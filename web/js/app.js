/* SimDash app shell: routing, page building, status, settings, inspector. */
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const D = window.DASHBOARDS;
  const store = {
    get(k, d) { try { const v = localStorage.getItem('simdash.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('simdash.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  };

  // ---------- home ----------
  const list = $('#dash-list');
  const ORDER = ['prop', 'g1000', 'map', 'efb', 'custom', 'heli', 'civil-heli', 'agfire', 'civil-plane', 'dcs-cockpit', 'apache', 'mil-jet', 'mil-heli'];
  const ids = ORDER.filter((k) => D[k]).concat(Object.keys(D).filter((k) => !ORDER.includes(k)));
  ids.map((id) => [id, D[id]]).forEach(([id, d]) => {
    const b = document.createElement('button');
    b.className = 'dash-card';
    b.innerHTML = `<span class="dash-icon">${d.icon}</span><span class="dash-name">${d.name}</span><span class="dash-pages">${d.sub || d.pages.map((p) => p.title).join(' · ')}</span>`;
    b.onclick = () => { location.hash = id; };
    list.appendChild(b);
  });

  // ---------- widget registration (recurses into groups) ----------
  function registerTree(w) {
    if (w.children) w.children.forEach(registerTree);
    if (w.keys && w.keys.length) window.Link.register(w);
  }

  let current = null, custom = null;
  const built = {};

  function leaveCustom() {
    if (custom) { custom.unmount(); custom = null; }
  }

  function openDash(id, pageIdx) {
    const d = D[id];
    if (!d) return showHome();
    $('#home').classList.add('hidden');
    $('#dash').classList.remove('hidden');
    $('#dash-title').textContent = d.name;
    if (d.custom) {
      if (current === id) return;
      leaveCustom();
      current = id;
      store.set('last', id);
      $('#pages').innerHTML = '';
      $('#tabs').innerHTML = '';
      Object.keys(built).forEach((k) => delete built[k]);
      custom = d.custom;
      custom.mount($('#pages'), $('#tabs'));
      return;
    }
    if (current !== id) {
      leaveCustom();
      current = id;
      $('#pages').innerHTML = '';
      Object.keys(built).forEach((k) => delete built[k]);
      const tabs = $('#tabs');
      tabs.innerHTML = '';
      d.pages.forEach((p, i) => {
        const t = document.createElement('button');
        t.className = 'tab';
        t.textContent = p.title;
        t.onclick = () => { location.hash = id + '/' + i; };
        tabs.appendChild(t);
      });
    }
    pageIdx = Math.min(+pageIdx || 0, d.pages.length - 1);
    store.set('last', id + '/' + pageIdx);
    [...$('#tabs').children].forEach((t, i) => t.classList.toggle('active', i === pageIdx));
    Object.values(built).forEach((p) => p.classList.add('hidden'));
    if (!built[pageIdx]) built[pageIdx] = buildPage(d.pages[pageIdx]);
    built[pageIdx].classList.remove('hidden');
  }

  function buildPage(p) {
    const page = document.createElement('div');
    page.className = 'page';
    page.style.gridTemplateColumns = `repeat(${p.cols}, 1fr)`;
    page.style.gridTemplateRows = p.rowsTpl || `repeat(${p.rows}, 1fr)`;
    p.cells.forEach(([factory, cs = 1, rs = 1]) => {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.style.gridColumn = cs >= 99 ? '1 / -1' : `span ${cs}`;
      cell.style.gridRow = `span ${rs}`;
      const w = factory();
      cell.appendChild(w.el);
      page.appendChild(cell);
      registerTree(w);
    });
    // night-lighting tint layer on top of every instrument face (multiply blend = backlit look)
    page.querySelectorAll('.instrument').forEach((i) => i.appendChild(Object.assign(document.createElement('div'), { className: 'night-tint' })));
    $('#pages').appendChild(page);
    return page;
  }

  function showHome() {
    leaveCustom();
    current = null;
    $('#dash').classList.add('hidden');
    $('#home').classList.remove('hidden');
  }

  function route() {
    const [id, pg] = location.hash.slice(1).split('/');
    if (id) openDash(id, pg);
    else showHome();
  }
  window.addEventListener('hashchange', route);
  $('#btn-home').onclick = () => { location.hash = ''; };

  // swipe left/right on the tab bar area to change page
  let sx = null;
  $('#pages').addEventListener('touchstart', (e) => { if (e.touches.length === 2) sx = e.touches[0].clientX; }, { passive: true });
  $('#pages').addEventListener('touchend', (e) => {
    if (sx === null) return;
    const dx = e.changedTouches[0].clientX - sx;
    sx = null;
    if (Math.abs(dx) < 80 || !current || !D[current].pages) return;
    const n = D[current].pages.length, cur = +(location.hash.split('/')[1] || 0);
    location.hash = current + '/' + ((cur + (dx < 0 ? 1 : -1) + n) % n);
  });

  // ---------- status ----------
  window.Link.onStatus((s) => {
    let text, cls;
    if (!s.connected) { text = 'Bridge offline'; cls = 'bad'; }
    else if (s.demo) { text = 'DEMO data'; cls = 'demo'; }
    else if (s.sim) { text = s.aircraft ? `${s.sim} · ${s.aircraft}` : `${s.sim} connected`; cls = 'ok'; }
    else {
      const src = s.sources || {};
      const names = { msfs: 'MSFS', dcs: 'DCS', simhub: 'SimHub' };
      const w = Object.keys(src).map((k) => names[k] || k);
      text = w.length ? `Waiting for ${w.join(' / ')}` : 'No sim connection';
      cls = 'warn';
    }
    ['#pill', '#home-pill'].forEach((q) => { const p = $(q); p.textContent = text; p.className = 'pill ' + cls; });
  });

  // ---------- panel lighting: day / night (red) / NVG (green) + brightness ----------
  const MODES = ['day', 'night', 'nvg'];
  const ICON = { day: '☀', night: '☾', nvg: '◉' };
  function setLight(mode, dim) {
    if (mode !== undefined) {
      MODES.forEach((m) => document.body.classList.toggle('mode-' + m, m === mode));
      document.querySelectorAll('.light-btn').forEach((b) => { b.textContent = ICON[mode]; });
      document.querySelectorAll('#light-seg button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
      store.set('light', mode);
    }
    if (dim !== undefined) {
      $('#dimmer').style.opacity = String(1 - dim / 100);
      $('#dim').value = dim;
      $('#dim-val').textContent = dim + '%';
      store.set('dim', dim);
    }
  }
  const cycleLight = () => {
    const cur = MODES.find((m) => document.body.classList.contains('mode-' + m)) || 'day';
    const next = MODES[(MODES.indexOf(cur) + 1) % MODES.length];
    // switching into a night mode starts dimmer; back to day restores full brightness
    setLight(next, next === 'day' ? 100 : Math.min(+$('#dim').value, 70));
  };
  document.querySelectorAll('.light-btn').forEach((b) => { b.onclick = cycleLight; });
  document.querySelectorAll('#light-seg button').forEach((b) => { b.onclick = () => setLight(b.dataset.mode); });
  $('#dim').addEventListener('input', (e) => setLight(undefined, +e.target.value));
  setLight(store.get('light', 'day'), store.get('dim', 100));

  // ---------- settings ----------
  const menu = $('#menu');
  $('#btn-menu').onclick = () => menu.classList.remove('hidden');
  menu.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act && e.target !== menu) return;
    menu.classList.add('hidden');
    if (act === 'inspect') openInspector();
    if (act === 'log') { $('#input-log').classList.toggle('hidden'); }
    if (act === 'reload') location.reload();
  });

  // input log: wrap Link.input
  const origInput = window.Link.input;
  window.Link.input = (name, a) => {
    if (a !== 'release' && !$('#input-log').classList.contains('hidden')) {
      const l = $('#input-log');
      const row = document.createElement('div');
      row.textContent = name;
      l.prepend(row);
      while (l.children.length > 8) l.lastChild.remove();
    }
    return origInput(name, a);
  };

  // ---------- inspector ----------
  let inspTimer = null;
  function openInspector() {
    $('#inspector').classList.remove('hidden');
    window.Link.inspect();
    inspTimer = setInterval(window.Link.inspect, 1000);
  }
  $('#insp-close').onclick = () => { $('#inspector').classList.add('hidden'); clearInterval(inspTimer); };
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const show = (v) => (v === null || v === undefined ? '—' : typeof v === 'number' ? +v.toFixed(3) : esc(v));
  window.Link.onInspect((m) => {
    $('#insp-meta').textContent = `profile: ${m.profile}  ·  game: ${m.game || '—'}`;
    $('#insp-table tbody').innerHTML = m.rows.map((r) => `
      <tr class="${r.value === undefined || r.value === null ? 'missing' : 'ok'}">
        <td><b>${esc(r.key)}</b> <small>${esc(r.unit || '')}</small></td>
        <td>${show(r.value)}</td>
        <td><code>${esc(r.from || '—')}</code></td>
        <td>${r.candidates.map((c) => `<div class="${c.v === null || c.v === undefined ? 'nil' : 'has'}"><code>${esc(c.p)}</code> = ${show(c.v)}</div>`).join('')}</td>
      </tr>`).join('');
  });

  // ---------- go ----------
  window.Link.connect();
  if (!location.hash && store.get('last', null) && new URLSearchParams(location.search).get('home') !== '1') location.hash = store.get('last');
  route();
})();
