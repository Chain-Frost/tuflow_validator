# Issue #10 — VSIX identity and coexistence evidence

Recorded 2026-11-22. Tracking: https://github.com/Chain-Frost/tuflow_validator/issues/10

## Provenance

| Item | Exact source identity | Observation |
| --- | --- | --- |
| Validator main | 4a0282e93b979345374076fb0adc60c7faf6af99; Chain-Frost.tuflow-path-validator 0.2.6 | Recognised-input-only validation; the viscosity commands classify as unknown, so file checks should be skipped |
| GitHub release v0.2.6 | Annotated tag 43053afafc981ba1d81d004b8306ab77d4e5d5cf targeting 3e8fe8e46dc2214d7d0bbcaa8faba615a15509e6, published 2026-08-27 | Source used a narrow skip-list and generic path heuristics; Node treats the extension of the string 0.2, 0.1 as .1 |
| First correction | 2e0f531c692b5e0943c8c3b76a6b69b394b986af, 2026-10-12 | Introduced the input-command allowlist, command classification and stable diagnostic codes |
| Helper PR #12 | 8a3411f528e33e7f227d72ca8b5ad41172fefdb4; lmillard79.tuflow-helper 0.8.2 | Draft, not merged; shared tuflow language ID and removed duplicate opener |
| Helper PR #16 | 3f68375b448ce26bf9d369fda9f3b3e05049ba27 | Draft, not merged; acceptance fixtures and runner |

**Main and the August release both advertise version 0.2.6.** No assumption about an actual user's installed compiled output can be made from the version number. The GitHub release VSIX does not independently prove the current Marketplace binary.

## Verification arrangement

The workflow in .github/workflows/issue10-vsix-acceptance.yml builds a VSIX from the checked-out Validator source and packages the pinned Helper PR #12 head. It downloads the public GitHub release VSIX as a historical comparison and records SHA-256 hashes, package identities, and compiled parser/diagnostic hashes. The compiled parser in the new VSIX is checked byte-for-byte against the compiled source.

The test uses Helper PR #16's existing acceptance runner. It takes a disposable copy, adds numeric/viscosity/unknown-command and genuine missing-input probes, and minimally instruments the copied runner to report diagnostic codes, Quick Fix titles, formatting and close/reopen observations. It does not modify Helper PRs or create a competing Helper acceptance harness.

Real Extension Host profiles use isolated settings and extensions directories: Validator-only with current VSIX, Validator-only with historical release, Helper-only, both, both with explicit tuflow file associations, and both with seito-openfile and Error Lens. The runner records VS Code version, observed document language, installed extension IDs/versions and source/VSIX hashes. All pass/fail/blocked statuses and original Helper runner failures are retained. Workflow evidence is uploaded as JSON only, not as VSIX binaries.

## Required expected behavior

- Viscosity Formulation == SMAGORINSKY and Viscosity Coefficients == 0.2, 0.1 must not generate missing-file errors on the current artifact.
- Other scalar/comma-separated decimals and unknown commands must not cause default input-path checks.
- A genuinely absent Geometry Control File and absent Read GIS Z Shape candidates must each generate a single missing-file diagnostic with correct range and, for the current build, source TUFLOW Path Validator and code TPV001.
- Missing-file diagnostics offer Ignore this line and Ignore entire file Quick Fix actions.
- Diagnostics remain consistent on close/reopen; optional conditional formatting remains disabled by default and can be enabled without Helper registering a competing formatter.
- Each supported control extension and explicit association must retain effective language ID tuflow; Helper owns syntax, hover, completion, snippets and documentation; seito alone owns referenced file opening and Error Lens only decorates diagnostics.

## Limitations and follow-up

A Linux real Extension Host is not a Windows local-machine test. Manual TextMate rendering, seito file navigation, Error Lens display, Windows UNC model folders, GeoPackage layer reads and individually installed Marketplace file hashes remain unverified until examined separately. Windows compile checks must not be reported as Windows Extension Host tests. Helper features beyond PR #12 remain in draft and can fail their independent runner checks; do not misrepresent them as Validator numeric regressions.

For an affected installation reporting 0.2.6, collect the VS Code version, extension IDs/versions, actual installed folder or VSIX SHA-256 and inspect its compiled out/pathParsing.js for the command-aware classifier. After verification, a locally built VSIX can be installed for testing via Extensions: Install from VSIX (followed by reload). An ordinary Marketplace update to version 0.2.6 is not proof of receiving the October fix. No publication or version bump is requested.

Retain filename-version and scenario/event-token checks; missing concrete input paths are still errors even inside conditionals; unresolved runtime tokens remain unevaluated. Do not introduce GeoPackage PR #9 machinery, model-wide parameters, release selection, model runs or QGIS integration. Source classifier test ownership stays with Agent A; packaged end-to-end checks belong here. Repeat evidence on integrated A/B heads when available. Keep issue #10 open unless the full source/artifact question is resolved. This work is draft-only: no merge, publish, release or auth change.

## Verified real Extension Host evidence — 2026-11-22

Passed reference workflow: https://github.com/Chain-Frost/tuflow_validator/actions/runs/45039219599 (artifact: issue10-vsix-host-evidence-linux). It used actual VS Code **1.147.0** on Ubuntu Linux, not a mocked extension host.

| Artifact or component | Exact identity | Verification |
| --- | --- | --- |
| Source-built Validator VSIX, this specific run | Chain-Frost.tuflow-path-validator 0.2.6, SHA-256 71cb1419754112a372c0b8ac381f3f08fb1c41053192904128ef6585e540e36e | Passed numeric, missing-input, code/range, Quick Fix, opt-in formatter and lifecycle probes |
| Source-built compiled parser | SHA-256 72a2ae643678a1249a0c43b52ecf6d537004a872c5ceeb0f7603b2a77986e69a | Byte-identical to compiled source |
| Public GitHub v0.2.6 VSIX | SHA-256 1b5f9803d2bdf306fc8f2a2b2d7da02dd06b8840a8ccb87e2988d19214555162 | Failed numeric: false File not found on 0.2, 0.1, as expected for negative control |
| Public GitHub v0.2.6 compiled parser | SHA-256 120edb1b34012b3dda099b3781ac3f6efddece5cdbaea650db538b8ccddf2933 | Legacy heuristic; no command-aware allowlist |
| Helper draft PR #12 | lmillard79.tuflow-helper 0.8.2, 8a3411f528e33e7f227d72ca8b5ad41172fefdb4 | Language registration and basic command completion passed; four broader Helper acceptance failures remain |
| Other companions | Fr43nk.seito-openfile 2.3.3; usernamehw.errorlens 3.30.0 | Installed/activated in real host; UI file-open and decoration behaviour not manually tested |

Actual ZIP hashes may change across separate builds with identical compiled JS because packaging includes metadata; record both the individual archive SHA and compiled parser SHA per run. Both old and corrected artifacts declare the same 0.2.6 version.

**Scoped issue #10 statuses:** Validator-only current PASS; published release-only EXPECTED FAILURE (negative control); Helper-only PASS for absence of Validator diagnostics; both PASS; both with explicit associations PASS; both plus seito/Error Lens PASS for scoped checks. In all profiles, supported .tcf/.tgc/.tbc/.ecf/.tef/.trd/.qcf files had effective languageId tuflow, including an already-open TCF on host startup. Close/reopen retained one missing-input diagnostic without duplication. Missing TCF, missing GIS candidates and a missing Read File target under If Scenario all had one current TPV001 from TUFLOW Path Validator with correct operand range. Quick Fix titles included Ignore this line and Ignore entire file. Scalar, comma-separated viscosity and unknown-command false positives were absent in the current artifact.

**Formatting:** With enableIfStatementFormatting=false, formatting provided no edits; after enabling, one edit was observed on deliberately misindented control text. Other tested settings: diagnosticLevel=hint, enableLatestVersionChecks=true, enableIfStatementChecks=true. Explicit-associations profile assigned the seven control extensions to tuflow.

**Independent Helper acceptance FAILURES:** multiword-command-hover (empty), no-cross-file-command-leakage (TGC command in TEF completion), no-generic-completions-in-comment and no-universal-gis-values. These four failed in Helper-only and combined profiles, and were reported to Helper PRs #12 and #16. They prevent a claim that all Helper services pass, despite the scoped Validator co-installation checks passing.

**Untested or blocked:** manual seito-openfile cursor navigation, Error Lens visual rendering, TextMate theme/scopes, user's actual installed/Marketplace compiled bytes, Windows Extension Host and SMB/UNC. Windows source compilation and JS syntax checks passed, but are not Windows Extension Host proof.

## A/B integration snapshot recheck

The workflow also checks out B draft PR #21 on A2 PR #17 on A1 PR #14 as a separate read-only job, builds its exact source and compares packaged JS with its own compiled output, then reruns the same installed-artifact profiles. The audit accepts either the original command-aware allowlist or Agent A's getInputFileRole metadata. Each run records the actual stacked commit. An in-progress B draft snapshot is not final integration sign-off. No branch is merged or changed by this check.

### Completed stacked A/B snapshot — 2026-11-22

Successful three-job workflow: https://github.com/Chain-Frost/tuflow_validator/actions/runs/45039573478 . The A1/A2/B source was **B commit d0565bcb42e3d517ae59db0361e05a58e4ae0e60**, explicitly checked out from draft PR #21; no branch was merged. Generated integrated VSIX SHA-256 `9200bf8608f0c5460f37322916d271cf853a23b205362bd6e762362de53e86a5`; packaged role-based parser SHA-256 `2bdd6d554228a074ea0e0cd96afb62bcaffb8e5c56d63cea12c3d7e9647efc46`, identical to compiled integrated source; packaged diagnostics SHA-256 `3f287c3d79e62345406b34dcbfc4c436edbae3da978fd166ff8e2fcc30bfc6f1`.

**All six issue #10 profiles PASSED** on VS Code 1.147.0: integrated Validator alone, historical GitHub release negative control, Helper alone, integrated Validator+Helper, both with explicit file associations, and all four companions installed/activated. The historical release still reproducibly fails viscosity as expected. Four concrete missing input candidates (including a missing Read File under If Scenario) had precise TPV001 ranges/source in integrated profiles; numeric and unknown false positives were absent; Quick Fix and enabled conditional formatting passed; close/reopen stayed stable. The Helper runner's separate four editor-service failures persisted unchanged.

An earlier integrated A/B snapshot `869ead9d5688206615827ef986276b7dc96a3ca9` passed the five profiles that could run but its full companion installation was blocked by Marketplace HTTP 503. The successful d0565bc run supersedes that environment blocker. A newer B commit `504cde07893641e79b5ebac0f1ecc84060ce6713` modified only `src/test/suite/freshness.test.ts` after the successful run (no runtime file changed); do not treat the older snapshot as acceptance for every future B change. B remains draft.

**Outcome:** issue #10's reported numeric false positive is conclusively an August-release/compiled-artifact issue, not a defect in tested current or stacked Validator runtime. However individual user's installed bytes/Marketplace package identity, actual seito navigation/visual decorations and Windows Extension Host remain untested. Issue #10 remains open; no source fix, merge, publishing or version change authorised.
