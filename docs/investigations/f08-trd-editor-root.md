# F08: included TRD opened as an independent editor root

> Investigation only. No production behavior, release, publishing, scenario/event selection, GeoPackage processing, or model-wide parameter handling is changed.

## Evidence baseline

- Repository: https://github.com/Chain-Frost/tuflow_validator
- Default branch: `main` at `4a0282e93b979345374076fb0adc60c7faf6af99` (2026-10-12 UTC).
- Package version: `0.2.6` on main. The version string alone **does not** identify installed code.
- Published `v0.2.6` VSIX released on 2026-08-27, SHA-256 `1b5f9803d2bdf306fc8f2a2b2d7da02dd06b8840a8ccb87e2988d19214555162`, predates merged PR #6. It has **not** been tested in this investigation.
- Previously merged dependency work: PR #6 (merge commit `99c9ec50f19ea6e2e03949f4316e977170308666`), included in baseline main. A later Agent B head must be verified separately and not assumed merged.
- The observational probe `src/test/suite/zz_f08_investigation.test.ts` prints `F08_ENV`, `F08_SNAPSHOT`, and `F08_RESULT` from the actual VS Code source-development host. It does **not** install a VSIX; its results must not be called installed-artifact proof.

## Source mechanism (hypothesis, not runtime proof)

1. `extension.ts` handles `onDidOpenTextDocument` by calling `updateDiagnostics(doc, collection)` on every TUFLOW document, including an included TRD.
2. `diagnostics.ts` adds every opened document's URI as an independent analysis root. `analyzeRootDocument()` passes no source TCF directory.
3. `analyzeFile()` uses the original TCF directory for TRD paths when provided by recursion; without that context it falls back to the TRD's own directory.
4. `rebuildMergedDiagnostics()` merges the independent root and known-parent results by diagnostic target URI and fingerprint. The public diagnostic `source` is `TUFLOW Path Validator`, not a TCF-root identifier.
5. Opening the TRD could therefore introduce a spurious `TPV001` on the TRD itself for a TCF-relative input which exists, while real missing inputs remain valid.

## Minimal deterministic fixture

The test creates a temporary, disposable fixture on each platform:

```text
f08/
  a/runs/A.tcf             Set Variable LOCAL_SHAPE == assets\only_a.shp
                           Read File == ..\..\shared\terrain.trd
  b/runs/B.tcf             Set Variable LOCAL_SHAPE == assets\missing_b.shp
                           Read File == ..\..\shared\terrain.trd
  a/runs/assets/           present.shp, edited_present.shp, only_a.shp
  b/runs/assets/           present.shp, edited_present.shp
  shared/terrain.trd
  shared/nested.trd
```

`shared/terrain.trd` reads `assets\present.shp` (exists relative to either source TCF, absent relative to TRD), the statically expanded `<<LOCAL_SHAPE>>` (exists under A; truly missing under B), `assets\missing.shp` (truly missing under both), and nested `shared/nested.trd`. It also includes a genuinely missing `assets\conditional_missing.shp` inside `If Scenario == F08`, and a deliberately unresolved `assets\<<~s1~>>.shp`. `shared/nested.trd` references `assets\present.shp`.

Empty `.shp` files are physical-file existence sentinels; this investigation deliberately does not read GIS contents.

## Test matrix / stages

| Stage | Editor event and expected distinction |
|---|---|
| 01 | TCF A only: present reference and A's static variable resolve, real missing/conditional missing remain |
| 02 | Open included TRD while A stays open: look for an additional `TPV001` on present input |
| 03 | Dirty TRD buffer changes present to edited_present (still exists under both TCFs) |
| 04 | Save TRD: compare diagnoses and document content used |
| 05–06 | Open and close nested TRD; check parent diagnostics stay correct |
| 07 | Close TRD while A remains: extra orphan-root errors should vanish, true missing should stay |
| 08 | Open TCF B with different static variable/directory; B's variable target truly is missing |
| 09 | Open same TRD with both TCFs; preserve both contexts |
| 10 | Close B: B-only variable missing must disappear; A and real missing results stay |
| 11 | Close A while TRD remains: no known parent, so do not infer a source TCF |
| 12 | Close all and reopen TRD alone: distinguish missing context from a known missing file |

Each snapshot reports VS Code diagnostic URI, source, code, message, severity and line, open documents, and absolute candidate resolutions/existence for A, B and orphan TRD. The source/VSIX hash and OS must be recorded from the exact run; do not extrapolate synthetic or Linux tests to Windows filesystem results.

## Decision and bounded follow-up

**Confirm F08 only** if opening the included TRD creates a missing-file diagnostic for an input which concretely exists from the known source TCF directory, and the same diagnostic was absent with only the parent open. Record the triggering sequence and absolute wrong/correct paths. If that does not occur, report 'not reproduced' with environment and revision.

With no inspected parent, the extension cannot know the source TCF directory or inherited variables. With two known parents, it has two explicit contexts and must preserve both rather than arbitrarily selecting one. The generic VS Code Problems entry does not expose root ownership; parent `TPV002` summaries can help identify which analysis contributed a problem.

Do not suppress truly missing inputs (including in conditional branches) or guess scenario/event values. Runtime `<<~s1~>>` remains unresolved. Do not alter filename-version, scenario/event-token or version-token checks. A separate implementation proposal, only after confirmation and any later Agent B final head, may consider explicit root-owned diagnostics and refraining from speculative TRD-root existence checks when TCF context is absent.

### Proposed regression outline, not yet implemented

Convert the observational probe to assertions covering: parent-only, TRD open/edit/save/close, orphan TRD, two parent roots and differing static variables, nested TRDs, dirty child buffers, real missing and conditional missing, unresolved runtime values, closing one parent, and existing version/token checks. Keep context-dependent checks separate from context-free syntax checks.

## Execution status

Source-level risk observed on main; actual runtime observations and any later Agent B head comparison must be appended here before concluding that the defect is confirmed. Probe results are non-prescriptive and should not be merged into main as a permanent expectation of current behavior.
