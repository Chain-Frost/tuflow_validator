import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { TPV_CODES } from '../../diagnosticCodes';
import {
    getTrackedDependencyPaths,
    normalizeDependencyPath,
    removeDiagnosticsForDocument,
    scheduleDiagnosticsUpdate,
    updateDiagnostics
} from '../../diagnostics';
import * as inventory from '../../geopackageInventory';
import { createGeoPackage } from '../helpers/gpkgFixtures';

suite('GeoPackage context and asynchronous revalidation', function () {
    this.timeout(30000);
    let directory: string;
    let collection: vscode.DiagnosticCollection;
    let documents: vscode.TextDocument[];
    const originalConfiguration = new Map<string, unknown>();
    const configuration = () => vscode.workspace.getConfiguration('tuflowValidator');

    suiteSetup(async () => {
        const settings: Array<[string, boolean | string]> = [
            ['enableGeoPackageLayerChecks', true],
            ['enableLatestVersionChecks', false],
            // Context must remain conservative even when block diagnostics are off.
            ['enableIfStatementChecks', false],
            ['diagnosticLevel', 'hint']
        ];
        for (const [name, value] of settings) {
            originalConfiguration.set(name, configuration().inspect(name)?.globalValue);
            await configuration().update(name, value, vscode.ConfigurationTarget.Global);
        }
    });

    setup(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tpv-gpkg-context-'));
        documents = [];
        collection = vscode.languages.createDiagnosticCollection('tpv-gpkg-context-test');
        inventory.invalidateGeoPackage();
    });

    teardown(async () => {
        for (const document of documents) {
            if (!document.isClosed && document.isDirty) {
                await document.save();
            }
        }
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        for (const document of documents) {
            await removeDiagnosticsForDocument(document, collection);
        }
        collection.dispose();
        inventory.invalidateGeoPackage();
        // Windows directory watchers may release their handles asynchronously.
        await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });

    suiteTeardown(async () => {
        for (const [name, value] of originalConfiguration) {
            await configuration().update(name, value, vscode.ConfigurationTarget.Global);
        }
    });

    async function open(name: string, contents: string): Promise<vscode.TextDocument> {
        const file = path.join(directory, name);
        fs.writeFileSync(file, contents);
        const document = await vscode.workspace.openTextDocument(file);
        documents.push(document);
        await vscode.window.showTextDocument(document, { preview: false, preserveFocus: true });
        return document;
    }

    function diagnostics(documentOrPath: vscode.TextDocument | string): vscode.Diagnostic[] {
        const uri = typeof documentOrPath === 'string'
            ? vscode.Uri.file(path.join(directory, documentOrPath)) : documentOrPath.uri;
        return [...(collection.get(uri) ?? [])];
    }

    function missingLayers(documentOrPath: vscode.TextDocument | string): vscode.Diagnostic[] {
        return diagnostics(documentOrPath).filter(item => item.code === TPV_CODES.missingGeoPackageLayer);
    }

    test('Read File remains inline when the included file uses a .tcf extension', async () => {
        createGeoPackage(path.join(directory, 'global.gpkg'), ['global_layer']);
        createGeoPackage(path.join(directory, 'replacement.gpkg'), ['replacement_layer']);
        fs.writeFileSync(path.join(directory, 'settings.tcf'), 'Spatial Database == replacement.gpkg');
        const document = await open('root.tcf', [
            'Spatial Database == global.gpkg',
            'Read File == settings.tcf',
            'Read GIS Mat == replacement_layer'
        ].join('\n'));
        await updateDiagnostics(document, collection);
        assert.deepStrictEqual(diagnostics(document), []);
        assert.deepStrictEqual(diagnostics('settings.tcf'), []);
    });

    test('inline .tcf assignments preserve a local scope and OFF still affects the parent', async () => {
        createGeoPackage(path.join(directory, 'global.gpkg'), ['global_layer']);
        createGeoPackage(path.join(directory, 'local.gpkg'), ['local_layer']);
        fs.writeFileSync(path.join(directory, 'settings.tcf'), 'Spatial Database == local.gpkg');
        fs.writeFileSync(path.join(directory, 'geometry.tgc'), [
            'Read File == settings.tcf',
            'Read GIS Mat == local_layer'
        ].join('\n'));
        fs.writeFileSync(path.join(directory, 'off.tcf'), 'Spatial Database == OFF');
        fs.writeFileSync(path.join(directory, 'boundary.tbc'), 'Read File == off.tcf');
        const document = await open('root.tcf', [
            'Spatial Database == global.gpkg',
            'Geometry Control File == geometry.tgc',
            'Read GIS Mat == global_layer',
            'BC Control File == boundary.tbc',
            'Read GIS Mat == runtime_layer'
        ].join('\n'));
        await updateDiagnostics(document, collection);
        assert.deepStrictEqual(missingLayers(document), []);
        assert.deepStrictEqual(diagnostics('geometry.tgc'), []);
        assert.deepStrictEqual(diagnostics('settings.tcf'), []);
        const unresolved = diagnostics(document).filter(item => item.code === TPV_CODES.unresolvedDatabase);
        assert.deepStrictEqual(unresolved.map(item => item.range.start.line), [4]);
    });

    test('conditional includes invalidate changed variables without discarding unaffected ones', async () => {
        createGeoPackage(path.join(directory, 'model.gpkg'), ['actual']);
        fs.writeFileSync(path.join(directory, 'override.trd'), 'Set Variable Layer == actual');
        const document = await open('root.tcf', [
            'Set Variable Layer == former',
            'Set Variable Stable == definitely_missing',
            'If Scenario == DEV',
            'Read File == override.trd',
            'End If',
            'Read GIS Mat == model.gpkg >> <<Layer>>',
            'Read GIS Mat == model.gpkg >> <<Stable>>'
        ].join('\n'));
        await updateDiagnostics(document, collection);
        const missing = missingLayers(document);
        assert.strictEqual(missing.length, 1);
        assert.strictEqual(missing[0].range.start.line, 6);
        assert.ok(missing[0].message.includes('definitely_missing'));
        assert.strictEqual(document.getText(missing[0].range), '<<Stable>>');
    });

    test('uninspectable includes cannot preserve stale variables for explicit selectors', async () => {
        createGeoPackage(path.join(directory, 'model.gpkg'), ['actual']);
        fs.writeFileSync(path.join(directory, 'ignored.trd'), '! tpv-ignore-file\nSet Variable Layer == actual');
        fs.writeFileSync(path.join(directory, 'line_ignored.trd'), 'Set Variable Layer == actual');
        fs.writeFileSync(path.join(directory, 'settings.txt'), 'Set Variable Layer == actual');
        // An existing directory is unreadable as a control file on every platform.
        fs.mkdirSync(path.join(directory, 'unreadable.trd'));
        const includes = [
            'ignored.trd',
            'line_ignored.trd ! tpv-ignore',
            '<<UnknownInclude>>',
            'missing.trd',
            'unreadable.trd',
            'settings.txt'
        ];
        for (let index = 0; index < includes.length; index++) {
            const document = await open(`root${index}.tcf`, [
                'Set Variable Layer == former',
                `Read File == ${includes[index]}`,
                'Read GIS Mat == model.gpkg >> <<Layer>>'
            ].join('\n'));
            await updateDiagnostics(document, collection);
            assert.deepStrictEqual(missingLayers(document), [], includes[index]);
            const missingFiles = diagnostics(document).filter(item => item.code === TPV_CODES.missingFile);
            assert.strictEqual(missingFiles.length, includes[index] === 'missing.trd' ? 1 : 0, includes[index]);
        }
    });

    test('an unresolved local database assignment may disable the global database', async () => {
        createGeoPackage(path.join(directory, 'global.gpkg'), ['known']);
        fs.writeFileSync(path.join(directory, 'geometry.tgc'), 'Spatial Database == <<UnknownDatabase>>');
        fs.writeFileSync(path.join(directory, 'boundary.tbc'), 'Read GIS Mat == runtime_layer');
        const document = await open('root.tcf', [
            'Spatial Database == global.gpkg',
            'Geometry Control File == geometry.tgc',
            'BC Control File == boundary.tbc',
            'Read GIS Mat == runtime_layer'
        ].join('\n'));
        await updateDiagnostics(document, collection);
        assert.deepStrictEqual(missingLayers(document), []);
        assert.deepStrictEqual(missingLayers('boundary.tbc'), []);
        assert.ok(diagnostics(document).some(item => item.code === TPV_CODES.unresolvedDatabase && item.range.start.line === 3));
        assert.ok(diagnostics('boundary.tbc').some(item => item.code === TPV_CODES.unresolvedDatabase));
    });

    test('nested non-event Define blocks do not end runtime database uncertainty', async () => {
        createGeoPackage(path.join(directory, 'global.gpkg'), ['known']);
        createGeoPackage(path.join(directory, 'event.gpkg'), ['event_layer']);
        const document = await open('root.tcf', [
            'Spatial Database == global.gpkg',
            'Set Variable Layer == known',
            'Define Event == storm',
            'Define Output Zone == zone',
            'End Define',
            'Spatial Database == event.gpkg',
            'Set Variable Layer == event_missing',
            'End Define',
            'Read GIS Mat == runtime_layer',
            'Read GIS Mat == event.gpkg >> <<Layer>>'
        ].join('\n'));
        await updateDiagnostics(document, collection);
        assert.deepStrictEqual(missingLayers(document), []);
        assert.ok(diagnostics(document).some(item => item.code === TPV_CODES.unresolvedDatabase && item.range.start.line === 8));
    });

    test('a child edit invalidates and restarts its parent during the first asynchronous scan', async () => {
        const database = path.join(directory, 'model.gpkg');
        createGeoPackage(database, ['valid']);
        const child = await open('child.trd', 'Read GIS Mat == model.gpkg >> stale_missing');
        await updateDiagnostics(child, collection);
        const parent = await open('root.tcf', '');
        await updateDiagnostics(parent, collection);
        await replaceText(parent, 'Read File == child.trd');

        const pause = pauseInventory(database);
        let firstScan: Promise<void> | undefined;
        try {
            firstScan = updateDiagnostics(parent, collection);
            await withTimeout(pause.entered, 'The parent did not reach metadata inspection');
            await replaceText(child, 'Read GIS Mat == model.gpkg >> current_missing');
            // Explicitly schedule with this collection and reset the debounce timer.
            scheduleDiagnosticsUpdate(child, collection);
            pause.release();
            await firstScan;

            assert.ok(!diagnostics(parent).some(item => item.code === TPV_CODES.childIssues),
                'The stale parent scan must not publish during the debounce interval');
            await until(() => diagnostics(parent).some(item => item.code === TPV_CODES.childIssues));
            assert.ok(missingLayers(child).some(item => item.message.includes('current_missing')));
            assert.ok(!missingLayers(child).some(item => item.message.includes('stale_missing')));
            assert.ok(getTrackedDependencyPaths().has(normalizeDependencyPath(child.fileName)),
                'The replacement parent scan must publish its child dependency');
        } finally {
            pause.release();
            pause.restore();
            await firstScan;
        }
    });

    test('disabling the setting prevents an already-running metadata pass from publishing', async () => {
        const database = path.join(directory, 'model.gpkg');
        createGeoPackage(database, ['valid']);
        const document = await open('root.tcf', '');
        await updateDiagnostics(document, collection);
        await replaceText(document, 'Read GIS Mat == model.gpkg >> stale_missing');
        const pause = pauseInventory(database);
        let firstScan: Promise<void> | undefined;
        try {
            firstScan = updateDiagnostics(document, collection);
            await withTimeout(pause.entered, 'The document did not reach metadata inspection');
            await configuration().update('enableGeoPackageLayerChecks', false, vscode.ConfigurationTarget.Global);
            await updateDiagnostics(document, collection);
            pause.release();
            await firstScan;
            assert.deepStrictEqual(missingLayers(document), []);
        } finally {
            pause.release();
            pause.restore();
            await firstScan;
            await configuration().update('enableGeoPackageLayerChecks', true, vscode.ConfigurationTarget.Global);
        }
    });
});

async function replaceText(document: vscode.TextDocument, contents: string): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri,
        new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), contents);
    assert.strictEqual(await vscode.workspace.applyEdit(edit), true);
}

/** Delay only this test's database; keep real inventories for unrelated roots. */
function pauseInventory(database: string): {
    entered: Promise<void>;
    release: () => void;
    restore: () => void;
} {
    const mutableExports = inventory as {
        createGeoPackageInventoryPass: typeof inventory.createGeoPackageInventoryPass;
    };
    const original = mutableExports.createGeoPackageInventoryPass;
    let markEntered!: () => void;
    let release!: () => void;
    const entered = new Promise<void>(resolve => { markEntered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    mutableExports.createGeoPackageInventoryPass = () => {
        const inspect = original();
        return async filePath => {
            if (normalizeDependencyPath(filePath) === normalizeDependencyPath(database)) {
                markEntered();
                await gate;
            }
            return inspect(filePath);
        };
    };
    return {
        entered,
        release,
        restore: () => { mutableExports.createGeoPackageInventoryPass = original; }
    };
}

async function withTimeout(promise: Promise<void>, message: string): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        await Promise.race([
            promise,
            new Promise<void>((_, reject) => {
                timer = setTimeout(() => reject(new Error(message)), 8000);
            })
        ]);
    } finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
}

async function until(predicate: () => boolean): Promise<void> {
    const deadline = Date.now() + 8000;
    while (!predicate()) {
        assert.ok(Date.now() < deadline, 'Timed out waiting for current context diagnostics');
        await new Promise(resolve => setTimeout(resolve, 30));
    }
}
