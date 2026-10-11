import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { TPV_CODES } from '../../diagnosticCodes';
import { applyStaticVariableDefinition, expandStaticVariables } from '../../staticVariables';

const BASE = path.resolve(__dirname, '../../../src/test/fixtures/static-variables');

suite('TUFLOW static variables', function () {
    this.timeout(15000);

    test('expands only known unconditional definitions', () => {
        const vars = new Map<string, string>();
        applyStaticVariableDefinition('Set Variable Base', 'data', false, vars);
        applyStaticVariableDefinition('Set Variable SubDir', '<<Base>>/terrain', false, vars);
        assert.strictEqual(expandStaticVariables('<<SubDir>>/existing.shp', vars), 'data/terrain/existing.shp');
        assert.strictEqual(expandStaticVariables('<<Unknown>>/missing.shp', vars), null);
        assert.strictEqual(expandStaticVariables('<<~s1~>>/missing.shp', vars), null);
        assert.strictEqual(expandStaticVariables('<<~e4~>>/missing.shp', vars), null);

        applyStaticVariableDefinition('Set Variable Base', 'maybe', true, vars);
        assert.strictEqual(expandStaticVariables('<<Base>>/missing.shp', vars), null);
    });

    test('rejects variable cycles without a filesystem error', () => {
        const vars = new Map([['A', '<<B>>'], ['B', '<<A>>']]);
        assert.strictEqual(expandStaticVariables('<<A>>/input.gpkg', vars), null);
    });

    test('revalidates a tracked missing dependency on creation and deletion', async () => {
        const root = path.join(BASE, 'watch-regression.tcf');
        const target = path.join(BASE, 'watch-created.gpkg');
        fs.rmSync(target, { force: true });
        fs.writeFileSync(root, 'Read GIS Z Shape == watch-created.gpkg\n');
        try {
            const document = await vscode.workspace.openTextDocument(root);
            await vscode.window.showTextDocument(document);
            const until = async (expected: boolean) => {
                const end = Date.now() + 8000;
                while (Date.now() < end) {
                    const diagnostics = vscode.languages.getDiagnostics(document.uri);
                    if (diagnostics.some(d => d.code === TPV_CODES.missingFile) === expected) {
                        return;
                    }
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
                assert.fail(`Expected missing-file diagnostic: ${expected}`);
            };
            await until(true);
            // Give dependency watchers time to reconcile before creating target.
            await new Promise(resolve => setTimeout(resolve, 900));
            fs.writeFileSync(target, '');
            await until(false);
            fs.rmSync(target);
            await until(true);
        } finally {
            fs.rmSync(root, { force: true });
            fs.rmSync(target, { force: true });
            await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        }
    });

    test('validates resolved paths without guessing runtime or unknown variables', async () => {
        const config = vscode.workspace.getConfiguration('tuflowValidator');
        await config.update('diagnosticLevel', 'hint', vscode.ConfigurationTarget.Global);
        await config.update('enableIfStatementChecks', true, vscode.ConfigurationTarget.Global);

        const doc = await vscode.workspace.openTextDocument(path.join(BASE, 'root.tcf'));
        await vscode.window.showTextDocument(doc);
        let diagnostics: vscode.Diagnostic[] = [];
        const until = Date.now() + 8000;
        while (Date.now() < until) {
            diagnostics = vscode.languages.getDiagnostics(doc.uri);
            if (diagnostics.some(d => d.code === TPV_CODES.missingFile)) {
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        const missing = diagnostics.filter(d => d.code === TPV_CODES.missingFile);
        assert.strictEqual(missing.length, 1, missing.map(d => d.message).join(', '));
        assert.ok(missing[0].message.includes('<<FullDir>>'));
        assert.ok(!diagnostics.some(d => d.message.includes('unresolvable')));
        assert.ok(!diagnostics.some(d => d.message.includes('not_a_missing_file')));
    });
});
