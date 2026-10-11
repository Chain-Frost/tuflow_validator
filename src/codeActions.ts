import * as vscode from 'vscode';
import { TPV_CODES, TPV_SOURCE } from './diagnosticCodes';

/**
 * Provides Quick Fix code actions for TUFLOW diagnostics.
 * Offers options to ignore errors on a specific line or for the entire file.
 */
export class IgnoreCodeActionProvider implements vscode.CodeActionProvider {
    /**
     * The kinds of code actions provided by this provider.
     */
    public static readonly providedCodeActionKinds = [
        vscode.CodeActionKind.QuickFix
    ];

    /**
     * Computes code actions for the given range in the document.
     *
     * @param document - The document in which the command was invoked.
     * @param range - The range for which the command was invoked.
     * @param context - The context for the code action, including diagnostics.
     * @param token - A cancellation token.
     * @returns An array of CodeActions or undefined if none are applicable.
     */
    provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<(vscode.Command | vscode.CodeAction)[]> {
        // Codes, rather than human-readable messages, identify our diagnostics.
        // Other extensions' diagnostics must never offer TUFLOW-specific fixes.
        const ignorableCodes: ReadonlySet<string> = new Set([
            TPV_CODES.missingFile,
            TPV_CODES.childIssues,
            TPV_CODES.missingFilenameToken,
            TPV_CODES.outdatedVersion
        ]);
        const diagnostics = context.diagnostics.filter(diagnostic =>
            diagnostic.source === TPV_SOURCE &&
            ignorableCodes.has(getDiagnosticCode(diagnostic))
        );

        if (diagnostics.length === 0) {
            return;
        }

        const actions: vscode.CodeAction[] = [];

        // 1. Ignore this line: Append "! tpv-ignore" to the end of the line (or inject into existing comment)
        const lineFix = new vscode.CodeAction('Ignore this line (TUFLOW)', vscode.CodeActionKind.QuickFix);
        lineFix.edit = new vscode.WorkspaceEdit();
        const line = document.lineAt(range.start.line);
        const text = line.text;
        const commentIndex = text.indexOf('!');

        if (commentIndex >= 0) {
            // Insert ' tpv-ignore' after the exclamation mark to ensure it's the first token in the comment
            lineFix.edit.insert(document.uri, new vscode.Position(range.start.line, commentIndex + 1), ' tpv-ignore');
        } else {
            // No existing comment, append one at the end of the line
            lineFix.edit.insert(document.uri, line.range.end, ' ! tpv-ignore');
        }
        lineFix.diagnostics = diagnostics;
        actions.push(lineFix);

        // 2. Ignore entire file: Insert "! tpv-ignore-file" at the very beginning of the document
        const fileFix = new vscode.CodeAction('Ignore entire file (TUFLOW)', vscode.CodeActionKind.QuickFix);
        fileFix.edit = new vscode.WorkspaceEdit();
        fileFix.edit.insert(document.uri, new vscode.Position(0, 0), '! tpv-ignore-file\n');
        fileFix.diagnostics = diagnostics;
        actions.push(fileFix);

        for (const diagnostic of diagnostics) {
            if (getDiagnosticCode(diagnostic) !== TPV_CODES.outdatedVersion) {
                continue;
            }
            const updatedText = buildLatestVersionReplacement(document, diagnostic);
            if (!updatedText) {
                continue;
            }

            const latestFix = new vscode.CodeAction('Update to latest version (TUFLOW)', vscode.CodeActionKind.QuickFix);
            latestFix.edit = new vscode.WorkspaceEdit();
            latestFix.edit.replace(document.uri, diagnostic.range, updatedText);
            latestFix.diagnostics = [diagnostic];
            actions.push(latestFix);
        }

        return actions;
    }
}

function getDiagnosticCode(diagnostic: vscode.Diagnostic): string {
    const code = diagnostic.code;
    if (typeof code === 'string' || typeof code === 'number') {
        return String(code);
    }
    return code && 'value' in code ? String(code.value) : '';
}

/** Use only an existing replacement file from the version rule's metadata. */
function buildLatestVersionReplacement(
    document: vscode.TextDocument,
    diagnostic: vscode.Diagnostic
): string | null {
    const code = diagnostic.code;
    if (!code || typeof code !== 'object' || !('target' in code)) {
        return null;
    }

    const original = document.getText(diagnostic.range);
    const index = Math.max(original.lastIndexOf('/'), original.lastIndexOf('\\'));
    const oldName = original.slice(index + 1);
    const newName = code.target.path.split('/').pop();
    if (!oldName || !newName || newName === oldName) {
        return null;
    }
    // The source diagnostic was calculated using file-system discovery; do not
    // silently change other path segments or re-infer which number is a version.
    return original.slice(0, index + 1) + newName;
}
