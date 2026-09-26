"""
Installs the MobiFlight WASM module ("mobiflight-event-module") into the MSFS Community folder.

SimDash needs it for the G1000 keys (softkeys, FMS knob, D-> / MENU / FPL / PROC / CLR / ENT, RANGE): the
G1000 NXi only reacts to H: events, which SimConnect can't send by itself. The module turns an event
"MobiFlight.AS1000_PFD_SOFTKEYS_1" into (>H:AS1000_PFD_SOFTKEYS_1). It is free and open source:
https://github.com/MobiFlight/MobiFlight-WASM-Module (MobiFlight Connector installs the same module).

    python install_mobiflight.py                        Community folder(s) found from MSFS's UserCfg.opt
    python install_mobiflight.py "D:\\MSFS\\Community"    or name it
"""

import json
import shutil
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

from msfs_community import community_dirs, mobiflight_module

REPO = "MobiFlight/MobiFlight-WASM-Module"


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "SimDash", "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def latest_zip():
    rel = json.loads(get(f"https://api.github.com/repos/{REPO}/releases/latest"))
    for a in rel.get("assets", []):
        if a["name"].lower().endswith(".zip"):
            return rel.get("tag_name", "?"), a["browser_download_url"]
    raise RuntimeError("the latest MobiFlight WASM module release has no .zip")


def package_root(folder):
    """The folder in the zip that is the MSFS package (the one with layout.json)."""
    found = sorted(folder.rglob("layout.json"), key=lambda p: len(p.parts))
    if not found:
        raise RuntimeError("the zip holds no MSFS package (no layout.json)")
    return found[0].parent


def main():
    dirs = [Path(a) for a in sys.argv[1:]] or community_dirs()
    if not dirs:
        print("No MSFS Community folder found. Start MSFS once, or give the folder:\n"
              '    install-mobiflight-module.bat "D:\\MSFS\\Community"')
        return 1
    todo = []
    for d in dirs:
        mod = mobiflight_module([d])
        if mod:
            print(f"Already installed: {mod}")
        elif not d.is_dir():
            print(f"Not a folder: {d}")
        else:
            todo.append(d)
    if not todo:
        return 0

    tag, url = latest_zip()
    print(f"Downloading MobiFlight WASM module {tag} ...")
    with tempfile.TemporaryDirectory() as tmp:
        z = Path(tmp) / "module.zip"
        z.write_bytes(get(url))
        with zipfile.ZipFile(z) as f:
            f.extractall(Path(tmp) / "x")
        root = package_root(Path(tmp) / "x")
        name = root.name if root != Path(tmp) / "x" else "mobiflight-event-module"
        for d in todo:
            shutil.copytree(root, d / name)
            print(f"Installed: {d / name}")
    print("\nRestart MSFS (the module loads when the sim starts), then the G1000 keys on the iPad work.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # network, permissions...
        print(f"\nCould not install the module: {e}\n"
              f"Get it by hand: download the .zip from https://github.com/{REPO}/releases and unzip its\n"
              "mobiflight-event-module folder into the MSFS Community folder.")
        sys.exit(1)
