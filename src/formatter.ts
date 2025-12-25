import * as vscode from 'vscode';
import { getConfiguredIfStatementFormattingEnabled } from './config';

const IF_STATEMENT_REGEX = /^\s*if\b\s+(event|scenario)\s*==/i;
const ELSE_IF_REGEX = /^\s*else\b\s+if\b\s+(event|scenario)\s*==/i;
const ELSE_REGEX = /^\s*else\b/i;
const END_IF_REGEX = /^\s*end\b\s*if\b/i;
const DEFINE_EVENT_REGEX = /^\s*define\b\s+event\b/i;
const END_DEFINE_REGEX = /^\s*end\b\s+define\b/i;
const START_1D_DOMAIN_REGEX = /^\s*start\b\s+1d\b\s+domain\b/i;
const END_1D_DOMAIN_REGEX = /^\s*end\b\s+1d\b\s+domain\b/i;
const START_2D_DOMAIN_REGEX = /^\s*start\b\s+2d\b\s+domain\b/i;
const END_2D_DOMAIN_REGEX = /^\s*end\b\s+2d\b\s+domain\b/i;

type BlockKind = 'if' | 'define-event' | 'start-1d-domain' | 'start-2d-domain';

interface BlockIndent {
    kind: BlockKind;
    indent: string;
}

export class IfStatementFormattingProvider implements vscode.DocumentFormattingEditProvider {
    provideDocumentFormattingEdits(
        document: vscode.TextDocument,
        options: vscode.FormattingOptions,
        token: vscode.CancellationToken
    ): vscode.TextEdit[] {
        if (!getConfiguredIfStatementFormattingEnabled()) {
            return [];
        }

        const edits: vscode.TextEdit[] = [];
        const indentStack: BlockIndent[] = [];

        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i);
            const text = line.text;
            const commentIndex = text.indexOf('!');
            const lineContent = commentIndex >= 0 ? text.slice(0, commentIndex) : text;
            if (!lineContent.trim()) {
                continue;
            }

            const currentIndentMatch = /^\s*/.exec(text);
            const currentIndent = currentIndentMatch ? currentIndentMatch[0] : '';

            const isEndIf = END_IF_REGEX.test(lineContent);
            const isElseIf = ELSE_IF_REGEX.test(lineContent);
            const isElse = !isElseIf && ELSE_REGEX.test(lineContent);
            const isIfStart = IF_STATEMENT_REGEX.test(lineContent);
            const isDefineEventStart = DEFINE_EVENT_REGEX.test(lineContent);
            const isStart1dDomain = START_1D_DOMAIN_REGEX.test(lineContent);
            const isStart2dDomain = START_2D_DOMAIN_REGEX.test(lineContent);
            const isEndDefine = END_DEFINE_REGEX.test(lineContent);
            const isEnd1dDomain = END_1D_DOMAIN_REGEX.test(lineContent);
            const isEnd2dDomain = END_2D_DOMAIN_REGEX.test(lineContent);

            let expectedIndent = currentIndent;

            if (isEndIf) {
                const ifIndent = findIndentForKind(indentStack, 'if');
                if (ifIndent !== null) {
                    expectedIndent = ifIndent;
                }
                applyIndentEdit(edits, line, currentIndent, expectedIndent);
                popBlock(indentStack, 'if');
                continue;
            }

            if (isEndDefine) {
                const defineIndent = findIndentForKind(indentStack, 'define-event');
                if (defineIndent !== null) {
                    expectedIndent = defineIndent;
                }
                applyIndentEdit(edits, line, currentIndent, expectedIndent);
                popBlock(indentStack, 'define-event');
                continue;
            }

            if (isEnd1dDomain) {
                const domainIndent = findIndentForKind(indentStack, 'start-1d-domain');
                if (domainIndent !== null) {
                    expectedIndent = domainIndent;
                }
                applyIndentEdit(edits, line, currentIndent, expectedIndent);
                popBlock(indentStack, 'start-1d-domain');
                continue;
            }

            if (isEnd2dDomain) {
                const domainIndent = findIndentForKind(indentStack, 'start-2d-domain');
                if (domainIndent !== null) {
                    expectedIndent = domainIndent;
                }
                applyIndentEdit(edits, line, currentIndent, expectedIndent);
                popBlock(indentStack, 'start-2d-domain');
                continue;
            }

            if (isElseIf || isElse) {
                const ifIndent = findIndentForKind(indentStack, 'if');
                if (ifIndent !== null) {
                    expectedIndent = ifIndent;
                }
                applyIndentEdit(edits, line, currentIndent, expectedIndent);
                continue;
            }

            if (isIfStart || isDefineEventStart || isStart1dDomain || isStart2dDomain) {
                if (indentStack.length > 0) {
                    expectedIndent = `${indentStack[indentStack.length - 1].indent}\t`;
                }
                applyIndentEdit(edits, line, currentIndent, expectedIndent);
                if (isIfStart) {
                    indentStack.push({ kind: 'if', indent: expectedIndent });
                } else if (isDefineEventStart) {
                    indentStack.push({ kind: 'define-event', indent: expectedIndent });
                } else if (isStart1dDomain) {
                    indentStack.push({ kind: 'start-1d-domain', indent: expectedIndent });
                } else if (isStart2dDomain) {
                    indentStack.push({ kind: 'start-2d-domain', indent: expectedIndent });
                }
                continue;
            }

            if (indentStack.length > 0) {
                expectedIndent = `${indentStack[indentStack.length - 1].indent}\t`;
                applyIndentEdit(edits, line, currentIndent, expectedIndent);
            }
        }

        return edits;
    }
}

function applyIndentEdit(
    edits: vscode.TextEdit[],
    line: vscode.TextLine,
    currentIndent: string,
    expectedIndent: string
): void {
    if (currentIndent === expectedIndent) {
        return;
    }

    const range = new vscode.Range(line.lineNumber, 0, line.lineNumber, currentIndent.length);
    edits.push(vscode.TextEdit.replace(range, expectedIndent));
}

function findIndentForKind(stack: BlockIndent[], kind: BlockKind): string | null {
    for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].kind === kind) {
            return stack[i].indent;
        }
    }
    return null;
}

function popBlock(stack: BlockIndent[], kind: BlockKind): void {
    if (stack.length === 0) {
        return;
    }

    if (stack[stack.length - 1].kind === kind) {
        stack.pop();
    }
}
