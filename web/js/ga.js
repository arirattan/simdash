/*
 * General aviation / utility panels for MSFS (and DCS where data exists):
 *   "Prop & Cessna"  PANEL (six-pack + CDI + ADF + engine) · RADIOS (COM/NAV 1+2 with keypad entry,
 *                    transponder, ADF, KAP 140) · CONTROLS (throttle/prop/mixture levers, trim wheel,
 *                    flaps, fuel selector, magneto key, switches)
 *   "Ag & Fire"      DROP (hopper/tank, drop / spray / scoop) · ENGINE (turboprop gauges)
 * Commands are K: events (MSFS SDK names) or named inputs from msfs.json.
 */
(function (global) {
  'use strict';
  const G = global.Gauges, C = global.Controls, Link = global.Link;
  const { el, svg, clamp } = G;
  const send = (name, a = 'tap') => Link.input(name, a);
  const tap = (name) => { send(name, 'press'); setTimeout(() => send(name, 'release'), 60); };
  const click = (t) => global.Feedback && global.Feedback.play(t);

  // ------------------------------------------------------------------ instrument shell (same structure as the six-pack)
  function shell() {
    const wrap = el('div', { class: 'gauge' });
    const inst = el('div', { class: 'instrument' }, wrap);
    return { wrap, inst };
  }
  const layer = (inst, cls = '') => { const s = svg('svg', { viewBox: '0 0 200 200', class: 'box overlay ' + cls }); inst.appendChild(s); return s; };
  function face(s) {
    svg('rect', { x: 1, y: 1, width: 198, height: 198, rx: 14, fill: '#222', stroke: '#111', 'stroke-width': 2, class: 'dial-box' }, s);
    svg('circle', { cx: 100, cy: 100, r: 95, fill: '#555', stroke: '#1a1a1a', 'stroke-width': 3 }, s);
    svg('circle', { cx: 100, cy: 100, r: 90, fill: '#0b0b0b' }, s);
  }
  function compassCard(s, r1 = 88, labelR = 66) {
    for (let d = 0; d < 360; d += 5) {
      const a = d * Math.PI / 180, len = d % 30 === 0 ? 12 : d % 10 === 0 ? 8 : 5;
      svg('line', { x1: 100 + r1 * Math.sin(a), y1: 100 - r1 * Math.cos(a), x2: 100 + (r1 - len) * Math.sin(a), y2: 100 - (r1 - len) * Math.cos(a), stroke: '#eee', 'stroke-width': d % 30 === 0 ? 2.2 : 1.2 }, s);
    }
    ['N', '3', '6', 'E', '12', '15', 'S', '21', '24', 'W', '30', '33'].forEach((t, i) => {
      const a = i * 30 * Math.PI / 180;
      svg('text', { x: 100 + labelR * Math.sin(a), y: 100 - labelR * Math.cos(a) + 5, 'text-anchor': 'middle', 'font-size': t.length > 1 ? 13 : 15, 'font-weight': 700, fill: '#f2f2f2', 'font-family': 'var(--gauge-font)', transform: `rotate(${i * 30} ${100 + labelR * Math.sin(a)} ${100 - labelR * Math.cos(a)})` }, s).textContent = t;
    });
  }

  // VOR / LOC / GS indicator (OBS card, CDI needle, glideslope needle, TO/FROM + NAV flags)
  function CDI() {
    const { wrap, inst } = shell();
    face(layer(inst));
    const card = layer(inst, 'rot');
    compassCard(card, 88, 70);
    const fix = layer(inst);
    svg('path', { d: 'M100 6 L94 18 L106 18 Z', fill: '#ffd400' }, fix);
    for (let i = -5; i <= 5; i++) if (i) svg('circle', { cx: 100 + i * 10, cy: 100, r: 2.4, fill: 'none', stroke: '#eee', 'stroke-width': 1.3 }, fix);
    for (let i = -5; i <= 5; i++) if (i) svg('circle', { cx: 168, cy: 100 + i * 9, r: 2, fill: '#eee' }, fix);
    svg('circle', { cx: 100, cy: 100, r: 8, fill: 'none', stroke: '#eee', 'stroke-width': 1.3 }, fix);
    const toFrom = svg('text', { x: 128, y: 80, 'font-size': 12, 'font-weight': 800, fill: '#fff', 'font-family': 'var(--gauge-font)' }, fix);
    const navFlag = svg('text', { x: 58, y: 80, 'font-size': 12, 'font-weight': 800, fill: '#ff3b30', 'font-family': 'var(--gauge-font)' }, fix);
    navFlag.textContent = 'NAV';
    const cdiL = layer(inst, 'slide-x');
    svg('rect', { x: 98.5, y: 45, width: 3, height: 110, rx: 1.5, fill: '#fff' }, cdiL);
    const gsL = layer(inst, 'slide-y');
    svg('rect', { x: 55, y: 98.5, width: 90, height: 3, rx: 1.5, fill: '#fff' }, gsL);
    const obsVal = el('div', { class: 'hdg-readout' }, inst);
    return {
      el: wrap, keys: ['crs', 'cdi', 'gsi', 'tofrom', 'has_gs', 'nav_ok'],
      update(s) {
        card.style.transform = `rotate(${-(s.crs || 0)}deg)`;
        cdiL.style.transform = `translateX(${clamp((s.cdi || 0) / 127, -1, 1) * 25}%)`;
        gsL.style.transform = `translateY(${clamp(-(s.gsi || 0) / 119, -1, 1) * 22.5}%)`;
        gsL.style.opacity = s.has_gs > 0.5 ? 1 : 0.15;
        toFrom.textContent = s.tofrom === 1 ? 'TO' : s.tofrom === 2 ? 'FR' : '';
        navFlag.style.opacity = s.nav_ok > 0.5 ? 0 : 1;
        obsVal.textContent = 'OBS ' + String(Math.round(s.crs || 0) % 360).padStart(3, '0');
      }
    };
  }

  // ADF with the card slaved to heading (RMI style) - needle = bearing to the NDB
  function ADF() {
    const { wrap, inst } = shell();
    face(layer(inst));
    const card = layer(inst, 'rot');
    compassCard(card, 88, 68);
    const fix = layer(inst);
    svg('path', { d: 'M100 6 L94 18 L106 18 Z', fill: '#ffd400' }, fix);
    svg('text', { x: 100, y: 140, 'text-anchor': 'middle', 'font-size': 11, fill: '#aaa', 'font-family': 'var(--gauge-font)' }, fix).textContent = 'ADF';
    const needle = layer(inst, 'rot');
    svg('path', { d: 'M100 22 L108 44 L102 44 L102 170 L98 170 L98 44 L92 44 Z', fill: '#ffd400', stroke: '#000', 'stroke-width': 0.8 }, needle);
    const hub = layer(inst);
    svg('circle', { cx: 100, cy: 100, r: 7, fill: '#1c1c1c', stroke: '#666', 'stroke-width': 1.5 }, hub);
    const freq = el('div', { class: 'alt-readout' }, inst);
    let hPrev = null, nPrev = null;
    const unwrap = (prev, a) => (prev === null ? a : prev + ((((a - prev) % 360) + 540) % 360 - 180));
    return {
      el: wrap, keys: ['heading', 'adf_brg', 'adf_ok', 'adf_freq'],
      update(s) {
        hPrev = unwrap(hPrev, -(s.heading || 0));
        card.style.transform = `rotate(${hPrev}deg)`;
        const ok = s.adf_ok > 0;
        nPrev = unwrap(nPrev, ok ? (s.adf_brg || 0) : 90);
        needle.style.transform = `rotate(${nPrev}deg)`;
        needle.style.opacity = ok ? 1 : 0.35;
        freq.textContent = typeof s.adf_freq === 'number' ? Math.round(s.adf_freq) + ' kHz' : 'ADF';
      }
    };
  }

  // Tall tank / hopper gauge
  function Tank(o) {
    const w = el('div', { class: 'tank' });
    el('div', { class: 'tank-t', text: o.title }, w);
    const tube = el('div', { class: 'tank-tube' }, w);
    const fill = el('div', { class: 'tank-fill' }, tube);
    [25, 50, 75].forEach((p) => el('div', { class: 'tank-mark', style: `bottom:${p}%` }, tube));
    const v = el('div', { class: 'tank-v' }, w);
    const sub = el('div', { class: 'tank-sub' }, w);
    return {
      el: w, keys: [o.key, o.subKey].filter(Boolean),
      update(s) {
        const x = s[o.key];
        fill.style.height = clamp(x || 0, 0, 100) + '%';
        fill.classList.toggle('low', x < 15);
        v.textContent = typeof x === 'number' ? Math.round(x) + '%' : '--';
        sub.textContent = o.subKey && typeof s[o.subKey] === 'number' ? Math.round(s[o.subKey]) + ' ' + (o.subUnit || '') : '';
      }
    };
  }

  // ------------------------------------------------------------------ keypad overlay (frequencies / squawk)
  function keypad({ title, allowed = '0123456789.', maxLen = 7, validate, onEnter }) {
    const ov = el('div', { class: 'kp-overlay' }, document.body);
    const box = el('div', { class: 'kp' }, ov);
    el('div', { class: 'kp-t', text: title }, box);
    const disp = el('div', { class: 'kp-d', text: '' }, box);
    const err = el('div', { class: 'kp-e' }, box);
    const grid = el('div', { class: 'kp-g' }, box);
    let val = '';
    const show = () => { disp.textContent = val || ' '; err.textContent = ''; };
    const close = () => ov.remove();
    '789456123'.split('').concat(['.', '0', '⌫']).forEach((k) => {
      const b = el('button', { class: 'kp-k' + (allowed.includes(k) || k === '⌫' ? '' : ' off'), type: 'button', text: k }, grid);
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (k === '⌫') val = val.slice(0, -1);
        else if (allowed.includes(k) && val.length < maxLen) val += k;
        show();
      });
    });
    const row = el('div', { class: 'kp-r' }, box);
    const bc = el('button', { class: 'kp-k', type: 'button', text: 'CANCEL' }, row);
    const be = el('button', { class: 'kp-k enter', type: 'button', text: 'ENTER' }, row);
    bc.onclick = close;
    ov.addEventListener('pointerdown', (e) => { if (e.target === ov) close(); });
    be.onclick = () => {
      const msg = validate ? validate(val) : '';
      if (msg) { err.textContent = msg; click('cover'); return; }
      onEnter(val);
      close();
    };
    show();
  }

  // ------------------------------------------------------------------ radio box
  // o: { name, act, stby, dp, whole:[inc,dec], fract:[inc,dec], swap, setHz, min, max }
  function Radio(o) {
    const w = el('div', { class: 'radio' });
    el('div', { class: 'radio-n', text: o.name }, w);
    const a = el('div', { class: 'radio-act' }, w);
    const sw = el('button', { class: 'btn radio-swap', type: 'button', text: '⇆' }, w);
    sw.addEventListener('pointerdown', () => tap(o.swap));
    const s = el('button', { class: 'radio-stby', type: 'button', title: 'tap to type a frequency' }, w);
    s.addEventListener('click', () => keypad({
      title: `${o.name} standby (${o.min.toFixed(2)} - ${o.max.toFixed(2)})`,
      validate: (v) => { const f = parseFloat(v); return f >= o.min && f <= o.max ? '' : 'out of range'; },
      onEnter: (v) => send(`K:${o.setHz}=${Math.round(parseFloat(v) * 1e6)}`, 'press'),
    }));
    const k = C.DualKnob({ outer: { inc: o.whole[0], dec: o.whole[1] }, inner: { inc: o.fract[0], dec: o.fract[1] }, push: o.swap, pushLabel: '⇆', size: 'sm' });
    k.el.classList.add('radio-knob');
    w.appendChild(k.el);
    return {
      el: w, keys: [o.act, o.stby],
      update(st) {
        a.textContent = typeof st[o.act] === 'number' ? st[o.act].toFixed(o.dp) : '---.--';
        s.textContent = typeof st[o.stby] === 'number' ? st[o.stby].toFixed(o.dp) : '---.--';
      }
    };
  }

  function Transponder() {
    const w = el('div', { class: 'radio xpdr' });
    el('div', { class: 'radio-n', text: 'XPDR' }, w);
    const code = el('button', { class: 'radio-stby big', type: 'button', title: 'tap to enter a squawk' }, w);
    const mode = el('div', { class: 'radio-mode' }, w);
    const row = el('div', { class: 'radio-row' }, w);
    const setCode = (v) => send(`K:XPNDR_SET=${parseInt(v, 16)}`, 'press');  // BCD16: "7000" -> 0x7000
    code.addEventListener('click', () => keypad({
      title: 'Squawk (4 digits 0-7)', allowed: '01234567', maxLen: 4,
      validate: (v) => (/^[0-7]{4}$/.test(v) ? '' : 'four digits 0-7'),
      onEnter: setCode,
    }));
    [['1200', '1200'], ['7000', '7000'], ['IDENT', null]].forEach(([t, v]) => {
      const b = el('button', { class: 'btn small', type: 'button', text: t }, row);
      b.addEventListener('pointerdown', () => (v ? setCode(v) : tap('K:XPNDR_IDENT_ON')));
    });
    const MODES = ['OFF', 'STBY', 'TEST', 'ON', 'ALT', 'GND'];
    return {
      el: w, keys: ['xpdr', 'xpdr_state'],
      update(s) {
        code.textContent = typeof s.xpdr === 'number' ? String(s.xpdr).padStart(4, '0') : '----';
        mode.textContent = typeof s.xpdr_state === 'number' ? (MODES[s.xpdr_state] || '') : '';
      }
    };
  }

  function AdfRadio() {
    const w = el('div', { class: 'radio adf' });
    el('div', { class: 'radio-n', text: 'ADF' }, w);
    const f = el('div', { class: 'radio-act' }, w);
    const row = el('div', { class: 'radio-row' }, w);
    [['100', 'ADF_100'], ['10', 'ADF_10'], ['1', 'ADF_1']].forEach(([t, ev]) => {
      const g = el('div', { class: 'radio-step' }, row);
      el('span', { text: t }, g);
      const m = el('button', { class: 'step', type: 'button', text: '−' }, g);
      const p = el('button', { class: 'step', type: 'button', text: '+' }, g);
      m.addEventListener('pointerdown', () => tap(`K:${ev}_DEC`));
      p.addEventListener('pointerdown', () => tap(`K:${ev}_INC`));
    });
    return { el: w, keys: ['adf_freq'], update(s) { f.textContent = typeof s.adf_freq === 'number' ? Math.round(s.adf_freq) + ' kHz' : '--- kHz'; } };
  }

  // Bendix/King KAP 140 style autopilot
  function KAP140() {
    const w = el('div', { class: 'kap' });
    const lcd = el('div', { class: 'kap-lcd' }, w);
    const lat = el('div', { class: 'kap-lat' }, lcd);
    const ap = el('div', { class: 'kap-ap', text: 'AP' }, lcd);
    const vert = el('div', { class: 'kap-vert' }, lcd);
    const sel = el('div', { class: 'kap-sel' }, lcd);
    const keys = el('div', { class: 'kap-keys' }, w);
    [['AP', 'K:AP_MASTER'], ['HDG', 'K:AP_HDG_HOLD'], ['NAV', 'K:AP_NAV1_HOLD'], ['APR', 'K:AP_APR_HOLD'], ['REV', 'K:AP_BC_HOLD'], ['ALT', 'K:AP_ALT_HOLD'], ['UP', 'K:AP_VS_VAR_INC'], ['DN', 'K:AP_VS_VAR_DEC']]
      .forEach(([t, ev]) => { const b = el('button', { class: 'btn kap-k', type: 'button', text: t }, keys); b.addEventListener('pointerdown', () => tap(ev)); });
    const knob = C.DualKnob({ text: 'ALT SEL', outer: { inc: 'ALT_INC_1000', dec: 'ALT_DEC_1000' }, inner: { inc: 'K:AP_ALT_VAR_INC', dec: 'K:AP_ALT_VAR_DEC' }, size: 'sm' });
    w.appendChild(knob.el);
    return {
      el: w, keys: ['ap_master', 'ap_hdg', 'ap_nav', 'ap_apr', 'ap_bc', 'ap_alt', 'ap_vs', 'alt_sel', 'vs_sel'],
      update(s) {
        const on = s.ap_master > 0.5;
        ap.style.visibility = on ? 'visible' : 'hidden';
        lat.textContent = !on ? '' : s.ap_apr > 0.5 ? 'APR' : s.ap_bc > 0.5 ? 'REV' : s.ap_nav > 0.5 ? 'NAV' : s.ap_hdg > 0.5 ? 'HDG' : 'ROL';
        vert.textContent = !on ? '' : s.ap_alt > 0.5 ? 'ALT' : 'VS ' + (s.vs_sel > 0 ? '+' : '') + Math.round(s.vs_sel || 0);
        sel.textContent = typeof s.alt_sel === 'number' ? Math.round(s.alt_sel).toLocaleString('en-US') + ' FT' : '';
      }
    };
  }

  // ------------------------------------------------------------------ levers & controls
  // vertical lever: drag the handle; sends K:<event>=0..16383
  function Lever(o) {
    const w = el('div', { class: 'lever ' + (o.cls || '') });
    el('div', { class: 'lever-t', text: o.title }, w);
    const track = el('div', { class: 'lever-track' }, w);
    const handle = el('div', { class: 'lever-h' }, track);
    const v = el('div', { class: 'lever-v' }, w);
    let dragging = false, lastSent = 0, pending = null;
    const setPos = (pct) => { handle.style.bottom = `calc(${clamp(pct, 0, 100)}% * (1 - var(--hh)))`; };
    const fromEvent = (e) => { const r = track.getBoundingClientRect(); return clamp((r.bottom - e.clientY) / r.height * 100, 0, 100); };
    const emit = (pct) => {
      pending = pct;
      const now = performance.now();
      if (now - lastSent < 50) return;
      lastSent = now;
      send(`K:${o.event}=${Math.round(pending / 100 * 16383)}`, 'press');
    };
    track.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { track.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      dragging = true;
      const p = fromEvent(e); setPos(p); emit(p); v.textContent = Math.round(p) + '%';
    });
    track.addEventListener('pointermove', (e) => { if (!dragging) return; const p = fromEvent(e); setPos(p); emit(p); v.textContent = Math.round(p) + '%'; });
    const end = () => { if (!dragging) return; dragging = false; if (pending !== null) send(`K:${o.event}=${Math.round(pending / 100 * 16383)}`, 'press'); };
    track.addEventListener('pointerup', end);
    track.addEventListener('pointercancel', end);
    setPos(0);
    return { el: w, keys: [o.key], update(s) { if (dragging || typeof s[o.key] !== 'number') return; setPos(s[o.key]); v.textContent = Math.round(s[o.key]) + '%'; } };
  }

  // trim wheel: drag up = nose down (like rolling a real wheel forward)
  function TrimWheel() {
    const w = el('div', { class: 'trim' });
    el('div', { class: 'lever-t', text: 'TRIM' }, w);
    const wheel = el('div', { class: 'trim-wheel' }, w);
    const ind = el('div', { class: 'trim-ind' }, w);
    const mark = el('div', { class: 'trim-mark' }, ind);
    el('div', { class: 'trim-lbl', html: '<span>DN</span><span>TO</span><span>UP</span>' }, w);
    let y0 = null, acc = 0, off = 0;
    wheel.addEventListener('pointerdown', (e) => { e.preventDefault(); try { wheel.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } y0 = e.clientY; acc = 0; });
    wheel.addEventListener('pointermove', (e) => {
      if (y0 === null) return;
      acc += e.clientY - y0; off += e.clientY - y0; y0 = e.clientY;
      wheel.style.backgroundPositionY = off + 'px';
      while (Math.abs(acc) >= 10) {
        const dir = Math.sign(acc); acc -= dir * 10;
        tap(dir < 0 ? 'K:ELEV_TRIM_DN' : 'K:ELEV_TRIM_UP');
        click('detent');
      }
    });
    const end = () => { y0 = null; };
    wheel.addEventListener('pointerup', end);
    wheel.addEventListener('pointercancel', end);
    return { el: w, keys: ['trim'], update(s) { mark.style.top = (50 - clamp(s.trim || 0, -100, 100) / 2) + '%'; } };
  }

  // segmented selector bound to sim state; opts: [{t, input, hold, release}]; index(s) -> active option
  function Seg(o) {
    const w = el('div', { class: 'gseg' });
    el('div', { class: 'lever-t', text: o.title }, w);
    const row = el('div', { class: 'gseg-row' }, w);
    const btns = o.options.map((opt) => {
      const b = el('button', { class: 'sel-pos', type: 'button', text: opt.t }, row);
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); send(opt.input, 'press'); });
      const rel = () => { if (opt.release) send(opt.release, 'press'); send(opt.input, 'release'); };
      b.addEventListener('pointerup', rel);
      b.addEventListener('pointercancel', rel);
      return b;
    });
    return { el: w, keys: o.keys, update(s) { const i = o.index(s); btns.forEach((b, j) => b.classList.toggle('sel', i === j)); } };
  }

  // ------------------------------------------------------------------ layout helpers
  function Group(title, children, cls = '') {
    return () => {
      const wrap = el('div', { class: 'group ' + cls });
      if (title) el('div', { class: 'group-title', text: title }, wrap);
      const body = el('div', { class: 'group-body' }, wrap);
      const ws = children.map((f) => (typeof f === 'function' ? f() : f));
      ws.forEach((w) => body.appendChild(w.el));
      return { el: wrap, keys: [], children: ws, update() {} };
    };
  }
  const W = (fn, o) => () => fn(o);
  const bars = (list) => Group('', list.map((b) => W(G.Bar, b)), 'bars');
  const tog = (text, input, key) => W(C.Toggle, { text, input, key });

  // ------------------------------------------------------------------ gauges
  const asi = W(G.Dial, { key: 'ias', min: 0, max: 200, start: -160, end: 160, major: 20, minor: 5, title: 'AIRSPEED', unit: 'KNOTS',
    arcs: [{ from: 40, to: 85, color: '#f5f5f5', r: 76, w: 4 }, { from: 50, to: 129, color: '#1db32a' }, { from: 129, to: 163, color: '#f2c200' }, { from: 163, to: 166, color: '#e0201b', w: 9 }], digital: 'ias' });
  const tach = W(G.Dial, { key: 'rpm', min: 0, max: 3500, start: -135, end: 135, major: 500, minor: 100, labelScale: 0.01, title: 'RPM', unit: 'x100',
    arcs: [{ from: 2100, to: 2700, color: '#1db32a' }, { from: 2700, to: 2750, color: '#e0201b', w: 9 }], digital: 'rpm' });
  const engineBars = bars([
    { key: 'fuel_l', title: 'FUEL L', min: 0, max: 30, unit: '', dp: 1, bands: [{ from: 0, to: 3, color: '#e0201b' }] },
    { key: 'fuel_r', title: 'FUEL R', min: 0, max: 30, unit: '', dp: 1, bands: [{ from: 0, to: 3, color: '#e0201b' }] },
    { key: 'oil_t', title: 'OIL T', min: 0, max: 130, unit: '°', bands: [{ from: 40, to: 118, color: '#1db32a' }] },
    { key: 'oil_p', title: 'OIL P', min: 0, max: 115, unit: '', bands: [{ from: 25, to: 100, color: '#1db32a' }] },
    { key: 'egt', title: 'EGT', min: 0, max: 900, unit: '°', bands: [] },
    { key: 'fuel_flow', title: 'FF', min: 0, max: 20, unit: '', dp: 1, bands: [] },
  ]);

  const radioStack = Group('', [
    W(Radio, { name: 'COM 1', act: 'com1_act', stby: 'com1', dp: 3, whole: ['K:COM_RADIO_WHOLE_INC', 'K:COM_RADIO_WHOLE_DEC'], fract: ['K:COM_RADIO_FRACT_INC', 'K:COM_RADIO_FRACT_DEC'], swap: 'K:COM_STBY_RADIO_SWAP', setHz: 'COM_STBY_RADIO_SET_HZ', min: 118, max: 136.99 }),
    W(Radio, { name: 'NAV 1', act: 'nav1_act', stby: 'nav1', dp: 2, whole: ['K:NAV1_RADIO_WHOLE_INC', 'K:NAV1_RADIO_WHOLE_DEC'], fract: ['K:NAV1_RADIO_FRACT_INC', 'K:NAV1_RADIO_FRACT_DEC'], swap: 'K:NAV1_RADIO_SWAP', setHz: 'NAV1_STBY_SET_HZ', min: 108, max: 117.95 }),
    W(Radio, { name: 'COM 2', act: 'com2_act', stby: 'com2', dp: 3, whole: ['K:COM2_RADIO_WHOLE_INC', 'K:COM2_RADIO_WHOLE_DEC'], fract: ['K:COM2_RADIO_FRACT_INC', 'K:COM2_RADIO_FRACT_DEC'], swap: 'K:COM2_RADIO_SWAP', setHz: 'COM2_STBY_RADIO_SET_HZ', min: 118, max: 136.99 }),
    W(Radio, { name: 'NAV 2', act: 'nav2_act', stby: 'nav2', dp: 2, whole: ['K:NAV2_RADIO_WHOLE_INC', 'K:NAV2_RADIO_WHOLE_DEC'], fract: ['K:NAV2_RADIO_FRACT_INC', 'K:NAV2_RADIO_FRACT_DEC'], swap: 'K:NAV2_RADIO_SWAP', setHz: 'NAV2_STBY_SET_HZ', min: 108, max: 117.95 }),
  ], 'radios');

  const fuelSel = W(Seg, { title: 'FUEL SELECTOR', keys: ['fuel_sel'], index: (s) => ({ 2: 0, 1: 1, 3: 2, 0: 3 })[s.fuel_sel],
    options: [{ t: 'LEFT', input: 'FUEL_LEFT' }, { t: 'BOTH', input: 'FUEL_BOTH' }, { t: 'RIGHT', input: 'FUEL_RIGHT' }, { t: 'OFF', input: 'FUEL_OFF' }] });
  const magKey = W(Seg, { title: 'MAGNETOS', keys: ['mag_l', 'mag_r', 'starter'],
    index: (s) => (s.starter > 0.5 ? 4 : s.mag_l > 0.5 && s.mag_r > 0.5 ? 3 : s.mag_l > 0.5 ? 2 : s.mag_r > 0.5 ? 1 : 0),
    options: [{ t: 'OFF', input: 'MAG_OFF' }, { t: 'R', input: 'MAG_R' }, { t: 'L', input: 'MAG_L' }, { t: 'BOTH', input: 'MAG_BOTH' }, { t: 'START', input: 'MAG_START', release: 'MAG_BOTH' }] });

  const quadrant = (cond) => Group('', [
    W(Lever, { title: 'THROTTLE', key: 'throttle', event: 'THROTTLE_SET', cls: 'throttle' }),
    W(Lever, { title: 'PROP', key: 'prop', event: 'PROP_PITCH_SET', cls: 'prop' }),
    W(Lever, { title: cond ? 'CONDITION' : 'MIXTURE', key: 'mixture', event: 'MIXTURE_SET', cls: 'mixture' }),
    W(TrimWheel, {}),
  ], 'quadrant');

  // ------------------------------------------------------------------ Ag & Fire
  const hold = (text, down, up, cls = '') => () => {
    const b = el('button', { class: 'btn ' + cls, type: 'button' });
    el('span', { class: 'btn-led' }, b);
    el('span', { class: 'btn-text', text }, b);
    const release = () => { if (!b.classList.contains('pressed')) return; b.classList.remove('pressed'); send(up, 'press'); };
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.classList.add('pressed'); send(down, 'press'); });
    b.addEventListener('pointerup', release);
    b.addEventListener('pointercancel', release);
    b.addEventListener('pointerleave', release);
    return { el: b, keys: ['drop_door'], update(s) { b.classList.toggle('lit', s.drop_door > 5); } };
  };
  const btn = (text, input, key, cls = '') => W(C.Button, { text, input, key, cls });
  const readout = (title, key, unit, dp = 0) => W(G.Readout, { title, key, unit, dp, big: true });
  const dropGroup = Group('DROP / SPRAY', [
    hold('HOLD TO DROP / SPRAY', 'DROP_OPEN', 'DROP_CLOSE', 'red drop'),
    btn('DOOR OPEN', 'DROP_OPEN'), btn('DOOR CLOSE', 'DROP_CLOSE'),
    btn('SCOOP DOWN', 'SCOOP_DOWN'), btn('SCOOP UP', 'SCOOP_UP'),
  ], 'buttons-grid drops');
  const agStatus = Group('', [
    readout('DOOR', 'drop_door', ' %'), readout('SCOOP', 'scoop', ' %'), readout('FLOW', 'drop_flow', ' lb/h'),
    readout('RAD ALT', 'radalt', ' ft'), readout('GS', 'gs', ' kt'), readout('IAS', 'ias', ' kt'),
  ], 'readouts');
  const torque = W(G.Dial, { key: 'torque', min: 0, max: 120, start: -135, end: 135, major: 10, minor: 5, labels: [0, 20, 40, 60, 80, 100, 120], title: 'TORQUE', unit: '%',
    arcs: [{ from: 0, to: 100, color: '#1db32a' }, { from: 100, to: 120, color: '#e0201b' }], digital: 'torque' });
  const itt = W(G.Dial, { key: 'itt', min: 0, max: 1000, start: -135, end: 135, major: 100, minor: 50, labelScale: 0.01, title: 'ITT', unit: '°C x100',
    arcs: [{ from: 400, to: 765, color: '#1db32a' }, { from: 765, to: 805, color: '#f2c200' }, { from: 805, to: 1000, color: '#e0201b' }], digital: 'itt' });
  const ng = W(G.Dial, { key: 'n1', min: 0, max: 110, start: -135, end: 135, major: 10, minor: 5, labels: [0, 20, 40, 60, 80, 100], title: 'Ng', unit: '%',
    arcs: [{ from: 52, to: 101.6, color: '#1db32a' }, { from: 101.6, to: 110, color: '#e0201b' }], digital: (s) => (typeof s.n1 === 'number' ? s.n1.toFixed(1) : '--') });
  const propRpm = W(G.Dial, { key: 'prop_rpm', min: 0, max: 2400, start: -135, end: 135, major: 200, minor: 100, labelScale: 0.01, labels: [0, 400, 800, 1200, 1600, 2000, 2400], title: 'PROP RPM', unit: 'x100',
    arcs: [{ from: 1600, to: 2200, color: '#1db32a' }, { from: 2200, to: 2400, color: '#e0201b' }], digital: 'prop_rpm' });

  global.DASHBOARDS.prop = {
    name: 'Prop & Cessna', icon: '🛫', sub: 'six-pack + CDI/ADF · radio stack & KAP 140 · levers, trim, fuel, mags',
    pages: [
      { title: 'PANEL', cols: 5, rows: 2, cells: [
        [asi], [W(G.Attitude, {})], [W(G.Altimeter, {})], [W(CDI, {})], [tach],
        [W(G.TurnCoordinator, {})], [W(G.Heading, { course: true })], [W(G.Vario, {})], [W(ADF, {})], [engineBars]
      ] },
      { title: 'RADIOS', cols: 3, rowsTpl: '1fr 1fr', cells: [
        [radioStack, 2, 2],
        [Group('TRANSPONDER · ADF', [W(Transponder, {}), W(AdfRadio, {})], 'col')],
        [Group('AUTOPILOT', [W(KAP140, {})], 'col')],
      ] },
      { title: 'CONTROLS', cols: 4, rowsTpl: '1fr auto', cells: [
        [quadrant(false), 2, 1],
        [Group('', [W(C.Selector, { text: 'FLAPS', key: 'flaps', inc: 'FLAPS_INC', dec: 'FLAPS_DEC', positions: ['UP', '10°', '20°', 'FULL'] }), fuelSel, magKey], 'col stack-left')],
        [Group('SWITCHES', [
          tog('BAT', 'MASTER_BATTERY', 'battery'), tog('ALT', 'MASTER_ALTERNATOR', 'alternator'), tog('AVIONICS', 'AVIONICS_MASTER', 'avionics'),
          tog('FUEL PUMP', 'FUEL_PUMP', 'fuel_pump'), tog('BEACON', 'LIGHT_BEACON', 'light_beacon'), tog('LAND', 'LIGHT_LANDING', 'light_landing'),
          tog('TAXI', 'LIGHT_TAXI', 'light_taxi'), tog('NAV', 'LIGHT_NAV', 'light_nav'), tog('STROBE', 'LIGHT_STROBE', 'light_strobe'),
          tog('PITOT HT', 'PITOT_HEAT', 'pitot_heat')
        ], 'switches')],
        [Group('', [btn('PARK BRAKE', 'PARKING_BRAKE', 'parking_brake'), btn('CARB HEAT', 'CARB_HEAT'), btn('GEAR ⇅', 'GEAR_TOGGLE', 'gear')], 'row'), 99, 1],
      ] },
    ]
  };

  global.DASHBOARDS.agfire = {
    name: 'Ag & Fire', icon: '🔥', sub: 'AT-802 spray · CL-415 / Air Crane water: tank, drop, scoop, turboprop',
    pages: [
      { title: 'DROP', cols: 4, rowsTpl: '1fr 1fr', cells: [
        [W(Tank, { title: 'HOPPER / TANK', key: 'tank_pct', subKey: 'tank_gal', subUnit: 'gal' }), 1, 2],
        [dropGroup, 2, 1],
        [agStatus, 1, 2],
        [quadrant(true), 2, 1],
      ] },
      { title: 'ENGINE', cols: 4, rows: 2, cells: [
        [torque], [itt], [ng], [propRpm],
        [bars([
          { key: 'fuel_flow', title: 'FUEL FLOW', min: 0, max: 100, dp: 0, bands: [] },
          { key: 'fuel', title: 'FUEL', min: 0, max: 100, unit: '%', bands: [{ from: 0, to: 10, color: '#e0201b' }] },
          { key: 'oil_p', title: 'OIL P', min: 0, max: 150, unit: 'psi', bands: [{ from: 85, to: 105, color: '#1db32a' }] },
          { key: 'oil_t', title: 'OIL T', min: 0, max: 130, unit: '°C', bands: [{ from: 10, to: 99, color: '#1db32a' }] },
        ]), 2, 1],
        [W(G.Attitude, {})], [W(G.Dial, { key: 'radalt', min: 0, max: 500, start: -135, end: 135, major: 50, minor: 10, labels: [0, 100, 200, 300, 400, 500], title: 'RAD ALT', unit: 'FEET', digital: 'radalt' })],
      ] },
    ]
  };
})(window);
