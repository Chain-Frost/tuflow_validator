# Issue #10 — preserved evidence and deployment-acceptance ledger

Prepared 23 November 2026 against main `78050053c5330bd51f49fea536c6f6f7524080e4`. This is evidence/test preparation, **not** release, publication, or final issue acceptance. Tracking: [#10](https://github.com/Chain-Frost/tuflow_validator/issues/10); original [PR #19](https://github.com/Chain-Frost/tuflow_validator/pull/19) was closed unmerged.

## Established diagnosis

* Legacy GitHub release/Marketplace `Chain-Frost.tuflow-path-validator@0.2.6` contains compiled `out/pathParsing.js` SHA-256 `120edb1b34012b3dda099b3781ac3f6efddece5cdbaea650db538b8ccddf2933`; it reproduces the numeric viscosity false positive.
* The command-aware classifier was first introduced in source commit `2e0f531c692b5e0943c8c3b76a6b69b394b986af` (12 October 2026). Corrected source and historical source-built VSIXs also display `0.2.6`. **Version text alone cannot demonstrate correction.**
* Current main still declares `0.2.6` while requiring `engines.vscode: ^1.74.0`; the corresponding API typings are pinned to 1.74. Merged #29's maintained compatibility testing is not proof that a corrected Marketplace release exists.
* Source investigation: [immutable report at PR #19 head](https://github.com/Chain-Frost/tuflow_validator/blob/dd7c5e83abdc997766bc5fd3bb92e7459f2db2d/docs/issue10-artifact-investigation.md). [Local Windows acceptance](https://github.com/Chain-Frost/tuflow_validator/pull/19#issuecomment-7088276011) identified the affected normal installation as legacy. The normal installation was not changed.

## Historical Actions evidence — downloaded and preserved

Original run [45041472180](https://github.com/Chain-Frost/tuflow_validator/actions/runs/45041472180), PR #19 source `dd7c5e83abdc997766bc5fd3bb92e7459f2db2d2`. Three archives were downloaded on 23 November 2026, their actual bytes independently SHA-256 checked against GitHub's artifact metadata, and 18 inner JSON files per archive inventoried (54 files total).

| GitHub artifact ID | Original archive name | SHA-256 of original ZIP | GitHub expiry (UTC) |
| --- | --- | --- | --- |
| `14762305075` | `issue10-vsix-host-evidence-linux` | `a1a730e1f3a568b0e337f7771115f8432870a71f17465036a40d1b29d8db7a93` | 2026-12-22 16:06:41 |
| `14761997790` | `issue10-vsix-host-evidence-windows` | `03fd25322123de93d3158826d2cc3a301cbe638705a9dd6c8fef1a16c0b98538` | 2026-12-22 16:07:05 |
| `14761408482` | `issue10-integrated-ab-evidence-linux` | `48e71f6c0bb0bd5b4a7a4eb1a04a526ee1a4a6c5e71889ff96bf0a56bdbc9396` | 2026-12-22 16:06:48 |

These dates correspond to approximately 00:06–00:07 Australia/Perth on **23 December 2026**. The bytes are bundled without altering the original ZIPs; the bundle has SHA-256 `8ebca18a86263e90911c2019465715b2368b10fdbcc0874a3d60056a5ca93868` and contains `manifest.json` with per-file hashes. The retained owner-controlled **private ChatGPT Library** location is `/TUFLOW Path Validator/Issue 10 Evidence/2026-11-23/` (archive + standalone manifest). It is **not a public GitHub attachment**. A user-facing download copy was also provided.

The workstation's local-only report, screenshot and raw share-specific records are **not** included. They must not be described as uploaded evidence or made public without review. No private workstation profile was accessed in this preparation.

## Maintained regression and installed acceptance

* `src/test/suite/command_metadata.test.ts` already checks that viscosity/scalar/unknown commands do not request file lookup.
* The maintained `src/test/fixtures/correctness/path-commands.tcf` and `src/test/suite/correctness.test.ts` now explicitly include the reported `Viscosity Formulation == SMAGORINSKY`, `Viscosity Coefficients == 0.2, 0.1`, and a decimal-looking unknown command, while preserving the real missing `TPV001` input assertion and present-file check. This PR changes only fixture, regression, and documentation.
* `scripts/compatibility/probe/index.cjs` already tests an **installed** Validator: numeric viscosity negative, present input, missing control-file input, concrete conditional missing GIS input, unresolved token, shared language, code actions, and optional formatting, with a separately installed Helper profile.
* [Merged #29's compatibility run](https://github.com/Chain-Frost/tuflow_validator/actions/runs/45165798584) passed Windows/Linux × VS Code 1.74 and Stable with installed-source VSIX profiles. That result predates this PR and does **not** test a newer Marketplace payload.

New test additions need exact-head CI and independent Codex review before any merge; no local native VS Code host was available in the current execution environment.

## Release-to-installed provenance and closure gates

| Stage | Identity and required record | Status as of this preparation |
| --- | --- | --- |
| Current source | main `78050053c5330bd51f49fea536c6f6f7524080e4`, package `0.2.6`, engine `^1.74.0` | Known corrected source; not an approved release |
| Approved release candidate | Authorised reviewed release commit, immutable tag, package version, compiled module hashes | **Pending** separate #12/#30 approval |
| Release VSIX | Archive SHA-256, manifest ID/version, parser and diagnostics hashes, protected build provenance | **Pending** new release |
| Independently obtained Marketplace payload | Retrieval timestamp, publisher/version, manifest and compiled-file hashes; compare payload not merely ZIP container | **Pending** actual publication |
| Affected normal installation | Exact installed location, module hashes, language/settings and active extension, evidence fixture results | Historical legacy 0.2.6 identified; **new corrected installation pending** |
| First corrected published version | Recorded and communicated only after payload/install acceptance | **Unknown** |

### Prerequisite and safe scope

Publishing preparation is [#12](https://github.com/Chain-Frost/tuflow_validator/issues/12) / [#30](https://github.com/Chain-Frost/tuflow_validator/pull/30). Its configured GitHub protected `production` environment, Trusted Publishing policy, tag immutability, required review, successful CI and owner authorisation remain separate gates. Do not trigger a release, bump version, or change credentials under #10. Only Path Validator is in scope; do not publish the separate Helper.

After an authorised *new-version* Marketplace publication: independently download the Marketplace package; record hashes and compare against the approved release; update **only** Validator in the normal profile with permission; validate correct TUFLOW language and absence of suppression; prove no false viscosity/numeric diagnostic, present input valid, missing and conditional missing inputs report exactly one correct `TPV001`, and correct diagnostics after reload/reopen. Record the exact first fixed published version and update instructions.

Leave #10 open until both the Marketplace package and normal profile are verified. Separate Helper hover/completion issues, network watcher issues (#3), F13 model-wide validation, and GeoPackage content inspection (#9) are excluded.

