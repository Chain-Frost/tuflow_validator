import * as vscode from 'vscode';

/** Stable codes allow Quick Fixes and users to target a specific rule. */
export const TPV_SOURCE = 'TUFLOW Path Validator';
export const TPV_CODES = {
    missingFile: 'TPV001',
    childIssues: 'TPV002',
    missingEnd: 'TPV010',
    unexpectedEnd: 'TPV011',
    invalidElse: 'TPV012',
    missingFilenameToken: 'TPV020',
    versionToken: 'TPV021',
    outdatedVersion: 'TPV022'
} as const;

export type TpvCode = typeof TPV_CODES[keyof typeof TPV_CODES];

export function createTpvDiagnostic(
    range: vscode.Range,
    message: string,
    severity: vscode.DiagnosticSeverity,
    code: TpvCode
): vscode.Diagnostic {
    const diagnostic = new vscode.Diagnostic(range, message, severity);
    diagnostic.source = TPV_SOURCE;
    diagnostic.code = code;
    return diagnostic;
}
