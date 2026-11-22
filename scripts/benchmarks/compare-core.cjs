'use strict';

// Compare raw trials from two builds using the same disposable-fixture driver.
// Runtime diagnostics are acceptance invariants; latency and I/O are evidence,
// NOT automatic owner-approved performance budgets.
const fs = require('node:fs');
const assert = require('node:assert/strict');
if (process.argv.length !== 4) {
    throw new Error('Usage: node compare-core.cjs before.json after.json');
}
const before = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const after = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
assert.equal(before.schemaVersion, after.schemaVersion);
assert.equal(before.environment.fixtureManifestSha256, after.environment.fixtureManifestSha256,
    'The two benchmarks must use byte-identical fixture files');
assert.equal(before.environment.timedSamples, after.environment.timedSamples);
assert.equal(before.environment.syntheticIoLatencyMsPerFixtureOperation,
    after.environment.syntheticIoLatencyMsPerFixtureOperation);
assert.equal(before.environment.platform, after.environment.platform);
assert.deepEqual(before.environment.settings, after.environment.settings,
    'The two runs must use identical Validator settings');
assert.ok(before.environment.fixturesRemoved && after.environment.fixturesRemoved,
    'Both benchmark fixture trees must be deleted after testing');
const names = Object.keys(before.results);
assert.deepEqual(names.sort(), Object.keys(after.results).sort());
const format = n => typeof n === 'number' ? n.toFixed(3) : 'n/a';
const baseline = before.source.commit;
const candidate = after.source.commit;
console.log('Baseline:', baseline);
console.log('Candidate:', candidate);
console.log('Scenario | baseline median / p95 (ms) | candidate median / p95 (ms) | baseline reads/exists/readdir | candidate reads/exists/readdir');
for (const name of names) {
    const b = before.results[name], a = after.results[name];
    const bt = b.trials || [b], at = a.trials || [a];
    assert.equal(bt.length, at.length, name + ': sample count changed');
    // Diagnostic fingerprints are normalized to relative fixture paths in
    // the driver, so any mismatch can signal changed diagnostic correctness.
    for (let i = 0; i < bt.length; i++) {
        assert.equal(bt[i].diagnosticSignature, at[i].diagnosticSignature,
            name + ': diagnostic fingerprint differs at trial ' + (i + 1));
        assert.equal(bt[i].diagnosticCount, at[i].diagnosticCount,
            name + ': diagnostic count differs at trial ' + (i + 1));
    }
    const bs = b.summary || b, as = a.summary || a;
    const duration = v => [format(v.medianMs ?? v.elapsedMs), format(v.p95Ms)].join('/');
    const calls = v => [
        v.medianFileReads ?? v.readFileSync,
        v.medianExistenceChecks ?? v.existsSync,
        v.medianDirectoryEnumerations ?? v.readdirSync
    ].join('/');
    console.log(name + ' | ' + duration(bs) + ' | ' + duration(as) +
        ' | ' + calls(bs) + ' | ' + calls(as));
}
for (const key of ['versionSiblingBefore', 'versionSiblingWatcherEvent']) {
    const b = before.observations[key], a = after.observations[key];
    assert.equal(b?.sha256 ?? b?.diagnosticSignature, a?.sha256 ?? a?.diagnosticSignature,
        key + ': version sibling diagnostic fingerprint differs');
    if (key === 'versionSiblingWatcherEvent') {
        assert.equal(b?.eventReturned, a?.eventReturned,
            'Version sibling invalidation behavior changed');
    }
}
const bWide = before.results.wideGraph.summary;
const aWide = after.results.wideGraph.summary;
assert.ok(aWide.medianDirectoryEnumerations < bWide.medianDirectoryEnumerations,
    'Candidate did not reduce directory metadata calls on wide fixture');
console.log('PASS: all diagnostic signatures match; wide-graph directory enumerations ' +
    bWide.medianDirectoryEnumerations + ' -> ' + aWide.medianDirectoryEnumerations + '.');
