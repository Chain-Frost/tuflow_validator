import * as path from 'path';
import * as assert from 'assert';
import * as vscode from 'vscode';

const FIXTURE_ROOT = path.join(__dirname, '../../../src/test/fixtures');
const IGNORE_LINE_TCF = path.join(FIXTURE_ROOT, 'ignore_line.tcf');
const IGNORE_FILE_TCF = path.join(FIXTURE_ROOT, 'ignore_file.tcf');

suite('TUFLOW Ignore Diagnostics', function () {
    this.timeout(15000);

    test('ignores line errors with ! tpf-ignore', async () => {
        const doc = await vscode.workspace.openTextDocument(IGNORE_LINE_TCF);
        await vscode.window.showTextDocument(doc);
        await waitForDiagnostics(doc.uri);

        const diagnostics = vscode.languages.getDiagnostics(doc.uri);
        // Line 1 has ! tpf-ignore, so no error. Line 2 has no ignore, so error.
        
        const line1Error = diagnostics.find(d => d.range.start.line === 2); // 0-indexed, so line 3 is index 2
        const line0Error = diagnostics.find(d => d.range.start.line === 0);

        assert.strictEqual(line0Error, undefined, 'Line 0 should be ignored');
        assert.ok(line1Error, 'Line 2 should have an error');
        assert.ok(line1Error.message.includes('File not found'), 'Line 2 should error on missing file');
    });

    test('ignores file errors with ! tpf-ignore-file at top', async () => {
        const doc = await vscode.workspace.openTextDocument(IGNORE_FILE_TCF);
        await vscode.window.showTextDocument(doc);
        await waitForDiagnostics(doc.uri, 0);

        const diagnostics = vscode.languages.getDiagnostics(doc.uri);
        assert.strictEqual(diagnostics.length, 0, 'File-level ignore should suppress all diagnostics');
    });

    test('Recursion: TRD should flag outdated GPKG and propagate to TCF', async () => {
        const tcfUri = vscode.Uri.file(path.join(FIXTURE_ROOT, 'versioning', 'runs', 'recursion_test.tcf'));
        const doc = await vscode.workspace.openTextDocument(tcfUri);
        await vscode.window.showTextDocument(doc);
        await waitForDiagnostics(doc.uri);

        const tcfDiagnostics = vscode.languages.getDiagnostics(doc.uri);
        const trdUri = vscode.Uri.file(path.join(FIXTURE_ROOT, 'versioning', 'model', 'props_v01.trd'));
        const trdDiagnostics = vscode.languages.getDiagnostics(trdUri);

        assert.ok(trdDiagnostics.some(d => d.message.includes('not the latest version')), 'TRD should flag outdated GPKG');
        assert.ok(tcfDiagnostics.some(d => d.message.includes('Referenced file has 1 issue')), 'TCF should report child issue');
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
