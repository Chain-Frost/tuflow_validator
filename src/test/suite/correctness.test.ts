import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { classifyCommandValue } from '../../pathParsing';
import { TPV_CODES, TPV_SOURCE } from '../../diagnosticCodes';

const FIXTURES = path.resolve(__dirname, '../../../src/test/fixtures/correctness');

suite('TUFLOW command-aware validation and block diagnostics', function () {
    this.timeout(15000);

    suiteSetup(async () => {
        const config = vscode.workspace.getConfiguration('tuflowValidator');
        await config.update('diagnosticLevel', 'hint', vscode.ConfigurationTarget.Global);
        await config.update('enableIfStatementChecks', true, vscode.ConfigurationTarget.Global);
    });

    test('recognises input, output, conditional and unknown commands', () => {
        assert.strictEqual(classifyCommandValue('Read GIS Z Shape'), 'input-file');
        assert.strictEqual(classifyCommandValue('Geometry Control File'), 'input-file');
        assert.strictEqual(classifyCommandValue('Read GRID Zpts'), 'input-file');
        assert.strictEqual(classifyCommandValue('Read File'), 'input-file');
        assert.strictEqual(classifyCommandValue('BC Database'), 'input-file');
        assert.strictEqual(classifyCommandValue('Output Folder'), 'output');
        assert.strictEqual(classifyCommandValue('Write Check Files'), 'output');
        assert.strictEqual(classifyCommandValue('If Scenario'), 'non-file');
        assert.strictEqual(classifyCommandValue('else if event'), 'non-file');
        assert.strictEqual(classifyCommandValue('Set Variable OutputRoot'), 'non-file');
        assert.strictEqual(classifyCommandValue('Some Custom Command'), 'unknown');
    });

    test('reports only known missing input files, with stable diagnostic codes', async () => {
        const doc = await openFixture('path-commands.tcf');
        const diagnostics = await untilDiagnostics(doc.uri, items =>
            items.some(d => d.code === TPV_CODES.missingFile)
        );

        const missing = diagnostics.filter(d => d.code === TPV_CODES.missingFile);
        assert.strictEqual(missing.length, 1);
        assert.ok(missing[0].message.includes('missing/input.shp'));
        assert.strictEqual(missing[0].source, TPV_SOURCE);
        assert.strictEqual(missing[0].severity, vscode.DiagnosticSeverity.Error);
        assert.strictEqual(missing[0].range.start.line, 1);
        assert.ok(!diagnostics.some(d => d.message.includes('custom.shp')));
        assert.ok(!diagnostics.some(d => d.message.includes('results')));
        assert.ok(!diagnostics.some(d => d.message.includes('DEV.2026')));

        const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
            'vscode.executeCodeActionProvider',
            doc.uri,
            missing[0].range,
            vscode.CodeActionKind.QuickFix.value
        );
        assert.ok(actions?.some(action => action.title === 'Ignore this line (TUFLOW)'));
    });

    test('accepts correctly nested If/Define Event/Domain blocks', async () => {
        const doc = await openFixture('valid-blocks.tcf');
        await delay(400);
        const diagnostics = vscode.languages.getDiagnostics(doc.uri);
        assert.ok(!diagnostics.some(d =>
            d.code === TPV_CODES.missingEnd ||
            d.code === TPV_CODES.unexpectedEnd ||
            d.code === TPV_CODES.invalidElse
        ), `Unexpected block diagnostics: ${diagnostics.map(d => d.message).join('; ')}`);
    });

    test('reports unexpected endings and invalid Else ordering', async () => {
        const doc = await openFixture('invalid-blocks.tcf');
        const diagnostics = await untilDiagnostics(doc.uri, items =>
            items.filter(d => d.code === TPV_CODES.unexpectedEnd).length >= 3 &&
            items.filter(d => d.code === TPV_CODES.invalidElse).length >= 4
        );
        assert.strictEqual(diagnostics.filter(d => d.code === TPV_CODES.unexpectedEnd).length, 3);
        assert.strictEqual(diagnostics.filter(d => d.code === TPV_CODES.invalidElse).length, 4);
        assert.ok(diagnostics.some(d => d.message.includes('Duplicate Else')));
        assert.ok(diagnostics.some(d => d.message.includes('Else If cannot follow Else')));
        assert.ok(diagnostics.every(d => d.source === TPV_SOURCE));
    });
});

async function openFixture(name: string): Promise<vscode.TextDocument> {
    const document = await vscode.workspace.openTextDocument(path.join(FIXTURES, name));
    await vscode.window.showTextDocument(document);
    return document;
}

async function untilDiagnostics(
    uri: vscode.Uri,
    predicate: (diagnostics: vscode.Diagnostic[]) => boolean
): Promise<vscode.Diagnostic[]> {
    const until = Date.now() + 8000;
    while (Date.now() < until) {
        const diagnostics = vscode.languages.getDiagnostics(uri);
        if (predicate(diagnostics)) {
            return diagnostics;
        }
        await delay(50);
    }
    assert.fail(`Timed out waiting for expected diagnostics: ${uri.toString()}`);
}

function delay(milliseconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}
