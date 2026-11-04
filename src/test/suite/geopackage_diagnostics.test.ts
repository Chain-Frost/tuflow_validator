import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { TPV_CODES } from '../../diagnosticCodes';
import { getTrackedDependencyPaths, updateDiagnostics, updateDiagnosticsForChangedPath } from '../../diagnostics';
import { getGeoPackageInventoryStats, invalidateGeoPackage, resetGeoPackageInventoryStats } from '../../geopackageInventory';
import { createGeoPackage, executeGeoPackageSql } from '../helpers/gpkgFixtures';

suite('Opt-in GeoPackage diagnostics', function () {
    this.timeout(30000);
    let directory: string;
    let collection: vscode.DiagnosticCollection;
    let counter = 0;
    const config = () => vscode.workspace.getConfiguration('tuflowValidator');

    suiteSetup(async () => {
        await config().update('enableLatestVersionChecks', false, vscode.ConfigurationTarget.Global);
        await config().update('enableGeoPackageLayerChecks', true, vscode.ConfigurationTarget.Global);
        await config().update('diagnosticLevel', 'hint', vscode.ConfigurationTarget.Global);
    });
    setup(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tpv-gpkg-diagnostics-'));
        collection = vscode.languages.createDiagnosticCollection('tpv-gpkg-test');
        invalidateGeoPackage();
    });
    teardown(async () => {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        collection.dispose();
        fs.rmSync(directory, { recursive: true, force: true });
    });
    suiteTeardown(async () => {
        await config().update('enableGeoPackageLayerChecks', false, vscode.ConfigurationTarget.Global);
        await config().update('enableLatestVersionChecks', true, vscode.ConfigurationTarget.Global);
        await config().update('diagnosticLevel', 'hint', vscode.ConfigurationTarget.Global);
    });

    async function analyze(contents: string, extension = '.tgc') {
        const file = path.join(directory, `control${++counter}${extension}`);
        fs.writeFileSync(file, contents);
        const document = await vscode.workspace.openTextDocument(file);
        await updateDiagnostics(document, collection);
        return { document, diagnostics: [...(collection.get(document.uri) ?? [])] };
    }
    function layerErrors(diagnostics: vscode.Diagnostic[]) {
        return diagnostics.filter(item => item.code === TPV_CODES.missingGeoPackageLayer);
    }

    test('checks implicit basename and an explicitly different single layer', async () => {
        createGeoPackage(path.join(directory, 'terrain.gpkg'), ['contours']);
        const result = await analyze([
            'Read GIS Z Shape == terrain.gpkg',
            'Read GIS Z Shape == terrain.gpkg >> contours',
            'Read GIS Z Shape == terrain.gpkg >> terrain'
        ].join('\n'));
        assert.deepStrictEqual(layerErrors(result.diagnostics).map(item => item.range.start.line), [0, 2]);
        assert.strictEqual(result.document.getText(layerErrors(result.diagnostics)[0].range), 'terrain.gpkg');
        assert.strictEqual(result.document.getText(layerErrors(result.diagnostics)[1].range), 'terrain');
        createGeoPackage(path.join(directory, 'terrain.gpkg'), ['terrain']);
        await updateDiagnostics(result.document, collection);
        assert.deepStrictEqual(layerErrors([...(collection.get(result.document.uri) ?? [])])
            .map(item => item.range.start.line), [1]);
    });

    test('validates mixed independent files, &&, USE ALL and ASCII casing', async () => {
        createGeoPackage(path.join(directory, 'model.gpkg'), ['model', 'lines', 'points']);
        createGeoPackage(path.join(directory, 'other.gpkg'), ['other']);
        const result = await analyze([
            'Read GIS Z Shape == model.gpkg',
            'Read GIS Z Shape == model.gpkg >> LINES && points',
            'Read GIS Z Shape == model.gpkg >> use all',
            'Read GIS Z Shape == model.gpkg >> lines && missing | other.gpkg >> other && absent'
        ].join('\n'));
        assert.deepStrictEqual(layerErrors(result.diagnostics).map(item => result.document.getText(item.range)), ['missing', 'absent']);
        assert.ok(!result.diagnostics.some(item => item.code === TPV_CODES.missingFile));
    });

    test('a many-layer file still requires its basename when no selector is supplied', async () => {
        createGeoPackage(path.join(directory, 'model.gpkg'), ['lines', 'points']);
        const result = await analyze('Read GIS Z Shape == model.gpkg');
        assert.strictEqual(layerErrors(result.diagnostics).length, 1);
        assert.ok(result.diagnostics[0].message.includes('"model"'));
    });

    test('runtime selectors never suppress concrete file checks or static sibling selectors', async () => {
        createGeoPackage(path.join(directory, 'model.gpkg'), ['fixed']);
        const result = await analyze([
            'Read GIS Z Shape == model.gpkg >> layer_<<~s1~>>',
            'Read GIS Z Shape == model.gpkg >> fixed && missing && layer_<<~~s1~~>>',
            'Read GIS Z Shape == absent.gpkg >> layer_<<~e1~>>',
            'Read GIS Z Shape == dynamic_<<~s1~>>.gpkg >> missing',
            'Set Variable Layer == fixed',
            'Read GIS Z Shape == model.gpkg >> <<Layer>>',
            'Read GIS Z Shape == model.gpkg >> <<Undefined>>',
            'Set Variable Layer == still_<<~s1~>>',
            'Read GIS Z Shape == model.gpkg >> <<Layer>>'
        ].join('\n'));
        assert.deepStrictEqual(layerErrors(result.diagnostics).map(item => item.range.start.line), [1]);
        const missing = result.diagnostics.filter(item => item.code === TPV_CODES.missingFile);
        assert.strictEqual(missing.length, 1);
        assert.strictEqual(missing[0].range.start.line, 2);
    });

    test('supports local Spatial Database and layer-only lists without implied basename', async () => {
        createGeoPackage(path.join(directory, 'model.gpkg'), ['lines', 'points', 'mat.v2']);
        const result = await analyze([
            'Spatial Database == model.gpkg',
            'Read GIS Z Shape == lines && points | mat.v2',
            'Read GIS Mat == layer_<<~s1~>>',
            'Read GIS Mat == missing',
            'Spatial Database == OFF',
            'Read GIS Mat == unresolved'
        ].join('\n'));
        assert.deepStrictEqual(layerErrors(result.diagnostics).map(item => item.range.start.line), [3]);
        assert.ok(!result.diagnostics.some(item => item.code === TPV_CODES.missingFile));
        assert.ok(result.diagnostics.some(item => item.code === TPV_CODES.unresolvedDatabase && item.range.start.line === 5));
    });

    test('inherits TCF defaults, restores TCF after local assignment, and preserves TRD path bases', async () => {
        createGeoPackage(path.join(directory, 'global.gpkg'), ['global_layer']);
        fs.mkdirSync(path.join(directory, 'model'));
        createGeoPackage(path.join(directory, 'model', 'local.gpkg'), ['local_layer']);
        const child = path.join(directory, 'model', 'geometry.tgc');
        const trd = path.join(directory, 'model', 'inline.trd');
        fs.writeFileSync(child, [
            'Read GIS Mat == global_layer',
            'Spatial Database == local.gpkg',
            'Read GIS Mat == local_layer',
            'Read File == inline.trd',
            'Read GIS Mat == global_layer'
        ].join('\n'));
        fs.writeFileSync(trd, 'Spatial Database == global.gpkg\nRead GIS Mat == global_layer\nSpatial Database == TCF');
        const result = await analyze('Spatial Database == global.gpkg\nGeometry Control File == model/geometry.tgc\nRead GIS Mat == global_layer', '.tcf');
        for (const uri of [result.document.uri, vscode.Uri.file(child), vscode.Uri.file(trd)]) {
            const issues = [...(collection.get(uri) ?? [])];
            assert.deepStrictEqual(issues, [], issues.map(item => item.message).join('\n'));
        }
    });

    test('conditional assignments, event definitions, and ignored/unknown includes invalidate certainty', async () => {
        createGeoPackage(path.join(directory, 'global.gpkg'), ['known']);
        createGeoPackage(path.join(directory, 'other.gpkg'), ['other']);
        const result = await analyze([
            'Spatial Database == global.gpkg',
            'If Scenario == DEV',
            'Spatial Database == other.gpkg',
            'End If',
            'Read GIS Mat == possible',
            'Spatial Database == global.gpkg',
            'Define Event == storm',
            'Spatial Database == other.gpkg',
            'End Define',
            'Read GIS Mat == possible',
            'Spatial Database == global.gpkg',
            'Read File == <<Unknown>>',
            'Read GIS Mat == possible',
            'Spatial Database == global.gpkg',
            'Spatial Database == other.gpkg ! tpv-ignore',
            'Read GIS Mat == possible'
        ].join('\n'), '.tcf');
        assert.deepStrictEqual(layerErrors(result.diagnostics), []);
        assert.deepStrictEqual(result.diagnostics.filter(item => item.code === TPV_CODES.unresolvedDatabase)
            .map(item => item.range.start.line), [4, 9, 12, 15]);
    });

    test('OFF in a child disables the caller database and local overrides do not escape', async () => {
        createGeoPackage(path.join(directory, 'global.gpkg'), ['global_layer']);
        createGeoPackage(path.join(directory, 'local.gpkg'), ['local_layer']);
        fs.writeFileSync(path.join(directory, 'local.tgc'), 'Spatial Database == local.gpkg\nRead GIS Mat == local_layer');
        fs.writeFileSync(path.join(directory, 'off.tbc'), 'Spatial Database == OFF');
        const result = await analyze([
            'Spatial Database == global.gpkg',
            'Geometry Control File == local.tgc',
            'Read GIS Mat == global_layer',
            'BC Control File == off.tbc',
            'Read GIS Mat == unknown'
        ].join('\n'), '.tcf');
        assert.deepStrictEqual(layerErrors(result.diagnostics), []);
        assert.deepStrictEqual(result.diagnostics.filter(item => item.code === TPV_CODES.unresolvedDatabase)
            .map(item => item.range.start.line), [4]);
    });

    test('missing and invalid databases receive distinct diagnostics', async () => {
        fs.writeFileSync(path.join(directory, 'broken.gpkg'), 'not sqlite');
        createGeoPackage(path.join(directory, 'empty.gpkg'), []);
        const result = await analyze([
            'Read GIS Mat == absent.gpkg >> missing',
            'Read GIS Mat == broken.gpkg >> missing',
            'Read GIS Mat == empty.gpkg >> USE ALL'
        ].join('\n'));
        assert.deepStrictEqual(result.diagnostics.map(item => item.code), [
            TPV_CODES.missingFile, TPV_CODES.unreadableGeoPackage, TPV_CODES.emptyGeoPackage
        ]);
    });

    test('supports raster catalogs and a vector clip layer on Read Grid', async () => {
        createGeoPackage(path.join(directory, 'rasters.gpkg'), [{ name: 'dem', type: '2d-gridded-coverage' }]);
        createGeoPackage(path.join(directory, 'vectors.gpkg'), ['clip']);
        const result = await analyze('Read Grid Zpts == rasters.gpkg >> dem | vectors.gpkg >> clip');
        assert.deepStrictEqual(result.diagnostics, []);
    });

    test('ignores outputs/unknown commands and supports quoted inputs and ignore directives', async () => {
        createGeoPackage(path.join(directory, 'with space.gpkg'), ['some layer']);
        const result = await analyze([
            'Read GIS Mat == "with space.gpkg" >> "some layer"',
            'Read GIS Mat == "with space.gpkg" >> "missing layer" ! tpv-ignore',
            'Write Check Files == nonexistent.gpkg >> absent',
            'Unknown Command == nonexistent.gpkg >> absent'
        ].join('\n'));
        assert.deepStrictEqual(result.diagnostics, []);
        const ignored = await analyze('Read GIS Mat == nonexistent.gpkg >> absent\n! tpv-ignore-file');
        assert.deepStrictEqual(ignored.diagnostics, []);
    });

    test('disabled mode performs no metadata reads; toggles and severity apply', async () => {
        createGeoPackage(path.join(directory, 'model.gpkg'), ['valid']);
        await config().update('enableGeoPackageLayerChecks', false, vscode.ConfigurationTarget.Global);
        resetGeoPackageInventoryStats();
        const result = await analyze('Read GIS Mat == model.gpkg >> missing\nRead GIS Mat == absent.gpkg >> missing');
        assert.deepStrictEqual(result.diagnostics.map(item => item.code), [TPV_CODES.missingFile]);
        assert.strictEqual(getGeoPackageInventoryStats().metadataReads, 0);
        await config().update('enableGeoPackageLayerChecks', true, vscode.ConfigurationTarget.Global);
        await updateDiagnostics(result.document, collection);
        assert.strictEqual(layerErrors([...(collection.get(result.document.uri) ?? [])]).length, 1);
        await config().update('diagnosticLevel', 'none', vscode.ConfigurationTarget.Global);
        await updateDiagnostics(result.document, collection);
        assert.deepStrictEqual(collection.get(result.document.uri), []);
        await config().update('diagnosticLevel', 'hint', vscode.ConfigurationTarget.Global);
    });

    test('tracks a database and its sidecars once; revalidates changed and missing files', async () => {
        const database = path.join(directory, 'model.gpkg');
        createGeoPackage(database, ['valid']);
        const result = await analyze('Read GIS Mat == model.gpkg >> added\nRead GIS Mat == model.gpkg >> added');
        assert.strictEqual(layerErrors(result.diagnostics).length, 2);
        const dependencies = getTrackedDependencyPaths();
        for (const suffix of ['', '-wal', '-shm', '-journal']) {
            assert.ok(dependencies.has(path.normalize(database + suffix)));
        }
        executeGeoPackageSql(database, 'ALTER TABLE valid RENAME TO added; UPDATE gpkg_contents SET table_name=\'added\' WHERE table_name=\'valid\'; UPDATE gpkg_geometry_columns SET table_name=\'added\' WHERE table_name=\'valid\';');
        assert.ok(updateDiagnosticsForChangedPath(database, collection));
        await until(() => layerErrors([...(collection.get(result.document.uri) ?? [])]).length === 0);
        fs.unlinkSync(database);
        assert.ok(updateDiagnosticsForChangedPath(database, collection));
        await until(() => (collection.get(result.document.uri) ?? []).some(item => item.code === TPV_CODES.missingFile));
    });
});

async function until(predicate: () => boolean): Promise<void> {
    const deadline = Date.now() + 8000;
    while (!predicate()) {
        if (Date.now() >= deadline) {
            assert.fail('Timed out waiting for updated GeoPackage diagnostics');
        }
        await new Promise(resolve => setTimeout(resolve, 30));
    }
}
