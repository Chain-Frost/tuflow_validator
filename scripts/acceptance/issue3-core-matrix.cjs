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
const source = data[0].source;
const fixture = data[0].environment;
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
}
const result = {
    schemaVersion: 1, sourceSha: source.commit, vsixSha256: source.vsixSha256,
    fixture: { files: fixture.fixtureFiles, bytes: fixture.fixtureBytes,
        manifestSha256: fixture.fixtureManifestSha256 },
    note: 'Labels are operator-assigned; this script does not verify SMB, NTFS or cache state. Core FS calls are not network packets. p95 uses nearest rank.',
    rows: []
};
for (const key of Object.keys(data[0].results)) {
    if (!data.every(item => Array.isArray(item.results[key]?.trials))) continue;
    const signatures = [];
    for (const [i, item] of data.entries()) {
        const trials = item.results[key].trials;
        assert.ok(trials.length >= 19, labels[i] + '/' + key + ': fewer than 19 timed samples');
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
