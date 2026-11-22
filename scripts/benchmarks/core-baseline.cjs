'use strict';

// Opt-in core benchmark for the checked-out Validator source.
// The minimal VS Code stub is deliberate: this measures the synchronous
// traversal engine, NOT editor activation, native watchers or the VS Code UI.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const repo = path.resolve(__dirname, '../..');
const output = process.env.TPV_BENCHMARK_OUTPUT || path.join(repo, 'benchmark-core.json');
const iterations = Number(process.env.TPV_BENCHMARK_SAMPLES || 19);
const warmups = Number(process.env.TPV_BENCHMARK_WARMUPS || 3);
const syntheticMs = Number(process.env.TPV_SYNTHETIC_IO_MS || 0);
if (!Number.isSafeInteger(iterations) || iterations < 5 || iterations > 500 ||
    !Number.isSafeInteger(warmups) || warmups < 0 || warmups > 30 ||
    !Number.isFinite(syntheticMs) || syntheticMs < 0 || syntheticMs > 20) {
    throw new Error('Invalid sample, warmup or injected latency setting');
}

const fixtureParent = path.resolve(process.env.TPV_BENCHMARK_FIXTURE_PARENT || os.tmpdir());
if (!fs.existsSync(fixtureParent) || !fs.statSync(fixtureParent).isDirectory()) {
    throw new Error('TPV_BENCHMARK_FIXTURE_PARENT must be an existing disposable-fixture parent directory');
}
// Only create/remove our uniquely named child. Never inspect or mutate pre-existing model files.
const directory = fs.mkdtempSync(path.join(fixtureParent, 'tpv-core-benchmark-'));
const documents = [];
const settings = {
    diagnosticLevel: 'hint',
    enableLatestVersionChecks: true,
    enableIfStatementChecks: true,
    enableIfStatementFormatting: false
};
const uriFor = fileName => ({
    fsPath: path.normalize(fileName),
    toString() { return 'file://' + path.normalize(fileName).replace(/\\/g, '/'); }
});
class Range {
    constructor(line, start, endLine, end) {
        this.start = { line, character: start };
        this.end = { line: endLine, character: end };
    }
}
class Diagnostic {
    constructor(range, message, severity) {
        this.range = range;
        this.message = message;
        this.severity = severity;
    }
}
const vscode = {
    Range, Diagnostic,
    Uri: { file: uriFor },
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    workspace: {
        textDocuments: documents,
        getConfiguration(section) {
            assert.equal(section, 'tuflowValidator');
            return { get: (key, fallback) => settings[key] ?? fallback };
        }
    }
};
const originalLoad = Module._load;
let diagnostics;
try {
    Module._load = function (request, parent, isMain) {
        if (request === 'vscode') return vscode;
        return originalLoad.call(this, request, parent, isMain);
    };
    diagnostics = require(path.join(repo, 'out', 'diagnostics.js'));
} finally {
    Module._load = originalLoad;
}

const collected = new Map();
const collection = {
    set(uri, items) { collected.set(uri.fsPath, items); },
    delete(uri) { collected.delete(uri.fsPath); }
};
const fixtureManifest = [];
function create(relative, contents = '') {
    const target = path.join(directory, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
    fixtureManifest.push({
        path: relative.replace(/\\/g, '/'),
        bytes: Buffer.byteLength(contents),
        sha256: crypto.createHash('sha256').update(contents).digest('hex')
    });
    return target;
}
function makeDocument(fileName) {
    const doc = {
        fileName,
        languageId: 'tuflow',
        uri: uriFor(fileName),
        text: fs.readFileSync(fileName, 'utf8'),
        getText() { return this.text; }
    };
    documents.push(doc);
    return doc;
}
function closeDocument(doc) {
    diagnostics.removeDiagnosticsForDocument(doc, collection);
    const index = documents.indexOf(doc);
    if (index >= 0) documents.splice(index, 1);
}
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function snapshot() {
    const rows = [];
    for (const [file, issues] of collected) {
        for (const d of issues) {
            const code = typeof d.code === 'object' ? d.code.value : d.code;
            rows.push([path.relative(directory, file), d.range.start.line,
                d.range.start.character, d.severity, code, d.message].join('|'));
        }
    }
    rows.sort();
    return { count: rows.length, sha256: digest(rows.join('\n')), rows };
}

// Intercept the exact synchronous filesystem API used by the core engine.
// Only count calls targeting disposable fixtures; do not modify real GPKGs.
const operations = ['readFileSync', 'existsSync', 'readdirSync', 'statSync', 'lstatSync'];
const originals = {};
let activeCounters = null;
const prefix = path.normalize(directory + path.sep);
function isFixture(arg) {
    if (typeof arg !== 'string' && !Buffer.isBuffer(arg) && !(arg instanceof URL)) return false;
    try {
        const p = path.normalize(path.resolve(String(arg)));
        return p === directory || p.startsWith(prefix);
    } catch { return false; }
}
function injectDelay() {
    if (!syntheticMs) return;
    const deadline = performance.now() + syntheticMs;
    while (performance.now() < deadline) { /* intentionally synthetic */ }
}
for (const method of operations) {
    originals[method] = fs[method];
    fs[method] = function (...args) {
        if (activeCounters && isFixture(args[0])) {
            activeCounters[method]++;
            activeCounters.paths.add(path.normalize(String(args[0])));
            injectDelay();
        }
        return originals[method].apply(this, args);
    };
}
function handles() {
    return typeof process._getActiveHandles === 'function'
        ? process._getActiveHandles().length : null;
}
function fdCount() {
    if (process.platform !== 'linux') return null;
    try { return originals.readdirSync('/proc/self/fd').length; } catch { return null; }
}
const round = n => Math.round(n * 1000) / 1000;
function quantile(values, fraction) {
    if (!values.length) return null;
    const ordered = [...values].sort((a, b) => a - b);
    return round(ordered[Math.max(0, Math.ceil(fraction * ordered.length) - 1)]);
}
function summary(trials) {
    const values = key => trials.map(x => x[key]).filter(x => typeof x === 'number');
    return {
        samples: trials.length,
        medianMs: quantile(values('elapsedMs'), 0.5),
        p95Ms: quantile(values('elapsedMs'), 0.95),
        maxMs: quantile(values('elapsedMs'), 1),
        medianCpuUserMs: quantile(values('cpuUserMs'), 0.5),
        p95CpuUserMs: quantile(values('cpuUserMs'), 0.95),
        medianExistenceChecks: quantile(values('existsSync'), 0.5),
        medianFileReads: quantile(values('readFileSync'), 0.5),
        medianDirectoryEnumerations: quantile(values('readdirSync'), 0.5),
        medianDistinctFsTargets: quantile(values('distinctFsTargets'), 0.5),
        medianRssBytes: quantile(values('rssAfterBytes'), 0.5),
        medianOutstandingHandleProxy: quantile(values('activeHandlesAfter'), 0.5),
        medianLogicalWatcherDirectories: quantile(values('logicalWatcherDirectories'), 0.5)
    };
}
function one(action) {
    const counter = Object.fromEntries(operations.map(op => [op, 0]));
    counter.paths = new Set();
    activeCounters = counter;
    const beforeCpu = process.cpuUsage();
    const beforeMemory = process.memoryUsage();
    const beforeHandles = handles();
    const beforeFd = fdCount();
    const start = performance.now();
    let observed;
    try { observed = action(); }
    finally { activeCounters = null; }
    const elapsed = performance.now() - start;
    const cpu = process.cpuUsage(beforeCpu);
    const afterMemory = process.memoryUsage();
    const deps = diagnostics.getTrackedDependencyPaths();
    return {
        elapsedMs: round(elapsed),
        cpuUserMs: round(cpu.user / 1000),
        cpuSystemMs: round(cpu.system / 1000),
        rssBeforeBytes: beforeMemory.rss,
        rssAfterBytes: afterMemory.rss,
        heapBeforeBytes: beforeMemory.heapUsed,
        heapAfterBytes: afterMemory.heapUsed,
        activeHandlesBefore: beforeHandles,
        activeHandlesAfter: handles(),
        fileDescriptorsBefore: beforeFd,
        fileDescriptorsAfter: fdCount(),
        logicalDependencyPaths: deps.size,
        logicalWatcherDirectories: new Set([...deps].map(p => path.dirname(p))).size,
        readFileSync: counter.readFileSync,
        existsSync: counter.existsSync,
        readdirSync: counter.readdirSync,
        statSync: counter.statSync,
        lstatSync: counter.lstatSync,
        distinctFsTargets: counter.paths.size,
        diagnosticCount: observed?.count ?? null,
        diagnosticSignature: observed?.sha256 ?? null,
        ...(observed?.eventReturned === undefined ? {} : { eventReturned: observed.eventReturned })
    };
}
function measure(action, count = iterations, prewarm = warmups) {
    for (let i = 0; i < prewarm; i++) action();
    const trials = [];
    for (let i = 0; i < count; i++) trials.push(one(action));
    return { summary: summary(trials), trials };
}
function sampleAnalysis(doc) {
    diagnostics.updateDiagnostics(doc, collection);
    return snapshot();
}
function requireMissing(what) {
    const current = snapshot().rows;
    assert.ok(current.some(row => row.includes('File not found:')),
        what + ': fixture must produce at least one missing-file diagnostic');
}
function buildGraph(label, depth, width, copies) {
    const parts = [];
    const rootName = label + '/runs/' + label + '_v01.tcf';
    const prefixPath = label + '/runs/';
    create(prefixPath + 'existing.shp', '');
    for (let i = 0; i < width; i++) {
        const n = String(i).padStart(3, '0');
        const child = 'inc/wide_' + n + '.trd';
        create(prefixPath + child,
            'Read GIS Mat == existing.shp\nRead GIS Mat == missing_' + n + '.shp\n');
        parts.push('Read File == ' + child);
    }
    for (let i = 0; i < copies; i++) parts.push('Read File == inc/shared.trd');
    create(prefixPath + 'inc/shared.trd', 'Read GIS Mat == existing.shp\n');
    for (let i = depth - 1; i >= 0; i--) {
        const next = i === depth - 1 ? 'Read GIS Mat == tail_missing.shp\n'
            : 'Read File == inc/deep_' + String(i + 1).padStart(3, '0') + '.trd\n';
        create(prefixPath + 'inc/deep_' + String(i).padStart(3, '0') + '.trd', next);
    }
    if (depth) parts.push('Read File == inc/deep_000.trd');
    create(rootName, parts.join('\n') + '\n!edit:A\n');
    return rootName;
}

const small = create('small/runs/Root_v01.tcf',
    'Geometry Control File == geom_v01.tgc\nRead GIS Mat == data/absent.shp\n!edit:A\n');
const child = create('small/runs/geom_v01.tgc',
    'Read GIS Mat == data/present.gpkg\n! child:A\n');
create('small/runs/geom_v02.tgc', '! newer version\n');
create('small/runs/data/present.gpkg', ''); // physical existence only; never inspect SQLite content
const secondRoot = create('small/runs/Other_v01.tcf',
    'Geometry Control File == geom_v01.tgc\nRead GIS Mat == data/other_missing.shp\n');
const contextLines = [];
for (let i = 0; i < 24; i++) {
    const target = i % 2 ? 'data/unknown_' + i + '.shp' : 'data/present.shp';
    contextLines.push('Set Variable Target == ' + target);
    contextLines.push('Read File == shared.trd');
}
const contextRoot = create('contexts/runs/Context_v01.tcf', contextLines.join('\n') + '\n');
create('contexts/runs/shared.trd', 'Read GIS Mat == <<Target>>\n');
create('contexts/runs/data/present.shp', '');
const deepRoot = path.join(directory, buildGraph('deep', 48, 0, 2));
const wideRoot = path.join(directory, buildGraph('wide', 0, 120, 32));
const longRoot = create('long/runs/Lines_v01.tcf',
    Array.from({ length: 4000 }, (_, i) => i % 10 === 0
        ? 'Read GIS Mat == missing_' + i + '.shp'
        : '! generated comment ' + i).join('\n') + '\n');

fixtureManifest.sort((a, b) => a.path.localeCompare(b.path));
const report = {
    schemaVersion: 1,
    scope: 'synchronous-validator-core-only',
    issue: 'Chain-Frost/tuflow_validator#3',
    source: {
        commit: process.env.TPV_SOURCE_SHA || 'unrecorded',
        packageJsonSha256: digest(fs.readFileSync(path.join(repo, 'package.json'))),
        vsixPath: process.env.TPV_VSIX_PATH || null,
        vsixSha256: process.env.TPV_VSIX_PATH
            ? digest(fs.readFileSync(process.env.TPV_VSIX_PATH)) : null
    },
    environment: {
        recordedAt: new Date().toISOString(),
        platform: process.platform, arch: process.arch,
        osRelease: os.release(), osVersion: os.version(),
        node: process.version,
        vscode: 'not applicable (Node core harness; host covered separately)',
        cpuModel: os.cpus()[0]?.model,
        cpuCount: os.cpus().length, memoryBytes: os.totalmem(),
        storage: process.env.TPV_STORAGE_LABEL || 'temp directory (medium not independently verified)',
        fixtureParent,
        suppliedNetworkOrDriveLabel: process.env.TPV_BENCHMARK_NETWORK_EVIDENCE || null,
        fixtureLocation: directory,
        fixtureBytes: fixtureManifest.reduce((acc, f) => acc + f.bytes, 0),
        fixtureFiles: fixtureManifest.length,
        fixtureManifestSha256: digest(JSON.stringify(fixtureManifest)),
        realMappedOrUncEvidence: process.env.TPV_BENCHMARK_FIXTURE_PARENT
            ? 'custom filesystem parent supplied; network identity/metadata latency requires independent verification'
            : 'not measured: operating-system temporary directory',
        syntheticIoLatencyMsPerFixtureOperation: syntheticMs,
        pageCacheFlushed: false, coldDiskMeasured: false,
        settings, warmups, timedSamples: iterations,
        readOnlyGeoPackageContents: true
    },
    notes: [
        'The first run is cold engine state only: fixture creation warms OS metadata/page caches.',
        'Synchronous fs operations instrumented only inside disposable fixture tree.',
        'Missing-file diagnostics are preserved, including unresolved condition branches; runtime tokens are not replaced.',
        'Watcher counts are logical dependency-directory estimates, not native VS Code FileSystemWatcher/OS handle counts.',
        'No extension activation, debounce, filesystem watcher delivery or extension-host responsiveness is measured here.',
        'Synthetic latency is injected blocking time on fixture filesystem calls, never a real network measurement.',
        'Helper PR #16 supplies compatible editor/coexistence acceptance measurements separately.'
    ],
    results: {}, observations: {}, fixtureManifest
};
let failed = null;
const roots = [];
try {
    const baseDoc = makeDocument(small);
    roots.push(baseDoc);
    report.results.firstAnalysis = { ...one(() => sampleAnalysis(baseDoc)), type: 'single non-repeated trial' };
    requireMissing('firstAnalysis');
    report.results.warmAnalysis = measure(() => sampleAnalysis(baseDoc));
    let edit = false;
    report.results.singleCharacterEdit = measure(() => {
        edit = !edit;
        baseDoc.text = baseDoc.text.replace(/!edit:[AB]/, edit ? '!edit:B' : '!edit:A');
        return sampleAnalysis(baseDoc);
    });
    report.results.includedChildChange = measure(() => {
        edit = !edit;
        fs.writeFileSync(child, 'Read GIS Mat == data/present.gpkg\n! child:' + (edit ? 'B' : 'A') + '\n');
        const eventReturned = diagnostics.updateDiagnosticsForChangedPath(child, collection);
        return { ...snapshot(), eventReturned };
    });
    assert.ok(report.results.includedChildChange.trials.every(trial => trial.eventReturned === true),
        'Dependency invalidation did not recognise the included child');

    const sibling = create('small/runs/geom_v03.tgc', '! newer version sibling\n');
    report.observations.versionSiblingWatcherEvent = one(() => ({
        ...snapshot(),
        eventReturned: diagnostics.updateDiagnosticsForChangedPath(sibling, collection)
    }));
    report.results.versionSiblingExplicitRevalidation = measure(() => sampleAnalysis(baseDoc));

    const secondDoc = makeDocument(secondRoot);
    roots.push(secondDoc);
    sampleAnalysis(secondDoc);
    report.results.multipleRootChildChange = measure(() => {
        edit = !edit;
        fs.writeFileSync(child, 'Read GIS Mat == data/present.gpkg\n! child:' + (edit ? 'B' : 'A') + '\n');
        const eventReturned = diagnostics.updateDiagnosticsForChangedPath(child, collection);
        return { ...snapshot(), eventReturned };
    });
    assert.ok(report.results.multipleRootChildChange.trials.every(trial => trial.eventReturned === true),
        'Both active roots should track a shared included child');
    closeDocument(secondDoc);
    roots.pop();
    closeDocument(baseDoc);
    roots.pop();

    for (const [name, file] of [
        ['repeatedIncludeDifferentVariables', contextRoot],
        ['deepGraph', deepRoot],
        ['wideGraph', wideRoot],
        ['longControlFile', longRoot]
    ]) {
        const doc = makeDocument(file);
        roots.push(doc);
        const measurements = measure(() => sampleAnalysis(doc));
        report.results[name] = measurements;
        requireMissing(name);
        assert.equal(new Set(measurements.trials.map(t => t.diagnosticSignature)).size, 1,
            name + ' must produce deterministic diagnostics across repeated runs');
        closeDocument(doc);
        roots.pop();
    }
} catch (error) {
    failed = error;
    report.failure = String(error?.stack || error);
} finally {
    for (const doc of [...roots].reverse()) closeDocument(doc);
    report.observations.afterDisposal = {
        openRootDocuments: documents.length,
        logicalDependencyPaths: diagnostics.getTrackedDependencyPaths().size,
        activeHandles: handles(), fileDescriptors: fdCount()
    };
    for (const method of operations) fs[method] = originals[method];
    fs.rmSync(directory, { recursive: true, force: true });
    report.environment.fixturesRemoved = !fs.existsSync(directory);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    console.log('[tpv-core] source=' + report.source.commit +
        ' node=' + process.version + ' platform=' + process.platform +
        ' samples=' + iterations + ' injectedMs=' + syntheticMs);
    for (const [name, result] of Object.entries(report.results)) {
        const s = result.summary || result;
        console.log('[tpv-core] ' + name + ' median=' + (s.medianMs ?? s.elapsedMs) +
            'ms p95=' + (s.p95Ms ?? 'n/a') + 'ms reads=' +
            (s.medianFileReads ?? s.readFileSync) + ' exists=' +
            (s.medianExistenceChecks ?? s.existsSync) + ' dirs=' +
            (s.medianDirectoryEnumerations ?? s.readdirSync));
    }
    console.log('[tpv-core] raw-report=' + output + ' failure=' + (report.failure || 'none'));
}
if (failed) process.exitCode = 1;
