# PR #21 installed Windows acceptance — 23 November 2026

**Recommendation: BLOCKED — CORRECTNESS DEFECT. Full acceptance is incomplete; hold merge sign-off for this requested scope.** Workspace behavior passed on NTFS, genuine UNC and mapped SMB. Current-head empty-window SMB notification failure reproduces [issue #23](https://github.com/Chain-Frost/tuflow_validator/issues/23); complete native watcher-disposal proof remains blocked. This does not establish a new B path-analysis regression. Tracking: [issue #3](https://github.com/Chain-Frost/tuflow_validator/issues/3).

- Source: `bdb6769f5366fd8ec3532a63254f5af4ac7470a6`, separate detached checkout `E:\Github\tuflow-validator-acceptance-pr21`.
- VSIX SHA-256: `f22e7ce1e27d8619fdb601e2e7dbcf4dd6e3ec2a43f11ef94b9bdc8b74518495`; unchanged version 0.2.6. Docker locked install/build/package; all 11 installed JS modules match compiled source. Dedicated user-data and extensions directories; only a metadata-only probe was a development extension. Diagnostics came from the installed VSIX.
- Windows 10 Pro 10.0.19045 x64; VS Code 1.147.0 (`8a14f0cc1b08d531eb83255ea3764ae22aa932b5`); build Node 20.19.2 in Docker, launcher Node 22.23.0, Windows extension-host Node 24.22.1; Ryzen 7 7700X, 63.2 GiB RAM, 2.5 Gbps physical Ethernet.
- Storage: local fixed NTFS `E:\temp\tpv-pr21-acceptance-20261123\local-fixtures\<case>`; UNC `\\<SMB-SERVER>\<SHARE>\temp\<scratch>\<case>`; mapped `T:\temp\<scratch>\<case>`. Distinct LAN server and established TCP/445 verified; same sentinel SHA-256 through both aliases. Separate profiles/path identities, no string interchange assumption. SMB session-detail query denied without elevation; no permissions changed.
- Read repository guidance, latest commits, PR/issue work records and reviews. [Exact-head CI](https://github.com/Chain-Frost/tuflow_validator/actions/runs/45088299356) passed; [current-head independent review](https://github.com/Chain-Frost/tuflow_validator/pull/21#issuecomment-7088327775) found no major issues. No full automated suite repeated.

| Acceptance case | Local NTFS | Real UNC | Mapped SMB |
|---|---|---|---|
| Version-sibling create/rename/delete + correct Quick Fix | PASS | PASS | PASS |
| Unsaved TCF: nested outdated input; equal saved state | PASS | PASS | PASS |
| Dirty .tgc / .trd / plaintext .payload; save/tab-close/disk changes | PASS | PASS | PASS |
| Previously valid input delete/recreate | PASS | PASS | PASS |
| Two static contexts; shared child; TCF-relative nested TRD; reopen | PASS | PASS | PASS |
| 20 filesystem cycles: 80 transitions; no duplicate diagnostics | PASS | PASS | PASS |
| 20 open/edit/save/tab-close/root-switch cycles | PASS | PASS | PASS |
| Actual document-close ownership after root deletion | PASS | BLOCKED | BLOCKED |
| Unknown command, runtime tokens, conditional missing, current version, unrelated file | PASS | PASS | PASS |
| Remote file opened alone, no workspace: automatic sibling update | PASS | FAIL | FAIL |
| Native watcher-type count and complete disposal proof | BLOCKED | BLOCKED | BLOCKED |

Observed action-to-diagnostic timings in milliseconds (25 ms polling resolution; no invented latency budget):

| Storage | Cycle median | Cycle p95 | Cycle max | Dirty-edit median | Unsaved TCF | Max heartbeat lateness |
|---|---:|---:|---:|---:|---:|---:|
| local | 157.1 | 159.1 | 188.9 | 376.4 | 329.0 | 16.6 |
| unc | 155.7 | 158.6 | 185.7 | 375.1 | 329.0 | 43.1 |
| mapped | 156.3 | 159.0 | 189.1 | 374.3 | 319.0 | 41.2 |

Each storage completed 80/80 filesystem transitions: **240/240 overall**, with zero misses and no duplicate diagnostic entries. Heartbeat interval was 20 ms; no extension-host stalls observed during these bounded scratch runs. Dirty edits updated parent and child; saved children followed subsequent disk edits after tab closure.

Windows extension-host total process handles, sampled every two seconds:

| Storage | Filesystem run range (first → last) | Lifecycle run range (first → last) |
|---|---|---|
| local | 367–372 (372 → 367) | 370–372 (372 → 370) |
| unc | 370–375 (375 → 370) | 370–372 (372 → 370) |
| mapped | 367–372 (372 → 367) | 370–373 (373 → 370) |

local: real close true, final registered fixture documents 0; unc: real close false, final registered fixture documents 3; mapped: real close false, final registered fixture documents 3. Tab closure alone retained documents. Root deletion is a separate probe using VS Code WorkspaceEdit; Local deletion closed roots and cleared their diagnostics; both remote workspace probes retained three documents and stale root diagnostics after deletion, with zero close events. Empty-window remote deletion likewise did not unload the document. Bounded handle samples do not identify watcher types or establish complete native disposal; no leak-free claim. All 84 recorded test Code process IDs had exited at final verification (shutdown evidence retained).

Observed diagnostic examples:

- `TPV022`: `Referenced file is not the latest version in its folder: geom_v01.tgc (found 1, latest 2).` Quick Fix replacement: `geom_v02.tgc`, with the correct actual-path target.
- `TPV001`: `File not found: dirty_missing.csv`; conditional concrete missing input: `File not found: conditional_missing.csv`.
- `TPV002`: `Referenced file has 1 issue(s): dirty.payload` (also .tgc/.trd); shared TRD preserved independent A/B static contexts.
- `TPV020` filename-token warnings remain; runtime inputs produced no false `TPV001`. Unknown commands were excluded; unrelated file creation produced zero root diagnostic events.

Minimal confirmed failure reproducer (both network identities):

1. In a disposable SMB folder, create `Run_v01.tcf` containing `Geometry Control File == geom_v01.tgc`, plus clean `geom_v01.tgc`.
2. Open only the TCF in an isolated empty VS Code window, with **no workspace folder**. Wait for watcher setup.
3. Create `geom_v02.tgc` without editing the TCF. After approximately 4018 ms, expected `TPV022` is absent. Both UNC and mapped probes recorded zero VS Code watcher events and native `Error: UNKNOWN: unknown error, watch`.
4. Change diagnostic-level settings to force refresh: the correct `TPV022` appears. Opening the scratch folder as a workspace passes sibling notifications. Local NTFS also passes without a workspace.
5. In the remote empty-window probe, deleting the root did not unload its TextDocument; disposal there remains BLOCKED, not passing. No source change proposed; #23 already tracks the notification limitation. The separate F08 standalone-TRD context policy was not changed or requalified.

Probe corrections: initial unsaved-TCF assertion used unversioned `alternate.tgc`, excluded under the preserved version eligibility policy. Its failure is an invalid fixture assumption, superseded by the focused versioned `other_v02.tgc` probe and dirty/saved snapshot equality above. Initial separately imported module counters did not observe the extension's module instance; their zero watcher counts are invalid and excluded from conclusions. Raw observations and these corrections are retained.

Only new scratch text/existence-sentinel fixtures were changed; all scratch cases and the unique remote parent were removed and both aliases checked. No production projects, GeoPackages/sidecars/journals or QGIS datasets accessed; no TUFLOW execution, PR #9 code, policy/version/publishing changes, merge, release or publication. Original checkout and acceptance source remain clean. Full raw evidence is retained locally; a sanitized evidence bundle accompanies this Markdown report.


## Final independent verification addendum

This addendum reuses and inspects the same-day exact-head acceptance artifacts above; the 240-transition workspace matrix was not rerun. Six new installed-VSIX empty-window probes were executed independently. No implementation changes were made. PR #21 remained at `bdb6769f5366fd8ec3532a63254f5af4ac7470a6` after testing, and both exact-head hosted CI jobs remain passing.

The exact source was fetched into another clean detached worktree and rebuilt using Docker Node 20.19.2 and the documented `scripts/package-vsix.sh` process (CRLF in the shell script was temporarily converted to LF for execution and restored). A transient local comments export was removed before final packaging. The final VSIX contains only the normal 17 packaged entries; it was repackaged using the same `vsce package` command and prepublish compile. Its SHA-256 is `81a5c7e944d21c7216709744393fadd89138e6c425a0c9231948b706a43ccbef`. ZIP hashes differ from the earlier VSIX because packaging is not byte-reproducible. All 11 installed JavaScript module hashes match the freshly compiled source. The repeat package, profiles and extension directory are independent of the earlier acceptance runs and the user's normal extension installation. Installation and compilation succeeded; the complete 62-test suite was not repeated.

| Empty-window storage | Independent repeats | Automatic TPV022 after creation | VS Code watcher events | Native watch | Settings refresh | Fixture cleanup |
|---|---:|---|---|---|---|---|
| Local NTFS | 2 | PASS both | 3 per run, including root deletion | Events delivered | Correct warning | PASS both |
| Genuine UNC SMB | 2 | FAIL both | 0 both | UNKNOWN watch error both | Correct warning both | PASS both |
| Mapped SMB | 2 | FAIL both | 0 both | UNKNOWN watch error both | Correct warning both | PASS both |

Each repeat waited 1.5 seconds for watcher setup and observed creation for about 4 seconds. Raw per-run diagnostics, timestamps, errors, document-close events and cleanup results are in `repeat/*-1.json` and `repeat/*-2.json`. The first local launch was interrupted by the shell treating an Electron stderr message as an error; its test host nevertheless completed and wrote valid observations. A subsequent duplicate launch hit the profile mutex. Its exit is excluded from acceptance; the retained local-1 JSON is the completed original host, and local-2 used a separate fresh profile. The remaining four hosts completed normally. Runner exit codes are not the acceptance oracle; the recorded API events and diagnostic snapshots are.

Network configuration was rechecked: `T:` maps to the UNC share used here, the server resolves to a distinct LAN address, and an established TCP/445 connection exists to that address. No local-directory SMB substitute was used. Get-SmbConnection remained access-denied; no elevation or ACL changes were attempted. Mapped and UNC forms were tested in separate profiles. Their distinct URI strings remain distinct identities. Simultaneous dirty buffers for the same physical file via both identities were NOT TESTED.

Relevant settings: diagnosticLevel=`hint` initially (default), enableLatestVersionChecks=`true`, enableIfStatementChecks=`true`, enableIfStatementFormatting=`false`. The empty-window reproducer changes diagnosticLevel to `warning` only after the failed observation to force refresh. No user profile settings were changed.

## Resource evidence and remaining coverage

Resource summaries were calculated from the retained original raw samples, not from a new performance benchmark. Across the workspace and lifecycle runs respectively:

| Storage | Extension-host RSS MiB, first to final | CPU seconds over sampled elapsed seconds |
|---|---|---|
| NTFS | 229.0 to 194.4; 227.2 to 194.8 | 0.625 / 95.22; 1.000 / 31.12 |
| UNC | 228.7 to 191.2; 226.4 to 195.1 | 0.906 / 95.34; 1.453 / 30.96 |
| Mapped | 227.4 to 191.3; 227.8 to 196.7 | 0.797 / 95.68; 1.328 / 30.97 |

These bounded samples show no continuing total-handle or memory growth. They do not identify native watcher types or prove leak freedom. Node active handles and the separately loaded diagnostics module's trackedDirectories fields are invalid watcher-count evidence, as detailed in PROBE-LIMITATIONS.txt. Extension-host heartbeat observations do not establish UI-frame responsiveness.

| Additional acceptance item | Status | Limit |
|---|---|---|
| Network actual document unload and root-removal ownership | BLOCKED | Remote documents remained registered; no onDidCloseTextDocument observed, repeated in both new trials |
| Native watcher-type counts and complete disposal | BLOCKED | Total process handles observable; native watcher ownership not established |
| Newer TCF creation/removal changes latest-run eligibility | NOT TESTED | A Run_v02 fixture appears in lifecycle data, but no explicit eligibility assertion was recorded |
| Nested Read File traversal inside dirty include | NOT TESTED | Dirty direct includes and nested TRD context passed; dedicated dirty nested-Read-File acceptance not recorded |
| Temporary remote-share outage and watcher recovery | NOT TESTED | No controlled isolated share interruption performed; user's active mapping left intact |
| Simultaneous mapped/UNC open-buffer identity behavior | NOT TESTED | Separate identity runs passed workspace tests; concurrent alias buffers not exercised |
| Representative first/cold and warm validation benchmark | NOT TESTED here | Owned by Agent D #16; no cold-disk claim, caching not controlled |
| Production-model and long-duration performance | NOT TESTED | Disposable small fixtures only |

## Cause, follow-up and merge recommendation

At this exact source, `src/extension.ts:50` creates directory-relative VS Code filesystem watchers; lines 53-65 invoke targeted invalidation only when events arrive. In the failing empty-window remote context, an independent API watcher gets zero events and native fs.watch reports an error. The correct warning after settings refresh shows that the new sibling is discoverable by analysis. This supports notification delivery as the likely environmental cause, rather than incorrect version-series matching or stale snapshot calculation. `src/extension.ts:105` removes root contributions only on a real document-close event; the remote probes did not emit one. Retained diagnostics after root deletion are therefore reported as an unload/disposal gap rather than a separately proven B cleanup defect.

The focused freshness implementation has positive exact-head workspace evidence on NTFS and real SMB, plus passing hosted CI. Nevertheless, an automatic freshness requirement fails twice on each network path outside a workspace. That is a remaining local-environment correctness blocker for unconditional acceptance. Existing issue #23 owns this confirmed limitation. Recommend a focused follow-up there; manual refresh PR #24 is a fallback, not proof of automatic freshness. No speculative source fix was made and PR #21 was not expanded.

Agent D #16 retains representative performance qualification. Broader issue #3 acceptance additionally needs the missing environment/lifecycle and coverage items above; it must remain open. An owner may decide separately to accept a documented workspace-only limitation for the focused PR, but no such acceptance is inferred here.

**Final recommendation: BLOCKED — CORRECTNESS DEFECT.** This is the already tracked SMB empty-window notification failure, reproduced at the exact current head; no new general code-review defect is claimed. Do not merge PR #21 or close issue #3 from this report.
