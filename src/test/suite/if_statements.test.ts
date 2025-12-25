import * as path from 'path';
import * as assert from 'assert';
import * as vscode from 'vscode';

const FIXTURE_ROOT = path.join(__dirname, '../../../src/test/fixtures/if');
const IF_MISSING_END = path.join(FIXTURE_ROOT, 'if_missing_end.tcf');
const IF_NESTED_OK = path.join(FIXTURE_ROOT, 'if_nested_ok.tcf');
const IF_COMMENT_LINE = path.join(FIXTURE_ROOT, 'if_comment_line.tcf');
const IF_INLINE_COMMENT = path.join(FIXTURE_ROOT, 'if_inline_comment.tcf');
const IF_NOT_FIRST_WORD = path.join(FIXTURE_ROOT, 'if_not_first_word.tcf');
const IF_END_NOT_FIRST_WORD = path.join(FIXTURE_ROOT, 'if_end_not_first_word.tcf');

suite('TUFLOW if statement diagnostics', function () {
    this.timeout(15000);

    suiteSetup(async () => {
        const config = vscode.workspace.getConfiguration('tuflowValidator');
        await config.update('enableIfStatementChecks', true, vscode.ConfigurationTarget.Global);
    });

    test('flags missing End If', async () => {
        const doc = await vscode.workspace.openTextDocument(IF_MISSING_END);
        await vscode.window.showTextDocument(doc);
        await waitForDiagnostics(doc.uri);

        const diagnostics = vscode.languages.getDiagnostics(doc.uri);
        const missingEnd = diagnostics.filter(d => d.message.includes('missing a closing End If'));
        assert.strictEqual(missingEnd.length, 1);
    });

    test('allows nested If/Else If/End If blocks', async () => {
        const doc = await vscode.workspace.openTextDocument(IF_NESTED_OK);
        await vscode.window.showTextDocument(doc);
        await waitForDiagnostics(doc.uri, 0);

        const diagnostics = vscode.languages.getDiagnostics(doc.uri);
        assert.strictEqual(diagnostics.length, 0);
    });

    test('comment-only If line is ignored', async () => {
        const doc = await vscode.workspace.openTextDocument(IF_COMMENT_LINE);
        await vscode.window.showTextDocument(doc);
        await waitForDiagnostics(doc.uri, 0);

        const diagnostics = vscode.languages.getDiagnostics(doc.uri);
        assert.ok(!diagnostics.some(d => d.message.includes('missing a closing End If')));
    });

    test('inline comments do not break If matching', async () => {
        const doc = await vscode.workspace.openTextDocument(IF_INLINE_COMMENT);
        await vscode.window.showTextDocument(doc);
        await waitForDiagnostics(doc.uri, 0);

        const diagnostics = vscode.languages.getDiagnostics(doc.uri);
        assert.ok(!diagnostics.some(d => d.message.includes('missing a closing End If')));
    });

    test('only matches If statements when if is the first word', async () => {
        const doc = await vscode.workspace.openTextDocument(IF_NOT_FIRST_WORD);
        await vscode.window.showTextDocument(doc);
        await waitForDiagnostics(doc.uri, 0);

        const diagnostics = vscode.languages.getDiagnostics(doc.uri);
        assert.ok(!diagnostics.some(d => d.message.includes('missing a closing End If')));
    });

    test('only matches End If when end if are the first words', async () => {
        const doc = await vscode.workspace.openTextDocument(IF_END_NOT_FIRST_WORD);
        await vscode.window.showTextDocument(doc);
        await waitForDiagnostics(doc.uri);

        const diagnostics = vscode.languages.getDiagnostics(doc.uri);
        assert.ok(diagnostics.some(d => d.message.includes('missing a closing End If')));
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
