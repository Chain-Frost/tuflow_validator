import * as vscode from 'vscode';

export function getConfiguredDiagnosticLevel(): string {
    const config = vscode.workspace.getConfiguration('tuflowValidator');
    return (config.get<string>('diagnosticLevel') || 'hint').toLowerCase();
}

export function getConfiguredLatestVersionChecksEnabled(): boolean {
    const config = vscode.workspace.getConfiguration('tuflowValidator');
    return config.get<boolean>('enableLatestVersionChecks', true);
}

export function getConfiguredIfStatementChecksEnabled(): boolean {
    const config = vscode.workspace.getConfiguration('tuflowValidator');
    return config.get<boolean>('enableIfStatementChecks', true);
}

export function getConfiguredIfStatementFormattingEnabled(): boolean {
    const config = vscode.workspace.getConfiguration('tuflowValidator');
    return config.get<boolean>('enableIfStatementFormatting', false);
}
