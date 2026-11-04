import { execFileSync } from 'child_process';

export interface FixtureLayer {
    name: string;
    type?: 'features' | 'tiles' | '2d-gridded-coverage' | 'attributes';
}

export interface FixtureOptions {
    pageSize?: number;
    encoding?: 'UTF-8' | 'UTF-16le' | 'UTF-16be';
    descriptionBytes?: number;
    extraSql?: string;
    paddingBytes?: number;
}

/** Python is a development/test dependency only; the extension never invokes it. */
export function fixturePython(): string {
    return process.env.TPV_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
}

export function createGeoPackage(filePath: string, layers: Array<string | FixtureLayer>, options: FixtureOptions = {}): void {
    execFileSync(fixturePython(), ['-X', 'utf8', '-c', CREATE_GPKG], {
        input: JSON.stringify({ filePath, layers, options }), encoding: 'utf8', timeout: 15000
    });
}

export function executeGeoPackageSql(filePath: string, sql: string): void {
    execFileSync(fixturePython(), ['-X', 'utf8', '-c', MODIFY_GPKG], {
        input: JSON.stringify({ filePath, sql }), encoding: 'utf8', timeout: 15000
    });
}

const MODIFY_GPKG = `
import json, sqlite3, sys
request = json.load(sys.stdin)
with sqlite3.connect(request['filePath']) as db:
    db.executescript(request['sql'])
`;

const CREATE_GPKG = `
import json, sqlite3, sys
from pathlib import Path

request = json.load(sys.stdin)
target = Path(request['filePath'])
options = request['options']
target.parent.mkdir(parents=True, exist_ok=True)
target.unlink(missing_ok=True)

def identifier(value):
    return '"' + value.replace('"', '""') + '"'

with sqlite3.connect(target) as db:
    db.execute('PRAGMA page_size=' + str(options.get('pageSize', 4096)))
    encoding = options.get('encoding', 'UTF-8')
    if encoding not in ('UTF-8', 'UTF-16le', 'UTF-16be'):
        raise ValueError('Unsupported test encoding')
    db.execute("PRAGMA encoding='" + encoding + "'")
    db.executescript('''
        PRAGMA application_id=1196444487;
        PRAGMA user_version=10300;
        CREATE TABLE gpkg_spatial_ref_sys (
            srs_name TEXT NOT NULL, srs_id INTEGER NOT NULL PRIMARY KEY,
            organization TEXT NOT NULL, organization_coordsys_id INTEGER NOT NULL,
            definition TEXT NOT NULL, description TEXT
        );
        INSERT INTO gpkg_spatial_ref_sys VALUES ('Undefined Cartesian', -1, 'NONE', -1, 'undefined', 'undefined Cartesian coordinate reference system');
        INSERT INTO gpkg_spatial_ref_sys VALUES ('Undefined Geographic', 0, 'NONE', 0, 'undefined', 'undefined geographic coordinate reference system');
        INSERT INTO gpkg_spatial_ref_sys VALUES ('WGS 84', 4326, 'EPSG', 4326, 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]', 'longitude/latitude coordinates in decimal degrees on the WGS 84 spheroid');
        CREATE TABLE gpkg_contents (
            table_name TEXT NOT NULL PRIMARY KEY, data_type TEXT NOT NULL,
            identifier TEXT UNIQUE, description TEXT DEFAULT '',
            last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            min_x DOUBLE, min_y DOUBLE, max_x DOUBLE, max_y DOUBLE, srs_id INTEGER,
            CONSTRAINT fk_gc_r_srs_id FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id)
        );
        CREATE TABLE gpkg_geometry_columns (
            table_name TEXT NOT NULL, column_name TEXT NOT NULL,
            geometry_type_name TEXT NOT NULL, srs_id INTEGER NOT NULL,
            z TINYINT NOT NULL, m TINYINT NOT NULL,
            CONSTRAINT pk_geom_cols PRIMARY KEY (table_name, column_name),
            CONSTRAINT uk_gc_table_name UNIQUE (table_name),
            CONSTRAINT fk_gc_tn FOREIGN KEY (table_name) REFERENCES gpkg_contents(table_name),
            CONSTRAINT fk_gc_srs FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id)
        );
        CREATE TABLE gpkg_tile_matrix_set (
            table_name TEXT NOT NULL PRIMARY KEY, srs_id INTEGER NOT NULL,
            min_x DOUBLE NOT NULL, min_y DOUBLE NOT NULL, max_x DOUBLE NOT NULL, max_y DOUBLE NOT NULL,
            CONSTRAINT fk_gtms_table_name FOREIGN KEY (table_name) REFERENCES gpkg_contents(table_name),
            CONSTRAINT fk_gtms_srs FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id)
        );
        CREATE TABLE gpkg_tile_matrix (
            table_name TEXT NOT NULL, zoom_level INTEGER NOT NULL,
            matrix_width INTEGER NOT NULL, matrix_height INTEGER NOT NULL,
            tile_width INTEGER NOT NULL, tile_height INTEGER NOT NULL,
            pixel_x_size DOUBLE NOT NULL, pixel_y_size DOUBLE NOT NULL,
            CONSTRAINT pk_ttm PRIMARY KEY (table_name, zoom_level),
            CONSTRAINT fk_tmm_table_name FOREIGN KEY (table_name) REFERENCES gpkg_contents(table_name)
        );
    ''')
    for item in request['layers']:
        layer = {'name': item, 'type': 'features'} if isinstance(item, str) else item
        name = layer['name']
        kind = layer.get('type', 'features')
        if kind == 'features':
            db.execute('CREATE TABLE ' + identifier(name) + '(fid INTEGER PRIMARY KEY, geom GEOMETRY)')
            db.execute('INSERT INTO gpkg_geometry_columns VALUES (?, ?, ?, ?, ?, ?)', (name, 'geom', 'GEOMETRY', 4326, 0, 0))
        elif kind in ('tiles', '2d-gridded-coverage'):
            db.execute('CREATE TABLE ' + identifier(name) + '(id INTEGER PRIMARY KEY, zoom_level INTEGER NOT NULL, tile_column INTEGER NOT NULL, tile_row INTEGER NOT NULL, tile_data BLOB NOT NULL, UNIQUE (zoom_level, tile_column, tile_row))')
            db.execute('INSERT INTO gpkg_tile_matrix_set VALUES (?, 4326, -180, -90, 180, 90)', (name,))
            db.execute('INSERT INTO gpkg_tile_matrix VALUES (?, 0, 1, 1, 256, 256, 1.40625, 0.703125)', (name,))
        elif kind == 'attributes':
            db.execute('CREATE TABLE ' + identifier(name) + '(id INTEGER PRIMARY KEY, value TEXT)')
        else:
            raise ValueError('Unsupported test layer type')
        db.execute('INSERT INTO gpkg_contents (table_name, data_type, identifier, description, srs_id) VALUES (?, ?, ?, ?, ?)', (name, kind, name, 'x' * options.get('descriptionBytes', 0), 4326 if kind != 'attributes' else None))
    padding = options.get('paddingBytes', 0)
    if padding:
        db.execute('CREATE TABLE benchmark_payload (id INTEGER PRIMARY KEY, value BLOB)')
        db.execute("INSERT INTO gpkg_contents(table_name, data_type, identifier) VALUES ('benchmark_payload', 'attributes', 'benchmark_payload')")
        db.execute('INSERT INTO benchmark_payload(value) VALUES (zeroblob(?))', (padding,))
    if options.get('extraSql'):
        db.executescript(options['extraSql'])
`;
