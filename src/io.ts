import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Safely reads a file's content, returning null on failure (e.g. file not found).
 *
 * @param filePath - The absolute path of the file.
 * @returns The file content as a string, or null if reading failed.
 */
export function safeReadFile(filePath: string): string | null {
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch {
        return null;
    }
}

/**
 * Read command text from the active editor snapshot before falling back to
 * disk. Read File permits arbitrary suffixes and plaintext language IDs.
 * Diagnostics and latest-reference discovery must share this interface.
 *
 * Agent B may optimise the backing read without changing this contract.
 */
/** Stable comparison of paths on each host: never equate mapped drives with UNC shares. */
export function pathIdentity(filePath: string): string {
    const normalized = path.normalize(filePath);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export type ControlTextReader = (filePath: string) => string | null;

/** A per-analysis view: a dirty editor is preferred; each path is read once. */
export function createControlTextSnapshotReader(rootDocument?: vscode.TextDocument): ControlTextReader {
    const snapshots = new Map<string, string | null>();
    // Seed the actual root document: never fall back to saved text even if
    // VS Code has not yet surfaced the supplied document in textDocuments.
    if (rootDocument?.uri.scheme === 'file') {
        snapshots.set(pathIdentity(rootDocument.fileName), rootDocument.getText());
    }
    return (filePath: string): string | null => {
        const key = pathIdentity(filePath);
        if (!snapshots.has(key)) {
            snapshots.set(key, readControlTextSnapshot(filePath));
        }
        return snapshots.get(key) ?? null;
    };
}

export function readControlTextSnapshot(filePath: string): string | null {
    const normalizedPath = pathIdentity(filePath);
    const openDocument = vscode.workspace.textDocuments.find(document =>
        document.uri.scheme === 'file' &&
        pathIdentity(document.fileName) === normalizedPath
    );
    return openDocument ? openDocument.getText() : safeReadFile(filePath);
}
