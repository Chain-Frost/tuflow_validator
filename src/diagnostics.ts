import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { getConfiguredAnalyzeAllControlFilesEnabled, getConfiguredDiagnosticLevel } from './config';
import { CONTROL_FILE_EXTENSIONS, ISSUE_SUMMARY_SEVERITY } from './constants';
import { safeReadFile } from './io';
import { containsUnresolvedToken, extractPathCandidates, isLikelyFile, resolvePath, shouldSkipKeyForFileLookup } from './pathParsing';
import {
    buildLatestCheckContext,
    checkReferencedFileLatestVersion,
    checkScenarioEventTokensInValue,
    checkVersionTokenInFilename,
    LatestCheckContext,
    shouldCheckLatestReferencedVersions
} from './versioning';

let rootDiagnosticsByRoot = new Map<string, Map<string, vscode.Diagnostic[]>>();
let mergedFiles = new Set<string>();

export function updateDiagnostics(document: vscode.TextDocument, collection: vscode.DiagnosticCollection): void {
    if (!shouldProcessDocument(document)) {
        return;
    }

    const rootKey = document.uri.toString();
    rootDiagnosticsByRoot.set(rootKey, computeDiagnosticsForDocument(document));
    rebuildMergedDiagnostics(collection);
}

export function removeDiagnosticsForDocument(document: vscode.TextDocument, collection: vscode.DiagnosticCollection): void {
    const rootKey = document.uri.toString();
    if (!rootDiagnosticsByRoot.has(rootKey)) {
        return;
    }
    rootDiagnosticsByRoot.delete(rootKey);
    rebuildMergedDiagnostics(collection);
}

export async function refreshDiagnostics(collection: vscode.DiagnosticCollection): Promise<void> {
    const documents = await collectDocumentsForRefresh();
    const nextRootDiagnostics = new Map<string, Map<string, vscode.Diagnostic[]>>();

    for (const document of documents) {
        if (!shouldProcessDocument(document)) {
            continue;
        }
        nextRootDiagnostics.set(document.uri.toString(), computeDiagnosticsForDocument(document));
    }

    rootDiagnosticsByRoot = nextRootDiagnostics;
    rebuildMergedDiagnostics(collection);
}

function computeDiagnosticsForDocument(document: vscode.TextDocument): Map<string, vscode.Diagnostic[]> {
    const severityLevel = getConfiguredDiagnosticLevel();
    const diagnosticsByFile = analyzeRootDocument(document);
    const filteredByFile = new Map<string, vscode.Diagnostic[]>();

    for (const [filePath, diagnostics] of diagnosticsByFile.entries()) {
        filteredByFile.set(filePath, filterDiagnosticsByLevel(diagnostics, severityLevel));
    }

    return filteredByFile;
}

function rebuildMergedDiagnostics(collection: vscode.DiagnosticCollection): void {
    const merged = new Map<string, vscode.Diagnostic[]>();

    for (const diagnosticsByFile of rootDiagnosticsByRoot.values()) {
        for (const [filePath, diagnostics] of diagnosticsByFile.entries()) {
            const existing = merged.get(filePath);
            if (existing) {
                existing.push(...diagnostics);
            } else {
                merged.set(filePath, [...diagnostics]);
            }
        }
    }

    for (const filePath of mergedFiles) {
        if (!merged.has(filePath)) {
            collection.delete(vscode.Uri.file(filePath));
        }
    }

    for (const [filePath, diagnostics] of merged.entries()) {
        collection.set(vscode.Uri.file(filePath), diagnostics);
    }

    mergedFiles = new Set(merged.keys());
}

async function collectDocumentsForRefresh(): Promise<vscode.TextDocument[]> {
    const documents = new Map<string, vscode.TextDocument>();

    for (const document of vscode.workspace.textDocuments) {
        if (shouldProcessDocument(document)) {
            documents.set(document.uri.toString(), document);
        }
    }

    if (!getConfiguredAnalyzeAllControlFilesEnabled()) {
        return [...documents.values()];
    }

    const pattern = '**/*.{tcf,tgc,tbc,trd,tef,ecf,qcf}';
    const exclude = '**/{node_modules,.git,out,dist,.vscode-test}/**';
    const uris = await vscode.workspace.findFiles(pattern, exclude);

    for (const uri of uris) {
        if (documents.has(uri.toString())) {
            continue;
        }
        try {
            const document = await vscode.workspace.openTextDocument(uri);
            documents.set(uri.toString(), document);
        } catch {
            continue;
        }
    }

    return [...documents.values()];
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
