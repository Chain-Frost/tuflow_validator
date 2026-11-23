'use strict';

// Consolidate three original core-baseline JSON files. All raw trials remain
// in those files. Fail closed on identity/fixture/diagnostic inconsistencies.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const labels = ['ntfs', 'unc', 'mapped'];
const inputs = process.argv.slice(2);
if (inputs.length !== 5) {
    console.error('Usage: node scripts/acceptance/issue3-core-matrix.cjs NTFS.json UNC.json MAPPED.json SUMMARY.json SUMMARY.csv');
    process.exit(2);
}
const data = inputs.slice(0, 3).map(file => JSON.parse(fs.readFileSync(file, 'utf8')));
const round = n => Math.round(n * 1000) / 1000;
function nearestRank(values, q) {
    assert.ok(values.length, 'Empty sample distribution');
    const sorted = [...values].sort((a, b) => a - b);
    return round(sorted[Math.ceil(values.length * q) - 1]);
}
// This evidence gate is deliberately coupled to the reviewed core-baseline
// fixture scenarios. A changed/missing scenario requires an explicit review,
// not a smaller successful summary that silently hides the evidence gap.
const repeatedScenarios = [
    'warmAnalysis', 'singleCharacterEdit', 'includedChildChange',
    'versionSiblingExplicitRevalidation', 'multipleRootChildChange',
    'repeatedIncludeDifferentVariables', 'deepGraph', 'wideGraph', 'longControlFile'
];
const expectedScenarios = ['firstAnalysis', ...repeatedScenarios].sort();
const sha256Pattern = /^[0-9a-f]{64}$/;
const sourcePattern = /^[0-9a-f]{40}$/;
function requireFingerprint(value, context) {
    assert.ok(typeof value === 'string' && sha256Pattern.test(value),
        context + ': absent or invalid diagnostic fingerprint');
    return value;
}
const source = data[0].source;
const fixture = data[0].environment;
assert.ok(sourcePattern.test(source.commit), 'Source SHA must be a complete Git commit');
assert.ok(sha256Pattern.test(source.vsixSha256), 'VSIX SHA-256 must be recorded');
assert.ok(sha256Pattern.test(fixture.fixtureManifestSha256), 'Fixture manifest SHA-256 must be recorded');
assert.equal(fixture.platform, 'win32', 'This matrix qualifies a single Windows client');
assert.equal(fixture.warmups, 3, 'Comparable runs require three discarded warmups');
assert.equal(fixture.timedSamples, 19, 'Comparable runs require 19 timed trials');
assert.ok(fixture.settings && typeof fixture.settings === 'object',
    'Recorded Validator settings are required');
const sameHostFields = ['platform', 'arch', 'node', 'osRelease', 'cpuModel', 'cpuCount'];
for (const name of sameHostFields) {
    assert.ok(fixture[name] !== undefined && fixture[name] !== null && fixture[name] !== '',
        'Missing baseline host identity: ' + name);
}
for (const [i, item] of data.entries()) {
    assert.equal(item.failure, undefined, labels[i] + ' benchmark reported an error');
    assert.equal(item.source.commit, source.commit, 'Different source SHAs');
    assert.equal(item.source.vsixSha256, source.vsixSha256, 'Different VSIX hashes');
    assert.ok(source.commit && source.commit !== 'unrecorded', 'Unrecorded source SHA');
    assert.ok(source.vsixSha256, 'Missing packaged VSIX SHA-256');
    assert.equal(item.environment.fixtureFiles, fixture.fixtureFiles, 'Different fixture file counts');
    assert.equal(item.environment.fixtureBytes, fixture.fixtureBytes, 'Different fixture sizes');
    assert.equal(item.environment.fixtureManifestSha256, fixture.fixtureManifestSha256,
        'Different fixture manifests');
    assert.equal(item.environment.syntheticIoLatencyMsPerFixtureOperation, 0,
        'Artificial latency is not physical storage evidence');
    assert.equal(item.environment.fixturesRemoved, true, 'Disposable benchmark fixture was not removed');
    assert.equal(item.environment.warmups, fixture.warmups, 'Different warmup counts');
    assert.equal(item.environment.timedSamples, fixture.timedSamples, 'Different timed sample counts');
    assert.deepEqual(item.environment.settings, fixture.settings, 'Different Validator settings');
    for (const name of sameHostFields) {
        assert.equal(item.environment[name], fixture[name],
            labels[i] + ': different Windows client identity ' + name);
    }
    assert.deepEqual(Object.keys(item.results || {}).sort(), expectedScenarios,
        labels[i] + ': missing or unexpected benchmark scenario');
    const first = item.results.firstAnalysis;
    assert.ok(Number.isFinite(first.elapsedMs) && first.elapsedMs >= 0,
        labels[i] + ': invalid first-engine observation');
    requireFingerprint(first.diagnosticSignature, labels[i] + '/firstAnalysis');
}
assert.equal(new Set(data.map((item, i) => requireFingerprint(
    item.results.firstAnalysis.diagnosticSignature, labels[i] + '/firstAnalysis'))).size,
1, 'First-analysis diagnostic parity failed across storage spellings');
const result = {
    schemaVersion: 1, sourceSha: source.commit, vsixSha256: source.vsixSha256,
    fixture: { files: fixture.fixtureFiles, bytes: fixture.fixtureBytes,
        manifestSha256: fixture.fixtureManifestSha256 },
    note: 'Labels are operator-assigned; this script does not verify SMB, NTFS or cache state. Core FS calls are not network packets. p95 uses nearest rank.',
    rows: []
};
for (const key of repeatedScenarios) {
    const signatures = [];
    for (const [i, item] of data.entries()) {
        const trials = item.results[key]?.trials;
        assert.ok(Array.isArray(trials), labels[i] + '/' + key + ': missing trial array');
        assert.equal(trials.length, item.environment.timedSamples,
            labels[i] + '/' + key + ': raw trial count differs from declared sample count');
        for (const [index, trial] of trials.entries()) {
            requireFingerprint(trial.diagnosticSignature, labels[i] + '/' + key +
                '/trial-' + index);
            for (const operation of ['readFileSync', 'existsSync', 'readdirSync']) {
                assert.ok(Number.isSafeInteger(trial[operation]) && trial[operation] >= 0,
                    labels[i] + '/' + key + '/trial-' + index +
                    ': missing or invalid ' + operation);
            }
        }
        const elapsed = trials.map(t => t.elapsedMs);
        assert.ok(elapsed.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0),
            labels[i] + '/' + key + ': invalid elapsed time');
        const uniqueSignatures = [...new Set(trials.map(t => t.diagnosticSignature))];
        assert.equal(uniqueSignatures.length, 1, labels[i] + '/' + key + ': diagnostics changed within trials');
        signatures.push(uniqueSignatures[0]);
        const median = nearestRank(elapsed, 0.5);
        const p95 = nearestRank(elapsed, 0.95);
        assert.equal(median, item.results[key].summary.medianMs, 'Stored median disagrees with trials');
        assert.equal(p95, item.results[key].summary.p95Ms, 'Stored p95 disagrees with trials');
        result.rows.push({
            storage: labels[i], scenario: key, samples: trials.length,
            warmups: item.environment.warmups, medianMs: median, p95Ms: p95,
            readFileSync: nearestRank(trials.map(t => t.readFileSync), 0.5),
            existsSync: nearestRank(trials.map(t => t.existsSync), 0.5),
            readdirSync: nearestRank(trials.map(t => t.readdirSync), 0.5),
            diagnosticSignature: uniqueSignatures[0]
        });
    }
    assert.equal(new Set(signatures).size, 1, key + ': diagnostic parity failed across storage spellings');
}
const csvHeader = ['storage', 'scenario', 'samples', 'warmups', 'medianMs',
    'p95Ms', 'readFileSync', 'existsSync', 'readdirSync', 'diagnosticSignature'];
const csv = [csvHeader.join(','), ...result.rows.map(row =>
    csvHeader.map(key => String(row[key])).join(','))].join('\n') + '\n';
for (const outfile of inputs.slice(3)) {
    fs.mkdirSync(path.dirname(path.resolve(outfile)), { recursive: true });
}
fs.writeFileSync(inputs[3], JSON.stringify(result, null, 2) + '\n');
fs.writeFileSync(inputs[4], csv);
console.log('Verified ' + result.rows.length + ' storage/scenario summaries from raw trials.');
