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
- **Prop & Cessna** (MSFS):
  - **PANEL:** six-pack, VOR/CDI with glideslope, ADF, tach and engine bars.
  - **RADIOS:** COM1/NAV1/COM2/NAV2 (tap a standby frequency to type it on a keypad), transponder (type a squawk,
    1200/7000, IDENT), ADF, and a KAP 140 autopilot.
  - **CONTROLS:** touch throttle / prop / mixture levers, trim wheel, flaps, fuel selector, magneto key (hold START)
    and switches.
- **G1000** (MSFS): PFD and MFD bezels, including softkeys, FMS knobs and the GFC 700 keys. Pop the PFD / MFD out in
  MSFS and the **real Garmin screen** shows in the bezel, with each softkey right under its label.
- **Moving map** (MSFS & DCS):
  - Your aircraft and trail, with follow mode and range rings.
  - Streets / Topo / Satellite / Dark maps, plus an optional openAIP chart overlay (free API key).
  - **Long-press anywhere for Direct-To** (bearing, distance, ETE).
  - Airports with runways, frequencies and METAR, a NEAREST list, and your SimBrief route.
    Airports need the free OurAirports database; the map offers to download it once (about 15 MB, into `bridge/data/`).
- **Flight bag** (the in-flight iPad):
  - Checklists: C152/172, C172 G1000, Cub/Beaver, Caravan/PC-6, AT-802, CL-415/Air Crane, turbine and piston
    helicopters, and rescue/HEMS.
  - A finger / Apple Pencil scratchpad with CRAFT / ATIS / taxi templates.
  - Timers: auto flight time, stopwatch, countdowns with alarm, and a fuel-tank reminder.
  - METAR/TAF weather, with a nearest-stations button.
  - An E6B (wind triangle, runway crosswind, density altitude, fuel, descent, conversions). Values fill in from the sim.
  - SimBrief OFP and navlog.
- **My panels:** build your own pages right on the iPad.
  - Tap **✎ EDIT**, then tap an empty cell to add a widget:
    - any instrument from the other dashboards (six-pack, CDI, ADF, tachs, torque, hover display, radios, KAP 140…)
    - readouts, bar gauges, round dials and warning lamps (pick any sim value)
    - buttons, toggle switches, knobs and levers
    - labels
    - **any live cockpit control of the current aircraft** (MSFS input events / DCS-BIOS)
  - Tap a widget to move (arrows, or tap an empty cell), resize (W±/H±), edit, copy or delete it.
  - Pages: rename, grid size, add, duplicate, reorder and delete.
  - **EXPORT / IMPORT** layouts as text to share them or back them up.
  - What a button, switch or knob sends can be picked from lists:
    - `K:EVENT` or `K:EVENT=value`: MSFS sim event
    - `@INPUT_EVENT`: MSFS cockpit input event
    - `bios:ID [ARG]`: cockpit control; without ARG it acts as a push button
    - a named input from `msfs.json` / `dcs.json`
  - **TEST** fires an action right from the editor.
  - Layouts are saved on the iPad and on the bridge (`bridge/data/layouts.json`), so they survive clearing Safari.
- **Heli hover & rescue** (MSFS & DCS):
  - **HOVER:** a top-down drift display. The velocity vector shows forward/aft and left/right drift in knots, on
    rings that auto-scale (10/20/40 kt), with a wind arrow relative to the nose and a marker toward your target.
  - Next to it: a big radar altitude (amber below 50 ft), a vertical-speed bar, GS, torque, NR and TOT.
  - The HOVER page is also added to the Civil and Military helicopter dashboards.
  - **RESCUE:**
    - A bearing arrow to the target, with distance, ETE and "turn left/right".
    - The target is shared with the moving map's Direct-To, and **MARK POSITION** saves where you are.
    - Wind components with a "turn to face it" hint.
    - An expanding-square search helper (leg heading, length and time left).
    - ATT/ALT/HDG holds and lights.
- **Ag & Fire** (MSFS 2024 liquid-dropping system):
  - Hopper/tank level.
  - Hold-to-drop / spray, door open/close, and scoop down/up for the AT-802, CL-415 and Air Crane.
  - Radar altimeter, levers and turboprop gauges (torque, ITT, Ng, prop RPM).
  - If the drop door doesn't react, swap the two numbers of `DROP_OPEN` / `DROP_CLOSE` in `bridge/msfs.json`.
- **Civil aircraft · Civil helicopter · Military jet · Military helicopter:** instrument panels with touch controls.
- **AH-64D Apache** (DCS): MPDs with the **live MPD pictures**, a **TADS · TEDAC** page with the **live FLIR / TV picture**,
  EUFD + keyboard, and fire / arm / CMWS panels.
- **F-14 Tomcat** (DCS): pilot and RIO seats with every panel: master arm, engine / fuel, gear, AFCS, the full caution
  panel, radios, the RIO's CAP keypad, radar / DDD / TID controls, countermeasures and armament.
- **Live screens:** the real cockpit displays streamed from DCS to the iPad (FLIR, FCR radar, TSD, MFDs; see section 3b).
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
`G1000_PFD_GROUP_KNOB_INC`), so no add-ons are needed. Drag a knob's outer ring or inner knob, tap its centre to push,
or use ⟲ − + ⟳. FMS knob push has no sim event, so it presses the aircraft's input event instead (best effort).

*The real G1000 screen and softkey labels:* the softkeys only mean something with the Garmin screen above them, so the
bridge streams the sim's own PFD / MFD into the bezel (Windows):
1. Once: double-click **`install-screen-capture.bat`** (installs `windows-capture`), so the pop-outs don't have to stay
   visible on the PC. Restart the bridge.
2. In the cockpit, **Right-Alt + click the PFD**, then the MFD. MSFS opens each one in its own window ("pop-out").
   Put the PFD left of (or above) the MFD, then click back into the sim: the pop-outs can sit **behind the sim window**
   or be **minimised**, and the iPad still shows them (Windows Graphics Capture).
   Without step 1 the bridge copies them off the screen, so they must stay visible (a second monitor or a corner of
   the main screen); a covered pop-out would show whatever covers it.
3. The G1000 page shows **● LIVE** and the picture fills the bezel. The softkey row is exactly as wide as the picture, so
   each key sits under its label.

If it says **NO SIGNAL**, the amber line under it says why, and the bridge window lists the pop-outs it found
(`Screens: MSFS pop-outs, left to right: #1 1024x768 …`) or the MSFS windows it can see. "0 open" means no pop-out
window exists yet: in the 3D cockpit, hold **Right-Alt** (the Alt key right of the space bar) and left-click on the PFD
screen itself. A separate window with only the PFD appears; it can open small or behind the sim, so look for it.
Very large pop-outs are scaled down for Wi-Fi. If Windows Graphics Capture can't capture a window, the bridge window
says so and falls back to copying it off the screen.

The bridge finds the pop-outs by itself and counts them left to right: the 1st is the PFD, the 2nd the MFD. To pick
them yourself (e.g. only the MFD popped out), set `G1000_PFD` / `G1000_MFD` in `bridge/data/screens.json`:
`"G1000_MFD": {"popout": 1}` (1st pop-out), `{"window": "MFD"}` (window title, e.g. renamed by Pop Out Panel Manager),
or desktop pixels. Without a pop-out the screen shows SimDash's own flight display.

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

- **TADS · TEDAC** (the CPG's sight): the live TEDAC picture (TADS FLIR / TV / DVO, or FCR / PNV / G/S video) in its bezel with
  the video-select keys, SYM / BRT / CON, FLIR GAIN / LEV, R/F, EL, AZ, * / BORESIGHT / ACM / FREEZE / FILTER. Next to it are
  the handgrip switches: sensor select, FOV, IAT / OFS, LMC, laser tracker, STORE / UPDT, sight slave, manual tracker, sight
  select, weapons action, FCR mode / scan, cued search, C-scope and the cursor. Needs live screens (section 3b).
- With live screens set up, the MPD page shows the **real MPD pictures** (TSD, FCR radar, video / FLIR, engine pages...) inside
  the bezels; otherwise it shows flight data and the EUFD text as before.

**F-14 Tomcat dashboard** (needs DCS-BIOS; F-14A and F-14B). **SEAT** switches between PILOT and RIO. Switch positions and
labels come from DCS-BIOS, and controls your version doesn't have (e.g. the F-14B(U) ALE-47) are hidden.
- **Pilot:** FLIGHT (instruments, AOA indexer, fuel readouts, master caution) · ARMAMENT (master arm, ACM cover / jettison,
  gun rate, Sidewinder cool, missile prep / mode, HUD modes) · ENGINE · FUEL (crank, throttle mode / temp, generators, fire
  bottles, fuel panel with the fuel counters and BINGO, hydraulics) · GEAR · SYSTEMS (gear, hook, launch bar, nose strut,
  anti-skid, flaps, AFCS / autopilot, lights, canopy) · CAUTION (all 49 caution / advisory lamps) · RADIO · NAV (ARC-159 UHF
  with its frequency display, TACAN with range / course, steering and HSD / VDI modes).
- **RIO:** CAP · TID (computer address panel with category, the 10 function keys and the keypad, plus the TID controls) ·
  RADAR (modes, ranges, elevation bars / azimuth, DDD and hand-control-unit switches) · DEFENSIVE (AN/ALE-37 with the chaff /
  flare / jammer counters, RWR, DECM) · ARMAMENT (weapon wheel, fuzing, missile options, selective jettison) · RADIO · NAV
  (ARC-182 V/UHF with its display, TACAN).
- Guarded switches show a red-striped cover: tap it to lift the cover, then flip the switch.
- The TID and DDD **pictures** can't be shown: Heatblur's F-14 (and F-4E) don't support DCS's display export, so there is
  nothing to stream. All their controls work.

Generic dashboards (Military jet / helicopter): flight instruments come from `SimDash.lua` for any aircraft.
Their switches are connected to DCS-BIOS for the **F-14, F-4E and AH-64D** in `bridge/dcs.json`; you can add more aircraft
there. If a gauge moves the wrong way in DCS (e.g. the attitude indicator banks backwards), set `flip` in `dcs.json`.

## 3b. Live screens: FLIR, radar and MFD pictures on the iPad
DCS can draw an aircraft's displays in extra places on your PC screen ("exported displays"). The bridge copies those
places off the screen and streams them to the iPad several times a second.
1. Double-click **`setup-screens.bat`** once. It writes a DCS monitor layout (`Saved Games\DCS\Config\MonitorSetup\SimDash.lua`)
   and `bridge/data/screens.json`:
   - with a second monitor to the right of the main one, the displays go there;
   - otherwise they go in a strip on the right of the main screen (the 3D view gets a bit narrower).
   - `--strip` forces the strip, `--size 600` sets the display size, `--remove` deletes the layout again.
2. In DCS: **Options › System**: Monitors = **SimDash (iPad live screens)**, Resolution = the size the script prints, and
   **Full Screen off** (exclusive full screen captures as black). Restart DCS.
3. Start the bridge. The Apache MPD page and TADS · TEDAC page go live on their own.

Which aircraft can export displays: most Eagle Dynamics modules use `LEFT_MFCD` / `RIGHT_MFCD` / `CENTER_MFCD`: the AH-64D
(both MPDs, and the TEDAC in the centre slot), F/A-18C, F-16C, A-10C and others. Heatblur's F-14 and F-4E don't support it.

- **My panels** has a **Live screen** widget, so you can put any screen on your own pages at any size.
- MSFS pop-outs (Right-Alt + click an instrument) are found by themselves: the G1000 page uses the first two as
  `G1000_PFD` / `G1000_MFD` (see section 2).
- Any window or area of the PC screen can be added to `bridge/data/screens.json` by hand:
  `"GNS530": {"label": "GNS 530", "popout": 3}` (the 3rd MSFS pop-out, counted left to right),
  `{"window": "PFD"}` (a part of a window title) or `{"x": 1920, "y": 0, "w": 600, "h": 600}` (desktop pixels).
- Pictures are PNG. **`pip install pillow`** (or `install-screen-capture.bat`) switches them to JPEG, which is about
  10x smaller and smoother over Wi-Fi.
  `"fps"` (default 8) and `"quality"` (default 70) in screens.json tune speed against Wi-Fi load.
- Demo mode shows a fake FLIR picture on the TADS page so you can see how it looks.

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
setup-screens.bat         DCS display export for live screens (FLIR, radar, MFDs)
install-screen-capture.bat  lets MSFS pop-outs stay hidden while the iPad shows them (windows-capture)
start-bridge-simhub.bat   optional SimHub mode
bridge/bridge.py          HTTP + WebSocket server, routes data and touches
bridge/src_msfs.py        SimConnect (ctypes, no pip packages)      + msfs.json
bridge/src_dcs.py         SimDash.lua + DCS-BIOS client              + dcs.json
bridge/src_simhub.py      SimHub Property Server client (optional)  + properties.json
bridge/src_screens.py     live screens: copies exported displays off the PC screen
bridge/setup_screens.py   writes the DCS monitor layout + bridge/data/screens.json
dcs/SimDash.lua           DCS export script
web/                      the iPad web app
```
