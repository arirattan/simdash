# SimDash: iPad cockpit panels for MSFS 2024 & DCS

Touch dashboards for an iPad: live instruments plus working buttons, switches, knobs and levers.
The bridge connects **directly to the sims**, so SimHub isn't needed:

```
 MSFS 2020/2024 ◄── SimConnect ──►┐
                                   ├── bridge/bridge.py (on the PC, port 8787) ◄── Wi-Fi ──► iPad Safari
 DCS World ◄── SimDash.lua ───────►│      serves the web app + WebSocket
           ◄── DCS-BIOS ──────────►┘
```

**Dashboards**
- **Civil aircraft · Civil helicopter · Military jet · Military helicopter:** instrument panels with touch controls.
- **Cockpit:** builds a touch panel for *every* control of the aircraft you're flying, read live from the sim:
  - **MSFS 2024/2020:** every clickable switch, button and knob of the loaded aircraft, from the sim's own
    "input events" (C172, C152, Caravan, Cabri G2, H125, add-ons…).
  - **DCS:** every switch, button, knob, lamp and display from DCS-BIOS (F-14, F-4E, AH-64D, …).

## 1. Try it now (no sim needed)
1. Install Python 3 if you don't have it.
2. Double-click **`start-demo.bat`**. It prints an address like `http://192.168.1.20:8787/`.
3. On the iPad (same Wi-Fi), open that address in Safari, then **Share → Add to Home Screen** for full-screen.
   - If the iPad can't connect: in Windows, set your Wi-Fi to **Private** (Settings › Network & internet › Wi-Fi ›
     your network › Network profile type). Then allow Python through the firewall on Private networks.

## 2. MSFS 2024 / 2020
Nothing to install. Double-click **`start-bridge.bat`** and fly. The bridge finds `SimConnect.dll` on its own; it
checks SimHub's folder, the MSFS SDK and MobiFlight. Gauges read SimVars, and buttons fire sim events directly,
so there are no key bindings to set up.
Mapping: `bridge/msfs.json` (SimVar per gauge, sim event per button). Restart the bridge after editing it.

**G1000 dashboard (MSFS):** a PFD and MFD bezel for G1000 aircraft (C172 G1000, 208B Grand Caravan, DA40…).
It has softkeys 1–12, D→ / MENU / FPL / PROC / CLR / ENT, dual FMS / NAV / COM / ALT / BARO-CRS knobs, HDG (push = sync),
RANGE (push = pan) and the GFC 700 autopilot keys. The keys fire the same sim events that MSFS's own G1000 cockpit
template binds to each bezel control (e.g. `G1000_PFD_SOFTKEY3`, `G1000_MFD_ENTER_BUTTON`,
`G1000_PFD_GROUP_KNOB_INC`), so no add-ons are needed. The screen area shows SimDash's own flight display; the Garmin
screen itself stays in the sim. Drag a knob's outer ring or inner knob, tap its centre to push, or use ⟲ − + ⟳.
FMS knob push has no sim event, so it presses the aircraft's input event instead (best effort).

**Cockpit dashboard (MSFS):** when an aircraft loads, the bridge asks the sim for that aircraft's cockpit controls,
the same ones you click in the 3D cockpit. They appear on the iPad grouped by system (LIGHTING, ELECTRICAL,
AUTOPILOT…). Buttons press, switches flip and knobs step, and they stay in sync with the cockpit.
The aircraft files themselves are encrypted, so nothing is copied out of MSFS; everything comes from the running
sim through SimConnect.
Tip: once you know a control's name from that page, a generic dashboard button can drive it directly. Map it in
`msfs.json` as `"AP_MASTER": "@AUTOPILOT_KAP140_Push_AP"` (the `@` means "cockpit input event").

## 3. DCS World
1. **Flight data:** double-click **`install-dcs.bat`** once. It copies `SimDash.lua` into
   `Saved Games\DCS\Scripts\SimDash\` and adds one line to `Scripts\Export.lua`. Existing lines
   (DCS-BIOS, MOZA, TacView…) are kept, a backup is made, and `install-dcs.bat --uninstall` removes it again.
2. **Cockpit switches:** install **DCS-BIOS**, the maintained version from
   https://github.com/DCS-Skunkworks/dcs-bios/releases. Follow its install guide
   (copy it into `Saved Games\DCS\Scripts\` and add its line to `Export.lua`).
3. Run **`start-bridge.bat`** and start a mission. The status pill shows e.g. `DCS · F-14B`.
4. Open the **DCS cockpit** dashboard on the iPad for every control of that aircraft. It has categories by panel,
   a search box, and PILOT / RIO / WSO / CPG filters.

**AH-64D Apache dashboard** (needs DCS-BIOS). Use **SEAT** to switch between PILOT and CPG; controls the current seat
doesn't have are hidden automatically.
- **MPD:** both MPD bezels (T1–T6, B1–B6 with M, L1–L6, R1–R6, FCR / WPN / TSD / * / VID / COM / A/C, and MODE / BRT / VIDEO).
  The left screen shows attitude and flight data; the right screen mirrors the EUFD text.
- **EUFD · KU:** the real Up-Front Display text (14 lines) with WCA / IDM / RTS rockers, PRESET / ENT / SWAP / STOPWATCH,
  and the full keyboard unit with its scratchpad.
- **PANELS:** master warning / caution, A/S arm and GND ORIDE, jettison stations, fire panel (covers lift first), engine
  start, APU, rotor brake, master ignition, CMWS (flare/chaff counts + threat sectors), emergency panel, and lights.
- **FLIGHT:** airspeed, attitude, altimeter, radar altimeter, heading, VSI and engine RPM, from SimDash.lua.

Generic dashboards (Military jet / helicopter): flight instruments come from `SimDash.lua` for any aircraft.
Their switches are connected to DCS-BIOS for the **F-14, F-4E and AH-64D** in `bridge/dcs.json`; you can add more aircraft
there. If a gauge moves the wrong way in DCS (e.g. the attitude indicator banks backwards), set `flip` in `dcs.json`.

## 4. Panel lighting (night mode)
The **☀** button cycles **Day → Night (red backlight) → NVG (green)** on every panel. **⚙ › Brightness** dims further.

## 5. Click feedback
Every control makes a short mechanical sound:
- push buttons click down and up
- toggle switches and selectors clack
- knobs tick once per detent while you turn them
- guard covers thud

Turn it on or off and set the volume in **⚙ › Click feedback**. iPads have no vibration motor, so true haptics aren't
possible; sound is the closest substitute. On Android tablets the same taps also vibrate. If the iPad is muted,
the clicks are muted too.

## 6. Other tools
- **⚙ › Property inspector:** live list of every value arriving from the sim.
- **⚙ › Show button log:** shows each input name as you tap a control.
- **SimHub mode (optional, old way):** `start-bridge-simhub.bat` uses SimHub's Property Server plugin with
  `bridge/properties.json`, and buttons are then bound in SimHub.

## Customising
- Layouts: `web/js/dashboards.js`. Instruments: `web/js/gauges.js` (the generic `Dial` covers most round gauges).
- Classic six-pack artwork: [jQuery-Flight-Indicators](https://github.com/sebmatton/jQuery-Flight-Indicators) (GPLv3),
  so this project is GPLv3 too (`LICENSE`).

## Files
```
start-bridge.bat          MSFS + DCS (direct)
start-demo.bat            fake data, try the iPad side
install-dcs.bat           installs SimDash.lua into DCS (--uninstall to remove)
start-bridge-simhub.bat   optional SimHub mode
bridge/bridge.py          HTTP + WebSocket server, routes data and touches
bridge/src_msfs.py        SimConnect (ctypes, no pip packages)      + msfs.json
bridge/src_dcs.py         SimDash.lua + DCS-BIOS client              + dcs.json
bridge/src_simhub.py      SimHub Property Server client (optional)  + properties.json
dcs/SimDash.lua           DCS export script
web/                      the iPad web app
```
