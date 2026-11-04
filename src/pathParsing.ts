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

const INPUT_FILE_COMMANDS = new Set([
    'GEOMETRY CONTROL FILE',
    'BC CONTROL FILE',
    'QUADTREE CONTROL FILE',
    'EVENT FILE',
    'RAINFALL CONTROL FILE',
    'EXTERNAL STRESS FILE',
    'OPERATIONAL CONTROL FILE',
    'SWMM CONTROL FILE',
    'ADVECTION DISPERSION CONTROL FILE',
    'BC EVENT FILE',
    'ESTRY CONTROL FILE',
    'ESTRY EVENT FILE',
    'READ FILE',
    'READ MATERIALS FILE',
    'READ SOILS FILE',
    'BC DATABASE',
    'MATERIALS FILE',
    'SPATIAL DATABASE',
    'CALIBRATION POINTS GIS FILE',
    'GPKG PROJECTION',
    'MI PROJECTION',
    'SHP PROJECTION',
    'TIF PROJECTION',
    'ASC PROJECTION'
]);

/**
 * Only classify known input-file commands as requiring an existing path.
 * Leave event/scenario predicates to TUFLOW; their values come from runtime.
 */
export function classifyCommandValue(keyText: string): CommandValueKind {
    const key = normalizeKey(keyText);

    if (
        INPUT_FILE_COMMANDS.has(key) ||
        /^READ\s+(?:GIS|GRID|TIN|MIF|SHP|GPKG|ROWCOL|MID)\s+\S/.test(key) ||
        /^READ\s+.+\s+FILE$/.test(key)
    ) {
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

export interface GisReferenceToken {
    text: string;
    range: vscode.Range;
}

export interface GisReference {
    /** A file path, or the first layer name when using Spatial Database. */
    path: GisReferenceToken;
    /** All explicit selectors, or subsequent names in a layer-only && list. */
    layers: GisReferenceToken[];
    /** True only for a >> selector outside quotes and unresolved macros. */
    explicit: boolean;
}

/**
 * Recognise input command families that can refer to GeoPackage layers.
 * Spatial Database is a database assignment, not an implicit layer reference.
 */
export function isGeoPackageInputCommand(keyText: string): boolean {
    const key = normalizeKey(keyText);
    return key === 'GPKG PROJECTION' ||
        key === 'CALIBRATION POINTS GIS FILE' ||
        /^READ (?:GIS|GRID|GPKG) \S/.test(key);
}

/** Remove surrounding whitespace and a matched pair of outer quotes only. */
export function unquoteReference(text: string): string {
    const trimmed = text.trim();
    if (hasOuterQuotes(trimmed)) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
}

/**
 * Parse GIS inputs without discarding layer selectors or their source spans.
 * The caller removes comments and resolves static variables independently for
 * each token. Runtime macros remain untouched. Backslashes are never escapes.
 *
 * An implicit file reference has an empty layers list. For a layer-only input
 * such as "first && second", path is "first" and layers contains "second";
 * the caller determines whether an active Spatial Database makes it a layer.
 */
export function extractGisReferences(
    valueText: string,
    valueStartIndex: number,
    lineIndex: number
): GisReference[] {
    const references: GisReference[] = [];
    const separators = findReferenceDelimiters(valueText, '|');
    separators.push(valueText.length);
    let segmentStart = 0;

    for (const segmentEnd of separators) {
        const segment = valueText.slice(segmentStart, segmentEnd);
        const selectorIndex = findReferenceDelimiters(segment, '>>')[0];
        const explicit = selectorIndex !== undefined;
        const pathEnd = explicit
            ? selectorIndex
            : findReferenceDelimiters(segment, '&&')[0] ?? segment.length;
        const pathToken = createReferenceToken(
            segment.slice(0, pathEnd), valueStartIndex + segmentStart, lineIndex
        );

        if (pathToken) {
            const layers: GisReferenceToken[] = [];
            const layerStart = explicit ? selectorIndex + 2 : pathEnd + 2;
            if (layerStart <= segment.length) {
                const layerText = segment.slice(layerStart);
                const layerSeparators = findReferenceDelimiters(layerText, '&&');
                layerSeparators.push(layerText.length);
                let tokenStart = 0;

                for (const tokenEnd of layerSeparators) {
                    const token = createReferenceToken(
                        layerText.slice(tokenStart, tokenEnd),
                        valueStartIndex + segmentStart + layerStart + tokenStart,
                        lineIndex
                    );
                    if (token) {
                        layers.push(token);
                    }
                    tokenStart = tokenEnd + 2;
                }
            }
            references.push({ path: pathToken, layers, explicit });
        }
        segmentStart = segmentEnd + 1;
    }

    return references;
}

function hasOuterQuotes(text: string): boolean {
    return text.length >= 2 &&
        (text[0] === '"' || text[0] === "'") &&
        text[text.length - 1] === text[0];
}

function createReferenceToken(
    rawText: string,
    offset: number,
    lineIndex: number
): GisReferenceToken | undefined {
    const trimmed = rawText.trim();
    const text = unquoteReference(rawText);
    if (!text) {
        return undefined;
    }
    const leadingWhitespace = rawText.length - rawText.trimStart().length;
    const start = offset + leadingWhitespace + (hasOuterQuotes(trimmed) ? 1 : 0);
    return { text, range: new vscode.Range(lineIndex, start, lineIndex, start + text.length) };
}

/**
 * Find separators only outside macros and quoted atoms. A quote starts an atom
 * only at its beginning, so an apostrophe in an ordinary filename is literal.
 * Unclosed macros/quotes conservatively consume the rest of the input.
 */
function findReferenceDelimiters(text: string, delimiter: '|' | '>>' | '&&'): number[] {
    const positions: number[] = [];
    let quote: string | undefined;
    let macroDepth = 0;
    let atAtomStart = true;

    for (let i = 0; i < text.length; i++) {
        const character = text[i];
        if (quote !== undefined) {
            if (character === quote) {
                quote = undefined;
            }
            continue;
        }

        const pair = text.slice(i, i + 2);
        if (pair === '<<') {
            macroDepth++;
            atAtomStart = false;
            i++;
            continue;
        }
        if (macroDepth > 0) {
            if (pair === '>>') {
                macroDepth--;
                i++;
            }
            continue;
        }
        if (atAtomStart && (character === '"' || character === "'")) {
            quote = character;
            atAtomStart = false;
            continue;
        }

        const separator = character === '|' ? '|' : pair === '>>' || pair === '&&' ? pair : undefined;
        if (separator !== undefined) {
            if (separator === delimiter) {
                positions.push(i);
            }
            i += separator.length - 1;
            atAtomStart = true;
        } else if (!/\s/.test(character)) {
            atAtomStart = false;
        }
    }
    return positions;
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
