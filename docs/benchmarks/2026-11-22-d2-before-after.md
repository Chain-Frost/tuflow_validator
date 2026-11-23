# D2 focused directory snapshot optimisation — before/after evidence

**Tracking:** issue #3; [D2 PR #22](https://github.com/Chain-Frost/tuflow_validator/pull/22), separate from [D1 PR #16](https://github.com/Chain-Frost/tuflow_validator/pull/16).

## Current integration baseline — 23 November 2026

D2 is reconciled with Agent B PR #21 at exact commit
`cb038248e0987cb35a00223990185a0bb4016a25`, which includes merged main
`936231289b767ec0028a0be7b18bb78596dc4fd6` (A1/A2, E1 packaging and E2 tooling).
The two parent commits since B `53f756aa...` document the accepted network
support boundary in the README and implementation record. The existing D2
runtime source and regression remain unchanged from reviewed
`9c9ef571fb2f541ad6e6f063a75cb735d7bb166a` and the previous D2 head
`98596af122bd44279eb78835ce1005127d8e2943`. The reconciliation retains the
current parent CI, lockfile, package boundary verifier and Windows filesystem
regressions. No PR #24 manual-refresh change is included.

The D2 paired workflow now pins **B `cb038248e098...`** for both checkout and
recorded source identity. Both variants still use the identical reviewed D1
driver `71b3cb56258ed03929665dbf2596af839c09bde6`. New exact-head CI and paired
raw artifacts must be checked before accepting this reconciled candidate.
Older timings and network evidence below belong only to their stated SHAs;
this reconciliation does not relabel them as tests of the current source.

The owner accepted a permanent support limitation on 23 November 2026:
automatic freshness on UNC/mapped network shares is supported only when the
model directory is opened as a VS Code workspace, subject to the tested
configurations. Automatic external updates for individually opened network
files outside a workspace are unsupported and will not be implemented.
[Issue #23](https://github.com/Chain-Frost/tuflow_validator/issues/23) is closed
as **not planned**, not technically fixed, and no longer blocks PR #21.
D2 does not change event delivery or add polling, a recursive watcher fallback
or the separate PR #24 explicit refresh command. Manual refresh is an optional
user action, not automatic monitoring. Keep issue #3 open for its separately
scoped performance and network document-lifecycle evidence; it is not a reason
to reopen the accepted outside-workspace limitation. Current-head checks,
review and parent-first integration remain required; no PR merge is automatic.

### Previous reconciled head: evidence retained

The preceding D2 head `98596af122bd44279eb78835ce1005127d8e2943` passed
[paired benchmark and Windows/Linux host/VSIX run 45115108969](https://github.com/Chain-Frost/tuflow_validator/actions/runs/45115108969),
[standard CI 45115109084](https://github.com/Chain-Frost/tuflow_validator/actions/runs/45115109084)
and [independent review](https://github.com/Chain-Frost/tuflow_validator/pull/22#issuecomment-7092069534).
In that same-run local Linux comparison, B `53f756aa...` versus D2 `98596af...`
had wide-graph median/p95 **48.296/58.049 → 35.548/42.464 ms**, with 19 timed
trials after 3 warmups. Directory enumerations were **121 → 2**, reads
**121 → 121** and existence checks **576 → 576**; all per-trial diagnostic
signatures matched. These are historical synthetic local-runner results, not
measurements of the new reconciled head or new SMB evidence.

The following sections preserve the original benchmark and earlier integration
record. Statements about unmerged predecessors and pending runs describe those
historical points, not the current branch state.

## Historical exact version and integration chain

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

## Historical gates at the original measured head

1. CI at **final D2 PR head** on Linux and actual Windows Extension Host must pass, including native Windows filesystem and Agent E-style packaged VSIX verification. Retain raw paired trials for the final head and document any differences.
2. Independent review of this **actual production change** and test design; address all findings before owner merge approval.
3. Parent Agent B and upstream Agent A chain are not merged. Agent E CI is a separate unmerged PR; resolve overlap and rerun after integration before suggesting merge.
4. No representative real Windows SMB UNC/mapped-drive measurements, actual network filesystem notifications or native watcher/handle counts are available in hosted CI. Use the narrowly-scoped [D1 local Windows handoff](https://github.com/Chain-Frost/tuflow_validator/blob/perf/issue-3-d1-core-baseline/docs/benchmarks/2026-11-22-windows-unc-agent-handoff.md). Do not equate synthetic delays with actual SMB timings.
5. D1 proposed performance budgets are **screening proposals**, not approved thresholds. Keep issue #3 open; do not publish, release, bump extension version, automatically merge or close #3 from local-only evidence.

## Historical integration refresh — Agent B bdb6769, 23 November 2026

A later Agent B review fix, at commit `bdb6769f5366fd8ec3532a63254f5af4ac7470a6`, preserves the supplied historical text for non-`file` URI roots. D2 originally branched from `889d5e2`, so the two independent B source fixes (`src/diagnostics.ts`, `src/io.ts`) and the associated `src/test/suite/freshness.test.ts` regression are included unchanged here. The D2 physical directory cache remains scoped to a single analysis. The workflow now uses the updated B commit for **new** paired raw comparisons; results elsewhere in this report remain historical and pinned to their explicitly stated SHAs.

Independent [Windows/real SMB acceptance](https://github.com/Chain-Frost/tuflow_validator/blob/3600377d823562bbe3aebd6abdfd58407798f12e/docs/acceptance/windows-network-2026-11-23/README.txt) confirmed D2's existing optimization on genuine remote storage: UNC median/p95 323/446 → 155/184 ms against the then-pinned B `889d5e2`, with identical diagnostics. This is **not** a remeasurement of the newer B source. The inherited outside-workspace SMB notification failure was recorded in [#23](https://github.com/Chain-Frost/tuflow_validator/issues/23), subsequently closed as not planned under the accepted support boundary above. PR #24 provides a separate explicit manual refresh, not automatic polling. Native watcher-type counting and network document unload were not qualified by that report.

A new exact-head Linux/Windows VS Code integration and VSIX verification run and a same-run B/D2 benchmark are required for this integration commit before a merge recommendation. The actual D1 benchmark driver remains pinned at `71b3cb56258ed03929665dbf2596af839c09bde6`. No main-branch merge or release was authorized.
