/*
 * SimDash instruments.
 *
 * Classic six-pack instruments reuse the vector artwork from
 * jQuery Flight Indicators by Sébastien Matton (GPLv3)
 * https://github.com/sebmatton/jQuery-Flight-Indicators
 * re-implemented here without jQuery, with smoothing and extra overlays.
 *
 * Everything else (jet/heli/engine gauges) is drawn by the generic SVG Dial below.
 *
 * Every widget: { el, keys: [...], update(state) }
 */
(function (global) {
  'use strict';
  const IMG = 'img/';
  const NS = 'http://www.w3.org/2000/svg';

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);

  // Keep rotations continuous so CSS transitions never spin the long way round (359° -> 1°).
  function unwrapper() {
    let prev = null;
    return (a) => {
      if (prev === null) return (prev = a);
      let d = ((a - prev) % 360 + 540) % 360 - 180;
      return (prev = prev + d);
    };
  }

  function el(tag, attrs = {}, parent) {
    const e = document.createElement(tag);
    for (const k in attrs) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    if (parent) parent.appendChild(e);
    return e;
  }
  function svg(tag, attrs = {}, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  const layer = (parent, src, cls = '') => el('img', { src: IMG + src, class: 'box ' + cls, alt: '', draggable: 'false' }, parent);
  const holder = (parent, cls) => el('div', { class: 'box ' + cls }, parent);

  function shell(label) {
    const wrap = el('div', { class: 'gauge' });
    const inst = el('div', { class: 'instrument' }, wrap);
    if (label) el('div', { class: 'gauge-label', text: label }, wrap);
    return { wrap, inst };
  }

  // ------------------------------------------------------------------ //
  // Six-pack (artwork from jQuery Flight Indicators)
  // ------------------------------------------------------------------ //
  function Attitude(o = {}) {
    const { wrap, inst } = shell(o.label);
    layer(inst, 'fi_box.svg', 'bg');
    const roll = holder(inst, 'rot');
    layer(roll, 'horizon_back.svg');
    const pitch = holder(roll, 'pitch');
    layer(pitch, 'horizon_ball.svg');
    layer(roll, 'horizon_circle.svg');
    const mech = holder(inst, '');
    layer(mech, 'horizon_mechanics.svg');
    layer(mech, 'fi_circle.svg');
    return {
      el: wrap, keys: ['pitch', 'roll'],
      update(s) {
        // artwork: +roll rotates the ball clockwise; aircraft right bank => horizon tilts left
        roll.style.transform = `rotate(${-num(s.roll)}deg)`;
        pitch.style.top = clamp(num(s.pitch), -30, 30) * 0.7 + '%';
      }
    };
  }

  function Heading(o = {}) {
    const { wrap, inst } = shell(o.label);
    layer(inst, 'fi_box.svg', 'bg');
    const card = holder(inst, 'rot');
    layer(card, 'heading_yaw.svg');
    // heading bug overlay
    const bugSvg = svg('svg', { viewBox: '0 0 200 200', class: 'box rot overlay' });
    inst.appendChild(bugSvg);
    svg('path', { d: 'M92 16 L108 16 L108 26 L104 26 L100 21 L96 26 L92 26 Z', fill: '#ff9d00', stroke: '#000', 'stroke-width': '0.8' }, bugSvg);
    const crsSvg = svg('svg', { viewBox: '0 0 200 200', class: 'box rot overlay' });
    inst.appendChild(crsSvg);
    if (o.course) {
      svg('path', { d: 'M100 38 L95 50 L98.5 50 L98.5 150 L101.5 150 L101.5 50 L105 50 Z', fill: '#e040e0', opacity: '0.85' }, crsSvg);
    }
    const mech = holder(inst, '');
    layer(mech, 'heading_mechanics.svg');
    layer(mech, 'fi_circle.svg');
    const readout = el('div', { class: 'hdg-readout' }, inst);
    const uw = unwrapper(), ub = unwrapper(), uc = unwrapper();
    return {
      el: wrap, keys: ['heading', 'hdg_bug', 'crs'],
      update(s) {
        const h = num(s.heading);
        card.style.transform = `rotate(${uw(-h)}deg)`;
        if (s.hdg_bug !== undefined) bugSvg.style.transform = `rotate(${ub(num(s.hdg_bug) - h)}deg)`;
        else bugSvg.style.display = 'none';
        if (o.course && s.crs !== undefined) crsSvg.style.transform = `rotate(${uc(num(s.crs) - h)}deg)`;
        readout.textContent = String(Math.round(((h % 360) + 360) % 360) || 360).padStart(3, '0');
      }
    };
  }

  function Airspeed160(o = {}) {
    const { wrap, inst } = shell(o.label);
    layer(inst, 'fi_box.svg', 'bg');
    layer(inst, 'speed_mechanics.svg');
    const n = holder(inst, 'rot');
    layer(n, 'fi_needle.svg');
    layer(holder(inst, ''), 'fi_circle.svg');
    return {
      el: wrap, keys: ['ias'],
      update(s) { n.style.transform = `rotate(${90 + clamp(num(s.ias), 0, 160) * 2}deg)`; }
    };
  }

  function Altimeter(o = {}) {
    const { wrap, inst } = shell(o.label);
    layer(inst, 'fi_box.svg', 'bg');
    const press = holder(inst, 'rot');
    layer(press, 'altitude_pressure.svg');
    layer(inst, 'altitude_ticks.svg');
    const small = holder(inst, 'rot');
    layer(small, 'fi_needle_small.svg');
    const big = holder(inst, 'rot');
    layer(big, 'fi_needle.svg');
    layer(holder(inst, ''), 'fi_circle.svg');
    const readout = el('div', { class: 'alt-readout' }, inst);
    const ub = unwrapper();
    return {
      el: wrap, keys: ['alt', 'baro'],
      update(s) {
        const a = num(s.alt);
        big.style.transform = `rotate(${ub(90 + (a % 1000) * 0.36)}deg)`;
        small.style.transform = `rotate(${a / 10000 * 360}deg)`;
        press.style.transform = `rotate(${2 * num(s.baro, 1013.25) - 1980}deg)`;
        readout.textContent = Math.round(a).toLocaleString('en-US');
      }
    };
  }

  function Vario(o = {}) {
    const { wrap, inst } = shell(o.label);
    layer(inst, 'fi_box.svg', 'bg');
    layer(inst, 'vertical_mechanics.svg');
    const n = holder(inst, 'rot');
    layer(n, 'fi_needle.svg');
    layer(holder(inst, ''), 'fi_circle.svg');
    return {
      el: wrap, keys: ['vs'],
      update(s) { n.style.transform = `rotate(${clamp(num(s.vs) / 1000, -1.95, 1.95) * 90}deg)`; }
    };
  }

  function TurnCoordinator(o = {}) {
    const { wrap, inst } = shell(o.label);
    layer(inst, 'fi_box.svg', 'bg');
    layer(inst, 'turn_coordinator.svg');
    const plane = holder(inst, 'rot');
    layer(plane, 'fi_tc_airplane.svg');
    // slip ball overlay
    const ballSvg = svg('svg', { viewBox: '0 0 200 200', class: 'box overlay' });
    inst.appendChild(ballSvg);
    svg('rect', { x: 70, y: 138.5, width: 60, height: 15, rx: 7.5, fill: '#e8e2c4', stroke: '#222', 'stroke-width': 1.2 }, ballSvg);
    svg('line', { x1: 92.5, y1: 138.5, x2: 92.5, y2: 153.5, stroke: '#222', 'stroke-width': 1.3 }, ballSvg);
    svg('line', { x1: 107.5, y1: 138.5, x2: 107.5, y2: 153.5, stroke: '#222', 'stroke-width': 1.3 }, ballSvg);
    const ball = svg('circle', { cx: 100, cy: 146, r: 6.5, fill: '#111', stroke: '#ddd', 'stroke-width': 1.2, class: 'slide' }, ballSvg);
    layer(holder(inst, ''), 'fi_circle.svg');
    return {
      el: wrap, keys: ['turn', 'slip'],
      update(s) {
        plane.style.transform = `rotate(${clamp(num(s.turn), -30, 30)}deg)`;
        ball.setAttribute('cx', 100 + clamp(num(s.slip), -1, 1) * 22);
      }
    };
  }

  // ------------------------------------------------------------------ //
  // Generic SVG dial - jets, helicopters, engines
  // ------------------------------------------------------------------ //
  /*
   * opts:
   *  min, max, start=-135, end=135      angle in degrees, 0 = 12 o'clock, clockwise
   *  points: [[value, fraction]...]     optional non-linear scale
   *  major, minor                        tick steps
   *  labels: [values] | fn(v)->text      label values (default: every major)
   *  labelScale: 1                       label text = v * labelScale
   *  arcs: [{from, to, color}]
   *  needles: [{key, color, length, label}]   (default one needle on opts.key)
   *  title, unit
   *  digital: fn(state)->text | key
   *  wrap: true                          full-circle dial (e.g. 0..10 in 360°)
   *  minmax: true                        show min/max memory needles (G-meter)
   */
  function Dial(o) {
    o = Object.assign({ start: -135, end: 135, major: 10, minor: 0, labelScale: 1, arcs: [], title: '', unit: '' }, o);
    if (!o.needles) o.needles = [{ key: o.key, color: '#f2f2f2' }];
    const keys = o.needles.map((n) => n.key).concat(o.keys || []);
    if (typeof o.digital === 'string') keys.push(o.digital);

    const frac = (v) => {
      if (o.points) {
        const p = o.points;
        if (v <= p[0][0]) return p[0][1];
        for (let i = 1; i < p.length; i++) {
          if (v <= p[i][0]) return p[i - 1][1] + (p[i][1] - p[i - 1][1]) * (v - p[i - 1][0]) / (p[i][0] - p[i - 1][0]);
        }
        return p[p.length - 1][1];
      }
      return clamp((v - o.min) / (o.max - o.min), o.wrap ? -Infinity : 0, o.wrap ? Infinity : 1);
    };
    const ang = (v) => o.start + (o.end - o.start) * frac(v);
    const pol = (a, r) => [100 + r * Math.sin(a * Math.PI / 180), 100 - r * Math.cos(a * Math.PI / 180)];

    const { wrap, inst } = shell(o.label);
    const s = svg('svg', { viewBox: '0 0 200 200', class: 'box dial' });
    inst.appendChild(s);
    const gid = 'g' + Math.random().toString(36).slice(2, 8);
    const defs = svg('defs', {}, s);
    const lg = svg('radialGradient', { id: gid, cx: '50%', cy: '40%', r: '65%' }, defs);
    svg('stop', { offset: '0', 'stop-color': '#2a2a2a' }, lg);
    svg('stop', { offset: '1', 'stop-color': '#050505' }, lg);
    svg('rect', { x: 1, y: 1, width: 198, height: 198, rx: 14, fill: '#222', stroke: '#111', 'stroke-width': 2, class: 'dial-box' }, s);
    [[12, 12], [188, 12], [12, 188], [188, 188]].forEach(([x, y]) => {
      svg('circle', { cx: x, cy: y, r: 4.5, fill: '#3a3a3a', stroke: '#111' }, s);
      svg('line', { x1: x - 3, y1: y, x2: x + 3, y2: y, stroke: '#111', 'stroke-width': 1.2 }, s);
    });
    svg('circle', { cx: 100, cy: 100, r: 95, fill: '#555', stroke: '#1a1a1a', 'stroke-width': 3 }, s);
    svg('circle', { cx: 100, cy: 100, r: 90, fill: `url(#${gid})` }, s);

    const arcPath = (a0, a1, r) => {
      const [x0, y0] = pol(a0, r), [x1, y1] = pol(a1, r);
      const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
      return `M${x0} ${y0} A${r} ${r} 0 ${large} ${a1 > a0 ? 1 : 0} ${x1} ${y1}`;
    };
    o.arcs.forEach((a) => svg('path', { d: arcPath(ang(a.from), ang(a.to), a.r || 82), stroke: a.color, 'stroke-width': a.w || 7, fill: 'none' }, s));

    const ticks = (step, len, w) => {
      if (!step) return;
      for (let v = o.min; v <= o.max + 1e-9; v += step) {
        if (o.wrap && v >= o.max - 1e-9 && o.end - o.start >= 359) break;
        const a = ang(v), [x0, y0] = pol(a, 87), [x1, y1] = pol(a, 87 - len);
        svg('line', { x1: x0, y1: y0, x2: x1, y2: y1, stroke: '#f0f0f0', 'stroke-width': w, 'stroke-linecap': 'butt' }, s);
      }
    };
    ticks(o.minor, 6, 1.4);
    ticks(o.major, 13, 2.6);
    // non-linear dials: put a major tick at every label
    if (!o.major && Array.isArray(o.labels)) {
      o.labels.forEach((v) => {
        const a = ang(v), [x0, y0] = pol(a, 87), [x1, y1] = pol(a, 75);
        svg('line', { x1: x0, y1: y0, x2: x1, y2: y1, stroke: '#f0f0f0', 'stroke-width': 2.6 }, s);
      });
    }
    (o.ticksAt || []).forEach((v) => {
      const a = ang(v), [x0, y0] = pol(a, 87), [x1, y1] = pol(a, 81);
      svg('line', { x1: x0, y1: y0, x2: x1, y2: y1, stroke: '#f0f0f0', 'stroke-width': 1.4 }, s);
    });

    let labelVals = Array.isArray(o.labels) ? o.labels : [];
    if (!Array.isArray(o.labels) && o.labels !== false) {
      for (let v = o.min; v <= o.max + 1e-9; v += o.major) {
        if (o.wrap && v >= o.max - 1e-9 && o.end - o.start >= 359) break;
        labelVals.push(v);
      }
    }
    const fs = o.fontSize || 15;
    labelVals.forEach((v) => {
      const [x, y] = pol(ang(v), o.labelR || 63);
      const t = typeof o.labels === 'function' ? o.labels(v) : +(v * o.labelScale).toFixed(2);
      svg('text', { x, y: y + fs * 0.36, 'text-anchor': 'middle', 'font-size': fs, fill: '#f5f5f5', 'font-family': 'var(--gauge-font)', 'font-weight': 600 }, s).textContent = t;
    });
    if (o.title) svg('text', { x: 100, y: o.titleY || 124, 'text-anchor': 'middle', 'font-size': 12, fill: '#e8e8e8', 'font-family': 'var(--gauge-font)', 'letter-spacing': 1 }, s).textContent = o.title;
    if (o.unit) svg('text', { x: 100, y: (o.titleY || 124) + 13, 'text-anchor': 'middle', 'font-size': 9, fill: '#aaa', 'font-family': 'var(--gauge-font)' }, s).textContent = o.unit;
    (o.texts || []).forEach((t) => svg('text', { x: t.x, y: t.y, 'text-anchor': 'middle', 'font-size': t.size || 10, fill: t.color || '#ccc', 'font-family': 'var(--gauge-font)' }, s).textContent = t.text);

    let dig = null;
    if (o.digital) {
      const y = o.digitalY || 160;
      svg('rect', { x: 70, y: y - 13, width: 60, height: 18, rx: 3, fill: '#000', stroke: '#444' }, s);
      dig = svg('text', { x: 100, y: y + 1, 'text-anchor': 'middle', 'font-size': 13, fill: '#7cff7c', 'font-family': 'var(--digital-font)' }, s);
    }

    // Each needle is its own full-size <svg> layer rotated as an HTML box around its centre.
    // (CSS rotation of elements *inside* an SVG pivots unreliably across Safari/Chrome.)
    function pivot() {
      const layerSvg = svg('svg', { viewBox: '0 0 200 200', class: 'box rot overlay' });
      inst.appendChild(layerSvg);
      return svg('g', {}, layerSvg);
    }

    let mm = null;
    if (o.minmax) {
      mm = { lo: Infinity, hi: -Infinity };
      mm.gLo = pivot();
      mm.gHi = pivot();
      [mm.gLo, mm.gHi].forEach((g) => svg('path', { d: 'M98.6 100 L100 30 L101.4 100 Z', fill: '#ffae00', opacity: 0.8 }, g));
      wrap.addEventListener('dblclick', () => { mm.lo = Infinity; mm.hi = -Infinity; });
      wrap.title = 'Double-tap to reset min/max';
    }

    const needles = o.needles.map((n) => {
      const g = pivot();
      const L = n.length || 78;
      if (n.style === 'short') {
        svg('path', { d: `M96 104 L100 ${100 - L} L104 104 Z`, fill: n.color || '#fff', stroke: '#000', 'stroke-width': 0.6 }, g);
      } else {
        svg('path', { d: `M97 118 L98.3 100 L100 ${100 - L} L101.7 100 L103 118 Z`, fill: n.color || '#f2f2f2', stroke: '#000', 'stroke-width': 0.6 }, g);
      }
      if (n.label) svg('text', { x: 100, y: 100 - L * 0.55, 'text-anchor': 'middle', 'font-size': 9, 'font-weight': 700, fill: '#000', transform: `rotate(90 100 ${100 - L * 0.55})`, 'font-family': 'var(--gauge-font)' }, g).textContent = n.label;
      return { g, key: n.key, uw: o.wrap ? unwrapper() : (x) => x };
    });
    const hub = svg('svg', { viewBox: '0 0 200 200', class: 'box overlay' });
    inst.appendChild(hub);
    svg('circle', { cx: 100, cy: 100, r: 8, fill: '#1c1c1c', stroke: '#666', 'stroke-width': 1.5 }, hub);
    svg('circle', { cx: 100, cy: 100, r: 2.5, fill: '#888' }, hub);

    return {
      el: wrap, keys,
      update(st) {
        needles.forEach((n) => {
          const v = st[n.key];
          n.g.parentNode.style.opacity = v === undefined ? 0.25 : 1;
          n.g.parentNode.style.transform = `rotate(${n.uw(ang(num(v, o.min)))}deg)`;
        });
        if (mm) {
          const v = st[o.needles[0].key];
          if (typeof v === 'number') { mm.lo = Math.min(mm.lo, v); mm.hi = Math.max(mm.hi, v); }
          if (isFinite(mm.lo)) { mm.gLo.parentNode.style.transform = `rotate(${ang(mm.lo)}deg)`; mm.gHi.parentNode.style.transform = `rotate(${ang(mm.hi)}deg)`; }
        }
        if (dig) {
          const t = typeof o.digital === 'function' ? o.digital(st) : (st[o.digital] === undefined ? '---' : Math.round(st[o.digital]));
          dig.textContent = t;
        }
      }
    };
  }

  // ------------------------------------------------------------------ //
  // Small helpers: bar gauge, digital readout, annunciator lamp
  // ------------------------------------------------------------------ //
  function Bar(o) {
    const wrap = el('div', { class: 'bar-gauge' });
    el('div', { class: 'bar-title', text: o.title }, wrap);
    const track = el('div', { class: 'bar-track' }, wrap);
    (o.bands || []).forEach((b) => {
      el('div', { class: 'bar-band', style: `bottom:${(b.from - o.min) / (o.max - o.min) * 100}%;height:${(b.to - b.from) / (o.max - o.min) * 100}%;background:${b.color}` }, track);
    });
    const fill = el('div', { class: 'bar-fill' }, track);
    const val = el('div', { class: 'bar-value' }, wrap);
    return {
      el: wrap, keys: [o.key],
      update(s) {
        const v = s[o.key];
        fill.style.height = clamp((num(v, o.min) - o.min) / (o.max - o.min), 0, 1) * 100 + '%';
        val.textContent = v === undefined ? '--' : (+v).toFixed(o.dp || 0) + (o.unit ? ' ' + o.unit : '');
      }
    };
  }

  function Readout(o) {
    const wrap = el('div', { class: 'readout' + (o.big ? ' big' : '') });
    el('div', { class: 'readout-title', text: o.title }, wrap);
    const v = el('div', { class: 'readout-value' }, wrap);
    return {
      el: wrap, keys: o.keys || [o.key],
      update(s) {
        if (o.format) { v.textContent = o.format(s); return; }
        const x = s[o.key];
        v.textContent = x === undefined ? '---' : (+x).toFixed(o.dp || 0) + (o.unit ? o.unit : '');
      }
    };
  }

  function Lamp(o) {
    const wrap = el('div', { class: 'lamp ' + (o.color || 'amber') + (o.size ? ' ' + o.size : ''), text: o.text });
    return {
      el: wrap, keys: [o.key],
      update(s) {
        const v = s[o.key];
        const on = o.when ? o.when(v, s) : num(v) > 0.5;
        wrap.classList.toggle('on', !!on);
        if (o.blink) wrap.classList.toggle('blink', !!on);
      }
    };
  }

  // Three-green gear indicator
  function GearLights(o = {}) {
    const wrap = el('div', { class: 'gear-lights' });
    const mk = (key, txt) => {
      const d = el('div', { class: 'gear-light', text: txt }, wrap);
      return { key, d };
    };
    const ls = [mk('gear_l', 'L'), mk('gear_n', 'N'), mk('gear_r', 'R')];
    return {
      el: wrap, keys: ['gear', 'gear_l', 'gear_n', 'gear_r'],
      update(s) {
        ls.forEach(({ key, d }) => {
          const v = s[key] !== undefined ? s[key] : s.gear;
          d.className = 'gear-light ' + (v === undefined ? '' : v >= 0.99 ? 'green' : v <= 0.01 ? 'off' : 'red');
        });
      }
    };
  }

  // Carrier-style AOA indexer: slow (^), on-speed (O), fast (v)
  function AoaIndexer(o = {}) {
    const lo = o.onspeedLow || 7.4, hi = o.onspeedHigh || 8.8;
    const wrap = el('div', { class: 'aoa-indexer', html:
      '<svg viewBox="0 0 60 120"><path class="aoa-hi" d="M8 8 L30 38 L52 8" /><circle class="aoa-on" cx="30" cy="60" r="14"/><path class="aoa-lo" d="M8 112 L30 82 L52 112"/></svg><div class="aoa-val"></div>' });
    const hiEl = wrap.querySelector('.aoa-hi'), onEl = wrap.querySelector('.aoa-on'), loEl = wrap.querySelector('.aoa-lo'), val = wrap.querySelector('.aoa-val');
    return {
      el: wrap, keys: ['aoa'],
      update(s) {
        const a = s.aoa;
        const has = typeof a === 'number';
        hiEl.classList.toggle('lit', has && a > hi - 0.4);   // slow: nose-down chevron (green)
        onEl.classList.toggle('lit', has && a >= lo - 0.4 && a <= hi + 0.4);
        loEl.classList.toggle('lit', has && a < lo + 0.4);  // fast (red)
        val.textContent = has ? a.toFixed(1) + '°' : '--';
      }
    };
  }

  global.Gauges = { Attitude, Heading, Airspeed160, Altimeter, Vario, TurnCoordinator, Dial, Bar, Readout, Lamp, GearLights, AoaIndexer, el, svg, clamp, num };
})(window);
