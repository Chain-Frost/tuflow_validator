import * as vscode from 'vscode';
import { IgnoreCodeActionProvider } from './codeActions';
import { refreshDiagnostics, removeDiagnosticsForDocument, updateDiagnostics } from './diagnostics';
import { IfStatementFormattingProvider } from './formatter';

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
                event.affectsConfiguration('tuflowValidator.enableIfStatementChecks') ||
                event.affectsConfiguration('tuflowValidator.analyzeAllControlFiles')
            ) {
                void refreshDiagnostics(collection);
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
