'use strict';

// Regression tests for fail-closed three-spelling evidence aggregation.
// Synthetic JSON here tests the matrix validator ONLY; it is not SMB/NTFS data.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const matrixScript = path.join(__dirname, 'issue3-core-matrix.cjs');
const repeated = [
    'warmAnalysis', 'singleCharacterEdit', 'includedChildChange',
    'versionSiblingExplicitRevalidation', 'multipleRootChildChange',
    'repeatedIncludeDifferentVariables', 'deepGraph', 'wideGraph', 'longControlFile'
];
const signature = 'e'.repeat(64);
function report() {
    const results = {
        firstAnalysis: { elapsedMs: 4.5, diagnosticSignature: signature }
    };
    for (const name of repeated) {
        const trials = Array.from({ length: 19 }, (_, index) => ({
            elapsedMs: index + 1, readFileSync: 121, existsSync: 576, readdirSync: 2,
            diagnosticSignature: signature
        }));
        results[name] = { summary: { medianMs: 10, p95Ms: 19 }, trials };
    }
    return {
        source: { commit: 'a'.repeat(40), vsixSha256: 'b'.repeat(64) },
        environment: { fixtureFiles: 183, fixtureBytes: 117425,
            fixtureManifestSha256: 'c'.repeat(64),
            syntheticIoLatencyMsPerFixtureOperation: 0, fixturesRemoved: true, warmups: 3,
            timedSamples: 19, platform: 'win32', arch: 'x64', node: 'v22.23.5',
            osRelease: '10.0.test', cpuModel: 'synthetic-test-cpu', cpuCount: 4,
            settings: { diagnosticLevel: 'hint', enableLatestVersionChecks: true,
                enableIfStatementChecks: true, enableIfStatementFormatting: false } },
        results
    };
}
function execute(mutator = () => {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tpv-issue3-matrix-test-'));
    try {
        const reports = [report(), report(), report()];
        mutator(reports);
        const paths = reports.map((value, i) => {
            const filename = path.join(directory, 'input-' + i + '.json');
            fs.writeFileSync(filename, JSON.stringify(value));
            return filename;
        });
        const jsonOut = path.join(directory, 'output.json');
        const csvOut = path.join(directory, 'output.csv');
        const processResult = spawnSync(process.execPath, [matrixScript, ...paths, jsonOut, csvOut],
            { encoding: 'utf8', timeout: 10000 });
        return {
            status: processResult.status, stderr: processResult.stderr,
            stdout: processResult.stdout, error: processResult.error,
            evidence: fs.existsSync(jsonOut) ? JSON.parse(fs.readFileSync(jsonOut, 'utf8')) : null,
            csv: fs.existsSync(csvOut) ? fs.readFileSync(csvOut, 'utf8') : null
        };
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
}
function expectRejected(change, message) {
    const actual = execute(change);
    assert.equal(actual.error, undefined, 'The test matrix process did not launch');
    assert.notEqual(actual.status, 0, 'Malformed evidence was accepted');
    assert.match(actual.stderr, message);
    assert.equal(actual.evidence, null, 'Rejected input must not write a passing JSON summary');
    assert.equal(actual.csv, null, 'Rejected input must not write a passing CSV summary');
}

test('complete evidence produces 9 x 3 rows with firstAnalysis excluded from warm trials', () => {
    const actual = execute();
    assert.equal(actual.status, 0, actual.stderr);
    assert.equal(actual.evidence.rows.length, 27);
    assert.equal(actual.csv.trimEnd().split('\n').length, 28);
    assert.deepEqual(new Set(actual.evidence.rows.map(r => r.scenario)), new Set(repeated));
    assert.ok(actual.evidence.rows.every(r => r.diagnosticSignature === signature &&
        r.samples === 19 && r.medianMs === 10 && r.p95Ms === 19));
});

test('missing wide graph in one spelling must fail instead of shrinking the matrix', () => {
    expectRejected(reports => { delete reports[1].results.wideGraph; },
        /missing or unexpected benchmark scenario/);
});
test('missing trial array must fail instead of skipping scenario', () => {
    expectRejected(reports => { delete reports[2].results.deepGraph.trials; },
        /missing trial array/);
});
test('missing diagnostic fingerprints in every trial must not pass parity', () => {
    expectRejected(reports => {
        for (const report of reports) {
            for (const name of repeated) {
                for (const trial of report.results[name].trials) delete trial.diagnosticSignature;
            }
        }
    }, /absent or invalid diagnostic fingerprint/);
});
test('null diagnostic fingerprint in any single trial must fail', () => {
    expectRejected(reports => { reports[1].results.wideGraph.trials[3].diagnosticSignature = null; },
        /absent or invalid diagnostic fingerprint/);
});
test('missing first-engine diagnostic fingerprint must fail', () => {
    expectRejected(reports => { delete reports[0].results.firstAnalysis.diagnosticSignature; },
        /absent or invalid diagnostic fingerprint/);
});
test('different diagnostic fingerprints across storage spellings must fail', () => {
    expectRejected(reports => {
        for (const trial of reports[2].results.wideGraph.trials) trial.diagnosticSignature = 'f'.repeat(64);
    }, /diagnostic parity failed across storage spellings/);
});
test('different fixture manifests must fail', () => {
    expectRejected(reports => { reports[1].environment.fixtureManifestSha256 = 'f'.repeat(64); },
        /Different fixture manifests/);
});
test('synthetic latency cannot be presented as genuine storage trials', () => {
    expectRejected(reports => { reports[0].environment.syntheticIoLatencyMsPerFixtureOperation = 0.75; },
        /Artificial latency is not physical storage evidence/);
});
test('missing scenario from every spelling must still fail', () => {
    expectRejected(reports => {
        for (const report of reports) delete report.results.wideGraph;
    }, /missing or unexpected benchmark scenario/);
});

test('different Validator settings cannot be compared', () => {
    expectRejected(reports => { reports[2].environment.settings.diagnosticLevel = 'none'; },
        /Different Validator settings/);
});
test('different Windows host identity cannot be compared', () => {
    expectRejected(reports => { reports[2].environment.cpuModel = 'another-host'; },
        /different Windows client identity/);
});
test('different discarded-warmup setting cannot be compared', () => {
    expectRejected(reports => { reports[1].environment.warmups = 2; },
        /Different warmup counts/);
});
test('a truncated trial set must be rejected rather than reinterpreted', () => {
    expectRejected(reports => { reports[1].results.wideGraph.trials.pop(); },
        /raw trial count differs from declared sample count/);
});
