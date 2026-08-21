/* ══════════════════════════════════════════════════════════════════════
   Visor FEN · Villa María del Triunfo  —  app.js
   Dos vistas: (1) Unidades y vías expuestas · (2) Intervenciones (Informe 054-2026)
   Solo VMT. Sin dominio operacional/comercial, sin directa/indirecta.
   Fuente de exposición: susceptibilidad SIGRID (canal A) ∪ cercanía a los 44
   puntos del evento 16-ago-2026 (canal C). Todo autocontenido en ./data/.
   ══════════════════════════════════════════════════════════════════════ */
const DATA = './data/', BUILD = 'vmt1';
const fmt = n => new Intl.NumberFormat('es-PE', { maximumFractionDigits: 1 }).format(Number(n || 0));
const escapeHtml = s => (s ?? '').toString().replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]));
const escapeAttr = escapeHtml;
const escLabel = m => m < 1000 ? `${m} m` : `${m / 1000} km`;
const norm = s => (s ?? '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// ── Modelo de severidad / peligro ──
const SEV = { 'muy alto': 4, 'alto': 3, 'medio': 2, 'bajo': 1 };
const sevOf = lvl => { const n = norm(lvl); if (n.includes('muy alto')) return 4; if (n.includes('alto')) return 3; if (n.includes('medio')) return 2; if (n.includes('bajo')) return 1; return SEV[n] || 0; };
const SEV_LABEL = ['—', 'Bajo', 'Medio', 'Alto', 'Muy alto'];
const HAZARDS = [{ key: 'inundacion', label: 'Inundación / aniego' }, { key: 'mov_masa', label: 'Mov. en masa' }];
const HAZ_KEYS = HAZARDS.map(h => h.key);
const HAZ_NIVELES = ['Muy alto', 'Alto', 'Medio'];
function pcFamilies(peligro) {
  const s = norm(peligro), o = [];
  if (s.includes('inunda') || s.includes('erosi') || s.includes('aniego') || s.includes('desborde')) o.push('inundacion');
  if (s.includes('detrito') || s.includes('huaico') || s.includes('huayco') || s.includes('flujo') || s.includes('pirca') || s.includes('derrumbe') || s.includes('desliza') || s.includes('desprend') || s.includes('colapso') || s.includes('muro')) o.push('mov_masa');
  return o.length ? o : ['inundacion'];
}
// Rampa de riesgo por nivel compuesto (1..4)
const RAMP = { 4: '#8f0a0a', 3: '#d21f1f', 2: '#e8624a', 1: '#f4c6ba', 0: '#c9ced4' };
const riskColor = lvl => RAMP[Math.max(0, Math.min(4, lvl | 0))];
const metersBetween = (aLat, aLng, bLat, bLng) => { const R = 6371000, dLat = (bLat - aLat) * Math.PI / 180, dLng = (bLng - aLng) * Math.PI / 180, la = (aLat + bLat) / 2 * Math.PI / 180, x = dLng * Math.cos(la), y = dLat; return Math.sqrt(x * x + y * y) * R; };

// ── Zonas municipales VMT ──
const ZONAS = [
  { n: 1, nombre: 'José Carlos Mariátegui' }, { n: 2, nombre: 'Cercado' },
  { n: 3, nombre: 'Inca Pachacútec' }, { n: 4, nombre: 'Nueva Esperanza' },
  { n: 5, nombre: 'Tablada de Lurín' }, { n: 6, nombre: 'José Gálvez' },
  { n: 7, nombre: 'Nuevo Milenio' },
];
const ZLABEL = n => (ZONAS.find(z => z.n === n) || {}).nombre || (n ? 'Zona ' + n : 'Otras áreas');

// ── Tipos de unidad ──
// Etiquetas de los tipos de equipamiento expuesto SIGRID (catálogo CENEPRED)
const EE_LABELS = {
  ee_recursos_respuesta: 'Bomberos y comisarías', ee_transmision: 'Línea de transmisión',
  ee_penitenciarias: 'Penitenciarías', ee_central_hidraulica: 'Central hidráulica',
  ee_hidrocarburos: 'Establecimientos de hidrocarburos', ee_glp: 'Envasadora de GLP',
  ee_ductos: 'Ductos (gas / oleoducto / poliducto)', ee_agencias: 'Agencias bancarias',
  ee_ferroviaria: 'Red ferroviaria', ee_sanitaria: 'Infraestructura sanitaria',
};
let TIPOS = [], TIPO_LABEL = {};
// una vía es 'vias' (vehicular) o 'vias_peatonal' (pasaje/escalera) según su grupo OSM
const unitTipoKey = u => u.tipo === 'vias' ? (u.grupo === 'peatonal' ? 'vias_peatonal' : 'vias') : u.tipo;
const unitTipoLabel = u => TIPO_LABEL[unitTipoKey(u)] || u.tipo;
// Lista de tipos: sociales fijos + un ítem por tipo de equipamiento SIGRID presente en VMT + vías.
function buildTipos() {
  const base = [
    { key: 'colegios', label: 'Colegios', shape: 'circle' },
    { key: 'salud', label: 'Salud', shape: 'square' },
    { key: 'comedores', label: 'Comedores / ollas', shape: 'triangle' },
  ];
  const eePresent = [...new Set((eeUnidades || []).map(e => e.tipo))];
  const eeTipos = eePresent.map(k => ({ key: k, label: EE_LABELS[k] || k, shape: 'diamond', ee: true }));
  TIPOS = [...base, ...eeTipos, { key: 'vias', label: 'Vías', shape: 'line' }, { key: 'vias_peatonal', label: 'Pasajes / escaleras', shape: 'line' }];
  TIPO_LABEL = Object.fromEntries(TIPOS.map(t => [t.key, t.label]));
  exp.tipos = new Set(TIPOS.filter(t => t.key !== 'vias_peatonal').map(t => t.key));  // pasajes/escaleras off por defecto
}

// ── Estado global ──
const state = { scenario: 250, view: 'exposicion' };
const exp = {
  tipos: new Set(['colegios', 'salud', 'comedores', 'ee', 'vias']),  // pasajes/escaleras off por defecto
  haz: new Set(HAZ_KEYS), hazNivel: new Set(HAZ_NIVELES), canal: new Set(['zona', 'punto', 'ambos']),
  zonas: new Set(), qVia: '', showPC: true, showSusc: false, selected: null,
};
const iv = { familias: new Set(HAZ_KEYS), acciones: new Set(), estados: new Set(), zonas: new Set(), selected: null };
// familias de riesgo que atiende una acción: campo explícito del informe, con respaldo al mapeo por texto
const accFamilias = a => (a.familias && a.familias.length) ? a.familias : pcFamilies(a.peligro);

// ── Datos ──
let zonasFC, puntos, colegios, salud, comedores, eeUnidades, canalA, viasFC, suscInund, suscMmasa, intervData;
let UNITS = [];            // universo de exposición precalculado
let me, mi;               // mapas
let mePrev = [], miPrev = [];  // capas efímeras
let distBounds = null;

const VIA_VEHIC = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'service', 'living_street', 'track', 'road', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']);
const viaClaseGrupo = c => VIA_VEHIC.has(c) ? 'vehicular' : 'peatonal';

// Datos: si existe el global VMTDATA (via vmt-data.js) se usan inline —así el visor
// abre con doble clic desde file:// sin servidor. Si no, se bajan por fetch (servido).
async function loadJSON(f) { if (window.VMTDATA && window.VMTDATA[f]) return window.VMTDATA[f]; const r = await fetch(`${DATA}${f}?v=${BUILD}`, { cache: 'no-store' }); if (!r.ok) throw new Error(`${f}: ${r.status}`); return r.json(); }
function tile(map) { L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map); }

/* ─────────── Precálculo del universo de exposición ─────────── */
function nearestPointPerFamily(lat, lng) {
  // punto del evento más cercano por familia de peligro
  const best = { inundacion: null, mov_masa: null };
  for (const f of puntos.features) {
    const c = f.geometry.coordinates, d = metersBetween(lat, lng, c[1], c[0]), p = f.properties;
    for (const fam of pcFamilies(p.peligro)) {
      if (!best[fam] || d < best[fam].dist) best[fam] = { dist: d, nivel: p.nivel, peligro: p.peligro, nombre: p.nombre, zona_n: p.zona_n };
    }
  }
  return best;
}
function buildUnits() {
  UNITS = [];
  const social = [['colegios', colegios], ['salud', salud], ['comedores', comedores]];
  for (const [cap, fc] of social) {
    for (const f of fc.features) {
      const p = f.properties, c = f.geometry.coordinates, id = String(p.entity_id);
      const za = (canalA[cap] && canalA[cap][id]) || {};
      UNITS.push({
        kind: 'point', tipo: cap, id, nombre: p.nombre, lat: c[1], lng: c[0], zona_n: p.zona_n || 0,
        mag: Number(p.mag || 0), magu: p.magu || '', canalA: { inundacion: za.i || '', mov_masa: za.m || '' },
        near: nearestPointPerFamily(c[1], c[0]),
      });
    }
  }
  for (const e of eeUnidades) {
    if (e.lat == null || e.lng == null) continue;
    UNITS.push({
      kind: 'point', tipo: e.tipo || 'ee', id: String(e.id), nombre: e.nombre || e.subtipo || 'Equipamiento', subtipo: e.subtipo || '',
      lat: e.lat, lng: e.lng, zona_n: e.zona_n || 0, mag: 0, magu: '',
      canalA: { inundacion: e.za_i || '', mov_masa: e.za_m || '' }, near: nearestPointPerFamily(e.lat, e.lng),
    });
  }
  for (const f of viasFC.features) {
    const p = f.properties, near = { inundacion: null, mov_masa: null };
    if (p.pc_dist_m != null) { for (const fam of pcFamilies(p.pc_peligro)) near[fam] = { dist: p.pc_dist_m, nivel: p.pc_nivel, peligro: p.pc_peligro }; }
    UNITS.push({
      kind: 'line', tipo: 'vias', id: 'v' + p.osm_id, nombre: p.nombre || '(vía sin nombre)', clase: p.clase,
      grupo: viaClaseGrupo(p.clase), zona_n: p.zona_n || 0, mag: Number(p.long_km || 0), magu: 'km',
      canalA: { inundacion: p.susc_inund || '', mov_masa: p.susc_mmasa || '' }, near, geom: f.geometry,
    });
  }
}
// nivel compuesto de una unidad bajo el escenario y peligros activos
function levelOf(u) {
  let lvl = 0, hasA = false, hasC = false; const per = {};
  for (const fam of exp.haz) {
    const sa = sevOf(u.canalA[fam]); let sc = 0, dist = null, nivC = '';
    const nf = u.near[fam];
    if (nf && nf.dist <= state.scenario) { sc = sevOf(nf.nivel) || 2; dist = nf.dist; nivC = nf.nivel; }
    if (sa > 0) hasA = true; if (sc > 0) hasC = true;
    const s = Math.max(sa, sc); per[fam] = { sev: s, sa, sc, dist, zona: u.canalA[fam], nivC };
    lvl = Math.max(lvl, s);
  }
  const canal = hasA && hasC ? 'ambos' : hasA ? 'zona' : hasC ? 'punto' : '';
  return { lvl, canal, per };
}

/* ─────────── VISTA 1 · EXPOSICIÓN ─────────── */
const chkBar = g => `<div class="chk-actions"><button type="button" data-ca="all" data-g="${g}">Todos</button><button type="button" data-ca="none" data-g="${g}">Limpiar</button></div>`;
function bindCA(box, g, onAll, onNone) { const a = box.querySelector(`[data-ca="all"][data-g="${g}"]`), n = box.querySelector(`[data-ca="none"][data-g="${g}"]`); if (a) a.onclick = onAll; if (n) n.onclick = onNone; }

function expFiltered() {
  const qv = norm(exp.qVia);
  const out = [];
  for (const u of UNITS) {
    if (!exp.tipos.has(unitTipoKey(u))) continue;
    if (exp.zonas.size && !exp.zonas.has(u.zona_n)) continue;
    if (qv && u.tipo !== 'vias') continue;
    if (qv && !norm(u.nombre).includes(qv)) continue;
    const L = levelOf(u);
    if (L.lvl <= 0) continue;
    if (exp.hazNivel.size < HAZ_NIVELES.length && !exp.hazNivel.has(SEV_LABEL[L.lvl])) continue;
    if (exp.canal.size < 3 && !exp.canal.has(L.canal)) continue;
    u._L = L; out.push(u);
  }
  // orden: nivel desc, luego cercanía (menor dist) / magnitud
  out.sort((a, b) => b._L.lvl - a._L.lvl || minDist(a) - minDist(b) || (b.mag || 0) - (a.mag || 0));
  return out;
}
function minDist(u) { let d = Infinity; for (const fam of exp.haz) { const p = u._L.per[fam]; if (p && p.dist != null) d = Math.min(d, p.dist); } return d; }

// íconos por tipo (forma) + color por riesgo
function unitIcon(u, sel) {
  const c = riskColor(u._L.lvl), ring = sel ? '#000' : '#fff', bw = sel ? 2.2 : 1.2, sz = sel ? 20 : 12 + u._L.lvl * 2;
  const sh = (TIPOS.find(t => t.key === u.tipo) || {}).shape;
  let inner;
  if (sh === 'circle') inner = `<div style="width:${sz}px;height:${sz}px;border-radius:50%;background:${c};border:${bw}px solid ${ring};box-sizing:border-box"></div>`;
  else if (sh === 'square') inner = `<div style="width:${sz - 2}px;height:${sz - 2}px;background:${c};border:${bw}px solid ${ring};box-sizing:border-box"></div>`;
  else if (sh === 'diamond') inner = `<div style="width:${sz - 3}px;height:${sz - 3}px;background:${c};border:${bw}px solid ${ring};transform:rotate(45deg);box-sizing:border-box"></div>`;
  else { const s = sz + 2; inner = `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><polygon points="12,2.5 22,21.5 2,21.5" fill="${c}" stroke="${ring}" stroke-width="${bw * 1.6}" stroke-linejoin="round"/></svg>`; }
  const box = sz + 4; return L.divIcon({ className: 'v2-unit-icon', html: inner, iconSize: [box, box], iconAnchor: [box / 2, box / 2] });
}
const CP_GLYPH = {
  inundacion: `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M2 9c2 0 2 1.6 4 1.6S8 9 10 9s2 1.6 4 1.6S16 9 18 9s2 1.6 4 1.6"/><path d="M2 15c2 0 2 1.6 4 1.6S8 15 10 15s2 1.6 4 1.6S16 15 18 15s2 1.6 4 1.6"/></svg>`,
  mov_masa: `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M3 20 L10 8 L14 14 L17 9 L21 20 Z"/></svg>`,
};
const cpIcon = fam => L.divIcon({ className: 'pc-icon', html: `<div class="pc-badge">${CP_GLYPH[fam] || CP_GLYPH.inundacion}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] });
const cpIconHi = fam => L.divIcon({ className: 'pc-icon', html: `<div class="pc-badge pc-badge-hi">${CP_GLYPH[fam] || CP_GLYPH.inundacion}</div>`, iconSize: [32, 32], iconAnchor: [16, 16] });

function renderExpZonas() {
  const box = document.getElementById('expZonas'); if (!box) return;
  box.innerHTML = chkBar('z') + `<div class="checks chk-list">` + ZONAS.map(z => `<label><input type="checkbox" data-z="${z.n}" ${exp.zonas.has(z.n) ? 'checked' : ''}><span class="zlabel"><b class="zn">Zona ${z.n}</b><span class="znm">${escapeHtml(z.nombre)}</span></span></label>`).join('') + `</div>`;
  bindCA(box, 'z', () => { ZONAS.forEach(z => exp.zonas.add(z.n)); renderExp(); }, () => { exp.zonas.clear(); renderExp(); });
  box.querySelectorAll('[data-z]').forEach(el => el.onchange = () => { const n = Number(el.dataset.z); el.checked ? exp.zonas.add(n) : exp.zonas.delete(n); renderExp(); });
}
function renderExpTipos() {
  const box = document.getElementById('expTipos'); if (!box) return;
  box.innerHTML = chkBar('t') + `<div class="checks">` + TIPOS.map(t => `<label><input type="checkbox" data-t="${t.key}" ${exp.tipos.has(t.key) ? 'checked' : ''}>${escapeHtml(t.label)}</label>`).join('') + `</div>`;
  bindCA(box, 't', () => { TIPOS.forEach(t => exp.tipos.add(t.key)); renderExp(); }, () => { exp.tipos.clear(); renderExp(); });
  box.querySelectorAll('[data-t]').forEach(el => el.onchange = () => { const k = el.dataset.t; el.checked ? exp.tipos.add(k) : exp.tipos.delete(k); renderExp(); });
}
function renderExpPeligro() {
  const box = document.getElementById('expPeligro'); if (!box) return;
  let h = `<div class="filter-label">Tipo de riesgo</div>` + chkBar('h') + `<div class="checks">` + HAZARDS.map(hz => `<label><input type="checkbox" data-h="${hz.key}" ${exp.haz.has(hz.key) ? 'checked' : ''}>${escapeHtml(hz.label)}</label>`).join('') + `</div>`;
  h += `<div class="filter-label">Nivel compuesto</div>` + chkBar('hn') + `<div class="checks">` + HAZ_NIVELES.map(v => `<label><input type="checkbox" data-hn="${v}" ${exp.hazNivel.has(v) ? 'checked' : ''}>${v}</label>`).join('') + `</div>`;
  h += `<div class="filter-label">Canal de exposición</div>` + chkBar('cn') + `<div class="checks">` + [['zona', 'Solo susceptibilidad (zona)'], ['punto', 'Solo cercanía a punto crítico'], ['ambos', 'Ambos canales']].map(([v, l]) => `<label><input type="checkbox" data-cn="${v}" ${exp.canal.has(v) ? 'checked' : ''}>${escapeHtml(l)}</label>`).join('') + `</div>`;
  h += `<p class="muted" style="margin-top:6px">El nivel de cada unidad es el mayor entre su susceptibilidad SIGRID y el punto crítico del evento más cercano, dentro del escenario.</p>`;
  box.innerHTML = h;
  bindCA(box, 'h', () => { HAZ_KEYS.forEach(k => exp.haz.add(k)); renderExp(); }, () => { exp.haz.clear(); renderExp(); });
  bindCA(box, 'hn', () => { HAZ_NIVELES.forEach(v => exp.hazNivel.add(v)); renderExp(); }, () => { exp.hazNivel.clear(); renderExp(); });
  bindCA(box, 'cn', () => { ['zona', 'punto', 'ambos'].forEach(v => exp.canal.add(v)); renderExp(); }, () => { exp.canal.clear(); renderExp(); });
  box.querySelectorAll('[data-h]').forEach(el => el.onchange = () => { const k = el.dataset.h; el.checked ? exp.haz.add(k) : exp.haz.delete(k); renderExp(); });
  box.querySelectorAll('[data-hn]').forEach(el => el.onchange = () => { const v = el.dataset.hn; el.checked ? exp.hazNivel.add(v) : exp.hazNivel.delete(v); renderExp(); });
  box.querySelectorAll('[data-cn]').forEach(el => el.onchange = () => { const v = el.dataset.cn; el.checked ? exp.canal.add(v) : exp.canal.delete(v); renderExp(); });
}
function renderExpCapas() {
  const box = document.getElementById('expCapas'); if (!box) return;
  box.innerHTML = `<div class="checks">
    <label><input type="checkbox" id="cxPC" ${exp.showPC ? 'checked' : ''}> Puntos críticos del evento (44)</label>
    <label><input type="checkbox" id="cxSusc" ${exp.showSusc ? 'checked' : ''}> Zonas de susceptibilidad SIGRID</label></div>
    <div class="leyenda-inline" style="margin-top:8px"><span><i style="background:${RAMP[4]}"></i>Muy alto</span><span><i style="background:${RAMP[3]}"></i>Alto</span><span><i style="background:${RAMP[2]}"></i>Medio</span></div>`;
  box.querySelector('#cxPC').onchange = e => { exp.showPC = e.target.checked; renderExp(); };
  box.querySelector('#cxSusc').onchange = e => { exp.showSusc = e.target.checked; renderExp(); };
}
function fillViaSearch() {
  const dl = document.getElementById('expViaList'); if (!dl) return; const s = new Set();
  for (const f of viasFC.features) { const v = (f.properties.nombre || '').trim(); if (v) s.add(v); }
  dl.innerHTML = [...s].sort((a, b) => a.localeCompare(b, 'es')).slice(0, 1200).map(v => `<option value="${escapeAttr(v)}">`).join('');
  const q = document.getElementById('expQVia'); if (q) q.oninput = () => { exp.qVia = q.value; exp.selected = null; renderExp(); };
}

function unitPopup(u) {
  const L = u._L; let rows = '';
  for (const hz of HAZARDS) { if (!exp.haz.has(hz.key)) continue; const p = L.per[hz.key]; if (!p || !p.sev) continue; rows += `<span>Por ${hz.label.toLowerCase()}</span><b class="lv-${p.sev}">${SEV_LABEL[p.sev]}</b>`; if (p.zona) rows += `<span>· susceptibilidad</span><b>${escapeHtml(SEV_LABEL[sevOf(p.zona)])}</b>`; if (p.dist != null) rows += `<span>· punto crítico</span><b>${fmt(p.dist)} m</b>`; }
  const magT = u.mag > 0 ? `<span>${u.tipo === 'vias' ? 'Longitud' : 'Magnitud'}</span><b>${fmt(u.mag)} ${u.magu}${u.tipo !== 'vias' && u.magu ? '' : ''}</b>` : '';
  return `<b>${escapeHtml(u.nombre)}</b><div class="muted" style="margin:2px 0 0">${escapeHtml(unitTipoLabel(u))}${u.subtipo ? ' · ' + escapeHtml(u.subtipo) : ''}${u.zona_n ? ' · Zona ' + u.zona_n : ''}${u.clase ? ' · ' + escapeHtml(u.clase) : ''}</div><div class="popup-grid" style="margin-top:8px"><span>Nivel de exposición</span><b class="lv-${L.lvl}">${SEV_LABEL[L.lvl]}</b>${rows}${magT}</div>`;
}
function pcPopup(p) {
  return `<b>Punto crítico · ${escapeHtml(p.peligro || '—')}</b><div class="muted" style="margin:2px 0 0">${escapeHtml(p.nombre || '')}${p.zona_nombre ? ' · ' + escapeHtml(p.zona_nombre) : ''}</div><div class="popup-grid" style="margin-top:6px"><span>Nivel</span><b>${escapeHtml(p.nivel || '—')}</b>${p.descrip ? `<span>Detalle</span><b>${escapeHtml(p.descrip)}</b>` : ''}${p.evento ? `<span>Evento</span><b>${escapeHtml(p.evento)}</b>` : ''}</div>`;
}

// latlng representativa de una unidad (punto = su coord; vía = punto medio de la traza)
function unitLatLng(u) {
  if (u.lat != null && u.lng != null) return [u.lat, u.lng];
  if (u.geom) { const cs = flattenCoords(u.geom); if (cs.length) { const m = cs[Math.floor(cs.length / 2)]; return [m[1], m[0]]; } }
  return null;
}
function flattenCoords(geom) { const cs = []; (function w(c) { if (typeof c[0] === 'number') { cs.push(c); return; } c.forEach(w); })(geom.coordinates); return cs; }
// Puntos del evento que exponen a la unidad: dentro del escenario y de un peligro activo.
function connectingPoints(u) {
  const coords = u.geom ? flattenCoords(u.geom) : (u.lat != null ? [[u.lng, u.lat]] : []);
  if (!coords.length) return [];
  const out = [];
  for (const f of puntos.features) {
    const p = f.properties, c = f.geometry.coordinates;
    if (!pcFamilies(p.peligro).some(fam => exp.haz.has(fam))) continue;
    let d = Infinity; for (const cc of coords) { const dd = metersBetween(cc[1], cc[0], c[1], c[0]); if (dd < d) d = dd; }
    if (d <= state.scenario) out.push({ lat: c[1], lng: c[0], dist: Math.round(d), peligro: p.peligro, nivel: p.nivel });
  }
  out.sort((a, b) => a.dist - b.dist);
  return out;
}
function renderExp() {
  renderExpZonas(); renderExpTipos(); renderExpPeligro(); renderExpCapas();
  const units = expFiltered();
  mePrev.forEach(l => me.removeLayer(l)); mePrev = [];
  // zonas (polígonos) + límite
  const zsel = f => exp.zonas.size === 0 || exp.zonas.has(f.properties.zona_n);
  const zl = L.geoJSON(zonasFC, { style: f => ({ color: '#8a8a8a', weight: f.properties.zona_n ? 1.2 : 0.6, fillColor: '#454545', fillOpacity: zsel(f) && f.properties.zona_n ? 0.05 : 0, dashArray: f.properties.zona_n ? null : '3,3' }), onEachFeature: (f, l) => { if (f.properties.zona_n) l.bindTooltip(`Zona ${f.properties.zona_n} · ${f.properties.zona_nombre}`, { sticky: true }); } });
  zl.addTo(me); mePrev.push(zl);
  // susceptibilidad (overlay)
  if (exp.showSusc) {
    for (const [g, col] of [[suscInund, '#3b82c4'], [suscMmasa, '#b5651d']]) {
      const sl = L.geoJSON(g, { style: f => ({ color: col, weight: 0, fillColor: col, fillOpacity: f.properties.nivel === 'Muy alto' ? 0.28 : f.properties.nivel === 'Alto' ? 0.2 : 0.12 }), interactive: false }); sl.addTo(me); mePrev.push(sl);
    }
  }
  // vías expuestas (líneas coloreadas)
  const viaU = units.filter(u => u.kind === 'line' && u.geom);
  if (viaU.length) {
    const vl = L.geoJSON({ type: 'FeatureCollection', features: viaU.map(u => ({ type: 'Feature', geometry: u.geom, properties: { k: u.id } })) }, { style: f => { const u = viaU.find(x => x.id === f.properties.k), sel = u.id === exp.selected, dim = exp.selected && !sel; return sel ? { color: '#111', weight: 5, opacity: 1 } : { color: riskColor(u._L.lvl), weight: dim ? 1.4 : 3.2, opacity: dim ? .18 : .9 }; }, onEachFeature: (f, l) => { const u = viaU.find(x => x.id === f.properties.k); l.on('click', () => { exp.selected = exp.selected === u.id ? null : u.id; renderExp(); }); } });
    vl.addTo(me); mePrev.push(vl);
  }
  // unidades puntuales
  const ptU = units.filter(u => u.kind === 'point');
  const ul = L.geoJSON({ type: 'FeatureCollection', features: ptU.map(u => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [u.lng, u.lat] }, properties: { k: u.id } })) }, { pointToLayer: (f, ll) => { const u = ptU.find(x => x.id === f.properties.k), sel = u.id === exp.selected; return L.marker(ll, { icon: unitIcon(u, sel), zIndexOffset: sel ? 1000 : 0, opacity: (exp.selected && !sel) ? 0.25 : 1 }); }, onEachFeature: (f, l) => { const u = ptU.find(x => x.id === f.properties.k); l.on('click', () => { exp.selected = exp.selected === u.id ? null : u.id; renderExp(); }); } });
  ul.addTo(me); mePrev.push(ul);
  // puntos críticos del evento — con selección, solo se resaltan los que exponen al elegido; el resto se atenúa
  const su0 = exp.selected ? units.find(u => u.id === exp.selected) : null;
  const conn = su0 ? connectingPoints(su0) : [];
  const connSet = new Set(conn.map(c => c.lat + ',' + c.lng));
  if (exp.showPC) {
    const pcs = puntos.features.filter(f => (exp.zonas.size === 0 || exp.zonas.has(f.properties.zona_n)) && !connSet.has(f.geometry.coordinates[1] + ',' + f.geometry.coordinates[0]));
    const pl = L.geoJSON({ type: 'FeatureCollection', features: pcs }, {
      pointToLayer: (f, ll) => su0
        ? L.circleMarker(ll, { radius: 3, color: '#9aa0a6', weight: .5, fillColor: '#c3c7cc', fillOpacity: .45 })
        : L.marker(ll, { icon: cpIcon(pcFamilies(f.properties.peligro)[0]), zIndexOffset: 500 }),
      onEachFeature: (f, l) => l.bindPopup(pcPopup(f.properties))
    }); pl.addTo(me); mePrev.push(pl);
  }
  // puntos que conectan con el elemento seleccionado: badge resaltado + línea de conexión
  if (su0 && conn.length) {
    const sll = unitLatLng(su0);
    conn.forEach(pc => {
      if (sll) { const link = L.polyline([sll, [pc.lat, pc.lng]], { color: '#111', weight: 1.6, opacity: .8, dashArray: '4,4', interactive: false }); link.addTo(me); mePrev.push(link); }
      const mk = L.marker([pc.lat, pc.lng], { icon: cpIconHi(pcFamilies(pc.peligro)[0]), zIndexOffset: 2000 });
      mk.bindPopup(`<b>Punto crítico que lo expone</b><div class="popup-grid" style="margin-top:6px"><span>Distancia</span><b>${fmt(pc.dist)} m</b><span>Peligro</span><b>${escapeHtml(pc.peligro || '—')}</b><span>Nivel</span><b>${escapeHtml(pc.nivel || '—')}</b></div>`);
      mk.addTo(me); mePrev.push(mk);
    });
  }
  // KPIs + lista
  const byTipo = { colegios: 0, salud: 0, comedores: 0, ee: 0, vias: 0, vias_peatonal: 0 };
  units.forEach(u => { const k = unitTipoKey(u); if (k in byTipo) byTipo[k]++; else if (String(u.tipo).startsWith('ee')) byTipo.ee++; });
  document.getElementById('expKpis').innerHTML = `<div class="kpi"><b>${fmt(byTipo.colegios)}</b><span>Colegios</span></div><div class="kpi"><b>${fmt(byTipo.salud)}</b><span>Salud</span></div><div class="kpi"><b>${fmt(byTipo.comedores)}</b><span>Comedores</span></div><div class="kpi"><b>${fmt(byTipo.ee)}</b><span>Otros equip.</span></div><div class="kpi"><b>${fmt(byTipo.vias)}</b><span>Vías</span></div><div class="kpi"><b>${fmt(byTipo.vias_peatonal)}</b><span>Pasajes/esc.</span></div><div class="kpi"><b>${fmt(units.length)}</b><span>Total expuestas</span></div>`;
  document.getElementById('expCount').textContent = fmt(units.length);
  document.getElementById('expSubtitle').textContent = `Escenario ${escLabel(state.scenario)} · orden por nivel de exposición.`;
  const list = document.getElementById('expList');
  list.innerHTML = units.length ? units.slice(0, 400).map((u, i) => expRow(u, i)).join('') + (units.length > 400 ? `<div class="empty-list">Mostrando 400 de ${fmt(units.length)}. Afina los filtros.</div>` : '') : `<div class="empty-list">No hay unidades expuestas con los filtros y escenario actuales.</div>`;
  list.querySelectorAll('.affected-item').forEach(el => el.onclick = () => { const k = el.dataset.k; exp.selected = exp.selected === k ? null : k; renderExp(); if (exp.selected) { const u = units.find(x => x.id === k), ll = u && unitLatLng(u); if (ll) me.setView(ll, u.kind === 'line' ? 16 : 15); } });
  // Popup de la unidad seleccionada (por ranking o por clic en el mapa): uno solo, se abre al cambiar la selección.
  const su = exp.selected ? units.find(u => u.id === exp.selected) : null;
  if (su) { const ll = unitLatLng(su); if (ll && me._selKey !== su.id) { me._selKey = su.id; if (me._selPopup) me.closePopup(me._selPopup); me._selPopup = L.popup({ offset: [0, -6], autoPan: true, maxWidth: 300 }).setLatLng(ll).setContent(unitPopup(su)).openOn(me); } }
  else { me._selKey = null; if (me._selPopup) { me.closePopup(me._selPopup); me._selPopup = null; } }
}
function expRow(u, i) {
  const L = u._L, fams = HAZARDS.filter(hz => exp.haz.has(hz.key) && L.per[hz.key] && L.per[hz.key].sev).map(hz => hz.label.toLowerCase()).join(' · ');
  const magT = u.mag > 0 ? `${fmt(u.mag)} ${u.magu}` : (u.magu ? '' : '');
  const dist = minDist(u); const distT = isFinite(dist) ? `${fmt(dist)} m al punto crítico` : 'en zona de susceptibilidad';
  return `<div class="affected-item${u.id === exp.selected ? ' sel' : ''}" data-k="${escapeAttr(u.id)}"><div class="rank" style="background:${riskColor(L.lvl)}">${i + 1}</div><div><h4>${escapeHtml(unitTipoLabel(u))} · ${escapeHtml(u.nombre)}</h4><div class="meta"><b class="lv-${L.lvl}">${SEV_LABEL[L.lvl]}</b>${fams ? ' · por ' + escapeHtml(fams) : ''}${u.zona_n ? ' · Zona ' + u.zona_n : ''}</div><div class="meta">${distT}${magT ? ' · ' + magT : ''}</div></div></div>`;
}

/* ─────────── VISTA 2 · INTERVENCIONES ─────────── */
const EST = ['Por desplegar', 'En gestión', 'Ejecutada'];
const estIdx = e => Math.max(0, EST.indexOf(e));
const EST_COL = ['#b3261e', '#b8860b', '#1b6b33'];
const LS_KEY = 'vmt-intervenciones-estado';
function estadoStore() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { return {}; } }
function estadoOf(a) { const s = estadoStore(); return s[a.id] || a.estado || 'Por desplegar'; }
function setEstado(id, val) { const s = estadoStore(); s[id] = val; localStorage.setItem(LS_KEY, JSON.stringify(s)); }

function ivFiltered() {
  return intervData.acciones.filter(a => {
    if (iv.familias.size < HAZ_KEYS.length && !accFamilias(a).some(f => iv.familias.has(f))) return false;
    if (iv.acciones.size && !iv.acciones.has(a.id)) return false;
    if (iv.estados.size && !iv.estados.has(estadoOf(a))) return false;
    if (iv.zonas.size && !a.zonas.some(z => iv.zonas.has(z))) return false;
    return true;
  });
}
function renderIntFilters() {
  const br = document.getElementById('intRiesgo');
  if (br) {
    br.innerHTML = chkBar('ir') + `<div class="checks">` + HAZARDS.map(hz => `<label><input type="checkbox" data-ir="${hz.key}" ${iv.familias.has(hz.key) ? 'checked' : ''}>${escapeHtml(hz.label)}</label>`).join('') + `</div><p class="muted" style="margin-top:6px">Filtra las acciones por el peligro que atienden. El informe es sobre todo aniego/inundación; solo el Plan de GRD toca laderas.</p>`;
    bindCA(br, 'ir', () => { HAZ_KEYS.forEach(k => iv.familias.add(k)); renderInt(); }, () => { iv.familias.clear(); renderInt(); });
    br.querySelectorAll('[data-ir]').forEach(el => el.onchange = () => { const k = el.dataset.ir; el.checked ? iv.familias.add(k) : iv.familias.delete(k); renderInt(); });
  }

  const ba = document.getElementById('intAcciones');
  ba.innerHTML = chkBar('a') + `<div class="checks chk-list">` + intervData.acciones.map(a => `<label><input type="checkbox" data-a="${a.id}" ${iv.acciones.has(a.id) ? 'checked' : ''}><span class="zlabel"><b class="zn zn-badge">${a.id}</b><span class="znm">${escapeHtml(a.accion)}</span></span></label>`).join('') + `</div>`;
  bindCA(ba, 'a', () => { intervData.acciones.forEach(a => iv.acciones.add(a.id)); renderInt(); }, () => { iv.acciones.clear(); renderInt(); });
  ba.querySelectorAll('[data-a]').forEach(el => el.onchange = () => { const k = el.dataset.a; el.checked ? iv.acciones.add(k) : iv.acciones.delete(k); renderInt(); });

  const be = document.getElementById('intEstados');
  be.innerHTML = `<div class="checks">` + EST.map((e, i) => `<label><input type="checkbox" data-e="${escapeAttr(e)}" ${iv.estados.has(e) ? 'checked' : ''}><span class="estado-chip est-${i}">${e}</span></label>`).join('') + `</div>`;
  be.querySelectorAll('[data-e]').forEach(el => el.onchange = () => { const k = el.dataset.e; el.checked ? iv.estados.add(k) : iv.estados.delete(k); renderInt(); });

  const bz = document.getElementById('intZonas');
  bz.innerHTML = chkBar('iz') + `<div class="checks chk-list">` + ZONAS.map(z => `<label><input type="checkbox" data-iz="${z.n}" ${iv.zonas.has(z.n) ? 'checked' : ''}><span class="zlabel"><b class="zn">Zona ${z.n}</b><span class="znm">${escapeHtml(z.nombre)}</span></span></label>`).join('') + `</div>`;
  bindCA(bz, 'iz', () => { ZONAS.forEach(z => iv.zonas.add(z.n)); renderInt(); }, () => { iv.zonas.clear(); renderInt(); });
  bz.querySelectorAll('[data-iz]').forEach(el => el.onchange = () => { const n = Number(el.dataset.iz); el.checked ? iv.zonas.add(n) : iv.zonas.delete(n); renderInt(); });

  document.getElementById('intFuente').innerHTML = `<p>${escapeHtml(intervData.fuente)}</p><p class="muted">${escapeHtml(intervData.evento)}</p><p class="muted">${escapeHtml(intervData.nota_estado)}</p>`;
}
function zoneMarkers(list) {
  // por zona: nº de intervenciones activas + peor estado (menor idx = más urgente)
  const byZona = new Map();
  for (const a of list) { const e = estIdx(estadoOf(a)); for (const z of a.zonas) { if (iv.zonas.size && !iv.zonas.has(z)) continue; const cur = byZona.get(z) || { n: 0, worst: 2 }; cur.n++; cur.worst = Math.min(cur.worst, e); byZona.set(z, cur); } }
  return byZona;
}
function renderInt() {
  renderIntFilters();
  const list = ivFiltered();
  miPrev.forEach(l => mi.removeLayer(l)); miPrev = [];
  // zonas
  const selZ = iv.selected ? new Set(intervData.acciones.find(a => a.id === iv.selected)?.zonas || []) : null;
  const zl = L.geoJSON(zonasFC, { style: f => { const on = selZ ? selZ.has(f.properties.zona_n) : true; return { color: '#8a8a8a', weight: f.properties.zona_n ? 1.3 : 0.6, fillColor: on && f.properties.zona_n ? '#ffd7d7' : '#eee', fillOpacity: f.properties.zona_n ? (on ? 0.35 : 0.08) : 0, dashArray: f.properties.zona_n ? null : '3,3' }; }, onEachFeature: (f, l) => { if (f.properties.zona_n) l.bindTooltip(`Zona ${f.properties.zona_n} · ${f.properties.zona_nombre}`, { sticky: true }); } });
  zl.addTo(mi); miPrev.push(zl);
  // puntos del evento (contexto)
  const pl = L.geoJSON(puntos, { pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 3.2, color: '#888', weight: .6, fillColor: '#bbb', fillOpacity: .7 }), onEachFeature: (f, l) => l.bindPopup(pcPopup(f.properties)), interactive: true }); pl.addTo(mi); miPrev.push(pl);
  // badges por zona
  const byZona = zoneMarkers(list);
  const lg = L.layerGroup();
  for (const f of zonasFC.features) {
    const zn = f.properties.zona_n; if (!zn) continue;
    const info = byZona.get(zn); const col = info ? EST_COL[info.worst] : '#c9ced4', n = info ? info.n : 0;
    const html = `<div class="zb"><div class="zb-dot" style="background:${col}">${n}</div><div class="zb-lb">Zona ${zn}</div></div>`;
    const mk = L.marker([f.properties.clat, f.properties.clng], { icon: L.divIcon({ className: 'zone-badge', html, iconSize: [60, 46], iconAnchor: [30, 23] }), zIndexOffset: 800 });
    mk.on('click', () => { iv.zonas = iv.zonas.has(zn) && iv.zonas.size === 1 ? new Set() : new Set([zn]); iv.selected = null; renderInt(); });
    mk.bindTooltip(`Zona ${zn} · ${escapeHtml(ZLABEL(zn))} — ${n} intervención(es)`, { direction: 'top' });
    lg.addLayer(mk);
  }
  lg.addTo(mi); miPrev.push(lg);
  // KPIs
  const cnt = [0, 0, 0]; intervData.acciones.forEach(a => cnt[estIdx(estadoOf(a))]++);
  document.getElementById('intKpis').innerHTML = `<div class="kpi"><b>${cnt[0]}</b><span>Por desplegar</span></div><div class="kpi"><b>${cnt[1]}</b><span>En gestión</span></div><div class="kpi"><b>${cnt[2]}</b><span>Ejecutadas</span></div><div class="kpi"><b>${intervData.acciones.length}</b><span>Acciones totales</span></div>`;
  document.getElementById('intCount').textContent = fmt(list.length);
  // lista
  const box = document.getElementById('intList');
  box.innerHTML = list.length ? list.map(a => ivCard(a)).join('') : `<div class="empty-list">Ninguna intervención con los filtros actuales.</div>`;
  box.querySelectorAll('.iv-item').forEach(el => {
    el.querySelector('.iv-body').onclick = () => { iv.selected = iv.selected === el.dataset.id ? null : el.dataset.id; renderInt(); if (iv.selected) fitZonas(intervData.acciones.find(a => a.id === iv.selected).zonas); };
    const sel = el.querySelector('.estado-sel'); if (sel) sel.onchange = e => { e.stopPropagation(); setEstado(el.dataset.id, sel.value); renderInt(); };
  });
}
function ivCard(a) {
  const est = estadoOf(a), ei = estIdx(est), sel = a.id === iv.selected;
  const zonas = a.zonas.map(z => `<span class="zchip${(!iv.zonas.size || iv.zonas.has(z)) ? ' on' : ''}">Z${z}</span>`).join('');
  return `<div class="iv-item${sel ? ' sel' : ''}" data-id="${a.id}"><div class="iv-body" style="cursor:pointer">
    <div class="iv-head"><h4 class="iv-title">${escapeHtml(a.accion)}</h4><span class="iv-id">${a.id}</span></div>
    <div class="iv-desc">${escapeHtml(a.descripcion)}</div>
    <div class="iv-qty">▸ ${escapeHtml(a.cantidad)}</div>
    <div class="iv-meta">Peligro: <b>${escapeHtml(a.peligro)}</b> · ${escapeHtml(a.origen)}</div>
    <div class="iv-zonas">${zonas}</div></div>
    <div class="estado-row"><span class="estado-chip est-${ei}">${est}</span>
      <select class="estado-sel">${EST.map(e => `<option ${e === est ? 'selected' : ''}>${e}</option>`).join('')}</select></div></div>`;
}
function fitZonas(zns) {
  const feats = zonasFC.features.filter(f => zns.includes(f.properties.zona_n));
  if (feats.length) { try { const b = L.geoJSON({ type: 'FeatureCollection', features: feats }).getBounds(); if (b.isValid()) mi.fitBounds(b, { padding: [30, 30], maxZoom: 14 }); } catch (e) { } }
}

/* ─────────── Setup ─────────── */
function fitDistrict(map) { if (distBounds && distBounds.isValid()) map.fitBounds(distBounds, { padding: [20, 20], maxZoom: 14 }); }
function setupTabs() {
  document.querySelectorAll('.tab').forEach(b => b.onclick = () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active')); b.classList.add('active');
    state.view = b.dataset.view;
    document.querySelectorAll('.view').forEach(x => x.classList.remove('active'));
    document.getElementById(state.view === 'exposicion' ? 'exposicionView' : 'intervencionesView').classList.add('active');
    document.getElementById('scenarioWrap').style.visibility = state.view === 'exposicion' ? 'visible' : 'hidden';
    location.hash = state.view;
    setTimeout(() => { if (state.view === 'exposicion') { me.invalidateSize(); fitDistrict(me); } else { mi.invalidateSize(); fitDistrict(mi); } }, 60);
  });
}
async function init() {
  me = L.map('mapExp', { zoomControl: false, preferCanvas: true }).setView([-12.17, -76.93], 12); tile(me); L.control.zoom({ position: 'bottomright' }).addTo(me);
  mi = L.map('mapInt', { zoomControl: false, preferCanvas: true }).setView([-12.17, -76.93], 12); tile(mi); L.control.zoom({ position: 'bottomright' }).addTo(mi);
  [zonasFC, puntos, colegios, salud, comedores, eeUnidades, canalA, viasFC, suscInund, suscMmasa, intervData] = await Promise.all([
    loadJSON('zonas-vmt.geojson'), loadJSON('puntos-criticos-vmt.geojson'), loadJSON('colegios.geojson'), loadJSON('salud.geojson'),
    loadJSON('comedores.geojson'), loadJSON('ee-unidades-vmt.json'), loadJSON('canalA-vmt.json'), loadJSON('vias-vmt.geojson'),
    loadJSON('susc_inundacion.geojson'), loadJSON('susc_mmasa.geojson'), loadJSON('intervenciones-vmt.json'),
  ]);
  try { distBounds = L.geoJSON(zonasFC).getBounds(); } catch (e) { distBounds = null; }
  buildTipos();
  buildUnits();
  document.getElementById('scenarioBtns').onclick = e => { const m = e.target.dataset.m; if (!m) return; state.scenario = Number(m); document.querySelectorAll('#scenarioBtns button').forEach(b => b.classList.toggle('active', Number(b.dataset.m) === state.scenario)); renderExp(); };
  document.getElementById('resetExp').onclick = () => { me.invalidateSize(); fitDistrict(me); };
  document.getElementById('resetInt').onclick = () => { mi.invalidateSize(); fitDistrict(mi); };
  setupTabs(); fillViaSearch();
  renderExp(); renderInt();
  fitDistrict(me); fitDistrict(mi);
  const hv = (location.hash || '').replace('#', ''); if (hv === 'intervenciones') { const t = document.querySelector('.tab[data-view="intervenciones"]'); if (t) t.click(); }
}
init().catch(e => { console.error(e); document.body.insertAdjacentHTML('beforeend', `<div style="position:fixed;inset:20px;background:#fff;z-index:99999;padding:30px;border:3px solid red;overflow:auto"><b>Error:</b><pre>${escapeHtml(e.stack || e.message)}</pre></div>`); });
