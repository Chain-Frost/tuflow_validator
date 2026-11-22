import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { TPV_CODES } from '../../diagnosticCodes';
import { getTrackedDependencyPaths, updateDiagnosticsForChangedPath } from '../../diagnostics';
import { pathIdentity } from '../../io';
import { isVersionSeriesCandidate } from '../../versioning';

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
            assert.ok(getTrackedDependencyPaths().has(pathIdentity(original)));
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

    test('dirty plaintext Read File contents update parents, save and disk events', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpv-fresh-inline-'));
        const rootPath = path.join(dir, 'Run_v01.tcf');
        const childPath = path.join(dir, 'include.data');
        const existingPath = path.join(dir, 'existing.shp');
        fs.writeFileSync(rootPath, 'Read File == include.data\n');
        fs.writeFileSync(childPath, 'Read GIS BC == missing.shp\n');
        fs.writeFileSync(existingPath, '');

        let child: vscode.TextDocument | undefined;
        try {
            const root = await vscode.workspace.openTextDocument(rootPath);
            await vscode.window.showTextDocument(root);
            await waitFor(() => vscode.languages.getDiagnostics(root.uri).some(d =>
                d.message.includes('Referenced file has')), 'missing original inline error summary');

            child = await vscode.workspace.openTextDocument(childPath);
            await vscode.window.showTextDocument(child);
            assert.ok(getTrackedDependencyPaths().has(pathIdentity(childPath)),
                'plaintext include is a root dependency despite its non-control suffix');
            const edit = new vscode.WorkspaceEdit();
            edit.replace(child.uri,
                new vscode.Range(child.positionAt(0), child.positionAt(child.getText().length)),
                'Read GIS BC == existing.shp\n');
            assert.strictEqual(await vscode.workspace.applyEdit(edit), true);
            await waitFor(() => !vscode.languages.getDiagnostics(root.uri).some(d =>
                d.message.includes('Referenced file has')), 'dirty plaintext include did not clear parent');
            assert.strictEqual(await child.save(), true);

            // The previously clean path is still tracked without a diagnostic.
            await delay(750);
            assert.ok(getTrackedDependencyPaths().has(pathIdentity(existingPath)));
            fs.unlinkSync(existingPath);
            await waitFor(() => vscode.languages.getDiagnostics(root.uri).some(d =>
                d.message.includes('Referenced file has')), 'deleting a clean input did not update parent');
            fs.writeFileSync(existingPath, '');
            await waitFor(() => !vscode.languages.getDiagnostics(root.uri).some(d =>
                d.message.includes('Referenced file has')), 'recreating the input did not clear parent');
        } finally {
            if (child?.isDirty) {
                await child.save();
            }
            await vscode.commands.executeCommand('workbench.action.closeAllEditors');
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test('clean included child edited on disk invalidates its parent', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpv-fresh-clean-'));
        const rootPath = path.join(dir, 'Run_v01.tcf');
        const childPath = path.join(dir, 'geom_v01.tgc');
        fs.writeFileSync(rootPath, 'Geometry Control File == geom_v01.tgc\n');
        fs.writeFileSync(childPath, '! no errors\n');
        try {
            const root = await vscode.workspace.openTextDocument(rootPath);
            await vscode.window.showTextDocument(root);
            await delay(1000);
            assert.ok(getTrackedDependencyPaths().has(pathIdentity(childPath)));
            fs.writeFileSync(childPath, 'Read GIS BC == missing.shp\n');
            await waitFor(() => vscode.languages.getDiagnostics(root.uri).some(d =>
                d.message.includes('Referenced file has')), 'clean included child change was not tracked');
            fs.writeFileSync(childPath, '! restored\n');
            await waitFor(() => !vscode.languages.getDiagnostics(root.uri).some(d =>
                d.message.includes('Referenced file has')), 'restored child still has parent summary');
        } finally {
            await vscode.commands.executeCommand('workbench.action.closeAllEditors');
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test('shared children survive close/reopen without stale owners', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpv-fresh-shared-'));
        const rootAPath = path.join(dir, 'RunA_v01.tcf');
        const rootBPath = path.join(dir, 'RunB_v01.tcf');
        const commonPath = path.join(dir, 'geom_v01.tgc');
        const newerPath = path.join(dir, 'geom_v02.tgc');
        fs.writeFileSync(rootAPath, 'Geometry Control File == geom_v01.tgc\n');
        fs.writeFileSync(rootBPath, 'Geometry Control File == geom_v01.tgc\n');
        fs.writeFileSync(commonPath, '! shared\n');
        try {
            const a = await vscode.workspace.openTextDocument(rootAPath);
            const b = await vscode.workspace.openTextDocument(rootBPath);
            await vscode.window.showTextDocument(a);
            await vscode.window.showTextDocument(b);
            await delay(1100);
            fs.writeFileSync(newerPath, '! newer\n');
            await waitFor(() => outdated(a.uri).length > 0 && outdated(b.uri).length > 0,
                'shared version-sibling event did not update both roots');

            // Closing an editor tab does not guarantee onDidCloseTextDocument:
            // VS Code may keep the document open. Close both document roots
            // before checking the actual onDidClose ownership cleanup.
            const closedUris = new Set<string>();
            const closeListener = vscode.workspace.onDidCloseTextDocument(d => closedUris.add(d.uri.toString()));
            await vscode.commands.executeCommand('workbench.action.closeAllEditors');
            await delay(400);
            console.log('FRESHNESS_CLOSE_OBSERVATION', JSON.stringify({
                aClosed: closedUris.has(a.uri.toString()),
                bClosed: closedUris.has(b.uri.toString()),
                aLoaded: vscode.workspace.textDocuments.some(d => d.uri.toString() === a.uri.toString()),
                bLoaded: vscode.workspace.textDocuments.some(d => d.uri.toString() === b.uri.toString()),
                aVisible: vscode.window.visibleTextEditors.some(e => e.document.uri.toString() === a.uri.toString()),
                bVisible: vscode.window.visibleTextEditors.some(e => e.document.uri.toString() === b.uri.toString()),
                aDiagnostics: outdated(a.uri).length,
                bDiagnostics: outdated(b.uri).length
            }));
            closeListener.dispose();
            await waitFor(() => outdated(a.uri).length === 0 && outdated(b.uri).length === 0,
                'closed document roots left stale diagnostics');
            const reopened = await vscode.workspace.openTextDocument(rootBPath);
            await vscode.window.showTextDocument(reopened);
            await waitFor(() => outdated(reopened.uri).length > 0,
                'reopening a shared-root document lost its latest-version warning');
            await delay(750); // watcher re-created for the surviving root
            fs.unlinkSync(newerPath);
            await waitFor(() => outdated(reopened.uri).length === 0,
                'reopened root lost the shared directory watcher');
        } finally {
            await vscode.commands.executeCommand('workbench.action.closeAllEditors');
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test('version-event matching retains existing series rules and separate Windows path identities', () => {
        const p = (name: string): string => path.join('model', name);
        assert.ok(isVersionSeriesCandidate(p('geom_v01.tgc'), p('geom_v02.tgc')));
        assert.ok(!isVersionSeriesCandidate(p('geom_v01.tgc'), p('other_v02.tgc')));
        assert.ok(!isVersionSeriesCandidate(p('geom_v01.tgc'), path.join('other', 'geom_v02.tgc')));
        assert.ok(!isVersionSeriesCandidate(p('geom_v01.tgc'), p('geom_v02.shp')));
        assert.ok(!isVersionSeriesCandidate(p('geom.tgc'), p('geom_v02.tgc')));

        const mapped = pathIdentity('Z:\\models\\geom_v01.tgc');
        const unc = pathIdentity('\\\\server\\share\\models\\geom_v01.tgc');
        assert.notStrictEqual(mapped, unc, 'a drive mapping cannot be assumed to equal a UNC path');
        if (process.platform === 'win32') {
            assert.strictEqual(pathIdentity('C:\\MODELS\\GEOM_V01.TGC'),
                pathIdentity('c:\\models\\geom_v01.tgc'));
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
