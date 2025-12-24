import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// Supported control file types for diagnostics/recursion.
const CONTROL_FILE_EXTENSIONS = new Set(['.tcf', '.tgc', '.tbc', '.trd', '.ecf', '.qcf', '.tef']);
// Severity used when summarizing child-file issues on the parent reference line.
const ISSUE_SUMMARY_SEVERITY = vscode.DiagnosticSeverity.Warning;
// Tracks which files were last updated for each root doc so we can clear stale diagnostics.
const lastFilesByRoot = new Map<string, Set<string>>();
// Extensions eligible for latest-version checks (control files only; data files are excluded). Data files are checked elsewhere.
const LATEST_CHECK_CONTROL_EXTENSIONS = new Set(['.tcf', '.tgc', '.tbc', '.trd', '.ecf', '.qcf']);
// Matches scenario/event tokens embedded in filenames (e.g. ~s1~, ~e4~).
const SCENARIO_EVENT_TOKEN_REGEX = /~[se][1-9]~/gi;

export function activate(context: vscode.ExtensionContext) {
    const collection = vscode.languages.createDiagnosticCollection('tuflow');
    context.subscriptions.push(collection);

    if (vscode.window.activeTextEditor) {
        updateDiagnostics(vscode.window.activeTextEditor.document, collection);
    }

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(doc => updateDiagnostics(doc, collection)),
        vscode.workspace.onDidChangeTextDocument(event => updateDiagnostics(event.document, collection)),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (
                event.affectsConfiguration('tuflowValidator.diagnosticLevel') ||
                event.affectsConfiguration('tuflowValidator.enableLatestVersionChecks')
            ) {
                refreshDiagnostics(collection);
            }
        })
    );

    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(
            { scheme: 'file', language: 'tuflow' },
            new IgnoreCodeActionProvider(),
            { providedCodeActionKinds: IgnoreCodeActionProvider.providedCodeActionKinds }
        )
    );
    // Also register for our supported extensions if language ID is not strictly 'tuflow'
    // Since document selector can take an array or filter. 
    // The previous logic checked extensions manually.
    // For simplicity, let's register for all files and let the provider filter or use a specific selector.
    // Actually, VS Code usually requires a language ID or specific patterns.
    // Let's use a document selector that matches our files.
    const selector: vscode.DocumentSelector = [
        { language: 'tuflow' },
        { pattern: '**/*.{tcf,tgc,tbc,trd,tef,ecf,qcf}' }
    ];
    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(
            selector,
            new IgnoreCodeActionProvider(),
            { providedCodeActionKinds: IgnoreCodeActionProvider.providedCodeActionKinds }
        )
    );
}

function updateDiagnostics(document: vscode.TextDocument, collection: vscode.DiagnosticCollection): void {
    if (!shouldProcessDocument(document)) {
        return;
    }

    const severityLevel = getConfiguredDiagnosticLevel();

    const rootKey = document.uri.toString();
    const previousFiles = lastFilesByRoot.get(rootKey);
    if (previousFiles) {
        for (const filePath of previousFiles) {
            collection.delete(vscode.Uri.file(filePath));
        }
    }

    const diagnosticsByFile = analyzeRootDocument(document);
    const updatedFiles = new Set<string>();

    for (const [filePath, diagnostics] of diagnosticsByFile.entries()) {
        const filtered = filterDiagnosticsByLevel(diagnostics, severityLevel);
        collection.set(vscode.Uri.file(filePath), filtered);
        updatedFiles.add(filePath);
    }

    lastFilesByRoot.set(rootKey, updatedFiles);
}

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
function isLikelyFile(value: string): boolean {
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
 * Determines if a document should be processed by this extension.
 * Checks language ID and file extension.
 * 
 * @param document - The VS Code TextDocument.
 * @returns True if the document is a supported TUFLOW control file.
 */
function shouldProcessDocument(document: vscode.TextDocument): boolean {
    if (document.languageId === 'tuflow') {
        return true;
    }

    return CONTROL_FILE_EXTENSIONS.has(path.extname(document.fileName).toLowerCase());
}

/**
 * Entry point for analyzing the root document.
 * Initializes context and starts analysis.
 * 
 * @param document - The root document opened by the user.
 * @returns A map of file paths to their diagnostics.
 */
function analyzeRootDocument(document: vscode.TextDocument): Map<string, vscode.Diagnostic[]> {
    const visited = new Map<string, vscode.Diagnostic[]>();
    const rootPath = document.fileName;
    const latestCheckContext = buildLatestCheckContext(document);
    analyzeFile(rootPath, document.getText(), visited, latestCheckContext);
    return visited;
}

/**
 * Analyzes a single file for path validation issues.
 * This is the core logic function that parses the file content line by line.
 * 
 * @param filePath - The absolute path of the file to analyze.
 * @param contents - The raw text content of the file.
 * @param visited - A map of visited file paths to their diagnostics (memoization/recursion tracking).
 * @param latestCheckContext - Context for checking latest version status of referenced files.
 * @returns An array of diagnostics found in the file.
 */
function analyzeFile(
    filePath: string,
    contents: string,
    visited: Map<string, vscode.Diagnostic[]>,
    latestCheckContext: LatestCheckContext
): vscode.Diagnostic[] {
    const normalizedPath = path.normalize(filePath);
    const cached = visited.get(normalizedPath);
    if (cached) {
        return cached;
    }

    const diagnostics: vscode.Diagnostic[] = [];
    visited.set(normalizedPath, diagnostics);

    const lines = contents.split(/\r?\n/);
    const docDir = path.dirname(normalizedPath);
    const isTcf = path.extname(normalizedPath).toLowerCase() === '.tcf';
    const shouldCheckLatestReferencedFiles = shouldCheckLatestReferencedVersions(
        normalizedPath,
        diagnostics,
        latestCheckContext
    );

    for (let i = 0; i < lines.length; i++) {
        const text = lines[i];

        // Check for file-level ignore comment: "! tpf-ignore-file"
        // This MUST be the first thing checked to effectively skip the whole file.
        if (text.trim().startsWith('!')) {
            const commentContent = text.trim().slice(1).trim();
            if (commentContent.startsWith('tpf-ignore-file')) {
                // If we find a file-level ignore, we clear all diagnostics and memoize an empty result.
                diagnostics.length = 0;
                visited.set(normalizedPath, []);
                return [];
            }
            continue;
        }

        if (text.trim().length === 0) {
            continue;
        }

        const separatorIndex = text.indexOf('==');
        if (separatorIndex === -1) {
            continue;
        }

        const valueStartIndex = separatorIndex + 2;
        const valueWithComment = text.slice(valueStartIndex);
        const commentIndex = valueWithComment.indexOf('!');
        
        // Check for line-level ignore comment: "Command == Path ! tpf-ignore"
        if (commentIndex >= 0) {
            const commentContent = valueWithComment.slice(commentIndex + 1).trim();
            if (commentContent.startsWith('tpf-ignore')) {
                continue;
            }
        }

        const valueText = commentIndex >= 0 ? valueWithComment.slice(0, commentIndex) : valueWithComment;
        const keyText = text.slice(0, separatorIndex).trim();

        if (isTcf) {
            checkVersionTokenInFilename(keyText, valueText, valueStartIndex, i, normalizedPath, diagnostics);
            checkScenarioEventTokensInValue(valueText, valueStartIndex, i, normalizedPath, diagnostics);
        }

        if (shouldSkipKeyForFileLookup(keyText)) {
            continue;
        }

        const candidates = extractPathCandidates(valueText, valueStartIndex, i);
        for (const candidate of candidates) {
            if (!isLikelyFile(candidate.text) || containsUnresolvedToken(candidate.text)) {
                continue;
            }

            const resolvedPath = resolvePath(docDir, candidate.text);
            if (!fs.existsSync(resolvedPath)) {
                diagnostics.push(new vscode.Diagnostic(
                    candidate.range,
                    `File not found: ${candidate.text}`,
                    vscode.DiagnosticSeverity.Error
                ));
                continue;
            }

            if (shouldCheckLatestReferencedFiles) {
                checkReferencedFileLatestVersion(
                    resolvedPath,
                    candidate.range,
                    diagnostics
                );
            }

            // Recursive check for referenced control files
            if (CONTROL_FILE_EXTENSIONS.has(path.extname(resolvedPath).toLowerCase())) {
                const childContents = safeReadFile(resolvedPath);
                if (childContents === null) {
                    continue;
                }

                const childDiagnostics = analyzeFile(resolvedPath, childContents, visited, latestCheckContext);
                if (childDiagnostics.length > 0) {
                    diagnostics.push(new vscode.Diagnostic(
                        candidate.range,
                        `Referenced file has ${childDiagnostics.length} issue(s): ${path.basename(resolvedPath)}`,
                        ISSUE_SUMMARY_SEVERITY
                    ));
                }
            }
        }
    }

    return diagnostics;
}

/**
 * Determines if a specific key should be skipped during file lookup.
 * Certain TUFLOW commands (like PAUSE or events) do not reference files in the standard way.
 * 
 * @param keyText - The command key (left side of '==').
 * @returns True if the key should be ignored, false otherwise.
 */
function shouldSkipKeyForFileLookup(keyText: string): boolean {
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
function normalizeKey(keyText: string): string {
    return keyText.replace(/\s+/g, ' ').trim().toUpperCase();
}

/**
 * Context required for performing latest version checks across the workspace.
 */
interface LatestCheckContext {
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
function buildLatestCheckContext(document: vscode.TextDocument): LatestCheckContext {
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
function shouldCheckLatestReferencedVersions(
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

function checkReferencedFileLatestVersion(
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

function checkVersionTokenInFilename(
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

function checkScenarioEventTokensInValue(
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

function getConfiguredDiagnosticLevel(): string {
    const config = vscode.workspace.getConfiguration('tuflowValidator');
    return (config.get<string>('diagnosticLevel') || 'hint').toLowerCase();
}

function getConfiguredLatestVersionChecksEnabled(): boolean {
    const config = vscode.workspace.getConfiguration('tuflowValidator');
    return config.get<boolean>('enableLatestVersionChecks', true);
}

function filterDiagnosticsByLevel(
    diagnostics: vscode.Diagnostic[],
    level: string
): vscode.Diagnostic[] {
    if (level === 'none') {
        return [];
    }

    const threshold = severityRank(level);
    if (threshold === null) {
        return diagnostics;
    }

    return diagnostics.filter(diagnostic => severityRankValue(diagnostic.severity) <= threshold);
}

function severityRank(level: string): number | null {
    switch (level) {
        case 'error':
            return 0;
        case 'warning':
            return 1;
        case 'info':
        case 'information':
            return 2;
        case 'hint':
            return 3;
        default:
            return null;
    }
}

function severityRankValue(severity: vscode.DiagnosticSeverity): number {
    switch (severity) {
        case vscode.DiagnosticSeverity.Error:
            return 0;
        case vscode.DiagnosticSeverity.Warning:
            return 1;
        case vscode.DiagnosticSeverity.Information:
            return 2;
        case vscode.DiagnosticSeverity.Hint:
            return 3;
        default:
            return 2;
    }
}

function refreshDiagnostics(collection: vscode.DiagnosticCollection): void {
    for (const document of vscode.workspace.textDocuments) {
        updateDiagnostics(document, collection);
    }
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
function extractPathCandidates(valueText: string, valueStartIndex: number, lineIndex: number): Array<{ text: string; range: vscode.Range }> {
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
function resolvePath(baseDir: string, rawPath: string): string {
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
function containsUnresolvedToken(value: string): boolean {
    return value.includes('<<') || value.includes('>>');
}

/**
 * safely reads a file's content, returning null on failure (e.g. file not found).
 * 
 * @param filePath - The absolute path of the file.
 * @returns The file content as a string, or null if reading failed.
 */
function safeReadFile(filePath: string): string | null {
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch {
        return null;
    }
}

export function deactivate() {}

/**
 * Provides Quick Fix code actions for TUFLOW diagnostics.
 * Offers options to ignore errors on a specific line or for the entire file.
 */
export class IgnoreCodeActionProvider implements vscode.CodeActionProvider {
    /**
     * The kinds of code actions provided by this provider.
     */
    public static readonly providedCodeActionKinds = [
        vscode.CodeActionKind.QuickFix
    ];

    /**
     * Computes code actions for the given range in the document.
     * 
     * @param document - The document in which the command was invoked.
     * @param range - The range for which the command was invoked.
     * @param context - The context for the code action, including diagnostics.
     * @param token - A cancellation token.
     * @returns An array of CodeActions or undefined if none are applicable.
     */
    provideCodeActions(document: vscode.TextDocument, range: vscode.Range | vscode.Selection, context: vscode.CodeActionContext, token: vscode.CancellationToken): vscode.ProviderResult<(vscode.Command | vscode.CodeAction)[]> {
        // Filter diagnostics to only those relevant to this extension
        const diagnostics = context.diagnostics.filter(diagnostic => {
            return diagnostic.message.includes('File not found') || 
                   diagnostic.message.includes('Referenced file has') ||
                   diagnostic.message.includes('Filename is missing token') ||
                   diagnostic.message.includes('not the latest version') ||
                   diagnostic.message.includes('Unable to determine');
        });

        if (diagnostics.length === 0) {
            return;
        }

        const actions: vscode.CodeAction[] = [];

        // 1. Ignore this line: Append "! tpf-ignore" to the end of the line (or inject into existing comment)
        const lineFix = new vscode.CodeAction('Ignore this line (TUFLOW)', vscode.CodeActionKind.QuickFix);
        lineFix.edit = new vscode.WorkspaceEdit();
        const line = document.lineAt(range.start.line);
        const text = line.text;
        const commentIndex = text.indexOf('!');
        
        if (commentIndex >= 0) {
           // Insert ' tpf-ignore' after the exclamation mark to ensure it's the first token in the comment
           lineFix.edit.insert(document.uri, new vscode.Position(range.start.line, commentIndex + 1), ' tpf-ignore');
        } else {
            // No existing comment, append one at the end of the line
            lineFix.edit.insert(document.uri, line.range.end, ' ! tpf-ignore');
        }
        lineFix.diagnostics = diagnostics;
        actions.push(lineFix);

        // 2. Ignore entire file: Insert "! tpf-ignore-file" at the very beginning of the document
        const fileFix = new vscode.CodeAction('Ignore entire file (TUFLOW)', vscode.CodeActionKind.QuickFix);
        fileFix.edit = new vscode.WorkspaceEdit();
        fileFix.edit.insert(document.uri, new vscode.Position(0, 0), '! tpf-ignore-file\n');
        fileFix.diagnostics = diagnostics;
        actions.push(fileFix);

        return actions;
    }
}
