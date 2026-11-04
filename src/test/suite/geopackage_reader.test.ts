import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { createGeoPackageInventoryPass, disposeGeoPackageInventory, getGeoPackageInventoryStats, inspectGeoPackage, invalidateGeoPackage, resetGeoPackageInventoryStats } from '../../geopackageInventory';
import { InventoryResult, readGeoPackageSnapshot } from '../../geopackageReader';
import { createGeoPackage, executeGeoPackageSql, fixturePython } from '../helpers/gpkgFixtures';

suite('Read-only GeoPackage catalog inspection', function () {
    this.timeout(20000);
    let directory: string;
    let database: string;

    setup(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tpv-gpkg-reader-'));
        database = path.join(directory, 'model.gpkg');
    });

    teardown(() => {
        invalidateGeoPackage(database);
        fs.rmSync(directory, { recursive: true, force: true });
    });

    suiteTeardown(() => disposeGeoPackageInventory());

    test('reads genuine vector and raster inventories without reading data rows', () => {
        createGeoPackage(database, ['lines', { name: 'image', type: 'tiles' }, { name: 'dem', type: '2d-gridded-coverage' }, { name: 'notes', type: 'attributes' }]);
        const before = fs.readFileSync(database);
        const beforeFiles = fs.readdirSync(directory);
        const result = readGeoPackageSnapshot(database);
        assertLayers(result.result, ['lines', 'image', 'dem']);
        assert.ok(result.metrics.pagesRead > 0);
        assert.ok(result.metrics.bytesRead < before.length);
        assert.deepStrictEqual(fs.readFileSync(database), before, 'Inspection must not modify the database');
        assert.deepStrictEqual(fs.readdirSync(directory), beforeFiles, 'Inspection must not create journals or sidecars');
    });

    test('metadata read cost does not grow with payload size', () => {
        createGeoPackage(database, ['terrain']);
        const small = readGeoPackageSnapshot(database);
        createGeoPackage(database, ['terrain'], { paddingBytes: 8 * 1024 * 1024 });
        const large = readGeoPackageSnapshot(database);
        assertLayers(large.result, ['terrain']);
        assert.ok(fs.statSync(database).size > 8 * 1024 * 1024);
        assert.ok(large.metrics.bytesRead < 65536, `${large.metrics.bytesRead} bytes were read`);
        assert.ok(large.metrics.bytesRead <= small.metrics.bytesRead + 8192);
    });

    test('handles multi-page catalogs, record overflow, quoted names and UTF-16', () => {
        const names: string[] = [];
        for (let index = 0; index < 80; index++) {
            names.push(`contour_${index}`);
        }
        names.push('contours "quoted"', 'ระดับน้ำ');
        for (const encoding of ['UTF-8', 'UTF-16le', 'UTF-16be'] as const) {
            createGeoPackage(database, names, { pageSize: 512, encoding, descriptionBytes: 2000 });
            const result = readGeoPackageSnapshot(database);
            assertLayers(result.result, names);
            assert.ok(result.metrics.pagesRead > 20);
        }
    });

    test('supports SQLite 65536-byte pages', () => {
        createGeoPackage(database, ['terrain'], { pageSize: 65536 });
        assertLayers(readGeoPackageSnapshot(database).result, ['terrain']);
    });

    test('finds required catalog columns when their order differs', () => {
        createGeoPackage(database, ['lines'], { extraSql: `
            ALTER TABLE gpkg_contents RENAME TO old_contents;
            CREATE TABLE gpkg_contents ("description" TEXT, [data_type] TEXT, \`table_name\` TEXT PRIMARY KEY);
            INSERT INTO gpkg_contents SELECT description, data_type, table_name FROM old_contents;
            DROP TABLE old_contents;
        ` });
        assertLayers(readGeoPackageSnapshot(database).result, ['lines']);
    });

    test('reports empty, invalid and unreadable databases distinctly', () => {
        assertUnavailable(readGeoPackageSnapshot(database).result, 'unreadable');
        assert.strictEqual(fs.existsSync(database), false, 'Missing databases must never be created');
        fs.writeFileSync(database, 'not a GeoPackage');
        assertUnavailable(readGeoPackageSnapshot(database).result, 'invalid');
        createGeoPackage(database, []);
        assertUnavailable(readGeoPackageSnapshot(database).result, 'empty');
        createGeoPackage(database, [{ name: 'notes', type: 'attributes' }]);
        assertUnavailable(readGeoPackageSnapshot(database).result, 'empty');
        createGeoPackage(database, ['terrain'], { extraSql: 'DROP TABLE gpkg_contents;' });
        assertUnavailable(readGeoPackageSnapshot(database).result, 'invalid');
        createGeoPackage(database, ['terrain'], { extraSql: 'PRAGMA application_id=0;' });
        assertUnavailable(readGeoPackageSnapshot(database).result, 'invalid');
    });

    test('does not accept stale catalog entries or unregistered ordinary tables', () => {
        createGeoPackage(database, ['terrain'], { extraSql: 'DROP TABLE terrain;' });
        assertUnavailable(readGeoPackageSnapshot(database).result, 'invalid');
        createGeoPackage(database, ['terrain'], { extraSql: 'DELETE FROM gpkg_geometry_columns;' });
        assertUnavailable(readGeoPackageSnapshot(database).result, 'invalid');
        createGeoPackage(database, [], { extraSql: 'CREATE TABLE terrain(id INTEGER PRIMARY KEY);' });
        assertUnavailable(readGeoPackageSnapshot(database).result, 'empty');
    });

    test('rejects corrupt feature-table root pages without reading feature pages', () => {
        for (const rootPage of [0, 1, 999999]) {
            createGeoPackage(database, ['terrain']);
            // Deliberate test-only corruption of a genuine SQLite schema.
            executeGeoPackageSql(database, `
                PRAGMA writable_schema=ON;
                UPDATE sqlite_schema SET rootpage=${rootPage} WHERE name='terrain';
                PRAGMA writable_schema=OFF;
            `);
            assertUnavailable(readGeoPackageSnapshot(database).result, 'invalid');
        }
    });

    test('declines unsupported catalog layouts instead of returning an incomplete inventory', () => {
        createGeoPackage(database, ['lines'], { extraSql: `
            ALTER TABLE gpkg_contents RENAME TO old_contents;
            CREATE TABLE gpkg_contents (table_name TEXT PRIMARY KEY, data_type TEXT) WITHOUT ROWID;
            INSERT INTO gpkg_contents SELECT table_name, data_type FROM old_contents;
            DROP TABLE old_contents;
        ` });
        assertUnavailable(readGeoPackageSnapshot(database).result, 'unsupported');
        createGeoPackage(database, ['lines'], { extraSql: "UPDATE gpkg_contents SET data_type='vendor_specific';" });
        assertUnavailable(readGeoPackageSnapshot(database).result, 'unsupported');
        createGeoPackage(database, ['lines'], { extraSql: 'DROP TABLE lines; CREATE VIEW lines AS SELECT 1 AS fid, NULL AS geom;' });
        assertUnavailable(readGeoPackageSnapshot(database).result, 'unsupported');
    });

    test('declines WAL-mode and live journal databases without side effects', () => {
        createGeoPackage(database, ['terrain']);
        executeGeoPackageSql(database, 'PRAGMA journal_mode=WAL;');
        const original = fs.readFileSync(database);
        assertUnavailable(readGeoPackageSnapshot(database).result, 'busy');
        assert.deepStrictEqual(fs.readFileSync(database), original);
        assert.deepStrictEqual(fs.readdirSync(directory), ['model.gpkg']);
        createGeoPackage(database, ['terrain']);
        for (const suffix of ['-wal', '-journal', '-shm']) {
            fs.writeFileSync(database + suffix, 'a busy or unrecovered SQLite sidecar');
            const sidecar = fs.readFileSync(database + suffix);
            assertUnavailable(readGeoPackageSnapshot(database).result, 'busy');
            assert.deepStrictEqual(fs.readFileSync(database + suffix), sidecar);
            fs.unlinkSync(database + suffix);
        }
        assertLayers(readGeoPackageSnapshot(database).result, ['terrain']);
    });

    test('bounds corrupt catalog traversal and oversized metadata', () => {
        createGeoPackage(database, ['terrain'], { descriptionBytes: 4096 });
        assertUnavailable(readGeoPackageSnapshot(database, undefined, { maxRecordBytes: 1024 }).result, 'limit');
        assertUnavailable(readGeoPackageSnapshot(database, undefined, { maxBytes: 512 }).result, 'limit');
        assertUnavailable(readGeoPackageSnapshot(database, undefined, { maxRows: 1 }).result, 'limit');
        const descriptor = fs.openSync(database, 'r+');
        try {
            // A leaf cell pointer cannot point into the SQLite file header.
            const pointer = Buffer.alloc(2);
            pointer.writeUInt16BE(10);
            fs.writeSync(descriptor, pointer, 0, pointer.length, 108);
        } finally {
            fs.closeSync(descriptor);
        }
        assertUnavailable(readGeoPackageSnapshot(database).result, 'invalid');
    });

    test('leaves a genuinely locked SQLite transaction unchecked and unchanged', async () => {
        createGeoPackage(database, ['terrain']);
        const original = fs.readFileSync(database);
        const editor = spawn(fixturePython(), ['-c', `
import sqlite3, sys
db = sqlite3.connect(sys.argv[1])
db.execute('BEGIN EXCLUSIVE')
db.execute("UPDATE gpkg_contents SET description='pending edit'")
print('locked', flush=True)
sys.stdin.read(1)
db.rollback()
db.close()
`, database], { stdio: ['pipe', 'pipe', 'pipe'] });
        const exited = new Promise<void>((resolve, reject) => {
            editor.once('exit', code => code === 0 ? resolve() : reject(new Error(`SQLite editor exited with code ${code}`)));
            editor.once('error', reject);
        });
        try {
            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Timed out starting the SQLite transaction')), 3000);
                editor.stdout.once('data', data => {
                    clearTimeout(timeout);
                    if (data.toString().includes('locked')) {
                        resolve();
                    } else {
                        reject(new Error(`Unexpected SQLite editor response: ${data}`));
                    }
                });
                editor.once('error', error => { clearTimeout(timeout); reject(error); });
            });
            assertUnavailable(await inspectGeoPackage(database), 'busy');
            assert.deepStrictEqual(fs.readFileSync(database), original);
        } finally {
            editor.stdin.end('\n');
            await exited;
        }
        invalidateGeoPackage(database);
        assertLayers(await inspectGeoPackage(database), ['terrain']);
        assert.deepStrictEqual(fs.readFileSync(database), original);
    });

    test('deduplicates a thousand references and reuses verified inventories across passes', async () => {
        createGeoPackage(database, ['terrain']);
        invalidateGeoPackage();
        resetGeoPackageInventoryStats();
        const pass = createGeoPackageInventoryPass();
        const results: Array<Promise<InventoryResult>> = [];
        for (let index = 0; index < 1000; index++) {
            results.push(pass(database));
        }
        for (const result of await Promise.all(results)) {
            assertLayers(result, ['terrain']);
        }
        let stats = getGeoPackageInventoryStats();
        assert.strictEqual(stats.metadataReads, 1);
        assert.strictEqual(stats.workerRequests, 1);
        assert.strictEqual(stats.fileOpens, 1);
        assertLayers(await createGeoPackageInventoryPass()(database), ['terrain']);
        stats = getGeoPackageInventoryStats();
        assert.strictEqual(stats.metadataReads, 1);
        assert.strictEqual(stats.cacheHits, 1);
        assert.ok(stats.peakWorkers <= 2);
    });

    test('invalidates on changed header/content, explicit disk events and sidecars', async () => {
        createGeoPackage(database, ['terrain']);
        assertLayers(await inspectGeoPackage(database), ['terrain']);
        executeGeoPackageSql(database, `
            ALTER TABLE terrain RENAME TO contours;
            UPDATE gpkg_contents SET table_name='contours', identifier='contours' WHERE table_name='terrain';
            UPDATE gpkg_geometry_columns SET table_name='contours' WHERE table_name='terrain';
        `);
        assertLayers(await inspectGeoPackage(database), ['contours']);
        fs.writeFileSync(database + '-wal', 'pending changes');
        assertUnavailable(await inspectGeoPackage(database), 'busy');
        fs.unlinkSync(database + '-wal');
        invalidateGeoPackage(database + '-wal');
        assertLayers(await inspectGeoPackage(database), ['contours']);
        invalidateGeoPackage(database);
        const before = getGeoPackageInventoryStats().metadataReads;
        assertLayers(await inspectGeoPackage(database), ['contours']);
        assert.strictEqual(getGeoPackageInventoryStats().metadataReads, before + 1);
    });

    test('discarded in-flight results cannot republish an invalidated inventory', async () => {
        createGeoPackage(database, ['terrain']);
        const pending = inspectGeoPackage(database);
        invalidateGeoPackage(database);
        assertUnavailable(await pending, 'changed');
        assertLayers(await inspectGeoPackage(database), ['terrain']);
    });
});

function assertLayers(result: InventoryResult, expected: string[]): void {
    assert.strictEqual(result.status, 'ok', JSON.stringify(result));
    if (result.status === 'ok') {
        assert.deepStrictEqual([...result.layers].sort(), [...expected].sort());
    }
}

function assertUnavailable(result: InventoryResult, expected: string): void {
    assert.strictEqual(result.status, 'unavailable', JSON.stringify(result));
    if (result.status === 'unavailable') {
        assert.strictEqual(result.reasonCode, expected, result.reason);
        assert.ok(result.reason.length > 0);
    }
}
