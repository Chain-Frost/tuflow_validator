import * as path from 'path';
import * as assert from 'assert';
import * as vscode from 'vscode';

const FIXTURE_ROOT = path.join(__dirname, '../../../src/test/fixtures');
const ROOT_TCF = path.join(FIXTURE_ROOT, 'root.tcf');
const NESTED_TGC = path.join(FIXTURE_ROOT, 'subdir', 'nested.tgc');
const TOKEN_MISSING_TCF = path.join(FIXTURE_ROOT, 'token_missing.tcf');
const TOKEN_PRESENT_TCF = path.join(FIXTURE_ROOT, 'token_present_~s1~_~e2~.tcf');
const EXAMPLE_TCF = path.join(
    __dirname,
    '../../../example/runs/BigBoyCk_01_~s1~_~s2~_~e1~_~e2~_~e3~_~e4~_~s4~.tcf'
);
const EXAMPLE_MISSING_TCF = path.join(
    __dirname,
    '../../../example/runs/BigBoyCk_01_~s1~_~s2~_missing.tcf'
);

suite('TUFLOW diagnostics', () => {
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

    test('example run file does not report missing files or tokens', async () => {
        const doc = await vscode.workspace.openTextDocument(EXAMPLE_TCF);
        await vscode.window.showTextDocument(doc);
        await waitForDiagnostics(doc.uri);

        const diagnostics = vscode.languages.getDiagnostics(doc.uri);
        assert.ok(!diagnostics.some(d => d.message.includes('File not found:')));
        assert.ok(!diagnostics.some(d => d.message.includes('Referenced file has')));
        assert.ok(!diagnostics.some(d => d.message.includes('Filename is missing token')));
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

async function waitForDiagnostics(uri: vscode.Uri): Promise<void> {
    const start = Date.now();
    const timeoutMs = 2000;

    while (Date.now() - start < timeoutMs) {
        const diagnostics = vscode.languages.getDiagnostics(uri);
        if (diagnostics.length > 0) {
            return;
        }
        await delay(50);
    }
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
