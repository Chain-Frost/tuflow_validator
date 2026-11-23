# F08 — TRD editor context fix

Tracking: [issue #27](https://github.com/Chain-Frost/tuflow_validator/issues/27) and [implementation PR #28](https://github.com/Chain-Frost/tuflow_validator/pull/28). Investigation [#18](https://github.com/Chain-Frost/tuflow_validator/pull/18) remains evidence only; it is not merged or imported.

## Reproducer-first evidence

The regression-only commit `7fb15b310fb2b22a2b29abae9905e5ebc895941b` has no production changes. Its positive assertions reproduce the false `TPV001` diagnostics for an existing TCF-relative `assets/present.shp` and nested `../../shared/nested.trd` when a TRD is opened independently.

- Main source baseline: `936231289b767ec0028a0be7b18bb78596dc4fd6`; [run 45115200604](https://github.com/Chain-Frost/tuflow_validator/actions/runs/45115200604).
- Pinned B source: `53f756aa9c96da7399425d32b0325fe23b6c6082`; [compatibility run 45115200670](https://github.com/Chain-Frost/tuflow_validator/actions/runs/45115200670). Only the new test is copied into this checkout before the production fix exists; B's branch is never modified.
- Linux and Windows jobs reproduce all four expected regression failures on both sources. Existing tests pass: main 55 Linux / 56 Windows, B 62 Linux / 63 Windows (one Windows-only test skipped on Linux). The failing assertions show only the additional F08 errors.

Both correct and formerly incorrect nested-include locations are inside the unique disposable fixture. The regression suite asserts the correct behavior; it does not encode the defect as a permanent passing observation.

## Minimal production change

An independently opened TRD has no source-TCF directory. Its relative references therefore remain unknown during that standalone pass, while each known parent still validates the same text with its own source directory and static variables. No nearest-file search, parent choice, new UI, workspace scan or model-parameter input is added.

Block diagnostics and fully specified absolute input paths remain checkable without a TCF. Windows drive-relative and drive-less rooted inputs need context and are also left unchecked in that standalone pass. Genuine concrete missing inputs, including inside conditional blocks, remain errors. Filename/version matching and token checks are unchanged. GeoPackages continue to receive physical file-existence checks only; deferred PR #9 is unrelated.

## Regression matrix

- Parent before TRD; TRD before parent; nested TRD opened separately.
- Dirty child updates retire a fixed error before save, while the real conditional error remains.
- Absolute existing/missing targets and statically expanded absolute values; absolute nested includes whose own relative base remains unknown.
- Two parent TCFs with different directories and static variable values, preserving both sets of diagnostic ownership.
- Real `onDidCloseTextDocument` during a rename to a non-control document, removal of the retired parent's contribution, and reopening its original TCF. Closing a tab alone is not treated as document disposal.
- Context-independent syntax checks and unresolved runtime tokens.

The regular workflow runs the complete extension-host suite and VSIX packaging checks. The separate compatibility workflow applies only the `src/diagnostics.ts` delta from the pinned main baseline to pinned B and copies the regression test. It does not replace B's diagnostic engine with main's, mutate B's branch, or claim to solve B's SMB notification limitation. Its job is limited to this implementation branch, so unrelated future PRs do not acquire a permanent dependency on the pinned B snapshot.

## Completed post-fix evidence

- Fix source `ee900c0df63cecf464310fc1c3f9dac3352d2dfd`: [main integration run 45115428583](https://github.com/Chain-Frost/tuflow_validator/actions/runs/45115428583) passed 59 tests on Linux (one Windows-only skip) and 60 on Windows, including all four new regression tests. Both packages verified with 17 entries and 11 runtime JavaScript modules.
- Source `009ee602b3e6f06cdf501be67a6ff8ab7de8d2db` contains the same production fix and tests with a compatibility-workflow correction. [Main run 45115604958](https://github.com/Chain-Frost/tuflow_validator/actions/runs/45115604958) passed Linux/Windows integration and VSIX checks; [pinned-B compatibility run 45115604969](https://github.com/Chain-Frost/tuflow_validator/actions/runs/45115604969) passed 66 tests on Linux (one Windows-only skip) and 67 on Windows, including the complete B suite and F08 regressions.
- The first post-fix compatibility run failed before executing tests because ordinary diff context included B's intentionally different dependency bookkeeping. The workflow now applies a one-context-line insertion; a local patch check and successful hosted B tests establish that B's `pathIdentity` tracking is retained. No B branch or production source is replaced.
- The final documentation/workflow-scope follow-up changes no production behavior; the current PR body records its exact-head checks and independent review status.

The real VS Code hosts used version 1.147.0 with extension-host Node v24.22.1. The test's `workflowSha` is GitHub's workflow/merge identity; the compatibility job separately prints the exact B and F08 source SHAs, which must not be confused with that environment value. The real-close/reopen assertion passed on Linux and Windows: renaming one parent to a non-control document fired `onDidCloseTextDocument`, retired its variable-specific missing-file contribution, preserved the other parent's errors, and restored the contribution on reopening.

Local Node 22 compilation and lint passed. Local Electron execution is unavailable because this environment has no Xvfb; real Linux and Windows extension-host evidence comes from GitHub-hosted jobs. Network-share acceptance and installed-VSIX operation are not established by these source-development-host fixtures. No merge, release, extension version change or publication is performed.
