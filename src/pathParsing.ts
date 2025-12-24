import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Determines if a string value looks like a potential file path.
 * Heuristics used:
 * 1. Checks if it is NOT a pure number.
 * 2. Checks for path separators (/ or \).
 * 3. Checks for a file extension.
 * 4. Filters out common TUFLOW keywords that often appear in similar contexts (ON, OFF, GPU, etc.).
 *
 * @param value - The string to check.
 * @returns True if the string is likely a file path, false otherwise.
 */
export function isLikelyFile(value: string): boolean {
    // 1. Shouldn't be a number
    if (!isNaN(Number(value))) {
        return false;
    }
    // 2. Should probably have an extension or path separators
    if (value.includes('/') || value.includes('\\')) {
        return true;
    }
    if (path.extname(value) !== '') {
        return true;
    }
    // 3. Common TUFLOW keywords that are NOT files (e.g. ON, OFF, HELP, AUTO)
    const keywords = ['ON', 'OFF', 'HPC', 'GPU', 'SM', 'DOUBLE', 'SINGLE'];
    if (keywords.includes(value.toUpperCase())) {
        return false;
    }

    return false;
}

/**
 * Determines if a specific key should be skipped during file lookup.
 * Certain TUFLOW commands (like PAUSE or events) do not reference files in the standard way.
 *
 * @param keyText - The command key (left side of '==').
 * @returns True if the key should be ignored, false otherwise.
 */
export function shouldSkipKeyForFileLookup(keyText: string): boolean {
    const normalized = normalizeKey(keyText);
    if (normalized === 'PAUSE') {
        return true;
    }

    const skipPrefixes = [
        'DEFINE EVENT',
        'IF EVENT',
        'ELSE IF EVENT',
        'ELSEIF EVENT',
        'BC EVENT SOURCE'
    ];

    return skipPrefixes.some(prefix => normalized.startsWith(prefix));
}

/**
 * Normalizes a command key for comparison by trimming, replacing multiple spaces, and uppercasing.
 *
 * @param keyText - The raw key text.
 * @returns The normalized key string.
 */
export function normalizeKey(keyText: string): string {
    return keyText.replace(/\s+/g, ' ').trim().toUpperCase();
}

/**
 * Extracts potential file path candidates from a line of text.
 * Handles paths separated by '|' and removes TUFLOW layer selectors ('>>').
 *
 * @param valueText - The value part of the command (right side of '==').
 * @param valueStartIndex - The index where the value starts in the line.
 * @param lineIndex - The line number in the document.
 * @returns An array of path candidates with their ranges.
 */
export function extractPathCandidates(
    valueText: string,
    valueStartIndex: number,
    lineIndex: number
): Array<{ text: string; range: vscode.Range }> {
    const candidates: Array<{ text: string; range: vscode.Range }> = [];
    const segmentRegex = /[^|]+/g;
    let match: RegExpExecArray | null;

    while ((match = segmentRegex.exec(valueText)) !== null) {
        const segmentText = match[0];
        if (segmentText.includes('<<') && segmentText.includes('>>')) {
            continue;
        }

        const layerIndex = segmentText.indexOf('>>');
        const pathPortion = layerIndex >= 0 ? segmentText.slice(0, layerIndex) : segmentText;
        const trimmed = pathPortion.trim();
        if (!trimmed) {
            continue;
        }

        const leadingWhitespace = pathPortion.length - pathPortion.trimStart().length;
        const startChar = valueStartIndex + match.index + leadingWhitespace;
        const endChar = startChar + trimmed.length;
        candidates.push({ text: trimmed, range: new vscode.Range(lineIndex, startChar, lineIndex, endChar) });
    }

    return candidates;
}

/**
 * Resolves a potentially relative path to an absolute path.
 *
 * @param baseDir - Generally the directory of the current file.
 * @param rawPath - The path string found in the file.
 * @returns The absolute path.
 */
export function resolvePath(baseDir: string, rawPath: string): string {
    const normalized = rawPath.replace(/\\/g, '/');
    if (path.isAbsolute(normalized) || path.win32.isAbsolute(normalized)) {
        return normalized;
    }

    return path.resolve(baseDir, normalized);
}

/**
 * Checks if a string contains unresolved TUFLOW tokens/macros (e.g. <<...>>).
 *
 * @param value - The string to check.
 * @returns True if unresolved tokens are present.
 */
export function containsUnresolvedToken(value: string): boolean {
    return value.includes('<<') || value.includes('>>');
}
