"""
Optional: data through SimHub + the SimHub Property Server plugin (TCP 18082).
Only used with  --source simhub . The direct MSFS / DCS connections don't need SimHub.
"""
import asyncio
import json
import math
import os
from pathlib import Path

HERE = Path(__file__).resolve().parent


class Mapping:
    """properties.json: SimHub property names -> canonical dashboard keys."""

    def __init__(self, path, log):
        self.path, self.log = path, log
        self.mtime = 0
        self.cfg = {}
        self.reload()

    def reload(self):
        self.mtime = os.path.getmtime(self.path)
        with open(self.path, encoding="utf-8") as f:
            self.cfg = json.load(f)
        self.log(f"SimHub: loaded {self.path.name} (profiles {', '.join(self.profiles())})")

    def changed(self):
        try:
            return os.path.getmtime(self.path) != self.mtime
        except OSError:
            return False

    def profiles(self):
        return [k for k in self.cfg if not k.startswith("_")]

    def detect(self, game_name):
        g = (game_name or "").lower()
        for name in self.profiles():
            for pat in self.cfg[name].get("_match", []):
                if pat.lower() in g:
                    return name
        return self.cfg.get("_default_profile", self.profiles()[0])

    def all_props(self, profile):
        out = set()
        for key, spec in self.cfg.get(profile, {}).items():
            if not key.startswith("_"):
                out.update(spec.get("props", []))
        return out

    def resolve(self, profile, raw):
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
                result[key], source[key] = v, p
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
    if spec.get("invert"):
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
    try:
        return float(text.replace(",", "."))
    except ValueError:
        if text.lower() in ("true", "false"):
            return text.lower() == "true"
        return text


class SimHubSource:
    name = "simhub"
    label = "SimHub"

    def __init__(self, bridge, log, address="127.0.0.1:18082", profile=None):
        self.b, self.log = bridge, log
        self.address = address
        self.forced_profile = profile
        self.mapping = Mapping(HERE / "properties.json", log)
        self.profile = profile or self.mapping.detect("")
        self.game = ""
        self.raw = {}
        self.source = {}
        self.subscribed = set()
        self.writer = None
        self.ok = False
        self.dirty = False

    @property
    def live(self):
        return self.ok and bool(self.game)

    def status(self):
        return {"connected": self.ok, "aircraft": self.game, "profile": self.profile}

    async def run(self):
        asyncio.get_running_loop().create_task(self.resolve_loop())
        host, port = self.address.rsplit(":", 1)
        warned = False
        while True:
            try:
                reader, writer = await asyncio.open_connection(host, int(port))
                banner = await asyncio.wait_for(reader.readline(), 5)
                self.log("SimHub connected:", banner.decode().strip())
                self.writer, self.ok, self.subscribed, warned = writer, True, set(), False
                self.b.source_changed()
                await self.send("subscribe DataCorePlugin.CurrentGame")
                await self.sync_subscriptions()
                while True:
                    line = await reader.readline()
                    if not line:
                        break
                    self.on_line(line.decode("utf-8", "replace").rstrip("\r\n"))
            except (OSError, asyncio.TimeoutError) as e:
                if self.ok or not warned:
                    self.log(f"SimHub Property Server not reachable at {self.address} ({e.__class__.__name__}). Retrying...")
                    warned = True
            self.ok, self.writer = False, None
            self.b.source_changed()
            await asyncio.sleep(3)

    async def send(self, line):
        if self.writer:
            self.writer.write((line + "\r\n").encode())
            await self.writer.drain()

    async def sync_subscriptions(self):
        wanted = self.mapping.all_props(self.profile)
        for p in sorted(wanted - self.subscribed):
            await self.send(f"subscribe {p}")
        for p in sorted(self.subscribed - wanted):
            await self.send(f"unsubscribe {p}")
            self.raw.pop(p, None)
        self.subscribed = set(wanted)

    def on_line(self, line):
        if not line.startswith("Property "):
            if line.strip():
                self.log("SimHub:", line)
            return
        parts = line.split(" ", 3)
        if len(parts) < 4:
            return
        _, name, typ, text = parts
        val = parse_value(typ, text)
        if name == "DataCorePlugin.CurrentGame":
            self.game = str(val or "")
            if not self.forced_profile:
                prof = self.mapping.detect(self.game)
                if prof != self.profile:
                    self.log(f"SimHub: game '{self.game}' -> profile '{prof}'")
                    self.profile = prof
                    asyncio.get_running_loop().create_task(self.sync_subscriptions())
            self.b.source_changed()
            return
        self.raw[name] = val
        self.dirty = True

    async def resolve_loop(self):
        while True:
            await asyncio.sleep(1 / 30)
            if self.mapping.changed():
                try:
                    self.mapping.reload()
                    if not self.forced_profile:
                        self.profile = self.mapping.detect(self.game)
                    await self.sync_subscriptions()
                    self.dirty = True
                except Exception as e:  # bad JSON while the user is editing
                    self.log("properties.json error:", e)
            if self.dirty:
                self.dirty = False
                vals, self.source = self.mapping.resolve(self.profile, self.raw)
                self.b.push(vals, self)

    async def input(self, name, action):
        if not self.ok:
            return False
        cmd = {"press": "trigger-input-pressed", "release": "trigger-input-released"}.get(action, "trigger-input")
        await self.send(f"{cmd} {name}")
        return True

    def inspect_rows(self, state):
        rows = []
        for key, spec in self.mapping.cfg.get(self.profile, {}).items():
            if key.startswith("_"):
                continue
            rows.append({"key": key, "unit": spec.get("unit", ""), "value": state.get(key), "from": self.source.get(key),
                         "candidates": [{"p": p, "v": self.raw.get(p)} for p in spec.get("props", [])]})
        return rows
