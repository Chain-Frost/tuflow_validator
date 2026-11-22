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
 * Classifies the meaning of the value supplied to a TUFLOW command.
 *
 * File-system validation must be command-aware: values such as "0.05",
 * "DEV.2026", and output folders are not input-file references, even when
 * they resemble paths. Unknown commands are intentionally not validated:
 * incorrectly reporting missing files is worse than declining to validate.
 */
export type CommandValueKind = 'input-file' | 'output' | 'non-file' | 'unknown';

/**
 * File-consuming TUFLOW commands are classified by their operand's purpose,
 * not by the target filename extension. In particular, Read File introduces
 * inline control text with *any* suffix, while GIS, database and SWMM files
 * are data even when their suffix resembles a control file.
 *
 * Source for the added commands:
 * https://docs.tuflow.com/classic-hpc/manual/2026.3/80-AppendicesA-TCFCommands.html
 * https://docs.tuflow.com/classic-hpc/manual/2026.3/89-AppendicesJ-ADCFCommands.html
 * https://docs.tuflow.com/classic-hpc/manual/2026.3/88-AppendicesI-TSCFCommands.html
 */
export type InputFileRole = 'data-file' | 'control-file' | 'inline-read-file';

const CONTROL_FILE_COMMANDS = new Set([
    'GEOMETRY CONTROL FILE',
    'BC CONTROL FILE',
    'QUADTREE CONTROL FILE',
    'EVENT FILE',
    'RAINFALL CONTROL FILE',
    'EXTERNAL STRESS FILE',
    'OPERATIONAL CONTROL FILE',
    'SWMM CONTROL FILE',
    'ADVECTION DISPERSION CONTROL FILE',
    'AD CONTROL FILE',
    'BC EVENT FILE',
    'ESTRY CONTROL FILE',
    'ESTRY EVENT FILE'
]);

const DATA_FILE_COMMANDS = new Set([
    'READ MATERIALS FILE',
    'READ SOILS FILE',
    'BC DATABASE',
    'AD BC DATABASE',
    'AD GLOBAL DATABASE',
    'READ SWMM',
    'MATERIALS FILE',
    'SPATIAL DATABASE',
    'CALIBRATION POINTS GIS FILE',
    'GPKG PROJECTION',
    'MI PROJECTION',
    'SHP PROJECTION',
    'TIF PROJECTION',
    'ASC PROJECTION'
]);

/** Only recognised file operands are eligible for existence checking. */
export function getInputFileRole(keyText: string): InputFileRole | null {
    const key = normalizeKey(keyText);
    if (key === 'READ FILE') {
        return 'inline-read-file';
    }
    if (CONTROL_FILE_COMMANDS.has(key)) {
        return 'control-file';
    }
    if (
        DATA_FILE_COMMANDS.has(key) ||
        /^READ\s+(?:GIS|GRID|TIN|MIF|SHP|GPKG|ROWCOL|MID)\s+\S/.test(key) ||
        /^READ\s+.+\s+FILE$/.test(key)
    ) {
        return 'data-file';
    }
    return null;
}

/** A control-file reference or Read File is TUFLOW command text. */
export function isControlTextInput(role: InputFileRole): boolean {
    return role === 'control-file' || role === 'inline-read-file';
}

/**
 * Only classify known input-file commands as requiring an existing path.
 * Leave event/scenario predicates to TUFLOW; their values come from runtime.
 */
export function classifyCommandValue(keyText: string): CommandValueKind {
    const key = normalizeKey(keyText);

    if (getInputFileRole(key) !== null) {
        return 'input-file';
    }

    if (
        /^(?:OUTPUT|LOG|CHECK|WRITE)\s+(?:FOLDER|FILE|FILES)(?:\s|$)/.test(key) ||
        /^(?:WRITE|OUTPUT|LOG)\s+/.test(key)
    ) {
        return 'output';
    }

    if (
        /^(?:IF|ELSE\s+IF|ELSEIF)\s+(?:EVENT|SCENARIO)(?:\s|$)/.test(key) ||
        /^(?:SET\s+VARIABLE|DEFINE\s+EVENT|BC\s+EVENT\s+SOURCE)(?:\s|$)/.test(key) ||
        key === 'PAUSE'
    ) {
        return 'non-file';
    }

    return 'unknown';
}

/**
 * Retained for existing callers; only known input-file commands are checked.
 */
export function shouldSkipKeyForFileLookup(keyText: string): boolean {
    return classifyCommandValue(keyText) !== 'input-file';
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
        // Keep unresolved placeholders as candidates so the caller can
        // expand known static variables or conservatively skip the reference.
        // A macro closes with ">>" too; only a ">>" outside macros is
        // a GIS layer selector.
        const selectorText = segmentText.replace(/<<[^<>]*>>/g, token => ' '.repeat(token.length));
        const layerIndex = selectorText.indexOf('>>');
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
