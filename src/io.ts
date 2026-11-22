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
export function readControlTextSnapshot(filePath: string): string | null {
    const normalizedPath = path.normalize(filePath);
    const openDocument = vscode.workspace.textDocuments.find(document =>
        document.uri.scheme === 'file' &&
        path.normalize(document.fileName) === normalizedPath
    );
    return openDocument ? openDocument.getText() : safeReadFile(filePath);
}
