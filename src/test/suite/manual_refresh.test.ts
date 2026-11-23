import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { TPV_CODES } from '../../diagnosticCodes';

const REFRESH = 'tuflowValidator.refreshDiagnostics';

function hasCode(uri: vscode.Uri, code: string): boolean {
    return vscode.languages.getDiagnostics(uri).some(diagnostic => {
        const actual = typeof diagnostic.code === 'object' && diagnostic.code !== null
            ? diagnostic.code.value : diagnostic.code;
        return actual === code;
    });
}

suite('Issue #23 explicit diagnostics refresh', function () {
    this.timeout(20000);

    suiteSetup(async () => {
        const settings = vscode.workspace.getConfiguration('tuflowValidator');
        await settings.update('diagnosticLevel', 'hint', vscode.ConfigurationTarget.Global);
        await settings.update('enableLatestVersionChecks', true, vscode.ConfigurationTarget.Global);
    });

    test('re-evaluates an out-of-workspace file after missed disk notifications', async () => {
        // This verifies the explicit fallback, not native SMB notification
        // delivery. The local fixture is not an SMB/mapped-drive test.
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpv-manual-refresh-'));
        const rootPath = path.join(dir, 'Run_v01.tcf');
        const rootUri = vscode.Uri.file(rootPath);
        const childPath = path.join(dir, 'geom_v01.tgc');
        const childUri = vscode.Uri.file(childPath);
        const newVersion = path.join(dir, 'geom_v02.tgc');
        const renamedVersion = path.join(dir, 'different_v02.tgc');
        fs.writeFileSync(rootPath, 'Geometry Control File == geom_v01.tgc\n');
        fs.writeFileSync(childPath, '! existing geometry\n');

        let rootDocument: vscode.TextDocument | undefined;
        try {
            rootDocument = await vscode.workspace.openTextDocument(rootUri);
            await vscode.window.showTextDocument(rootDocument, { preview: false });
            assert.strictEqual(vscode.workspace.getWorkspaceFolder(rootUri), undefined,
                'The fixture must be outside the active workspace');
            assert.ok((await vscode.commands.getCommands(true)).includes(REFRESH),
                'Manual refresh command must be registered on activation');

            await vscode.commands.executeCommand(REFRESH);
            assert.strictEqual(hasCode(rootUri, TPV_CODES.outdatedVersion), false);

            // Creation/rename/deletion may or may not deliver a native watcher
            // event. The awaited command must always recompute the answer.
            fs.writeFileSync(newVersion, '! created sibling\n');
            await vscode.commands.executeCommand(REFRESH);
            assert.ok(hasCode(rootUri, TPV_CODES.outdatedVersion),
                'Manual refresh did not detect the newly created version sibling');

            fs.renameSync(newVersion, renamedVersion);
            await vscode.commands.executeCommand(REFRESH);
            assert.strictEqual(hasCode(rootUri, TPV_CODES.outdatedVersion), false,
                'Manual refresh retained a moved-away version sibling');

            fs.renameSync(renamedVersion, newVersion);
            await vscode.commands.executeCommand(REFRESH);
            assert.ok(hasCode(rootUri, TPV_CODES.outdatedVersion));

            fs.unlinkSync(newVersion);
            await vscode.commands.executeCommand(REFRESH);
            assert.strictEqual(hasCode(rootUri, TPV_CODES.outdatedVersion), false,
                'Manual refresh retained a deleted version sibling');

            fs.writeFileSync(childPath, 'Read GIS BC == missing_child.shp\n');
            await vscode.commands.executeCommand(REFRESH);
            assert.ok(hasCode(childUri, TPV_CODES.missingFile),
                'Missing file in changed included control text was not detected');
            assert.ok(hasCode(rootUri, TPV_CODES.childIssues),
                'Root summary did not update after a child disk edit');

            fs.writeFileSync(childPath, '! no missing files\n');
            await vscode.commands.executeCommand(REFRESH);
            assert.strictEqual(hasCode(childUri, TPV_CODES.missingFile), false);
            assert.strictEqual(hasCode(rootUri, TPV_CODES.childIssues), false);

            const added = [
                'Geometry Control File == geom_v01.tgc',
                'If Scenario == Storm',
                'Read GIS BC == conditional_missing.shp',
                'End If',
                'Read GIS BC == <<~s1~>>.shp',
                ''
            ].join('\n');
            const edit = new vscode.WorkspaceEdit();
            edit.replace(rootUri, new vscode.Range(
                rootDocument.positionAt(0), rootDocument.positionAt(rootDocument.getText().length)
            ), added);
            assert.strictEqual(await vscode.workspace.applyEdit(edit), true);
            assert.ok(rootDocument.isDirty, 'Must analyse dirty editor text without saving');

            await vscode.commands.executeCommand(REFRESH);
            const missing = vscode.languages.getDiagnostics(rootUri)
                .filter(diagnostic => (
                    (typeof diagnostic.code === 'object' && diagnostic.code !== null
                        ? diagnostic.code.value : diagnostic.code) === TPV_CODES.missingFile
                ));
            assert.ok(missing.some(diagnostic => diagnostic.message.includes('conditional_missing.shp')),
                'A concretely missing input inside a conditional still requires a diagnostic');
            assert.ok(!missing.some(diagnostic => diagnostic.message.includes('<<~s1~>>')),
                'Runtime scenario tokens must remain unresolved');
        } finally {
            // Only disposable fixture content is saved or removed.
            if (rootDocument?.isDirty) {
                await rootDocument.save();
            }
            await vscode.commands.executeCommand('workbench.action.closeAllEditors');
            fs.rmSync(dir, { recursive: true, force: true, maxRetries: 12, retryDelay: 250 });
        }
    });
});
