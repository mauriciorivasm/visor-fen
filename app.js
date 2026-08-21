const BUILD='2.3.3';
const DATA='./data/';
const state={scenario:500,metric:'alumnos_afectados',mode:'filtered',singleCritical:null,
  territory:{departamento:new Set(),provincia:new Set(),distrito:new Set(),zona:new Set(),influencia:new Set()},
  hazard:{ficha:new Set(),tipo:new Set(),nivel:new Set(),medida:new Set()},
  layers:{colegios:true,salud:true,comedores:true,puentes:true,progresol:true,carreteras:true,cultivos:true},
  prioScope:'influencia'
};
// filtros propios del universo "territorio comercial" (los 5,521 puntos CENEPRED del mercado)
const stateTC={dep:new Set(),prov:new Set(),dist:new Set(),ficha:new Set(),nivel:new Set(),
  soloEmergencia:false,soloFondes:false,soloInfluencia:false};
const fmt=n=>new Intl.NumberFormat('es-PE',{maximumFractionDigits:1}).format(Number(n||0));
const escLabel=m=>m<1000?`${m} m`:`${m/1000} km`;
const norm=s=>(s??'').toString().trim().toLocaleLowerCase('es');
const splitNorm=(s,def)=>{const t=(s??'').toString().trim();return (t?t.split('|').map(x=>x.trim()).filter(Boolean):[def]);};
const metricLabels={alumnos_afectados:'Alumnos potencialmente expuestos',colegios_afectados:'Locales educativos potencialmente expuestos',salud_afectados:'Establecimientos de salud',comedores_afectados:'Comedores / ollas',usuarios_afectados:'Usuarios de comedores',puentes_afectados:'Puentes',vias_km_afectadas:'Km de vías',cultivos_ha_afectados:'Ha de cultivos',puntos_criticos:'Puntos críticos',progresol_afectados:'Progresol potencialmente expuestos'};
const typeLabels={colegios:'Local educativo',salud:'Establecimiento de salud',comedores:'Comedor / olla',puentes:'Puente',progresol:'Progresol',carreteras:'Vía',cultivos:'Área de cultivo'};
let subzones,criticals,relations,roadRelations,cropRelations,roadSegments,roads,crops; const assets={};
let puntosTerr=null;   // capa ampliada: puntos criticos CENEPRED en todo el territorio comercial
// Vista 2 (Unidades expuestas): capas operacional/comercial nacionales + indices
let concesiones=null,corredores=null,progresolNac=null,corredoresPC=null,deptos=null,unidadesOp=null,terrComercial=null,viasDS=null,viasSociales=null,viasLocales=null,viasAcceso=null;
let canalASocial=null; // canal A (zona de susceptibilidad) por elemento social: {capa:{entity_id:{i,m}}} — ver web/data/build_canalA_social.py
let colegiosPadron={}; // datos clave del padron de escuelas (data-territorial) keyed por cod_local — ver web/data/build_padron_colegios.py; alimenta la descarga CSV de colegios del ranking
let eeUnidades=null,eeCatalogo=null; // Elementos expuestos SIGRID (bomberos/comisarías, penitenciarías, hidrocarburos, agencias, etc.): ampliación del catálogo social (contrato V4 §6). Cada unidad trae su canal A (za_i/za_m) y sus puntos críticos (pcs).
// Zonas de propensidad (vector tiles): capa SOLO del prototipo. La app real NO define SUSC_TILES_URL
// ni carga protomaps-leaflet → el toggle no aparece y syncSuscLayer() queda inerte aquí. El proto
// define SUSC_TILES_URL en su header (prototipo _proto/mod2.js) y sí carga protomaps.
let relByEntity={},criticalById=new Map(),critGeomById=new Map(),v2Bounds=null;
let pointIndex={}, roadSegIndex={}, cropIndex={};
let relByCritical={},roadRelByCritical={},cropRelByCritical={};
let mt,md,terrZoneLayer,detailZoneLayer,terrCriticalLayer,detailCriticalLayer,terrLabels,detailLabels;
let detailAssetLayers={},affectedRoadLayer,affectedCropLayer,individualBufferLayer;
let lastCalc=null;

async function loadJSON(f){const r=await fetch(`${DATA}${f}?v=${BUILD}`,{cache:'no-store'});if(!r.ok)throw new Error(`${f}: ${r.status}`);return r.json()}
function tile(map){L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(map)}
function makeMaps(){mt=L.map('mapTerritorial',{zoomControl:false,preferCanvas:true}).setView([-12.1,-76.9],9);tile(mt);L.control.zoom({position:'bottomright'}).addTo(mt);md=L.map('mapDetail',{zoomControl:false,preferCanvas:true}).setView([-12.1,-76.9],9);tile(md);L.control.zoom({position:'bottomright'}).addTo(md)}

function catalogFromCritical(field,def){const m=new Map();criticals.features.forEach(f=>splitNorm(f.properties[field],def).forEach(v=>{const k=norm(v);if(!m.has(k))m.set(k,v)}));return [...m.values()].sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'}))}
function allSubProps(){return subzones.features.map(f=>f.properties)}
function availableTerritory(dim){let rows=allSubProps();const order=['departamento','provincia','distrito','zona'];const prop={departamento:'DEPARTAMEN',provincia:'PROVINCIA',distrito:'DISTRITO',zona:'Zonas'};const idx=order.indexOf(dim);for(let i=0;i<idx;i++){const d=order[i],sel=state.territory[d];if(sel.size)rows=rows.filter(r=>sel.has(r[prop[d]]))}if(dim==='influencia'){for(const d of order){const sel=state.territory[d];if(sel.size)rows=rows.filter(r=>sel.has(r[prop[d]]))}return [...new Set(rows.map(r=>r.tipo_influencia).filter(Boolean))].sort()}return [...new Set(rows.map(r=>r[prop[dim]]).filter(Boolean))].sort()}
function validateTerritory(){for(const dim of ['provincia','distrito','zona','influencia']){const avail=new Set(availableTerritory(dim));for(const v of [...state.territory[dim]])if(!avail.has(v))state.territory[dim].delete(v)}}
function multiHTML(title,dim,values,selected,group){const count=selected.size?`${selected.size} sel.`:'Todas';return `<div class="filter-label">${title}</div><div class="multi"><div class="multi-head"><span>${count}</span><span class="multi-actions"><button data-clear="${group}:${dim}">Limpiar</button></span></div><div class="multi-options">${values.map(v=>`<label><input type="checkbox" data-group="${group}" data-dim="${dim}" value="${escapeAttr(v)}" ${selected.has(v)?'checked':''}>${escapeHtml(v)}</label>`).join('')}</div></div>`}
function escapeHtml(s){return (s??'').toString().replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}
function escapeAttr(s){return escapeHtml(s)}
function renderFilters(){const territory=`${multiHTML('Departamento','departamento',availableTerritory('departamento'),state.territory.departamento,'territory')}${multiHTML('Provincia','provincia',availableTerritory('provincia'),state.territory.provincia,'territory')}${multiHTML('Distrito','distrito',availableTerritory('distrito'),state.territory.distrito,'territory')}${multiHTML('Zona / subzona','zona',availableTerritory('zona'),state.territory.zona,'territory')}${multiHTML('Tipo de influencia','influencia',availableTerritory('influencia'),state.territory.influencia,'territory')}<button class="btn-clear" data-clear-all="territory">Restablecer territorio</button>`;
const hazard=`${multiHTML('Tipo Ficha','ficha',catalogFromCritical('tipo_ficha_norm','Sin tipo de ficha'),state.hazard.ficha,'hazard')}${multiHTML('Tipo de peligro','tipo',catalogFromCritical('tipo_peligro_norm','Inundación'),state.hazard.tipo,'hazard')}${multiHTML('Nivel de peligro','nivel',catalogFromCritical('n_peligro_norm','Medio'),state.hazard.nivel,'hazard')}${multiHTML('Medidas de prevención','medida',catalogFromCritical('medidas_norm','Sin medidas'),state.hazard.medida,'hazard')}<button class="btn-clear" data-clear-all="hazard">Restablecer puntos críticos</button>`;
['territoryFiltersTerritorial','territoryFiltersDetail'].forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML=territory});['criticalFiltersTerritorial','criticalFiltersDetail','criticalFiltersPrioriza'].forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML=hazard});bindFilterEvents();renderPrioTerritory()}
function bindFilterEvents(){document.querySelectorAll('input[data-group]').forEach(el=>el.onchange=()=>{const g=el.dataset.group,d=el.dataset.dim,set=state[g][d];el.checked?set.add(el.value):set.delete(el.value);if(g==='territory')validateTerritory();state.singleCritical=null;renderFilters();updateAll(true)});document.querySelectorAll('[data-clear]').forEach(b=>b.onclick=()=>{const [g,d]=b.dataset.clear.split(':');state[g][d].clear();if(g==='territory')validateTerritory();state.singleCritical=null;renderFilters();updateAll(true)});document.querySelectorAll('[data-clear-all]').forEach(b=>b.onclick=()=>{const g=b.dataset.clearAll;Object.values(state[g]).forEach(s=>s.clear());state.singleCritical=null;renderFilters();updateAll(true)})}

function visibleZoneFeatures(){return subzones.features.filter(f=>{const p=f.properties,t=state.territory;return (!t.departamento.size||t.departamento.has(p.DEPARTAMEN))&&(!t.provincia.size||t.provincia.has(p.PROVINCIA))&&(!t.distrito.size||t.distrito.has(p.DISTRITO))&&(!t.zona.size||t.zona.has(p.Zonas))&&(!t.influencia.size||t.influencia.has(p.tipo_influencia))})}
function visibleZoneIds(){return new Set(visibleZoneFeatures().map(f=>String(f.properties.sububigeo)))}
function hazardMatches(p){const h=state.hazard;const checks=[['ficha','tipo_ficha_norm','Sin tipo de ficha'],['tipo','tipo_peligro_norm','Inundación'],['nivel','n_peligro_norm','Medio'],['medida','medidas_norm','Sin medidas']];return checks.every(([d,field,def])=>{if(!h[d].size)return true;const vals=new Set(splitNorm(p[field],def).map(norm));return [...h[d]].some(s=>vals.has(norm(s)))})}
function visibleCriticals(){const ids=visibleZoneIds();return criticals.features.filter(f=>ids.has(String(f.properties.sububigeo)))}
function matchingCriticals(){return visibleCriticals().filter(f=>hazardMatches(f.properties))}
function activeCriticalIds(){if(state.mode==='single')return state.singleCritical?new Set([String(state.singleCritical)]):new Set();return new Set(matchingCriticals().map(f=>String(f.properties.critical_id)))}

function indexData(){for(const [type,fc] of Object.entries(assets)){pointIndex[type]=new Map(fc.features.map(f=>[String(f.properties.entity_id),f]))}roadSegIndex=new Map(roadSegments.features.map(f=>[String(f.properties.segment_id),f]));cropIndex=new Map(crops.features.map(f=>[String(f.properties.asset_id),f]));relations.forEach(r=>(relByCritical[String(r.critical_id)]??=[]).push(r));roadRelations.forEach(r=>(roadRelByCritical[String(r.critical_id)]??=[]).push(r));cropRelations.forEach(r=>(cropRelByCritical[String(r.critical_id)]??=[]).push(r))}
function exposureSets(){const active=activeCriticalIds(),pointMaps={colegios:new Map(),salud:new Map(),comedores:new Map(),puentes:new Map(),progresol:new Map()},roadMap=new Map(),cropMap=new Map();for(const cid of active){for(const r of relByCritical[cid]||[]){if(Number(r.distance_m)>state.scenario)continue;const m=pointMaps[r.entity_type];if(!m)continue;const k=String(r.entity_id),prev=m.get(k);if(!prev||r.distance_m<prev.distance)m.set(k,{distance:Number(r.distance_m),criticalCount:(prev?.criticalCount||0)+1});else prev.criticalCount++}for(const r of roadRelByCritical[cid]||[]){if(Number(r.distance_m)>state.scenario)continue;const k=String(r.segment_id),prev=roadMap.get(k);if(!prev||r.distance_m<prev.distance)roadMap.set(k,{distance:Number(r.distance_m),criticalCount:(prev?.criticalCount||0)+1});else prev.criticalCount++}for(const r of cropRelByCritical[cid]||[]){if(Number(r.distance_m)>state.scenario)continue;const k=String(r.asset_id),prev=cropMap.get(k);if(!prev||r.distance_m<prev.distance)cropMap.set(k,{distance:Number(r.distance_m),criticalCount:(prev?.criticalCount||0)+1});else prev.criticalCount++}}return {pointMaps,roadMap,cropMap}}
function cropExposure(cropMap){const active=matchingCriticals().filter(f=>activeCriticalIds().has(String(f.properties.critical_id)));if(!active.length||!cropMap.size)return {byAsset:new Map(),features:[]};let union=null;const bufs=active.map(f=>turf.buffer(f,state.scenario/1000,{units:'kilometers',steps:12}));try{if(bufs.length===1)union=bufs[0];else union=turf.union(turf.featureCollection(bufs))}catch(e){try{union=bufs[0];for(let i=1;i<bufs.length;i++)union=turf.union(union,bufs[i])}catch(e2){console.warn('No se pudo unir buffers',e2);union=null}}const byAsset=new Map(),features=[];for(const [id,info] of cropMap){const f=cropIndex.get(id);if(!f)continue;let inter=null,ha=0;try{if(union){try{inter=turf.intersect(turf.featureCollection([f,union]))}catch(e){inter=turf.intersect(f,union)}if(inter)ha=turf.area(inter)/10000}}catch(e){console.warn('crop intersect',id,e)}if(!union){ha=0}if(ha>0){byAsset.set(id,{...info,ha});if(inter){inter.properties={...(f.properties||{}),entity_type:'cultivos',exposed_ha:ha,asset_id:id};features.push(inter)}}}return {byAsset,features}}

function calculate(){const zones=visibleZoneFeatures(),zoneIds=new Set(zones.map(f=>String(f.properties.sububigeo))),matching=matchingCriticals(),active=activeCriticalIds(),exp=exposureSets(),cropExp=cropExposure(exp.cropMap);const zstats=new Map(zones.map(f=>[String(f.properties.sububigeo),{puntos_criticos:0,colegios_afectados:0,alumnos_afectados:0,salud_afectados:0,comedores_afectados:0,usuarios_afectados:0,puentes_afectados:0,progresol_afectados:0,vias_km_afectadas:0,cultivos_ha_afectados:0}]));matching.forEach(f=>{if(active.has(String(f.properties.critical_id))){const z=zstats.get(String(f.properties.sububigeo));if(z)z.puntos_criticos++}});
for(const [type,map] of Object.entries(exp.pointMaps)){for(const id of map.keys()){const f=pointIndex[type].get(id);if(!f||!zoneIds.has(String(f.properties.sububigeo)))continue;const z=zstats.get(String(f.properties.sububigeo));z[`${type}_afectados`]++;if(type==='colegios')z.alumnos_afectados+=Number(f.properties.TALUMNO||0);if(type==='comedores')z.usuarios_afectados+=Number(f.properties.usuarios||0)}}
for(const sid of exp.roadMap.keys()){const f=roadSegIndex.get(sid);if(!f||!zoneIds.has(String(f.properties.sububigeo)))continue;zstats.get(String(f.properties.sububigeo)).vias_km_afectadas+=Number(f.properties.segment_length_km||0)}
for(const [id,info] of cropExp.byAsset){const f=cropIndex.get(id);if(!f||!zoneIds.has(String(f.properties.sububigeo)))continue;zstats.get(String(f.properties.sububigeo)).cultivos_ha_afectados+=info.ha}
return {zones,zoneIds,matching,active,exp,cropExp,zstats}}

function breaks(vals){const a=vals.filter(v=>v>0).sort((a,b)=>a-b);if(!a.length)return [0,1,2,3,4];const q=p=>a[Math.min(a.length-1,Math.floor((a.length-1)*p))];return [0,q(.25),q(.5),q(.75),a[a.length-1]]}
function redScale(v,b){if(v<=0)return '#eeeeee';if(v<=b[1])return '#ffd7d7';if(v<=b[2])return '#ffaaaa';if(v<=b[3])return '#ff6262';return '#ff0000'}
function zonePopup(p,s){return `<b>${escapeHtml(p.DISTRITO||'')}</b><br>${escapeHtml(p.Zonas||'')}<div class="popup-grid"><span>Puntos críticos</span><b>${fmt(s.puntos_criticos)}</b><span>Colegios</span><b>${fmt(s.colegios_afectados)}</b><span>Alumnos</span><b>${fmt(s.alumnos_afectados)}</b><span>Salud</span><b>${fmt(s.salud_afectados)}</b><span>Comedores / ollas</span><b>${fmt(s.comedores_afectados)}</b><span>Usuarios</span><b>${fmt(s.usuarios_afectados)}</b><span>Puentes</span><b>${fmt(s.puentes_afectados)}</b><span>Progresol</span><b>${fmt(s.progresol_afectados)}</b><span>Vías expuestas</span><b>${fmt(s.vias_km_afectadas)} km</b><span>Cultivos expuestos</span><b>${fmt(s.cultivos_ha_afectados)} ha</b></div>`}
function criticalPopup(p){const url=(p.url||'').trim();return `<b>${escapeHtml(p.nom_sector||'Punto crítico')}</b><div class="popup-grid"><span>Tipo ficha</span><b>${escapeHtml(p.tipo_ficha_norm||'Sin tipo de ficha')}</b><span>Tipo peligro</span><b>${escapeHtml(p.tipo_peligro_norm||'Inundación')}</b><span>Nivel</span><b>${escapeHtml(p.n_peligro_norm||'Medio')}</b><span>Distrito</span><b>${escapeHtml(p.nom_dist||p.DISTRITO||'-')}</b><span>Periodo</span><b>${escapeHtml(p.periodo||'-')}</b><span>Hab. reportados</span><b>${fmt(p.e_habitant)}</b><span>II.EE. reportadas</span><b>${fmt(p.e_iiee)}</b><span>EE.SS. reportados</span><b>${fmt(p.e_eess)}</b><span>Ha reportadas</span><b>${fmt(p.e_area_cul)}</b><span>Puentes reportados</span><b>${fmt(p.e_puentes)}</b></div>${p.descrip?`<p>${escapeHtml(p.descrip)}</p>`:''}${url&&/^https?:/i.test(url)?`<a class="popup-url" href="${escapeAttr(url)}" target="_blank" rel="noopener">Abrir ficha fuente ↗</a>`:''}`}
function addLabels(map,features,oldGroup){if(oldGroup)map.removeLayer(oldGroup);const g=L.layerGroup();features.forEach(f=>{try{const c=turf.centroid(f).geometry.coordinates;const p=f.properties;L.marker([c[1],c[0]],{interactive:false,icon:L.divIcon({className:'zone-label',html:`<div class="abbr">${escapeHtml(p.abreviatura||p.DISTRITO||'')}</div><div class="zone">${escapeHtml(p.Zonas||'')}</div>`,iconSize:[130,34],iconAnchor:[65,17]})}).addTo(g)}catch(e){}});g.addTo(map);return g}

function renderTerritorial(calc){if(terrZoneLayer)mt.removeLayer(terrZoneLayer);const vals=calc.zones.map(f=>calc.zstats.get(String(f.properties.sububigeo))?.[state.metric]||0),br=breaks(vals);terrZoneLayer=L.geoJSON({type:'FeatureCollection',features:calc.zones},{style:f=>{const s=calc.zstats.get(String(f.properties.sububigeo)),v=s?.[state.metric]||0;return {color:'#555',weight:1.2,fillColor:redScale(v,br),fillOpacity:.72}},onEachFeature:(f,l)=>l.bindPopup(zonePopup(f.properties,calc.zstats.get(String(f.properties.sububigeo))))}).addTo(mt);terrLabels=addLabels(mt,calc.zones,terrLabels);
if(terrCriticalLayer)mt.removeLayer(terrCriticalLayer);const visible=visibleCriticals();terrCriticalLayer=L.geoJSON({type:'FeatureCollection',features:visible},{pointToLayer:(f,ll)=>{const ok=hazardMatches(f.properties);return L.circleMarker(ll,{radius:ok?5:4,color:ok?'#fff':'#777',weight:ok?1.2:.7,fillColor:ok?'#111':'#a4a4a4',fillOpacity:ok?0.95:0.48})},onEachFeature:(f,l)=>l.bindPopup(criticalPopup(f.properties))}).addTo(mt);
const totals=aggregateTotals(calc);document.getElementById('territorialKpis').innerHTML=kpiHTML(totals);document.getElementById('legendBody').innerHTML=[['Sin exposición','#eee'],[`> 0 – ${fmt(br[1])}`,'#ffd7d7'],[`${fmt(br[1])} – ${fmt(br[2])}`,'#ffaaaa'],[`${fmt(br[2])} – ${fmt(br[3])}`,'#ff6262'],[`> ${fmt(br[3])}`,'#ff0000']].map(x=>`<div class="legend-row"><span class="swatch" style="background:${x[1]}"></span>${x[0]}</div>`).join('');}
function aggregateTotals(calc){const t={puntos_criticos:0,colegios_afectados:0,alumnos_afectados:0,salud_afectados:0,comedores_afectados:0,usuarios_afectados:0,puentes_afectados:0,progresol_afectados:0,vias_km_afectadas:0,cultivos_ha_afectados:0};for(const s of calc.zstats.values())for(const k in t)t[k]+=Number(s[k]||0);return t}
function kpiHTML(t){return `<div class="kpi"><b>${fmt(t.puntos_criticos)}</b><span>Puntos críticos</span></div><div class="kpi"><b>${fmt(t.colegios_afectados)}</b><span>Locales educativos</span></div><div class="kpi"><b>${fmt(t.alumnos_afectados)}</b><span>Alumnos</span></div><div class="kpi"><b>${fmt(t.salud_afectados)}</b><span>Salud</span></div><div class="kpi"><b>${fmt(t.comedores_afectados)}</b><span>Comedores / ollas</span></div><div class="kpi"><b>${fmt(t.usuarios_afectados)}</b><span>Usuarios</span></div><div class="kpi"><b>${fmt(t.puentes_afectados)}</b><span>Puentes</span></div><div class="kpi"><b>${fmt(t.progresol_afectados)}</b><span>Progresol</span></div><div class="kpi"><b>${fmt(t.vias_km_afectadas)} km</b><span>Vías</span></div><div class="kpi"><b>${fmt(t.cultivos_ha_afectados)} ha</b><span>Cultivos</span></div>`}

function assetPopup(type,p){if(type==='colegios')return `<b>${escapeHtml(p.CEN_EDU||'Colegio')}</b><br>${escapeHtml(p.D_NIV_MOD||'')}<div class="popup-grid"><span>Alumnos</span><b>${fmt(p.TALUMNO)}</b><span>Distrito</span><b>${escapeHtml(p.DISTRITO||'-')}</b></div>`;if(type==='salud')return `<b>${escapeHtml(p['Nombre del establecimiento']||'Salud')}</b><br>${escapeHtml(p.Categoria||p.Clasificación||'')}<div class="popup-grid"><span>Camas registradas</span><b>${fmt(p.CAMAS)}</b><span>Distrito</span><b>${escapeHtml(p.DISTRITO||'-')}</b></div>`;if(type==='comedores')return `<b>${escapeHtml(p.nombre||'Comedor / olla')}</b><br>${escapeHtml(p.tipo||'')}<div class="popup-grid"><span>Usuarios</span><b>${fmt(p.usuarios)}</b><span>Distrito</span><b>${escapeHtml(p.DISTRITO||'-')}</b></div>`;if(type==='puentes')return `<b>${escapeHtml(p.v_nom_infr||'Puente')}</b><br>${escapeHtml(p.estado||'')}<br>${escapeHtml(p.DISTRITO||'')}`;if(type==='progresol')return `<b>${escapeHtml(p['NOMBRE COMERCIAL']||'Progresol')}</b><br>${escapeHtml(p['TIPO DE PDV']||'')}<div class="popup-grid"><span>RUC</span><b>${escapeHtml(p.RUC||'-')}</b><span>Distrito</span><b>${escapeHtml(p.DISTRITO||'-')}</b></div>`;return ''}

function criticalXIcon(ok,sel=false){const color=sel?'#ff0000':(ok?'#111111':'#9a9a9a');const size=sel?22:(ok?18:16);return L.divIcon({className:'critical-x-wrap',html:`<span class="critical-x" style="color:${color};font-size:${size}px">×</span>`,iconSize:[size,size],iconAnchor:[size/2,size/2]})}

function renderDetail(calc){if(detailZoneLayer)md.removeLayer(detailZoneLayer);detailZoneLayer=L.geoJSON({type:'FeatureCollection',features:calc.zones},{style:{color:'#17365d',weight:2,fillColor:'#fff',fillOpacity:.025},onEachFeature:(f,l)=>l.bindPopup(zonePopup(f.properties,calc.zstats.get(String(f.properties.sububigeo))))}).addTo(md);detailLabels=addLabels(md,calc.zones,detailLabels);
if(detailCriticalLayer)md.removeLayer(detailCriticalLayer);detailCriticalLayer=L.geoJSON({type:'FeatureCollection',features:visibleCriticals()},{pointToLayer:(f,ll)=>{const ok=hazardMatches(f.properties),sel=String(f.properties.critical_id)===String(state.singleCritical);return L.marker(ll,{icon:criticalXIcon(ok,sel)})},onEachFeature:(f,l)=>{l.bindPopup(criticalPopup(f.properties));l.on('click',()=>{if(state.mode==='single'&&hazardMatches(f.properties)){state.singleCritical=String(f.properties.critical_id);updateAll(false)}})}}).addTo(md);
for(const [k,l] of Object.entries(detailAssetLayers)){if(l)md.removeLayer(l)}detailAssetLayers={};const zoneIds=calc.zoneIds;
for(const type of ['colegios','salud','comedores','puentes','progresol']){if(!state.layers[type])continue;const feats=assets[type].features.filter(f=>zoneIds.has(String(f.properties.sububigeo)));const affected=calc.exp.pointMaps[type];detailAssetLayers[type]=L.geoJSON({type:'FeatureCollection',features:feats},{pointToLayer:(f,ll)=>{const on=affected.has(String(f.properties.entity_id));return L.circleMarker(ll,{radius:on?5.8:4,color:on?'#fff':'#252b32',weight:on?1.5:1,fillColor:on?'#ff0000':'#46505a',fillOpacity:on?0.95:0.78})},onEachFeature:(f,l)=>l.bindPopup(assetPopup(type,f.properties))}).addTo(md)}
if(detailAssetLayers.carreteras)md.removeLayer(detailAssetLayers.carreteras);if(state.layers.carreteras){const feats=roads.features.filter(f=>zoneIds.has(String(f.properties.sububigeo)));detailAssetLayers.carreteras=L.geoJSON({type:'FeatureCollection',features:feats},{style:{color:'#e3b505',weight:2.2,opacity:.78}}).addTo(md)}if(affectedRoadLayer)md.removeLayer(affectedRoadLayer);if(state.layers.carreteras){const aff=[...calc.exp.roadMap.keys()].map(id=>roadSegIndex.get(id)).filter(Boolean);affectedRoadLayer=L.geoJSON({type:'FeatureCollection',features:aff},{style:{color:'#ff0000',weight:5.5,opacity:1}}).addTo(md)}
if(detailAssetLayers.cultivos)md.removeLayer(detailAssetLayers.cultivos);if(state.layers.cultivos){const feats=crops.features.filter(f=>zoneIds.has(String(f.properties.sububigeo)));detailAssetLayers.cultivos=L.geoJSON({type:'FeatureCollection',features:feats},{style:{color:'#5f8f5f',weight:1.2,fillColor:'#8fbc8f',fillOpacity:.18}}).addTo(md)}if(affectedCropLayer)md.removeLayer(affectedCropLayer);if(state.layers.cultivos&&calc.cropExp.features.length)affectedCropLayer=L.geoJSON({type:'FeatureCollection',features:calc.cropExp.features},{style:{color:'#ff0000',weight:2.4,fillColor:'#ff0000',fillOpacity:.32}}).addTo(md);
if(individualBufferLayer)md.removeLayer(individualBufferLayer);individualBufferLayer=null;if(state.mode==='single'&&state.singleCritical){const f=criticals.features.find(x=>String(x.properties.critical_id)===String(state.singleCritical));if(f)individualBufferLayer=L.geoJSON(turf.buffer(f,state.scenario/1000,{units:'kilometers',steps:24}),{style:{color:'#ff0000',weight:2,dashArray:'7 5',fillColor:'#ff0000',fillOpacity:.06}}).addTo(md)}
document.getElementById('detailKpis').innerHTML=kpiHTML(aggregateTotals(calc));renderAffectedList(calc);renderSelectedPoint();}

function rating(distance){const r=distance/Math.max(state.scenario,1);return r<=.2?5:r<=.4?4:r<=.6?3:r<=.8?2:1}
function stars(n){return `<span class="rating">${[1,2,3,4,5].map(i=>`<span class="star ${i<=n?'on':''}">★</span>`).join('')}</span>`}
function renderAffectedList(calc){const entries=[];for(const [type,map] of Object.entries(calc.exp.pointMaps)){if(!state.layers[type])continue;for(const [id,info] of map){const f=pointIndex[type].get(id);if(!f||!calc.zoneIds.has(String(f.properties.sububigeo)))continue;const p=f.properties;let name='',people=0,metric='';if(type==='colegios'){name=p.CEN_EDU||'Local educativo';people=Number(p.TALUMNO||0);metric=`${fmt(people)} alumnos`}else if(type==='comedores'){name=p.nombre||'Comedor / olla';people=Number(p.usuarios||0);metric=`${fmt(people)} usuarios`}else if(type==='salud'){name=p['Nombre del establecimiento']||'Establecimiento de salud';metric='Usuarios: 0'}else if(type==='progresol'){name=p['NOMBRE COMERCIAL']||'Progresol';metric='Usuarios: 0'}else{name=p.v_nom_infr||'Puente';metric='Usuarios: 0'}entries.push({type,name,people,distance:info.distance,metric})}}
const roadGroups=new Map();if(state.layers.carreteras)for(const [sid,info] of calc.exp.roadMap){const f=roadSegIndex.get(sid);if(!f||!calc.zoneIds.has(String(f.properties.sububigeo)))continue;const id=String(f.properties.asset_id),g=roadGroups.get(id)||{type:'carreteras',name:f.properties.road_name||'Tramo vial',people:0,distance:Infinity,km:0};g.km+=Number(f.properties.segment_length_km||0);g.distance=Math.min(g.distance,info.distance);roadGroups.set(id,g)}for(const g of roadGroups.values()){g.metric=`${fmt(g.km)} km expuestos`;entries.push(g)}
if(state.layers.cultivos)for(const [id,info] of calc.cropExp.byAsset){const f=cropIndex.get(id);if(!f||!calc.zoneIds.has(String(f.properties.sububigeo)))continue;entries.push({type:'cultivos',name:f.properties.CATEGORIA||f.properties.NOMBDIST||'Área de cultivo',people:0,distance:info.distance,metric:`${fmt(info.ha)} ha expuestas`})}
entries.sort((a,b)=>a.distance-b.distance||b.people-a.people||a.name.localeCompare(b.name,'es'));document.getElementById('listCount').textContent=fmt(entries.length);document.getElementById('listSubtitle').textContent=`Escenario ${escLabel(state.scenario)} · cercanía primero; personas como desempate.`;document.getElementById('affectedList').innerHTML=entries.length?entries.map((e,i)=>`<div class="affected-item"><div class="rank">${i+1}</div><div><h4>${escapeHtml(typeLabels[e.type])} - ${escapeHtml(e.name)} ${stars(rating(e.distance))}</h4><div class="meta">${fmt(e.distance)} m al punto crítico más cercano · ${escapeHtml(e.metric)}</div></div></div>`).join(''):`<div class="empty-list">No hay elementos expuestos con los filtros y escenario actuales.</div>`}
function renderSelectedPoint(){const box=document.getElementById('selectedPoint'),hint=document.getElementById('singleHint');hint.classList.toggle('hidden',state.mode!=='single');if(state.mode!=='single'){box.innerHTML='';return}if(!state.singleCritical){box.innerHTML='<p class="muted">Aún no has seleccionado un punto.</p>';return}const f=criticals.features.find(x=>String(x.properties.critical_id)===String(state.singleCritical));if(!f){box.innerHTML='';return}const p=f.properties;box.innerHTML=`<div class="point-card"><span class="tag">${escapeHtml(p.n_peligro_norm||'Medio')}</span><h3>${escapeHtml(p.nom_sector||'Punto crítico')}</h3><dl><dt>Distrito</dt><dd>${escapeHtml(p.nom_dist||p.DISTRITO||'-')}</dd><dt>Tipo</dt><dd>${escapeHtml(p.tipo_peligro_norm||'Inundación')}</dd><dt>Escenario</dt><dd>${escLabel(state.scenario)}</dd></dl></div>`}

function fitMapToZones(map){if(map===mp&&state.prioScope==='comercial'){if(tcBounds&&tcBounds.isValid())map.fitBounds(tcBounds,{padding:[20,20],maxZoom:12});return}if(map===md){if(v2Bounds&&v2Bounds.isValid())map.fitBounds(v2Bounds,{padding:[20,20],maxZoom:13});return}const feats=(lastCalc?.zones||visibleZoneFeatures());if(!feats.length)return;const temp=L.geoJSON({type:'FeatureCollection',features:feats});const b=temp.getBounds();if(b.isValid())map.fitBounds(b,{padding:[20,20],maxZoom:13})}
function resetActiveMap(view){setTimeout(()=>{const map=view==='territorial'?mt:(view==='prioriza'?mp:md);if(!map)return;map.invalidateSize();fitMapToZones(map)},100)}
function updateAll(fit=false){/* Build "solo Unidades expuestas": no corre motor territorial ni cartera; solo renderExpuestas(). */renderExpuestas();if(fit){fitMapToZones(md)}}
function setupControls(){document.getElementById('metricSelect').value=state.metric;document.getElementById('metricSelect').onchange=e=>{state.metric=e.target.value;updateAll(false)};document.getElementById('scenarioBtns').onclick=e=>{const m=e.target.dataset.m;if(!m)return;state.scenario=Number(m);document.querySelectorAll('#scenarioBtns button').forEach(b=>b.classList.toggle('active',Number(b.dataset.m)===state.scenario));updateAll(false)};const amEl=document.getElementById('analysisMode');if(amEl)amEl.onchange=e=>{state.mode=e.target.value;state.singleCritical=null;updateAll(false)};const lcEl=document.getElementById('layerChecks');if(lcEl){lcEl.innerHTML=Object.keys(state.layers).map(k=>`<label><input type="checkbox" data-layer="${k}" ${state.layers[k]?'checked':''}>${typeLabels[k]}</label>`).join('');document.querySelectorAll('#layerChecks input').forEach(x=>x.onchange=()=>{state.layers[x.dataset.layer]=x.checked;updateAll(false)})}document.getElementById('resetTerritorial').onclick=()=>resetActiveMap('territorial');document.getElementById('resetDetail').onclick=()=>resetActiveMap('detail');const v2sp=document.getElementById('v2SoloProyecto');if(v2sp)v2sp.onchange=()=>{v2.soloProyecto=v2sp.checked;renderExpuestas()};const viewIds={territorial:'territorialView',detail:'detailView',prioriza:'priorizaView'};document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));b.classList.add('active');document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));document.getElementById(viewIds[b.dataset.view]).classList.add('active');location.hash=b.dataset.view;if(b.dataset.view==='prioriza'){renderPrioriza();resetActiveMap('prioriza')}else resetActiveMap(b.dataset.view)});document.getElementById('resetPrioriza').onclick=()=>resetActiveMap('prioriza');const v2exp=document.getElementById('v2Export');if(v2exp)v2exp.onclick=exportColegiosCsv;
const scopeBtns=document.getElementById('prioScopeBtns');if(scopeBtns)scopeBtns.onclick=e=>{const s=e.target.dataset.scope;if(!s||s===state.prioScope)return;state.prioScope=s;priorizaSelected=null;scopeBtns.querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.scope===s));const inf=s==='influencia';document.getElementById('prioInfluenciaOnly').classList.toggle('hidden',!inf);document.getElementById('prioComercialFiltros').classList.toggle('hidden',inf);document.getElementById('scopeHint').textContent=inf?'55 proyectos de prevención en los 13 distritos de influencia, puntuados por proximidad a los activos mapeados.':'5,521 puntos críticos del inventario de la ANA en el mercado UNACEM, puntuados por la exposición declarada en la ficha + FONDES + emergencia.';if(inf){renderFilters()}renderPrioriza();resetActiveMap('prioriza')}}

/* ===== V3 prototipo · Cartera priorizada de proyectos de intervención ===== */
let mp,priorizaZoneLayer,priorizaHistLayer,priorizaProjLayer,priorizaBufferLayer,priorizaAssetLayer,priorizaSelected=null;
const CRITERIOS=[{key:'peligro',label:'Nivel de peligro',w:25,dom:'amenaza'},{key:'social_pop',label:'Población social en riesgo',w:25,dom:'social'},{key:'social_act',label:'Activos sociales expuestos',w:20,dom:'social'},{key:'comercial',label:'Exposición comercial (PDV)',w:15,dom:'comercial'},{key:'operacional',label:'Exposición operacional',w:15,dom:'operacional',pendiente:true}];
const CRITDOM={amenaza:'#111',social:'#ff0000',comercial:'#b06a00',operacional:'#9aa0a8'};
const NIVEL_SCORE={alto:1,'muy alto':1,medio:0.6,bajo:0.3};
const NEAR_TYPES=['colegios','salud','comedores','progresol'];
let prioNear=new Set(),prioMenu=null;
const PRIO_TERR=[['departamento','Departamento'],['provincia','Provincia'],['distrito','Distrito'],['zona','Zona / subzona'],['influencia','Tipo de influencia']];
function renderPrioTerritory(){const box=document.getElementById('territoryFiltersPrioriza');if(!box)return;box.innerHTML=PRIO_TERR.map(([dim,label])=>{const opts=availableTerritory(dim),sel=state.territory[dim],open=prioMenu===dim,summary=sel.size?[...sel].join(', '):'Todas';return `<div class="dd${open?' open':''}"><div class="dd-k">${label}</div><div class="dd-b" data-ddtoggle="${dim}"><span class="dd-lb">${escapeHtml(summary)}</span><span class="dd-car">▾</span></div><div class="dd-menu"><label data-ddall="${dim}"><input type="checkbox" ${sel.size?'':'checked'}><span class="dd-todos">Todas</span></label>${opts.map(v=>`<label data-dddim="${dim}" data-ddval="${escapeAttr(v)}"><input type="checkbox" ${sel.has(v)?'checked':''}><span>${escapeHtml(v)}</span></label>`).join('')}</div></div>`}).join('')+`<button class="btn-clear" data-ddclear="1">Restablecer territorio</button>`;bindPrioTerritory()}
function bindPrioTerritory(){const box=document.getElementById('territoryFiltersPrioriza');if(!box)return;box.querySelectorAll('[data-ddtoggle]').forEach(el=>el.onclick=()=>{const d=el.dataset.ddtoggle;prioMenu=prioMenu===d?null:d;renderPrioTerritory()});box.querySelectorAll('[data-dddim]').forEach(el=>{el.querySelector('input').onchange=()=>{const d=el.dataset.dddim,v=el.dataset.ddval,s=state.territory[d];s.has(v)?s.delete(v):s.add(v);validateTerritory();renderPrioTerritory();renderPrioriza()}});box.querySelectorAll('[data-ddall]').forEach(el=>{el.querySelector('input').onchange=()=>{state.territory[el.dataset.ddall].clear();validateTerritory();renderPrioTerritory();renderPrioriza()}});const clr=box.querySelector('[data-ddclear]');if(clr)clr.onclick=()=>{Object.values(state.territory).forEach(s=>s.clear());validateTerritory();prioMenu=null;renderPrioTerritory();renderPrioriza()}}
function isIntervention(p){return (p.tipo_ficha_norm||'').toLowerCase().startsWith('prev')}
function projStats(cid){const s={colegios:0,salud:0,comedores:0,puentes:0,progresol:0},seen={colegios:new Set(),salud:new Set(),comedores:new Set(),puentes:new Set(),progresol:new Set()};let alumnos=0,usuarios=0,minDist=Infinity;for(const r of relByCritical[String(cid)]||[]){if(Number(r.distance_m)>state.scenario)continue;const t=r.entity_type;if(!(t in s))continue;const k=String(r.entity_id);if(seen[t].has(k))continue;seen[t].add(k);s[t]++;minDist=Math.min(minDist,Number(r.distance_m));const f=pointIndex[t]&&pointIndex[t].get(k);if(f){if(t==='colegios')alumnos+=Number(f.properties.TALUMNO||0);if(t==='comedores')usuarios+=Number(f.properties.usuarios||0)}}return {counts:s,alumnos,usuarios,minDist,social_act:s.colegios+s.salud+s.comedores+s.puentes,social_pop:alumnos+usuarios,comercial:s.progresol,operacional:0}}
function priorizaProjects(){const ids=visibleZoneIds(),near=[...prioNear];return criticals.features.filter(f=>{const p=f.properties;if(!(isIntervention(p)&&ids.has(String(p.sububigeo))&&hazardMatches(p)))return false;if(near.length){const st=projStats(p.critical_id);if(!near.every(t=>st.counts[t]>0))return false}return true})}
function totalPrevCount(){return criticals.features.filter(f=>isIntervention(f.properties)).length}
function renderNearChecks(){const box=document.getElementById('nearAssetChecks');if(!box)return;box.innerHTML=NEAR_TYPES.map(t=>`<label><input type="checkbox" data-near="${t}" ${prioNear.has(t)?'checked':''}>${escapeHtml(typeLabels[t]||t)}</label>`).join('');box.querySelectorAll('input').forEach(el=>el.onchange=()=>{el.checked?prioNear.add(el.dataset.near):prioNear.delete(el.dataset.near);renderPrioriza()})}
function scoreProjects(){const rows=priorizaProjects().map(f=>{const p=f.properties,st=projStats(p.critical_id),peligro=NIVEL_SCORE[norm(p.n_peligro_norm||'medio')]??0.6;return {f,p,st,raw:{peligro,social_pop:st.social_pop,social_act:st.social_act,comercial:st.comercial,operacional:0}}});const max={};CRITERIOS.forEach(c=>{max[c.key]=Math.max(1e-9,...rows.map(r=>r.raw[c.key]||0))});const wsum=CRITERIOS.reduce((a,c)=>a+c.w,0)||1;rows.forEach(r=>{let total=0;r.parts={};CRITERIOS.forEach(c=>{const n=c.key==='peligro'?r.raw.peligro:(r.raw[c.key]||0)/max[c.key];const contrib=(c.w/wsum)*n;r.parts[c.key]={n,contrib};total+=contrib});r.score=total});rows.sort((a,b)=>b.score-a.score||b.st.social_pop-a.st.social_pop);return rows}
function renderWeights(){const box=document.getElementById('weightControls');if(!box)return;box.innerHTML=CRITERIOS.map((c,i)=>`<div class="wrow"><div class="wlab"><span><span class="wdot" style="background:${c.pendiente?'#c9ccd1':CRITDOM[c.dom]}"></span>${escapeHtml(c.label)}${c.pendiente?' <span class="pend">datos pendientes</span>':''}</span><b data-pct="${i}"></b></div><input type="range" min="0" max="50" value="${c.w}" data-ci="${i}"></div>`).join('');box.querySelectorAll('input').forEach(el=>el.oninput=()=>{CRITERIOS[Number(el.dataset.ci)].w=Number(el.value);updateWeightPct();renderPrioriza()});updateWeightPct()}
function updateWeightPct(){const wsum=CRITERIOS.reduce((a,c)=>a+c.w,0)||1;document.querySelectorAll('#weightControls [data-pct]').forEach(b=>{b.textContent=Math.round(CRITERIOS[Number(b.dataset.pct)].w/wsum*100)+'%'})}
function ensurePriorizaMap(){if(mp)return;mp=L.map('mapPrioriza',{zoomControl:false,preferCanvas:true}).setView([-12.1,-76.9],9);tile(mp);L.control.zoom({position:'bottomright'}).addTo(mp)}
function priorizaColor(t){if(t>=.8)return '#c00000';if(t>=.6)return '#ff0000';if(t>=.4)return '#ff6262';if(t>=.2)return '#ffaaaa';return '#ffd7d7'}
function projPopup(r){return `<b>${escapeHtml(r.p.nom_sector||'Proyecto')}</b><div class="popup-grid"><span>Ficha</span><b>${escapeHtml(r.p.tipo_ficha_norm||'')}</b><span>Valor en riesgo</span><b>${(r.score*100).toFixed(0)}/100</b><span>Nivel</span><b>${escapeHtml(r.p.n_peligro_norm||'-')}</b><span>Población soc.</span><b>${fmt(r.st.social_pop)}</b><span>Activos soc.</span><b>${fmt(r.st.social_act)}</b><span>PDV</span><b>${fmt(r.st.comercial)}</b></div>${r.p.medid_prev&&r.p.medid_prev.trim().length>2?`<p>${escapeHtml(r.p.medid_prev)}</p>`:''}`}
function priorizaRow(r,i){const sel=String(r.p.critical_id)===String(priorizaSelected),perm=/perman/i.test(r.p.tipo_ficha_norm||''),tipo=perm?'Obra permanente':'Acción temporal';const bars=CRITERIOS.map(c=>`<span class="sb" title="${escapeHtml(c.label)}" style="flex:${Math.max(0.001,r.parts[c.key].contrib)};background:${c.pendiente?'#d3d6da':CRITDOM[c.dom]}"></span>`).join('');const med=(r.p.medid_prev||'').trim();return `<div class="affected-item prioriza-item${sel?' sel':''}" data-cid="${escapeAttr(String(r.p.critical_id))}"><div class="rank">${i+1}</div><div><h4>${escapeHtml(r.p.nom_sector||'Proyecto de intervención')}</h4><div class="meta"><span class="ctag ${perm?'perm':'temp'}">${tipo}</span> · ${escapeHtml(r.p.nom_dist||r.p.DISTRITO||'')} · nivel ${escapeHtml(r.p.n_peligro_norm||'-')}</div><div class="scorebar">${bars}</div><div class="meta">Valor en riesgo <b>${(r.score*100).toFixed(0)}</b>/100 · ${fmt(r.st.social_pop)} pers · ${fmt(r.st.social_act)} act. soc · ${fmt(r.st.comercial)} PDV</div>${med.length>2?`<div class="medida">▸ ${escapeHtml(med)}</div>`:''}</div></div>`}
function renderPrioriza(){if(!criticals)return;ensurePriorizaMap();if(state.prioScope==='comercial'){renderPriorizaComercial();return}if(!document.querySelector('#weightControls input'))renderWeights();if(!document.querySelector('#nearAssetChecks input'))renderNearChecks();const rows=scoreProjects();const zones=visibleZoneFeatures(),ids=visibleZoneIds();
if(priorizaZoneLayer)mp.removeLayer(priorizaZoneLayer);priorizaZoneLayer=L.geoJSON({type:'FeatureCollection',features:zones},{style:{color:'#9aa3ad',weight:1,fillColor:'#fff',fillOpacity:.02},interactive:false}).addTo(mp);
if(priorizaHistLayer)mp.removeLayer(priorizaHistLayer);const hist=criticals.features.filter(f=>!isIntervention(f.properties)&&ids.has(String(f.properties.sububigeo)));priorizaHistLayer=L.geoJSON({type:'FeatureCollection',features:hist},{pointToLayer:(f,ll)=>L.circleMarker(ll,{radius:3,color:'#b7bcc4',weight:.6,fillColor:'#cfd3d9',fillOpacity:.55}),onEachFeature:(f,l)=>l.bindPopup('<b>Peligro histórico</b><br>'+escapeHtml(f.properties.nom_sector||'')+'<br><span class="muted">Contexto de amenaza, no es proyecto.</span>')}).addTo(mp);
if(priorizaProjLayer)mp.removeLayer(priorizaProjLayer);const maxScore=Math.max(1e-9,...rows.map(r=>r.score));priorizaProjLayer=L.geoJSON({type:'FeatureCollection',features:rows.map(r=>r.f)},{pointToLayer:(f,ll)=>{const r=rows.find(x=>x.f===f),sel=String(f.properties.critical_id)===String(priorizaSelected),t=r.score/maxScore;return L.circleMarker(ll,{radius:sel?12:6+t*7,color:sel?'#000':'#fff',weight:sel?2.4:1.2,fillColor:priorizaColor(t),fillOpacity:.92})},onEachFeature:(f,l)=>{l.on('click',()=>{priorizaSelected=String(f.properties.critical_id);renderPrioriza()});l.bindPopup(projPopup(rows.find(x=>x.f===f)))}}).addTo(mp);
if(priorizaBufferLayer){mp.removeLayer(priorizaBufferLayer);priorizaBufferLayer=null}if(priorizaAssetLayer){mp.removeLayer(priorizaAssetLayer);priorizaAssetLayer=null}
if(priorizaSelected){const self=criticals.features.find(x=>String(x.properties.critical_id)===String(priorizaSelected));if(self){priorizaBufferLayer=L.geoJSON(turf.buffer(self,state.scenario/1000,{units:'kilometers',steps:24}),{style:{color:'#ff0000',weight:2,dashArray:'6 5',fillColor:'#ff0000',fillOpacity:.05}}).addTo(mp);const feats=[];for(const r of relByCritical[String(priorizaSelected)]||[]){if(Number(r.distance_m)>state.scenario)continue;const f=pointIndex[r.entity_type]&&pointIndex[r.entity_type].get(String(r.entity_id));if(f)feats.push(f)}priorizaAssetLayer=L.geoJSON({type:'FeatureCollection',features:feats},{pointToLayer:(f,ll)=>L.circleMarker(ll,{radius:4.5,color:'#fff',weight:1,fillColor:'#ff0000',fillOpacity:.9})}).addTo(mp)}}
const t={n:rows.length,perm:rows.filter(r=>/perman/i.test(r.p.tipo_ficha_norm||'')).length,temp:rows.filter(r=>/tempor/i.test(r.p.tipo_ficha_norm||'')).length,pop:rows.reduce((a,r)=>a+r.st.social_pop,0),pdv:rows.reduce((a,r)=>a+r.st.comercial,0)},prev=totalPrevCount();
document.getElementById('priorizaResult').innerHTML=`<div class="funnel">${fmt(prev)} proyectos de prevención <span>→</span> <b>${fmt(t.n)}</b> tras filtros</div><div class="res-grid"><div class="res"><b>${fmt(t.perm)}</b><span>Obra permanente</span></div><div class="res"><b>${fmt(t.temp)}</b><span>Acción temporal</span></div><div class="res"><b>${fmt(t.pop)}</b><span>Población social en riesgo</span></div><div class="res"><b>${fmt(t.pdv)}</b><span>PDV comerciales</span></div><div class="res pend"><b>—</b><span>Activos operacionales · dato pendiente</span></div></div>`;
document.getElementById('priorizaCount').textContent=fmt(rows.length);document.getElementById('priorizaSubtitle').textContent=`Escenario ${escLabel(state.scenario)} · orden por valor en riesgo ponderado.`;document.getElementById('priorizaList').innerHTML=rows.length?rows.map((r,i)=>priorizaRow(r,i)).join(''):`<div class="empty-list">No hay proyectos de intervención con los filtros actuales.</div>`;
document.querySelectorAll('#priorizaList .prioriza-item').forEach(el=>el.onclick=()=>{priorizaSelected=el.dataset.cid;renderPrioriza();const self=criticals.features.find(x=>String(x.properties.critical_id)===String(priorizaSelected));if(self){const c=self.geometry.coordinates;mp.setView([c[1],c[0]],14)}})}

/* ===== V3 · Universo "Territorio comercial" (5,521 puntos CENEPRED del mercado) ===== */
// Puntaje por la exposicion DECLARADA en la ficha CENEPRED (comparable en todo el
// territorio) + elegibilidad de inversion, no por proximidad a activos mapeados (que
// solo existe en la zona de influencia). Fuente: web/data/puntos-criticos-territorio-comercial.geojson.
const CRIT_TC=[
  {key:'peligro',label:'Nivel de peligro',w:20,dom:'amenaza'},
  {key:'poblacion',label:'Población en riesgo (ficha)',w:25,dom:'social'},
  {key:'activos',label:'Activos sociales (II.EE. + EE.SS.)',w:15,dom:'social'},
  {key:'cultivos',label:'Área de cultivo en riesgo',w:10,dom:'social'},
  {key:'fondes',label:'Elegibilidad FONDES (nivel SIGRID)',w:30,dom:'amenaza'},
];
const FONDES_SCORE={'muy alto':1,'alto':0.85,'medio':0.5,'bajo':0.3,'muy bajo':0.15};
let tcSelected=null,tcMenu=null,tcLayer=null,tcHistLayer=null,tcBuffer=null,tcBounds=null;
const numOr0=v=>{const n=Number(v);return isFinite(n)?n:0};
function isInterventionTC(p){return (p.tipo_ficha||'').toLowerCase().startsWith('prev')}
function nivelScore(s){const parts=(s||'').toString().toLowerCase().split(/[,;|]+/).map(x=>x.trim());let m=0;parts.forEach(x=>{if(x.includes('muy alto')||x==='alto')m=Math.max(m,1);else if(x.includes('medio'))m=Math.max(m,0.6);else if(x.includes('bajo'))m=Math.max(m,0.3)});return m||0.6}
function tcAll(){return (puntosTerr&&puntosTerr.features)||[]}
function tcCatalog(dim){let rows=tcAll().filter(f=>isInterventionTC(f.properties));const p=f=>f.properties;
  if(dim!=='dep'&&stateTC.dep.size)rows=rows.filter(f=>stateTC.dep.has(p(f).departamento));
  if(dim==='dist'&&stateTC.prov.size)rows=rows.filter(f=>stateTC.prov.has(p(f).provincia));
  const field={dep:'departamento',prov:'provincia',dist:'distrito'}[dim];
  return [...new Set(rows.map(f=>p(f)[field]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'))}
function tcValidate(){const provOK=new Set(tcCatalog('prov'));[...stateTC.prov].forEach(v=>{if(!provOK.has(v))stateTC.prov.delete(v)});const distOK=new Set(tcCatalog('dist'));[...stateTC.dist].forEach(v=>{if(!distOK.has(v))stateTC.dist.delete(v)})}
function tcFiltered(){const F=tcAll().filter(f=>{const p=f.properties;if(!isInterventionTC(p))return false;
  if(stateTC.dep.size&&!stateTC.dep.has(p.departamento))return false;
  if(stateTC.prov.size&&!stateTC.prov.has(p.provincia))return false;
  if(stateTC.dist.size&&!stateTC.dist.has(p.distrito))return false;
  if(stateTC.nivel.size&&![...stateTC.nivel].some(n=>norm(p.n_peligro).includes(norm(n))))return false;
  if(stateTC.ficha.size){const perm=/perman/i.test(p.tipo_ficha||''),tag=perm?'Obra permanente':'Acción temporal';if(!stateTC.ficha.has(tag))return false}
  if(stateTC.soloEmergencia&&!p.ds097_emergencia)return false;
  if(stateTC.soloFondes&&!p.fondes_apto)return false;
  if(stateTC.soloInfluencia&&!p.es_influencia_unacem)return false;
  return true});return F}
function scoreTC(){const rows=tcFiltered().map(f=>{const p=f.properties;return {f,p,raw:{
  peligro:nivelScore(p.n_peligro),
  poblacion:numOr0(p.e_habitantes),
  activos:numOr0(p.e_iiee)+numOr0(p.e_eess),
  cultivos:numOr0(p.e_area_cultivo_ha),
  fondes:FONDES_SCORE[(p.fondes_nivel_sigrid||'').toLowerCase()]||0}}});
  const max={};CRIT_TC.forEach(c=>{max[c.key]=Math.max(1e-9,...rows.map(r=>r.raw[c.key]||0))});
  const wsum=CRIT_TC.reduce((a,c)=>a+c.w,0)||1;
  rows.forEach(r=>{let total=0;r.parts={};CRIT_TC.forEach(c=>{const n=(c.key==='peligro'||c.key==='fondes')?r.raw[c.key]:(r.raw[c.key]||0)/max[c.key];const contrib=(c.w/wsum)*n;r.parts[c.key]={n,contrib};total+=contrib});r.score=total});
  rows.sort((a,b)=>b.score-a.score||b.raw.poblacion-a.raw.poblacion);return rows}
function tcDD(dim,label){const opts=tcCatalog(dim),sel=stateTC[dim],open=tcMenu===dim,summary=sel.size?[...sel].join(', '):'Todas';
  return `<div class="dd${open?' open':''}"><div class="dd-k">${label}</div><div class="dd-b" data-tctoggle="${dim}"><span class="dd-lb">${escapeHtml(summary)}</span><span class="dd-car">▾</span></div><div class="dd-menu"><label data-tcall="${dim}"><input type="checkbox" ${sel.size?'':'checked'}><span class="dd-todos">Todas</span></label>${opts.map(v=>`<label data-tcdim="${dim}" data-tcval="${escapeAttr(v)}"><input type="checkbox" ${sel.has(v)?'checked':''}><span>${escapeHtml(v)}</span></label>`).join('')}</div></div>`}
function renderTCTerritory(){const box=document.getElementById('territoryFiltersPrioriza');if(!box)return;
  box.innerHTML=tcDD('dep','Departamento')+tcDD('prov','Provincia')+tcDD('dist','Distrito')+`<button class="btn-clear" data-tcclear="1">Restablecer territorio</button>`;
  box.querySelectorAll('[data-tctoggle]').forEach(el=>el.onclick=()=>{const d=el.dataset.tctoggle;tcMenu=tcMenu===d?null:d;renderTCTerritory()});
  box.querySelectorAll('[data-tcdim]').forEach(el=>el.querySelector('input').onchange=()=>{const d=el.dataset.tcdim,v=el.dataset.tcval,s=stateTC[d];s.has(v)?s.delete(v):s.add(v);tcValidate();renderTCTerritory();renderPriorizaComercial()});
  box.querySelectorAll('[data-tcall]').forEach(el=>el.querySelector('input').onchange=()=>{stateTC[el.dataset.tcall].clear();tcValidate();renderTCTerritory();renderPriorizaComercial()});
  const clr=box.querySelector('[data-tcclear]');if(clr)clr.onclick=()=>{stateTC.dep.clear();stateTC.prov.clear();stateTC.dist.clear();tcMenu=null;renderTCTerritory();renderPriorizaComercial()}}
function renderTCChars(){const box=document.getElementById('prioComercialFiltros');if(!box)return;const fichas=['Obra permanente','Acción temporal'];const niveles=['Muy Alto','Alto','Medio','Bajo'];
  box.innerHTML=`<div class="filter-label">Tipo de proyecto</div><div class="checks">${fichas.map(v=>`<label><input type="checkbox" data-tcf="${escapeAttr(v)}" ${stateTC.ficha.has(v)?'checked':''}>${escapeHtml(v)}</label>`).join('')}</div>`+
    `<div class="filter-label">Nivel de peligro</div><div class="checks">${niveles.map(v=>`<label><input type="checkbox" data-tcn="${escapeAttr(v)}" ${stateTC.nivel.has(v)?'checked':''}>${escapeHtml(v)}</label>`).join('')}</div>`+
    `<div class="filter-label">Elegibilidad para inversión UNACEM</div><div class="checks"><label><input type="checkbox" data-tctog="soloEmergencia" ${stateTC.soloEmergencia?'checked':''}>Solo en emergencia DS 097</label><label><input type="checkbox" data-tctog="soloFondes" ${stateTC.soloFondes?'checked':''}>Solo distrito apto FONDES</label><label><input type="checkbox" data-tctog="soloInfluencia" ${stateTC.soloInfluencia?'checked':''}>Solo zona de influencia</label></div>`;
  box.querySelectorAll('[data-tcf]').forEach(el=>el.onchange=()=>{const v=el.dataset.tcf;el.checked?stateTC.ficha.add(v):stateTC.ficha.delete(v);renderPriorizaComercial()});
  box.querySelectorAll('[data-tcn]').forEach(el=>el.onchange=()=>{const v=el.dataset.tcn;el.checked?stateTC.nivel.add(v):stateTC.nivel.delete(v);renderPriorizaComercial()});
  box.querySelectorAll('[data-tctog]').forEach(el=>el.onchange=()=>{stateTC[el.dataset.tctog]=el.checked;renderPriorizaComercial()})}
function renderTCWeights(){const box=document.getElementById('weightControls');if(!box)return;box.dataset.mode='tc';
  box.innerHTML=CRIT_TC.map((c,i)=>`<div class="wrow"><div class="wlab"><span><span class="wdot" style="background:${CRITDOM[c.dom]}"></span>${escapeHtml(c.label)}</span><b data-tcpct="${i}"></b></div><input type="range" min="0" max="50" value="${c.w}" data-tcci="${i}"></div>`).join('');
  box.querySelectorAll('input').forEach(el=>el.oninput=()=>{CRIT_TC[Number(el.dataset.tcci)].w=Number(el.value);tcUpdatePct();renderPriorizaComercial()});tcUpdatePct()}
function tcUpdatePct(){const wsum=CRIT_TC.reduce((a,c)=>a+c.w,0)||1;document.querySelectorAll('#weightControls [data-tcpct]').forEach(b=>{b.textContent=Math.round(CRIT_TC[Number(b.dataset.tcpct)].w/wsum*100)+'%'})}
function tcColor(t){return priorizaColor(t)}
function tcRow(r,i){const perm=/perman/i.test(r.p.tipo_ficha||''),tipo=perm?'Obra permanente':'Acción temporal';const bars=CRIT_TC.map(c=>`<span class="sb" title="${escapeHtml(c.label)}" style="flex:${Math.max(0.001,r.parts[c.key].contrib)};background:${CRITDOM[c.dom]}"></span>`).join('');
  const badges=[r.p.ds097_emergencia?'<span class="ctag temp">Emergencia DS 097</span>':'',r.p.fondes_nivel_sigrid?`<span class="ctag perm">FONDES ${escapeHtml(r.p.fondes_nivel_sigrid)}</span>`:''].join(' ');
  const pres=r.p.presupuesto_soles?`S/ ${fmt(r.p.presupuesto_soles)}`:'sin presupuesto en ficha';const med=(r.p.medidas||'').trim();
  return `<div class="affected-item prioriza-item${String(r.p.critical_id)===String(tcSelected)?' sel':''}" data-tccid="${escapeAttr(String(r.p.critical_id))}"><div class="rank">${i+1}</div><div><h4>${escapeHtml(r.p.nom_sector||'Punto crítico')}</h4><div class="meta"><span class="ctag ${perm?'perm':'temp'}">${tipo}</span> · ${escapeHtml(r.p.distrito||'')}, ${escapeHtml(r.p.provincia||'')} · nivel ${escapeHtml(r.p.n_peligro||'-')}</div><div class="scorebar">${bars}</div><div class="meta">Valor en riesgo <b>${(r.score*100).toFixed(0)}</b>/100 · ${fmt(r.raw.poblacion)} hab · ${fmt(r.raw.activos)} act. soc · ${escapeHtml(pres)}</div><div class="meta">${badges}</div>${med.length>2?`<div class="medida">▸ ${escapeHtml(med)}</div>`:''}</div></div>`}
function tcPopup(r){const pres=r.p.presupuesto_soles?`S/ ${fmt(r.p.presupuesto_soles)}`:'—';const tope=r.p.tope_ciprl_oxi_soles!=null?`S/ ${fmt(r.p.tope_ciprl_oxi_soles)}`:'—';
  return `<b>${escapeHtml(r.p.nom_sector||'Punto crítico')}</b><div class="popup-grid"><span>Distrito</span><b>${escapeHtml(r.p.distrito||'-')}</b><span>Valor en riesgo</span><b>${(r.score*100).toFixed(0)}/100</b><span>Nivel</span><b>${escapeHtml(r.p.n_peligro||'-')}</b><span>Hab. (ficha)</span><b>${fmt(r.p.e_habitantes)}</b><span>Presupuesto obra</span><b>${escapeHtml(pres)}</b><span>Emergencia DS097</span><b>${r.p.ds097_emergencia?'Sí':'No'}</b><span>FONDES</span><b>${escapeHtml(r.p.fondes_nivel_sigrid||'-')}</b><span>Tope CIPRL distrito</span><b>${escapeHtml(tope)}</b></div>${r.p.descripcion?`<p>${escapeHtml(r.p.descripcion)}</p>`:''}${r.p.url&&/^https?:/i.test(r.p.url)?`<a class="popup-url" href="${escapeAttr(r.p.url)}" target="_blank" rel="noopener">Abrir ficha fuente ↗</a>`:''}`}
function renderPriorizaComercial(){if(!puntosTerr){document.getElementById('priorizaResult').innerHTML='<div class="empty-list">Capa de territorio comercial no disponible. Regenera con build_puntos_criticos_territorio.py.</div>';return}
  if(document.getElementById('weightControls').dataset.mode!=='tc')renderTCWeights();renderTCTerritory();renderTCChars();
  const rows=scoreTC();
  if(tcLayer){mp.removeLayer(tcLayer);tcLayer=null}if(tcHistLayer){mp.removeLayer(tcHistLayer);tcHistLayer=null}if(tcBuffer){mp.removeLayer(tcBuffer);tcBuffer=null}
  const maxScore=Math.max(1e-9,...rows.map(r=>r.score));
  tcLayer=L.geoJSON({type:'FeatureCollection',features:rows.map(r=>r.f)},{pointToLayer:(f,ll)=>{const r=rows.find(x=>x.f===f),sel=String(f.properties.critical_id)===String(tcSelected),t=r.score/maxScore;return L.circleMarker(ll,{radius:sel?12:5+t*7,color:sel?'#000':'#fff',weight:sel?2.4:1,fillColor:tcColor(t),fillOpacity:.9})},onEachFeature:(f,l)=>{l.on('click',()=>{tcSelected=String(f.properties.critical_id);renderPriorizaComercial()});l.bindPopup(tcPopup(rows.find(x=>x.f===f)))}}).addTo(mp);
  try{const b=tcLayer.getBounds();tcBounds=b&&b.isValid()?b:null}catch(e){tcBounds=null}
  if(tcSelected){const self=rows.find(r=>String(r.p.critical_id)===String(tcSelected));if(self){tcBuffer=L.geoJSON(turf.buffer(self.f,state.scenario/1000,{units:'kilometers',steps:24}),{style:{color:'#ff0000',weight:2,dashArray:'6 5',fillColor:'#ff0000',fillOpacity:.05}}).addTo(mp)}}
  const t={n:rows.length,perm:rows.filter(r=>/perman/i.test(r.p.tipo_ficha||'')).length,temp:rows.filter(r=>!/perman/i.test(r.p.tipo_ficha||'')).length,pop:rows.reduce((a,r)=>a+r.raw.poblacion,0),emerg:rows.filter(r=>r.p.ds097_emergencia).length,pres:rows.reduce((a,r)=>a+numOr0(r.p.presupuesto_soles),0)};
  const totalPrev=tcAll().filter(f=>isInterventionTC(f.properties)).length;
  document.getElementById('priorizaResult').innerHTML=`<div class="funnel">${fmt(totalPrev)} proyectos de prevención <span>→</span> <b>${fmt(t.n)}</b> tras filtros</div><div class="res-grid"><div class="res"><b>${fmt(t.perm)}</b><span>Obra permanente</span></div><div class="res"><b>${fmt(t.temp)}</b><span>Acción temporal</span></div><div class="res"><b>${fmt(t.pop)}</b><span>Población en riesgo (ficha)</span></div><div class="res"><b>${fmt(t.emerg)}</b><span>En emergencia DS 097</span></div><div class="res"><b>S/ ${fmt(t.pres)}</b><span>Presupuesto de obras</span></div></div>`;
  document.getElementById('priorizaCount').textContent=fmt(rows.length);document.getElementById('priorizaSubtitle').textContent=`Puntuado por exposición declarada en ficha + elegibilidad FONDES · orden por valor en riesgo ponderado.`;
  const list=document.getElementById('priorizaList');list.innerHTML=rows.length?rows.slice(0,300).map((r,i)=>tcRow(r,i)).join('')+(rows.length>300?`<div class="empty-list">Mostrando los 300 primeros de ${fmt(rows.length)}. Afina los filtros para acotar.</div>`:''):`<div class="empty-list">No hay proyectos de prevención con los filtros actuales.</div>`;
  list.querySelectorAll('.prioriza-item').forEach(el=>el.onclick=()=>{tcSelected=el.dataset.tccid;renderPriorizaComercial();const self=tcAll().find(x=>String(x.properties.critical_id)===String(tcSelected));if(self){const c=self.geometry.coordinates;mp.setView([c[1],c[0]],13)}})}

/* ===== V4 · Vista 2: Unidades expuestas ===== */
//#region MOD2-VIEW  (bloque compartido: app real + prototipo _proto/mod2.js — se sube desde el proto con promote_mod2.py; NO editar aquí, editar en el proto)
// Explorador de unidades expuestas por dominio (operacional/comercial/social) con ranking
// de afectacion adaptativo y embudo de decision (¿tiene proyecto? -> ruta de accion).
// v1 rankea unidades PUNTUALES; lineas/areas (vias sociales, corredores de despacho) van
// como contexto de mapa (su unidad -tramo/area- se define en la siguiente iteracion).
// Default = TODO marcado (nada arranca en blanco). tipo se puebla en buildV2Index (necesita V2_TYPES).
// Semántica: marcado = incluido. Cuando un grupo está completo, el filtro se salta (muestra todo,
// sin descartar unidades con el campo vacío); parcial = filtra; vacío = no muestra nada.
// Dos familias de peligro. La zona de susceptibilidad solo distingue estas dos (inundación / laderas);
// los puntos críticos traen inundación|erosión|huaico, que se reparten: erosión→inundación, huaico→mov. en masa.
// Nivel de la unidad = COMPUESTO: el mayor entre su zona (canal A) y su punto crítico (canal C), dentro de
// los peligros marcados. Prender/apagar un peligro recalcula el nivel de cada unidad (Opción A, 2026-08-16).
const HAZARDS=[{key:'inundacion',label:'Inundación'},{key:'mov_masa',label:'Mov. en masa'}];
const HAZ_KEYS=HAZARDS.map(h=>h.key);
const HAZ_NIVELES=['Muy alto','Alto','Medio'],TIPO_INFLU=['Directa','Indirecta']; // nivel = del compuesto (Baja no marca)
const NIVEL_SEV={'muy alto':4,'alto':3,'medio':2,'bajo':1};
const sevOf=lvl=>NIVEL_SEV[norm(lvl)]||0;
const SEV_LABEL=['','Bajo','Medio','Alto','Muy alto']; // índice = severidad 1..4
const SEV_STARS={4:5,3:4,2:3,1:2}; // severidad compuesta → estrella del ramp de riesgo (colores fuertes y distintos)
// A qué familia(s) pertenece un punto crítico (su tipo puede venir combinado y tocar las dos).
function pcFamilies(peligro){const s=norm(peligro),o=[];
  if(s.includes('inunda')||s.includes('erosi'))o.push('inundacion');
  if(s.includes('detrito')||s.includes('huaico')||s.includes('huayco')||s.includes('flujo'))o.push('mov_masa');
  return o.length?o:['inundacion']}
const v2={dom:new Set(['operacional','comercial','social']),tipo:new Set(),
  dep:new Set(),dist:new Set(),zona:new Set(),tipoInf:new Set(['Directa']),q:{dep:'',dist:'',zona:''},qVia:'',qRio:'',
  haz:new Set(HAZ_KEYS),hazNivel:new Set(HAZ_NIVELES),canal:new Set(['zona','punto','ambos']),soloProyecto:false,showCP:false,showSus:false,selected:null};
const v2TipoTotal=()=>['operacional','comercial','social'].filter(d=>v2.dom.has(d)).reduce((n,d)=>n+V2_TYPES[d].length,0);
let INFLU=null; // jerarquia de la zona de influencia (13 distritos / 26 subzonas), desde subzonas.geojson
const depKey=s=>(s??'').toString().normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim();
const titleCase=s=>(s??'').toString().toLowerCase().replace(/(^|[\s\-])\p{L}/gu,m=>m.toUpperCase());
const PERU_DEP=['Amazonas','Áncash','Apurímac','Arequipa','Ayacucho','Cajamarca','Callao','Cusco','Huancavelica','Huánuco','Ica','Junín','La Libertad','Lambayeque','Lima','Loreto','Madre de Dios','Moquegua','Pasco','Piura','Puno','San Martín','Tacna','Tumbes','Ucayali'];
const V2_TYPES={social:['colegios','salud','comedores','puentes','vias_soc'],comercial:['progresol_nac','vias_local'],operacional:['planta','cantera','faja','terminal','linea_transmision','concesiones','vias','vias_acceso']};
const V2_LABEL={colegios:'Colegios',salud:'Salud',comedores:'Comedores / ollas',puentes:'Puentes',progresol_nac:'Progresol (nacional)',concesiones:'Concesiones',planta:'Planta',cantera:'Cantera',faja:'Faja transportadora',terminal:'Terminal portuario',linea_transmision:'Línea de transmisión',vias:'Vías de despacho / suministro',vias_soc:'Vías sociales',vias_local:'Vía de acceso a progresol',vias_acceso:'Vías de acceso a planta'};
const V2_DOMLABEL={social:'Social',comercial:'Comercial',operacional:'Operacional'};
// Dominio = FORMA (sin color). El COLOR de la unidad lo lleva el RIESGO.
const V2_DOMCOLOR={social:'#7a3f9c',comercial:'#c02a6e',operacional:'#1f1f1f'}; // se conserva para el nº de ranking de la lista y el tag del panel de accion
const V2_SHAPE={operacional:'square',comercial:'triangle',social:'circle'};
// Glifo neutro de la forma del dominio, para la leyenda del filtro (mismo lenguaje que los marcadores del mapa).
const V2_DOMGLYPH=d=>{const sh=V2_SHAPE[d],c='#2b2b2b';
  if(sh==='square')return `<svg class="dom-glyph" width="13" height="13" viewBox="0 0 13 13"><rect x="1" y="1" width="11" height="11" fill="${c}"/></svg>`;
  if(sh==='triangle')return `<svg class="dom-glyph" width="14" height="13" viewBox="0 0 14 13"><polygon points="7,1 13,12 1,12" fill="${c}"/></svg>`;
  return `<svg class="dom-glyph" width="13" height="13" viewBox="0 0 13 13"><circle cx="6.5" cy="6.5" r="5.5" fill="${c}"/></svg>`};
// Rampa de riesgo por estrellas (afScore = 0.5·proximidad al punto critico + 0.5·severidad del punto critico).
// El mapa y el ranking cuentan la misma historia: mismo score -> mismo color y mismo orden en la lista.
const V2_RISK_RAMP=['#f7c6ba','#f19a80','#e8624a','#d21f1f','#8f0a0a']; // 1..5 estrellas
const V2_RISK_LABEL=['Bajo','Moderado','Alto','Muy alto','Crítico'];
const v2RiskColor=s=>V2_RISK_RAMP[Math.max(1,Math.min(5,Math.round(s||1)))-1];
// ---- Zonas de propensidad (susceptibilidad) CENEPRED/SIGRID: capa opcional de fondo ----
// Vector tiles PMTiles nacionales (pipeline/susc_tiles.py → data/tiles/susceptibilidad.pmtiles),
// dibujados con protomaps-leaflet. El navegador solo baja las teselas visibles: cobertura nacional
// sin descargar cientos de MB. Escala de calor rojo→naranja por nivel; una capa de tile por familia
// (inundacion / mov_masa). La URL la fija cada entrypoint en SUSC_TILES_URL (rutas relativas distintas).
const SUSC_COLOR={'muy alto':'#c1121f','alto':'#f3722c','medio':'#f6a23c'};
const suscColor=n=>SUSC_COLOR[norm(n)]||'#f6a23c';
let _suscLayer=null;
// Una regla por (familia × nivel): color fijo por nivel; el filtro respeta en vivo los toggles de
// familia (v2.haz) y de nivel (v2.hazNivel). Al cambiar un filtro se llama rerenderTiles().
function suscPaintRules(){
  if(typeof protomapsL==='undefined')return [];
  const famOn=fam=>v2.haz.size>=HAZ_KEYS.length||v2.haz.has(fam);
  const nivOn=niv=>v2.hazNivel.size>=HAZ_NIVELES.length||[...v2.hazNivel].some(n=>norm(n)===norm(niv));
  const rules=[];
  for(const fam of ['mov_masa','inundacion'])for(const niv of HAZ_NIVELES){
    rules.push({dataLayer:fam,symbolizer:new protomapsL.PolygonSymbolizer({fill:suscColor(niv),opacity:.34}),
      filter:(z,f)=>f.props.nivel===niv&&famOn(fam)&&nivOn(niv)});
  }
  return rules;
}
function syncSuscLayer(){
  if(!md||typeof protomapsL==='undefined'||typeof SUSC_TILES_URL==='undefined'||!SUSC_TILES_URL)return;
  if(v2.showSus){
    if(!_suscLayer){_suscLayer=protomapsL.leafletLayer({url:SUSC_TILES_URL,paintRules:suscPaintRules(),labelRules:[],maxDataZoom:10});_suscLayer.setZIndex(300)}
    if(!md.hasLayer(_suscLayer))_suscLayer.addTo(md);
    _suscLayer.paintRules=suscPaintRules();
    try{_suscLayer.rerenderTiles()}catch(e){try{_suscLayer.redraw()}catch(_){}}
  }else if(_suscLayer&&md.hasLayer(_suscLayer)){md.removeLayer(_suscLayer)}
}
// ---- Puntos críticos CENEPRED: capa opcional para ubicar el peligro real junto a las unidades ----
// El tipo de peligro puede venir combinado ("Erosión | Flujo de detritos | Inundación"); el ícono
// toma el peligro dominante por severidad de fenómeno: huaico > inundación > erosión.
const CP_HAZ=['huaico','inundacion','erosion'];
const CP_HAZ_LABEL={huaico:'Flujo de detritos (huaico)',inundacion:'Inundación',erosion:'Erosión'};
function cpHazType(peligro){const s=norm(peligro);
  if(s.includes('detrito')||s.includes('huaico')||s.includes('huayco')||s.includes('flujo'))return 'huaico';
  if(s.includes('inunda'))return 'inundacion';
  if(s.includes('erosi'))return 'erosion';
  return 'inundacion'}
// Glifos de trazo blanco (14×14) sobre el badge oscuro del punto crítico.
const CP_GLYPH={
  inundacion:`<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M2 9c2 0 2 1.6 4 1.6S8 9 10 9s2 1.6 4 1.6S16 9 18 9s2 1.6 4 1.6"/><path d="M2 15c2 0 2 1.6 4 1.6S8 15 10 15s2 1.6 4 1.6S16 15 18 15s2 1.6 4 1.6"/></svg>`,
  huaico:`<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M3 20 L10 8 L14 14 L17 9 L21 20 Z"/><circle cx="9.5" cy="17" r="1" fill="#fff" stroke="none"/><circle cx="13.5" cy="18.5" r="1" fill="#fff" stroke="none"/></svg>`,
  erosion:`<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M2 21 L9 10 L14 16 L22 5"/><path d="M9 10 L9 21 M14 16 L14 21"/></svg>`};
const CP_LVL_RING=lvl=>{const n=norm(lvl);return n.includes('muy alto')?'#8f0a0a':n.includes('alto')?'#d21f1f':'#8a8a8a'};
function cpIcon(p){const t=cpHazType(p.tipo_peligro_norm||p.tip_peligr||''),ring=CP_LVL_RING(p.n_peligro_norm);
  return L.divIcon({className:'cp-icon',html:`<div class="cp-badge" style="border-color:${ring}">${CP_GLYPH[t]}</div>`,iconSize:[27,27],iconAnchor:[13.5,13.5]})}
// Marcador enfatizado del punto crítico que dispara la selección de una unidad.
function cpIconHi(pc){const t=cpHazType(pc.peligro||'');return L.divIcon({className:'cp-icon',html:`<div class="cp-badge cp-badge-hi">${CP_GLYPH[t]}</div>`,iconSize:[36,36],iconAnchor:[18,18]})}
// Render adaptativo de los puntos críticos: en zoom alto, badge con ícono; en zoom bajo, punto
// liviano en canvas (barato) que crece suave con el zoom. Además solo se dibujan los del viewport,
// para no crear miles de marcadores fuera de pantalla. Baja carga visual y computacional.
const V2_CP_ICON_ZOOM=12;                        // >= este zoom: badge con ícono; por debajo: punto
const cpDotRadius=z=>Math.max(1.5,(z-4)*0.55);   // radio del punto según el zoom
function renderCPLayer(){
  if(!md)return;
  if(md._cpLayer){md.removeLayer(md._cpLayer);md._cpLayer=null}
  const all=md._cpFeatures;if(!all||!all.length)return;
  const z=md.getZoom(),badge=z>=V2_CP_ICON_ZOOM,r=cpDotRadius(z),b=md.getBounds().pad(0.25);
  const dim=v2.selected?0.22:1;  // con una unidad seleccionada, el resto de puntos críticos se atenúa
  const cps=all.filter(f=>{const c=f.geometry.coordinates;return b.contains([c[1],c[0]])});
  const cl=L.geoJSON({type:'FeatureCollection',features:cps},{pointToLayer:(f,ll)=>{
      if(badge)return L.marker(ll,{icon:cpIcon(f.properties),zIndexOffset:1200,opacity:dim});
      const ring=CP_LVL_RING(f.properties.n_peligro_norm);
      return L.circleMarker(ll,{radius:r,color:ring,weight:1,opacity:.9*dim,fillColor:ring,fillOpacity:.7*dim})},
    onEachFeature:(f,l)=>l.bindPopup(cpPopup(f.properties))});
  cl.addTo(md);md._cpLayer=cl;
}
// Filtra los puntos críticos por los mismos filtros de peligro y territorio activos en la vista.
function v2Criticals(){if(!criticals)return [];let fs=criticals.features;
  if(v2.haz.size<HAZ_KEYS.length)fs=fs.filter(f=>pcFamilies(f.properties.tipo_peligro_norm||f.properties.tip_peligr||'').some(fam=>v2.haz.has(fam)));
  if(v2.hazNivel.size<HAZ_NIVELES.length)fs=fs.filter(f=>[...v2.hazNivel].some(n=>norm(f.properties.n_peligro_norm||'').includes(norm(n))));
  if(v2.dep.size)fs=fs.filter(f=>v2.dep.has(depKey(f.properties.DEPARTAMEN||f.properties.nom_dpto||'')));
  if(v2.dist.size)fs=fs.filter(f=>v2.dist.has(f.properties.DISTRITO));
  if(v2.zona.size)fs=fs.filter(f=>v2.zona.has(f.properties.Zonas));
  return fs}
function cpPopup(p){const exp=[[p.e_habitant,'habitantes'],[p.e_vivienda,'viviendas'],[p.e_iiee,'II.EE.'],[p.e_eess,'EE.SS.']].filter(([v])=>v&&Number(v)>0).map(([v,u])=>`<span>${u}</span><b>${fmt(v)}</b>`).join('');
  const ficha=/^prev/i.test(p.tipo_ficha_norm||'')?'Propuesta de prevención':'Evento histórico';
  return `<b>Punto crítico · ${escapeHtml(p.tipo_peligro_norm||p.tip_peligr||'—')}</b><div class="muted" style="margin:2px 0 0">${escapeHtml(p.nom_sector||'')}${p.nom_dist?' · '+escapeHtml(titleCase(p.nom_dist)):''}</div><div class="popup-grid"><span>Nivel de peligro</span><b>${escapeHtml(p.n_peligro_norm||'—')}</b><span>Registro</span><b>${escapeHtml(ficha)}</b>${p.periodo?`<span>Periodo</span><b>${escapeHtml(String(p.periodo))}</b>`:''}${exp}</div>`}
// ---- Vías de despacho / suministro (corredores UNACEM) ----
// Cada vía es una UNIDAD expuesta (no una capa de contexto): se rankea por proximidad al punto crítico.
// Sin distinguir entrada de insumos de salida de producto (la fuente trae un único flag comercial).
function viasPeligro(s){if(!s)return '';const parts=String(s).split(';').map(x=>{const i=x.lastIndexOf(':');return [x.slice(0,i).trim(),Number(x.slice(i+1))]}).filter(([n])=>n&&!/^s\/d/i.test(n));parts.sort((a,b)=>b[1]-a[1]);return parts.length?parts[0][0]:''}
// Punto medio de la traza (la vía es lineal; el marcador y el centrado usan este punto).
function lineMid(geom){if(!geom)return null;const cs=[];(function walk(c){if(typeof c[0]==='number'){cs.push(c);return}c.forEach(walk)})(geom.coordinates);if(!cs.length)return null;const m=cs[Math.floor(cs.length/2)];return [m[1],m[0]]}
// Punto de la traza más cercano al punto crítico (el punto EXPUESTO): ahí va el marcador de la vía,
// no en el centro geométrico. Proyección plana local (escala lng por cos(lat); exacta a esta escala).
function lineNearest(geom,plat,plng){if(!geom||plat==null||plng==null)return lineMid(geom);const cs=[];(function walk(c){if(typeof c[0]==='number'){cs.push(c);return}c.forEach(walk)})(geom.coordinates);if(!cs.length)return null;if(cs.length===1)return [cs[0][1],cs[0][0]];
  const k=Math.cos(plat*Math.PI/180),px=plng*k,py=plat;let best=null;
  for(let i=0;i+1<cs.length;i++){const ax=cs[i][0]*k,ay=cs[i][1],dx=cs[i+1][0]*k-ax,dy=cs[i+1][1]-ay,L2=dx*dx+dy*dy;let t=L2?((px-ax)*dx+(py-ay)*dy)/L2:0;t=t<0?0:t>1?1:t;const qx=ax+t*dx,qy=ay+t*dy,d2=(px-qx)*(px-qx)+(py-qy)*(py-qy);if(!best||d2<best.d2)best={d2,lat:qy,lng:qx/k}}
  return best?[best.lat,best.lng]:[cs[0][1],cs[0][0]]}
// Carga del corredor (material + origen → planta, del S&OP de materias primas). Sustituye el nombre
// oficial largo del tramo por la lógica de negocio: qué transporta la ruta y de dónde a dónde.
function cargaCap(arr,n){const a=arr||[];return a.length<=n?a.slice():a.slice(0,n).concat('+'+(a.length-n)+' más')}
function viasCargaLinea(u){if(!u||!u.materiales||!u.materiales.length)return '';
  const mat=cargaCap(u.materiales,3).join(', ').toLowerCase(),ori=cargaCap(u.origenes,3).join(', '),des=(u.destinos||[]).join(' y ');
  return `Transporta ${escapeHtml(mat)}${ori?' · '+escapeHtml(ori):''}${des?' → '+escapeHtml(des):''}`}
function viasCargaDetalle(u){if(!u||!u.flujos||!u.flujos.length)return '';
  const filas=u.flujos.map(fl=>`<div class="via-flujo"><b>${escapeHtml(fl.m)}</b> <span>${escapeHtml((fl.o||[]).join(', '))} → ${escapeHtml((fl.d||[]).join(' y '))}</span></div>`).join('');
  return `<div class="via-carga"><div class="via-carga-h">Materia prima que transporta este corredor</div>${filas}</div>`}
function viasPopup(u){const geo=u.distrito?titleCase(u.distrito):(u.dep?titleCase(u.dep):'');
  const conecta=u.tipo==='vias_local'
    ?`<div class="muted" style="margin:4px 0 0">Último tramo que conecta el <b>progresol ${escapeHtml(u.progNom||'')}</b>${u.progDir?' — '+escapeHtml(titleCase(u.progDir)):''} con la red vial. Si esta vía se corta por un peligro FEN, ese punto de venta queda aislado del despacho de cemento.<div style="margin-top:3px">Vía: ${escapeHtml(u.viaRuta||'')} ${escapeHtml(u.viaNom||'')}${u.progDist!=null?` · a ${fmt(u.progDist)} m del punto de venta`:''}</div></div>`
    :(u.tipo==='vias'?viasCargaDetalle(u)+(u.tramo?`<div class="muted via-tramo">Tramo oficial (MTC): ${escapeHtml(u.tramo)}</div>`:''):'');
  return `<b>${escapeHtml(u.nombre)}</b><div class="muted" style="margin:2px 0 0">${V2_DOMLABEL[u.dominio]} · ${escapeHtml(V2_LABEL[u.tipo])}${geo?' · '+escapeHtml(geo):''}</div>`+
    conecta+
    hazGrid(u)+
    `<div class="haz-mag">${fmt(u.mag)} km${u.pcritKm!=null?` · ${fmt(u.pcritKm)} puntos críticos a 1 km`:''}</div>`}
// Marcador de unidad: la FORMA distingue dominio; el COLOR = nivel de riesgo; el anillo negro solo marca la seleccion.
function v2Icon(u,sel){const c=v2RiskColor(u.stars),ring=sel?'#000':'#fff',bw=sel?2.2:1.2,size=sel?22:12+u.stars*2,sh=V2_SHAPE[u.dominio];let inner;
  if(sh==='circle')inner=`<div style="width:${size}px;height:${size}px;border-radius:50%;background:${c};border:${bw}px solid ${ring};box-sizing:border-box"></div>`;
  else if(sh==='square')inner=`<div style="width:${size-2}px;height:${size-2}px;background:${c};border:${bw}px solid ${ring};box-sizing:border-box"></div>`;
  else{const s=size+2;inner=`<svg width="${s}" height="${s}" viewBox="0 0 24 24"><polygon points="12,2.5 22,21.5 2,21.5" fill="${c}" stroke="${ring}" stroke-width="${bw*1.6}" stroke-linejoin="round"/></svg>`}
  const box=size+4;return L.divIcon({className:'v2-unit-icon',html:inner,iconSize:[box,box],iconAnchor:[box/2,box/2]})}
const V2_MAG={colegios:{f:p=>Number(p.TALUMNO||0),unit:'alumnos'},salud:{f:p=>Number(p.CAMAS||0),unit:'camas'},comedores:{f:p=>Number(p.usuarios||0),unit:'usuarios'}};
const V2_NIVELSC={'muy alto':1,'alto':1,'medio':0.6,'bajo':0.3};
let mdLayers=[],v2Last=[],prevPts=null,v2ProjCache=new Map();

function metersBetween(aLat,aLng,bLat,bLng){const R=6371000,dLat=(bLat-aLat)*Math.PI/180,dLng=(bLng-aLng)*Math.PI/180,la=(aLat+bLat)/2*Math.PI/180,x=dLng*Math.cos(la),y=dLat;return Math.sqrt(x*x+y*y)*R}
function nearestPrevProj(lat,lng){if(lat==null||lng==null||!prevPts)return null;let best=null;for(const p of prevPts){const d=metersBetween(lat,lng,p.lat,p.lng);if(d<=2000&&(!best||d<best.dist))best={cid:p.cid,dist:d,props:p.props}}return best?{critical_id:best.cid,dist:best.dist,scope:'comercial',props:best.props}:null}
function afScore(dist,nivel){const prox=Math.max(0,1-dist/Math.max(state.scenario,1)),p=V2_NIVELSC[norm(nivel)]??0.6;return 0.5*prox+0.5*p}
function afStars(s){return Math.max(1,Math.min(5,Math.round(s*5)))}
function starHTML(n){return `<span class="rating">${[1,2,3,4,5].map(i=>`<span class="star ${i<=n?'on':''}">★</span>`).join('')}</span>`}
function afLabel(n){return ['Muy baja','Baja','Media','Alta','Muy alta'][Math.max(1,Math.min(5,n))-1]||'—'}
function v2Name(t,p){switch(t){case 'colegios':return p.CEN_EDU||'Local educativo';case 'salud':return p['Nombre del establecimiento']||'Establecimiento de salud';case 'comedores':return p.nombre||'Comedor / olla';case 'puentes':return p.v_nom_infr||'Puente';case 'progresol_nac':return p.nombre||'Progresol';case 'concesiones':return p.concesion||'Concesión';case 'planta':case 'cantera':case 'faja':case 'terminal':case 'linea_transmision':return p.nombre||'Unidad operacional';case 'vias':return p.corredor?(p.corredor+' ('+p.cod_ruta+')'):(p.cod_ruta||p.nombre_oficial||'Vía');case 'vias_soc':return p.nombre||p.cod||'Vía';case 'vias_local':return p.progresol_servido||p.nombre||'Progresol';case 'vias_acceso':return p.nombre||'Vía de acceso'}return '—'}

function buildV2Index(){
  relByEntity={};
  (relations||[]).forEach(r=>{const t=r.entity_type;(relByEntity[t]??=new Map());const k=String(r.entity_id),rec={critical_id:String(r.critical_id),distance:Number(r.distance_m)},a=relByEntity[t].get(k);if(a)a.push(rec);else relByEntity[t].set(k,[rec])});
  criticalById=new Map((criticals?.features||[]).map(f=>[String(f.properties.critical_id),f.properties]));
  critGeomById=new Map((criticals?.features||[]).filter(f=>f.geometry&&f.geometry.type==='Point').map(f=>[String(f.properties.critical_id),f.geometry.coordinates]));
  // proyectos de prevencion del territorio comercial, para linkear unidades nacionales
  prevPts=(puntosTerr?.features||[]).filter(f=>/^prev/i.test(f.properties.tipo_ficha||'')).map(f=>({lat:f.geometry.coordinates[1],lng:f.geometry.coordinates[0],cid:String(f.properties.critical_id),props:f.properties}));
  v2ProjCache=new Map();
  for(const f of (concesiones?.features||[]))v2ProjCache.set('concesiones:'+String(f.properties.codigou||f.properties.concesion),nearestPrevProj(f.properties.lat,f.properties.lon));
  for(const f of (progresolNac?.features||[])){const c=f.geometry.coordinates;v2ProjCache.set('progresol_nac:'+String(f.properties.pdv||f.properties.nombre),nearestPrevProj(c[1],c[0]))}
  // Default: todos los tipos de los dominios activos marcados (nada arranca en blanco).
  if(!v2._tipoInit){v2._tipoInit=true;['operacional','comercial','social'].forEach(d=>{if(v2.dom.has(d))V2_TYPES[d].forEach(t=>v2.tipo.add(t))})}
  buildInflu();
}
function buildInflu(){if(!subzones){INFLU=null;return}const m=new Map();
  for(const f of subzones.features){const p=f.properties,dist=p.DISTRITO,dep=p.DEPARTAMEN,zona=p.Zonas,ti=p.tipo_influencia;
    if(!m.has(dist))m.set(dist,{dep,dist,zonas:[],tipoInf:new Set()});
    const e=m.get(dist);e.zonas.push({zona,ti});e.tipoInf.add(ti)}
  INFLU={byDist:m,dists:[...m.values()].sort((a,b)=>a.dep.localeCompare(b.dep,'es')||a.dist.localeCompare(b.dist,'es'))}}

// El área de influencia social de FEN es la de influencia DIRECTA (DP-003, 2026-08-19). El universo
// social por defecto se acota a tipo_influencia = Directa vía el filtro v2.tipoInf; la Indirecta
// (San Juan de Miraflores, Tarma y otros de Junín) queda como contexto y se enciende con su casilla.
// Recorte territorial por ubicación: el tipo de influencia (Directa/Indirecta) es atributo de la SUBZONA,
// no de la unidad. Las capas sociales ya lo traen stampeado desde el pipeline (sjoin en build_all.py); los
// activos operacionales/comerciales no, así que se resuelve aquí por point-in-polygon contra subzonas.geojson
// para que el recorte v2.tipoInf los incluya/excluya por dónde caen (p. ej. la planta cae en subzona Directa).
const _tiCache=new Map();
function _ringHas(x,y,r){let inside=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const xi=r[i][0],yi=r[i][1],xj=r[j][0],yj=r[j][1];if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/((yj-yi)||1e-12)+xi))inside=!inside}return inside}
function _polyHas(x,y,poly){if(!_ringHas(x,y,poly[0]))return false;for(let k=1;k<poly.length;k++)if(_ringHas(x,y,poly[k]))return false;return true}
function subzonaTipoInf(lat,lng){if(lat==null||lng==null||typeof subzones==='undefined'||!subzones)return '';const k=lat.toFixed(5)+','+lng.toFixed(5);if(_tiCache.has(k))return _tiCache.get(k);let ti='';for(const f of subzones.features){const g=f.geometry;if(!g)continue;const polys=g.type==='MultiPolygon'?g.coordinates:g.type==='Polygon'?[g.coordinates]:[];let hit=false;for(const p of polys)if(_polyHas(lng,lat,p)){hit=true;break}if(hit){ti=f.properties.tipo_influencia||'';break}}_tiCache.set(k,ti);return ti}
function v2Units(){
  const out=[];
  if(v2.dom.has('social'))for(const type of V2_TYPES.social){const fc=assets[type];if(!fc)continue;for(const f of fc.features){
    const rels=(relByEntity[type]&&relByEntity[type].get(String(f.properties.entity_id)))||[];
    const within=rels.filter(r=>r.distance<=state.scenario).sort((a,b)=>a.distance-b.distance);
    // Regla de unión (DP-001): la unidad entra si tiene punto crítico en el escenario (canal C)
    // O si cae en zona de susceptibilidad Media+ (canal A). Antes solo entraba por canal C, así que
    // distritos de pura ladera sin punto crítico ANA (p. ej. Villa María) salían "sin nada expuesto".
    const zaTag=canalASocial&&canalASocial[type]&&canalASocial[type][String(f.properties.entity_id)];
    const hasA=!!(zaTag&&(zaTag.i||zaTag.m));
    if(!within.length&&!hasA)continue;
    const near=within[0]||null,cp=near?(criticalById.get(near.critical_id)||{}):{};
    const prev=within.filter(r=>{const c=criticalById.get(r.critical_id);return c&&/^prev/i.test(c.tipo_ficha_norm||'')});
    const proj=prev.length?{critical_id:prev[0].critical_id,dist:prev[0].distance,scope:'influencia',props:criticalById.get(prev[0].critical_id)}:null;
    const c=f.geometry&&f.geometry.coordinates;
    // pcs = puntos críticos (dentro del escenario) que hacen que esta unidad esté expuesta.
    const pcs=within.map(r=>{const g=critGeomById.get(r.critical_id);if(!g)return null;const pp=criticalById.get(r.critical_id)||{};return {lat:g[1],lng:g[0],dist:r.distance,peligro:pp.tipo_peligro_norm||'',nivel:pp.n_peligro_norm||''}}).filter(Boolean);
    out.push({dominio:'social',tipo:type,id:String(f.properties.entity_id),_key:type+':'+f.properties.entity_id,
      nombre:v2Name(type,f.properties),lat:c?c[1]:null,lng:c?c[0]:null,dist:near?near.distance:null,
      nivel:cp.n_peligro_norm||'',peligro:cp.tipo_peligro_norm||'',dep:f.properties.DEPARTAMEN||'',prov:f.properties.PROVINCIA||'',distrito:f.properties.DISTRITO||'',zona:f.properties.Zonas||'',tipoInf:f.properties.tipo_influencia||'',sub:String(f.properties.sububigeo||''),
      mag:V2_MAG[type]?V2_MAG[type].f(f.properties):null,magUnit:V2_MAG[type]?V2_MAG[type].unit:'',proj,pcs})
  }}
  if(v2.dom.has('comercial'))for(const f of (progresolNac?.features||[])){const d=Number(f.properties.fen_pc_dist_m),inScen=d<=state.scenario,c=f.geometry.coordinates,id=String(f.properties.pdv||f.properties.nombre);
    const zt=canalASocial&&canalASocial['progresol_nac']&&canalASocial['progresol_nac'][id],hasA=!!(zt&&(zt.i||zt.m)); // regla de unión (DP-001)
    if(!inScen&&!hasA)continue;
    out.push({dominio:'comercial',tipo:'progresol_nac',id,_key:'progresol_nac:'+id,nombre:v2Name('progresol_nac',f.properties),lat:c[1],lng:c[0],dist:inScen?d:null,nivel:inScen?(f.properties.fen_nivel||''):'',peligro:inScen?(f.properties.fen_peligro||''):'',dep:'',distrito:'',mag:null,magUnit:'',proj:v2ProjCache.get('progresol_nac:'+id)||null})}
  if(v2.dom.has('operacional'))for(const f of (concesiones?.features||[])){const d=Number(f.properties.fen_pc_dist_m),inScen=d<=state.scenario,id=String(f.properties.codigou||f.properties.concesion);
    const zt=canalASocial&&canalASocial['concesiones']&&canalASocial['concesiones'][id],hasA=!!(zt&&(zt.i||zt.m));
    if(!inScen&&!hasA)continue;
    out.push({dominio:'operacional',tipo:'concesiones',id,_key:'concesiones:'+id,nombre:v2Name('concesiones',f.properties),lat:f.properties.lat,lng:f.properties.lon,dist:inScen?d:null,nivel:inScen?(f.properties.fen_nivel||''):'',peligro:inScen?(f.properties.fen_peligro||''):'',dep:f.properties.fen_pc_dpto||'',distrito:'',mag:null,magUnit:'',proj:v2ProjCache.get('concesiones:'+id)||null})}
  // Unidades operacionales físicas (plantas, canteras, faja, terminal, línea de transmisión).
  // La distancia FEN es el mínimo sobre toda la huella (no el centroide); el centroide solo
  // ubica el marcador. La huella (polígonos/líneas) se dibuja como contexto en renderExpuestas.
  if(v2.dom.has('operacional'))for(const f of (unidadesOp?.features||[])){const p=f.properties,d=Number(p.fen_pc_dist_m),inScen=d<=state.scenario,id=String(p.id);
    const zt=canalASocial&&canalASocial[p.tipo]&&canalASocial[p.tipo][id],hasA=!!(zt&&(zt.i||zt.m));
    if(!inScen&&!hasA)continue;
    out.push({dominio:'operacional',tipo:p.tipo,id,_key:'unidadop:'+id,nombre:p.nombre,lat:p.lat,lng:p.lon,dist:inScen?d:null,nivel:inScen?(p.fen_nivel||''):'',peligro:inScen?(p.fen_peligro||''):'',dep:p.fen_pc_dpto||'',distrito:'',mag:null,magUnit:'',proj:null,aproximada:!!p.aproximada})}
  // Vías de despacho / suministro (corredores UNACEM): cada vía es una unidad; se guarda la geometría
  // para dibujar la traza (el marcador va al punto medio). La magnitud es la longitud de la vía.
  if(v2.dom.has('operacional'))for(const f of (viasDS?.features||[])){const p=f.properties,d=Number(p.dist_min_m),inScen=d<=state.scenario,id=String(p.fid||p.cod_ruta||p.nombre_oficial); // id por tramo (fid): clave del Canal A por tramo, no por corredor
    const zt=canalASocial&&canalASocial['vias']&&canalASocial['vias'][id],hasA=!!(zt&&(zt.i||zt.m)); // regla de unión (DP-001): la vía en zona de susceptibilidad entra aunque el punto crítico quede fuera del escenario
    if(!inScen&&!hasA)continue;
    const m=lineNearest(f.geometry,p.pc_lat,p.pc_lng),pl=viasPeligro(p.peligro_top),nivTop=p.nivel_top||'',peliTop=p.pc_top_peligro||pl;
    // Un punto crítico por familia (inundación / mov. en masa): solo dentro del escenario (canal C).
    const pcs=[];
    if(inScen){
      if(p.pc_inund_lat!=null)pcs.push({lat:p.pc_inund_lat,lng:p.pc_inund_lng,dist:d,peligro:p.pc_inund_peligro||'Inundación',nivel:p.nivel_inund||''});
      if(p.pc_mmasa_lat!=null)pcs.push({lat:p.pc_mmasa_lat,lng:p.pc_mmasa_lng,dist:d,peligro:p.pc_mmasa_peligro||'Flujo de detritos',nivel:p.nivel_mmasa||''});
      if(!pcs.length&&p.pc_lat!=null)pcs.push({lat:p.pc_lat,lng:p.pc_lng,dist:d,peligro:peliTop,nivel:nivTop});
    }
    out.push({dominio:'operacional',tipo:'vias',id,_key:'vias:'+id,nombre:v2Name('vias',p),lat:m?m[0]:null,lng:m?m[1]:null,dist:inScen?d:null,nivel:inScen?nivTop:'',peligro:inScen?pl:'',dep:p.departamento||'',distrito:'',mag:Number(p.long_km)||null,magUnit:'km',proj:null,geom:f.geometry,pcritKm:p.puntos_criticos_1km,corredor:p.corredor||'',codRuta:p.cod_ruta||'',materiales:p.carga_materiales||[],origenes:p.carga_origenes||[],destinos:p.carga_destinos||[],flujos:p.carga_flujos||[],tramo:p.nombre_oficial||'',rio:p.pc_rio||'',pcs})}
  // Vías sociales (zona de influencia): vías afectables que no son de despacho/suministro. Como unidad
  // social, participan de los filtros de territorio (distrito/zona/tipo de influencia) y del punto crítico.
  if(v2.dom.has('social'))for(const f of (viasSociales?.features||[])){const p=f.properties,d=Number(p.dist_min_m),inScen=d<=state.scenario,id=String(p.cod||p.nombre);
    const zt=canalASocial&&canalASocial['vias_soc']&&canalASocial['vias_soc'][id],hasA=!!(zt&&(zt.i||zt.m));
    if(!inScen&&!hasA)continue;
    const m=lineNearest(f.geometry,p.pc_lat,p.pc_lng),pcs=(inScen&&p.pc_lat!=null&&p.pc_lng!=null)?[{lat:p.pc_lat,lng:p.pc_lng,dist:d,peligro:p.peligro||'',nivel:p.nivel||''}]:[];
    out.push({dominio:'social',tipo:'vias_soc',id,_key:'vias_soc:'+id,nombre:v2Name('vias_soc',p),lat:m?m[0]:null,lng:m?m[1]:null,dist:inScen?d:null,nivel:inScen?(p.nivel||''):'',peligro:inScen?(p.peligro||''):'',dep:p.DEPARTAMEN||'',prov:p.PROVINCIA||'',distrito:p.DISTRITO||'',zona:p.Zonas||'',tipoInf:p.tipo_influencia||'',sub:String(p.sububigeo||''),mag:Number(p.long_km)||null,magUnit:'km',proj:null,geom:f.geometry,rio:p.pc_rio||'',pcs})}
  // Elementos expuestos SIGRID (contrato V4 §6): bomberos/comisarías, penitenciarías, hidrocarburos, GLP,
  // agencias bancarias, ductos, red ferroviaria, central hidráulica, línea de transmisión, sanitaria.
  // Unidades sociales puntuales: canal A propio (za_i/za_m = susceptibilidad Media+ ya filtrada en el dato)
  // + puntos críticos precalculados (pcs, hasta 2 km). El departamento se deriva del distrito de influencia.
  if(v2.dom.has('social'))for(const e of (eeUnidades||[])){
    const za={i:e.za_i||'',m:e.za_m||''},hasA=!!(za.i||za.m);
    const pcs=(e.pcs||[]).filter(p=>Number(p.dist)<=state.scenario).sort((a,b)=>Number(a.dist)-Number(b.dist)); // canal C dentro del escenario
    if(!pcs.length&&!hasA)continue; // regla de unión DP-001: entra por punto crítico O por zona de susceptibilidad
    const near=pcs[0]||null,dep=((INFLU&&INFLU.byDist.get(e.distrito))||{}).dep||'';
    const nombre=(e.nombre&&String(e.nombre).trim())||e.subtipo||V2_LABEL[e.tipo]||'Elemento expuesto';
    out.push({dominio:'social',tipo:e.tipo,id:String(e.id),_key:e.tipo+':'+e.id,nombre,subtipo:e.subtipo||'',sub:'',
      lat:e.lat,lng:e.lng,dist:near?Number(near.dist):null,nivel:near?near.nivel:'',peligro:near?near.peligro:'',
      dep,prov:'',distrito:e.distrito||'',zona:e.zona||'',tipoInf:e.tipoInf||'',mag:null,magUnit:'',proj:null,pcs,_za:za})}
  // Vías de acceso a progresol (last-mile de despacho a progresoles expuestos): departamental/vecinal +
  // nacional cercano al progresol. Unidad COMERCIAL (el progresol es punto de venta); misma mecánica de traza.
  if(v2.dom.has('comercial'))for(const f of (viasLocales?.features||[])){const p=f.properties,d=Number(p.dist_min_m),inScen=d<=state.scenario,id='L'+p.fid;
    const zt=canalASocial&&canalASocial['vias_local']&&canalASocial['vias_local'][id],hasA=!!(zt&&(zt.i||zt.m));
    if(!inScen&&!hasA)continue;
    const m=lineNearest(f.geometry,p.pc_lat,p.pc_lng),pcs=(inScen&&p.pc_lat!=null&&p.pc_lng!=null)?[{lat:p.pc_lat,lng:p.pc_lng,dist:d,peligro:p.peligro||'',nivel:p.nivel||''}]:[];
    out.push({dominio:'comercial',tipo:'vias_local',id,_key:'vias_local:'+id,nombre:v2Name('vias_local',p),lat:m?m[0]:null,lng:m?m[1]:null,dist:inScen?d:null,nivel:inScen?(p.nivel||''):'',peligro:inScen?(p.peligro||''):'',dep:p.departamento||'',prov:p.provincia||'',distrito:p.distrito||'',mag:Number(p.long_km)||null,magUnit:'km',proj:null,geom:f.geometry,pcritKm:p.puntos_criticos_1km,progNom:p.progresol_servido||'',progDir:p.progresol_direccion||'',progDist:p.progresol_dist_m,viaRuta:p.ruta||'',viaNom:p.nombre||'',rio:p.pc_rio||'',pcs})}
  // Vías de acceso a planta (calles urbanas de Lima Sur, OpenStreetMap): la entrada real a Atocongo
  // (Av. Lima / Av. Atocongo / Av. Pachacútec) no está en la red del MTC. Exposición por zona de
  // susceptibilidad (canal A: susc_inund/mmasa) + punto crítico ANA de cauce como contexto. Unidad
  // OPERACIONAL (continuidad de acceso a la planta).
  if(v2.dom.has('operacional'))for(const f of (viasAcceso?.features||[])){const p=f.properties,id=String(p.osm_id||p.id);
    const za={i:p.susc_inund_nivel||'',m:p.susc_mmasa_nivel||''},hasA=!!(za.i||za.m);
    const d=Number(p.ana_pc_dist_m),inScen=isFinite(d)&&d<=state.scenario;
    if(!hasA&&!inScen)continue; // no expuesta: ni zona de susceptibilidad ni punto crítico en el escenario
    const m=lineNearest(f.geometry,null,null),ti=subzonaTipoInf(m?m[0]:null,m?m[1]:null)||'Directa';
    const pcs=inScen?[{lat:m?m[0]:null,lng:m?m[1]:null,dist:d,peligro:p.ana_pc_peligro||'',nivel:p.ana_pc_nivel||''}]:[];
    out.push({dominio:'operacional',tipo:'vias_acceso',id,_key:'vias_acceso:'+id,nombre:v2Name('vias_acceso',p),
      lat:m?m[0]:null,lng:m?m[1]:null,dist:inScen?d:null,nivel:'',peligro:'',dep:'Lima',distrito:p.ana_pc_distrito||'',
      tipoInf:ti,mag:Number(p.long_km)||null,magUnit:'km',proj:null,geom:f.geometry,rio:p.pc_rio||p.ana_pc_rio_q||'',
      accesoPrincipal:!!p.via_acceso_principal,clase:p.clase||'',_za:za,pcs})}
  // Ubica en su subzona a las unidades sin tipo de influencia del pipeline (operacionales/comerciales),
  // para que el recorte v2.tipoInf opere por posición y no las descarte por no cargar el tag.
  for(const u of out)if(!u.tipoInf&&u.lat!=null&&u.lng!=null)u.tipoInf=subzonaTipoInf(u.lat,u.lng);
  return out;
}
// Severidad por familia de una unidad = máx entre su zona (canal A) y sus puntos críticos de esa familia
// (canal C). Guarda también la fuente de cada familia (zona + punto crítico más severo/cercano), para el
// "de qué lo expone" del detalle. Canal A (canalA-social.json) cubre las 4 capas sociales puntuales
// y las vías de despacho (susceptibilidad en el punto expuesto, keyed por fid); comercial va solo con canal C.
function v2Hazards(u){
  const za=u._za||(canalASocial&&canalASocial[u.tipo]&&canalASocial[u.tipo][u.id])||null;
  const src={inundacion:{sev:0,zona:'',pc:null},mov_masa:{sev:0,zona:'',pc:null}};
  if(za){if(za.i){src.inundacion.zona=za.i;src.inundacion.sev=sevOf(za.i)}
         if(za.m){src.mov_masa.zona=za.m;src.mov_masa.sev=sevOf(za.m)}}
  const pcs=(u.pcs&&u.pcs.length)?u.pcs:(u.peligro?[{peligro:u.peligro,nivel:u.nivel,dist:u.dist}]:[]);
  for(const pc of pcs){const s=sevOf(pc.nivel)||2; // dentro del escenario sin nivel clasificado → Medio (piso, como el default previo)
    for(const fam of pcFamilies(pc.peligro)){const d=src[fam];
      if(s>d.sev)d.sev=s;
      if(!d.pc||s>(sevOf(d.pc.nivel)||2)||(s===(sevOf(d.pc.nivel)||2)&&(pc.dist??1e9)<(d.pc.dist??1e9)))d.pc={dist:pc.dist,nivel:pc.nivel,peligro:pc.peligro}}}
  return src}
// Nivel compuesto de la unidad = mayor severidad entre los peligros MARCADOS (0 = no expuesta bajo el filtro).
function v2Level(src){let s=0;for(const k of v2.haz)s=Math.max(s,src[k].sev);return s}

function v2Filtered(){let u=v2Units();
  // Búsqueda por nombre de vía y por nombre de río (punto crítico ANA de la vía). depKey = sin tildes,
  // minúsculas: "lurin" encuentra "Río Lurín". El filtro por río excluye lo que no tiene río (no-vías).
  const qv=depKey(v2.qVia),qr=depKey(v2.qRio);
  if(qv)u=u.filter(x=>depKey(x.nombre).includes(qv)||depKey(x.tramo).includes(qv)||depKey(x.viaNom).includes(qv));
  if(qr)u=u.filter(x=>depKey(x.rio).includes(qr));
  // Grupos con default "todo marcado": si están completos NO se filtra (no descarta unidades con campo
  // vacío, p. ej. comercial/concesiones sin nivel); parcial filtra; vacío (Limpiar) no muestra nada.
  if(v2.tipo.size<v2TipoTotal())u=u.filter(x=>v2.tipo.has(x.tipo));
  // Compuesto por peligro: cada unidad guarda su severidad por familia y su nivel bajo los peligros activos.
  u.forEach(x=>{x._haz=v2Hazards(x);x._lvl=v2Level(x._haz)});
  u=u.filter(x=>x._lvl>0); // solo las expuestas bajo los peligros marcados
  // Clase de canal por unidad, bajo los peligros activos (regla de unión DP-001):
  //   zona = solo susceptibilidad (canal A) · punto = solo punto crítico (canal C) · ambos = los dos.
  u.forEach(x=>{let a=false,c=false;for(const k of v2.haz){const d=x._haz&&x._haz[k];if(!d)continue;if(d.zona)a=true;if(d.pc)c=true;}x._canal=a&&c?'ambos':a?'zona':'punto'});
  if(v2.canal.size<3)u=u.filter(x=>v2.canal.has(x._canal));
  if(v2.hazNivel.size<HAZ_NIVELES.length)u=u.filter(x=>v2.hazNivel.has(SEV_LABEL[x._lvl]));
  if(v2.dep.size)u=u.filter(x=>!x.dep||v2.dep.has(depKey(x.dep)));
  if(v2.dist.size)u=u.filter(x=>v2.dist.has(x.distrito));
  if(v2.zona.size)u=u.filter(x=>v2.zona.has(x.zona));
  // Recorte territorial (todas las unidades por ubicación): pasa la que cae en una subzona del tipo activo.
  // A diferencia de dep/dist/zona, aquí SÍ se descarta la de tipoInf vacío: significa fuera del área de influencia.
  // EXCEPCIÓN: si hay búsqueda por nombre de vía/río, no se aplica el recorte de influencia (buscar una vía
  // por nombre debe encontrarla en todo el país, p. ej. la Panamericana Sur, aunque caiga fuera de influencia).
  if(!qv&&!qr&&v2.tipoInf.size<TIPO_INFLU.length)u=u.filter(x=>x.tipoInf&&v2.tipoInf.has(x.tipoInf));
  if(v2.soloProyecto)u=u.filter(x=>x.proj&&x.proj.dist<=state.scenario);
  return u}
// El nivel compuesto manda el color y el orden; la proximidad al punto crítico desempata dentro del nivel.
function v2Rank(units){const types=new Set(units.map(u=>u.tipo)),single=types.size===1?[...types][0]:null;
  units.forEach(u=>{u.stars=SEV_STARS[u._lvl]||1;const prox=Math.max(0,1-(u.dist??state.scenario)/Math.max(state.scenario,1));u.score=u._lvl+0.49*prox});
  if(single&&V2_MAG[single])units.sort((a,b)=>(b.mag||0)-(a.mag||0)||b.score-a.score);
  else units.sort((a,b)=>b.score-a.score||(b.mag||0)-(a.mag||0));return units}

// Barra "Todos / Limpiar" reutilizable; `g` distingue grupos dentro de un mismo panel.
const chkBar=g=>`<div class="chk-actions"><button type="button" data-ca="all" data-g="${g}">Todos</button><button type="button" data-ca="none" data-g="${g}">Limpiar</button></div>`;
const onCA=(box,g,onAll,onNone)=>{const a=box.querySelector(`[data-ca="all"][data-g="${g}"]`),n=box.querySelector(`[data-ca="none"][data-g="${g}"]`);if(a)a.onclick=onAll;if(n)n.onclick=onNone};
function renderV2Domain(){const box=document.getElementById('v2Domain');if(!box)return;const doms=['operacional','comercial','social'];
  box.innerHTML=chkBar('dom')+`<div class="checks">`+doms.map(d=>`<label><input type="checkbox" data-v2dom="${d}" ${v2.dom.has(d)?'checked':''}>${V2_DOMGLYPH(d)} ${V2_DOMLABEL[d]}</label>`).join('')+`</div>`;
  onCA(box,'dom',()=>{doms.forEach(d=>{v2.dom.add(d);V2_TYPES[d].forEach(t=>v2.tipo.add(t))});renderExpuestas()},()=>{v2.dom.clear();v2.tipo.clear();renderExpuestas()});
  box.querySelectorAll('[data-v2dom]').forEach(el=>el.onchange=()=>{const d=el.dataset.v2dom;if(el.checked){v2.dom.add(d);V2_TYPES[d].forEach(t=>v2.tipo.add(t))}else{v2.dom.delete(d);V2_TYPES[d].forEach(t=>v2.tipo.delete(t))}renderExpuestas()})}
function renderV2Types(){const box=document.getElementById('v2Types');if(!box)return;
  const doms=['operacional','comercial','social'].filter(d=>v2.dom.has(d)),allTypes=doms.flatMap(d=>V2_TYPES[d]);
  const groups=doms.map(d=>`<div class="type-group"><div class="filter-label">${escapeHtml(V2_DOMLABEL[d])}</div><div class="checks">`+V2_TYPES[d].map(t=>`<label><input type="checkbox" data-v2t="${t}" ${v2.tipo.has(t)?'checked':''}>${escapeHtml(V2_LABEL[t])}</label>`).join('')+`</div></div>`).join('');
  box.innerHTML=chkBar('tipo')+(groups||`<p class="muted">Activa un dominio para ver sus tipos.</p>`);
  onCA(box,'tipo',()=>{allTypes.forEach(t=>v2.tipo.add(t));renderExpuestas()},()=>{v2.tipo.clear();renderExpuestas()});
  box.querySelectorAll('[data-v2t]').forEach(el=>el.onchange=()=>{const t=el.dataset.v2t;el.checked?v2.tipo.add(t):v2.tipo.delete(t);renderExpuestas()})}
function renderV2Hazard(){const box=document.getElementById('v2Hazard');if(!box)return;const niv=HAZ_NIVELES;
  const cpN=v2.showCP?v2Criticals().length:0;
  // Dos familias de peligro. Cada casilla lleva su ícono (inundación / mov. en masa). Prender o apagar
  // una familia recalcula el nivel compuesto de cada unidad (mayor entre zona y punto crítico de esa familia).
  let h=`<div class="filter-label">Tipo de peligro</div>`+chkBar('ht')+`<div class="checks">`+HAZARDS.map(hz=>`<label><input type="checkbox" data-v2ht="${escapeAttr(hz.key)}" ${v2.haz.has(hz.key)?'checked':''}>${escapeHtml(hz.label)}<span class="cp-badge cp-badge-sm haz-ic">${CP_GLYPH[hz.key==='mov_masa'?'huaico':'inundacion']}</span></label>`).join('')+`</div>`;
  h+=`<p class="muted cp-note" style="margin:7px 0 2px">El nivel de cada unidad es el mayor entre su zona de susceptibilidad y su punto crítico, dentro de los peligros marcados.</p>`;
  h+=`<div class="filter-label">Nivel compuesto</div>`+chkBar('hn')+`<div class="checks">`+niv.map(v=>`<label><input type="checkbox" data-v2hn="${escapeAttr(v)}" ${v2.hazNivel.has(v)?'checked':''}>${escapeHtml(v)}</label>`).join('')+`</div>`;
  h+=`<div class="filter-label">Canal de exposición</div>`+chkBar('cn')+`<div class="checks">`+[['zona','Solo zona de susceptibilidad'],['punto','Solo punto crítico'],['ambos','Ambos canales']].map(([v,l])=>`<label><input type="checkbox" data-v2cn="${v}" ${v2.canal.has(v)?'checked':''}>${escapeHtml(l)}</label>`).join('')+`</div><p class="muted cp-note" style="margin:5px 0 0">"Solo zona" aísla las unidades en susceptibilidad SIGRID sin punto crítico ANA cerca (regla de unión DP-001).</p>`;
  h+=`<div class="cp-show"><label class="cp-toggle"><input type="checkbox" id="v2ShowCP" ${v2.showCP?'checked':''}> Ver puntos críticos en el mapa${v2.showCP?` <span class="cp-count">${fmt(cpN)}</span>`:''}</label><p class="muted cp-note">Ubica el punto crítico del inventario de la ANA (peligro real) con el ícono de su tipo; el anillo indica el nivel. Sigue los filtros de arriba.</p></div>`;
  // Toggle de propensidad: SOLO en el prototipo (donde SUSC_TILES_URL está definido). En la app real no aparece.
  if(typeof SUSC_TILES_URL!=='undefined'&&SUSC_TILES_URL)h+=`<div class="cp-show"><label class="cp-toggle"><input type="checkbox" id="v2ShowSus" ${v2.showSus?'checked':''}> Ver zonas de propensidad</label><p class="muted cp-note" style="margin-top:3px">Susceptibilidad del terreno</p><p class="muted cp-note" style="display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:2px"><span style="white-space:nowrap"><span style="color:${SUSC_COLOR['medio']}">▉</span> medio</span><span style="white-space:nowrap"><span style="color:${SUSC_COLOR['alto']}">▉</span> alto</span><span style="white-space:nowrap"><span style="color:${SUSC_COLOR['muy alto']}">▉</span> muy alto</span></p></div>`;
  box.innerHTML=h;
  const cp=box.querySelector('#v2ShowCP');if(cp)cp.onchange=()=>{v2.showCP=cp.checked;renderExpuestas()};
  const su=box.querySelector('#v2ShowSus');if(su)su.onchange=()=>{v2.showSus=su.checked;renderExpuestas()};
  onCA(box,'ht',()=>{HAZ_KEYS.forEach(k=>v2.haz.add(k));renderExpuestas()},()=>{v2.haz.clear();renderExpuestas()});
  onCA(box,'hn',()=>{niv.forEach(v=>v2.hazNivel.add(v));renderExpuestas()},()=>{v2.hazNivel.clear();renderExpuestas()});
  onCA(box,'cn',()=>{['zona','punto','ambos'].forEach(v=>v2.canal.add(v));renderExpuestas()},()=>{v2.canal.clear();renderExpuestas()});
  box.querySelectorAll('[data-v2cn]').forEach(el=>el.onchange=()=>{const v=el.dataset.v2cn;el.checked?v2.canal.add(v):v2.canal.delete(v);renderExpuestas()});
  box.querySelectorAll('[data-v2ht]').forEach(el=>el.onchange=()=>{const v=el.dataset.v2ht;el.checked?v2.haz.add(v):v2.haz.delete(v);renderExpuestas()});box.querySelectorAll('[data-v2hn]').forEach(el=>el.onchange=()=>{const v=el.dataset.v2hn;el.checked?v2.hazNivel.add(v):v2.hazNivel.delete(v);renderExpuestas()})}
function renderV2Territory(){const box=document.getElementById('v2Territory');if(!box)return;
  const drop=(label,items,sel,attr,qkey)=>{const q=depKey(v2.q[qkey]||'');
    return `<details class="terr-drop"${sel.size||q?' open':''}><summary>${escapeHtml(label)}<span class="sel-count">${sel.size?sel.size+' sel.':'todas'}</span></summary><div class="terr-drop-body"><input class="terr-search" type="text" placeholder="Buscar…" data-q="${escapeAttr(qkey)}" value="${escapeAttr(v2.q[qkey]||'')}">`+chkBar(qkey)+`<div class="checks terr-opts">`+(items.length?items.map(it=>{const lab=depKey(it.label),hide=q&&!lab.includes(q);return `<label class="terr-opt${it.dis?' opt-off':''}" data-lab="${escapeAttr(lab)}"${hide?' style="display:none"':''}><input type="checkbox" data-${attr}="${escapeAttr(it.v)}" ${sel.has(it.v)?'checked':''} ${it.dis?'disabled':''}>${escapeHtml(it.label)}${it.n!=null?`<span class="opt-n">${it.n?fmt(it.n):'—'}</span>`:''}</label>`}).join(''):'<p class="muted">Sin opciones.</p>')+`</div><p class="muted terr-nomatch" style="display:none">Sin coincidencias.</p></div></details>`};
  const cntDep=new Map();v2Units().forEach(u=>{if(u.dep)cntDep.set(depKey(u.dep),(cntDep.get(depKey(u.dep))||0)+1)});
  const depItems=PERU_DEP.map(d=>{const k=depKey(d),n=cntDep.get(k)||0;return {v:k,label:d,n,dis:n===0}});
  const dists=INFLU?INFLU.dists:[];
  const distF=dists.filter(d=>!v2.dep.size||v2.dep.has(depKey(d.dep)));
  [...v2.dist].forEach(d=>{if(!distF.some(x=>x.dist===d))v2.dist.delete(d)});
  const distItems=distF.map(d=>({v:d.dist,label:titleCase(d.dist)}));
  const zonaItems=[];distF.forEach(d=>{if(v2.dist.size&&!v2.dist.has(d.dist))return;d.zonas.forEach(z=>{if(z.zona&&z.zona!=='Todas Zonas')zonaItems.push({v:z.zona,label:z.zona})})});
  const zset=new Set(zonaItems.map(z=>z.v));[...v2.zona].forEach(z=>{if(!zset.has(z))v2.zona.delete(z)});
  // Accesos rápidos: aíslan la vista a un solo territorio (dominio) — social o comercial.
  const soloS=v2.dom.size===1&&v2.dom.has('social'),soloC=v2.dom.size===1&&v2.dom.has('comercial');
  let h=`<div class="segmented v2-scope terr-solo"><button type="button" data-v2solo="social" class="${soloS?'active':''}">Solo territorio social</button><button type="button" data-v2solo="comercial" class="${soloC?'active':''}">Solo territorio comercial</button></div>`;
  h+=drop('Departamento',depItems,v2.dep,'v2dep','dep');
  h+=drop('Distrito',distItems,v2.dist,'v2dist','dist');
  h+=drop('Zona',zonaItems,v2.zona,'v2zona','zona');
  h+=`<div class="filter-label" style="margin-top:11px">Tipo de influencia (social)</div>`+chkBar('ti')+`<div class="checks">`+['Directa','Indirecta'].map(v=>`<label><input type="checkbox" data-v2ti="${v}" ${v2.tipoInf.has(v)?'checked':''}>${v}</label>`).join('')+`</div>`;
  box.innerHTML=h;
  // Solo territorio social / comercial: deja un único dominio activo con todos sus tipos (misma lógica que el toggle de dominio).
  box.querySelectorAll('[data-v2solo]').forEach(el=>el.onclick=()=>{const d=el.dataset.v2solo;v2.dom.clear();v2.dom.add(d);v2.tipo.clear();V2_TYPES[d].forEach(t=>v2.tipo.add(t));renderExpuestas()});
  onCA(box,'dep',()=>{depItems.filter(it=>!it.dis).forEach(it=>v2.dep.add(it.v));renderExpuestas();v2ZoomSel()},()=>{v2.dep.clear();renderExpuestas();v2ZoomSel()});
  onCA(box,'dist',()=>{distItems.forEach(it=>v2.dist.add(it.v));renderExpuestas();v2ZoomSel()},()=>{v2.dist.clear();renderExpuestas();v2ZoomSel()});
  onCA(box,'zona',()=>{zonaItems.forEach(it=>v2.zona.add(it.v));renderExpuestas();v2ZoomSel()},()=>{v2.zona.clear();renderExpuestas();v2ZoomSel()});
  onCA(box,'ti',()=>{['Directa','Indirecta'].forEach(v=>v2.tipoInf.add(v));renderExpuestas()},()=>{v2.tipoInf.clear();renderExpuestas()});
  box.querySelectorAll('[data-v2dep]').forEach(el=>el.onchange=()=>{const v=el.dataset.v2dep;el.checked?v2.dep.add(v):v2.dep.delete(v);renderExpuestas();v2ZoomSel()});
  box.querySelectorAll('[data-v2ti]').forEach(el=>el.onchange=()=>{const v=el.dataset.v2ti;el.checked?v2.tipoInf.add(v):v2.tipoInf.delete(v);renderExpuestas()});
  box.querySelectorAll('[data-v2dist]').forEach(el=>el.onchange=()=>{const v=el.dataset.v2dist;el.checked?v2.dist.add(v):v2.dist.delete(v);renderExpuestas();v2ZoomSel()});
  box.querySelectorAll('[data-v2zona]').forEach(el=>el.onchange=()=>{const v=el.dataset.v2zona;el.checked?v2.zona.add(v):v2.zona.delete(v);renderExpuestas();v2ZoomSel()});
  box.querySelectorAll('.terr-search').forEach(inp=>{inp.onclick=e=>e.stopPropagation();inp.oninput=()=>{const q=depKey(inp.value);v2.q[inp.dataset.q]=inp.value;const body=inp.parentElement;let vis=0;body.querySelectorAll('.terr-opt').forEach(l=>{const ok=!q||l.dataset.lab.includes(q);l.style.display=ok?'':'none';if(ok)vis++});const nm=body.querySelector('.terr-nomatch');if(nm)nm.style.display=vis?'none':''}})}
function v2ZoomSel(){if(!md)return;let feats=null;
  if(subzones&&v2.zona.size)feats=subzones.features.filter(f=>v2.zona.has(f.properties.Zonas));
  else if(subzones&&v2.dist.size)feats=subzones.features.filter(f=>v2.dist.has(f.properties.DISTRITO));
  else if(deptos&&v2.dep.size)feats=deptos.features.filter(f=>v2.dep.has(depKey(f.properties.NOMBDEP)));
  if(feats&&feats.length){try{const b=L.geoJSON({type:'FeatureCollection',features:feats}).getBounds();if(b.isValid()){md.fitBounds(b,{padding:[30,30],maxZoom:14});return}}catch(e){}}
  if(v2Bounds&&v2Bounds.isValid())md.fitBounds(v2Bounds,{padding:[25,25],maxZoom:13})}
const V2_LABEL_ZOOM=11; // rótulos de distrito solo cuando estás acercado; abajo de esto se ocultan
function v2LabelVis(){if(!md||!detailLabels)return;if(md.getZoom()>=V2_LABEL_ZOOM){if(!md.hasLayer(detailLabels))md.addLayer(detailLabels)}else if(md.hasLayer(detailLabels))md.removeLayer(detailLabels)}

// "De qué lo expone": por cada peligro marcado con severidad, una línea con su fuente (zona + punto crítico).
// "De qué lo expone": un bloque por peligro marcado, con sus dos canales rotulados por separado
// —Susceptibilidad de la zona (canal A) y Cercanía a punto crítico (canal C)— para que se distingan.
// Solo se muestra el canal que aplica; las vías y las capas comercial/operacional no tienen zona.
// Todo el desglose en UNA grilla de dos columnas (rótulo | nivel) para que los niveles alineen a la
// derecha. La distancia del punto crítico va como nota dentro del rótulo, no rompe la columna del nivel.
function hgRow(label,rowCls,sev,txt,extra){
  return `<div class="hg-l ${rowCls}">${escapeHtml(label)}${extra?`<i>${escapeHtml(extra)}</i>`:''}</div>`+
         `<div class="hg-v ${rowCls} lv-${sev}">${txt}</div>`}
function hazGrid(u){
  let out=hgRow('Nivel de exposición','hg-total',u._lvl,SEV_LABEL[u._lvl]||'—','');
  let any=false;
  for(const hz of HAZARDS){if(!v2.haz.has(hz.key))continue;const d=u._haz&&u._haz[hz.key];if(!d||!d.sev)continue;any=true;
    out+=hgRow('Por '+hz.label.toLowerCase(),'hg-haz',d.sev,SEV_LABEL[d.sev],'');
    if(d.zona)out+=hgRow('Susceptibilidad de la zona','hg-canal',sevOf(d.zona),SEV_LABEL[sevOf(d.zona)],'');
    if(d.pc){const s=sevOf(d.pc.nivel);out+=hgRow('Cercanía a punto crítico','hg-canal',s||2,s?SEV_LABEL[s]:'sin clasificar',`${fmt(d.pc.dist)} m`)}}
  if(!any)out+=`<div class="hg-l hg-canal" style="grid-column:1/3">Sin exposición bajo los peligros activos.</div>`;
  return `<div class="haz-grid">${out}</div>`}
function v2Popup(u){const magTxt=(u.mag!=null&&u.mag>0)?`<div class="haz-mag">${fmt(u.mag)} ${escapeHtml(u.magUnit)}</div>`:'';
  return `<b>${escapeHtml(u.nombre)}</b><div class="muted" style="margin:2px 0 0">${V2_DOMLABEL[u.dominio]} · ${escapeHtml(V2_LABEL[u.tipo])}${u.subtipo&&u.subtipo!==u.nombre?' · '+escapeHtml(u.subtipo):''}</div>`+
    hazGrid(u)+magTxt}
function v2Row(u,i){const dc=V2_DOMCOLOR[u.dominio],magTxt=(u.mag!=null&&u.mag>0)?`${fmt(u.mag)} ${u.magUnit}`:'',proj=u.proj&&u.proj.dist<=state.scenario,prevTxt=proj?`proyecto de prevención a ${fmt(u.proj.dist)} m`:'sin proyecto de prevención cercano',geo=u.distrito||u.dep||'';
  const fams=HAZARDS.filter(hz=>v2.haz.has(hz.key)&&u._haz&&u._haz[hz.key].sev).map(hz=>hz.label.toLowerCase()).join(' · ');
  const carga=(u.tipo==='vias'&&u.materiales&&u.materiales.length)?`<div class="meta via-carga-row">${viasCargaLinea(u)}</div>`:'';
  return `<div class="affected-item v2-item${u._key===v2.selected?' sel':''}" data-v2k="${escapeAttr(u._key)}"><div class="rank" style="background:${dc}">${i+1}</div><div><h4>${escapeHtml(V2_LABEL[u.tipo])} · ${escapeHtml(u.nombre)}</h4>${carga}<div class="meta"><b class="lv-${u._lvl}">${SEV_LABEL[u._lvl]||'—'}</b>${fams?(' · por '+escapeHtml(fams)):''}${magTxt?(' · '+magTxt):''}</div><div class="meta">${geo?escapeHtml(geo)+' · ':''}<span class="prev-k">Prevención</span> ${escapeHtml(prevTxt)}</div></div></div>`}
// El detalle de la unidad seleccionada ahora vive en un popup del mapa (no en una tarjeta encima del
// ranking). Se mantiene el contenedor vacío para no romper el layout.
function v2ActionPanel(){const box=document.getElementById('v2Action');if(box)box.innerHTML=''}
function v2GoToView3(cid){state.prioScope='comercial';const btns=document.getElementById('prioScopeBtns');if(btns)btns.querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.scope==='comercial'));const io=document.getElementById('prioInfluenciaOnly'),cf=document.getElementById('prioComercialFiltros');if(io)io.classList.add('hidden');if(cf)cf.classList.remove('hidden');const sh=document.getElementById('scopeHint');if(sh)sh.textContent='5,521 puntos críticos del inventario de la ANA en el mercado UNACEM, puntuados por la exposición declarada en la ficha + FONDES + emergencia.';tcSelected=String(cid);const tab=document.querySelector('.tab[data-view="prioriza"]');if(tab)tab.click();const self=(puntosTerr&&puntosTerr.features||[]).find(x=>String(x.properties.critical_id)===String(cid));if(self){const c=self.geometry.coordinates;setTimeout(()=>{if(mp)mp.setView([c[1],c[0]],13)},200)}}

// Búsqueda por nombre de vía / río (Vista 2): cablea los dos inputs y llena sus datalist con los
// nombres presentes en las 4 capas de vías cargadas. Se invoca una vez, tras cargar los datos.
// Encuadra el mapa a las vías/unidades que coinciden con la búsqueda (o vuelve al dominio si se limpia).
function v2FitSearch(){
  if(!md)return;
  if(v2.qVia||v2.qRio){
    const sf=[];
    for(const u of (v2Last||[])){
      if(u.geom)sf.push({type:'Feature',geometry:u.geom});
      else if(u.lat!=null&&u.lng!=null)sf.push({type:'Feature',geometry:{type:'Point',coordinates:[u.lng,u.lat]}});
    }
    if(sf.length){try{const b=L.geoJSON({type:'FeatureCollection',features:sf}).getBounds();
      if(b.isValid()){md.fitBounds(b,{padding:[40,40],maxZoom:15});return}}catch(e){}}
  }
  if(v2Bounds&&v2Bounds.isValid())md.fitBounds(v2Bounds,{padding:[25,25],maxZoom:13}); // sin búsqueda o sin coincidencias
}
function wireV2Search(){
  const qv=document.getElementById('v2QVia'),qr=document.getElementById('v2QRio');
  if(qv)qv.oninput=()=>{v2.qVia=qv.value;v2.selected=null;renderExpuestas();v2FitSearch()};
  if(qr)qr.oninput=()=>{v2.qRio=qr.value;v2.selected=null;renderExpuestas();v2FitSearch()};
  const capas=[viasDS,viasSociales,viasLocales,viasAcceso];
  const fill=(id,pick)=>{const dl=document.getElementById(id);if(!dl)return;const s=new Set();
    for(const fc of capas)for(const f of (fc?.features||[])){const v=(pick(f.properties)||'').trim();if(v&&v!=='(sin nombre)')s.add(v)}
    dl.innerHTML=[...s].sort((a,b)=>a.localeCompare(b,'es')).map(v=>`<option value="${escapeAttr(v)}">`).join('')};
  fill('v2ViaList',p=>p.nombre||p.nombre_oficial||p.corredor);
  fill('v2RioList',p=>p.pc_rio);
}
function renderExpuestas(){if(!document.getElementById('detailView')||!md)return;
  renderV2Domain();renderV2Types();renderV2Hazard();renderV2Territory();
  const units=v2Rank(v2Filtered());v2Last=units;
  mdLayers.forEach(l=>md.removeLayer(l));mdLayers=[];
  if(detailLabels){md.removeLayer(detailLabels);detailLabels=null}
  // Contexto departamental: gris tenue; resalta los departamentos seleccionados en el filtro.
  if(deptos){const dl=L.geoJSON(deptos,{interactive:false,style:f=>v2.dep.has(depKey(f.properties.NOMBDEP))?{color:'#111',weight:2,fillColor:'#111',fillOpacity:.05,dashArray:null}:{color:'#cdd1d6',weight:.6,opacity:.6,fillOpacity:0,dashArray:'3,3'}});dl.addTo(md);mdLayers.push(dl)}
  // Zonas de propensidad (susceptibilidad): telón opcional de vector tiles bajo las unidades.
  // Capa persistente (no entra en mdLayers): se prende/apaga y se re-pinta según los filtros.
  syncSuscLayer();
  // Territorio comercial UNACEM (mercado de venta): region REAL, solo cuando el dominio comercial esta activo.
  // Tono neutro (el rojo queda reservado a exposicion). Departamento completo / provincia de frontera / punta-de-red.
  const _tc=(typeof terrComercial!=='undefined')?terrComercial:null;
  if(_tc&&v2.dom.has('comercial')){const cl=L.geoJSON(_tc,{style:f=>{const pr=f.properties.nivel==='punta-de-red';return{color:'#3a3a3a',weight:pr?1:1.3,opacity:pr?.5:.85,dashArray:pr?'4,4':null,fillColor:'#000',fillOpacity:pr?.02:.055}},onEachFeature:(f,l)=>{const p=f.properties;l.bindPopup(`<b>Territorio comercial UNACEM</b><br>${escapeHtml(p.departamento)}${p.ambito==='provincia'?' · '+escapeHtml(p.provincia):''}<div class="popup-grid"><span>Nivel</span><b>${escapeHtml(p.nivel)}</b><span>Macrozona</span><b>${escapeHtml(p.macrozona||'—')}</b></div>`)}});cl.addTo(md);mdLayers.push(cl)}
  // Zona de influencia: SIEMPRE delimita todas las subzonas; rellena las que tienen unidades
  const zcnt=new Map();units.forEach(u=>{if(u.sub)zcnt.set(u.sub,(zcnt.get(u.sub)||0)+1)});
  if(subzones){
    const max=Math.max(1,...zcnt.values());
    // Delimitacion del area de influencia: plomo uniforme, misma para todas.
    // El relleno es GRIS por densidad de unidades (mancha de exposicion agregada); el ROJO
    // quedo reservado para el riesgo POR UNIDAD (color del marcador), para que no compitan.
    const ZBORDER='#8a8a8a';
    const zl=L.geoJSON(subzones,{style:f=>{const n=zcnt.get(String(f.properties.sububigeo))||0;if(n>0){const t=max>1?(n-1)/(max-1):1;return{color:ZBORDER,weight:1,fillColor:'#454545',fillOpacity:.05+.20*t}}return{color:ZBORDER,weight:1,opacity:.8,fillOpacity:0}},onEachFeature:(f,l)=>{const n=zcnt.get(String(f.properties.sububigeo))||0,z=f.properties.Zonas;l.bindPopup(`<b>${escapeHtml(f.properties.DISTRITO||'')}</b>${z&&z!=='Todas Zonas'?'<br>'+escapeHtml(z):''}<div class="popup-grid"><span>Unidades expuestas</span><b>${fmt(n)}</b></div>`)}});
    zl.addTo(md);mdLayers.push(zl);
    // una etiqueta por distrito de influencia (todos), centrada y de tamaño fijo
    const byDist=new Map();subzones.features.forEach(f=>{const d=f.properties.DISTRITO;if(!byDist.has(d))byDist.set(d,[]);byDist.get(d).push(f)});
    const lg=L.layerGroup();
    byDist.forEach((fs,d)=>{try{const c=turf.centroid({type:'FeatureCollection',features:fs}).geometry.coordinates,ab=fs[0].properties.abreviatura||d;L.marker([c[1],c[0]],{interactive:false,icon:L.divIcon({className:'zone-label',html:`<div class="abbr">${escapeHtml(ab)}</div>`,iconSize:[54,15],iconAnchor:[27,7]})}).addTo(lg)}catch(e){}});
    lg.addTo(md);detailLabels=lg;mdLayers.push(lg);
    if(!md._v2LabelBound){md._v2LabelBound=true;md.on('zoomend',v2LabelVis)}
    v2LabelVis();
  }
  if(v2.dom.has('operacional')&&corredores){const cl=L.geoJSON(corredores,{style:{color:'#111',weight:1.3,opacity:.32}});cl.addTo(md);mdLayers.push(cl)}
  // Huella física de las unidades operacionales (contexto). Línea de transmisión punteada
  // (traza derivada del plano CAD, aproximada); plantas/canteras/terminal como polígono oscuro.
  if(v2.dom.has('operacional')&&unidadesOp){const feats=unidadesOp.features.filter(f=>!v2.tipo.size||v2.tipo.has(f.properties.tipo));
    const ol=L.geoJSON({type:'FeatureCollection',features:feats},{style:f=>f.properties.aproximada
        ?{color:'#e0661e',weight:2.4,opacity:.9,dashArray:'6,4',fill:false}
        :{color:'#1f1f1f',weight:1.4,opacity:.85,fillColor:'#1f1f1f',fillOpacity:.12},
      onEachFeature:(f,l)=>{const p=f.properties;l.bindPopup(`<b>${escapeHtml(p.nombre)}</b><div class="popup-grid"><span>Tipo</span><b>${escapeHtml(V2_LABEL[p.tipo]||p.tipo)}</b><span>Operación</span><b>${escapeHtml(p.planta||'')}</b><span>Punto crítico FEN</span><b>${fmt(p.fen_pc_dist_m)} m</b><span>Peligro</span><b>${escapeHtml(p.fen_peligro||'-')}</b></div>${p.aproximada?'<p class="muted" style="margin:.4em 0 0">Traza derivada del plano CAD (PSAD56), aproximada.</p>':''}`)}});
    ol.addTo(md);mdLayers.push(ol)}
  // Vías (despacho/suministro y sociales): cada vía-unidad se dibuja como traza coloreada por su riesgo.
  // Clic en la línea (o en el ranking) la selecciona; seleccionada = trazo negro más grueso.
  const viasU=units.filter(u=>(u.tipo==='vias'||u.tipo==='vias_soc'||u.tipo==='vias_local'||u.tipo==='vias_acceso')&&u.geom);
  if(viasU.length){const vl=L.geoJSON({type:'FeatureCollection',features:viasU.map(u=>({type:'Feature',geometry:u.geom,properties:{k:u._key}}))},{style:f=>{const u=units.find(x=>x._key===f.properties.k),sel=u._key===v2.selected,dim=v2.selected&&!sel;return sel?{color:'#111',weight:5,opacity:1}:{color:v2RiskColor(u.stars),weight:dim?2:3.4,opacity:dim?.25:.92}},onEachFeature:(f,l)=>{l.on('click',()=>{const k=f.properties.k;v2.selected=v2.selected===k?null:k;renderExpuestas()})}});vl.addTo(md);mdLayers.push(vl)}
  // Marcadores de punto: todas las unidades puntuales (las vías van como traza, no como punto).
  const pts=units.filter(u=>u.tipo!=='vias'&&u.tipo!=='vias_soc'&&u.lat!=null&&u.lng!=null&&isFinite(u.lat)&&isFinite(u.lng));
  const ul=L.geoJSON({type:'FeatureCollection',features:pts.map(u=>({type:'Feature',geometry:{type:'Point',coordinates:[u.lng,u.lat]},properties:{k:u._key}}))},{pointToLayer:(f,ll)=>{const u=units.find(x=>x._key===f.properties.k),sel=u._key===v2.selected;return L.marker(ll,{icon:v2Icon(u,sel),zIndexOffset:sel?1000:0,opacity:(v2.selected&&!sel)?0.25:1})},onEachFeature:(f,l)=>{l.on('click',()=>{const k=f.properties.k;v2.selected=v2.selected===k?null:k;renderExpuestas()})}});ul.addTo(md);mdLayers.push(ul);
  // Puntos críticos CENEPRED (capa opcional): la ubicación real del peligro, con ícono por tipo.
  // Van ENCIMA de las unidades para que no se oculten tras el marcador de la unidad seleccionada
  // (una unidad expuesta siempre está pegada a su punto crítico).
  // La capa de puntos críticos se gestiona aparte (no en mdLayers): se redibuja en cada 'moveend'
  // (pan y zoom) con renderCPLayer, que ajusta tamaño y recorta al viewport.
  md._cpFeatures=(v2.showCP&&criticals)?v2Criticals().filter(f=>f.geometry&&f.geometry.type==='Point'):null;
  renderCPLayer();
  if(!md._cpMoveBound){md._cpMoveBound=true;md.on('moveend',renderCPLayer)}
  // Selección: resaltar el/los punto(s) crítico(s) que exponen a la unidad, unidos por una línea.
  // Así se entiende POR QUÉ está seleccionada; el resto de puntos críticos queda atenuado (arriba).
  const su=v2.selected?units.find(u=>u._key===v2.selected):null;
  if(su&&su.lat!=null&&su.pcs&&su.pcs.length)su.pcs.forEach(pc=>{
    const link=L.polyline([[su.lat,su.lng],[pc.lat,pc.lng]],{color:'#111',weight:1.6,opacity:.75,dashArray:'4,4',interactive:false});link.addTo(md);mdLayers.push(link);
    const mk=L.marker([pc.lat,pc.lng],{icon:cpIconHi(pc),zIndexOffset:2000});mk.bindPopup(`<b>Punto crítico que la expone</b><div class="popup-grid"><span>Distancia</span><b>${fmt(pc.dist)} m</b><span>Peligro</span><b>${escapeHtml(pc.peligro||'—')}</b>${pc.nivel?`<span>Nivel</span><b>${escapeHtml(pc.nivel)}</b>`:''}</div>`);mk.addTo(md);mdLayers.push(mk)});
  // Detalle de la unidad seleccionada: popup en el mapa (ya no una tarjeta encima del ranking).
  if(su&&su.lat!=null){if(md._selPopupKey!==su._key){md._selPopupKey=su._key;if(md._selPopup)md.closePopup(md._selPopup);md._selPopup=L.popup({offset:[0,-6],autoPan:false}).setLatLng([su.lat,su.lng]).setContent((su.tipo==='vias'||su.tipo==='vias_soc'||su.tipo==='vias_local')?viasPopup(su):v2Popup(su)).openOn(md)}}
  else{md._selPopupKey=null;if(md._selPopup){md.closePopup(md._selPopup);md._selPopup=null}}
  // Reencuadre por dominio: el area social/operativa (Lima Sur/Tarma) y el mercado comercial (nacional)
  // viven a escalas distintas. Con comercial activo, encuadre nacional (territorio comercial); sin el,
  // encuadre al entorno de planta para que el area social no se vuelva una mancha invisible.
  let fb=null;
  if(v2.dom.has('comercial')&&_tc){try{const b=L.geoJSON(_tc).getBounds();if(b.isValid())fb=b}catch(e){}}
  else if(subzones){try{const b=L.geoJSON(subzones).getBounds();if(b.isValid())fb=b}catch(e){}}
  if(!fb){try{const b=ul.getBounds();fb=b&&b.isValid()?b:null}catch(e){fb=null}}
  v2Bounds=fb;
  // Al cambiar el conjunto de dominios activos, reencuadrar al foco correspondiente (nacional vs planta).
  const domKey=[...v2.dom].sort().join(',');
  if(md._v2DomKey!==domKey){md._v2DomKey=domKey;if(v2Bounds&&v2Bounds.isValid())md.fitBounds(v2Bounds,{padding:[25,25],maxZoom:v2.dom.has('comercial')?9:13})}
  const byDom={social:0,comercial:0,operacional:0};units.forEach(u=>byDom[u.dominio]++);
  const nivColors=[[2,'Medio'],[3,'Alto'],[4,'Muy alto']].map(([s,l])=>[v2RiskColor(SEV_STARS[s]),l]);
  const riskLegend=`<div class="kpi kpi-legend"><span class="kpi-legend-title">Nivel compuesto</span><span class="kpi-legend-ramp">${nivColors.map(([c,l])=>`<i title="${l}" style="background:${c}"></i>`).join('')}</span><span class="kpi-legend-ends">medio → muy alto</span></div>`;
  document.getElementById('detailKpis').innerHTML=`<div class="kpi"><b>${fmt(byDom.operacional)}</b><span>Operacional</span></div><div class="kpi"><b>${fmt(byDom.comercial)}</b><span>Comercial</span></div><div class="kpi"><b>${fmt(byDom.social)}</b><span>Social</span></div><div class="kpi"><b>${fmt(units.length)}</b><span>Total expuestas</span></div>`+riskLegend;
  const single=new Set(units.map(u=>u.tipo)).size===1&&units.length;
  document.getElementById('v2Subtitle').textContent=single?'Un solo tipo: orden por magnitud, modulado por severidad.':`Orden por severidad de exposición · escenario ${escLabel(state.scenario)}.`;
  document.getElementById('v2Count').textContent=fmt(units.length);
  const list=document.getElementById('v2List');list.innerHTML=units.length?units.slice(0,300).map((u,i)=>v2Row(u,i)).join('')+(units.length>300?`<div class="empty-list">Mostrando 300 de ${fmt(units.length)}. Afina los filtros.</div>`:''):`<div class="empty-list">No hay unidades expuestas con los filtros y escenario actuales.</div>`;
  list.querySelectorAll('.v2-item').forEach(el=>el.onclick=()=>{const k=el.dataset.v2k;v2.selected=v2.selected===k?null:k;renderExpuestas();const u=units.find(x=>x._key===v2.selected);if(u&&u.lat!=null)md.setView([u.lat,u.lng],13)});
  // Clic en el fondo del mapa (no sobre una unidad) deselecciona.
  if(!md._v2BgBound){md._v2BgBound=true;md.on('click',()=>{if(v2.selected){v2.selected=null;renderExpuestas()}})}
  v2ActionPanel();}
//#endregion MOD2-VIEW

/* ===== Descarga CSV de los colegios del ranking ===== */
// La descarga es 100% en el navegador: NO necesita servidor ni base de datos. Los datos ya
// vienen embebidos en la página (colegios.geojson + colegios-padron.json). Genera un CSV
// (UTF-8 con BOM, separador ';' — apto para Excel es-PE) con TODOS los colegios del ranking
// actual (los filtros y el escenario que tengas puestos), cada uno con sus datos clave del
// padrón (data-territorial) cuando cruza por cod_local.
function _download(blob,filename){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.style.display='none';document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(url);a.remove()},250)}
// Normaliza el CODLOCAL del visor ("241943.0") al cod_local del padron ("241943").
function _codLocal(id){const s=String(id==null?'':id).trim();return s.endsWith('.0')?s.slice(0,-2):s}
// Un campo CSV: entrecomilla si trae separador, comillas o salto de línea.
function _csvCell(v){if(v==null)return '';let s=String(v);return /[";\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}
function _csv(rows){return '﻿'+rows.map(r=>r.map(_csvCell).join(';')).join('\r\n')}
// Colegios del ranking actual (toda la lista visible con los filtros/escenario vigentes).
function v2ColegiosVisibles(){return (v2Last||[]).filter(u=>u.tipo==='colegios')}
function exportColegiosCsv(){
  const cols=v2ColegiosVisibles();
  if(!cols.length){alert('No hay colegios en el ranking con los filtros y el escenario actuales.\n\nEnciende el dominio Social y el tipo Colegios (panel izquierdo), revisa el territorio y el escenario, y vuelve a descargar.');return}
  const P=colegiosPadron||{};
  const header=['Código local','Nombre','Distrito','Centro poblado','Zona AIS','UGEL','Área de influencia',
    'Nivel de exposición','Por inundación','Por mov. en masa','Canal de exposición','Distancia a punto crítico (m)','Peligro cercano','Escenario','Riesgo (1-5)','Proyecto de prevención cercano (m)',
    'Matrícula (alumnos)','Mat. inicial','Mat. primaria','Mat. secundaria',
    'Estado estructural','Necesidad interv. estructural','Brecha estimada (S/)','Área techada (m2)',
    'Grupo de prioridad','Orden prioridad nacional','Orden prioridad distrital',
    'Con proyecto público','Unidad ejecutora','CUI (PI)',
    'Acceso agua','Acceso alcantarillado','Acceso energía','Acceso internet',
    'Mant. 2026 beneficiario','Mant. 2026 total (S/)','SíseVe casos','En padrón data-territorial'];
  const int=x=>{if(x==null||x==='')return '';const n=Number(x);return isFinite(n)?Math.round(n):''};
  const sevTxt=s=>SEV_LABEL[s]||'';
  const rows=[header];
  cols.forEach(u=>{const cod=_codLocal(u.id),p=P[cod]||null,h=u._haz||{};
    rows.push([
      cod,(p&&p.nombre)||u.nombre||'',u.distrito||'',(p&&p.centro_poblado)||'',(p&&p.zona_ais)||'',(p&&p.ugel)||'',u.tipoInf||'',
      SEV_LABEL[u._lvl]||'',h.inundacion?sevTxt(h.inundacion.sev):'',h.mov_masa?sevTxt(h.mov_masa.sev):'',u._canal||'',
      u.dist!=null?Math.round(u.dist):'',u.peligro||'',escLabel(state.scenario),u.stars!=null?u.stars:'',
      (u.proj&&u.proj.dist!=null&&u.proj.dist<=state.scenario)?Math.round(u.proj.dist):'',
      p?int(p.matricula):int(u.mag),p?int(p.mat_inicial):'',p?int(p.mat_primaria):'',p?int(p.mat_secundaria):'',
      p?(p.estado_estructural||''):'',p?(p.necesidad_intervencion_estructural||''):'',p?int(p.brecha_estimada_soles):'',p?int(p.area_techada_m2):'',
      p?(p.grupo_prioridad||''):'',p?(p.orden_prioridad_nacional||''):'',p?(p.orden_prioridad_distrital||''):'',
      p?(p.con_proyecto_publico||''):'',p?(p.unidad_ejecutora||''):'',p?(p.cui_pi||''):'',
      p?(p.acceso_agua||''):'',p?(p.acceso_alcantarillado||''):'',p?(p.acceso_energia||''):'',p?(p.acceso_internet||''):'',
      p?(p.mant_2026_beneficiario||''):'',p?int(p.mant_2026_total_soles):'',p?int(p.siseve_casos):'',p?'Sí':'No']);
  });
  const stamp=new Date().toISOString().slice(0,10);
  _download(new Blob([_csv(rows)],{type:'text/csv;charset=utf-8'}),`colegios-expuestos-fen-${stamp}.csv`);
}
// Botón del pie: refleja cuántos colegios hay en el ranking y se habilita solo si hay al menos uno.
// Envuelve renderExpuestas (región MOD2) SIN editar esa región.
function updateExportBtn(){const n=v2ColegiosVisibles().length,btn=document.getElementById('v2Export');if(!btn)return;btn.disabled=n===0;const lbl=btn.querySelector('.dl-lbl');if(lbl)lbl.textContent=n?`Descargar lista · ${n} colegio${n===1?'':'s'} (CSV)`:'Descargar lista (CSV)'}
const _renderExpuestasBase=renderExpuestas;
renderExpuestas=function(){_renderExpuestasBase.apply(this,arguments);updateExportBtn()};

async function init(){makeMaps();const EMPTY={type:'FeatureCollection',features:[]};/* Build "solo Unidades expuestas": capas territoriales pesadas (cultivos, road_segments, carreteras + relaciones) NO se cargan; se stubean vacias. */[subzones,criticals,assets.colegios,assets.salud,assets.comedores,assets.puentes,assets.progresol]=await Promise.all([loadJSON('subzonas.geojson'),loadJSON('critical_points.geojson'),loadJSON('colegios.geojson'),loadJSON('salud.geojson'),loadJSON('comedores.geojson'),loadJSON('puentes.geojson'),loadJSON('progresol.geojson')]);relations=[];roadRelations=[];cropRelations=[];roadSegments=EMPTY;roads=EMPTY;crops=EMPTY;indexData();
const loadWeb=async f=>{try{const r=await fetch(`./data/${f}?v=${BUILD}`,{cache:'no-store'});return r.ok?await r.json():null}catch(e){console.warn(f,e);return null}};
[puntosTerr,concesiones,corredores,progresolNac,corredoresPC,deptos,unidadesOp,terrComercial,viasDS,viasSociales,viasLocales,viasAcceso,canalASocial]=await Promise.all([
  loadWeb('puntos-criticos-territorio-comercial.geojson'),loadWeb('concesiones-unacem.geojson'),
  loadWeb('corredores-mtc.geojson'),loadWeb('progresol-nacional.geojson'),loadWeb('corredores-fen-puntos.geojson'),loadWeb('peru-departamental.geojson'),loadWeb('unidades-operacionales.geojson'),loadWeb('territorio-comercial-unacem.geojson'),loadWeb('vias-despacho-suministro.geojson'),loadWeb('vias-sociales.geojson'),loadWeb('vias-locales-fen.geojson'),loadWeb('vias-acceso-planta-atocongo.geojson'),loadWeb('canalA-social.json')]);
const canalAVias=await loadWeb('canalA-vias.json');
if(canalAVias){if(canalASocial)Object.assign(canalASocial,canalAVias);else canalASocial=canalAVias;}
const canalANeg=await loadWeb('canalA-negocio.json');
if(canalANeg){if(canalASocial)Object.assign(canalASocial,canalANeg);else canalASocial=canalANeg;}
// Elementos expuestos SIGRID: se cargan y se registran como tipos del dominio social (contrato V4 §6).
[eeUnidades,eeCatalogo]=await Promise.all([loadWeb('ee_unidades.json'),loadWeb('ee_catalogo.json')]);
if(eeCatalogo)for(const c of eeCatalogo){if(!V2_TYPES.social.includes(c.key))V2_TYPES.social.push(c.key);if(!(c.key in V2_LABEL))V2_LABEL[c.key]=c.label;}
// Datos clave del padron de escuelas (data-territorial), para la descarga Excel de colegios expuestos.
colegiosPadron=await loadWeb('colegios-padron.json')||{};
buildV2Index();
renderFilters();setupControls();wireV2Search();updateAll(true);const hv=(location.hash||'').replace('#','');if(['territorial','detail','prioriza'].includes(hv)){const tab=document.querySelector(`.tab[data-view="${hv}"]`);if(tab)tab.click()}}
init().catch(e=>{console.error(e);document.body.insertAdjacentHTML('beforeend',`<div style="position:fixed;inset:20px;background:white;z-index:99999;padding:30px;border:3px solid red"><b>Error cargando la V2:</b><pre>${escapeHtml(e.stack||e.message)}</pre></div>`)})
