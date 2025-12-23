import * as path from 'path';
import * as assert from 'assert';
import * as vscode from 'vscode';

const FIXTURE_ROOT = path.join(__dirname, '../../../example/test-fixtures');
const ROOT_TCF = path.join(FIXTURE_ROOT, 'root.tcf');
const NESTED_TGC = path.join(FIXTURE_ROOT, 'subdir', 'nested.tgc');

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
