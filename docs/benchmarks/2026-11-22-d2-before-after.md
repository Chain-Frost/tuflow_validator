# D2 focused directory snapshot optimisation — before/after evidence

**Tracking:** issue #3; [D2 PR #22](https://github.com/Chain-Frost/tuflow_validator/pull/22), separate from [D1 PR #16](https://github.com/Chain-Frost/tuflow_validator/pull/16).

## Exact version and integration chain

- Unmerged parent B [PR #21](https://github.com/Chain-Frost/tuflow_validator/pull/21): base commit **889d5e2e1951fe7de6edc187ea4508e6037d2179**, itself stacked on A2 #17 → A1 #14 → main.
- Initial D2 measured source SHA **57b9404656238a6c1f46286168bf5c0fef896a85**, the first branch head with directory inventory optimization and the paired benchmark workflow.
- Same benchmark source for both: pinned D1 driver SHA **71b3cb56258ed03929665dbf2596af839c09bde6**, including independent Codex corrections of fixture writes, sibling-event snapshots and the immutable fixture-manifest metadata.
- CI/packaging: uses Agent E [PR #15](https://github.com/Chain-Frost/tuflow_validator/pull/15) Windows/Linux host test pattern and exact standard-library VSIX verifier. E1 remains unmerged; resolve overlapping verifier/CI files at integration, do not silently bypass checks.
- No production code from deferred GeoPackage PR #9 or local SQLite workers. Ordinary .gpkg file-existence checks remain permitted.

## Provenance and results

[Paired GitHub Actions run #45042210486](https://github.com/Chain-Frost/tuflow_validator/actions/runs/45042210486) built B and D2 separately, ran **19 timed trials each after 3 discarded warmups** on the same Linux GitHub runner with identical fixtures/settings and Node 22.23.5. Raw JSON for both is in artifact **tpv-b-vs-d2-linux**; the compared metrics below are for exact pinned snapshots, not subsequently added tests/docs.

| Same local fixture / pass | B before | D2 after |
|---|---:|---:|
| Wide graph median | **57.259 ms** | **41.329 ms** |
| Wide graph p95 | **67.504 ms** | **51.846 ms** |
| Wide graph synchronous readdir | **121** | **2** |
| Wide graph physical readFile | 121 | 121 |
| Wide graph exists checks | 576 | 576 |
| Deep graph median | 5.793 ms | 5.681 ms |
| Repeated variable-context median | 1.619 ms | 1.382 ms |
| Included-child changed-path median | 0.288 ms | 0.292 ms |
| 4,000-line file median | 4.168 ms | 4.125 ms |

In this paired run, directory enumerations dropped **119/121 (98.3%)**, wide median fell **27.8%**, and wide p95 fell **23.2%**. Percentages are observed on this specific GitHub runner, **not owner-approved budgets or expected real network improvement**. Paired ordering (B before D2) and one runner are limited evidence; repeat and use real Windows mapped-drive/UNC model tests for acceptance.

The comparator passed with **exact equality of all per-trial diagnostic signatures and counts** across every fixture/case, and the same version-sibling changed-path observation. There were no deleted/changed missing-file diagnostics. No runtime scenario/event values were guessed. Complete raw data, fixture manifest hashes, settings, CPU/RSS, source/VSIX hashes and individual trials are in the zipped Actions artifact.

## Implementation and lifecycle

D2 adds **only a Map of physical sibling listings per normalised directory, scoped to one root analysis** (LatestCheckContext). Each discovered physical directory is enumerated once and reused for repeated version-reference comparisons. This is not a cache of context-dependent variable evaluation. Each edit, fresh root analysis, version-sibling event, configuration refresh or reopen builds a new context; unsuccessful directory reads are not cached. The existing filename-version algorithm, token rules, latest warning messages/Quick Fix targets and missing-file semantics are unchanged. No async tasks are introduced, so a false promise-cancellation claim is unnecessary.

A separate integration regression test exercises stale old-pass inventory followed by fresh-pass creation/deletion of a versioned sibling, verifying the new pass sees the change. Existing B tests already cover real directory watcher create/delete/rename, dirty buffers and shared roots; paired diagnostics verify no output regressions.

## Remaining gates

1. CI at **final D2 PR head** on Linux and actual Windows Extension Host must pass, including native Windows filesystem and Agent E-style packaged VSIX verification. Retain raw paired trials for the final head and document any differences.
2. Independent review of this **actual production change** and test design; address all findings before owner merge approval.
3. Parent Agent B and upstream Agent A chain are not merged. Agent E CI is a separate unmerged PR; resolve overlap and rerun after integration before suggesting merge.
4. No representative real Windows SMB UNC/mapped-drive measurements, actual network filesystem notifications or native watcher/handle counts are available in hosted CI. Use the narrowly-scoped [D1 local Windows handoff](https://github.com/Chain-Frost/tuflow_validator/blob/perf/issue-3-d1-core-baseline/docs/benchmarks/2026-11-22-windows-unc-agent-handoff.md). Do not equate synthetic delays with actual SMB timings.
5. D1 proposed performance budgets are **screening proposals**, not approved thresholds. Keep issue #3 open; do not publish, release, bump extension version, automatically merge or close #3 from local-only evidence.
