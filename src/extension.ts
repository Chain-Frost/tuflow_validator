import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

const CONTROL_FILE_EXTENSIONS = new Set(['.tcf', '.tgc', '.tbc', '.trd', '.tef', '.ecf', '.qcf']);
const ISSUE_SUMMARY_SEVERITY = vscode.DiagnosticSeverity.Warning;
const lastFilesByRoot = new Map<string, Set<string>>();
const LATEST_CHECK_CONTROL_EXTENSIONS = new Set(['.tcf', '.tgc', '.tbc', '.ecf']);
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
            if (event.affectsConfiguration('tuflowValidator.diagnosticLevel')) {
                refreshDiagnostics(collection);
            }
        })
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

function shouldProcessDocument(document: vscode.TextDocument): boolean {
    if (document.languageId === 'tuflow') {
        return true;
    }

    return CONTROL_FILE_EXTENSIONS.has(path.extname(document.fileName).toLowerCase());
}

function analyzeRootDocument(document: vscode.TextDocument): Map<string, vscode.Diagnostic[]> {
    const visited = new Map<string, vscode.Diagnostic[]>();
    const rootPath = document.fileName;
    analyzeFile(rootPath, document.getText(), visited);
    return visited;
}

function analyzeFile(filePath: string, contents: string, visited: Map<string, vscode.Diagnostic[]>): vscode.Diagnostic[] {
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
    const shouldCheckLatestReferencedFiles = shouldCheckLatestReferencedVersions(normalizedPath, diagnostics);

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
                checkReferencedFileLatestVersion(resolvedPath, candidate.range, diagnostics);
            }

            if (CONTROL_FILE_EXTENSIONS.has(path.extname(resolvedPath).toLowerCase())) {
                const childContents = safeReadFile(resolvedPath);
                if (childContents === null) {
                    continue;
                }

                const childDiagnostics = analyzeFile(resolvedPath, childContents, visited);
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

function normalizeKey(keyText: string): string {
    return keyText.replace(/\s+/g, ' ').trim().toUpperCase();
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

function shouldCheckLatestReferencedVersions(filePath: string, diagnostics: vscode.Diagnostic[]): boolean {
    const ext = path.extname(filePath).toLowerCase();
    if (!LATEST_CHECK_CONTROL_EXTENSIONS.has(ext)) {
        return false;
    }

    const status = getLatestVersionStatus(filePath);
    if (status.status === 'ambiguous') {
        diagnostics.push(new vscode.Diagnostic(
            new vscode.Range(0, 0, 0, 0),
            `Unable to determine latest version for "${path.basename(filePath)}" because multiple numeric tokens were found.`,
            vscode.DiagnosticSeverity.Warning
        ));
        return false;
    }

    return status.status === 'latest';
}

function checkReferencedFileLatestVersion(
    filePath: string,
    range: vscode.Range,
    diagnostics: vscode.Diagnostic[]
): void {
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
        diagnostics.push(new vscode.Diagnostic(
            range,
            `Referenced file is not the latest version in its folder: ${path.basename(filePath)} (found ${currentVersion}, latest ${latestVersion}).`,
            vscode.DiagnosticSeverity.Error
        ));
    }
}

function getLatestVersionStatus(filePath: string): LatestVersionResult {
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

    let entries: fs.Dirent[] = [];
    try {
        entries = fs.readdirSync(path.dirname(filePath), { withFileTypes: true });
    } catch {
        return { status: 'latest', currentVersion, latestVersion };
    }

    for (const entry of entries) {
        if (!entry.isFile()) {
            continue;
        }

        if (path.extname(entry.name).toLowerCase() !== ext) {
            continue;
        }

        const entryBaseName = path.basename(entry.name, ext);
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
        const prevChar = start > 0 ? baseName[start - 1] : '';
        const nextChar = end < baseName.length ? baseName[end] : '';
        const prevIsLetter = /[a-z]/i.test(prevChar);
        const nextIsLetter = /[a-z]/i.test(nextChar);
        const prevIsV = prevIsLetter && prevChar.toLowerCase() === 'v';

        if (!nextIsLetter && (!prevIsLetter || prevIsV)) {
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

function resolvePath(baseDir: string, rawPath: string): string {
    const normalized = rawPath.replace(/\\/g, '/');
    if (path.isAbsolute(normalized) || path.win32.isAbsolute(normalized)) {
        return normalized;
    }

    return path.resolve(baseDir, normalized);
}

function containsUnresolvedToken(value: string): boolean {
    return value.includes('<<') || value.includes('>>');
}

function safeReadFile(filePath: string): string | null {
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch {
        return null;
    }
}

export function deactivate() {}
