"""Inspect the built extension archive; uses only Python's standard library."""

from pathlib import Path
import sys
import zipfile


def verify(package: Path) -> None:
    with zipfile.ZipFile(package) as archive:
        names = set(archive.namelist())
    required = {
        "extension/package.json",
        "extension/out/extension.js",
        "extension/out/geopackageReader.js",
        "extension/out/geopackageWorker.js",
        "extension/out/geopackageInventory.js",
        "extension/out/geopackageDiagnostics.js",
        "extension/out/spatialDatabase.js",
    }
    missing = required - names
    assert not missing, f"Runtime files missing from VSIX: {sorted(missing)}"
    for name in names:
        assert not name.startswith((
            "extension/src/", "extension/out/test/", "extension/node_modules/",
            "extension/example/", "extension/docs/",
        )), f"Development file packaged: {name}"
    print(f"VSIX verified: {package.name}; {len(names)} entries; reader and worker included.")


if __name__ == "__main__":
    verify(Path(sys.argv[1]))
