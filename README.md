# SimDash — iPad cockpit panels for DCS & MSFS 2024 (via SimHub)

Touch dashboards for an iPad: live instruments plus working buttons, switches, knobs and levers.
There are four dashboards: **Civil aircraft · Civil helicopter · Military jet · Military helicopter**.
Each one has several pages (flight instruments, autopilot/radios, systems panel, combat, engine).

```
 DCS / MSFS 2024 ──► SimHub ──► Property Server plugin (TCP 18082)
                                      ▲   │
              trigger-input (buttons) │   │ property values (~10 Hz)
                                      │   ▼
                              bridge/bridge.py  (on the PC, port 8787)
                                      ▲   │  WebSocket + serves the web app
                                      │   ▼
                            iPad Safari  http://<PC-IP>:8787/
```

## 1. Try it right now (no sim needed)
1. Install Python 3 (python.org or Microsoft Store) if you don't have it.
2. Double-click **`start-demo.bat`**. It prints an address like `http://192.168.1.20:8787/`.
3. On the iPad (same Wi-Fi network), open that address in Safari. If Windows asks, allow Python on **Private** networks.
4. In Safari tap **Share → Add to Home Screen**. The dashboard then opens full-screen like an app.

## 2. Connect it to SimHub
1. **Install the SimHub Property Server plugin**: download it from
   https://github.com/pre-martin/SimHubPropertyServer/releases and follow its README.
   Check that it's enabled in SimHub. Its default port is 18082.
2. **Enable the game in SimHub.**
   - **MSFS 2024:** SimHub › Games › Microsoft Flight Simulator (2020/2024).
   - **DCS:** SimHub › Games › DCS World. Let SimHub install/patch its `Export.lua` hook.
3. Double-click **`start-bridge.bat`**, then open the printed address on the iPad.
   The status pill (top right) should show the running sim, for example `FlightSimulator2024 · msfs`.

## 3. Map the data (one-time, per sim)
SimHub property names for flight sims depend on your SimHub version, so `bridge/properties.json`
lists **candidate names** for each value. The bridge uses the first candidate that has data.

- On the iPad open **⚙ › Property inspector**. Green rows are working. Grey rows have no data yet.
- For a grey row: in SimHub › **Available properties**, search (e.g. `altitude`), then right-click › **Copy name**.
  Paste the name at the top of that key's `"props"` list in `properties.json` and save.
  The bridge reloads the file automatically; you don't need to restart it.
- Units: use `"scale"`, `"offset"`, `"invert": true`, or `"rad2deg": true` per key.
  The DCS profile already converts metric → knots/feet/fpm.
- The profile is picked automatically from the running game. To force one: `start-bridge.bat --profile dcs`.

## 4. Make the buttons work (bind inputs in SimHub)
Every touch control sends a named **SimHub input** (press + release), for example `GEAR_UP` or `AP_MASTER`.
Bind each name once in SimHub (**Controls and events** / **Control mapper**) to the keyboard shortcut or
vJoy button your sim uses for that function.

Tip: open **⚙ › Show button log** on the iPad. It shows the exact input name every time you tap a control.
When SimHub is waiting for you to press an input, tap the iPad control.

Knobs send `<NAME>_INC` / `<NAME>_DEC` for each detent and `<NAME>_PUSH` when tapped.
Drag in a circle or up/down, or use the − / + buttons, which auto-repeat when held.

| Area | Input names |
|---|---|
| Gear / flaps / brakes | `GEAR_UP` `GEAR_DOWN` `GEAR_TOGGLE` `FLAPS_INC` `FLAPS_DEC` `PARKING_BRAKE` `SPEEDBRAKE_OUT` `SPEEDBRAKE_IN` `SPEEDBRAKE_TOGGLE` `HOOK_TOGGLE` `TRIM_NOSE_UP` `TRIM_NOSE_DN` |
| Autopilot | `AP_MASTER` `AP_FD` `AP_YD` `AP_HDG` `AP_NAV` `AP_APR` `AP_ALT` `AP_VS` `AP_FLC` `AP_BC` `AP_VNAV` `AP_CWS` `AP_ATT` `AP_HOVER` `AUTOTHROTTLE` |
| Knobs | `HDG_*` `CRS_*` `ALT_*` `VS_*` `BARO_*` `COM1_*` `NAV1_*` `XPDR_*` (each `_INC` `_DEC` `_PUSH`), `COM1_SWAP` `NAV1_SWAP` `XPDR_IDENT` |
| Electrical / engine | `MASTER_BATTERY` `MASTER_ALTERNATOR` `AVIONICS_MASTER` `GENERATOR` `GENERATOR_L` `GENERATOR_R` `APU` `FUEL_PUMP` `FUEL_VALVE` `GOVERNOR` `HYDRAULICS` `STARTER` `ENGINE_START_L` `ENGINE_START_R` `IDLE_RELEASE` `ROTOR_BRAKE` `BLEED_AIR` `FIRE_TEST` `CARB_HEAT` `MAGNETO_INC` `PITOT_HEAT` |
| Lights | `LIGHT_BEACON` `LIGHT_LANDING` `LIGHT_TAXI` `LIGHT_NAV` `LIGHT_STROBE` `LIGHT_FORMATION` `LIGHT_NVG` |
| Helicopter | `FORCE_TRIM` `SAS` `PEDAL_TRIM` `TAILWHEEL_LOCK` |
| Combat | `MASTER_ARM` `JETTISON` `WPN_GUN` `WPN_SRM` `WPN_MRM` `WPN_AG` `WPN_ROCKETS` `WPN_MISSILES` `WPN_DOOR` `LASER_ARM` `TGP_POWER` `SIGHT_MODE` `CM_CHAFF` `CM_FLARE` `CM_PROGRAM` `ECM_TOGGLE` `RWR_POWER` `IR_JAMMER` |
| Jet misc | `NWS` `LAUNCH_BAR` `CANOPY` `WING_FOLD` `ANTI_SKID` |

Guarded switches (MASTER ARM, JETTISON) take two taps: the first lifts the red guard, the second flips the switch.
The guard closes again after 4 seconds.

## 5. Panel lighting (night mode)
The **☀** button in the top bar of every dashboard cycles through three modes:
- **Day**
- **Night:** red backlighting. Instrument markings glow red and the panel goes dark.
- **NVG:** green, night-vision friendly.

Warning lamps and gear lights keep their real colors so they still read correctly.
**⚙ › Brightness** dims the whole screen in any mode. Your choice is remembered on the iPad.

## 6. Customising
- Layouts are in `web/js/dashboards.js`. A page is a grid, and each cell is an instrument or a group of controls.
  Copy a dashboard entry to build one for a specific aircraft (F/A-18, AH-64, Huey, C172…).
- Instruments are in `web/js/gauges.js`. `Dial` is a generic, configurable round gauge
  (ranges, colored arcs, non-linear scales, several needles, digital window).
- The classic six-pack artwork comes from
  [jQuery-Flight-Indicators](https://github.com/sebmatton/jQuery-Flight-Indicators) (GPLv3; license in `web/img/`).
  Because of that, keep this project GPLv3 if you share it.

## Files
```
start-demo.bat       fake data, test the iPad side
start-bridge.bat     real mode (SimHub)
bridge/bridge.py     bridge: HTTP + WebSocket server, SimHub client (Python stdlib only)
bridge/properties.json   SimHub property → dashboard value mapping (msfs, dcs)
web/                 the iPad web app
```
