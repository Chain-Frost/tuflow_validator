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
        vscode.workspace.onDidChangeTextDocument(event => updateDiagnostics(event.document, collection))
    );
}

function updateDiagnostics(document: vscode.TextDocument, collection: vscode.DiagnosticCollection): void {
    if (!shouldProcessDocument(document)) {
        return;
    }

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
        collection.set(vscode.Uri.file(filePath), diagnostics);
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
