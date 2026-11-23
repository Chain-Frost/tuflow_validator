import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { TPV_CODES } from '../../diagnosticCodes';

type Fixture = { base: string; a: string; b: string; trd: string; nested: string };

function makeFixture(): Fixture {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tpv-trd-context-'));
    const files: Array<[string, string]> = [
        ['a/runs/A.tcf', 'Set Variable LOCAL_SHAPE == assets/only_a.shp\nRead File == ../../standalone/context/shared/terrain.trd\n'],
        ['b/runs/B.tcf', 'Set Variable LOCAL_SHAPE == assets/missing_b.shp\nRead File == ../../standalone/context/shared/terrain.trd\n'],
        ['standalone/context/shared/terrain.trd', [
            'Read GIS Z Shape == assets/present.shp',
            'Read GIS Z Shape == <<LOCAL_SHAPE>>',
            'Read GIS Z Shape == assets/missing.shp',
            'Read File == ../../shared/nested.trd',
            'If Scenario == F08',
            'Read GIS Z Shape == assets/conditional_missing.shp',
            'End If',
            'Read GIS Z Shape == assets/<<~s1~>>.shp',
            ''
        ].join('\n')],
        ['shared/nested.trd', 'Read GIS Z Shape == assets/present.shp\n'],
        ['a/runs/assets/present.shp', ''],
        ['a/runs/assets/edited_present.shp', ''],
        ['a/runs/assets/only_a.shp', ''],
        ['b/runs/assets/present.shp', ''],
        ['b/runs/assets/edited_present.shp', '']
    ];
    for (const [relative, contents] of files) {
        const target = path.join(base, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, contents);
    }
    const fixture = {
        base, a: path.join(base, 'a/runs/A.tcf'), b: path.join(base, 'b/runs/B.tcf'),
        trd: path.join(base, 'standalone/context/shared/terrain.trd'),
        nested: path.join(base, 'shared/nested.trd')
    };
    // Both the correct and formerly incorrect nested-include candidates stay
    // inside this disposable fixture; unrelated /tmp files cannot affect it.
    const wrongNested = path.resolve(path.dirname(fixture.trd), '../../shared/nested.trd');
    assert.ok(wrongNested.startsWith(base + path.sep));
    assert.strictEqual(fs.existsSync(wrongNested), false);
    return fixture;
}

function diagnostics(file: string): vscode.Diagnostic[] {
    return vscode.languages.getDiagnostics(vscode.Uri.file(file));
}

function missing(file: string): string[] {
    return diagnostics(file).filter(issue => issue.code === TPV_CODES.missingFile)
        .map(issue => issue.message).sort();
}

async function open(file: string): Promise<vscode.TextDocument> {
    const document = await vscode.workspace.openTextDocument(file);
    await vscode.window.showTextDocument(document, { preview: false });
    return document;
}

function delay(ms = 450): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
        if (predicate()) { return; }
        await delay(50);
    }
    assert.fail(message);
}

function assertKnownParentMissing(f: Fixture, withB = false): void {
    const expected = [
        'File not found: assets/conditional_missing.shp',
        'File not found: assets/missing.shp'
    ];
    if (withB) { expected.push('File not found: <<LOCAL_SHAPE>>'); }
    assert.deepStrictEqual(missing(f.trd), expected.sort(),
        'Opening a TRD must not add errors from an invented TRD-directory base');
    assert.deepStrictEqual(missing(f.nested), []);
}

async function cleanup(f: Fixture): Promise<void> {
    for (const document of vscode.workspace.textDocuments) {
        if (document.fileName.includes(path.basename(f.base)) && document.isDirty) {
            await document.save();
        }
    }
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    // A closed tab is not necessarily a disposed TextDocument. Do not assert
    // otherwise or let temporary Windows watcher contention hide test results.
    try {
        await fs.promises.rm(f.base, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 });
    } catch (error) {
        console.warn('TRD_CONTEXT_CLEANUP ' + String(error));
    }
}

suite('TRD editor context (F08)', function () {
    this.timeout(35000);

    suiteSetup(async () => {
        const config = vscode.workspace.getConfiguration('tuflowValidator');
        await config.update('diagnosticLevel', 'hint', vscode.ConfigurationTarget.Global);
        await config.update('enableLatestVersionChecks', true, vscode.ConfigurationTarget.Global);
        await config.update('enableIfStatementChecks', true, vscode.ConfigurationTarget.Global);
        console.log('TRD_CONTEXT_ENV ' + JSON.stringify({
            vscode: vscode.version, node: process.version, platform: process.platform,
            workflowSha: process.env.GITHUB_SHA ?? 'local'
        }));
    });

    test('opening, editing and saving included/nested TRDs preserves the source-TCF base', async () => {
        const f = makeFixture();
        try {
            await open(f.a);
            await waitFor(() => missing(f.trd).length >= 2, 'Parent diagnostics did not arrive');
            assertKnownParentMissing(f);
            const child = await open(f.trd);
            await open(f.nested);
            await delay();
            assertKnownParentMissing(f);

            const previous = 'assets/present.shp';
            const offset = child.getText().indexOf(previous);
            const edit = new vscode.WorkspaceEdit();
            edit.replace(child.uri, new vscode.Range(child.positionAt(offset),
                child.positionAt(offset + previous.length)), 'assets/edited_present.shp');
            const missingOffset = child.getText().indexOf('assets/missing.shp');
            edit.replace(child.uri, new vscode.Range(child.positionAt(missingOffset),
                child.positionAt(missingOffset + 'assets/missing.shp'.length)), 'assets/present.shp');
            assert.strictEqual(await vscode.workspace.applyEdit(edit), true);
            assert.ok(child.isDirty);
            await waitFor(() => missing(f.trd).length === 1,
                'Dirty child changes must retire the fixed error without saving');
            assert.deepStrictEqual(missing(f.trd), ['File not found: assets/conditional_missing.shp']);
            assert.deepStrictEqual(missing(f.nested), []);
            assert.strictEqual(await child.save(), true);
            await delay();
            assert.deepStrictEqual(missing(f.trd), ['File not found: assets/conditional_missing.shp']);
            assert.deepStrictEqual(missing(f.nested), []);
            assert.ok(diagnostics(f.a).some(issue => issue.code === TPV_CODES.childIssues));
        } finally {
            await cleanup(f);
        }
    });

    test('orphan relative references stay unknown and become checkable after a parent opens', async () => {
        const f = makeFixture();
        fs.appendFileSync(f.trd, 'End If\n');
        try {
            await open(f.trd);
            await waitFor(() => diagnostics(f.trd).some(issue => issue.code === TPV_CODES.unexpectedEnd),
                'Context-free block checks must remain active on orphan TRDs');
            assert.deepStrictEqual(missing(f.trd), [], 'No source TCF means no invented relative path base');
            assert.deepStrictEqual(diagnostics(f.nested), [], 'An unresolved relative include is not traversed');
            await open(f.a);
            await waitFor(() => missing(f.trd).length >= 2, 'Known parent must restore concrete path checks');
            assertKnownParentMissing(f);
            assert.ok(diagnostics(f.trd).some(issue => issue.code === TPV_CODES.unexpectedEnd));
        } finally {
            await cleanup(f);
        }
    });

    test('orphan TRDs still check absolute paths, static absolute values and conditional missing inputs', async () => {
        const f = makeFixture();
        const absoluteMissing = path.join(f.base, 'absolute-missing.shp');
        const conditionalMissing = path.join(f.base, 'conditional-absolute-missing.shp');
        const nestedMissing = path.join(f.base, 'nested-absolute-missing.shp');
        fs.writeFileSync(f.trd, [
            'Read GIS Z Shape == assets/relative-unknown.shp',
            `Read GIS Z Shape == ${path.join(f.base, 'a/runs/assets/present.shp')}`,
            `Set Variable ABS_FILE == ${absoluteMissing}`,
            'Read GIS Z Shape == <<ABS_FILE>>',
            'If Scenario == F08',
            `Read GIS Z Shape == ${conditionalMissing}`,
            'End If',
            `Read File == ${f.nested}`,
            'Read GIS Z Shape == assets/<<~s1~>>.shp',
            ''
        ].join('\n'));
        fs.writeFileSync(f.nested, [
            'Read GIS Z Shape == assets/nested-relative-unknown.shp',
            `Read GIS Z Shape == ${nestedMissing}`, ''
        ].join('\n'));
        try {
            await open(f.trd);
            await waitFor(() => missing(f.trd).some(message => message.includes('conditional-absolute-missing')),
                'Concrete conditional absolute paths must still be checked');
            assert.deepStrictEqual(missing(f.trd), [
                'File not found: <<ABS_FILE>>', `File not found: ${conditionalMissing}`
            ].sort());
            assert.deepStrictEqual(missing(f.nested), [`File not found: ${nestedMissing}`]);
            assert.ok(diagnostics(f.trd).filter(issue => issue.code === TPV_CODES.missingFile)
                .every(issue => issue.severity === vscode.DiagnosticSeverity.Error));
        } finally {
            await cleanup(f);
        }
    });

    test('distinct parent variables survive actual document close/reopen without an arbitrary parent', async () => {
        const f = makeFixture();
        const closedUris = new Set<string>();
        const closeListener = vscode.workspace.onDidCloseTextDocument(document => closedUris.add(document.uri.toString()));
        try {
            await open(f.a);
            const b = await open(f.b);
            await open(f.trd);
            await waitFor(() => missing(f.trd).some(message => message.includes('<<LOCAL_SHAPE>>')),
                'Parent B must retain its genuinely missing variable target');
            assertKnownParentMissing(f, true);
            assert.ok(diagnostics(f.a).some(issue => issue.code === TPV_CODES.childIssues && issue.message.includes('2 issue(s)')));
            assert.ok(diagnostics(f.b).some(issue => issue.code === TPV_CODES.childIssues && issue.message.includes('3 issue(s)')));

            // Rename to a non-control suffix to cause a real document-close
            // event. Closing a visible tab alone does not guarantee that event.
            const retired = vscode.Uri.file(f.b + '.retired');
            const rename = new vscode.WorkspaceEdit();
            rename.renameFile(b.uri, retired);
            assert.strictEqual(await vscode.workspace.applyEdit(rename), true);
            const retiredDocument = await vscode.workspace.openTextDocument(retired);
            await vscode.languages.setTextDocumentLanguage(retiredDocument, 'plaintext');
            await waitFor(() => closedUris.has(b.uri.toString()), 'A real parent TextDocument close event is required');
            assert.ok(b.isClosed);
            await waitFor(() => !missing(f.trd).some(message => message.includes('<<LOCAL_SHAPE>>')),
                'Closing B must retire B-only diagnostics while retaining A');
            assertKnownParentMissing(f);
            assert.deepStrictEqual(diagnostics(f.b), []);
            assert.ok(diagnostics(f.a).some(issue => issue.code === TPV_CODES.childIssues));

            fs.copyFileSync(retired.fsPath, f.b);
            await open(f.b);
            await waitFor(() => missing(f.trd).some(message => message.includes('<<LOCAL_SHAPE>>')),
                'Reopening B must restore its independent context');
            assertKnownParentMissing(f, true);
        } finally {
            closeListener.dispose();
            await cleanup(f);
        }
    });
});
