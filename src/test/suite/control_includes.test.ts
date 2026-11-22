import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { TPV_CODES } from '../../diagnosticCodes';
import { resolvePath } from '../../pathParsing';

const FIXTURES = path.resolve(__dirname, '../../../src/test/fixtures/control-includes');

suite('Documented control-text include traversal', function () {
    this.timeout(20000);

    suiteSetup(async () => {
        const config = vscode.workspace.getConfiguration('tuflowValidator');
        await config.update('diagnosticLevel', 'hint', vscode.ConfigurationTarget.Global);
        await config.update('enableLatestVersionChecks', true, vscode.ConfigurationTarget.Global);
        await config.update('enableIfStatementChecks', true, vscode.ConfigurationTarget.Global);
    });

    test('validates present/missing AD control, AD databases and SWMM inputs', async () => {
        const root = await openRoot();
        const rootIssues = await waitFor(root.uri, items =>
            items.some(issue => issue.code === TPV_CODES.missingFile &&
                issue.message.includes('missing.adcf'))
        );
        const adcfUri = fixtureUri('model/ad.adcf');
        const adcfIssues = await waitFor(adcfUri, items =>
            items.filter(issue => issue.code === TPV_CODES.missingFile).length >= 2
        );
        const swmmIssues = await waitFor(fixtureUri('model/swmm.tscf'), items =>
            items.some(issue => issue.code === TPV_CODES.missingFile &&
                issue.message.includes('missing-network.inp'))
        );

        // Every documented command has an existing operand and a missing one.
        assert.strictEqual(rootIssues.filter(issue =>
            issue.code === TPV_CODES.missingFile && issue.message.includes('missing.adcf')).length, 1);
        assert.strictEqual(adcfIssues.filter(issue =>
            issue.code === TPV_CODES.missingFile && issue.message.includes('missing-ad-bc.csv')).length, 1);
        assert.strictEqual(adcfIssues.filter(issue =>
            issue.code === TPV_CODES.missingFile && issue.message.includes('missing-ad-global.csv')).length, 1);
        assert.strictEqual(swmmIssues.filter(issue =>
            issue.code === TPV_CODES.missingFile && issue.message.includes('missing-network.inp')).length, 1);
        for (const token of ['ad_bc.csv', 'ad_global.csv', 'network_a.inp', 'network_b.inp']) {
            assert.ok(![...rootIssues, ...adcfIssues, ...swmmIssues].some(issue =>
                issue.code === TPV_CODES.missingFile && issue.message.includes(token)), token);
        }
        assert.ok(rootIssues.some(issue => issue.code === TPV_CODES.childIssues &&
            issue.message.includes('ad.adcf')));
        assert.ok(rootIssues.some(issue => issue.code === TPV_CODES.childIssues &&
            issue.message.includes('swmm.tscf')));
    });

    test('walks nested .erd/.rdf/custom Read File text, handles cycles and latest graph', async () => {
        const root = await openRoot();
        await waitFor(root.uri, items =>
            items.filter(issue => issue.code === TPV_CODES.childIssues).length >= 4
        );
        for (const [name, expected] of [
            ['runs/parts.erd', 'missing-erd.shp'],
            ['runs/parts.rdf', 'missing-rdf.shp'],
            ['runs/grandchild.odd', 'nested-missing.shp']
        ]) {
            const issues = await waitFor(fixtureUri(name), items =>
                items.some(issue => issue.code === TPV_CODES.missingFile &&
                    issue.message.includes(expected))
            );
            assert.strictEqual(issues.filter(issue =>
                issue.code === TPV_CODES.missingFile &&
                issue.message.includes(expected)).length, 1, name);
        }
        const nested = vscode.languages.getDiagnostics(fixtureUri('runs/grandchild.odd'));
        assert.ok(nested.some(issue => (
            typeof issue.code === 'object' ? issue.code.value : issue.code
        ) === TPV_CODES.outdatedVersion && issue.message.includes('geometry_v01.gpkg')),
        'An arbitrary-suffix nested Read File must participate in latest-reference discovery');
        assert.ok(!vscode.languages.getDiagnostics(fixtureUri('runs/parts.rdf')).some(issue =>
            issue.message.includes('ignored-rdf.shp')));
    });

    test('does not parse GIS, CSV or SWMM data and keeps numeric/unknown/output negatives', async () => {
        const root = await openRoot();
        const diagnostics = await waitFor(root.uri, items =>
            items.some(issue => issue.code === TPV_CODES.missingFile &&
                issue.message.includes('missing-conditional.shp'))
        );
        assert.ok(!diagnostics.some(issue => issue.message.includes('0.2, 0.1')));
        assert.ok(!diagnostics.some(issue => issue.message.includes('Some Unknown Command')));
        assert.ok(!diagnostics.some(issue => issue.message.includes('no-such-file.dat')));
        assert.ok(!diagnostics.some(issue => issue.message.includes('not-created')));
        assert.ok(!diagnostics.some(issue => issue.message.includes('runtime-unknown.shp')));
        assert.strictEqual(diagnostics.filter(issue =>
            issue.code === TPV_CODES.missingFile &&
            issue.message.includes('missing-conditional.shp')).length, 1);
        for (const dataFile of [
            'model/ad_bc.csv',
            'model/ad_global.csv',
            'model/network_a.inp',
            'model/network_b.inp',
            'model/misleading.tgc',
            'model/misleading.erd'
        ]) {
            assert.ok(!vscode.languages.getDiagnostics(fixtureUri(dataFile)).some(issue =>
                issue.message.includes('sentinel-missing')), dataFile);
        }
        // The two GIS data targets have control-like suffixes but must not
        // produce child summary diagnostics at their reference lines.
        assert.ok(!diagnostics.some(issue =>
            issue.code === TPV_CODES.childIssues &&
            [8, 9].includes(issue.range.start.line)));
    });

    test('mocked Windows drive and UNC paths remain absolute (no real network access)', () => {
        // Path-library regression only. This is not a native UNC share test.
        assert.strictEqual(resolvePath('/tmp/root', 'C:\\models\\controls.trd'),
            'C:/models/controls.trd');
        assert.strictEqual(resolvePath('/tmp/root', '\\\\server\\share\\controls.erd'),
            '//server/share/controls.erd');
    });

    test('dirty plaintext Read File snapshot updates parent and child diagnostics', async () => {
        const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'tpv-includes-'));
        const rootPath = path.join(folder, 'root.tcf');
        const childPath = path.join(folder, 'child.customtext');
        fs.writeFileSync(rootPath, 'Read File == child.customtext\n');
        fs.writeFileSync(childPath, 'Read GIS BC == old-missing.shp\n');

        let child: vscode.TextDocument | undefined;
        try {
            const root = await vscode.workspace.openTextDocument(rootPath);
            await vscode.window.showTextDocument(root);
            const childUri = vscode.Uri.file(childPath);
            await waitFor(childUri, items => items.some(issue =>
                issue.code === TPV_CODES.missingFile && issue.message.includes('old-missing.shp')));
            child = await vscode.workspace.openTextDocument(childPath);
            assert.strictEqual(child.languageId, 'plaintext');
            await vscode.window.showTextDocument(child);
            const edit = new vscode.WorkspaceEdit();
            edit.replace(child.uri, new vscode.Range(child.positionAt(0), child.positionAt(child.getText().length)),
                'Read GIS BC == new-missing.shp\n');
            assert.strictEqual(await vscode.workspace.applyEdit(edit), true);
            const changed = await waitFor(child.uri, items => items.some(issue =>
                issue.code === TPV_CODES.missingFile && issue.message.includes('new-missing.shp')));
            assert.ok(!changed.some(issue => issue.message.includes('old-missing.shp')));
            assert.ok(child.isDirty, 'The parent must revalidate without saving the child');
            assert.ok(vscode.languages.getDiagnostics(root.uri).some(issue =>
                issue.code === TPV_CODES.childIssues));
        } finally {
            if (child?.isDirty) {
                await child.save();
            }
            await vscode.commands.executeCommand('workbench.action.closeAllEditors');
            fs.rmSync(folder, { recursive: true, force: true });
        }
    });
});

async function openRoot(): Promise<vscode.TextDocument> {
    const document = await vscode.workspace.openTextDocument(path.join(FIXTURES, 'runs/Root_v02.tcf'));
    await vscode.window.showTextDocument(document);
    return document;
}

function fixtureUri(relative: string): vscode.Uri {
    return vscode.Uri.file(path.join(FIXTURES, relative));
}

async function waitFor(
    uri: vscode.Uri,
    predicate: (diagnostics: vscode.Diagnostic[]) => boolean
): Promise<vscode.Diagnostic[]> {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
        const diagnostics = vscode.languages.getDiagnostics(uri);
        if (predicate(diagnostics)) {
            return diagnostics;
        }
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.fail(`Timed out waiting for diagnostics: ${uri.fsPath}`);
}
