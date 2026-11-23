# Issue #3: current-build Windows NTFS / remote SMB acceptance

23 November 2026 (Australia/Perth). Evidence only; no production changes.

**Recommendation:** recommend subsequent owner closure of issue #3. Current-build diagnostic parity and supported-workspace lifecycle passed on verified local NTFS, genuine remote UNC SMB and its mapped alias. Observed performance is recorded for owner acceptance without an invented latency/resource budget. Native watcher attribution remains an explicit measurement limitation.

- Tested production baseline: main `78050053c5330bd51f49fea536c6f6f7524080e4`. Main advanced concurrently to `23455cf1192f17093126fab7fb09e39a1e51788f` via PR #32 before delivery; only issue #10 documentation and regression fixture/test changed. Production `src` excluding `src/test`, manifest and lockfile remain identical to the tested baseline. No untested production revision was substituted.
- Exact tested evidence source: `9dc8512db03b278f7cd311159aaffee3277d6df0` (independently reviewed PR #31 head). Six evidence-only files differ from main; production `src`, manifest and lockfile are unchanged.
- Locally built VSIX SHA-256: `8322b3d6fae597ffc1dca916162f503c1924ebfcf57fa93fe502c9d633c3923e`. All 11 installed runtime JS modules matched compiled bytes for each run. Archive verification: 17 entries, no test/source/example/dependency payload.
- Windows 10 Pro build 19045; AMD Ryzen 7 7700X, 16 logical processors, about 63.2 GiB physical memory. VS Code 1.147.0; extension-host Node 24.22.1. Build Node 20.19.2 in Docker; Windows core/launcher Node 22.23.0. See [environment](environment.json). The local VSIX hash differs from hosted packaging; all three local runs used this same recorded package.
- Build/install, compile, ESLint, packaging and read-only archive checks passed. Existing npm audit reported 23 vulnerabilities (1 low, 9 moderate, 13 high); no dependency changes were made.

## Storage provenance and measurement method

Get-Volume confirmed the disposable local parent is on a fixed NTFS volume. Get-SmbMapping linked the approved mapped parent to its UNC spelling. A uniquely named sentinel child produced identical SHA-256 through both aliases; TCP/445 was reachable at an address distinct from every local IPv4 address. That child was removed and absence verified through both aliases. Only unique fixture children of the owner-approved remote parent were written. SMB dialect inspection was denied; no elevation was attempted. Public paths are aliases; original provenance stays private.

The same 183-file / 117,425-byte fixture ran sequentially on the same Windows client with identical settings, source and package. Fixture manifest SHA-256: `55a7a7a506948fc5317c00ce8dac5f24e86e739d15d04c07657de398c45f163d`. Each repeated scenario has 19 timed warm trials after 3 warmups; first-engine observations are retained separately. Fixture creation warms filesystem caches: no physical cold-disk claim. No synthetic latency, cache clearing, drive remapping, service changes or operational model/GeoPackage database access occurred.

The maintained matrix checker passed all 27 storage/scenario summaries, including exact fingerprints, fixture/settings/source/package/host parity and recomputation of nearest-rank median/p95. At N=19, nearest-rank p95 is the largest trial. Counts are filesystem API calls, not SMB packets. These results are current-build observations, not a controlled improvement over historical B/D2 builds.

## Performance and diagnostic parity

| Scenario | NTFS median / p95 ms | UNC median / p95 ms | Mapped median / p95 ms | Reads / exists / enumerations | Parity |
| --- | ---: | ---: | ---: | --- | --- |
| warmAnalysis | 0.531 / 1.136 | 4.333 / 12.104 | 4.220 / 4.893 | 2 / 6 / 2 | PASSED |
| singleCharacterEdit | 0.467 / 0.583 | 7.619 / 20.401 | 4.146 / 4.555 | 2 / 6 / 2 | PASSED |
| includedChildChange | 0.753 / 1.554 | 6.255 / 7.651 | 6.255 / 6.850 | 2 / 6 / 2 | PASSED |
| versionSiblingExplicitRevalidation | 0.392 / 0.533 | 4.296 / 5.650 | 4.327 / 4.762 | 2 / 6 / 2 | PASSED |
| multipleRootChildChange | 1.130 / 1.378 | 9.888 / 10.916 | 10.207 / 12.624 | 2 / 11 / 4 | PASSED |
| repeatedIncludeDifferentVariables | 2.330 / 2.784 | 21.374 / 23.615 | 21.549 / 23.072 | 1 / 72 / 1 | PASSED |
| deepGraph | 9.055 / 11.136 | 27.291 / 29.817 | 24.353 / 27.171 | 49 / 103 / 2 | PASSED |
| wideGraph | 56.078 / 62.917 | 120.729 / 145.001 | 106.947 / 111.344 | 121 / 576 / 2 | PASSED |
| longControlFile | 5.672 / 6.143 | 18.578 / 21.343 | 17.105 / 19.504 | 0 / 400 / 1 | PASSED |

Raw per-trial timing, CPU/RSS/heap proxies, diagnostic counts/fingerprints, logical dependency/watcher-directory estimates, fixture files/hashes and first-use observations: [NTFS](core-ntfs.json), [UNC](core-unc.json), [mapped](core-mapped.json). [Calculated matrix JSON](core-summary.json) and [CSV](core-summary.csv). Coverage includes depth 48, width 120 with 32 shared references, multiple roots, 24 static-variable contexts, version-sibling changes and a 4,000-line control file.

## Installed workspace lifecycle and resources

Each spelling opened the disposable model directory as a workspace in a fresh profile with the installed VSIX and a metadata-only probe extension. Each passed 16 phases: initial independent roots/shared TRD, dirty child edit/restore, external file create/delete, and two bounded cycles of B retirement with A preserved, final-root retirement, stale callback suppression and independent A/B reopening. Rename-to-non-control-suffix induced real original-document close events; the renamed document stayed alive during its plaintext language change. Tab closure was not counted as disposal.

| Storage | Original A/B closures (`isClosed=true`) | Phases | Handles min / max | RSS min / max MiB | Heap min / max MiB | Node handles min / max | External create ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| ntfs | 4 | 16 | 356.0 / 373.0 | 147.2 / 175.0 | 28.8 / 44.1 | 3.0 / 10.0 | 154.578 |
| unc | 4 | 16 | 360.0 / 370.0 | 146.3 / 176.0 | 26.4 / 46.0 | 6.0 / 10.0 | 166.749 |
| mapped | 4 | 16 | 356.0 / 370.0 | 145.0 / 173.1 | 28.8 / 44.9 | 3.0 / 10.0 | 190.221 |

Complete events, relative-path diagnostic snapshots and phase-specific resources: [NTFS lifecycle](lifecycle-ntfs.json), [UNC lifecycle](lifecycle-unc.json), [mapped lifecycle](lifecycle-mapped.json). Each contains four true original-root closures, plus eight intermediate renamed-document language-change notifications (`isClosed=false`), which were not misclassified as original closure.

Resource scope: core logical watched-directory estimates describe dependency state; they are not installed VS Code watcher/listener ownership counts. Node active handles are process-resource proxies. Windows Get-Process handles measure the actual extension-host PID. RSS/heap cover the whole extension host, including built-ins. Native watcher identities and attributable listener/watcher disposal are not directly exposed by this probe. No established lightweight native attribution tool was available; the presence of Windows WPR alone does not provide attribution, and no administrator tracing project was started. Stable totals do not prove leak freedom.

[Watcher log observations](watcher-log-observations.json) retain generic watcher warnings emitted during the runs, including UNKNOWN backend errors; their native ownership is unproven. Actual supported-workspace create/delete assertions and diagnostic events passed on all three spellings. Outside-workspace SMB freshness remains permanently unsupported; issue #23 is not reopened.

## Integrity, shutdown and disposition

All successful runs verified physical sentinels, removed their unique fixture and profile directories and observed isolated editor exit. A final [process census](shutdown.json) found zero task-owned Code processes. The initial NTFS launch was interrupted by PowerShell treating progress stderr as an error before the probe; it is excluded from acceptance. Its abandoned local fixture was verified against the initial manifest before explicitly scoped cleanup; its profile was also removed, after confirming neither was in use. See [aborted-launch cleanup](aborted-launch-cleanup.json). The wrapper correction did not change reviewed probes or Validator source.

| Requirement | Classification | Evidence / remaining decision |
| --- | --- | --- |
| Current verified NTFS, remote UNC and same-share mapped core | PASSED | Raw 19-trial sets and matrix parity above |
| Installed workspace freshness, actual close, retirement, stale callbacks, reopening | PASSED | All three lifecycle event logs, 48 total phases / 12 original closures |
| Bounded process resources, fixture integrity and host shutdown | PASSED | Actual phase samples, sentinel checks, cleanup and final zero-process census |
| Native watcher identities and directly attributable disposal | BLOCKED (observability) | Measurement limit, not a product defect or a leak-free claim |
| Absolute performance/resource budget | Owner acceptance decision | No threshold supplied; report observed distributions without inventing one |
| Earlier B/D2 and 240-transition campaign | HISTORICAL-ONLY | Not reused as current-build acceptance or speedup |
| Supported-workspace product defect | None reproduced | Generic backend warnings did not defeat acceptance assertions |

Issue #3 may be closed subsequently by the owner after accepting these observed performance distributions and the native watcher observability limitation. Actual network TextDocument retirement is now observed, so no narrow exception for missing close events is needed. Recommend closing superseded PR #18 unmerged while preserving its historical evidence. Issue #3 and PR #31 remain open/unmerged under this assignment; no merge, tag, release, publishing or issue closure occurred. F05/F09/F10, runtime tokens and diagnostic/version policy remain unchanged; F13 and deferred GeoPackage PR #9 remain excluded.

The reviewed source head and existing final-head hosted qualification were refreshed before testing, not rerun as a substitute for this workstation evidence. [Independent reviewed-source receipt](https://github.com/Chain-Frost/tuflow_validator/pull/31#issuecomment-7101528522). The evidence commit containing this report changes only sanitized artifacts/documentation; tested source identity remains the SHA above.

Sanitization replaces private storage/profile/checkout prefixes only; raw numeric trials, hashes, diagnostics and event observations remain intact. Full original paths, mapping/IP provenance and complete launcher logs are retained locally. No private server/share identifiers are published.
