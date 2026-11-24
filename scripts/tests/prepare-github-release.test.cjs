'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { prepareGithubRelease } = require('../prepare-github-release.cjs');

const tag = 'v0.2.7';
const commit = 'b8d5f9d42fe0a7f1f5e8d5337e8c9646ffdebfc5';
const run = 'https://github.com/Chain-Frost/tuflow_validator/actions/runs/45228773579';

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tpv-github-release-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, 'docs', 'releases'), { recursive: true });
    const manifest = { publisher: 'Chain-Frost', name: 'tuflow-path-validator', version: '0.2.7' };
    const bytes = Buffer.from('sample-verified-package');
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    const notes = `# TUFLOW Path Validator v0.2.7 — proposed release notes\n\n**Status:** Not published.\n\n## Changes since published v0.2.6\n\n- Fixed viscosity false positive.\n- Preserved VS Code 1.74.\n\n## Release/verification conditions\n\n- Not yet published.\n`;
    const write = () => {
        fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(manifest));
        fs.writeFileSync(path.join(root, 'validator-ci.vsix'), bytes);
        fs.writeFileSync(path.join(root, 'validator-ci.vsix.sha256'), `${hash}  validator-ci.vsix\n`);
        fs.writeFileSync(path.join(root, 'docs', 'releases', 'v0.2.7.md'), notes);
    };
    write();
    return { root, manifest, bytes, hash, notes, write };
}

test('prepares exactly verified package bytes, renamed checksum, and final release notes', t => {
    const f = fixture(t);
    const result = prepareGithubRelease(f.root, tag, commit, run);
    assert.equal(result.sha256, f.hash);
    const dir = path.join(f.root, 'github-release');
    assert.deepEqual(fs.readdirSync(dir).sort(), [
        'RELEASE_NOTES.md', 'tuflow-path-validator-0.2.7.vsix', 'tuflow-path-validator-0.2.7.vsix.sha256'
    ]);
    assert.deepEqual(fs.readFileSync(path.join(dir, result.vsixName)), f.bytes);
    assert.equal(fs.readFileSync(path.join(dir, `${result.vsixName}.sha256`), 'utf8'), `${f.hash}  ${result.vsixName}\n`);
    const notes = fs.readFileSync(path.join(dir, 'RELEASE_NOTES.md'), 'utf8');
    assert.match(notes, /Fixed viscosity false positive/);
    assert.match(notes, /VS Code 1\.74/);
    assert.match(notes, new RegExp(commit));
    assert.match(notes, new RegExp(f.hash));
    assert.match(notes, /Approved Marketplace publishing workflow/);
    assert.doesNotMatch(notes, /Not published/);
    assert.doesNotMatch(notes, /Release\/verification conditions/);
    assert.doesNotMatch(notes, /Not yet published/);
});

test('rejects wrong tag, commit, or untrusted workflow URL', t => {
    const f = fixture(t);
    for (const badTag of ['v0.2.8', 'v0.2.7-rc.1', 'main', '../v0.2.7']) {
        assert.throws(() => prepareGithubRelease(f.root, badTag, commit, run), /tag|identity|version/);
    }
    assert.throws(() => prepareGithubRelease(f.root, tag, 'deadbee', run), /full lowercase SHA/);
    assert.throws(() => prepareGithubRelease(f.root, tag, commit, 'https://example.invalid/runs/1'), /trusted repository/);
});

test('rejects another publisher, extension identity, and package version', t => {
    const f = fixture(t);
    for (const [field, bad] of [['publisher', 'Other'], ['name', 'helper'], ['version', '0.2.8']]) {
        const before = f.manifest[field];
        f.manifest[field] = bad;
        f.write();
        assert.throws(() => prepareGithubRelease(f.root, tag, commit, run), /identity or version/);
        f.manifest[field] = before;
    }
});

test('fails closed on changed payload and malformed checksum sidecar', t => {
    const f = fixture(t);
    fs.appendFileSync(path.join(f.root, 'validator-ci.vsix'), 'tampered');
    assert.throws(() => prepareGithubRelease(f.root, tag, commit, run), /checksum mismatch/);
    f.write();
    fs.writeFileSync(path.join(f.root, 'validator-ci.vsix.sha256'), `${f.hash}  other.vsix\n`);
    assert.throws(() => prepareGithubRelease(f.root, tag, commit, run), /checksum sidecar format/);
});

test('fails closed on missing or malformed release notes', t => {
    const f = fixture(t);
    const notesPath = path.join(f.root, 'docs', 'releases', 'v0.2.7.md');
    fs.writeFileSync(notesPath, '# unrelated\n## Changes since published v0.2.6\n- fix');
    assert.throws(() => prepareGithubRelease(f.root, tag, commit, run), /exact tag/);
    fs.writeFileSync(notesPath, '# TUFLOW Path Validator v0.2.7\n\n## Pending\n- fix');
    assert.throws(() => prepareGithubRelease(f.root, tag, commit, run), /lack a changes section/);
    fs.writeFileSync(notesPath, '# TUFLOW Path Validator v0.2.7\n\n## Changes since published v0.2.6\n\nNothing');
    assert.throws(() => prepareGithubRelease(f.root, tag, commit, run), /changes section is empty/);
});
