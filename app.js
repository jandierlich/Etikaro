// ===== Etikaro — App-Logik =====
// Speicherung ausschließlich lokal (IndexedDB). Kein Server-Zugriff.

const DB_NAME = 'etikaro-db';
const DB_VERSION = 1;
const STORE = 'produkte';
let db = null;
let currentEditId = null;
let pendingPhotoDataUrl = null;
let currentQty = 1;
let allEntries = [];
let activeCategoryFilter = null; // Klick auf Kategorie-Zeile
let currentView = 'list'; // 'list' | 'table'
let sortKey = 'aktualisiert';
let sortDir = 'desc';
let exportSelection = new Set(); // Kategorien, die für den PDF-Export ausgewählt sind
let lastPdfBlobUrl = null;
let lastPdfBlob = null;

const CAT_PALETTE = [
  {bg:'var(--violet)', soft:'var(--violet-soft)'},
  {bg:'var(--teal)', soft:'var(--teal-soft)'},
  {bg:'var(--pink)', soft:'var(--pink-soft)'}
];
function colorForCategory(name){
  const key = (name || 'Ohne Kategorie');
  let hash = 0;
  for(let i=0;i<key.length;i++) hash = (hash*31 + key.charCodeAt(i)) % 997;
  return CAT_PALETTE[hash % CAT_PALETTE.length];
}

// ---------- DB Setup ----------
function openDB(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e)=>{
      const _db = e.target.result;
      if(!_db.objectStoreNames.contains(STORE)){
        const store = _db.createObjectStore(STORE, {keyPath:'id'});
        store.createIndex('name', 'name', {unique:false});
        store.createIndex('kategorie', 'kategorie', {unique:false});
      }
    };
    req.onsuccess = (e)=>{ db = e.target.result; resolve(db); };
    req.onerror = (e)=> reject(e);
  });
}
function dbGetAll(){
  return new Promise((resolve, reject)=>{
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = ()=> resolve(req.result || []);
    req.onerror = (e)=> reject(e);
  });
}
function dbPut(entry){
  return new Promise((resolve, reject)=>{
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(entry);
    tx.oncomplete = ()=> resolve(entry);
    tx.onerror = (e)=> reject(e);
  });
}
function dbDelete(id){
  return new Promise((resolve, reject)=>{
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = ()=> resolve();
    tx.onerror = (e)=> reject(e);
  });
}
function dbClearAll(){
  return new Promise((resolve, reject)=>{
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = ()=> resolve();
    tx.onerror = (e)=> reject(e);
  });
}

// ---------- Helpers ----------
function uid(){ return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,8); }
function esc(s){ return (s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._tm);
  showToast._tm = setTimeout(()=> t.classList.remove('show'), 2200);
}
function openScreen(id){ document.getElementById(id).classList.add('open'); }
function closeScreen(id){ document.getElementById(id).classList.remove('open'); }

// ---------- Dark-Mode Toggle ----------
function applyThemePref(){
  const pref = localStorage.getItem('etikaro-theme'); // 'dark' | 'light' | null(=system)
  document.documentElement.classList.remove('force-dark','force-light');
  if(pref === 'dark') document.documentElement.classList.add('force-dark');
  if(pref === 'light') document.documentElement.classList.add('force-light');
}
document.getElementById('darkToggle').addEventListener('click', ()=>{
  const pref = localStorage.getItem('etikaro-theme');
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const currentlyDark = pref ? pref === 'dark' : systemDark;
  localStorage.setItem('etikaro-theme', currentlyDark ? 'light' : 'dark');
  applyThemePref();
});
applyThemePref();

// ---------- Daten laden & rendern ----------
async function refreshEntries(){
  allEntries = await dbGetAll();
  renderCategoryList();
  renderMain();
}

function categoryStats(){
  const map = new Map();
  allEntries.forEach(e=>{
    const cat = e.kategorie && e.kategorie.trim() ? e.kategorie.trim() : 'Ohne Kategorie';
    if(!map.has(cat)) map.set(cat, {name:cat, items:0, stueck:0});
    const s = map.get(cat);
    s.items += 1;
    s.stueck += (e.anzahl||1);
  });
  return [...map.values()].sort((a,b)=> b.stueck - a.stueck);
}

function renderCategoryList(){
  const wrap = document.getElementById('catList');
  const label = document.getElementById('catLabel');
  const stats = categoryStats();
  if(stats.length === 0){ wrap.innerHTML=''; label.style.display='none'; return; }
  label.style.display='block';
  wrap.innerHTML = stats.map(s=>{
    const color = colorForCategory(s.name);
    const active = activeCategoryFilter === s.name;
    return `
    <div class="cat-row ${active?'active':''}" data-cat="${esc(s.name)}">
      <div class="dot" style="background:${color.bg};">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>
      </div>
      <div class="label">${esc(s.name)}<small>${s.items} ${s.items===1?'Eintrag':'Einträge'}</small></div>
      <div class="val">${s.stueck}×</div>
    </div>`;
  }).join('');
  wrap.querySelectorAll('.cat-row').forEach(row=>{
    row.addEventListener('click', ()=>{
      const cat = row.dataset.cat;
      activeCategoryFilter = (activeCategoryFilter === cat) ? null : cat;
      renderCategoryList();
      renderMain();
    });
  });
}

function filteredEntries(){
  const q = document.getElementById('searchInput').value.trim().toLowerCase();
  return allEntries.filter(e=>{
    const cat = e.kategorie && e.kategorie.trim() ? e.kategorie.trim() : 'Ohne Kategorie';
    if(activeCategoryFilter && cat !== activeCategoryFilter) return false;
    if(q){
      const hay = [e.name, e.kategorie, e.menge, e.notiz, e.ocrText].join(' ').toLowerCase();
      if(!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderMain(){
  const list = filteredEntries();
  const totalLabel = document.getElementById('totalLabel');
  const totalStueck = allEntries.reduce((s,e)=> s+(e.anzahl||1), 0);
  totalLabel.textContent = activeCategoryFilter
    ? `${activeCategoryFilter} — ${list.length} ${list.length===1?'Eintrag':'Einträge'}`
    : `Gesamter Bestand — ${totalStueck} Stück`;

  document.getElementById('empty').style.display = list.length===0 ? 'block' : 'none';
  document.getElementById('listView').style.display = (currentView==='list' && list.length>0) ? 'block' : 'none';
  document.getElementById('tableView').style.display = (currentView==='table' && list.length>0) ? 'block' : 'none';

  if(currentView === 'list') renderListView(list);
  else renderTableView(list);
}

function renderListView(list){
  const grid = document.getElementById('listView');
  const sorted = [...list].sort((a,b)=> (b.aktualisiert||0) - (a.aktualisiert||0));
  grid.innerHTML = sorted.map(e=>`
    <div class="row" data-id="${e.id}">
      ${e.foto ? `<img class="thumb" src="${e.foto}" alt="" style="object-fit:cover;">` : `<div class="thumb">🏺</div>`}
      <div class="meta">
        <div class="name">${esc(e.name)}</div>
        <div class="sub">${esc(e.kategorie || 'Ohne Kategorie')}${e.menge ? ' · ' + esc(e.menge) : ''}</div>
      </div>
      <div class="qty">${e.anzahl||1}×</div>
    </div>
  `).join('');
  grid.querySelectorAll('.row').forEach(row=> row.addEventListener('click', ()=> openEditForId(row.dataset.id)));
}

const TABLE_COLS = [
  {key:'name', label:'Name'},
  {key:'kategorie', label:'Kategorie'},
  {key:'menge', label:'Menge'},
  {key:'anzahl', label:'Anzahl'},
  {key:'notiz', label:'Notiz'},
];

function renderTableView(list){
  const wrap = document.getElementById('tableView');
  const sorted = [...list].sort((a,b)=>{
    let va = a[sortKey], vb = b[sortKey];
    if(sortKey === 'anzahl'){ va = va||1; vb = vb||1; }
    else { va = (va||'').toString().toLowerCase(); vb = (vb||'').toString().toLowerCase(); }
    if(va < vb) return sortDir==='asc' ? -1 : 1;
    if(va > vb) return sortDir==='asc' ? 1 : -1;
    return 0;
  });
  const head = TABLE_COLS.map(c=>{
    const arrow = sortKey===c.key ? (sortDir==='asc' ? '▲' : '▼') : '';
    return `<th data-key="${c.key}">${esc(c.label)} <span class="arrow">${arrow}</span></th>`;
  }).join('');
  const rows = sorted.map(e=>`
    <tr data-id="${e.id}">
      <td class="name-cell">${esc(e.name)}</td>
      <td>${esc(e.kategorie||'—')}</td>
      <td>${esc(e.menge||'—')}</td>
      <td>${e.anzahl||1}×</td>
      <td>${esc((e.notiz||'').slice(0,40))}${(e.notiz||'').length>40?'…':''}</td>
    </tr>`).join('');
  wrap.innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
  wrap.querySelectorAll('thead th').forEach(th=>{
    th.addEventListener('click', ()=>{
      const key = th.dataset.key;
      if(sortKey === key) sortDir = sortDir==='asc' ? 'desc' : 'asc';
      else { sortKey = key; sortDir = 'asc'; }
      renderTableView(filteredEntries());
    });
  });
  wrap.querySelectorAll('tbody tr').forEach(tr=> tr.addEventListener('click', ()=> openEditForId(tr.dataset.id)));
}

document.getElementById('searchInput').addEventListener('input', renderMain);

document.getElementById('viewSwitch').addEventListener('click', (e)=>{
  const btn = e.target.closest('button[data-view]');
  if(!btn) return;
  currentView = btn.dataset.view;
  document.querySelectorAll('#viewSwitch button').forEach(b=>b.classList.toggle('active', b===btn));
  renderMain();
});

// ---------- Navigation ----------
document.querySelectorAll('nav.bottom button').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const target = btn.dataset.nav;
    document.querySelectorAll('nav.bottom button').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    closeScreen('backupScreen'); closeScreen('infoScreen'); closeScreen('exportScreen');
    if(target === 'backup') openScreen('backupScreen');
    else if(target === 'info') openScreen('infoScreen');
    else if(target === 'export'){ prepareExportScreen(); openScreen('exportScreen'); }
  });
});

document.querySelectorAll('[data-close]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    closeScreen(btn.dataset.close);
    if(['scanScreen','editScreen'].includes(btn.dataset.close) === false && btn.dataset.close !== 'backupScreen' && btn.dataset.close !== 'infoScreen' && btn.dataset.close !== 'exportScreen' && btn.dataset.close !== 'pdfPreviewScreen'){
      return;
    }
    document.querySelectorAll('nav.bottom button').forEach(b=>b.classList.remove('active'));
    document.querySelector('[data-nav="register"]').classList.add('active');
  });
});

document.querySelectorAll('[data-open]').forEach(btn=>{
  btn.addEventListener('click', ()=> openScreen(btn.dataset.open));
});

document.getElementById('scanBtn').addEventListener('click', ()=>{
  document.getElementById('scanStatus').innerHTML = '';
  document.getElementById('fileInput').value = '';
  document.getElementById('captureZone').style.display = 'block';
  const oldRetry = document.getElementById('retryWithoutOcrBtn');
  if(oldRetry) oldRetry.remove();
  openScreen('scanScreen');
});

// ---------- Zuschneide-Werkzeug ----------
let cropRect = null; // {x,y,w,h} in Anzeige-Pixeln relativ zu #cropContainer
let cropDrag = null; // {mode:'move'|'nw'|'ne'|'sw'|'se', startX, startY, startRect}

function openCropScreen(dataUrl){
  const img = document.getElementById('cropImage');
  img.onload = ()=>{
    const container = document.getElementById('cropContainer');
    const w = container.clientWidth, h = img.clientHeight;
    // Startrahmen: mittig, 70% Breite/Höhe
    cropRect = { x: w*0.15, y: h*0.15, w: w*0.7, h: h*0.7 };
    renderCropBox();
  };
  img.src = dataUrl;
  openScreen('cropScreen');
}

function renderCropBox(){
  const box = document.getElementById('cropBox');
  box.style.left = cropRect.x + 'px';
  box.style.top = cropRect.y + 'px';
  box.style.width = cropRect.w + 'px';
  box.style.height = cropRect.h + 'px';
}

function clampCropRect(){
  const container = document.getElementById('cropContainer');
  const maxW = container.clientWidth, maxH = document.getElementById('cropImage').clientHeight;
  cropRect.w = Math.max(40, Math.min(cropRect.w, maxW));
  cropRect.h = Math.max(40, Math.min(cropRect.h, maxH));
  cropRect.x = Math.max(0, Math.min(cropRect.x, maxW - cropRect.w));
  cropRect.y = Math.max(0, Math.min(cropRect.y, maxH - cropRect.h));
}

function cropPointerDown(e, mode){
  e.preventDefault();
  const p = e.touches ? e.touches[0] : e;
  cropDrag = { mode, startX:p.clientX, startY:p.clientY, startRect:{...cropRect} };
}
function cropPointerMove(e){
  if(!cropDrag) return;
  e.preventDefault();
  const p = e.touches ? e.touches[0] : e;
  const dx = p.clientX - cropDrag.startX;
  const dy = p.clientY - cropDrag.startY;
  const r = cropDrag.startRect;
  if(cropDrag.mode === 'move'){
    cropRect.x = r.x + dx; cropRect.y = r.y + dy;
  } else {
    if(cropDrag.mode.includes('n')){ cropRect.y = r.y + dy; cropRect.h = r.h - dy; }
    if(cropDrag.mode.includes('s')){ cropRect.h = r.h + dy; }
    if(cropDrag.mode.includes('w')){ cropRect.x = r.x + dx; cropRect.w = r.w - dx; }
    if(cropDrag.mode.includes('e')){ cropRect.w = r.w + dx; }
  }
  clampCropRect();
  renderCropBox();
}
function cropPointerUp(){ cropDrag = null; }

document.getElementById('cropBox').addEventListener('mousedown', (e)=>{
  if(e.target.closest('.crop-handle')) return;
  cropPointerDown(e, 'move');
});
document.getElementById('cropBox').addEventListener('touchstart', (e)=>{
  if(e.target.closest('.crop-handle')) return;
  cropPointerDown(e, 'move');
}, {passive:false});
document.querySelectorAll('.crop-handle').forEach(h=>{
  h.addEventListener('mousedown', (e)=>{ e.stopPropagation(); cropPointerDown(e, h.dataset.handle); });
  h.addEventListener('touchstart', (e)=>{ e.stopPropagation(); cropPointerDown(e, h.dataset.handle); }, {passive:false});
});
window.addEventListener('mousemove', cropPointerMove);
window.addEventListener('touchmove', cropPointerMove, {passive:false});
window.addEventListener('mouseup', cropPointerUp);
window.addEventListener('touchend', cropPointerUp);

function getCroppedDataUrl(){
  const img = document.getElementById('cropImage');
  const scale = img.naturalWidth / img.clientWidth;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(cropRect.w * scale);
  canvas.height = Math.round(cropRect.h * scale);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(
    img,
    cropRect.x * scale, cropRect.y * scale, cropRect.w * scale, cropRect.h * scale,
    0, 0, canvas.width, canvas.height
  );
  return canvas.toDataURL('image/jpeg', 0.92);
}

document.getElementById('confirmCropBtn').addEventListener('click', ()=>{
  const cropped = getCroppedDataUrl();
  closeScreen('cropScreen');
  runOcrAndOpenEdit(cropped);
});
document.getElementById('skipCropBtn').addEventListener('click', ()=>{
  closeScreen('cropScreen');
  runOcrAndOpenEdit(rawCaptureDataUrl);
});

// ---------- Scan / Zuschneiden / OCR flow ----------
let rawCaptureDataUrl = null;

document.getElementById('fileInput').addEventListener('change', async (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const dataUrl = await fileToDataUrl(file);
  rawCaptureDataUrl = dataUrl;
  closeScreen('scanScreen');
  openCropScreen(dataUrl);
});

async function runOcrAndOpenEdit(dataUrl){
  openScreen('scanScreen');
  document.getElementById('captureZone').style.display = 'none';
  const oldRetry = document.getElementById('retryWithoutOcrBtn');
  if(oldRetry) oldRetry.remove();
  const statusEl = document.getElementById('scanStatus');
  pendingPhotoDataUrl = dataUrl;

  const offlineNote = navigator.onLine ? '' : ' (offline)';
  statusEl.innerHTML = `<div class="status-line">Texterkennung läuft${offlineNote} …</div>`;

  let recognizingStarted = false;
  const makeLogger = ()=> (m)=>{
    if(m.status === 'recognizing text'){
      recognizingStarted = true;
      const pct = Math.round((m.progress||0)*100);
      statusEl.innerHTML = `<div class="status-line">Texterkennung läuft${offlineNote} … ${pct}%</div>`;
    } else if(m.status === 'loading language traineddata' || m.status === 'loading tesseract core'){
      statusEl.innerHTML = `<div class="status-line">Sprachdaten werden geladen${offlineNote} …</div>`;
    }
  };

  // Fester Pfad auf die passende Kern-Datei statt Ordner-Auto-Erkennung
  // (zuverlässiger, da wir bewusst nur die 2 benötigten LSTM-Varianten mitliefern).
  const CORE_CANDIDATES = ['./tesseract-core-simd-lstm.wasm.js', './tesseract-core-lstm.wasm.js'];
  // Beide Schreibweisen ausprobieren, da Dokumentation/Praxis dazu widersprüchlich sind.
  const LANG_CANDIDATES = ['.', './'];

  let result = null;
  let lastError = null;
  outer:
  for(const corePath of CORE_CANDIDATES){
    for(const langPath of LANG_CANDIDATES){
      recognizingStarted = false;
      try{
        result = await Tesseract.recognize(dataUrl, 'deu', {
          workerPath: './worker.min.js',
          corePath,
          langPath,
          logger: makeLogger()
        });
        if(result && (result.data.text || '').trim()){
          break outer; // Text gefunden — fertig
        }
        // Kein Fehler, aber leerer Text: nächste Pfad-Variante probieren, bevor wir aufgeben.
      }catch(err){
        lastError = err;
        console.error('OCR-Versuch fehlgeschlagen mit corePath', corePath, 'langPath', langPath, err);
      }
    }
  }

  try{
    if(!result) throw lastError || new Error('OCR fehlgeschlagen');
    const text = (result.data.text || '').trim();
    if('vibrate' in navigator){ try{ navigator.vibrate(35); }catch(err){} }
    if(!text && !recognizingStarted){
      // Die Erkennung hat nie richtig gestartet — vermutlich fehlt/passt eine der 6 Dateien nicht.
      statusEl.innerHTML = '<div class="status-line">Texterkennung konnte nicht starten. Bitte prüfen, ob alle 6 Dateien (tesseract.min.js, worker.min.js, tesseract-core-simd-lstm.wasm.js, tesseract-core-lstm.wasm.js, deu.traineddata.gz, jspdf.umd.min.js) korrekt benannt im selben Ordner liegen.</div>';
      await new Promise(r=>setTimeout(r, 3200));
      closeScreen('scanScreen');
      openEditForNewScan('', dataUrl);
      return;
    }
    statusEl.innerHTML = '<div class="status-line">✓ Erkannt</div>';
    await new Promise(r=>setTimeout(r, 280));
    closeScreen('scanScreen');
    openEditForNewScan(text, dataUrl);
  }catch(err){
    console.error(err);
    const details = (err && (err.message || err.toString())) || 'unbekannter Fehler';
    statusEl.innerHTML = `<div class="status-line">Texterkennung fehlgeschlagen.</div><div class="ocr-box" style="margin-top:8px;">${esc(details)}</div>`;
    const retryBtn = document.createElement('button');
    retryBtn.id = 'retryWithoutOcrBtn';
    retryBtn.className = 'btn btn-secondary';
    retryBtn.textContent = 'Ohne OCR fortfahren';
    retryBtn.onclick = ()=>{ closeScreen('scanScreen'); openEditForNewScan('', dataUrl); };
    document.getElementById('scanBody').appendChild(retryBtn);
  }
}

function fileToDataUrl(file){
  return new Promise((resolve)=>{
    const reader = new FileReader();
    reader.onload = ()=> resolve(reader.result);
    reader.readAsDataURL(file);
  });
}
function guessNameFromOcr(text){
  if(!text) return '';
  const line = text.split('\n').map(l=>l.trim()).find(l=> l.length >= 3);
  return line ? line.slice(0, 60) : '';
}

// ---------- Edit screen ----------
function populateCatDatalist(){
  const dl = document.getElementById('catDatalist');
  const cats = [...new Set(allEntries.map(e=>e.kategorie).filter(Boolean))].sort();
  dl.innerHTML = cats.map(c=>`<option value="${esc(c)}">`).join('');
}

function resetEditForm(){
  document.getElementById('fName').value = '';
  document.getElementById('fCat').value = '';
  document.getElementById('fMenge').value = '';
  document.getElementById('fNotiz').value = '';
  document.getElementById('ocrRaw').value = '';
  document.getElementById('editPhoto').style.display = 'none';
  document.getElementById('dupBanner').style.display = 'none';
  document.getElementById('deleteEntryBtn').style.display = 'none';
  currentQty = 1;
  document.getElementById('qtyNum').textContent = '1';
  currentEditId = null;
  pendingPhotoDataUrl = null;
  populateCatDatalist();
}

function openEditForNewScan(ocrText, dataUrl){
  resetEditForm();
  document.getElementById('editTitle').textContent = 'Eintrag prüfen';
  document.getElementById('ocrRaw').value = ocrText || '';
  document.getElementById('fName').value = guessNameFromOcr(ocrText);
  if(dataUrl){
    pendingPhotoDataUrl = dataUrl;
    const img = document.getElementById('editPhoto');
    img.src = dataUrl; img.style.display = 'block';
  }
  checkDuplicate();
  openScreen('editScreen');
}

function openEditForId(id){
  const entry = allEntries.find(e=>e.id===id);
  if(!entry) return;
  resetEditForm();
  currentEditId = id;
  document.getElementById('editTitle').textContent = 'Eintrag bearbeiten';
  document.getElementById('fName').value = entry.name || '';
  document.getElementById('fCat').value = entry.kategorie || '';
  document.getElementById('fMenge').value = entry.menge || '';
  document.getElementById('fNotiz').value = entry.notiz || '';
  document.getElementById('ocrRaw').value = entry.ocrText || '';
  currentQty = entry.anzahl || 1;
  document.getElementById('qtyNum').textContent = currentQty;
  if(entry.foto){
    pendingPhotoDataUrl = entry.foto;
    const img = document.getElementById('editPhoto');
    img.src = entry.foto; img.style.display = 'block';
  }
  document.getElementById('deleteEntryBtn').style.display = 'block';
  openScreen('editScreen');
}

function checkDuplicate(){
  const name = document.getElementById('fName').value.trim().toLowerCase();
  const banner = document.getElementById('dupBanner');
  if(!name || currentEditId){ banner.style.display='none'; return; }
  const match = allEntries.find(e => e.name.trim().toLowerCase() === name);
  if(match){
    banner.style.display = 'block';
    banner.innerHTML = `„${esc(match.name)}“ existiert bereits (${match.anzahl||1}×). Beim Speichern wird die Anzahl erhöht.`;
    banner.dataset.matchId = match.id;
  } else {
    banner.style.display = 'none';
    delete banner.dataset.matchId;
  }
}
document.getElementById('fName').addEventListener('input', checkDuplicate);

document.getElementById('qtyMinus').addEventListener('click', ()=>{
  currentQty = Math.max(1, currentQty - 1);
  document.getElementById('qtyNum').textContent = currentQty;
});
document.getElementById('qtyPlus').addEventListener('click', ()=>{
  currentQty += 1;
  document.getElementById('qtyNum').textContent = currentQty;
});
document.getElementById('cancelEditBtn').addEventListener('click', ()=> closeScreen('editScreen'));

document.getElementById('saveEntryBtn').addEventListener('click', async ()=>{
  const name = document.getElementById('fName').value.trim();
  if(!name){ showToast('Bitte einen Produktnamen eingeben.'); return; }
  const banner = document.getElementById('dupBanner');
  const dupId = banner.dataset.matchId;

  if(dupId && !currentEditId){
    const existing = allEntries.find(e=>e.id===dupId);
    existing.anzahl = (existing.anzahl||1) + currentQty;
    existing.kategorie = document.getElementById('fCat').value.trim() || existing.kategorie;
    existing.aktualisiert = Date.now();
    if(pendingPhotoDataUrl) existing.foto = pendingPhotoDataUrl;
    await dbPut(existing);
    showToast('Anzahl aktualisiert.');
  } else {
    const entry = {
      id: currentEditId || uid(),
      name,
      kategorie: document.getElementById('fCat').value.trim(),
      menge: document.getElementById('fMenge').value.trim(),
      notiz: document.getElementById('fNotiz').value.trim(),
      ocrText: document.getElementById('ocrRaw').value.trim(),
      foto: pendingPhotoDataUrl || null,
      anzahl: currentQty,
      erstellt: currentEditId ? (allEntries.find(e=>e.id===currentEditId)?.erstellt || Date.now()) : Date.now(),
      aktualisiert: Date.now()
    };
    await dbPut(entry);
    showToast(currentEditId ? 'Eintrag aktualisiert.' : 'Im Bestand gespeichert.');
  }
  closeScreen('editScreen');
  await refreshEntries();
});

document.getElementById('deleteEntryBtn').addEventListener('click', async ()=>{
  if(!currentEditId) return;
  if(!confirm('Diesen Eintrag wirklich löschen?')) return;
  await dbDelete(currentEditId);
  closeScreen('editScreen');
  await refreshEntries();
  showToast('Eintrag gelöscht.');
});

// ---------- PDF-Export ----------
function prepareExportScreen(){
  const stats = categoryStats();
  exportSelection = new Set(stats.map(s=>s.name)); // Standard: alle ausgewählt
  renderExportCatList();
}

function renderExportCatList(){
  const wrap = document.getElementById('exportCatList');
  const stats = categoryStats();
  if(stats.length === 0){
    wrap.innerHTML = '<p style="color:var(--text-soft); font-size:14px;">Noch keine Einträge vorhanden.</p>';
  } else {
    wrap.innerHTML = stats.map(s=>{
      const color = colorForCategory(s.name);
      const on = exportSelection.has(s.name);
      return `
      <div class="exp-row ${on?'':'off'}" data-cat="${esc(s.name)}">
        <div class="check" style="background:${color.bg};">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>
        </div>
        <div class="label">${esc(s.name)}<small>${s.items} ${s.items===1?'Eintrag':'Einträge'}</small></div>
        <div class="val">${s.stueck}×</div>
      </div>`;
    }).join('');
    wrap.querySelectorAll('.exp-row').forEach(row=>{
      row.addEventListener('click', ()=>{
        const cat = row.dataset.cat;
        if(exportSelection.has(cat)) exportSelection.delete(cat); else exportSelection.add(cat);
        renderExportCatList();
        updateExportSummary();
      });
    });
  }
  updateExportSummary();
}

function updateExportSummary(){
  const count = allEntries.filter(e=>{
    const cat = e.kategorie && e.kategorie.trim() ? e.kategorie.trim() : 'Ohne Kategorie';
    return exportSelection.has(cat);
  }).length;
  document.getElementById('exportSummary').textContent = `${count} ${count===1?'Eintrag':'Einträge'}`;
}

document.getElementById('buildPdfBtn').addEventListener('click', async ()=>{
  const items = allEntries.filter(e=>{
    const cat = e.kategorie && e.kategorie.trim() ? e.kategorie.trim() : 'Ohne Kategorie';
    return exportSelection.has(cat);
  }).sort((a,b)=> (a.kategorie||'').localeCompare(b.kategorie||'') || a.name.localeCompare(b.name));

  const hint = document.getElementById('exportHint');
  if(items.length === 0){
    hint.style.display = 'block';
    hint.textContent = 'Keine Einträge in der Auswahl — bitte mindestens eine Kategorie mit Inhalten wählen.';
    return;
  }
  hint.style.display = 'none';

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({unit:'mm', format:'a4'});
  const pageW = doc.internal.pageSize.getWidth();
  const marginX = 16;
  let y = 20;

  doc.setFont('helvetica','bold'); doc.setFontSize(18);
  doc.text('Etikaro — Bestandsliste', marginX, y);
  y += 6;
  doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(120);
  doc.text(new Date().toLocaleDateString('de-DE', {day:'2-digit', month:'2-digit', year:'numeric'}), marginX, y);
  doc.setTextColor(0);
  y += 10;

  let currentCat = null;
  items.forEach((item)=>{
    const cat = item.kategorie && item.kategorie.trim() ? item.kategorie.trim() : 'Ohne Kategorie';
    if(cat !== currentCat){
      currentCat = cat;
      if(y > 265){ doc.addPage(); y = 20; }
      y += 4;
      doc.setFont('helvetica','bold'); doc.setFontSize(13);
      doc.text(cat, marginX, y);
      y += 2;
      doc.setDrawColor(200); doc.line(marginX, y, pageW-marginX, y);
      y += 6;
    }
    if(y > 270){ doc.addPage(); y = 20; }
    doc.setFont('helvetica','bold'); doc.setFontSize(11);
    doc.text(`${item.name}`, marginX, y);
    doc.setFont('helvetica','normal'); doc.setFontSize(11);
    doc.text(`${item.anzahl||1}×`, pageW - marginX, y, {align:'right'});
    y += 5;
    doc.setFontSize(9.5); doc.setTextColor(110);
    const detailParts = [];
    if(item.menge) detailParts.push(item.menge);
    if(item.notiz) detailParts.push(item.notiz);
    if(detailParts.length){
      const detailLines = doc.splitTextToSize(detailParts.join(' · '), pageW - marginX*2);
      doc.text(detailLines, marginX, y);
      y += detailLines.length * 4.2;
    }
    doc.setTextColor(0);
    y += 3;
  });

  const totalStueck = items.reduce((s,e)=> s+(e.anzahl||1), 0);
  if(y > 265){ doc.addPage(); y = 20; }
  y += 4;
  doc.setDrawColor(200); doc.line(marginX, y, pageW-marginX, y);
  y += 8;
  doc.setFont('helvetica','bold'); doc.setFontSize(12);
  doc.text(`Gesamt: ${items.length} Einträge, ${totalStueck} Stück`, marginX, y);

  if(lastPdfBlobUrl) URL.revokeObjectURL(lastPdfBlobUrl);
  lastPdfBlob = doc.output('blob');
  lastPdfBlobUrl = URL.createObjectURL(lastPdfBlob);
  document.getElementById('pdfFrame').src = lastPdfBlobUrl;
  openScreen('pdfPreviewScreen');
});

document.getElementById('savePdfBtn').addEventListener('click', ()=>{
  if(!lastPdfBlob) return;
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0,10);
  a.href = lastPdfBlobUrl;
  a.download = `etikaro-bestand-${stamp}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  showToast('PDF gespeichert.');
});
document.getElementById('discardPdfBtn').addEventListener('click', ()=>{
  closeScreen('pdfPreviewScreen');
});

// ---------- Backup / Restore (JSON) ----------
document.getElementById('exportJsonBtn').addEventListener('click', async ()=>{
  const data = await dbGetAll();
  const payload = { app:'etikaro', exportedAt:new Date().toISOString(), entries:data };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0,10);
  a.href = url; a.download = `etikaro-backup-${stamp}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  showToast('Backup exportiert.');
});

document.getElementById('importInput').addEventListener('change', async (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  try{
    const text = await file.text();
    const payload = JSON.parse(text);
    const entries = Array.isArray(payload) ? payload : payload.entries;
    if(!Array.isArray(entries)) throw new Error('Ungültiges Format');
    for(const entry of entries){
      if(entry && entry.id && entry.name) await dbPut(entry);
    }
    await refreshEntries();
    showToast(`${entries.length} Einträge wiederhergestellt.`);
  }catch(err){
    console.error(err);
    showToast('Backup-Datei konnte nicht gelesen werden.');
  }
  e.target.value = '';
});

document.getElementById('wipeBtn').addEventListener('click', async ()=>{
  if(!confirm('Wirklich ALLE Einträge unwiderruflich löschen?')) return;
  await dbClearAll();
  await refreshEntries();
  showToast('Bestand geleert.');
});

// ---------- Impressum/Datenschutz aus config.js befüllen ----------
function fillLegalInfo(){
  const cfg = (window.ETIKARO_CONFIG) || {};
  const name = (cfg.name || '').trim();
  const strasse = (cfg.strasse || '').trim();
  const ort = (cfg.ort || '').trim();
  const email = (cfg.email || '').trim();

  const isPlaceholder = !name || name === 'Vorname Nachname' || !email || email === 'deine@email.de';

  document.getElementById('impressumAdresse').innerHTML = `${esc(name)}<br>${esc(strasse)}<br>${esc(ort)}`;
  document.getElementById('impressumEmail').textContent = `E-Mail: ${email}`;
  document.getElementById('datenschutzVerantwortlicher').textContent = `${name}, ${strasse}, ${ort}, ${email}`;
  document.getElementById('impressumConfigHint').style.display = isPlaceholder ? 'block' : 'none';
}

// ---------- Online/Offline ----------
function updateOnlineStatus(){
  // (Badge derzeit nicht im Header sichtbar, Status steht für spätere Nutzung bereit.)
}
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

// ---------- Init ----------
(async function init(){
  await openDB();
  await refreshEntries();
  updateOnlineStatus();
  fillLegalInfo();
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('service-worker.js').catch(()=>{});
    // Sobald eine neue Version aktiv wird, Seite automatisch neu laden,
    // damit Updates nicht erst durch mehrfaches manuelles Neuladen ankommen.
    let refreshedOnce = false;
    navigator.serviceWorker.addEventListener('controllerchange', ()=>{
      if(refreshedOnce) return;
      refreshedOnce = true;
      window.location.reload();
    });
  }
})();
