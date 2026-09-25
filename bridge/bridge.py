"""
SimDash bridge
==============

iPad (Safari)  <--WebSocket/HTTP-->  this bridge  <--TCP 18082-->  SimHub Property Server plugin  <-->  DCS / MSFS 2024

* Serves the dashboard web app (../web) over HTTP so the iPad can open it.
* Subscribes to SimHub properties listed in properties.json and pushes them to
  the iPad as canonical keys (ias, alt, pitch, ...), so dashboards never care
  which sim is running.
* Receives touch presses from the iPad and forwards them to SimHub as
  `trigger-input-pressed/released <name>`. In SimHub you map those inputs to
  keystrokes / vJoy buttons that the sim is bound to.

Pure Python standard library - no pip install needed.

    python bridge.py                 # normal mode, talks to SimHub
    python bridge.py --demo          # fake flight data, no SimHub required
    python bridge.py --port 8787 --simhub 127.0.0.1:18082
"""

import argparse
import asyncio
import base64
import hashlib
import json
import math
import mimetypes
import os
import socket
import struct
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
WEB_ROOT = (HERE.parent / "web").resolve()
PROPS_FILE = HERE / "properties.json"
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("text/javascript", ".js")


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


# --------------------------------------------------------------------------- #
# Property mapping
# --------------------------------------------------------------------------- #
class Mapping:
    """Loads properties.json and turns raw SimHub values into canonical keys."""

    def __init__(self, path):
        self.path = path
        self.mtime = 0
        self.cfg = {}
        self.reload()

    def reload(self):
        self.mtime = os.path.getmtime(self.path)
        with open(self.path, encoding="utf-8") as f:
            self.cfg = json.load(f)
        log(f"Loaded {self.path.name}: profiles = {', '.join(self.profiles())}")

    def changed(self):
        try:
            return os.path.getmtime(self.path) != self.mtime
        except OSError:
            return False

    def profiles(self):
        return [k for k in self.cfg if not k.startswith("_")]

    def detect(self, game_name):
        """Pick a profile from SimHub's DataCorePlugin.CurrentGame value."""
        g = (game_name or "").lower()
        for name in self.profiles():
            for pat in self.cfg[name].get("_match", []):
                if pat.lower() in g:
                    return name
        return self.cfg.get("_default_profile", self.profiles()[0])

    def all_props(self, profile):
        out = set()
        for key, spec in self.cfg.get(profile, {}).items():
            if key.startswith("_"):
                continue
            out.update(spec.get("props", []))
        return out

    def resolve(self, profile, raw):
        """raw: {propName: value}. Returns {canonicalKey: value} plus which prop won."""
        result, source = {}, {}
        for key, spec in self.cfg.get(profile, {}).items():
            if key.startswith("_"):
                continue
            for p in spec.get("props", []):
                v = raw.get(p)
                if v is None:
                    continue
                v = convert(v, spec)
                if v is None:
                    continue
                result[key] = v
                source[key] = p
                break
        return result, source


def convert(v, spec):
    kind = spec.get("type", "number")
    if kind == "bool":
        if isinstance(v, str):
            return 1 if v.strip().lower() in ("true", "1", "on", "yes") else 0
        return 1 if v else 0
    if kind == "string":
        return str(v)
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    if spec.get("rad2deg"):
        x = math.degrees(x)
    x = x * spec.get("scale", 1.0) + spec.get("offset", 0.0)
    if "invert" in spec and spec["invert"]:
        x = -x
    return round(x, 3)


def parse_value(typ, text):
    if text == "(null)":
        return None
    if typ in ("integer", "long"):
        try:
            return int(text)
        except ValueError:
            return None
    if typ in ("double", "float", "decimal"):
        try:
            return float(text.replace(",", "."))
        except ValueError:
            return None
    if typ == "boolean":
        return text.lower() == "true"
    # generic/object/string: try number, else leave as text
    try:
        return float(text.replace(",", "."))
    except ValueError:
        if text.lower() in ("true", "false"):
            return text.lower() == "true"
        return text


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
        self.mapping = Mapping(PROPS_FILE)
        self.clients = set()
        self.raw = {}  # SimHub property -> value
        self.state = {}  # canonical key -> value
        self.source = {}
        self.game = ""
        self.profile = args.profile or self.mapping.detect("")
        self.simhub_ok = False
        self.sh_writer = None
        self.subscribed = set()
        self.dirty = set()

    # ---------- SimHub side ----------
    async def simhub_loop(self):
        host, port = self.args.simhub.rsplit(":", 1)
        while True:
            try:
                reader, writer = await asyncio.open_connection(host, int(port))
                banner = await asyncio.wait_for(reader.readline(), 5)
                log("SimHub connected:", banner.decode().strip())
                self.sh_writer, self.simhub_ok, self.subscribed = writer, True, set()
                await self.broadcast_status()
                await self.sh_send("subscribe DataCorePlugin.CurrentGame")
                await self.sync_subscriptions()
                while True:
                    line = await reader.readline()
                    if not line:
                        break
                    self.on_simhub_line(line.decode("utf-8", "replace").rstrip("\r\n"))
            except (OSError, asyncio.TimeoutError) as e:
                if self.simhub_ok or not getattr(self, "_warned", False):
                    log(f"SimHub Property Server not reachable at {self.args.simhub} ({e.__class__.__name__}). Retrying...")
                    self._warned = True
            self.simhub_ok, self.sh_writer = False, None
            await self.broadcast_status()
            await asyncio.sleep(3)

    async def sh_send(self, line):
        if self.sh_writer:
            self.sh_writer.write((line + "\r\n").encode())
            await self.sh_writer.drain()

    async def sync_subscriptions(self):
        wanted = self.mapping.all_props(self.profile)
        for p in sorted(wanted - self.subscribed):
            await self.sh_send(f"subscribe {p}")
        for p in sorted(self.subscribed - wanted):
            await self.sh_send(f"unsubscribe {p}")
            self.raw.pop(p, None)
        self.subscribed = set(wanted)

    def on_simhub_line(self, line):
        # "Property <name> <type> <value...>"
        if not line.startswith("Property "):
            if line.strip():
                log("SimHub:", line)
            return
        parts = line.split(" ", 3)
        if len(parts) < 4:
            return
        _, name, typ, text = parts
        val = parse_value(typ, text)
        if name == "DataCorePlugin.CurrentGame":
            self.game = str(val or "")
            if not self.args.profile:
                prof = self.mapping.detect(self.game)
                if prof != self.profile:
                    log(f"Game '{self.game}' -> profile '{prof}'")
                    self.profile = prof
                    asyncio.get_event_loop().create_task(self.sync_subscriptions())
            asyncio.get_event_loop().create_task(self.broadcast_status())
            return
        self.raw[name] = val
        self.dirty.add(name)

    async def trigger(self, name, action):
        cmd = {"press": "trigger-input-pressed", "release": "trigger-input-released"}.get(action, "trigger-input")
        if self.args.verbose or not self.simhub_ok:
            log(f"input {name} {action}" + ("" if self.simhub_ok or self.args.demo else "  (SimHub not connected)"))
        if self.args.demo:
            self.demo_input(name, action)
        await self.sh_send(f"{cmd} {name}")

    # ---------- publish loop ----------
    async def publish_loop(self):
        period = 1.0 / 30
        while True:
            await asyncio.sleep(period)
            if self.mapping.changed():
                try:
                    self.mapping.reload()
                    if not self.args.profile:
                        self.profile = self.mapping.detect(self.game)
                    await self.sync_subscriptions()
                    self.dirty = set(self.raw)
                except Exception as e:  # bad JSON while user is editing
                    log("properties.json error:", e)
            if self.args.demo:
                self.demo_tick()
            if not self.dirty:
                continue
            self.dirty.clear()
            new, self.source = self.mapping.resolve(self.profile, self.raw) if not self.args.demo else (self.state_demo, {})
            delta = {k: v for k, v in new.items() if self.state.get(k) != v}
            self.state.update(new)
            if delta:
                await self.broadcast({"t": "state", "d": delta})

    # ---------- clients ----------
    async def broadcast(self, msg):
        for c in list(self.clients):
            await c.send(msg)
            if not c.alive:
                self.clients.discard(c)

    def status_msg(self):
        return {"t": "status", "simhub": self.simhub_ok or self.args.demo, "demo": self.args.demo,
                "game": "DEMO" if self.args.demo else self.game, "profile": self.profile}

    async def broadcast_status(self):
        await self.broadcast(self.status_msg())

    async def ws_session(self, ws):
        self.clients.add(ws)
        log(f"iPad/browser connected {ws.peer[0]}  ({len(self.clients)} client(s))")
        await ws.send(self.status_msg())
        await ws.send({"t": "state", "d": self.state})
        try:
            while True:
                msg = await ws.recv()
                if msg is None:
                    break
                try:
                    m = json.loads(msg)
                except ValueError:
                    continue
                if m.get("t") == "input" and isinstance(m.get("name"), str):
                    name = "".join(ch for ch in m["name"] if ch.isalnum() or ch in "._-")
                    await self.trigger(name, m.get("a", "tap"))
                elif m.get("t") == "inspect":
                    await ws.send(self.inspect())
        except (asyncio.IncompleteReadError, ConnectionError):
            pass
        finally:
            ws.alive = False
            self.clients.discard(ws)
            log(f"client {ws.peer[0]} left")

    def inspect(self):
        rows = []
        for key, spec in self.mapping.cfg.get(self.profile, {}).items():
            if key.startswith("_"):
                continue
            rows.append({"key": key, "unit": spec.get("unit", ""), "value": self.state.get(key),
                         "from": self.source.get(key),
                         "candidates": [{"p": p, "v": self.raw.get(p)} for p in spec.get("props", [])]})
        return {"t": "inspect", "profile": self.profile, "game": self.game, "rows": rows}

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

        await self.serve_file(writer, method, target.split("?", 1)[0])

    async def serve_file(self, writer, method, path):
        if path == "/":
            path = "/index.html"
        f = (WEB_ROOT / path.lstrip("/")).resolve()
        if WEB_ROOT not in f.parents and f != WEB_ROOT or not f.is_file():
            body, status, ctype = b"Not found", "404 Not Found", "text/plain"
        else:
            body, status = f.read_bytes(), "200 OK"
            ctype = mimetypes.guess_type(str(f))[0] or "application/octet-stream"
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
                     "crs": 90, "baro": 1013.25, "master_arm": 0, "lights": 0}
        self.state_demo = {}

    def demo_input(self, name, action):
        if action == "release":
            return
        d, n = self.demo, name.upper()
        step = {"HDG": ("hdg_bug", 1, 360), "ALT": ("alt_sel", 100, None), "VS": ("vs_sel", 100, None),
                "CRS": ("crs", 1, 360), "BARO": ("baro", 1, None)}
        for pre, (k, s, wrap) in step.items():
            if n.startswith(pre + "_INC") or n.startswith(pre + "_DEC"):
                d[k] += s if "_INC" in n else -s
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
        self.dirty.add("demo")

    def demo_tick(self):
        t = time.time() - self.t0
        d = self.demo
        roll = 25 * math.sin(t / 7)
        pitch = 4 * math.sin(t / 5)
        hdg = (d["hdg_bug"] + 30 * math.sin(t / 11)) % 360
        ias = 115 + 25 * math.sin(t / 13)
        vs = 900 * math.sin(t / 9)
        alt = 4500 + 1500 * math.sin(t / 30)
        self.state_demo = {
            "pitch": round(pitch, 2), "roll": round(roll, 2), "heading": round(hdg, 1), "ias": round(ias, 1),
            "alt": round(alt), "vs": round(vs), "turn": round(roll / 25 * 20, 2), "slip": round(3 * math.sin(t / 3), 2),
            "baro": d["baro"], "mach": round(0.6 + 0.3 * math.sin(t / 13), 3), "g": round(1 + 2.5 * abs(math.sin(t / 4)), 2),
            "aoa": round(8 + 5 * math.sin(t / 6), 2), "rpm": round(2350 + 150 * math.sin(t / 8)),
            "n1": round(85 + 10 * math.sin(t / 8), 1), "n2": round(97 + 2 * math.sin(t / 5), 1),
            "nr": round(100 + 1.5 * math.sin(t / 3), 1), "torque": round(60 + 20 * math.sin(t / 7), 1),
            "radalt": round(max(0, 300 + 300 * math.sin(t / 15))), "egt": round(620 + 60 * math.sin(t / 10)),
            "oil_p": round(60 + 5 * math.sin(t / 12)), "oil_t": round(85 + 5 * math.sin(t / 20)),
            "fuel": round(70 - (t / 60) % 60, 1), "fuel_l": round(20 - (t / 120) % 20, 1), "fuel_r": round(19 - (t / 120) % 19, 1),
            "fuel_flow": round(9 + math.sin(t / 5), 1), "throttle": round(70 + 20 * math.sin(t / 8)),
            "gear": d["gear"], "gear_n": d["gear"], "gear_l": d["gear"], "gear_r": d["gear"], "flaps": d["flaps"],
            "ap_master": d["ap"], "ap_hdg": d["ap"], "ap_alt": d["ap"], "ap_nav": 0, "ap_vs": 0, "ap_apr": 0,
            "hdg_bug": d["hdg_bug"], "alt_sel": d["alt_sel"], "vs_sel": d["vs_sel"], "crs": d["crs"],
            "master_arm": d["master_arm"], "master_caution": 1 if int(t) % 20 < 3 else 0, "master_warning": 0,
            "chaff": 60, "flare": 30, "gun": 578, "volts": 28.1, "amps": round(10 + 3 * math.sin(t / 4), 1),
            "suction": 5.0, "cht": round(380 + 20 * math.sin(t / 25)), "speedbrake": 0, "hook": 0,
        }
        self.dirty.add("demo")


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
    ap = argparse.ArgumentParser(description="SimDash bridge: SimHub <-> iPad dashboard")
    ap.add_argument("--port", type=int, default=8787, help="HTTP/WebSocket port for the iPad (default 8787)")
    ap.add_argument("--simhub", default="127.0.0.1:18082", help="SimHub Property Server host:port")
    ap.add_argument("--profile", help="force a profile from properties.json (e.g. msfs, dcs)")
    ap.add_argument("--demo", action="store_true", help="generate fake flight data (no SimHub needed)")
    ap.add_argument("-v", "--verbose", action="store_true", help="log every button press")
    args = ap.parse_args()

    b = Bridge(args)
    tasks = [b.publish_loop()]
    if args.demo:
        b.demo_init()
        b.profile = "demo"
        log("DEMO mode - generating fake flight data")
    else:
        tasks.append(b.simhub_loop())

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
