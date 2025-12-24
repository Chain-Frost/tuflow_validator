import * as path from 'path';
import * as assert from 'assert';
import * as vscode from 'vscode';

const FIXTURE_ROOT = path.join(__dirname, '../../../src/test/fixtures');
const IGNORE_LINE_TCF = path.join(FIXTURE_ROOT, 'ignore_line.tcf');
const LATEST_TGC = path.join(FIXTURE_ROOT, 'latest', 'model', 'geom_v02.tgc');

suite('TUFLOW quick fixes', function () {
    this.timeout(15000);

    suiteSetup(async () => {
        const config = vscode.workspace.getConfiguration('tuflowValidator');
        await config.update('enableLatestVersionChecks', true, vscode.ConfigurationTarget.Global);
        await config.update('diagnosticLevel', 'hint', vscode.ConfigurationTarget.Global);
    });

    test('offers ignore line and file quick fixes', async () => {
        const doc = await openDocument(IGNORE_LINE_TCF);
        await waitForDiagnostics(doc.uri);

        const diagnostics = vscode.languages.getDiagnostics(doc.uri);
        const missing = diagnostics.find(d => d.message.includes('another_missing.shp'));
        assert.ok(missing, 'Expected missing file diagnostic for another_missing.shp');

        const actions = await getQuickFixes(doc.uri, missing.range);
        assert.ok(actions.some(action => action.title === 'Ignore this line (TUFLOW)'));
        assert.ok(actions.some(action => action.title === 'Ignore entire file (TUFLOW)'));

        const ignoreLine = actions.find(action => action.title === 'Ignore this line (TUFLOW)');
        assert.ok(ignoreLine?.edit, 'Ignore line fix should include an edit');
        const ignoreLineEdits = ignoreLine?.edit?.get(doc.uri) ?? [];
        assert.strictEqual(ignoreLineEdits.length, 1);
        assert.ok(ignoreLineEdits[0].newText.includes('tpf-ignore'));

        const ignoreFile = actions.find(action => action.title === 'Ignore entire file (TUFLOW)');
        assert.ok(ignoreFile?.edit, 'Ignore file fix should include an edit');
        const ignoreFileEdits = ignoreFile?.edit?.get(doc.uri) ?? [];
        assert.strictEqual(ignoreFileEdits.length, 1);
        assert.ok(ignoreFileEdits[0].newText.includes('tpf-ignore-file'));
    });

    test('offers update-to-latest quick fix outside TCF files', async () => {
        const doc = await openDocument(LATEST_TGC);
        await waitForDiagnostics(doc.uri);

        const diagnostics = vscode.languages.getDiagnostics(doc.uri);
        const notLatest = diagnostics.find(d =>
            d.message.includes('not the latest version') &&
            d.message.includes('levee_v01.shp')
        );
        assert.ok(notLatest, 'Expected not-latest diagnostic for levee_v01.shp');

        const actions = await getQuickFixes(doc.uri, notLatest.range);
        const latestFix = actions.find(action => action.title === 'Update to latest version (TUFLOW)');
        assert.ok(latestFix?.edit, 'Update to latest version fix should include an edit');

        const latestEdits = latestFix?.edit?.get(doc.uri) ?? [];
        assert.strictEqual(latestEdits.length, 1);
        assert.strictEqual(latestEdits[0].newText, '..\\\\shapes\\\\levee_v02.shp');
    });
});

async function openDocument(filePath: string): Promise<vscode.TextDocument> {
    const doc = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(doc);
    return doc;
}

async function getQuickFixes(
    uri: vscode.Uri,
    range: vscode.Range
): Promise<vscode.CodeAction[]> {
    const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
        'vscode.executeCodeActionProvider',
        uri,
        range,
        vscode.CodeActionKind.QuickFix.value
    );
    return actions ?? [];
}

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
