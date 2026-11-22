import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    getConfiguredDiagnosticLevel,
    getConfiguredIfStatementChecksEnabled,
    getConfiguredLatestVersionChecksEnabled
} from './config';
import { CONTROL_FILE_EXTENSIONS, ISSUE_SUMMARY_SEVERITY } from './constants';
import { ControlTextReader, createControlTextSnapshotReader, pathIdentity, readControlTextSnapshot } from './io';
import { applyStaticVariableDefinition, expandStaticVariables } from './staticVariables';
import { createTpvDiagnostic, TPV_CODES } from './diagnosticCodes';
import { containsUnresolvedToken, extractPathCandidates, getInputFileRole, isControlTextInput, isLikelyFile, resolvePath } from './pathParsing';
import {
    buildLatestCheckContext,
    checkReferencedFileLatestVersion,
    checkScenarioEventTokensInValue,
    checkVersionTokenInFilename,
    LatestCheckContext,
    isVersionSeriesCandidate,
    shouldCheckLatestReferencedVersions
} from './versioning';

let rootDiagnosticsByRoot = new Map<string, Map<string, vscode.Diagnostic[]>>();
const rootDependenciesByRoot = new Map<string, Set<string>>();
/** Filenames whose existing version series is consulted for each open root. */
const versionSearchPathsByRoot = new Map<string, Set<string>>();
/** Run directories whose .tcf listing affects latest-run eligibility. */
const tcfSearchFoldersByRoot = new Map<string, Set<string>>();
let mergedFiles = new Set<string>();
let isRefreshing = false;
const pendingDiagnosticUpdates = new Map<string, ReturnType<typeof setTimeout>>();
const DIAGNOSTIC_UPDATE_DEBOUNCE_MS = 300;
const IF_STATEMENT_REGEX = /^\s*if\b\s+(event|scenario)\s*==/i;
const ELSE_IF_REGEX = /^\s*else\b\s+if\b\s+(event|scenario)\s*==/i;
const ELSE_REGEX = /^\s*else\b(?!\s*if\b)/i;
const END_IF_REGEX = /^\s*end\b\s*if\b/i;
const DEFINE_EVENT_REGEX = /^\s*define\b\s+event\b/i;
const END_DEFINE_REGEX = /^\s*end\b\s+define\b/i;
const START_1D_DOMAIN_REGEX = /^\s*start\b\s+1d\b\s+domain\b/i;
const END_1D_DOMAIN_REGEX = /^\s*end\b\s+1d\b\s+domain\b/i;
const START_2D_DOMAIN_REGEX = /^\s*start\b\s+2d\b\s+domain\b/i;
const END_2D_DOMAIN_REGEX = /^\s*end\b\s+2d\b\s+domain\b/i;

type BlockKind = 'if' | 'define-event' | 'start-1d-domain' | 'start-2d-domain';

interface BlockEntry {
    kind: BlockKind;
    range: vscode.Range;
    message: string;
    hasElse?: boolean;
}

export function updateDiagnostics(document: vscode.TextDocument, collection: vscode.DiagnosticCollection): void {
    const isControlDocument = shouldProcessDocument(document);
    const affectedRootKeys = findRootKeysAffectedByDocument(document);
    // Read File may include arbitrary-suffix plaintext. Its dirty text must
    // revalidate parent roots without promoting the file to a root itself.
    if (!isControlDocument && affectedRootKeys.size === 0) {
        return;
    }

    clearPendingDiagnosticUpdate(document);
    const rootKey = document.uri.toString();
    if (isControlDocument) {
        affectedRootKeys.add(rootKey);
    }

    for (const affectedRootKey of affectedRootKeys) {
        const rootDocument = findOpenDocumentByUri(affectedRootKey);
        if (!rootDocument || !shouldProcessDocument(rootDocument)) {
            forgetRoot(affectedRootKey);
            continue;
        }

        rootDiagnosticsByRoot.set(affectedRootKey, computeDiagnosticsForDocument(rootDocument));
    }

    rebuildMergedDiagnostics(collection);
}

export function scheduleDiagnosticsUpdate(document: vscode.TextDocument, collection: vscode.DiagnosticCollection): void {
    if (!shouldProcessDocument(document) && findRootKeysAffectedByDocument(document).size === 0) {
        return;
    }

    clearPendingDiagnosticUpdate(document);
    const documentKey = document.uri.toString();
    const timeout = setTimeout(() => {
        pendingDiagnosticUpdates.delete(documentKey);
        updateDiagnostics(document, collection);
    }, DIAGNOSTIC_UPDATE_DEBOUNCE_MS);
    pendingDiagnosticUpdates.set(documentKey, timeout);
}

export function removeDiagnosticsForDocument(document: vscode.TextDocument, collection: vscode.DiagnosticCollection): void {
    clearPendingDiagnosticUpdate(document);
    const rootKey = document.uri.toString();
    const affectedRootKeys = findRootKeysAffectedByDocument(document);

    forgetRoot(rootKey);

    for (const affectedRootKey of affectedRootKeys) {
        if (affectedRootKey === rootKey) {
            continue;
        }

        const rootDocument = findOpenDocumentByUri(affectedRootKey);
        if (!rootDocument || !shouldProcessDocument(rootDocument)) {
            forgetRoot(affectedRootKey);
            continue;
        }

        rootDiagnosticsByRoot.set(affectedRootKey, computeDiagnosticsForDocument(rootDocument));
    }

    rebuildMergedDiagnostics(collection);
}

export async function refreshDiagnostics(collection: vscode.DiagnosticCollection): Promise<void> {
    isRefreshing = true;
    try {
        clearPendingDiagnosticUpdates();
        const documents = await collectDocumentsForRefresh();
        const nextRootDiagnostics = new Map<string, Map<string, vscode.Diagnostic[]>>();

        for (const document of documents) {
            if (!shouldProcessDocument(document)) {
                continue;
            }
            nextRootDiagnostics.set(document.uri.toString(), computeDiagnosticsForDocument(document));
        }

        rootDiagnosticsByRoot = nextRootDiagnostics;
        const activeRoots = new Set(nextRootDiagnostics.keys());
        for (const root of new Set([
            ...rootDependenciesByRoot.keys(),
            ...versionSearchPathsByRoot.keys(),
            ...tcfSearchFoldersByRoot.keys()
        ])) {
            if (!activeRoots.has(root)) {
                forgetRoot(root);
            }
        }
        rebuildMergedDiagnostics(collection);
    } finally {
        isRefreshing = false;
    }
}

/**
 * Paths from active roots, including references to files which do not yet exist.
 * A disk watcher uses this graph rather than watching every GIS file in a model.
 */
export function getTrackedDependencyPaths(): Set<string> {
    const paths = new Set<string>();
    for (const deps of rootDependenciesByRoot.values()) {
        for (const dependency of deps) {
            paths.add(dependency);
        }
    }
    return paths;
}

/**
 * Watch each directory once, independently of whether any diagnostics exist.
 * The listener validates *events*, not directory contents; only affected roots
 * are reanalysed.
 */
export function getTrackedWatchDirectories(): Set<string> {
    const directories = new Set<string>();
    for (const dependency of getTrackedDependencyPaths()) {
        directories.add(pathIdentity(path.dirname(dependency)));
    }
    for (const sources of versionSearchPathsByRoot.values()) {
        for (const source of sources) {
            directories.add(pathIdentity(path.dirname(source)));
        }
    }
    for (const folders of tcfSearchFoldersByRoot.values()) {
        for (const folder of folders) {
            directories.add(folder);
        }
    }
    return directories;
}

/** Revalidate only roots affected by an exact file or relevant version sibling. */
export function updateDiagnosticsForChangedPath(
    filePath: string,
    collection: vscode.DiagnosticCollection
): boolean {
    const key = pathIdentity(filePath);
    const directory = pathIdentity(path.dirname(filePath));
    const tcfChanged = path.extname(filePath).toLowerCase() === '.tcf';
    let updated = false;

    for (const [root, dependencies] of rootDependenciesByRoot.entries()) {
        const inTcfDiscovery = tcfChanged && (tcfSearchFoldersByRoot.get(root)?.has(directory) ?? false);
        const versionSources = versionSearchPathsByRoot.get(root);
        const inVersionSeries = !dependencies.has(key) && !inTcfDiscovery &&
            (versionSources !== undefined && [...versionSources].some(source =>
                isVersionSeriesCandidate(source, filePath)
            ));
        if (!dependencies.has(key) && !inTcfDiscovery && !inVersionSeries) {
            continue;
        }

        const document = findOpenDocumentByUri(root);
        if (document && shouldProcessDocument(document)) {
            rootDiagnosticsByRoot.set(root, computeDiagnosticsForDocument(document));
        } else {
            forgetRoot(root);
        }
        updated = true;
    }

    if (updated) {
        rebuildMergedDiagnostics(collection);
    }
    return updated;
}

/** Remove all three root-owned contributions without affecting other roots. */
function forgetRoot(root: string): void {
    rootDiagnosticsByRoot.delete(root);
    rootDependenciesByRoot.delete(root);
    versionSearchPathsByRoot.delete(root);
    tcfSearchFoldersByRoot.delete(root);
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
    const seenByFile = new Map<string, Set<string>>();

    for (const diagnosticsByFile of rootDiagnosticsByRoot.values()) {
        for (const [filePath, diagnostics] of diagnosticsByFile.entries()) {
            let existing = merged.get(filePath);
            let seen = seenByFile.get(filePath);
            if (!existing) {
                existing = [];
                merged.set(filePath, existing);
            }
            if (!seen) {
                seen = new Set<string>();
                seenByFile.set(filePath, seen);
            }

            for (const diagnostic of diagnostics) {
                const key = diagnosticFingerprint(diagnostic);
                if (seen.has(key)) {
                    continue;
                }
                seen.add(key);
                existing.push(diagnostic);
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

function diagnosticFingerprint(diagnostic: vscode.Diagnostic): string {
    const range = diagnostic.range;
    const severity = diagnostic.severity;
    const message = diagnostic.message;
    const source = diagnostic.source ?? '';
    const code = diagnostic.code;
    let codeValue = '';
    if (typeof code === 'string' || typeof code === 'number') {
        codeValue = String(code);
    } else if (code && typeof code === 'object' && 'value' in code) {
        codeValue = String((code as { value: string | number }).value);
    }

    return [
        range.start.line,
        range.start.character,
        range.end.line,
        range.end.character,
        severity,
        source,
        codeValue,
        message
    ].join('|');
}

function findRootKeysAffectedByDocument(document: vscode.TextDocument): Set<string> {
    const affectedRootKeys = new Set<string>();
    if (document.uri.scheme !== 'file') {
        return affectedRootKeys;
    }
    const filePath = pathIdentity(document.fileName);
    // Diagnostics may be empty, but the dependency still needs revalidation.
    for (const [rootKey, dependencies] of rootDependenciesByRoot.entries()) {
        if (dependencies.has(filePath)) {
            affectedRootKeys.add(rootKey);
        }
    }
    return affectedRootKeys;
}

function findOpenDocumentByUri(uriString: string): vscode.TextDocument | undefined {
    return vscode.workspace.textDocuments.find(document => document.uri.toString() === uriString);
}

function clearPendingDiagnosticUpdate(document: vscode.TextDocument): void {
    const documentKey = document.uri.toString();
    const timeout = pendingDiagnosticUpdates.get(documentKey);
    if (!timeout) {
        return;
    }

    clearTimeout(timeout);
    pendingDiagnosticUpdates.delete(documentKey);
}

function clearPendingDiagnosticUpdates(): void {
    for (const timeout of pendingDiagnosticUpdates.values()) {
        clearTimeout(timeout);
    }
    pendingDiagnosticUpdates.clear();
}

async function collectDocumentsForRefresh(): Promise<vscode.TextDocument[]> {
    const documents = new Map<string, vscode.TextDocument>();

    for (const document of vscode.workspace.textDocuments) {
        if (shouldProcessDocument(document)) {
            documents.set(document.uri.toString(), document);
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
    const readText = createControlTextSnapshotReader();
    const latestCheckContext = buildLatestCheckContext(document, readText);
    // Root files and latest-TCF graph sources are dependencies even when clean.
    const dependencies = new Set<string>([pathIdentity(rootPath), ...latestCheckContext.discoveryPaths]);
    const versionSearchPaths = new Set<string>();
    analyzeFile(
        rootPath, document.getText(), visited, latestCheckContext, undefined,
        new Map<string, string>(), dependencies, new Set<string>(), false,
        versionSearchPaths, readText
    );
    const rootKey = document.uri.toString();
    rootDependenciesByRoot.set(rootKey, dependencies);
    versionSearchPathsByRoot.set(rootKey, versionSearchPaths);
    tcfSearchFoldersByRoot.set(rootKey, latestCheckContext.tcfSearchFolders);
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
    latestCheckContext: LatestCheckContext,
    sourceTcfDirectory?: string,
    staticVariables: Map<string, string> = new Map(),
    dependencies: Set<string> = new Set(),
    recursionStack: Set<string> = new Set(),
    inheritedConditional = false,
    versionSearchPaths: Set<string> = new Set(),
    readText: ControlTextReader = readControlTextSnapshot
): vscode.Diagnostic[] {
    const normalizedPath = path.normalize(filePath);
    const fileKey = pathIdentity(normalizedPath);
    if (getConfiguredLatestVersionChecksEnabled()) {
        versionSearchPaths.add(normalizedPath);
    }
    // Repeated includes may use different variable values. Only stop cycles
    // along the active recursion path; don't memoise solely by filename.
    if (recursionStack.has(fileKey)) {
        return [];
    }
    recursionStack.add(fileKey);
    const diagnostics: vscode.Diagnostic[] = [];

    const lines = contents.split(/\r?\n/);
    const docDir = path.dirname(normalizedPath);
    const extension = path.extname(normalizedPath).toLowerCase();
    const isTcf = extension === '.tcf';
    const activeTcfDirectory = isTcf ? docDir : sourceTcfDirectory;
    const pathBaseDirectory = extension === '.trd' && activeTcfDirectory
        ? activeTcfDirectory
        : docDir;
    const shouldCheckIfStatements = getConfiguredIfStatementChecksEnabled();
    const blockStack: BlockEntry[] = [];
    let conditionalDepth = 0;
    const shouldCheckLatestReferencedFiles = shouldCheckLatestReferencedVersions(
        normalizedPath,
        diagnostics,
        latestCheckContext
    );

    for (let i = 0; i < lines.length; i++) {
        const text = lines[i];

        // Check for file-level ignore comment: "! tpv-ignore-file"
        // This MUST be the first thing checked to effectively skip the whole file.
        if (text.trim().startsWith('!')) {
            const commentContent = text.trim().slice(1).trim();
            if (commentContent.startsWith('tpv-ignore-file')) {
                // If we find a file-level ignore, we clear all diagnostics and memoize an empty result.
                diagnostics.length = 0;
                visited.set(fileKey, []);
                recursionStack.delete(fileKey);
                return [];
            }
            continue;
        }

        if (text.trim().length === 0) {
            continue;
        }

        if (shouldCheckIfStatements) {
            updateBlockStack(text, i, blockStack, diagnostics);
        }
        const commandText = text.split('!')[0];
        if (/^\s*if\b/i.test(commandText)) {
            conditionalDepth++;
        } else if (/^\s*end\s*if\b/i.test(commandText)) {
            conditionalDepth = Math.max(0, conditionalDepth - 1);
        }

        const separatorIndex = text.indexOf('==');
        if (separatorIndex === -1) {
            continue;
        }

        const valueStartIndex = separatorIndex + 2;
        const valueWithComment = text.slice(valueStartIndex);
        const commentIndex = valueWithComment.indexOf('!');

        // Check for line-level ignore comment: "Command == Path ! tpv-ignore"
        if (commentIndex >= 0) {
            const commentContent = valueWithComment.slice(commentIndex + 1).trim();
            if (commentContent.startsWith('tpv-ignore')) {
                continue;
            }
        }

        const valueText = commentIndex >= 0 ? valueWithComment.slice(0, commentIndex) : valueWithComment;
        const keyText = text.slice(0, separatorIndex).trim();

        applyStaticVariableDefinition(keyText, valueText, inheritedConditional || conditionalDepth > 0, staticVariables);

        if (isTcf) {
            checkVersionTokenInFilename(keyText, valueText, valueStartIndex, i, normalizedPath, diagnostics);
            checkScenarioEventTokensInValue(valueText, valueStartIndex, i, normalizedPath, diagnostics);
        }

        const inputRole = getInputFileRole(keyText);
        if (inputRole === null) {
            continue;
        }

        const candidates = extractPathCandidates(valueText, valueStartIndex, i);
        for (const candidate of candidates) {
            // Static variables may form part of a path. Runtime -s/-e tokens
            // and unknown definitions are never guessed or treated as absent files.
            const expanded = expandStaticVariables(candidate.text, staticVariables);
            if (expanded === null || !isLikelyFile(expanded) || containsUnresolvedToken(expanded)) {
                continue;
            }

            const resolvedPath = resolvePath(pathBaseDirectory, expanded);
            dependencies.add(pathIdentity(resolvedPath));
            if (!fs.existsSync(resolvedPath)) {
                diagnostics.push(createTpvDiagnostic(
                    candidate.range,
                    `File not found: ${candidate.text}`,
                    vscode.DiagnosticSeverity.Error,
                    TPV_CODES.missingFile
                ));
                continue;
            }

            if (shouldCheckLatestReferencedFiles) {
                versionSearchPaths.add(path.normalize(resolvedPath));
                checkReferencedFileLatestVersion(
                    resolvedPath,
                    candidate.range,
                    diagnostics
                );
            }

            // A filename suffix never turns GIS, CSV or SWMM data into TUFLOW
            // command text. Control-file and Read File operands always do.
            if (isControlTextInput(inputRole)) {
                const childContents = readText(resolvedPath);
                if (childContents === null) {
                    continue;
                }

                const childConditional = inheritedConditional || conditionalDepth > 0;
                const childVariables = childConditional
                    ? new Map(staticVariables)
                    : staticVariables;
                const childDiagnostics = analyzeFile(
                    resolvedPath,
                    childContents,
                    visited,
                    latestCheckContext,
                    activeTcfDirectory,
                    childVariables,
                    dependencies,
                    recursionStack,
                    childConditional,
                    versionSearchPaths,
                    readText
                );
                if (childDiagnostics.length > 0) {
                    diagnostics.push(createTpvDiagnostic(
                        candidate.range,
                        `Referenced file has ${childDiagnostics.length} issue(s): ${path.basename(resolvedPath)}`,
                        ISSUE_SUMMARY_SEVERITY,
                        TPV_CODES.childIssues
                    ));
                }
            }
        }
    }

    if (shouldCheckIfStatements && blockStack.length > 0) {
        for (const entry of blockStack) {
            diagnostics.push(createTpvDiagnostic(
                entry.range,
                entry.message,
                vscode.DiagnosticSeverity.Error,
                TPV_CODES.missingEnd
            ));
        }
    }

    const combined = visited.get(fileKey) ?? [];
    const seen = new Set(combined.map(diagnosticFingerprint));
    for (const diagnostic of diagnostics) {
        const key = diagnosticFingerprint(diagnostic);
        if (!seen.has(key)) {
            combined.push(diagnostic);
            seen.add(key);
        }
    }
    visited.set(fileKey, combined);
    recursionStack.delete(fileKey);
    return diagnostics;
}

function updateBlockStack(
    line: string,
    lineIndex: number,
    stack: BlockEntry[],
    diagnostics: vscode.Diagnostic[]
): void {
    const commentIndex = line.indexOf('!');
    const lineContent = commentIndex >= 0 ? line.slice(0, commentIndex) : line;
    if (!lineContent.trim()) {
        return;
    }

    const startChar = /^\s*/.exec(lineContent)?.[0].length ?? 0;
    const rangeFor = (length: number) => new vscode.Range(lineIndex, startChar, lineIndex, startChar + length);
    const top = stack[stack.length - 1];

    const endings: Array<{ regex: RegExp; kind: BlockKind; label: string }> = [
        { regex: END_IF_REGEX, kind: 'if', label: 'End If' },
        { regex: END_DEFINE_REGEX, kind: 'define-event', label: 'End Define' },
        { regex: END_1D_DOMAIN_REGEX, kind: 'start-1d-domain', label: 'End 1D Domain' },
        { regex: END_2D_DOMAIN_REGEX, kind: 'start-2d-domain', label: 'End 2D Domain' }
    ];
    for (const ending of endings) {
        if (!ending.regex.test(lineContent)) {
            continue;
        }
        if (top?.kind === ending.kind) {
            stack.pop();
        } else {
            diagnostics.push(createTpvDiagnostic(
                rangeFor(ending.label.length),
                `Unexpected ${ending.label}: no matching opening block at this nesting level.`,
                vscode.DiagnosticSeverity.Error,
                TPV_CODES.unexpectedEnd
            ));
        }
        return;
    }

    if (ELSE_IF_REGEX.test(lineContent) || ELSE_REGEX.test(lineContent)) {
        const isElseIf = ELSE_IF_REGEX.test(lineContent);
        const label = isElseIf ? 'Else If' : 'Else';
        let message: string | null = null;

        if (top?.kind !== 'if') {
            message = `${label} does not have a matching open If block.`;
        } else if (top.hasElse) {
            message = isElseIf ? 'Else If cannot follow Else in the same If block.' : 'Duplicate Else in the same If block.';
        } else if (!isElseIf) {
            top.hasElse = true;
        }

        if (message) {
            diagnostics.push(createTpvDiagnostic(
                rangeFor(label.length),
                message,
                vscode.DiagnosticSeverity.Error,
                TPV_CODES.invalidElse
            ));
        }
        return;
    }

    if (IF_STATEMENT_REGEX.test(lineContent)) {
        stack.push({
            kind: 'if',
            range: rangeFor(2),
            message: 'If statement is missing a closing End If.',
            hasElse: false
        });
    } else if (DEFINE_EVENT_REGEX.test(lineContent)) {
        stack.push({
            kind: 'define-event',
            range: rangeFor(6),
            message: 'Define Event statement is missing a closing End Define.'
        });
    } else if (START_1D_DOMAIN_REGEX.test(lineContent)) {
        stack.push({
            kind: 'start-1d-domain',
            range: rangeFor(5),
            message: 'Start 1D Domain statement is missing a closing End 1D Domain.'
        });
    } else if (START_2D_DOMAIN_REGEX.test(lineContent)) {
        stack.push({
            kind: 'start-2d-domain',
            range: rangeFor(5),
            message: 'Start 2D Domain statement is missing a closing End 2D Domain.'
        });
    }
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
