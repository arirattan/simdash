"""
DCS World direct connection.

* Flight data  : SimDash.lua export -> UDP 127.0.0.1:7790 (JSON)            -> canonical keys (ias, alt, ...)
* Cockpit state: DCS-BIOS export    -> UDP multicast 239.255.50.10:5010     -> every switch / lamp / display
* Commands     : "IDENTIFIER ARGUMENT\n" -> UDP 127.0.0.1:7778 (DCS-BIOS import)

DCS-BIOS assigns memory addresses at runtime and documents them in
Saved Games\\DCS\\Scripts\\DCS-BIOS\\doc\\json\\<module>.json - we read those files.
"""
import asyncio
import json
import os
import re
import socket
import struct
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
IDENT_RE = re.compile(r"^[A-Za-z0-9_]+$")
ARG_RE = re.compile(r"^[-+A-Za-z0-9_.]+$")


def find_doc_dir(override=None):
    if override and os.path.isdir(override):
        return Path(override)
    home = Path(os.environ.get("USERPROFILE", str(Path.home())))
    best = None
    for sg in sorted((home / "Saved Games").glob("DCS*")):
        d = sg / "Scripts" / "DCS-BIOS" / "doc" / "json"
        if (d / "AircraftAliases.json").is_file():
            m = (d / "AircraftAliases.json").stat().st_mtime
            if not best or m > best[0]:
                best = (m, d)
    return best[1] if best else None


class BiosParser:
    """DCS-BIOS export stream -> 64 KB memory image (same state machine as the official Arduino library)."""
    WAIT, ADDR_LO, ADDR_HI, CNT_LO, CNT_HI, DATA_LO, DATA_HI = range(7)

    def __init__(self):
        self.mem = bytearray(65536)
        self.state = self.WAIT
        self.sync = 0
        self.addr = self.count = self.data = 0
        self.dirty = set()

    def feed(self, buf):
        S = self
        for c in buf:
            st = S.state
            if st == S.ADDR_LO:
                S.addr = c
                S.state = S.ADDR_HI
            elif st == S.ADDR_HI:
                S.addr |= c << 8
                S.state = S.CNT_LO if S.addr != 0x5555 else S.WAIT
            elif st == S.CNT_LO:
                S.count = c
                S.state = S.CNT_HI
            elif st == S.CNT_HI:
                S.count |= c << 8
                S.state = S.DATA_LO
            elif st == S.DATA_LO:
                S.data = c
                S.count -= 1
                S.state = S.DATA_HI
            elif st == S.DATA_HI:
                S.count -= 1
                a = S.addr
                if a < 65535:
                    S.mem[a] = S.data
                    S.mem[a + 1] = c
                    S.dirty.add(a)
                S.addr += 2
                S.state = S.DATA_LO if S.count > 0 else S.ADDR_LO
            if c == 0x55:
                S.sync += 1
                if S.sync == 4:
                    S.state, S.sync = S.ADDR_LO, 0
            else:
                S.sync = 0

    def word(self, a):
        return self.mem[a] | (self.mem[a + 1] << 8)

    def string(self, a, n):
        return bytes(self.mem[a:a + n]).split(b"\0")[0].decode("latin-1").rstrip()


class DcsSource:
    name = "dcs"
    label = "DCS"

    def __init__(self, bridge, log):
        self.b, self.log = bridge, log
        self.cfg = json.loads((HERE / "dcs.json").read_text(encoding="utf-8"))
        self.flip = self.cfg.get("flip", {})
        bios = self.cfg.get("bios", {})
        self.cmd_addr = (bios.get("command_host", "127.0.0.1"), bios.get("command_port", 7778))
        self.doc_dir_override = bios.get("doc_dir")
        self.export_aircraft = ""
        self.last_export = 0
        self.last_bios = 0
        self.parser = BiosParser()
        self.bios_aircraft = ""
        self.int_outputs = {}   # word address -> [(ident, mask, shift)]
        self.str_outputs = {}   # word address -> {ident}
        self.str_meta = {}      # ident -> (address, length)
        self.bios_values = {}   # ident -> value (int or str)
        self.panel = None       # compact control list for the iPad
        self.acft_map = None
        self.cmd_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

    # ------------------------------------------------------------------ status
    @property
    def live(self):
        return time.time() - self.last_export < 3 or time.time() - self.last_bios < 3

    @property
    def aircraft(self):
        return self.export_aircraft or self.bios_aircraft

    def status(self):
        now = time.time()
        return {"connected": self.live, "aircraft": self.aircraft,
                "export": now - self.last_export < 3, "bios": now - self.last_bios < 3,
                "bios_aircraft": self.bios_aircraft if self.panel else ""}

    # ------------------------------------------------------------------ run
    async def run(self):
        loop = asyncio.get_running_loop()
        port = self.cfg.get("export_port", 7790)
        try:
            await loop.create_datagram_endpoint(lambda: _Proto(self.on_export), local_addr=("127.0.0.1", port))
            self.log(f"DCS: listening for SimDash.lua flight data on UDP {port}")
        except OSError as e:
            self.log(f"DCS: cannot listen on UDP {port}: {e}")
        bios = self.cfg.get("bios", {})
        group, bport = bios.get("multicast_group", "239.255.50.10"), bios.get("export_port", 5010)
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            s.bind(("", bport))
            mreq = struct.pack("4s4s", socket.inet_aton(group), socket.inet_aton("0.0.0.0"))
            s.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)
            s.setblocking(False)
            await loop.create_datagram_endpoint(lambda: _Proto(self.on_bios), sock=s)
            self.log(f"DCS: listening for DCS-BIOS on {group}:{bport}")
        except OSError as e:
            self.log(f"DCS: cannot join DCS-BIOS multicast {group}:{bport}: {e}")
        was_live = False
        while True:  # notice DCS going quiet (mission ended / DCS closed)
            await asyncio.sleep(1)
            if was_live != self.live:
                was_live = self.live
                self.log("DCS: " + (f"receiving data ({self.aircraft or 'unknown aircraft'})" if was_live else "no data (mission ended or DCS closed)"))
                self.b.source_changed()

    # ------------------------------------------------------------------ flight data (SimDash.lua)
    def on_export(self, data, addr):
        try:
            m = json.loads(data)
        except ValueError:
            return
        name = m.pop("a", "")
        if name != self.export_aircraft:
            self.export_aircraft = name
            self.log(f"DCS: aircraft '{name}'" if name else "DCS: left aircraft")
            self.acft_map = self.match_aircraft(name)
            self.b.source_changed()
        if not name:
            self.last_export = 0
            return
        self.last_export = time.time()
        for k, f in self.flip.items():
            if f and k in m:
                m[k] = -m[k]
        # fuel: kg internal / external, shown as fuel_l / fuel_r readouts
        if "fuel_int" in m:
            m["fuel_l"] = m.pop("fuel_int")
        if "fuel_ext" in m:
            m["fuel_r"] = m.pop("fuel_ext")
        self.b.push(m, self)

    # ------------------------------------------------------------------ DCS-BIOS
    def on_bios(self, data, addr):
        self.last_bios = time.time()
        p = self.parser
        p.feed(data)
        if not p.dirty:
            return
        dirty, p.dirty = p.dirty, set()
        if any(a < 24 for a in dirty):  # MetadataStart _ACFT_NAME lives at 0x0000 (24 chars)
            name = p.string(0, 24)
            if name != self.bios_aircraft:
                self.set_bios_aircraft(name)
        changed = {}
        for a in dirty:
            for ident, mask, shift in self.int_outputs.get(a, ()):
                v = (p.word(a) & mask) >> shift
                if self.bios_values.get(ident) != v:
                    self.bios_values[ident] = changed[ident] = v
            for ident in self.str_outputs.get(a, ()):
                sa, n = self.str_meta[ident]
                v = p.string(sa, n)
                if self.bios_values.get(ident) != v:
                    self.bios_values[ident] = changed[ident] = v
        if changed:
            self.b.push_bios(changed)
            if self.acft_map:
                self.b.push(self.map_state(changed), self)

    def set_bios_aircraft(self, name):
        self.bios_aircraft = name
        self.int_outputs, self.str_outputs, self.str_meta = {}, {}, {}
        self.bios_values, self.panel = {}, None
        if not name or name == "NONE":
            self.b.source_changed()
            return
        doc_dir = find_doc_dir(self.doc_dir_override)
        if not doc_dir:
            self.log("DCS: DCS-BIOS is sending data but its doc\\json folder was not found - set bios.doc_dir in dcs.json")
            return
        try:
            aliases = json.loads((doc_dir / "AircraftAliases.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            aliases = {}
        modules = aliases.get(name) or [name]
        docs = []
        for mod in modules:
            f = doc_dir / f"{mod}.json"
            if f.is_file():
                try:
                    docs.append((mod, json.loads(f.read_text(encoding="utf-8"))))
                except ValueError as e:
                    self.log(f"DCS: could not read {f.name}: {e}")
        self.index(docs)
        if not self.acft_map:
            self.acft_map = self.match_aircraft(name)
        n = sum(len(c["controls"]) for c in self.panel["categories"])
        self.log(f"DCS-BIOS: aircraft '{name}' - {n} cockpit controls loaded ({', '.join(m for m, _ in docs)})")
        # resend everything currently in memory for the new layout
        self.parser.dirty.update(range(0, 65536, 2))
        self.b.source_changed()

    def index(self, docs):
        cats = []
        for mod, doc in docs:
            for cat, controls in doc.items():
                entries = []
                for ident, c in controls.items():
                    ctype = c.get("control_type", "")
                    for o in c.get("outputs", []):
                        if o.get("type") == "integer":
                            self.int_outputs.setdefault(o["address"], []).append((ident, o["mask"], o["shift_by"]))
                        elif o.get("type") == "string":
                            a, n = o["address"], o["max_length"]
                            self.str_meta[ident] = (a, n)
                            for w in range(a - (a % 2), a + n, 2):
                                self.str_outputs.setdefault(w, set()).add(ident)
                    if ctype == "metadata" or mod in ("MetadataStart", "MetadataEnd"):
                        continue
                    entries.append(compact_control(ident, c))
                if entries:
                    cats.append({"name": cat, "module": mod, "controls": entries})
        # aircraft module first, CommonData last
        cats.sort(key=lambda c: (c["module"] in ("CommonData", "NS430", "SuperCarrier"), 0))
        self.panel = {"aircraft": self.bios_aircraft, "categories": cats}

    # ------------------------------------------------------------------ generic dashboards <-> DCS-BIOS
    def match_aircraft(self, name):
        for key, spec in self.cfg.get("aircraft", {}).items():
            for pat in spec.get("match", [key]):
                if name and name.upper().startswith(pat.upper()):
                    return spec
        return None

    def map_state(self, changed):
        out = {}
        for key, spec in self.acft_map.get("state", {}).items():
            ident, table = (spec, None) if isinstance(spec, str) else (spec[0], spec[1])
            if ident in changed:
                v = changed[ident]
                out[key] = table.get(str(v), 0) if table is not None else v
        return out

    def send_cmd(self, line):
        ident, _, arg = line.partition(" ")
        if not IDENT_RE.match(ident) or not ARG_RE.match(arg):
            return False
        self.cmd_sock.sendto(f"{ident} {arg}\n".encode(), self.cmd_addr)
        return True

    async def bios_input(self, ident, arg):
        return self.send_cmd(f"{ident} {arg}")

    async def input(self, name, action):
        spec = (self.acft_map or {}).get("inputs", {}).get(name)
        if spec is None or not self.live:
            return False
        if isinstance(spec, str):
            if action != "release":
                self.send_cmd(spec)
            return True
        cover = spec.get("cover")
        if "toggle" in spec:
            if action == "release":
                return True
            if cover:
                self.send_cmd(f"{cover} 1")
            cur = self.bios_values.get(spec["toggle"])
            self.send_cmd(f"{spec['toggle']} {spec['off'] if cur == spec['on'] else spec['on']}")
            return True
        if action in ("press", "tap") and "press" in spec:
            if cover:
                self.send_cmd(f"{cover} 1")
            self.send_cmd(spec["press"])
            if action == "tap" and "release" in spec:
                await asyncio.sleep(0.1)
                self.send_cmd(spec["release"])
        elif action == "release" and "release" in spec:
            self.send_cmd(spec["release"])
        return True


def compact_control(ident, c):
    """Shrink a DCS-BIOS control description to what the iPad panel needs."""
    e = {"id": ident, "t": c.get("control_type", ""), "d": c.get("description", "")}
    if c.get("api_variant"):
        e["v"] = c["api_variant"]
    if c.get("positions"):
        e["p"] = c["positions"]
    if c.get("color"):
        e["c"] = c["color"]
    ins = []
    for i in c.get("inputs", []):
        it = i.get("interface")
        if it == "set_state":
            ins.append(["s", i.get("max_value", 1)])
        elif it == "fixed_step":
            ins.append(["f"])
        elif it == "variable_step":
            ins.append(["v", i.get("suggested_step", 3200), i.get("max_value", 65535)])
        elif it == "action":
            ins.append(["a", i.get("argument", "TOGGLE")])
    if ins:
        e["i"] = ins
    for o in c.get("outputs", []):
        if o.get("type") == "integer":
            e["max"] = o.get("max_value", 1)
            break
        if o.get("type") == "string":
            e["len"] = o.get("max_length", 1)
            break
    return e


class _Proto(asyncio.DatagramProtocol):
    def __init__(self, cb):
        self.cb = cb

    def datagram_received(self, data, addr):
        try:
            self.cb(data, addr)
        except Exception as e:  # never let a bad packet kill the listener
            print("DCS packet error:", e, flush=True)
