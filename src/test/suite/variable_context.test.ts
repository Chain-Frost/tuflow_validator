import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { TPV_CODES } from '../../diagnosticCodes';

const BASE = path.resolve(__dirname, '../../../src/test/fixtures/context');

suite('Conditional and repeated include contexts', function () {
    this.timeout(15000);

    suiteSetup(async () => {
        const config = vscode.workspace.getConfiguration('tuflowValidator');
        await config.update('diagnosticLevel', 'hint', vscode.ConfigurationTarget.Global);
        await config.update('enableLatestVersionChecks', true, vscode.ConfigurationTarget.Global);
    });

    test('conditionally included variable definitions do not escape the runtime branch', async () => {
        const root = await open('conditional/runs/root.tcf');
        await delay(600);
        const issues = vscode.languages.getDiagnostics(root.uri);
        assert.ok(!issues.some(issue => issue.code === TPV_CODES.missingFile),
            issues.map(issue => issue.message).join('; '));
    });

    test('repeated includes are re-checked after static variables change', async () => {
        const root = await open('repeated/runs/root.tcf');
        const childUri = vscode.Uri.file(path.join(BASE, 'repeated/runs/child.trd'));
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
            const issues = vscode.languages.getDiagnostics(childUri);
            if (issues.some(issue => issue.code === TPV_CODES.missingFile)) {
                assert.strictEqual(issues.filter(issue => issue.code === TPV_CODES.missingFile).length, 1);
                assert.ok(vscode.languages.getDiagnostics(root.uri).some(
                    issue => issue.code === TPV_CODES.childIssues
                ));
                return;
            }
            await delay(50);
        }
        assert.fail('Expected missing file under the second variable context');
    });

    test('TRD nested under a separate TCF uses the child TCF directory', async () => {
        const root = await open('nested-tcf/parent/runs/Parent_v02.tcf');
        const nestedUri = vscode.Uri.file(path.join(
            BASE, 'nested-tcf/child/model/nested_v02.trd'
        ));
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
            const issues = vscode.languages.getDiagnostics(nestedUri);
            if (issues.some(issue => (
                typeof issue.code === 'object' ? issue.code.value : issue.code
            ) === TPV_CODES.outdatedVersion)) {
                assert.ok(!issues.some(issue => issue.code === TPV_CODES.missingFile));
                assert.ok(!vscode.languages.getDiagnostics(root.uri).some(
                    issue => issue.code === TPV_CODES.missingFile
                ));
                return;
            }
            await delay(50);
        }
        assert.fail('Expected version warning in TRD scoped to child TCF directory');
    });
});

async function open(relative: string): Promise<vscode.TextDocument> {
    const doc = await vscode.workspace.openTextDocument(path.join(BASE, relative));
    await vscode.window.showTextDocument(doc);
    return doc;
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
