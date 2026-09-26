"""
Live screens for the iPad
=========================

Streams parts of the PC screen to the iPad as pictures it refreshes several times a second:

* DCS displays exported with setup_screens.py - e.g. the AH-64D MPDs (TSD, FCR radar, video pages)
  and the TEDAC with the TADS FLIR / TV picture, or the MFDs of the F/A-18, F-16, A-10...
* the MSFS G1000 PFD / MFD: the sim's own pop-out windows (Right-Alt + click the screen in the cockpit),
  found on their own as G1000_PFD / G1000_MFD, no setup needed.
* any window or area of the desktop you add to bridge/data/screens.json.

bridge/data/screens.json:
    {
      "fps": 8,
      "quality": 70,
      "screens": {
        "LEFT_MFCD": {"label": "Left MFD", "x": 1920, "y": 0, "w": 640, "h": 640},
        "PFD":       {"label": "MSFS PFD pop-out", "window": "PFD"},
        "G1000_MFD": {"label": "G1000 MFD", "popout": 1}
      }
    }
  x / y / w / h are desktop pixels. With "window" (a part of the window title) or "popout" (the n-th MSFS
  pop-out window, counted left to right), x / y / w / h are optional and relative to that window's inside
  (so a part of a window can be shown). Entries here replace the built-in G1000_PFD / G1000_MFD.

Windows only (GDI through ctypes, no pip packages). Pictures are PNG; if Pillow is installed
(pip install pillow) they are JPEG instead, which is about 10x smaller and so smoother on Wi-Fi.

Windows ("window" / "popout") are copied off the screen, so they must stay visible - unless the
windows-capture package is installed (install-screen-capture.bat, or pip install windows-capture):
then they are captured with Windows Graphics Capture, which also works while a pop-out is behind the
sim window or minimised, and pictures are JPEG through its OpenCV.
"""

import asyncio
import ctypes
import io
import json
import struct
import sys
import threading
import time
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
CONFIG = HERE / "data" / "screens.json"

try:
    from PIL import Image  # optional: JPEG instead of PNG
except ImportError:
    Image = None

try:  # optional: capture windows that are covered or minimised (brings numpy + OpenCV along)
    from windows_capture import WindowsCapture
    import cv2
    import numpy
except Exception:  # not installed, or its DLLs don't load
    WindowsCapture = cv2 = numpy = None

WIN = sys.platform == "win32"
if WIN:
    from ctypes import wintypes

    try:  # capture in real pixels, the same ones DCS uses for its exported viewports
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except (AttributeError, OSError):
        try:
            ctypes.windll.user32.SetProcessDPIAware()
        except (AttributeError, OSError):
            pass

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    gdi32 = ctypes.WinDLL("gdi32", use_last_error=True)
    user32.GetDC.restype = wintypes.HDC
    user32.GetDC.argtypes = [wintypes.HWND]
    user32.ReleaseDC.argtypes = [wintypes.HWND, wintypes.HDC]
    gdi32.CreateCompatibleDC.restype = wintypes.HDC
    gdi32.CreateCompatibleDC.argtypes = [wintypes.HDC]
    gdi32.CreateCompatibleBitmap.restype = wintypes.HBITMAP
    gdi32.CreateCompatibleBitmap.argtypes = [wintypes.HDC, ctypes.c_int, ctypes.c_int]
    gdi32.SelectObject.restype = wintypes.HGDIOBJ
    gdi32.SelectObject.argtypes = [wintypes.HDC, wintypes.HGDIOBJ]
    gdi32.BitBlt.argtypes = [wintypes.HDC, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
                             wintypes.HDC, ctypes.c_int, ctypes.c_int, wintypes.DWORD]
    gdi32.StretchBlt.argtypes = [wintypes.HDC, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
                                 wintypes.HDC, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.DWORD]
    gdi32.SetStretchBltMode.argtypes = [wintypes.HDC, ctypes.c_int]
    gdi32.SetBrushOrgEx.argtypes = [wintypes.HDC, ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
    gdi32.GetDIBits.argtypes = [wintypes.HDC, wintypes.HBITMAP, wintypes.UINT, wintypes.UINT,
                                ctypes.c_void_p, ctypes.c_void_p, wintypes.UINT]
    gdi32.DeleteObject.argtypes = [wintypes.HGDIOBJ]
    gdi32.DeleteDC.argtypes = [wintypes.HDC]
    EnumWindowsProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32.EnumWindows.argtypes = [EnumWindowsProc, wintypes.LPARAM]
    user32.IsWindowVisible.argtypes = [wintypes.HWND]
    user32.IsIconic.argtypes = [wintypes.HWND]
    user32.GetWindowTextLengthW.argtypes = [wintypes.HWND]
    user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user32.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user32.GetWindowThreadProcessId.restype = wintypes.DWORD
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    user32.GetClientRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
    user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
    user32.ClientToScreen.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.POINT)]
    dwmapi = ctypes.WinDLL("dwmapi")
    dwmapi.DwmGetWindowAttribute.argtypes = [wintypes.HWND, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD]

    class WINDOWPLACEMENT(ctypes.Structure):
        _fields_ = [("length", wintypes.UINT), ("flags", wintypes.UINT), ("showCmd", wintypes.UINT),
                    ("ptMinPosition", wintypes.POINT), ("ptMaxPosition", wintypes.POINT), ("rcNormalPosition", wintypes.RECT)]

    user32.GetWindowPlacement.argtypes = [wintypes.HWND, ctypes.POINTER(WINDOWPLACEMENT)]

    class BITMAPINFOHEADER(ctypes.Structure):
        _fields_ = [("biSize", wintypes.DWORD), ("biWidth", wintypes.LONG), ("biHeight", wintypes.LONG),
                    ("biPlanes", wintypes.WORD), ("biBitCount", wintypes.WORD), ("biCompression", wintypes.DWORD),
                    ("biSizeImage", wintypes.DWORD), ("biXPelsPerMeter", wintypes.LONG),
                    ("biYPelsPerMeter", wintypes.LONG), ("biClrUsed", wintypes.DWORD), ("biClrImportant", wintypes.DWORD)]

    class BITMAPINFO(ctypes.Structure):
        _fields_ = [("bmiHeader", BITMAPINFOHEADER), ("bmiColors", wintypes.DWORD * 3)]

SRCCOPY = 0x00CC0020
HALFTONE = 4
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
DWMWA_EXTENDED_FRAME_BOUNDS = 9
MAX_SIDE = 1600  # bigger captures (e.g. a maximised pop-out) are scaled down to fit: lighter on Wi-Fi

# MSFS pop-outs (Right-Alt + click an instrument) are untitled windows of the sim (class AceApp; Pop Out Panel
# Manager renames them "Custom - PFD" / "... (Custom)"). Counted left to right, so the PFD goes left of (or above)
# the MFD.
DEFAULTS = {
    "G1000_PFD": {"label": "G1000 PFD (MSFS pop-out 1)", "popout": 1},
    "G1000_MFD": {"label": "G1000 MFD (MSFS pop-out 2)", "popout": 2},
}


def grab_bgra(x, y, w, h, ow, oh):
    """Desktop pixels -> top-down BGRA bytes, scaled to ow x oh."""
    screen = user32.GetDC(None)
    mem = gdi32.CreateCompatibleDC(screen)
    bmp = gdi32.CreateCompatibleBitmap(screen, ow, oh)
    old = gdi32.SelectObject(mem, bmp)
    try:
        if (ow, oh) == (w, h):
            if not gdi32.BitBlt(mem, 0, 0, w, h, screen, x, y, SRCCOPY):
                raise OSError("screen capture failed (BitBlt)")
        else:
            gdi32.SetStretchBltMode(mem, HALFTONE)
            gdi32.SetBrushOrgEx(mem, 0, 0, None)
            if not gdi32.StretchBlt(mem, 0, 0, ow, oh, screen, x, y, w, h, SRCCOPY):
                raise OSError("screen capture failed (StretchBlt)")
        bmi = BITMAPINFO()
        bmi.bmiHeader.biSize = ctypes.sizeof(BITMAPINFOHEADER)
        bmi.bmiHeader.biWidth, bmi.bmiHeader.biHeight = ow, -oh  # negative = top-down rows
        bmi.bmiHeader.biPlanes, bmi.bmiHeader.biBitCount = 1, 32
        buf = ctypes.create_string_buffer(ow * oh * 4)
        if gdi32.GetDIBits(mem, bmp, 0, oh, buf, ctypes.byref(bmi), 0) != oh:
            raise OSError("screen capture failed (GetDIBits)")
        return buf.raw
    finally:
        gdi32.SelectObject(mem, old)
        gdi32.DeleteObject(bmp)
        gdi32.DeleteDC(mem)
        user32.ReleaseDC(None, screen)


def window_title(hwnd):
    n = user32.GetWindowTextLengthW(hwnd)
    if not n:
        return ""
    b = ctypes.create_unicode_buffer(n + 1)
    user32.GetWindowTextW(hwnd, b, n + 1)
    return b.value


def find_window(title):
    """First visible window whose title contains `title` (case-insensitive)."""
    want, found = title.lower(), []

    def cb(hwnd, _):
        if user32.IsWindowVisible(hwnd) and not user32.IsIconic(hwnd) and want in window_title(hwnd).lower():
            found.append(hwnd)
            return False
        return True

    user32.EnumWindows(EnumWindowsProc(cb), 0)
    return found[0] if found else None


def client_rect(hwnd):
    """Inside of a window in desktop pixels: x, y, w, h."""
    r, p = wintypes.RECT(), wintypes.POINT(0, 0)
    user32.GetClientRect(hwnd, ctypes.byref(r))
    user32.ClientToScreen(hwnd, ctypes.byref(p))
    return p.x, p.y, r.right, r.bottom


def normal_rect(hwnd):
    """Where a minimised window sits when restored (workspace pixels): x, y, w, h."""
    wp = WINDOWPLACEMENT()
    wp.length = ctypes.sizeof(WINDOWPLACEMENT)
    user32.GetWindowPlacement(hwnd, ctypes.byref(wp))
    r = wp.rcNormalPosition
    return r.left, r.top, r.right - r.left, r.bottom - r.top


def client_box(hwnd, fw, fh):
    """The window's inside within a Windows Graphics Capture frame of fw x fh, which shows the whole window with
    its title bar: left, top, right, bottom. None while minimised (worked out the way OBS does it)."""
    r = wintypes.RECT()
    if user32.IsIconic(hwnd) or dwmapi.DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, ctypes.byref(r), ctypes.sizeof(r)):
        return None
    x, y, w, h = client_rect(hwnd)
    if w <= 0 or h <= 0:
        return None
    left, top = max(0, x - r.left), max(0, y - r.top)
    return left, top, left + max(1, min(fw - left, w)), top + max(1, min(fh - top, h))


_exe = {}


def process_name(hwnd):
    """Lower-case exe name of the process that owns a window ('' if it can't be read)."""
    pid = wintypes.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    if pid.value not in _exe:
        name, h = "", kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid.value)
        if h:
            b, n = ctypes.create_unicode_buffer(1024), wintypes.DWORD(1024)
            if kernel32.QueryFullProcessImageNameW(h, 0, b, ctypes.byref(n)):
                name = b.value.replace("/", "\\").rsplit("\\", 1)[-1].lower()
            kernel32.CloseHandle(h)
        if len(_exe) > 500:
            _exe.clear()
        _exe[pid.value] = name
    return _exe[pid.value]


def msfs_windows(minimised=False):
    """Visible windows of the sim (class AceApp, or FlightSimulator*.exe): [(title, x, y, w, h, hwnd)].
    Minimised ones only if asked, at the place they'd be restored to."""
    found = []

    def cb(hwnd, _):
        if user32.IsWindowVisible(hwnd) and (minimised or not user32.IsIconic(hwnd)):
            b = ctypes.create_unicode_buffer(32)
            user32.GetClassNameW(hwnd, b, 32)
            if b.value == "AceApp" or process_name(hwnd).startswith("flightsimulator"):
                x, y, w, h = normal_rect(hwnd) if user32.IsIconic(hwnd) else client_rect(hwnd)
                if w >= 64 and h >= 64:
                    found.append((window_title(hwnd), x, y, w, h, hwnd))
        return True

    user32.EnumWindows(EnumWindowsProc(cb), 0)
    return found


def msfs_popouts(wins):
    """The sim's pop-out windows: untitled ones (or renamed by Pop Out Panel Manager) left to right (then top to
    bottom), then any other window of the sim except the main one and its multi-monitor views."""
    main = max((t for t in wins if "microsoft flight simulator" in t[0].lower()), key=lambda t: t[3] * t[4], default=None)
    pops = [t for t in wins if t is not main and "WINDOW" not in t[0]]
    rank = lambda t: (0 if not t[0] or "custom" in t[0].lower() else 1, t[1], t[2])
    return sorted(pops, key=rank)


def describe(wins):
    return ", ".join(f"'{t[0][:40]}' {t[3]}x{t[4]}" for t in wins[:5]) or "none"


def find_target(spec, wins=None):
    """The window a "popout" / "window" screen shows."""
    if "popout" in spec:
        wins = msfs_windows() if wins is None else wins
        n, pops = int(spec["popout"]), msfs_popouts(wins)
        if not 0 < n <= len(pops):
            if not wins:
                raise LookupError("no MSFS window on this PC - is the sim running here, and not minimised?")
            raise LookupError(f"MSFS pop-out {n} not found ({len(pops)} open): in the cockpit, hold Right-Alt and click "
                              f"the PFD, then the MFD. MSFS windows seen: {describe(wins)}")
        return pops[n - 1][5]
    hwnd = find_window(spec["window"])
    if not hwnd:
        raise LookupError(f"window '{spec['window']}' not found (is it open and not minimised?)")
    return hwnd


def window_rect(spec, hwnd):
    """The part of a window a screen shows, in desktop pixels: x, y, w, h."""
    x0, y0, cw, ch = client_rect(hwnd)
    x, y = x0 + int(spec.get("x", 0)), y0 + int(spec.get("y", 0))
    w = int(spec.get("w", cw - int(spec.get("x", 0))))
    h = int(spec.get("h", ch - int(spec.get("y", 0))))
    return x, y, w, h


_MASK = bytes(v & 0xFC for v in range(256))  # 6 bits per colour: invisible on displays, compresses much better


def png(bgra, w, h):
    rgb = bytearray(w * h * 3)
    rgb[0::3], rgb[1::3], rgb[2::3] = bgra[2::4], bgra[1::4], bgra[0::4]
    rgb = rgb.translate(_MASK)
    stride, mv, parts = w * 3, memoryview(rgb), []
    for i in range(0, len(rgb), stride):
        parts += (b"\x00", mv[i:i + stride])  # filter type 0 per row

    def chunk(kind, data):
        return struct.pack("!I", len(data)) + kind + data + struct.pack("!I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack("!IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(b"".join(parts), 1)) + chunk(b"IEND", b""))


def png_gray(px, w, h):
    mv, parts = memoryview(px), []
    for i in range(0, w * h, w):
        parts += (b"\x00", mv[i:i + w])

    def chunk(kind, data):
        return struct.pack("!I", len(data)) + kind + data + struct.pack("!I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack("!IIBBBBB", w, h, 8, 0, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(b"".join(parts), 1)) + chunk(b"IEND", b""))


class DemoFlir:
    """Fake white-hot FLIR picture for --demo: scrolling terrain, a road, hot vehicles, a crosshair."""
    W = H = 360

    def __init__(self):
        import math
        import random
        rnd, W, H = random.Random(64), self.W, self.H
        px, tau = bytearray(W * H), 2 * math.pi
        for y in range(H):  # every term repeats after H rows, so the scroll has no seam
            for x in range(W):
                v = 78 + 16 * math.sin(x / 23.0) * math.cos(tau * 2 * y / H) + 10 * math.sin(tau * (3 * x / W + 5 * y / H)) + rnd.random() * 12
                if abs((x - y) % W - 150) < 5:  # road
                    v += 34
                px[y * W + x] = max(0, min(255, int(v)))
        for _ in range(9):  # hot engines
            cx, cy, r = rnd.randrange(20, W - 20), rnd.randrange(H), rnd.randrange(3, 6)
            for y in range(cy - 3 * r, cy + 3 * r):
                for x in range(cx - 3 * r, cx + 3 * r):
                    d = math.hypot(x - cx, y - cy)
                    if d < 3 * r:
                        i = (y % H) * W + x
                        px[i] = max(px[i], 255 if d < r else int(255 - (d - r) * 55 / r))
        self.base = bytes(px)

    def frame(self):
        W, H = self.W, self.H
        k = int(time.monotonic() * 14) % H * W  # slow scroll, as if flying forward
        px = bytearray(self.base[k:] + self.base[:k])
        c, g, n = W // 2, 10, 34
        for y in (c - 1, c):
            for x in list(range(c - n, c - g)) + list(range(c + g, c + n)):
                px[y * W + x] = 250
                px[x * W + y] = 250
        return "image/png", png_gray(px, W, H)


def encode(bgra, w, h, quality):
    if Image is not None:
        out = io.BytesIO()
        Image.frombuffer("RGB", (w, h), bgra, "raw", "BGRX", 0, 1).save(out, "JPEG", quality=quality)
        return "image/jpeg", out.getvalue()
    if cv2 is not None:
        bgr = numpy.ascontiguousarray(numpy.frombuffer(bgra, numpy.uint8).reshape(h, w, 4)[:, :, :3])
        ok, jpg = cv2.imencode(".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, quality])
        if ok:
            return "image/jpeg", jpg.tobytes()
    return "image/png", png(bgra, w, h)


class WgcSession:
    """Windows Graphics Capture of one window (windows-capture package). Unlike copying the screen it sees the
    window while other windows cover it, or while it's minimised. Frames arrive on their own thread; the newest
    one is kept."""
    OPTIONS = ({"cursor_capture": False, "draw_border": False}, {})  # no yellow border / cursor, where Windows allows

    def __init__(self, hwnd, every):
        self.hwnd, self.every, self.box = hwnd, every, None
        self.frame, self.at, self.used, self.closed = None, 0.0, time.monotonic(), False
        self.lock, self.ready, self.control, self.attempt = threading.Lock(), threading.Event(), None, 0
        err = None
        for opts in self.OPTIONS:
            self.attempt += 1
            n = self.attempt  # a failed attempt's late calls must not touch the next one

            def on_frame_arrived(frame, control, n=n):
                if n == self.attempt:
                    self.took(frame)

            def on_closed(n=n):
                if n == self.attempt:
                    self.closed = True
                    self.ready.set()

            try:
                cap = WindowsCapture(window_hwnd=hwnd, **opts)
                cap.event(on_frame_arrived)
                cap.event(on_closed)
                self.control = cap.start_free_threaded()
            except Exception as e:
                err, self.control = e, None
                continue
            until = time.monotonic() + 3
            while self.frame is None and not self.closed and not self.control.is_finished() and time.monotonic() < until:
                self.ready.wait(0.05)
            if self.frame is not None:
                return
            err = self.error() or "no picture came"
            self.stop()
            self.closed = False
            self.ready.clear()
        self.attempt += 1
        raise OSError(f"Windows Graphics Capture didn't start ({err})")

    def took(self, frame):
        now = time.monotonic()
        if self.frame is None or now - self.at >= self.every:
            f = frame.frame_buffer.copy()  # BGRA; the native buffer is reused after this call
            with self.lock:
                self.frame, self.at = f, now
            self.ready.set()

    def latest(self):
        self.used = time.monotonic()
        with self.lock:
            return self.frame

    def error(self):
        try:
            if self.control is not None and self.control.is_finished():
                self.control.wait()
        except Exception as e:
            return str(e) or type(e).__name__
        return ""

    def stop(self):
        try:
            if self.control is not None:
                self.control.stop()
        except Exception:
            pass


class Screens:
    DEMO = "CENTER_MFCD"  # --demo without screens.json: a fake FLIR picture on the Apache TEDAC

    def __init__(self, log, demo=False):
        self.log = log
        self.demo, self.demo_flir = demo, None
        self.conf, self.mtime, self.checked = {}, None, 0.0
        self.cache, self.locks = {}, {}
        self.seen = None  # MSFS pop-outs last reported in the bridge window
        self.wgc, self.wgc_lock, self.wgc_failed = {}, threading.Lock(), set()  # hwnd -> WgcSession

    def demo_only(self):
        return self.demo and not self.config().get("screens")

    # ---------- configuration ----------
    def config(self):
        now = time.monotonic()
        if now - self.checked > 2:
            self.checked = now
            try:
                m = CONFIG.stat().st_mtime
            except OSError:
                m = None
            if m != self.mtime:
                self.mtime = m
                try:
                    self.conf = json.loads(CONFIG.read_text(encoding="utf-8")) if m else {}
                    if m:
                        self.log(f"Screens: {len(self.conf.get('screens', {}))} live screen(s) from {CONFIG.name}")
                except (OSError, ValueError) as e:
                    self.log(f"Screens: can't read {CONFIG}: {e}")
                    self.conf = {}
                self.cache.clear()
        return self.conf

    def screens(self):
        """Configured screens, then the built-in G1000 pop-outs (Windows only)."""
        out = dict(self.config().get("screens", {}))
        if WIN:
            for name, spec in DEFAULTS.items():
                out.setdefault(name, spec)
        return out

    def fps(self):
        return max(1.0, min(30.0, float(self.config().get("fps", 8))))

    def info(self):
        if self.demo_only():
            return {"available": True, "screens": [{"name": self.DEMO, "label": "Demo FLIR (fake picture)", "w": DemoFlir.W, "h": DemoFlir.H}],
                    "fps": 10, "format": "png", "error": ""}
        screens = [{"name": n, "label": s.get("label", n), "w": s.get("w"), "h": s.get("h"), "window": s.get("window")}
                   for n, s in self.screens().items()]
        err = "" if WIN else "live screens need the bridge to run on Windows"
        if WIN and not self.config().get("screens"):  # only the built-in G1000 pop-outs
            err = "no screens set up yet - run setup-screens.bat on the PC"
        return {"available": WIN and bool(screens), "screens": screens, "fps": self.fps(),
                "format": "jpeg" if Image is not None or cv2 is not None else "png", "error": err,
                "hidden": WIN and WindowsCapture is not None}  # windows may be covered / minimised

    # ---------- capture ----------
    def report(self, wins):
        """Say in the bridge window which MSFS pop-outs were found, whenever that changes."""
        pops = msfs_popouts(wins)
        seen = [(t[0], t[3], t[4]) for t in pops]
        if seen != self.seen:
            self.seen = seen
            if pops:
                self.log("Screens: MSFS pop-outs, left to right: " + ", ".join(
                    f"#{i} {t[3]}x{t[4]}" + (f" '{t[0][:30]}'" if t[0] else "") for i, t in enumerate(pops, 1)) +
                    (" - they may sit behind the sim or be minimised" if WindowsCapture else
                     " - keep them visible on the PC screen, or run install-screen-capture.bat so they can hide"))
            else:
                self.log(f"Screens: no MSFS pop-out yet (MSFS windows seen: {describe(wins)}) - "
                         "in the cockpit, hold Right-Alt and click the PFD, then the MFD")

    def grab(self, spec):
        if "popout" in spec or "window" in spec:
            if "popout" in spec:
                wins = msfs_windows(minimised=WindowsCapture is not None)
                self.report(wins)
                hwnd = find_target(spec, wins)
            else:
                hwnd = find_target(spec)
            if WindowsCapture is not None and hwnd not in self.wgc_failed:
                try:
                    return self.grab_wgc(hwnd, spec)
                except OSError as e:
                    self.wgc_failed.add(hwnd)
                    self.log(f"Screens: {e} - copying the window off the screen instead, so it must stay visible")
            if user32.IsIconic(hwnd):
                raise LookupError("the pop-out is minimised: restore it and keep it visible on the PC screen")
            x, y, w, h = window_rect(spec, hwnd)
        else:
            x, y, w, h = (int(spec[k]) for k in ("x", "y", "w", "h"))
        if w <= 0 or h <= 0:
            raise ValueError(f"bad size {w}x{h}")
        k = min(1.0, MAX_SIDE / max(w, h))
        ow, oh = max(1, round(w * k)), max(1, round(h * k))
        return encode(grab_bgra(x, y, w, h, ow, oh), ow, oh, int(self.config().get("quality", 70)))

    def grab_wgc(self, hwnd, spec):
        """A window's picture through Windows Graphics Capture: its inside (or the x / y / w / h part of it)."""
        with self.wgc_lock:
            now = time.monotonic()
            for h, ses in list(self.wgc.items()):  # stop captures of closed windows, or that nobody watched lately
                if ses.closed or now - ses.used > 30:
                    ses.stop()
                    del self.wgc[h]
            ses = self.wgc.get(hwnd)
            if ses is None:
                ses = self.wgc[hwnd] = WgcSession(hwnd, 0.5 / self.fps())
        img = ses.latest()
        fh, fw = img.shape[:2]
        box = client_box(hwnd, fw, fh)
        if box:
            ses.box = box  # remembered for when the window gets minimised
        left, top, right, bottom = box or ses.box or (0, 0, fw, fh)
        x0, y0 = left + int(spec.get("x", 0)), top + int(spec.get("y", 0))
        x1 = x0 + int(spec["w"]) if "w" in spec else right
        y1 = y0 + int(spec["h"]) if "h" in spec else bottom
        img = img[max(0, y0):min(fh, y1), max(0, x0):min(fw, x1)]
        h, w = img.shape[:2]
        if not w or not h:
            raise ValueError(f"empty picture ({fw}x{fh} window picture, part {x0},{y0} to {x1},{y1})")
        k = min(1.0, MAX_SIDE / max(w, h))
        if k < 1:
            img = cv2.resize(img, (max(1, round(w * k)), max(1, round(h * k))), interpolation=cv2.INTER_AREA)
            h, w = img.shape[:2]
        return encode(numpy.ascontiguousarray(img).tobytes(), w, h, int(self.config().get("quality", 70)))

    async def frame(self, name):
        """(content type, bytes) of the newest picture of screen `name`; raises LookupError / OSError."""
        if self.demo_only() and name == self.DEMO:
            if self.demo_flir is None:
                self.demo_flir = await asyncio.to_thread(DemoFlir)
            return await asyncio.to_thread(self.demo_flir.frame)
        if not WIN:
            raise OSError("live screens need the bridge to run on Windows")
        spec = self.screens().get(name)
        if spec is None:
            raise LookupError(f"screen '{name}' is not set up (run setup-screens.bat or edit bridge/data/screens.json)")
        dt = 1.0 / self.fps()
        c = self.cache.get(name)
        if c and time.monotonic() - c[0] < dt:
            return c[1], c[2]
        lock = self.locks.setdefault(name, asyncio.Lock())
        async with lock:  # several iPads watching the same screen share one capture
            c = self.cache.get(name)
            if c and time.monotonic() - c[0] < dt:
                return c[1], c[2]
            ctype, data = await asyncio.to_thread(self.grab, spec)
            self.cache[name] = (time.monotonic(), ctype, data)
            return ctype, data
