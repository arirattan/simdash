/*
 * Dashboard layouts. Each dashboard = pages; each page = CSS grid of cells.
 * cell: [widgetFactory, colSpan, rowSpan]
 *
 * Input names (what you bind in SimHub) are the UPPER_CASE strings.
 * Data keys (what properties.json maps) are the lower_case strings.
 */
(function (global) {
  'use strict';
  const G = global.Gauges, C = global.Controls;

  // A titled group of widgets (panel section)
  function Group(title, children, cls = '') {
    return () => {
      const wrap = G.el('div', { class: 'group ' + cls });
      if (title) G.el('div', { class: 'group-title', text: title }, wrap);
      const body = G.el('div', { class: 'group-body' }, wrap);
      const ws = children.map((f) => (typeof f === 'function' ? f() : f));
      ws.forEach((w) => body.appendChild(w.el));
      return { el: wrap, keys: [], children: ws, update() {} };
    };
  }
  const W = (fn, o) => () => fn(o);
  const fmt3 = (v) => String(Math.round(((v % 360) + 360) % 360)).padStart(3, '0');
  const fmtAlt = (v) => Math.round(v).toLocaleString('en-US');
  const fmtVs = (v) => (v > 0 ? '+' : '') + Math.round(v);

  // ------------------------------------------------------------------ //
  // Shared instrument presets
  // ------------------------------------------------------------------ //
  const I = {
    att: W(G.Attitude, {}),
    alt: W(G.Altimeter, {}),
    hdg: W(G.Heading, { course: true }),
    hdgPlain: W(G.Heading, {}),
    vsi: W(G.Vario, {}),
    tc: W(G.TurnCoordinator, {}),
    asiGA: W(G.Dial, { key: 'ias', min: 0, max: 200, start: -160, end: 160, major: 20, minor: 5, title: 'AIRSPEED', unit: 'KNOTS',
      arcs: [{ from: 40, to: 85, color: '#f5f5f5', r: 76, w: 4 }, { from: 50, to: 129, color: '#1db32a' }, { from: 129, to: 163, color: '#f2c200' }, { from: 163, to: 166, color: '#e0201b', w: 9 }],
      digital: 'ias' }),
    asiHeli: W(G.Dial, { key: 'ias', min: 0, max: 160, start: -160, end: 160, major: 20, minor: 5, title: 'AIRSPEED', unit: 'KNOTS',
      arcs: [{ from: 0, to: 130, color: '#1db32a' }, { from: 130, to: 140, color: '#e0201b', w: 9 }], digital: 'ias' }),
    asiMilHeli: W(G.Dial, { key: 'ias', min: 0, max: 200, start: -160, end: 160, major: 20, minor: 5, title: 'AIRSPEED', unit: 'KNOTS',
      arcs: [{ from: 0, to: 150, color: '#1db32a' }, { from: 150, to: 193, color: '#f2c200' }, { from: 193, to: 196, color: '#e0201b', w: 9 }], digital: 'ias' }),
    // Jet ASI: expanded low-speed scale, compressed high-speed, digital Mach window
    asiJet: W(G.Dial, { key: 'ias', min: 80, max: 850, start: -150, end: 150,
      points: [[80, 0], [200, 0.25], [300, 0.45], [500, 0.75], [850, 1]],
      labels: [100, 150, 200, 250, 300, 400, 500, 600, 700, 850], major: 0, minor: 0, fontSize: 12, labelR: 66,
      ticksAt: [90, 110, 120, 130, 140, 160, 170, 180, 190, 210, 220, 230, 240, 260, 270, 280, 290, 350, 450, 550, 650, 750, 800],
      title: 'KNOTS', titleY: 76, digital: (s) => (typeof s.mach === 'number' ? 'M ' + s.mach.toFixed(2) : 'M -.--'), keys: ['mach'], digitalY: 140 }),
    vviJet: W(G.Dial, { key: 'vs', min: -6000, max: 6000, start: -90 - 170, end: -90 + 170,
      points: [[-6000, 0], [-2000, 0.2], [-1000, 0.33], [0, 0.5], [1000, 0.67], [2000, 0.8], [6000, 1]],
      labels: [-6000, -4000, -2000, -1000, 0, 1000, 2000, 4000, 6000], labelScale: 0.001, major: 0, fontSize: 13, title: 'VERT VEL', unit: 'x1000 FT/MIN', titleY: 72,
      ticksAt: [-5000, -3000, -1500, -500, 500, 1500, 3000, 5000],
      digital: (s) => (typeof s.vs === 'number' ? fmtVs(s.vs) : '---'), digitalY: 140 }),
    g: W(G.Dial, { key: 'g', min: -4, max: 10, start: -135, end: 135, major: 2, minor: 0.5, title: 'G', unit: 'double-tap reset', minmax: true,
      arcs: [{ from: -3, to: -2, color: '#f2c200' }, { from: -4, to: -3, color: '#e0201b' }, { from: 7.5, to: 9, color: '#f2c200' }, { from: 9, to: 10, color: '#e0201b' }],
      digital: (s) => (typeof s.g === 'number' ? s.g.toFixed(1) : '-.-') }),
    aoa: W(G.Dial, { key: 'aoa', min: 0, max: 35, start: -135, end: 135, major: 5, minor: 1, title: 'AOA', unit: 'UNITS / DEG',
      arcs: [{ from: 7.4, to: 8.8, color: '#1db32a' }, { from: 22, to: 35, color: '#e0201b' }], digital: (s) => (typeof s.aoa === 'number' ? s.aoa.toFixed(1) : '--') }),
    rpmJet: W(G.Dial, { min: 0, max: 110, start: -135, end: 135, major: 10, minor: 5, title: 'RPM', unit: '% L / R', labels: [0, 20, 40, 60, 80, 100],
      needles: [{ key: 'n1', color: '#f2f2f2', label: 'L' }, { key: 'n2', color: '#58c7ff', label: 'R', length: 64 }],
      arcs: [{ from: 102, to: 110, color: '#e0201b' }], digital: (s) => (typeof s.n1 === 'number' ? Math.round(s.n1) + ' ' + Math.round(s.n2 || 0) : '--') }),
    egtJet: W(G.Dial, { key: 'egt', min: 200, max: 1000, start: -135, end: 135, major: 100, minor: 50, labelScale: 0.01, title: 'EGT', unit: '°C x100',
      arcs: [{ from: 850, to: 900, color: '#f2c200' }, { from: 900, to: 1000, color: '#e0201b' }], digital: 'egt' }),
    fuelJet: W(G.Dial, { key: 'fuel', min: 0, max: 100, start: -135, end: 135, major: 20, minor: 5, title: 'FUEL', unit: '%',
      arcs: [{ from: 0, to: 15, color: '#e0201b' }], digital: (s) => (typeof s.fuel_l === 'number' ? Math.round(s.fuel_l) : typeof s.fuel === 'number' ? Math.round(s.fuel) + '%' : '--'), keys: ['fuel_l'] }),
    rpmGA: W(G.Dial, { key: 'rpm', min: 0, max: 3500, start: -135, end: 135, major: 500, minor: 100, labelScale: 0.01, title: 'RPM', unit: 'x100',
      arcs: [{ from: 2100, to: 2700, color: '#1db32a' }, { from: 2700, to: 2750, color: '#e0201b', w: 9 }], digital: 'rpm' }),
    // Helicopter dual tach: rotor NR + engine N2 on one face
    dualTach: W(G.Dial, { min: 0, max: 120, start: -135, end: 135, major: 10, minor: 5, labels: [0, 20, 40, 60, 80, 100, 120], title: 'ROTOR / ENG', unit: 'NR  % N2',
      needles: [{ key: 'n2', color: '#f2f2f2', label: 'E' }, { key: 'nr', color: '#ffae00', label: 'R', length: 66 }],
      arcs: [{ from: 95, to: 104, color: '#1db32a' }, { from: 104, to: 110, color: '#f2c200' }, { from: 110, to: 120, color: '#e0201b' }, { from: 0, to: 90, color: '#e0201b', r: 70, w: 3 }],
      digital: (s) => (typeof s.nr === 'number' ? Math.round(s.nr) + ' / ' + Math.round(s.n2 || 0) : '--') }),
    torque: W(G.Dial, { key: 'torque', min: 0, max: 120, start: -135, end: 135, major: 10, minor: 5, labels: [0, 20, 40, 60, 80, 100, 120], title: 'TORQUE', unit: '%',
      arcs: [{ from: 0, to: 85, color: '#1db32a' }, { from: 85, to: 100, color: '#f2c200' }, { from: 100, to: 120, color: '#e0201b' }], digital: 'torque' }),
    radalt: W(G.Dial, { key: 'radalt', min: 0, max: 1500, start: 0, end: 330,
      points: [[0, 0], [100, 0.33], [200, 0.5], [500, 0.75], [1000, 0.9], [1500, 1]],
      labels: [0, 50, 100, 200, 300, 500, 1000, 1500], labelScale: 1, major: 0, fontSize: 11, labelR: 67, title: 'RAD ALT', unit: 'FEET', titleY: 124, digitalY: 76,
      ticksAt: [10, 20, 30, 40, 60, 70, 80, 90, 150, 250, 400, 750],
      digital: (s) => (typeof s.radalt === 'number' ? (s.radalt > 1500 ? '----' : Math.round(s.radalt)) : '----') }),
    totHeli: W(G.Dial, { key: 'egt', min: 0, max: 1000, start: -135, end: 135, major: 100, minor: 50, labelScale: 0.01, title: 'TOT', unit: '°C x100',
      arcs: [{ from: 300, to: 738, color: '#1db32a' }, { from: 738, to: 810, color: '#f2c200' }, { from: 810, to: 1000, color: '#e0201b' }], digital: 'egt' }),
    ngHeli: W(G.Dial, { key: 'n1', min: 0, max: 110, start: -135, end: 135, major: 10, minor: 5, labels: [0, 20, 40, 60, 80, 100], title: 'GAS PROD', unit: 'N1 %',
      arcs: [{ from: 60, to: 105, color: '#1db32a' }, { from: 105, to: 110, color: '#e0201b' }], digital: (s) => (typeof s.n1 === 'number' ? s.n1.toFixed(1) : '--') }),
    fuelLR: W(G.Dial, { min: 0, max: 30, start: -135, end: 135, major: 5, minor: 1, title: 'FUEL', unit: 'GAL  L / R',
      needles: [{ key: 'fuel_l', color: '#f2f2f2', label: 'L' }, { key: 'fuel_r', color: '#58c7ff', label: 'R', length: 64 }], arcs: [{ from: 0, to: 3, color: '#e0201b' }] }),
    compassStrip: null
  };

  const bars = (list) => Group('', list.map((b) => W(G.Bar, b)), 'bars');
  const engineBarsGA = bars([
    { key: 'oil_p', title: 'OIL P', min: 0, max: 115, unit: 'psi', bands: [{ from: 25, to: 100, color: '#1db32a' }] },
    { key: 'oil_t', title: 'OIL T', min: 0, max: 130, unit: '°C', bands: [{ from: 40, to: 118, color: '#1db32a' }] },
    { key: 'egt', title: 'EGT', min: 0, max: 900, unit: '°C', bands: [] },
    { key: 'cht', title: 'CHT', min: 100, max: 500, unit: '°F', bands: [{ from: 200, to: 435, color: '#1db32a' }, { from: 435, to: 500, color: '#e0201b' }] },
    { key: 'volts', title: 'VOLTS', min: 20, max: 32, dp: 1, bands: [{ from: 26, to: 29.5, color: '#1db32a' }] },
    { key: 'amps', title: 'AMPS', min: -20, max: 60, bands: [] }
  ]);
  const engineBarsHeli = bars([
    { key: 'oil_p', title: 'ENG OIL P', min: 0, max: 150, unit: 'psi', bands: [{ from: 50, to: 130, color: '#1db32a' }] },
    { key: 'oil_t', title: 'ENG OIL T', min: 0, max: 130, unit: '°C', bands: [{ from: 0, to: 107, color: '#1db32a' }] },
    { key: 'fuel', title: 'FUEL', min: 0, max: 100, unit: '%', bands: [{ from: 0, to: 10, color: '#e0201b' }] },
    { key: 'fuel_flow', title: 'FUEL FLOW', min: 0, max: 60, dp: 1, bands: [] },
    { key: 'volts', title: 'VOLTS', min: 20, max: 32, dp: 1, bands: [{ from: 26, to: 29.5, color: '#1db32a' }] }
  ]);

  // ------------------------------------------------------------------ //
  // Shared control groups
  // ------------------------------------------------------------------ //
  const knob = (text, pre, key, extra = {}) => W(C.Knob, Object.assign({ text, inc: pre + '_INC', dec: pre + '_DEC', push: pre + '_PUSH', key }, extra));
  const btn = (text, input, key, extra = {}) => W(C.Button, Object.assign({ text, input, key }, extra));
  const tog = (text, input, key, extra = {}) => W(C.Toggle, Object.assign({ text, input, key }, extra));
  const lamp = (text, key, color, extra = {}) => W(G.Lamp, Object.assign({ text, key, color }, extra));

  const apPanelGA = Group('AUTOPILOT', [
    btn('AP', 'AP_MASTER', 'ap_master'), btn('FD', 'AP_FD', 'ap_fd'), btn('YD', 'AP_YD', 'ap_yd'),
    btn('HDG', 'AP_HDG', 'ap_hdg'), btn('NAV', 'AP_NAV', 'ap_nav'), btn('APR', 'AP_APR', 'ap_apr'),
    btn('ALT', 'AP_ALT', 'ap_alt'), btn('VS', 'AP_VS', 'ap_vs'), btn('FLC', 'AP_FLC', 'ap_flc'),
    btn('BC', 'AP_BC', 'ap_bc'), btn('VNV', 'AP_VNAV', 'ap_vnav'), btn('CWS', 'AP_CWS')
  ], 'buttons-grid');
  const apKnobsGA = Group('SELECT', [
    knob('HDG', 'HDG', 'hdg_bug', { format: fmt3 }), knob('CRS', 'CRS', 'crs', { format: fmt3 }),
    knob('ALT', 'ALT', 'alt_sel', { format: fmtAlt }), knob('VS', 'VS', 'vs_sel', { format: fmtVs }),
    knob('BARO', 'BARO', 'baro', { format: (v) => v.toFixed(0) + ' hPa' })
  ], 'knobs');
  const radiosGA = Group('RADIOS', [
    knob('COM1', 'COM1', 'com1', { format: (v) => (+v).toFixed(3), push: 'COM1_SWAP' }),
    knob('NAV1', 'NAV1', 'nav1', { format: (v) => (+v).toFixed(2), push: 'NAV1_SWAP' }),
    knob('XPDR', 'XPDR', 'xpdr', { format: (v) => String(Math.round(v)).padStart(4, '0') }),
    btn('COM ⇄', 'COM1_SWAP'), btn('NAV ⇄', 'NAV1_SWAP'), btn('IDENT', 'XPDR_IDENT')
  ], 'knobs');

  const lightsGA = Group('LIGHTS', [
    tog('BEACON', 'LIGHT_BEACON', 'light_beacon'), tog('LAND', 'LIGHT_LANDING', 'light_landing'),
    tog('TAXI', 'LIGHT_TAXI', 'light_taxi'), tog('NAV', 'LIGHT_NAV', 'light_nav'), tog('STROBE', 'LIGHT_STROBE', 'light_strobe')
  ], 'switches');
  const elecGA = Group('ELECTRICAL', [
    tog('BAT', 'MASTER_BATTERY', 'battery'), tog('ALT', 'MASTER_ALTERNATOR', 'alternator'), tog('AVIONICS', 'AVIONICS_MASTER', 'avionics'),
    tog('FUEL PUMP', 'FUEL_PUMP', 'fuel_pump'), tog('PITOT HT', 'PITOT_HEAT', 'pitot_heat')
  ], 'switches');
  const annunGA = Group('ANNUNCIATORS', [
    lamp('MASTER\nWARN', 'master_warning', 'red', { blink: true }), lamp('MASTER\nCAUTION', 'master_caution', 'amber'),
    lamp('PARK BRK', 'parking_brake', 'red'), lamp('LOW VOLTS', 'volts', 'amber', { when: (v) => typeof v === 'number' && v < 24 }),
    lamp('OIL PRESS', 'oil_p', 'red', { when: (v) => typeof v === 'number' && v < 20 }), lamp('LOW FUEL', 'fuel', 'amber', { when: (v) => typeof v === 'number' && v < 10 })
  ], 'lamps');
  const flightCtlGA = Group('', [
    W(C.GearLever, {}),
    W(C.Selector, { text: 'FLAPS', key: 'flaps', inc: 'FLAPS_INC', dec: 'FLAPS_DEC', positions: ['UP', '10°', '20°', 'FULL'] }),
    Group('TRIM / BRAKES', [
      btn('TRIM ▲', 'TRIM_NOSE_DN', null, { sub: 'nose dn' }), btn('TRIM ▼', 'TRIM_NOSE_UP', null, { sub: 'nose up' }),
      btn('PARK BRK', 'PARKING_BRAKE', 'parking_brake'), btn('CARB HT', 'CARB_HEAT', 'carb_heat'),
      btn('MAG L/R/B', 'MAGNETO_INC'), btn('START', 'STARTER', null, { cls: 'red' })
    ], 'buttons-grid')
  ], 'row');

  // ------------------------------------------------------------------ //
  // Military shared groups
  // ------------------------------------------------------------------ //
  const cautionsMil = Group('', [
    lamp('MASTER\nWARNING', 'master_warning', 'red', { blink: true, size: 'big' }),
    lamp('MASTER\nCAUTION', 'master_caution', 'amber', { size: 'big' })
  ], 'lamps stack');
  const cmGroup = (programs) => Group('COUNTERMEASURES', [
    W(C.CountButton, { text: 'CHAFF', input: 'CM_CHAFF', key: 'chaff' }),
    W(C.CountButton, { text: 'FLARE', input: 'CM_FLARE', key: 'flare', cls: 'amber' }),
    btn('PROGRAM', 'CM_PROGRAM', null, { sub: 'dispense' }),
    ...(programs || [])
  ], 'buttons-grid cm');
  const armGroup = (weapons) => Group('ARMAMENT', [
    W(C.Guarded, { text: 'MASTER ARM', input: 'MASTER_ARM', key: 'master_arm', onText: 'ARM', offText: 'SAFE' }),
    W(C.Guarded, { text: 'JETTISON', input: 'JETTISON', onText: 'JETT', offText: 'NORM' }),
    Group('', weapons.map(([t, i]) => btn(t, i, i.toLowerCase(), { latch: true })), 'buttons-grid'),
    W(G.Readout, { title: 'GUN', key: 'gun', big: true })
  ], 'row wrap');

  // Quick strips under the flight instruments
  const STRIP = '1fr 1fr 128px';
  const strip = (items) => [Group('', items, 'row strip'), 99, 1];
  const quickGA = strip([
    lamp('MASTER\nWARN', 'master_warning', 'red', { blink: true }), lamp('MASTER\nCAUT', 'master_caution', 'amber'),
    W(G.GearLights, {}), W(G.Readout, { title: 'FLAPS', key: 'flaps' }),
    btn('AP', 'AP_MASTER', 'ap_master'), btn('HDG', 'AP_HDG', 'ap_hdg'), btn('NAV', 'AP_NAV', 'ap_nav'), btn('ALT', 'AP_ALT', 'ap_alt'),
    btn('FLAPS ▲', 'FLAPS_DEC'), btn('FLAPS ▼', 'FLAPS_INC'), btn('PARK BRK', 'PARKING_BRAKE', 'parking_brake')
  ]);
  const quickHeli = strip([
    lamp('MASTER\nCAUT', 'master_caution', 'amber'), lamp('LOW\nROTOR', 'nr', 'red', { blink: true, when: (v) => typeof v === 'number' && v > 5 && v < 90 }),
    W(G.Readout, { title: 'RAD ALT', key: 'radalt', unit: ' ft' }), btn('FORCE TRIM', 'FORCE_TRIM', null, { sub: 'release' }),
    btn('ATT HOLD', 'AP_ATT', 'ap_att'), btn('ALT HOLD', 'AP_ALT', 'ap_alt'), btn('HOVER', 'AP_HOVER', 'ap_hover'), btn('LDG LT', 'LIGHT_LANDING', 'light_landing')
  ]);
  const quickJet = strip([
    lamp('MASTER\nWARN', 'master_warning', 'red', { blink: true }), lamp('MASTER\nCAUT', 'master_caution', 'amber'),
    W(G.GearLights, {}), btn('GEAR', 'GEAR_TOGGLE', 'gear'), btn('HOOK', 'HOOK_TOGGLE', 'hook'), btn('SPD BRK', 'SPEEDBRAKE_TOGGLE', 'speedbrake'),
    W(C.CountButton, { text: 'CHAFF', input: 'CM_CHAFF', key: 'chaff' }), W(C.CountButton, { text: 'FLARE', input: 'CM_FLARE', key: 'flare', cls: 'amber' }),
    btn('MASTER ARM', 'MASTER_ARM', 'master_arm', { cls: 'red' })
  ]);
  const quickMilHeli = strip([
    lamp('MASTER\nWARN', 'master_warning', 'red', { blink: true }), lamp('MASTER\nCAUT', 'master_caution', 'amber'),
    W(G.Readout, { title: 'RAD ALT', key: 'radalt', unit: ' ft' }), btn('FORCE TRIM', 'FORCE_TRIM', null, { sub: 'release' }), btn('ALT HOLD', 'AP_ALT', 'ap_alt'), btn('HOVER', 'AP_HOVER', 'ap_hover'),
    W(C.CountButton, { text: 'CHAFF', input: 'CM_CHAFF', key: 'chaff' }), W(C.CountButton, { text: 'FLARE', input: 'CM_FLARE', key: 'flare', cls: 'amber' }),
    btn('MASTER ARM', 'MASTER_ARM', 'master_arm', { cls: 'red' })
  ]);

  // ------------------------------------------------------------------ //
  // DASHBOARDS
  // ------------------------------------------------------------------ //
  const DASHBOARDS = {
    'civil-plane': {
      name: 'Civil aircraft', icon: '✈',
      pages: [
        { title: 'FLIGHT', cols: 4, rowsTpl: STRIP, cells: [
          [I.asiGA], [I.att], [I.alt], [I.rpmGA],
          [I.tc], [I.hdg], [I.vsi], [I.fuelLR], quickGA
        ] },
        { title: 'FLIGHT + ENGINE', cols: 5, rows: 2, cells: [
          [I.asiGA], [I.att], [I.alt], [engineBarsGA, 2, 1],
          [I.tc], [I.hdg], [I.vsi], [I.rpmGA], [I.fuelLR]
        ] },
        { title: 'AUTOPILOT', cols: 4, rows: 2, cells: [
          [I.att], [I.hdg], [apPanelGA, 2, 1],
          [apKnobsGA, 3, 1], [I.alt]
        ] },
        { title: 'RADIOS', cols: 4, rows: 2, cells: [[radiosGA, 3, 1], [I.hdg], [apKnobsGA, 3, 1], [annunGA]] },
        { title: 'PANEL', cols: 4, rows: 2, cells: [
          [elecGA, 2, 1], [lightsGA, 2, 1],
          [flightCtlGA, 3, 1], [annunGA]
        ] }
      ]
    },

    'civil-heli': {
      name: 'Civil helicopter', icon: '🚁',
      pages: [
        { title: 'FLIGHT', cols: 4, rowsTpl: STRIP, cells: [
          [I.asiHeli], [I.att], [I.alt], [I.dualTach],
          [I.radalt], [I.hdgPlain], [I.vsi], [I.torque], quickHeli
        ] },
        { title: 'ENGINE', cols: 4, rows: 2, cells: [
          [I.dualTach], [I.torque], [I.totHeli], [I.ngHeli],
          [engineBarsHeli, 3, 1], [Group('', [
            lamp('MASTER\nCAUTION', 'master_caution', 'amber', { size: 'big' }),
            lamp('LOW ROTOR', 'nr', 'red', { blink: true, when: (v) => typeof v === 'number' && v > 5 && v < 90, size: 'big' })
          ], 'lamps stack')]
        ] },
        { title: 'PANEL', cols: 4, rows: 2, cells: [
          [Group('ELECTRICAL / ENGINE', [
            tog('BAT', 'MASTER_BATTERY', 'battery'), tog('GEN', 'GENERATOR', 'generator'), tog('AVIONICS', 'AVIONICS_MASTER', 'avionics'),
            tog('FUEL VALVE', 'FUEL_VALVE', 'fuel_valve'), tog('BOOST PUMP', 'FUEL_PUMP', 'fuel_pump'), tog('GOVERNOR', 'GOVERNOR', 'governor'),
            tog('HYD', 'HYDRAULICS', 'hydraulics')
          ], 'switches'), 3, 1],
          [Group('START', [
            btn('STARTER', 'STARTER', null, { cls: 'red' }), btn('IDLE REL', 'IDLE_RELEASE'), btn('ROTOR BRK', 'ROTOR_BRAKE', 'rotor_brake')
          ], 'buttons-grid')],
          [Group('FLIGHT', [
            btn('FORCE TRIM', 'FORCE_TRIM', 'force_trim', { sub: 'release' }), btn('SAS', 'SAS', 'sas'), btn('ATT HOLD', 'AP_ATT', 'ap_att'),
            btn('HDG HOLD', 'AP_HDG', 'ap_hdg'), btn('ALT HOLD', 'AP_ALT', 'ap_alt'), btn('HOVER', 'AP_HOVER', 'ap_hover'),
            btn('PARK BRK', 'PARKING_BRAKE', 'parking_brake'), btn('PEDAL TRIM', 'PEDAL_TRIM')
          ], 'buttons-grid'), 2, 1],
          [Group('LIGHTS', [
            tog('ANTI-COL', 'LIGHT_BEACON', 'light_beacon'), tog('POS', 'LIGHT_NAV', 'light_nav'), tog('LDG', 'LIGHT_LANDING', 'light_landing'), tog('SEARCH', 'LIGHT_TAXI', 'light_taxi')
          ], 'switches'), 2, 1]
        ] },
        { title: 'NAV', cols: 4, rows: 2, cells: [[I.att], [I.hdg], [apKnobsGA, 2, 1], [radiosGA, 3, 1], [I.radalt]] }
      ]
    },

    'mil-jet': {
      name: 'Military jet', icon: '🛩',
      pages: [
        { title: 'FLIGHT', cols: 5, rowsTpl: STRIP, cells: [
          [I.asiJet], [I.att], [I.alt], [I.aoa], [W(G.AoaIndexer, {})],
          [I.vviJet], [I.hdg], [I.g], [I.rpmJet], [I.fuelJet], quickJet
        ] },
        { title: 'COMBAT', cols: 4, rows: 2, cells: [
          [armGroup([['GUN', 'WPN_GUN'], ['AA SRM', 'WPN_SRM'], ['AA MRM', 'WPN_MRM'], ['A/G', 'WPN_AG'], ['LASER', 'LASER_ARM'], ['TGT PWR', 'TGP_POWER']]), 3, 1],
          [cautionsMil],
          [cmGroup([btn('ECM', 'ECM_TOGGLE', 'ecm'), btn('RWR', 'RWR_POWER', 'rwr')]), 2, 1],
          [I.att], [I.g]
        ] },
        { title: 'SYSTEMS', cols: 4, rows: 2, cells: [
          [Group('', [
            W(C.GearLever, {}),
            W(C.Selector, { text: 'FLAPS', key: 'flaps', inc: 'FLAPS_INC', dec: 'FLAPS_DEC', positions: ['AUTO', 'HALF', 'FULL'] }),
            Group('', [
              btn('HOOK', 'HOOK_TOGGLE', 'hook'), btn('SPD BRK OUT', 'SPEEDBRAKE_OUT', 'speedbrake'), btn('SPD BRK IN', 'SPEEDBRAKE_IN'),
              btn('NWS', 'NWS'), btn('LAUNCH BAR', 'LAUNCH_BAR'), btn('CANOPY', 'CANOPY'),
              btn('PARK BRK', 'PARKING_BRAKE', 'parking_brake'), btn('WING FOLD', 'WING_FOLD'), btn('ANTI SKID', 'ANTI_SKID')
            ], 'buttons-grid')
          ], 'row'), 3, 1],
          [cautionsMil],
          [Group('AUTOPILOT', [
            btn('AP', 'AP_MASTER', 'ap_master'), btn('ATT HOLD', 'AP_ATT', 'ap_att'), btn('ALT HOLD', 'AP_ALT', 'ap_alt'),
            btn('HDG SEL', 'AP_HDG', 'ap_hdg'), btn('CPL', 'AP_NAV', 'ap_nav'), btn('A/T', 'AUTOTHROTTLE', 'autothrottle')
          ], 'buttons-grid'), 2, 1],
          [Group('', [knob('HDG', 'HDG', 'hdg_bug', { format: fmt3 }), knob('CRS', 'CRS', 'crs', { format: fmt3 }), knob('BARO', 'BARO', 'baro', { format: (v) => v.toFixed(0) })], 'knobs'), 2, 1]
        ] },
        { title: 'ENGINE / START', cols: 4, rows: 2, cells: [
          [I.rpmJet], [I.egtJet], [I.fuelJet], [Group('', [
            W(G.Readout, { title: 'FUEL INT', key: 'fuel_l' }), W(G.Readout, { title: 'FUEL EXT', key: 'fuel_r' }),
            W(G.Readout, { title: 'FF', key: 'fuel_flow', dp: 1 }), W(G.Readout, { title: 'THROTTLE', key: 'throttle', unit: '%' })
          ], 'readouts')],
          [Group('START / ELECTRICAL', [
            tog('BATTERY', 'MASTER_BATTERY', 'battery'), tog('GEN L', 'GENERATOR_L', 'gen_l'), tog('GEN R', 'GENERATOR_R', 'gen_r'),
            tog('APU', 'APU', 'apu'), btn('ENG CRANK L', 'ENGINE_START_L', null, { cls: 'red' }), btn('ENG CRANK R', 'ENGINE_START_R', null, { cls: 'red' }),
            btn('FIRE TEST', 'FIRE_TEST'), tog('BLEED AIR', 'BLEED_AIR', 'bleed')
          ], 'switches'), 3, 1],
          [Group('LIGHTS', [tog('POSITION', 'LIGHT_NAV', 'light_nav'), tog('STROBE', 'LIGHT_STROBE', 'light_strobe'), tog('LDG/TAXI', 'LIGHT_LANDING', 'light_landing'), tog('FORMATION', 'LIGHT_FORMATION')], 'switches')]
        ] }
      ]
    },

    'mil-heli': {
      name: 'Military helicopter', icon: '🚁',
      pages: [
        { title: 'FLIGHT', cols: 4, rowsTpl: STRIP, cells: [
          [I.asiMilHeli], [I.att], [I.alt], [I.dualTach],
          [I.radalt], [I.hdg], [I.vsi], [I.torque], quickMilHeli
        ] },
        { title: 'COMBAT', cols: 4, rows: 2, cells: [
          [armGroup([['GUN', 'WPN_GUN'], ['ROCKETS', 'WPN_ROCKETS'], ['MISSILES', 'WPN_MISSILES'], ['LASER', 'LASER_ARM'], ['SIGHT', 'SIGHT_MODE'], ['DOOR GUN', 'WPN_DOOR']]), 3, 1],
          [cautionsMil],
          [cmGroup([btn('IR JAM', 'IR_JAMMER', 'ir_jammer'), btn('RWR', 'RWR_POWER', 'rwr')]), 2, 1],
          [I.radalt], [I.torque]
        ] },
        { title: 'SYSTEMS', cols: 4, rows: 2, cells: [
          [Group('ENGINES / APU', [
            tog('BATTERY', 'MASTER_BATTERY', 'battery'), tog('APU', 'APU', 'apu'), tog('GEN 1', 'GENERATOR_L', 'gen_l'), tog('GEN 2', 'GENERATOR_R', 'gen_r'),
            tog('FUEL PUMPS', 'FUEL_PUMP', 'fuel_pump'), btn('START ENG 1', 'ENGINE_START_L', null, { cls: 'red' }), btn('START ENG 2', 'ENGINE_START_R', null, { cls: 'red' }),
            btn('ROTOR BRK', 'ROTOR_BRAKE', 'rotor_brake')
          ], 'switches'), 3, 1],
          [cautionsMil],
          [Group('FLIGHT CONTROL', [
            btn('FORCE TRIM', 'FORCE_TRIM', null, { sub: 'release' }), btn('SAS', 'SAS', 'sas'), btn('ATT HOLD', 'AP_ATT', 'ap_att'),
            btn('ALT HOLD', 'AP_ALT', 'ap_alt'), btn('HDG HOLD', 'AP_HDG', 'ap_hdg'), btn('HOVER', 'AP_HOVER', 'ap_hover'),
            btn('WHEEL BRK', 'PARKING_BRAKE', 'parking_brake'), btn('TAIL WHL LK', 'TAILWHEEL_LOCK')
          ], 'buttons-grid'), 2, 1],
          [W(C.GearLever, { text: 'GEAR' })],
          [Group('LIGHTS', [tog('ANTI-COL', 'LIGHT_BEACON', 'light_beacon'), tog('POS', 'LIGHT_NAV', 'light_nav'), tog('SEARCH', 'LIGHT_LANDING', 'light_landing'), tog('NVG', 'LIGHT_NVG')], 'switches')]
        ] },
        { title: 'ENGINE', cols: 4, rows: 2, cells: [
          [I.dualTach], [I.torque], [I.totHeli], [I.ngHeli],
          [engineBarsHeli, 3, 1], [I.fuelJet]
        ] }
      ]
    }
  };

  global.DASHBOARDS = DASHBOARDS;
})(window);
