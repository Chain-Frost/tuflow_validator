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

## Reproduction evidence — confirmed on Linux and Windows

The **second**, corrected observational run passed all 48 VS Code integration tests per platform; the test does not assert the existence of the bug as intended behavior. Evidence: [run 45038542684](https://github.com/Chain-Frost/tuflow_validator/actions/runs/45038542684), [Linux job 137257619181](https://github.com/Chain-Frost/tuflow_validator/actions/runs/45038542684/job/137257619181), [Windows job 137257619448](https://github.com/Chain-Frost/tuflow_validator/actions/runs/45038542684/job/137257619448).

- Tested PR head/source changes: `ec66615bc0f3f92a6eec23286db04a46f6250e3e` (test/doc/workflow changes only); underlying **unchanged production** `main`: `4a0282e93b979345374076fb0adc60c7faf6af99`.
- GitHub's generated PR merge ref in the test host was `7001f69b19dbfc7ad01f37b92add9d27654d96bf`, **not** the PR head SHA. This distinction is recorded explicitly.
- Linux x64 / Windows x64, VS Code `1.147.0`, extension-host Node `v24.22.1`; runner Node `22`. Extension package version `0.2.6`. **No VSIX was installed or tested** in either run. The older published VSIX/tag are identified above and must not be conflated with this source.
- The first run [45038314220](https://github.com/Chain-Frost/tuflow_validator/actions/runs/45038314220) already reproduced F08 opening/edit/save on both OS, but its probe stopped at tab-closing checks: Linux retained closed documents and Windows canonicalized temporary-file paths. The corrected probe does not mistake those harness assumptions for a failure of path detection.

| Stage(s) | Identical observed behavior in Linux and Windows |
|---|---|
| 01 | Only A.tcf visible: child TRD has two **valid** `TPV001`s for `assets\missing.shp` and `assets\conditional_missing.shp`; A.tcf has one `TPV002` summary of two child issues. No missing diagnostic for present path. |
| 02 | Opening `shared/terrain.trd` adds false `TPV001` on `assets\present.shp` and false `TPV001` on the physically existing `..\..\shared\nested.trd`. The root A `TPV002` remains two genuine child issues, proving the new diagnostics come from additional TRD-root analysis. |
| 03–04 | Dirty-buffer edit to `assets\edited_present.shp` changes the false error, and saving leaves it in place. Both TCF A/B have that asset; TRD directory does not. |
| 05–06 | Opening nested.trd creates false `TPV001` for `assets\present.shp` on the nested file. Closing its tab does **not** immediately remove it. |
| 07 | Closing the main TRD tab leaves false `TPV001` visible. The tab was absent, but VS Code retained the text document, and no `onDidCloseTextDocument` callback fired. |
| 08–09 | Opening B.tcf adds a **genuine** variable-context-specific missing `TPV001` for `<<LOCAL_SHAPE>>` (B's `assets\missing_b.shp`), while A's `assets\only_a.shp` exists. Both parent `TPV002` summaries remain distinct (A=2, B=3). Shared TRD's separately opened speculative errors remain. |
| 10–12 | Closing B's tab, then A's tab, then all tabs retains their loaded documents and their diagnostics in this test host. `onDidCloseTextDocument` remained unfired. A's correct results remain, but B's additional missing-variable result also persists despite its tab being closed. This is a **lifecycle/ownership observation**, not proof that VS Code dispatched a document-close event that the extension ignored. |
| 13 | Fresh TRD opened in a separately generated model with no inspected parent reports the relative assets and include as missing from its own directory. With no known parent it has no source TCF directory or inherited variables; these errors are speculative rather than proof that inputs are genuinely absent from a TUFLOW model. |

### Exact resolved paths, observed in the dirty-buffer state

Linux fixture:

```text
CORRECT A: /tmp/tpv-f08-xM1ZBS/a/runs/assets/edited_present.shp    exists=true
CORRECT B: /tmp/tpv-f08-xM1ZBS/b/runs/assets/edited_present.shp    exists=true
WRONG TRD: /tmp/tpv-f08-xM1ZBS/shared/assets/edited_present.shp  exists=false
TPV001 on shared/terrain.trd, line 1: File not found: assets\edited_present.shp
```

Windows fixture:

```text
CORRECT A: C:\Users\RUNNER~1\AppData\Local\Temp\tpv-f08-6r8pVh\a\runs\assets\edited_present.shp    exists=true
CORRECT B: C:\Users\RUNNER~1\AppData\Local\Temp\tpv-f08-6r8pVh\b\runs\assets\edited_present.shp    exists=true
WRONG TRD: C:\Users\RUNNER~1\AppData\Local\Temp\tpv-f08-6r8pVh\shared\assets\edited_present.shp  exists=false
TPV001 on shared/terrain.trd, line 1: File not found: assets\edited_present.shp
```

These are actual Windows filesystem checks, not emulated `path.win32` transformations. Runtime `<<~s1~>>` remained unresolved without a missing-file error; the true missing input inside an `If Scenario` block remained a missing-file error.

### Minimal proposed context and diagnostic-ownership rule — **not implemented**

- An explicitly opened TRD is **not** an independent source TCF. For relative TRD inputs and nested control-file references, only perform filesystem-missing checks inside each **known TCF-root context**, using its source TCF directory and statically known variables. Do not substitute the TRD directory when TCF context is absent.
- With no parent known, preserve context-independent checks; an actual absolute input with a concrete target may still be existence-checked, including inside a conditional block. Do not invent a parent root or silently reclassify an actually missing concrete file as unknown.
- With multiple known parents, retain each root's independent diagnostics and variable context; merge for the Problems view without adopting any arbitrary parent as the TRD's own context. Existing per-root diagnostic maps already provide a starting point.
- Define diagnostic ownership/lifetime explicitly. A closed editor **tab** and a disposed VS Code **TextDocument** differed in both test hosts; the current extension listens only for document close. Determine whether tab closure should retire an inspected root without breaking revalidation of live parent roots. This should be tested, not assumed.
- Preserve filename versioning, filename/scenario/event-token checks, real `TPV001` errors (including conditional branches), and unresolved runtime placeholders. Do not depend on PR #9.

### Separate implementation scope — **deferred until Agent B final revision**

1. Obtain Agent B's **actual final head SHA** after dependency/root changes, identify whether it has landed on main or is a stacked branch, and rerun this fixture/test matrix on that exact code. Current main already contains older merged PR #6; no later Agent B final revision was available for this report.
2. If F08 remains, implement only explicit TRD-relative path context and root-owned diagnostic publication/retirement. Do not add workspace root scanning, scenario/event guesswork, UI, full TUFLOW execution, or GeoPackage reading.
3. Convert the observational probe into stable positive/negative acceptance tests. Cover the exact 13 stages, Windows filesystem behavior, true missing paths in conditional blocks, multi-root variable differences, nested TRDs, dirty buffers, absolute-path references and loaded-document versus visible-tab lifecycle.
4. Run unit, Linux and Windows VS Code integration tests and regression checks for existing filename-version and token rules. Compare actual installed-VSIX behavior if a VSIX is separately built/identified; record its hash rather than using the shared `0.2.6` version string.
5. Open a **separate implementation PR after B** only if reproduction persists. Do not merge this investigation draft as a behavioral regression test of incorrect output.
## Status and remaining gate

**F08 is confirmed in real VS Code source-development hosts on Linux and Windows.** The only remaining gate before implementation is a fresh comparison against Agent B's final dependency/root changes, plus installed-VSIX reproduction if installed behavior is in question. No production code was modified.
