/* Audit patrimoine – saisie terrain hors ligne (POC). Aucun appel réseau : tout reste sur l'appareil. */
'use strict';
const C = window.CONFIG;
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ETATS = C.lists.L_Etat;
const TECH = Object.fromEntries(C.technique.map(r => [r.row, r]));
const ui = { audit: null, tab: 'visite', lot: null, photoTarget: null };
const thumbs = new Map();

/* ---------------- IndexedDB ---------------- */
let db;
function openDB() {
  return new Promise((ok, ko) => {
    const rq = indexedDB.open('auditGray', 1);
    rq.onupgradeneeded = () => {
      rq.result.createObjectStore('audits', { keyPath: 'id' });
      rq.result.createObjectStore('photos', { keyPath: 'id' });
    };
    rq.onsuccess = () => { db = rq.result; ok(); };
    rq.onerror = () => ko(rq.error);
  });
}
function tx(store, mode, fn) {
  return new Promise((ok, ko) => {
    const t = db.transaction(store, mode); const s = t.objectStore(store);
    const r = fn(s); t.oncomplete = () => ok(r && r.result); t.onerror = () => ko(t.error); t.onabort = () => ko(t.error);
  });
}
const dbAll = s => tx(s, 'readonly', st => st.getAll());
const dbGet = (s, k) => tx(s, 'readonly', st => st.get(k));
const dbPut = (s, v) => tx(s, 'readwrite', st => st.put(v));
const dbDel = (s, k) => tx(s, 'readwrite', st => st.delete(k));

/* ---------------- Sauvegarde auto ---------------- */
let saveTimer = null;
function touch() {
  ui.audit.updated = Date.now();
  $('#save').textContent = '…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 300);
}
async function flush() {
  clearTimeout(saveTimer); saveTimer = null;
  if (!ui.audit) return;
  try {
    await dbPut('audits', ui.audit);
    $('#save').textContent = '✓ ' + new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch (e) { $('#save').textContent = '⚠ non enregistré'; toast('Erreur d\'enregistrement : ' + e.message); }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && saveTimer) flush(); });
window.addEventListener('pagehide', () => { if (saveTimer) flush(); });

function toast(m, ms = 3000) {
  const d = document.createElement('div'); d.className = 'toast'; d.setAttribute('role', 'status'); d.textContent = m;
  document.body.appendChild(d); setTimeout(() => d.remove(), ms);
}

/* ---------------- Accueil ---------------- */
async function home() {
  if (saveTimer) await flush();
  ui.audit = null; ui.lot = null;
  $('#tabs').classList.add('hidden'); $('#title').textContent = 'Audit patrimoine – Ville de Gray'; $('#save').textContent = '';
  const audits = (await dbAll('audits')).sort((a, b) => b.updated - a.updated);
  const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
  let est = '';
  if (navigator.storage && navigator.storage.estimate) {
    const e = await navigator.storage.estimate(); est = `Stockage utilisé : ${(e.usage / 1048576).toFixed(1)} Mo sur ${(e.quota / 1048576 / 1024).toFixed(1)} Go disponibles.`;
  }
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  $('#main').innerHTML = `
    ${!standalone ? '<div class="alert">Pour un usage hors ligne fiable, installez l\'application sur l\'écran d\'accueil (Safari : Partager › Sur l\'écran d\'accueil ; Chrome : ⋮ › Installer l\'application).</div>' : ''}
    ${!persisted ? '<div class="alert">Le stockage n\'est pas garanti par le navigateur : exportez chaque audit (ZIP) en fin de visite. <button type="button" class="btn sec" id="bPersist">Demander un stockage persistant</button></div>' : ''}
    <div class="card"><h2>Nouvel audit</h2>
      <label class="f"><span>Bâtiment</span><select id="newBat"><option value="">— Choisir —</option>
      ${C.batiments.map((b, i) => `<option value="${i}">${esc(b.libelle)} (${esc(b.code)})</option>`).join('')}</select></label>
      <button type="button" class="btn big" id="bNew">Créer l'audit</button></div>
    <div class="card"><h2>Audits sur cette tablette (${audits.length})</h2>
      ${audits.length ? audits.map(a => {
        const unsaved = !a.exported || a.updated > a.exported;
        return `<div class="card audit"><div><b>${esc(a.libelle)}</b><div class="mut">${esc(a.code)} · modifié ${new Date(a.updated).toLocaleString('fr-FR')} · ${a.ph.length} photo(s)</div>
          <div class="mut" style="color:${unsaved ? 'var(--warn)' : 'var(--ok)'}">${unsaved ? '⚠ Modifications non exportées' : '✓ Exporté le ' + new Date(a.exported).toLocaleString('fr-FR')}</div></div>
          <div><button type="button" class="btn" data-open="${a.id}">Ouvrir</button><button type="button" class="btn sec" data-del="${a.id}" aria-label="Supprimer">🗑</button></div></div>`;
      }).join('') : '<p class="mut">Aucun audit.</p>'}
    </div>
    <div class="card"><h2>Restaurer une sauvegarde</h2><p class="mut">Recharge un ZIP exporté par cette application (données + photos).</p>
      <button type="button" class="btn sec" id="bRestore">Choisir un fichier ZIP</button></div>
    <p class="mut">${est} Trame : ${esc(C.source)} – bibliothèques du ${esc(C.version)}.</p>`;
  $('#bNew').onclick = createAudit;
  $('#bRestore').onclick = () => $('#fileZip').click();
  const bp = $('#bPersist'); if (bp) bp.onclick = async () => { const ok = await navigator.storage.persist(); toast(ok ? 'Stockage persistant accordé' : 'Refusé par le navigateur – installez l\'application puis réessayez'); home(); };
  $('#main').querySelectorAll('[data-open]').forEach(b => b.onclick = () => openAudit(b.dataset.open));
  $('#main').querySelectorAll('[data-del]').forEach(b => b.onclick = () => deleteAudit(b.dataset.del));
}

async function createAudit() {
  const i = $('#newBat').value; if (i === '') return toast('Choisissez un bâtiment');
  const b = C.batiments[i];
  const a = {
    id: b.code + '-' + Date.now().toString(36), libelle: b.libelle, code: b.code, nom: b.nom,
    created: Date.now(), updated: Date.now(), exported: 0, nextNum: 1,
    v: { 'Historique!D20': new Date().toISOString().slice(0, 10) }, t: {}, f: {}, ph: []
  };
  await dbPut('audits', a); openAudit(a.id);
}
async function deleteAudit(id) {
  const a = await dbGet('audits', id);
  const warn = (!a.exported || a.updated > a.exported) ? '\n\n⚠ Cet audit contient des modifications NON exportées.' : '';
  if (!confirm(`Supprimer définitivement l'audit « ${a.libelle} » et ses ${a.ph.length} photo(s) de cette tablette ?${warn}`)) return;
  for (const p of a.ph) await dbDel('photos', p.id);
  await dbDel('audits', id); home();
}
async function openAudit(id) {
  ui.audit = await dbGet('audits', id); ui.lot = null;
  $('#title').textContent = ui.audit.libelle; $('#tabs').classList.remove('hidden');
  show(ui.tab);
}

/* ---------------- Navigation ---------------- */
$('#bHome').onclick = home;
$('#tabs').addEventListener('click', e => { const t = e.target.closest('[data-t]'); if (t) { if (t.dataset.t === 'tech') ui.lot = null; show(t.dataset.t); } });
function show(t) {
  ui.tab = t;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  ({ visite: rVisite, ident: rIdent, fonct: rFonct, tech: rTech, photos: rPhotos, export: rExport })[t]();
  window.scrollTo(0, 0);
}

/* ---------------- Champs génériques ---------------- */
function field(f) {
  const v = ui.audit.v[f.cell] ?? '';
  const cls = v !== '' ? 'filled' : '';
  const ph = f.defaut != null ? `placeholder="Trame : ${esc(f.defaut)}"` : '';
  let inp;
  if (f.type === 'list' && f.list === 'L_Auditeurs') {
    inp = `<input data-cell="${esc(f.cell)}" class="${cls}" list="dl_aud" value="${esc(v)}"><datalist id="dl_aud">${C.lists.L_Auditeurs.map(o => `<option value="${esc(o)}">`).join('')}</datalist>`;
  } else if (f.type === 'list') {
    const opts = C.lists[f.list] || [];
    inp = `<select data-cell="${esc(f.cell)}" class="${cls}"><option value="">${f.defaut != null ? '(trame : ' + esc(f.defaut) + ')' : '—'}</option>${opts.map(o => `<option${String(o) === String(v) ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  } else if (f.type === 'textarea') {
    inp = `<textarea data-cell="${esc(f.cell)}" class="${cls}">${esc(v)}</textarea>`;
  } else {
    const ty = f.type === 'number' ? 'number" inputmode="decimal" step="any' : f.type === 'date' ? 'date' : 'text';
    inp = `<input type="${ty}" data-cell="${esc(f.cell)}" class="${cls}" value="${esc(v)}" ${ph}>`;
  }
  return `<label class="f"><span>${esc(f.label)}</span>${inp}</label>`;
}
function bindCells(root) {
  root.querySelectorAll('[data-cell]').forEach(el => {
    const h = () => {
      let v = el.value.trim();
      if (el.type === 'number' && v !== '' && !isFinite(+v)) { toast('Nombre invalide'); return; }
      if (v === '') delete ui.audit.v[el.dataset.cell]; else ui.audit.v[el.dataset.cell] = v;
      el.classList.toggle('filled', v !== ''); touch();
    };
    el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', h);
  });
}

/* ---------------- Onglets simples ---------------- */
function rVisite() {
  const b = C.batiments.find(x => x.code === ui.audit.code) || {};
  $('#main').innerHTML = `<div class="card"><h2>${esc(ui.audit.libelle)}</h2><p class="mut">${esc(b.code)} – ${esc(b.adresse)} – ${esc(b.surface)} m²</p></div>
    <div class="card"><h2>Réalisation de la visite</h2><div class="grid">${C.visite.map(field).join('')}</div></div>`;
  bindCells($('#main'));
}
function rIdent() {
  const secs = {};
  C.identification.forEach(f => (secs[f.section] = secs[f.section] || []).push(f));
  const terr = [], bur = [];
  Object.entries(secs).forEach(([s, fs]) => {
    const t = fs.filter(f => f.terrain), o = fs.filter(f => !f.terrain);
    if (t.length) terr.push(`<div class="card"><h3>${esc(s)}</h3><div class="grid">${t.map(field).join('')}</div></div>`);
    if (o.length) bur.push(`<h3>${esc(s)}</h3><div class="grid">${o.map(field).join('')}</div>`);
  });
  $('#main').innerHTML = `<p class="mut">Les données de la liste du patrimoine et les propositions automatiques restent calculées dans la trame.</p>${terr.join('')}
    <div class="card"><details><summary>Autres champs (normalement complétés au bureau)</summary>${bur.join('')}</details></div>`;
  bindCells($('#main'));
}
function rFonct() {
  const f = ui.audit.f; let theme = '', h = '';
  C.fonctionnel.forEach(r => {
    if (r.theme !== theme) { if (theme) h += '</div>'; theme = r.theme; h += `<div class="card"><h3>${esc(theme)}</h3>`; }
    const d = f[r.row] || {};
    h += `<div style="margin:12px 0"><b>${esc(r.critere)}</b><div class="chips" style="margin-top:6px">${C.lists.L_Satisfaction.map(s =>
      `<button type="button" class="chip${d.a === s ? ' on' : ''}" data-fr="${r.row}" data-a="${esc(s)}">${esc(s)}</button>`).join('')}</div>
      <input type="text" placeholder="Commentaire" data-fc="${r.row}" value="${esc(d.c || '')}" style="margin-top:6px"></div>`;
  });
  $('#main').innerHTML = h + '</div>';
  $('#main').querySelectorAll('[data-fr]').forEach(b => b.onclick = () => {
    const d = f[b.dataset.fr] = f[b.dataset.fr] || {};
    d.a = d.a === b.dataset.a ? '' : b.dataset.a; touch();
    b.parentNode.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c.dataset.a === d.a));
  });
  $('#main').querySelectorAll('[data-fc]').forEach(i => i.oninput = () => { (f[i.dataset.fc] = f[i.dataset.fc] || {}).c = i.value; touch(); });
}

/* ---------------- État technique ---------------- */
const rowLot = r => TECH[r].lot || (ui.audit.t[r] && ui.audit.t[r].lot) || '';
const rowComp = r => (ui.audit.t[r] && ui.audit.t[r].comp) || TECH[r].comp;
const isVisible = r => TECH[r].comp || (ui.audit.t[r] && ui.audit.t[r].act);
const rowPhotos = r => ui.audit.ph.filter(p => p.row === r).sort((a, b) => a.num - b.num);
function constatOf(lot, ct) { return (C.constats[lot] || []).find(x => x.c === ct); }
function rowStatus(r) {
  const d = ui.audit.t[r] || {};
  const bad = d.etat === 'Mauvais' || d.etat === 'Hors service / Inexistant';
  if ((bad && !d.ct) || (d.ct && !d.etat)) return 'warn';
  return d.etat ? 'done' : '';
}
function rTech() { ui.lot ? rLot() : rLots(); }
function rLots() {
  const lots = C.lists.L_Lots;
  $('#main').innerHTML = `<p class="mut">Choisir un lot. Pour chaque composant : l'état, puis un constat type. Nature, criticité, préconisation, coût et programmation sont calculés dans la trame.</p>` +
    lots.map(l => {
      const rows = C.technique.filter(r => rowLot(r.row) === l && isVisible(r.row)).map(r => r.row);
      const done = rows.filter(r => (ui.audit.t[r] || {}).etat).length;
      const warn = rows.filter(r => rowStatus(r) === 'warn').length;
      return `<button type="button" class="lot" data-lot="${esc(l)}"><span>${esc(l)}</span><span>${warn ? `<span class="badge" style="color:var(--warn)">⚠ ${warn}</span> ` : ''}<span class="badge">${done} / ${rows.length}</span></span></button>`;
    }).join('');
  $('#main').querySelectorAll('[data-lot]').forEach(b => b.onclick = () => { ui.lot = b.dataset.lot; rLot(); window.scrollTo(0, 0); });
}
function rLot() {
  const l = ui.lot;
  const rows = C.technique.filter(r => rowLot(r.row) === l && isVisible(r.row)).map(r => r.row);
  $('#main').innerHTML = `<button type="button" class="btn sec" id="bBack">‹ Lots</button><h2>${esc(l)}</h2><div id="rows">${rows.map(rowCard).join('')}</div>
    <button type="button" class="btn big sec" id="bAdd">+ Ajouter un composant / constat</button>`;
  $('#bBack').onclick = () => { ui.lot = null; rLots(); };
  $('#bAdd').onclick = addRow;
  rows.forEach(bindRow);
}
function addRow() {
  const l = ui.lot;
  let r = C.technique.find(x => x.lot === l && !x.comp && !(ui.audit.t[x.row] && ui.audit.t[x.row].act));
  if (!r) r = C.technique.find(x => !x.lot && !(ui.audit.t[x.row] && ui.audit.t[x.row].act));
  if (!r) return toast('Plus de ligne libre dans la trame (184 lignes)');
  ui.audit.t[r.row] = { act: 1, lot: r.lot ? undefined : l };
  touch();
  const div = document.createElement('div'); div.innerHTML = rowCard(r.row);
  $('#rows').appendChild(div.firstElementChild); bindRow(r.row);
  $(`#r${r.row}`).scrollIntoView({ behavior: 'smooth' });
}
function rowCard(r) {
  const d = ui.audit.t[r] || {}, lot = rowLot(r), comp = rowComp(r), blank = !TECH[r].comp;
  const ct = d.ct ? constatOf(lot, d.ct) : null;
  const bad = d.etat === 'Mauvais' || d.etat === 'Hors service / Inexistant';
  let auto = '';
  if (ct && ct.preco) auto = `<div class="auto"><b>Proposé :</b> ${esc(ct.preco)}<br>Nature ${esc(ct.nat)} · Criticité ${esc(ct.crit)} · ${esc(ct.typo)}</div>`;
  else if (ct) auto = '<div class="auto">Pas de préconisation associée.</div>';
  else if (bad) auto = '<div class="auto" style="color:var(--warn)">⚠ Choisir un constat type (sinon préconisation à saisir au bureau).</div>';
  const ouvs = C.ouvrages[lot] || [];
  const unit = (ouvs.find(o => o.n === d.ouv) || {}).u;
  const ph = rowPhotos(r);
  const opt = (list, v) => list.map(o => `<option${String(o) === String(v ?? '') ? ' selected' : ''}>${esc(o)}</option>`).join('');
  return `<div class="card row ${rowStatus(r)}" id="r${r}">
    <div style="display:flex;justify-content:space-between;gap:8px"><b>N° ${r - 6} – ${esc(comp || 'Nouveau composant')}</b>${d.loc ? `<span class="badge">${esc(d.loc)}</span>` : ''}</div>
    ${blank ? `<label class="f"><span>Composant</span><input data-k="comp" list="dlc${r}" value="${esc(d.comp || '')}" placeholder="Choisir ou saisir"><datalist id="dlc${r}">${(C.composants[lot] || []).map(o => `<option value="${esc(o)}">`).join('')}</datalist></label>` : ''}
    <div class="chips" style="margin-top:8px">${ETATS.map(e => `<button type="button" class="chip e-${esc(e.split(' ')[0])}${d.etat === e ? ' on' : ''}" data-etat="${esc(e)}">${esc(e)}</button>`).join('')}</div>
    <label class="f"><span>Constat type</span><select data-k="ct"><option value="">—</option>${opt((C.constats[lot] || []).map(x => x.c), d.ct)}</select></label>
    ${auto}
    <label class="f"><span>Précisions sur le constat</span><textarea data-k="pr" rows="2">${esc(d.pr || '')}</textarea></label>
    <details${d.loc || d.ouv || d.an || d.q ? ' open' : ''}><summary>Localisation, ouvrage, année, quantité</summary><div class="grid">
      <label class="f"><span>Localisation</span><select data-k="loc"><option value="">—</option>${opt(C.lists.L_Localisation, d.loc)}</select></label>
      <label class="f"><span>Type d'ouvrage (facultatif)</span><select data-k="ouv"><option value="">—</option>${opt(ouvs.map(o => o.n), d.ouv)}</select></label>
      <label class="f"><span>Année de mise en service</span><input data-k="an" type="number" inputmode="numeric" min="1500" max="2100" value="${esc(d.an || '')}"></label>
      <label class="f"><span>Quantité${unit ? ' (' + esc(unit) + ')' : ''}</span><input data-k="q" type="number" inputmode="decimal" step="any" min="0" value="${esc(d.q || '')}">${ct && ct.f ? `<span class="mut">Forfait du constat : ${ct.f} € HT – il sera multiplié par la quantité dans la trame.</span>` : ''}</label>
    </div></details>
    <div><button type="button" class="btn sec" data-cam="${r}">📷 Photo</button><button type="button" class="btn sec" data-gal="${r}">🖼 Galerie</button></div>
    <div class="thumbs">${ph.map(thumbHtml).join('')}</div>
    ${blank ? `<button type="button" class="btn sec" data-rm="${r}" style="margin-top:6px">Retirer cette ligne</button>` : ''}
  </div>`;
}
function bindRow(r) {
  const el = $(`#r${r}`);
  const d = () => (ui.audit.t[r] = ui.audit.t[r] || {});
  const redraw = () => { const n = document.createElement('div'); n.innerHTML = rowCard(r); el.replaceWith(n.firstElementChild); bindRow(r); };
  el.querySelectorAll('[data-etat]').forEach(b => b.onclick = () => { const o = d(); o.etat = o.etat === b.dataset.etat ? '' : b.dataset.etat; touch(); redraw(); });
  el.querySelectorAll('select[data-k]').forEach(s => s.onchange = () => { d()[s.dataset.k] = s.value; touch(); redraw(); });
  el.querySelectorAll('input[data-k],textarea[data-k]').forEach(i => {
    i.oninput = () => {
      if (i.type === 'number' && i.value !== '' && !isFinite(+i.value)) return;
      d()[i.dataset.k] = i.value.trim(); touch();
    };
    if (i.dataset.k === 'comp') i.onchange = () => { const h = el.querySelector('b'); if (h) h.textContent = `N° ${r - 6} – ${i.value || 'Nouveau composant'}`; };
  });
  el.querySelectorAll('[data-cam]').forEach(b => b.onclick = () => { ui.photoTarget = r; $('#fileCam').click(); });
  el.querySelectorAll('[data-gal]').forEach(b => b.onclick = () => { ui.photoTarget = r; $('#fileGal').click(); });
  bindThumbs(el, redraw);
  const rm = el.querySelector('[data-rm]');
  if (rm) rm.onclick = async () => {
    if (!confirm('Retirer cette ligne et ses photos ?')) return;
    for (const p of rowPhotos(r)) await removePhoto(p.id, true);
    delete ui.audit.t[r]; touch(); el.remove();
  };
}

/* ---------------- Photos ---------------- */
function thumbHtml(p) {
  return `<div class="thumb"><img data-th="${p.id}" alt="Photo ${p.num}"><b>${p.num}</b><button type="button" data-delph="${p.id}" aria-label="Supprimer la photo ${p.num}">✕</button></div>`;
}
async function bindThumbs(root, after) {
  root.querySelectorAll('[data-delph]').forEach(b => b.onclick = async () => {
    if (!confirm('Supprimer cette photo ?')) return;
    await removePhoto(b.dataset.delph); after();
  });
  for (const img of root.querySelectorAll('[data-th]')) {
    const id = img.dataset.th;
    if (!thumbs.has(id)) { const rec = await dbGet('photos', id); if (rec) thumbs.set(id, URL.createObjectURL(rec.blob)); }
    if (thumbs.has(id)) img.src = thumbs.get(id);
  }
}
async function removePhoto(id, silent) {
  ui.audit.ph = ui.audit.ph.filter(p => p.id !== id);
  await dbDel('photos', id);
  if (thumbs.has(id)) { URL.revokeObjectURL(thumbs.get(id)); thumbs.delete(id); }
  touch(); if (!silent) toast('Photo supprimée (son numéro n\'est pas réattribué)');
}
async function compress(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = url; await img.decode();
    const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const cv = document.createElement('canvas');
    cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    return await new Promise((ok, ko) => cv.toBlob(b => b ? ok(b) : ko(new Error('Compression impossible')), 'image/jpeg', 0.82));
  } finally { URL.revokeObjectURL(url); }
}
async function onFiles(e) {
  const files = [...e.target.files]; e.target.value = '';
  if (!files.length || !ui.audit) return;
  for (const f of files) {
    if (ui.audit.nextNum > C.photosMax) { toast(`Limite de ${C.photosMax} photos de la trame atteinte`); break; }
    try {
      const blob = await compress(f);
      const id = ui.audit.id + '-p' + ui.audit.nextNum + '-' + Date.now().toString(36);
      await dbPut('photos', { id, blob });
      ui.audit.ph.push({ id, num: ui.audit.nextNum++, row: ui.photoTarget, com: '', ts: Date.now() });
      touch();
    } catch (err) { toast('Photo non enregistrée : ' + err.message); }
  }
  await flush();
  if (ui.tab === 'tech' && ui.photoTarget) {
    const el = $(`#r${ui.photoTarget}`);
    if (el) { const n = document.createElement('div'); n.innerHTML = rowCard(ui.photoTarget); el.replaceWith(n.firstElementChild); bindRow(ui.photoTarget); }
  } else if (ui.tab === 'photos') rPhotos();
}
$('#fileCam').onchange = onFiles; $('#fileGal').onchange = onFiles;

function rPhotos() {
  const ph = [...ui.audit.ph].sort((a, b) => a.num - b.num);
  $('#main').innerHTML = `<div class="card"><h2>Photos (${ph.length})</h2>
    <p class="mut">Les photos prises depuis une ligne de l'état technique y sont liées automatiquement. Ajoutez ici les photos générales (façades, vues d'ensemble…).</p>
    <button type="button" class="btn" id="pCam">📷 Photo générale</button><button type="button" class="btn sec" id="pGal">🖼 Galerie</button></div>
    ${ph.map(p => `<div class="card" style="display:flex;gap:12px;align-items:flex-start"><div class="thumbs" style="margin:0">${thumbHtml(p)}</div>
      <div style="flex:1"><div class="mut">${p.row ? `Ligne N° ${p.row - 6} – ${esc(rowComp(p.row))} (${esc(rowLot(p.row))})` : 'Photo générale'}</div>
      <input type="text" placeholder="Commentaire" data-pc="${p.id}" value="${esc(p.com)}"></div></div>`).join('')}`;
  $('#pCam').onclick = () => { ui.photoTarget = null; $('#fileCam').click(); };
  $('#pGal').onclick = () => { ui.photoTarget = null; $('#fileGal').click(); };
  $('#main').querySelectorAll('[data-pc]').forEach(i => i.oninput = () => { ui.audit.ph.find(p => p.id === i.dataset.pc).com = i.value; touch(); });
  bindThumbs($('#main'), rPhotos);
}

/* ---------------- Export : fichier d'import trame (TSV) ---------------- */
function buildImport(a) {
  const L = [];
  const e = s => String(s).replace(/\\/g, '\\\\').replace(/\t/g, ' ').replace(/\r?\n/g, '\\n');
  const add = (ref, v, t = 's') => { const [sh, c] = ref.split('!'); L.push([sh, c, t, e(v)].join('\t')); };
  add('Page de garde!B9', a.libelle);
  const types = {}; [...C.visite, ...C.identification].forEach(f => types[f.cell] = f.type);
  Object.entries(a.v).forEach(([k, v]) => add(k, v, types[k] === 'number' ? 'n' : types[k] === 'date' ? 'd' : 's'));
  Object.entries(a.f).forEach(([r, d]) => { if (d.a !== undefined) add(`Etat fonctionnel!D${r}`, d.a); if (d.c !== undefined) add(`Etat fonctionnel!F${r}`, d.c); });
  Object.keys(a.t).map(Number).sort((x, y) => x - y).forEach(r => {
    const d = a.t[r], o = TECH[r], S = 'Etat technique!';
    if (!o) return;
    const has = ['comp', 'ouv', 'loc', 'an', 'etat', 'ct', 'pr', 'q'].some(k => d[k]) || a.ph.some(p => p.row === r);
    if (!has && !o.comp) return;
    if (!o.lot && d.lot) add(S + 'B' + r, d.lot);
    if (d.comp !== undefined && d.comp !== o.comp) add(S + 'C' + r, d.comp);
    if (d.ouv !== undefined) add(S + 'D' + r, d.ouv);
    if (d.loc !== undefined) add(S + 'E' + r, d.loc);
    if (d.an !== undefined) add(S + 'F' + r, d.an, d.an === '' ? 's' : 'n');
    if (d.etat !== undefined) add(S + 'I' + r, d.etat);
    if (d.ct !== undefined) add(S + 'J' + r, d.ct);
    if (d.pr !== undefined) add(S + 'K' + r, d.pr);
    if (d.q !== undefined) add(S + 'P' + r, d.q, d.q === '' ? 's' : 'n');
  });
  const byRow = {};
  a.ph.slice().sort((x, y) => x.num - y.num).forEach(p => {
    let com = p.com || '';
    if (p.row) {
      if (!byRow[p.row]) { byRow[p.row] = p.num; add('Etat technique!V' + p.row, p.num, 'n'); }
      else com = `Lié au N° ${p.row - 6} – ${rowLotComp(a, p.row)}` + (com ? ' : ' + com : '');
    }
    if (com) add('Rapport photos!G' + (8 + p.num), com);
  });
  const head = ['#AUDIT_TERRAIN', 'v1', a.code, a.libelle, new Date().toISOString(), C.version].map(e).join('\t');
  return '\ufeff' + head + '\r\n' + L.join('\r\n') + '\r\n';
}
function rowLotComp(a, r) { return ((a.t[r] && a.t[r].comp) || TECH[r].comp || '') ; }

/* ---------------- ZIP (sans compression, sans bibliothèque externe) ---------------- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function makeZip(files) {
  const enc = new TextEncoder(), parts = [], cd = []; let off = 0;
  const d = new Date(), dt = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)), dd = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate());
  for (const f of files) {
    const name = enc.encode(f.name), data = f.data, crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, dt, true); h.setUint16(12, dd, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
    h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    parts.push(h.buffer, name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, dt, true); c.setUint16(14, dd, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
    c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    cd.push(c.buffer, name);
    off += 30 + name.length + data.length;
  }
  const cdSize = cd.reduce((s, x) => s + x.byteLength, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, cdSize, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...cd, e.buffer], { type: 'application/zip' });
}
async function readZip(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer()), dv = new DataView(buf.buffer), dec = new TextDecoder();
  let p = buf.length - 22; while (p >= 0 && dv.getUint32(p, true) !== 0x06054b50) p--;
  if (p < 0) throw new Error('ZIP illisible');
  const n = dv.getUint16(p + 10, true); let o = dv.getUint32(p + 16, true); const out = {};
  for (let i = 0; i < n; i++) {
    const meth = dv.getUint16(o + 10, true), csz = dv.getUint32(o + 20, true), nl = dv.getUint16(o + 28, true), xl = dv.getUint16(o + 30, true), cl = dv.getUint16(o + 32, true), lo = dv.getUint32(o + 42, true);
    const name = dec.decode(buf.subarray(o + 46, o + 46 + nl));
    const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
    let data = buf.slice(start, start + csz);
    if (meth === 8) {
      if (typeof DecompressionStream === 'undefined') throw new Error('ZIP compressé non pris en charge sur cet appareil');
      data = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    } else if (meth !== 0) throw new Error('Méthode de compression non prise en charge');
    out[name] = data; o += 46 + nl + xl + cl;
  }
  return out;
}

async function buildExport(a) {
  await flush();
  const enc = new TextEncoder(), files = [];
  files.push({ name: `${a.code}_import_trame.tsv`, data: enc.encode(buildImport(a)) });
  files.push({ name: `${a.code}_sauvegarde.json`, data: enc.encode(JSON.stringify({ app: 'audit-gray', cfg: C.version, audit: a }, null, 1)) });
  const missing = [];
  for (const p of a.ph.slice().sort((x, y) => x.num - y.num)) {
    const rec = await dbGet('photos', p.id);
    if (!rec) { missing.push(p.num); continue; }
    files.push({ name: `${a.code}/${p.num}.jpg`, data: new Uint8Array(await rec.blob.arrayBuffer()) });
  }
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '_');
  return { blob: makeZip(files), name: `Audit_${a.code}_${stamp}.zip`, missing };
}
async function markExported() { ui.audit.exported = Date.now(); await dbPut('audits', ui.audit); }

function rExport() {
  const a = ui.audit;
  const nT = Object.values(a.t).filter(d => d.etat).length;
  const nW = Object.keys(a.t).filter(r => rowStatus(+r) === 'warn').length;
  const nF = Object.values(a.f).filter(d => d.a).length;
  const unsaved = !a.exported || a.updated > a.exported;
  const canShare = !!(navigator.canShare && window.File);
  $('#main').innerHTML = `<div class="card"><h2>Bilan de saisie</h2>
    <p>Composants évalués : <b>${nT}</b> · Lignes à vérifier : <b style="color:${nW ? 'var(--warn)' : 'inherit'}">${nW}</b><br>
    Critères fonctionnels : <b>${nF} / ${C.fonctionnel.length}</b> · Champs visite / identification : <b>${Object.keys(a.v).length}</b> · Photos : <b>${a.ph.length}</b></p>
    <p style="color:${unsaved ? 'var(--warn)' : 'var(--ok)'}">${unsaved ? '⚠ Des modifications n\'ont pas encore été exportées.' : '✓ Dernier export : ' + new Date(a.exported).toLocaleString('fr-FR')}</p></div>
    <div class="card"><h2>Exporter</h2><p class="mut">Le ZIP contient les données (fichier d'import pour la trame + sauvegarde complète) et les photos nommées 1.jpg, 2.jpg… dans un dossier ${esc(a.code)}.</p>
    <button type="button" class="btn big" id="bZip">⬇ Enregistrer le ZIP</button>
    ${canShare ? '<button type="button" class="btn big sec" id="bShare">↗ Partager le ZIP (Fichiers, OneDrive, e-mail…)</button>' : ''}</div>
    <div class="card"><h3>Au bureau</h3><ol class="mut"><li>Décompresser le ZIP ; copier le dossier ${esc(a.code)} dans le dossier racine des photos (onglet Paramètres).</li>
    <li>Ouvrir une copie vierge de la trame, lancer la macro <b>ImporterSaisieTerrain</b> et choisir le fichier ${esc(a.code)}_import_trame.tsv.</li>
    <li>Contrôler l'onglet État technique (colonne « Contrôle de saisie »), puis insérer les photos (macro AffImage).</li></ol></div>`;
  $('#bZip').onclick = async () => {
    const { blob, name, missing } = await buildExport(a);
    const url = URL.createObjectURL(blob), l = document.createElement('a'); l.href = url; l.download = name;
    document.body.appendChild(l); l.click(); l.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    await markExported(); toast(missing.length ? `Export fait – photos introuvables : ${missing.join(', ')}` : 'ZIP enregistré – vérifiez sa présence dans Fichiers / Téléchargements', 5000);
    rExport();
  };
  const bs = $('#bShare');
  if (bs) bs.onclick = async () => {
    const { blob, name } = await buildExport(a);
    const file = new File([blob], name, { type: 'application/zip' });
    if (!navigator.canShare({ files: [file] })) return toast('Partage de fichier non pris en charge – utilisez « Enregistrer le ZIP »');
    try { await navigator.share({ files: [file], title: name }); await markExported(); rExport(); }
    catch (e) { if (e.name !== 'AbortError') toast('Partage impossible : ' + e.message); }
  };
}

/* ---------------- Restauration ---------------- */
$('#fileZip').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const z = await readZip(f);
    const jn = Object.keys(z).find(n => n.endsWith('_sauvegarde.json'));
    if (!jn) throw new Error('Pas de fichier de sauvegarde dans ce ZIP');
    const { audit: a } = JSON.parse(new TextDecoder().decode(z[jn]));
    const ex = await dbGet('audits', a.id);
    if (ex && !confirm(`L'audit « ${a.libelle} » existe déjà sur cette tablette (modifié le ${new Date(ex.updated).toLocaleString('fr-FR')}). Le remplacer par la sauvegarde ?`)) return;
    if (ex) for (const p of ex.ph) await dbDel('photos', p.id);
    let miss = 0;
    for (const p of a.ph) {
      const d = z[`${a.code}/${p.num}.jpg`];
      if (d) await dbPut('photos', { id: p.id, blob: new Blob([d], { type: 'image/jpeg' }) }); else miss++;
    }
    await dbPut('audits', a);
    toast(`Audit restauré${miss ? ` (${miss} photo(s) absente(s) du ZIP)` : ''}`, 4000); home();
  } catch (err) { toast('Restauration impossible : ' + err.message, 5000); }
};

/* ---------------- Démarrage ---------------- */
(async () => {
  try { await openDB(); } catch (e) { $('#main').innerHTML = `<div class="alert">Stockage local indisponible (navigation privée ?) : ${esc(e.message)}</div>`; return; }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persisted().then(p => { if (!p) navigator.storage.persist(); });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  home();
})();
