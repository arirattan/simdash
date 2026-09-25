/*
 * Link: WebSocket to the SimDash bridge, shared state store, widget refresh.
 *   ?demo=1  -> fake data generated in the browser (no bridge needed)
 *   ?host=192.168.1.20:8787 -> connect to a bridge other than the page's origin
 */
(function (global) {
  'use strict';
  const params = new URLSearchParams(location.search);
  const state = {};
  const fromSim = new Set();
  const widgets = [];
  const listeners = { status: [], inspect: [] };
  let ws = null, status = { simhub: false, game: '', profile: '' }, pending = new Set(), raf = 0;
  let localDemo = params.get('demo') === '1' || location.protocol === 'file:' || /claude|artifact/.test(location.host);

  function register(w) {
    widgets.push(w);
    w.update(state);
  }

  function apply(delta) {
    for (const k in delta) {
      state[k] = delta[k];
      fromSim.add(k);
      pending.add(k);
    }
    if (!raf) raf = requestAnimationFrame(flush);
  }

  function flush() {
    raf = 0;
    for (const w of widgets) {
      if (!w.keys.length) continue;
      if (w.keys.some((k) => pending.has(k))) w.update(state);
    }
    pending.clear();
  }

  function input(name, a) {
    if (!name) return;
    if (localDemo) return Demo.input(name, a);
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'input', name, a }));
  }

  function connect() {
    if (localDemo) {
      setStatus({ simhub: true, demo: true, game: 'DEMO (browser)', profile: 'demo', connected: true });
      Demo.start();
      return;
    }
    const host = params.get('host') || location.host;
    ws = new WebSocket(`ws://${host}/ws`);
    ws.onopen = () => setStatus(Object.assign({}, status, { connected: true }));
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.t === 'state') apply(m.d);
      else if (m.t === 'status') setStatus(Object.assign(m, { connected: true }));
      else if (m.t === 'inspect') listeners.inspect.forEach((f) => f(m));
    };
    ws.onclose = () => {
      setStatus(Object.assign({}, status, { connected: false, simhub: false }));
      setTimeout(connect, 2000);
    };
  }

  function setStatus(s) {
    status = s;
    listeners.status.forEach((f) => f(s));
  }

  function inspect() {
    if (localDemo) return listeners.inspect.forEach((f) => f({ profile: 'demo', game: 'DEMO', rows: Object.keys(state).sort().map((k) => ({ key: k, value: state[k], from: 'demo generator', candidates: [] })) }));
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'inspect' }));
  }

  // ---------------------------------------------------------------- //
  // In-browser demo so the dashboards can be tried without a sim
  // ---------------------------------------------------------------- //
  const Demo = {
    d: { gear: 1, flaps: 0, ap: 0, hdg_bug: 90, alt_sel: 5000, vs_sel: 500, crs: 90, baro: 1013.25, master_arm: 0, chaff: 60, flare: 30 },
    start() {
      const t0 = performance.now();
      const step = () => {
        const t = (performance.now() - t0) / 1000, d = this.d, S = Math.sin;
        const roll = 25 * S(t / 7);
        apply({
          pitch: 4 * S(t / 5), roll, heading: (d.hdg_bug + 30 * S(t / 11) + 360) % 360, ias: 115 + 25 * S(t / 13),
          alt: 4500 + 1500 * S(t / 30), vs: 900 * S(t / 9), turn: roll / 25 * 20, slip: 0.4 * S(t / 3), baro: d.baro,
          mach: 0.6 + 0.3 * S(t / 13), g: 1 + 2.5 * Math.abs(S(t / 4)), aoa: 8 + 5 * S(t / 6), rpm: 2350 + 150 * S(t / 8),
          n1: 85 + 10 * S(t / 8), n2: 97 + 2 * S(t / 5), nr: 100 + 1.5 * S(t / 3), torque: 60 + 20 * S(t / 7),
          radalt: Math.max(0, 300 + 300 * S(t / 15)), egt: 620 + 60 * S(t / 10), oil_p: 60 + 5 * S(t / 12), oil_t: 85 + 5 * S(t / 20),
          fuel: 70 - (t / 60) % 60, fuel_l: 20 - (t / 120) % 20, fuel_r: 19 - (t / 120) % 19, fuel_flow: 9 + S(t / 5),
          throttle: 70 + 20 * S(t / 8), gear: d.gear, gear_n: d.gear, gear_l: d.gear, gear_r: d.gear, flaps: d.flaps,
          ap_master: d.ap, ap_hdg: d.ap, ap_alt: d.ap, ap_nav: 0, ap_vs: 0, ap_apr: 0, hdg_bug: d.hdg_bug, alt_sel: d.alt_sel,
          vs_sel: d.vs_sel, crs: d.crs, master_arm: d.master_arm, master_caution: Math.floor(t) % 20 < 3 ? 1 : 0, master_warning: 0,
          chaff: d.chaff, flare: d.flare, gun: 578, volts: 28.1, amps: 10 + 3 * S(t / 4), suction: 5, cht: 380 + 20 * S(t / 25),
          speedbrake: 0, hook: 0
        });
      };
      setInterval(step, 100);
      step();
    },
    input(name, a) {
      if (a === 'release') return;
      const d = this.d, n = name.toUpperCase();
      const knobs = { HDG: ['hdg_bug', 1, 360], ALT: ['alt_sel', 100], VS: ['vs_sel', 100], CRS: ['crs', 1, 360], BARO: ['baro', 1] };
      for (const p in knobs) {
        const [k, s, wrap] = knobs[p];
        if (n === p + '_INC' || n === p + '_DEC') { d[k] += n.endsWith('_INC') ? s : -s; if (wrap) d[k] = (d[k] + wrap) % wrap; }
      }
      if (n === 'GEAR_UP') d.gear = 0;
      if (n === 'GEAR_DOWN') d.gear = 1;
      if (n === 'FLAPS_INC') d.flaps = Math.min(3, d.flaps + 1);
      if (n === 'FLAPS_DEC') d.flaps = Math.max(0, d.flaps - 1);
      if (n === 'AP_MASTER') d.ap ^= 1;
      if (n === 'MASTER_ARM') d.master_arm ^= 1;
      if (n === 'CM_CHAFF') d.chaff = Math.max(0, d.chaff - 1);
      if (n === 'CM_FLARE') d.flare = Math.max(0, d.flare - 1);
      if (n === 'CM_PROGRAM') { d.chaff = Math.max(0, d.chaff - 2); d.flare = Math.max(0, d.flare - 2); }
      console.log('[demo input]', name, a);
    }
  };

  // keep the iPad screen awake while the dashboard is open
  async function keepAwake() {
    try { if ('wakeLock' in navigator) await navigator.wakeLock.request('screen'); } catch (e) { /* not granted */ }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); });
  document.addEventListener('pointerdown', keepAwake, { once: true });

  global.Link = {
    state, register, input, connect, inspect,
    has: (k) => fromSim.has(k),
    onStatus: (f) => { listeners.status.push(f); f(status); },
    onInspect: (f) => listeners.inspect.push(f),
    get demo() { return localDemo; }
  };
})(window);
