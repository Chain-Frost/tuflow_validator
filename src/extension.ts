import * as vscode from 'vscode';
import { IgnoreCodeActionProvider } from './codeActions';
import {
    refreshDiagnostics,
    getTrackedWatchDirectories,
    updateDiagnosticsForChangedPath,
    removeDiagnosticsForDocument,
    scheduleDiagnosticsUpdate,
    updateDiagnostics
} from './diagnostics';
import { IfStatementFormattingProvider } from './formatter';

export function activate(context: vscode.ExtensionContext) {
    const collection = vscode.languages.createDiagnosticCollection('tuflow');
    context.subscriptions.push(collection);

    // One watcher and exactly three owned listeners per directory, shared
    // by all roots. An unreferenced version sibling is a relevant directory
    // event even though it is not yet a file dependency.
    interface DirectoryWatcher {
        watcher: vscode.FileSystemWatcher;
        listeners: vscode.Disposable[];
    }
    const watchers = new Map<string, DirectoryWatcher>();
    let reconcileTimer: ReturnType<typeof setTimeout> | undefined;

    const disposeWatcher = (directory: string): void => {
        const entry = watchers.get(directory);
        if (!entry) {
            return;
        }
        for (const listener of entry.listeners) {
            listener.dispose();
        }
        entry.watcher.dispose();
        watchers.delete(directory);
    };

    const reconcileWatchers = () => {
        const directories = getTrackedWatchDirectories();
        for (const directory of watchers.keys()) {
            if (!directories.has(directory)) {
                disposeWatcher(directory);
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
                // The handler checks exact missing/present dependencies, latest
                // TCF discovery and current version series per root. Unrelated
                // directory events do not trigger reanalysis.
                if (updateDiagnosticsForChangedPath(uri.fsPath, collection)) {
                    scheduleWatcherReconcile();
                }
            };
            const listeners = [
                watcher.onDidCreate(onFileEvent),
                watcher.onDidChange(onFileEvent),
                watcher.onDidDelete(onFileEvent)
            ];
            watchers.set(directory, { watcher, listeners });
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
            for (const directory of watchers.keys()) {
                disposeWatcher(directory);
            }
        }
    });

    void refreshDiagnostics(collection).then(scheduleWatcherReconcile);

    // Explicit recovery when the host's native filesystem watcher cannot
    // deliver notifications (e.g. remote files opened outside a workspace).
    // Do not mask unsupported native watchers with unbounded network polling.
    context.subscriptions.push(vscode.commands.registerCommand(
        'tuflowValidator.refreshDiagnostics',
        async () => {
            await refreshDiagnostics(collection);
            scheduleWatcherReconcile();
        }
    ));

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(doc => {
            updateDiagnostics(doc, collection);
            scheduleWatcherReconcile();
        }),
        vscode.workspace.onDidChangeTextDocument(event => {
            scheduleDiagnosticsUpdate(event.document, collection);
            scheduleWatcherReconcile();
        }),
        vscode.workspace.onDidSaveTextDocument(doc => {
            updateDiagnostics(doc, collection);
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
        { pattern: '**/*.{tcf,tgc,tbc,trd,erd,rdf,adcf,tef,ecf,qcf,tesf,tscf,trfc,toc}' }
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
