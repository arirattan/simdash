/*
 * Flight bag (the "in-flight iPad"):
 *   CHECKLIST · NOTES (finger / Apple Pencil scratchpad) · TIMERS · WEATHER · E6B · SIMBRIEF
 * Everything is stored on the iPad (localStorage); weather and SimBrief go through the bridge.
 */
(function (global) {
  'use strict';
  const Link = global.Link;
  const { el } = global.Gauges;
  const PAGES = ['CHECKLIST', 'NOTES', 'TIMERS', 'WEATHER', 'E6B', 'SIMBRIEF'];
  const store = {
    get(k, d) { try { const v = localStorage.getItem('simdash.efb.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('simdash.efb.' + k, JSON.stringify(v)); } catch (e) { /* full / private */ } }
  };
  const api = (path) => {
    const host = new URLSearchParams(location.search).get('host');
    return fetch((host ? `http://${host}` : '') + path, { cache: 'no-store' }).then((r) => r.json());
  };
  const click = (t = 'press') => global.Feedback && global.Feedback.play(t);

  let root = null, tabsEl = null, page = 'CHECKLIST', live = [], ticker = 0;

  function reg(w) { live.push(w); Link.register(w); return w; }
  function btn(parent, text, onclick, cls = '') {
    const b = el('button', { class: 'efb-btn ' + cls, type: 'button', text }, parent);
    b.addEventListener('click', onclick);
    return b;
  }

  // ================================================================== CHECKLIST
  function checklistPage(c) {
    const lists = global.CHECKLISTS;
    const names = Object.keys(lists);
    let acft = store.get('cl.acft', names[0]);
    if (!lists[acft]) acft = names[0];
    const p = el('div', { class: 'efb-cl' }, c);
    const side = el('div', { class: 'efb-cl-side' }, p);
    const sel = el('select', { class: 'efb-select' }, side);
    names.forEach((n) => { const o = el('option', { text: n }, sel); o.value = n; });
    sel.value = acft;
    const secList = el('div', { class: 'efb-cl-secs' }, side);
    const main = el('div', { class: 'efb-cl-main' }, p);
    const state = () => store.get('cl.state.' + acft, {});
    let sec = 0;
    function render() {
      const data = lists[acft], st = state();
      secList.innerHTML = '';
      data.forEach(([name, items], i) => {
        const done = (st[i] || []).filter(Boolean).length;
        const b = el('button', { class: 'efb-sec' + (i === sec ? ' active' : '') + (done === items.length ? ' done' : ''), type: 'button' }, secList);
        el('span', { text: name }, b);
        el('small', { text: `${done}/${items.length}` }, b);
        b.onclick = () => { sec = i; render(); };
      });
      btn(secList, 'RESET ALL', () => { if (confirm('Reset all checklist ticks for ' + acft + '?')) { store.set('cl.state.' + acft, {}); sec = 0; render(); } }, 'danger');
      main.innerHTML = '';
      const [name, items] = data[sec];
      el('div', { class: 'efb-h', text: name }, main);
      const checks = st[sec] || [];
      items.forEach(([item, action], j) => {
        const row = el('button', { class: 'efb-item' + (checks[j] ? ' done' : ''), type: 'button' }, main);
        el('span', { class: 'efb-box', text: checks[j] ? '✓' : '' }, row);
        el('span', { class: 'efb-it', text: item }, row);
        el('span', { class: 'efb-dots' }, row);
        el('span', { class: 'efb-act', text: action }, row);
        row.onclick = () => {
          const s2 = state();
          s2[sec] = s2[sec] || [];
          s2[sec][j] = !s2[sec][j];
          store.set('cl.state.' + acft, s2);
          click('toggle');
          // auto-advance when a section is complete
          if (s2[sec].filter(Boolean).length === items.length && sec < data.length - 1) setTimeout(() => { sec++; render(); }, 350);
          render();
        };
      });
      const nav = el('div', { class: 'efb-row' }, main);
      if (sec > 0) btn(nav, '◀ ' + data[sec - 1][0], () => { sec--; render(); });
      if (sec < data.length - 1) btn(nav, data[sec + 1][0] + ' ▶', () => { sec++; render(); }, 'on');
    }
    sel.onchange = () => { acft = sel.value; store.set('cl.acft', acft); sec = 0; render(); };
    render();
  }

  // ================================================================== NOTES (scratchpad)
  const TEMPLATES = {
    BLANK: [],
    CRAFT: ['C  Clearance limit', 'R  Route', 'A  Altitude', 'F  Frequency', 'T  Transponder'],
    ATIS: ['Information', 'Wind', 'Visibility', 'Clouds', 'Temp / Dew', 'Altimeter', 'Runway', 'Remarks'],
    TAXI: ['Runway', 'Taxi route', 'Hold short', 'Frequency'],
  };
  function notesPage(c) {
    const p = el('div', { class: 'efb-notes' }, c);
    const bar = el('div', { class: 'efb-row wrap' }, p);
    const wrap = el('div', { class: 'efb-canvas-wrap' }, p);
    const cv = el('canvas', { class: 'efb-canvas' }, wrap);
    const ctx = cv.getContext('2d');
    let strokes = store.get('notes.strokes', []), tpl = store.get('notes.tpl', 'CRAFT');
    let color = store.get('notes.color', '#ffffff'), width = 3, cur = null, erasing = false;
    const colors = { White: '#ffffff', Yellow: '#ffd400', Cyan: '#37d7ff', Green: '#3dff6e', Red: '#ff5a4a' };
    Object.keys(TEMPLATES).forEach((t) => btn(bar, t, () => { tpl = t; store.set('notes.tpl', t); draw(); markBar(); }, 'tpl'));
    el('span', { class: 'efb-sep' }, bar);
    Object.entries(colors).forEach(([n, col]) => {
      const b = btn(bar, '●', () => { color = col; erasing = false; store.set('notes.color', col); markBar(); }, 'col');
      b.style.color = col; b.dataset.col = col;
    });
    const er = btn(bar, 'ERASER', () => { erasing = !erasing; markBar(); }, 'er');
    btn(bar, 'UNDO', () => { strokes.pop(); save(); draw(); });
    btn(bar, 'CLEAR', () => { if (!strokes.length || confirm('Clear the scratchpad?')) { strokes = []; save(); draw(); } }, 'danger');
    function markBar() {
      bar.querySelectorAll('.tpl').forEach((b) => b.classList.toggle('on', b.textContent === tpl));
      bar.querySelectorAll('.col').forEach((b) => b.classList.toggle('on', !erasing && b.dataset.col === color));
      er.classList.toggle('on', erasing);
    }
    function save() { store.set('notes.strokes', strokes.slice(-400)); }
    function size() {
      const r = wrap.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      cv.width = r.width * dpr; cv.height = r.height * dpr;
      cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    }
    function draw() {
      const w = cv.width / (window.devicePixelRatio || 1), h = cv.height / (window.devicePixelRatio || 1);
      ctx.clearRect(0, 0, w, h);
      const lines = TEMPLATES[tpl] || [];
      if (lines.length) {
        const rowH = h / lines.length;
        ctx.font = '600 15px -apple-system, Segoe UI, sans-serif';
        lines.forEach((t, i) => {
          ctx.fillStyle = 'rgba(160,170,180,0.55)';
          ctx.fillText(t, 12, i * rowH + 22);
          ctx.strokeStyle = 'rgba(160,170,180,0.25)';
          ctx.beginPath(); ctx.moveTo(0, (i + 1) * rowH); ctx.lineTo(w, (i + 1) * rowH); ctx.stroke();
        });
      }
      strokes.forEach(drawStroke);
    }
    function drawStroke(s) {
      if (!s.p.length) return;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.globalCompositeOperation = s.e ? 'destination-out' : 'source-over';
      ctx.strokeStyle = s.c;
      for (let i = 1; i < s.p.length; i++) {
        ctx.lineWidth = s.e ? 26 : Math.max(1.2, s.w * (s.p[i][2] || 0.5) * 2);
        ctx.beginPath(); ctx.moveTo(s.p[i - 1][0], s.p[i - 1][1]); ctx.lineTo(s.p[i][0], s.p[i][1]); ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    const pt = (e) => { const r = cv.getBoundingClientRect(); return [Math.round(e.clientX - r.left), Math.round(e.clientY - r.top), e.pressure || 0.5]; };
    cv.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      cur = { c: color, w: width, e: erasing, p: [pt(e)] };
      strokes.push(cur);
    });
    cv.addEventListener('pointermove', (e) => {
      if (!cur) return;
      const q = pt(e);
      cur.p.push(q);
      drawStroke({ c: cur.c, w: cur.w, e: cur.e, p: cur.p.slice(-2) });
    });
    const end = () => { if (cur) { cur = null; save(); } };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    markBar();
    requestAnimationFrame(size);
    setTimeout(size, 60);
    const ro = new ResizeObserver(() => size());
    ro.observe(wrap);
    live.push({ keys: [], update() {}, destroy: () => ro.disconnect() });
  }

  // ================================================================== TIMERS
  const fmt = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  const clockOf = (sec) => (typeof sec === 'number' ? fmt(sec * 1000).slice(0, 5) : '--:--');
  // timers live in localStorage so switching pages never loses them: { run: bool, t0: ms, acc: ms }
  const T = {
    get: (k) => store.get('tm.' + k, { run: false, t0: 0, acc: 0 }),
    set: (k, v) => store.set('tm.' + k, v),
    val(k) { const t = T.get(k); return t.acc + (t.run ? Date.now() - t.t0 : 0); },
    start(k) { const t = T.get(k); if (!t.run) { t.run = true; t.t0 = Date.now(); T.set(k, t); } },
    stop(k) { const t = T.get(k); if (t.run) { t.acc += Date.now() - t.t0; t.run = false; T.set(k, t); } },
    reset(k) { T.set(k, { run: false, t0: 0, acc: 0 }); },
  };
  // automatic flight timer: runs while airborne (SIM ON GROUND = 0)
  let groundSince = 0;
  const autoFlight = {
    keys: ['on_ground'],
    update(s) {
      if (!store.get('tm.auto', true) || typeof s.on_ground !== 'number') return;
      if (s.on_ground < 0.5) { groundSince = 0; T.start('flight'); }
      else if (T.get('flight').run) {
        if (!groundSince) groundSince = Date.now();
        else if (Date.now() - groundSince > 10000) T.stop('flight');
      }
    }
  };
  Link.register(autoFlight);

  function timersPage(c) {
    const p = el('div', { class: 'efb-timers' }, c);
    const card = (title) => { const d = el('div', { class: 'efb-card' }, p); el('div', { class: 'efb-h', text: title }, d); return d; };
    // clocks
    const clocks = card('CLOCK');
    const zulu = el('div', { class: 'efb-big' }, clocks);
    const local = el('div', { class: 'efb-sub' }, clocks);
    reg({ keys: ['zulu_time', 'local_time'], update(s) {
      const now = new Date();
      zulu.textContent = (typeof s.zulu_time === 'number' ? clockOf(s.zulu_time) : now.toISOString().slice(11, 16)) + ' Z';
      local.textContent = 'Local ' + (typeof s.local_time === 'number' ? clockOf(s.local_time) : now.toTimeString().slice(0, 5)) + (typeof s.zulu_time === 'number' ? '  (sim time)' : '  (device)');
    } });
    // flight time
    const fl = card('FLIGHT TIME');
    const flv = el('div', { class: 'efb-big' }, fl);
    const flr = el('div', { class: 'efb-row' }, fl);
    btn(flr, 'START', () => T.start('flight'), 'on');
    btn(flr, 'STOP', () => T.stop('flight'));
    btn(flr, 'RESET', () => T.reset('flight'), 'danger');
    const auto = btn(flr, 'AUTO', () => { store.set('tm.auto', !store.get('tm.auto', true)); auto.classList.toggle('on', store.get('tm.auto', true)); });
    auto.classList.toggle('on', store.get('tm.auto', true));
    el('div', { class: 'efb-sub', text: 'AUTO starts at lift-off and stops 10 s after landing.' }, fl);
    // stopwatch
    const sw = card('STOPWATCH');
    const swv = el('div', { class: 'efb-big' }, sw);
    const swr = el('div', { class: 'efb-row' }, sw);
    btn(swr, 'START / STOP', () => (T.get('sw').run ? T.stop('sw') : T.start('sw')), 'on');
    btn(swr, 'RESET', () => T.reset('sw'), 'danger');
    // countdown
    const cd = card('COUNTDOWN');
    const cdv = el('div', { class: 'efb-big' }, cd);
    const cdr = el('div', { class: 'efb-row wrap' }, cd);
    [1, 3, 5, 10, 15, 30, 45, 60].forEach((m) => btn(cdr, m + ' min', () => { store.set('tm.cd', { end: Date.now() + m * 60000, len: m * 60000, fired: false }); }));
    btn(cdr, 'CANCEL', () => store.set('tm.cd', null), 'danger');
    const rep = btn(cdr, 'FUEL TANK 30 min ⟳', () => { const on = !store.get('tm.tank', false); store.set('tm.tank', on); rep.classList.toggle('on', on); if (on) store.set('tm.cd', { end: Date.now() + 1800000, len: 1800000, fired: false, repeat: true }); });
    rep.classList.toggle('on', store.get('tm.tank', false));
    const tick = () => {
      flv.textContent = fmt(T.val('flight'));
      swv.textContent = fmt(T.val('sw'));
      const x = store.get('tm.cd', null);
      if (!x) { cdv.textContent = '--:--:--'; cd.classList.remove('alarm'); return; }
      const left = x.end - Date.now();
      cdv.textContent = fmt(left);
      if (left <= 0 && !x.fired) {
        x.fired = true;
        store.set('tm.cd', x);
        cd.classList.add('alarm');
        if (global.Feedback && global.Feedback.alarm) global.Feedback.alarm();
        if (x.repeat && store.get('tm.tank', false)) setTimeout(() => store.set('tm.cd', { end: Date.now() + x.len, len: x.len, fired: false, repeat: true }), 5000);
      }
      if (left > 0) cd.classList.remove('alarm');
    };
    tick();
    ticker = setInterval(tick, 250);
  }

  // ================================================================== WEATHER
  function weatherPage(c) {
    const p = el('div', { class: 'efb-wx' }, c);
    const bar = el('div', { class: 'efb-row' }, p);
    const inp = el('input', { class: 'efb-input', type: 'text', placeholder: 'ICAO, e.g. KSEA KBFI', autocapitalize: 'characters', autocomplete: 'off' }, bar);
    inp.value = store.get('wx.ids', '');
    btn(bar, 'METAR / TAF', () => load(inp.value), 'on');
    btn(bar, 'NEAREST', nearest);
    const out = el('div', { class: 'efb-wx-list' }, p);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') load(inp.value); });
    async function nearest() {
      const s = Link.state;
      if (typeof s.lat !== 'number') { out.textContent = 'Waiting for aircraft position from the sim…'; return; }
      out.textContent = 'finding nearest airports…';
      const r = await api(`/api/nearest?lat=${s.lat}&lon=${s.lon}&n=12`);
      if (r.state !== 'ready') { out.textContent = 'The airport database is not downloaded yet - open the Moving map and accept the download, or type ICAO codes.'; return; }
      inp.value = r.airports.map((a) => a.id).join(' ');
      load(inp.value, true);
    }
    async function load(ids, onlyReporting) {
      ids = ids.toUpperCase().trim();
      if (!ids) return;
      store.set('wx.ids', ids);
      out.textContent = 'loading…';
      let m, t;
      try { [m, t] = await Promise.all([api('/api/metar?ids=' + encodeURIComponent(ids)), api('/api/taf?ids=' + encodeURIComponent(ids))]); }
      catch (e) { out.textContent = 'Weather unavailable (is the PC online?)'; return; }
      if (m.error) { out.textContent = m.error; return; }
      out.innerHTML = '';
      const tafs = {};
      (t.data || []).forEach((x) => { tafs[x.icaoId] = x.rawTAF; });
      if (!m.data.length) { out.textContent = onlyReporting ? 'No METAR-reporting stations nearby.' : 'No METAR found.'; return; }
      m.data.forEach((x) => out.appendChild(metarCard(x, tafs[x.icaoId])));
    }
    if (inp.value) load(inp.value);
  }

  function metarCard(x, taf) {
    const cat = x.fltCat || '';
    const d = el('div', { class: 'efb-card wx ' + cat.toLowerCase() });
    const head = el('div', { class: 'efb-wx-head' }, d);
    el('b', { text: x.icaoId }, head);
    el('span', { text: (x.name || '').split(',')[0] }, head);
    el('span', { class: 'efb-cat ' + cat.toLowerCase(), text: cat || '—' }, head);
    const grid = el('div', { class: 'efb-wx-grid' }, d);
    const wind = x.wdir === 'VRB' ? 'VRB' : (typeof x.wdir === 'number' ? String(x.wdir).padStart(3, '0') + '°' : '—');
    const kv = (k, v) => { const r = el('div', {}, grid); el('span', { text: k }, r); el('b', { text: v }, r); };
    kv('Wind', `${wind} ${x.wspd ?? '—'} kt${x.wgst ? ' G' + x.wgst : ''}`);
    kv('Visibility', x.visib !== undefined ? x.visib + ' SM' : '—');
    kv('Clouds', (x.clouds || []).map((cl) => cl.cover + (cl.base ? String(Math.round(cl.base / 100)).padStart(3, '0') : '')).join(' ') || 'CLR');
    kv('Temp / Dew', `${x.temp ?? '—'}° / ${x.dewp ?? '—'}°`);
    kv('Altimeter', typeof x.altim === 'number' ? `${(x.altim / 33.8639).toFixed(2)} inHg · ${Math.round(x.altim)} hPa` : '—');
    kv('Observed', x.reportTime ? String(x.reportTime).slice(11, 16) + ' Z' : '—');
    el('div', { class: 'efb-raw', text: x.rawOb || '' }, d);
    if (taf) el('div', { class: 'efb-raw taf', text: taf }, d);
    return d;
  }

  // ================================================================== E6B
  function e6bPage(c) {
    const p = el('div', { class: 'efb-e6b' }, c);
    const s = () => Link.state;
    const r1 = (v) => (isFinite(v) ? Math.round(v) : '—');
    const deg = (v) => (isFinite(v) ? String(Math.round(((v % 360) + 360) % 360)).padStart(3, '0') + '°' : '—');
    function calc(title, fields, compute, simFill) {
      const card = el('div', { class: 'efb-card' }, p);
      const h = el('div', { class: 'efb-h' }, card);
      el('span', { text: title }, h);
      const inputs = {};
      const form = el('div', { class: 'efb-form' }, card);
      fields.forEach(([k, label, def]) => {
        const row = el('label', { class: 'efb-field' }, form);
        el('span', { text: label }, row);
        const i = el('input', { type: 'number', inputmode: 'decimal', step: 'any' }, row);
        i.value = store.get('e6b.' + title + '.' + k, def);
        i.addEventListener('input', () => { store.set('e6b.' + title + '.' + k, i.value); run(); });
        inputs[k] = i;
      });
      const res = el('div', { class: 'efb-res' }, card);
      const run = () => {
        const v = {};
        Object.entries(inputs).forEach(([k, i]) => { v[k] = parseFloat(i.value); });
        res.innerHTML = '';
        compute(v).forEach(([k, val]) => { const d = el('div', {}, res); el('span', { text: k }, d); el('b', { text: val }, d); });
      };
      if (simFill) btn(h, 'FROM SIM', () => { const f = simFill(s()); Object.entries(f).forEach(([k, val]) => { if (inputs[k] && isFinite(val)) { inputs[k].value = Math.round(val * 100) / 100; store.set('e6b.' + title + '.' + k, inputs[k].value); } }); run(); }, 'sim');
      run();
    }
    calc('WIND TRIANGLE', [['tas', 'TAS kt', 110], ['tc', 'True course °', 90], ['wd', 'Wind from °', 30], ['ws', 'Wind kt', 15]], (v) => {
      const a = (v.wd - v.tc) * Math.PI / 180;
      const wca = Math.asin(Math.max(-1, Math.min(1, v.ws * Math.sin(a) / v.tas))) * 180 / Math.PI;
      const gs = v.tas * Math.cos(wca * Math.PI / 180) - v.ws * Math.cos(a);
      return [['WCA', (wca >= 0 ? 'R ' : 'L ') + Math.abs(wca).toFixed(1) + '°'], ['True heading', deg(v.tc + wca)], ['Ground speed', r1(gs) + ' kt']];
    }, (x) => ({ tas: x.tas, tc: x.track, wd: x.wind_dir, ws: x.wind_kt }));
    calc('RUNWAY WIND', [['rwy', 'Runway (e.g. 27)', 27], ['wd', 'Wind from °', 300], ['ws', 'Wind kt', 12], ['gust', 'Gust kt', 0]], (v) => {
      const a = (v.wd - v.rwy * 10) * Math.PI / 180;
      const w = Math.max(v.ws, v.gust || 0);
      const head = w * Math.cos(a), cross = w * Math.sin(a);
      return [[head >= 0 ? 'Headwind' : 'Tailwind', r1(Math.abs(head)) + ' kt'], ['Crosswind', `${r1(Math.abs(cross))} kt from the ${cross >= 0 ? 'right' : 'left'}`]];
    }, (x) => ({ wd: x.wind_dir, ws: x.wind_kt }));
    calc('DENSITY ALTITUDE', [['elev', 'Field elevation ft', 500], ['baro', 'Altimeter inHg', 29.92], ['oat', 'OAT °C', 25]], (v) => {
      const pa = v.elev + (29.92 - v.baro) * 1000;
      const isa = 15 - 2 * pa / 1000;
      const da = pa + 120 * (v.oat - isa);
      return [['Pressure altitude', r1(pa) + ' ft'], ['ISA temp', isa.toFixed(1) + ' °C'], ['Density altitude', r1(da) + ' ft']];
    }, (x) => ({ elev: x.alt, baro: x.baro_hg, oat: x.oat }));
    calc('FUEL', [['fuel', 'Fuel on board', 40], ['burn', 'Burn per hour', 8.5], ['dist', 'Distance nm', 120], ['gs', 'Ground speed kt', 110]], (v) => {
      const hrs = v.dist / v.gs, need = hrs * v.burn, endur = v.fuel / v.burn;
      const hm = (h) => (isFinite(h) ? `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}` : '—');
      return [['Time en route', hm(hrs)], ['Fuel required', need.toFixed(1)], ['Endurance', hm(endur)], ['Reserve at arrival', (v.fuel - need).toFixed(1)]];
    }, (x) => ({ fuel: x.fuel_total, burn: x.fuel_flow, gs: x.gs }));
    calc('DESCENT', [['alt', 'Current altitude ft', 6500], ['tgt', 'Target altitude ft', 1500], ['gs', 'Ground speed kt', 120], ['vs', 'Descent rate fpm', 500]], (v) => {
      const min = (v.alt - v.tgt) / v.vs;
      return [['Time', r1(min) + ' min'], ['Start descent', (v.gs * min / 60).toFixed(1) + ' nm before'], ['3° path needs', r1(v.gs * 5.3) + ' fpm']];
    }, (x) => ({ alt: x.alt, gs: x.gs }));
    calc('CONVERT', [['v', 'Value', 1]], (v) => [
      ['kg → lb', (v.v * 2.20462).toFixed(1)], ['lb → kg', (v.v / 2.20462).toFixed(1)], ['L → US gal', (v.v / 3.78541).toFixed(2)],
      ['US gal → L', (v.v * 3.78541).toFixed(1)], ['hPa → inHg', (v.v / 33.8639).toFixed(2)], ['inHg → hPa', (v.v * 33.8639).toFixed(0)],
      ['°C → °F', (v.v * 9 / 5 + 32).toFixed(1)], ['°F → °C', ((v.v - 32) * 5 / 9).toFixed(1)], ['km → nm', (v.v / 1.852).toFixed(2)], ['m → ft', (v.v * 3.28084).toFixed(0)]]);
  }

  // ================================================================== SIMBRIEF
  function simbriefPage(c) {
    const p = el('div', { class: 'efb-sb' }, c);
    const bar = el('div', { class: 'efb-row' }, p);
    const inp = el('input', { class: 'efb-input', type: 'text', placeholder: 'SimBrief username', autocomplete: 'off', autocapitalize: 'off' }, bar);
    inp.value = store.get('sb.user', '');
    btn(bar, 'FETCH LATEST OFP', fetchOfp, 'on');
    btn(bar, 'SHOW ON MAP', () => { store.set('sb.showOnMap', true); location.hash = '#map'; });
    const out = el('div', { class: 'efb-sb-out' }, p);
    async function fetchOfp() {
      const u = inp.value.trim();
      store.set('sb.user', u);
      out.textContent = 'loading…';
      let r;
      try { r = await api('/api/simbrief?user=' + encodeURIComponent(u)); } catch (e) { out.textContent = 'SimBrief unavailable (is the PC online?)'; return; }
      if (r.error) { out.textContent = r.error; return; }
      try { localStorage.setItem('simdash.ofp', JSON.stringify(r)); } catch (e) { /* ignore */ }
      render(r);
    }
    function render(r) {
      out.innerHTML = '';
      const card = el('div', { class: 'efb-card' }, out);
      el('div', { class: 'efb-h', text: `${r.origin.icao} → ${r.dest.icao}${r.altn ? '  (altn ' + r.altn + ')' : ''}` }, card);
      const g = el('div', { class: 'efb-wx-grid' }, card);
      const kv = (k, v) => { const d = el('div', {}, g); el('span', { text: k }, d); el('b', { text: v || '—' }, d); };
      const hm = (s) => (s ? `${Math.floor(s / 3600)}:${String(Math.round(s / 60) % 60).padStart(2, '0')}` : '—');
      kv('Callsign', r.callsign); kv('Aircraft', r.aircraft); kv('Cruise', r.cruise ? r.cruise + ' ft' : '');
      kv('Distance', r.distance ? r.distance + ' nm' : ''); kv('Time en route', hm(+r.ete)); kv('Block fuel', r.fuel_block ? `${r.fuel_block} ${r.units || ''}` : '');
      kv('Departure rwy', r.origin.rwy); kv('Arrival rwy', r.dest.rwy);
      el('div', { class: 'efb-raw', text: r.route || '' }, card);
      const t = el('table', { class: 'efb-table' }, out);
      const hr = el('tr', {}, el('thead', {}, t));
      ['FIX', 'TRK', 'ALT', 'LEG nm', 'LEG time', 'FREQ'].forEach((h) => el('th', { text: h }, hr));
      const tb = el('tbody', {}, t);
      r.fixes.forEach((f) => {
        const tr = el('tr', {}, tb);
        [f.id, f.trk ? String(f.trk).padStart(3, '0') + '°' : '', f.alt, f.dist, f.ete ? hm(+f.ete) : '', f.freq || ''].forEach((v) => el('td', { text: v ?? '' }, tr));
      });
    }
    try { const saved = JSON.parse(localStorage.getItem('simdash.ofp') || 'null'); if (saved) render(saved); } catch (e) { /* none */ }
  }

  // ================================================================== shell
  function render() {
    live.forEach((w) => { if (w.destroy) w.destroy(); else Link.unregister(w); });
    live = [];
    clearInterval(ticker);
    root.innerHTML = '';
    const body = el('div', { class: 'efb-page' }, root);
    ({ CHECKLIST: checklistPage, NOTES: notesPage, TIMERS: timersPage, WEATHER: weatherPage, E6B: e6bPage, SIMBRIEF: simbriefPage })[page](body);
    if (tabsEl) [...tabsEl.children].forEach((t) => t.classList.toggle('active', t.textContent === page));
  }

  function mount(container, tabs) {
    root = el('div', { class: 'efb-root' }, container);
    tabsEl = tabs;
    page = store.get('page', 'CHECKLIST');
    if (!PAGES.includes(page)) page = 'CHECKLIST';
    PAGES.forEach((pg) => {
      const t = el('button', { class: 'tab', type: 'button', text: pg }, tabs);
      t.onclick = () => { page = pg; store.set('page', pg); render(); };
    });
    render();
  }

  function unmount() {
    live.forEach((w) => { if (w.destroy) w.destroy(); else Link.unregister(w); });
    live = [];
    clearInterval(ticker);
    root = null;
  }

  global.DASHBOARDS.efb = {
    name: 'Flight bag', icon: '🧳', sub: 'checklists · notes · timers · weather · E6B · SimBrief',
    custom: { mount, unmount }
  };
})(window);
