/*
 * F-14A/B Tomcat (DCS) dashboard, driven by DCS-BIOS - pilot and RIO seats.
 *
 * PILOT: FLIGHT · ARMAMENT · ENGINE / FUEL · GEAR / SYSTEMS · CAUTION · RADIO / NAV
 * RIO:   CAP / TID · RADAR · DEFENSIVE · ARMAMENT · RADIO / NAV
 *
 * Pages are data: each group lists controls as [kind, IDENTIFIER, label, extra].
 *   seg     multi-position switch (positions from DCS-BIOS when the jet is loaded, else the given list)
 *   push    momentary button (opts: lamp, color, cls, cover)
 *   rocker  spring-loaded 3-position (hold up / down)
 *   step    click-stepped selector (INC / DEC) with its position shown
 *   rot     rotary (variable step -/+)
 *   pot     potentiometer (-/+ in %)
 *   lamp    indicator light
 *   text    DCS-BIOS string / number display
 */
(function (global) {
  'use strict';
  const G = global.Gauges, L = global.Link;
  const { el } = G;

  let root = null, tabsEl = null, live = [], seat = 'PLT', page = null, known = null, controls = {}, acft = '';
  const store = {
    get(k, d) { try { return localStorage.getItem('simdash.f14.' + k) || d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('simdash.f14.' + k, v); } catch (e) { /* ignore */ } }
  };
  const has = (ident) => !known || known.has(ident);
  const val = (ident) => L.state['bios:' + ident];
  const cmd = (ident, arg) => L.biosCmd(ident, arg);
  function reg(w) { live.push(w); L.register(w); return w; }
  const K = global.BiosKit({ reg, has, val, cmd });

  // positions straight from DCS-BIOS if available (keeps labels exact for A/B/B(U))
  const posOf = (ident, fallback) => (controls[ident] && controls[ident].p) || fallback;

  // ------------------------------------------------------------------ extra widgets
  function covered(inner, coverIdent, label) {
    if (!has(coverIdent)) return inner;
    const w = el('div', { class: 'ah-guarded' + (inner.classList.contains('wide') ? ' wide' : '') });
    w.appendChild(inner);
    const cover = el('div', { class: 'ah-cover', html: `${label}<small>lift cover</small>` }, w);
    cover.addEventListener('pointerdown', (e) => { e.preventDefault(); cmd(coverIdent, 1); });
    const close = el('button', { class: 'ah-cover-close', type: 'button', text: '✕ close cover' }, w);
    close.addEventListener('pointerdown', (e) => { e.preventDefault(); cmd(coverIdent, 0); });
    K.watch(w, [coverIdent], () => w.classList.toggle('open', val(coverIdent) > 0));
    return w;
  }

  function stepper(ident, label, arg = ['DEC', 'INC'], fallback) {
    if (!has(ident)) return el('span', { class: 'ah-gap' });
    const w = el('div', { class: 'ah-pot wide f14-step' });
    el('div', { class: 'ah-lbl', text: label }, w);
    const row = el('div', { class: 'ah-seg-row' }, w);
    const m = el('button', { class: 'ah-pos', type: 'button', text: '−' }, row);
    const v = el('span', { class: 'ah-pot-v' }, row);
    const p = el('button', { class: 'ah-pos', type: 'button', text: '+' }, row);
    const rep = (b, a) => {
      let t1, t2;
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); cmd(ident, a); t1 = setTimeout(() => { t2 = setInterval(() => cmd(ident, a), 120); }, 450); });
      const stop = () => { clearTimeout(t1); clearInterval(t2); };
      ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => b.addEventListener(ev, stop));
    };
    rep(m, arg[0]);
    rep(p, arg[1]);
    if (arg[0] === 'DEC') {
      K.watch(w, [ident], () => {
        const x = val(ident), pos = posOf(ident, fallback);
        v.textContent = x === undefined ? '--' : (pos && pos[x] !== undefined ? pos[x] : x);
      });
    } else {
      v.textContent = '⟲  ⟳';   // endless rotary: its knob angle means nothing to the pilot
    }
    return w;
  }

  function display(ident, label, cls = '') {
    if (!has(ident)) return el('span', { class: 'ah-gap' });
    const w = el('div', { class: 'f14-disp ' + cls });
    el('div', { class: 'ah-lbl', text: label }, w);
    w.appendChild(K.text(ident, 'f14-disp-v'));
    return w;
  }

  function aoaIndexer() {
    const w = el('div', { class: 'aoa-indexer', html:
      '<svg viewBox="0 0 60 120"><path class="aoa-hi" d="M8 8 L30 38 L52 8" /><circle class="aoa-on" cx="30" cy="60" r="14"/><path class="aoa-lo" d="M8 112 L30 82 L52 112"/></svg><div class="aoa-val">INDEXER</div>' });
    const map = [['PLT_AOA_SLOW', '.aoa-hi'], ['PLT_AOA_OPT', '.aoa-on'], ['PLT_AOA_FAST', '.aoa-lo']];
    K.watch(w, map.map((m) => m[0]), () => map.forEach(([id, sel]) => w.querySelector(sel).classList.toggle('lit', val(id) > 0)));
    return w;
  }

  // compact spec -> element
  function item(spec) {
    const [kind, id, label, x = {}] = spec;
    const o = Array.isArray(x) ? { pos: x } : x;
    let node;
    switch (kind) {
      case 'seg': {
        const pos = posOf(id, o.pos || ['OFF', 'ON']);
        node = K.seg(id, pos, label);
        if (pos.length >= 6) node.classList.add('row');   // e.g. V/UHF frequency mode: give it the whole row
        break;
      }
      case 'push': node = K.push(id, label, { lamp: o.lamp || false, color: o.color, cls: o.cls }); break;
      case 'rocker': node = K.rocker(id, label, o.up || '▲', o.down || '▼'); break;
      case 'step': node = stepper(id, label, ['DEC', 'INC'], o.pos); break;
      case 'rot': node = stepper(id, label, ['-3200', '+3200']); break;
      case 'pot': node = K.pot(id, label); break;
      case 'lamp': node = K.lamp(id, label, o.color || 'amber'); break;
      case 'text': node = display(id, label, o.cls); break;
      case 'aoa': node = aoaIndexer(); break;
      default: node = el('span', { class: 'ah-gap' });
    }
    if (o.cover && !node.classList.contains('ah-gap')) node = covered(node, o.cover, label);
    if (o.wide && !node.classList.contains('ah-gap')) node.classList.add('wide');
    return node;
  }
  function groups(c, list, cls = '') {
    const p = el('div', { class: 'ah-page ah-panels ' + cls }, c);
    list.forEach(([title, items, gcls]) => {
      const nodes = items.map(item).filter((n) => !n.classList.contains('ah-gap'));
      if (nodes.length) p.appendChild(K.group(title, nodes, gcls || ''));
    });
    return p;
  }

  // ================================================================== PILOT
  function pltFlight(c) {
    const P = global.INSTRUMENT_PRESETS || {};
    const p = el('div', { class: 'ah-page f14-flight' }, c);
    const cell = (w) => { const d = el('div', { class: 'ah-cell' }, p); d.appendChild(reg(w).el); return d; };
    [P.asiJet, () => G.Attitude({}), () => G.Altimeter({}), P.aoa].forEach((f) => f && cell(f()));
    const side = el('div', { class: 'ah-cell ah-flight-side' }, p);
    side.appendChild(aoaIndexer());
    side.appendChild(item(['push', 'PLT_MASTER_CAUTION_RESET', 'MASTER CAUTION', { lamp: 'PLT_MASTER_CAUTION', color: 'amber', cls: 'big caut' }]));
    side.appendChild(item(['text', 'PLT_HUD_MODE', 'HUD MODE']));
    [P.vviJet, () => G.Heading({ course: true }), P.g, P.rpmJet].forEach((f) => f && cell(f()));
    const fuel = el('div', { class: 'ah-cell ah-flight-side' }, p);
    [['PLT_FUEL_LEFT_DISP', 'FUEL L'], ['PLT_FUEL_RIGHT_DISP', 'FUEL R'], ['PLT_FUEL_TOTAL_DISP', 'TOTAL'], ['PLT_FUEL_BINGO_DISP', 'BINGO']]
      .forEach(([id, l]) => fuel.appendChild(item(['text', id, l])));
    fuel.appendChild(item(['lamp', 'PLT_GEAR_LIGHT', 'GEAR', { color: 'red' }]));
    p.querySelectorAll('.instrument').forEach((i) => i.appendChild(Object.assign(document.createElement('div'), { className: 'night-tint' })));
  }

  const pltArmament = (c) => groups(c, [
    ['MASTER ARM', [['seg', 'PLT_MASTER_ARM_SW', 'MASTER ARM', { pos: ['ON', 'OFF', 'TNG'], cover: 'PLT_MASTER_ARM_COVER' }],
      ['push', 'PLT_ACM_JETT', 'ACM JETT', { cover: 'PLT_ACM_COVER', cls: 'danger' }], ['push', 'PLT_EMERG_STORE_JETT', 'EMERG JETT', { cls: 'danger' }]]],
    ['STICK / ACM PANEL', [
      ['push', 'PLT_GUN_RATE', 'GUN RATE', { lamp: 'PLT_GUN_RATE_HIGH' }], ['push', 'PLT_SIDEWINDER_COOL', 'SW COOL', { lamp: 'PLT_SW_COOL_ON' }],
      ['push', 'PLT_MISSLE_PREP', 'MSL PREP', { lamp: 'PLT_MSL_PREP_ON' }], ['push', 'PLT_MISSLE_MODE', 'MSL MODE', { lamp: 'PLT_MSL_MODE_BORE' }],
      ['lamp', 'PLT_HOT_TRIGGER', 'HOT TRIGGER', { color: 'red' }], ['lamp', 'PLT_COLLISION_LIGHT', 'COLLISION', { color: 'amber' }],
      ['lamp', 'PLT_SEAM_LOCK', 'SEAM LOCK', { color: 'green' }], ['text', 'PLT_AMMO_DISP', 'AMMO'], ['text', 'PLT_GUN_LEAD_DISP', 'GUN LEAD']], 'wide'],
    ['HUD', [['push', 'PLT_HUD_MODE_TAKEOFF', 'T.O.'], ['push', 'PLT_HUD_MODE_CRUISE', 'CRUISE'], ['push', 'PLT_HUD_MODE_A2A', 'A/A'],
      ['push', 'PLT_HUD_MODE_A2G', 'A/G'], ['push', 'PLT_HUD_MODE_LAND', 'LDG'], ['text', 'PLT_HUD_MODE', 'MODE'],
      ['seg', 'PLT_HUD_DECLUTTER', 'DECLUTTER', ['OFF', 'ON']], ['seg', 'PLT_HUD_MODE_AWL', 'AWL', ['ACL', 'ILS']]], 'wide'],
    ['THREAT (RWR)', [['lamp', 'PLT_HUD_LIGHT_SAM', 'SAM', { color: 'red' }], ['lamp', 'PLT_HUD_LIGHT_AAA', 'AAA', { color: 'red' }], ['lamp', 'PLT_HUD_LIGHT_AI', 'AI', { color: 'red' }],
      ['pot', 'PLT_RWR_BRIGHT', 'RWR BRT']]],
  ]);

  const pltEngineFuel = (c) => groups(c, [
    ['ENGINE START', [['seg', 'PLT_ENGINE_CRANK', 'CRANK', ['R', 'OFF', 'L']], ['seg', 'PLT_ENGINE_AIRSTART', 'AIRSTART', ['NORM', 'ON']],
      ['seg', 'PLT_THROTTLE_MODE', 'THROTTLE MODE', ['MAN', 'BOOST', 'AUTO']], ['seg', 'PLT_THROTTLE_TEMP', 'THROTTLE TEMP', ['COLD', 'NORM', 'HOT']],
      ['seg', 'PLT_ENGINE_MODE_L', 'L ENG MODE', ['PRI', 'SEC']], ['seg', 'PLT_ENGINE_MODE_R', 'R ENG MODE', ['PRI', 'SEC']],
      ['seg', 'PLT_ANTI_ICE', 'ANTI-ICE', ['OFF', 'AUTO', 'ORIDE']], ['seg', 'PLT_ASY_THRUST_LIMIT', 'ASYM LIMIT', { pos: ['ON', 'OFF'], cover: 'PLT_ASY_THRUST_LIMIT_COVER' }]], 'wide'],
    ['ELECTRICS', [['seg', 'PLT_L_GEN_SW', 'L GEN', ['TEST', 'OFF', 'NORM']], ['seg', 'PLT_R_GEN_SW', 'R GEN', ['TEST', 'OFF', 'NORM']],
      ['seg', 'PLT_EMERG_GEN_SW', 'EMERG GEN', { pos: ['OFF', 'NORM'], cover: 'PLT_EMERG_GEN_COVER' }],
      ['lamp', 'PLT_WARN_LGEN', 'L GEN', { color: 'amber' }], ['lamp', 'PLT_WARN_RGEN', 'R GEN', { color: 'amber' }]]],
    ['FIRE', [['push', 'PLT_FIRE_EX_BOTTLE_L', 'L BOTTLE', { lamp: 'PLT_L_ENG_FIRE', color: 'amber', cls: 'danger' }],
      ['push', 'PLT_FIRE_EX_BOTTLE_R', 'R BOTTLE', { lamp: 'PLT_R_ENG_FIRE', color: 'amber', cls: 'danger' }],
      ['lamp', 'PLT_L_ENG_FIRE', 'L FIRE', { color: 'red' }], ['lamp', 'PLT_R_ENG_FIRE', 'R FIRE', { color: 'red' }]]],
    ['FUEL', [['text', 'PLT_FUEL_LEFT_DISP', 'LEFT'], ['text', 'PLT_FUEL_RIGHT_DISP', 'RIGHT'], ['text', 'PLT_FUEL_TOTAL_DISP', 'TOTAL'], ['text', 'PLT_FUEL_BINGO_DISP', 'BINGO'],
      ['rot', 'PLT_BINGO_FUEL_KNOB', 'BINGO SET'], ['seg', 'PLT_FUEL_QUANT_SEL', 'QTY SEL', ['EXT', 'FEED', 'WING']],
      ['seg', 'PLT_FUEL_FEED', 'FEED', { pos: ['AFT', 'NORM', 'FWD'], cover: 'PLT_FUEL_FEED_COVER' }], ['seg', 'PLT_FUEL_WING_EXT_TRANS', 'WING/EXT TRANS', ['OFF', 'AUTO', 'ORIDE']],
      ['seg', 'PLT_FUEL_DUMP', 'DUMP', ['OFF', 'DUMP']], ['seg', 'PLT_REFUEL_PROBE', 'PROBE', ['RET', 'EXT FUS', 'EXT ALL']],
      ['seg', 'PLT_FUEL_SHUTOFF_L', 'L SHUTOFF', ['OFF', 'ON']], ['seg', 'PLT_FUEL_SHUTOFF_R', 'R SHUTOFF', ['OFF', 'ON']],
      ['lamp', 'PLT_WARN_LFUELLOW', 'L FUEL LOW'], ['lamp', 'PLT_WARN_RFUELLOW', 'R FUEL LOW'], ['lamp', 'PLT_WARN_BINGO', 'BINGO']], 'wide'],
    ['HYDRAULICS', [['seg', 'PLT_HYD_TRANS_PUMPLT_SW', 'TRANS PUMP', { pos: ['NORMAL', 'SHUTOFF'], cover: 'PLT_HYD_TRANS_PUMPLT_COVER' }],
      ['seg', 'PLT_HYD_ISOL_SW', 'ISOLATION', ['T.O./LDG', 'FLT']], ['seg', 'PLT_HYD_EMERG_FCONTR_SW', 'EMERG FLT HYD', { pos: ['AUTO', 'LOW', 'HIGH'], cover: 'PLT_HYD_EMERG_FCONTR_COVER' }],
      ['lamp', 'PLT_WARN_HYDPRESS', 'HYD PRESS']], 'wide'],
  ]);

  const pltGearSystems = (c) => groups(c, [
    ['GEAR / HOOK', [['seg', 'PLT_GEAR_LEVER', 'GEAR', ['UP', 'DN']], ['lamp', 'PLT_GEAR_LIGHT', 'GEAR TRANSIT', { color: 'red' }],
      ['seg', 'PLT_HOOK_LEVER', 'HOOK', ['UP', 'DN']], ['lamp', 'PLT_HOOK_LIGHT', 'HOOK', { color: 'red' }],
      ['push', 'PLT_LAUNCHBAR_ABORT', 'LAUNCH BAR ABORT', { cover: 'PLT_LAUNCHBAR_ABORT_COVER', cls: 'danger' }],
      ['seg', 'PLT_NOSE_STRUT_SW', 'NOSE STRUT', ['KNEEL', 'OFF', 'EXTD']], ['seg', 'PLT_PARK_BRAKE', 'PARK BRAKE', ['OFF', 'ON']],
      ['seg', 'PLT_ANTI_SKID_SW', 'ANTI-SKID', ['SPLR BK', 'OFF', 'BOTH']], ['seg', 'PLT_HOOK_BYPASS', 'HOOK BYPASS', ['CARRIER', 'FIELD']]], 'wide'],
    ['FLAPS / WING', [['pot', 'PLT_FLAPS_LEVER', 'FLAPS'], ['pot', 'PLT_EMERG_WING_SWEEPLT_LEVER', 'EMERG SWEEP'],
      ['seg', 'PLT_EMERG_WING_SWEEPLT_COVER', 'SWEEP COVER', ['CLOSED', 'OPEN']], ['lamp', 'PLT_WARN_WINGSWEEP', 'WING SWEEP'], ['lamp', 'PLT_WARN_FLAP', 'FLAP']]],
    ['AFCS / AUTOPILOT', [['seg', 'PLT_AFCS_PITCH', 'PITCH SAS', ['OFF', 'ON']], ['seg', 'PLT_AFCS_ROLL', 'ROLL SAS', ['OFF', 'ON']], ['seg', 'PLT_AFCS_YAW', 'YAW SAS', ['OFF', 'ON']],
      ['seg', 'PLT_AUTOPLT_VECTOR_CARRIER', 'VEC / ACL', ['ACL', 'OFF', 'VEC/PCD']], ['seg', 'PLT_AUTOPLT_ALT', 'ALT HOLD', ['OFF', 'ON']],
      ['seg', 'PLT_AUTOPLT_HDG', 'HDG', ['GT', 'OFF', 'HDG']], ['seg', 'PLT_AUTOPLT_ENGAGE', 'ENGAGE', ['OFF', 'ENGAGE']], ['lamp', 'PLT_WARN_AUTOPLT', 'AUTOPILOT']], 'wide'],
    ['LIGHTS', [['seg', 'PLT_POS_LIGHT_WING', 'POS WING', ['DIM', 'OFF', 'BRT']], ['seg', 'PLT_POS_LIGHT_TAIL', 'POS TAIL', ['DIM', 'OFF', 'BRT']],
      ['seg', 'PLT_POS_LIGHT_FLASH', 'FLASH', ['STEADY', 'FLASH']], ['seg', 'PLT_ANTICOL_LIGHT', 'ANTI-COL', ['OFF', 'ON']], ['seg', 'PLT_TAXI_LIGHT', 'TAXI', ['OFF', 'ON']],
      ['seg', 'PLT_FLOOD_LIGHT_RED', 'RED FLOOD', ['DIM', 'MED', 'BRT']], ['step', 'PLT_LIGHT_INTENT_FORMATION', 'FORMATION']], 'wide'],
    ['COCKPIT', [['push', 'CANOPY_TOGGLE', 'CANOPY'], ['seg', 'PLT_SPOIL_OVER_INBOARD', 'INBD SPOILER', { pos: ['NORM', 'ORIDE'], cover: 'PLT_SPOIL_OVER_COVER_INBOARD' }],
      ['seg', 'PLT_SPOIL_OVER_OUTBOARD', 'OUTBD SPOILER', { pos: ['NORM', 'ORIDE'], cover: 'PLT_SPOIL_OVER_COVER_OUTBOARD' }]]],
  ]);

  // pilot caution / advisory panel: all PLT_WARN_* lamps in panel order (DCS-BIOS F-14 module), panel labels
  const CAUTIONS = [
    ['LGEN', 'L GEN'], ['LOILHOT', 'L OIL HOT'], ['LFUELPRESS', 'L FUEL PRESS'], ['ENGFIREEXT', 'ENG FIRE EXT'], ['RGEN', 'R GEN'],
    ['ROILHOT', 'R OIL HOT'], ['RFUELPRESS', 'R FUEL PRESS'], ['WINGSWEEP', 'WING SWEEP'], ['AUXFIREEXT', 'AUX FIRE EXT'], ['YAWSTABOP', 'YAW STAB OP'],
    ['YAWSTABOUT', 'YAW STAB OUT'], ['CANOPY', 'CANOPY'], ['CADC', 'CADC'], ['LFUELLOW', 'L FUEL LOW'], ['WSHIELDHOT', 'WSHLD HOT'],
    ['EMERGJETT', 'EMERG JETT'], ['OXYLOW', 'OXY LOW'], ['BINGO', 'BINGO'], ['HYDPRESS', 'HYD PRESS'], ['RFUELLOW', 'R FUEL LOW'],
    ['MACHTRIM', 'MACH TRIM'], ['PITCHSTAB', 'PITCH STAB 1'], ['BLEEDDUCT', 'BLEED DUCT'], ['ROLLSTAB', 'ROLL STAB 1'], ['PITCHSTAB2', 'PITCH STAB 2'],
    ['AUTOPLT', 'AUTOPILOT'], ['LOVSPVALVE', 'L OVSP VALVE'], ['ROVSPVALVE', 'R OVSP VALVE'], ['RRAMP', 'R RAMPS'], ['LAUNCHBAR', 'LAUNCH BAR'],
    ['FLAP', 'FLAP'], ['HZTAILAUTH', 'HZ TAIL AUTH'], ['OILPRESS', 'OIL PRESS'], ['LRAMP', 'L RAMPS'], ['LADDER', 'LADDER'],
    ['RINLET', 'R INLET'], ['INLETICE', 'INLET ICE'], ['RUDDERAUTH', 'RUDDER AUTH'], ['LINLET', 'L INLET'], ['ANRS', 'ANRS'],
    ['ROLLSTAB2', 'ROLL STAB 2'], ['SPOILERS', 'SPOILERS'], ['TRANSRECT', 'TRANS/RECT'], ['REDUCESPEED', 'REDUCE SPEED'], ['INTERTRIM', 'INTER TRIM'],
    ['LENGSEC', 'L ENG SEC'], ['RATS', 'RATS'], ['STARTVALVE', 'START VALVE'], ['RENGSEC', 'R ENG SEC'],
  ];
  const pltCaution = (c) => groups(c, [
    ['MASTER', [['push', 'PLT_MASTER_CAUTION_RESET', 'MASTER CAUTION', { lamp: 'PLT_MASTER_CAUTION', color: 'amber', cls: 'big caut' }],
      ['lamp', 'PLT_L_ENG_FIRE', 'L FIRE', { color: 'red' }], ['lamp', 'PLT_R_ENG_FIRE', 'R FIRE', { color: 'red' }],
      ['lamp', 'PLT_MASTERTEST_GO', 'TEST GO', { color: 'green' }], ['lamp', 'PLT_MASTERTEST_NOGO', 'TEST NO-GO', { color: 'red' }]]],
    ['CAUTION / ADVISORY PANEL', CAUTIONS.map(([id, label]) => ['lamp', 'PLT_WARN_' + id, label, { color: 'amber' }]), 'f14-caution'],
  ]);

  const pltRadioNav = (c) => groups(c, [
    ['UHF ARC-159', [['text', 'PLT_UHF_DISP', 'FREQUENCY', { cls: 'big' }], ['seg', 'PLT_UHF1_FUNCTION', 'FUNCTION', ['OFF', 'MAIN', 'BOTH', 'ADF']],
      ['seg', 'PLT_UHF1_FREQ_MODE', 'MODE', ['PRESET', 'MANUAL', 'GUARD']], ['step', 'PLT_UHF1_PRESETS', 'PRESET'],
      ['rocker', 'PLT_UHF1_110_DIAL', '100/10 MHz'], ['rocker', 'PLT_UHF1_1_DIAL', '1 MHz'], ['rocker', 'PLT_UHF1_01_DIAL', '0.1 MHz'], ['rocker', 'PLT_UHF1_025_DIAL', '.025 MHz'],
      ['seg', 'PLT_UHF1_SQUELCH', 'SQUELCH', ['OFF', 'ON']], ['pot', 'PLT_UHF1_VOL', 'VOLUME'], ['push', 'PLT_UHF1_LOAD', 'LOAD'], ['push', 'PLT_UHF1_TONE', 'TONE']], 'wide'],
    ['V/UHF (RIO RADIO)', [['text', 'PLT_VUHF_REMOTE_DISP', 'V/UHF', { cls: 'big' }]]],
    ['TACAN', [['seg', 'PLT_TACAN_MODE', 'MODE', ['OFF', 'REC', 'T/R', 'A/A', 'BCN']], ['step', 'PLT_TACAN_DIAL_TENS', 'CHANNEL 10s'], ['step', 'PLT_TACAN_DIAL_ONES', 'CHANNEL 1s'],
      ['seg', 'PLT_TACAN_CHANNEL', 'X / Y', ['X', 'Y']], ['text', 'HSD_TACAN_RANGE_S', 'RANGE'], ['text', 'HSD_TACAN_CRS_S', 'COURSE'],
      ['lamp', 'PLT_TACAN_COMAND_PLT', 'CMD PILOT', { color: 'green' }], ['lamp', 'PLT_TACAN_COMAND_NFO', 'CMD RIO', { color: 'green' }]], 'wide'],
    ['STEERING / DISPLAYS', [['push', 'PLT_NAV_STEER_TACAN', 'TACAN'], ['push', 'PLT_NAV_STEER_DEST', 'DEST'], ['push', 'PLT_NAV_STEER_AWL', 'AWL/PCD'],
      ['push', 'PLT_NAV_STEER_VECTOR', 'VECTOR'], ['push', 'PLT_NAV_STEER_MAN', 'MAN'], ['text', 'PLT_STEER_MODE', 'STEER'],
      ['seg', 'PLT_HSD_DIS_MODE', 'HSD', ['ECM', 'TID', 'NAV']], ['seg', 'PLT_VDI_MODE_LAND', 'VDI LAND', ['ACL', 'ILS']], ['text', 'HSD_MAN_CRS_S', 'MAN CRS']], 'wide'],
  ]);

  // ================================================================== RIO
  function rioCapTid(c) {
    const p = groups(c, [
      ['TID', [['seg', 'RIO_TID_MODE', 'MODE', ['GND STAB', 'A/C STAB', 'ATTK', 'TV']], ['seg', 'RIO_TID_RANGE', 'RANGE', ['25', '50', '100', '200', '400']],
        ['push', 'RIO_TID_NON_ATTK', 'NON ATTK'], ['push', 'RIO_TID_JAM_STROBE', 'JAM STROBE'], ['push', 'RIO_TID_DATA_LINK', 'DATA LINK'],
        ['push', 'RIO_TID_SYM_ELEM', 'SYM ELEM'], ['push', 'RIO_TID_ALT_NUM', 'ALT NUM'], ['push', 'RIO_TID_RID_DSBL', 'RID DSBL'],
        ['push', 'RIO_TID_LAUNCH_ZONE', 'LAUNCH ZONE'], ['push', 'RIO_TID_VEL_VECTOR', 'VEL VECTOR'], ['push', 'RIO_TID_CLSN', 'CLSN'], ['push', 'RIO_TID_TRACKHOLD', 'TRACK HOLD']], 'wide'],
    ]);
    // CAP: 10 function buttons + numeric keypad
    const cap = el('div', { class: 'ah-group wide f14-cap' });
    el('div', { class: 'ah-group-t', text: 'COMPUTER ADDRESS PANEL' }, cap);
    cap.appendChild(item(['seg', 'RIO_CAP_CATRGORY', 'CATEGORY', ['BIT', 'SPL', 'NAV', 'TAC DATA', 'D/L', 'TGT DATA']]));
    const body = el('div', { class: 'f14-cap-b' }, cap);
    const fn = el('div', { class: 'f14-cap-fn' }, body);
    [1, 6, 2, 7, 3, 8, 4, 9, 5, 10].forEach((n) => fn.appendChild(K.push('RIO_CAP_BTN_' + n, String(n), { lamp: false })));
    fn.appendChild(K.push('RIO_CAP_BTN_TNG', 'TNG NBR', { lamp: false }));
    fn.appendChild(K.push('RIO_CAP_BTN_PGM_RESTRT', 'PGM RSTRT', { lamp: false }));
    const pad = el('div', { class: 'f14-cap-pad' }, body);
    [['RIO_CAP_LAT_1', '1', 'LAT'], ['RIO_CAP_NBR_2', '2', 'NBR'], ['RIO_CAP_SPD_3', '3', 'SPD'], ['RIO_CAP_ALT_4', '4', 'ALT'], ['RIO_CAP_RNG_5', '5', 'RNG'],
     ['RIO_CAP_LONG_6', '6', 'LONG'], ['RIO_CAP_7', '7', ''], ['RIO_CAP_HDG_8', '8', 'HDG'], ['RIO_CAP_9', '9', ''],
     ['RIO_CAP_NE', 'N+E', ''], ['RIO_CAP_BRG_0', '0', 'BRG'], ['RIO_CAP_SW', 'S−W', '']].forEach(([id, big, small]) => {
      const b = K.push(id, big, { lamp: false, cls: 'key' });
      if (small) el('small', { class: 'f14-cap-sub', text: small }, b);
      pad.appendChild(b);
    });
    pad.appendChild(K.push('RIO_CAP_CLEAR', 'CLEAR', { lamp: false, cls: 'key fn' }));
    pad.appendChild(K.push('RIO_CAP_ENTER', 'ENTER', { lamp: false, cls: 'key ent' }));
    p.insertBefore(cap, p.firstChild);
    // F-14B(U) CDNU / TIS lines when present
    const lines = ['RIO_CDNU_LINE1', 'RIO_CDNU_LINE2', 'RIO_CDNU_LINE3', 'RIO_CDNU_LINE4', 'RIO_CDNU_LINE5', 'RIO_CDNU_LINE6', 'RIO_CDNU_LINE7', 'RIO_CDNU_LINE8'].filter((x) => known && known.has(x));
    if (lines.length) {
      const d = el('div', { class: 'ah-eufd' });
      lines.forEach((x) => d.appendChild(K.text(x, 'ah-eufd-line')));
      p.appendChild(K.group('CDNU', [d], 'wide'));
    }
  }

  const rioRadar = (c) => groups(c, [
    ['RADAR MODE', [['push', 'RIO_RADAR_PULSE', 'PULSE SRCH'], ['push', 'RIO_RADAR_PDSRCH', 'PD SRCH'], ['push', 'RIO_RADAR_RWS', 'RWS'],
      ['push', 'RIO_RADAR_TWSMAN', 'TWS MAN'], ['push', 'RIO_RADAR_TWSAUTO', 'TWS AUTO'], ['push', 'RIO_RADAR_PSTT', 'P STT'], ['push', 'RIO_RADAR_PDSTT', 'PD STT']], 'wide'],
    ['RANGE (nm)', [['push', 'RIO_RADAR_5', '5'], ['push', 'RIO_RADAR_10', '10'], ['push', 'RIO_RADAR_20', '20'], ['push', 'RIO_RADAR_50', '50'],
      ['push', 'RIO_RADAR_100', '100'], ['push', 'RIO_RADAR_200', '200']], 'wide'],
    ['SCAN', [['seg', 'RIO_RADAR_ELE_BARS', 'ELEV BARS', ['1', '2', '4', '8']], ['seg', 'RIO_RADAR_AZI_SCAN', 'AZIMUTH', ['±10°', '±20°', '±40°', '±65°']],
      ['pot', 'RIO_RADAR_ELE_CENTER', 'ELEV CENTER'], ['pot', 'RIO_RADAR_AZI_CENTER', 'AZ CENTER'], ['seg', 'RIO_RADAR_STABI', 'STAB', ['OUT', 'IN']],
      ['seg', 'RIO_RADAR_VSL', 'VSL', ['LO', 'OFF', 'HI']]], 'wide'],
    ['DDD', [['push', 'RIO_DDD_RADAR', 'RADAR'], ['push', 'RIO_DDD_IR', 'IR'], ['push', 'RIO_DDD_IFF', 'IFF'], ['push', 'RIO_CCM_SPL', 'CCM SPL'],
      ['push', 'RIO_CCM_ALT_DIFF', 'ALT DIFF'], ['push', 'RIO_CCM_VGS', 'VGS'], ['seg', 'RIO_DDD_ASPECT', 'ASPECT', ['TAIL', 'BEAM', 'NOSE']],
      ['seg', 'RIO_DDD_VC_SCALE', 'Vc SCALE', ['VID', 'NORM', 'X4']], ['seg', 'RIO_DDD_TGTS', 'TGT SIZE', ['LARGE', 'SMALL', 'NORM']], ['seg', 'RIO_DDD_MLC', 'MLC FILTER', ['OUT', 'AUTO', 'ON']],
      ['pot', 'RIO_DDD_BRIGHT', 'BRIGHT'], ['pot', 'RIO_DDD_PULSE_GAIN', 'PULSE GAIN']], 'wide'],
    ['HAND CONTROL UNIT', [['seg', 'RIO_HCU_WCS', 'WCS', ['OFF', 'STBY', 'XMT']], ['seg', 'RIO_HCU_TVIR_SW', 'TV/IR', ['OFF', 'STBY', 'IR/TV']],
      ['seg', 'RIO_HCU_RADAR', 'RADAR', ['OFF', 'ON']], ['seg', 'RIO_HCU_DDD', 'DDD', ['OFF', 'ON']], ['seg', 'RIO_HCU_TID', 'TID', ['OFF', 'ON']], ['seg', 'RIO_HCU_TCS', 'TCS', ['OFF', 'ON']],
      ['push', 'RIO_HCU_PW_RESET', 'PWR RESET'], ['push', 'RIO_HCU_LIGHT_TEST', 'LIGHT TEST']], 'wide'],
  ]);

  const rioDefensive = (c) => groups(c, [
    ['AN/ALE-37 COUNTERMEASURES', [['text', 'RIO_CMDS_CHAFFCNT_DISPLAY', 'CHAFF', { cls: 'big' }], ['text', 'RIO_CMDS_FLARECNT_DISPLAY', 'FLARE', { cls: 'big' }], ['text', 'RIO_CMDS_JAMMCNT_DISPLAY', 'JAMMER', { cls: 'big' }],
      ['seg', 'RIO_CMDS_PW', 'POWER / MODE', ['OFF', 'MAN', 'AUTO']], ['seg', 'RIO_CMDS_DISP_CHAFF', 'CHAFF', ['SGL', 'STBY', 'PRGM']], ['seg', 'RIO_CMDS_DISP_FLAR', 'FLARE', ['SGL', 'STBY', 'PRGM']],
      ['seg', 'RIO_CMDS_DISP_JAMMER', 'JAMMER', ['SGL', 'STBY', 'PRGM']], ['seg', 'RIO_CMDS_FLAREMODE', 'FLARE MODE', ['PILOT', 'NORM', 'MULTI']],
      ['push', 'RIO_CMDS_FLARE_SALVO', 'FLARE SALVO', { cls: 'danger' }], ['push', 'RIO_CMDS_PROG_RESET', 'PRGM RESET'], ['text', 'RIO_ALE_47_DISPLAY', 'ALE-47']], 'wide'],
    ['RWR AN/ALR-67', [['seg', 'RIO_RWR_PW', 'POWER', ['OFF', 'ON']], ['seg', 'RIO_RWR_MODE', 'MODE', ['LMT', 'OFF', 'OFST']], ['seg', 'RIO_RWR_TEST', 'TEST', ['BIT', 'OFF', 'SPL']],
      ['step', 'RIO_RWR_DIS_TYP', 'DISPLAY TYPE'], ['pot', 'RIO_RWR_VOL', 'VOLUME'], ['pot', 'RIO_RWR_BRIGHT', 'BRIGHT']], 'wide'],
    ['DECM ALQ-100', [['step', 'RIO_DECM_PW_MODE', 'POWER / MODE'], ['pot', 'RIO_DECM_VOL', 'VOLUME']]],
    ['CAUTION', [['push', 'RIO_MASTER_CAUTION_RESET', 'MASTER CAUTION RESET', { cls: 'caut' }]]],
  ]);

  const rioArmament = (c) => groups(c, [
    ['WEAPON SELECT', [['step', 'RIO_WEAPON_TYPE', 'WEAPON TYPE'], ['step', 'RIO_WEAPON_ATTK_MODE', 'ATTACK MODE'], ['step', 'RIO_WEAPON_ELEC_FUSE', 'ELEC FUSE'],
      ['step', 'RIO_WEAPON_MSL_SPD', 'MSL SPEED GATE'], ['seg', 'RIO_WEAPON_MECH_FUSE', 'MECH FUSE', ['N/T', 'SAFE', 'NOSE']], ['seg', 'RIO_WEAPON_MSL_OPT', 'MSL OPTION', ['PH ACT', 'NORM', 'SP PD']],
      ['push', 'RIO_WEAPON_AA_LAUNCH', 'A/A LAUNCH', { cls: 'danger' }], ['push', 'RIO_WEAPON_NEXT_LAUNCH', 'NEXT LAUNCH']], 'wide'],
    ['BOMBS / GUN', [['step', 'RIO_WEAPON_QUANT_10', 'QTY 10s'], ['step', 'RIO_WEAPON_QUANTR_1', 'QTY 1s'], ['step', 'RIO_WEAPON_INTER_100', 'INTERVAL x100ms'], ['step', 'RIO_WEAPON_INTER_10', 'INTERVAL x10ms'],
      ['seg', 'RIO_WEAPON_BOMB_SINGLE', 'SGL / PRS', ['PRS', 'SGL']], ['seg', 'RIO_WEAPON_BOMB_STEP', 'STEP / RIPPLE', ['RPL', 'STP']], ['seg', 'RIO_WEAPON_AG_GUN', 'A/G GUN', ['OFF', 'MIXED']]], 'wide'],
    ['JETTISON', [['seg', 'RIO_WEAPON_SEL_JETT', 'SELECTIVE JETT', { pos: ['AUX', 'SAFE', 'JETT'], cover: 'RIO_WEAPON_SEL_JETT_COVER' }], ['seg', 'RIO_WEAPON_JETT_RACK', 'RACKS', ['WPNS', 'MER/TER']],
      ['seg', 'RIO_WEAPON_JETT_TANK_L', 'L TANK', ['SAFE', 'SEL']], ['seg', 'RIO_WEAPON_JETT_TANK_R', 'R TANK', ['SAFE', 'SEL']],
      ['seg', 'RIO_WEAPON_JETT_STAT_1', 'STA 1', ['SW', 'SAFE', 'SEL']], ['seg', 'RIO_WEAPON_JETT_STAT_3', 'STA 3', ['SAFE', 'SEL']], ['seg', 'RIO_WEAPON_JETT_STAT_4', 'STA 4', ['SAFE', 'SEL']],
      ['seg', 'RIO_WEAPON_JETT_STAT_5', 'STA 5', ['SAFE', 'SEL']], ['seg', 'RIO_WEAPON_JETT_STAT_6', 'STA 6', ['SAFE', 'SEL']], ['seg', 'RIO_WEAPON_JETT_STAT_8', 'STA 8', ['SW', 'SAFE', 'SEL']]], 'wide'],
  ]);

  const rioRadioNav = (c) => groups(c, [
    ['V/UHF ARC-182', [['text', 'RIO_VUHF_DISP', 'FREQUENCY', { cls: 'big' }], ['seg', 'RIO_VUHF_MODE', 'MODE', ['OFF', 'T/R', 'T/R&G', 'DF', 'TEST']],
      ['seg', 'RIO_VUHF_FREQ_MODE', 'FREQ MODE', ['243', 'MAN', 'G', 'PRESET', 'READ', 'LOAD']], ['step', 'RIO_VUHF_PRESETS', 'PRESET'],
      ['rocker', 'RIO_VUHF_110_DIAL', '100/10 MHz'], ['rocker', 'RIO_VUHF_1_DIAL', '1 MHz'], ['rocker', 'RIO_VUHF_01_DIAL', '0.1 MHz'], ['rocker', 'RIO_VUHF_025_DIAL', '.025 MHz'],
      ['seg', 'RIO_VUHF_FM_AM', 'FM / AM', ['FM', 'AM']], ['seg', 'RIO_VUHF_SQUELCH', 'SQUELCH', ['OFF', 'ON']], ['pot', 'RIO_VUHF_VOL', 'VOLUME']], 'wide'],
    ['UHF (PILOT RADIO)', [['text', 'RIO_UHF_REMOTE_DISP', 'UHF', { cls: 'big' }], ['pot', 'RIO_UHF1_VOL', 'VOLUME'], ['seg', 'RIO_ICS_XMTR_SEL', 'XMTR SEL', ['UHF 2', 'BOTH', 'UHF 1']]]],
    ['TACAN', [['seg', 'RIO_TACAN_MODE', 'MODE', ['OFF', 'REC', 'T/R', 'A/A', 'BCN']], ['step', 'RIO_TACAN_DIAL_TENS', 'CHANNEL 10s'], ['step', 'RIO_TACAN_DIAL_ONES', 'CHANNEL 1s'],
      ['seg', 'RIO_TACAN_CHANNEL', 'X / Y', ['X', 'Y']], ['seg', 'RIO_TACAN_CMD_BUTTON', 'TACAN CMD', ['PILOT', 'RIO']]], 'wide'],
  ]);

  const SEATS = {
    PLT: [['FLIGHT', pltFlight], ['ARMAMENT', pltArmament], ['ENGINE · FUEL', pltEngineFuel], ['GEAR · SYSTEMS', pltGearSystems], ['CAUTION', pltCaution], ['RADIO · NAV', pltRadioNav]],
    RIO: [['CAP · TID', rioCapTid], ['RADAR', rioRadar], ['DEFENSIVE', rioDefensive], ['ARMAMENT', rioArmament], ['RADIO · NAV', rioRadioNav]],
  };

  // ------------------------------------------------------------------ shell
  function render() {
    if (!root) return;
    live.forEach((w) => L.unregister(w));
    live = [];
    root.innerHTML = '';
    const pages = SEATS[seat];
    if (!pages.some(([t]) => t === page)) page = pages[0][0];
    const warn = !acft ? 'F-14 not detected: start a DCS mission in the F-14 with DCS-BIOS installed. Buttons are shown but do nothing yet.'
      : !/F-14/i.test(acft) ? `Current DCS-BIOS aircraft is ${acft}, not the F-14.` : '';
    if (warn && !L.status.demo) el('div', { class: 'ah-banner', text: warn }, root);
    const body = el('div', { class: 'ah-body' }, root);
    pages.find(([t]) => t === page)[1](body);
    renderTabs();
  }

  function renderTabs() {
    if (!tabsEl) return;
    tabsEl.innerHTML = '';
    SEATS[seat].forEach(([t]) => {
      const b = el('button', { class: 'tab pg' + (t === page ? ' active' : ''), type: 'button', text: t }, tabsEl);
      b.onclick = () => { page = t; store.set('page.' + seat, t); render(); };
    });
    const s = el('button', { class: 'tab seat', type: 'button', text: seat === 'PLT' ? 'SEAT: PILOT' : 'SEAT: RIO' }, tabsEl);
    s.onclick = () => { seat = seat === 'PLT' ? 'RIO' : 'PLT'; store.set('seat', seat); page = store.get('page.' + seat, SEATS[seat][0][0]); render(); };
  }

  async function loadKnown() {
    try {
      const panel = await global.BiosPanel.fetchPanel();
      acft = panel.aircraft || '';
      controls = {};
      (panel.categories || []).forEach((cat) => cat.controls.forEach((c) => { controls[c.id] = c; }));
      known = /F-14/i.test(acft) && Object.keys(controls).length ? new Set(Object.keys(controls)) : null;
      if (!known) controls = {};
    } catch (e) {
      acft = ''; known = null; controls = {};
    }
    if (root) render();
  }

  function mount(container, tabs) {
    root = el('div', { class: 'ah-root' }, container);
    tabsEl = tabs;
    seat = store.get('seat', 'PLT') === 'RIO' ? 'RIO' : 'PLT';
    page = store.get('page.' + seat, SEATS[seat][0][0]);
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
    tabsEl = null;
  }

  global.DASHBOARDS.f14 = {
    name: 'F-14 Tomcat', icon: '🐱', sub: 'pilot: arm, engine/fuel, gear, caution, radios · RIO: CAP/TID, radar, ALE-37, armament (DCS-BIOS)',
    custom: { mount, unmount }
  };
})(window);
