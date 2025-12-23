# TUFLOW Path Validator

Lightweight VS Code extension that validates file paths referenced in TUFLOW control files and reports issues in the Problems panel.

## Features
- Missing file diagnostics for `Command == Value` lines that look like paths.
- Resolves relative paths from the current file and supports multiple paths separated by `|`.
- Ignores GeoPackage layer selectors after `>>` (e.g. `file.gpkg >> layer1 && layer2`).
- Skips unresolved tokens/macros that contain `<<...>>`.
- Recursively checks referenced control files and summarizes nested issues.
- Warns when scenario/event tokens `<<~s1~>>`-`<<~s9~>>` or `<<~e1~>>`-`<<~e9~>>` listed anywhere in a TCF value are missing from the filename.
- When a versioned TCF/TGC/TBC/ECF is the latest in its folder, referenced files with numeric versions (e.g. `v07`, `011`, `Model12`) are checked for latest versions (warns when newness is ambiguous or a newer version exists). Latest control files are determined per folder and must be referenced by a latest TCF.
- Checks `Set Variable Version` tokens against the current filename (info when present, warning when missing).
- Configurable minimum diagnostic severity (default: `hint`).

## Supported control files (recursive)
- `.tcf`
- `.tgc`
- `.tbc`
- `.trd`
- `.tef`
- `.ecf`
- `.qcf`

## Installation
Marketplace:
1. Open Extensions (Ctrl+Shift+X).
2. Search for "TUFLOW Path Validator".
3. Click Install.

Manual:
1. Download the `.vsix` from a release.
2. Extensions → "..." → Install from VSIX.

## Usage
Open any supported control file. Diagnostics appear automatically as you edit. Example:

```tuflow
Read GIS Z Shape == gis/terrain.gpkg >> contours
Read GIS BC == missing/bc_01.shp | bc/valid_02.shp
```

## Settings
- `tuflowValidator.diagnosticLevel`: `error`, `warning`, `info`, `hint` (default), or `none`.
- `tuflowValidator.enableLatestVersionChecks`: Enable latest-version checks for versioned filenames (default: `true`).

## Limitations and non-goals
- Macros and variables like `<<OutputRoot>>` or `<<~s1~>>` are ignored.
- This does not implement a full TUFLOW grammar; it only validates file paths.
- Dataset contents, layer names, and runtime options are not validated.

## Development
```bash
npm run compile
npm run test:container
npm run package:vsix
```
