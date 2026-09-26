/*
 * AH-64D Apache (DCS) dashboard, driven by DCS-BIOS.
 *
 * Pages:  MPD (both MPD bezels, live MPD pictures with setup-screens.bat) · TADS · TEDAC (CPG sight: live FLIR / TV picture + handgrips)
 *         EUFD + KU (up-front display text + keyboard unit)
 *         PANELS (armament, jettison, fire, engine start, CMWS, emergency, lights) · FLIGHT (standby instruments)
 * Seat:   PLT / CPG - every identifier is the DCS-BIOS name with the seat prefix (PLT_MPD_L_T1 -> CPG_MPD_L_T1).
 *         Controls the current seat doesn't have (checked against the bridge's DCS-BIOS list) are hidden.
 *
 * DCS-BIOS conventions used here (AH-64D.lua):
 *   push buttons          1 = pressed, 0 = released
 *   rockers / spring 3-pos 0 = held down/left, 1 = centre, 2 = held up/right
 *   covers                1 = open
 */
(function (global) {
  'use strict';
  const G = global.Gauges, L = global.Link;
  const { el } = G;

  let root = null, tabsEl = null, live = [], page = 'MPD', seat = 'PLT', known = null, acft = '';
  const PAGES = ['MPD', 'TADS · TEDAC', 'EUFD · KU', 'PANELS', 'FLIGHT'];
  const store = {
    get(k, d) { try { return localStorage.getItem('simdash.ah64.' + k) || d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('simdash.ah64.' + k, v); } catch (e) { /* ignore */ } }
  };

  const id = (s) => seat + '_' + s;                 // seat-prefixed DCS-BIOS identifier
  const has = (ident) => !known || known.has(ident); // hide controls this seat doesn't have
  const val = (ident) => L.state['bios:' + ident];
  const cmd = (ident, arg) => L.biosCmd(ident, arg);

  function reg(w) {
    live.push(w);
    L.register(w);
    return w;
  }
  // shared DCS-BIOS touch building blocks (bioskit.js)
  const { watch, push, guarded, seg, rocker, pot, lamp, text, group, guardedSwitch, dpad } = global.BiosKit({ reg, has, val, cmd });

  // live picture of an exported DCS display over `scr` (setup-screens.bat); invisible until pictures arrive
  function liveScreen(scr, names, quiet = true) {
    scr.appendChild(reg(global.Screens.View(names, { quiet, cls: 'ah-live' })).el);
  }

  // ------------------------------------------------------------------ MPD page
  function mpd(side, screenFill) {
    const P = id('MPD_' + side + '_');
    const m = el('div', { class: 'ah-mpd' });
    const top = el('div', { class: 'ah-mpd-top' }, m);
    for (let i = 1; i <= 6; i++) top.appendChild(push(P + 'T' + i, 'T' + i, { lamp: false }));
    const left = el('div', { class: 'ah-mpd-side' }, m);
    for (let i = 1; i <= 6; i++) left.appendChild(push(P + 'L' + i, 'L' + i, { lamp: false }));
    const scr = el('div', { class: 'ah-mpd-screen' }, m);
    el('div', { class: 'ah-mpd-name', text: (side === 'L' ? 'LEFT' : 'RIGHT') + ' MPD' }, scr);
    screenFill(scr);
    const right = el('div', { class: 'ah-mpd-side' }, m);
    for (let i = 1; i <= 6; i++) right.appendChild(push(P + 'R' + i, 'R' + i, { lamp: false }));
    const bot = el('div', { class: 'ah-mpd-bot' }, m);
    for (let i = 1; i <= 6; i++) bot.appendChild(push(P + 'B' + i, i === 1 ? 'M' : 'B' + i, { lamp: false, cls: i === 1 ? 'menu' : '' }));
    const fixed = el('div', { class: 'ah-mpd-fixed' }, m);
    [['FCR', 'FCR'], ['WPN', 'WPN'], ['TSD', 'TSD'], ['*', 'AST'], ['VID', 'VID'], ['COM', 'COM'], ['A/C', 'AC']]
      .forEach(([t, k]) => fixed.appendChild(push(P + k, t, { lamp: false, cls: 'fixed' })));
    const knobs = el('div', { class: 'ah-mpd-knobs' }, m);
    knobs.appendChild(seg(P + 'MODE', ['MONO', 'NIGHT', 'DAY'], 'MODE'));
    knobs.appendChild(pot(P + 'BRT', 'BRT'));
    knobs.appendChild(pot(P + 'VIDEO', 'VIDEO'));
    return m;
  }

  function flightInfo(scr) {
    const box = (label, key, fmt) => {
      const b = el('div', { class: 'ah-info' });
      el('span', { class: 'ah-info-l', text: label }, b);
      const v = el('span', { class: 'ah-info-v' }, b);
      reg({ el: b, keys: [key], update(s) { v.textContent = typeof s[key] === 'number' ? fmt(s[key]) : '---'; } });
      return b;
    };
    const grid = el('div', { class: 'ah-info-grid' }, scr);
    const att = el('div', { class: 'ah-inst' }, grid);
    att.appendChild(reg(G.Attitude({})).el);
    const col = el('div', { class: 'ah-info-col' }, grid);
    col.appendChild(box('IAS', 'ias', (v) => Math.round(v) + ' KT'));
    col.appendChild(box('ALT', 'alt', (v) => Math.round(v).toLocaleString('en-US') + ' FT'));
    col.appendChild(box('RALT', 'radalt', (v) => (v > 1428 ? '----' : Math.round(v)) + ' FT'));
    col.appendChild(box('VS', 'vs', (v) => (v > 0 ? '+' : '') + Math.round(v / 10) * 10));
    col.appendChild(box('HDG', 'heading', (v) => String(Math.round(v) % 360).padStart(3, '0') + '°'));
    col.appendChild(box('ENG 1 / 2', 'n1', () => `${Math.round(L.state.n1 || 0)} / ${Math.round(L.state.n2 || 0)} %`));
  }

  function eufdMini(scr) {
    const d = el('div', { class: 'ah-eufd small' }, scr);
    for (let i = 1; i <= 14; i++) d.appendChild(text(id('EUFD_LINE' + i), 'ah-eufd-line'));
  }

  function mpdPage(c) {
    const p = el('div', { class: 'ah-page ah-mpds' }, c);
    // with live screens set up, the real MPD pictures (TSD, FCR radar, video / FLIR...) cover the stand-in content
    p.appendChild(mpd('L', (scr) => { flightInfo(scr); liveScreen(scr, ['LEFT_MFCD']); }));
    p.appendChild(mpd('R', (scr) => { eufdMini(scr); liveScreen(scr, ['RIGHT_MFCD']); }));
  }

  // ------------------------------------------------------------------ TADS · TEDAC page (CPG sight: FLIR / TV / DVO picture)
  // spring-loaded switches with positions [first, Off, last]: rocker(ident, label, last, first)
  function tadsPage(c) {
    const p = el('div', { class: 'ah-page ah-tads' }, c);
    const t = el('div', { class: 'ah-tedac' }, p);
    const top = el('div', { class: 'ah-tedac-top' }, t);
    top.appendChild(seg('CPG_TEDAC_DISP_MODE', ['OFF', 'NT', 'DAY'], 'MODE'));
    top.appendChild(rocker('CPG_TEDAC_SYM', 'SYM', '+', '−'));
    top.appendChild(rocker('CPG_TEDAC_BRT', 'BRT', '+', '−'));
    top.appendChild(rocker('CPG_TEDAC_CON', 'CON', '+', '−'));
    const left = el('div', { class: 'ah-tedac-side' }, t);
    [['TAD_SEL', 'TAD'], ['FCR_SEL', 'FCR'], ['PNV_SEL', 'PNV'], ['GS_SEL', 'G/S']]
      .forEach(([k, l]) => left.appendChild(push('CPG_TEDAC_' + k, l, { lamp: false })));
    const scr = el('div', { class: 'ah-tedac-screen' }, t);
    el('div', { class: 'ah-tedac-name', text: 'TEDAC' }, scr);
    liveScreen(scr, ['TEDAC', 'CENTER_MFCD'], false);
    const right = el('div', { class: 'ah-tedac-side' }, t);
    right.appendChild(pot('CPG_TEDAC_FLIR_GAIN', 'FLIR GAIN'));
    right.appendChild(pot('CPG_TEDAC_FLIR_LEV', 'FLIR LEV'));
    right.appendChild(rocker('CPG_TEDAC_RF', 'R/F', '+', '−'));
    right.appendChild(rocker('CPG_TEDAC_EL', 'EL', '▲', '▼'));
    right.appendChild(rocker('CPG_TEDAC_AZ', 'AZ', '▶', '◀'));
    const bot = el('div', { class: 'ah-tedac-bot' }, t);
    [['MULTI', '*'], ['BORESIGHT', 'BORESIGHT'], ['ACM', 'ACM'], ['FREEZE', 'FREEZE'], ['FILTER', 'FILTER']]
      .forEach(([k, l]) => bot.appendChild(push('CPG_TEDAC_' + k, l, { lamp: false })));

    // handgrip switches, grouped by job
    const g = el('div', { class: 'ah-panels ah-tads-grips' }, p);
    [
      ['SENSOR', [seg('CPG_LHG_TADS_SEL', ['DVO', 'TV', 'FLIR'], 'TADS SENSOR'), rocker('CPG_LHG_TADS_FOV_UP_DN', 'FOV', 'Z', 'M'),
        rocker('CPG_LHG_TADS_FOV_L_R', 'FOV', 'W', 'N'), push('CPG_RHG_FLIR_POL', 'FLIR POL', { lamp: false }), push('CPG_RHG_DISP_ZOOM', 'ZOOM', { lamp: false })]],
      ['TRACK · LASER', [rocker('CPG_LHG_TEDAC_L_IAT', 'IAT / OFS', 'IAT', 'OFS'), push('CPG_LHG_LMC', 'LMC', { lamp: false }),
        seg('CPG_RHG_LASER_TRACK', ['M', 'O', 'A'], 'LST'), rocker('CPG_LHG_STORE_UPDATE', 'STORE / UPDT', 'STO', 'UPD'),
        push('CPG_RHG_SIGHT_SLAVE', 'SLAVE', { lamp: false }), dpad('CPG_RHG_MAN_TRK_UP_DN', 'CPG_RHG_MAN_TRK_L_R', 'MAN TRACK')]],
      ['SIGHT · WEAPONS', [rocker('CPG_RHG_SIGHT_L_R', 'SIGHT', 'TADS', 'FCR'), rocker('CPG_RHG_SIGHT_UP_DN', 'SIGHT', 'HMD', 'LINK'),
        push('CPG_RHG_HDD_SW', 'HDD / HOD', { lamp: false }), rocker('CPG_LHG_WPN_UP_DN', 'WPN ACTION', 'GUN', 'ATA'),
        rocker('CPG_LHG_WPN_L_R', 'WPN ACTION', 'MSL', 'RKT')]],
      ['FCR · CURSOR', [rocker('CPG_LHG_FCR_UP_DN', 'FCR MODE', 'GTM', 'ATM'), rocker('CPG_LHG_FCR_L_R', 'FCR MODE', 'RMAP', 'TPM'),
        rocker('CPG_LHG_FCR_SCAN', 'FCR SCAN', 'S', 'C'), push('CPG_LHG_CUED_SEARCH', 'CUED', { lamp: false }), push('CPG_RHG_C_SCOPE', 'C-SCOPE', { lamp: false }),
        dpad('CPG_LHG_CURSOR_UP_DN', 'CPG_LHG_CURSOR_L_R', 'CURSOR', 'CPG_LHG_CURSOR_ENT'), push('CPG_LHG_LR_BTN', 'L / R', { lamp: false })]],
    ].forEach(([title, kids]) => g.appendChild(group(title, kids.filter((k) => !k.classList.contains('ah-gap')))));
  }

  // ------------------------------------------------------------------ EUFD + KU page
  function eufdKuPage(c) {
    const p = el('div', { class: 'ah-page ah-eufdku' }, c);
    // EUFD
    const e = el('div', { class: 'ah-eufd-panel' }, p);
    const l = el('div', { class: 'ah-eufd-side' }, e);
    l.appendChild(rocker(id('EUFD_WCA'), 'WCA'));
    l.appendChild(rocker(id('EUFD_IDM'), 'IDM'));
    l.appendChild(rocker(id('EUFD_RTS'), 'RTS'));
    const d = el('div', { class: 'ah-eufd' }, e);
    for (let i = 1; i <= 14; i++) d.appendChild(text(id('EUFD_LINE' + i), 'ah-eufd-line'));
    const r = el('div', { class: 'ah-eufd-side' }, e);
    r.appendChild(push(id('EUFD_PRESET'), 'PRESET', { lamp: false }));
    r.appendChild(push(id('EUFD_ENT'), 'ENT', { lamp: false }));
    r.appendChild(push(id('EUFD_SWAP'), 'SWAP', { lamp: false }));
    r.appendChild(push(id('EUFD_STOPWATCH'), 'STOPWATCH', { lamp: false }));
    r.appendChild(pot(id('EUFD_BRT'), 'BRT'));
    // KU
    const k = el('div', { class: 'ah-ku' }, p);
    k.appendChild(text(id('KU_DISPLAY'), 'ah-ku-display'));
    const keys = el('div', { class: 'ah-ku-keys' }, k);
    const letters = el('div', { class: 'ah-ku-letters' }, keys);
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach((ch) => letters.appendChild(push(id('KU_' + ch), ch, { lamp: false, cls: 'key' })));
    letters.appendChild(push(id('KU_SLASH'), '/', { lamp: false, cls: 'key' }));
    letters.appendChild(push(id('KU_SPC'), 'SPC', { lamp: false, cls: 'key wide' }));
    letters.appendChild(push(id('KU_BKS'), 'BKS', { lamp: false, cls: 'key fn' }));
    letters.appendChild(push(id('KU_CLR'), 'CLR', { lamp: false, cls: 'key fn' }));
    const nums = el('div', { class: 'ah-ku-nums' }, keys);
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'DOT', '0', 'SIGN'].forEach((n) =>
      nums.appendChild(push(id('KU_' + n), { DOT: '.', SIGN: '+/−' }[n] || n, { lamp: false, cls: 'key num' })));
    const fn = el('div', { class: 'ah-ku-fn' }, keys);
    [['MULTI', '×'], ['DIV', '÷'], ['PLUS', '+'], ['MINUS', '−'], ['LEFT', '◀'], ['RIGHT', '▶']].forEach(([n, t]) =>
      fn.appendChild(push(id('KU_' + n), t, { lamp: false, cls: 'key fn' })));
    fn.appendChild(push(id('KU_ENT'), 'ENTER', { lamp: false, cls: 'key ent' }));
  }

  // ------------------------------------------------------------------ PANELS page
  function panelsPage(c) {
    const p = el('div', { class: 'ah-page ah-panels' }, c);
    p.appendChild(group('CAUTION', [
      push(id('INTL_MWARN_BTN'), 'MASTER WARNING', { lamp: id('MASTER_WARNING_L'), color: 'amber', cls: 'big warn' }),
      push(id('INTL_MCAUTION_BTN'), 'MASTER CAUTION', { lamp: id('MASTER_CAUTION_L'), color: 'amber', cls: 'big caut' }),
      push(id('INTL_TEST_BTN'), 'LIGHT TEST', { lamp: false })
    ], 'col'));
    p.appendChild(group('ARMAMENT', [
      push(id('MASTER_ARM_BTN'), 'A/S', { lamp: [id('MASTER_ARM_ARM_L')], color: 'amber', cls: 'big' }),
      lamp(id('MASTER_ARM_ARM_L'), 'ARM', 'amber'), lamp(id('MASTER_ARM_SAFE_L'), 'SAFE', 'green'),
      push(id('GROUND_OVERRIDE_BTN'), 'GND ORIDE', { lamp: id('GROUND_OVERRIDE_L') })
    ]));
    p.appendChild(group('JETTISON', [
      push(id('JETT_STORE_LW'), 'L TIP', { lamp: id('JETT_L_TIP_L') }), push(id('JETT_STORE_LO'), 'L OUTBD', { lamp: id('JETT_L_OUTBOARD_L') }),
      push(id('JETT_STORE_LI'), 'L INBD', { lamp: id('JETT_L_INBOARD_L') }), push(id('JETT_STORE_RI'), 'R INBD', { lamp: id('JETT_R_INBOARD_L') }),
      push(id('JETT_STORE_RO'), 'R OUTBD', { lamp: id('JETT_R_OUTBOARD_L') }), push(id('JETT_STORE_RW'), 'R TIP', { lamp: id('JETT_R_TIP_L') }),
      push(id('JETT_BTN'), 'JETT', { lamp: false, cls: 'danger' })
    ], 'wide'));
    p.appendChild(group('FIRE', [
      guarded(id('FIRE_ENG1_BTN'), id('FIRE_ENG1_CVR'), 'ENG 1 FIRE', { lamp: id('ENG_1_FIRE_L'), color: 'amber', cls: 'danger' }),
      guarded(id('FIRE_APU_BTN'), id('FIRE_APU_CVR'), 'APU FIRE', { lamp: id('APU_FIRE_L'), color: 'amber', cls: 'danger' }),
      guarded(id('FIRE_ENG2_BTN'), id('FIRE_ENG2_CVR'), 'ENG 2 FIRE', { lamp: id('ENG_2_FIRE_L'), color: 'amber', cls: 'danger' }),
      push(id('FIRE_PRIME_EXT'), 'PRI DISCH', { lamp: id('FIRE_EXT_DISCH_PRI_L') }),
      push(id('FIRE_RES_EXT'), 'RES DISCH', { lamp: id('FIRE_EXT_DISCH_RES_L') }),
      rocker(id('FIRE_DETECT_TEST'), 'TEST', '2', '1')
    ], 'wide'));
    p.appendChild(group('ENGINES / APU', [
      seg(id('MASTER_IGN_SW'), ['OFF', 'BATT', 'EXT PWR'], 'MASTER IGN'),
      guarded(id('APU_BTN'), id('APU_BTN_CVR'), 'APU', { lamp: [id('APU_L'), id('APU_READY_L')] }),
      lamp(id('APU_READY_L'), 'APU READY', 'green'),
      startSwitch(id('ENG1_START'), 'ENG 1', id('ENG_1_READY_L')),
      startSwitch(id('ENG2_START'), 'ENG 2', id('ENG_2_READY_L')),
      seg(id('ROTOR_BRK'), ['LOCK', 'BRK', 'OFF'], 'ROTOR BRAKE')
    ], 'wide'));
    p.appendChild(group('CMWS', [
      cmwsDisplay(),
      seg(id('CMWS_PW'), ['OFF', 'ON', 'TEST'], 'PWR'),
      seg(id('CMWS_ARM'), ['SAFE', 'ARM'], 'FLARE'),
      seg(id('CMWS_MODE'), ['NAV', 'CMWS'], 'MODE'),
      seg(id('CMWS_BYPASS'), ['AUTO', 'BYPASS'], 'OPER'),
      guardedSwitch(id('CMWS_JETT'), id('CMWS_JETT_CVR'), 'FLARE JETT')
    ], 'wide'));
    p.appendChild(group('EMERGENCY', [
      push(id('EMERG_GUARD_BTN'), 'GUARD', { lamp: id('EMERG_GUARD_L') }),
      push(id('EMERG_XPNDR_BTN'), 'XPNDR', { lamp: id('EMERG_XPNDR_L') }),
      push(id('EMERG_HYD_BTN'), 'EMERG HYD', { lamp: id('EMERG_HYD_L') }),
      push(id('T_WHEEL_UNLOCK_BTN'), 'TAIL WHEEL', { lamp: id('T_WHEEL_UNLOCK_L') })
    ]));
    p.appendChild(group('LIGHTS / MISC', [
      seg(id('EXTL_NAV_L_SW'), ['DIM', 'OFF', 'BRT'], 'NAV LIGHTS'),
      seg(id('EXTL_ACOL_L_SW'), ['RED', 'OFF', 'WHT'], 'ANTI-COL'),
      pot(id('EXTL_FROMATION_L_KNB'), 'FORMATION'),
      seg(id('PARK_BRAKE'), ['STOW', 'PULL'], 'PARK BRAKE'),
      seg(id('CANOPY'), ['CLOSE', 'OPEN'], 'CANOPY'),
      seg(id('WIPER_SW'), ['PARK', 'OFF', 'LO', 'HI'], 'WIPER')
    ], 'wide'));
  }

  // ENG START: spring-loaded IGN ORIDE (0) / OFF (1) / START (2) + READY lamp
  function startSwitch(ident, label, readyLamp) {
    if (!has(ident)) return el('span', { class: 'ah-gap' });
    const w = el('div', { class: 'ah-start' });
    el('div', { class: 'ah-lbl', text: label }, w);
    w.appendChild(push(ident, 'START', { press: 2, release: 1, lamp: readyLamp }));
    w.appendChild(push(ident, 'IGN ORIDE', { press: 0, release: 1, lamp: false, cls: 'small' }));
    return w;
  }

  // CMWS display: F / C counts and the four threat sectors + R / D lights
  function cmwsDisplay() {
    const w = el('div', { class: 'ah-cmws' });
    const counts = el('div', { class: 'ah-cmws-counts' }, w);
    const f = text(id('CMWS_FLARE_COUNT'), 'ah-cmws-n');
    const ch = text(id('CMWS_CHAFF_COUNT'), 'ah-cmws-n');
    el('span', { class: 'ah-cmws-l', text: 'F' }, counts); counts.appendChild(f);
    el('span', { class: 'ah-cmws-l', text: 'C' }, counts); counts.appendChild(ch);
    const dia = el('div', { class: 'ah-cmws-dia' }, w);
    [['FWD_LEFT', 'fl'], ['FWD_RIGHT', 'fr'], ['AFT_LEFT', 'al'], ['AFT_RIGHT', 'ar']].forEach(([s, cls]) => {
      const b = id('CMWS_' + s + '_BRT_L'), dm = id('CMWS_' + s + '_DIM_L');
      const q = el('div', { class: 'ah-cmws-q ' + cls }, dia);
      watch(q, [b, dm], () => { q.classList.toggle('on', val(b) > 0); q.classList.toggle('dim', !(val(b) > 0) && val(dm) > 0); });
    });
    const rd = el('div', { class: 'ah-cmws-rd' }, w);
    [['R', 'CMWS_R'], ['D', 'CMWS_D']].forEach(([t, k]) => {
      const q = el('span', { class: 'ah-cmws-x', text: t }, rd);
      const b = id(k + '_BRT_L'), dm = id(k + '_DIM_L');
      watch(q, [b, dm], () => { q.classList.toggle('on', val(b) > 0); q.classList.toggle('dim', !(val(b) > 0) && val(dm) > 0); });
    });
    return w;
  }

  // ------------------------------------------------------------------ FLIGHT page (SimDash.lua flight data)
  function flightPage(c) {
    const p = el('div', { class: 'ah-page ah-flight' }, c);
    const cell = (w) => { const d = el('div', { class: 'ah-cell' }, p); d.appendChild(reg(w).el); };
    cell(G.Dial({ key: 'ias', min: 0, max: 200, start: -160, end: 160, major: 20, minor: 5, title: 'AIRSPEED', unit: 'KNOTS',
      arcs: [{ from: 0, to: 150, color: '#1db32a' }, { from: 150, to: 193, color: '#f2c200' }, { from: 193, to: 196, color: '#e0201b', w: 9 }], digital: 'ias' }));
    cell(G.Attitude({}));
    cell(G.Altimeter({}));
    cell(G.Dial({ key: 'radalt', min: 0, max: 1500, start: 0, end: 330, points: [[0, 0], [100, 0.33], [200, 0.5], [500, 0.75], [1000, 0.9], [1500, 1]],
      labels: [0, 50, 100, 200, 300, 500, 1000, 1500], major: 0, fontSize: 11, labelR: 67, title: 'RAD ALT', unit: 'FEET', titleY: 124, digitalY: 76,
      digital: (s) => (typeof s.radalt === 'number' ? (s.radalt > 1500 ? '----' : Math.round(s.radalt)) : '----') }));
    cell(G.Heading({}));
    cell(G.Vario({}));
    cell(G.Dial({ min: 0, max: 120, start: -135, end: 135, major: 10, minor: 5, labels: [0, 20, 40, 60, 80, 100, 120], title: 'ENGINES', unit: '% ENG 1 / 2',
      needles: [{ key: 'n1', color: '#f2f2f2', label: '1' }, { key: 'n2', color: '#58c7ff', label: '2', length: 64 }],
      arcs: [{ from: 95, to: 104, color: '#1db32a' }, { from: 104, to: 120, color: '#e0201b' }],
      digital: (s) => (typeof s.n1 === 'number' ? Math.round(s.n1) + ' ' + Math.round(s.n2 || 0) : '--') }));
    const side = el('div', { class: 'ah-cell ah-flight-side' }, p);
    side.appendChild(push(id('INTL_MWARN_BTN'), 'MASTER WARNING', { lamp: id('MASTER_WARNING_L'), color: 'amber', cls: 'big warn' }));
    side.appendChild(push(id('INTL_MCAUTION_BTN'), 'MASTER CAUTION', { lamp: id('MASTER_CAUTION_L'), color: 'amber', cls: 'big caut' }));
    side.appendChild(push(id('MASTER_ARM_BTN'), 'A/S', { lamp: [id('MASTER_ARM_ARM_L')], color: 'amber', cls: 'big' }));
    side.appendChild(cmwsDisplay());
    p.querySelectorAll('.instrument').forEach((i) => i.appendChild(Object.assign(document.createElement('div'), { className: 'night-tint' })));
  }

  // ------------------------------------------------------------------ shell
  function render() {
    live.forEach((w) => L.unregister(w));
    live = [];
    root.innerHTML = '';
    const warn = !acft ? 'Apache not detected: start a DCS mission in the AH-64D with DCS-BIOS installed. Buttons are shown but do nothing yet.'
      : !/AH-64/i.test(acft) ? `Current DCS-BIOS aircraft is ${acft}, not the AH-64D.` : '';
    if (warn && !L.status.demo) el('div', { class: 'ah-banner', text: warn }, root);
    const body = el('div', { class: 'ah-body' }, root);
    ({ 'MPD': mpdPage, 'TADS · TEDAC': tadsPage, 'EUFD · KU': eufdKuPage, 'PANELS': panelsPage, 'FLIGHT': flightPage })[page](body);
    if (tabsEl) {
      [...tabsEl.querySelectorAll('.tab.pg')].forEach((t) => t.classList.toggle('active', t.textContent === page));
      const s = tabsEl.querySelector('.tab.seat');
      if (s) s.textContent = seat === 'PLT' ? 'SEAT: PILOT' : 'SEAT: CPG';
    }
  }

  async function loadKnown() {
    try {
      const host = new URLSearchParams(location.search).get('host');
      const r = await fetch((host ? `http://${host}` : '') + '/bios/panel.json', { cache: 'no-store' });
      const panel = await r.json();
      acft = panel.aircraft || '';
      const ids = new Set();
      (panel.categories || []).forEach((cat) => cat.controls.forEach((c) => ids.add(c.id)));
      known = /AH-64/i.test(acft) && ids.size ? ids : null;  // only filter when we really have the Apache list
    } catch (e) {
      acft = '';
      known = null;
    }
    if (root) render();
  }

  function mount(container, tabs) {
    root = el('div', { class: 'ah-root' }, container);
    tabsEl = tabs;
    page = store.get('page', 'MPD');
    seat = store.get('seat', 'PLT');
    if (!PAGES.includes(page)) page = 'MPD';
    PAGES.forEach((pg) => {
      const t = el('button', { class: 'tab pg', type: 'button', text: pg }, tabs);
      t.onclick = () => { page = pg; store.set('page', pg); render(); };
    });
    const st = el('button', { class: 'tab seat', type: 'button' }, tabs);
    st.onclick = () => { seat = seat === 'PLT' ? 'CPG' : 'PLT'; store.set('seat', seat); render(); };
    render();
    loadKnown();
    if (!mount.watching) {
      mount.watching = true;
      L.onStatus((s) => { if (root && s.connected && (s.bios || '') !== acft) loadKnown(); });
    }
  }

  function unmount() {
    live.forEach((w) => L.unregister(w));
    live = [];
    root = null;
  }

  global.DASHBOARDS.apache = {
    name: 'AH-64D Apache', icon: '🚁', sub: 'live MPDs · TADS FLIR · EUFD · keyboard · fire / arm / CMWS panels  (DCS-BIOS)',
    custom: { mount, unmount }
  };
})(window);
