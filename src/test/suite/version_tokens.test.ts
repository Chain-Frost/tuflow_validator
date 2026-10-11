import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { TPV_CODES } from '../../diagnosticCodes';

const BASE = path.resolve(__dirname, '../../../src/test/fixtures/version-tokens');

suite('Versioned files with runtime scenario tokens', function () {
    this.timeout(15000);

    test('keeps scenario slots distinct and only fixes matching series', async () => {
        const config = vscode.workspace.getConfiguration('tuflowValidator');
        await config.update('diagnosticLevel', 'hint', vscode.ConfigurationTarget.Global);
        await config.update('enableLatestVersionChecks', true, vscode.ConfigurationTarget.Global);

        const doc = await vscode.workspace.openTextDocument(
            path.join(BASE, 'runs', 'TokenRun_~s1~_v02.tcf')
        );
        await vscode.window.showTextDocument(doc);
        const deadline = Date.now() + 8000;
        let warnings: vscode.Diagnostic[] = [];
        while (Date.now() < deadline) {
            const all = vscode.languages.getDiagnostics(doc.uri);
            warnings = all.filter(issue => (
                typeof issue.code === 'object' ? issue.code.value : issue.code
            ) === TPV_CODES.outdatedVersion);
            if (warnings.length > 0) {
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        assert.strictEqual(warnings.length, 1);
        assert.ok(warnings[0].message.includes('matching_~s1~_v01.tgc'));
        assert.ok(!warnings.some(item => item.message.includes('model_~s1~_v01.tgc')));

        const fixes = await vscode.commands.executeCommand<vscode.CodeAction[]>(
            'vscode.executeCodeActionProvider', doc.uri, warnings[0].range,
            vscode.CodeActionKind.QuickFix.value
        ) ?? [];
        const latestFix = fixes.find(fix => fix.title === 'Update to latest version (TUFLOW)');
        const edits = latestFix?.edit?.get(doc.uri) ?? [];
        assert.strictEqual(edits.length, 1);
        assert.strictEqual(edits[0].newText, '..\\model\\matching_~s1~_v02.tgc');
    });
});
