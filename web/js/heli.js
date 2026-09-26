/*
 * Helicopter hover & rescue (MSFS + DCS)
 *   HOVER   top-down drift display: velocity vector from body-axis speeds (VELOCITY BODY X/Z),
 *           range rings, wind arrow relative to the nose, target marker; big radalt / VS / torque / NR / TOT
 *   RESCUE  bearing arrow + distance + ETE to the Direct-To target (shared with the moving map),
 *           mark current position, wind components on the nose, expanding-square search helper, holds & lights
 * The HOVER page is also added to the Civil / Military helicopter dashboards.
 */
(function (global) {
  'use strict';
  const G = global.Gauges, C = global.Controls, Link = global.Link;
  const { el, svg, clamp } = G;
  const FPS2KT = 0.592484;
  const R = Math.PI / 180;
  const num = (v) => typeof v === 'number' && isFinite(v);
  const pad3 = (v) => String(Math.round(((v % 360) + 360) % 360)).padStart(3, '0');
  const target = () => { try { return JSON.parse(localStorage.getItem('simdash.target') || 'null'); } catch (e) { return null; } };
  function distNm(a, b) {
    const dp = (b[0] - a[0]) * R, dl = (b[1] - a[1]) * R;
    const h = Math.sin(dp / 2) ** 2 + Math.cos(a[0] * R) * Math.cos(b[0] * R) * Math.sin(dl / 2) ** 2;
    return 3440.065 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function brgT(a, b) {
    const y = Math.sin((b[1] - a[1]) * R) * Math.cos(b[0] * R);
    const x = Math.cos(a[0] * R) * Math.sin(b[0] * R) - Math.sin(a[0] * R) * Math.cos(b[0] * R) * Math.cos((b[1] - a[1]) * R);
    return (Math.atan2(y, x) / R + 360) % 360;
  }

  // ------------------------------------------------------------------ hover display
  function HoverDisplay() {
    const wrap = el('div', { class: 'hv' });
    const s = svg('svg', { viewBox: '0 0 400 400', class: 'hv-svg' });
    wrap.appendChild(s);
    svg('rect', { x: 0, y: 0, width: 400, height: 400, rx: 18, fill: '#050807' }, s);
    const ringG = svg('g', {}, s);
    // crosshair
    svg('line', { x1: 200, y1: 20, x2: 200, y2: 380, stroke: '#1f3a2c', 'stroke-width': 1 }, s);
    svg('line', { x1: 20, y1: 200, x2: 380, y2: 200, stroke: '#1f3a2c', 'stroke-width': 1 }, s);
    const wind = svg('g', {}, s);
    svg('path', { d: 'M200 22 L210 44 L203 44 L203 70 L197 70 L197 44 L190 44 Z', fill: '#4cc9f0' }, wind);
    const windTxt = svg('text', { x: 214, y: 50, 'font-size': 14, fill: '#4cc9f0', 'font-family': 'var(--digital-font)' }, wind);
    const tgt = svg('g', {}, s);
    svg('path', { d: 'M200 14 L211 32 L189 32 Z', fill: '#ff4dff' }, tgt);
    const tgtTxt = svg('text', { x: 200, y: 48, 'text-anchor': 'middle', 'font-size': 13, fill: '#ff4dff', 'font-family': 'var(--digital-font)' }, tgt);
    // velocity vector
    const vec = svg('line', { x1: 200, y1: 200, x2: 200, y2: 200, stroke: '#3dff6e', 'stroke-width': 6, 'stroke-linecap': 'round' }, s);
    const head = svg('circle', { cx: 200, cy: 200, r: 10, fill: '#3dff6e' }, s);
    // own ship (top-down helicopter)
    const ship = svg('g', {}, s);
    svg('ellipse', { cx: 200, cy: 196, rx: 9, ry: 16, fill: '#ffd400', stroke: '#000', 'stroke-width': 1.5 }, ship);
    svg('rect', { x: 198, y: 208, width: 4, height: 26, fill: '#ffd400', stroke: '#000', 'stroke-width': 1 }, ship);
    svg('rect', { x: 192, y: 230, width: 16, height: 4, fill: '#ffd400', stroke: '#000', 'stroke-width': 1 }, ship);
    svg('circle', { cx: 200, cy: 196, r: 34, fill: 'none', stroke: '#ffd40066', 'stroke-width': 2, 'stroke-dasharray': '6 5' }, ship);
    const hdg = svg('text', { x: 200, y: 392, 'text-anchor': 'middle', 'font-size': 15, fill: '#e9ecef', 'font-family': 'var(--digital-font)' }, s);
    const drift = el('div', { class: 'hv-drift' }, wrap);
    const scaleBtn = el('button', { class: 'hv-scale', type: 'button' }, wrap);
    let scale = 0;               // 0 = auto
    const SCALES = [10, 20, 40];
    scaleBtn.addEventListener('click', () => { scale = (scale + 1) % (SCALES.length + 1); });
    let lastMax = 10;
    function rings(max) {
      if (max === lastMax && ringG.childNodes.length) return;
      lastMax = max;
      ringG.innerHTML = '';
      [0.25, 0.5, 0.75, 1].forEach((f) => {
        svg('circle', { cx: 200, cy: 200, r: 170 * f, fill: 'none', stroke: f === 1 ? '#2e5a45' : '#1f3a2c', 'stroke-width': f === 1 ? 2 : 1.2 }, ringG);
        svg('text', { x: 200 + 170 * f * 0.707 + 4, y: 200 - 170 * f * 0.707 - 4, 'font-size': 12, fill: '#5f9c7d', 'font-family': 'var(--digital-font)' }, ringG).textContent = +(max * f).toFixed(1) + ' kt';
      });
    }
    return {
      el: wrap, keys: ['vel_x', 'vel_z', 'heading', 'hdg_true', 'wind_dir', 'wind_kt', 'lat', 'lon', 'gs'],
      update(st) {
        const right = num(st.vel_x) ? st.vel_x * FPS2KT : 0, fwd = num(st.vel_z) ? st.vel_z * FPS2KT : 0;
        const spd = Math.hypot(right, fwd);
        const max = scale ? SCALES[scale - 1] : spd > 18 ? 40 : spd > 8 ? 20 : 10;
        scaleBtn.textContent = 'SCALE ' + max + ' kt' + (scale ? '' : ' (auto)');
        rings(max);
        const len = Math.min(spd / max, 1) * 170;
        const ang = Math.atan2(right, fwd);
        const x = 200 + len * Math.sin(ang), y = 200 - len * Math.cos(ang);
        vec.setAttribute('x2', x); vec.setAttribute('y2', y);
        head.setAttribute('cx', x); head.setAttribute('cy', y);
        const col = spd < 1 ? '#3dff6e' : spd < 5 ? '#ffd400' : '#ff8a3d';
        vec.setAttribute('stroke', col); head.setAttribute('fill', col);
        head.setAttribute('r', spd / max > 1 ? 13 : 10);
        drift.innerHTML = `<b>${fwd >= 0 ? 'FWD' : 'AFT'} ${Math.abs(fwd).toFixed(1)}</b> kt &nbsp; <b>${right >= 0 ? 'RIGHT' : 'LEFT'} ${Math.abs(right).toFixed(1)}</b> kt`;
        const h = num(st.heading) ? st.heading : 0;
        hdg.textContent = 'HDG ' + pad3(h) + '°';
        // wind: arrow shows where the wind blows TO, relative to the nose
        if (num(st.wind_dir) && num(st.wind_kt) && st.wind_kt > 0.5) {
          wind.style.display = '';
          wind.setAttribute('transform', `rotate(${st.wind_dir + 180 - h} 200 200)`);
          windTxt.textContent = Math.round(st.wind_kt) + ' kt';
        } else wind.style.display = 'none';
        // target marker on the outer ring
        const t = target();
        if (t && num(st.lat)) {
          tgt.style.display = '';
          const trueHdg = num(st.hdg_true) ? st.hdg_true : h;
          const rel = brgT([st.lat, st.lon], [t.lat, t.lon]) - trueHdg;
          tgt.setAttribute('transform', `rotate(${rel} 200 200)`);
          tgtTxt.textContent = distNm([st.lat, st.lon], [t.lat, t.lon]).toFixed(1);
        } else tgt.style.display = 'none';
      }
    };
  }

  // vertical speed bar (±1000 fpm)
  function VsBar() {
    const w = el('div', { class: 'hv-vs' });
    el('div', { class: 'lever-t', text: 'VS' }, w);
    const t = el('div', { class: 'hv-vs-track' }, w);
    el('div', { class: 'hv-vs-zero' }, t);
    const f = el('div', { class: 'hv-vs-fill' }, t);
    const v = el('div', { class: 'hv-vs-v' }, w);
    return {
      el: w, keys: ['vs'],
      update(s) {
        const x = num(s.vs) ? s.vs : 0, p = clamp(x / 1000, -1, 1) * 50;
        f.style.height = Math.abs(p) + '%';
        f.style.bottom = p >= 0 ? '50%' : (50 + p) + '%';
        f.classList.toggle('down', x < 0);
        v.textContent = (x > 0 ? '+' : '') + Math.round(x / 10) * 10;
      }
    };
  }

  // big radar altitude
  function RadAlt() {
    const w = el('div', { class: 'hv-ralt' });
    el('div', { class: 'lever-t', text: 'RAD ALT' }, w);
    const v = el('div', { class: 'hv-ralt-v' }, w);
    el('div', { class: 'hv-ralt-u', text: 'FT AGL' }, w);
    return {
      el: w, keys: ['radalt'],
      update(s) {
        const x = s.radalt;
        v.textContent = num(x) ? (x > 2500 ? '----' : Math.round(x)) : '---';
        w.classList.toggle('low', num(x) && x < 50);
      }
    };
  }

  // ------------------------------------------------------------------ rescue: bearing to target
  function TargetNav() {
    const w = el('div', { class: 'rs-nav' });
    const name = el('div', { class: 'rs-name' }, w);
    const s = svg('svg', { viewBox: '0 0 200 200', class: 'rs-svg' });
    w.appendChild(s);
    svg('circle', { cx: 100, cy: 100, r: 92, fill: '#070a0c', stroke: '#2a2e33', 'stroke-width': 3 }, s);
    svg('path', { d: 'M100 12 L94 24 L106 24 Z', fill: '#ffd400' }, s);
    const arrow = svg('g', {}, s);
    svg('path', { d: 'M100 26 L122 70 L108 70 L108 170 L92 170 L92 70 L78 70 Z', fill: '#ff4dff', stroke: '#000', 'stroke-width': 1 }, arrow);
    const info = el('div', { class: 'rs-info' }, w);
    const row = (l) => { const d = el('div', {}, info); el('span', { text: l }, d); return el('b', { text: '---' }, d); };
    const dist = row('DIST'), brg = row('BRG'), ete = row('ETE'), turn = row('TURN');
    return {
      el: w, keys: ['lat', 'lon', 'heading', 'hdg_true', 'gs'],
      update(st) {
        const t = target();
        if (!t) { name.textContent = 'No target - set Direct-To on the map, or MARK below'; arrow.style.display = 'none'; [dist, brg, ete, turn].forEach((b) => { b.textContent = '---'; }); return; }
        name.textContent = 'TARGET  ' + (t.name || '');
        if (!num(st.lat)) return;
        arrow.style.display = '';
        const b = brgT([st.lat, st.lon], [t.lat, t.lon]);
        const trueHdg = num(st.hdg_true) ? st.hdg_true : st.heading || 0;
        const rel = ((b - trueHdg + 540) % 360) - 180;
        arrow.setAttribute('transform', `rotate(${rel} 100 100)`);
        const d = distNm([st.lat, st.lon], [t.lat, t.lon]);
        dist.textContent = d < 1 ? Math.round(d * 6076) + ' ft' : d.toFixed(1) + ' nm';
        brg.textContent = pad3(b) + '°T';
        const m = num(st.gs) && st.gs > 5 ? Math.round(d / st.gs * 60) : null;
        ete.textContent = m === null ? '--:--' : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
        turn.textContent = Math.abs(rel) < 3 ? 'ON COURSE' : (rel > 0 ? 'RIGHT ' : 'LEFT ') + Math.round(Math.abs(rel)) + '°';
      }
    };
  }

  function WindCard() {
    const w = el('div', { class: 'rs-wind' });
    el('div', { class: 'lever-t', text: 'WIND ON THE NOSE' }, w);
    const a = el('div', { class: 'rs-wind-v' }, w);
    const b = el('div', { class: 'rs-wind-s' }, w);
    return {
      el: w, keys: ['wind_dir', 'wind_kt', 'heading'],
      update(s) {
        if (!num(s.wind_dir) || !num(s.wind_kt)) { a.textContent = '---'; return; }
        const rel = ((s.wind_dir - (s.heading || 0)) + 540) % 360 - 180;
        const head = s.wind_kt * Math.cos(rel * R), cross = s.wind_kt * Math.sin(rel * R);
        a.textContent = `${pad3(s.wind_dir)}° / ${Math.round(s.wind_kt)} kt`;
        b.textContent = `${head >= 0 ? 'HEAD' : 'TAIL'} ${Math.abs(head).toFixed(0)} kt · CROSS ${Math.abs(cross).toFixed(0)} kt ${cross >= 0 ? 'R' : 'L'}` +
          (Math.abs(rel) > 30 ? `  → turn ${rel > 0 ? 'right' : 'left'} ${Math.round(Math.abs(rel))}° to face it` : '  (into wind)');
      }
    };
  }

  // expanding square search: legs 1,1,2,2,3,3... x base length, right turns of 90°
  function SearchPattern() {
    const KEY = 'simdash.search';
    const w = el('div', { class: 'rs-search' });
    el('div', { class: 'lever-t', text: 'EXPANDING SQUARE SEARCH' }, w);
    const info = el('div', { class: 'rs-search-i' }, w);
    const row = el('div', { class: 'radio-row' }, w);
    const get = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } };
    const put = (v) => { try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch (e) { /* ignore */ } };
    const mk = (t, fn, cls = '') => { const b = el('button', { class: 'btn ' + cls, type: 'button', text: t }, row); b.addEventListener('click', fn); };
    mk('START HERE', () => put({ hdg: Link.state.heading || 0, leg: 1, base: 0.5, t0: Date.now() }), 'red');
    mk('NEXT LEG', () => { const x = get(); if (x) { x.leg++; x.t0 = Date.now(); put(x); } });
    mk('0.25 / 0.5 / 1 nm', () => { const x = get(); if (x) { x.base = x.base === 0.25 ? 0.5 : x.base === 0.5 ? 1 : 0.25; put(x); } });
    mk('STOP', () => put(null));
    return {
      el: w, keys: ['gs'],
      update(s) {
        const x = get();
        if (!x) { info.textContent = 'Start over the last known position. Each leg turns 90° right; legs grow 1, 1, 2, 2, 3, 3 × the base length.'; return; }
        const mult = Math.ceil(x.leg / 2), legNm = mult * x.base, hdg = (x.hdg + 90 * (x.leg - 1)) % 360;
        const legSec = num(s.gs) && s.gs > 10 ? legNm / s.gs * 3600 : null, el2 = (Date.now() - x.t0) / 1000;
        info.innerHTML = `LEG <b>${x.leg}</b> · HEADING <b>${pad3(hdg)}°</b> · <b>${legNm} nm</b>` +
          (legSec ? ` · <b>${Math.max(0, Math.round(legSec - el2))} s</b> left at current GS` : '') +
          `<br><small>next: ${pad3((hdg + 90) % 360)}° for ${Math.ceil((x.leg + 1) / 2) * x.base} nm</small>`;
        w.classList.toggle('due', legSec !== null && el2 >= legSec);
      }
    };
  }

  // ------------------------------------------------------------------ pages
  const W = (fn, o) => () => fn(o);
  function Group(title, children, cls = '') {
    return () => {
      const wrap = el('div', { class: 'group ' + cls });
      if (title) el('div', { class: 'group-title', text: title }, wrap);
      const body = el('div', { class: 'group-body' }, wrap);
      const ws = children.map((f) => (typeof f === 'function' ? f() : f));
      ws.forEach((x) => body.appendChild(x.el));
      return { el: wrap, keys: [], children: ws, update() {} };
    };
  }
  const readout = (title, key, unit, dp = 0) => W(G.Readout, { title, key, unit, dp, big: true });
  const btn = (text, input, key, cls = '') => W(C.Button, { text, input, key, cls });
  const markBtn = () => {
    const b = el('button', { class: 'btn red', type: 'button' });
    el('span', { class: 'btn-led' }, b);
    el('span', { class: 'btn-text', text: 'MARK POSITION' }, b);
    b.addEventListener('click', () => {
      const s = Link.state;
      if (!num(s.lat)) return;
      try { localStorage.setItem('simdash.target', JSON.stringify({ lat: s.lat, lon: s.lon, name: 'MARK ' + new Date().toTimeString().slice(0, 5) })); } catch (e) { /* ignore */ }
    });
    return { el: b, keys: [], update() {} };
  };
  const clearBtn = () => {
    const b = el('button', { class: 'btn', type: 'button' });
    el('span', { class: 'btn-led' }, b);
    el('span', { class: 'btn-text', text: 'CLEAR TARGET' }, b);
    b.addEventListener('click', () => { try { localStorage.removeItem('simdash.target'); } catch (e) { /* ignore */ } });
    return { el: b, keys: [], update() {} };
  };
  const mapBtn = () => {
    const b = el('button', { class: 'btn', type: 'button' });
    el('span', { class: 'btn-led' }, b);
    el('span', { class: 'btn-text', text: 'OPEN MAP' }, b);
    b.addEventListener('click', () => { location.hash = '#map'; });
    return { el: b, keys: [], update() {} };
  };

  const hoverSide = Group('', [
    W(RadAlt, {}), W(VsBar, {}),
    readout('GS', 'gs', ' kt'), readout('TORQUE', 'torque', ' %'), readout('NR', 'nr', ' %'), readout('TOT / ITT', 'itt', '°'),
  ], 'hv-side');
  const HOVER_PAGE = { title: 'HOVER', cols: 3, rows: 1, cells: [[W(HoverDisplay, {}), 2, 1], [hoverSide]] };

  global.DASHBOARDS.heli = {
    name: 'Heli hover & rescue', icon: '🚑', sub: 'drift / hover vector, radalt · rescue: target bearing, mark, wind, search pattern',
    pages: [
      HOVER_PAGE,
      { title: 'RESCUE', cols: 3, rowsTpl: '1fr 150px', cells: [
        [Group('', [W(TargetNav, {})], 'col'), 1, 1],
        [Group('', [W(WindCard, {}), W(SearchPattern, {})], 'col'), 2, 1],
        [Group('', [
          markBtn, clearBtn, mapBtn,
          btn('ATT HOLD', 'AP_ATT', 'ap_att'), btn('ALT HOLD', 'AP_ALT', 'ap_alt'), btn('HDG HOLD', 'AP_HDG', 'ap_hdg'),
          btn('LDG LIGHT', 'LIGHT_LANDING', 'light_landing'), btn('BEACON', 'LIGHT_BEACON', 'light_beacon'),
        ], 'row wrap rs-buttons'), 99, 1],
      ] },
    ]
  };

  // add the HOVER page to the other helicopter dashboards
  ['civil-heli', 'mil-heli'].forEach((id) => {
    const d = global.DASHBOARDS[id];
    if (d && d.pages && !d.pages.some((p) => p.title === 'HOVER')) d.pages.splice(1, 0, HOVER_PAGE);
  });
})(window);
