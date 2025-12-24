import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { getConfiguredLatestVersionChecksEnabled } from './config';
import { LATEST_CHECK_CONTROL_EXTENSIONS, SCENARIO_EVENT_TOKEN_REGEX } from './constants';
import { extractPathCandidates, isLikelyFile, resolvePath, containsUnresolvedToken, normalizeKey } from './pathParsing';
import { safeReadFile } from './io';

/**
 * Context required for performing latest version checks across the workspace.
 */
export interface LatestCheckContext {
    /** Map of folder paths to lists of .tcf files within them. */
    tcfFilesByFolder: Map<string, string[]>;
    /** Set of control files that are referenced by the "latest" .tcf file in their respective folders. */
    latestTcfReferencedControls: Set<string>;
}

type LatestVersionStatus = 'no-version' | 'ambiguous' | 'latest' | 'not-latest';

interface VersionMatch {
    raw: string;
    value: number;
    start: number;
    end: number;
}

interface LatestVersionResult {
    status: LatestVersionStatus;
    currentVersion?: number;
    latestVersion?: number;
}

/**
 * Builds the context needed to verify if files are the latest version.
 * This involves scanning the workspace (or current folder) for TCF files to determine
 * which TCF is the "latest" and what it references.
 *
 * @param document - The current document to anchor the search (if no workspace folders).
 * @returns The populated LatestCheckContext.
 */
export function buildLatestCheckContext(document: vscode.TextDocument): LatestCheckContext {
    if (!getConfiguredLatestVersionChecksEnabled()) {
        return { tcfFilesByFolder: new Map(), latestTcfReferencedControls: new Set() };
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;

    const tcfFilesByFolder = new Map<string, string[]>();
    if (workspaceFolders && workspaceFolders.length > 0) {
        for (const folder of workspaceFolders) {
            collectTcfFilesRecursively(folder.uri.fsPath, tcfFilesByFolder);
        }
    } else {
        collectTcfFilesRecursively(path.dirname(document.fileName), tcfFilesByFolder);
    }

    const latestTcfs = collectLatestTcfFiles(tcfFilesByFolder);
    const latestTcfReferencedControls = collectReferencedControlFilesFromTcfs(latestTcfs);

    return { tcfFilesByFolder, latestTcfReferencedControls };
}

/**
 * Recursively finds all .tcf files in a directory data structure.
 *
 * @param rootDir - The directory to start searching from.
 * @param tcfFilesByFolder - Accumulator map of folder paths to TCF files.
 */
function collectTcfFilesRecursively(rootDir: string, tcfFilesByFolder: Map<string, string[]>): void {
    let entries: fs.Dirent[] = [];
    try {
        entries = fs.readdirSync(rootDir, { withFileTypes: true });
    } catch {
        return;
    }

    for (const entry of entries) {
        const entryPath = path.join(rootDir, entry.name);
        if (entry.isDirectory()) {
            if (shouldSkipFolderScan(entry.name)) {
                continue;
            }
            collectTcfFilesRecursively(entryPath, tcfFilesByFolder);
            continue;
        }

        if (!entry.isFile()) {
            continue;
        }

        if (path.extname(entry.name).toLowerCase() !== '.tcf') {
            continue;
        }

        const folder = path.dirname(entryPath);
        const files = tcfFilesByFolder.get(folder) ?? [];
        files.push(entryPath);
        tcfFilesByFolder.set(folder, files);
    }
}

/**
 * Checks if a directory should be skipped during recursive scanning (e.g. node_modules).
 *
 * @param folderName - The name of the folder.
 * @returns True if the folder should be skipped.
 */
function shouldSkipFolderScan(folderName: string): boolean {
    const normalized = folderName.toLowerCase();
    return (
        normalized === '.git' ||
        normalized === 'node_modules' ||
        normalized === '.vscode' ||
        normalized === '.vscode-test' ||
        normalized === 'out' ||
        normalized === 'dist'
    );
}

/**
 * Identifies the "latest" .tcf file(s) in each folder based on version numbering.
 *
 * Behavior:
 * - If a TCF filename contains a numeric token (e.g. file_01.tcf, file02.tcf),
 *   it participates in a versioned series and only the highest version in that
 *   series is "latest".
 * - If a TCF filename contains no numeric token, it is treated as "latest" on
 *   its own. This means multiple "latest" TCFs can exist in a folder when there
 *   are multiple unversioned files or multiple versioned series.
 *
 * @param tcfFilesByFolder - Map of folders to their .tcf files.
 * @returns A list of absolute paths to the latest .tcf files.
 */
function collectLatestTcfFiles(tcfFilesByFolder: Map<string, string[]>): string[] {
    const latestTcfs: string[] = [];

    for (const files of tcfFilesByFolder.values()) {
        for (const file of files) {
            const status = getLatestVersionStatus(file, files);
            if (status.status === 'latest' || status.status === 'no-version') {
                latestTcfs.push(path.normalize(file));
            }
        }
    }

    return latestTcfs;
}

/**
 * Collects all control files referenced by a given list of TCF files.
 * This effectively defines the "active set" of files for the latest simulation runs.
 *
 * @param tcfFiles - List of TCF file paths.
 * @returns Set of referenced file paths.
 */
function collectReferencedControlFilesFromTcfs(tcfFiles: string[]): Set<string> {
    const referenced = new Set<string>();

    for (const tcfFile of tcfFiles) {
        const contents = safeReadFile(tcfFile);
        if (contents === null) {
            continue;
        }

        collectReferencedControlFiles(tcfFile, contents, referenced);
    }

    return referenced;
}

/**
 * Parses a TCF file content and extracts referenced control file paths.
 *
 * @param tcfPath - Path to the TCF file.
 * @param contents - Content of the TCF file.
 * @param referenced - Accumulator set for referenced files.
 */
function collectReferencedControlFiles(tcfPath: string, contents: string, referenced: Set<string>): void {
    const lines = contents.split(/\r?\n/);
    const docDir = path.dirname(tcfPath);

    for (let i = 0; i < lines.length; i++) {
        const text = lines[i];
        if (text.trim().startsWith('!') || text.trim().length === 0) {
            continue;
        }

        const separatorIndex = text.indexOf('==');
        if (separatorIndex === -1) {
            continue;
        }

        const valueStartIndex = separatorIndex + 2;
        const valueWithComment = text.slice(valueStartIndex);
        const commentIndex = valueWithComment.indexOf('!');
        const valueText = commentIndex >= 0 ? valueWithComment.slice(0, commentIndex) : valueWithComment;

        const candidates = extractPathCandidates(valueText, valueStartIndex, i);
        for (const candidate of candidates) {
            if (!isLikelyFile(candidate.text) || containsUnresolvedToken(candidate.text)) {
                continue;
            }

            const resolvedPath = resolvePath(docDir, candidate.text);
            const ext = path.extname(resolvedPath).toLowerCase();
            if (!LATEST_CHECK_CONTROL_EXTENSIONS.has(ext) || ext === '.tcf') {
                continue;
            }

            if (!fs.existsSync(resolvedPath)) {
                continue;
            }

            referenced.add(path.normalize(resolvedPath));
        }
    }
}

/**
 * checks if a referenced file needs a version check.
 *
 * Note: Unversioned TCFs are treated as "latest" so their referenced files
 * still participate in latest-version checks.
 *
 * @param filePath - The referenced file path.
 * @param diagnostics - Diagnostics array to push warnings to.
 * @param latestCheckContext - Context for latest version checking.
 * @returns True if we should proceed with version checking for this file.
 */
export function shouldCheckLatestReferencedVersions(
    filePath: string,
    diagnostics: vscode.Diagnostic[],
    latestCheckContext: LatestCheckContext
): boolean {
    if (!getConfiguredLatestVersionChecksEnabled()) {
        return false;
    }

    const ext = path.extname(filePath).toLowerCase();
    if (!LATEST_CHECK_CONTROL_EXTENSIONS.has(ext)) {
        return false;
    }

    const normalizedPath = path.normalize(filePath);
    if (
        ext !== '.tcf' &&
        latestCheckContext.latestTcfReferencedControls.size > 0 &&
        !latestCheckContext.latestTcfReferencedControls.has(normalizedPath)
    ) {
        return false;
    }

    const candidateFiles = getCandidateFilesForLatestStatus(filePath, latestCheckContext);
    const status = getLatestVersionStatus(filePath, candidateFiles);
    if (status.status === 'ambiguous') {
        diagnostics.push(new vscode.Diagnostic(
            new vscode.Range(0, 0, 0, 0),
            `Unable to determine latest version for "${path.basename(filePath)}" because multiple numeric tokens were found.`,
            vscode.DiagnosticSeverity.Warning
        ));
        return false;
    }

    return status.status === 'latest' || (ext === '.tcf' && status.status === 'no-version');
}

export function checkReferencedFileLatestVersion(
    filePath: string,
    range: vscode.Range,
    diagnostics: vscode.Diagnostic[]
): void {
    if (!getConfiguredLatestVersionChecksEnabled()) {
        return;
    }

    const status = getLatestVersionStatus(filePath);
    if (status.status === 'ambiguous') {
        diagnostics.push(new vscode.Diagnostic(
            range,
            `Unable to determine latest version for "${path.basename(filePath)}" because multiple numeric tokens were found.`,
            vscode.DiagnosticSeverity.Warning
        ));
        return;
    }

    if (status.status === 'not-latest') {
        const currentVersion = status.currentVersion ?? 0;
        const latestVersion = status.latestVersion ?? currentVersion;
        const severity = vscode.DiagnosticSeverity.Warning;
        diagnostics.push(new vscode.Diagnostic(
            range,
            `Referenced file is not the latest version in its folder: ${path.basename(filePath)} (found ${currentVersion}, latest ${latestVersion}).`,
            severity
        ));
    }
}

function getCandidateFilesForLatestStatus(
    filePath: string,
    latestCheckContext: LatestCheckContext
): string[] | undefined {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.tcf') {
        return latestCheckContext.tcfFilesByFolder.get(path.dirname(filePath));
    }

    if (!LATEST_CHECK_CONTROL_EXTENSIONS.has(ext) || ext === '.tcf') {
        return undefined;
    }

    if (latestCheckContext.latestTcfReferencedControls.size === 0) {
        return undefined;
    }

    return filterReferencedControlCandidates(filePath, latestCheckContext.latestTcfReferencedControls);
}

function filterReferencedControlCandidates(
    filePath: string,
    referencedControls: Set<string>
): string[] {
    const ext = path.extname(filePath).toLowerCase();
    const dir = path.dirname(filePath);
    const candidates: string[] = [];

    for (const referencedPath of referencedControls) {
        if (path.extname(referencedPath).toLowerCase() !== ext) {
            continue;
        }
        if (path.dirname(referencedPath) !== dir) {
            continue;
        }
        candidates.push(referencedPath);
    }

    return candidates;
}

function getLatestVersionStatus(filePath: string, candidateFiles?: string[]): LatestVersionResult {
    const ext = path.extname(filePath).toLowerCase();
    const baseName = path.basename(filePath, ext);
    const cleanedBaseName = stripScenarioEventTokens(baseName).toLowerCase();
    const matches = getVersionMatches(cleanedBaseName);

    if (matches.length === 0) {
        return { status: 'no-version' };
    }

    if (matches.length > 1) {
        return { status: 'ambiguous' };
    }

    const currentMatch = matches[0];
    const currentVersion = currentMatch.value;
    const currentPattern = buildVersionPattern(cleanedBaseName, currentMatch);
    let latestVersion = currentVersion;
    let entries: string[] = [];

    if (candidateFiles) {
        entries = candidateFiles;
    } else {
        try {
            entries = fs
                .readdirSync(path.dirname(filePath), { withFileTypes: true })
                .filter(entry => entry.isFile())
                .map(entry => path.join(path.dirname(filePath), entry.name));
        } catch {
            return { status: 'latest', currentVersion, latestVersion };
        }
    }

    for (const entryPath of entries) {
        if (path.extname(entryPath).toLowerCase() !== ext) {
            continue;
        }

        const entryBaseName = path.basename(entryPath, ext);
        const entryCleaned = stripScenarioEventTokens(entryBaseName).toLowerCase();
        const entryMatches = getVersionMatches(entryCleaned);
        if (entryMatches.length !== 1) {
            continue;
        }

        const entryPattern = buildVersionPattern(entryCleaned, entryMatches[0]);
        if (entryPattern !== currentPattern) {
            continue;
        }

        const entryVersion = entryMatches[0].value;
        if (entryVersion > latestVersion) {
            latestVersion = entryVersion;
        }
    }

    return currentVersion === latestVersion
        ? { status: 'latest', currentVersion, latestVersion }
        : { status: 'not-latest', currentVersion, latestVersion };
}

function stripScenarioEventTokens(value: string): string {
    return value.replace(SCENARIO_EVENT_TOKEN_REGEX, '');
}

function getVersionMatches(baseName: string): VersionMatch[] {
    const matches: VersionMatch[] = [];
    const regex = /\d+/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(baseName)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        const nextChar = end < baseName.length ? baseName[end] : '';
        const nextIsLetter = /[a-z]/i.test(nextChar);

        if (!nextIsLetter) {
            matches.push({
                raw: match[0],
                value: Number.parseInt(match[0], 10),
                start,
                end
            });
        }
    }

    return matches;
}

function buildVersionPattern(baseName: string, match: VersionMatch): string {
    return `${baseName.slice(0, match.start)}#${baseName.slice(match.end)}`;
}

export function checkVersionTokenInFilename(
    keyText: string,
    valueText: string,
    valueStartIndex: number,
    lineIndex: number,
    filePath: string,
    diagnostics: vscode.Diagnostic[]
): void {
    if (normalizeKey(keyText) !== 'SET VARIABLE VERSION') {
        return;
    }

    const versionValue = valueText.trim().split(/\s+/)[0];
    if (!versionValue) {
        return;
    }

    const baseName = path.basename(filePath);
    const message = baseName.includes(versionValue)
        ? `Version token "${versionValue}" found in filename.`
        : `Version token "${versionValue}" not found in filename.`;
    const severity = baseName.includes(versionValue)
        ? vscode.DiagnosticSeverity.Information
        : vscode.DiagnosticSeverity.Warning;

    const valueIndex = valueText.indexOf(versionValue);
    const startChar = valueStartIndex + (valueIndex >= 0 ? valueIndex : 0);
    const endChar = startChar + versionValue.length;
    diagnostics.push(new vscode.Diagnostic(
        new vscode.Range(lineIndex, startChar, lineIndex, endChar),
        message,
        severity
    ));
}

export function checkScenarioEventTokensInValue(
    valueText: string,
    valueStartIndex: number,
    lineIndex: number,
    filePath: string,
    diagnostics: vscode.Diagnostic[]
): void {
    const baseName = path.basename(filePath).toLowerCase();
    const tokenRegex = /<<([^>]+)>>/g;
    const scenarioEventToken = /^~[se][1-9]~$/i;
    const seenTokens = new Set<string>();
    let match: RegExpExecArray | null;

    while ((match = tokenRegex.exec(valueText)) !== null) {
        const token = match[1].trim();
        if (!token) {
            continue;
        }

        if (!scenarioEventToken.test(token)) {
            continue;
        }

        const normalizedToken = token.toLowerCase();
        if (seenTokens.has(normalizedToken)) {
            continue;
        }
        seenTokens.add(normalizedToken);

        if (!baseName.includes(normalizedToken)) {
            const startChar = valueStartIndex + match.index;
            const endChar = startChar + match[0].length;
            diagnostics.push(new vscode.Diagnostic(
                new vscode.Range(lineIndex, startChar, lineIndex, endChar),
                `Filename is missing token "${token}" listed in this control file.`,
                vscode.DiagnosticSeverity.Warning
            ));
        }
    }
}
