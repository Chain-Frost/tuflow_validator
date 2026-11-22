# Core Validator performance — reproducible D1 baseline (draft)

**Tracking:** [issue #3](https://github.com/Chain-Frost/tuflow_validator/issues/3) ·
**Source parent:** main at 4a0282e93b979345374076fb0adc60c7faf6af99 (2026-11-22) ·
**Implementation:** instrumentation and fixtures only. No production runtime, version, release or publishing changes.

## Status / scope of evidence

- **D1 benchmark harness:** implemented in scripts/benchmarks/core-baseline.cjs. Each CI run packages the *same checked-out source* into a VSIX, records its SHA-256, and saves full raw trials as an Actions artifact. Record actual job URL, source SHA, VSIX hash and numeric results **only once the jobs have completed**; no unrun check is called a pass.
- **Core microbenchmarks:** benchmark the real compiled src/diagnostics.ts, src/versioning.ts, and src/io.ts with a minimal VS Code API adapter. The adapter exists only so the core engine can be measured independently of editor startup/provider overhead. It does not replace VS Code integration tests.
- **Real VS Code editor/coexistence:** Helper [PR #16](https://github.com/Chain-Frost/tuflow-vscode/pull/16) supplies compatible extension-host, language-ID, coexistence and full editor-profile acceptance measurements. Reuse its **actual run output when available**; its current draft runbook is *not* a measured result. Core-only results below do not establish activation, full editor responsiveness or native watcher/handle counts.
- **Storage:** CI uses a disposable local runner temp directory. The backing physical medium is not verified. No network share is available in this environment. The optional injection of 0.75 ms **per synchronous fixture filesystem call** is synthetic blocking, **not** a mapped-drive/UNC measurement.
- **Cold:** "first analysis" means first engine invocation after generated fixture creation; it is **not a cold OS disk/page cache**, nor is it cold VS Code activation. No OS cache clearing is attempted. Warm trials run in the same process after three discarded warmups.
- **GeoPackage:** only a zero-byte disposable .gpkg file is created for physical *file existence* checks. The harness never reads SQLite/GPKG records or layers. Deferred PR #9's reader/workers are not imported.

**D1 is not finished until representative network and VS Code extension-host evidence is attached.** This PR can remain draft with those environmental gates open. Never close issue #3 solely from CI/local timings.

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

The job "Core performance evidence (issue 3)" runs local core baselines on Linux and Windows, and a separately labelled synthetic-latency run on Linux. Download the tpv-core-baseline-* artifacts for **individual** trial data and fixture manifest. Use the CI output for aggregates. The runner deletes its disposable temp fixture directory in a finally block and writes the JSON even on an assertion failure.

For before/after comparisons, use equal source-based fixtures, identical sample counts, toolchain, runner architecture and storage. Pin the tested source SHA and VSIX hash. Repeat runs on the **same machine** when practical and publish raw data, not just percentages.

## Measurement gaps and handoff

| Evidence | State / required follow-up |
|---|---|
| Exact source revision, package hash and VSIX SHA-256 | Generated by each CI job; link completed run |
| Local Linux/Windows core time and metadata-operation counts | CI report, pending completion |
| Synthetic filesystem latency sensitivity | CI report, pending completion; **not network evidence** |
| Cold VS Code activation and first diagnostic arrival | Capture via real extension host; do not substitute Node core first analysis |
| Real editor event latency and extension-host heartbeat | Use compatible Helper PR #16 measurements; add Validator-specific probe only for missing dimensions |
| OS/native watcher count, actual open handles and outstanding work | Not established by logical dependencies or the Node handle proxy |
| True cold-disk/cache-cleared results | Not measured; requires controlled machine, documented cache methodology |
| Mapped-drive/UNC, representative shared model | **Unavailable; open**. Record actual share latency, environment and cache state when available |
| Cleanup following editor/root closure, settings change and cancellation | Native Extension Host verification required before D2 acceptance |

### Candidate optimisations (not pre-approved)

Observed source inspection suggests synchronous readFileSync, existsSync, and repeated readdirSync calls in recursive traversal and latest-version checking. The D1 report is **not evidence that a refactor is justified** until the benchmarks are recorded. If operation counts and latencies warrant it, consider *within-analysis* raw-content/directory caching and bounded asynchronous IO first, preserving distinct variable contexts; separately assess targeted invalidation and generation-based cancellation. No persistent path-only cache of context-dependent results.

D2 must be its **own PR**, based on the exact integrated Agent A traversal + Agent B dependency fixes and using Agent E's CI. State that parent SHA and the D1 benchmark dependency. Show before/after raw trials with unchanged diagnostics, properly invalidated edits/settings/closed roots and no lost missing-file results. Timed-out promises alone do not demonstrate cancellation of a blocked OS operation. Unvisited graph state must be reported as incomplete, never valid. Do not introduce arbitrary small graph limits.

### Proposed performance budgets — **for owner approval only**

These are screening proposals, **not verified thresholds** or merge gates:

- **Extension-host uninterrupted synchronous work:** flag any p95 validation block over **50 ms** for investigation. Basis: a >50 ms uninterrupted Node extension-host operation can delay other extension services and interactive work; this is a responsiveness-risk trigger, not a guarantee of UI frame time.
- **Single-character/child change:** collect both engine time and **edit-to-diagnostic p95** with the current 300 ms debounce reported separately. Do not set a numerical total-latency target before real host measurements; the debounce is already a substantial component.
- **Network-hosted representative model:** no defensible millisecond target without a real UNC/mapped-drive trace and model size; record read/metadata operations and responsiveness first.
- **Correctness/resource use:** zero stale published diagnostics from cancelled/closed work, no duplicated Problems entries, consistent missing-file diagnostics and complete cleanup. These are functional requirements, not statistically approved latency budgets.

**Out of scope:** changing version-pattern/token checks, conditional missing-file semantics, model-wide parameter entry, TUFLOW execution/release selection, QGIS, file opening, Helper syntax/completion/hover, Error Lens behavior, GeoPackage inspection/PR #9, publishing/versioning.
