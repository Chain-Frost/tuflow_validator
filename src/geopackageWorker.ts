import { parentPort } from 'worker_threads';
import { GeoPackageReadResult, GeoPackageSnapshot, InventoryResult, readGeoPackageSnapshot } from './geopackageReader';

const MAX_CACHED_DATABASES = 128;
const MAX_CACHED_NAME_CHARACTERS = 1000000;
const FAILURE_BACKOFF_MS = 1500;

interface CacheEntry {
    snapshot: GeoPackageSnapshot;
    characters: number;
    expires?: number;
}

const cache = new Map<string, CacheEntry>();
let cachedCharacters = 0;

function removeCached(filePath: string): void {
    const existing = cache.get(filePath);
    if (existing) {
        cachedCharacters -= existing.characters;
        cache.delete(filePath);
    }
}

function cacheResult(filePath: string, result: GeoPackageReadResult): void {
    removeCached(filePath);
    let characters = 0;
    if (result.result.status === 'ok') {
        for (const name of result.result.layers) {
            characters += name.length;
        }
    }
    if (characters > MAX_CACHED_NAME_CHARACTERS) {
        return;
    }
    while (cache.size >= MAX_CACHED_DATABASES || cachedCharacters + characters > MAX_CACHED_NAME_CHARACTERS) {
        const oldest = cache.keys().next().value as string | undefined;
        if (oldest === undefined) {
            break;
        }
        removeCached(oldest);
    }
    cache.set(filePath, {
        snapshot: { fingerprint: result.fingerprint, result: result.result },
        characters,
        expires: result.result.status === 'unavailable' ? Date.now() + FAILURE_BACKOFF_MS : undefined
    });
    cachedCharacters += characters;
}

parentPort?.on('message', (message: { type: 'inspect' | 'invalidate'; id?: number; filePath?: string }) => {
    if (message.type === 'invalidate') {
        if (message.filePath === undefined) {
            cache.clear();
            cachedCharacters = 0;
        } else {
            removeCached(message.filePath);
        }
        return;
    }
    if (message.type !== 'inspect' || message.filePath === undefined) {
        return;
    }
    const previous = cache.get(message.filePath);
    let read: GeoPackageReadResult;
    if (previous?.expires !== undefined && previous.expires > Date.now()) {
        // Brief backoff is only for a non-success result. It cannot invent a
        // missing layer, and watcher/configuration invalidation clears it.
        read = {
            result: previous.snapshot.result,
            metrics: { fileOpens: 0, bytesRead: 0, pagesRead: 0, metadataReads: 0, cacheHits: 1 }
        };
    } else {
        read = readGeoPackageSnapshot(message.filePath, previous?.snapshot);
        cacheResult(message.filePath, read);
    }
    parentPort?.postMessage({ id: message.id, result: read.result as InventoryResult, metrics: read.metrics });
});
