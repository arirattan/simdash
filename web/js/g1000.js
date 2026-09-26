/*
 * G1000 bezel (PFD / MFD) for MSFS G1000 aircraft: C172 G1000, 208B Grand Caravan, DA40/DA62, ...
 *
 * Every key and knob sends the sim event that MSFS's own AS1000 cockpit template binds to the
 * matching bezel control (fs-base-aircraft-common/ModelBehaviorDefs/Asobo/GlassCockpit/AS1000.xml):
 *   softkeys        K:G1000_<PFD|MFD>_SOFTKEY1..12
 *   D→ MENU FPL...  K:G1000_<PFD|MFD>_DIRECTTO_BUTTON / MENU_BUTTON / FLIGHTPLAN_BUTTON / PROCEDURE_BUTTON / CLEAR_BUTTON / ENTER_BUTTON
 *   FMS knob        K:G1000_<X>_GROUP_KNOB_INC/DEC (small), PAGE_KNOB_INC/DEC (large)
 *   RANGE knob      K:G1000_<X>_ZOOMOUT_BUTTON / ZOOMIN_BUTTON, push CURSOR_BUTTON
 *   radios, HDG, ALT, CRS/BARO, autopilot: standard K: events
 * The screen area shows SimDash's own flight display (the Garmin screen itself stays in the sim).
 */
(function (global) {
  'use strict';
  const G = global.Gauges, C = global.Controls, L = global.Link;
  const { el } = G;

  const freq = (v, dp) => (typeof v === 'number' ? v.toFixed(dp) : '---.--');
  const pad3 = (v) => (typeof v === 'number' ? String(Math.round(((v % 360) + 360) % 360) || 360).padStart(3, '0') : '---');
  const num = (v, dp = 0) => (typeof v === 'number' ? v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }) : '---');

  let root = null, live = [], unit = 'PFD', tabsEl = null;

  function reg(w) {
    live.push(w);
    L.register(w);
    return w;
  }

  // small labelled data box inside the screen: [LABEL value]
  function box(label, fn, keys, cls = '') {
    const b = el('div', { class: 'g1k-box ' + cls });
    el('span', { class: 'g1k-box-l', text: label }, b);
    const v = el('span', { class: 'g1k-box-v' }, b);
    reg({ el: b, keys, update(s) { v.textContent = fn(s); } });
    return b;
  }

  function key(label, input, lit, cls = '') {
    const w = C.Button({ text: label, input, key: lit, cls: 'g1k-key ' + cls });
    if (lit) reg(w);
    return w.el;
  }

  function dual(o) {
    const w = C.DualKnob(o);
    return w.el;
  }

  // ------------------------------------------------------------------ screen (SimDash flight display)
  function pfdScreen(scr) {
    const top = el('div', { class: 'g1k-top' }, scr);
    top.appendChild(box('NAV1', (s) => `${freq(s.nav1_act, 2)}  ⇆  ${freq(s.nav1, 2)}`, ['nav1_act', 'nav1'], 'nav'));
    const modes = el('div', { class: 'g1k-modes' }, top);
    [['AP', 'ap_master'], ['FD', 'ap_fd'], ['HDG', 'ap_hdg'], ['NAV', 'ap_nav'], ['APR', 'ap_apr'], ['ALT', 'ap_alt'], ['VS', 'ap_vs'], ['FLC', 'ap_flc'], ['GS', 'ap_gs']]
      .forEach(([t, k]) => {
        const m = el('span', { class: 'g1k-mode', text: t }, modes);
        reg({ el: m, keys: [k], update(s) { m.classList.toggle('on', s[k] > 0.5); } });
      });
    top.appendChild(box('COM1', (s) => `${freq(s.com1_act, 3)}  ⇆  ${freq(s.com1, 3)}`, ['com1_act', 'com1'], 'com'));

    const mid = el('div', { class: 'g1k-mid' }, scr);
    const left = el('div', { class: 'g1k-col' }, mid);
    left.appendChild(box('IAS', (s) => num(s.ias), ['ias'], 'big'));
    left.appendChild(box('TAS', (s) => num(s.tas) + ' KT', ['tas']));
    left.appendChild(box('GS', (s) => num(s.gs) + ' KT', ['gs']));
    left.appendChild(box('OAT', (s) => num(s.oat) + '°C', ['oat']));
    const att = el('div', { class: 'g1k-inst' }, mid);
    att.appendChild(reg(G.Attitude({})).el);
    const right = el('div', { class: 'g1k-col' }, mid);
    right.appendChild(box('ALT SEL', (s) => num(s.alt_sel), ['alt_sel'], 'sel'));
    right.appendChild(box('ALT', (s) => num(s.alt), ['alt'], 'big'));
    right.appendChild(box('VS', (s) => (typeof s.vs === 'number' ? (s.vs > 0 ? '+' : '') + Math.round(s.vs / 10) * 10 : '---'), ['vs']));
    right.appendChild(box('VS SEL', (s) => num(s.vs_sel), ['vs_sel']));

    const bot = el('div', { class: 'g1k-bot' }, scr);
    const bl = el('div', { class: 'g1k-col' }, bot);
    bl.appendChild(box('HDG', (s) => pad3(s.hdg_bug) + '°', ['hdg_bug'], 'sel'));
    bl.appendChild(box('BRG', (s) => pad3(s.heading) + '°', ['heading']));
    const hsi = el('div', { class: 'g1k-inst' }, bot);
    hsi.appendChild(reg(G.Heading({ course: true })).el);
    const br = el('div', { class: 'g1k-col' }, bot);
    br.appendChild(box('CRS', (s) => pad3(s.crs) + '°', ['crs'], 'sel'));
    br.appendChild(box('BARO', (s) => (typeof s.baro_hg === 'number' ? s.baro_hg.toFixed(2) + ' IN' : '---'), ['baro_hg'], 'sel'));
  }

  function mfdScreen(scr) {
    const top = el('div', { class: 'g1k-top' }, scr);
    top.appendChild(box('NAV1', (s) => `${freq(s.nav1_act, 2)}  ⇆  ${freq(s.nav1, 2)}`, ['nav1_act', 'nav1'], 'nav'));
    top.appendChild(box('GS', (s) => num(s.gs) + ' KT', ['gs']));
    top.appendChild(box('COM1', (s) => `${freq(s.com1_act, 3)}  ⇆  ${freq(s.com1, 3)}`, ['com1_act', 'com1'], 'com'));
    const body = el('div', { class: 'g1k-mfd' }, scr);
    const eis = el('div', { class: 'g1k-eis' }, body);
    el('div', { class: 'g1k-eis-title', text: 'ENGINE' }, eis);
    eis.appendChild(box('RPM', (s) => num(s.rpm), ['rpm'], 'big'));
    eis.appendChild(box('FFLOW GPH', (s) => num(s.fuel_flow, 1), ['fuel_flow']));
    eis.appendChild(box('OIL PRES', (s) => num(s.oil_p), ['oil_p']));
    eis.appendChild(box('OIL TEMP', (s) => num(s.oil_t), ['oil_t']));
    eis.appendChild(box('EGT', (s) => num(s.egt), ['egt']));
    eis.appendChild(box('CHT', (s) => num(s.cht), ['cht']));
    eis.appendChild(box('FUEL L', (s) => num(s.fuel_l, 1), ['fuel_l']));
    eis.appendChild(box('FUEL R', (s) => num(s.fuel_r, 1), ['fuel_r']));
    eis.appendChild(box('VOLTS', (s) => num(s.volts, 1), ['volts']));
    eis.appendChild(box('AMPS', (s) => num(s.amps, 1), ['amps']));
    const hsi = el('div', { class: 'g1k-inst big' }, body);
    hsi.appendChild(reg(G.Heading({ course: true })).el);
    const info = el('div', { class: 'g1k-col' }, body);
    info.appendChild(box('HDG', (s) => pad3(s.heading) + '°', ['heading'], 'big'));
    info.appendChild(box('ALT', (s) => num(s.alt), ['alt']));
    info.appendChild(box('IAS', (s) => num(s.ias), ['ias']));
    info.appendChild(box('TAS', (s) => num(s.tas), ['tas']));
    info.appendChild(box('OAT', (s) => num(s.oat) + '°C', ['oat']));
  }

  // ------------------------------------------------------------------ bezel
  function build(container) {
    const U = unit;
    const K = (name) => 'K:G1000_' + U + '_' + name;
    const b = el('div', { class: 'g1k' }, container);

    // left side: NAV, HDG, autopilot, ALT
    const left = el('div', { class: 'g1k-side' }, b);
    const navRow = el('div', { class: 'g1k-row' }, left);
    navRow.appendChild(dual({ text: 'NAV VOL', inner: { inc: 'K:NAV1_VOLUME_INC', dec: 'K:NAV1_VOLUME_DEC' }, size: 'sm' }));
    navRow.appendChild(key('NAV ⇆', 'K:NAV1_RADIO_SWAP', null, 'swap'));
    left.appendChild(dual({ text: 'NAV  MHz / kHz', outer: { inc: 'K:NAV1_RADIO_WHOLE_INC', dec: 'K:NAV1_RADIO_WHOLE_DEC' }, inner: { inc: 'K:NAV1_RADIO_FRACT_INC', dec: 'K:NAV1_RADIO_FRACT_DEC' } }));
    left.appendChild(dual({ text: 'HDG', inner: { inc: 'K:HEADING_BUG_INC', dec: 'K:HEADING_BUG_DEC' }, push: 'HDG_PUSH', pushLabel: 'SYNC', size: 'sm' }));
    const ap = el('div', { class: 'g1k-ap' }, left);
    [['AP', 'AP_MASTER', 'ap_master'], ['FD', 'AP_FD', 'ap_fd'], ['HDG', 'AP_HDG', 'ap_hdg'], ['ALT', 'AP_ALT', 'ap_alt'],
     ['NAV', 'AP_NAV', 'ap_nav'], ['VS', 'AP_VS', 'ap_vs'], ['APR', 'AP_APR', 'ap_apr'], ['FLC', 'AP_FLC', 'ap_flc'],
     ['BC', 'AP_BC', 'ap_bc'], ['NOSE ▲', 'AP_NOSE_UP', null], ['YD', 'AP_YD', 'ap_yd'], ['NOSE ▼', 'AP_NOSE_DN', null]]
      .forEach(([t, i, k]) => ap.appendChild(key(t, i, k)));
    left.appendChild(dual({ text: 'ALT  1000 / 100', outer: { inc: 'ALT_INC_1000', dec: 'ALT_DEC_1000' }, inner: { inc: 'K:AP_ALT_VAR_INC', dec: 'K:AP_ALT_VAR_DEC' } }));

    // screen
    const scr = el('div', { class: 'g1k-screen' }, b);
    el('div', { class: 'g1k-brand', text: 'GARMIN · ' + U + ' · SimDash display' }, scr);
    (U === 'PFD' ? pfdScreen : mfdScreen)(scr);

    // right side: COM, CRS/BARO, RANGE, keys, FMS
    const right = el('div', { class: 'g1k-side' }, b);
    const comRow = el('div', { class: 'g1k-row' }, right);
    comRow.appendChild(key('COM ⇆', 'K:COM_STBY_RADIO_SWAP', null, 'swap'));
    comRow.appendChild(dual({ text: 'COM VOL', inner: { inc: 'K:COM1_VOLUME_INC', dec: 'K:COM1_VOLUME_DEC' }, size: 'sm' }));
    right.appendChild(dual({ text: 'COM  MHz / kHz', outer: { inc: 'K:COM_RADIO_WHOLE_INC', dec: 'K:COM_RADIO_WHOLE_DEC' }, inner: { inc: 'K:COM_RADIO_FRACT_INC', dec: 'K:COM_RADIO_FRACT_DEC' } }));
    right.appendChild(dual({ text: 'BARO / CRS', outer: { inc: 'K:KOHLSMAN_INC', dec: 'K:KOHLSMAN_DEC' }, inner: { inc: 'K:VOR1_OBI_INC', dec: 'K:VOR1_OBI_DEC' } }));
    right.appendChild(dual({ text: 'RANGE', inner: { inc: K('ZOOMOUT_BUTTON'), dec: K('ZOOMIN_BUTTON') }, push: K('CURSOR_BUTTON'), pushLabel: 'PAN', size: 'sm' }));
    const keys = el('div', { class: 'g1k-keys' }, right);
    [['D→', 'DIRECTTO_BUTTON'], ['MENU', 'MENU_BUTTON'], ['FPL', 'FLIGHTPLAN_BUTTON'], ['PROC', 'PROCEDURE_BUTTON'], ['CLR', 'CLEAR_BUTTON'], ['ENT', 'ENTER_BUTTON']]
      .forEach(([t, e]) => keys.appendChild(key(t, K(e))));
    right.appendChild(dual({ text: 'FMS', outer: { inc: K('PAGE_KNOB_INC'), dec: K('PAGE_KNOB_DEC') }, inner: { inc: K('GROUP_KNOB_INC'), dec: K('GROUP_KNOB_DEC') }, push: '@AS1000_' + U + '_1_FMS_Inner_Button', pushLabel: 'CRSR' }));

    // softkeys under the screen
    const sk = el('div', { class: 'g1k-softkeys' }, b);
    for (let i = 1; i <= 12; i++) sk.appendChild(key(String(i), K('SOFTKEY' + i), null, 'soft'));

    // night lighting tint on the instruments inside the screen
    b.querySelectorAll('.instrument').forEach((i) => i.appendChild(Object.assign(document.createElement('div'), { className: 'night-tint' })));
  }

  function render() {
    live.forEach((w) => L.unregister(w));
    live = [];
    root.innerHTML = '';
    build(root);
    if (tabsEl) [...tabsEl.children].forEach((t) => t.classList.toggle('active', t.textContent === unit));
  }

  function mount(container, tabs) {
    root = el('div', { class: 'g1k-root' }, container);
    tabsEl = tabs;
    try { unit = localStorage.getItem('simdash.g1000') || 'PFD'; } catch (e) { unit = 'PFD'; }
    ['PFD', 'MFD'].forEach((u) => {
      const t = el('button', { class: 'tab', type: 'button', text: u }, tabs);
      t.onclick = () => { unit = u; try { localStorage.setItem('simdash.g1000', u); } catch (e) { /* ignore */ } render(); };
    });
    render();
  }

  function unmount() {
    live.forEach((w) => L.unregister(w));
    live = [];
    root = null;
  }

  global.DASHBOARDS.g1000 = {
    name: 'G1000', icon: '🟦', sub: 'PFD / MFD bezel: C172 G1000, Caravan, DA40…  (MSFS)',
    custom: { mount, unmount }
  };
})(window);
