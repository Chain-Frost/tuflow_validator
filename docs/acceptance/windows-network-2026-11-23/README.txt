Independent Windows / real SMB acceptance - 23 November 2026
Tracking: issue #3; D1 #16; D2 #22

Verdict: D2 core improvement persists on genuine mapped SMB and UNC. Full environmental acceptance remains FAILED / BLOCKED as detailed below. No production code, extension version, release or merge changes were made.

Environment and method
Windows 10 Pro 10.0.19045; AMD Ryzen 7 7700X (16 logical CPUs); 67,869,888,512 bytes visible RAM; local C: NTFS. Active physical LAN adapter reports 2.5 Gbps. Distinct LAN client/server IPv4 and an established remote TCP/445 connection independently support genuine SMB; mapped alias and matching UNC reference the same approved scratch parent. Server/share/IP, route and mappings are retained in local private records and redacted from public files per prior owner instruction. SMB dialect/signing/server OS were unavailable (Get-SmbConnection access denied); no elevation or ACL change.
VS Code 1.147.0; extension-host Node 24.22.1; core/build Node 22.23.0. Node portable archive matched official SHASUMS256. Extension version stays 0.2.6. Isolated user-data and extension directories; only Validator installed as a user extension, plus an empty development test scaffold. Bundled VS Code extensions remained active: host CPU/RSS/timer jitter include their work.
Core D1 driver pinned to 71b3cb56258ed03929665dbf2596af839c09bde6, copied byte-identically into separately compiled B and D2 worktrees. N=19 warm trials after 3 discarded warmups for each of nine warm scenarios, plus one separate first-engine invocation. 1,548 total core trials across 3 builds x 3 storage spellings. Fixture: 183 files, 117,425 bytes, SHA-256 55a7a7a506948fc5317c00ce8dac5f24e86e739d15d04c07657de398c45f163d. No injected delay, loopback share, cache flush or production model was used. First invocation follows fixture creation and is NOT cold disk. p95 is nearest-rank; at N=19 it is the maximum sample.
Settings: diagnosticLevel=hint, enableLatestVersionChecks=true, enableIfStatementChecks=true, enableIfStatementFormatting=false, except explicitly measured settings changes.

Source identity and packaged bytes
d1: source commit 71b3cb56258ed03929665dbf2596af839c09bde6
  git archive ZIP SHA-256 2b2107a59d54acc4f788770e67789410b0a3ece87740ed8875fd6ded2267cab7
  VSIX SHA-256 48c65e94ccb957547235dc47ceeac00d3f552c004cb29fd10d2386fa369ec674
before: source commit 889d5e2e1951fe7de6edc187ea4508e6037d2179
  git archive ZIP SHA-256 59e47384a18f288bffb38d68919764abf292b2c1024c4a97b787e9ebb60cdc03
  VSIX SHA-256 f0dfbb3115bbb8121ebf70a5f61003626bd7c6cf7673615f16b849ffbe849cde
d2: source commit f5845503fc0587e37c43d807bf11bfd6bfbbdfe4
  git archive ZIP SHA-256 467b50d7b949e3a66b93f17aaa3fdbc8ec795039f3a0287ba300e4a3f9bcd6fa
  VSIX SHA-256 b39d6f9f5afa753b5db4d48d2809194ea60499da806b3920c75a38bdef157899
All three VSIXs contain 17 entries and 11 runtime JS modules. CRC passed; compiled, packaged and installed runtime bytes matched exactly. All three passed the unchanged E1 verifier copied into each source checkout. Source ZIPs and VSIXs are retained locally, not released.

Core wide graph: median / p95 milliseconds (N=19)
Storage | D1 | pinned B | D2 | B-to-D2 median reduction
local | 80.951/101.842 | 94.129/98.196 | 65.527/81.565 | 30.4%
mapped | 297.656/474.185 | 273.598/330.339 | 120.963/162.560 | 55.8%
unc | 295.064/414.176 | 323.267/446.022 | 154.845/183.922 | 52.1%
Operation counts are instrumented synchronous filesystem API calls, not SMB packet/request counts or cold physical-disk reads.
Wide per-analysis reads/exists/directory enumerations: D1 305/576/121; B 121/576/121; D2 121/576/2. All 19-trial B/D2 diagnostic signatures and counts match in every scenario on all three storage spellings; sibling changed-path outcomes match. Core scenarios also include depth-48, 120-wide/32-shared, two roots, 24 variable contexts, root edit, child change, version revalidation and 4,000-line/400-missing controls. All fixture trees were removed. See core-trials.csv and core-summary.csv for every measurement, not only the wide graph.
D1 and B differ in traversal and freshness behavior: do not attribute their timing difference to one isolated cache change.
These are one-workstation, fixed-order B-before/D2-after observations, without randomized/reversed replications. SMB cache state was uncontrolled; this is a synthetic disposable model corpus on real network storage, not a representative production-model or engineering acceptance claim. Reduced synchronous filesystem API calls and unchanged diagnostics support the measured benefit, but the percentages are not universal performance guarantees.

Comparison with downloaded exact-head CI raw artifacts
D1 run 45042495644: wide Linux 35.143/40.857 ms, hosted Windows 114.375/122.421 ms, 305/576/121 operations. D2 run 45042568558: pinned B 46.961/54.068 -> D2 36.315/40.208 ms, 121 -> 2 directory enumerations, unchanged 121 reads / 576 exists. Retrieved raw JSON is included in ci-reference. Different Windows builds, CPUs, Node versions and storage preclude direct attribution of cross-machine wall-time differences. The same operation reduction and paired diagnostic parity persist on this real SMB server.

Installed VSIX editor observations (includes 300 ms debounce)
Run | first diagnostic, N=1 | dirty root median/p95, N=19 | dirty child median/p95, N=19
host-d2-local | 285.384 | 374.322/499.491 | 373.326/379.590
host-d2-mapped | 171.730 | 374.000/574.902 | 374.211/384.286
host-d2-unc | 239.534 | 374.460/475.777 | 376.596/391.945
host-d2-workspace-mapped | 300.662 | 377.510/498.061 | 378.534/393.485
host-d2-workspace-unc | 211.456 | 377.810/736.793 | 377.107/393.682
Main host-* runs use an empty window (no workspace folder). host-d2-workspace-* repeat the complete sequence with the approved scratch folder open. Non-edit event/settings measurements are one correctness observation each; a timeout is NOT a successful latency or a p95 estimate. Dirty buffers were authoritative; missing physical input create/delete, saved-child disk edits, version sibling create/delete/rename, settings disable/re-enable and diagnostic snapshots are in raw JSON.

Notification isolation: B versus D2, empty window versus open scratch workspace
Run | version diagnostic after 4 s | native fs.watch error | VS Code watcher API events | actual document-close observation
notify-before-local-false | passed | False | 3 | passed
notify-before-local-true | passed | False | 5 | passed
notify-before-mapped-false | failed | True | 0 | blocked
notify-before-mapped-true | passed | True | 1 | blocked
notify-before-unc-false | failed | True | 0 | blocked
notify-before-unc-true | passed | True | 1 | blocked
notify-d2-local-false | passed | False | 3 | passed
notify-d2-local-true | passed | False | 6 | passed
notify-d2-mapped-false | failed | True | 0 | blocked
notify-d2-mapped-true | passed | True | 1 | blocked
notify-d2-unc-false | failed | True | 0 | blocked
notify-d2-unc-true | passed | True | 1 | blocked
For the initial failed remote sequence, create/edit cases establish incorrect diagnostics. Rename-away/delete timeouts alone do not prove an incorrect diagnostic state when the preceding create notification was already missed.
On both B and D2, remote paths outside the open workspace fail to refresh after sibling creation; initial full empty-window runs also failed sibling rename/delete, child disk edit and missing-input create/delete (no diagnostic event within 10 s). Local NTFS passed. Native fs.watch reported UNKNOWN: unknown error, watch for the remote directory. Opening the disposable share folder as a workspace restores the sibling notification through VS Code, even though the direct Node watcher still errors. A settings refresh sees the new sibling on the failed cases, so the evidence does not identify a D2 stale-directory-cache regression. This is an inherited, context-dependent environmental acceptance failure, not blanket failure of SMB notifications.

Wide graph host responsiveness, D2 only (custom disposable host fixture; not a paired host speedup comparison)
host-d2-followup-local: N=19, edit median/p95 438.786/471.076 ms; 10 ms heartbeat delay p95/max 6.285/99.611 ms; each edit retained 120 child summaries.
host-d2-followup-mapped: N=19, edit median/p95 470.599/589.879 ms; 10 ms heartbeat delay p95/max 6.279/146.808 ms; each edit retained 120 child summaries.
host-d2-followup-unc: N=19, edit median/p95 487.623/533.631 ms; 10 ms heartbeat delay p95/max 6.310/159.730 ms; each edit retained 120 child summaries.
Timer scheduling delay is a host responsiveness proxy, not editor frame-rate telemetry. No owner-approved millisecond budget was applied. Wide processing still creates visible synchronous-blocking risk despite D2 operation savings.

Lifecycle, handles, memory and integrity
Closing tabs left documents registered/isClosed=false and did not establish an onDidCloseTextDocument event. The focused local delete-through-editor probes observed an actual close event, isClosed=true and cleared diagnostics after 1.5 s. On the network, the editor deletion path did not unload the documents; native close/disposal qualification is BLOCKED there. Node cleanup of the disposable files succeeded. This is not evidence of a watcher leak. No private/production model or GeoPackage was modified, locked, truncated or replaced; no GPKG/SQLite contents were read. Existing synthetic physical-input sentinel hashes before/after are identical in each main host run.
os-handles-*.csv/json are actual Windows Get-Process process-handle, working-set/private-memory and CPU samples at approximately 2 s intervals. Match environment.pid to the extension-host PID; other rows are the isolated Code process tree. These are OS handles, not a count of native filesystem watchers. Main empty-window extension-host handle min/max/last were local 370/380/380; mapped 365/380/380; UNC 359/378/378. Closure left roots active, so these values do not establish leakage. Per-phase RSS/heap/CPU and Node active-handle/request proxies are retained separately. Native watcher-type enumeration, timer/queue ownership, server SMB session details and a long-duration leak campaign remain unavailable; process-exit observations are in shutdown.json.

Probe qualifications
The initial small-host runtime-token assertion used bare ~s1~/~e1~ filename literals instead of TUFLOW substitutions <<~s1~>>/<<~e1~>>. Its failed runtimeTokensUnevaluated check is an invalid test expectation, not a product finding. All corrected wide follow-up and workspace probes retain the proper substitutions and pass the no-missing-file requirement, while still reporting concrete conditional missing inputs. TPV020 missing-filename-token checks remain permitted. The initial observer also compared object-valued VS Code diagnostic codes directly to strings; initial observer raw files are preserved as probe-initial-* and the corrected observer normalizes code.value. notification-analysis.json independently derives verdicts from the raw code value. The early wide follow-up close listener used a case-sensitive Windows prefix; its empty closeEvents is not used as proof of no close. The corrected notification observer uses a case-insensitive prefix and directly records the close event.

Validation and follow-up
Fresh native Windows standard extension-host suites (D1 then D2): 47, 62 passing. Install/compile/lint/package logs and immutable source identities are retained locally; compiled/package/installed byte equality is recorded in provenance.json.
1. Investigate/document remote files opened outside a workspace: reproduce with a clean profile, open only the scratch TCF, create geom_v02.tgc, wait 10 s, then compare with opening the scratch folder as a workspace. B and D2 both reproduce. Test a safe notification fallback or an explicit refresh path for this environment before claiming general network freshness.
2. Re-test actual network document unloading, watcher disposal and stale publication with native watcher tracing/type counts. Do not equate tab closure, logical dependencies or Node active handles with native watcher disposal.
3. Retain D2 as a measured optimization candidate; it does not resolve network watcher delivery or all synchronous host latency. Keep issue #3 open. Do not merge/release from these results.

Acceptance classifications
PASSED: same-machine NTFS/mapped/UNC and 19-sample deep/wide/shared/multi-root/static-context core tests
PASSED: paired B/D2 core diagnostic parity and real-network D2 directory-operation improvement
PASSED: dirty root/child editor changes and settings invalidation
PASSED: concrete conditional missing inputs, unresolved runtime substitutions and filename version detection
FAILED: remote filesystem freshness for files opened outside any workspace
PASSED: open-workspace remote notification sequence
PASSED: local actual document-close event and diagnostic cleanup
BLOCKED: network actual document-close/disposal and native watcher-type counts
BLOCKED: true cold-disk/cache-cleared, server OS/SMB dialect, actual UI-frame measurement and long-duration leak acceptance

Data and reproducibility
core-trials.csv = every raw timed core trial; core-summary.csv = all per-scenario medians/p95 and operation counts. core-*.json = immutable fixture manifest, settings, diagnostics fingerprints, CPU/RSS and event/disposal observations. host-*.json = editor timings/diagnostic snapshots; notify-*.json = independent watcher comparison; os-handles-* = actual process resources; provenance.json = source archives/VSIX identities and byte-equality checks; evidence-manifest.json = public sanitized file hashes. Source build archives, VSIXs, exact server identity and unsanitized measurements are retained under the local operator acceptance directory. Public artifacts redact paths/server identifiers but preserve measured numbers. Test scripts are included under reproducer; re-run only with your own owner-approved disposable filesystem parent. Do not point them at a production model/share tree.

