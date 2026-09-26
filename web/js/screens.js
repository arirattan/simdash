/*
 * Live screens: pictures of exported cockpit displays (Apache MPDs / TADS FLIR, MFDs, MSFS pop-outs...)
 * streamed by the bridge (bridge/src_screens.py, set up with setup-screens.bat).
 *
 *   Screens.View(['TEDAC', 'CENTER_MFCD'], { quiet: true })  -> widget {el, keys, update}
 *     names  screen names to try, first one the bridge has wins
 *     quiet  stay invisible (so whatever is underneath shows) until pictures arrive
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
    let timer = null, prev = null, seen = false, stopped = false, fails = 0;

    const later = (ms) => { clearTimeout(timer); timer = setTimeout(tick, ms); };
    function stop() { stopped = true; clearTimeout(timer); if (prev) URL.revokeObjectURL(prev); prev = null; }
    function offline(text) { w.classList.remove('live'); msg.textContent = text; }

    async function tick() {
      if (stopped) return;
      if (!w.isConnected) { if (seen) return stop(); return later(300); }  // removed from the page: done
      seen = true;
      if (document.hidden) return later(1000);
      const i = await list();
      const name = names.find((n) => i.screens.some((s) => s.name === n));
      if (!name) {
        offline(i.error && !i.screens.length ? `LIVE SCREEN NOT SET UP\n${i.error}` : `LIVE SCREEN NOT SET UP\nno "${names[0]}" screen in bridge/data/screens.json`);
        return later(5000);
      }
      const t0 = performance.now();
      try {
        const r = await fetch(`${base()}/screen/${encodeURIComponent(name)}`, { cache: 'no-store' });
        if (!r.ok) throw new Error(await r.text());
        const url = URL.createObjectURL(await r.blob());
        await new Promise((ok, bad) => { img.onload = ok; img.onerror = () => bad(new Error('bad picture')); img.src = url; });
        if (prev) URL.revokeObjectURL(prev);
        prev = url;
        fails = 0;
        w.classList.add('live');
        later(Math.max(15, 1000 / (i.fps || 8) - (performance.now() - t0)));
      } catch (e) {
        offline('NO SIGNAL\n' + e.message);
        later(Math.min(5000, 400 * ++fails));
      }
    }
    later(0);
    return { el: w, keys: [], update() {}, stop };
  }

  global.Screens = { View, list };
})(window);
