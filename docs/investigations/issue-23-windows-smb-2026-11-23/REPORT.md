# Windows SMB watcher investigation — 23 November 2026

Tracking: [#23](https://github.com/Chain-Frost/tuflow_validator/issues/23), parent [#3](https://github.com/Chain-Frost/tuflow_validator/issues/3), freshness [PR #21](https://github.com/Chain-Frost/tuflow_validator/pull/21).

**Decision: BLOCKED — PERFORMANCE OR RESOURCE RISK.** A documented recursive watcher arrangement receives automatic notifications on the tested out-of-workspace SMB fixtures. It is not a verified product fix: it expands every dependency-directory subscription into a descendant-tree watch, without an extension-owned bound on that tree. No production implementation or default fallback was added. The owner has not accepted a workspace-only product limitation.

## Tested identities

- Default branch at investigation start: `936231289b767ec0028a0be7b18bb78596dc4fd6`.
- Exact installed implementation: PR #21 `53f756aa9c96da7399425d32b0325fe23b6c6082`. All four investigated implementation files are unchanged from independently reviewed `bdb6769f5366fd8ec3532a63254f5af4ac7470a6`. Separate worktree/branch `investigation/issue-23-smb-watchers`; the user's original checkout was preserved.
- Other live heads inspected: PR #22 `9c9ef571fb2f541ad6e6f063a75cb735d7bb166a`; PR #24 `1e34ab304134c7755411deb99e28f633d210b845`. Neither was imported. PR #24 remains the distinct manual fallback.
- Freshly built VSIX SHA-256: `67a13b61952a65246c09843bc475d754d7ddae47535f7c0b879b8eb65ae05573`; unchanged version 0.2.6. All 11 installed runtime modules match the compiled worktree ([identity](installed-identity.json)).
- Windows 10 Pro `10.0.19045`, local E: NTFS. VS Code `1.147.0`, commit `8a14f0cc1b08d531eb83255ea3764ae22aa932b5`; Windows Extension Host Node `24.22.1`. Build: Docker `tuflow-helper-qa`, Node `20.19.2`; launcher Node `22.23.0`.
- Genuine existing mapped SMB and matching UNC on a distinct LAN server. Both aliases read the scratch sentinel SHA-256 `e0487ea55a6d036b0ded12c238d06e82d08ce847860d513b2a19e31eebf47456`; established TCP/445 sessions were present. No SMB dialect or other-server compatibility claim. Only uniquely named scratch files were used; no production models, GeoPackages, QGIS or TUFLOW accessed.
- Each run used its own new profile, isolated extensions directory, installed VSIX and metadata-only development probe. Raw evidence remains under `E:\temp\tpv-smb-investigation-20261123`; this directory contains sanitized copies. Private server/share identifiers are replaced, while fixture suffixes, timestamps and separate path identities remain.

## Reproducer and alternatives

Create `Run_v01.tcf` containing `Geometry Control File == geom_v01.tgc`, and a clean `geom_v01.tgc`. Open the TCF, wait for registration, then create `geom_v02.tgc` without changing an editor buffer. Expected: automatic TPV022. Also rename the sibling out of/back into the version series and delete it. Each arrangement runs two four-transition cycles, with snapshots after 900 ms. This is an observation interval, not a guaranteed delivery deadline.

The probe registers these arrangements sequentially, disposing each before the next:

1. Existing `RelativePattern(directoryString, '*')`.
2. Documented explicit `RelativePattern(Uri.file(directory), '*')`.
3. Documented recursive `RelativePattern(Uri.file(directory), '**/*')`.

Sequential registration matters: VS Code's stable watchers consume a shared, uncorrelated event stream. Installing a working recursive watcher alongside the original watcher can make the original callback fire; that does not prove the original native subscription works. The extension's TPV022 updates while the recursive probe is active demonstrate this sharing.

Detailed outcomes, snapshots, native errors, registrations and callback times are in the six `*-empty.json` / `*-workspace.json` files and `summary.json`. The original two nonrecursive arrangements deliver no network events outside workspaces. The URI base does not repair this failure. Recursive watching receives the tested transitions; workspace opening also restores event delivery for the original pattern. Direct nonrecursive `fs.watch` reports `UNKNOWN`, including where workspace events work. Its failure is not a reliable capability test for VS Code's recursive backend.

After disposing the recursive probe, a further sibling creation on empty-window SMB again fails to produce TPV022. An explicit settings refresh then finds the correct warning. This is a computation control, **not automatic acceptance** and not a replacement implementation of PR #24.

## Cause and documented boundaries

The extension already supplies an absolute external base through `RelativePattern`; this is a supported API arrangement. Passing a bare glob string instead would restrict events to workspace folders and would fail in an empty window. There is no evidence of a path-parsing or version-diagnostic defect here.

The observed failure is in the nonrecursive notification path. VS Code trace logs identify the Node watcher and `UNKNOWN` failures on the scratch directory/open TCF. Recursive requests instead use Parcel's Windows backend and receive changes. Workspace-open configurations already have recursive coverage. This explains the observed configuration difference; the precise cause inside Electron/Node/libuv, Windows or the SMB server remains unresolved. Do not label all SMB notifications unsupported, or claim the OS/server lacks change notification support.

Official sources, checked during this investigation:

- [VS Code API: createFileSystemWatcher](https://code.visualstudio.com/api/references/vscode-api#workspace.createFileSystemWatcher): external RelativePattern bases are supported; glob complexity selects recursion; recursive watchers cost more resources; a bare string does not add an external watch. This is documented API behavior, not a network reliability guarantee.
- [VS Code watcher internals](https://github.com/microsoft/vscode/wiki/File-Watcher-Internals): Node/nonrecursive versus Parcel/recursive implementation and shared events. Internal implementation details can change.
- [Current Node watcher implementation](https://github.com/microsoft/vscode/blob/main/src/vs/platform/files/node/watcher/nodejs/nodejsWatcherLib.ts): backend errors and internal failure callbacks exist. These are not extension API failure signals; the source is corroborating current upstream code, not a pin to the installed binary.
- [Upstream custom-exclusion proposal #169724](https://github.com/microsoft/vscode/issues/169724): the proposed per-watcher exclude API is not a stable API contract available to this extension. Do not use proposed API as a production correction.
- [Upstream watcher limitations](https://github.com/microsoft/vscode-wiki/blob/main/File-Watcher-Issues.md): network notification delivery is not guaranteed. Silence cannot prove a dependency graph is fresh.

`FileSystemWatcher` exposes create/change/delete and disposal, but no public ready, failed, overflow or healthy state. Creation returning successfully did not mean events would arrive. A direct native-watch failure is also not proof that the API's other backend fails. No reliable automatic fallback trigger was demonstrated.

## Why no default correction was implemented

Replacing `*` with `**/*` is a small textual change with a much larger filesystem scope. Every directory containing an exact dependency, version series or latest-TCF discovery dependency can contain an arbitrarily large unrelated tree. A narrow complex glob still requests recursive backend coverage: the event filter does not establish a traversal bound. The depth probe and watcher traces record that distinction.

The stable API gives this extension neither a per-watch descendant-exclusion control nor a maximum enumerated-entry, memory, work or network-I/O budget. Global `files.watcherExclude` belongs to the user and cannot be silently rewritten as an extension fix. Scratch success does not qualify large/unavailable shares. We did not scan a production tree or introduce permanent background tree scans to obtain a benchmark.

Other alternatives assessed:

- Bare workspace glob: wrong scope for empty windows; rejected by documented semantics.
- URI base with simple glob: tested; still fails outside SMB workspaces.
- Native `fs.watch`: tested; fails. Native recursive behavior is recorded separately by the depth probe. No native-addon implementation was introduced.
- Editor/workspace file-operation events: do not cover external creation of unreferenced siblings; cannot satisfy this objective.
- Re-registering a silent watcher: no public failure trigger; repeating an unchanged failed native arrangement is not evidence-backed recovery.
- Periodic reconciliation: not proposed or implemented. No reliable failure trigger was established; a directory-count cap does not bound entries or the duration of SMB reads. A timeout around uncancellable work does not bound outstanding requests. Thus no safe default activation condition, work budget, interval, disconnect or shutdown contract was demonstrated. No speculative polling was enabled.

## Acceptance and resources

Fresh watcher comparison (API callback delivery, two four-transition cycles per arrangement):

| Storage/window | Existing string base `*` | URI base `*` | Experimental URI `**/*` |
|---|---:|---:|---:|
| NTFS / empty | 8/8 | 8/8 | 8/8 |
| NTFS / workspace | 8/8 | 8/8 | 8/8 |
| UNC SMB / empty | 0/8 | 0/8 | 8/8 |
| UNC SMB / workspace | 8/8 | 8/8 | 8/8 |
| Mapped SMB / empty | 0/8 | 0/8 | 8/8 |
| Mapped SMB / workspace | 8/8 | 8/8 | 8/8 |

Both sibling creations and their renames back into the version series automatically produced TPV022 in every notified arrangement; renaming away and deletion cleared it. The failing arrangements never warned on creation. The independent `*-repeat-empty.json` runs use fresh profiles/fixtures and disk mutations from a **separate Node process**, with no recursive probe installed, to avoid attributing the result to same-process mutation or recursive event sharing.

Independent-repeat results: NTFS 8/8 transitions notified, UNC 0/8, mapped 0/8; no probe exception. Each remote repeat still produces the correct TPV022 after explicit revalidation.

The full installed-VSIX workspace driver repeats 20 cycles of sibling create, rename away/back and delete (80 transitions per configuration), then checks Quick Fix targeting, existing-child disk changes, missing-file recovery, dirty TCF and plaintext include buffers, latest-TCF eligibility changes, two static-variable contexts sharing a child, root reopen, and unrelated events. Per-transition diagnostics and latency are retained in `*-acceptance.json`; statistics are in `summary.json`.

| Full workspace acceptance | NTFS | UNC SMB | Mapped SMB |
|---|---:|---:|---:|
| Sibling transition cycles | 80/80 | 80/80 | 80/80 |
| All passing checks | 111 | 111 | 111 |
| Failed checks | 0 | 0 | 0 |
| Tab-close unload check, correctly left blocked | 1 | 1 | 1 |
| Transition latency median / p95 (ms) | 157.6 / 160.1 | 156.3 / 182.1 | 156.3 / 159.4 |
| Transition latency maximum (ms) | 160.2 | 186.2 | 186.7 |
| Sampled Extension Host handles first → last | 375 → 370 | 375 → 370 | 370 → 365 |
| Sampled Extension Host CPU seconds delta | 0.594 | 0.922 | 0.922 |
| Sampled peak Extension Host RSS (MiB) | 231.7 | 231.2 | 236.2 |

This is **240/240 cycle transitions and 333 passing checks**, with three explicitly blocked tab-close assumptions. Timing is action-to-diagnostic observation at 25 ms polling resolution, including delivery/debounce; it does not isolate notification-callback-to-diagnostic latency. No latency or resource budget was preapproved, so these are observations, not performance acceptance limits. Each full run has 37 OS resource samples.

The source suite and focused no-workspace probes do not establish full no-workspace SMB acceptance. Those configurations fail the automatic smoke test; the remainder of their full diagnostic matrix is unvalidated. Experimental recursive coverage is not a supported product configuration and has no full acceptance claim.

Resource evidence includes Windows process CPU, working set/private memory and handles sampled every two seconds; Extension Host snapshots include memory and heartbeat jitter. `process._getActiveHandles()` is only a proxy and is not a native watcher count. Trace logs identify backend registrations/stops. Samples cover bounded scratch runs, not server/network byte counts, a production-scale workload or unavailable-share behavior. No inference of universal low overhead or leak freedom is justified.

The inherited workspace driver's `trackedDirectories` field comes from a separately required diagnostic module. That module identity was not authenticated against the running extension instance; its empty counts are excluded from ownership/resource conclusions. Real diagnostic snapshots, public close events, process samples and backend trace logs are the evidence used here.

The separate lifecycle probe distinguishes tab closure from actual document unloading, records real close callbacks, and deletes only disposable roots through WorkspaceEdit. The existing implementation disposes all three owned listeners and its watcher on directory removal, and clears its reconciliation timer on deactivation. Root ownership can persist while VS Code retains the TextDocument. Trace stops and process shutdown must be assessed separately from tab closure.

Fresh results: all three configurations retained both documents after tab closure. Local WorkspaceEdit deletion emitted two real close events, closed both documents and cleared both diagnostics. UNC and mapped deletion returned success but emitted **zero** close events; both TextDocuments remained open internally with TPV002 still present. Thus actual network unload/ownership disposal remains **BLOCKED**, not passing. The probes dispose their listeners/watchers explicitly; native backend traces show recursive probe stop requests. Complete product watcher disposal while network documents remain retained is unqualified.

[Shutdown/cleanup evidence](shutdown.json): all **154 sampled test Code process IDs** exited, with no remaining Code command line referencing the lab. All recorded unique fixtures were removed; the now-empty network scratch parent was removed and its absence verified through mapped and UNC paths. The local lab, profiles, original logs and VSIX remain available for audit. This verifies test shutdown, not native watcher leak freedom during a retained-document session.

The recursive depth probe receives creation of `unrelated/deep/unreferenced.txt`; a narrow complex `*/unmatchable-control-file.tgc` pattern is still logged as a recursive request, even though its event filter matches nothing. Both direct native recursive SMB probes fail with `UNKNOWN`. This establishes that neither changing native recursion nor narrowing the callback glob establishes a lightweight reliable fallback. Successful small recursive API probes remain experimental.

Share interruption/recovery was not run: the accessible shares are shared existing services, not an exclusively owned disposable SMB server/session. Disconnecting one could disturb other work. Missing-file recreation is not evidence of network reconnection behavior.

## Validation and merge gates

- Docker locked installation, TypeScript compilation, ESLint and VSIX packaging passed.
- Fresh native Windows VS Code Extension Host suite: **63 passed, 0 failed**, exit 0 ([log](windows-suite.log)).
- Exact implementation-head hosted [Extension tests #45103645922](https://github.com/Chain-Frost/tuflow_validator/actions/runs/45103645922) passed: **62 Linux / 63 Windows**, including package-boundary checks. Exact-head [core baseline #45103645949](https://github.com/Chain-Frost/tuflow_validator/actions/runs/45103645949) also succeeded. These hosted jobs do not exercise genuine SMB.
- Local Linux suite launch was unavailable in the existing Docker image (`xvfb-run` absent); no local Linux pass is claimed. Hosted Linux results above were independently fetched at the exact implementation SHA.
- New reproducible investigation drivers live in `scripts/smb-*.cjs`, `run-smb-probe.cjs`, `run-windows-suite.cjs`, and `sample-smb-resources.ps1`; they are excluded from the VSIX by the existing packaging rules. They exercise the installed implementation rather than an uninstalled development substitute.

**PR #21 remains blocked for unconditional automatic freshness outside SMB workspaces.** No fix PR is appropriate without a demonstrated safe implementation. Recommend that the owner consider explicitly documenting workspace-open automatic freshness on the tested configurations, with PR #24 as manual recovery where needed. That is a recommendation, not an adopted product-policy decision. Alternatively, authorize a separately scoped opt-in recursive-watcher investigation with explicit scope/resource limits and fresh full acceptance. Other servers, minimum supported VS Code, network reconnection and complete native disposal remain unqualified.

No merge, release, publication, version change or issue closure was performed.
