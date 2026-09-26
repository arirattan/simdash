/*
 * Touch feedback: short synthesized "mechanical" sounds for every control,
 * plus a vibration pulse on devices that support it (Android; iPads have no vibration motor).
 *
 *   press / release  push buttons, keys, tabs
 *   toggle           toggle switches, position selectors, gear lever
 *   detent           knob clicks while dragging
 *   cover            guard covers
 *
 * Sounds are generated once with Web Audio (no audio files) and played with ~10 ms latency.
 */
(function (global) {
  'use strict';
  const KEY = 'simdash.feedback';
  const S = { on: true, vol: 0.7 };
  try { Object.assign(S, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* defaults */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* private mode */ } };

  let ctx = null, master = null;
  const bufs = {};

  // deterministic noise so every click sounds identical
  function noiseGen(seed) {
    let x = seed;
    return () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x3fffffff - 1; };
  }

  function synth(seconds, fn, seed = 7) {
    const rate = ctx.sampleRate, n = Math.floor(rate * seconds);
    const b = ctx.createBuffer(1, n, rate);
    const d = b.getChannelData(0);
    const rnd = noiseGen(seed);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / rate, r = rnd();
      lp += (r - lp) * 0.35;              // softened noise for body
      d[i] = fn(t, r, lp);
    }
    return b;
  }

  const TAU = Math.PI * 2;
  function build() {
    // crisp micro-switch click with a small plastic body
    bufs.press = synth(0.045, (t, r, lp) =>
      r * Math.exp(-t * 900) * 0.55 + lp * Math.exp(-t * 260) * 0.5 + Math.sin(TAU * 170 * t) * Math.exp(-t * 120) * 0.45);
    // lighter click when the button springs back
    bufs.release = synth(0.03, (t, r, lp) =>
      r * Math.exp(-t * 1500) * 0.3 + Math.sin(TAU * 260 * t) * Math.exp(-t * 220) * 0.2, 11);
    // toggle switch: snap + second contact ~9 ms later, heavier body
    bufs.toggle = synth(0.08, (t, r, lp) => {
      const t2 = t - 0.009;
      const snap = r * Math.exp(-t * 700) * 0.7 + Math.sin(TAU * 115 * t) * Math.exp(-t * 55) * 0.7;
      const second = t2 > 0 ? (r * Math.exp(-t2 * 1100) * 0.4 + lp * Math.exp(-t2 * 300) * 0.3) : 0;
      return snap + second;
    }, 23);
    // knob detent: tiny tick
    bufs.detent = synth(0.014, (t, r) =>
      r * Math.exp(-t * 2600) * 0.45 + Math.sin(TAU * 2300 * t) * Math.exp(-t * 900) * 0.15, 31);
    // guard cover: low plastic flip
    bufs.cover = synth(0.12, (t, r, lp) =>
      Math.sin(TAU * 85 * t) * Math.exp(-t * 35) * 0.75 + lp * Math.exp(-t * 180) * 0.5, 41);
  }

  function init() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return;
    }
    const AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return;
    try {
      // mix with other audio, don't interrupt it (Safari 16.4+)
      if (navigator.audioSession) navigator.audioSession.type = 'ambient';
    } catch (e) { /* not supported */ }
    ctx = new AC({ latencyHint: 'interactive' });
    master = ctx.createGain();
    master.gain.value = S.vol;
    master.connect(ctx.destination);
    build();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  const VIBE = { press: 8, release: 0, toggle: 14, detent: 4, cover: 18 };
  function play(type) {
    if (!S.on) return;
    if (navigator.vibrate && VIBE[type]) { try { navigator.vibrate(VIBE[type]); } catch (e) { /* ignore */ } }
    if (!ctx || !bufs[type]) return;
    const src = ctx.createBufferSource();
    src.buffer = bufs[type];
    src.connect(master);
    src.start();
  }

  // ------------------------------------------------------------------ automatic hooks for every control
  const COVER = '.guard, .ah-cover, .ah-cover-close';
  const TOGGLE = '.toggle-body, .ah-pos, .bc-pos, .sel-pos, .lever-handle';
  const PRESS = '.btn, .ah-btn, .step, .tab, .icon-btn, .menu-item, .dash-card, .seg button';
  const SPRING = '.btn, .ah-btn';   // these also click when released

  document.addEventListener('pointerdown', (e) => {
    init();
    const t = e.target;
    if (!t || !t.closest) return;
    if (t.closest(COVER)) play('cover');
    else if (t.closest(TOGGLE)) play('toggle');
    else if (t.closest(PRESS)) play('press');
  }, true);
  document.addEventListener('pointerup', (e) => {
    init();
    if (e.target && e.target.closest && e.target.closest(SPRING)) play('release');
  }, true);
  // iOS only unlocks audio on touchend/click - make sure the context gets resumed
  document.addEventListener('touchend', init, true);
  document.addEventListener('click', init, true);

  // ------------------------------------------------------------------ settings (⚙ menu)
  function wire() {
    const seg = document.getElementById('fb-seg');
    const vol = document.getElementById('fb-vol');
    if (!seg || !vol) return;
    const render = () => {
      seg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', (b.dataset.on === '1') === S.on));
      vol.value = Math.round(S.vol * 100);
      vol.disabled = !S.on;
    };
    seg.querySelectorAll('button').forEach((b) => {
      b.onclick = () => { S.on = b.dataset.on === '1'; save(); render(); init(); play('toggle'); };
    });
    vol.addEventListener('input', () => { S.vol = vol.value / 100; if (master) master.gain.value = S.vol; save(); });
    vol.addEventListener('change', () => play('press'));
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();

  global.Feedback = { play, init, settings: S };
})(window);
