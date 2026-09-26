"""
Live screens for the iPad
=========================

Streams parts of the PC screen to the iPad as pictures it refreshes several times a second:

* DCS displays exported with setup_screens.py - e.g. the AH-64D MPDs (TSD, FCR radar, video pages)
  and the TEDAC with the TADS FLIR / TV picture, or the MFDs of the F/A-18, F-16, A-10...
* any window or area of the desktop you add to bridge/data/screens.json (e.g. an MSFS pop-out window).

bridge/data/screens.json:
    {
      "fps": 8,
      "quality": 70,
      "screens": {
        "LEFT_MFCD": {"label": "Left MFD", "x": 1920, "y": 0, "w": 640, "h": 640},
        "PFD":       {"label": "MSFS PFD pop-out", "window": "PFD"}
      }
    }
  x / y / w / h are desktop pixels. With "window", x / y / w / h are optional and relative to that
  window's inside (so a part of a window can be shown).

Windows only (GDI through ctypes, no pip packages). Pictures are PNG; if Pillow is installed
(pip install pillow) they are JPEG instead, which is about 10x smaller and so smoother on Wi-Fi.
"""

import asyncio
import ctypes
import io
import json
import struct
import sys
import time
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
CONFIG = HERE / "data" / "screens.json"

try:
    from PIL import Image  # optional: JPEG instead of PNG
except ImportError:
    Image = None

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
    user32.GetClientRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
    user32.ClientToScreen.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.POINT)]

    class BITMAPINFOHEADER(ctypes.Structure):
        _fields_ = [("biSize", wintypes.DWORD), ("biWidth", wintypes.LONG), ("biHeight", wintypes.LONG),
                    ("biPlanes", wintypes.WORD), ("biBitCount", wintypes.WORD), ("biCompression", wintypes.DWORD),
                    ("biSizeImage", wintypes.DWORD), ("biXPelsPerMeter", wintypes.LONG),
                    ("biYPelsPerMeter", wintypes.LONG), ("biClrUsed", wintypes.DWORD), ("biClrImportant", wintypes.DWORD)]

    class BITMAPINFO(ctypes.Structure):
        _fields_ = [("bmiHeader", BITMAPINFOHEADER), ("bmiColors", wintypes.DWORD * 3)]

SRCCOPY = 0x00CC0020
MAX_SIDE = 2048


def grab_bgra(x, y, w, h):
    """Desktop pixels -> top-down BGRA bytes."""
    screen = user32.GetDC(None)
    mem = gdi32.CreateCompatibleDC(screen)
    bmp = gdi32.CreateCompatibleBitmap(screen, w, h)
    old = gdi32.SelectObject(mem, bmp)
    try:
        if not gdi32.BitBlt(mem, 0, 0, w, h, screen, x, y, SRCCOPY):
            raise OSError("screen capture failed (BitBlt)")
        bmi = BITMAPINFO()
        bmi.bmiHeader.biSize = ctypes.sizeof(BITMAPINFOHEADER)
        bmi.bmiHeader.biWidth, bmi.bmiHeader.biHeight = w, -h  # negative = top-down rows
        bmi.bmiHeader.biPlanes, bmi.bmiHeader.biBitCount = 1, 32
        buf = ctypes.create_string_buffer(w * h * 4)
        if gdi32.GetDIBits(mem, bmp, 0, h, buf, ctypes.byref(bmi), 0) != h:
            raise OSError("screen capture failed (GetDIBits)")
        return buf.raw
    finally:
        gdi32.SelectObject(mem, old)
        gdi32.DeleteObject(bmp)
        gdi32.DeleteDC(mem)
        user32.ReleaseDC(None, screen)


def find_window(title):
    """First visible window whose title contains `title` (case-insensitive)."""
    want, found = title.lower(), []

    def cb(hwnd, _):
        if user32.IsWindowVisible(hwnd) and not user32.IsIconic(hwnd):
            n = user32.GetWindowTextLengthW(hwnd)
            if n:
                b = ctypes.create_unicode_buffer(n + 1)
                user32.GetWindowTextW(hwnd, b, n + 1)
                if want in b.value.lower():
                    found.append(hwnd)
                    return False
        return True

    user32.EnumWindows(EnumWindowsProc(cb), 0)
    return found[0] if found else None


def window_rect(spec):
    hwnd = find_window(spec["window"])
    if not hwnd:
        raise LookupError(f"window '{spec['window']}' not found (is it open and not minimised?)")
    r, p = wintypes.RECT(), wintypes.POINT(0, 0)
    user32.GetClientRect(hwnd, ctypes.byref(r))
    user32.ClientToScreen(hwnd, ctypes.byref(p))
    x, y = p.x + int(spec.get("x", 0)), p.y + int(spec.get("y", 0))
    w = int(spec.get("w", r.right - int(spec.get("x", 0))))
    h = int(spec.get("h", r.bottom - int(spec.get("y", 0))))
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
    return "image/png", png(bgra, w, h)


class Screens:
    DEMO = "CENTER_MFCD"  # --demo without screens.json: a fake FLIR picture on the Apache TEDAC

    def __init__(self, log, demo=False):
        self.log = log
        self.demo, self.demo_flir = demo, None
        self.conf, self.mtime, self.checked = {}, None, 0.0
        self.cache, self.locks = {}, {}

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

    def fps(self):
        return max(1.0, min(30.0, float(self.config().get("fps", 8))))

    def info(self):
        if self.demo_only():
            return {"available": True, "screens": [{"name": self.DEMO, "label": "Demo FLIR (fake picture)", "w": DemoFlir.W, "h": DemoFlir.H}],
                    "fps": 10, "format": "png", "error": ""}
        conf = self.config()
        screens =[{"name": n, "label": s.get("label", n), "w": s.get("w"), "h": s.get("h"), "window": s.get("window")}
                   for n, s in conf.get("screens", {}).items()]
        err = "" if WIN else "live screens need the bridge to run on Windows"
        if WIN and not screens:
            err = "no screens set up yet - run setup-screens.bat on the PC"
        return {"available": WIN and bool(screens), "screens": screens, "fps": self.fps(),
                "format": "jpeg" if Image is not None else "png", "error": err}

    # ---------- capture ----------
    def grab(self, spec):
        if "window" in spec:
            x, y, w, h = window_rect(spec)
        else:
            x, y, w, h = (int(spec[k]) for k in ("x", "y", "w", "h"))
        if not (0 < w <= MAX_SIDE and 0 < h <= MAX_SIDE):
            raise ValueError(f"bad size {w}x{h}")
        return encode(grab_bgra(x, y, w, h), w, h, int(self.config().get("quality", 70)))

    async def frame(self, name):
        """(content type, bytes) of the newest picture of screen `name`; raises LookupError / OSError."""
        if self.demo_only() and name == self.DEMO:
            if self.demo_flir is None:
                self.demo_flir = await asyncio.to_thread(DemoFlir)
            return await asyncio.to_thread(self.demo_flir.frame)
        if not WIN:
            raise OSError("live screens need the bridge to run on Windows")
        spec = self.config().get("screens", {}).get(name)
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
