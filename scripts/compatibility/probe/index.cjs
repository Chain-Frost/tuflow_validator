'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

exports.run = async () => {
    const workspace = process.env.TPV_COMPAT_WORKSPACE;
    const mode = process.env.TPV_COMPAT_MODE;
    const evidence = {
        ...JSON.parse(process.env.TPV_COMPAT_PROVENANCE),
        mode,
        platform: process.platform,
        vscodeVersion: vscode.version,
        extensionHostNode: process.versions.node,
        extensionHostElectron: process.versions.electron,
        status: 'failed',
        checks: []
    };
    try {
        if (evidence.requestedVSCode !== 'stable') {
            assert.equal(vscode.version, evidence.requestedVSCode, 'The requested minimum editor must actually run');
        }
        const validator = installedExtension('Chain-Frost.tuflow-path-validator');
        assert.equal(validator.packageJSON.engines.vscode, '^1.74.0');
        const helper = vscode.extensions.getExtension('lmillard79.tuflow-helper');
        assert.equal(Boolean(helper), mode === 'with-helper', 'Isolated profile contains the wrong companions');
        if (helper) {
            installedExtension(helper.id);
            assert.equal(helper.packageJSON.engines.vscode, '^1.74.0');
        }

        fs.writeFileSync(path.join(workspace, 'exists.tgc'), '! existing input\n');
        const filename = path.join(workspace, 'Model_~s1~.tcf');
        fs.writeFileSync(filename, [
            'Geometry Control File == exists.tgc',
            'Geometry Control File == missing.tgc',
            'If Scenario == Future',
            'Read GIS BC == conditional-missing.shp',
            'End If',
            'Viscosity Coefficients == 0.2, 0.1',
            'Read GIS BC == unresolved_<<~s1~>>.shp'
        ].join('\n'));
        const document = await vscode.workspace.openTextDocument(filename);
        await vscode.window.showTextDocument(document);
        assert.equal(document.languageId, 'tuflow');
        // Do not call Validator.activate(): opening its document must activate
        // the installed extension through its actual manifest contributions.
        await until(() => validator.isActive && missingDiagnostics(document.uri).length === 2);
        const diagnostics = missingDiagnostics(document.uri);
        assert.ok(diagnostics.some(d => d.message.includes('missing.tgc')));
        assert.ok(diagnostics.some(d => d.message.includes('conditional-missing.shp')));
        assert.ok(diagnostics.every(d => d.severity === vscode.DiagnosticSeverity.Error));
        const allDiagnostics = vscode.languages.getDiagnostics(document.uri);
        assert.ok(!allDiagnostics.some(d => /exists\.tgc|0\.2, 0\.1|unresolved_/.test(d.message)));
        evidence.checks.push('installed activation', 'shared language', 'present and missing paths',
            'conditional missing input remains an error', 'numeric and runtime-token negatives');

        const missing = diagnostics.find(d => d.message.includes('missing.tgc'));
        const fixes = await vscode.commands.executeCommand(
            'vscode.executeCodeActionProvider', document.uri, missing.range, vscode.CodeActionKind.QuickFix.value
        );
        assert.ok(fixes.some(fix => fix.title === 'Ignore this line (TUFLOW)'));
        evidence.checks.push('registered diagnostic Quick Fix');

        const formatFile = path.join(workspace, 'indentation.tcf');
        fs.writeFileSync(formatFile, 'If Scenario == Future\nCell Size == 10\nEnd If\n');
        const formatDocument = await vscode.workspace.openTextDocument(formatFile);
        const config = vscode.workspace.getConfiguration('tuflowValidator');
        const options = { insertSpaces: true, tabSize: 2 };
        const format = async () => (await vscode.commands.executeCommand(
            'vscode.executeFormatDocumentProvider', formatDocument.uri, options
        )) || [];
        assert.equal((await format()).length, 0, 'Optional formatting must stay disabled by default');
        await config.update('enableIfStatementFormatting', true, vscode.ConfigurationTarget.Global);
        const edits = await format();
        assert.equal(edits.length, 1);
        assert.equal(edits[0].newText, '  ');
        await config.update('enableIfStatementFormatting', false, vscode.ConfigurationTarget.Global);
        evidence.checks.push('optional formatter and editor indentation');

        if (helper) {
            await until(() => helper.isActive);
            const completionDocument = await vscode.workspace.openTextDocument({ language: 'tuflow', content: 'Cell' });
            const completions = await vscode.commands.executeCommand(
                'vscode.executeCompletionItemProvider', completionDocument.uri, new vscode.Position(0, 4)
            );
            assert.ok(completions.items.some(item => item.label === 'Cell Size'), 'Helper completions must coexist');
            const commands = await vscode.commands.getCommands(true);
            assert.ok(commands.includes('tuflow-helper.openDocumentation'));
            assert.ok(!commands.includes('tuflow-helper.openFileUnderCursor'));
            evidence.checks.push('Helper activation and completion coexistence', 'companion command boundaries');
        }
        evidence.extensions = [validator, helper].filter(Boolean).map(extension => ({
            id: extension.id, version: extension.packageJSON.version,
            engine: extension.packageJSON.engines.vscode, active: extension.isActive,
            location: extension.extensionPath
        }));
        evidence.status = 'passed';
    } catch (error) {
        evidence.error = error.stack || String(error);
        throw error;
    } finally {
        fs.mkdirSync(path.dirname(process.env.TPV_COMPAT_EVIDENCE), { recursive: true });
        fs.writeFileSync(process.env.TPV_COMPAT_EVIDENCE, JSON.stringify(evidence, null, 2) + '\n');
    }
};

function installedExtension(id) {
    const extension = vscode.extensions.getExtension(id);
    assert.ok(extension, `Installed extension not found: ${id}`);
    const relative = path.relative(process.env.TPV_COMPAT_EXTENSIONS, extension.extensionPath);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative),
        `${id} must run from the isolated VSIX installation, not the checkout`);
    return extension;
}

function missingDiagnostics(uri) {
    return vscode.languages.getDiagnostics(uri).filter(d =>
        d.source === 'TUFLOW Path Validator' && d.code === 'TPV001');
}

async function until(predicate) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        if (predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.fail('Installed extension did not reach the expected state within 15 seconds');
}
