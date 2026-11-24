'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const RUN_PATTERN = /^https:\/\/github\.com\/Chain-Frost\/tuflow_validator\/actions\/runs\/[1-9]\d*$/;
const PUBLISHER = 'Chain-Frost';
const EXTENSION = 'tuflow-path-validator';

function prepareGithubRelease(root, tag, commit, runUrl) {
    if (!TAG_PATTERN.test(tag ?? '')) throw new Error('Release tag must be a stable vMAJOR.MINOR.PATCH.');
    if (!COMMIT_PATTERN.test(commit ?? '')) throw new Error('Release commit must be the full lowercase SHA.');
    if (!RUN_PATTERN.test(runUrl ?? '')) throw new Error('Release run must be the trusted repository Actions URL.');

    const version = tag.slice(1);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    if (manifest.publisher !== PUBLISHER || manifest.name !== EXTENSION || manifest.version !== version) {
        throw new Error('Release identity or version does not match the approved tag.');
    }

    const vsixPath = path.join(root, 'validator-ci.vsix');
    const checksumPath = path.join(root, 'validator-ci.vsix.sha256');
    const checksumText = fs.readFileSync(checksumPath, 'utf8');
    const checksumMatch = /^([a-f0-9]{64})  validator-ci\.vsix\n?$/.exec(checksumText);
    if (!checksumMatch) throw new Error('Unexpected VSIX checksum sidecar format.');
    const actualChecksum = crypto.createHash('sha256').update(fs.readFileSync(vsixPath)).digest('hex');
    if (actualChecksum !== checksumMatch[1]) throw new Error('Verified VSIX checksum mismatch.');

    const notesPath = path.join(root, 'docs', 'releases', `${tag}.md`);
    const rawNotes = fs.readFileSync(notesPath, 'utf8');
    const expectedHeading = `# TUFLOW Path Validator ${tag}`;
    const heading = rawNotes.split(/\r?\n/, 1)[0];
    if (heading !== expectedHeading && !heading.startsWith(`${expectedHeading} — `)) {
        throw new Error('Release notes must identify the exact tag.');
    }
    const changesStart = rawNotes.search(/^## Changes since published [^\n]+$/m);
    if (changesStart < 0) throw new Error('Release notes lack a changes section.');
    const remainder = rawNotes.slice(changesStart);
    const nextSection = /^## (?!Changes since published )[^\n]+$/gm;
    nextSection.lastIndex = 1;
    const next = nextSection.exec(remainder);
    const changes = remainder.slice(0, next?.index ?? remainder.length).trim();
    if (!/^\s*- /m.test(changes)) throw new Error('Release changes section is empty.');

    const notes = [
        `# TUFLOW Path Validator ${tag}`,
        '',
        changes,
        '',
        '## Verified release provenance',
        '',
        `- Source commit: \`${commit}\``,
        `- Protected tag: \`${tag}\``,
        `- [Approved Marketplace publishing workflow](${runUrl})`,
        `- [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=${PUBLISHER}.${EXTENSION})`,
        `- Tested VSIX SHA-256: \`${actualChecksum}\``,
        '',
        'The VSIX attached to this GitHub Release is the same tested archive supplied to the Marketplace publishing command. Marketplace download and installed-profile acceptance are tracked separately.',
        ''
    ].join('\n');

    const outputDir = path.join(root, 'github-release');
    fs.mkdirSync(outputDir, { recursive: true });
    const vsixName = `${EXTENSION}-${version}.vsix`;
    fs.copyFileSync(vsixPath, path.join(outputDir, vsixName));
    fs.writeFileSync(path.join(outputDir, `${vsixName}.sha256`), `${actualChecksum}  ${vsixName}\n`);
    fs.writeFileSync(path.join(outputDir, 'RELEASE_NOTES.md'), notes);

    return { version, vsixName, sha256: actualChecksum, outputDir };
}

module.exports = { prepareGithubRelease };

if (require.main === module) {
    try {
        const result = prepareGithubRelease(process.cwd(), process.argv[2], process.argv[3], process.argv[4]);
        console.log(`Prepared GitHub Release ${result.version}; ${result.vsixName} SHA-256 ${result.sha256}`);
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
