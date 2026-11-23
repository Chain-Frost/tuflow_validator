# Core Validator performance — reproducible D1 baseline (draft)

**Tracking:** [issue #3](https://github.com/Chain-Frost/tuflow_validator/issues/3) ·
**Source parent:** main at 4a0282e93b979345374076fb0adc60c7faf6af99 (2026-11-22) ·
**Implementation:** instrumentation and fixtures only. No production runtime, version, release or publishing changes.

## Status / scope of evidence

- **D1 benchmark harness:** implemented in scripts/benchmarks/core-baseline.cjs. Each CI run packages the *same checked-out source* into a VSIX, records its SHA-256, and saves full raw trials as an Actions artifact. Record actual job URL, source SHA, VSIX hash and numeric results **only once the jobs have completed**; no unrun check is called a pass.
- **Core microbenchmarks:** benchmark the real compiled src/diagnostics.ts, src/versioning.ts, and src/io.ts with a minimal VS Code API adapter. The adapter exists only so the core engine can be measured independently of editor startup/provider overhead. It does not replace VS Code integration tests.
- **Real VS Code host:** Separate Validator-only Extension Host probes now run on both Linux and hosted Windows. It measures first diagnostic arrival, ten root edits, ten included-child edits, heartbeat jitter, a version-sibling event and document-close observations. Helper [PR #16](https://github.com/Chain-Frost/tuflow-vscode/pull/16) still owns the broader four-profile coexistence measurements. Neither result is a native watcher-count audit.
- **Storage:** CI uses a disposable local runner temp directory. The backing physical medium is not verified. No network share is available in this environment. The optional injection of 0.75 ms **per synchronous fixture filesystem call** is synthetic blocking, **not** a mapped-drive/UNC measurement.
- **Cold:** "first analysis" means first engine invocation after generated fixture creation; it is **not a cold OS disk/page cache**, nor is it cold VS Code activation. No OS cache clearing is attempted. Warm trials run in the same process after three discarded warmups.
- **GeoPackage:** only a zero-byte disposable .gpkg file is created for physical *file existence* checks. The harness never reads SQLite/GPKG records or layers. Deferred PR #9's reader/workers are not imported.

**D1 remains incomplete for real Windows mapped-drive/UNC evidence and full editor/coexistence acceptance.** A Linux Validator-only Extension Host run now exists; this is not representative Windows/network qualification. Keep the PR draft, and do not close issue #3 on local-only results.

## Recorded measurements — 22 November 2026

**Pinned, completed CI run:** [GitHub Actions #45038937417](https://github.com/Chain-Frost/tuflow_validator/actions/runs/45038937417), tested source **5b8f05915d9f93ca9a698a1460150cefe53fb90e**. Both Linux and Windows benchmark jobs passed. The associated raw, per-trial JSON and per-fixture hashes are stored in that run's artifacts **tpv-core-linux** and **tpv-core-windows** (30-day retention). Rebuild/re-run the script from the pinned source SHA after artifact expiry. The same fixture manifest SHA-256 on both platforms is **55a7a7a506948fc5317c00ce8dac5f24e86e739d15d04c07657de398c45f163d**: 183 generated files totalling 117,425 bytes. Full default settings and CPU/OS/version metadata are in the JSON.

| Core synchronous validation scenario | Linux median / p95 (ms) | Windows median / p95 (ms) |
|---|---:|---:|
| First core analysis (single trial) | 3.10 / N/A | 8.19 / N/A |
| Warm analysis | 0.29 / 0.50 | 0.69 / 2.16 |
| Single-character dirty root edit | 0.25 / 0.32 | 0.55 / 1.04 |
| Included-child changed-path revalidation | 0.62 / 29.95 | 0.73 / 1.06 |
| Version-sibling **explicit** revalidation | 0.35 / 0.50 | 0.50 / 0.73 |
| Two roots, shared included-child change | 0.85 / 24.43 | 1.13 / 2.11 |
| 24 alternating variable contexts | 1.82 / 2.75 | 3.61 / 5.18 |
| Depth-48 include chain | 4.07 / 5.63 | 6.54 / 9.17 |
| 120 wide + 32 shared includes | **32.53 / 62.49** | **66.36 / 112.14** |
| 4,000-line file, 400 missing inputs | 3.54 / 3.81 | 7.77 / 8.61 |

N=19 timed trials after three discarded warmups, except first analysis N=1. These are two CI machines, **not a controlled matched-hardware comparison**. At least two Linux p95s include large runner outliers; compare distributions and replicate, not just single p95s. The wide graph uses **305 reads, 576 existence checks, 121 directory enumerations** per analysis on either OS. This confirms repeated metadata work and **synchronous extension-host blocking potential**. The measured wide-graph p95 exceeds the proposed 50 ms investigation flag on both machines, which justifies considering focused operation reduction **after** Agent A/B integration. It does not by itself justify a specific D2 patch.

Linux synthetic 0.75 ms per fixture FS operation (N=9) raised wide-graph median/p95 to **784.07/786.15 ms**; a 4,000-line file to ~305.53 ms median. This deliberately injects CPU-blocking latency and is **not a UNC trace or an estimate of actual share speed**. No metadata caches or disk page caches were explicitly cleared.

**Artifact hashes and toolchain:** Linux VSIX SHA-256 **28f04651e21c062791e04a0ba6371f15d11fdf44908aa6a51bc6969624835938**; Windows VSIX SHA-256 **70b91cb5169c8936b0014bbce8b8b5ce05687e03ff01fe9156d6378634af46f8**. These were separately packaged on each runner and differ; don't substitute one for the other. Both core runs used Node **22.23.5**. Linux kernel release **7.0.0-1020-azure**; Windows OS release **10.0.26100**. The VSIX package and exact settings are recorded in each JSON file.

**Actual Linux VS Code Extension Host:** source 5b8f059, VS Code **1.147.0**, extension-host Node **24.22.1**, Validator **0.2.6** initially inactive. First opened-document diagnostic arrived in **311.03 ms** (N=1, activation/readiness proxy). Ten real single-character editor edits had **351.75 / 372.82 ms** median/p95 from VS Code applyEdit to diagnostic event; ten included-child edits had **351.01 / 352.34 ms**. Those numbers include the existing **300 ms debounce** and host event delivery; core-only numbers exclude both. During the probes the 10 ms extension-host heartbeat median/p95 scheduling delay was **0.10 / 1.17 ms**, maximum 2.04 ms. These edit-probe results are for a small local fixture, not the large wide graph in an Extension Host.

**Version sibling event:** After generating a new geom_v03.tgc beside an already referenced geom_v01.tgc, the core changed-path entry point returned **false** on both platforms and the actual Linux host observed **no diagnostic refresh event** during its observation window. An explicit revalidation does reevaluate versions. This is a specific dependency-invalidation gap for Agent B; **preserve the existing version identification algorithm**. It is distinct from code correctness of finding the latest version when analysis runs.

**Document/root disposal limitation:** The fake core adapter removed all fake root documents and returned to zero logical dependency paths. In the actual VS Code host, the command to close all visible editors left both benchmark documents in vscode.workspace.textDocuments with isClosed=false, no document-close events, and three tracked dependencies. Thus **the actual root-close/dispose path was not exercised** and this is not evidence of a resource leak. No native watcher count was obtained; file descriptors were 44 before/after visible-editor closure. Proper document/root disposal, settings invalidation, outstanding work and cancellation still require targeted tests.

### Expanded Windows and Linux Extension Host evidence

**Cross-platform host run:** [Actions run #45040894524](https://github.com/Chain-Frost/tuflow_validator/actions/runs/45040894524), exact measured source **9fcf6278c6d2911b4212f67aee46fb5154cd6177**, local core and real Extension Host jobs passed on **both Windows and Linux**. Windows fixture teardown initially failed with a transient ENOTEMPTY error, then passed after bounded retry logic with documented **fixturesRemoved=true** in both host JSON reports. Full raw distributions, hashes and diagnostic snapshots are in the artifacts linked from that run. The subsequent module-observability clarification does not change production Validator behavior or its timing algorithm.

| Host observation | Linux | Windows |
|---|---:|---:|
| VS Code | 1.147.0 | 1.147.0 |
| Extension-host Node | 24.22.1 | 24.22.1 |
| Initial diagnostic arrival (N=1) | 276.02 ms | 846.03 ms |
| Root edit-to-diagnostic median / p95 (N=10) | 353.76 / 397.30 ms | 359.92 / 374.61 ms |
| Included-child edit-to-diagnostic median / p95 (N=10) | 352.43 / 353.28 ms | 362.02 / 376.60 ms |
| 120-child + 32-repeated-include host validation (N=1) | **161.03 ms** | **187.03 ms** |
| 10 ms heartbeat scheduling delay during wide validation, maximum | **95.13 ms** | **122.10 ms** |

The wide graph correctly produced **120 child-issue summary diagnostics** on each host. A single host-wide sample has no meaningful p95. Heartbeat jitter is a timer-delay proxy, not total editor frame blocking; its small N during the wide validation is explicitly recorded. Even so, these two actual Extension Host runs show significant uninterrupted work on the local wide fixture; this justifies investigating repeated synchronous directory work in the future D2 branch, subject to testing against B's latest source.

Core wide-graph run at the same exact source: **Linux median/p95 46.89/58.50 ms; Windows 70.97/75.57 ms** (N=19 each), 305 synchronous reads, 576 exists checks and 121 directory enumerations. The Linux synthetic +0.75 ms/call wide median was **807.15 ms**. This remains a synthetic local fixture, not a representative UNC share.

**Probe qualification:** Linux reported 244 dependency paths through a direct Node require() of the extension's diagnostics module, while Windows reported **zero despite confirmed live diagnostics**. An imported module may not share the active extension's module instance across host processes. The Windows zero therefore **cannot** establish that the active Validator has zero tracked dependencies/watchers. The additional probe records that uncertainty. The OS/native watcher count and actual document-disposal behavior are still unverified, and neither process-handle proxy can be equated to watcher count. Closing visible tabs did not cause a document-close event in either measured run. No actual memory or handle leak is established.

**VSIX SHA-256:** Linux **c4a119388d662bc8acd3132cb72b6404f0695f7279f32e6b59198716ff85e449**; Windows **49ce658029cbe918667d628f02391f7c25dbf4c5996870617aaefe0ef7fae50d**. Both reported the same disposable core fixture manifest SHA-256 55a7a7a506948fc5317c00ce8dac5f24e86e739d15d04c07657de398c45f163d. The different VSIX archive hashes are actual separately packaged bytes on the two OSes and must not be silently treated as identical.

### Real mapped-drive/UNC handoff (not run)

On a Windows machine with a known, writable, **disposable benchmarking folder** on a genuine SMB share or mapped drive, use the same repository revision and packages, and specify the fixture parent explicitly. The harness creates **only a new unique tpv-core-benchmark-* subdirectory** under this parent and deletes that subdirectory afterward. **Do not point it at a live model folder**; do not modify an existing model or GPKG.

~~~powershell
npm ci
npm run compile
npx vsce package --out benchmark-source.vsix
$env:TPV_SOURCE_SHA = (git rev-parse HEAD)
$env:TPV_VSIX_PATH = (Resolve-Path .\benchmark-source.vsix).Path
$env:TPV_BENCHMARK_FIXTURE_PARENT = '\\server\share\disposable-perf-tests'
$env:TPV_BENCHMARK_NETWORK_EVIDENCE = 'Real SMB UNC path; verify in environment record'
$env:TPV_STORAGE_LABEL = 'Windows real SMB, document server/client/mapped vs UNC, network type, latency, cache'
$env:TPV_BENCHMARK_OUTPUT = (Join-Path $PWD 'benchmark-real-unc.json')
$env:TPV_BENCHMARK_SAMPLES = '19'
node scripts/benchmarks/core-baseline.cjs
~~~

The real environment record must also identify the source machine, share server, link/VPN details, representative model size, current cache state, warm vs freshly opened results, and baseline local results on the **same machine**. A label supplied by an operator does not verify that the storage was genuinely remote. Only record cache-cleared results if the operator actually used and documented a safe clearance procedure. Avoid destructive eviction of production caches.

### Independent review and corrected measurement boundary

[Codex independent review](https://github.com/Chain-Frost/tuflow_validator/pull/16) identified two P2 benchmark methodology errors on an earlier source: fixture writes were incorrectly timed as core revalidation work for included-child and multi-root events, and the version-sibling observation captured diagnostics **before** invoking the changed-path handler. Both were fixed on benchmark driver commit **754d91df193fc79ea431a87390a2d6dd768d7609**. [Exact-source benchmark run 45041757131](https://github.com/Chain-Frost/tuflow_validator/actions/runs/45041757131) and [standard integration run 45041757142](https://github.com/Chain-Frost/tuflow_validator/actions/runs/45041757142) passed on that correction. The review findings were answered and resolved, and a new review was requested.

**Historical method caveat:** The earlier local *included-child* and *two-root child-change* rows in the table above are **superseded for the pure revalidation timing boundary** because they included the time to write the disposable fixture. Their filesystem read/existence/directory counts and diagnostic observations remain useful. The corrected driver performs mutations **outside** timed wall/CPU measurements and records version-sibling diagnostics after triggering revalidation. Download the current Actions artifacts for corrected edit timings; never combine old and new rows in a before/after comparison.

A matched [main-based versus A1/A2/B source run 45041594672](https://github.com/Chain-Frost/tuflow_validator/actions/runs/45041594672) used the same local Linux runner and identical generated fixtures. Agent B at pinned commit **889d5e2e1951fe7de6edc187ea4508e6037d2179** cut wide-graph physical reads **305 → 121**, but synchronous existence checks were **576** and sibling-directory enumerations **121** in both. Its wide-graph median was **43.31 ms** versus **31.13 ms** for main-based source in this run. These are different functionality/branch source snapshots; do **not** interpret the difference as a regression attributable to the snapshot itself.

A separate **D2 draft PR #22**, stacked **directly on Agent B PR #21**, now evaluates an *analysis-scoped directory-listing cache* with paired B-before/D2-after raw trials and Agent E-style cross-platform host/VSIX checks. It does not import the deferred GeoPackage reader. **B and E remain unmerged, and true UNC storage evidence remains open**.

## Cases exercised

| Case | Fixture/action | Measurement boundary |
|---|---|---|
| First + warm | Root TCF, versioned referenced TGC, existing GPKG, missing GIS input | Complete synchronous core revalidation; first run once, warm 19 samples |
| Single-character edit | Alternate A/B in a root comment | Direct core revalidation after in-memory dirty document mutation; **excludes 300 ms VS Code edit debounce** |
| Included-child change | Rewrite a referenced TGC comment, then call the same changed-path revalidation entry point used by watchers | Measures core revalidation *after* delivery; **excludes OS watcher notification time** |
| Version sibling | Create a newer sibling and send the corresponding changed-path event; then explicitly revalidate root | Records whether the event currently triggers revalidation; **does not presume sibling event correctness** |
| Multiple roots | Two open TCF roots that share an included TGC | Changed-path impact across both roots, merged diagnostics |
| Different variable contexts | 24 alternating static Set Variable assignments referencing the same TRD, half existing / half missing | Repeated evaluation in distinct contexts; no path-only result cache |
| Deep graph | 48 nested TRD includes | Full recursive traversal, no speculative cutoff |
| Wide/shared graph | 120 child TRDs and 32 references to the same TRD | Shared includes, file reads and directory enumeration counts |
| Large control text | 4,000 lines including 400 missing inputs | Scaling with line count; diagnostic completeness |

Each trial collects elapsed wall time, CPU user/system time, RSS/heap before and after, filesystem read/existence/readdir/stat calls and distinct targets (limited to fixture paths), diagnostic signature/count, logical dependency count, logical parent-directory count, process active-handle **proxy**, and Linux process FD count. The handle/directory quantities are **not VS Code native watcher counts**. Source/VSIX hashes, OS/Node/CPU, fixture hashes/sizes, settings, sample counts and teardown status are included in the JSON.

Diagnostics must be deterministic across the repeated deep/wide/context cases and missing input diagnostics must remain present. After closing all fake root documents, recorded dependency state should clear. The benchmark does **not** mutate real model files, use TUFLOW, inspect GPKG contents, or infer runtime scenario/event values.

## Reproduction

From the repository's benchmark branch (or a fixed commit), with Node 22 and npm installed:

~~~sh
npm ci
npm run compile
npm run lint
npx vsce package --out benchmark-source.vsix
TPV_SOURCE_SHA="$(git rev-parse HEAD)" \
TPV_VSIX_PATH="$PWD/benchmark-source.vsix" \
TPV_BENCHMARK_OUTPUT="$PWD/benchmark-core.json" \
TPV_BENCHMARK_SAMPLES=19 \
node scripts/benchmarks/core-baseline.cjs
~~~

Optional **synthetic** blocking test, using the exact same source and settings:

~~~sh
TPV_SOURCE_SHA="$(git rev-parse HEAD)" \
TPV_VSIX_PATH="$PWD/benchmark-source.vsix" \
TPV_BENCHMARK_OUTPUT="$PWD/benchmark-synthetic.json" \
TPV_BENCHMARK_SAMPLES=9 \
TPV_SYNTHETIC_IO_MS=0.75 \
node scripts/benchmarks/core-baseline.cjs
~~~

The job "Validator core performance baseline" runs local core baselines on Linux and Windows, a separately labelled synthetic-latency run on Linux, and the Validator-only Linux Extension Host probe via TPV_BENCHMARK_HOST=1. Download the tpv-core-baseline-* artifacts for **individual** trial data and fixture manifest. Use the CI output for aggregates. The core runner deletes its disposable temp fixture directory in a finally block and writes the JSON even on an assertion failure. Host runner performs separate fixture teardown; true document-close coverage remains open.

For before/after comparisons, use equal source-based fixtures, identical sample counts, toolchain, runner architecture and storage. Pin the tested source SHA and VSIX hash. Repeat runs on the **same machine** when practical and publish raw data, not just percentages.

## Measurement gaps and handoff

| Evidence | State / required follow-up |
|---|---|
| Exact source revision, package hash and VSIX SHA-256 | Recorded above for completed Linux/Windows CI snapshot; raw artifact includes full hashes |
| Local Linux/Windows core time and metadata-operation counts | Recorded above with CI raw trials; not real network qualification |
| Synthetic filesystem latency sensitivity | Recorded above; **not network evidence** |
| Cold VS Code activation and first diagnostic arrival | Single Linux and Windows first-diagnostic proxy recorded; direct activation telemetry and true cold disk still unmeasured |
| Real editor event latency and extension-host heartbeat | Validator-only **Linux and Windows** host measured above; reuse Helper PR #16 for broader coexistence/editor profiles |
| OS/native watcher count, actual open handles and outstanding work | Not established by logical dependencies or the Node handle proxy; Windows direct module-import probe is specifically unverified |
| True cold-disk/cache-cleared results | Not measured; requires controlled machine, documented cache methodology |
| Mapped-drive/UNC, representative shared model | **Unavailable; open**. Record actual share latency, environment and cache state when available |
| Cleanup following editor/root closure, settings change and cancellation | Visible-editor close did not close VS Code documents; actual document-close/disposal, settings and cancellation remain unverified |

### Candidate optimisations (evidence-backed candidates, not approved)

Observed source inspection suggests synchronous readFileSync, existsSync, and repeated readdirSync calls in recursive traversal and latest-version checking. Recorded operation counts and latency sensitivity justify exploring operation reduction, but are not sufficient evidence for any particular code change without after/against-A+B comparisons. If operation counts and latencies warrant it, consider *within-analysis* raw-content/directory caching and bounded asynchronous IO first, preserving distinct variable contexts; separately assess targeted invalidation and generation-based cancellation. No persistent path-only cache of context-dependent results.

D2 must be its **own PR**, based on the exact integrated Agent A traversal + Agent B dependency fixes and using Agent E's CI. State that parent SHA and the D1 benchmark dependency. Show before/after raw trials with unchanged diagnostics, properly invalidated edits/settings/closed roots and no lost missing-file results. Timed-out promises alone do not demonstrate cancellation of a blocked OS operation. Unvisited graph state must be reported as incomplete, never valid. Do not introduce arbitrary small graph limits.

### Proposed performance budgets — **for owner approval only**

These are screening proposals, **not verified thresholds** or merge gates:

- **Extension-host uninterrupted synchronous work:** flag any p95 validation block over **50 ms** for investigation. Basis: a >50 ms uninterrupted Node extension-host operation can delay other extension services and interactive work; this is a responsiveness-risk trigger, not a guarantee of UI frame time.
- **Single-character/child change:** collect both engine time and **edit-to-diagnostic p95** with the current 300 ms debounce reported separately. Do not set a numerical total-latency target before real host measurements; the debounce is already a substantial component.
- **Network-hosted representative model:** no defensible millisecond target without a real UNC/mapped-drive trace and model size; record read/metadata operations and responsiveness first.
- **Correctness/resource use:** zero stale published diagnostics from cancelled/closed work, no duplicated Problems entries, consistent missing-file diagnostics and complete cleanup. These are functional requirements, not statistically approved latency budgets.

**Out of scope:** changing version-pattern/token checks, conditional missing-file semantics, model-wide parameter entry, TUFLOW execution/release selection, QGIS, file opening, Helper syntax/completion/hover, Error Lens behavior, GeoPackage inspection/PR #9, publishing/versioning.
