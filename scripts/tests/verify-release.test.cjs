'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { verifyRelease } = require('../verify-release.cjs');
const { getOIDCCredential } = require('@vscode/vsce/out/oidc');

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tpv-release-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
    const git = (...args) => execFileSync('git', [
        '-c', 'user.name=Release guard test', '-c', 'user.email=release-test@example.invalid', ...args
    ], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git('init');
    const manifest = {
        name: 'tuflow-path-validator', publisher: 'Chain-Frost', version: '0.2.7',
        scripts: { 'publish:vsix:oidc': 'vsce publish --oidc' }
    };
    const write = () => fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(manifest));
    write();
    git('add', 'package.json');
    git('commit', '-m', 'Fixture release');
    const commit = git('rev-parse', 'HEAD');
    git('update-ref', 'refs/remotes/origin/main', commit);
    git('tag', 'v0.2.7');
    return { root, git, manifest, write, commit };
}

test('accepts the exact reviewed commit and records lightweight/annotated tag identity', t => {
    const f = fixture(t);
    assert.deepEqual(verifyRelease(f.root, 'v0.2.7', f.commit), { commit: f.commit, tagObject: f.commit });
    f.git('tag', '-fa', 'v0.2.7', '-m', 'Annotated release');
    const verified = verifyRelease(f.root, 'v0.2.7', f.commit);
    assert.notEqual(verified.tagObject, f.commit);
    assert.equal(verified.tagObject, f.git('rev-parse', 'refs/tags/v0.2.7'));
});

test('rejects invalid tag/commit inputs before invoking git', t => {
    const f = fixture(t);
    for (const tag of ['main', '../v0.2.7', 'v0.2.7;echo unsafe', 'v0.2.7-beta.1', 'v00.2.7']) {
        assert.throws(() => verifyRelease(f.root, tag, f.commit), /Release tag/);
    }
    for (const commit of ['main', f.commit.slice(0, 7), 'g'.repeat(40), undefined]) {
        assert.throws(() => verifyRelease(f.root, 'v0.2.7', commit), /Release commit/);
    }
});

test('rejects mismatched version, publisher, extension name and non-OIDC command', t => {
    const f = fixture(t);
    assert.throws(() => verifyRelease(f.root, 'v0.2.8', f.commit), /version/);
    for (const key of ['publisher', 'name']) {
        const before = f.manifest[key];
        f.manifest[key] = 'different'; f.write();
        assert.throws(() => verifyRelease(f.root, 'v0.2.7', f.commit), /identity/);
        f.manifest[key] = before;
    }
    f.manifest.scripts['publish:vsix:oidc'] = 'vsce publish'; f.write();
    assert.throws(() => verifyRelease(f.root, 'v0.2.7', f.commit), /--oidc/);
});

test('rejects a tag moved away from the reviewed commit', t => {
    const f = fixture(t);
    f.git('commit', '--allow-empty', '-m', 'Different commit');
    f.git('tag', '-f', 'v0.2.7');
    f.git('checkout', '--detach', f.commit);
    assert.throws(() => verifyRelease(f.root, 'v0.2.7', f.commit), /reviewed commit/);
});

test('rejects a different checkout and a release not present on origin/main', t => {
    const f = fixture(t);
    f.git('commit', '--allow-empty', '-m', 'Unmerged release');
    assert.throws(() => verifyRelease(f.root, 'v0.2.7', f.commit), /reviewed commit/);
    const unmerged = f.git('rev-parse', 'HEAD');
    f.git('tag', '-f', 'v0.2.7');
    assert.throws(() => verifyRelease(f.root, 'v0.2.7', unmerged), /Command failed/);
});

test('trusted workflow guard rejects an unmerged candidate that replaces its own guard', t => {
    const f = fixture(t);
    fs.mkdirSync(path.join(f.root, 'scripts'));
    fs.writeFileSync(path.join(f.root, 'scripts', 'verify-release.cjs'),
        "require('node:fs').writeFileSync('candidate-ran', 'unsafe'); process.exit(0);\n");
    f.git('add', 'scripts');
    f.git('commit', '-m', 'Unmerged candidate overrides its own release guard');
    const unmerged = f.git('rev-parse', 'HEAD');
    f.git('tag', '-f', 'v0.2.7');
    // Same trust boundary as the workflow's separate release-policy checkout.
    const result = spawnSync(process.execPath, [
        path.resolve(__dirname, '../verify-release.cjs'), 'v0.2.7', unmerged
    ], { cwd: f.root, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /merge-base/);
    assert.equal(fs.existsSync(path.join(f.root, 'candidate-ran')), false);
});

test('OIDC fails without a provider or token-request permission, without a network call', async () => {
    const request = async () => { throw new Error('Unexpected network request'); };
    await assert.rejects(getOIDCCredential('Chain-Frost', {
        environment: { VSCE_PAT: 'unused-test-placeholder' }, request
    }), /No supported OIDC provider/);
    await assert.rejects(getOIDCCredential('Chain-Frost', {
        environment: { GITHUB_ACTIONS: 'true', VSCE_PAT: 'unused-test-placeholder' }, request
    }), /id-token: write/);
});

test('OIDC policy rejection propagates without PAT fallback (mocked HTTP only)', async () => {
    let calls = 0;
    await assert.rejects(getOIDCCredential('Chain-Frost', {
        environment: {
            GITHUB_ACTIONS: 'true', ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.invalid/request',
            ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'test-request-token', VSCE_PAT: 'unused-test-placeholder'
        },
        marketplaceUrl: 'https://marketplace.invalid',
        request: async () => (++calls === 1
            ? { statusCode: 200, readBody: async () => JSON.stringify({ value: 'test-id-token' }) }
            : { statusCode: 403, statusMessage: 'Forbidden', readBody: async () => 'Policy rejected' })
    }), /Marketplace OIDC token exchange failed with 403/);
    assert.equal(calls, 2);
});
