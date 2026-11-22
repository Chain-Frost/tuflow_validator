import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { TPV_CODES } from '../../diagnosticCodes';
import { getTrackedDependencyPaths, updateDiagnosticsForChangedPath } from '../../diagnostics';

const outdated = (uri: vscode.Uri): vscode.Diagnostic[] =>
    vscode.languages.getDiagnostics(uri).filter(d =>
        (typeof d.code === 'object' && d.code !== null ? d.code.value : d.code) === TPV_CODES.outdatedVersion
    );

suite('Issue #3 freshness regressions', function () {
    this.timeout(30000);

    suiteSetup(async () => {
        const config = vscode.workspace.getConfiguration('tuflowValidator');
        await config.update('diagnosticLevel', 'hint', vscode.ConfigurationTarget.Global);
        await config.update('enableLatestVersionChecks', true, vscode.ConfigurationTarget.Global);
    });

    test('unreferenced newer-version creation, rename and deletion update the root', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpv-fresh-sibling-'));
        const root = path.join(dir, 'Run_v01.tcf');
        const original = path.join(dir, 'geom_v01.tgc');
        const newer = path.join(dir, 'geom_v02.tgc');
        const renamed = path.join(dir, 'unrelated_v02.tgc');
        fs.writeFileSync(root, 'Geometry Control File == geom_v01.tgc\n');
        fs.writeFileSync(original, '! existing\n');
        try {
            const doc = await vscode.workspace.openTextDocument(root);
            await vscode.window.showTextDocument(doc);
            await delay(1100); // extension's directory watcher has been reconciled
            assert.ok(getTrackedDependencyPaths().has(path.normalize(original)));
            assert.strictEqual(outdated(doc.uri).length, 0);

            fs.writeFileSync(newer, '! new sibling without a model reference\n');
            await waitFor(() => outdated(doc.uri).some(d => d.message.includes('geom_v01.tgc')),
                'new sibling was not detected by a real directory watcher');

            fs.renameSync(newer, renamed);
            await waitFor(() => outdated(doc.uri).length === 0,
                'renaming a sibling away from the series did not clear the warning');
            fs.renameSync(renamed, newer);
            await waitFor(() => outdated(doc.uri).length > 0, 'renaming a sibling back did not warn');
            fs.unlinkSync(newer);
            await waitFor(() => outdated(doc.uri).length === 0, 'deleting the sibling did not clear warning');

            const probe = vscode.languages.createDiagnosticCollection('tpv-freshness-probe');
            try {
                assert.strictEqual(updateDiagnosticsForChangedPath(path.join(dir, 'unrelated.csv'), probe), false,
                    'unrelated directory event should not cause root revalidation');
            } finally {
                probe.dispose();
            }
        } finally {
            await vscode.commands.executeCommand('workbench.action.closeAllEditors');
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test('unsaved TCF change discovers its new nested latest-reference graph', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpv-fresh-buffer-'));
        const root = path.join(dir, 'Run_v02.tcf');
        const original = path.join(dir, 'original_v02.tgc');
        const changed = path.join(dir, 'other_v02.tgc');
        const layerOld = path.join(dir, 'layer_v01.gpkg');
        const layerNew = path.join(dir, 'layer_v02.gpkg');
        fs.writeFileSync(root, 'Geometry Control File == original_v02.tgc\n');
        fs.writeFileSync(original, '! original\n');
        fs.writeFileSync(changed, 'Read GIS BC == layer_v01.gpkg\n');
        fs.writeFileSync(layerOld, '');
        fs.writeFileSync(layerNew, '');

        let doc: vscode.TextDocument | undefined;
        try {
            doc = await vscode.workspace.openTextDocument(root);
            await vscode.window.showTextDocument(doc);
            await delay(650);
            assert.strictEqual(outdated(vscode.Uri.file(changed)).length, 0);
            const edit = new vscode.WorkspaceEdit();
            edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)),
                'Geometry Control File == other_v02.tgc\n');
            assert.strictEqual(await vscode.workspace.applyEdit(edit), true);
            await waitFor(() => outdated(vscode.Uri.file(changed)).some(d => d.message.includes('layer_v01.gpkg')),
                'dirty TCF did not update nested latest-reference discovery');
            assert.strictEqual(await doc.save(), true);
            await waitFor(() => outdated(vscode.Uri.file(changed)).length > 0,
                'equivalent saved TCF lost the nested latest-version warning');
        } finally {
            if (doc?.isDirty) {
                await doc.save();
            }
            await vscode.commands.executeCommand('workbench.action.closeAllEditors');
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
    const deadline = Date.now() + 9000;
    while (Date.now() < deadline) {
        if (predicate()) {
            return;
        }
        await delay(60);
    }
    assert.fail(message);
}
