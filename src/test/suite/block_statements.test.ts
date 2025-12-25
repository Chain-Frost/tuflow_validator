import * as path from 'path';
import * as assert from 'assert';
import * as vscode from 'vscode';

const FIXTURE_ROOT = path.join(__dirname, '../../../src/test/fixtures/blocks');
const DEFINE_EVENT_MISSING_END = path.join(FIXTURE_ROOT, 'define_event_missing_end.tcf');
const DEFINE_EVENT_COMMENT_END = path.join(FIXTURE_ROOT, 'define_event_comment_end.tcf');
const START_1D_MISSING_END = path.join(FIXTURE_ROOT, 'start_1d_missing_end.tcf');
const START_2D_OK = path.join(FIXTURE_ROOT, 'start_2d_ok.tcf');

suite('TUFLOW block statement diagnostics', function () {
    this.timeout(15000);

    suiteSetup(async () => {
        const config = vscode.workspace.getConfiguration('tuflowValidator');
        await config.update('enableIfStatementChecks', true, vscode.ConfigurationTarget.Global);
    });

    test('flags missing End Define for Define Event blocks', async () => {
        const doc = await vscode.workspace.openTextDocument(DEFINE_EVENT_MISSING_END);
        await vscode.window.showTextDocument(doc);
        await waitForDiagnostics(doc.uri);

        const diagnostics = vscode.languages.getDiagnostics(doc.uri);
        assert.ok(diagnostics.some(d => d.message.includes('missing a closing End Define')));
    });

    test('ignores End Define when it is commented out', async () => {
        const doc = await vscode.workspace.openTextDocument(DEFINE_EVENT_COMMENT_END);
        await vscode.window.showTextDocument(doc);
        await waitForDiagnostics(doc.uri);

        const diagnostics = vscode.languages.getDiagnostics(doc.uri);
        assert.ok(diagnostics.some(d => d.message.includes('missing a closing End Define')));
    });

    test('flags missing End 1D Domain', async () => {
        const doc = await vscode.workspace.openTextDocument(START_1D_MISSING_END);
        await vscode.window.showTextDocument(doc);
        await waitForDiagnostics(doc.uri);

        const diagnostics = vscode.languages.getDiagnostics(doc.uri);
        assert.ok(diagnostics.some(d => d.message.includes('missing a closing End 1D Domain')));
    });

    test('allows Start 2D Domain blocks with matching End 2D Domain', async () => {
        const doc = await vscode.workspace.openTextDocument(START_2D_OK);
        await vscode.window.showTextDocument(doc);
        await waitForDiagnostics(doc.uri, 0);

        const diagnostics = vscode.languages.getDiagnostics(doc.uri);
        assert.strictEqual(diagnostics.length, 0);
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
