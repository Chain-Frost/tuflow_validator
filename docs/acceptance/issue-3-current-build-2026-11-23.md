# Issue #3 — current-build performance and supported network-workspace lifecycle

**Assessment prepared:** 23 November 2026.  
**Tracking:** [issue #3](https://github.com/Chain-Frost/tuflow_validator/issues/3) — evidence/test work only, Refs #3.  
**Base production source:** main at 78050053c5330bd51f49fea536c6f6f7524080e4.  
**Status:** genuine current-build UNC/mapped SMB acceptance **NOT YET RUN**. Hosted Windows local-only current-build acceptance passed at evidence SHA `82f85d2c07f011a633387de00af41986de3098aa`; native watcher attribution and performance acceptance thresholds remain unverified.

The evidence branch adds only opt-in probes, a summariser, this record and local-only hosted CI. Record the final branch SHA independently from the unchanged base main source SHA.

## Reused evidence, with correct provenance

- [Final main CI](https://github.com/Chain-Frost/tuflow_validator/actions/runs/45166290943) passed Windows/Linux × VS Code 1.74/current Stable on final main. The [TRD-context regression](../../src/test/suite/trd_editor_context.test.ts) uses an actual close event, removes B-only shared diagnostics while A survives, and verifies reopening. Its minimum-editor correction keeps the renamed document live during the language change. This is **not real-SMB installed-VSIX disposal evidence**.
- [Historical real Windows SMB evidence](https://github.com/Chain-Frost/tuflow_validator/tree/3600377d823562bbe3aebd6abdfd58407798f12e/docs/acceptance/windows-network-2026-11-23) tested earlier B 889d5e2 and D2 f584550 source, **not current main**. N=19 warm trials after three warmups: wide graph median B→D2 local 94.129→65.527 ms, mapped 273.598→120.963 ms, UNC 323.267→154.845 ms; directory enumerations 121→2 without diagnostic changes. The old network probe could not produce actual TextDocument disposal. Process handle values were not native watcher counts.
- [PR #28](https://github.com/Chain-Frost/tuflow_validator/pull/28) and [PR #29](https://github.com/Chain-Frost/tuflow_validator/pull/29) supersede [unmerged investigation PR #18](https://github.com/Chain-Frost/tuflow_validator/pull/18). Preserve its [immutable historical report at 3940b4b9](https://github.com/Chain-Frost/tuflow_validator/blob/3940b4b9ddbb1b1799ebdb1b37dca014b8fec6bd/docs/investigations/f08-trd-editor-root.md), recommend closing #18 **unmerged**, and do not import its old observational probe or workflow.

## Evidence matrix — current assessment

| Question | Classification | Completion evidence |
| --- | --- | --- |
| Static variables, dependencies, F08 parent context, latest version, manual refresh and minimum-host behavior on main | **PASSED (existing main CI)** | Full regression, exact-main CI 45166290943; do not repeat 240 transitions |
| Current-build installed VSIX, hosted Windows local workspace lifecycle | **PASSED (hosted local only)** | [Run 45174533535](https://github.com/Chain-Frost/tuflow_validator/actions/runs/45174533535): actual close/reopen, independent diagnostics, installed 11/11 runtime JS byte identity and scratch cleanup |
| Current-build synchronous validation on genuine local NTFS | **BLOCKED (NTFS not independently verified)** | Hosted Windows temporary local core passed; local operator must establish physical NTFS and collect matching 19-trial raw JSON |
| Current-build synchronous validation on remote UNC and matching mapped SMB | **BLOCKED here** | Owner-approved real remote share and same-build/fixture raw samples for each spelling |
| Current installed supported-workspace file create/delete smoke | **PASSED (hosted local only)** | Installed extension received diagnostic event with target state changes; genuine SMB spellings still to test |
| Current installed network workspace: close event, B-only retirement, other parent preserved, last-root retirement, stale callbacks, reopening | **BLOCKED here** | Real onDidCloseTextDocument and isClosed=true, before/after diagnostics, two bounded cycles, not merely closed tabs |
| Native watcher types/identities attributed to active Validator | **BLOCKED / not exposed by current package** | Only attributable native traces if available. A missing native counter is a measurement limit, not automatically a product defect |
| OS process handles/RSS/heap, Node handle proxy and isolated host shutdown | **PASSED (hosted local samples only)** | 16 measured phases at actual extension-host PID, isolated runner exit; these are *not* native watcher identities or a no-leak claim |
| Earlier B/D2 SMB speedup and tab-close observations | **HISTORICAL-ONLY** | Retain old source SHAs and evidence |
| Outside-workspace SMB automatic notification | **ACCEPTED UNSUPPORTED** | Permanent owner decision; [#23](https://github.com/Chain-Frost/tuflow_validator/issues/23) closed as not planned |

PASSED requires a directly observed result on identified source and environment. DEFECT requires a minimal in-scope reproducer. BLOCKED identifies missing hardware, access or observability. HISTORICAL-ONLY cannot qualify a different source. No invented latency or memory acceptance threshold is applied.

## Completed current-build hosted Windows evidence (not SMB)

[Exact-head hosted run 45174533535](https://github.com/Chain-Frost/tuflow_validator/actions/runs/45174533535) passed at evidence source SHA `82f85d2c07f011a633387de00af41986de3098aa`; it differs from unchanged production main only by opt-in tests, workflow and documentation. The VSIX SHA-256 was `81b9ffb56024fff98767a72880bd1cdfcfe083f566df6d65f9baacbea20531f8`; all 11 installed runtime JavaScript modules were byte-identical to compiled source. Actual VS Code 1.147.0 / Extension Host Node 24.22.1; build Node 22.23.5.

The installed probe passed 16 diagnostic/resource snapshots, two cycles of **actual** A/B `onDidCloseTextDocument` events and original `isClosed=true`, removal of B-only errors with A unchanged, last-root error retirement, no stale callback republishing, and independent A/B reopening. A supported local workspace file create/delete smoke test passed; `isClosed=false` notifications for the intermediate renamed document were not misclassified as root closure. Scratch sentinels retained hashes, temporary directories and the isolated profile were removed, and the runner observed extension-host termination.

The synthetic core corpus has **183 files / 117,425 bytes** and fixture manifest SHA-256 `55a7a7a506948fc5317c00ce8dac5f24e86e739d15d04c07657de398c45f163d`. N=19 warm trials after 3 discarded warmups: **wide median/p95 124.226/131.516 ms**; **121 reads, 576 exists, 2 readdir** per wide trial. Windows hosted temporary storage was not independently certified NTFS; there is no current real SMB, cold physical-disk, native watcher-type or owner-defined latency acceptance claim. [Raw trial and lifecycle JSON artifact 14818292138](https://github.com/Chain-Frost/tuflow_validator/actions/runs/45174533535/artifacts/14818292138).

The full cross-platform VS Code 1.74/current Stable matrix, [run 45174533609](https://github.com/Chain-Frost/tuflow_validator/actions/runs/45174533609), also passed with identical file-tree identity between its GitHub test merge commit and `82f85d2`. [Core baseline workflow](https://github.com/Chain-Frost/tuflow_validator/actions/runs/45174533556) and [D2 workflow](https://github.com/Chain-Frost/tuflow_validator/actions/runs/45174533449) passed. Codex identified two P2 fail-open gaps in the first three-spelling matrix implementation: dropped scenario arrays and absent fingerprints could spuriously pass. The matrix now requires all reviewed repeated scenarios and a real SHA-256 signature for each first/warm trial; dedicated negative tests exercise missing scenarios, missing/null fingerprints, mismatched parity and provenance. **The first hosted results precede these evidence-only matrix test corrections; their exact source identity is retained, and revised-head CI/review must pass separately before any integration.**

## Fixture coverage and probe limits

The reviewed [core benchmark](../../scripts/benchmarks/core-baseline.cjs) produces **183 files / 117,425 bytes**: depth-48 graph, 120-wide graph with 32 shared references, two roots, 24 static-variable contexts, 4,000-line text, and version-sibling changes. Its raw JSON includes 19 warm trials after three discarded warmups, first-engine result separately, per-analysis filesystem API calls, diagnostic signatures, CPU/RSS proxies, source hash and package hash. Core timing **excludes** debounce, activation, VS Code event delivery and rendering. Filesystem API calls are **not** SMB packets.

The new [installed lifecycle probe](../../scripts/acceptance/issue3-lifecycle-probe.cjs) uses two TCF roots, a shared TRD, nested TRD, five physical-file sentinels, conditional concrete missing paths, unresolved runtime substitutions, a dirty child and an external missing-file create/delete. Its [runner](../../scripts/acceptance/run-issue3-lifecycle.cjs) creates an isolated profile/workspace, installs the recorded VSIX, compares installed runtime JS to compiled source, records real close events and exact diagnostic snapshots, and checks sentinel hashes and unique-fixture removal.

Process handles are measured using Windows Get-Process against the **actual extension-host process PID**, whereas Node activeHandleProxy is a runtime proxy. Neither establishes native FileSystemWatcher identities or leak freedom. The script does **not** import a second copy of Validator's diagnostics module to pretend it is the active installed instance.

## Focused local Windows procedure

Use one Windows workstation with three pre-existing **approved disposable scratch parents**: local NTFS, a real remote SMB UNC parent, and a mapped-drive alias of that same remote parent. Verify real SMB to a separate server (Get-SmbMapping, established remote TCP/445, or equivalent); do not label a local or loopback share genuine remote SMB. Record sanitized CPU, OS/build, VS Code/editor Node/build Node, server/share relation, network/cache details and effective settings. If a native watcher tool or SMB dialect metadata is unavailable, document that limit rather than changing permissions.

Do not point these scripts at an operational model, GeoPackage or unapproved share. Do not remap drives, clear server caches, change permissions, start outages or run an old 240-transition campaign. The scripts remove only new unique tpv-core-benchmark-*, tpv-issue3-lifecycle-* and local profile fixture children, never the supplied parent. Redact private server names/paths before public evidence upload.

Run from an isolated checkout of the evidence branch. Verify the diff from base main contains *only* test scripts, workflow and documentation. Source main production must remain unchanged.

~~~powershell
git fetch origin
git switch evidence/issue-3-current-build-20261123
git rev-parse HEAD
git diff --name-only 78050053c5330bd51f49fea536c6f6f7524080e4 HEAD

npm ci
npm run compile
npm run lint
npm run package:vsix:ci
python scripts/verify-vsix.py validator-ci.vsix

$source = (git rev-parse HEAD).Trim()
$vsix = (Resolve-Path .\validator-ci.vsix).Path
$evidence = Join-Path $PWD 'issue3-evidence-local'
New-Item -ItemType Directory -Force -Path $evidence | Out-Null

# REPLACE with three existing OWNER-APPROVED disposable scratch parents.
$parents = @{
  ntfs   = 'C:\approved-disposable-tests'
  unc    = '\\remote-server\share\approved-disposable-tests'
  mapped = 'X:\approved-disposable-tests'
}
# Verify identical UNC/mapped share, real SMB transport, and local NTFS separately.
$env:TPV_SOURCE_SHA = $source
$env:TPV_VSIX_PATH = $vsix
$env:TPV_BENCHMARK_SAMPLES = '19'
$env:TPV_BENCHMARK_WARMUPS = '3'
$env:TPV_ISSUE3_VSIX = $vsix
$env:TPV_ISSUE3_APPROVED = 'YES'
$env:TPV_VSCODE_VERSION = 'stable'
Remove-Item Env:\TPV_SYNTHETIC_IO_MS -ErrorAction SilentlyContinue

foreach ($label in @('ntfs','unc','mapped')) {
    if (-not (Test-Path -LiteralPath $parents[$label] -PathType Container)) {
        throw "Approved parent missing for $label"
    }
    $env:TPV_STORAGE_LABEL = "$label - verified separately by operator"
    $env:TPV_BENCHMARK_FIXTURE_PARENT = $parents[$label]
    $env:TPV_BENCHMARK_OUTPUT = Join-Path $evidence "core-$label.json"
    node scripts/benchmarks/core-baseline.cjs
    if ($LASTEXITCODE -ne 0) { throw "Core benchmark failed for $label" }

    $env:TPV_ISSUE3_FIXTURE_PARENT = $parents[$label]
    $env:TPV_ISSUE3_OUTPUT = Join-Path $evidence "lifecycle-$label.json"
    node scripts/acceptance/run-issue3-lifecycle.cjs
    if ($LASTEXITCODE -ne 0) { throw "Installed lifecycle failed for $label" }
}
node scripts/acceptance/issue3-core-matrix.cjs (Join-Path $evidence 'core-ntfs.json') (Join-Path $evidence 'core-unc.json') (Join-Path $evidence 'core-mapped.json') (Join-Path $evidence 'core-summary.json') (Join-Path $evidence 'core-summary.csv')
if ($LASTEXITCODE -ne 0) { throw 'Benchmark parity/provenance validation failed' }
~~~

The matrix tool validates source/VSIX and fixture identity, raw nearest-rank median/p95 and diagnostic parity across spellings. At N=19, nearest-rank p95 is the largest trial; retain all raw distributions. Separate first-engine from warmed trials: fixture generation warms OS caches, so there is **no cold physical disk claim**. Do not compare core synchronous milliseconds to editor action-to-diagnostic times, which include debounce, scheduling and notification. Probe timeouts are not successful latency observations. The lifecycle probe is deliberately short; do not repurpose it as a full-model benchmark.

For each local result, examine actual closeEvents and original isClosed, B-only error disappearance and A's preserved errors, last-root cleanup, stale callback check and reopening. A rename-to-non-control-suffix induces closure; editor tabs alone do not. Report bounded process-handle/RSS/heap changes over two cycles without inventing a native watcher count or resource limit. If a genuine Windows SMB close event cannot be observed, retain exact logs and classify as BLOCKED pending a narrow owner evidence decision—not proof of a leak.

## Closure recommendation and safeguards

**Do not close #3 in this assignment.** If current genuine-SMB tests pass for core parity, workspace notifications and actual close/reopen, recommend later owner closure with the native watcher observability limit stated explicitly, without an absolute latency budget. If actual network document closure remains unobservable despite the proven rename sequence, request a narrow owner decision about accepting that limitation. An actual supported-workspace defect requires a reproducer and a separate minimal fix/regression PR, not an investigation of outside-workspace notifications.

Every proposed PR needs an independent Codex review of its final head, addressed findings and relevant passing CI before later integration. No merging, tagging, publishing, release, issue closure, polling, recursive fallback, speculative async rewrite, GeoPackage reader from deferred PR #9, F13 model-wide validation or changes to F05/F09/F10 are authorised.
