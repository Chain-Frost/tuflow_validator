import * as vscode from 'vscode';

export function getConfiguredDiagnosticLevel(): string {
    const config = vscode.workspace.getConfiguration('tuflowValidator');
    return (config.get<string>('diagnosticLevel') || 'hint').toLowerCase();
}

export function getConfiguredLatestVersionChecksEnabled(): boolean {
    const config = vscode.workspace.getConfiguration('tuflowValidator');
    return config.get<boolean>('enableLatestVersionChecks', true);
}

export function getConfiguredAnalyzeAllControlFilesEnabled(): boolean {
    const config = vscode.workspace.getConfiguration('tuflowValidator');
    return config.get<boolean>('analyzeAllControlFiles', false);
}
