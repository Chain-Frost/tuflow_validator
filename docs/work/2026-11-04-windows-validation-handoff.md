# Local Windows validation handoff — 4 November 2026

Use the following as the task prompt for an agent on the user's Windows PC. It covers environmental evidence that cannot be established from the cloud workspace, plus focused corrections uncovered by that validation.

## Repository and scope

Repository: <https://github.com/Chain-Frost/tuflow_validator>

Continue the existing PR: ISSUE8_PR_URL.

Branch: `feat/gpkg-layer-validation-8`.

Related issues:

- [#3 — Static variables and dependency revalidation](https://github.com/Chain-Frost/tuflow_validator/issues/3).
- [#4 — Version Quick Fixes, formatter settings, CI and tooling](https://github.com/Chain-Frost/tuflow_validator/issues/4).
- [#8 — Optional GeoPackage layer checks](https://github.com/Chain-Frost/tuflow_validator/issues/8).

Read all three issue bodies and comments, repository guidance, the complete current PR diff, [the baseline open-issue audit](2026-11-04-open-issues-audit.md), and any implementation/benchmark notes added to the branch. Fetch the latest remote PR branch and `main`, record both SHAs, and use an isolated worktree. Preserve unrelated changes.

Your primary task is to complete Windows installation, QGIS interaction and representative project-network validation. Commit and push task-related fixes, regression tests and redacted evidence to the existing PR branch. Do not merge, publish, tag a release, enable auto-merge or change Marketplace authentication. If this PR has already merged, create a focused follow-up branch/PR from current `main` and link the original PR rather than reviving its merged branch.

The original issue checklists contain already-implemented work. PR #6 implemented core #3 behavior; PR #7 implemented core #4 behavior. The current #8 PR adds Windows integration and VSIX verification in CI plus a `main` push trigger; verify their final outcomes. Recheck the final current branch before concluding an audit finding still exists. The outstanding #3/#4 correctness fixes are authorized as separate focused follow-up PRs. Their code work is not inherently blocked on a local PC; do not silently mix unrelated version-selection or toolchain redesign into the #8 validation PR.

## 1. Establish the Windows package baseline

Record Windows, VS Code/Electron, extension-host Node, development Node, npm, CPU and RAM details. Distinguish the Node used by development commands from the runtime used by the installed extension.

From the isolated checkout run:

```powershell
npm ci
npm run compile
npm run lint
npm test
```

Use the repository's current build/benchmark commands if they have changed. On native Windows, the VS Code integration runner should not need `xvfb`. Capture failures and fix task-related causes; do not replace integration tests with a compile-only claim.

Build the actual VSIX. If the repository's Bash packaging wrapper is unavailable in PowerShell, compile and use the locally installed packager, for example:

```powershell
npx --no-install vsce package --out tuflow-path-validator-validation.vsix
```

Inspect the archive, not just the source tree. It must contain the entry point, GeoPackage reader and all required runtime assets, and exclude source/tests/examples. Install it into an isolated VS Code profile and confirm activation and layer checking without requiring QGIS, GDAL, Python, a development checkout or a separately installed SQLite executable. Run on the minimum supported VS Code/runtime where practical as well as the user's installed version; report unsupported or untested versions accurately.

## 2. Exercise correctness and QGIS interaction

Use disposable, genuine GeoPackages and model copies. Do not edit production models or databases merely to conduct a test.

Cover the issue #8 matrix: one layer with the basename, one differently named layer, multiple layers with/without the basename, explicit `>>`, implicit selection, `&&`, mixed `|` plus `&&`, `USE ALL`, duplicates, supported vector/raster catalogues, and case behavior documented by the implementation. Include spaces/quotes, Windows drive letters, mapped drives, UNC paths, relative inputs and nested TRD bases where supported.

Check `Spatial Database` local/global precedence, nested controls, resets and conditional/dynamic uncertainty. A selector such as `layer_<<~s1~>>` or `<<~~s1~~>>` must remain unevaluated; it must not disable the concrete physical-file check or concrete sibling selectors. Do not guess runtime event/scenario values or substitute another layer.

Verify diagnostic codes, severities and precise ranges, bounded available-layer messages, ignore directives, setting toggles, missing/corrupt/empty/unreadable databases and the distinction between verified success and unknown/not checked. Confirm no layer-name replacement Quick Fix guesses an alternative.

Use QGIS on disposable copies to open, edit, save, add/remove/rename layers and exercise concurrent-reader/lock behavior. Cover SQLite WAL/journal states supported by the implementation, including transitions while the editor is open. Record cases deliberately reported as not checked. Do not infer success from the absence of a missing-layer diagnostic.

Compare before/after hashes or other suitable integrity evidence, modification times, journaling and sidecars during reader-only passes. Establish that the extension does not create files, modify the database, checkpoint, change journal settings or retain handles/locks after completion/timeout. QGIS itself may modify the test database; separate those intentional writes from reader-only integrity checks.

Exercise database/control-file change, create, delete and rename events; rapid dirty edits; cancellation; closing/reopening files; and on/off toggles during an in-flight scan. Assert that old asynchronous results cannot republish stale diagnostics or dependencies. Check repeated references and multiple roots without duplicate metadata work or Problems entries.

## 3. Measure performance for issues #3 and #8

Use the same machine, inputs and storage conditions for comparisons. Record the exact baseline and changed SHAs. Where comparing with the original implementation, the audit baseline was `4a0282e93b979345374076fb0adc60c7faf6af99`; prefer an appropriate current base if the branch has since incorporated other changes, and explain the choice.

Measure GeoPackage checks **off and on**. Record latest-version-check settings separately, because repeated directory discovery may dominate the existing validator's cost.

### Dataset matrix

- One small single-layer GeoPackage and one multi-layer GeoPackage.
- Many-layer and genuinely large databases with multi-GB feature data where available; reader cost should depend on metadata rather than reading feature data.
- 1, 10, 100 and 1,000 references, including repeated references to one database, many distinct databases, nested/shared controls and multiple roots.
- Local SSD, an available mapped project share, and the equivalent UNC route. Record the actual storage and network conditions; do not assume a drive mapping or invent an inaccessible dataset.
- A safely reproducible unavailable/high-latency share case where feasible. Do not disconnect operational drive mappings or change firewall/share settings just to induce a failure.

### Event matrix and measurements

Measure first activation/first scan, warm repeat, typing/debounced validation, dirty child edits, saves, database changes, setting toggles and disk create/delete/rename. Capture raw per-trial elapsed time, median and p95, baseline delta, distinct database opens/metadata reads, bytes/pages if exposed, peak memory/handles, extension-host or event-loop responsiveness, and diagnostic correctness/false-positive counts.

Use repeated trials and retain the raw values. Distinguish a fresh extension process from a genuinely cold operating-system/storage cache. Do not claim a cold-cache benchmark without establishing it. Confirm caching reduces repeated I/O, invalidation catches changes, and unreadable/locked/unavailable inputs do not cause excessive retries or editor freezes.

Use the committed benchmark harness if available. Extend it where needed so the measurement is reproducible rather than a one-off stopwatch result. Record clear limits/thresholds and the rationale for them. Synthetic sparse files can test bounded reads, but do not present them as representative real-model network evidence.

## 4. Recheck the focused issue #3 gaps

The baseline audit reproduced two problems. They may already be fixed by the PR; inspect and run the new regressions before changing code:

1. Creating `geom_v02.tgc` while an open root references `geom_v01.tgc` did not trigger a latest-version warning until another revalidation. Removing a newer sibling also needs coverage. Directory discovery must participate in targeted invalidation.
2. Dirty TCF changes to the referenced control graph were used by path analysis but not latest-version discovery until saved. Both need a consistent view of open buffers.

If still present, create a separate focused #3 follow-up branch/PR for these two correctness regressions. Add actual VS Code integration regressions and focused fixes using the existing shared watcher/dependency system. Preserve variable-context distinctions, source-TCF-relative TRD bases, runtime uncertainty and deduplication. Do not use path-only result memoization where the same child can be evaluated under different variable/database contexts. Link the #8 PR and coordinate shared watcher changes; do not merge either PR without the user's instruction. Do not auto-close #3 while representative performance evidence remains outstanding.

Optimize synchronous I/O only against a measured remaining problem, with bounded concurrency, cancellation and tests proving current results. Document any further architectural work as an explicit follow-up instead of concealing an incomplete performance result.

## 5. Complete issue #4 in focused follow-up work

If still outstanding, create a separate focused branch/PR for conservative version recognition and unique verified targets. The baseline treated `model_v01_tp01.csv`/`model_v01_tp02.csv` as revisions despite the explicit `v01`, treated `rain_20261103.csv`/`rain_20261104.csv` dates as revisions, and selected between `geom_v2.tgc` and `geom_v02.tgc` according to discovery order. Reproduce these with regression tests, then implement an explicit/conservative policy. Prefer identifiable version tokens; leave ambiguous numeric filenames unevaluated. Require one unique existing replacement and do not choose an arbitrary equal-number candidate.

Cover model IDs, AEPs, durations, temporal patterns, dates, runtime slot tokens, zero-padding, ties, no-newer-target cases, and a target disappearing after analysis. Preserve all unrelated filename/path segments and structured diagnostic metadata. Document intentional compatibility changes and any suffix-only version policy. Run full compile/lint/integration/package checks and inspect CI for the exact final SHA before handing off the PR.

Assess ageing development dependencies in a separate small toolchain PR if modernization remains outstanding. Check current official compatibility guidance and preserve the supported VS Code runtime; do not assume the CI Node version is the extension-host minimum. Leave publishing authentication unchanged. Report the exact remaining acceptance criteria for #4 instead of closing it solely because the version-selection PR passes.

## 6. Evidence and completion

Commit redacted benchmark JSON/CSV, fixture/harness changes and a Markdown report under the repository's appropriate benchmark/work documentation locations. Do not upload proprietary project models, client identifiers, credentials or large input databases. Record unavailable tests explicitly.

Keep `tuflowValidator.enableGeoPackageLayerChecks` default `false` unless reproducible evidence for representative **local and network-hosted** models supports a documented default-on decision. A fast local microbenchmark alone is insufficient. If the implementation intentionally returns not-checked results for an unsupported concurrency/storage case, document that limitation and its user-visible behavior.

Run final compile, lint, Windows integration and package/install checks against the final committed SHA. Inspect GitHub CI for that SHA. In the handoff provide:

- Exact SHA, commands, environments and pass/fail results.
- Benchmark report and raw-result paths, datasets/storage metadata and thresholds.
- Bugs fixed and regression tests demonstrating the correction.
- Unmeasured, unsupported or failing cases and their practical effect.
- A separate close/keep-open recommendation for #3, #4 and #8 against each issue's remaining scope.

If a required share, QGIS setup or dataset is unavailable, complete everything else and state the exact missing evidence. Do not fabricate a pass or close an issue on the basis of compile/lint alone.
