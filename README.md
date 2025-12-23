# TUFLOW Path Validator

Lightweight VS Code extension that validates file paths referenced in TUFLOW control files and reports issues in the Problems panel.

## Features
- Missing file diagnostics for `Command == Value` lines.
- Handles multiple paths separated by `|`.
- Ignores GeoPackage layer selectors after `>>` (e.g. `file.gpkg >> layer1 && layer2`).
- Recursively checks referenced control files and summarizes nested issues.
- Flags missing filename tokens required by `XF Files Include in Filename`.
- Checks `Set Variable Version` tokens against the current filename.
- Configurable minimum diagnostic severity.

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
- `tuflowValidator.diagnosticLevel`: `error`, `warning`, `info`, `hint`, or `none`.

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
