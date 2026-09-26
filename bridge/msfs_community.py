"""
Where MSFS 2020 / 2024 keep their Community folder, and whether the MobiFlight WASM module is in it.

The folder is the "InstalledPackagesPath" in MSFS's UserCfg.opt (Microsoft Store or Steam install).
"""
import os
import re
from pathlib import Path


def usercfg_files():
    local, roaming = os.environ.get("LOCALAPPDATA", ""), os.environ.get("APPDATA", "")
    return [
        Path(local, "Packages", "Microsoft.Limitless_8wekyb3d8bbwe", "LocalCache", "UserCfg.opt"),        # 2024 Microsoft Store
        Path(roaming, "Microsoft Flight Simulator 2024", "UserCfg.opt"),                                   # 2024 Steam
        Path(local, "Packages", "Microsoft.FlightSimulator_8wekyb3d8bbwe", "LocalCache", "UserCfg.opt"),  # 2020 Microsoft Store
        Path(roaming, "Microsoft Flight Simulator", "UserCfg.opt"),                                        # 2020 Steam
    ]


def community_dirs():
    """Existing Community folders of every MSFS installed on this PC."""
    out = []
    for f in usercfg_files():
        try:
            text = f.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        m = re.search(r'^\s*InstalledPackagesPath\s+"([^"]+)"', text, re.M)
        if m:
            d = Path(m.group(1)) / "Community"
            if d.is_dir() and d not in out:
                out.append(d)
    return out


def mobiflight_module(dirs=None):
    """The MobiFlight WASM module's folder in a Community folder, or None."""
    for d in community_dirs() if dirs is None else dirs:
        try:
            for p in d.iterdir():
                if "mobiflight" in p.name.lower() and (p / "modules").is_dir():
                    return p
        except OSError:
            continue
    return None
