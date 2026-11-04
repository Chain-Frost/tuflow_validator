import * as fs from 'fs';
import { TextDecoder } from 'util';

export type InventoryUnavailableReason =
    'invalid' | 'unreadable' | 'busy' | 'unsupported' | 'empty' | 'changed' |
    'limit' | 'timeout' | 'cancelled';

export type InventoryResult =
    { status: 'ok'; layers: string[] } |
    { status: 'unavailable'; reason: string; reasonCode: InventoryUnavailableReason };

export interface GeoPackageReadMetrics {
    fileOpens: number;
    bytesRead: number;
    pagesRead: number;
    metadataReads: number;
    cacheHits: number;
}

export interface GeoPackageSnapshot {
    fingerprint?: string;
    result: InventoryResult;
}

export interface GeoPackageReadResult extends GeoPackageSnapshot {
    metrics: GeoPackageReadMetrics;
}

export interface GeoPackageReadLimits {
    maxBytes: number;
    maxPages: number;
    maxRows: number;
    maxRecordBytes: number;
    maxLayers: number;
    timeoutMs: number;
}

export const GEOPACKAGE_READ_LIMITS: Readonly<GeoPackageReadLimits> = {
    maxBytes: 16 * 1024 * 1024,
    maxPages: 4096,
    maxRows: 100000,
    maxRecordBytes: 1024 * 1024,
    maxLayers: 20000,
    timeoutMs: 4000
};

/** SQLite identifiers fold ASCII letters, without guessing Unicode equivalence. */
export function foldGeoPackageName(name: string): string {
    return name.replace(/[A-Z]/g, character => character.toLowerCase());
}

class InspectionError extends Error {
    constructor(readonly reasonCode: InventoryUnavailableReason, message: string) {
        super(message);
    }
}

type SqlValue = string | number | bigint | Buffer | null;

interface SchemaTable {
    name: string;
    rootPage: number;
    sql: string;
}

/**
 * A bounded reader for the documented SQLite table b-tree/record format.
 * It deliberately does not execute SQL or visit feature, tile or index pages.
 * Unsupported catalog layouts are reported as unchecked, never as empty.
 *
 * Format references: https://www.sqlite.org/fileformat.html and
 * https://www.geopackage.org/spec140/index.html#_table_definition_sql
 */
class CatalogReader {
    private readonly pageSize: number;
    private readonly usableSize: number;
    private readonly pageCount: number;
    private readonly textDecoder: TextDecoder;
    private readonly pages = new Map<number, Buffer>();
    private readonly deadline: number;
    private rowCount = 0;

    constructor(
        private readonly descriptor: number,
        header: Buffer,
        fileSize: number,
        private readonly limits: GeoPackageReadLimits,
        private readonly metrics: GeoPackageReadMetrics
    ) {
        if (header.toString('ascii', 0, 16) !== 'SQLite format 3\0') {
            throw new InspectionError('invalid', 'The file is not an SQLite GeoPackage.');
        }
        const applicationId = header.toString('ascii', 68, 72);
        if (!['GPKG', 'GP10', 'GP11'].includes(applicationId)) {
            throw new InspectionError('invalid', 'The SQLite application ID does not identify a GeoPackage.');
        }
        if (header[18] === 2 || header[19] === 2) {
            throw new InspectionError('busy', 'WAL-mode GeoPackage is not checked; its current catalog may reside in the write-ahead log.');
        }
        if (header[18] !== 1 || header[19] !== 1) {
            throw new InspectionError('unsupported', 'The SQLite file format version is not supported.');
        }
        const storedPageSize = header.readUInt16BE(16);
        this.pageSize = storedPageSize === 1 ? 65536 : storedPageSize;
        if (this.pageSize < 512 || this.pageSize > 65536 || (this.pageSize & (this.pageSize - 1)) !== 0) {
            throw new InspectionError('invalid', 'Invalid SQLite page size.');
        }
        this.usableSize = this.pageSize - header[20];
        if (this.usableSize < 480 || header[21] !== 64 || header[22] !== 32 || header[23] !== 32) {
            throw new InspectionError('invalid', 'Invalid SQLite page format.');
        }
        if (fileSize < this.pageSize || fileSize % this.pageSize !== 0) {
            throw new InspectionError('invalid', 'The GeoPackage is truncated or has an invalid file size.');
        }
        const physicalPageCount = fileSize / this.pageSize;
        const storedPageCount = header.readUInt32BE(28);
        const storedPageCountIsValid = storedPageCount !== 0 && header.readUInt32BE(24) === header.readUInt32BE(92);
        if (storedPageCountIsValid && storedPageCount > physicalPageCount) {
            throw new InspectionError('invalid', 'The GeoPackage header refers to pages beyond the end of the file.');
        }
        this.pageCount = storedPageCountIsValid ? storedPageCount : physicalPageCount;
        const schemaVersion = header.readUInt32BE(44);
        if (schemaVersion < 1 || schemaVersion > 4) {
            throw new InspectionError('unsupported', 'The SQLite schema format is not supported.');
        }
        const encoding = header.readUInt32BE(56);
        if (encoding < 1 || encoding > 3) {
            throw new InspectionError('unsupported', 'The SQLite text encoding is not supported.');
        }
        this.textDecoder = new TextDecoder(encoding === 1 ? 'utf-8' : encoding === 2 ? 'utf-16le' : 'utf-16be', { fatal: true });
        this.deadline = Date.now() + limits.timeoutMs;
    }

    inventory(): string[] {
        const tables = new Map<string, SchemaTable>();
        const unsupportedTables = new Set<string>();
        const roots = new Set<number>();
        for (const row of this.tableRows(1)) {
            if (row.length < 5 || typeof row[0] !== 'string' || typeof row[1] !== 'string') {
                throw new InspectionError('invalid', 'Invalid SQLite schema catalog record.');
            }
            if (row[0] === 'view') {
                unsupportedTables.add(foldGeoPackageName(row[1]));
                continue;
            }
            if (row[0] !== 'table') {
                continue;
            }
            if (typeof row[4] === 'string' && /^CREATE\s+VIRTUAL\s+TABLE\b/i.test(row[4]) && (row[3] === 0 || row[3] === null)) {
                // Virtual tables are not ordinary feature tables. Keep them out
                // of the inventory rather than attempting to execute modules.
                unsupportedTables.add(foldGeoPackageName(row[1]));
                continue;
            }
            if (
                typeof row[3] !== 'number' || !Number.isInteger(row[3]) ||
                row[3] <= 1 || row[3] > this.pageCount || typeof row[4] !== 'string'
            ) {
                // Feature pages are never traversed, but their catalog root
                // must still refer to an ordinary table inside this database.
                throw new InspectionError('invalid', 'SQLite schema contains an invalid table root page.');
            }
            const key = foldGeoPackageName(row[1]);
            if (tables.has(key) || roots.has(row[3])) {
                throw new InspectionError('invalid', 'Duplicate table names or root pages in the SQLite catalog.');
            }
            roots.add(row[3]);
            tables.set(key, { name: row[1], rootPage: row[3], sql: row[4] });
        }
        const contents = tables.get('gpkg_contents');
        if (!contents) {
            throw new InspectionError('invalid', 'GeoPackage has no readable gpkg_contents catalog.');
        }
        const contentRows = this.catalogRows(contents, ['table_name', 'data_type']);
        const wanted: Array<{ name: string; kind: string }> = [];
        let needGeometry = false;
        let needTiles = false;
        for (const row of contentRows) {
            const [name, kind] = row;
            if (typeof name !== 'string' || !name || typeof kind !== 'string') {
                throw new InspectionError('invalid', 'GeoPackage contains an invalid layer catalog entry.');
            }
            if (kind === 'features') {
                needGeometry = true;
            } else if (kind === 'tiles' || kind === '2d-gridded-coverage') {
                needTiles = true;
            } else if (kind === 'attributes') {
                // Attribute-only tables and extension metadata are not spatial
                // input layers. Solver-specific suitability remains out of scope.
                continue;
            } else {
                throw new InspectionError('unsupported', `GeoPackage contains unsupported catalog data type "${boundedName(kind)}"; an incomplete inventory will not be used.`);
            }
            wanted.push({ name, kind });
            if (wanted.length > this.limits.maxLayers) {
                throw new InspectionError('limit', 'GeoPackage layer count exceeds the inspection limit.');
            }
        }
        const geometry = needGeometry ? this.registeredNames(tables, 'gpkg_geometry_columns') : new Set<string>();
        const tiles = needTiles ? this.registeredNames(tables, 'gpkg_tile_matrix_set') : new Set<string>();
        const layers: string[] = [];
        const seen = new Set<string>();
        for (const layer of wanted) {
            const key = foldGeoPackageName(layer.name);
            const registered = layer.kind === 'features' ? geometry : tiles;
            if (unsupportedTables.has(key)) {
                throw new InspectionError('unsupported', `GeoPackage layer "${boundedName(layer.name)}" uses a view or virtual table that is not inspected.`);
            }
            if (!tables.has(key) || !registered.has(key)) {
                throw new InspectionError('invalid', `GeoPackage catalog entry "${boundedName(layer.name)}" has no matching spatial table metadata.`);
            }
            if (seen.has(key)) {
                throw new InspectionError('invalid', 'GeoPackage contains duplicate layer catalog entries.');
            }
            seen.add(key);
            layers.push(layer.name);
        }
        if (layers.length === 0) {
            throw new InspectionError('empty', 'GeoPackage has no registered vector or raster layers.');
        }
        return layers.sort();
    }

    private registeredNames(tables: Map<string, SchemaTable>, name: string): Set<string> {
        const table = tables.get(name);
        if (!table) {
            throw new InspectionError('invalid', `GeoPackage is missing the ${name} catalog.`);
        }
        const names = new Set<string>();
        for (const row of this.catalogRows(table, ['table_name'])) {
            if (typeof row[0] !== 'string' || !row[0]) {
                throw new InspectionError('invalid', `Invalid table name in ${name}.`);
            }
            names.add(foldGeoPackageName(row[0]));
        }
        return names;
    }

    private *catalogRows(table: SchemaTable, names: string[]): Generator<SqlValue[]> {
        const columns = columnNames(table.sql);
        const indexes = names.map(name => columns.indexOf(name));
        if (indexes.some(index => index < 0)) {
            throw new InspectionError('invalid', `GeoPackage ${table.name} is missing required catalog columns.`);
        }
        for (const row of this.tableRows(table.rootPage)) {
            if (indexes.some(index => index >= row.length)) {
                throw new InspectionError('unsupported', `GeoPackage ${table.name} uses an unsupported catalog record layout.`);
            }
            yield indexes.map(index => row[index]);
        }
    }

    private *tableRows(rootPage: number): Generator<SqlValue[]> {
        const pending = [rootPage];
        const visited = new Set<number>();
        while (pending.length > 0) {
            this.checkDeadline();
            const pageNumber = pending.pop()!;
            if (visited.has(pageNumber)) {
                throw new InspectionError('invalid', 'Cycle in the SQLite catalog b-tree.');
            }
            visited.add(pageNumber);
            const page = this.page(pageNumber);
            const offset = pageNumber === 1 ? 100 : 0;
            const pageType = page[offset];
            if (pageType !== 0x05 && pageType !== 0x0d) {
                throw new InspectionError('unsupported', 'Only ordinary SQLite rowid catalogs are supported; this catalog uses a different b-tree layout.');
            }
            const headerSize = pageType === 0x05 ? 12 : 8;
            this.bounds(offset, headerSize, this.usableSize);
            const cellCount = page.readUInt16BE(offset + 3);
            const pointerEnd = offset + headerSize + 2 * cellCount;
            this.bounds(offset + headerSize, cellCount * 2, this.usableSize);
            if (pageType === 0x05) {
                pending.push(page.readUInt32BE(offset + 8));
            }
            for (let index = cellCount - 1; index >= 0; index--) {
                this.checkDeadline();
                const cellOffset = page.readUInt16BE(offset + headerSize + index * 2);
                if (cellOffset < pointerEnd || cellOffset >= this.usableSize) {
                    throw new InspectionError('invalid', 'Invalid SQLite catalog cell pointer.');
                }
                if (pageType === 0x05) {
                    this.bounds(cellOffset, 4, this.usableSize);
                    readVarint(page, cellOffset + 4, this.usableSize);
                    pending.push(page.readUInt32BE(cellOffset));
                } else {
                    this.rowCount++;
                    if (this.rowCount > this.limits.maxRows) {
                        throw new InspectionError('limit', 'SQLite catalog row count exceeds the inspection limit.');
                    }
                    yield this.record(this.cellPayload(page, cellOffset));
                }
            }
            if (pending.length > this.limits.maxPages) {
                throw new InspectionError('limit', 'SQLite catalog traversal exceeds the inspection limit.');
            }
        }
    }

    private cellPayload(page: Buffer, offset: number): Buffer {
        const payloadVarint = readVarint(page, offset, this.usableSize);
        const payloadSize = safeNumber(payloadVarint.value);
        if (payloadSize > this.limits.maxRecordBytes) {
            throw new InspectionError('limit', 'SQLite catalog record exceeds the inspection limit.');
        }
        const rowid = readVarint(page, payloadVarint.next, this.usableSize);
        let localSize = payloadSize;
        const maximum = this.usableSize - 35;
        if (payloadSize > maximum) {
            const minimum = Math.floor((this.usableSize - 12) * 32 / 255) - 23;
            const candidate = minimum + (payloadSize - minimum) % (this.usableSize - 4);
            localSize = candidate <= maximum ? candidate : minimum;
        }
        const hasOverflow = localSize < payloadSize;
        this.bounds(rowid.next, localSize + (hasOverflow ? 4 : 0), this.usableSize);
        if (!hasOverflow) {
            return page.subarray(rowid.next, rowid.next + localSize);
        }
        const payload = Buffer.alloc(payloadSize);
        page.copy(payload, 0, rowid.next, rowid.next + localSize);
        let copied = localSize;
        let nextPage = page.readUInt32BE(rowid.next + localSize);
        const visited = new Set<number>();
        while (copied < payloadSize) {
            if (visited.has(nextPage)) {
                throw new InspectionError('invalid', 'Cycle in SQLite catalog overflow pages.');
            }
            visited.add(nextPage);
            const overflow = this.page(nextPage);
            const count = Math.min(this.usableSize - 4, payloadSize - copied);
            overflow.copy(payload, copied, 4, 4 + count);
            copied += count;
            nextPage = overflow.readUInt32BE(0);
        }
        if (nextPage !== 0) {
            throw new InspectionError('invalid', 'Invalid SQLite catalog overflow chain.');
        }
        return payload;
    }

    private record(payload: Buffer): SqlValue[] {
        const header = readVarint(payload, 0, payload.length);
        const headerSize = safeNumber(header.value);
        if (headerSize < header.next || headerSize > payload.length) {
            throw new InspectionError('invalid', 'Invalid SQLite catalog record header.');
        }
        let headerOffset = header.next;
        let contentOffset = headerSize;
        const values: SqlValue[] = [];
        while (headerOffset < headerSize) {
            const serial = readVarint(payload, headerOffset, headerSize);
            const type = safeNumber(serial.value);
            headerOffset = serial.next;
            let length: number;
            if (type === 0 || type === 8 || type === 9) {
                length = 0;
            } else if (type >= 1 && type <= 4) {
                length = type;
            } else if (type === 5) {
                length = 6;
            } else if (type === 6 || type === 7) {
                length = 8;
            } else if (type >= 12) {
                length = Math.floor((type - 12) / 2);
            } else {
                throw new InspectionError('invalid', 'Reserved SQLite catalog serial type.');
            }
            this.bounds(contentOffset, length, payload.length);
            let value: SqlValue;
            if (type === 0) {
                value = null;
            } else if (type === 8 || type === 9) {
                value = type - 8;
            } else if (type <= 5) {
                value = payload.readIntBE(contentOffset, length);
            } else if (type === 6) {
                const integer = payload.readBigInt64BE(contentOffset);
                value = integer >= BigInt(Number.MIN_SAFE_INTEGER) && integer <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(integer) : integer;
            } else if (type === 7) {
                value = payload.readDoubleBE(contentOffset);
            } else if (type % 2 === 0) {
                value = payload.subarray(contentOffset, contentOffset + length);
            } else {
                try {
                    value = this.textDecoder.decode(payload.subarray(contentOffset, contentOffset + length));
                } catch {
                    throw new InspectionError('invalid', 'Invalid text encoding in the SQLite catalog.');
                }
            }
            contentOffset += length;
            values.push(value);
            if (values.length > 1024) {
                throw new InspectionError('limit', 'SQLite catalog column count exceeds the inspection limit.');
            }
        }
        if (contentOffset !== payload.length) {
            throw new InspectionError('invalid', 'Invalid SQLite catalog record length.');
        }
        return values;
    }

    private page(number: number): Buffer {
        this.checkDeadline();
        if (!Number.isInteger(number) || number < 1 || number > this.pageCount) {
            throw new InspectionError('invalid', 'SQLite catalog refers to a page outside the database.');
        }
        const cached = this.pages.get(number);
        if (cached) {
            return cached;
        }
        if (this.pages.size >= this.limits.maxPages || this.metrics.bytesRead + this.pageSize > this.limits.maxBytes) {
            throw new InspectionError('limit', 'SQLite metadata exceeds the inspection byte/page limit.');
        }
        const buffer = readExactly(this.descriptor, this.pageSize, (number - 1) * this.pageSize, this.metrics);
        this.metrics.pagesRead++;
        this.pages.set(number, buffer);
        return buffer;
    }

    private bounds(offset: number, length: number, limit: number): void {
        if (offset < 0 || length < 0 || offset + length > limit) {
            throw new InspectionError('invalid', 'SQLite catalog record extends beyond its page.');
        }
    }

    private checkDeadline(): void {
        if (Date.now() > this.deadline) {
            throw new InspectionError('timeout', 'GeoPackage metadata inspection exceeded its time limit.');
        }
    }
}

function readVarint(buffer: Buffer, offset: number, limit: number): { value: bigint; next: number } {
    let value = 0n;
    for (let count = 0; count < 9; count++) {
        if (offset >= limit) {
            throw new InspectionError('invalid', 'Truncated SQLite catalog varint.');
        }
        const byte = buffer[offset++];
        if (count === 8) {
            return { value: (value << 8n) | BigInt(byte), next: offset };
        }
        value = (value << 7n) | BigInt(byte & 0x7f);
        if ((byte & 0x80) === 0) {
            return { value, next: offset };
        }
    }
    throw new InspectionError('invalid', 'Invalid SQLite catalog varint.');
}

function safeNumber(value: bigint): number {
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new InspectionError('invalid', 'SQLite catalog integer exceeds the supported range.');
    }
    return Number(value);
}

/** Read column order rather than assuming that every producer uses OGC order. */
function columnNames(sql: string): string[] {
    const tokens = sqlTokens(sql);
    if (tokens[0]?.text.toUpperCase() !== 'CREATE' || tokens[1]?.text.toUpperCase() !== 'TABLE') {
        throw new InspectionError('unsupported', 'GeoPackage catalog is not an ordinary SQLite table.');
    }
    for (let index = 0; index < tokens.length - 1; index++) {
        if (!tokens[index].quoted && tokens[index].text.toUpperCase() === 'WITHOUT' && tokens[index + 1].text.toUpperCase() === 'ROWID') {
            throw new InspectionError('unsupported', 'WITHOUT ROWID GeoPackage catalogs are not supported.');
        }
    }
    const start = tokens.findIndex(token => token.text === '(' && !token.quoted);
    if (start < 0) {
        throw new InspectionError('invalid', 'Invalid GeoPackage catalog table definition.');
    }
    const columns: string[] = [];
    let depth = 1;
    let first = true;
    for (let index = start + 1; index < tokens.length; index++) {
        const token = tokens[index];
        if (!token.quoted && token.text === '(') {
            depth++;
        } else if (!token.quoted && token.text === ')') {
            depth--;
            if (depth === 0) {
                return columns;
            }
        } else if (!token.quoted && token.text === ',' && depth === 1) {
            first = true;
        } else if (depth === 1 && first) {
            first = false;
            const keyword = token.text.toUpperCase();
            if (token.quoted || !['CONSTRAINT', 'PRIMARY', 'UNIQUE', 'CHECK', 'FOREIGN'].includes(keyword)) {
                columns.push(foldGeoPackageName(token.text));
            }
        } else if (depth === 1 && !token.quoted && token.text.toUpperCase() === 'AS' && tokens[index + 1]?.text === '(') {
            throw new InspectionError('unsupported', 'Generated columns in GeoPackage catalogs are not supported.');
        }
    }
    throw new InspectionError('invalid', 'Unclosed GeoPackage catalog table definition.');
}

function sqlTokens(sql: string): Array<{ text: string; quoted: boolean }> {
    const tokens: Array<{ text: string; quoted: boolean }> = [];
    let offset = 0;
    while (offset < sql.length) {
        const character = sql[offset];
        if (/\s/.test(character)) {
            offset++;
            continue;
        }
        if (sql.slice(offset, offset + 2) === '--') {
            const end = sql.indexOf('\n', offset + 2);
            offset = end < 0 ? sql.length : end + 1;
            continue;
        }
        if (sql.slice(offset, offset + 2) === '/*') {
            const end = sql.indexOf('*/', offset + 2);
            if (end < 0) {
                throw new InspectionError('invalid', 'Unclosed comment in a GeoPackage catalog definition.');
            }
            offset = end + 2;
            continue;
        }
        if ('\"\'`['.includes(character)) {
            const quote = character === '[' ? ']' : character;
            let text = '';
            let closed = false;
            offset++;
            while (offset < sql.length) {
                if (sql[offset] === quote) {
                    if (quote !== ']' && sql[offset + 1] === quote) {
                        text += quote;
                        offset += 2;
                        continue;
                    }
                    offset++;
                    closed = true;
                    break;
                }
                text += sql[offset++];
            }
            if (!closed) {
                throw new InspectionError('invalid', 'Unclosed quote in a GeoPackage catalog definition.');
            }
            tokens.push({ text, quoted: true });
        } else if ('(),;'.includes(character)) {
            tokens.push({ text: character, quoted: false });
            offset++;
        } else {
            const start = offset;
            while (offset < sql.length && !/[\s(),;"'`\[]/.test(sql[offset])) {
                offset++;
            }
            tokens.push({ text: sql.slice(start, offset), quoted: false });
        }
        if (tokens.length > 16384) {
            throw new InspectionError('limit', 'GeoPackage catalog definition exceeds the inspection limit.');
        }
    }
    return tokens;
}

function boundedName(name: string): string {
    return name.replace(/[\r\n\0]/g, ' ').slice(0, 120);
}

function statFingerprint(stat: fs.Stats): string {
    return [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs, stat.birthtimeMs].join(':');
}

function sidecarFingerprint(filePath: string): string {
    const parts: string[] = [];
    for (const suffix of ['-wal', '-journal', '-shm']) {
        try {
            const stat = fs.statSync(filePath + suffix);
            if (!stat.isFile() || stat.size > 0) {
                throw new InspectionError('busy', `GeoPackage has a ${suffix.slice(1)} sidecar; its catalog is not checked while database state may be changing.`);
            }
            parts.push(suffix + ':' + statFingerprint(stat));
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw error;
            }
            parts.push(suffix + ':absent');
        }
    }
    return parts.join('|');
}

function readExactly(descriptor: number, size: number, position: number, metrics: GeoPackageReadMetrics): Buffer {
    const buffer = Buffer.alloc(size);
    let read = 0;
    while (read < size) {
        const count = fs.readSync(descriptor, buffer, read, size - read, position + read);
        if (count === 0) {
            throw new InspectionError('invalid', 'The GeoPackage is empty or truncated.');
        }
        read += count;
        metrics.bytesRead += count;
    }
    return buffer;
}

/**
 * Worker-only synchronous entry point. Every file is opened with 'r'; no SQLite
 * connection, journal, checkpoint, feature scan, or writable handle is created.
 * Before/after identity, header and sidecar checks reject observed concurrent
 * changes. This is conservative inspection, not a SQLite transaction or full
 * integrity check. WAL/live-journal files are intentionally left unchecked.
 */
export function readGeoPackageSnapshot(
    filePath: string,
    previous?: GeoPackageSnapshot,
    overrides: Partial<GeoPackageReadLimits> = {}
): GeoPackageReadResult {
    const metrics: GeoPackageReadMetrics = { fileOpens: 0, bytesRead: 0, pagesRead: 0, metadataReads: 0, cacheHits: 0 };
    let descriptor: number | undefined;
    let fingerprint: string | undefined;
    try {
        const beforeSidecars = sidecarFingerprint(filePath);
        const beforePathStat = fs.statSync(filePath);
        if (!beforePathStat.isFile()) {
            throw new InspectionError('unreadable', 'GeoPackage path is not a regular file.');
        }
        descriptor = fs.openSync(filePath, 'r');
        metrics.fileOpens++;
        const beforeStat = fs.fstatSync(descriptor);
        if (statFingerprint(beforeStat) !== statFingerprint(beforePathStat)) {
            throw new InspectionError('changed', 'GeoPackage changed before its catalog could be inspected.');
        }
        const header = readExactly(descriptor, 100, 0, metrics);
        fingerprint = statFingerprint(beforeStat) + '|' + beforeSidecars + '|' + header.toString('hex');
        let result: InventoryResult;
        if (previous?.fingerprint === fingerprint) {
            result = previous.result;
            metrics.cacheHits++;
        } else {
            const reader = new CatalogReader(descriptor, header, beforeStat.size, { ...GEOPACKAGE_READ_LIMITS, ...overrides }, metrics);
            metrics.metadataReads++;
            result = { status: 'ok', layers: reader.inventory() };
        }
        const afterHeader = readExactly(descriptor, 100, 0, metrics);
        const afterStat = fs.fstatSync(descriptor);
        const afterPathStat = fs.statSync(filePath);
        const afterSidecars = sidecarFingerprint(filePath);
        if (
            !afterHeader.equals(header) ||
            statFingerprint(afterStat) !== statFingerprint(beforeStat) ||
            statFingerprint(afterPathStat) !== statFingerprint(beforeStat) ||
            afterSidecars !== beforeSidecars
        ) {
            throw new InspectionError('changed', 'GeoPackage changed while its catalog was being inspected; layer checks were skipped.');
        }
        return { result, fingerprint, metrics };
    } catch (error) {
        const result: InventoryResult = error instanceof InspectionError
            ? { status: 'unavailable', reason: error.message, reasonCode: error.reasonCode }
            : { status: 'unavailable', reason: fileErrorReason(error), reasonCode: 'unreadable' };
        // Failure results are not retained as a successful snapshot. In
        // particular, a transient writer must not poison later validation.
        return { result, metrics };
    } finally {
        if (descriptor !== undefined) {
            try {
                fs.closeSync(descriptor);
            } catch {
                // The handle was read-only and the failed inspection is already
                // non-successful. The worker lifetime still bounds open handles.
            }
        }
    }
}

function fileErrorReason(error: unknown): string {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM') {
        return 'GeoPackage is not readable (permission denied or locked by another application).';
    }
    if (code === 'ENOENT') {
        return 'GeoPackage is no longer present.';
    }
    return `GeoPackage metadata could not be read${code ? ` (${code})` : ''}.`;
}
