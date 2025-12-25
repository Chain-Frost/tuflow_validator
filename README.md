# TUFLOW Path Validator

Lightweight VS Code extension that validates file paths referenced in TUFLOW control files and surfaces missing references as diagnostics in the Problems panel.

## Features
- Validates file paths on `Command == Value` lines and reports missing files in the Problems view.
- Resolves relative paths from the current file, honors `|`-separated lists, and ignores GeoPackage selectors after `>>`.
- Skips tokens and macros that remain unresolved (any `<<...>>` sequence) while still analyzing other paths.
- Recursively checks referenced control files and summarizes issues discovered in nested dependencies.
- Warns when scenario/event tokens `<<~s1~>>`-`<<~s9~>>` or `<<~e1~>>`-`<<~e9~>>` appear in a value but are missing from the filename.
- When a versioned TCF/TGC/TBC/ECF is the latest in its folder, referenced files with numeric versions (e.g., `v07`, `011`, `Model12`) are checked for newer alternatives or ambiguous updates.
- Validates `Set Variable Version` tokens against the current filename and surfaces whether the token matches (info) or is missing (warning).
- Validates `If Event ==` / `If Scenario ==`, `Define Event`, and `Start 1D/2D Domain` blocks with matching `End` statements (case-insensitive).
- Configurable minimum diagnostic severity (default: `hint`) and focus on path validation rather than a full TUFLOW grammar.
- **Quick Fixes** help add ignore comments for a specific line or the entire file when issues should be suppressed, and offer to update versioned references when a `Set Variable Version` header is present in a `.tcf`.

## Supported control files
- `.tcf`
- `.tgc`
- `.tbc`
- `.trd`
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

Activation note: the extension activates only when a workspace contains at least one supported control file.

## Ignoring issues
Use comments to suppress diagnostics when needed.
- **Ignore a specific line**: append `! tpf-ignore`.
  ```tuflow
  Read GIS Z Shape == missing_file.shp ! tpf-ignore
  ```
- **Ignore an entire file**: add `! tpf-ignore-file` anywhere in the file (commonly at the top).
  ```tuflow
  ! tpf-ignore-file
  Read GIS Z Shape == missing_file.shp
  ```

## Quick Fixes
Click a diagnostic to see Quick Fixes that automatically insert `! tpf-ignore` or `! tpf-ignore-file` comments so you do not need to edit the file manually.
- **Update to latest version (TUFLOW)**: When the diagnostic says the referenced file is not the latest version, the Quick Fix replaces the numeric token with the latest version.

## Settings
- `tuflowValidator.diagnosticLevel`: `error`, `warning`, `info`, `hint` (default), or `none`.
- `tuflowValidator.enableLatestVersionChecks`: Enable latest-version checks for versioned filenames (default: `true`).
- `tuflowValidator.enableIfStatementChecks`: Validate `If Event ==` / `If Scenario ==`, `Define Event`, and `Start 1D/2D Domain` blocks with matching `End` statements (default: `true`).
- `tuflowValidator.enableIfStatementFormatting`: Format `If`/`Else`/`End If` indentation with tab-based nesting (default: `false`).
- `tuflowValidator.analyzeAllControlFiles`: Analyze all supported control files in the workspace (default: `false`).

## If statement formatting
When enabled, `Format Document` aligns `If Event ==` / `If Scenario ==`, `Define Event`, and `Start 1D/2D Domain` blocks so that:
- Lines inside a block are indented by one tab per nesting level.
- `Else`, `Else If`, and `End If` align with the matching `If`.
Recognized forms are `If Event ==`, `If Scenario ==`, `Else If Event ==`, `Else If Scenario ==`, `End If`, `Define Event`, `End Define`, `Start 1D Domain`, `End 1D Domain`, `Start 2D Domain`, and `End 2D Domain`.

## Latest TCF behavior
Latest-version checks run only for the "latest" TCFs in each folder. A TCF is considered latest when it is either:

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
- This extension does not implement a full TUFLOW grammar; it focuses on file-path validation.
- It does not validate dataset contents, layer names, or runtime options.

## Development
```bash
npm run compile
npm run test:container
npm run package:vsix
```
