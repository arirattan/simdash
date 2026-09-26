"""
MSFS 2020 / 2024 direct connection through SimConnect.

Pure ctypes against the native SimConnect.dll - no pip packages.
Every SimVar gets its own data definition + request, so one bad SimVar name
only disables itself instead of shifting everything after it.

Mapping lives in msfs.json (canonical dashboard key -> SimVar, input name -> K: event).

Cockpit panel: MSFS 2020 (SU13+) / 2024 "input events" list every clickable control of the
loaded aircraft (switches, buttons, knobs - the same ones you click in the 3D cockpit).
They are enumerated when the aircraft changes, their values subscribed, and they are shown
on the iPad "Cockpit" dashboard exactly like DCS-BIOS controls.

H: events ("H:AS1000_PFD_SOFTKEYS_1"): the G1000 NXi keys only react to these, and SimConnect can't
send them by itself. The MobiFlight WASM module (Community folder, install-mobiflight-module.bat)
registers an event "MobiFlight.<name>" for each one that runs (>H:<name>), so they're sent as that.
"""
import asyncio
import ctypes
import ctypes.wintypes as wt
import glob
import json
import os
import re
import string
import struct
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent

# SimConnect constants
RECV_EXCEPTION, RECV_OPEN, RECV_QUIT, RECV_SIMOBJECT_DATA = 1, 2, 3, 8
RECV_ENUMERATE_INPUT_EVENTS, RECV_GET_INPUT_EVENT, RECV_SUBSCRIBE_INPUT_EVENT = 34, 35, 36
IE_DESCRIPTOR_SIZE = 76          # char Name[64] + UINT64 Hash + DWORD eType, pack(1)
IE_ENUM_REQ, IE_GET_REQ_BASE = 50000, 60000
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
        # (hSimConnect, ObjectID, EventID, GroupID, Flags, dwData0..dwData4) - multi-parameter events
        "SimConnect_TransmitClientEvent_EX1": [H, DW, DW, DW, ctypes.c_int, DW, DW, DW, DW, DW],
        "SimConnect_GetLastSentPacketID": [H, ctypes.POINTER(DW)],
        # input events (MSFS 2020 SU13+ / 2024) - optional
        "SimConnect_EnumerateInputEvents": [H, DW],
        "SimConnect_GetInputEvent": [H, DW, ctypes.c_uint64],
        "SimConnect_SetInputEvent": [H, ctypes.c_uint64, DW, ctypes.c_void_p],
        "SimConnect_SubscribeInputEvent": [H, ctypes.c_uint64],
    }
    for name, args in sig.items():
        f = getattr(d, name, None)
        if f is None:
            continue
        f.argtypes, f.restype = args, HR
    return d


PUSH_RE = re.compile(r"push|button|btn|softkey|press|ident|swap|test|_clr|_ent\b|menu|directto|_fpl|_proc", re.I)
ANALOG_RE = re.compile(r"knob|dial|wheel|volume|vol_|bright|dimmer|pot|trim|heading|course|obs|baro|freq|range|axis|lever|throttle|mixture|propeller|condition|collective|cyclic|pedal", re.I)


def pretty(name):
    return re.sub(r"_+", " ", name).strip()


def classify(name, value):
    """Turn an input event into a control description for the iPad (same format as DCS-BIOS controls)."""
    e = {"id": name, "d": pretty(name)}
    if PUSH_RE.search(name):
        e.update(t="selector", v="momentary_last_position", i=[["s", 1]], max=1)
    elif value in (0, 1) and not ANALOG_RE.search(name):
        e.update(t="selector", p=["OFF", "ON"], i=[["s", 1], ["f"], ["a", "TOGGLE"]], max=1)
    else:
        e.update(t="fixed_step_dial", i=[["f"], ["s", 100]], max=100)
    return e


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
        self.ie = {}          # input event name -> [hash, type]
        self.ie_by_hash = {}  # hash -> name
        self.ie_vals = {}     # name -> value
        self.ie_get = {}      # request id -> name
        self.ie_pending = 0   # outstanding initial GetInputEvent answers
        self.ie_ready_at = 0
        self.panel = None     # cockpit control list for the iPad

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
                while True:
                    try:
                        if not self.pump():
                            break
                    except OSError:
                        raise
                    except Exception as e:  # a bad value must never kill the connection
                        self.log(f"MSFS: skipped a bad update ({e!r})")
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
        self.ie, self.ie_by_hash, self.ie_vals, self.panel = {}, {}, {}, None
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
                        self.enumerate_input_events()
                        self.b.source_changed()
                    continue
                key = self.req_key.get(req)
                if key:
                    out[key] = struct.unpack_from("<d", raw, 40)[0] * self.scale.get(key, 1)
            elif rid == RECV_OPEN:
                app = raw[12:12 + 256].split(b"\0")[0].decode("utf-8", "replace")
                self.connected = True
                self.log(f"MSFS: connected to {app}")
                self.check_mobiflight()
                self.b.source_changed()
            elif rid == RECV_EXCEPTION:
                exc, send_id, index = struct.unpack_from("<III", raw, 12)
                self.log(f"MSFS: SimConnect exception {EXCEPTIONS.get(exc, exc)} for {self.sent.get(send_id, 'packet %d' % send_id)}")
            elif rid == RECV_ENUMERATE_INPUT_EVENTS:
                self.on_ie_list(raw)
            elif rid == RECV_GET_INPUT_EVENT:
                req, etype = struct.unpack_from("<II", raw, 12)
                name = self.ie_get.pop(req, None)
                if name and etype == 0:
                    self.ie_vals[name] = struct.unpack_from("<d", raw, 20)[0]
                    self.ie_pending -= 1
            elif rid == RECV_SUBSCRIBE_INPUT_EVENT:
                h, etype = struct.unpack_from("<QI", raw, 12)
                name = self.ie_by_hash.get(h)
                if name and etype == 0:
                    v = struct.unpack_from("<d", raw, 24)[0]
                    self.ie_vals[name] = v
                    if self.panel:
                        self.b.push_bios({name: round(v, 4)})
            elif rid == RECV_QUIT:
                self.log("MSFS: simulator closed")
                return False
        if out:
            self.b.push(self.derive(out), self)
        if self.ie and not self.panel and (self.ie_pending <= 0 or time.time() > self.ie_ready_at):
            self.build_panel()
        # no title heartbeat for 20 s -> assume the sim crashed/closed
        return time.time() - self.last_msg < 20

    def derive(self, out):
        for k in list(out):
            if k.startswith("_"):
                self.hidden[k] = out.pop(k)
        if "xpdr" in out:
            # MSFS 2024 reports the squawk as a plain number (7000); older builds used BCD (0x7000 = 28672)
            v = int(out["xpdr"])
            digits = str(v)
            if len(digits) > 4 or any(c in "89" for c in digits):
                digits = format(v, "x")
            out["xpdr"] = int(digits) if digits.isdigit() else 0
        cap = self.hidden.get("_fuel_cap")
        if "_fuel_qty" in self.hidden and cap:
            out["fuel"] = self.hidden["_fuel_qty"] / cap * 100
        return {k: round(v, 3) for k, v in out.items()}

    # ---------------------------------------------------------------- input events (cockpit panel)
    def enumerate_input_events(self):
        self.ie, self.ie_by_hash, self.ie_vals, self.panel = {}, {}, {}, None
        self.ie_ready_at = time.time() + 5
        if self.h and hasattr(self.dll, "SimConnect_EnumerateInputEvents"):
            self.dll.SimConnect_EnumerateInputEvents(self.h, IE_ENUM_REQ)

    def on_ie_list(self, raw):
        req, count, entry, out_of = struct.unpack_from("<4I", raw, 12)
        for i in range(count):
            o = 28 + i * IE_DESCRIPTOR_SIZE
            if o + IE_DESCRIPTOR_SIZE > len(raw):
                break
            name = raw[o:o + 64].split(b"\0")[0].decode("utf-8", "replace")
            h, etype = struct.unpack_from("<QI", raw, o + 64)
            if name:
                self.ie[name] = [h, etype]
                self.ie_by_hash[h] = name
        if entry + 1 >= out_of:  # last packet: read current values and subscribe to changes
            self.ie_get, self.ie_pending = {}, 0
            for n, name in enumerate(self.ie):
                h, etype = self.ie[name]
                if etype != 0:  # string input events are rare; skip them
                    continue
                req_id = IE_GET_REQ_BASE + n
                self.ie_get[req_id] = name
                self.ie_pending += 1
                self.dll.SimConnect_GetInputEvent(self.h, req_id, h)
                self.dll.SimConnect_SubscribeInputEvent(self.h, h)
            self.ie_ready_at = time.time() + 2

    def build_panel(self):
        cats = {}
        for name in sorted(self.ie):
            if self.ie[name][1] != 0:
                continue
            cat = name.split("_", 1)[0].upper() if "_" in name else "OTHER"
            cats.setdefault(cat, []).append(classify(name, self.ie_vals.get(name)))
        self.panel = {"aircraft": self.title, "categories": [{"name": c, "module": "MSFS", "controls": v} for c, v in sorted(cats.items())]}
        self.log(f"MSFS: cockpit panel for '{self.title}' - {sum(len(v) for v in cats.values())} controls")
        self.b.push_bios({k: round(v, 4) for k, v in self.ie_vals.items()})
        self.b.source_changed()

    async def bios_input(self, name, arg):
        """Set an input event from the iPad cockpit panel. arg: number, TOGGLE, INC, DEC, +n, -n."""
        if name not in self.ie or not self.h:
            return False
        h = self.ie[name][0]
        cur = self.ie_vals.get(name, 0.0)
        if arg == "TOGGLE":
            v = 0.0 if cur else 1.0
        elif arg in ("INC", "DEC"):
            step = 1.0 if (abs(cur) >= 2 or cur == int(cur)) else 0.05
            v = cur + (step if arg == "INC" else -step)
        elif arg[:1] in "+-" and len(arg) > 1:
            v = cur + float(arg)
        else:
            try:
                v = float(arg)
            except ValueError:
                return False
        val = ctypes.c_double(v)
        self.dll.SimConnect_SetInputEvent(self.h, h, 8, ctypes.byref(val))
        self._track(f"input event '{name}' = {v}")
        return True

    def check_mobiflight(self):
        """Tell the bridge window and the iPad (key g1000_keys) whether the G1000 keys can work."""
        from msfs_community import community_dirs, mobiflight_module
        mod = mobiflight_module()
        if mod:
            self.log(f"MSFS: G1000 keys go through the MobiFlight WASM module ({mod})")
        else:
            where = ", ".join(str(d) for d in community_dirs()) or "no Community folder found"
            self.log("MSFS: the G1000 keys (softkeys, FMS knob, ENT, CLR...) need the MobiFlight WASM module, which isn't "
                     f"in the Community folder ({where}) - run install-mobiflight-module.bat, then restart MSFS")
        self.b.push({"g1000_keys": 1 if mod else 0})

    # ---------------------------------------------------------------- send
    def value_of(self, v):
        """Numbers pass through; "$key", "$key+100", "$key-1000" read the current dashboard value."""
        if isinstance(v, str) and v.startswith("$"):
            m = re.match(r"^\$([a-z0-9_]+)\s*([+-]\s*[0-9.]+)?$", v)
            if not m:
                return 0
            return float(self.b.state.get(m.group(1), 0) or 0) + float((m.group(2) or "0").replace(" ", ""))
        return v

    async def input(self, name, action):
        if name.startswith("@"):
            # direct cockpit input event from a panel, e.g. "@AS1000_PFD_1_FMS_Inner_Button"
            if not self.connected or name[1:] not in self.ie:
                return False
            if action != "release":
                await self.bios_input(name[1:], "1")
            return True
        if name.startswith("H:"):
            # H: event, e.g. "H:AS1000_PFD_SOFTKEYS_1" (G1000 NXi keys), through the MobiFlight WASM module
            if not re.match(r"^[A-Za-z0-9_]+$", name[2:]) or not self.connected:
                return False
            if action != "release":
                self.send_event("MobiFlight." + name[2:], [0], name)
            return True
        if name.startswith("K:"):
            # direct sim event from a panel: "K:AP_MASTER", "K:THROTTLE_SET=8192", "K:SOME_EVENT=16384,1"
            m = re.match(r"^([A-Z0-9_]+)(?:=(-?\d+(?:,-?\d+){0,4}))?$", name[2:])
            if not m or not self.connected:
                return False
            spec = [m.group(1)] + [int(x) for x in m.group(2).split(",")] if m.group(2) else m.group(1)
        else:
            spec = self.cfg["events"].get(name)
        if spec is None or not self.connected:
            return False
        head = spec if isinstance(spec, str) else str(spec[0])
        if head.startswith("@"):
            # "@INPUT_EVENT_NAME" or ["@INPUT_EVENT_NAME", value]: drive a cockpit input event directly
            if action != "release":
                value = 1 if isinstance(spec, str) else spec[1]
                await self.bios_input(head[1:], str(value))
            return True
        if action == "release":  # K: events are one-shot, fired on press
            return True
        if isinstance(spec, str):
            event, values = spec, [0]
        else:
            event, values = spec[0], [self.value_of(v) for v in spec[1:]] or [0]
        self.send_event(event, values, name)
        return True

    def send_event(self, event, values, name):
        """Fire a sim event (or a client event such as "MobiFlight.X") with up to 5 values."""
        eid = self.events.get(event)
        if eid is None:
            eid = len(self.events) + 1
            self.dll.SimConnect_MapClientEventToSimEvent(self.h, eid, event.encode())
            self._track(f"event '{event}' ({name})")
            self.events[event] = eid
        data = [int(round(float(v))) & 0xFFFFFFFF for v in values]
        if len(data) > 1 and hasattr(self.dll, "SimConnect_TransmitClientEvent_EX1"):
            data += [0] * (5 - len(data))
            hr = self.dll.SimConnect_TransmitClientEvent_EX1(self.h, USER_OBJECT, eid, GROUP_PRIORITY_HIGHEST, EVENT_FLAG_GROUPID_IS_PRIORITY, *data[:5])
        else:
            hr = self.dll.SimConnect_TransmitClientEvent(self.h, USER_OBJECT, eid, data[0], GROUP_PRIORITY_HIGHEST, EVENT_FLAG_GROUPID_IS_PRIORITY)
        if hr != 0:
            self.log(f"MSFS: failed to send {event}")
