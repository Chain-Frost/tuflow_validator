import * as assert from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { performance } from 'perf_hooks';
import {
    createGeoPackageInventoryPass,
    disposeGeoPackageInventory,
    GEOPACKAGE_REQUEST_TIMEOUT_MS,
    GEOPACKAGE_WORKER_LIMIT,
    getGeoPackageInventoryStats,
    invalidateGeoPackage,
    resetGeoPackageInventoryStats
} from '../geopackageInventory';
import { createGeoPackage, fixturePython } from './helpers/gpkgFixtures';

// This measures the metadata service, not the VS Code diagnostic pipeline.
// Fixture preparation, integrity hashes and warm-cache priming are not timed.
const REFERENCE_COUNTS = [1, 10, 100, 1000];
const PAYLOAD_BYTES = 16 * 1024 * 1024;
const DISTINCT_DATABASES = 16;
const HEARTBEAT_INTERVAL_MS = 2;
const HEARTBEAT_DRAIN_MS = 3;
const MODES = ['off', 'metadata-cache-cleared', 'metadata-cache-warm'] as const;
type Mode = typeof MODES[number];

interface Fixture {
    id: string;
    filePath: string;
    layers: string[];
    payloadBytes: number;
}

interface Dataset {
    id: string;
    description: string;
    fixtures: Fixture[];
}

interface FileSignature {
    sha256: string;
    sizeBytes: number;
    mtimeMs: number;
    ctimeMs: number;
}

interface HeartbeatSample {
    additionalDelayMs: number;
    rssBytes: number;
}

interface Trial {
    trial: number;
    elapsedMs: number;
    pathExistsCalls: number;
    inventory: ReturnType<typeof getGeoPackageInventoryStats>;
    heartbeatSamples: number;
    heartbeatMaxAdditionalDelayMs: number | null;
    sampledPeakRssBytes: number;
    rssAfterBytes: number;
    openDescriptorsAfter: number | null;
}

function configuredTrials(): number {
    const trials = Number(process.env.TPV_BENCHMARK_TRIALS ?? 30);
    if (!Number.isInteger(trials) || trials < 5 || trials > 200) {
        throw new Error('TPV_BENCHMARK_TRIALS must be an integer between 5 and 200.');
    }
    return trials;
}

function delay(milliseconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function percentile(values: number[], fraction: number): number {
    assert.ok(values.length > 0);
    const ordered = [...values].sort((left, right) => left - right);
    return ordered[Math.max(0, Math.ceil(fraction * ordered.length) - 1)];
}

function summarize(values: number[]) {
    const ordered = [...values].sort((left, right) => left - right);
    const middle = Math.floor(ordered.length / 2);
    return {
        samples: values.length,
        min: ordered[0],
        median: ordered.length % 2 === 0 ? (ordered[middle - 1] + ordered[middle]) / 2 : ordered[middle],
        p95: percentile(ordered, 0.95),
        max: ordered[ordered.length - 1]
    };
}

function openDescriptorCount(): number | null {
    if (process.platform !== 'linux') {
        return null;
    }
    try {
        return fs.readdirSync('/proc/self/fd').length;
    } catch {
        return null;
    }
}

async function fileSignature(filePath: string): Promise<FileSignature> {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(filePath)) {
        hash.update(chunk);
    }
    const stat = fs.statSync(filePath);
    return { sha256: hash.digest('hex'), sizeBytes: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs };
}

function sourceIdentity() {
    let gitHead: string | null = null;
    let gitDirty: boolean | null = null;
    try {
        gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
        gitDirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0;
    } catch {
        // The compiled benchmark can also run outside a Git checkout.
    }
    const compiledSha256: Record<string, string> = {};
    for (const relative of ['geopackageInventory.js', 'geopackageReader.js', 'geopackageWorker.js', 'test/benchmarkGeoPackage.js', 'test/helpers/gpkgFixtures.js']) {
        const absolute = path.resolve(__dirname, '..', relative);
        compiledSha256[relative] = crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
    }
    return { gitHead, gitDirty, compiledSha256 };
}

function prepareDatasets(directory: string): Dataset[] {
    const datasets: Dataset[] = [];
    const addSingleDatabase = (id: string, layerCount: number, payloadBytes: number, description: string) => {
        const layers: string[] = [];
        for (let index = 0; index < layerCount; index++) {
            layers.push(`layer_${index.toString().padStart(3, '0')}`);
        }
        const fixture: Fixture = { id, filePath: path.join(directory, `${id}.gpkg`), layers, payloadBytes };
        createGeoPackage(fixture.filePath, layers, { paddingBytes: payloadBytes });
        datasets.push({ id, description, fixtures: [fixture] });
    };
    addSingleDatabase('single', 1, 0, 'One empty spatial layer; repeated references to the same database.');
    addSingleDatabase('multi', 8, 0, 'Eight empty spatial layers in one database.');
    addSingleDatabase('many_layers', 100, 0, 'One hundred empty spatial layers in one database.');
    addSingleDatabase('payload_16mib', 1, PAYLOAD_BYTES,
        'One empty spatial layer plus a registered attributes table containing a materialized 16 MiB SQLite zeroblob; no sparse-file padding.');
    const distinct: Fixture[] = [];
    for (let index = 0; index < DISTINCT_DATABASES; index++) {
        const id = `distinct_${index.toString().padStart(2, '0')}`;
        const fixture: Fixture = { id, filePath: path.join(directory, `${id}.gpkg`), layers: ['layer_000'], payloadBytes: 0 };
        createGeoPackage(fixture.filePath, fixture.layers);
        distinct.push(fixture);
    }
    datasets.push({
        id: 'distinct_16',
        description: 'References cycle over up to sixteen distinct single-layer databases; fewer references use fewer databases.',
        fixtures: distinct
    });
    return datasets;
}

function referencesFor(dataset: Dataset, count: number): Fixture[] {
    const references: Fixture[] = [];
    for (let index = 0; index < count; index++) {
        references.push(dataset.fixtures[index % dataset.fixtures.length]);
    }
    return references;
}

async function inspectReferences(references: Fixture[], enabled: boolean): Promise<void> {
    const inspect = enabled ? createGeoPackageInventoryPass() : undefined;
    const verified = new Set<string>();
    for (const fixture of references) {
        assert.ok(fs.existsSync(fixture.filePath), `Missing benchmark fixture: ${fixture.id}`);
        if (!inspect) {
            continue;
        }
        const result = await inspect(fixture.filePath);
        if (result.status !== 'ok') {
            throw new Error(`${fixture.id}: ${result.reasonCode}: ${result.reason}`);
        }
        // Verify every distinct inventory once per pass, outside feature rows.
        if (!verified.has(fixture.filePath)) {
            assert.deepStrictEqual(result.layers, [...fixture.layers].sort());
            verified.add(fixture.filePath);
        }
    }
}

function summarizeMode(trials: Trial[]) {
    return {
        elapsedMs: summarize(trials.map(trial => trial.elapsedMs)),
        metadataReads: summarize(trials.map(trial => trial.inventory.metadataReads)),
        fileOpens: summarize(trials.map(trial => trial.inventory.fileOpens)),
        bytesRead: summarize(trials.map(trial => trial.inventory.bytesRead)),
        pagesRead: summarize(trials.map(trial => trial.inventory.pagesRead)),
        cacheHits: summarize(trials.map(trial => trial.inventory.cacheHits)),
        workerRequests: summarize(trials.map(trial => trial.inventory.workerRequests)),
        heartbeatObservedSamples: trials.reduce((total, trial) => total + trial.heartbeatSamples, 0),
        heartbeatMaxAdditionalDelayMs: Math.max(...trials.map(trial => trial.heartbeatMaxAdditionalDelayMs ?? 0)),
        sampledPeakRssBytes: Math.max(...trials.map(trial => trial.sampledPeakRssBytes)),
        timeouts: trials.reduce((total, trial) => total + trial.inventory.timeouts, 0)
    };
}

/** Keep complete raw trials on single lines instead of generating a huge diff. */
function formatReport(value: unknown, depth = 0): string {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }
    const indent = '  '.repeat(depth);
    const childIndent = indent + '  ';
    if (Array.isArray(value)) {
        if (value.length === 0 || value.every(item => item === null || typeof item !== 'object')) {
            return JSON.stringify(value);
        }
        return '[\n' + value.map(item => childIndent + formatReport(item, depth + 1)).join(',\n') + '\n' + indent + ']';
    }
    const entries = Object.entries(value);
    if (Object.prototype.hasOwnProperty.call(value, 'trial') ||
        entries.every(([, item]) => item === null || typeof item !== 'object')) {
        return JSON.stringify(value);
    }
    return '{\n' + entries.map(([key, item]) =>
        childIndent + JSON.stringify(key) + ': ' + formatReport(item, depth + 1)
    ).join(',\n') + '\n' + indent + '}';
}

async function main(): Promise<void> {
    const trials = configuredTrials();
    const output = path.resolve(process.env.TPV_BENCHMARK_OUTPUT ?? 'docs/benchmarks/gpkg-local.json');
    const parentDirectory = path.resolve(process.env.TPV_BENCHMARK_DIRECTORY ?? os.tmpdir());
    fs.mkdirSync(parentDirectory, { recursive: true });
    const directory = fs.mkdtempSync(path.join(parentDirectory, 'tpv-gpkg-benchmark-'));
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    try {
        const identity = sourceIdentity();
        const datasets = prepareDatasets(directory);
        const fixtures: Fixture[] = [];
        for (const dataset of datasets) {
            fixtures.push(...dataset.fixtures);
        }
        const before = new Map<string, FileSignature>();
        for (const fixture of fixtures) {
            before.set(fixture.id, await fileSignature(fixture.filePath));
        }
        const filesBefore = fs.readdirSync(directory).sort();
        const memoryBeforeWorkers = process.memoryUsage();
        const descriptorsBeforeWorkers = openDescriptorCount();
        const heartbeats: HeartbeatSample[] = [];
        let lastHeartbeat = performance.now();
        heartbeat = setInterval(() => {
            const now = performance.now();
            heartbeats.push({
                additionalDelayMs: Math.max(0, now - lastHeartbeat - HEARTBEAT_INTERVAL_MS),
                rssBytes: process.memoryUsage().rss
            });
            lastHeartbeat = now;
        }, HEARTBEAT_INTERVAL_MS);
        await delay(HEARTBEAT_DRAIN_MS);

        const measure = async (references: Fixture[], mode: Mode, trial: number): Promise<Trial> => {
            const uniqueCount = new Set(references.map(fixture => fixture.filePath)).size;
            if (mode === 'metadata-cache-cleared') {
                invalidateGeoPackage();
            } else if (mode === 'metadata-cache-warm') {
                // Priming is excluded from both timings and reported read counters.
                const unique = new Map<string, Fixture>();
                for (const fixture of references) {
                    unique.set(fixture.filePath, fixture);
                }
                await inspectReferences([...unique.values()], true);
            }
            resetGeoPackageInventoryStats();
            const heartbeatStart = heartbeats.length;
            const rssBefore = process.memoryUsage().rss;
            const start = performance.now();
            await inspectReferences(references, mode !== 'off');
            const elapsedMs = performance.now() - start;
            const inventory = getGeoPackageInventoryStats();
            assert.strictEqual(inventory.timeouts, 0);
            assert.strictEqual(inventory.pendingRequests, 0);
            assert.ok(inventory.activeWorkers <= GEOPACKAGE_WORKER_LIMIT);
            assert.strictEqual(inventory.workerRequests, mode === 'off' ? 0 : uniqueCount);
            assert.strictEqual(inventory.metadataReads, mode === 'metadata-cache-cleared' ? uniqueCount : 0);
            assert.strictEqual(inventory.cacheHits, mode === 'metadata-cache-warm' ? uniqueCount : 0);
            // Let a timer delayed by synchronous path checks run. This drain is
            // outside elapsedMs; heartbeat windows include the following 3 ms.
            await delay(HEARTBEAT_DRAIN_MS);
            const observed = heartbeats.slice(heartbeatStart);
            const rssAfterBytes = process.memoryUsage().rss;
            return {
                trial, elapsedMs, pathExistsCalls: references.length, inventory,
                heartbeatSamples: observed.length,
                heartbeatMaxAdditionalDelayMs: observed.length === 0 ? null
                    : Math.max(...observed.map(sample => sample.additionalDelayMs)),
                sampledPeakRssBytes: Math.max(rssBefore, rssAfterBytes, ...observed.map(sample => sample.rssBytes)),
                rssAfterBytes, openDescriptorsAfter: openDescriptorCount()
            };
        };

        const firstWorkerRead = await measure([fixtures[0]], 'metadata-cache-cleared', 0);
        // Start both worker slots before the steady-state matrix. This is not
        // included in its cold-reader-cache timings.
        await inspectReferences(fixtures, true);
        const results = [];
        for (const dataset of datasets) {
            for (const referenceCount of REFERENCE_COUNTS) {
                const references = referencesFor(dataset, referenceCount);
                const samples: Record<Mode, Trial[]> = { off: [], 'metadata-cache-cleared': [], 'metadata-cache-warm': [] };
                for (let trial = 0; trial < trials; trial++) {
                    // Rotate mode order to avoid always timing off before on.
                    for (let offset = 0; offset < MODES.length; offset++) {
                        const mode = MODES[(trial + offset) % MODES.length];
                        samples[mode].push(await measure(references, mode, trial + 1));
                    }
                }
                const summary = {
                    off: summarizeMode(samples.off),
                    'metadata-cache-cleared': summarizeMode(samples['metadata-cache-cleared']),
                    'metadata-cache-warm': summarizeMode(samples['metadata-cache-warm'])
                };
                results.push({
                    dataset: dataset.id, referenceCount,
                    distinctDatabases: new Set(references.map(fixture => fixture.filePath)).size,
                    summary, trials: samples
                });
                console.log(`Measured ${dataset.id}: ${referenceCount} references (${trials} trials per mode).`);
            }
        }

        clearInterval(heartbeat);
        heartbeat = undefined;
        disposeGeoPackageInventory();
        const shutdownDeadline = performance.now() + GEOPACKAGE_REQUEST_TIMEOUT_MS;
        while (getGeoPackageInventoryStats().activeWorkers > 0 && performance.now() < shutdownDeadline) {
            await delay(10);
        }
        assert.strictEqual(getGeoPackageInventoryStats().activeWorkers, 0, 'Workers did not finish shutdown.');
        const memoryAfterWorkersDisposed = process.memoryUsage();
        const descriptorsAfterWorkersDisposed = openDescriptorCount();
        const integrity = [];
        for (const fixture of fixtures) {
            const after = await fileSignature(fixture.filePath);
            const original = before.get(fixture.id)!;
            assert.deepStrictEqual(after, original, `Read-only integrity changed for ${fixture.id}`);
            integrity.push({ fixture: fixture.id, before: original, after, unchanged: true });
        }
        const filesAfter = fs.readdirSync(directory).sort();
        assert.deepStrictEqual(filesAfter, filesBefore, 'Validation created or removed fixture files/sidecars.');
        const finalIdentity = sourceIdentity();
        assert.deepStrictEqual(finalIdentity.compiledSha256, identity.compiledSha256,
            'Compiled benchmark or reader changed during the run.');
        const report = {
            schemaVersion: 1,
            generatedAt: new Date().toISOString(),
            status: 'passed',
            scope: 'Synthetic metadata-service microbenchmark; not full extension validation or representative project/network evidence.',
            source: identity,
            environment: {
                platform: process.platform, release: os.release(), architecture: process.arch,
                node: process.version, pythonForFixtureGeneration: fixturePython(),
                cpuModel: os.cpus()[0]?.model ?? 'unknown', logicalCpus: os.cpus().length,
                hostMemoryBytes: os.totalmem(),
                fixtureParentDirectory: parentDirectory,
                storageLabel: process.env.TPV_BENCHMARK_STORAGE_LABEL ?? 'Unclassified storage; report physical/network conditions separately.'
            },
            methodology: {
                trialsPerMode: trials, referenceCounts: REFERENCE_COUNTS, modeOrder: 'rotated every trial',
                baseline: 'One synchronous fs.existsSync per reference; no parsing, latest-version directory scans, diagnostic creation or VS Code events.',
                enabled: 'Same path checks plus sequential calls through a fresh createGeoPackageInventoryPass; inventory asserted once per distinct database.',
                coldMeaning: 'Worker inventory cache invalidated before every trial; workers remain alive. OS and storage caches are not cold.',
                warmMeaning: 'Fresh pass after untimed inventory priming; identity/header verification remains enabled.',
                firstWorkerRead: 'Separate first read includes startup of one worker; subsequent matrix runs after both slots have been warmed.',
                memoryCaveat: 'RSS includes all process threads and is sampled, not an OS peak. Off trials retain already-started idle workers; not isolated off/on memory comparisons.',
                descriptorCaveat: 'Linux /proc/self/fd snapshots outside timed work; null on other systems. Not peak native handle measurements.',
                heartbeat: `A ${HEARTBEAT_INTERVAL_MS} ms timer measures additional scheduling delay; per-trial observation includes an untimed ${HEARTBEAT_DRAIN_MS} ms drain. Instrumentation and shared-host scheduling affect it.`,
                percentile: 'p95 uses nearest rank; median averages the two central values for even counts.',
                exclusions: ['feature/geometry validation', 'control-file parsing/traversal', 'editor debounce/UI latency', 'QGIS locks/WAL', 'network/offline shares', 'real multi-GB datasets']
            },
            workerLimit: GEOPACKAGE_WORKER_LIMIT,
            datasets: datasets.map(dataset => ({
                id: dataset.id, description: dataset.description,
                fixtures: dataset.fixtures.map(fixture => ({
                    id: fixture.id, spatialLayerCount: fixture.layers.length,
                    materializedPayloadBytes: fixture.payloadBytes, sizeBytes: before.get(fixture.id)!.sizeBytes
                }))
            })),
            firstWorkerRead,
            process: { memoryBeforeWorkers, memoryAfterWorkersDisposed, descriptorsBeforeWorkers, descriptorsAfterWorkersDisposed },
            results,
            integrity: { allFilesUnchanged: true, noSidecarsCreatedOrRemoved: true, files: integrity },
            defaultDecision: 'Keep enableGeoPackageLayerChecks false; Windows, QGIS and representative network validation remain outstanding.'
        };
        fs.mkdirSync(path.dirname(output), { recursive: true });
        fs.writeFileSync(output, formatReport(report) + '\n');
        console.log(JSON.stringify({ status: report.status, output, cases: results.length,
            measuredTrials: results.length * MODES.length * trials, unchangedFiles: integrity.length }));
    } finally {
        if (heartbeat) {
            clearInterval(heartbeat);
        }
        disposeGeoPackageInventory();
        fs.rmSync(directory, { recursive: true, force: true });
    }
}

if (require.main === module) {
    void main().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}
