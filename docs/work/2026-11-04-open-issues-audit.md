# Open issue audit — 4 November 2026

Repository: [Chain-Frost/tuflow_validator](https://github.com/Chain-Frost/tuflow_validator)

Audit baseline: [`4a0282e93b979345374076fb0adc60c7faf6af99`](https://github.com/Chain-Frost/tuflow_validator/commit/4a0282e93b979345374076fb0adc60c7faf6af99), the `main` head inspected before the GeoPackage implementation.

Current implementation branch: `feat/gpkg-layer-validation-8`.

Current implementation PR: https://github.com/Chain-Frost/tuflow_validator/pull/9.

This audit records the baseline findings. The implementation PR may address some of them; assess its final diff and test evidence before treating a finding below as still outstanding. The accompanying [Windows validation handoff](2026-11-04-windows-validation-handoff.md) describes the environmental checks that require a local Windows PC and project network access.

**Current PR update:** the GeoPackage PR adds full Windows integration CI, VSIX packaging/content verification, and a `main` push trigger. These address the corresponding baseline CI gaps below, subject to a passing run for the final PR head. Issue #4's conservative version selection and development-toolchain modernization remain separate follow-ups. The local handoff authorizes focused follow-up PRs for outstanding #3/#4 code defects as well as environmental validation.

## Issue register

The open issue list contained exactly three issues when inspected. Core work for #3 and #4 is already merged; their original unchecked acceptance lists are not a reliable measure of the remaining implementation.

| Issue | Already delivered on the baseline | Remaining scope at audit | Execution environment |
| --- | --- | --- | --- |
| [#3 — Static variables and dependency revalidation](https://github.com/Chain-Frost/tuflow_validator/issues/3) | Conservative static variables, recursive dependencies, conditional/repeated include handling, TCF-relative TRD bases, targeted input-file watchers and deduplicated diagnostics | Two reproduced latest-version invalidation/context defects; representative cold/incremental benchmarks; repeated synchronous I/O and traversal bounds assessed against evidence | Code fixes and synthetic tests can run in repository development/CI; representative mapped-drive/UNC performance requires local access |
| [#4 — Version Quick Fixes, formatter settings, CI and tooling](https://github.com/Chain-Frost/tuflow_validator/issues/4) | Verified-target Quick Fixes, preserved runtime slot tokens, editor indentation options, Linux integration CI and Windows compile/lint | Conservative version recognition, unique-target enforcement, broader regression coverage, Windows integration/package validation and a separate development-toolchain update | Primarily repository work; a local PC is not a prerequisite for the version-selection fixes |
| [#8 — Optional GeoPackage layer checks](https://github.com/Chain-Frost/tuflow_validator/issues/8) | No layer metadata inspection on the baseline; implementation is the purpose of the current PR | Finish and verify the implementation against the issue; packaged Windows runtime, QGIS edit/lock behavior and representative network performance evidence | Automated tests and synthetic benchmarks here; Windows/QGIS/network evidence locally |

## Issue #3

### Work already merged

[PR #6](https://github.com/Chain-Frost/tuflow_validator/pull/6) merged on 12 October 2026. The [integration completion comment](https://github.com/Chain-Frost/tuflow_validator/issues/3#issuecomment-6128738292) explicitly leaves the issue open for representative large/network-model benchmarking, cold/incremental timing, synchronous I/O improvements where warranted, and performance acceptance thresholds.

The baseline includes:

- Literal and chained `Set Variable` expansion, bounded variable expansion, and conservative treatment of unresolved/cyclic definitions.
- Runtime `-s`/`-e` placeholders left unresolved.
- Recursive controls, repeated includes under different variable contexts, conditional includes and nested TCF/TRD bases.
- Open/dirty child contents in the path-diagnostic traversal.
- Directory-level watchers for tracked referenced paths, including files that do not yet exist.
- Merged diagnostics without duplicate Problems-panel entries across roots.
- Regression tests for the main cases above.

Sources: [static_variables.test.ts](https://github.com/Chain-Frost/tuflow_validator/blob/4a0282e93b979345374076fb0adc60c7faf6af99/src/test/suite/static_variables.test.ts), [variable_context.test.ts](https://github.com/Chain-Frost/tuflow_validator/blob/4a0282e93b979345374076fb0adc60c7faf6af99/src/test/suite/variable_context.test.ts), [diagnostics.test.ts](https://github.com/Chain-Frost/tuflow_validator/blob/4a0282e93b979345374076fb0adc60c7faf6af99/src/test/suite/diagnostics.test.ts), and [recursive_dependencies.test.ts](https://github.com/Chain-Frost/tuflow_validator/blob/4a0282e93b979345374076fb0adc60c7faf6af99/src/test/suite/recursive_dependencies.test.ts).

### Finding 3A: dirty buffers and latest-version discovery disagree

`diagnostics.ts` obtains open control-file contents from VS Code. The separate graph discovery in `versioning.ts` calls `safeReadFile()` directly for the root TCFs and their children. Consequently the path traversal and latest-version eligibility can use different graphs until the editor is saved.

Reproduction against the baseline:

1. Save `Run_v02.tcf` with `Geometry Control File == original_v02.tgc`.
2. Create `other_v02.tgc` containing `Read GIS BC == layer_v01.gpkg`, with both `layer_v01.gpkg` and `layer_v02.gpkg` present.
3. Change the open TCF buffer to reference `other_v02.tgc`, without saving.
4. Revalidate. The child has no outdated-layer warning.
5. Save the identical buffer and revalidate. The outdated-layer warning appears.

This was reproduced using the actual baseline TypeScript, transpiled in memory, real temporary files, and a minimal VS Code API shim. It was not a full desktop VS Code integration run. A regression should exercise the actual editor event path and ensure both analyses consume the same document snapshot.

Sources: [versioning.ts](https://github.com/Chain-Frost/tuflow_validator/blob/4a0282e93b979345374076fb0adc60c7faf6af99/src/versioning.ts) and [diagnostics.ts](https://github.com/Chain-Frost/tuflow_validator/blob/4a0282e93b979345374076fb0adc60c7faf6af99/src/diagnostics.ts).

### Finding 3B: new version siblings are not tracked dependencies

The shared directory watcher discards an event unless its exact file path is already in `getTrackedDependencyPaths()`. A newly created, unreferenced version candidate is not in that set. Directory listings are inputs to latest-version discovery, but are not themselves represented in the dependency graph.

Reproduction against the baseline:

1. Open a root that references existing `geom_v01.tgc`; there are no newer siblings or diagnostics.
2. Create `geom_v02.tgc`.
3. `updateDiagnosticsForChangedPath(geom_v02.tgc)` returns `false`; no warning appears.
4. Explicit document revalidation then reports that `geom_v01.tgc` is outdated.

This was reproduced with the same baseline-code/temporary-file/API-shim method as finding 3A. Deleting or renaming a version candidate also requires coverage so an obsolete warning disappears. Track the relevant version-discovery directories per root and reuse the existing directory watchers; do not create a watcher per file or layer.

Sources: [extension.ts](https://github.com/Chain-Frost/tuflow_validator/blob/4a0282e93b979345374076fb0adc60c7faf6af99/src/extension.ts) and [diagnostics.ts](https://github.com/Chain-Frost/tuflow_validator/blob/4a0282e93b979345374076fb0adc60c7faf6af99/src/diagnostics.ts).

### Performance and remaining verification

The baseline has no committed benchmark harness/results or recorded thresholds. Control-file reads, file-existence checks and repeated latest-version directory listings use synchronous filesystem calls. Path analysis and latest discovery repeat parts of the traversal. The active recursion stack stops cycles, but does not impose a general budget on large acyclic graphs.

Measure before deciding how much to refactor. Cover cold and incremental scans, many shared references, multiple open roots, nested controls, dirty edits, saves, rename/create/delete events, directory changes and unavailable shares. Record filesystem operation counts, elapsed median/p95, memory/handles, extension-host responsiveness and correctness. Confirm targeted events do not rescan unrelated roots.

Synthetic fixtures can establish repeatability and catch regressions. Actual Windows mapped-drive/UNC conditions and representative project sizes remain environmental evidence, not facts that can be inferred from a local-container result.

## Issue #4

### Work already merged

[PR #7](https://github.com/Chain-Frost/tuflow_validator/pull/7) merged on 12 October 2026. Its [completion comment](https://github.com/Chain-Frost/tuflow_validator/issues/4#issuecomment-6128738931) retains conservative version recognition, broader regression coverage, development-toolchain modernization and fuller cross-platform coverage as follow-ups. The linked [combined-workstream CI run](https://github.com/Chain-Frost/tuflow_validator/actions/runs/38280343063) completed successfully.

The baseline Quick Fix uses a structured, discovered target and verifies that it exists. It preserves the directory and runtime scenario/event slot identity. Formatting respects `insertSpaces` and `tabSize`, with tabs, spaces and idempotence covered. Publishing authentication remains separate from PR validation.

### Finding 4A: rightmost-number inference remains unsafe

The baseline still selects the rightmost qualifying number as a revision. An in-memory probe of the baseline `getLatestVersionStatus()` produced these results:

| Candidate filenames | Baseline result | Required follow-up |
| --- | --- | --- |
| `model_v01_tp01.csv`, `model_v01_tp02.csv` | Calls temporal patterns 1 and 2 revisions, despite explicit `v01` | Prefer an identifiable revision token; do not reinterpret temporal patterns |
| `rain_20261103.csv`, `rain_20261104.csv` | Calls the dates revisions 20261103 and 20261104 | Leave ambiguous/date-only names unevaluated unless an explicit supported policy establishes the revision |
| `geom_v01.tgc`, `geom_v2.tgc`, `geom_v02.tgc` | Chooses either version-2 path depending on candidate order | Require a unique verified target; equivalent-number ties must not choose an arbitrary path |

These are executed function-level reproductions, not just speculative test cases. Source: [versioning.ts](https://github.com/Chain-Frost/tuflow_validator/blob/4a0282e93b979345374076fb0adc60c7faf6af99/src/versioning.ts).

An explicit version marker should take precedence over unrelated digits. Support for suffix-only numeric revisions must be deliberate and documented; mixed model/AEP/duration/temporal-pattern/date numbers should fail conservatively. Test zero-padding, equal-number ties, unique targets, no-newer-target cases, and targets removed after analysis.

### Tooling and coverage gaps

- Windows CI only compiles and lints on the baseline. It does not launch VS Code integration tests. Add actual Windows runtime/path/watch coverage, including drive-letter and UNC handling.
- No CI job builds and inspects the VSIX. Assert that runtime assets are included and source/tests/examples are excluded. The baseline `.vscodeignore` excludes all `node_modules`, which matters if the GeoPackage reader introduces packaged runtime dependencies.
- Add explicit CRLF/comment preservation and unchanged-outside-block formatting regressions where absent.
- The CI push trigger names an old feature branch; `pull_request` still works, but a post-merge `main` trigger should be assessed.
- The manifest declares TypeScript `^4.8.4`, ESLint `^8.26.0`, typescript-eslint `^5.42.0` and Node 16 typings. Upgrade in a separate verified change. Keep runtime APIs/types consistent with the supported VS Code engine; Node 22 in CI alone does not establish Node 22 in every supported extension host.
- Marketplace authentication and OIDC remain outside this issue's implementation scope.

Sources: [ci.yml](https://github.com/Chain-Frost/tuflow_validator/blob/4a0282e93b979345374076fb0adc60c7faf6af99/.github/workflows/ci.yml), [.vscodeignore](https://github.com/Chain-Frost/tuflow_validator/blob/4a0282e93b979345374076fb0adc60c7faf6af99/.vscodeignore), [package.json](https://github.com/Chain-Frost/tuflow_validator/blob/4a0282e93b979345374076fb0adc60c7faf6af99/package.json), and [formatter.test.ts](https://github.com/Chain-Frost/tuflow_validator/blob/4a0282e93b979345374076fb0adc60c7faf6af99/src/test/suite/formatter.test.ts).

### Sequencing

Version-selection fixes are ordinary repository work and do not require the user's PC. Keep the version-recognition redesign in a focused #4 PR; keep development-dependency modernization separate again if it introduces substantial toolchain changes. The current #8 PR adds Windows integration, VSIX checks and the `main` trigger. Confirm the final CI results before marking that coverage passed; these additions do not imply the rest of #4 is complete.

## Issue #8 and local evidence

Use [issue #8](https://github.com/Chain-Frost/tuflow_validator/issues/8) as the implementation contract. Audit the final PR for supported syntax, conservative unresolved selectors and spatial-database scope, genuine read-only metadata access, bounded resources, diagnostics, cache invalidation, and regression coverage.

The local validation gate should cover:

- Packaged installation in supported Windows VS Code without external QGIS/GDAL/Python/SQLite runtime requirements.
- Real QGIS edit/save/lock behavior and relevant SQLite sidecars.
- Local SSD, mapped drive and UNC, including large/many-layer GeoPackages and unavailable/high-latency shares where safely reproducible.
- Cold/warm and incremental median/p95, metadata opens/reads, memory/handles, event-loop responsiveness, and diagnostic correctness.
- Evidence that reader-only validation does not modify the GeoPackage, journal settings or sidecars, and releases resources on completion or timeout.

Keep `tuflowValidator.enableGeoPackageLayerChecks` default `false` pending representative evidence. A fast synthetic or local-only result is insufficient to enable it by default. The [Windows validation handoff](2026-11-04-windows-validation-handoff.md) is the concrete next task for this evidence.

## Closure recommendations

- **#3:** Recheck fixes for findings 3A/3B, run the missing regressions, and record representative performance evidence and thresholds before closing.
- **#4:** Keep open until conservative/unique version selection, the agreed regression/CI coverage and separately assessed toolchain work are accounted for. Do not close it because Windows compile/lint succeeds.
- **#8:** Reconcile the final implementation against its acceptance criteria and clearly list outstanding local validation. Keep opt-in behavior unless the full default-on gate is met; do not label unmeasured network behavior as passed.
