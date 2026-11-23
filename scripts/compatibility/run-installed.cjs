'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { downloadAndUnzipVSCode, runTests, runVSCodeCommand } = require('@vscode/test-electron');

const root = path.resolve(__dirname, '../..');
const version = process.env.TPV_VSCODE_VERSION || 'stable';
const validatorVsix = path.join(root, 'validator-ci.vsix');
const helperVsix = process.env.TPV_HELPER_VSIX && path.resolve(root, process.env.TPV_HELPER_VSIX);
const evidenceDirectory = path.join(root, '.compatibility/evidence');

async function main() {
    assert.ok(helperVsix, 'Set TPV_HELPER_VSIX to a locally built, pinned Helper package');
    const helperDirectory = path.dirname(helperVsix);
    const helperSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: helperDirectory, encoding: 'utf8' }).trim();
    if (process.env.TPV_HELPER_SOURCE_SHA) {
        assert.equal(helperSha, process.env.TPV_HELPER_SOURCE_SHA, 'Helper checkout must match the pinned test source');
    }
    const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const packages = [validatorVsix, helperVsix].map(file => ({
        name: path.basename(file),
        sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
    }));
    fs.mkdirSync(evidenceDirectory, { recursive: true });
    delete process.env.ELECTRON_RUN_AS_NODE;
    const vscodeExecutablePath = await downloadAndUnzipVSCode({ version });

    for (const mode of ['validator-only', 'with-helper']) {
        const disposable = fs.mkdtempSync(path.join(os.tmpdir(), 'tpv-compatibility-'));
        const extensions = path.join(disposable, 'extensions');
        const profile = path.join(disposable, 'user-data');
        const workspace = path.join(disposable, 'workspace');
        const resultFile = path.join(evidenceDirectory, `${process.platform}-${version}-${mode}.json`);
        fs.mkdirSync(workspace, { recursive: true });
        fs.mkdirSync(path.join(profile, 'User'), { recursive: true });
        fs.writeFileSync(path.join(profile, 'User/settings.json'), JSON.stringify({
            'extensions.autoUpdate': false,
            'extensions.autoCheckUpdates': false,
            'update.mode': 'none',
            'telemetry.telemetryLevel': 'off'
        }));
        const profileArgs = [`--user-data-dir=${profile}`, `--extensions-dir=${extensions}`];
        try {
            for (const vsix of mode === 'with-helper' ? [validatorVsix, helperVsix] : [validatorVsix]) {
                const result = await runVSCodeCommand(
                    [...profileArgs, '--install-extension', vsix, '--force', '--no-sandbox'],
                    { version, spawn: { timeout: 120000 } }
                );
                console.log(result.stdout.trim());
            }
            await runTests({
                vscodeExecutablePath,
                extensionDevelopmentPath: path.join(__dirname, 'probe'),
                extensionTestsPath: path.join(__dirname, 'probe/index.cjs'),
                launchArgs: [workspace, ...profileArgs, '--disable-gpu', '--disable-dev-shm-usage'],
                extensionTestsEnv: {
                    TPV_COMPAT_MODE: mode,
                    TPV_COMPAT_WORKSPACE: workspace,
                    TPV_COMPAT_EXTENSIONS: extensions,
                    TPV_COMPAT_EVIDENCE: resultFile,
                    TPV_COMPAT_PROVENANCE: JSON.stringify({ requestedVSCode: version, sourceSha, helperSha, packages })
                }
            });
            const evidence = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
            assert.equal(evidence.status, 'passed', 'Installed-host checks must report success');
            console.log(JSON.stringify(evidence));
        } finally {
            fs.rmSync(disposable, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
        }
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
