import * as vscode from 'vscode';
import { IgnoreCodeActionProvider } from './codeActions';
import { refreshDiagnostics, removeDiagnosticsForDocument, updateDiagnostics } from './diagnostics';

export function activate(context: vscode.ExtensionContext) {
    const collection = vscode.languages.createDiagnosticCollection('tuflow');
    context.subscriptions.push(collection);

    void refreshDiagnostics(collection);

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(doc => updateDiagnostics(doc, collection)),
        vscode.workspace.onDidChangeTextDocument(event => updateDiagnostics(event.document, collection)),
        vscode.workspace.onDidCloseTextDocument(doc => removeDiagnosticsForDocument(doc, collection)),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (
                event.affectsConfiguration('tuflowValidator.diagnosticLevel') ||
                event.affectsConfiguration('tuflowValidator.enableLatestVersionChecks') ||
                event.affectsConfiguration('tuflowValidator.analyzeAllControlFiles')
            ) {
                void refreshDiagnostics(collection);
            }
        })
    );

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

export function deactivate() {}
