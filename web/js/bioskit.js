/*
 * BiosKit - touch building blocks for DCS-BIOS cockpit panels (used by the Apache and F-14 pages).
 *   const K = BiosKit({ reg, has, val, cmd })
 *     reg(widget)       register a widget for live updates
 *     has(identifier)   false hides a control (e.g. not present in this seat / aircraft)
 *     val(identifier)   current DCS-BIOS value
 *     cmd(identifier, argument)   send a DCS-BIOS command
 *   K.push / K.guarded / K.seg / K.rocker / K.pot / K.lamp / K.text / K.group / K.guardedSwitch / K.dpad / K.watch
 */
(function (global) {
  'use strict';
  const { el } = global.Gauges;

  global.BiosKit = function (env) {
    const { reg, has, val, cmd } = env;

    function watch(node, idents, fn) {
      reg({ el: node, keys: idents.map((i) => 'bios:' + i), update: fn });
      return node;
    }

    // ------------------------------------------------------------------ building blocks
    // momentary button; lamp: identifier (or list) that lights it
    function push(ident, label, opts = {}) {
      if (!has(ident)) return el('span', { class: 'ah-gap' });
      const b = el('button', { class: 'ah-btn ' + (opts.cls || ''), type: 'button' });
      if (opts.lamp !== false) el('span', { class: 'ah-led ' + (opts.color || '') }, b);
      el('span', { class: 'ah-btn-t', text: label }, b);
      let down = false;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        try { b.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        down = true;
        b.classList.add('pressed');
        cmd(ident, opts.press !== undefined ? opts.press : 1);
      });
      const up = () => {
        if (!down) return;
        down = false;
        b.classList.remove('pressed');
        cmd(ident, opts.release !== undefined ? opts.release : 0);
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      const lamps = [].concat(opts.lamp || []).filter(Boolean);
      if (lamps.length) watch(b, lamps, () => b.classList.toggle('lit', lamps.some((l) => val(l) > 0)));
      return b;
    }

    // guarded button: first tap opens the cover (sim), second tap presses
    function guarded(btnIdent, coverIdent, label, opts = {}) {
      if (!has(btnIdent)) return el('span', { class: 'ah-gap' });
      const w = el('div', { class: 'ah-guarded' });
      const b = push(btnIdent, label, opts);
      w.appendChild(b);
      if (has(coverIdent)) {
        const cover = el('div', { class: 'ah-cover', html: label + '<small>lift cover</small>' }, w);
        cover.addEventListener('pointerdown', (e) => { e.preventDefault(); cmd(coverIdent, 1); });
        const close = el('button', { class: 'ah-cover-close', type: 'button', text: '✕ close cover' }, w);
        close.addEventListener('pointerdown', (e) => { e.preventDefault(); cmd(coverIdent, 0); });
        watch(w, [coverIdent], () => w.classList.toggle('open', val(coverIdent) > 0));
      } else {
        w.classList.add('open');
      }
      return w;
    }

    // multi-position switch shown as segments (positions in DCS-BIOS order 0..n)
    function seg(ident, positions, label) {
      if (!has(ident)) return el('span', { class: 'ah-gap' });
      const w = el('div', { class: 'ah-seg' + (positions.length >= 3 ? ' wide' : '') });
      if (label) el('div', { class: 'ah-lbl', text: label }, w);
      const row = el('div', { class: 'ah-seg-row' }, w);
      const btns = positions.map((p, i) => {
        const b = el('button', { class: 'ah-pos', type: 'button', text: p }, row);
        b.addEventListener('pointerdown', (e) => { e.preventDefault(); cmd(ident, i); });
        return b;
      });
      watch(w, [ident], () => btns.forEach((b, i) => b.classList.toggle('on', val(ident) === i)));
      return w;
    }

    // spring-loaded rocker: hold up (2) / hold down (0), releases to centre (1)
    function rocker(ident, label, up = '▲', down = '▼') {
      if (!has(ident)) return el('span', { class: 'ah-gap' });
      const w = el('div', { class: 'ah-rocker' });
      const mk = (text, v) => {
        const b = el('button', { class: 'ah-btn small', type: 'button', text }, w);
        b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.classList.add('pressed'); cmd(ident, v); });
        const rel = () => { if (!b.classList.contains('pressed')) return; b.classList.remove('pressed'); cmd(ident, 1); };
        b.addEventListener('pointerup', rel);
        b.addEventListener('pointercancel', rel);
        b.addEventListener('pointerleave', rel);
      };
      mk(up, 2);
      el('div', { class: 'ah-lbl', text: label }, w);
      mk(down, 0);
      return w;
    }

    // potentiometer: −/+ steps
    function pot(ident, label) {
      if (!has(ident)) return el('span', { class: 'ah-gap' });
      const w = el('div', { class: 'ah-pot wide' });
      el('div', { class: 'ah-lbl', text: label }, w);
      const row = el('div', { class: 'ah-seg-row' }, w);
      const m = el('button', { class: 'ah-pos', type: 'button', text: '−' }, row);
      const v = el('span', { class: 'ah-pot-v' }, row);
      const p = el('button', { class: 'ah-pos', type: 'button', text: '+' }, row);
      m.addEventListener('pointerdown', (e) => { e.preventDefault(); cmd(ident, '-6553'); });
      p.addEventListener('pointerdown', (e) => { e.preventDefault(); cmd(ident, '+6553'); });
      watch(w, [ident], () => { const x = val(ident); v.textContent = x === undefined ? '--' : Math.round(x / 655.35) + '%'; });
      return w;
    }

    function lamp(ident, label, color = 'green') {
      if (!has(ident)) return el('span', { class: 'ah-gap' });
      const l = el('div', { class: 'lamp ah-lamp ' + color, text: label });
      return watch(l, [ident], () => l.classList.toggle('on', val(ident) > 0));
    }

    function text(ident, cls) {
      const d = el('div', { class: cls });
      if (!has(ident)) return d;
      return watch(d, [ident], () => { const x = val(ident); d.textContent = x === undefined || x === '' ? ' ' : x; });
    }

    function group(title, children, cls = '') {
      const g = el('div', { class: 'ah-group ' + cls });
      if (title) el('div', { class: 'ah-group-t', text: title }, g);
      const body = el('div', { class: 'ah-group-b' }, g);
      children.forEach((c) => c && body.appendChild(c));
      return g;
    }


    // covered 2-position switch (flare jettison)
    function guardedSwitch(ident, coverIdent, label) {
      if (!has(ident)) return el('span', { class: 'ah-gap' });
      const w = el('div', { class: 'ah-guarded' });
      w.appendChild(seg(ident, ['OFF', 'JETT'], label));
      if (has(coverIdent)) {
        const cover = el('div', { class: 'ah-cover', html: label + '<small>lift cover</small>' }, w);
        cover.addEventListener('pointerdown', (e) => { e.preventDefault(); cmd(coverIdent, 1); });
        const close = el('button', { class: 'ah-cover-close', type: 'button', text: '✕ close cover' }, w);
        close.addEventListener('pointerdown', (e) => { e.preventDefault(); cmd(coverIdent, 0); });
        watch(w, [coverIdent], () => w.classList.toggle('open', val(coverIdent) > 0));
      }
      return w;
    }


    // 4-way hat (cursor / tracker): hold ▲▼ -> udIdent 2 / 0, ◀▶ -> lrIdent 0 / 2, release -> 1; centre = push button
    function dpad(udIdent, lrIdent, label, centerIdent) {
      if (!has(udIdent) && !has(lrIdent)) return el('span', { class: 'ah-gap' });
      const w = el('div', { class: 'ah-dpad' });
      if (label) el('div', { class: 'ah-lbl', text: label }, w);
      const g = el('div', { class: 'ah-dpad-g' }, w);
      const blank = () => el('span', {}, g);
      const hold = (txt, ident, v) => {
        const b = el('button', { class: 'ah-btn small', type: 'button', text: txt }, g);
        b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.classList.add('pressed'); cmd(ident, v); });
        const rel = () => { if (!b.classList.contains('pressed')) return; b.classList.remove('pressed'); cmd(ident, 1); };
        ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => b.addEventListener(ev, rel));
      };
      blank(); hold('▲', udIdent, 2); blank();
      hold('◀', lrIdent, 0);
      if (centerIdent && has(centerIdent)) g.appendChild(push(centerIdent, 'ENT', { lamp: false, cls: 'small' })); else blank();
      hold('▶', lrIdent, 2);
      blank(); hold('▼', udIdent, 0); blank();
      return w;
    }

    return { watch, push, guarded, seg, rocker, pot, lamp, text, group, guardedSwitch, dpad };
  };
})(window);
