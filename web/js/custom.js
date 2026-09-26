/*
 * "My panels" - build your own pages on the iPad.
 *
 *  EDIT  -> tap an empty cell to add a widget, tap a widget to select it
 *           (move with the arrows or by tapping an empty cell, resize, edit, copy, delete)
 *  Widgets: any instrument from the other dashboards, readouts, bars, dials, lamps, buttons, switches,
 *           knobs, levers, labels, and any live cockpit control of the current aircraft.
 *  Actions (what a button / switch / knob sends):
 *     K:EVENT            MSFS sim event          K:EVENT=123   with a value
 *     @INPUT_EVENT       MSFS cockpit input event of the loaded aircraft
 *     bios:ID [ARG]      cockpit control (DCS-BIOS or MSFS input event); no ARG = push button 1/0
 *     NAME               a named input from msfs.json / dcs.json (e.g. GEAR_TOGGLE, DROP_OPEN)
 * Layouts are stored on the iPad and on the bridge (bridge/data/layouts.json).
 */
(function (global) {
  'use strict';
  const G = global.Gauges, C = global.Controls, Link = global.Link;
  const { el } = G;
  const LS = 'simdash.custom';
  const click = (t) => global.Feedback && global.Feedback.play(t);
  const host = () => { const h = new URLSearchParams(location.search).get('host'); return h ? `http://${h}` : ''; };
  const uid = () => Math.random().toString(36).slice(2, 9);

  let doc = null, pageIdx = 0, editing = false, sel = null, root = null, tabsEl = null, live = [], saveTimer = 0, cockpit = null;

  // ================================================================== catalogues
  const P = () => global.INSTRUMENT_PRESETS || {};
  const GA = () => global.GA_WIDGETS || {};
  const HE = () => global.HELI_WIDGETS || {};
  const INSTRUMENTS = [
    ['att', 'Attitude', () => G.Attitude({})], ['alt', 'Altimeter', () => G.Altimeter({})],
    ['hsi', 'Heading / HSI', () => G.Heading({ course: true })], ['vsi', 'Vertical speed', () => G.Vario({})],
    ['tc', 'Turn coordinator', () => G.TurnCoordinator({})], ['asiGA', 'Airspeed (GA)', () => P().asiGA()],
    ['asiHeli', 'Airspeed (heli)', () => P().asiHeli()], ['asiJet', 'Airspeed / Mach (jet)', () => P().asiJet()],
    ['vviJet', 'VVI (jet)', () => P().vviJet()], ['rpmGA', 'Tachometer (piston)', () => P().rpmGA()],
    ['fuelLR', 'Fuel L / R', () => P().fuelLR()], ['dualTach', 'Rotor / engine tach', () => P().dualTach()],
    ['torque', 'Torque', () => P().torque()], ['totHeli', 'TOT', () => P().totHeli()], ['ngHeli', 'Gas producer (N1)', () => P().ngHeli()],
    ['radalt', 'Radar altimeter (dial)', () => P().radalt()], ['g', 'G-meter', () => P().g()], ['aoa', 'AOA dial', () => P().aoa()],
    ['rpmJet', 'Jet RPM L / R', () => P().rpmJet()], ['egtJet', 'EGT', () => P().egtJet()], ['fuelJet', 'Fuel %', () => P().fuelJet()],
    ['cdi', 'VOR / CDI', () => GA().CDI()], ['adf', 'ADF', () => GA().ADF()],
    ['tank', 'Hopper / water tank', () => GA().Tank({ title: 'TANK', key: 'tank_pct', subKey: 'tank_gal', subUnit: 'gal' })],
    ['kap140', 'KAP 140 autopilot', () => GA().KAP140()], ['xpdr', 'Transponder', () => GA().Transponder()],
    ['com1', 'COM 1 radio', () => GA().Radio({ name: 'COM 1', act: 'com1_act', stby: 'com1', dp: 3, whole: ['K:COM_RADIO_WHOLE_INC', 'K:COM_RADIO_WHOLE_DEC'], fract: ['K:COM_RADIO_FRACT_INC', 'K:COM_RADIO_FRACT_DEC'], swap: 'K:COM_STBY_RADIO_SWAP', setHz: 'COM_STBY_RADIO_SET_HZ', min: 118, max: 136.99 })],
    ['nav1', 'NAV 1 radio', () => GA().Radio({ name: 'NAV 1', act: 'nav1_act', stby: 'nav1', dp: 2, whole: ['K:NAV1_RADIO_WHOLE_INC', 'K:NAV1_RADIO_WHOLE_DEC'], fract: ['K:NAV1_RADIO_FRACT_INC', 'K:NAV1_RADIO_FRACT_DEC'], swap: 'K:NAV1_RADIO_SWAP', setHz: 'NAV1_STBY_SET_HZ', min: 108, max: 117.95 })],
    ['adfRadio', 'ADF radio', () => GA().AdfRadio()], ['trim', 'Trim wheel', () => GA().TrimWheel()],
    ['hover', 'Hover drift display', () => HE().HoverDisplay()], ['radaltBig', 'Big radar altitude', () => HE().RadAlt()],
    ['vsBar', 'Vertical speed bar', () => HE().VsBar()], ['targetNav', 'Target bearing (rescue)', () => HE().TargetNav()],
    ['wind', 'Wind on the nose', () => HE().WindCard()], ['search', 'Expanding-square search', () => HE().SearchPattern()],
    ['gear', 'Gear lever', () => C.GearLever({})], ['gearLights', 'Gear lights', () => G.GearLights()], ['aoaIndexer', 'AOA indexer', () => G.AoaIndexer()],
  ];
  const INST = Object.fromEntries(INSTRUMENTS.map(([id, name, make]) => [id, { name, make }]));

  const KNOWN_KEYS = ('pitch roll heading hdg_true track ias tas gs alt radalt vs mach g aoa baro baro_hg turn slip lat lon on_ground ' +
    'rpm n1 n2 nr torque itt egt cht oil_p oil_t manifold prop_rpm fuel fuel_l fuel_r fuel_total fuel_flow fuel_press throttle prop mixture trim ' +
    'volts amps suction gear gear_l gear_n gear_r flaps speedbrake parking_brake hook ap_master ap_fd ap_yd ap_hdg ap_nav ap_apr ap_bc ap_alt ap_vs ap_flc ap_att ' +
    'hdg_bug alt_sel vs_sel crs com1 com1_act nav1 nav1_act com2 com2_act nav2 nav2_act xpdr xpdr_state cdi gsi tofrom adf_brg adf_freq ' +
    'battery alternator avionics fuel_pump pitot_heat light_beacon light_landing light_taxi light_nav light_strobe master_caution master_warning master_arm ' +
    'tank_pct tank_gal drop_door drop_flow scoop wind_dir wind_kt oat vel_x vel_z chaff flare gun').split(' ');

  const K_EVENTS = ('GEAR_TOGGLE GEAR_UP GEAR_DOWN FLAPS_INCR FLAPS_DECR FLAPS_UP FLAPS_DOWN SPOILERS_TOGGLE PARKING_BRAKES BRAKES ' +
    'AP_MASTER TOGGLE_FLIGHT_DIRECTOR YAW_DAMPER_TOGGLE AP_HDG_HOLD AP_NAV1_HOLD AP_APR_HOLD AP_BC_HOLD AP_ALT_HOLD AP_VS_HOLD FLIGHT_LEVEL_CHANGE AP_ATT_HOLD ' +
    'HEADING_BUG_INC HEADING_BUG_DEC AP_ALT_VAR_INC AP_ALT_VAR_DEC AP_VS_VAR_INC AP_VS_VAR_DEC VOR1_OBI_INC VOR1_OBI_DEC KOHLSMAN_INC KOHLSMAN_DEC BAROMETRIC ' +
    'COM_STBY_RADIO_SWAP COM_RADIO_WHOLE_INC COM_RADIO_WHOLE_DEC COM_RADIO_FRACT_INC COM_RADIO_FRACT_DEC NAV1_RADIO_SWAP COM2_RADIO_SWAP NAV2_RADIO_SWAP XPNDR_IDENT_ON ' +
    'TOGGLE_MASTER_BATTERY TOGGLE_MASTER_ALTERNATOR TOGGLE_AVIONICS_MASTER TOGGLE_ELECT_FUEL_PUMP PITOT_HEAT_TOGGLE ANTI_ICE_TOGGLE_ENG1 ' +
    'TOGGLE_BEACON_LIGHTS LANDING_LIGHTS_TOGGLE TOGGLE_TAXI_LIGHTS TOGGLE_NAV_LIGHTS STROBES_TOGGLE PANEL_LIGHTS_TOGGLE TOGGLE_CABIN_LIGHTS ' +
    'MAGNETO1_OFF MAGNETO1_RIGHT MAGNETO1_LEFT MAGNETO1_BOTH MAGNETO1_START FUEL_SELECTOR_LEFT FUEL_SELECTOR_RIGHT FUEL_SELECTOR_ALL FUEL_SELECTOR_OFF ' +
    'ELEV_TRIM_UP ELEV_TRIM_DN RUDDER_TRIM_LEFT RUDDER_TRIM_RIGHT AILERON_TRIM_LEFT AILERON_TRIM_RIGHT TOGGLE_PUSHBACK SMOKE_TOGGLE ' +
    'ROTOR_BRAKE ROTOR_GOV_SWITCH_TOGGLE HYDRAULIC_SWITCH_TOGGLE TOGGLE_STARTER1 PAUSE_TOGGLE SIM_RATE_INCR SIM_RATE_DECR ' +
    'G1000_PFD_SOFTKEY1 G1000_PFD_DIRECTTO_BUTTON G1000_PFD_ENTER_BUTTON G1000_PFD_CLEAR_BUTTON G1000_PFD_MENU_BUTTON G1000_PFD_FLIGHTPLAN_BUTTON G1000_PFD_PROCEDURE_BUTTON').split(' ');
  const NAMED = 'GEAR_TOGGLE FLAPS_INC FLAPS_DEC PARKING_BRAKE AP_MASTER AP_HDG AP_NAV AP_APR AP_ALT AP_VS HDG_PUSH ALT_INC_1000 ALT_DEC_1000 DROP_OPEN DROP_CLOSE SCOOP_DOWN SCOOP_UP FUEL_LEFT FUEL_RIGHT FUEL_BOTH MAG_BOTH MAG_START MASTER_ARM HOOK_TOGGLE JETTISON CM_CHAFF CM_FLARE CM_PROGRAM'.split(' ');
  const LEVER_EVENTS = ['THROTTLE_SET', 'PROP_PITCH_SET', 'MIXTURE_SET', 'THROTTLE1_SET', 'THROTTLE2_SET', 'MIXTURE1_SET', 'PROP_PITCH1_SET', 'FLAPS_SET', 'SPOILERS_SET', 'AXIS_ELEV_TRIM_SET'];

  // ================================================================== widget types
  function customButton(cfg) {
    const b = el('button', { class: 'btn ' + (cfg.style || ''), type: 'button' });
    el('span', { class: 'btn-led' }, b);
    el('span', { class: 'btn-text', text: cfg.label || 'BUTTON' }, b);
    let down = false;
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); down = true; b.classList.add('pressed'); Link.input(cfg.action, 'press'); });
    const up = () => { if (!down) return; down = false; b.classList.remove('pressed'); Link.input(cfg.action, 'release'); };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    return { el: b, keys: cfg.key ? [cfg.key] : [], update(s) { if (cfg.key) b.classList.toggle('lit', Number(s[cfg.key]) > (cfg.above ?? 0.5)); } };
  }
  function customToggle(cfg) {
    const w = el('div', { class: 'toggle' });
    el('div', { class: 'toggle-label top', text: cfg.on || 'ON' }, w);
    const sw = el('div', { class: 'toggle-body' }, w);
    el('div', { class: 'toggle-bat' }, sw);
    el('div', { class: 'toggle-label bottom', text: cfg.off || 'OFF' }, w);
    el('div', { class: 'toggle-name', text: cfg.label || '' }, w);
    let state = false;
    sw.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const next = !state;
      const act = next ? cfg.action : (cfg.actionOff || cfg.action);
      Link.input(act, 'press');
      setTimeout(() => Link.input(act, 'release'), 80);
      if (!cfg.key) { state = next; w.classList.toggle('on', state); }
    });
    return { el: w, keys: cfg.key ? [cfg.key] : [], update(s) { if (cfg.key && s[cfg.key] !== undefined) { state = Number(s[cfg.key]) > 0.5; w.classList.toggle('on', state); } } };
  }
  function customKnob(cfg) {
    const k = C.DualKnob({ text: cfg.label, inner: { inc: cfg.inc, dec: cfg.dec }, outer: cfg.inc2 ? { inc: cfg.inc2, dec: cfg.dec2 } : null, push: cfg.push || null,
      key: cfg.key || null, format: cfg.key ? (s) => (typeof s[cfg.key] === 'number' ? (+s[cfg.key]).toFixed(cfg.dp || 0) : '---') : null });
    return k;
  }
  function label(cfg) {
    const d = el('div', { class: 'cp-label ' + (cfg.size || 'md'), text: cfg.text || '' });
    return { el: d, keys: [], update() {} };
  }
  function cockpitWidget(cfg) {
    if (!global.BiosPanel || !cfg.control) return label({ text: 'cockpit control missing' });
    return global.BiosPanel.widgetFor(cfg.control);
  }

  const TYPES = {
    instrument: { name: 'Instrument', icon: '⏲', size: [1, 1], fields: [['kind', 'Instrument', 'select', INSTRUMENTS.map(([id, n]) => [id, n])]],
      make: (c) => (INST[c.kind] ? INST[c.kind].make() : label({ text: '?' })), title: (c) => (INST[c.kind] || {}).name },
    readout: { name: 'Readout', icon: '123', size: [1, 1], fields: [['label', 'Label', 'text'], ['key', 'Value', 'key'], ['unit', 'Unit', 'text'], ['dp', 'Decimals', 'number'], ['big', 'Big text', 'bool']],
      make: (c) => G.Readout({ title: c.label || c.key, key: c.key, unit: c.unit ? ' ' + c.unit : '', dp: +c.dp || 0, big: !!c.big }), title: (c) => c.label || c.key },
    bar: { name: 'Bar gauge', icon: '▮', size: [1, 2], fields: [['label', 'Label', 'text'], ['key', 'Value', 'key'], ['min', 'Min', 'number'], ['max', 'Max', 'number'], ['unit', 'Unit', 'text'], ['dp', 'Decimals', 'number']],
      make: (c) => G.Bar({ title: c.label || c.key, key: c.key, min: +c.min || 0, max: +c.max || 100, unit: c.unit || '', dp: +c.dp || 0, bands: [] }), title: (c) => c.label || c.key },
    dial: { name: 'Round dial', icon: '◔', size: [1, 1], fields: [['label', 'Title', 'text'], ['key', 'Value', 'key'], ['min', 'Min', 'number'], ['max', 'Max', 'number'], ['unit', 'Unit', 'text'], ['red', 'Red from (optional)', 'number']],
      make: (c) => {
        const min = +c.min || 0, max = +c.max || 100, step = niceStep((max - min) / 8);
        return G.Dial({ key: c.key, min, max, major: step, minor: step / 5, title: (c.label || '').toUpperCase(), unit: c.unit || '', digital: c.key,
          arcs: c.red !== '' && c.red !== undefined && !isNaN(+c.red) ? [{ from: +c.red, to: max, color: '#e0201b' }] : [] });
      }, title: (c) => c.label || c.key },
    lamp: { name: 'Warning lamp', icon: '●', size: [1, 1], fields: [['label', 'Text', 'text'], ['key', 'Value', 'key'], ['color', 'Colour', 'select', [['amber', 'Amber'], ['red', 'Red'], ['green', 'Green']]], ['above', 'On when value is above', 'number']],
      make: (c) => G.Lamp({ text: c.label, key: c.key, color: c.color || 'amber', when: (v) => Number(v) > (c.above === '' || c.above === undefined ? 0.5 : +c.above) }), title: (c) => c.label },
    button: { name: 'Button', icon: '⏺', size: [1, 1], fields: [['label', 'Label', 'text'], ['action', 'Sends', 'action'], ['key', 'Lights up when (optional)', 'key'], ['style', 'Style', 'select', [['', 'Normal'], ['red', 'Red']]]],
      make: customButton, title: (c) => c.label },
    toggle: { name: 'Toggle switch', icon: '⏻', size: [1, 1], fields: [['label', 'Label', 'text'], ['action', 'Sends (toggle / ON)', 'action'], ['actionOff', 'Sends for OFF (optional)', 'action'], ['key', 'Position from (optional)', 'key'], ['on', 'Up label', 'text'], ['off', 'Down label', 'text']],
      make: customToggle, title: (c) => c.label },
    knob: { name: 'Knob', icon: '◎', size: [1, 1], fields: [['label', 'Label', 'text'], ['inc', 'Turn right sends', 'action'], ['dec', 'Turn left sends', 'action'], ['push', 'Push sends (optional)', 'action'], ['inc2', 'Outer ring right (optional)', 'action'], ['dec2', 'Outer ring left (optional)', 'action'], ['key', 'Shows value (optional)', 'key'], ['dp', 'Decimals', 'number']],
      make: customKnob, title: (c) => c.label },
    lever: { name: 'Lever', icon: '⇕', size: [1, 2], fields: [['label', 'Label', 'text'], ['event', 'Sim event (0-16383)', 'select', LEVER_EVENTS.map((e) => [e, e])], ['key', 'Position from (%)', 'key'], ['color', 'Knob colour', 'select', [['throttle', 'Black'], ['prop', 'Blue'], ['mixture', 'Red']]]],
      make: (c) => GA().Lever({ title: (c.label || '').toUpperCase(), key: c.key, event: c.event || 'THROTTLE_SET', cls: c.color || 'throttle' }), title: (c) => c.label },
    cockpit: { name: 'Cockpit control', icon: '🎛', size: [1, 1], fields: [['control', 'Control of the current aircraft', 'cockpit']],
      make: cockpitWidget, title: (c) => (c.control ? c.control.d : '') },
    label: { name: 'Label', icon: 'T', size: [2, 1], fields: [['text', 'Text', 'text'], ['size', 'Size', 'select', [['sm', 'Small'], ['md', 'Medium'], ['lg', 'Large']]]],
      make: label, title: (c) => c.text },
  };
  function niceStep(x) { const p = Math.pow(10, Math.floor(Math.log10(x || 1))); const n = x / p; return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p; }

  // ================================================================== document & storage
  function starter() {
    const w = (type, c, r, wd, h, cfg) => ({ id: uid(), type, c, r, w: wd, h, cfg });
    return { ts: 0, pages: [
      { id: uid(), name: 'MY PANEL', cols: 6, rows: 4, widgets: [
        w('instrument', 1, 1, 2, 2, { kind: 'att' }), w('instrument', 3, 1, 2, 2, { kind: 'asiGA' }), w('instrument', 5, 1, 2, 2, { kind: 'alt' }),
        w('instrument', 1, 3, 2, 2, { kind: 'hsi' }),
        w('button', 3, 3, 1, 1, { label: 'GEAR', action: 'K:GEAR_TOGGLE', key: 'gear' }), w('button', 4, 3, 1, 1, { label: 'AP', action: 'K:AP_MASTER', key: 'ap_master' }),
        w('lamp', 3, 4, 1, 1, { label: 'MASTER CAUT', key: 'master_caution', color: 'amber' }), w('readout', 4, 4, 1, 1, { label: 'GS', key: 'gs', unit: 'kt', big: true }),
        w('lever', 5, 3, 1, 2, { label: 'Throttle', event: 'THROTTLE_SET', key: 'throttle', color: 'throttle' }),
        w('knob', 6, 3, 1, 2, { label: 'HDG', inc: 'K:HEADING_BUG_INC', dec: 'K:HEADING_BUG_DEC', push: 'HDG_PUSH', key: 'hdg_bug' }),
      ] },
    ] };
  }
  function localDoc() { try { return JSON.parse(localStorage.getItem(LS) || 'null'); } catch (e) { return null; } }
  async function loadDoc() {
    let local = localDoc(), remote = null;
    try { remote = await (await fetch(host() + '/api/layouts', { cache: 'no-store' })).json(); } catch (e) { /* offline: local only */ }
    if (remote && remote.pages && remote.pages.length && (!local || (remote.ts || 0) > (local.ts || 0))) return remote;
    return local && local.pages && local.pages.length ? local : starter();
  }
  function save() {
    doc.ts = Date.now();
    try { localStorage.setItem(LS, JSON.stringify(doc)); } catch (e) { /* full */ }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      fetch(host() + '/api/layouts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc) }).catch(() => {});
    }, 800);
  }
  const page = () => doc.pages[pageIdx];

  // ================================================================== layout helpers
  const overlaps = (a, b) => a.c < b.c + b.w && b.c < a.c + a.w && a.r < b.r + b.h && b.r < a.r + a.h;
  function fits(pg, box, ignoreId) {
    if (box.c < 1 || box.r < 1 || box.c + box.w - 1 > pg.cols || box.r + box.h - 1 > pg.rows) return false;
    return !pg.widgets.some((w) => w.id !== ignoreId && overlaps(w, box));
  }
  function toast(msg) {
    const t = el('div', { class: 'cp-toast', text: msg }, document.body);
    setTimeout(() => t.remove(), 1800);
  }

  // ================================================================== render
  function clearLive() { live.forEach((w) => Link.unregister(w)); live = []; }
  function registerTree(w) { if (w.children) w.children.forEach(registerTree); if (w.keys && w.keys.length) { Link.register(w); live.push(w); } }

  function render() {
    if (!root) return;
    clearLive();
    root.innerHTML = '';
    renderTabs();
    const pg = page();
    if (!pg) return;
    if (editing) renderEditBar(pg);
    const grid = el('div', { class: 'cp-grid' + (editing ? ' editing' : '') }, root);
    grid.style.gridTemplateColumns = `repeat(${pg.cols}, 1fr)`;
    grid.style.gridTemplateRows = `repeat(${pg.rows}, 1fr)`;
    if (editing) {
      for (let r = 1; r <= pg.rows; r++) for (let c = 1; c <= pg.cols; c++) {
        if (pg.widgets.some((w) => overlaps(w, { c, r, w: 1, h: 1 }))) continue;
        const e = el('button', { class: 'cp-empty', type: 'button', text: sel ? '⤓' : '+' }, grid);
        e.style.gridColumn = `${c} / span 1`; e.style.gridRow = `${r} / span 1`;
        e.addEventListener('click', () => (sel ? moveTo(sel, c, r) : addWidget(c, r)));
      }
    }
    pg.widgets.forEach((wd) => {
      const cell = el('div', { class: 'cell cp-cell' + (sel === wd.id ? ' selected' : '') }, grid);
      cell.style.gridColumn = `${wd.c} / span ${wd.w}`;
      cell.style.gridRow = `${wd.r} / span ${wd.h}`;
      let w;
      try { w = TYPES[wd.type].make(wd.cfg || {}); } catch (e) { w = label({ text: 'error: ' + e.message }); }
      cell.appendChild(w.el);
      registerTree(w);
      cell.querySelectorAll('.instrument').forEach((i) => i.appendChild(Object.assign(document.createElement('div'), { className: 'night-tint' })));
      if (editing) {
        const ov = el('button', { class: 'cp-overlay', type: 'button' }, cell);
        el('span', { class: 'cp-tag', text: `${TYPES[wd.type].icon} ${(TYPES[wd.type].title(wd.cfg || {}) || TYPES[wd.type].name).toString().slice(0, 28)}` }, ov);
        ov.addEventListener('click', () => { sel = sel === wd.id ? null : wd.id; render(); });
      }
    });
    if (editing && sel) renderSelBar(pg);
    if (!pg.widgets.length && !editing) el('div', { class: 'cp-hint', text: 'Empty page - tap EDIT, then tap a cell to add instruments, buttons, knobs…' }, grid);
  }

  function renderTabs() {
    if (!tabsEl) return;
    tabsEl.innerHTML = '';
    doc.pages.forEach((pg, i) => {
      const t = el('button', { class: 'tab' + (i === pageIdx ? ' active' : ''), type: 'button', text: pg.name }, tabsEl);
      t.onclick = () => { pageIdx = i; sel = null; try { localStorage.setItem(LS + '.page', i); } catch (e) { /* ignore */ } render(); };
    });
    const ed = el('button', { class: 'tab cp-edit' + (editing ? ' active' : ''), type: 'button', text: editing ? '✓ DONE' : '✎ EDIT' }, tabsEl);
    ed.onclick = () => { editing = !editing; sel = null; render(); };
  }

  function bar(parent, items) {
    items.forEach(([t, fn, cls]) => { const b = el('button', { class: 'cp-bbtn ' + (cls || ''), type: 'button', text: t }, parent); b.addEventListener('click', fn); });
  }

  function renderEditBar(pg) {
    const b = el('div', { class: 'cp-bar' }, root);
    el('span', { class: 'cp-bar-t', text: `EDITING “${pg.name}” · ${pg.cols}×${pg.rows}` }, b);
    bar(b, [
      ['RENAME', () => { const n = prompt('Page name', pg.name); if (n) { pg.name = n.toUpperCase().slice(0, 24); save(); render(); } }],
      ['GRID', () => form('Grid size', [['cols', 'Columns (2-10)', 'number'], ['rows', 'Rows (2-8)', 'number']], { cols: pg.cols, rows: pg.rows }, (v) => {
        const cols = Math.max(2, Math.min(10, +v.cols || 6)), rows = Math.max(2, Math.min(8, +v.rows || 4));
        if (pg.widgets.some((w) => w.c + w.w - 1 > cols || w.r + w.h - 1 > rows)) { toast('Move or shrink widgets outside the new grid first'); return; }
        pg.cols = cols; pg.rows = rows; save(); render();
      })],
      ['+ PAGE', () => { doc.pages.push({ id: uid(), name: 'PAGE ' + (doc.pages.length + 1), cols: 6, rows: 4, widgets: [] }); pageIdx = doc.pages.length - 1; save(); render(); }],
      ['DUPLICATE', () => { const cp = JSON.parse(JSON.stringify(pg)); cp.id = uid(); cp.name = (pg.name + ' 2').slice(0, 24); cp.widgets.forEach((w) => { w.id = uid(); }); doc.pages.splice(pageIdx + 1, 0, cp); pageIdx++; save(); render(); }],
      ['◀ MOVE', () => { if (pageIdx > 0) { doc.pages.splice(pageIdx - 1, 0, doc.pages.splice(pageIdx, 1)[0]); pageIdx--; save(); render(); } }],
      ['EXPORT', exportDoc], ['IMPORT', importDoc],
      ['DELETE PAGE', () => { if (doc.pages.length === 1) { toast('Keep at least one page'); return; } if (confirm(`Delete page “${pg.name}”?`)) { doc.pages.splice(pageIdx, 1); pageIdx = Math.max(0, pageIdx - 1); sel = null; save(); render(); } }, 'danger'],
    ]);
  }

  function renderSelBar(pg) {
    const wd = pg.widgets.find((w) => w.id === sel);
    if (!wd) return;
    const b = el('div', { class: 'cp-selbar' }, root);
    el('span', { class: 'cp-bar-t', text: `${TYPES[wd.type].name} · ${wd.w}×${wd.h}   (tap an empty cell to move it there)` }, b);
    const nudge = (dc, dr, dw, dh) => () => {
      const box = { c: wd.c + dc, r: wd.r + dr, w: Math.max(1, wd.w + dw), h: Math.max(1, wd.h + dh) };
      if (!fits(pg, box, wd.id)) { toast('No room there'); click('cover'); return; }
      Object.assign(wd, box); save(); render();
    };
    bar(b, [
      ['◀', nudge(-1, 0, 0, 0)], ['▶', nudge(1, 0, 0, 0)], ['▲', nudge(0, -1, 0, 0)], ['▼', nudge(0, 1, 0, 0)],
      ['W−', nudge(0, 0, -1, 0)], ['W+', nudge(0, 0, 1, 0)], ['H−', nudge(0, 0, 0, -1)], ['H+', nudge(0, 0, 0, 1)],
      ['EDIT', () => configure(wd.type, wd.cfg, (cfg) => { wd.cfg = cfg; save(); render(); })],
      ['COPY', () => {
        const spot = findSpot(pg, wd.w, wd.h);
        if (!spot) { toast('No free space for a copy'); return; }
        const cp = { id: uid(), type: wd.type, c: spot.c, r: spot.r, w: wd.w, h: wd.h, cfg: JSON.parse(JSON.stringify(wd.cfg)) };
        pg.widgets.push(cp); sel = cp.id; save(); render();
      }],
      ['DELETE', () => { pg.widgets = pg.widgets.filter((w) => w.id !== wd.id); sel = null; save(); render(); }, 'danger'],
      ['DONE', () => { sel = null; render(); }, 'on'],
    ]);
  }

  function findSpot(pg, w, h) {
    for (let r = 1; r <= pg.rows; r++) for (let c = 1; c <= pg.cols; c++) if (fits(pg, { c, r, w, h })) return { c, r };
    return null;
  }
  function moveTo(id, c, r) {
    const pg = page(), wd = pg.widgets.find((w) => w.id === id);
    if (!wd) return;
    const box = { c, r, w: wd.w, h: wd.h };
    if (!fits(pg, box, wd.id)) {
      // shrink to fit if needed
      box.w = 1; box.h = 1;
      if (!fits(pg, box, wd.id)) { toast('No room there'); return; }
    }
    Object.assign(wd, box); save(); render();
  }

  // ================================================================== add / configure
  function addWidget(c, r) {
    const sheet = openSheet('Add to this cell');
    const grid = el('div', { class: 'cp-types' }, sheet.body);
    Object.entries(TYPES).forEach(([id, t]) => {
      const b = el('button', { class: 'cp-type', type: 'button' }, grid);
      el('span', { class: 'cp-type-i', text: t.icon }, b);
      el('span', { text: t.name }, b);
      b.onclick = () => {
        sheet.close();
        configure(id, {}, (cfg) => {
          const pg = page();
          let [w, h] = t.size;
          if (!fits(pg, { c, r, w, h })) { w = 1; h = 1; }
          const wd = { id: uid(), type: id, c, r, w, h, cfg };
          pg.widgets.push(wd);
          sel = null;
          save(); render();
        });
      };
    });
  }

  function configure(type, cfg, done) {
    const t = TYPES[type];
    const defaults = { dp: 0, min: 0, max: 100, above: 0.5, color: type === 'lever' ? 'throttle' : 'amber', size: 'md', kind: 'att', event: 'THROTTLE_SET', style: '', on: 'ON', off: 'OFF' };
    const values = Object.assign({}, defaults, cfg);
    form(t.name, t.fields, values, done);
  }

  // generic form in a sheet. fields: [key, label, type, options]
  function form(title, fields, values, onSave) {
    const sheet = openSheet(title);
    const inputs = {};
    fields.forEach(([k, lab, type, opts]) => {
      const row = el('label', { class: 'cp-field' }, sheet.body);
      el('span', { text: lab }, row);
      let inp;
      if (type === 'select') {
        inp = el('select', { class: 'cp-in' }, row);
        opts.forEach(([v, n]) => { const o = el('option', { text: n }, inp); o.value = v; });
        inp.value = values[k] ?? opts[0][0];
      } else if (type === 'bool') {
        inp = el('input', { type: 'checkbox', class: 'cp-check' }, row);
        inp.checked = !!values[k];
      } else if (type === 'cockpit') {
        inp = el('button', { class: 'cp-in cp-pick', type: 'button', text: values[k] ? `${values[k].d}  (${values[k].id})` : 'Choose a control…' }, row);
        inp._val = values[k] || null;   // a control object - not a string, so keep it off .value
        inp.onclick = (e) => { e.preventDefault(); pickCockpit((c) => { inp._val = c; inp.textContent = `${c.d}  (${c.id})`; }); };
      } else {
        const line = el('div', { class: 'cp-line' }, row);
        inp = el('input', { class: 'cp-in', type: type === 'number' ? 'number' : 'text', inputmode: type === 'number' ? 'decimal' : 'text', autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false' }, line);
        inp.value = values[k] ?? '';
        if (type === 'key') {
          const b = el('button', { class: 'cp-bbtn', type: 'button', text: 'PICK' }, line);
          b.onclick = (e) => { e.preventDefault(); pickKey((v) => { inp.value = v; }); };
        }
        if (type === 'action') {
          const b = el('button', { class: 'cp-bbtn', type: 'button', text: 'PICK' }, line);
          b.onclick = (e) => { e.preventDefault(); pickAction((v) => { inp.value = v; }); };
          const tb = el('button', { class: 'cp-bbtn', type: 'button', text: 'TEST' }, line);
          tb.onclick = (e) => { e.preventDefault(); Link.input(inp.value.trim(), 'press'); setTimeout(() => Link.input(inp.value.trim(), 'release'), 120); };
        }
      }
      inputs[k] = [inp, type];
    });
    const row = el('div', { class: 'cp-row' }, sheet.body);
    bar(row, [
      ['CANCEL', () => sheet.close()],
      ['SAVE', () => {
        const out = {};
        Object.entries(inputs).forEach(([k, [inp, type]]) => {
          if (type === 'bool') out[k] = inp.checked;
          else if (type === 'cockpit') out[k] = inp._val || null;
          else out[k] = typeof inp.value === 'string' ? inp.value.trim() : inp.value;
        });
        sheet.close();
        onSave(out);
      }, 'on'],
    ]);
  }

  function openSheet(title) {
    const ov = el('div', { class: 'cp-sheet' }, document.body);
    const card = el('div', { class: 'cp-card' }, ov);
    const head = el('div', { class: 'cp-card-h' }, card);
    el('span', { text: title }, head);
    const x = el('button', { class: 'icon-btn', type: 'button', text: '✕' }, head);
    const body = el('div', { class: 'cp-card-b' }, card);
    const close = () => ov.remove();
    x.onclick = close;
    ov.addEventListener('pointerdown', (e) => { if (e.target === ov) close(); });
    return { body, close };
  }

  // searchable list picker; items: [{label, value, sub}]
  function pickList(title, items, onPick, allowFree) {
    const sheet = openSheet(title);
    const search = el('input', { class: 'cp-in', type: 'search', placeholder: 'Search…', autocapitalize: 'off', autocomplete: 'off' }, sheet.body);
    const list = el('div', { class: 'cp-list' }, sheet.body);
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      list.innerHTML = '';
      const hits = items.filter((i) => !q || (i.label + ' ' + (i.sub || '') + ' ' + i.value).toLowerCase().includes(q)).slice(0, 200);
      if (allowFree && q) hits.unshift({ label: `Use “${search.value.trim()}”`, value: search.value.trim(), sub: 'as typed' });
      hits.forEach((i) => {
        const b = el('button', { class: 'cp-item', type: 'button' }, list);
        el('b', { text: i.label }, b);
        if (i.sub) el('small', { text: i.sub }, b);
        b.onclick = () => { sheet.close(); onPick(i.value); };
      });
      if (!hits.length) el('div', { class: 'cp-hint', text: 'Nothing found.' }, list);
    };
    search.addEventListener('input', draw);
    draw();
    setTimeout(() => search.focus(), 50);
  }

  async function loadCockpit() {
    if (cockpit) return cockpit;
    try { const p = await global.BiosPanel.fetchPanel(); if (p && p.categories && p.categories.length) cockpit = p; } catch (e) { /* no sim */ }
    return cockpit;
  }
  async function pickCockpit(onPick) {
    cockpit = null;
    const p = await loadCockpit();
    if (!p) { toast('No cockpit controls yet - start the sim (MSFS aircraft loaded / DCS with DCS-BIOS)'); return; }
    const items = [];
    p.categories.forEach((cat) => cat.controls.forEach((c) => items.push({ label: c.d, sub: `${cat.name} · ${c.id}`, value: c })));
    pickList(`Cockpit controls: ${p.aircraft}`, items, onPick);
  }
  function pickKey(onPick) {
    const keys = new Set(KNOWN_KEYS.concat(Object.keys(Link.state).filter((k) => !k.startsWith('bios:'))));
    const items = [...keys].sort().map((k) => ({ label: k, value: k, sub: Link.state[k] !== undefined ? 'now: ' + fmtVal(Link.state[k]) : '' }));
    Object.keys(Link.state).filter((k) => k.startsWith('bios:')).slice(0, 3000).forEach((k) => items.push({ label: k, value: k, sub: 'cockpit value · now: ' + fmtVal(Link.state[k]) }));
    pickList('Value to show', items, onPick, true);
  }
  function fmtVal(v) { return typeof v === 'number' ? +v.toFixed(3) : String(v).slice(0, 20); }
  async function pickAction(onPick) {
    const items = [];
    NAMED.forEach((n) => items.push({ label: n, value: n, sub: 'SimDash input (msfs.json / dcs.json)' }));
    K_EVENTS.forEach((e) => items.push({ label: e, value: 'K:' + e, sub: 'MSFS sim event' }));
    const p = await loadCockpit();
    if (p) p.categories.forEach((cat) => cat.controls.forEach((c) => {
      const isSw = (c.i || []).some((x) => x[0] === 'a' && x[1] === 'TOGGLE');
      items.push({ label: c.d, value: 'bios:' + c.id + (isSw ? ' TOGGLE' : ''), sub: `cockpit · ${cat.name} · ${c.id}` });
    }));
    pickList('What should it send?', items, onPick, true);
  }

  // ================================================================== export / import
  function exportDoc() {
    const sheet = openSheet('Export: copy this text');
    const ta = el('textarea', { class: 'cp-json', readonly: 'readonly' }, sheet.body);
    ta.value = JSON.stringify(doc, null, 1);
    setTimeout(() => { ta.focus(); ta.select(); }, 50);
  }
  function importDoc() {
    const sheet = openSheet('Import: paste a layout');
    const ta = el('textarea', { class: 'cp-json', placeholder: '{ "pages": [ ... ] }' }, sheet.body);
    const row = el('div', { class: 'cp-row' }, sheet.body);
    bar(row, [
      ['ADD PAGES', () => apply(false)], ['REPLACE ALL', () => apply(true), 'danger'],
    ]);
    function apply(replace) {
      let d;
      try { d = JSON.parse(ta.value); } catch (e) { toast('Not valid JSON'); return; }
      const pages = Array.isArray(d) ? d : d.pages;
      if (!Array.isArray(pages) || !pages.every((p) => Array.isArray(p.widgets))) { toast('That is not a SimDash layout'); return; }
      pages.forEach((p) => { p.id = uid(); p.cols = p.cols || 6; p.rows = p.rows || 4; p.name = String(p.name || 'IMPORTED').slice(0, 24); p.widgets = p.widgets.filter((w) => TYPES[w.type]); p.widgets.forEach((w) => { w.id = uid(); }); });
      doc.pages = replace ? pages : doc.pages.concat(pages);
      pageIdx = 0; sel = null;
      save(); sheet.close(); render();
    }
  }

  // ================================================================== mount
  async function mount(container, tabs) {
    root = el('div', { class: 'cp-root' }, container);
    tabsEl = tabs;
    el('div', { class: 'cp-hint', text: 'loading…' }, root);
    doc = await loadDoc();
    if (!root) return;
    try { pageIdx = Math.min(+localStorage.getItem(LS + '.page') || 0, doc.pages.length - 1); } catch (e) { pageIdx = 0; }
    editing = false; sel = null;
    render();
  }
  function unmount() { clearLive(); root = null; editing = false; sel = null; }

  global.DASHBOARDS.custom = {
    name: 'My panels', icon: '🧩', sub: 'build your own pages: instruments, buttons, knobs, levers, cockpit controls',
    custom: { mount, unmount }
  };
})(window);
