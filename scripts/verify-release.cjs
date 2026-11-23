'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function verifyRelease(root, tag, expectedCommit) {
    if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag ?? '')) {
        throw new Error('Release tag must be a stable vMAJOR.MINOR.PATCH version.');
    }
    if (!/^[0-9a-f]{40}$/.test(expectedCommit ?? '')) {
        throw new Error('Release commit must be the full lowercase 40-character SHA.');
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    if (manifest.publisher !== 'Chain-Frost' || manifest.name !== 'tuflow-path-validator') {
        throw new Error('Release package has an unexpected Marketplace identity.');
    }
    if (tag !== `v${manifest.version}`) {
        throw new Error('Release tag does not match package.json version.');
    }
    if (manifest.scripts?.['publish:vsix:oidc'] !== 'vsce publish --oidc') {
        throw new Error('Publishing must use the locked local vsce with --oidc only.');
    }
    const git = (...args) => execFileSync('git', args, {
        cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
    const checkedOut = git('rev-parse', '--verify', 'HEAD');
    const taggedCommit = git('rev-parse', '--verify', `refs/tags/${tag}^{commit}`);
    if (checkedOut !== expectedCommit || taggedCommit !== expectedCommit) {
        throw new Error('The checkout and release tag must both match the reviewed commit.');
    }
    git('merge-base', '--is-ancestor', expectedCommit, 'refs/remotes/origin/main');
    return { commit: expectedCommit, tagObject: git('rev-parse', '--verify', `refs/tags/${tag}`) };
}

module.exports = { verifyRelease };

if (require.main === module) {
    try {
        const result = verifyRelease(process.cwd(), process.argv[2], process.argv[3]);
        if (process.env.GITHUB_OUTPUT) {
            fs.appendFileSync(process.env.GITHUB_OUTPUT, `tag_object=${result.tagObject}\n`);
        }
        console.log(`Verified release commit ${result.commit} and tag object ${result.tagObject}.`);
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
