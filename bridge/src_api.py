"""
Web helpers for the iPad flight bag / map (the iPad can't call these sites directly because of CORS):

  /api/metar?ids=KSEA,KBFI      METAR (aviationweather.gov, JSON)
  /api/taf?ids=KSEA             TAF   (aviationweather.gov, JSON)
  /api/simbrief?user=NAME       latest SimBrief OFP, trimmed to what the iPad shows
  /api/airports?bbox=s,w,n,e    airports inside a box (needs the airport database)
  /api/nearest?lat=..&lon=..    nearest airports
  /api/airport?id=KSEA          one airport with runways and frequencies
  /api/airportdb                database status;  POST-like GET ?download=1 starts the download

Airport data: OurAirports (public domain, https://ourairports.com/data/), downloaded on request
into bridge/data/ (~15 MB) and kept in memory.
"""
import asyncio
import csv
import io
import json
import math
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
UA = "SimDash/1.0 (flight-sim iPad dashboard)"
OURAIRPORTS = "https://davidmegginson.github.io/ourairports-data/"
KEEP_TYPES = {"large_airport", "medium_airport", "small_airport", "heliport", "seaplane_base"}
TYPE_RANK = {"large_airport": 0, "medium_airport": 1, "small_airport": 2, "seaplane_base": 3, "heliport": 4}


def fetch(url, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def nm_between(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 3440.065 * 2 * math.asin(min(1, math.sqrt(a)))


def bearing(lat1, lon1, lat2, lon2):
    p1, p2, dl = math.radians(lat1), math.radians(lat2), math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


class Api:
    def __init__(self, log):
        self.log = log
        self.cache = {}           # url -> (time, bytes)
        self.airports = []        # compact list
        self.by_id = {}
        self.db_state = "missing"  # missing | downloading | ready | error
        self.db_msg = ""
        self.load_db()

    # ---------------------------------------------------------------- routing
    async def handle(self, path, query):
        q = {k: v[0] for k, v in urllib.parse.parse_qs(query).items()}
        loop = asyncio.get_running_loop()
        try:
            if path == "/api/metar":
                return await loop.run_in_executor(None, self.wx, "metar", q.get("ids", ""))
            if path == "/api/taf":
                return await loop.run_in_executor(None, self.wx, "taf", q.get("ids", ""))
            if path == "/api/simbrief":
                return await loop.run_in_executor(None, self.simbrief, q.get("user", ""))
            if path == "/api/airportdb":
                if q.get("download") == "1" and self.db_state != "downloading":
                    self.db_state, self.db_msg = "downloading", "starting..."
                    loop.run_in_executor(None, self.download_db)
                return {"state": self.db_state, "msg": self.db_msg, "count": len(self.airports)}
            if path == "/api/airports":
                return self.in_bbox(q.get("bbox", ""), int(q.get("max", 400)))
            if path == "/api/nearest":
                return self.nearest(float(q["lat"]), float(q["lon"]), int(q.get("n", 10)), q.get("heli") == "1")
            if path == "/api/layouts":
                f = DATA / "layouts.json"
                return json.loads(f.read_text(encoding="utf-8")) if f.is_file() else {"pages": [], "ts": 0}
            if path == "/api/airport":
                a = self.by_id.get(q.get("id", "").upper())
                return a or {"error": "unknown airport"}
        except Exception as e:  # never break the bridge on a bad request / offline internet
            return {"error": str(e)}
        return {"error": "unknown api"}

    def save_layouts(self, body):
        """Custom panels from the iPad editor (max 2 MB of JSON)."""
        data = json.loads(body.decode("utf-8"))
        if not isinstance(data, dict) or not isinstance(data.get("pages"), list):
            return {"error": "bad layout"}
        DATA.mkdir(exist_ok=True)
        tmp = DATA / "layouts.json.tmp"
        tmp.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
        tmp.replace(DATA / "layouts.json")
        return {"ok": True, "ts": data.get("ts", 0)}

    # ---------------------------------------------------------------- weather
    def wx(self, kind, ids):
        ids = ",".join(i for i in re.split(r"[ ,]+", ids.upper()) if re.fullmatch(r"[A-Z0-9]{3,4}", i))[:120]
        if not ids:
            return {"error": "no station ids"}
        url = f"https://aviationweather.gov/api/data/{kind}?ids={ids}&format=json" + ("&taf=false" if kind == "metar" else "")
        now = time.time()
        hit = self.cache.get(url)
        if hit and now - hit[0] < 120:
            data = hit[1]
        else:
            data = fetch(url)
            self.cache[url] = (now, data)
        return {"data": json.loads(data or b"[]")}

    # ---------------------------------------------------------------- SimBrief
    def simbrief(self, user):
        if not re.fullmatch(r"[A-Za-z0-9_.\-]{2,40}", user or ""):
            return {"error": "enter your SimBrief username"}
        try:
            raw = json.loads(fetch("https://www.simbrief.com/api/xml.fetcher.php?json=1&username=" + urllib.parse.quote(user)))
        except urllib.error.HTTPError as e:
            return {"error": f"SimBrief has no flight plan for '{user}' (check the username, or generate a plan first). [HTTP {e.code}]"}
        if raw.get("fetch", {}).get("status", "").lower().startswith("error"):
            return {"error": raw["fetch"]["status"]}
        o, d, g = raw.get("origin", {}), raw.get("destination", {}), raw.get("general", {})
        fixes = raw.get("navlog", {}).get("fix", [])
        if isinstance(fixes, dict):
            fixes = [fixes]
        f = lambda v: float(v) if v not in (None, "", {}) else None
        return {
            "origin": {"icao": o.get("icao_code"), "name": o.get("name"), "lat": f(o.get("pos_lat")), "lon": f(o.get("pos_long")), "rwy": o.get("plan_rwy")},
            "dest": {"icao": d.get("icao_code"), "name": d.get("name"), "lat": f(d.get("pos_lat")), "lon": f(d.get("pos_long")), "rwy": d.get("plan_rwy")},
            "altn": (raw.get("alternate") or {}).get("icao_code"),
            "route": g.get("route"), "cruise": g.get("initial_altitude"), "distance": g.get("route_distance"),
            "aircraft": (raw.get("aircraft") or {}).get("name"), "callsign": (raw.get("atc") or {}).get("callsign"),
            "fuel_block": (raw.get("fuel") or {}).get("plan_ramp"), "units": (raw.get("params") or {}).get("units"),
            "ete": (raw.get("times") or {}).get("est_time_enroute"),
            "fixes": [{"id": x.get("ident"), "type": x.get("type"), "lat": f(x.get("pos_lat")), "lon": f(x.get("pos_long")),
                       "alt": x.get("altitude_feet"), "trk": x.get("track_mag"), "dist": x.get("distance"), "ete": x.get("time_leg"),
                       "freq": x.get("frequency")} for x in fixes],
        }

    # ---------------------------------------------------------------- airports
    def load_db(self):
        f = DATA / "airports.json"
        if not f.is_file():
            return
        try:
            self.airports = json.loads(f.read_text(encoding="utf-8"))
            self.by_id = {a["id"]: a for a in self.airports}
            self.db_state, self.db_msg = "ready", f"{len(self.airports)} airports"
            self.log(f"Airport database: {len(self.airports)} airports")
        except (OSError, ValueError) as e:
            self.db_state, self.db_msg = "error", str(e)

    def download_db(self):
        try:
            DATA.mkdir(exist_ok=True)
            self.db_msg = "downloading airports..."
            ap = fetch(OURAIRPORTS + "airports.csv", 120).decode("utf-8", "replace")
            self.db_msg = "downloading runways..."
            rw = fetch(OURAIRPORTS + "runways.csv", 120).decode("utf-8", "replace")
            self.db_msg = "downloading frequencies..."
            fq = fetch(OURAIRPORTS + "airport-frequencies.csv", 120).decode("utf-8", "replace")
            self.db_msg = "building database..."
            out, idx = [], {}
            for r in csv.DictReader(io.StringIO(ap)):
                if r["type"] not in KEEP_TYPES:
                    continue
                try:
                    a = {"id": r["ident"], "t": TYPE_RANK[r["type"]], "n": r["name"], "lat": round(float(r["latitude_deg"]), 5),
                         "lon": round(float(r["longitude_deg"]), 5), "elev": int(float(r["elevation_ft"] or 0)),
                         "city": r["municipality"], "cc": r["iso_country"], "rw": [], "fq": []}
                except ValueError:
                    continue
                idx[r["id"]] = a
                out.append(a)
            for r in csv.DictReader(io.StringIO(rw)):
                a = idx.get(r["airport_ref"])
                if a is not None and r.get("closed") != "1":
                    a["rw"].append([f"{r['le_ident']}/{r['he_ident']}", int(float(r["length_ft"] or 0)), r["surface"][:12], r["lighted"] == "1"])
            for r in csv.DictReader(io.StringIO(fq)):
                a = idx.get(r["airport_ref"])
                if a is not None:
                    a["fq"].append([r["type"][:8], r["description"][:30], r["frequency_mhz"]])
            (DATA / "airports.json").write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
            self.airports, self.by_id = out, {a["id"]: a for a in out}
            self.db_state, self.db_msg = "ready", f"{len(out)} airports"
            self.log(f"Airport database downloaded: {len(out)} airports")
        except Exception as e:
            self.db_state, self.db_msg = "error", f"download failed: {e}"
            self.log("Airport database download failed:", e)

    @staticmethod
    def lite(a):
        return {k: a[k] for k in ("id", "t", "n", "lat", "lon", "elev")}

    def in_bbox(self, bbox, limit):
        if not self.airports:
            return {"state": self.db_state, "airports": []}
        s, w, n, e = (float(x) for x in bbox.split(","))
        hits = [a for a in self.airports if s <= a["lat"] <= n and (w <= a["lon"] <= e if w <= e else (a["lon"] >= w or a["lon"] <= e))]
        hits.sort(key=lambda a: a["t"])
        return {"state": "ready", "airports": [self.lite(a) for a in hits[:limit]], "total": len(hits)}

    def nearest(self, lat, lon, n, heli):
        if not self.airports:
            return {"state": self.db_state, "airports": []}
        cand = [a for a in self.airports if abs(a["lat"] - lat) < 3 and (heli or a["t"] != 4)]
        cand.sort(key=lambda a: nm_between(lat, lon, a["lat"], a["lon"]))
        res = []
        for a in cand[:n]:
            x = self.lite(a)
            x["dist"] = round(nm_between(lat, lon, a["lat"], a["lon"]), 1)
            x["brg"] = round(bearing(lat, lon, a["lat"], a["lon"]))
            x["rw"] = a["rw"][:3]
            res.append(x)
        return {"state": "ready", "airports": res}
