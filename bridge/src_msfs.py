"""
MSFS 2020 / 2024 direct connection through SimConnect.

Pure ctypes against the native SimConnect.dll - no pip packages.
Every SimVar gets its own data definition + request, so one bad SimVar name
only disables itself instead of shifting everything after it.

Mapping lives in msfs.json (canonical dashboard key -> SimVar, input name -> K: event).
"""
import asyncio
import ctypes
import ctypes.wintypes as wt
import glob
import json
import os
import string
import struct
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent

# SimConnect constants
RECV_EXCEPTION, RECV_OPEN, RECV_QUIT, RECV_SIMOBJECT_DATA = 1, 2, 3, 8
PERIOD_VISUAL_FRAME, PERIOD_SECOND = 2, 4
FLAG_CHANGED = 1
DT_FLOAT64, DT_STRING256 = 4, 9
UNUSED = 0xFFFFFFFF
USER_OBJECT = 0
GROUP_PRIORITY_HIGHEST = 1
EVENT_FLAG_GROUPID_IS_PRIORITY = 0x10
TITLE_ID = 9999
EXCEPTIONS = {1: "ERROR", 2: "SIZE_MISMATCH", 3: "UNRECOGNIZED_ID", 4: "UNOPENED", 5: "VERSION_MISMATCH",
              7: "NAME_UNRECOGNIZED", 12: "DATA_ERROR", 20: "EVENT_ID_DUPLICATE"}


def find_dll(extra=None):
    """SimConnect.dll ships with the MSFS SDK and with many add-ons (SimHub, MobiFlight...)."""
    cands = [extra, os.environ.get("SIMCONNECT_DLL"), str(HERE / "SimConnect.dll")]
    for drive in string.ascii_uppercase[2:8]:  # C..H
        cands += [f"{drive}:\\MSFS 2024 SDK\\SimConnect SDK\\lib\\SimConnect.dll",
                  f"{drive}:\\MSFS SDK\\SimConnect SDK\\lib\\SimConnect.dll"]
    for pf in (os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"), os.environ.get("ProgramFiles", r"C:\Program Files")):
        cands.append(os.path.join(pf, "SimHub", "_Addons", "GamePlugins", "FlightSimulator", "SimConnect.dll"))
        cands += glob.glob(os.path.join(pf, "MobiFlight", "**", "SimConnect.dll"), recursive=True)
    cands += glob.glob(os.path.join(os.environ.get("LOCALAPPDATA", ""), "MobiFlight", "**", "SimConnect.dll"), recursive=True)
    for c in cands:
        if c and os.path.isfile(c):
            return c
    return None


def load_dll(path):
    d = ctypes.WinDLL(path)
    H, DW, HR = wt.HANDLE, wt.DWORD, ctypes.c_long
    sig = {
        "SimConnect_Open": [ctypes.POINTER(H), ctypes.c_char_p, wt.HWND, DW, H, DW],
        "SimConnect_Close": [H],
        "SimConnect_AddToDataDefinition": [H, DW, ctypes.c_char_p, ctypes.c_char_p, ctypes.c_int, ctypes.c_float, DW],
        "SimConnect_RequestDataOnSimObject": [H, DW, DW, DW, ctypes.c_int, DW, DW, DW, DW],
        "SimConnect_GetNextDispatch": [H, ctypes.POINTER(ctypes.c_void_p), ctypes.POINTER(DW)],
        "SimConnect_MapClientEventToSimEvent": [H, DW, ctypes.c_char_p],
        "SimConnect_TransmitClientEvent": [H, DW, DW, DW, DW, ctypes.c_int],
        "SimConnect_GetLastSentPacketID": [H, ctypes.POINTER(DW)],
    }
    for name, args in sig.items():
        f = getattr(d, name)
        f.argtypes, f.restype = args, HR
    return d


class MsfsSource:
    name = "msfs"
    label = "MSFS"

    def __init__(self, bridge, log):
        self.b, self.log = bridge, log
        self.cfg_path = HERE / "msfs.json"
        self.cfg = json.loads(self.cfg_path.read_text(encoding="utf-8"))
        self.dll = None
        self.h = None
        self.connected = False
        self.title = ""
        self.last_msg = 0
        self.req_key = {}     # request id -> canonical key
        self.scale = {}       # canonical key -> scale
        self.sent = {}        # packet id -> description (for exception messages)
        self.events = {}      # sim event name -> client event id
        self.hidden = {}      # values used only for derived keys

    @property
    def live(self):
        return self.connected

    def status(self):
        return {"connected": self.connected, "aircraft": self.title, "dll": bool(self.dll)}

    # ---------------------------------------------------------------- run
    async def run(self):
        path = find_dll(self.cfg.get("simconnect_dll"))
        if not path:
            self.log("MSFS: SimConnect.dll not found - MSFS direct connection disabled. "
                     "Install SimHub or the MSFS SDK, or put SimConnect.dll next to bridge.py.")
            return
        try:
            self.dll = load_dll(path)
        except (OSError, AttributeError) as e:
            self.log(f"MSFS: could not load {path}: {e}")
            return
        self.log(f"MSFS: using {path}")
        loop = asyncio.get_running_loop()
        waiting_logged = False
        while True:
            h = wt.HANDLE()
            hr = await loop.run_in_executor(None, lambda: self.dll.SimConnect_Open(ctypes.byref(h), b"SimDash", None, 0, None, 0))
            if hr != 0:
                if not waiting_logged:
                    self.log("MSFS: waiting for Microsoft Flight Simulator...")
                    waiting_logged = True
                await asyncio.sleep(5)
                continue
            waiting_logged = False
            self.h, self.last_msg = h, time.time()
            try:
                self.setup()
                while self.pump():
                    await asyncio.sleep(0.012)
            except OSError as e:
                self.log(f"MSFS: connection error {e}")
            self.close()
            await asyncio.sleep(2)

    def close(self):
        if self.h:
            try:
                self.dll.SimConnect_Close(self.h)
            except OSError:
                pass
        self.h, self.connected, self.title = None, False, ""
        self.events.clear()
        self.b.source_changed()
        self.log("MSFS: disconnected")

    def _track(self, what):
        pid = wt.DWORD()
        self.dll.SimConnect_GetLastSentPacketID(self.h, ctypes.byref(pid))
        self.sent[pid.value] = what

    def setup(self):
        dll, h = self.dll, self.h
        self.req_key.clear()
        self.sent.clear()
        rid = 1
        for key, spec in self.cfg["vars"].items():
            if key.startswith("_README"):
                continue
            simvar, unit = spec[0], spec[1]
            self.scale[key] = spec[2] if len(spec) > 2 else 1
            dll.SimConnect_AddToDataDefinition(h, rid, simvar.encode(), unit.encode() if unit else None, DT_FLOAT64, 0.0, UNUSED)
            self._track(f"SimVar '{simvar}' ({key})")
            dll.SimConnect_RequestDataOnSimObject(h, rid, rid, USER_OBJECT, PERIOD_VISUAL_FRAME, FLAG_CHANGED, 0, 1, 0)
            self.req_key[rid] = key
            rid += 1
        # aircraft title, once a second (also a heartbeat)
        dll.SimConnect_AddToDataDefinition(h, TITLE_ID, b"TITLE", None, DT_STRING256, 0.0, UNUSED)
        dll.SimConnect_RequestDataOnSimObject(h, TITLE_ID, TITLE_ID, USER_OBJECT, PERIOD_SECOND, 0, 0, 0, 0)

    # ---------------------------------------------------------------- receive
    def pump(self):
        """Drain SimConnect messages. Returns False when the sim went away."""
        p, cb = ctypes.c_void_p(), wt.DWORD()
        out = {}
        while self.h and self.dll.SimConnect_GetNextDispatch(self.h, ctypes.byref(p), ctypes.byref(cb)) == 0:
            raw = ctypes.string_at(p.value, cb.value)
            _, _, rid = struct.unpack_from("<III", raw, 0)
            self.last_msg = time.time()
            if rid == RECV_SIMOBJECT_DATA:
                req = struct.unpack_from("<I", raw, 12)[0]
                if req == TITLE_ID:
                    t = raw[40:40 + 256].split(b"\0")[0].decode("utf-8", "replace")
                    if t != self.title:
                        self.title = t
                        self.log(f"MSFS: aircraft '{t}'")
                        self.b.source_changed()
                    continue
                key = self.req_key.get(req)
                if key:
                    out[key] = struct.unpack_from("<d", raw, 40)[0] * self.scale.get(key, 1)
            elif rid == RECV_OPEN:
                app = raw[12:12 + 256].split(b"\0")[0].decode("utf-8", "replace")
                self.connected = True
                self.log(f"MSFS: connected to {app}")
                self.b.source_changed()
            elif rid == RECV_EXCEPTION:
                exc, send_id, index = struct.unpack_from("<III", raw, 12)
                self.log(f"MSFS: SimConnect exception {EXCEPTIONS.get(exc, exc)} for {self.sent.get(send_id, 'packet %d' % send_id)}")
            elif rid == RECV_QUIT:
                self.log("MSFS: simulator closed")
                return False
        if out:
            self.b.push(self.derive(out), self)
        # no title heartbeat for 20 s -> assume the sim crashed/closed
        return time.time() - self.last_msg < 20

    def derive(self, out):
        for k in list(out):
            if k.startswith("_"):
                self.hidden[k] = out.pop(k)
        if "xpdr" in out:  # transponder comes back as BCD (0x1200 -> 1200)
            out["xpdr"] = int(format(int(out["xpdr"]), "x") or 0)
        cap = self.hidden.get("_fuel_cap")
        if "_fuel_qty" in self.hidden and cap:
            out["fuel"] = self.hidden["_fuel_qty"] / cap * 100
        return {k: round(v, 3) for k, v in out.items()}

    # ---------------------------------------------------------------- send
    async def input(self, name, action):
        spec = self.cfg["events"].get(name)
        if spec is None or not self.connected:
            return False
        if action == "release":  # K: events are one-shot, fired on press
            return True
        event, value = (spec, 0) if isinstance(spec, str) else (spec[0], spec[1])
        if isinstance(value, str) and value.startswith("$"):  # e.g. "$heading" = current value of a key
            value = self.b.state.get(value[1:], 0)
        eid = self.events.get(event)
        if eid is None:
            eid = len(self.events) + 1
            self.dll.SimConnect_MapClientEventToSimEvent(self.h, eid, event.encode())
            self._track(f"event '{event}' ({name})")
            self.events[event] = eid
        data = int(round(value)) & 0xFFFFFFFF
        hr = self.dll.SimConnect_TransmitClientEvent(self.h, USER_OBJECT, eid, data, GROUP_PRIORITY_HIGHEST, EVENT_FLAG_GROUPID_IS_PRIORITY)
        if hr != 0:
            self.log(f"MSFS: failed to send {event}")
        return True
