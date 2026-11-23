import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { TPV_CODES } from '../../diagnosticCodes';

suite('Native Windows filesystem validation', function () {
    this.timeout(20000);

    test('resolves a backslash relative include using actual Windows files', async function () {
        if (process.platform !== 'win32') {
            this.skip();
        }

        const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'tuflow-validator-win-'));
        const modelDirectory = path.join(rootDirectory, 'model');
        const rootFile = path.join(rootDirectory, 'root.tcf');
        try {
            fs.mkdirSync(modelDirectory);
            fs.writeFileSync(path.join(modelDirectory, 'existing.tgc'), '! Existing control file\n');
            fs.writeFileSync(rootFile,
                'Geometry Control File == model\\existing.tgc\n' +
                'Read GIS Z Shape == missing.shp\n');

            await vscode.workspace.getConfiguration('tuflowValidator')
                .update('diagnosticLevel', 'hint', vscode.ConfigurationTarget.Global);
            const document = await vscode.workspace.openTextDocument(rootFile);
            await vscode.window.showTextDocument(document);

            const until = Date.now() + 8000;
            while (Date.now() < until) {
                const diagnostics = vscode.languages.getDiagnostics(document.uri);
                const missing = diagnostics.filter(item => (
                    (typeof item.code === 'object' ? item.code?.value : item.code) === TPV_CODES.missingFile
                ));
                if (missing.some(item => item.message.includes('missing.shp'))) {
                    assert.strictEqual(missing.length, 1,
                        'Only the deliberately absent file should produce a missing-file diagnostic');
                    assert.strictEqual(missing[0].range.start.line, 1);
                    return;
                }
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            assert.fail('Timed out waiting for native Windows filesystem diagnostics');
        } finally {
            fs.rmSync(rootDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        }
    });
});
