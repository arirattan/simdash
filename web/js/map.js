/*
 * Moving map (MSFS + DCS). Leaflet is loaded from cdnjs the first time the map opens
 * (the iPad needs internet for map tiles anyway).
 *
 *  - aircraft (true heading), trail, follow mode, range rings that scale with zoom
 *  - base maps: Streets (OSM), Topo (OpenTopoMap), Satellite (Esri), Dark (CARTO); optional OpenAIP overlay (API key)
 *  - long-press the map = Direct-To (magenta line, bearing / distance / ETE)
 *  - airports from the bridge's OurAirports database: tap for runways, frequencies, METAR, Direct-To
 *  - nearest airports list, SimBrief route (fetched in the Flight bag)
 */
(function (global) {
  'use strict';
  const Link = global.Link;
  const { el } = global.Gauges;
  const NM = 1852;
  const LEAFLET = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/';
  const store = {
    get(k, d) { try { const v = localStorage.getItem('simdash.map.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('simdash.map.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  };
  const api = (path) => {
    const host = new URLSearchParams(location.search).get('host');
    return fetch((host ? `http://${host}` : '') + path, { cache: 'no-store' }).then((r) => r.json());
  };

  let root = null, map = null, LL = null, widget = null;
  let plane = null, trail = null, rings = null, target = null, targetLine = null, aptLayer = null, routeLayer = null, base = null, aip = null;
  let follow = store.get('follow', true), showRings = store.get('rings', true), showApts = store.get('apts', true);
  let lastPos = null, lastDraw = 0, trailPts = [];
  let strip = {}, nearestBox = null, toast = null;

  // ------------------------------------------------------------------ geo helpers
  const R = Math.PI / 180;
  function distNm(a, b) {
    const dp = (b[0] - a[0]) * R, dl = (b[1] - a[1]) * R;
    const h = Math.sin(dp / 2) ** 2 + Math.cos(a[0] * R) * Math.cos(b[0] * R) * Math.sin(dl / 2) ** 2;
    return 3440.065 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function brg(a, b) {
    const y = Math.sin((b[1] - a[1]) * R) * Math.cos(b[0] * R);
    const x = Math.cos(a[0] * R) * Math.sin(b[0] * R) - Math.sin(a[0] * R) * Math.cos(b[0] * R) * Math.cos((b[1] - a[1]) * R);
    return (Math.atan2(y, x) / R + 360) % 360;
  }
  const pad3 = (v) => String(Math.round(v) % 360).padStart(3, '0');
  const ete = (nm, gs) => { if (!(gs > 20)) return '--:--'; const m = Math.round(nm / gs * 60); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };

  // ------------------------------------------------------------------ Leaflet loading
  function loadLeaflet() {
    if (global.L && global.L.map) return Promise.resolve(global.L);
    return new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = LEAFLET + 'leaflet.min.css';
      document.head.appendChild(css);
      const s = document.createElement('script');
      s.src = LEAFLET + 'leaflet.min.js';
      s.onload = () => resolve(global.L);
      s.onerror = () => reject(new Error('Could not load the map library - is the iPad online?'));
      document.head.appendChild(s);
    });
  }

  const BASES = {
    Streets: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }],
    Topo: ['https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: '© OpenTopoMap © OpenStreetMap' }],
    Satellite: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: '© Esri' }],
    Dark: ['https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19, attribution: '© OpenStreetMap © CARTO' }],
  };

  function setBase(name) {
    if (!BASES[name]) name = 'Streets';
    if (base) map.removeLayer(base);
    base = LL.tileLayer(BASES[name][0], BASES[name][1]).addTo(map);
    base.bringToBack();
    store.set('base', name);
    root.querySelectorAll('.mp-base button').forEach((b) => b.classList.toggle('on', b.textContent === name));
  }

  function setAip() {
    if (aip) { map.removeLayer(aip); aip = null; }
    const key = store.get('openaip', '');
    if (key) aip = LL.tileLayer('https://api.tiles.openaip.net/api/data/openaip/{z}/{x}/{y}.png?apiKey=' + encodeURIComponent(key), { maxZoom: 14, attribution: '© openAIP' }).addTo(map);
  }

  // ------------------------------------------------------------------ UI
  function button(parent, text, onclick, cls = '') {
    const b = el('button', { class: 'mp-btn ' + cls, type: 'button', text }, parent);
    b.addEventListener('click', onclick);
    return b;
  }
  function say(msg, ms = 3500) {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('on');
    clearTimeout(say.t);
    say.t = setTimeout(() => toast.classList.remove('on'), ms);
  }

  function buildUi() {
    const bar = el('div', { class: 'mp-strip' }, root);
    [['GS', 'gs'], ['ALT', 'alt'], ['HDG', 'hdg'], ['TRK', 'trk'], ['TO', 'to'], ['BRG', 'brg'], ['DIST', 'dist'], ['ETE', 'ete']].forEach(([l, k]) => {
      const c = el('div', { class: 'mp-cell ' + (['to', 'brg', 'dist', 'ete'].includes(k) ? 'tgt' : '') }, bar);
      el('span', { class: 'mp-l', text: l }, c);
      strip[k] = el('span', { class: 'mp-v', text: '---' }, c);
    });
    const tools = el('div', { class: 'mp-tools' }, root);
    const f = button(tools, 'FOLLOW', () => { follow = !follow; store.set('follow', follow); f.classList.toggle('on', follow); if (follow && lastPos) map.panTo(lastPos); }, follow ? 'on' : '');
    const rg = button(tools, 'RINGS', () => { showRings = !showRings; store.set('rings', showRings); rg.classList.toggle('on', showRings); drawRings(); }, showRings ? 'on' : '');
    const ap = button(tools, 'AIRPORTS', () => { showApts = !showApts; store.set('apts', showApts); ap.classList.toggle('on', showApts); loadAirports(); }, showApts ? 'on' : '');
    button(tools, 'NEAREST', toggleNearest);
    button(tools, 'ROUTE', drawRoute);
    button(tools, 'CLEAR', () => { setTarget(null); trailPts = []; if (trail) trail.setLatLngs([]); say('Direct-To and trail cleared'); });
    button(tools, '＋', () => map.zoomIn(), 'zoom');
    button(tools, '－', () => map.zoomOut(), 'zoom');
    const bases = el('div', { class: 'mp-base' }, root);
    Object.keys(BASES).forEach((n) => button(bases, n, () => setBase(n)));
    button(bases, 'openAIP…', () => {
      const k = prompt('openAIP API key for the aviation chart overlay (free at openaip.net). Leave empty to turn it off.', store.get('openaip', ''));
      if (k !== null) { store.set('openaip', k.trim()); setAip(); }
    });
    nearestBox = el('div', { class: 'mp-nearest hidden' }, root);
    toast = el('div', { class: 'mp-toast' }, root);
    el('div', { class: 'mp-hint', text: 'Long-press the map for Direct-To' }, root);
  }

  // ------------------------------------------------------------------ aircraft
  function planeIcon() {
    return LL.divIcon({
      className: 'mp-plane', iconSize: [44, 44], iconAnchor: [22, 22],
      html: '<svg viewBox="0 0 64 64"><path d="M32 4 L36 24 L58 34 L58 39 L36 34 L35 50 L43 56 L43 60 L32 57 L21 60 L21 56 L29 50 L28 34 L6 39 L6 34 L28 24 Z" fill="#ffd400" stroke="#000" stroke-width="2.5" stroke-linejoin="round"/></svg>'
    });
  }

  function update(s) {
    const lat = s.lat, lon = s.lon;
    if (typeof lat !== 'number' || typeof lon !== 'number' || (lat === 0 && lon === 0)) return;
    const now = performance.now();
    const pos = [lat, lon];
    const hdg = typeof s.hdg_true === 'number' ? s.hdg_true : s.heading || 0;
    if (!plane) {
      plane = LL.marker(pos, { icon: planeIcon(), interactive: false, zIndexOffset: 1000 }).addTo(map);
      lastPos = pos;
      map.setView(pos, Math.max(map.getZoom(), 11));
      drawRings();
    }
    plane.setLatLng(pos);
    const svg = plane.getElement() && plane.getElement().querySelector('svg');
    if (svg) svg.style.transform = `rotate(${hdg}deg)`;
    if (!lastPos || distNm(lastPos, pos) > 0.03) {
      trailPts.push(pos);
      if (trailPts.length > 4000) trailPts.shift();
      trail.setLatLngs(trailPts);
    }
    lastPos = pos;
    if (follow && now - lastDraw > 400) { map.panTo(pos, { animate: true, duration: 0.4 }); lastDraw = now; }
    if (rings) rings.forEach((c) => c.setLatLng(pos));
    // strip
    strip.gs.textContent = typeof s.gs === 'number' ? Math.round(s.gs) + ' kt' : '---';
    strip.alt.textContent = typeof s.alt === 'number' ? Math.round(s.alt).toLocaleString('en-US') + ' ft' : '---';
    strip.hdg.textContent = typeof s.heading === 'number' ? pad3(s.heading) + '°' : '---';
    strip.trk.textContent = typeof s.track === 'number' ? pad3(s.track) + '°T' : '---';
    if (target) {
      const d = distNm(pos, target.pos);
      strip.to.textContent = target.name;
      strip.brg.textContent = pad3(brg(pos, target.pos)) + '°T';
      strip.dist.textContent = d.toFixed(d < 10 ? 1 : 0) + ' nm';
      strip.ete.textContent = ete(d, s.gs);
      targetLine.setLatLngs([pos, target.pos]);
    }
  }

  // ------------------------------------------------------------------ rings
  function drawRings() {
    if (rings) rings.forEach((r) => map.removeLayer(r));
    rings = null;
    if (!showRings || !lastPos) return;
    const z = map.getZoom();
    const set = z >= 12 ? [0.5, 1, 2] : z >= 10 ? [2, 5, 10] : z >= 8 ? [10, 20, 40] : [25, 50, 100];
    rings = set.map((nm) => LL.circle(lastPos, { radius: nm * NM, color: '#00e5ff', weight: 1, opacity: 0.7, fill: false, dashArray: '4 6', interactive: false })
      .bindTooltip(nm + ' nm', { permanent: true, direction: 'top', className: 'mp-ring-label', offset: [0, 0] }).addTo(map));
  }

  // ------------------------------------------------------------------ Direct-To
  function setTarget(t) {
    target = t;
    if (!t) {
      targetLine.setLatLngs([]);
      ['to', 'brg', 'dist', 'ete'].forEach((k) => { strip[k].textContent = '---'; });
      if (setTarget.m) { map.removeLayer(setTarget.m); setTarget.m = null; }
      return;
    }
    if (setTarget.m) map.removeLayer(setTarget.m);
    setTarget.m = LL.circleMarker(t.pos, { radius: 9, color: '#ff00ff', weight: 3, fill: false }).addTo(map);
    if (lastPos) targetLine.setLatLngs([lastPos, t.pos]);
    strip.to.textContent = t.name;
    say('Direct-To ' + t.name);
  }

  // ------------------------------------------------------------------ airports
  const APT_STYLE = [
    { radius: 7, color: '#1e6bff', fillColor: '#7fb2ff' },  // large
    { radius: 6, color: '#1e6bff', fillColor: '#7fb2ff' },  // medium
    { radius: 5, color: '#b0008c', fillColor: '#ff7ae3' },  // small
    { radius: 5, color: '#00879e', fillColor: '#7ff0ff' },  // seaplane
    { radius: 5, color: '#1a8c1a', fillColor: '#8cff8c' },  // heliport
  ];
  let aptTimer = 0;
  function loadAirports() {
    clearTimeout(aptTimer);
    aptTimer = setTimeout(async () => {
      aptLayer.clearLayers();
      if (!showApts || !map) return;
      if (map.getZoom() < 7) return;
      const b = map.getBounds();
      let res;
      try { res = await api(`/api/airports?bbox=${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}&max=${map.getZoom() >= 10 ? 600 : 250}`); } catch (e) { return; }
      if (res.state !== 'ready') { offerDb(res.state); return; }
      res.airports.forEach((a) => {
        const st = APT_STYLE[a.t] || APT_STYLE[2];
        const m = LL.circleMarker([a.lat, a.lon], Object.assign({ weight: 2, fillOpacity: 0.8 }, st));
        const z = map.getZoom(), minor = a.t >= 3;   // seaplane bases & heliports only labelled when zoomed in
        if (z >= 10 || a.t <= 1) m.bindTooltip(a.id, { permanent: minor ? z >= 13 : z >= 11, direction: 'right', className: 'mp-apt-label', offset: [6, 0] });
        m.on('click', () => airportPopup(a, m));
        aptLayer.addLayer(m);
      });
    }, 250);
  }

  async function airportPopup(a, marker) {
    const box = el('div', { class: 'mp-pop' });
    el('div', { class: 'mp-pop-t', text: `${a.id}  ${a.n}` }, box);
    el('div', { class: 'mp-pop-s', text: `Elev ${a.elev} ft` }, box);
    const det = el('div', { class: 'mp-pop-d', text: 'loading…' }, box);
    const wx = el('div', { class: 'mp-pop-wx' }, box);
    const btns = el('div', { class: 'mp-pop-b' }, box);
    button(btns, 'DIRECT-TO', () => { setTarget({ pos: [a.lat, a.lon], name: a.id }); marker.closePopup(); }, 'on');
    button(btns, 'METAR', async () => {
      wx.textContent = 'loading…';
      try {
        const r = await api('/api/metar?ids=' + a.id);
        wx.textContent = r.data && r.data.length ? r.data[0].rawOb : (r.error || 'no METAR for ' + a.id);
      } catch (e) { wx.textContent = 'weather unavailable'; }
    });
    marker.bindPopup(box, { maxWidth: 360, className: 'mp-popup' }).openPopup();
    try {
      const d = await api('/api/airport?id=' + encodeURIComponent(a.id));
      det.innerHTML = '';
      (d.rw || []).forEach((r) => el('div', { text: `RWY ${r[0]}  ${r[1].toLocaleString('en-US')} ft  ${r[2]}${r[3] ? '  lit' : ''}` }, det));
      (d.fq || []).slice(0, 8).forEach((f) => el('div', { class: 'fq', text: `${f[0]}  ${f[2]}  ${f[1]}` }, det));
      if (!d.rw || (!d.rw.length && !d.fq.length)) det.textContent = 'no runway / frequency data';
    } catch (e) { det.textContent = ''; }
  }

  function offerDb(state) {
    if (state === 'downloading') { say('Airport database is downloading…'); pollDb(); return; }
    if (offerDb.asked) return;
    offerDb.asked = true;
    const box = el('div', { class: 'mp-offer' }, root);
    el('div', { text: 'Show airports on the map? The bridge can download the free OurAirports database (about 15 MB, once).' }, box);
    const row = el('div', { class: 'mp-pop-b' }, box);
    button(row, 'DOWNLOAD', async () => { box.remove(); await api('/api/airportdb?download=1'); pollDb(); }, 'on');
    button(row, 'NOT NOW', () => box.remove());
  }
  async function pollDb() {
    const r = await api('/api/airportdb');
    if (r.state === 'downloading') { say('Airport database: ' + r.msg, 2500); setTimeout(pollDb, 2000); }
    else if (r.state === 'ready') { say('Airport database ready: ' + r.msg); loadAirports(); }
    else say('Airport database: ' + r.msg, 6000);
  }

  // ------------------------------------------------------------------ nearest
  async function toggleNearest() {
    if (!nearestBox.classList.contains('hidden')) { nearestBox.classList.add('hidden'); return; }
    nearestBox.classList.remove('hidden');
    nearestBox.textContent = lastPos ? 'loading…' : 'waiting for aircraft position…';
    if (!lastPos) return;
    const heli = store.get('nearHeli', false);
    const r = await api(`/api/nearest?lat=${lastPos[0]}&lon=${lastPos[1]}&n=10&heli=${heli ? 1 : 0}`);
    nearestBox.innerHTML = '';
    if (r.state !== 'ready') { nearestBox.textContent = 'Airport database not downloaded yet.'; offerDb(r.state); return; }
    const head = el('div', { class: 'mp-pop-b' }, nearestBox);
    const refresh = (h) => { store.set('nearHeli', h); nearestBox.classList.add('hidden'); toggleNearest(); };
    button(head, 'AIRPORTS', () => refresh(false), heli ? '' : 'on');
    button(head, '+ HELIPADS', () => refresh(true), heli ? 'on' : '');
    r.airports.forEach((a) => {
      const row = el('button', { class: 'mp-near', type: 'button' }, nearestBox);
      el('b', { text: a.id }, row);
      el('span', { class: 'n', text: a.n }, row);
      el('span', { class: 'd', text: `${pad3(a.brg)}°  ${a.dist} nm` }, row);
      const longest = (a.rw || []).reduce((m, x) => Math.max(m, x[1]), 0);
      el('span', { class: 'r', text: a.t === 4 ? 'HELI' : a.t === 3 ? 'WATER' : longest ? longest.toLocaleString('en-US') + ' ft' : '' }, row);
      row.onclick = () => { setTarget({ pos: [a.lat, a.lon], name: a.id }); nearestBox.classList.add('hidden'); if (!follow) map.panTo([a.lat, a.lon]); };
    });
  }

  // ------------------------------------------------------------------ SimBrief route
  function drawRoute() {
    if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; say('Route hidden'); return; }
    let ofp = null;
    try { ofp = JSON.parse(localStorage.getItem('simdash.ofp') || 'null'); } catch (e) { /* none */ }
    if (!ofp || !ofp.fixes) { say('No SimBrief plan yet - load one in the Flight bag › SIMBRIEF tab', 5000); return; }
    const pts = [[ofp.origin.lat, ofp.origin.lon]].concat(ofp.fixes.filter((f) => f.lat !== null).map((f) => [f.lat, f.lon]));
    routeLayer = LL.layerGroup().addTo(map);
    LL.polyline(pts, { color: '#ff00ff', weight: 4, opacity: 0.85 }).addTo(routeLayer);
    ofp.fixes.forEach((f) => {
      if (f.lat === null || f.type === 'ltlg') return;
      LL.circleMarker([f.lat, f.lon], { radius: 4, color: '#ff00ff', fillColor: '#fff', fillOpacity: 1, weight: 2 })
        .bindTooltip(f.id, { permanent: true, direction: 'right', className: 'mp-wpt-label', offset: [5, 0] }).addTo(routeLayer);
    });
    map.fitBounds(LL.latLngBounds(pts).pad(0.1));
    follow = false;
    root.querySelector('.mp-tools .mp-btn').classList.remove('on');
    say(`Route ${ofp.origin.icao} → ${ofp.dest.icao}`);
  }

  // ------------------------------------------------------------------ mount
  async function mount(container) {
    root = el('div', { class: 'mp-root' }, container);
    const mapEl = el('div', { class: 'mp-map' }, root);
    buildUi();
    try {
      LL = await loadLeaflet();
    } catch (e) {
      el('div', { class: 'mp-offer', text: e.message }, root);
      return;
    }
    if (!root) return;
    map = LL.map(mapEl, { zoomControl: false, attributionControl: true, worldCopyJump: true }).setView(store.get('view', [47.45, -122.31]), store.get('zoom', 9));
    setBase(store.get('base', 'Streets'));
    setAip();
    trail = LL.polyline([], { color: '#ffd400', weight: 3, opacity: 0.8, interactive: false }).addTo(map);
    trail.setLatLngs(trailPts);
    targetLine = LL.polyline([], { color: '#ff00ff', weight: 4, dashArray: '10 8', interactive: false }).addTo(map);
    aptLayer = LL.layerGroup().addTo(map);
    map.on('dragstart', () => { if (follow) { follow = false; root.querySelector('.mp-tools .mp-btn').classList.remove('on'); } });
    map.on('zoomend', drawRings);
    map.on('moveend', () => { loadAirports(); store.set('view', [map.getCenter().lat, map.getCenter().lng]); store.set('zoom', map.getZoom()); });
    map.on('contextmenu', (e) => setTarget({ pos: [e.latlng.lat, e.latlng.lng], name: 'USER' }));
    widget = { el: root, keys: ['lat', 'lon', 'hdg_true', 'heading', 'track', 'gs', 'alt'], update };
    Link.register(widget);
    drawRings();
    loadAirports();
    setTimeout(() => map && map.invalidateSize(), 200);
    // "SHOW ON MAP" in the Flight bag's SimBrief page
    try {
      if (JSON.parse(localStorage.getItem('simdash.efb.sb.showOnMap') || 'false')) {
        localStorage.setItem('simdash.efb.sb.showOnMap', 'false');
        setTimeout(drawRoute, 300);
      }
    } catch (e) { /* ignore */ }
  }

  function unmount() {
    if (widget) Link.unregister(widget);
    widget = null;
    if (map) { map.remove(); map = null; }
    plane = rings = target = setTarget.m = routeLayer = base = aip = null;
    root = null;
    lastPos = null;
  }

  global.DASHBOARDS.map = {
    name: 'Moving map', icon: '🗺', sub: 'aircraft, trail, Direct-To, airports, nearest, SimBrief route',
    custom: { mount, unmount }
  };
})(window);
