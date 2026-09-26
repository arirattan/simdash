"""
Installs the SimDash export script into DCS World.

  * copies dcs/SimDash.lua  ->  Saved Games\\DCS...\\Scripts\\SimDash\\SimDash.lua
  * appends ONE line to Scripts\\Export.lua (existing lines, e.g. DCS-BIOS / MOZA / TacView, are kept)
  * backs up Export.lua first (Export.lua.simdash-backup)

    python install_dcs.py              install / update
    python install_dcs.py --uninstall  remove the Export.lua line (and the SimDash folder)
"""
import os
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE.parent / "dcs" / "SimDash.lua"
MARKER = "-- SimDash (iPad cockpit)"
LINE = MARKER + "\npcall(function() dofile(lfs.writedir() .. [[Scripts\\SimDash\\SimDash.lua]]) end)\n"


def saved_games_dirs():
    home = Path(os.environ.get("USERPROFILE", str(Path.home())))
    return [d for d in sorted((home / "Saved Games").glob("DCS*")) if d.is_dir() and (d / "Config").is_dir()]


def install(sg):
    scripts = sg / "Scripts"
    (scripts / "SimDash").mkdir(parents=True, exist_ok=True)
    shutil.copy2(SRC, scripts / "SimDash" / "SimDash.lua")
    export = scripts / "Export.lua"
    text = export.read_text(encoding="utf-8", errors="replace") if export.exists() else ""
    if MARKER in text:
        print(f"  {sg.name}: SimDash.lua updated (Export.lua already set up)")
    else:
        if export.exists():
            backup = scripts / "Export.lua.simdash-backup"
            if not backup.exists():
                shutil.copy2(export, backup)
        with open(export, "a", encoding="utf-8", newline="\n") as f:
            if text and not text.endswith("\n"):
                f.write("\n")
            f.write("\n" + LINE)
        print(f"  {sg.name}: installed (added 1 line to Scripts\\Export.lua)")
    bios = (scripts / "DCS-BIOS" / "BIOS.lua").exists() and "DCS-BIOS" in export.read_text(encoding="utf-8", errors="replace")
    print(f"  {sg.name}: DCS-BIOS {'found' if bios else 'NOT installed - cockpit switches/lamps need it (see README)'}")


def uninstall(sg):
    scripts = sg / "Scripts"
    export = scripts / "Export.lua"
    if export.exists():
        text = export.read_text(encoding="utf-8", errors="replace")
        if MARKER in text:
            export.write_text(text.replace("\n" + LINE, "").replace(LINE, ""), encoding="utf-8", newline="\n")
            print(f"  {sg.name}: removed SimDash line from Export.lua")
    shutil.rmtree(scripts / "SimDash", ignore_errors=True)


def main():
    dirs = saved_games_dirs()
    if not dirs:
        print("No DCS folder found in Saved Games. Start DCS once, then run this again.")
        return 1
    print("DCS folders:", ", ".join(d.name for d in dirs))
    for d in dirs:
        (uninstall if "--uninstall" in sys.argv else install)(d)
    print("Done. Restart DCS (or the mission) for it to take effect.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
