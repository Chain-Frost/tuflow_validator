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
