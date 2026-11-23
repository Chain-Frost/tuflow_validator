# Disposable Windows SMB probes

Read [REPORT.md](REPORT.md) for the tested identities and limitations. These drivers are investigation tools, not an automatic watcher fallback. Do not point them at a production model or share root. Use an existing genuine remote SMB share, with a newly created disposable parent accessible through both identities.

1. Check out PR #21's exact `53f756aa9c96da7399425d32b0325fe23b6c6082` implementation plus this evidence commit in a separate worktree. Build/install dependencies, compile, lint and package in the documented Docker/VM environment. Do not alter the extension version.
2. Set `TPV_LAB_ROOT` to a fresh local evidence directory. Create `probe/package.json` inside it with metadata only:

   ```json
   {"name":"smb-investigation-probe","publisher":"local","version":"0.0.1","engines":{"vscode":"^1.70.0"}}
   ```

3. Create `locations-private.json` inside that directory. Supply absolute, explicitly disposable parent paths for `local`, `mapped` and `unc`. Create the parents first. Verify a disposable sentinel through both network aliases; do not assume string identity proves physical identity. Keep this file private.
4. Install the freshly built VSIX into `<lab>/installed`, with a separate `<lab>/install-profile` user-data directory. Compare installed runtime hashes to compiled source. The development extension must be the metadata-only probe, so diagnostics come from the installed VSIX.
5. Run `node scripts/run-smb-probe.cjs` from the investigation worktree. It uses the installed Windows VS Code executable, individual new profiles and trace logging. No mode variable produces the six local/UNC/mapped × empty/workspace watcher comparisons. Each pattern gets two four-transition cycles. Clear mode variables between these additional runs:

   | Mode environment variable set to `1` | Coverage |
   |---|---|
   | `TPV_FULL` | Three workspace runs, 20 cycles each, then semantic diagnostics checks |
   | `TPV_DEPTH` | Three empty-window recursive-scope/native-recursive probes |
   | `TPV_LIFECYCLE` | Three workspace runs observing real close callbacks and disposable-root deletion |
   | `TPV_REPEAT` | Three fresh empty-window simple-pattern runs, without any recursive probe |

   Keep profiles fresh; reusing an evidence folder overwrites results and can retain configuration. Network writes use synchronous Node APIs in these controlled, small-fixture tests; this is not a proposed production I/O mechanism or unavailable-share test. A wedged share can stall a probe; do not run share-disconnection experiments on a shared service.

6. Optionally run `scripts/sample-smb-resources.ps1 -EvidenceRoot <lab>` separately during the tests. Creating `<lab>/sampling-stop` stops the sampler. Process samples are whole-process observations, not per-watcher or SMB byte counters. They include built-in extension overhead.
7. `node scripts/run-windows-suite.cjs` runs the existing compiled source suite in a separate development profile; this is explicitly distinct from the installed-VSIX probes. Update its paths for a different evidence root.
8. `py -3 scripts/export-smb-evidence.py` exports sanitized JSON and selected watcher traces. Inspect exports before publishing. The exporter requires the private path map and only exports evidence from the configured local lab. It never includes the private location map itself. Retain original raw evidence separately.

The drivers remove only the unique fixture directories they create. Leave the lab and its profiles/results intact for provenance. End all test Code processes before removing any empty scratch parent, and verify mapped/UNC cleanup separately. Do not disconnect mapped drives, modify ACLs or kill unrelated VS Code processes.

The full workspace driver was adapted from the earlier `84e8ad7` acceptance driver. Its known unversioned alternate-control fixture was corrected; latest-TCF eligibility creation/removal checks were added. Its separately imported diagnostic-module directory counts are not authoritative, as explained in the report. Only the real diagnostics, actual close events and native trace/process evidence support conclusions.
