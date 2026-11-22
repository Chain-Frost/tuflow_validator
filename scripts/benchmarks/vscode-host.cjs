'use strict';

// Opt-in Validator-only Extension Host probe. Helper PR #16 owns the wider
// coexistence/profile measurements; this probes Validator-specific timings.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const vscode = require('vscode');

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const round = n => Math.round(n * 1000) / 1000;
const q = (values, fraction) => {
    if (!values.length) return null;
    const ordered = [...values].sort((a, b) => a - b);
    return round(ordered[Math.max(0, Math.ceil(fraction * ordered.length) - 1)]);
};
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const code = diag => typeof diag.code === 'object' && diag.code
    ? diag.code.value : diag.code;
function diagView(uri) {
    return vscode.languages.getDiagnostics(uri).map(d => ({
        code: code(d),
        severity: d.severity, line: d.range.start.line, message: d.message
    }));
}
function fdCount() {
    if (process.platform !== 'linux') return null;
    try { return fs.readdirSync('/proc/self/fd').length; } catch { return null; }
}
function handleCount() {
    return typeof process._getActiveHandles === 'function'
        ? process._getActiveHandles().length : null;
}
function waitForDiagnosticEvent(uri, timeoutMs = 6000, predicate = () => true) {
    let timer, subscription;
    const promise = new Promise(resolve => {
        const finish = result => {
            if (timer) clearTimeout(timer);
            if (subscription) subscription.dispose();
            resolve(result);
        };
        subscription = vscode.languages.onDidChangeDiagnostics(event => {
            if (event.uris.some(changed => changed.toString() === uri.toString())
                && predicate()) finish({ observed: true, reason: 'diagnostic event' });
        });
        if (predicate()) {
            finish({ observed: true, reason: 'already satisfied' });
            return;
        }
        timer = setTimeout(() => finish({ observed: false, reason: 'timeout' }), timeoutMs);
    });
    return promise;
}
// Event-only variant avoids counting an existing matching diagnostic as a new
// response to an edit. It always creates its listener BEFORE applying edits.
function nextDiagnosticEvent(uri, timeoutMs = 6000) {
    let timer, sub;
    const promise = new Promise(resolve => {
        const done = observed => {
            if (timer) clearTimeout(timer);
            if (sub) sub.dispose();
            resolve(observed);
        };
        sub = vscode.languages.onDidChangeDiagnostics(event => {
            if (event.uris.some(changed => changed.toString() === uri.toString())) done(true);
        });
        timer = setTimeout(() => done(false), timeoutMs);
    });
    return promise;
}
async function replaceMarker(doc, markerLabel, char, affectedUri) {
    const body = doc.getText();
    const index = body.indexOf(markerLabel + ':');
    if (index < 0) throw new Error('Fixture edit marker absent: ' + markerLabel);
    const offset = index + markerLabel.length + 1;
    if (!/[AB]/.test(body[offset])) throw new Error('Expected A/B marker');
    const change = new vscode.WorkspaceEdit();
    change.replace(doc.uri,
        new vscode.Range(doc.positionAt(offset), doc.positionAt(offset + 1)), char);
    const start = performance.now();
    const observed = nextDiagnosticEvent(affectedUri);
    const applied = await vscode.workspace.applyEdit(change);
    if (!applied) throw new Error('VS Code rejected fixture edit');
    const updated = await observed;
    if (!updated) throw new Error('No diagnostic update event after editor change to ' + doc.fileName);
    return { elapsedMs: round(performance.now() - start), updated, rootDiagnosticCount: diagView(affectedUri).length };
}
function stats(samples) {
    return {
        count: samples.length, medianMs: q(samples.map(x => x.elapsedMs), 0.5),
        p95Ms: q(samples.map(x => x.elapsedMs), 0.95),
        rawSamples: samples
    };
}
module.exports.run = async function run() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tpv-host-benchmark-'));
    const source = process.env.TPV_SOURCE_SHA || 'unrecorded';
    const vsix = process.env.TPV_VSIX_PATH || null;
    const output = process.env.TPV_HOST_BENCHMARK_OUTPUT ||
        path.join(os.tmpdir(), 'tpv-host-benchmark.json');
    const ext = vscode.extensions.all.find(e =>
        e.id.toLowerCase() === 'chain-frost.tuflow-path-validator');
    if (!ext) throw new Error('Validator extension is not installed in Extension Host');
    const report = {
        schemaVersion: 1, issue: 'Chain-Frost/tuflow_validator#3',
        scope: 'real VS Code extension host (Validator only)',
        source: {
            commit: source, extensionId: ext.id,
            extensionVersion: ext.packageJSON.version,
            vsixSha256: vsix && fs.existsSync(vsix) ? sha256(fs.readFileSync(vsix)) : null,
            initiallyActive: ext.isActive
        },
        environment: {
            recordedAt: new Date().toISOString(),
            vscode: vscode.version, node: process.version, platform: process.platform,
            arch: process.arch, osRelease: os.release(), cpuModel: os.cpus()[0]?.model,
            storage: 'disposable OS local temp; cache state and physical medium unknown',
            workspaceFolderCount: vscode.workspace.workspaceFolders?.length || 0,
            effectiveSettings: Object.fromEntries([
                'diagnosticLevel', 'enableLatestVersionChecks', 'enableIfStatementChecks'
            ].map(key => [key, vscode.workspace.getConfiguration('tuflowValidator').get(key)])),
            sourcePath: ext.extensionPath,
            geoPackageContentsInspected: false, trueColdDisk: false,
            networkDriveTest: 'unavailable'
        },
        fixtures: [], results: {}, observations: {}, limitations: [
            'First validation time is an activation/readiness proxy, not VS Code internal activation telemetry.',
            'Edit measurements include the current debounce and VS Code event delivery, unlike core microbenchmarks.',
            'process CPU and active-handle observations include other extension-host work.',
            'Logical tracked directories do not establish the number of OS/native FileSystemWatcher handles.',
            'No disk cache flush and no actual UNC/mapped-drive latency measurement.',
            'No GeoPackage catalog or SQLite contents are opened.'
        ]
    };
    const closeEvents = [];
    const closeSubscription = vscode.workspace.onDidCloseTextDocument(doc => {
        if (path.normalize(doc.fileName).startsWith(path.normalize(root + path.sep))) {
            closeEvents.push(path.relative(root, doc.fileName));
        }
    });
    const file = (relative, contents) => {
        const p = path.join(root, relative);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, contents);
        report.fixtures.push({ path: relative, bytes: Buffer.byteLength(contents), sha256: sha256(contents) });
        return p;
    };
    const child = file('geom_v01.tgc', 'Read GIS Mat == data/existing.gpkg\n!child:A\n');
    file('geom_v02.tgc', '! second version\n');
    file('data/existing.gpkg', '');
    const rootFile = file('Run_v01.tcf',
        'Geometry Control File == geom_v01.tgc\nRead GIS Mat == data/missing.shp\n!edit:A\n');
    const rootUri = vscode.Uri.file(rootFile);
    let exception;
    let heartbeat;
    let wideHeartbeat;
    try {
        const beforeCpu = process.cpuUsage();
        const beforeRss = process.memoryUsage().rss;
        const start = performance.now();
        const firstChange = waitForDiagnosticEvent(rootUri, 12000,
            () => diagView(rootUri).some(d => d.message.startsWith('File not found:')));
        const rootDoc = await vscode.workspace.openTextDocument(rootUri);
        report.environment.languageId = rootDoc.languageId;
        await vscode.window.showTextDocument(rootDoc, { preview: false });
        await ext.activate();
        const first = await firstChange;
        report.results.firstValidation = {
            elapsedMs: round(performance.now() - start),
            diagnosticArrived: first.observed,
            reason: first.reason,
            afterActivation: ext.isActive,
            diagnosticCount: diagView(rootUri).length
        };
        if (!first.observed) throw new Error('First-validation missing-file diagnostic not observed');
        await pause(600);

        const heartbeatIntervals = [];
        let lastTick = performance.now();
        heartbeat = setInterval(() => {
            const now = performance.now();
            heartbeatIntervals.push(Math.max(0, now - lastTick - 10));
            lastTick = now;
        }, 10);
        const rootEdits = [];
        for (let i = 0; i < 10; i++) {
            rootEdits.push(await replaceMarker(rootDoc, '!edit', i % 2 ? 'A' : 'B', rootUri));
        }
        report.results.singleCharacterEdits = stats(rootEdits);

        const childDoc = await vscode.workspace.openTextDocument(vscode.Uri.file(child));
        await vscode.window.showTextDocument(childDoc, { preview: false });
        await pause(600);
        const childEdits = [];
        for (let i = 0; i < 10; i++) {
            childEdits.push(await replaceMarker(childDoc, '!child', i % 2 ? 'A' : 'B', rootUri));
        }
        report.results.includedChildEdits = stats(childEdits);
        clearInterval(heartbeat);
        heartbeat = null;
        report.results.extensionHostHeartbeat = {
            intervalMs: 10, samples: heartbeatIntervals.length,
            medianDelayMs: q(heartbeatIntervals, 0.5),
            p95DelayMs: q(heartbeatIntervals, 0.95),
            maxDelayMs: q(heartbeatIntervals, 1)
        };

        // A sibling is not a tracked dependency simply by sharing a directory.
        // Record what actually happens; never presume latest-version freshness.
        const before = diagView(rootUri);
        const pending = nextDiagnosticEvent(rootUri, 1400);
        file('geom_v03.tgc', '! new sibling\n');
        const observed = await pending;
        report.observations.versionSibling = {
            diagnosticEventArrived: observed,
            before, after: diagView(rootUri)
        };
        // Single real Extension Host wide-graph probe, complementing the
        // repeated core-only wide-graph samples. First diagnostic arrival is
        // NOT a substitute for warm or true cold-disk measurements.
        const wideLines = [];
        for (let i = 0; i < 120; ++i) {
            const suffix = String(i).padStart(3, '0');
            file('wide/inc/wide_' + suffix + '.trd',
                'Read GIS Mat == missing_' + suffix + '.shp\n');
            wideLines.push('Read File == inc/wide_' + suffix + '.trd');
        }
        file('wide/inc/shared.trd', '! shared control text\n');
        for (let i = 0; i < 32; ++i) wideLines.push('Read File == inc/shared.trd');
        const wideUri = vscode.Uri.file(file('wide/Wide_v01.tcf', wideLines.join('\n') + '\n'));
        const wideChanges = waitForDiagnosticEvent(wideUri, 18000, () =>
            diagView(wideUri).filter(d => d.message.startsWith('Referenced file has')).length >= 120
        );
        const wideHostJitter = [];
        let wideLastTick = performance.now();
        wideHeartbeat = setInterval(() => {
            const now = performance.now();
            wideHostJitter.push(Math.max(0, now - wideLastTick - 10));
            wideLastTick = now;
        }, 10);
        const wideStart = performance.now();
        const wideCpu = process.cpuUsage();
        const wideRss = process.memoryUsage().rss;
        const wideDoc = await vscode.workspace.openTextDocument(wideUri);
        await vscode.window.showTextDocument(wideDoc, { preview: false });
        const wideStatus = await wideChanges;
        const wideElapsed = performance.now() - wideStart;
        const wideCpuDelta = process.cpuUsage(wideCpu);
        clearInterval(wideHeartbeat);
        wideHeartbeat = null;
        report.results.wideGraphValidation = {
            elapsedMs: round(wideElapsed),
            sampleCount: 1,
            diagnosticArrived: wideStatus.observed,
            reason: wideStatus.reason,
            sourceLines: wideLines.length,
            missingChildSummaries: diagView(wideUri).filter(d => d.message.startsWith('Referenced file has')).length,
            cpuUserMs: round(wideCpuDelta.user / 1000),
            cpuSystemMs: round(wideCpuDelta.system / 1000),
            rssBeforeBytes: wideRss,
            rssAfterBytes: process.memoryUsage().rss,
            heartbeatDelayP95Ms: q(wideHostJitter, 0.95),
            heartbeatDelayMaxMs: q(wideHostJitter, 1),
            heartbeatSamples: wideHostJitter.length
        };
        if (!wideStatus.observed) {
            throw new Error('Wide graph did not publish expected 120 referenced-child diagnostics');
        }
        const deps = require(path.join(ext.extensionPath, 'out', 'diagnostics.js'))
            .getTrackedDependencyPaths();
        report.observations.beforeDisposal = {
            dependencyPaths: deps.size,
            logicalWatcherDirectories: new Set([...deps].map(p => path.dirname(p))).size,
            activeHandlesProxy: handleCount(),
            linuxFdCount: fdCount()
        };
        const cpu = process.cpuUsage(beforeCpu);
        report.results.totalCpuUserMs = round(cpu.user / 1000);
        report.results.totalCpuSystemMs = round(cpu.system / 1000);
        report.results.rssBeforeBytes = beforeRss;
        report.results.rssAfterBytes = process.memoryUsage().rss;
        // Dirty fixture editors can prompt instead of closing in a headless host.
        // Save ONLY the disposable fixture documents before measuring disposal.
        if (!(await rootDoc.save()) || !(await childDoc.save())) {
            throw new Error('Could not save disposable benchmark documents before closure');
        }
        await pause(350);
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        await pause(1300);
        const after = require(path.join(ext.extensionPath, 'out', 'diagnostics.js'))
            .getTrackedDependencyPaths();
        report.observations.afterDisposal = {
            dependencyPaths: after.size,
            logicalWatcherDirectories: new Set([...after].map(p => path.dirname(p))).size,
            activeHandlesProxy: handleCount(),
            linuxFdCount: fdCount(),
            closeEvents,
            rootDocumentIsClosed: rootDoc.isClosed,
            openFixtureDocuments: vscode.workspace.textDocuments
                .filter(d => path.normalize(d.fileName).startsWith(path.normalize(root + path.sep)))
                .map(d => ({ file: path.relative(root, d.fileName), isDirty: d.isDirty, isClosed: d.isClosed })),
            visibleFixtureEditors: vscode.window.visibleTextEditors
                .filter(e => path.normalize(e.document.fileName).startsWith(path.normalize(root + path.sep)))
                .map(e => path.relative(root, e.document.fileName))
        };
    } catch (err) {
        exception = err;
        report.failure = String(err?.stack || err);
    } finally {
        if (heartbeat) clearInterval(heartbeat);
        if (wideHeartbeat) clearInterval(wideHeartbeat);
        closeSubscription.dispose();
        try { await vscode.commands.executeCommand('workbench.action.closeAllEditors'); }
        catch { /* cleanup best effort */ }
        fs.rmSync(root, { recursive: true, force: true });
        report.environment.fixturesRemoved = !fs.existsSync(root);
        fs.mkdirSync(path.dirname(output), { recursive: true });
        fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
        console.log('[tpv-host] source=' + source + ' vscode=' + report.environment.vscode +
            ' node=' + report.environment.node + ' initialActive=' + report.source.initiallyActive);
        for (const [key, result] of Object.entries(report.results)) {
            if (result && typeof result === 'object') {
                console.log('[tpv-host] ' + key + ' median=' + (result.medianMs ?? result.elapsedMs ?? 'n/a') +
                    ' p95=' + (result.p95Ms ?? 'n/a') + ' observed=' +
                    (result.diagnosticArrived ?? result.rawSamples?.every(x => x.updated) ?? 'n/a'));
            }
        }
        console.log('[tpv-host] report=' + output + ' failure=' + (report.failure || 'none'));
    }
    if (exception) throw exception;
};
