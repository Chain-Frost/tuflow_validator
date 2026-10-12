import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { TPV_CODES } from '../../diagnosticCodes';

const BASE = path.resolve(__dirname, '../../../src/test/fixtures/recursive-latest');

suite('Recursive latest-version dependencies', function () {
    this.timeout(15000);

    test('includes TRD files transitively referenced by the latest TCF', async () => {
        const config = vscode.workspace.getConfiguration('tuflowValidator');
        await config.update('diagnosticLevel', 'hint', vscode.ConfigurationTarget.Global);
        await config.update('enableLatestVersionChecks', true, vscode.ConfigurationTarget.Global);
        const root = await vscode.workspace.openTextDocument(path.join(BASE, 'runs', 'Run_v02.tcf'));
        await vscode.window.showTextDocument(root);
        const nestedUri = vscode.Uri.file(path.join(BASE, 'model', 'nested_v02.trd'));
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
            const issues = vscode.languages.getDiagnostics(nestedUri);
            if (issues.some(d => (typeof d.code === 'object' ? d.code.value : d.code) === TPV_CODES.outdatedVersion)) {
                assert.ok(!issues.some(d => d.code === TPV_CODES.missingFile));
                return;
            }
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        assert.fail('Expected outdated GIS layer warning in transitively referenced TRD');
    });
});
