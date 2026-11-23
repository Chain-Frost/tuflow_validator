'use strict';

// Optional installed-VSIX issue #3 lifecycle probe. Called by the isolated runner.
// It deliberately does not import Validator's diagnostics module: that module
// might not be the active installed extension instance.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const vscode = require('vscode');

const base = process.env.TPV_ISSUE3_FIXTURE;
const output = process.env.TPV_ISSUE3_PROBE_OUTPUT;
const installation = process.env.TPV_ISSUE3_EXTENSIONS;
const evidence = {
    ...JSON.parse(process.env.TPV_ISSUE3_PROVENANCE || '{}'),
    probe: 'installed-VSIX-workspace-document-lifecycle',
    status: 'failed',
    extensionHost: {
        pid: process.pid, node: process.version, electron: process.versions.electron,
        vscode: vscode.version, platform: process.platform
    },
    phases: [], diagnosticEvents: [], closeEvents: [], observations: []
};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const fixturePath = relative => path.join(base, relative);
function relativeFixture(file) {
    if (!file || !base) return null;
    const relative = path.relative(base, file);
    if (!relative || relative === '..' ||
        relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return null;
    return relative.replace(/\\/g, '/');
}
const paths = {
    a: fixturePath('a/runs/A.tcf'),
    b: fixturePath('b/runs/B.tcf'),
    trd: fixturePath('standalone/context/shared/terrain.trd'),
    nested: fixturePath('shared/nested.trd'),
    smoke: fixturePath('a/runs/assets/smoke_missing_a.shp')
};
function code(d) {
    return typeof d.code === 'object' && d.code ? d.code.value : d.code;
}
function diagnostics(file) {
    return vscode.languages.getDiagnostics(vscode.Uri.file(file)).map(d => ({
        code: code(d), severity: d.severity,
        line: d.range.start.line, message: d.message, source: d.source || ''
    })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
function missing(file) {
    return diagnostics(file).filter(d => d.code === 'TPV001').map(d => d.message).sort();
}
function digest(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}
function osHandles() {
    if (process.platform !== 'win32') return { count: null, limitation: 'Windows Get-Process unavailable on this platform' };
    try {
        const stdout = execFileSync('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-Command',
            '(Get-Process -Id ' + process.pid + ' -ErrorAction Stop).HandleCount'
        ], { encoding: 'utf8', timeout: 15000 }).trim();
        const count = Number(stdout);
        if (!Number.isInteger(count) || count < 0) throw new Error('Invalid OS handle count');
        return { count };
    } catch (error) {
        return { count: null, limitation: String(error) };
    }
}
function capture(label) {
    const files = Object.fromEntries(Object.entries(paths).filter(([key]) => key !== 'smoke')
        .map(([key, file]) => [key, diagnostics(file)]));
    const rows = Object.entries(files).flatMap(([file, items]) =>
        items.map(item => JSON.stringify([file, item.code, item.line, item.severity, item.message])));
    const memory = process.memoryUsage();
    const phase = {
        label, at: new Date().toISOString(), diagnostics: files,
        diagnosticFingerprint: digest(rows.sort().join('\n')),
        resources: {
            pid: process.pid, rssBytes: memory.rss, heapUsedBytes: memory.heapUsed,
            activeHandleProxy: typeof process._getActiveHandles === 'function'
                ? process._getActiveHandles().length : null,
            osProcessHandles: osHandles(),
            openFixtureDocuments: vscode.workspace.textDocuments.filter(d =>
                d.uri.scheme === 'file' && relativeFixture(d.uri.fsPath)).length
        }
    };
    evidence.phases.push(phase);
}
async function until(predicate, label, timeoutMs = 16000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) return;
        await pause(75);
    }
    assert.fail(label + ' (not observed within ' + timeoutMs + ' ms)');
}
async function open(file) {
    const document = await vscode.workspace.openTextDocument(file);
    await vscode.window.showTextDocument(document, { preview: false });
    assert.equal(document.languageId, 'tuflow');
    return document;
}
async function replace(document, from, to) {
    const offset = document.getText().indexOf(from);
    assert.ok(offset >= 0, 'Fixture text not found: ' + from);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, new vscode.Range(document.positionAt(offset),
        document.positionAt(offset + from.length)), to);
    assert.equal(await vscode.workspace.applyEdit(edit), true);
}
async function retire(document, cycle, id) {
    const originalRelative = relativeFixture(document.fileName);
    const retired = vscode.Uri.file(document.fileName + '.retired-' + cycle);
    const edit = new vscode.WorkspaceEdit();
    edit.renameFile(document.uri, retired);
    assert.equal(await vscode.workspace.applyEdit(edit), true);
    await until(() => evidence.closeEvents.some(e => e.relativeFile === originalRelative),
        'Actual onDidCloseTextDocument required for root ' + id);
    assert.equal(document.isClosed, true, 'Retired original TextDocument must be closed');
    // On VS Code 1.74, keep the renamed model alive through its language change.
    const editor = await vscode.window.showTextDocument(retired, { preview: false });
    const plaintext = await vscode.languages.setTextDocumentLanguage(editor.document, 'plaintext');
    assert.equal(plaintext.languageId, 'plaintext');
    evidence.observations.push({ kind: 'actual-root-close', root: id, cycle,
        originalIsClosed: document.isClosed });
    return retired.fsPath;
}
exports.run = async function run() {
    assert.ok(base && output && installation, 'Required isolated probe environment is missing');
    const subscriptions = [];
    try {
        const workspace = vscode.workspace.workspaceFolders || [];
        const identity = file => {
            const normal = path.resolve(file);
            return process.platform === 'win32' ? normal.toLowerCase() : normal;
        };
        const matches = workspace.map(folder => folder.uri.scheme === 'file' &&
            identity(folder.uri.fsPath) === identity(base));
        evidence.workspace = { folderCount: workspace.length, matchedFixture: matches.includes(true),
            folderSchemes: workspace.map(folder => folder.uri.scheme),
            folderIdentitySha256: workspace.map(folder => digest(identity(folder.uri.fsPath))),
            expectedIdentitySha256: digest(identity(base)) };
        assert.ok(evidence.workspace.matchedFixture,
            'The fixture directory MUST be open as a VS Code workspace');
        const validator = vscode.extensions.getExtension('Chain-Frost.tuflow-path-validator');
        assert.ok(validator, 'Installed Validator VSIX not found');
        const relative = path.relative(installation, validator.extensionPath);
        assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative),
            'Validator must load from the isolated installed-VSIX directory');
        evidence.installed = { id: validator.id, version: validator.packageJSON.version,
            engine: validator.packageJSON.engines.vscode, activatedFromInstalledPackage: true };
        subscriptions.push(vscode.workspace.onDidCloseTextDocument(doc => {
            const relative = doc.uri.scheme === 'file' ? relativeFixture(doc.uri.fsPath) : null;
            if (relative) evidence.closeEvents.push({
                relativeFile: relative, isClosed: doc.isClosed, at: new Date().toISOString() });
        }));
        subscriptions.push(vscode.languages.onDidChangeDiagnostics(event => {
            evidence.diagnosticEvents.push({
                at: new Date().toISOString(),
                files: event.uris.filter(uri => uri.scheme === 'file')
                    .map(uri => relativeFixture(uri.fsPath)).filter(Boolean)
            });
        }));
        capture('before-open');
        let a = await open(paths.a);
        await until(() => validator.isActive && missing(paths.trd).length === 2,
            'A-only shared-TRD diagnostics');
        capture('only-A-open');
        let b = await open(paths.b);
        const child = await open(paths.trd);
        await until(() => missing(paths.trd).some(m => m.includes('<<LOCAL_SHAPE>>')),
            'B-specific inherited missing variable');
        assert.equal(missing(paths.trd).length, 3, 'Shared TRD must contain two shared and one B-only error');
        assert.ok(diagnostics(paths.a).some(d => d.code === 'TPV002'));
        assert.ok(diagnostics(paths.b).some(d => d.code === 'TPV002'));
        capture('both-roots-open');

        await replace(child, 'assets/missing.shp', 'assets/edited_present.shp');
        assert.ok(child.isDirty, 'The child edit must be an unsaved editor buffer');
        await until(() => missing(paths.trd).length === 2,
            'Dirty child edit should remove the common error without saving');
        capture('child-dirty-updated');
        await replace(child, 'assets/edited_present.shp', 'assets/missing.shp');
        await until(() => missing(paths.trd).length === 3,
            'Dirty child restore should reinstate the common error');
        capture('child-dirty-restored');

        const beforeCreate = evidence.diagnosticEvents.length;
        const startCreate = performance.now();
        fs.writeFileSync(paths.smoke, 'disposable SMB file change\n');
        await until(() => !missing(paths.a).some(m => m.includes('smoke_missing_a.shp')),
            'Workspace filesystem create notification must clear the concrete A-only missing input');
        assert.ok(evidence.diagnosticEvents.slice(beforeCreate).some(e => e.files.includes('a/runs/A.tcf')),
            'A diagnostic event must follow the external fixture create');
        evidence.observations.push({ kind: 'workspace-file-create', observed: true,
            actionToDiagnosticMs: Math.round((performance.now() - startCreate) * 1000) / 1000 });
        fs.rmSync(paths.smoke);
        await until(() => missing(paths.a).some(m => m.includes('smoke_missing_a.shp')),
            'Workspace filesystem deletion must restore the concrete missing input');
        capture('workspace-freshness-smoke');

        for (let cycle = 1; cycle <= 2; cycle++) {
            const retiredB = await retire(b, cycle, 'B');
            await until(() => !missing(paths.trd).some(m => m.includes('<<LOCAL_SHAPE>>')),
                'B-only shared diagnostic must retire');
            assert.equal(missing(paths.trd).length, 2, 'A shared errors must survive B retirement');
            assert.deepEqual(diagnostics(paths.b), []);
            assert.ok(diagnostics(paths.a).some(d => d.code === 'TPV002'));
            capture('cycle-' + cycle + '-B-retired');

            const retiredA = await retire(a, cycle, 'A');
            await until(() => missing(paths.trd).length === 0 &&
                diagnostics(paths.a).length === 0, 'Last root retirement must remove all inherited path errors');
            assert.deepEqual(diagnostics(paths.b), []);
            capture('cycle-' + cycle + '-last-root-retired');

            // Revalidation after the last root is retired must not resurrect
            // its diagnostics through a pending timer/callback.
            await replace(child, '! dirty:A', '! dirty:B');
            await pause(1100);
            assert.deepEqual(missing(paths.trd), [], 'Stale callback republished retired root');
            await replace(child, '! dirty:B', '! dirty:A');
            await pause(1100);
            assert.deepEqual(missing(paths.trd), [], 'Second callback republished retired root');
            capture('cycle-' + cycle + '-stale-callback-check');

            fs.copyFileSync(retiredA, paths.a);
            a = await open(paths.a);
            await until(() => missing(paths.trd).length === 2,
                'Reopened A must restore only its source-TCF context');
            assert.ok(diagnostics(paths.a).some(d => d.code === 'TPV002'));
            capture('cycle-' + cycle + '-A-reopened');
            fs.copyFileSync(retiredB, paths.b);
            b = await open(paths.b);
            await until(() => missing(paths.trd).some(m => m.includes('<<LOCAL_SHAPE>>')),
                'Reopened B must restore its independent contribution');
            assert.equal(missing(paths.trd).length, 3);
            capture('cycle-' + cycle + '-both-reopened');
        }
        await child.save();
        evidence.observations.push({ kind: 'resource-accounting-boundary',
            detail: 'Process handles and Node active handles are proxies, not native FileSystemWatcher identities. Installed extension watcher disposal is not directly observable.' });
        evidence.status = 'passed';
    } catch (error) {
        evidence.error = error.stack || String(error);
        throw error;
    } finally {
        for (const item of subscriptions) item.dispose();
        fs.mkdirSync(path.dirname(output), { recursive: true });
        fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
    }
};
