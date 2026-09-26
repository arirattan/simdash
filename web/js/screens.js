/*
 * Live screens: pictures of exported cockpit displays (Apache MPDs / TADS FLIR, MFDs, MSFS pop-outs...)
 * streamed by the bridge (bridge/src_screens.py, set up with setup-screens.bat).
 *
 *   Screens.View(['TEDAC', 'CENTER_MFCD'], { quiet: true })  -> widget {el, keys, update}
 *     names    screen names to try, first one the bridge has wins
 *     quiet    stay invisible (so whatever is underneath shows) until pictures arrive
 *     onstate  (live, message, width, height) when the picture comes or goes, or changes size
 *     onfps    (pictures per second shown) every 2 s while live
 */
(function (global) {
  'use strict';
  const { el } = global.Gauges;
  const base = () => { const h = new URLSearchParams(location.search).get('host'); return h ? `http://${h}` : ''; };

  let info = null, infoAt = 0, pending = null;
  function list() {
    if (info && Date.now() - infoAt < 5000) return Promise.resolve(info);
    if (!pending) {
      pending = fetch(base() + '/api/screens', { cache: 'no-store' }).then((r) => r.json())
        .catch(() => ({ available: false, screens: [], fps: 8, error: 'bridge not reachable' }))
        .then((i) => { info = i; infoAt = Date.now(); pending = null; return i; });
    }
    return pending;
  }

  function View(names, o = {}) {
    names = [].concat(names);
    const w = el('div', { class: 'scr' + (o.quiet ? ' quiet' : '') + (o.cls ? ' ' + o.cls : '') });
    const img = el('img', { class: 'scr-img', alt: '' }, w);
    const msg = el('div', { class: 'scr-msg' }, w);
    let timer = null, sock = null, prev = null, seen = false, stopped = false, fails = 0, state = '';
    let type = 'image/jpeg', next = null, busy = false, shown = 0, since = performance.now();

    const later = (ms) => { clearTimeout(timer); timer = setTimeout(connect, ms); };
    function close() { if (sock) { const s = sock; sock = null; s.close(); } }
    function stop() { stopped = true; clearTimeout(timer); clearInterval(watch); close(); if (prev) URL.revokeObjectURL(prev); prev = null; }
    function report(live, text, iw = 0, ih = 0) {
      const s = [live, text, iw, ih].join('|');
      if (s !== state && o.onstate) o.onstate(live, text, iw, ih);
      state = s;
    }
    function offline(text) { w.classList.remove('live'); msg.textContent = text; report(false, text); }

    // pictures come over their own WebSocket as fast as the bridge captures them
    async function connect() {
      if (stopped) return;
      if (!w.isConnected) { if (seen) return stop(); return later(300); }  // removed from the page: done
      seen = true;
      if (document.hidden) return later(1000);
      const i = await list();
      const name = names.find((n) => i.screens.some((s) => s.name === n));
      if (!name) {
        offline(i.error ? `LIVE SCREEN NOT SET UP\n${i.error}` : `LIVE SCREEN NOT SET UP\nno "${names[0]}" screen in bridge/data/screens.json`);
        return later(5000);
      }
      if (stopped || sock) return;
      const s = sock = new WebSocket(`ws://${new URLSearchParams(location.search).get('host') || location.host}/screen/${encodeURIComponent(name)}`);
      s.binaryType = 'blob';
      s.onmessage = (ev) => {
        if (typeof ev.data !== 'string') { next = ev.data; show(); return; }
        let m = {};
        try { m = JSON.parse(ev.data); } catch (e) { /* ignore */ }
        if (m.type) type = m.type;
        if (m.error) offline('NO SIGNAL\n' + m.error);
      };
      s.onclose = () => {
        if (sock !== s) return;  // closed on purpose
        sock = null;
        if (!stopped) { offline('NO SIGNAL\nbridge not reachable'); later(Math.min(5000, 500 * ++fails)); }
      };
    }

    // newest picture only: the ones arriving while the iPad decodes are skipped, so it never lags behind
    function show() {
      if (busy || !next) return;
      const url = URL.createObjectURL(new Blob([next], { type }));
      next = null;
      busy = true;
      img.onload = () => {
        busy = false;
        if (prev) URL.revokeObjectURL(prev);
        prev = url;
        fails = 0;
        w.classList.add('live');
        report(true, '', img.naturalWidth, img.naturalHeight);
        shown++;
        const t = performance.now();
        if (t - since >= 2000) { if (o.onfps) o.onfps(shown * 1000 / (t - since)); shown = 0; since = t; }
        show();
      };
      img.onerror = () => { busy = false; URL.revokeObjectURL(url); show(); };
      img.src = url;
    }

    // hidden page or widget removed: stop streaming
    const watch = setInterval(() => {
      if (seen && !w.isConnected) return stop();
      if (document.hidden && sock) { close(); later(1000); }
    }, 1000);
    later(0);
    return { el: w, keys: [], update() {}, stop };
  }

  global.Screens = { View, list };
})(window);
