"""
SimDash bridge
==============

    iPad (Safari)  <--HTTP + WebSocket-->  bridge  <--SimConnect-->  MSFS 2020 / 2024
                                                   <--UDP-------->  DCS World (SimDash.lua + DCS-BIOS)
                                                   <--TCP-------->  SimHub Property Server (optional)

* Serves the dashboard web app (../web) so the iPad just opens a URL.
* Pushes sim values to the iPad as canonical keys (ias, alt, pitch, ...) plus,
  for DCS, every DCS-BIOS cockpit control.
* Turns touches on the iPad into sim commands (SimConnect events / DCS-BIOS commands).

Pure Python standard library - no pip install needed.

    python bridge.py                    # MSFS + DCS, whichever is running
    python bridge.py --demo             # fake flight data, no sim needed
    python bridge.py --source simhub    # old way: through SimHub's Property Server plugin
"""

import argparse
import asyncio
import base64
import hashlib
import json
import math
import mimetypes
import socket
import struct
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
WEB_ROOT = (HERE.parent / "web").resolve()
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("text/javascript", ".js")


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


# --------------------------------------------------------------------------- #
# Minimal WebSocket (RFC 6455) on asyncio streams
# --------------------------------------------------------------------------- #
class WSClient:
    def __init__(self, reader, writer):
        self.r, self.w = reader, writer
        self.alive = True
        self.peer = writer.get_extra_info("peername")

    async def send(self, obj):
        if not self.alive:
            return
        data = json.dumps(obj, separators=(",", ":")).encode()
        n = len(data)
        if n < 126:
            hdr = struct.pack("!BB", 0x81, n)
        elif n < 65536:
            hdr = struct.pack("!BBH", 0x81, 126, n)
        else:
            hdr = struct.pack("!BBQ", 0x81, 127, n)
        try:
            self.w.write(hdr + data)
            await self.w.drain()
        except (ConnectionError, RuntimeError):
            self.alive = False

    async def recv(self):
        """Returns decoded text message, or None when closed."""
        buf = b""
        while True:
            b1, b2 = await self.r.readexactly(2)
            op, masked, n = b1 & 0x0F, b2 & 0x80, b2 & 0x7F
            if n == 126:
                n = struct.unpack("!H", await self.r.readexactly(2))[0]
            elif n == 127:
                n = struct.unpack("!Q", await self.r.readexactly(8))[0]
            mask = await self.r.readexactly(4) if masked else b"\0\0\0\0"
            payload = bytearray(await self.r.readexactly(n))
            for i in range(n):
                payload[i] ^= mask[i % 4]
            if op == 0x8:  # close
                return None
            if op == 0x9:  # ping -> pong
                self.w.write(struct.pack("!BB", 0x8A, len(payload)) + bytes(payload))
                continue
            if op in (0x1, 0x0, 0x2):
                buf += bytes(payload)
                if b1 & 0x80:
                    return buf.decode("utf-8", "replace")


# --------------------------------------------------------------------------- #
# Bridge core
# --------------------------------------------------------------------------- #
class Bridge:
    def __init__(self, args):
        self.args = args
        self.clients = set()
        self.state = {}          # canonical key -> value
        self.bios = {}           # DCS-BIOS identifier -> value
        self.dirty = set()
        self.bios_dirty = set()
        self.status_dirty = True
        self.sources = []
        self.dcs = None
        self.msfs = None
        from src_api import Api
        self.api = Api(log)

    # ---------- called by sources ----------
    def push(self, values, src=None):
        for k, v in values.items():
            if v is None:
                continue
            if isinstance(v, float) and not math.isfinite(v):
                continue
            if self.state.get(k) != v:
                self.state[k] = v
                self.dirty.add(k)

    def push_bios(self, values):
        self.bios.update(values)
        self.bios_dirty.update(values)

    def source_changed(self):
        self.status_dirty = True

    def cockpit(self):
        """Source whose cockpit-control panel (DCS-BIOS / MSFS input events) the iPad should show."""
        cands = [s for s in (self.dcs, self.msfs) if s and getattr(s, "panel", None)]
        live = [s for s in cands if s.live]
        return (live or cands or [None])[0]

    def active(self):
        for s in self.sources:
            if s.live:
                return s
        return None

    # ---------- inputs from the iPad ----------
    async def trigger(self, name, action):
        if self.args.verbose:
            log(f"input {name} {action}")
        if self.args.demo:
            self.demo_input(name, action)
            return
        # the sim that is actually flying first, then anything that is merely connected
        for s in sorted(self.sources, key=lambda s: not s.live):
            if await s.input(name, action):
                return
        if action != "release":
            log(f"input {name}: no connected sim handles it")

    async def bios_input(self, ident, arg):
        if self.args.verbose:
            log(f"DCS-BIOS {ident} {arg}")
        c = self.cockpit()
        if c:
            await c.bios_input(ident, arg)

    # ---------- publish ----------
    async def publish_loop(self):
        while True:
            await asyncio.sleep(1 / 30)
            if self.args.demo:
                self.demo_tick()
            if self.status_dirty:
                self.status_dirty = False
                await self.broadcast(self.status_msg())
            if self.dirty:
                d = {k: self.state[k] for k in self.dirty}
                self.dirty.clear()
                await self.broadcast({"t": "state", "d": d})
            if self.bios_dirty:
                d = {k: self.bios[k] for k in self.bios_dirty if k in self.bios}
                self.bios_dirty.clear()
                await self.broadcast({"t": "bios", "d": d})

    async def broadcast(self, msg):
        for c in list(self.clients):
            await c.send(msg)
            if not c.alive:
                self.clients.discard(c)

    def status_msg(self):
        a = self.active()
        return {
            "t": "status", "demo": self.args.demo,
            "sim": "DEMO" if self.args.demo else (a.label if a else ""),
            "aircraft": "" if self.args.demo else (a.status().get("aircraft", "") if a else ""),
            "bios": "DEMO" if self.args.demo else (self.cockpit().panel["aircraft"] if self.cockpit() else ""),
            "sources": {s.name: s.status() for s in self.sources},
        }

    # ---------- clients ----------
    async def ws_session(self, ws):
        self.clients.add(ws)
        log(f"iPad/browser connected {ws.peer[0]}  ({len(self.clients)} client(s))")
        await ws.send(self.status_msg())
        await ws.send({"t": "state", "d": self.state})
        if self.bios:
            await ws.send({"t": "bios", "d": self.bios})
        try:
            while True:
                msg = await ws.recv()
                if msg is None:
                    break
                try:
                    m = json.loads(msg)
                except ValueError:
                    continue
                t = m.get("t")
                if t == "input" and isinstance(m.get("name"), str):
                    name = "".join(ch for ch in m["name"] if ch.isalnum() or ch in "._-:@=,")
                    await self.trigger(name, m.get("a", "tap"))
                elif t == "bios" and isinstance(m.get("id"), str):
                    await self.bios_input(m["id"], str(m.get("arg", "")))
                elif t == "inspect":
                    await ws.send(self.inspect())
        except (asyncio.IncompleteReadError, ConnectionError):
            pass
        finally:
            ws.alive = False
            self.clients.discard(ws)
            log(f"client {ws.peer[0]} left")

    def inspect(self):
        a = self.active()
        if a and hasattr(a, "inspect_rows"):
            rows = a.inspect_rows(self.state)
        else:
            rows = [{"key": k, "unit": "", "value": v, "from": a.label if a else "", "candidates": []}
                    for k, v in sorted(self.state.items())]
        return {"t": "inspect", "profile": a.name if a else "-", "game": self.status_msg()["aircraft"], "rows": rows}

    # ---------- HTTP + WS on one port ----------
    async def handle_conn(self, reader, writer):
        try:
            req = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 10)
        except (asyncio.IncompleteReadError, asyncio.LimitOverrunError, asyncio.TimeoutError, ConnectionError):
            writer.close()
            return
        lines = req.decode("latin-1").split("\r\n")
        try:
            method, target, _ = lines[0].split(" ", 2)
        except ValueError:
            writer.close()
            return
        headers = {}
        for l in lines[1:]:
            if ":" in l:
                k, v = l.split(":", 1)
                headers[k.strip().lower()] = v.strip()

        if headers.get("upgrade", "").lower() == "websocket":
            key = headers.get("sec-websocket-key", "")
            accept = base64.b64encode(hashlib.sha1((key + WS_GUID).encode()).digest()).decode()
            writer.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                          f"Sec-WebSocket-Accept: {accept}\r\n\r\n").encode())
            await writer.drain()
            sock = writer.get_extra_info("socket")
            if sock:
                sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            await self.ws_session(WSClient(reader, writer))
            writer.close()
            return

        path, _, query = target.partition("?")
        if path.startswith("/api/"):
            res = await self.api.handle(path, query)
            await self.respond(writer, method, "200 OK", "application/json", json.dumps(res, separators=(",", ":")).encode())
            return
        if path == "/bios/panel.json":
            c = self.cockpit()
            panel = c.panel if c else None
            if self.args.demo and not panel:
                panel = demo_panel()
            body = json.dumps(panel or {"aircraft": "", "categories": []}, separators=(",", ":")).encode()
            await self.respond(writer, method, "200 OK", "application/json", body)
            return
        await self.serve_file(writer, method, path)

    async def serve_file(self, writer, method, path):
        if path == "/":
            path = "/index.html"
        f = (WEB_ROOT / path.lstrip("/")).resolve()
        if (WEB_ROOT not in f.parents and f != WEB_ROOT) or not f.is_file():
            await self.respond(writer, method, "404 Not Found", "text/plain", b"Not found")
            return
        ctype = mimetypes.guess_type(str(f))[0] or "application/octet-stream"
        await self.respond(writer, method, "200 OK", ctype, f.read_bytes())

    async def respond(self, writer, method, status, ctype, body):
        writer.write((f"HTTP/1.1 {status}\r\nContent-Type: {ctype}\r\nContent-Length: {len(body)}\r\n"
                      "Cache-Control: no-cache\r\nConnection: close\r\n\r\n").encode())
        if method != "HEAD":
            writer.write(body)
        try:
            await writer.drain()
        finally:
            writer.close()

    # ---------- demo mode ----------
    def demo_init(self):
        self.t0 = time.time()
        self.demo = {"gear": 1, "flaps": 0, "ap": 0, "hdg_bug": 90, "alt_sel": 5000, "vs_sel": 500,
                     "crs": 90, "baro": 1013.25, "master_arm": 0, "chaff": 60, "flare": 30,
                     "door": 0, "scoop": 0, "tank": 100.0, "throttle": 75, "mixture": 90, "prop": 100}
        # sample AH-64D up-front display / keyboard / CMWS text for the Apache page
        eufd = ["ENGINE 1 OUT        |UHF  305.000  305.000", "                    |VHF  127.000  135.000",
                "                    |FM1   30.000   30.000", "        TAIL WHEEL UNLOCKED  |FM2   30.000   30.000",
                "                    |HF     2.0000A  2.0000A", "", "", "*SQL  RTS  UHF VHF FM1 FM2 HF",
                "", "", "", "", "FUEL  2450 LBS   ENDR 2+10", "          12:34:56 Z"]
        self.push_bios({**{f"PLT_EUFD_LINE{i + 1}": t for i, t in enumerate(eufd)},
                        **{f"CPG_EUFD_LINE{i + 1}": t for i, t in enumerate(eufd)},
                        "PLT_KU_DISPLAY": "WPT FLY-TO A01", "CPG_KU_DISPLAY": "TGT T01",
                        "PLT_CMWS_FLARE_COUNT": "30", "PLT_CMWS_CHAFF_COUNT": "00", "CPG_CMWS_FLARE_COUNT": "30",
                        "PLT_MASTER_ARM_SAFE_L": 1, "PLT_CMWS_FWD_LEFT_BRT_L": 1, "PLT_MASTER_CAUTION_L": 1})

    def demo_input(self, name, action):
        if action == "release":
            return
        d, n = self.demo, name.upper()
        n = {"K:HEADING_BUG_INC": "HDG_INC", "K:HEADING_BUG_DEC": "HDG_DEC", "K:AP_ALT_VAR_INC": "ALT_INC",
             "K:AP_ALT_VAR_DEC": "ALT_DEC", "K:KOHLSMAN_INC": "BARO_INC", "K:KOHLSMAN_DEC": "BARO_DEC",
             "K:VOR1_OBI_INC": "CRS_INC", "K:VOR1_OBI_DEC": "CRS_DEC", "K:AP_MASTER": "AP_MASTER"}.get(n, n)
        if n in ("ALT_INC_1000", "ALT_DEC_1000"):
            d["alt_sel"] += 1000 if n == "ALT_INC_1000" else -1000
        step = {"HDG": ("hdg_bug", 1, 360), "ALT": ("alt_sel", 100, None), "VS": ("vs_sel", 100, None),
                "CRS": ("crs", 1, 360), "BARO": ("baro", 1, None)}
        for pre, (k, s, wrap) in step.items():
            if n in (pre + "_INC", pre + "_DEC"):
                d[k] += s if n.endswith("_INC") else -s
                if wrap:
                    d[k] %= wrap
        if n == "GEAR_UP":
            d["gear"] = 0
        elif n == "GEAR_DOWN":
            d["gear"] = 1
        elif n == "GEAR_TOGGLE":
            d["gear"] ^= 1
        elif n == "FLAPS_INC":
            d["flaps"] = min(3, d["flaps"] + 1)
        elif n == "FLAPS_DEC":
            d["flaps"] = max(0, d["flaps"] - 1)
        elif n == "AP_MASTER":
            d["ap"] ^= 1
        elif n == "MASTER_ARM":
            d["master_arm"] ^= 1
        elif n == "CM_CHAFF":
            d["chaff"] = max(0, d["chaff"] - 1)
        elif n == "CM_FLARE":
            d["flare"] = max(0, d["flare"] - 1)
        elif n in ("DROP_OPEN", "DROP_CLOSE"):
            d["door"] = 100 if n == "DROP_OPEN" else 0
        elif n in ("SCOOP_DOWN", "SCOOP_UP"):
            d["scoop"] = 100 if n == "SCOOP_DOWN" else 0
        elif n.startswith("K:THROTTLE_SET=") or n.startswith("K:MIXTURE_SET=") or n.startswith("K:PROP_PITCH_SET="):
            k = {"THROTTLE": "throttle", "MIXTURE": "mixture", "PROP": "prop"}[n[2:].split("_")[0]]
            d[k] = round(int(n.split("=")[1]) / 163.83)

    def demo_tick(self):
        t = time.time() - self.t0
        d, S = self.demo, math.sin
        roll = 25 * S(t / 7)
        self.push({
            "pitch": round(4 * S(t / 5), 2), "roll": round(roll, 2), "heading": round((d["hdg_bug"] + 30 * S(t / 11)) % 360, 1),
            "ias": round(115 + 25 * S(t / 13), 1), "alt": round(4500 + 1500 * S(t / 30)), "vs": round(900 * S(t / 9)),
            "turn": round(roll / 25 * 20, 2), "slip": round(0.4 * S(t / 3), 2), "baro": d["baro"],
            "mach": round(0.6 + 0.3 * S(t / 13), 3), "g": round(1 + 2.5 * abs(S(t / 4)), 2), "aoa": round(8 + 5 * S(t / 6), 2),
            "rpm": round(2350 + 150 * S(t / 8)), "n1": round(85 + 10 * S(t / 8), 1), "n2": round(97 + 2 * S(t / 5), 1),
            "nr": round(100 + 1.5 * S(t / 3), 1), "torque": round(60 + 20 * S(t / 7), 1), "radalt": round(max(0, 300 + 300 * S(t / 15))),
            "egt": round(620 + 60 * S(t / 10)), "oil_p": round(60 + 5 * S(t / 12)), "oil_t": round(85 + 5 * S(t / 20)),
            "fuel": round(70 - (t / 60) % 60, 1), "fuel_l": round(20 - (t / 120) % 20, 1), "fuel_r": round(19 - (t / 120) % 19, 1),
            "fuel_flow": round(9 + S(t / 5), 1), "throttle": round(70 + 20 * S(t / 8)),
            "gear": d["gear"], "gear_n": d["gear"], "gear_l": d["gear"], "gear_r": d["gear"], "flaps": d["flaps"],
            "ap_master": d["ap"], "ap_hdg": d["ap"], "ap_alt": d["ap"], "ap_nav": 0, "ap_vs": 0, "ap_apr": 0,
            "hdg_bug": d["hdg_bug"], "alt_sel": d["alt_sel"], "vs_sel": d["vs_sel"], "crs": d["crs"],
            "master_arm": d["master_arm"], "master_caution": 1 if int(t) % 20 < 3 else 0, "master_warning": 0,
            "chaff": d["chaff"], "flare": d["flare"], "gun": 578, "volts": 28.1, "amps": round(10 + 3 * S(t / 4), 1),
            "suction": 5.0, "cht": round(380 + 20 * S(t / 25)), "speedbrake": 0, "hook": 0,
            "com1_act": 118.3, "com1": 121.5, "nav1_act": 110.5, "nav1": 113.9, "baro_hg": round(d["baro"] / 33.8639, 2),
            "tas": round(122 + 25 * S(t / 13)), "gs": round(118 + 25 * S(t / 13)), "oat": 12,
        })
        # moving position (a lazy circle near Seattle) + nav radios + utility systems
        ang = t / 240
        d["tank"] = max(0.0, d["tank"] - (0.4 if d["door"] else 0)) if d["tank"] > 0 else 100.0
        self.push({
            "lat": round(47.53 + 0.12 * math.sin(ang), 6), "lon": round(-122.30 + 0.18 * math.cos(ang), 6),
            "hdg_true": round((math.degrees(-ang) + 180) % 360, 1), "track": round((math.degrees(-ang) + 180) % 360, 1), "on_ground": 0,
            "cdi": round(60 * S(t / 9)), "gsi": round(50 * S(t / 11)), "tofrom": 1, "has_gs": 1, "nav_ok": 1,
            "adf_brg": round((40 + 30 * S(t / 17)) % 360, 1), "adf_ok": 1, "adf_freq": 362,
            "com2_act": 119.9, "com2": 124.7, "nav2_act": 116.8, "nav2": 108.9, "xpdr": 1200, "xpdr_state": 4,
            "throttle": d["throttle"], "mixture": d["mixture"], "prop": d["prop"], "trim": round(10 * S(t / 20), 1),
            "fuel_sel": 1, "mag_l": 1, "mag_r": 1, "starter": 0, "manifold": 22.5, "prop_rpm": round(1900 + 50 * S(t / 7)),
            "itt": round(690 + 30 * S(t / 9)), "fuel_press": 28, "fuel_total": round(38 - (t / 90) % 30, 1),
            "zulu_time": (time.time() % 86400), "local_time": ((time.time() - 25200) % 86400), "wind_dir": 290, "wind_kt": 12,
            "tank_pct": round(d["tank"], 1), "tank_gal": round(d["tank"] * 8), "drop_door": d["door"], "drop_flow": 9000 if d["door"] else 0,
            "scoop": d["scoop"], "vel_x": round(2 * S(t / 5), 2), "vel_z": round(3 * S(t / 7), 2),
        })


def demo_panel():
    """A tiny fake DCS-BIOS panel so the 'DCS cockpit' page can be tried in demo mode."""
    return {"aircraft": "DEMO", "categories": [
        {"name": "Gear", "module": "DEMO", "controls": [
            {"id": "GEAR_LEVER", "t": "selector", "d": "Landing Gear Lever", "p": ["UP", "DN"], "i": [["s", 1], ["f"], ["a", "TOGGLE"]], "max": 1},
            {"id": "HOOK_LEVER", "t": "selector", "d": "Hook Handle", "p": ["UP", "DN"], "i": [["s", 1], ["f"], ["a", "TOGGLE"]], "max": 1},
            {"id": "GEAR_LIGHT", "t": "led", "d": "Landing Gear Light", "c": "red", "max": 1}]},
        {"name": "Weapons Panel", "module": "DEMO", "controls": [
            {"id": "MASTER_ARM_COVER", "t": "selector", "d": "Master Arm Cover", "p": ["CLOSE", "OPEN"], "i": [["s", 1], ["f"], ["a", "TOGGLE"]], "max": 1},
            {"id": "MASTER_ARM_SW", "t": "selector", "d": "Master Arm Switch", "p": ["ON", "OFF", "TNG"], "i": [["s", 2], ["f"]], "max": 2},
            {"id": "MASTER_CAUTION_RESET", "t": "selector", "v": "momentary_last_position", "d": "Master Caution Reset", "i": [["s", 1]], "max": 1},
            {"id": "MASTER_CAUTION", "t": "led", "d": "Master Caution Light", "c": "yellow", "max": 1},
            {"id": "WEAPON_TYPE", "t": "selector", "d": "Weapon Type Wheel", "p": ["GUN", "SW-COOL", "SP", "PH"], "i": [["s", 3], ["f"]], "max": 3}]},
        {"name": "Lights", "module": "DEMO", "controls": [
            {"id": "INSTR_LIGHTS", "t": "limited_dial", "d": "Instrument Light Intensity", "i": [["s", 65535], ["v", 3200, 65535]], "max": 65535},
            {"id": "ANTICOL_LIGHT", "t": "selector", "d": "Anti-Collision Light", "p": ["OFF", "ON"], "i": [["s", 1], ["f"], ["a", "TOGGLE"]], "max": 1}]},
        {"name": "Displays", "module": "DEMO", "controls": [
            {"id": "FUEL_TOTAL", "t": "display", "d": "Fuel Total Counter", "len": 5},
            {"id": "HYD_PRESS", "t": "analog_gauge", "d": "Hydraulic Pressure Needle", "max": 65535}]},
    ]}


async def supervise(source):
    """Run a sim connection; if it ever crashes, log it and restart it instead of stopping the bridge."""
    while True:
        try:
            await source.run()
            return  # run() only returns when the source is disabled (e.g. no SimConnect.dll)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            log(f"{source.label}: crashed ({e!r}) - restarting in 3 s")
            await asyncio.sleep(3)


def lan_ips():
    ips = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ips.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass
    return sorted(i for i in ips if not i.startswith("127."))


async def main():
    ap = argparse.ArgumentParser(description="SimDash bridge: MSFS / DCS <-> iPad dashboard")
    ap.add_argument("--port", type=int, default=8787, help="HTTP/WebSocket port for the iPad (default 8787)")
    ap.add_argument("--source", default="msfs,dcs", help="comma list of: msfs, dcs, simhub (default msfs,dcs)")
    ap.add_argument("--simhub", default="127.0.0.1:18082", help="SimHub Property Server host:port (with --source simhub)")
    ap.add_argument("--profile", help="SimHub: force a profile from properties.json")
    ap.add_argument("--demo", action="store_true", help="generate fake flight data (no sim needed)")
    ap.add_argument("-v", "--verbose", action="store_true", help="log every button press")
    args = ap.parse_args()

    b = Bridge(args)
    tasks = [b.publish_loop()]
    if args.demo:
        b.demo_init()
        log("DEMO mode - generating fake flight data")
    else:
        wanted = [s.strip().lower() for s in args.source.split(",") if s.strip()]
        if "msfs" in wanted:
            from src_msfs import MsfsSource
            b.msfs = MsfsSource(b, log)
            b.sources.append(b.msfs)
        if "dcs" in wanted:
            from src_dcs import DcsSource
            b.dcs = DcsSource(b, log)
            b.sources.append(b.dcs)
        if "simhub" in wanted:
            from src_simhub import SimHubSource
            b.sources.append(SimHubSource(b, log, args.simhub, args.profile))
        tasks += [supervise(s) for s in b.sources]

    server = await asyncio.start_server(b.handle_conn, "0.0.0.0", args.port)
    log("SimDash bridge running. On the iPad, open Safari at:")
    for ip in lan_ips() or ["<this-PC-IP>"]:
        log(f"    http://{ip}:{args.port}/")
    log("(Windows may ask to allow Python through the firewall - allow it on Private networks.)")
    async with server:
        await asyncio.gather(server.serve_forever(), *tasks)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
