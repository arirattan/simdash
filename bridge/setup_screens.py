"""
Sets up live screens for DCS: exports the cockpit displays to fixed places on the PC screen so the bridge
can stream them to the iPad (Apache MPDs with the FCR radar / TSD / video pages, the TEDAC with the TADS
FLIR picture, the MFDs of the F/A-18, F-16, A-10 ...).

  * writes  Saved Games\\DCS...\\Config\\MonitorSetup\\SimDash.lua   (a DCS monitor layout)
  * writes  bridge\\data\\screens.json                              (tells the bridge where to look)

    python setup_screens.py             second monitor to the right if you have one, else a strip on the main screen
    python setup_screens.py --strip     always use a strip on the right of the main screen
    python setup_screens.py --size 600  size of each exported display in pixels
    python setup_screens.py --remove    delete SimDash.lua again (pick your old monitor setup in DCS)

Heatblur's F-14 and F-4E do not support display export in DCS, so their TID / DDD / radar scopes
can't be streamed this way.
"""

import ctypes
import json
import sys
from pathlib import Path

from install_dcs import saved_games_dirs

HERE = Path(__file__).resolve().parent
SCREENS_JSON = HERE / "data" / "screens.json"

# the viewport names DCS aircraft look for (Apache: TEDAC falls back to CENTER_MFCD)
EXPORTS = [("LEFT_MFCD", "Left MFD / MPD"), ("RIGHT_MFCD", "Right MFD / MPD"), ("CENTER_MFCD", "Centre MFD / Apache TEDAC (TADS FLIR)")]


def monitors():
    """[(left, top, right, bottom, primary)] in real pixels."""
    from ctypes import wintypes
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except (AttributeError, OSError):
        ctypes.windll.user32.SetProcessDPIAware()

    class MONITORINFO(ctypes.Structure):
        _fields_ = [("cbSize", wintypes.DWORD), ("rcMonitor", wintypes.RECT), ("rcWork", wintypes.RECT), ("dwFlags", wintypes.DWORD)]

    out = []
    proc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HMONITOR, wintypes.HDC, ctypes.POINTER(wintypes.RECT), wintypes.LPARAM)

    def cb(hmon, hdc, rect, data):
        mi = MONITORINFO()
        mi.cbSize = ctypes.sizeof(MONITORINFO)
        ctypes.windll.user32.GetMonitorInfoW(hmon, ctypes.byref(mi))
        r = mi.rcMonitor
        out.append((r.left, r.top, r.right, r.bottom, bool(mi.dwFlags & 1)))
        return True

    ctypes.windll.user32.EnumDisplayMonitors(None, None, proc(cb), 0)
    return out


def layout(mons, force_strip, size):
    prim = next((m for m in mons if m[4]), mons[0])
    pw, ph = prim[2] - prim[0], prim[3] - prim[1]
    right = [m for m in mons if m is not prim and m[0] == prim[2]]  # a monitor touching the right edge
    if right and not force_strip:
        m = right[0]
        mw, mh, top = m[2] - m[0], m[3] - m[1], m[1] - prim[1]
        s = size or min(mh, mw // 3)
        rects = [(pw + i * s, top, s, s) for i in range(3)]
        center = (0, 0, pw, ph)
        res = (pw + mw, max(ph, top + mh))
        how = f"on your second monitor ({mw}x{mh}, right of the main one)"
    else:
        s = size or ph // 3
        rects = [(pw - s, i * s, s, s) for i in range(3)]
        center = (0, 0, pw - s, ph)
        res = (pw, ph)
        how = f"in a {s}-pixel strip on the right of your main screen (the 3D view gets a bit narrower)"
    return center, rects, res, how, (prim[0], prim[1])


def monitor_lua(center, rects):
    x, y, w, h = center
    lines = ["_  = function(p) return p end",
             "name = _('SimDash (iPad live screens)')",
             "Description = 'Main view plus exported displays that SimDash streams to the iPad'",
             "Viewports =", "{", "  Center =", "  {",
             f"    x = {x}, y = {y}, width = {w}, height = {h},",
             "    viewDx = 0, viewDy = 0,", f"    aspect = {w} / {h},", "  }", "}"]
    for (name, _), (rx, ry, rw, rh) in zip(EXPORTS, rects):
        lines.append(f"{name} = {{ x = {rx}, y = {ry}, width = {rw}, height = {rh} }}")
    lines += ["UIMainView = Viewports.Center", "GU_MAIN_VIEWPORT = Viewports.Center", ""]
    return "\n".join(lines)


def main():
    if sys.platform != "win32":
        print("Live screens need Windows.")
        return 1
    dirs = saved_games_dirs()
    if "--remove" in sys.argv:
        for d in dirs:
            f = d / "Config" / "MonitorSetup" / "SimDash.lua"
            if f.exists():
                f.unlink()
                print(f"Removed {f}")
        print("In DCS: Options > System > Monitors - pick your old setup again.")
        return 0
    if not dirs:
        print("No DCS folder found in Saved Games. Start DCS once, then run this again.")
        return 1
    size = 0
    if "--size" in sys.argv:
        size = int(sys.argv[sys.argv.index("--size") + 1])
    center, rects, res, how, origin = layout(monitors(), "--strip" in sys.argv, size)

    lua = monitor_lua(center, rects)
    for d in dirs:
        f = d / "Config" / "MonitorSetup" / "SimDash.lua"
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(lua, encoding="utf-8")
        print(f"Wrote {f}")

    conf = {}
    if SCREENS_JSON.exists():
        try:
            conf = json.loads(SCREENS_JSON.read_text(encoding="utf-8"))
        except ValueError:
            conf = {}
    screens = conf.setdefault("screens", {})
    for (name, label), (rx, ry, rw, rh) in zip(EXPORTS, rects):  # DCS window starts at the main monitor's corner
        screens[name] = {"label": label, "x": origin[0] + rx, "y": origin[1] + ry, "w": rw, "h": rh}
    conf.setdefault("fps", 8)
    conf.setdefault("quality", 70)
    SCREENS_JSON.parent.mkdir(parents=True, exist_ok=True)
    SCREENS_JSON.write_text(json.dumps(conf, indent=2), encoding="utf-8")
    print(f"Wrote {SCREENS_JSON}")

    print(f"""
Exported displays go {how}.
Now in DCS: Options > System
  * Monitors:    SimDash (iPad live screens)
  * Resolution:  {res[0]} x {res[1]}   (type it in if it isn't in the list)
  * Full Screen: OFF  (the bridge copies the displays from the desktop; exclusive full screen shows black)
Restart DCS, start the bridge, and open the Apache page on the iPad: the MPDs and the TADS page go live.
Tip: pip install pillow  makes the pictures about 10x smaller (smoother over Wi-Fi).""")
    return 0


if __name__ == "__main__":
    sys.exit(main())
