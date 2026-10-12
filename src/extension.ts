import * as path from 'path';
import * as vscode from 'vscode';
import { IgnoreCodeActionProvider } from './codeActions';
import {
    refreshDiagnostics,
    getTrackedDependencyPaths,
    updateDiagnosticsForChangedPath,
    removeDiagnosticsForDocument,
    scheduleDiagnosticsUpdate,
    updateDiagnostics
} from './diagnostics';
import { IfStatementFormattingProvider } from './formatter';

export function activate(context: vscode.ExtensionContext) {
    const collection = vscode.languages.createDiagnosticCollection('tuflow');
    context.subscriptions.push(collection);

    // A directory-level watcher is shared by all references in that folder.
    // This avoids one native watcher per file in large TUFLOW models.
    const watchers = new Map<string, vscode.FileSystemWatcher>();
    let reconcileTimer: ReturnType<typeof setTimeout> | undefined;
    const reconcileWatchers = () => {
        const dependencies = getTrackedDependencyPaths();
        const directories = new Set([...dependencies].map(file => path.dirname(file)));
        for (const [directory, watcher] of watchers) {
            if (!directories.has(directory)) {
                watcher.dispose();
                watchers.delete(directory);
            }
        }
        for (const directory of directories) {
            if (watchers.has(directory)) {
                continue;
            }
            const watcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(directory, '*')
            );
            const onFileEvent = (uri: vscode.Uri) => {
                if (!getTrackedDependencyPaths().has(path.normalize(uri.fsPath))) {
                    return;
                }
                updateDiagnosticsForChangedPath(uri.fsPath, collection);
                scheduleWatcherReconcile();
            };
            watcher.onDidCreate(onFileEvent, undefined, context.subscriptions);
            watcher.onDidChange(onFileEvent, undefined, context.subscriptions);
            watcher.onDidDelete(onFileEvent, undefined, context.subscriptions);
            watchers.set(directory, watcher);
        }
    };
    function scheduleWatcherReconcile() {
        if (reconcileTimer) {
            clearTimeout(reconcileTimer);
        }
        reconcileTimer = setTimeout(() => {
            reconcileTimer = undefined;
            reconcileWatchers();
        }, 450);
    }

    context.subscriptions.push({
        dispose: () => {
            if (reconcileTimer) {
                clearTimeout(reconcileTimer);
            }
            for (const watcher of watchers.values()) {
                watcher.dispose();
            }
            watchers.clear();
        }
    });

    void refreshDiagnostics(collection).then(scheduleWatcherReconcile);

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(doc => {
            updateDiagnostics(doc, collection);
            scheduleWatcherReconcile();
        }),
        vscode.workspace.onDidChangeTextDocument(event => {
            scheduleDiagnosticsUpdate(event.document, collection);
            scheduleWatcherReconcile();
        }),
        vscode.workspace.onDidCloseTextDocument(doc => {
            removeDiagnosticsForDocument(doc, collection);
            scheduleWatcherReconcile();
        }),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (
                event.affectsConfiguration('tuflowValidator.diagnosticLevel') ||
                event.affectsConfiguration('tuflowValidator.enableLatestVersionChecks') ||
                event.affectsConfiguration('tuflowValidator.enableIfStatementChecks')
            ) {
                void refreshDiagnostics(collection).then(scheduleWatcherReconcile);
            }
        })
    );

    const selector: vscode.DocumentSelector = [
        { language: 'tuflow' },
        { pattern: '**/*.{tcf,tgc,tbc,trd,tef,ecf,qcf,tesf,tscf,trfc,toc}' }
    ];
    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(
            selector,
            new IgnoreCodeActionProvider(),
            { providedCodeActionKinds: IgnoreCodeActionProvider.providedCodeActionKinds }
        )
    );

    context.subscriptions.push(
        vscode.languages.registerDocumentFormattingEditProvider(
            selector,
            new IfStatementFormattingProvider()
        )
    );
}

export function deactivate() {}
