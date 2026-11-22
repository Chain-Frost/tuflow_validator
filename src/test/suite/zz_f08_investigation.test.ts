import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { TPV_CODES } from '../../diagnosticCodes';

// Investigation-only observational probe. No production behavior change.
// Do not turn today's spurious diagnostics into a permanent passing assertion.
type Fixture = { base: string; a: string; b: string; trd: string; nested: string };
const closeEvents: string[] = [];

function makeFixture(): Fixture {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tpv-f08-'));
    const files: Array<[string, string]> = [
        ['a/runs/A.tcf', 'Set Variable LOCAL_SHAPE == assets\\only_a.shp\nRead File == ..\\..\\standalone\\context\\shared\\terrain.trd\n'],
        ['b/runs/B.tcf', 'Set Variable LOCAL_SHAPE == assets\\missing_b.shp\nRead File == ..\\..\\shared\\terrain.trd\n'],
        ['standalone/context/shared/terrain.trd', [
            'Read GIS Z Shape == assets\\present.shp',
            'Read GIS Z Shape == <<LOCAL_SHAPE>>',
            'Read GIS Z Shape == assets\\missing.shp',
            'Read File == ..\\..\\shared\\nested.trd',
            'If Scenario == F08',
            '    Read GIS Z Shape == assets\\conditional_missing.shp',
            'End If',
            'Read GIS Z Shape == assets\\<<~s1~>>.shp',
            ''
        ].join('\n')],
        ['shared/nested.trd', 'Read GIS Z Shape == assets\\present.shp\n'],
        ['a/runs/assets/present.shp', ''],
        ['a/runs/assets/edited_present.shp', ''],
        ['a/runs/assets/only_a.shp', ''],
        ['b/runs/assets/present.shp', ''],
        ['b/runs/assets/edited_present.shp', '']
    ];
    for (const [name, contents] of files) {
        const output = path.join(base, name);
        fs.mkdirSync(path.dirname(output), { recursive: true });
        fs.writeFileSync(output, contents);
    }
    return {
        base,
        a: path.join(base, 'a/runs/A.tcf'),
        b: path.join(base, 'b/runs/B.tcf'),
        trd: path.join(base, 'standalone/context/shared/terrain.trd'),
        nested: path.join(base, 'shared/nested.trd')
    };
}

function code(d: vscode.Diagnostic): string {
    const raw = d.code;
    return typeof raw === 'object' && raw !== null ? String(raw.value) : String(raw ?? '');
}
function problems(file: string): vscode.Diagnostic[] {
    return vscode.languages.getDiagnostics(vscode.Uri.file(file));
}
function missing(file: string, reference: string): boolean {
    return problems(file).some(d => code(d) === TPV_CODES.missingFile && d.message.includes(reference));
}
function snapshot(stage: string, f: Fixture): void {
    const summarize = (file: string): object[] => problems(file).map(d => ({
        code: code(d), source: d.source, message: d.message, severity: d.severity,
        line: d.range.start.line + 1
    }));
    console.log('F08_SNAPSHOT ' + JSON.stringify({
        stage,
        openDocuments: vscode.workspace.textDocuments.map(d => d.fileName)
            .filter(file => file.toLowerCase().includes('tpv-f08-')),
        openTabs: vscode.window.tabGroups.all.flatMap(group => group.tabs.map(tab => tab.label)),
        documentCloseEvents: [...closeEvents],
        resolution: {
            a: path.resolve(path.dirname(f.a), 'assets/edited_present.shp'),
            b: path.resolve(path.dirname(f.b), 'assets/edited_present.shp'),
            standalone: path.resolve(path.dirname(f.trd), 'assets/edited_present.shp')
        },
        nestedIncludeResolution: {
            a: path.resolve(path.dirname(f.a), '../../shared/nested.trd'),
            b: path.resolve(path.dirname(f.b), '../../shared/nested.trd'),
            standalone: path.resolve(path.dirname(f.trd), '../../shared/nested.trd')
        },
        nestedIncludeExists: {
            a: fs.existsSync(path.resolve(path.dirname(f.a), '../../shared/nested.trd')),
            b: fs.existsSync(path.resolve(path.dirname(f.b), '../../shared/nested.trd')),
            standalone: fs.existsSync(path.resolve(path.dirname(f.trd), '../../shared/nested.trd'))
        },
        present: {
            a: fs.existsSync(path.resolve(path.dirname(f.a), 'assets/edited_present.shp')),
            b: fs.existsSync(path.resolve(path.dirname(f.b), 'assets/edited_present.shp')),
            standalone: fs.existsSync(path.resolve(path.dirname(f.trd), 'assets/edited_present.shp'))
        },
        rootA: summarize(f.a), rootB: summarize(f.b),
        trd: summarize(f.trd), nested: summarize(f.nested)
    }));
}
function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
async function waitFor(predicate: () => boolean, reason: string): Promise<void> {
    for (let i = 0; i < 80; i++) {
        if (predicate()) { return; }
        await delay(100);
    }
    assert.fail('F08 timed out: ' + reason);
}
async function open(file: string): Promise<vscode.TextDocument> {
    const document = await vscode.workspace.openTextDocument(file);
    await vscode.window.showTextDocument(document, { preview: false });
    return document;
}
async function close(document: vscode.TextDocument): Promise<void> {
    // Use the exact document instance, not a string match: on Windows the
    // document URI can canonicalize a temporary 8.3 path to a long path.
    await vscode.window.showTextDocument(document, { preview: false });
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
}

async function cleanupFixture(base: string): Promise<void> {
    // Bounded linear retry backoff: at most 5.5 s per directory (11 s
    // for two fixtures), within the suite's 65 s timeout. Windows watcher
    // shutdown may race cleanup; a disposable fixture cleanup error must not
    // obscure the 13 completed diagnostic observations.
    try {
        await fs.promises.rm(base, {
            recursive: true, force: true, maxRetries: 10, retryDelay: 100
        });
    } catch (error) {
        console.warn('F08_CLEANUP_WARNING ' + String(error) + ' ' + base);
    }
}

suite('F08 investigation — included TRD opened as independent root', function () {
    this.timeout(65000);
    test('observation across editor operations and two TCF contexts', async () => {
        const f = makeFixture();
        const correctlyResolvedNested = path.resolve(path.dirname(f.a), '../../shared/nested.trd');
        const wronglyResolvedNested = path.resolve(path.dirname(f.trd), '../../shared/nested.trd');
        assert.strictEqual(correctlyResolvedNested, f.nested);
        assert.ok(wronglyResolvedNested.startsWith(f.base + path.sep),
            'Incorrect TRD-root candidate must remain inside the disposable fixture');
        assert.strictEqual(fs.existsSync(correctlyResolvedNested), true);
        assert.strictEqual(fs.existsSync(wronglyResolvedNested), false);
        const configuration = vscode.workspace.getConfiguration('tuflowValidator');
        const prior = configuration.get<string>('diagnosticLevel');
        let isolated: Fixture | undefined;
        const closeEventListener = vscode.workspace.onDidCloseTextDocument(document => {
            if (document.fileName.toLowerCase().includes('tpv-f08-')) {
                closeEvents.push(document.fileName);
            }
        });
        console.log('F08_ENV ' + JSON.stringify({
            vscode: vscode.version, node: process.version, platform: process.platform,
            arch: process.arch, ciSha: process.env.GITHUB_SHA ?? null,
            extensionVersion: JSON.parse(fs.readFileSync(
                path.resolve(__dirname, '../../../package.json'), 'utf8'
            )).version
        }));
        try {
            await configuration.update('diagnosticLevel', 'hint', vscode.ConfigurationTarget.Global);
            await vscode.commands.executeCommand('workbench.action.closeAllEditors');
            await delay(500);

            const a = await open(f.a);
            await waitFor(() => missing(f.trd, 'assets\\missing.shp'), 'parent A analysis');
            assert.strictEqual(missing(f.trd, 'assets\\present.shp'), false);
            assert.strictEqual(missing(f.trd, '<<LOCAL_SHAPE>>'), false);
            assert.ok(missing(f.trd, 'conditional_missing.shp'));
            snapshot('01_A_ONLY', f);

            const child = await open(f.trd);
            await delay(550);
            snapshot('02_TRD_OPEN', f);

            const oldPath = 'assets\\present.shp';
            const newPath = 'assets\\edited_present.shp';
            const offset = child.getText().indexOf(oldPath);
            assert.ok(offset >= 0);
            const edit = new vscode.WorkspaceEdit();
            edit.replace(child.uri, new vscode.Range(
                child.positionAt(offset), child.positionAt(offset + oldPath.length)
            ), newPath);
            assert.strictEqual(await vscode.workspace.applyEdit(edit), true);
            assert.strictEqual(child.isDirty, true);
            await delay(550);
            snapshot('03_TRD_DIRTY', f);
            assert.strictEqual(await child.save(), true);
            await delay(450);
            snapshot('04_TRD_SAVED', f);

            const nested = await open(f.nested);
            await delay(450);
            snapshot('05_NESTED_OPEN', f);
            await close(nested);
            await delay(450);
            snapshot('06_NESTED_CLOSED', f);

            await close(child);
            await delay(650);
            assert.ok(missing(f.trd, 'assets\\missing.shp'));
            // VS Code can retain a text document after its editor tab closes.
            // Record tab state, document state and any TPV001 separately.
            snapshot('07_TRD_TAB_CLOSED_A_REMAINS', f);

            const b = await open(f.b);
            await waitFor(() => missing(f.trd, '<<LOCAL_SHAPE>>'), 'root B distinct missing static variable');
            snapshot('08_A_AND_B_OPEN', f);

            await open(f.trd);
            await delay(500);
            snapshot('09_A_B_TRD_OPEN', f);

            await close(b);
            await delay(650);
            assert.ok(missing(f.trd, 'assets\\missing.shp'));
            snapshot('10_B_TAB_CLOSED_A_REMAINS', f);

            await close(a);
            await delay(650);
            snapshot('11_BOTH_PARENT_TABS_CLOSED_TRD_OPEN', f);

            await vscode.commands.executeCommand('workbench.action.closeAllEditors');
            await delay(700);
            snapshot('12_ALL_TABS_CLOSED', f);
            // Use a distinct model directory to guarantee no parent from
            // previous stages could have contributed to this orphan result.
            isolated = makeFixture();
            await open(isolated.trd);
            await delay(550);
            snapshot('13_FRESH_ORPHAN_TRD', isolated);
            console.log('F08_RESULT ' + JSON.stringify({
                interpretation: 'Consult F08_SNAPSHOT logs. Observational only; no assertion of a defect or proposed fix.'
            }));
        } finally {
            closeEventListener.dispose();
            await vscode.commands.executeCommand('workbench.action.closeAllEditors');
            if (prior !== undefined) {
                await configuration.update('diagnosticLevel', prior, vscode.ConfigurationTarget.Global);
            }
            await delay(700);
            await cleanupFixture(f.base);
            if (isolated) {
                await cleanupFixture(isolated.base);
            }
        }
    });
});
