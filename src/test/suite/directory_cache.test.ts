import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { buildLatestCheckContext, checkReferencedFileLatestVersion, LatestCheckContext } from '../../versioning';
import { pathIdentity } from '../../io';

suite('D2 per-analysis directory inventory freshness', function () {
    this.timeout(15000);

    test('reuse a sibling directory within one pass, then refresh after a later sibling event', async () => {
        const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tpv-directory-cache-'));
        const runs = path.join(temp, 'runs');
        const model = path.join(temp, 'model');
        fs.mkdirSync(runs);
        fs.mkdirSync(model);
        const root = path.join(runs, 'Run_v01.tcf');
        const geom01 = path.join(model, 'geom_v01.tgc');
        const geom02 = path.join(model, 'geom_v02.tgc');
        const geom03 = path.join(model, 'geom_v03.tgc');
        fs.writeFileSync(root, 'Geometry Control File == ../model/geom_v01.tgc\n');
        fs.writeFileSync(geom01, '! original\n');
        fs.writeFileSync(geom02, '! newer\n');
        try {
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(root));
            const message = (context: LatestCheckContext): string => {
                const diagnostics: vscode.Diagnostic[] = [];
                checkReferencedFileLatestVersion(geom01, new vscode.Range(0, 0, 0, 10),
                    diagnostics, context);
                assert.strictEqual(diagnostics.length, 1);
                return diagnostics[0].message;
            };
            const pass1 = buildLatestCheckContext(doc);
            assert.ok(message(pass1).includes('latest 2'), 'initial sibling v02 must be latest');
            assert.strictEqual(pass1.directoryFilesByFolder?.size, 1);
            assert.ok(pass1.directoryFilesByFolder?.has(pathIdentity(model)));
            for (let i = 0; i < 20; i++) {
                assert.ok(message(pass1).includes('latest 2'));
                assert.strictEqual(pass1.directoryFilesByFolder?.size, 1,
                    'identical directory is reused, not repeatedly enumerated');
            }

            fs.writeFileSync(geom03, '! latest sibling created between analyses\n');
            assert.ok(message(pass1).includes('latest 2'),
                'directory is a stable per-pass snapshot only, never a persistent cache');
            const pass2 = buildLatestCheckContext(doc);
            assert.notStrictEqual(pass1.directoryFilesByFolder, pass2.directoryFilesByFolder);
            assert.ok(message(pass2).includes('latest 3'),
                'fresh analysis must observe newly created newer-version sibling');

            fs.unlinkSync(geom03);
            const pass3 = buildLatestCheckContext(doc);
            assert.ok(message(pass3).includes('latest 2'),
                'fresh analysis must not publish a deleted sibling as latest');
        } finally {
            // Use only the disposable fixture directory; no real model or
            // GeoPackage is inspected, modified or opened as a database.
            fs.rmSync(temp, { recursive: true, force: true, maxRetries: 12, retryDelay: 250 });
        }
    });
});
