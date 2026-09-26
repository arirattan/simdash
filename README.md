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
- **DCS cockpit:** builds a touch panel for *every* switch, button, knob, lamp and display of the DCS aircraft
  you're flying. It works for any aircraft DCS-BIOS supports (F-14, F-4E, AH-64D, …) and needs no setup.

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

Generic dashboards (Military jet / helicopter): flight instruments come from `SimDash.lua` for any aircraft.
Their switches are connected to DCS-BIOS for the **F-14, F-4E and AH-64D** in `bridge/dcs.json`; you can add more aircraft
there. If a gauge moves the wrong way in DCS (e.g. the attitude indicator banks backwards), set `flip` in `dcs.json`.

## 4. Panel lighting (night mode)
The **☀** button cycles **Day → Night (red backlight) → NVG (green)** on every panel. **⚙ › Brightness** dims further.

## 5. Other tools
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
