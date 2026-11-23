# TUFLOW Path Validator

Lightweight VS Code extension that validates file paths referenced in TUFLOW control files and surfaces missing references as diagnostics in the Problems panel.

## Features
- Validates input-file paths in recognised TUFLOW commands and reports missing files in the Problems view. Output locations, runtime conditions, variable declarations and unknown commands are not treated as input-file references.
- Resolves relative paths from the current file, except paths in nested TRD files which resolve from their source TCF directory; honors `|`-separated lists and ignores GeoPackage selectors after `>>`.
- Skips tokens and macros that remain unresolved (any `<<...>>` sequence) while still analyzing other paths.
- Recursively validates actual control-command text referenced by control-file commands and inline `Read File` includes (including `.erd`, `.rdf`, `.adcf` and arbitrary text suffixes), and summarizes nested issues. Data files are checked for physical existence but not parsed as commands.
- Warns when scenario/event tokens `<<~s1~>>`-`<<~s9~>>` or `<<~e1~>>`-`<<~e9~>>` appear in a value but are missing from the filename.
- When a versioned TCF/TGC/TBC/ECF is the latest in its folder, referenced files with numeric versions (e.g., `v07`, `011`, `Model12`) are checked for newer alternatives or ambiguous updates.
- Validates `Set Variable Version` tokens against the current filename and surfaces whether the token matches (info) or is missing (warning).
- Validates `If Event ==` / `If Scenario ==`, `Define Event`, and `Start 1D/2D Domain` blocks with matching `End` statements (case-insensitive).
- Configurable minimum diagnostic severity (default: `hint`) and focus on path validation rather than a full TUFLOW grammar.
- **Quick Fixes** help add ignore comments for a specific line or the entire file when issues should be suppressed, and offer to update versioned references when a `Set Variable Version` header is present in a `.tcf`.

## Documented command inputs

Path validation uses a command-aware allowlist. Each recognised input is classified as a data file, a referenced control file or an inline `Read File` include. See [the official-source command audit](docs/input-commands.md) for the AD and SWMM additions and scope limits.

## Supported control files
- `.tcf`
- `.tgc`
- `.tbc`
- `.trd`
- `.erd`
- `.rdf`
- `.adcf`
- `.tef`
- `.ecf`
- `.qcf`
- `.tesf`
- `.tscf`
- `.trfc`
- `.toc`

## Installation

### Marketplace
1. Open Extensions (Ctrl+Shift+X).
2. Search for "TUFLOW Path Validator".
3. Click **Install**.

### Manual
1. Download the `.vsix` from a release.
2. Go to Extensions → **...** → *Install from VSIX*.

## Usage
Open any supported control file and diagnostics appear automatically as you edit. Example:

```tuflow
Read GIS Z Shape == gis/terrain.gpkg >> contours
Read GIS BC == missing/bc_01.shp | bc/valid_02.shp
```

Activation note: the extension activates when a supported file is opened with the TUFLOW language, or when a workspace contains a supported control file. Files opened outside a workspace can be validated.

## Refresh diagnostics when remote notifications fail

If a TUFLOW control file is opened directly from a mapped/UNC network share **without opening that folder as a VS Code workspace**, some Windows/SMB configurations do not deliver filesystem change events. The Problems panel may then retain an outdated result after a file is created, renamed, deleted or changed on disk.

- Prefer **File → Open Folder** for the relevant model/scratch folder. Network change notifications passed the independent Windows acceptance tests when the share was opened as a workspace.
- When a folder cannot be opened, run **TUFLOW Path Validator: Refresh Path Diagnostics** from the Command Palette (`Ctrl+Shift+P`). This rescans the open control-file roots and their dependencies using current dirty editor buffers, without saving files, changing settings or running TUFLOW. Repeat it after external file changes.

**This is an explicit recovery action, not a replacement for automatic notifications.** It does not enable background polling or guarantee that remote filesystem watchers work without a workspace. See [the tracked remote-watcher limitation](https://github.com/Chain-Frost/tuflow_validator/issues/23) and the [independent network evidence](https://github.com/Chain-Frost/tuflow_validator/blob/3600377d823562bbe3aebd6abdfd58407798f12e/docs/acceptance/windows-network-2026-11-23/README.txt). No GeoPackage database contents are accessed.

## Ignoring issues
Use comments to suppress diagnostics when needed.
- **Ignore a specific line**: append `! tpv-ignore`.
  ```tuflow
  Read GIS Z Shape == missing_file.shp ! tpv-ignore
  ```
- **Ignore an entire file**: add `! tpv-ignore-file` anywhere in the file (commonly at the top).
  ```tuflow
  ! tpv-ignore-file
  Read GIS Z Shape == missing_file.shp
  ```

## Quick Fixes
Click a diagnostic to see Quick Fixes that automatically insert `! tpv-ignore` or `! tpv-ignore-file` comments so you do not need to edit the file manually.
- **Update to latest version (TUFLOW)**: When a newer file in the same recognised series exists, the Quick Fix replaces the referenced filename with the verified target, preserving the directory. No update is offered if the target cannot be verified.

## Settings
- `tuflowValidator.diagnosticLevel`: `error`, `warning`, `info`, `hint` (default), or `none`.
- `tuflowValidator.enableLatestVersionChecks`: Enable latest-version checks for versioned filenames (default: `true`).
- `tuflowValidator.enableIfStatementChecks`: Validate `If Event ==` / `If Scenario ==`, `Define Event`, and `Start 1D/2D Domain` blocks with matching `End` statements (default: `true`).
- `tuflowValidator.enableIfStatementFormatting`: Format `If`/`Else`/`End If` indentation with tab-based nesting (default: `false`).

## If statement formatting
When enabled, `Format Document` aligns `If Event ==` / `If Scenario ==`, `Define Event`, and `Start 1D/2D Domain` blocks so that:
- Lines inside a block are indented by one tab per nesting level.
- `Else`, `Else If`, and `End If` align with the matching `If`.
Recognized forms are `If Event ==`, `If Scenario ==`, `Else If Event ==`, `Else If Scenario ==`, `End If`, `Define Event`, `End Define`, `Start 1D Domain`, `End 1D Domain`, `Start 2D Domain`, and `End 2D Domain`.

## Latest TCF behavior
Latest-version checks run only for the "latest" TCFs in the folder of the currently open TCF. The extension does not scan the full workspace for TCFs. A TCF is considered latest when it is either:

1. The highest-numbered file in a versioned series (files containing a number contribute to a versioned series).
2. An unversioned file (no number) that stands on its own.

Multiple latest TCFs can coexist in a folder when different series or unversioned files are present.

Example:
```tuflow
file.tcf       # latest (no version token)
file_01.tcf
file02.tcf     # latest (highest in its series)
king05.tcf
king08.tcf     # latest (highest in its series)
```

## Limitations and non-goals
- Macros and variables like `<<OutputRoot>>` or `<<~s1~>>` are ignored if they cannot be resolved.
- An arbitrary-suffix inline `Read File` is discovered from its parent, not treated as a standalone validation root. Dirty `plaintext` buffers of those includes are used.
- This extension does not implement a full TUFLOW grammar; it focuses on file-path validation.
- Unrecognised commands are not assumed to consume files. Input-path validation is intentionally conservative to avoid false errors.
- It does not validate dataset contents, layer names, or runtime options.

## Development
```bash
npm run compile
npm run test:container
npm run package:vsix
```
