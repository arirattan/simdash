/*
 * SimDash touch controls.
 *
 * Every control sends SimHub "inputs" by name through the bridge:
 *   press   -> trigger-input-pressed <NAME>
 *   release -> trigger-input-released <NAME>
 * In SimHub (Controls and events / Control mapper) you bind each input name to
 * a keystroke or vJoy button that DCS / MSFS is bound to.
 *
 * Lamps/positions come from the sim state when a `key` is given, otherwise the
 * control keeps a local (optimistic) state.
 */
(function (global) {
  'use strict';
  const { el, num, clamp } = global.Gauges;
  const send = (name, a) => global.Link.input(name, a);

  // momentary press+release on one input, with visual feedback
  function tapInput(name, holdMs = 90) {
    send(name, 'press');
    setTimeout(() => send(name, 'release'), holdMs);
  }

  function pressable(node, name, onTap) {
    let down = false;
    node.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      node.setPointerCapture && node.setPointerCapture(e.pointerId);
      down = true;
      node.classList.add('pressed');
      if (name) send(name, 'press');
    });
    const up = () => {
      if (!down) return;
      down = false;
      node.classList.remove('pressed');
      if (name) send(name, 'release');
      onTap && onTap();
    };
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', up);
    node.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ------------------------------------------------------------------ //
  // Push button with optional annunciator lamp (autopilot keys, etc.)
  // ------------------------------------------------------------------ //
  function Button(o) {
    const b = el('button', { class: 'btn ' + (o.cls || ''), type: 'button' });
    el('span', { class: 'btn-led' }, b);
    el('span', { class: 'btn-text', text: o.text }, b);
    if (o.sub) el('span', { class: 'btn-sub', text: o.sub }, b);
    let local = false;
    pressable(b, o.input, () => { if (!o.key) { local = !local; if (o.latch) b.classList.toggle('lit', local); } });
    return {
      el: b, keys: o.key ? [o.key] : [],
      update(s) { if (o.key) b.classList.toggle('lit', num(s[o.key]) > 0.5); }
    };
  }

  // ------------------------------------------------------------------ //
  // Toggle switch (bat, lights...). Single toggle input, or separate on/off inputs.
  // ------------------------------------------------------------------ //
  function Toggle(o) {
    const w = el('div', { class: 'toggle' + (o.red ? ' red' : '') });
    el('div', { class: 'toggle-label top', text: o.onText || 'ON' }, w);
    const sw = el('div', { class: 'toggle-body' }, w);
    el('div', { class: 'toggle-bat' }, sw);
    el('div', { class: 'toggle-label bottom', text: o.offText || 'OFF' }, w);
    el('div', { class: 'toggle-name', text: o.text }, w);
    let state = false;
    const render = () => w.classList.toggle('on', state);
    sw.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const next = !state;
      if (o.onInput && o.offInput) tapInput(next ? o.onInput : o.offInput);
      else tapInput(o.input);
      if (!o.key || !global.Link.has(o.key)) { state = next; render(); }
    });
    return {
      el: w, keys: o.key ? [o.key] : [],
      update(s) { if (o.key && s[o.key] !== undefined) { state = num(s[o.key]) > 0.5; render(); } }
    };
  }

  // ------------------------------------------------------------------ //
  // Guarded switch (master arm, jettison): 1st tap opens the guard, 2nd flips.
  // Guard closes itself after 4 s.
  // ------------------------------------------------------------------ //
  function Guarded(o) {
    const w = el('div', { class: 'guarded' });
    const t = Toggle(Object.assign({}, o, { red: true }));
    w.appendChild(t.el);
    const guard = el('div', { class: 'guard' }, w);
    el('div', { class: 'guard-stripes' }, guard);
    let timer;
    guard.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      w.classList.add('open');
      clearTimeout(timer);
      timer = setTimeout(() => w.classList.remove('open'), 4000);
    });
    return { el: w, keys: t.keys, update: t.update };
  }

  // ------------------------------------------------------------------ //
  // Rotary knob: drag in a circle (or up/down) -> INC/DEC detents; tap = PUSH
  // Outer ring (big steps) optional via o.coarse {inc, dec}
  // ------------------------------------------------------------------ //
  function Knob(o) {
    const w = el('div', { class: 'knob-wrap' });
    el('div', { class: 'knob-title', text: o.text }, w);
    const readout = el('div', { class: 'knob-readout' }, w);
    const k = el('div', { class: 'knob' }, w);
    const cap = el('div', { class: 'knob-cap' }, k);
    el('div', { class: 'knob-mark' }, cap);
    const btns = el('div', { class: 'knob-steps' }, w);
    const minus = el('button', { class: 'step', type: 'button', text: '−' }, btns);
    const plus = el('button', { class: 'step', type: 'button', text: '+' }, btns);
    let rot = 0, active = null, moved = 0;
    const detent = o.detent || 18; // degrees of finger travel per click
    const center = () => { const r = k.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
    const angleOf = (e) => { const [cx, cy] = center(); return Math.atan2(e.clientX - cx, cy - e.clientY) * 180 / Math.PI; };
    const click = (dir) => {
      rot += dir * detent;
      cap.style.transform = `rotate(${rot}deg)`;
      tapInput(dir > 0 ? o.inc : o.dec, 40);
    };
    k.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { k.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or ended pointer */ }
      active = { a: angleOf(e), y: e.clientY, acc: 0 };
      moved = 0;
      k.classList.add('grab');
    });
    k.addEventListener('pointermove', (e) => {
      if (!active) return;
      const a = angleOf(e);
      let d = a - active.a;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      // vertical drag also works (easier near the knob centre)
      const dy = (active.y - e.clientY) * 1.2;
      active.y = e.clientY;
      active.a = a;
      const [cx, cy] = center();
      const r = Math.hypot(e.clientX - cx, e.clientY - cy);
      active.acc += r > 18 ? d : dy;
      while (Math.abs(active.acc) >= detent) {
        const dir = Math.sign(active.acc);
        active.acc -= dir * detent;
        moved++;
        if (global.Feedback) global.Feedback.play('detent');
        click(dir);
      }
    });
    const end = () => {
      if (!active) return;
      active = null;
      k.classList.remove('grab');
      if (!moved && o.push) { tapInput(o.push); k.classList.add('pushed'); setTimeout(() => k.classList.remove('pushed'), 150); }
    };
    k.addEventListener('pointerup', end);
    k.addEventListener('pointercancel', end);
    // +/- buttons with auto-repeat
    const repeat = (btn, dir) => {
      let t1, t2;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        click(dir);
        t1 = setTimeout(() => { t2 = setInterval(() => click(dir), 70); }, 400);
      });
      const stop = () => { clearTimeout(t1); clearInterval(t2); };
      btn.addEventListener('pointerup', stop);
      btn.addEventListener('pointercancel', stop);
      btn.addEventListener('pointerleave', stop);
    };
    repeat(minus, -1);
    repeat(plus, 1);
    return {
      el: w, keys: o.key ? [o.key] : [],
      update(s) {
        if (!o.key) { readout.style.display = 'none'; return; }
        const v = s[o.key];
        readout.textContent = v === undefined ? '---' : (o.format ? o.format(v) : Math.round(v));
      }
    };
  }

  // ------------------------------------------------------------------ //
  // Gear lever: drag/tap handle up or down. Shows 3 greens next to it.
  // ------------------------------------------------------------------ //
  function GearLever(o = {}) {
    const w = el('div', { class: 'gear-lever' });
    el('div', { class: 'lever-title', text: o.text || 'GEAR' }, w);
    const slot = el('div', { class: 'lever-slot' }, w);
    el('div', { class: 'lever-up', text: 'UP' }, slot);
    el('div', { class: 'lever-dn', text: 'DN' }, slot);
    const handle = el('div', { class: 'lever-handle' }, slot);
    el('div', { class: 'lever-wheel' }, handle);
    const lights = global.Gauges.GearLights();
    w.appendChild(lights.el);
    const warn = el('div', { class: 'lever-transit' }, slot);
    let down = true;
    const render = () => w.classList.toggle('up', !down);
    let y0 = null;
    handle.addEventListener('pointerdown', (e) => { e.preventDefault(); handle.setPointerCapture(e.pointerId); y0 = e.clientY; });
    handle.addEventListener('pointerup', (e) => {
      if (y0 === null) return;
      const dy = e.clientY - y0;
      y0 = null;
      let next = Math.abs(dy) < 10 ? !down : dy > 0;
      if (next === down) return;
      down = next;
      if (o.toggleInput) tapInput(o.toggleInput);
      else tapInput(down ? (o.downInput || 'GEAR_DOWN') : (o.upInput || 'GEAR_UP'));
      render();
    });
    return {
      el: w, keys: ['gear'].concat(lights.keys),
      update(s) {
        lights.update(s);
        if (s.gear !== undefined) { down = s.gear > 0.5; render(); }
        const moving = ['gear_l', 'gear_n', 'gear_r'].some((k) => s[k] !== undefined && s[k] > 0.01 && s[k] < 0.99);
        warn.classList.toggle('on', moving);
      }
    };
  }

  // ------------------------------------------------------------------ //
  // Detent selector (flaps). Tap a position -> sends INC/DEC the right number of times.
  // ------------------------------------------------------------------ //
  function Selector(o) {
    const w = el('div', { class: 'selector' });
    el('div', { class: 'selector-title', text: o.text }, w);
    const col = el('div', { class: 'selector-col' }, w);
    let pos = 0;
    const items = o.positions.map((label, i) => {
      const b = el('button', { class: 'sel-pos', type: 'button', text: label }, col);
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const diff = i - pos;
        const name = diff > 0 ? o.inc : o.dec;
        for (let n = 0; n < Math.abs(diff); n++) setTimeout(() => tapInput(name, 50), n * 140);
        if (!global.Link.has(o.key)) { pos = i; render(); }
      });
      return b;
    });
    const render = () => items.forEach((b, i) => b.classList.toggle('sel', i === pos));
    render();
    return {
      el: w, keys: [o.key],
      update(s) {
        const v = s[o.key];
        if (v === undefined) return;
        // accept either a handle index (0..n) or a 0..1 ratio
        pos = clamp(Math.round(v <= 1 && o.positions.length > 2 && !Number.isInteger(v) ? v * (o.positions.length - 1) : v), 0, o.positions.length - 1);
        render();
      }
    };
  }

  // Countermeasure / small counter button: shows a count, sends input when pressed
  function CountButton(o) {
    const b = Button({ text: o.text, input: o.input, cls: 'count ' + (o.cls || '') });
    const c = el('span', { class: 'btn-count' }, b.el);
    return {
      el: b.el, keys: [o.key],
      update(s) { c.textContent = s[o.key] === undefined ? '--' : Math.round(s[o.key]); }
    };
  }

  // ------------------------------------------------------------------ //
  // Dual concentric knob (Garmin style): drag the outer ring or the inner
  // knob, tap the centre to push. Small −/+ buttons for each ring as well.
  // o: { text, outer: {inc, dec, label}, inner: {inc, dec, label}, push, key, format, size }
  // ------------------------------------------------------------------ //
  function DualKnob(o) {
    const w = el('div', { class: 'dknob-wrap' + (o.size ? ' ' + o.size : '') });
    if (o.text) el('div', { class: 'knob-title', text: o.text }, w);
    const readout = o.key ? el('div', { class: 'knob-readout' }, w) : null;
    const k = el('div', { class: 'dknob' }, w);
    const ring = el('div', { class: 'dknob-outer' }, k);
    el('div', { class: 'knob-mark' }, ring);
    const inner = el('div', { class: 'dknob-inner' }, k);
    el('div', { class: 'knob-mark' }, inner);
    if (o.push) el('div', { class: 'dknob-push', text: o.pushLabel || 'PUSH' }, inner);
    const rot = { outer: 0, inner: 0 };
    const detent = 20;
    const send = (zone, dir) => {
      const z = o[zone];
      if (!z) return;
      rot[zone] += dir * detent;
      (zone === 'outer' ? ring : inner).style.transform = `rotate(${rot[zone]}deg)`;
      tapInput(dir > 0 ? z.inc : z.dec, 40);
    };
    let act = null;
    const center = () => { const r = k.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, r.width / 2]; };
    k.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { k.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or ended pointer */ }
      const [cx, cy, R] = center();
      const dist = Math.hypot(e.clientX - cx, e.clientY - cy);
      act = { zone: dist > R * 0.58 ? 'outer' : 'inner', a: Math.atan2(e.clientX - cx, cy - e.clientY) * 180 / Math.PI, y: e.clientY, acc: 0, moved: 0 };
      k.classList.add('grab-' + act.zone);
    });
    k.addEventListener('pointermove', (e) => {
      if (!act) return;
      const [cx, cy] = center();
      const a = Math.atan2(e.clientX - cx, cy - e.clientY) * 180 / Math.PI;
      let d = a - act.a;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      const r = Math.hypot(e.clientX - cx, e.clientY - cy);
      act.acc += r > 14 ? d : (act.y - e.clientY) * 1.2;
      act.a = a;
      act.y = e.clientY;
      while (Math.abs(act.acc) >= detent) {
        const dir = Math.sign(act.acc);
        act.acc -= dir * detent;
        act.moved++;
        if (global.Feedback) global.Feedback.play('detent');
        send(act.zone, dir);
      }
    });
    const end = () => {
      if (!act) return;
      k.classList.remove('grab-outer', 'grab-inner');
      if (!act.moved && act.zone === 'inner' && o.push) {
        tapInput(o.push);
        inner.classList.add('pushed');
        setTimeout(() => inner.classList.remove('pushed'), 150);
      }
      act = null;
    };
    k.addEventListener('pointerup', end);
    k.addEventListener('pointercancel', end);
    // step buttons: outer −/+ and inner −/+
    const steps = el('div', { class: 'dknob-steps' }, w);
    const stepBtn = (zone, dir, label) => {
      if (!o[zone]) return;
      const b = el('button', { class: 'step ' + zone, type: 'button', text: label }, steps);
      let t1, t2;
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); send(zone, dir); t1 = setTimeout(() => { t2 = setInterval(() => send(zone, dir), 80); }, 400); });
      const stop = () => { clearTimeout(t1); clearInterval(t2); };
      ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => b.addEventListener(ev, stop));
    };
    stepBtn('outer', -1, '⟲');
    stepBtn('inner', -1, '−');
    stepBtn('inner', 1, '+');
    stepBtn('outer', 1, '⟳');
    return {
      el: w, keys: o.keys || (o.key ? [o.key] : []),
      update(s) {
        if (!readout) return;
        const v = s[o.key];
        readout.textContent = o.format ? o.format(s) : (v === undefined ? '---' : Math.round(v));
      }
    };
  }

  global.Controls = { Button, Toggle, Guarded, Knob, GearLever, Selector, CountButton, DualKnob, tapInput };
})(window);
