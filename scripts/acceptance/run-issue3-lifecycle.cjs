'use strict';

// Opt-in isolated installed-VSIX runner for issue #3. It may write ONLY inside
// its unique fixture child and its separately created local test profile.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { downloadAndUnzipVSCode, runTests, runVSCodeCommand } = require('@vscode/test-electron');

const root = path.resolve(__dirname, '../..');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const absolute = value => path.resolve(value);
const stamp = () => new Date().toISOString();
const parentArgument = process.env.TPV_ISSUE3_FIXTURE_PARENT;
const localSmoke = process.env.TPV_ISSUE3_LOCAL_SMOKE === '1';
const parent = parentArgument ? absolute(parentArgument) : localSmoke ? os.tmpdir() : null;
const out = absolute(process.env.TPV_ISSUE3_OUTPUT || path.join(root, 'issue3-lifecycle.json'));
const vsix = absolute(process.env.TPV_ISSUE3_VSIX || path.join(root, 'validator-ci.vsix'));
const requestedVSCode = process.env.TPV_VSCODE_VERSION || 'stable';
const manifest = [];

function makeFixture(directory) {
    const files = [
        ['a/runs/A.tcf', 'Set Variable LOCAL_SHAPE == assets/only_a.shp\nRead File == ../../standalone/context/shared/terrain.trd\nRead GIS Z Shape == assets/smoke_missing_a.shp\n'],
        ['b/runs/B.tcf', 'Set Variable LOCAL_SHAPE == assets/missing_b.shp\nRead File == ../../standalone/context/shared/terrain.trd\n'],
        ['standalone/context/shared/terrain.trd', [
            'Read GIS Z Shape == assets/present.shp',
            'Read GIS Z Shape == <<LOCAL_SHAPE>>',
            'Read GIS Z Shape == assets/missing.shp',
            'Read File == ../../shared/nested.trd',
            'If Scenario == Issue3',
            'Read GIS Z Shape == assets/conditional_missing.shp',
            'End If',
            'Read GIS Z Shape == assets/<<~s1~>>.shp',
            '! dirty:A',
            ''
        ].join('\n')],
        ['shared/nested.trd', 'Read GIS Z Shape == assets/present.shp\n'],
        ['a/runs/assets/present.shp', 'fixture-A-present\n'],
        ['a/runs/assets/edited_present.shp', 'fixture-A-edited\n'],
        ['a/runs/assets/only_a.shp', 'fixture-A-only\n'],
        ['b/runs/assets/present.shp', 'fixture-B-present\n'],
        ['b/runs/assets/edited_present.shp', 'fixture-B-edited\n']
    ];
    for (const [relative, contents] of files) {
        const target = path.join(directory, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, contents);
        manifest.push({ path: relative, bytes: Buffer.byteLength(contents), sha256: sha(contents) });
    }
    manifest.sort((a, b) => a.path.localeCompare(b.path));
    return files.filter(([relative]) => relative.endsWith('.shp'))
        .map(([relative, contents]) => ({ relative, sha256: sha(contents) }));
}
function checkSentinels(directory, sentinels) {
    return sentinels.every(s =>
        fs.existsSync(path.join(directory, s.relative)) &&
        sha(fs.readFileSync(path.join(directory, s.relative))) === s.sha256);
}
function assertFixtureParent() {
    assert.ok(parent && fs.existsSync(parent) && fs.statSync(parent).isDirectory(),
        'Set TPV_ISSUE3_FIXTURE_PARENT to a pre-existing approved scratch parent');
    assert.ok(localSmoke || process.env.TPV_ISSUE3_APPROVED === 'YES',
        'Set TPV_ISSUE3_APPROVED=YES only after verifying this scratch parent is owner-approved');
    assert.ok(fs.existsSync(vsix) && fs.statSync(vsix).isFile(), 'Package a verified VSIX first');
    if (process.env.TPV_SYNTHETIC_IO_MS) {
        throw new Error('Synthetic-latency runs are not accepted as lifecycle or SMB evidence');
    }
}
async function main() {
    assertFixtureParent();
    const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const disposable = fs.mkdtempSync(path.join(os.tmpdir(), 'tpv-issue3-profile-'));
    const fixture = fs.mkdtempSync(path.join(parent, 'tpv-issue3-lifecycle-'));
    assert.ok(!out.startsWith(fixture + path.sep), 'Evidence must be outside the disposable fixture');
    const installation = path.join(disposable, 'extensions');
    const profile = path.join(disposable, 'profile');
    const probeResult = path.join(disposable, 'probe.json');
    const identity = {
        sourceSha: source, requestedVSCode, vsixSha256: sha(fs.readFileSync(vsix)),
        invocationId: crypto.randomUUID(), recordedAt: stamp(),
        fixtureClass: process.env.TPV_STORAGE_LABEL || 'Unverified filesystem; do not claim SMB',
        networkVerifiedByOperator: false
    };
    const report = { ...identity, status: 'failed', runnerPlatform: process.platform,
        runnerNode: process.version, manifest: null, sentinelsUnchanged: null,
        fixtureRemoved: false, profileRemoved: false, extensionHostExited: null };
    let failure;
    try {
        const sentinels = makeFixture(fixture);
        report.manifest = { count: manifest.length,
            bytes: manifest.reduce((n, f) => n + f.bytes, 0),
            sha256: sha(JSON.stringify(manifest)), files: manifest };
        fs.mkdirSync(path.join(profile, 'User'), { recursive: true });
        fs.writeFileSync(path.join(profile, 'User/settings.json'), JSON.stringify({
            'extensions.autoUpdate': false, 'extensions.autoCheckUpdates': false,
            'update.mode': 'none', 'telemetry.telemetryLevel': 'off',
            'tuflowValidator.diagnosticLevel': 'hint',
            'tuflowValidator.enableLatestVersionChecks': true,
            'tuflowValidator.enableIfStatementChecks': true
        }));
        delete process.env.ELECTRON_RUN_AS_NODE;
        const executable = await downloadAndUnzipVSCode({ version: requestedVSCode });
        const profileArgs = ['--user-data-dir=' + profile, '--extensions-dir=' + installation];
        await runVSCodeCommand([...profileArgs, '--install-extension', vsix, '--force', '--no-sandbox'],
            { version: requestedVSCode, spawn: { timeout: 120000 } });
        fs.rmSync(probeResult, { force: true });
        await runTests({
            vscodeExecutablePath: executable,
            extensionDevelopmentPath: path.join(root, 'scripts/compatibility/probe'),
            extensionTestsPath: path.join(__dirname, 'issue3-lifecycle-probe.cjs'),
            launchArgs: [fixture, ...profileArgs, '--disable-gpu',
                '--disable-dev-shm-usage', '--no-sandbox'],
            extensionTestsEnv: {
                TPV_ISSUE3_FIXTURE: fixture,
                TPV_ISSUE3_PROBE_OUTPUT: probeResult,
                TPV_ISSUE3_EXTENSIONS: installation,
                TPV_ISSUE3_PROVENANCE: JSON.stringify(identity)
            }
        });
        assert.ok(fs.existsSync(probeResult), 'No fresh probe evidence from the installed Extension Host');
        const observed = JSON.parse(fs.readFileSync(probeResult, 'utf8'));
        assert.equal(observed.status, 'passed', 'Installed-host lifecycle probe did not pass');
        assert.equal(observed.invocationId, identity.invocationId, 'Stale/mismatched evidence');
        assert.equal(observed.sourceSha, source, 'Wrong source SHA in installed-host evidence');
        assert.equal(observed.vsixSha256, identity.vsixSha256, 'Wrong VSIX hash in evidence');
        report.probe = observed;
        report.extensionHostExited = true; // runTests returned after the isolated editor exited
        report.status = 'passed';
        report.sentinelsUnchanged = checkSentinels(fixture, sentinels);
        assert.ok(report.sentinelsUnchanged, 'A sentinel was unexpectedly changed');
    } catch (error) {
        failure = error;
        report.error = error.stack || String(error);
        if (fs.existsSync(probeResult)) {
            try { report.probe = JSON.parse(fs.readFileSync(probeResult, 'utf8')); } catch { /* preserve error */ }
        }
    } finally {
        // Only the two unique mkdtemp children may be removed.
        if (report.sentinelsUnchanged === null) {
            report.sentinelsUnchanged = checkSentinels(fixture,
                manifest.filter(f => f.path.endsWith('.shp')).map(f => ({
                    relative: f.path, sha256: f.sha256
                })));
        }
        try {
            fs.rmSync(fixture, { recursive: true, force: true, maxRetries: 20, retryDelay: 150 });
            report.fixtureRemoved = !fs.existsSync(fixture);
        } catch (error) { report.fixtureCleanupError = String(error); }
        try {
            fs.rmSync(disposable, { recursive: true, force: true, maxRetries: 20, retryDelay: 150 });
            report.profileRemoved = !fs.existsSync(disposable);
        } catch (error) { report.profileCleanupError = String(error); }
        if (!report.fixtureRemoved || !report.profileRemoved || !report.sentinelsUnchanged) {
            report.status = 'failed';
            failure ||= new Error('Integrity or cleanup verification failed');
        }
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
        console.log('Issue #3 lifecycle evidence: ' + out);
        if (failure) throw failure;
    }
}
main().catch(error => {
    console.error(error.stack || String(error));
    process.exitCode = 1;
});
