import * as path from 'path';
import { Worker } from 'worker_threads';
import { GeoPackageReadMetrics, InventoryResult, InventoryUnavailableReason } from './geopackageReader';

export { InventoryResult, InventoryUnavailableReason, foldGeoPackageName } from './geopackageReader';

export const GEOPACKAGE_WORKER_LIMIT = 2;
export const GEOPACKAGE_REQUEST_TIMEOUT_MS = 5000;
const MAX_PENDING_REQUESTS = 256;

interface InspectionTask {
    id: number;
    filePath: string;
    resolve: (result: InventoryResult) => void;
    promise: Promise<InventoryResult>;
    timer: ReturnType<typeof setTimeout>;
    invalidated: boolean;
    finished: boolean;
}

interface WorkerSlot {
    worker?: Worker;
    active?: InspectionTask;
    queue: InspectionTask[];
    terminating: boolean;
}

export interface GeoPackageInventoryStats extends GeoPackageReadMetrics {
    requests: number;
    deduplicated: number;
    workerRequests: number;
    timeouts: number;
    activeWorkers: number;
    peakWorkers: number;
    pendingRequests: number;
}

const slots: WorkerSlot[] = [];
for (let index = 0; index < GEOPACKAGE_WORKER_LIMIT; index++) {
    slots.push({ queue: [], terminating: false });
}
const inFlight = new Map<string, InspectionTask>();
let nextTaskId = 0;
let counters = emptyCounters();

function emptyCounters(): GeoPackageInventoryStats {
    return {
        fileOpens: 0, bytesRead: 0, pagesRead: 0, metadataReads: 0, cacheHits: 0,
        requests: 0, deduplicated: 0, workerRequests: 0, timeouts: 0,
        activeWorkers: 0, peakWorkers: 0, pendingRequests: 0
    };
}

function unavailable(reasonCode: InventoryUnavailableReason, reason: string): InventoryResult {
    return { status: 'unavailable', reasonCode, reason };
}

function keyFor(filePath: string): string {
    const normalized = path.resolve(filePath);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function slotFor(key: string): WorkerSlot {
    let hash = 0;
    for (let index = 0; index < key.length; index++) {
        hash = (Math.imul(hash, 31) + key.charCodeAt(index)) | 0;
    }
    return slots[(hash >>> 0) % slots.length];
}

function pendingCount(): number {
    let count = 0;
    for (const slot of slots) {
        count += slot.queue.length + (slot.active ? 1 : 0);
    }
    return count;
}

/**
 * Read metadata off the extension host with at most two workers and bounded
 * queue/time/memory. Repeated pending requests share one operation. Workers
 * retain bounded inventories and verify file identity/header on later passes.
 */
export function inspectGeoPackage(filePath: string): Promise<InventoryResult> {
    counters.requests++;
    const key = keyFor(filePath);
    const existing = inFlight.get(key);
    if (existing) {
        counters.deduplicated++;
        return existing.promise;
    }
    if (pendingCount() >= MAX_PENDING_REQUESTS) {
        return Promise.resolve(unavailable('limit', 'GeoPackage inspection queue is full; this reference was not checked.'));
    }
    let resolve!: (result: InventoryResult) => void;
    const promise = new Promise<InventoryResult>(done => { resolve = done; });
    const slot = slotFor(key);
    const task: InspectionTask = {
        id: ++nextTaskId, filePath: key, promise, resolve,
        timer: setTimeout(() => timeOut(slot, task), GEOPACKAGE_REQUEST_TIMEOUT_MS),
        invalidated: false, finished: false
    };
    inFlight.set(key, task);
    slot.queue.push(task);
    dispatch(slot);
    return promise;
}

/** Deduplicate even sequential references during one document/root scan. */
export function createGeoPackageInventoryPass(): (filePath: string) => Promise<InventoryResult> {
    const pending = new Map<string, Promise<InventoryResult>>();
    return filePath => {
        const key = keyFor(filePath);
        const previous = pending.get(key);
        if (previous) {
            return previous;
        }
        const next = inspectGeoPackage(key);
        pending.set(key, next);
        return next;
    };
}

function dispatch(slot: WorkerSlot): void {
    if (slot.active || slot.terminating || slot.queue.length === 0) {
        return;
    }
    const task = slot.queue.shift()!;
    if (task.finished) {
        dispatch(slot);
        return;
    }
    slot.active = task;
    let worker = slot.worker;
    if (!worker) {
        try {
            worker = new Worker(path.join(__dirname, 'geopackageWorker.js'), {
                resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 }
            });
        } catch {
            finish(slot, task, unavailable('unsupported', 'GeoPackage inspection worker could not be started.'));
            dispatch(slot);
            return;
        }
        slot.worker = worker;
        counters.peakWorkers = Math.max(counters.peakWorkers, slots.filter(item => item.worker !== undefined).length);
        const createdWorker = worker;
        worker.on('message', (message: { id: number; result: InventoryResult; metrics: GeoPackageReadMetrics }) => {
            if (slot.worker !== createdWorker || slot.active?.id !== message.id || slot.terminating) {
                return;
            }
            for (const key of ['fileOpens', 'bytesRead', 'pagesRead', 'metadataReads', 'cacheHits'] as const) {
                counters[key] += message.metrics[key];
            }
            const active = slot.active;
            finish(slot, active, active.invalidated
                ? unavailable('changed', 'GeoPackage changed during validation; this inspection was discarded.')
                : message.result);
            createdWorker.unref();
            dispatch(slot);
        });
        worker.on('error', () => {
            if (slot.worker !== createdWorker) {
                return;
            }
            if (slot.active) {
                finish(slot, slot.active, unavailable('unreadable', 'GeoPackage inspection worker stopped before completing its read.'));
            }
            terminate(slot);
        });
        worker.on('exit', () => {
            if (slot.worker !== createdWorker) {
                return;
            }
            if (slot.active) {
                finish(slot, slot.active, unavailable('unreadable', 'GeoPackage inspection worker exited before completing its read.'));
            }
            slot.worker = undefined;
            slot.terminating = false;
            dispatch(slot);
        });
    }
    counters.workerRequests++;
    worker.ref();
    try {
        worker.postMessage({ type: 'inspect', id: task.id, filePath: task.filePath });
    } catch {
        finish(slot, task, unavailable('unreadable', 'GeoPackage inspection worker could not receive the read request.'));
        terminate(slot);
    }
}

function finish(slot: WorkerSlot, task: InspectionTask, result: InventoryResult): void {
    if (task.finished) {
        return;
    }
    task.finished = true;
    clearTimeout(task.timer);
    if (inFlight.get(task.filePath) === task) {
        inFlight.delete(task.filePath);
    }
    if (slot.active === task) {
        slot.active = undefined;
    } else {
        const position = slot.queue.indexOf(task);
        if (position >= 0) {
            slot.queue.splice(position, 1);
        }
    }
    task.resolve(result);
}

function timeOut(slot: WorkerSlot, task: InspectionTask): void {
    const active = slot.active === task;
    counters.timeouts++;
    finish(slot, task, unavailable('timeout', 'GeoPackage metadata inspection timed out; the file or network share may be unavailable.'));
    if (active) {
        // A blocked OS read may delay worker termination. Keep this slot
        // reserved until its exit event; never spawn unbounded replacements.
        terminate(slot);
    }
}

function terminate(slot: WorkerSlot): void {
    if (!slot.worker || slot.terminating) {
        return;
    }
    slot.terminating = true;
    void slot.worker.terminate().catch(() => { /* exit/error handlers settle tasks */ });
}

/** A directory watcher can invalidate either the database or its sidecars. */
export function invalidateGeoPackage(filePath?: string): void {
    const key = filePath === undefined ? undefined : keyFor(filePath.replace(/-(?:wal|shm|journal)$/i, ''));
    for (const slot of slots) {
        if (slot.active && (key === undefined || slot.active.filePath === key)) {
            slot.active.invalidated = true;
            if (inFlight.get(slot.active.filePath) === slot.active) {
                inFlight.delete(slot.active.filePath);
            }
        }
        for (const task of slot.queue) {
            if (key === undefined || task.filePath === key) {
                task.invalidated = true;
                if (inFlight.get(task.filePath) === task) {
                    inFlight.delete(task.filePath);
                }
            }
        }
        if (slot.worker && !slot.terminating) {
            try {
                slot.worker.postMessage({ type: 'invalidate', filePath: key });
            } catch {
                // A concurrently exiting worker cannot reuse its old cache.
                terminate(slot);
            }
        }
    }
}

export function disposeGeoPackageInventory(): void {
    for (const slot of slots) {
        for (const task of [...slot.queue]) {
            finish(slot, task, unavailable('cancelled', 'GeoPackage inspection was cancelled.'));
        }
        if (slot.active) {
            finish(slot, slot.active, unavailable('cancelled', 'GeoPackage inspection was cancelled.'));
        }
        terminate(slot);
    }
    inFlight.clear();
}

export function getGeoPackageInventoryStats(): GeoPackageInventoryStats {
    return {
        ...counters,
        activeWorkers: slots.filter(slot => slot.worker !== undefined).length,
        pendingRequests: pendingCount()
    };
}

export function resetGeoPackageInventoryStats(): void {
    counters = emptyCounters();
    counters.peakWorkers = slots.filter(slot => slot.worker !== undefined).length;
}
