# Windows + real UNC/mapped-drive performance acceptance — local handoff

**Scope:** Only tests that require a real project share, actual native watchers/handles and local editor lifecycle. GitHub-hosted Windows/Linux VS Code integration and core benchmarking are already automated in Validator PR #16; do not duplicate those without a comparison reason.

## Copyable independent local-agent assignment

You are validating Chain-Frost/tuflow_validator issue #3 and performance PR #16 as an independent Windows tester. Read repository instructions, current PR and benchmark report, open A1 #14, A2 #17, B #21 and E1 #15, and their relevant CI evidence before beginning. Do not assume they are merged.

**Objective:** Establish Validator path correctness, host responsiveness and resource disposal on a **real accessible SMB UNC path** and its **mapped-drive alias**, compared with a local NTFS baseline **on the same Windows machine**. Report exact tested source SHA, VSIX SHA-256, extension version, VS Code version, host/tooling Node versions, OS/build, CPU/RAM, share/server/network details, effective settings, fixture/model sizes and sample counts.

### Safety

- No TUFLOW execution, model alteration, publishing, merging, release or extension-version bump. No PR #9 GeoPackage reader/workers/SQLite or layer inspection; ordinary physical-file existence checks only.
- Never write, truncate, lock or replace any model or GeoPackage. Test files must live **only in an owner-approved disposable benchmark folder**, not a live model tree. Do not disrupt QGIS or other applications.
- Use synthetic copied fixtures wherever possible. Live-model observation requires read-only permission and the owner's explicit approval. Do not clear production server caches.
- Do not treat mocked Windows paths, local loopback shares or injected delays as representative remote network evidence. If share access is absent, mark the test **blocked**.

### Required tests

1. Build the exact PR #16 head. Verify npm ci, compile, lint, standard VS Code integration tests, VSIX content and SHA-256. Run installed VSIX in a clean, isolated VS Code profile, not the normal work profile.
2. Run the same disposable core benchmark on local NTFS, real SMB UNC and its mapped-drive alias. Record 19+ warm trials, first validation separately, per-trial timings/p50/p95, reads, existence checks, directory enumerations, CPU and RSS. Include a deep graph, 120-wide + repeated/shared graph, multiple roots and static-variable contexts. Keep settings/toolchain/fixture hashes equivalent.
3. In an actual editor host, measure first-diagnostic arrival, warm validation, 19+ one-character edits, child dirty-buffer edit/save, referenced child create/delete/rename, new version sibling create/delete/rename, and settings changes. Report edit-to-diagnostic time **including the current 300 ms debounce**, separately from synchronous core time.
4. Record diagnostic code/message/source for present/missing inputs; preserve concrete missing-file results in conditional blocks, unevaluated runtime scenario/event tokens, original filename-version algorithm and token checks. Verify changed roots update, unrelated roots do not, and no stale or duplicate Problems entries appear.
5. Measure real native watcher and OS handle counts before/after opening, revalidation, closing a document/root, settings changes and process shutdown (use Process Explorer, handle.exe or equivalent if available). Track timers, queues, CPU, memory and responsiveness. **Do not equate tab close with onDidCloseTextDocument**: hosted tests did not observe actual document unloading. Flag unavailable native counts.
6. Compare with current PR #16 raw Linux/Windows artifacts and its pinned same-run Agent B comparison. Use the separate Helper PR #16 acceptance report for co-installed extension measurements; do not recreate Helper functionality or attribute shared extension-host CPU exclusively to Validator.
7. Give a compact report with raw JSON/CSV and results classed pass/fail/blocked; identify disk-cache handling accurately. Avoid posting credentials or sensitive full server/model paths publicly. Report findings to PR #16 and issue #3, with an independent verdict for D1 and whether D2 is justified. Do **not** merge anything.

### PowerShell — only after confirming an owner-approved disposable target

~~~powershell
git clone https://github.com/Chain-Frost/tuflow_validator.git
cd tuflow_validator
git fetch origin
git switch perf/issue-3-d1-core-baseline
git rev-parse HEAD
npm ci
npm run compile
npm run lint
npx vsce package --out benchmark-source.vsix
Get-FileHash .\benchmark-source.vsix -Algorithm SHA256

# Verify this is a genuine remote SMB share and a disposable benchmark folder.
$env:TPV_BENCHMARK_FIXTURE_PARENT = '\\server\share\disposable-perf-tests'
$env:TPV_STORAGE_LABEL = 'Real SMB, record server/client/cache/latency/link'
$env:TPV_BENCHMARK_NETWORK_EVIDENCE = 'verified remote SMB UNC, not loopback'
$env:TPV_SOURCE_SHA = (git rev-parse HEAD)
$env:TPV_VSIX_PATH = (Resolve-Path .\benchmark-source.vsix).Path
$env:TPV_BENCHMARK_OUTPUT = (Join-Path $PWD 'benchmark-real-unc.json')
$env:TPV_BENCHMARK_SAMPLES = '19'
Remove-Item Env:\TPV_SYNTHETIC_IO_MS -ErrorAction SilentlyContinue
node scripts/benchmarks/core-baseline.cjs
~~~

Repeat with a local disposable directory and with its real mapped-drive path, changing only the fixture parent and the output/description labels. The runner creates and removes only its unique child directory; verify the JSON fixturesRemoved flag. The script itself does **not** measure actual VS Code editor/watcher behavior; that is a separate installed-host acceptance test.

**Exclusions:** no model-wide parameter entry, TUFLOW version selection/running, QGIS integration, helper/editor feature duplication, GPKG layer reader, version bump or publishing.
