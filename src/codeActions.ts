import * as vscode from 'vscode';

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
        // Filter diagnostics to only those relevant to this extension
        const diagnostics = context.diagnostics.filter(diagnostic => {
            return diagnostic.message.includes('File not found') ||
                   diagnostic.message.includes('Referenced file has') ||
                   diagnostic.message.includes('Filename is missing token') ||
                   diagnostic.message.includes('not the latest version') ||
                   diagnostic.message.includes('Unable to determine');
        });

        if (diagnostics.length === 0) {
            return;
        }

        const actions: vscode.CodeAction[] = [];

        // 1. Ignore this line: Append "! tpf-ignore" to the end of the line (or inject into existing comment)
        const lineFix = new vscode.CodeAction('Ignore this line (TUFLOW)', vscode.CodeActionKind.QuickFix);
        lineFix.edit = new vscode.WorkspaceEdit();
        const line = document.lineAt(range.start.line);
        const text = line.text;
        const commentIndex = text.indexOf('!');

        if (commentIndex >= 0) {
            // Insert ' tpf-ignore' after the exclamation mark to ensure it's the first token in the comment
            lineFix.edit.insert(document.uri, new vscode.Position(range.start.line, commentIndex + 1), ' tpf-ignore');
        } else {
            // No existing comment, append one at the end of the line
            lineFix.edit.insert(document.uri, line.range.end, ' ! tpf-ignore');
        }
        lineFix.diagnostics = diagnostics;
        actions.push(lineFix);

        // 2. Ignore entire file: Insert "! tpf-ignore-file" at the very beginning of the document
        const fileFix = new vscode.CodeAction('Ignore entire file (TUFLOW)', vscode.CodeActionKind.QuickFix);
        fileFix.edit = new vscode.WorkspaceEdit();
        fileFix.edit.insert(document.uri, new vscode.Position(0, 0), '! tpf-ignore-file\n');
        fileFix.diagnostics = diagnostics;
        actions.push(fileFix);

        return actions;
    }
}
