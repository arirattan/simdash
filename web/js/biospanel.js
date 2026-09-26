/*
 * "Cockpit" dashboard: builds touch panels for EVERY cockpit control of the aircraft
 * you are sitting in.
 *   DCS  : from DCS-BIOS (F-14, F-4E, AH-64D, ... any module DCS-BIOS supports)
 *   MSFS : from the sim's input events (every clickable switch/button/knob of the loaded aircraft)
 *
 * The bridge serves the control list at /bios/panel.json. Values arrive as
 * Link.state["bios:<IDENTIFIER>"]; touches are sent with Link.biosCmd(identifier, argument).
 */
(function (global) {
  'use strict';
  const { el } = global.Gauges;
  const L = global.Link;
  const SEATS = [['PLT_', 'PILOT'], ['RIO_', 'RIO'], ['WSO_', 'WSO'], ['CPG_', 'CPG'], ['CP_', 'CO-PILOT'], ['FO_', 'CO-PILOT']];

  let root = null, panel = null, catIdx = 0, seat = 'ALL', query = '', live = [], loadedFor = null, watching = false, currentTabs = null;

  const input = (c, kind) => (c.i || []).find((x) => x[0] === kind);
  const val = (c) => L.state['bios:' + c.id];
  const shortDesc = (c) => c.d.replace(/^(PILOT|RIO|WSO|Pilot|Gunner|CPG|PLT)\s+/, '');
  const seatOf = (id) => (SEATS.find(([p]) => id.startsWith(p)) || [null, 'OTHER'])[1];

  // ------------------------------------------------------------------ widgets
  function card(c, wide) {
    const w = el('div', { class: 'bc' + (wide ? ' wide' : '') });
    el('div', { class: 'bc-name', text: shortDesc(c) }, w);
    el('div', { class: 'bc-id', text: c.id }, w);
    return w;
  }

  function segButtons(c, n) {
    const w = card(c, n > 3);
    const row = el('div', { class: 'bc-seg' }, w);
    const btns = [];
    for (let i = 0; i <= n; i++) {
      const label = c.p && c.p[i] !== undefined ? c.p[i] : String(i);
      const b = el('button', { class: 'bc-pos', type: 'button', text: label }, row);
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); L.biosCmd(c.id, i); });
      btns.push(b);
    }
    return { el: w, keys: ['bios:' + c.id], update() { const v = val(c); btns.forEach((b, i) => b.classList.toggle('on', v === i)); } };
  }

  function pushButton(c) {
    const w = card(c);
    const b = el('button', { class: 'btn bc-push', type: 'button' }, w);
    el('span', { class: 'btn-led' }, b);
    el('span', { class: 'btn-text', text: 'PRESS' }, b);
    let down = false;
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); down = true; b.classList.add('pressed'); L.biosCmd(c.id, 1); });
    const up = () => { if (!down) return; down = false; b.classList.remove('pressed'); L.biosCmd(c.id, 0); };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    return { el: w, keys: ['bios:' + c.id], update() { b.classList.toggle('lit', val(c) > 0); } };
  }

  function stepper(c, dec, inc) {
    const w = card(c);
    const row = el('div', { class: 'bc-step' }, w);
    const m = el('button', { class: 'step', type: 'button', text: '−' }, row);
    const v = el('div', { class: 'bc-val' }, row);
    const p = el('button', { class: 'step', type: 'button', text: '+' }, row);
    const repeat = (btn, arg) => {
      let t1, t2;
      btn.addEventListener('pointerdown', (e) => { e.preventDefault(); L.biosCmd(c.id, arg); t1 = setTimeout(() => { t2 = setInterval(() => L.biosCmd(c.id, arg), 90); }, 400); });
      const stop = () => { clearTimeout(t1); clearInterval(t2); };
      ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => btn.addEventListener(ev, stop));
    };
    repeat(m, dec);
    repeat(p, inc);
    return {
      el: w, keys: ['bios:' + c.id],
      update() {
        const x = val(c);
        if (x === undefined) { v.textContent = '--'; return; }
        if (c.p && c.p[x] !== undefined) v.textContent = c.p[x];
        else if (c.max > 100) v.textContent = Math.round(x / c.max * 100) + '%';
        else v.textContent = Number.isInteger(x) ? x : (+x).toFixed(2);
      }
    };
  }

  function dial(c) {
    const vs = input(c, 'v'), ss = input(c, 's');
    const step = vs ? vs[1] : 3200;
    const s = stepper(c, vs ? '-' + step : 'DEC', vs ? '+' + step : 'INC');
    if (ss) {
      const r = el('input', { type: 'range', min: 0, max: ss[1], step: 1, class: 'bc-range' }, s.el);
      let dragging = false, last = 0;
      r.addEventListener('pointerdown', () => { dragging = true; });
      r.addEventListener('pointerup', () => { dragging = false; });
      r.addEventListener('input', () => { const now = Date.now(); if (now - last > 50) { last = now; L.biosCmd(c.id, r.value); } });
      r.addEventListener('change', () => L.biosCmd(c.id, r.value));
      const base = s.update;
      s.update = () => { base(); if (!dragging && val(c) !== undefined) r.value = val(c); };
    }
    return s;
  }

  function lamp(c) {
    const w = card(c);
    const color = { red: 'red', green: 'green', yellow: 'amber', amber: 'amber', white: 'green', blue: 'green' }[(c.c || '').toLowerCase()] || 'amber';
    const l = el('div', { class: 'lamp bc-lamp ' + color, text: shortDesc(c).replace(/ (Light|Lamp|Indicator)s?\b.*$/i, '').slice(0, 28) }, w);
    return { el: w, keys: ['bios:' + c.id], update() { l.classList.toggle('on', val(c) > 0); } };
  }

  function display(c) {
    const w = card(c, (c.len || 0) > 12);
    const d = el('div', { class: 'bc-display' }, w);
    return { el: w, keys: ['bios:' + c.id], update() { const x = val(c); d.textContent = x === undefined || x === '' ? ' ' : x; } };
  }

  function gauge(c) {
    const w = card(c);
    const t = el('div', { class: 'bc-bar' }, w);
    const f = el('div', { class: 'bc-bar-fill' }, t);
    const v = el('div', { class: 'bc-val small' }, w);
    return {
      el: w, keys: ['bios:' + c.id],
      update() {
        const x = val(c);
        const pct = x === undefined ? 0 : x / (c.max || 65535) * 100;
        f.style.width = pct + '%';
        v.textContent = x === undefined ? '--' : Math.round(pct) + '%';
      }
    };
  }

  function actionButtons(c) {
    const w = card(c);
    const row = el('div', { class: 'bc-seg' }, w);
    (c.i || []).forEach((x) => {
      const args = x[0] === 'a' ? [x[1]] : x[0] === 'f' ? ['DEC', 'INC'] : [];
      args.forEach((a) => {
        const b = el('button', { class: 'bc-pos', type: 'button', text: a }, row);
        b.addEventListener('pointerdown', (e) => { e.preventDefault(); L.biosCmd(c.id, a); });
      });
    });
    return { el: w, keys: [], update() {} };
  }

  function widgetFor(c) {
    const ss = input(c, 's');
    const max = ss ? ss[1] : c.max;
    if (c.t === 'led') return lamp(c);
    if (c.len !== undefined && !ss) return display(c);
    if (c.t === 'analog_gauge' || (!c.i && c.max > 1)) return gauge(c);
    if (!c.i) return c.max === 1 ? lamp(c) : gauge(c);
    if (c.v === 'momentary_last_position' || (ss && max === 1 && /push ?button|button|press/i.test(c.d) && !/cover/i.test(c.d))) return pushButton(c);
    if (['limited_dial', 'analog_dial', 'variable_step_dial'].includes(c.t) || (ss && max > 20 && input(c, 'v'))) return dial(c);
    if (ss && max <= 6) return segButtons(c, max);
    if (input(c, 'f') || ['fixed_step_dial', 'discrete_dial', 'selector'].includes(c.t)) return stepper(c, 'DEC', 'INC');
    return actionButtons(c);
  }

  // ------------------------------------------------------------------ layout
  function clearLive() {
    live.forEach((w) => L.unregister(w));
    live = [];
  }

  function seatFilter(controls) {
    return seat === 'ALL' ? controls : controls.filter((c) => seatOf(c.id) === seat || seatOf(c.id) === 'OTHER');
  }

  function renderControls(host, controls) {
    clearLive();
    host.innerHTML = '';
    if (!controls.length) { el('div', { class: 'bc-empty', text: 'No controls here.' }, host); return; }
    controls.forEach((c) => {
      const w = widgetFor(c);
      host.appendChild(w.el);
      live.push(w);
      L.register(w);
    });
  }

  function render() {
    if (!root) return;
    const list = root.querySelector('.bp-cats');
    const body = root.querySelector('.bp-body');
    const title = root.querySelector('.bp-title');
    list.innerHTML = '';
    if (!panel || !panel.categories.length) {
      clearLive();
      body.innerHTML = '';
      title.textContent = '';
      el('div', { class: 'bc-empty', html: 'No aircraft yet.<br><br><b>MSFS 2024:</b> load a flight — this page fills itself with every clickable control of that aircraft.<br><b>DCS:</b> start a mission with DCS-BIOS installed — every switch, button, knob, lamp and display appears here.' }, body);
      return;
    }
    const cats = panel.categories.map((cat, i) => ({ cat, i, n: seatFilter(cat.controls).length })).filter((x) => x.n);
    if (!cats.find((x) => x.i === catIdx)) catIdx = cats.length ? cats[0].i : 0;
    cats.forEach(({ cat, i, n }) => {
      const b = el('button', { class: 'bp-cat' + (i === catIdx && !query ? ' active' : ''), type: 'button' }, list);
      el('span', { text: cat.name }, b);
      el('small', { text: n }, b);
      b.onclick = () => { catIdx = i; query = ''; root.querySelector('.bp-search').value = ''; render(); };
    });
    if (query) {
      const q = query.toLowerCase();
      const hits = [];
      panel.categories.forEach((cat) => seatFilter(cat.controls).forEach((c) => {
        if (hits.length < 120 && (c.d.toLowerCase().includes(q) || c.id.toLowerCase().includes(q))) hits.push(c);
      }));
      title.textContent = `Search “${query}” — ${hits.length}${hits.length === 120 ? '+' : ''} controls`;
      renderControls(body, hits);
    } else {
      const cat = panel.categories[catIdx];
      title.textContent = cat ? cat.name : '';
      renderControls(body, cat ? seatFilter(cat.controls) : []);
    }
  }

  function renderSeats(tabs) {
    tabs.innerHTML = '';
    if (!panel) return;
    const present = new Set();
    panel.categories.forEach((cat) => cat.controls.forEach((c) => present.add(seatOf(c.id))));
    const seats = ['ALL'].concat(SEATS.map((s) => s[1]).filter((s, i, a) => present.has(s) && a.indexOf(s) === i));
    if (seats.length <= 2) return;
    seats.forEach((s) => {
      const t = el('button', { class: 'tab' + (s === seat ? ' active' : ''), type: 'button', text: s }, tabs);
      t.onclick = () => { seat = s; renderSeats(tabs); render(); };
    });
  }

  async function load(tabs) {
    try {
      const host = new URLSearchParams(location.search).get('host');
      const r = await fetch((host ? `http://${host}` : '') + '/bios/panel.json', { cache: 'no-store' });
      panel = await r.json();
    } catch (e) {
      panel = null;
    }
    loadedFor = panel ? panel.aircraft || '' : '';
    catIdx = 0;
    const t = root && root.querySelector('.bp-acft');
    if (t) t.textContent = panel && panel.aircraft ? panel.aircraft : '—';
    renderSeats(tabs);
    render();
  }

  // ------------------------------------------------------------------ dashboard entry
  function mount(container, tabs) {
    root = el('div', { class: 'bp' }, container);
    const side = el('div', { class: 'bp-side' }, root);
    const head = el('div', { class: 'bp-head' }, side);
    el('div', { class: 'bp-acft', text: '…' }, head);
    const search = el('input', { class: 'bp-search', type: 'search', placeholder: 'Search switches…' }, head);
    search.addEventListener('input', () => { query = search.value.trim(); render(); });
    el('div', { class: 'bp-cats' }, side);
    const main = el('div', { class: 'bp-main' }, root);
    el('div', { class: 'bp-title' }, main);
    el('div', { class: 'bp-body' }, main);
    load(tabs);
    currentTabs = tabs;
    if (!watching) {
      watching = true;
      // reload when DCS-BIOS reports a different aircraft
      L.onStatus((s) => { if (root && s.connected && (s.bios || '') !== loadedFor) load(currentTabs); });
    }
  }

  function unmount() {
    clearLive();
    root = null;
  }

  global.DASHBOARDS['dcs-cockpit'] = {
    name: 'Cockpit', icon: '🎛', sub: 'every switch of the aircraft you are flying (MSFS & DCS)',
    custom: { mount, unmount }
  };
})(window);
