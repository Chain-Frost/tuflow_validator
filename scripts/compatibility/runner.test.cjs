'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { runProbeWithFreshEvidence } = require('./run-installed.cjs');

const expected = { invocationId: 'current-invocation', mode: 'validator-only',
    requestedVSCode: '1.74.0', sourceSha: 'source-sha', helperSha: 'helper-sha',
    packages: [{ name: 'validator-ci.vsix', sha256: 'current-package-hash' }] };

test('a zero-exit/no-probe run cannot reuse existing successful evidence', async () => {
    await withResultFile(async resultFile => {
        fs.writeFileSync(resultFile, JSON.stringify({ ...expected, status: 'passed' }));
        await assert.rejects(runProbeWithFreshEvidence(resultFile, expected, async () => {}),
            { code: 'ENOENT' });
    });
});

test('freshly written evidence must match this invocation and installed package', async () => {
    await withResultFile(async resultFile => {
        for (const change of [
            { invocationId: 'previous-invocation' },
            { packages: [{ name: 'validator-ci.vsix', sha256: 'older-package-hash' }] }
        ]) {
            await assert.rejects(runProbeWithFreshEvidence(resultFile, expected, async () => {
                fs.writeFileSync(resultFile, JSON.stringify({ ...expected, ...change, status: 'passed' }));
            }), { name: 'AssertionError' });
        }
    });
});

test('successful current probe evidence is accepted', async () => {
    await withResultFile(async resultFile => {
        const result = await runProbeWithFreshEvidence(resultFile, expected, async () => {
            fs.writeFileSync(resultFile, JSON.stringify({ ...expected, status: 'passed', vscodeVersion: '1.74.0' }));
        });
        assert.equal(result.vscodeVersion, '1.74.0');
    });
});

test('a failed host cannot pass even if it wrote a successful result', async () => {
    await withResultFile(async resultFile => {
        await assert.rejects(runProbeWithFreshEvidence(resultFile, expected, async () => {
            fs.writeFileSync(resultFile, JSON.stringify({ ...expected, status: 'passed' }));
            throw new Error('host failed');
        }), /host failed/);
    });
});

async function withResultFile(run) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tpv-compatibility-evidence-'));
    try {
        await run(path.join(directory, 'result.json'));
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
}
