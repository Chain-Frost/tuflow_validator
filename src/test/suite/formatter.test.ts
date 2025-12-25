import * as assert from 'assert';
import * as vscode from 'vscode';

suite('TUFLOW If statement formatting', function () {
    this.timeout(15000);

    test('returns no edits when formatting is disabled', async () => {
        const config = vscode.workspace.getConfiguration('tuflowValidator');
        await config.update('enableIfStatementFormatting', false, vscode.ConfigurationTarget.Global);

        const doc = await vscode.workspace.openTextDocument({
            language: 'tuflow',
            content: [
                'If Scenario == DEV',
                '    Command == foo',
                'End If',
                ''
            ].join('\n')
        });
        await vscode.window.showTextDocument(doc);

        const edits = await formatDocument(doc);
        assert.strictEqual(edits.length, 0);
    });

    test('formats If/Else/End If blocks with tab indentation', async () => {
        const config = vscode.workspace.getConfiguration('tuflowValidator');
        await config.update('enableIfStatementFormatting', true, vscode.ConfigurationTarget.Global);

        try {
            const content = [
                'If Scenario == DEV',
                '    Command == foo',
                '   If Event == EVT',
                'Command == bar',
                '  Else',
                '        Command == baz',
                ' End If',
                'Else If Scenario == QA',
                'Command == qux',
                'End If',
                ''
            ].join('\n');

            const expected = [
                'If Scenario == DEV',
                '\tCommand == foo',
                '\tIf Event == EVT',
                '\t\tCommand == bar',
                '\tElse',
                '\t\tCommand == baz',
                '\tEnd If',
                'Else If Scenario == QA',
                '\tCommand == qux',
                'End If',
                ''
            ].join('\n');

            const doc = await vscode.workspace.openTextDocument({ language: 'tuflow', content });
            await vscode.window.showTextDocument(doc);

            const edits = await formatDocument(doc);
            assert.ok(edits.length > 0);

            await applyEdits(doc, edits);

            assert.strictEqual(doc.getText(), expected);
        } finally {
            await config.update('enableIfStatementFormatting', false, vscode.ConfigurationTarget.Global);
        }
    });

    test('formats Define Event and Start Domain blocks with tab indentation', async () => {
        const config = vscode.workspace.getConfiguration('tuflowValidator');
        await config.update('enableIfStatementFormatting', true, vscode.ConfigurationTarget.Global);

        try {
            const content = [
                'Define Event EVT1',
                'Command == foo',
                ' Start 1D Domain',
                '  Command == bar',
                'End 1D Domain',
                'End Define',
                'Start 2D Domain',
                'Command == baz',
                'End 2D Domain',
                ''
            ].join('\n');

            const expected = [
                'Define Event EVT1',
                '\tCommand == foo',
                '\tStart 1D Domain',
                '\t\tCommand == bar',
                '\tEnd 1D Domain',
                'End Define',
                'Start 2D Domain',
                '\tCommand == baz',
                'End 2D Domain',
                ''
            ].join('\n');

            const doc = await vscode.workspace.openTextDocument({ language: 'tuflow', content });
            await vscode.window.showTextDocument(doc);

            const edits = await formatDocument(doc);
            assert.ok(edits.length > 0);

            await applyEdits(doc, edits);

            assert.strictEqual(doc.getText(), expected);
        } finally {
            await config.update('enableIfStatementFormatting', false, vscode.ConfigurationTarget.Global);
        }
    });
});

async function formatDocument(document: vscode.TextDocument): Promise<vscode.TextEdit[]> {
    const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
        'vscode.executeFormatDocumentProvider',
        document.uri,
        { tabSize: 4, insertSpaces: false }
    );
    return edits ?? [];
}

async function applyEdits(document: vscode.TextDocument, edits: vscode.TextEdit[]): Promise<void> {
    const workspaceEdit = new vscode.WorkspaceEdit();
    for (const edit of edits) {
        workspaceEdit.replace(document.uri, edit.range, edit.newText);
    }
    const applied = await vscode.workspace.applyEdit(workspaceEdit);
    assert.strictEqual(applied, true);
}
