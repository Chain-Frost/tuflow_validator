import * as fs from 'fs';

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
