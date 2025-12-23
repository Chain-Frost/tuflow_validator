# TUFLOW Validator (VS Code Extension)

This extension surfaces diagnostics in TUFLOW control files by checking that referenced files exist on disk. It is intentionally lightweight and focuses on path validation rather than full syntax validation.

## What it does
- Scans control files for `Command == Value` lines and checks paths in the value field.
- Supports multiple paths on a line separated by `|`.
- Supports GeoPackage layer syntax and ignores layer selectors after `>>` (for example, `file.gpkg >> layer1 && layer2`).
- Recursively parses referenced control files and reports their issues in the parent file as a warning.

## Supported control files (recursive)
- `.tcf`
- `.tgc`
- `.tbc`
- `.trd`
- `.tef`
- `.ecf`
- `.qcf`

## Platform behavior
- Treats `/` and `\` as path separators for relative paths to be platform-agnostic.

## Limitations and non-goals
- Does not resolve TUFLOW variables/macros (for example `<<OutputRoot>>` or `<<~s1~>>`); these values are ignored.
- Does not implement a full TUFLOW grammar; it only checks file paths in `Command == Value` lines.
- Does not validate layer names, dataset contents, or runtime options.

## Roadmap ideas
- More robust parsing of list values and complex syntax.
- Optional configuration for severity levels and parsing depth.
- Additional TUFLOW file types if needed.
