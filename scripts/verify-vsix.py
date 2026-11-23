"""Verify a VSIX built from this checkout using only Python's standard library.

The required JavaScript modules are derived from src/*.ts (excluding src/test)
rather than from GeoPackage feature branches or unrelated build artifacts.
"""

import argparse
import json
from pathlib import Path
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parents[1]
STATIC_CONTENT = {
    "[Content_Types].xml",
    "extension.vsixmanifest",
    "extension/package.json",
    "extension/readme.md",
    "extension/LICENSE.txt",
    "extension/resources/icon.png",
}


def verify(package: Path) -> None:
    if not package.is_file():
        raise ValueError(f"VSIX not found: {package}")

    runtime_modules = {
        f"extension/out/{source.stem}.js" for source in (ROOT / "src").glob("*.ts")
    }
    if "extension/out/extension.js" not in runtime_modules:
        raise ValueError("src/extension.ts must provide the runtime entry point")

    expected = STATIC_CONTENT | runtime_modules
    with ZipFile(package) as archive:
        members = [entry for entry in archive.infolist() if not entry.is_dir()]
        names = [member.filename for member in members]
        if len(names) != len(set(names)):
            raise ValueError("VSIX contains duplicate archive paths")

        actual = set(names)
        missing = sorted(expected - actual)
        unexpected = sorted(actual - expected)
        if missing or unexpected:
            raise ValueError(
                f"VSIX boundary mismatch; missing={missing}, unexpected={unexpected}"
            )

        corrupt = archive.testzip()
        if corrupt:
            raise ValueError(f"VSIX contains corrupt archive member: {corrupt}")

        packaged = json.loads(archive.read("extension/package.json"))
        source = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        for key in ("name", "publisher", "version", "main", "icon", "engines"):
            if packaged.get(key) != source.get(key):
                raise ValueError(f"Packaged {key} differs from the tested source")

        entry_point = "extension/" + packaged["main"].removeprefix("./")
        if entry_point != "extension/out/extension.js":
            raise ValueError(f"Unexpected extension entry point: {entry_point}")
        icon = "extension/" + packaged["icon"].removeprefix("./")
        if icon not in actual:
            raise ValueError(f"Extension icon missing from VSIX: {icon}")
        if packaged.get("dependencies"):
            raise ValueError("Runtime dependencies require an explicit packaging review")
        for module in runtime_modules:
            if not archive.getinfo(module).file_size:
                raise ValueError(f"Empty runtime JavaScript file: {module}")

    print(
        f"Verified {package.name}: {len(actual)} archive entries, "
        f"{len(runtime_modules)} JavaScript runtime modules, "
        "no test/source/example/dependency payload."
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("vsix", type=Path, help="VSIX archive to inspect")
    verify(parser.parse_args().vsix)
