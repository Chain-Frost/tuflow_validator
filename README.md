# TUFLOW Path Validator

Lightweight VS Code extension that validates file paths referenced in TUFLOW control files and surfaces missing references as diagnostics in the Problems panel.

## Features
- Validates input-file paths in recognised TUFLOW commands and reports missing files in the Problems view. Output locations, runtime conditions, variable declarations and unknown commands are not treated as input-file references.
- Resolves relative paths from the current file, except paths in nested TRD files which resolve from their source TCF directory; honors `|`-separated lists.
- Optional read-only GeoPackage layer checks retain `>>` selectors, `&&` lists, implicit basename selection and conservative `Spatial Database` scope. Disabled by default pending representative Windows/network benchmarks.
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
- `tuflowValidator.enableGeoPackageLayerChecks`: Check GeoPackage layer names (default: `false`). See the supported syntax and limitations below.
- `tuflowValidator.enableIfStatementChecks`: Validate `If Event ==` / `If Scenario ==`, `Define Event`, and `Start 1D/2D Domain` blocks with matching `End` statements (default: `true`).
- `tuflowValidator.enableIfStatementFormatting`: Format `If`/`Else`/`End If` indentation with tab-based nesting (default: `false`).

## GeoPackage layer checks

Enable **TUFLOW Validator: Enable GeoPackage Layer Checks** in Settings, or add:

```json
"tuflowValidator.enableGeoPackageLayerChecks": true
```

The default remains **false**. With the option off, the existing path parser and
file diagnostics remain in use and no GeoPackage metadata is read. Changing the
setting revalidates open roots and their dependencies.

### Supported references

```tuflow
Read GIS Z Shape == gis/terrain.gpkg >> contours
Read GIS Z Shape == gis/terrain.gpkg
Read GIS Z Shape == gis/model.gpkg >> lines && points | gis/other.gpkg >> boundaries
Read GIS Z Shape == gis/model.gpkg >> USE ALL
Spatial Database == gis/model.gpkg
Read GIS Mat == mat_R
Read GIS Z Shape == lines && points
Spatial Database == TCF
Spatial Database == OFF
```

An omitted selector requests the **database basename** (`terrain` above), even
when the database has only one differently named layer. `&&` adds layers from
the same database, `|` separates inputs, and `USE ALL` requests the inventory.
There is no fallback to another layer. These rules follow the
[TUFLOW GeoPackage input documentation](https://docs.tuflow.com/classic-hpc/manual/2026.0/GISLayers-2.html#gpkg-input-commands).

Local database assignments override the inherited TCF default. `TCF` restores
that default; `OFF` clears the active database globally. `Read File` includes
share the caller's database scope. Separately referenced control files have
local scope, with nested TCFs establishing a new global context. Existing
source-TCF-relative TRD path rules are preserved. A control file opened alone
cannot supply its unseen parent TCF's database context.

Checks apply to recognised `Read GIS`, `Read Grid`, `Read GPKG`,
`GPKG Projection` and `Calibration Points GIS File` input commands. Registered
vector and raster layers are included; ordinary attribute tables are not.
Raster inputs with a vector clipping reference are supported. This checks name
existence, not whether a layer is suitable for a particular solver command.
Output and unknown commands are not inspected.
Commands prefixed with `1D` and includes with non-control-file extensions are
not interpreted as a complete additional domain; uninspectable includes make
subsequent database/variable context uncertain.

Layer identifiers use ASCII case-insensitive matching, consistent with SQLite
identifier comparison and the
[TUFLOW QGIS plugin's correction of case-sensitive GPKG inputs](https://docs.tuflow.com/qgis-tuflow-plugin/changelog/2026.0.x/#tuflow-plugin-2026011).
Unicode names are not otherwise case-normalised. Paired single or double quotes
around input atoms are accepted by this extension; this is not a guarantee that
every TUFLOW command/version accepts quoted control-file syntax.

### Runtime values and uncertain context

```tuflow
Read GIS Z Shape == gis/model.gpkg >> fixed_layer && layer_<<~s1~>>
```

Here, the file and `fixed_layer` are checked. The runtime selector is left
unevaluated. The same applies to `<<~~s1~~>>`, undefined variables, unresolved
paths and unresolved layer-only names. Static variables are checked only when
they expand completely. No scenario/event value is guessed from the filename.

Conditional database assignments, event definitions and uninspectable includes
invalidate the affected context. The extension reports that it could not check
an unambiguously named layer when its database is uncertain. An absent layer
diagnostic for a dynamic selector does **not** establish that the layer exists.

### Diagnostics

| Code | Meaning | Severity |
| --- | --- | --- |
| `TPV001` | Referenced physical file is missing (existing check) | Error |
| `TPV030` | Concrete layer is missing; bounded available names are shown | Error |
| `TPV031` | Catalog cannot be checked: invalid, unreadable, busy, unsupported, changed or timed out | Warning |
| `TPV032` | No registered spatial layers | Warning |
| `TPV033` | Database scope cannot be established | Information |

Explicit selectors are underlined individually; an implied layer uses the
file-path span. Missing files do not also receive missing-layer errors.
`diagnosticLevel`, `tpv-ignore` and `tpv-ignore-file` apply. Quick Fixes offer
ignore directives; they never guess a replacement layer.

### Read-only access and limits

The packaged TypeScript reader uses read-only file handles in at most two
workers. It reads SQLite schema and GeoPackage catalog pages only. It does not
execute SQL, inspect feature/geometry/tile rows, copy the database, start a
SQLite connection, checkpoint, or create/change journaling files. Runtime use
requires no Python, QGIS, GDAL, native SQLite add-on or external executable.

**WAL-mode files and nonempty WAL/journal/SHM sidecars are left unchecked.**
Other unsupported layouts, including views/virtual layers and `WITHOUT ROWID`
or generated catalog columns, are also reported as unchecked. Before/after
file identity, timestamp, size, header and sidecar checks reject observed
concurrent changes; this is conservative catalog inspection, not a SQLite
transaction or a full database-integrity check. Do not alter a project's
journaling settings merely to satisfy the validator.

One validation pass deduplicates both database existence checks and inventory
reads. Later passes verify the cached inventory against file metadata and the
SQLite header. Existing shared directory watchers track the database and its
sidecars, without adding a watcher per layer. Edits, setting changes and disk
events invalidate outstanding results before they can overwrite newer checks.

Inspection is bounded to 16 MiB / 4,096 metadata pages, 1 MiB per catalog record,
100,000 catalog rows, 20,000 layer names and a five-second queued request
deadline. Cache and worker memory are bounded; a timed-out worker keeps its
slot until it exits. Exceeding a limit produces an unchecked diagnostic.
The pre-existing path/version traversal still contains synchronous filesystem
operations; issue [#3](https://github.com/Chain-Frost/tuflow_validator/issues/3)
tracks its broader network performance work.

The [local metadata benchmark](docs/benchmarks/2026-11-04-gpkg-local.md) and
[Windows validation handoff](docs/work/2026-11-04-windows-validation-handoff.md)
record the evidence and remaining gate. A fast local metadata result does not
justify enabling the feature by default on project network shares.

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
- This extension does not implement a full TUFLOW grammar; it focuses on file-path validation.
- Unrecognised commands are not assumed to consume files. Input-path validation is intentionally conservative to avoid false errors.
- It does not validate feature contents, geometry, CRS, required attributes or runtime options. GeoPackage layer names are checked only when explicitly enabled and statically resolvable.

## Development
```bash
npm run compile
npm run test:container
npm run package:vsix
npm run benchmark:gpkg
```

GeoPackage tests and the benchmark generate genuine SQLite/GeoPackage fixtures
using Python's standard library (`python3` on Unix, `python` on Windows, or
`TPV_TEST_PYTHON`). Python is needed only for development/tests. CI runs the
VS Code integration suite and VSIX-content verification on Linux and Windows.
