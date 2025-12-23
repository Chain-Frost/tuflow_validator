import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

const CONTROL_FILE_EXTENSIONS = new Set(['.tcf', '.tgc', '.tbc', '.trd', '.tef', '.ecf', '.qcf']);
const ISSUE_SUMMARY_SEVERITY = vscode.DiagnosticSeverity.Warning;
const lastFilesByRoot = new Map<string, Set<string>>();

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
            checkXfFilesIncludeTokens(keyText, valueText, valueStartIndex, i, normalizedPath, diagnostics);
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

function checkXfFilesIncludeTokens(
    keyText: string,
    valueText: string,
    valueStartIndex: number,
    lineIndex: number,
    filePath: string,
    diagnostics: vscode.Diagnostic[]
): void {
    if (normalizeKey(keyText) !== 'XF FILES INCLUDE IN FILENAME') {
        return;
    }

    const baseName = path.basename(filePath);
    const tokenRegex = /<<([^>]+)>>/g;
    let match: RegExpExecArray | null;

    while ((match = tokenRegex.exec(valueText)) !== null) {
        const token = match[1].trim();
        if (!token) {
            continue;
        }

        if (!baseName.includes(token)) {
            const startChar = valueStartIndex + match.index;
            const endChar = startChar + match[0].length;
            diagnostics.push(new vscode.Diagnostic(
                new vscode.Range(lineIndex, startChar, lineIndex, endChar),
                `Filename is missing token "${token}" required by XF Files Include in Filename.`,
                vscode.DiagnosticSeverity.Error
            ));
        }
    }
}

function getConfiguredDiagnosticLevel(): string {
    const config = vscode.workspace.getConfiguration('tuflowValidator');
    return (config.get<string>('diagnosticLevel') || 'warning').toLowerCase();
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
