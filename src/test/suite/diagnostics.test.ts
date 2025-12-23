import * as path from 'path';
import * as assert from 'assert';
import * as vscode from 'vscode';

const FIXTURE_ROOT = path.join(__dirname, '../../../src/test/fixtures');
const ROOT_TCF = path.join(FIXTURE_ROOT, 'root.tcf');
const NESTED_TGC = path.join(FIXTURE_ROOT, 'subdir', 'nested.tgc');
const TOKEN_MISSING_TCF = path.join(FIXTURE_ROOT, 'token_missing.tcf');
const TOKEN_PRESENT_TCF = path.join(FIXTURE_ROOT, 'token_present_~s1~_~e2~.tcf');
const VERSIONING_ROOT = path.join(FIXTURE_ROOT, 'versioning');
const VERSION_POS_TCF = path.join(VERSIONING_ROOT, 'runs', 'PosRun_v02.tcf');
const VERSION_NEG_TCF = path.join(VERSIONING_ROOT, 'runs', 'NegRun_v02.tcf');
const VERSION_GHOST_TCF = path.join(VERSIONING_ROOT, 'runs', 'GhostRun_v02.tcf');
const VERSION_POS_TGC = path.join(VERSIONING_ROOT, 'model', 'geomPos_v02.tgc');
const LATEST_ROOT = path.join(FIXTURE_ROOT, 'latest');
const LATEST_TCF = path.join(LATEST_ROOT, 'runs', 'LatestRun_~s1~_v02.tcf');
const LATEST_TGC = path.join(LATEST_ROOT, 'model', 'geom_v02.tgc');
const EXAMPLE_TCF = path.join(
    __dirname,
    '../../../example/runs/BigBoyCk_01_~s1~_~s2~_~e1~_~e2~_~e3~_~e4~_~s4~.tcf'
);
const EXAMPLE_MISSING_TCF = path.join(
    __dirname,
    '../../../example/runs/BigBoyCk_01_~s1~_~s2~_missing.tcf'
);

suite('TUFLOW diagnostics', function () {
    this.timeout(15000);
    suiteSetup(async () => {
        const config = vscode.workspace.getConfiguration('tuflowValidator');
        await config.update('enableLatestVersionChecks', true, vscode.ConfigurationTarget.Global);
        await config.update('diagnosticLevel', 'hint', vscode.ConfigurationTarget.Global);
    });
    test('reports missing files and nested issues', async () => {
        const doc = await vscode.workspace.openTextDocument(ROOT_TCF);
        await vscode.window.showTextDocument(doc);
        await waitForDiagnostics(doc.uri);

        const rootDiagnostics = vscode.languages.getDiagnostics(doc.uri);
        assert.ok(rootDiagnostics.some(d => d.message.includes('File not found:')));
        assert.ok(rootDiagnostics.some(d => d.message.includes('Referenced file has')));

        const nestedDiagnostics = vscode.languages.getDiagnostics(vscode.Uri.file(NESTED_TGC));
        assert.ok(nestedDiagnostics.some(d => d.message.includes('File not found:')));
    });

    test('ignores unresolved macros', async () => {
        const doc = await vscode.workspace.openTextDocument(ROOT_TCF);
        await vscode.window.showTextDocument(doc);
        await waitForDiagnostics(doc.uri);

        const rootDiagnostics = vscode.languages.getDiagnostics(doc.uri);
        const macroIssue = rootDiagnostics.find(d => d.message.includes('<<OutputRoot>>'));
        assert.strictEqual(macroIssue, undefined);
    });

    test('warns when scenario/event tokens are missing from filename', async () => {
        const doc = await vscode.workspace.openTextDocument(TOKEN_MISSING_TCF);
        await vscode.window.showTextDocument(doc);
        await waitForDiagnostics(doc.uri);

        const diagnostics = vscode.languages.getDiagnostics(doc.uri);
        const tokenWarnings = diagnostics.filter(d => d.message.includes('Filename is missing token'));

        assert.strictEqual(tokenWarnings.length, 3);
        assert.ok(tokenWarnings.some(d => d.message.includes('~s1~')));
        assert.ok(tokenWarnings.some(d => d.message.includes('~s2~')));
        assert.ok(tokenWarnings.some(d => d.message.includes('~e4~')));
        assert.ok(!tokenWarnings.some(d => d.message.includes('Version')));
    });

    test('does not warn when scenario/event tokens are in filename', async () => {
        const doc = await vscode.workspace.openTextDocument(TOKEN_PRESENT_TCF);
        await vscode.window.showTextDocument(doc);
        await waitForDiagnostics(doc.uri);

        const diagnostics = vscode.languages.getDiagnostics(doc.uri);
        const tokenWarnings = diagnostics.filter(d => d.message.includes('Filename is missing token'));
        assert.strictEqual(tokenWarnings.length, 0);
    });

    test('latest TCF enforces latest referenced versions', async () => {
        const doc = await vscode.workspace.openTextDocument(LATEST_TCF);
        await vscode.window.showTextDocument(doc);
        await waitForDiagnostics(doc.uri);

        const diagnostics = vscode.languages.getDiagnostics(doc.uri);
        const notLatest = diagnostics.filter(d => d.message.includes('not the latest version'));
        assert.strictEqual(notLatest.length, 1);
        assert.ok(diagnostics.some(d => d.message.includes('Unable to determine latest version')));
    });

    test('latest TGC enforces latest referenced versions', async () => {
        const doc = await vscode.workspace.openTextDocument(LATEST_TGC);
        await vscode.window.showTextDocument(doc);
        await waitForDiagnostics(doc.uri);

        const diagnostics = vscode.languages.getDiagnostics(doc.uri);
        assert.ok(diagnostics.some(d => d.message.includes('not the latest version')));
    });

    test('versioned latest references pass for latest TCF', async () => {
        const doc = await vscode.workspace.openTextDocument(VERSION_POS_TCF);
        await vscode.window.showTextDocument(doc);
        await waitForDiagnostics(doc.uri, 0);

        const diagnostics = vscode.languages.getDiagnostics(doc.uri);
        assert.ok(!diagnostics.some(d => d.message.includes('not the latest version')));
        assert.ok(!diagnostics.some(d => d.message.includes('Unable to determine latest version')));

        const tgcDiagnostics = vscode.languages.getDiagnostics(vscode.Uri.file(VERSION_POS_TGC));
        assert.ok(!tgcDiagnostics.some(d => d.message.includes('not the latest version')));
    });

    test('versioned latest references flag outdated and ambiguous files', async () => {
        const doc = await vscode.workspace.openTextDocument(VERSION_NEG_TCF);
        await vscode.window.showTextDocument(doc);
        await waitForDiagnostics(doc.uri);

        const diagnostics = vscode.languages.getDiagnostics(doc.uri);
        const notLatest = diagnostics.filter(d => d.message.includes('not the latest version'));
        const ambiguous = diagnostics.filter(d => d.message.includes('Unable to determine latest version'));
        assert.strictEqual(notLatest.length, 9);
        assert.strictEqual(ambiguous.length, 1);
    });

    test('latest TCF flags newer control files even if only referenced by non-latest TCFs', async () => {
        const doc = await vscode.workspace.openTextDocument(VERSION_GHOST_TCF);
        await vscode.window.showTextDocument(doc);
        await waitForDiagnostics(doc.uri, 0);

        const diagnostics = vscode.languages.getDiagnostics(doc.uri);
        assert.ok(diagnostics.some(d => d.message.includes('not the latest version')));
    });

    test('example run file does not report missing files or tokens', async () => {
        const doc = await vscode.workspace.openTextDocument(EXAMPLE_TCF);
        await vscode.window.showTextDocument(doc);
        await waitForDiagnostics(doc.uri);

        const diagnostics = vscode.languages.getDiagnostics(doc.uri);
        assert.ok(!diagnostics.some(d => d.message.includes('File not found:')));
        assert.ok(!diagnostics.some(d => d.message.includes('Filename is missing token')));
    });

    test('example run file flags outdated geometry control file', async () => {
        const doc = await vscode.workspace.openTextDocument(EXAMPLE_TCF);
        await vscode.window.showTextDocument(doc);
        await waitForDiagnostics(doc.uri);

        const diagnostics = vscode.languages.getDiagnostics(doc.uri);
        assert.ok(diagnostics.some(d =>
            d.severity === vscode.DiagnosticSeverity.Warning &&
            d.message.includes('not the latest version') &&
            d.message.includes('GEOM_01.tgc')
        ));
    });

    test('example missing file run reports missing files', async () => {
        const doc = await vscode.workspace.openTextDocument(EXAMPLE_MISSING_TCF);
        await vscode.window.showTextDocument(doc);
        await waitForDiagnostics(doc.uri);

        const diagnostics = vscode.languages.getDiagnostics(doc.uri);
        const missingFiles = diagnostics.filter(d => d.message.includes('File not found:'));
        assert.ok(missingFiles.length >= 3);
        assert.ok(diagnostics.some(d => d.message.includes('Referenced file has')));
    });
});

async function waitForDiagnostics(uri: vscode.Uri, minCount = 1): Promise<void> {
    const start = Date.now();
    const timeoutMs = 8000;
    const minDelayMs = 200;

    while (Date.now() - start < timeoutMs) {
        const diagnostics = vscode.languages.getDiagnostics(uri);
        if (diagnostics.length >= minCount) {
            if (minCount === 0 && Date.now() - start < minDelayMs) {
                await delay(50);
                continue;
            }
            return;
        }
        await delay(50);
    }
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
