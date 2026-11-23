# Issue #3 — latest-reference freshness fixes (Agent B)

Date: 22 November 2026
Repository: https://github.com/Chain-Frost/tuflow_validator
Tracking: https://github.com/Chain-Frost/tuflow_validator/issues/3
Draft PR: https://github.com/Chain-Frost/tuflow_validator/pull/21

## Baseline and minimal reproduction

- Main baseline: `4a0282e93b979345374076fb0adc60c7faf6af99`.
- A1 #14 → A2 #17 (`b0e095a4c2c5b7174b86a6bd597a2544577940b6`) → draft B #21.
- Reproducer-only commit: `fff7feb325c1baf788baf127d781d5f64a3b4550`.
- Pre-fix real Linux Extension Host: https://github.com/Chain-Frost/tuflow_validator/actions/runs/45039137901 — 56 passing, one failing as expected; Windows compile/lint passed.
- Failing case: create unreferenced `geom_v02.tgc` beside referenced `geom_v01.tgc`; no latest-version warning appears without touching the root.
- The unsaved-TCF graph test *already passed on A2*: A2 added `readControlTextSnapshot()` for both analyses. This PR preserves A2 behavior and adds shared per-analysis caching.

## Implementation design

**Shared text snapshot.** `createControlTextSnapshotReader()` reads a path once per root analysis, preferring current open text (including arbitrary-suffix plaintext Read File children), else disk. Both latest-TCF discovery and path diagnosis use it. Variables, conditional contexts, TCF/TRD bases and recursive traversal remain evaluated per include, not cached by path; only the active recursion stack is used to prevent cycles.

**Root-owned dependencies.** The root records exact referenced paths, including missing files and clean inputs; latest-TCF graph sources, including missing controls; latest-version series seed paths used for candidate lookup; and TCF-run directories used to discover which runs are latest. No diagnostic is required for a dependency to be tracked.

**Relevant disk events.** For each root, a changed path is relevant if it is an exact dependency, if it is a `.tcf` in a latest-TCF discovery directory, or if it is a sibling matching a version-series seed under the existing numeric parser and pattern logic. Unrelated directory events are ignored. A new candidate need not previously be referenced. Create/delete/rename is covered by filesystem watcher create/delete events.

**Windows identity.** Paths are normalised and case-folded on Windows only. Paths are never realpathed or assumed to make a mapped drive and its UNC counterpart interchangeable. Original paths are retained for file lookups and existing Quick Fix targets.

**Watcher ownership.** One shared FileSystemWatcher per active directory with its own three event listener disposables. All three listeners and the watcher are disposed when the directory is no longer required. Save explicitly recomputes the root (including plaintext children). Closing documents removes only that root's contributions and reanalyses dependent roots; the merged diagnostic collection retains diagnostics still owned by other roots.

## Regression suite

`src/test/suite/freshness.test.ts` uses temporary test directories and covers: sibling create/rename/delete, dirty TCF before/after save, dirty plaintext include, child clean-to-error, missing file deletion/recreation, multiple-root diagnostic ownership with an isolated `removeDiagnosticsForDocument()` lifecycle test, irrelevant directory events, and Windows-oriented path identity checks. VS Code retained open `TextDocument` instances after closing the editor tabs in the hosted runner; the test does not assert that editor-tab closure necessarily emits a document-close event. Existing variable-context, recursive/TRD, static-variable, Quick Fix and naming tests remain in the normal suite. Test runs and exact final head belong in PR #21.

## Deliberate exclusions and remaining verification

- Preserve existing rightmost-version parsing, series matching, candidate selection, Quick Fix, missing-file and unresolved-runtime-token behavior.
- No F08 standalone TRD root-policy change, model-wide inputs, async rewrite, GeoPackage reader, extension version bump, release, merge or publishing.
- Agent D's performance benchmarking is separate: https://github.com/Chain-Frost/tuflow_validator/pull/16.
- Deferred GeoPackage PR #9 is not imported.
- **Real Windows Extension Host CI passed:** [run 45040521593](https://github.com/Chain-Frost/tuflow_validator/actions/runs/45040521593) completed all 61 tests on **both Linux and Windows** at source head `1e169d72468070a20111864483d78a021551dc32`. This includes actual Windows local temporary-directory create/delete/rename watcher behavior, but not mapped-drive or UNC project shares.
- **Windows local network validation remains outstanding:** verify mapped-drive and UNC project path identities, file notifications, actual open/close lifecycle, watcher/handle disposal and representative project responsiveness. Do not infer network-share behavior or network performance from hosted CI.
- Independent review must be completed before merge.

## Owner-approved network support boundary — 23 November 2026

The owner confirmed that TUFLOW control files are normally used as part of a project and accepted a **permanent workspace-only support limitation**: for UNC/mapped SMB network models, automatic freshness after external filesystem changes is supported only when the relevant model directory is opened as a VS Code workspace, subject to the tested configurations. Individually opened network files without a workspace are **not supported for automatic external-change notifications**, and this behavior will not be fixed.

[Issue #23](https://github.com/Chain-Frost/tuflow_validator/issues/23) is closed **not planned**, rather than technically fixed. Its [installed VSIX acceptance](https://github.com/Chain-Frost/tuflow_validator/pull/21#issuecomment-7089420650) and [recursive watcher investigation](https://github.com/Chain-Frost/tuflow_validator/issues/23#issuecomment-7092023847) remain historical evidence. Workspace-driven network tests passed, while empty-window SMB simple watchers failed; experimental recursive watchers were rejected as an unbounded resource risk. No polling/native fallback is planned.

The supported operating procedure is **File → Open Folder** for a network-based TUFLOW model project. [PR #24](https://github.com/Chain-Frost/tuflow_validator/pull/24) provides an optional manual-refresh command for unsupported individually opened cases; it does not provide automatic freshness. This accepted limitation no longer blocks the focused PR #21 merge assessment. Separate issue #3 performance and network document-unload/disposal evidence remains separately qualified. This section supersedes earlier statements above that remote no-workspace notification testing was pending. No merge, release or source-code change was authorised by the support decision.
