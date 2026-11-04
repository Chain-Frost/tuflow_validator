import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    getConfiguredDiagnosticLevel,
    getConfiguredIfStatementChecksEnabled,
    getConfiguredGeoPackageLayerChecksEnabled
} from './config';
import { CONTROL_FILE_EXTENSIONS, ISSUE_SUMMARY_SEVERITY } from './constants';
import { safeReadFile } from './io';
import { applyStaticVariableDefinition, expandStaticVariables } from './staticVariables';
import { createTpvDiagnostic, TPV_CODES } from './diagnosticCodes';
import { containsUnresolvedToken, extractPathCandidates, extractGisReferences, isGeoPackageInputCommand,
    isLikelyFile, normalizeKey, resolvePath, shouldSkipKeyForFileLookup } from './pathParsing';
import { SpatialDatabaseScope } from './spatialDatabase';
import { addUncheckedDatabaseDiagnostic, checkGeoPackageLayers, implicitLayer } from './geopackageDiagnostics';
import { createGeoPackageInventoryPass, invalidateGeoPackage } from './geopackageInventory';
import {
    buildLatestCheckContext,
    checkReferencedFileLatestVersion,
    checkScenarioEventTokensInValue,
    checkVersionTokenInFilename,
    LatestCheckContext,
    shouldCheckLatestReferencedVersions
} from './versioning';

let rootDiagnosticsByRoot = new Map<string, Map<string, vscode.Diagnostic[]>>();
const rootDependenciesByRoot = new Map<string, Set<string>>();
let mergedFiles = new Set<string>();
const rootGenerations = new Map<string, number>();
const pendingAnalyses = new Map<string, { generation: number; dependencies: Set<string> }>();
const dependenciesChanged = new vscode.EventEmitter<void>();
export const onDidChangeDependencies = dependenciesChanged.event;
const pendingDiagnosticUpdates = new Map<string, ReturnType<typeof setTimeout>>();
const pendingAffectedRoots = new Map<string, Set<string>>();
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

export async function updateDiagnostics(
    document: vscode.TextDocument, collection: vscode.DiagnosticCollection, additionalRoots: Set<string> = new Set()
): Promise<void> {
    if (!shouldProcessDocument(document)) {
        return;
    }

    clearPendingDiagnosticUpdate(document);
    const rootKey = document.uri.toString();
    const affectedRootKeys = findRootKeysAffectedByDocument(document);
    for (const key of additionalRoots) {
        affectedRootKeys.add(key);
    }
    affectedRootKeys.add(rootKey);
    invalidateRoots(affectedRootKeys);

    for (const affectedRootKey of affectedRootKeys) {
        const rootDocument = findOpenDocumentByUri(affectedRootKey);
        if (!rootDocument || !shouldProcessDocument(rootDocument)) {
            rootDiagnosticsByRoot.delete(affectedRootKey);
            continue;
        }

        await updateRootDiagnostics(rootDocument);
    }

    rebuildMergedDiagnostics(collection);
}

export function scheduleDiagnosticsUpdate(document: vscode.TextDocument, collection: vscode.DiagnosticCollection): void {
    if (!shouldProcessDocument(document)) {
        return;
    }

    const documentKey = document.uri.toString();
    const affected = findRootKeysAffectedByDocument(document);
    for (const key of pendingAffectedRoots.get(documentKey) ?? []) {
        affected.add(key);
    }
    clearPendingDiagnosticUpdate(document);
    affected.add(documentKey);
    pendingAffectedRoots.set(documentKey, affected);
    invalidateRoots(affected);
    const timeout = setTimeout(() => {
        pendingDiagnosticUpdates.delete(documentKey);
        pendingAffectedRoots.delete(documentKey);
        void updateDiagnostics(document, collection, affected);
    }, DIAGNOSTIC_UPDATE_DEBOUNCE_MS);
    pendingDiagnosticUpdates.set(documentKey, timeout);
}

export async function removeDiagnosticsForDocument(document: vscode.TextDocument, collection: vscode.DiagnosticCollection): Promise<void> {
    clearPendingDiagnosticUpdate(document);
    const rootKey = document.uri.toString();
    const affectedRootKeys = findRootKeysAffectedByDocument(document);
    affectedRootKeys.add(rootKey);
    invalidateRoots(affectedRootKeys);

    if (rootDiagnosticsByRoot.has(rootKey)) {
        rootDiagnosticsByRoot.delete(rootKey);
    }
    rootDependenciesByRoot.delete(rootKey);

    for (const affectedRootKey of affectedRootKeys) {
        if (affectedRootKey === rootKey) {
            continue;
        }

        const rootDocument = findOpenDocumentByUri(affectedRootKey);
        if (!rootDocument || !shouldProcessDocument(rootDocument)) {
            rootDiagnosticsByRoot.delete(affectedRootKey);
            continue;
        }

        await updateRootDiagnostics(rootDocument);
    }

    rebuildMergedDiagnostics(collection);
}

export async function refreshDiagnostics(collection: vscode.DiagnosticCollection): Promise<void> {
    clearPendingDiagnosticUpdates();
    invalidateGeoPackage();
    invalidateRoots(new Set(rootGenerations.keys()));
    const documents = await collectDocumentsForRefresh();
    const activeRoots = new Set(documents.map(document => document.uri.toString()));
    for (const root of rootDiagnosticsByRoot.keys()) {
        if (!activeRoots.has(root)) {
            rootDiagnosticsByRoot.delete(root);
            rootDependenciesByRoot.delete(root);
        }
    }
    await Promise.all(documents.map(updateRootDiagnostics));
    rebuildMergedDiagnostics(collection);
}

async function updateRootDiagnostics(document: vscode.TextDocument): Promise<void> {
    const key = document.uri.toString();
    const generation = (rootGenerations.get(key) ?? 0) + 1;
    rootGenerations.set(key, generation);
    const version = document.version;
    const dependencies = new Set<string>();
    pendingAnalyses.set(key, { generation, dependencies });
    const isCurrent = () => rootGenerations.get(key) === generation && !document.isClosed && document.version === version;
    const result = await computeDiagnosticsForDocument(document, dependencies, isCurrent);
    // Slow network/catalog reads must never overwrite a newer edit, close or setting toggle.
    if (rootGenerations.get(key) === generation && !document.isClosed && document.version === version) {
        rootDiagnosticsByRoot.set(key, result.files);
        rootDependenciesByRoot.set(key, result.dependencies);
        dependenciesChanged.fire();
    }
    if (pendingAnalyses.get(key)?.generation === generation) {
        pendingAnalyses.delete(key);
    }
}

function invalidateRoots(roots: Set<string>): void {
    for (const key of roots) {
        rootGenerations.set(key, (rootGenerations.get(key) ?? 0) + 1);
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

export function normalizeDependencyPath(filePath: string): string {
    const normalized = path.normalize(filePath);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/** Revalidate only open roots that depend on a changed file-system path. */
export function updateDiagnosticsForChangedPath(
    filePath: string,
    collection: vscode.DiagnosticCollection
): boolean {
    const key = normalizeDependencyPath(filePath);
    invalidateGeoPackage(key.replace(/-(?:wal|shm|journal)$/i, ''));
    let updated = false;
    for (const [root, dependencies] of rootDependenciesByRoot.entries()) {
        if (!dependencies.has(key)) {
            continue;
        }
        const document = findOpenDocumentByUri(root);
        if (document && shouldProcessDocument(document)) {
            void updateRootDiagnostics(document).then(() => rebuildMergedDiagnostics(collection));
            updated = true;
        }
    }
    if (updated) {
        rebuildMergedDiagnostics(collection);
    }
    return updated;
}

async function computeDiagnosticsForDocument(
    document: vscode.TextDocument, dependencies: Set<string>, isCurrent: () => boolean
): Promise<{
    files: Map<string, vscode.Diagnostic[]>; dependencies: Set<string>
}> {
    const severityLevel = getConfiguredDiagnosticLevel();
    const diagnosticsByFile = await analyzeRootDocument(document, dependencies, isCurrent);
    const filteredByFile = new Map<string, vscode.Diagnostic[]>();

    for (const [filePath, diagnostics] of diagnosticsByFile.entries()) {
        filteredByFile.set(filePath, filterDiagnosticsByLevel(diagnostics, severityLevel));
    }

    return { files: filteredByFile, dependencies };
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
    const filePath = normalizeDependencyPath(document.fileName);

    for (const [rootKey, diagnosticsByFile] of rootDiagnosticsByRoot.entries()) {
        if (diagnosticsByFile.has(path.normalize(document.fileName)) || rootDependenciesByRoot.get(rootKey)?.has(filePath)) {
            affectedRootKeys.add(rootKey);
        }
    }
    for (const [rootKey, analysis] of pendingAnalyses) {
        if (analysis.dependencies.has(filePath)) {
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
    pendingAffectedRoots.delete(documentKey);
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
    pendingAffectedRoots.clear();
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

function getOpenDocumentForPath(filePath: string): vscode.TextDocument | undefined {
    const normalizedPath = normalizeDependencyPath(filePath);
    return vscode.workspace.textDocuments.find(document => normalizeDependencyPath(document.fileName) === normalizedPath);
}

function getControlFileContents(filePath: string): string | null {
    const openDocument = getOpenDocumentForPath(filePath);
    if (openDocument && shouldProcessDocument(openDocument)) {
        return openDocument.getText();
    }

    return safeReadFile(filePath);
}

/**
 * Entry point for analyzing the root document.
 * Initializes context and starts analysis.
 *
 * @param document - The root document opened by the user.
 * @returns A map of file paths to their diagnostics.
 */
async function analyzeRootDocument(
    document: vscode.TextDocument, dependencies: Set<string>, isCurrent: () => boolean
): Promise<Map<string, vscode.Diagnostic[]>> {
    const visited = new Map<string, vscode.Diagnostic[]>();
    const rootPath = document.fileName;
    const latestCheckContext = buildLatestCheckContext(document);
    const enabled = getConfiguredGeoPackageLayerChecksEnabled();
    const context: GeoPackageValidationContext = {
        enabled,
        inspect: createGeoPackageInventoryPass(),
        existingPaths: new Map(),
        isCurrent,
        scope: SpatialDatabaseScope.root(path.extname(rootPath).toLowerCase() === '.tcf')
    };
    await analyzeFile(rootPath, document.getText(), visited, latestCheckContext, undefined,
        new Map<string, string>(), dependencies, new Set(), false, context);
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
interface GeoPackageValidationContext {
    enabled: boolean;
    inspect: ReturnType<typeof createGeoPackageInventoryPass>;
    existingPaths: Map<string, boolean>;
    isCurrent: () => boolean;
    scope: SpatialDatabaseScope;
}

async function analyzeFile(
    filePath: string,
    contents: string,
    visited: Map<string, vscode.Diagnostic[]>,
    latestCheckContext: LatestCheckContext,
    sourceTcfDirectory?: string,
    staticVariables: Map<string, string> = new Map(),
    dependencies: Set<string> = new Set(),
    recursionStack: Set<string> = new Set(),
    inheritedConditional = false,
    geoPackage?: GeoPackageValidationContext
): Promise<vscode.Diagnostic[]> {
    const normalizedPath = path.normalize(filePath);
    // Repeated includes may use different variable values. Only stop cycles
    // along the active recursion path; don't memoise solely by filename.
    if (recursionStack.has(normalizedPath)) {
        return [];
    }
    recursionStack.add(normalizedPath);
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
    let eventDepth = 0;
    let domainDepth = 0;
    const defineEvents: boolean[] = [];
    const layerChecks = geoPackage?.enabled === true;
    // Ignored content may contain database assignments or inline includes.
    // Do not retain false certainty in the caller after declining to inspect it.
    if (layerChecks && lines.some(line => /^\s*!\s*tpv-ignore-file/.test(line))) {
        geoPackage.scope.uncertain('an ignored control file may change the active database', true);
        staticVariables.clear();
        visited.set(normalizedPath, []);
        recursionStack.delete(normalizedPath);
        return [];
    }
    const shouldCheckLatestReferencedFiles = shouldCheckLatestReferencedVersions(
        normalizedPath,
        diagnostics,
        latestCheckContext
    );

    for (let i = 0; i < lines.length; i++) {
        if (geoPackage && !geoPackage.isCurrent()) {
            break;
        }
        const text = lines[i];

        // Check for file-level ignore comment: "! tpv-ignore-file"
        // This MUST be the first thing checked to effectively skip the whole file.
        if (text.trim().startsWith('!')) {
            const commentContent = text.trim().slice(1).trim();
            if (commentContent.startsWith('tpv-ignore-file')) {
                // If we find a file-level ignore, we clear all diagnostics and memoize an empty result.
                diagnostics.length = 0;
                visited.set(normalizedPath, []);
                recursionStack.delete(normalizedPath);
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
        if (/^\s*define\b/i.test(commandText)) {
            const event = /^\s*define\s+event\b/i.test(commandText);
            defineEvents.push(event);
            if (event) {
                eventDepth++;
            }
        } else if (/^\s*end\s*define\b/i.test(commandText)) {
            if (defineEvents.pop()) {
                eventDepth = Math.max(0, eventDepth - 1);
            }
        }
        if (/^\s*start\s+[12]d\s+domain\b/i.test(commandText)) {
            domainDepth++;
        } else if (/^\s*end\s*[12]d\s*domain\b/i.test(commandText)) {
            domainDepth = Math.max(0, domainDepth - 1);
        }

        const separatorIndex = text.indexOf('==');
        if (separatorIndex === -1) {
            continue;
        }

        const valueStartIndex = separatorIndex + 2;
        const valueWithComment = text.slice(valueStartIndex);
        const commentIndex = layerChecks ? unquotedCommentIndex(valueWithComment) : valueWithComment.indexOf('!');

        // Check for line-level ignore comment: "Command == Path ! tpv-ignore"
        if (commentIndex >= 0) {
            const commentContent = valueWithComment.slice(commentIndex + 1).trim();
            if (commentContent.startsWith('tpv-ignore')) {
                if (layerChecks) {
                    applyStaticVariableDefinition(text.slice(0, separatorIndex).trim(), '', true, staticVariables);
                }
                if (layerChecks && /^(?:SPATIAL\s+DATABASE|READ\s+FILE|.*CONTROL\s+FILE|EVENT\s+FILE)$/i
                    .test(text.slice(0, separatorIndex).trim())) {
                    geoPackage.scope.uncertain('an ignored assignment or include may change the active database', true);
                    if (isControlFileCommand(normalizeKey(text.slice(0, separatorIndex)))) {
                        staticVariables.clear();
                    }
                }
                continue;
            }
        }

        const valueText = commentIndex >= 0 ? valueWithComment.slice(0, commentIndex) : valueWithComment;
        const keyText = text.slice(0, separatorIndex).trim();

        const runtimeDependent = inheritedConditional || conditionalDepth > 0 ||
            (layerChecks && (eventDepth > 0 || domainDepth > 0));
        applyStaticVariableDefinition(keyText, valueText, runtimeDependent, staticVariables);

        if (isTcf) {
            checkVersionTokenInFilename(keyText, valueText, valueStartIndex, i, normalizedPath, diagnostics);
            checkScenarioEventTokensInValue(valueText, valueStartIndex, i, normalizedPath, diagnostics);
        }

        if (layerChecks && /^1D\s+(?:SPATIAL\s+DATABASE|READ\s+FILE|.*CONTROL\s+FILE|EVENT\s+FILE)$/i.test(keyText)) {
            geoPackage.scope.uncertain('a prefixed 1D command has a database context that is not interpreted', true);
            staticVariables.clear();
            continue;
        }

        if (shouldSkipKeyForFileLookup(keyText) && !(layerChecks && isGeoPackageInputCommand(keyText))) {
            continue;
        }

        const key = normalizeKey(keyText);
        const gisInput = layerChecks && isGeoPackageInputCommand(keyText);
        const databaseAssignment = layerChecks && key === 'SPATIAL DATABASE';
        const references = gisInput || databaseAssignment
            ? extractGisReferences(valueText, valueStartIndex, i) : undefined;
        const candidates = references ? references.map(reference => reference.path)
            : extractPathCandidates(valueText, valueStartIndex, i);

        if (databaseAssignment) {
            const expanded = candidates.length === 1
                ? expandStaticVariables(candidates[0].text, staticVariables) : null;
            const command = expanded?.trim().toUpperCase();
            if (runtimeDependent) {
                geoPackage.scope.uncertain('Spatial Database depends on a runtime branch', command === 'OFF' || expanded === null);
            } else if (command === 'OFF') {
                geoPackage.scope.off();
                continue;
            } else if (command === 'TCF') {
                geoPackage.scope.useTcf();
                continue;
            } else if (expanded !== null && path.extname(expanded).toLowerCase() === '.gpkg') {
                geoPackage.scope.assign({ kind: 'database', filePath: resolvePath(pathBaseDirectory, expanded) });
            } else {
                geoPackage.scope.uncertain('Spatial Database is not statically resolvable', true);
                if (candidates[0]) {
                    addUncheckedDatabaseDiagnostic(diagnostics, candidates[0].range,
                        'Spatial Database is not statically resolvable');
                }
            }
            if (command === 'OFF' || command === 'TCF') {
                continue;
            }
        }

        for (const candidate of candidates) {
            if (geoPackage && !geoPackage.isCurrent()) {
                break;
            }
            // Static variables may form part of a path. Runtime -s/-e tokens
            // and unknown definitions are never guessed or treated as absent files.
            const expanded = expandStaticVariables(candidate.text, staticVariables);
            const reference = references?.find(item => item.path === candidate);
            if (gisInput && reference && !reference.explicit &&
                (expanded === null || !isStandaloneGisPath(expanded))) {
                const selection = geoPackage.scope.active();
                if (selection.kind === 'database') {
                    trackGeoPackageDependencies(selection.filePath, dependencies);
                    // A missing assigned database is diagnosed at its declaration.
                    // A dynamic layer must not be reinterpreted as a standalone file.
                    if (geoPackageExists(selection.filePath, geoPackage)) {
                        await checkGeoPackageLayers(selection.filePath,
                            [candidate, ...reference.layers], candidate.range, staticVariables,
                            diagnostics, geoPackage.inspect);
                    }
                } else if (expanded !== null) {
                    addUncheckedDatabaseDiagnostic(diagnostics, candidate.range,
                        selection.kind === 'unknown' ? selection.reason : 'no unambiguous Spatial Database is active');
                }
                continue;
            }
            if (expanded === null || !isLikelyFile(expanded) || containsUnresolvedToken(expanded)) {
                if (layerChecks && isControlFileCommand(key)) {
                    geoPackage.scope.uncertain('an unresolved control-file reference may change the database', true);
                    staticVariables.clear();
                }
                continue;
            }

            const resolvedPath = resolvePath(pathBaseDirectory, expanded);
            dependencies.add(normalizeDependencyPath(resolvedPath));
            const exists = layerChecks && path.extname(resolvedPath).toLowerCase() === '.gpkg'
                ? geoPackageExists(resolvedPath, geoPackage) : fs.existsSync(resolvedPath);
            if (!exists) {
                diagnostics.push(createTpvDiagnostic(
                    candidate.range,
                    `File not found: ${candidate.text}`,
                    vscode.DiagnosticSeverity.Error,
                    TPV_CODES.missingFile
                ));
                if (layerChecks && isControlFileCommand(key)) {
                    geoPackage.scope.uncertain('a missing control file may change the database', true);
                    staticVariables.clear();
                }
                continue;
            }

            if (layerChecks && reference && path.extname(resolvedPath).toLowerCase() === '.gpkg') {
                trackGeoPackageDependencies(resolvedPath, dependencies);
                const selectors = reference.explicit ? reference.layers
                    : [implicitLayer(resolvedPath, candidate.range), ...reference.layers];
                await checkGeoPackageLayers(resolvedPath, selectors, candidate.range,
                    staticVariables, diagnostics, geoPackage.inspect, databaseAssignment);
            }

            if (shouldCheckLatestReferencedFiles) {
                checkReferencedFileLatestVersion(
                    resolvedPath,
                    candidate.range,
                    diagnostics
                );
            }

            if (layerChecks && isControlFileCommand(key) && !CONTROL_FILE_EXTENSIONS.has(path.extname(resolvedPath).toLowerCase())) {
                geoPackage.scope.uncertain('an include with an unsupported control-file extension may change the database', true);
                staticVariables.clear();
            }

            // Recursive check for referenced control files
            if (CONTROL_FILE_EXTENSIONS.has(path.extname(resolvedPath).toLowerCase())) {
                const childContents = getControlFileContents(resolvedPath);
                if (childContents === null) {
                    if (layerChecks) {
                        geoPackage.scope.uncertain('an unreadable control file may change the database', true);
                        staticVariables.clear();
                    }
                    continue;
                }

                const childConditional = runtimeDependent;
                const childVariables = childConditional
                    ? new Map(staticVariables)
                    : staticVariables;
                const childDiagnostics = await analyzeFile(
                    resolvedPath,
                    childContents,
                    visited,
                    latestCheckContext,
                    activeTcfDirectory,
                    childVariables,
                    dependencies,
                    recursionStack,
                    childConditional,
                    geoPackage ? { ...geoPackage, scope: geoPackage.scope.child(
                        path.extname(resolvedPath).toLowerCase() === '.tcf', normalizeKey(keyText) === 'READ FILE'
                    ) } : undefined
                );
                if (layerChecks && childConditional) {
                    for (const [name, value] of staticVariables) {
                        if (childVariables.get(name) !== value) {
                            staticVariables.delete(name);
                        }
                    }
                }
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

    const combined = visited.get(normalizedPath) ?? [];
    const seen = new Set(combined.map(diagnosticFingerprint));
    for (const diagnostic of diagnostics) {
        const key = diagnosticFingerprint(diagnostic);
        if (!seen.has(key)) {
            combined.push(diagnostic);
            seen.add(key);
        }
    }
    visited.set(normalizedPath, combined);
    recursionStack.delete(normalizedPath);
    return diagnostics;
}

function isStandaloneGisPath(value: string): boolean {
    return /[\\/]/.test(value) || /\.(?:gpkg|shp|mif|mid|tiff?|flt|asc|adf|nc|csv|txt|xml|12da|tin)$/i.test(value);
}

function isControlFileCommand(key: string): boolean {
    return key === 'READ FILE' || /(?:CONTROL FILE|EVENT FILE|EXTERNAL STRESS FILE)$/.test(key);
}

function trackGeoPackageDependencies(filePath: string, dependencies: Set<string>): void {
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
        dependencies.add(normalizeDependencyPath(filePath + suffix));
    }
}

function geoPackageExists(filePath: string, context: GeoPackageValidationContext): boolean {
    const key = normalizeDependencyPath(filePath);
    const previous = context.existingPaths.get(key);
    if (previous !== undefined) {
        return previous;
    }
    const exists = fs.existsSync(filePath);
    context.existingPaths.set(key, exists);
    return exists;
}

function unquotedCommentIndex(value: string): number {
    let quote = '';
    for (let index = 0; index < value.length; index++) {
        const character = value[index];
        if (quote) {
            if (character === quote) {
                if (value[index + 1] === quote) {
                    index++;
                } else {
                    quote = '';
                }
            }
        } else if (character === '"' || character === "'") {
            quote = character;
        } else if (character === '!') {
            return index;
        }
    }
    return -1;
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
