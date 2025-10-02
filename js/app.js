(function(){
  'use strict';

  const CONFIG = {
    REFRESH_SEC: 15,
    POZOS: 6,
    ROWS: 60,
    JSON_CANDIDATES: [
      '../db/data.json'
    ]
  };

  const q = new URLSearchParams(location.search);
  const overrideSrc = q.get('src');
  if (overrideSrc) CONFIG.JSON_CANDIDATES.unshift(overrideSrc);

  document.getElementById('refreshSec').textContent = CONFIG.REFRESH_SEC;

  let paused = getPref('ui:paused', false);
  let autoScroll = getPref('ui:autoScroll', true);
  let isFetching = false;
  let latestMap = {};

  const DEFAULT_DISPLAY = {
    pozoFont: 20,
    cellFont: 18,
    stockFont: 14,
    nightDim: { enabled: false, startHour: 1, endHour: 6, dimLevel: 0.65 },
    pixelShift: { enabled: false, intervalMin: 2, maxOffsetPx: 2 },
    view: { visibleWells: [1,2,3,4,5,6] }
  };
  let DISPLAY = getPref('display:cfg', DEFAULT_DISPLAY);
  if (!DISPLAY.view || !Array.isArray(DISPLAY.view.visibleWells) || DISPLAY.view.visibleWells.length===0) {
    DISPLAY.view = { visibleWells: [1,2,3,4,5,6] };
    setPref('display:cfg', DISPLAY);
  }

  const DEFAULT_RULES = {
    'GAS OIL': { display:'GAS OIL', unit:'M3', low:50, mid:150 },
    'ARENA #100': { display:'ARENA #100', unit:'Tn', low:100, mid:300 },
    'ARENA #30/70': { display:'ARENA #30/70', unit:'Tn', low:300, mid:800 },
    'GEL BOLSONES': { display:'GEL BOLSONES', unit:'ud', low:10, mid:25 },
    'GEL TOTE': { display:'GEL TOTE', unit:'ud', low:5, mid:15 }
  };
  let STOCK_RULES = getPref('stock:rules', DEFAULT_RULES);

  const wellsEl = document.getElementById('wells');
  const stockBar = document.getElementById('stockBar');
  const btnRefresh = document.getElementById('btnRefresh');
  const btnPause = document.getElementById('btnPause');
  const btnFull = document.getElementById('btnFull');
  const btnSettings = document.getElementById('btnSettings');
  const autoScrollEl = document.getElementById('autoScroll');
  const lastUpdateEl = document.getElementById('lastUpdate');
  const net = document.getElementById('netStatus');

  const kpiTotal = document.getElementById('kpiTotal');
  const kpiDone = document.getElementById('kpiDone');
  const kpiRemain = document.getElementById('kpiRemain');
  const kpiAvg = document.getElementById('kpiAvg');
  const kpiETA = document.getElementById('kpiETA');

  const modal = document.getElementById('settingsModal');
  const setPozoFont = document.getElementById('setPozoFont');
  const setCellFont = document.getElementById('setCellFont');
  const setStockFont = document.getElementById('setStockFont');
  const setNightEnabled = document.getElementById('setNightEnabled');
  const setNightStart = document.getElementById('setNightStart');
  const setNightEnd = document.getElementById('setNightEnd');
  const setNightDim = document.getElementById('setNightDim');
  const setShiftEnabled = document.getElementById('setShiftEnabled');
  const setShiftEvery = document.getElementById('setShiftEvery');
  const setShiftPixels = document.getElementById('setShiftPixels');
  const btnClose = document.getElementById('btnCloseSettings');
  const btnSave = document.getElementById('btnSaveSettings');
  const btnReset = document.getElementById('btnReset');
  const rulesBody = document.getElementById('rulesBody');
  const btnLoadDetected = document.getElementById('btnLoadDetected');
  const btnAddRule = document.getElementById('btnAddRule');
  const wellChooser = document.getElementById('wellChooser');

  autoScrollEl.checked = !!autoScroll;
  btnPause.innerText = paused ? 'Reanudar' : 'Pausar';
  applyCSSVars();
  buildWellsSkeleton();
  applyWellVisibility();
  restartShift();
  restartNight();

  btnRefresh.onclick = () => forceRefresh();
  btnPause.onclick = () => { paused = !paused; setPref('ui:paused', paused); btnPause.innerText = paused ? 'Reanudar':'Pausar'; };
  autoScrollEl.onchange = () => { setPref('ui:autoScroll', autoScrollEl.checked); autoScroll = autoScrollEl.checked; };
  btnFull.onclick = () => {
    const el = document.documentElement;
    const fs = document.fullscreenElement;
    if (fs) (document.exitFullscreen||document.webkitExitFullscreen||document.msExitFullscreen||document.mozCancelFullScreen).call(document);
    else (el.requestFullscreen||el.webkitRequestFullscreen||el.msRequestFullscreen||el.mozRequestFullScreen).call(el);
  };
  btnSettings.onclick = openSettings;
  btnClose.onclick = () => modal.classList.remove('show');
  btnReset.onclick = () => { localStorage.removeItem('display:cfg'); localStorage.removeItem('stock:rules'); location.reload(); };
  btnSave.onclick = () => { saveSettings(); modal.classList.remove('show'); renderStock(lastStock); applyCSSVars(); applyWellVisibility(); };
  btnLoadDetected.onclick = () => mergeDetectedItems();
  btnAddRule.onclick = () => addRuleRow({ display:'', unit:'', low:'', mid:'' });
  window.addEventListener('keydown', (e)=>{ if(e.key==='Escape') modal.classList.remove('show'); });

  forceRefresh();
  setInterval(()=> loadAndRender(false), CONFIG.REFRESH_SEC*1000);

  function buildWellsSkeleton(){
    wellsEl.innerHTML = '';
    for (let p=1; p<=CONFIG.POZOS; p++){
      const card = document.createElement('section');
      card.className = 'well';
      card.dataset.pozo = String(p);
      card.innerHTML = `
        <header>
          <div class="title">POZO #${p} <span class="badge" data-badge="${p}" hidden>0</span></div>
        </header>
        <div class="body">
          <div class="tablewrap" data-tablewrap="${p}">
            <table>
              <thead>
                <tr><th>#</th><th>F/h TPN</th><th>TPN</th><th>FRACTURADO</th></tr>
              </thead>
              <tbody id="tbody-p${p}"></tbody>
            </table>
          </div>
        </div>`;
      wellsEl.appendChild(card);

      const tb = card.querySelector(`#tbody-p${p}`);
      const frag = document.createDocumentFragment();
      for (let r=1; r<=CONFIG.ROWS; r++){
        const id = '#'+String(r).padStart(2,'0');
        const tr = document.createElement('tr');
        tr.dataset.rowId = id;
        if (r%2===0) tr.classList.add('alt');
        tr.innerHTML = `<td class="rowid">${id}</td><td class="fh" data-fh="${p}"></td><td data-tpn="${p}"></td><td data-frac="${p}"></td>`;
        frag.appendChild(tr);
      }
      tb.appendChild(frag);
    }
  }

  async function tryFetch(url){
    const t0 = performance.now();
    const res = await fetch(url, { cache:'no-store' });
    if (!res.ok) throw new Error('HTTP '+res.status);
    const json = await res.json();
    const t1 = performance.now();
    setNet('OK', true, Math.round(t1-t0)+'ms');
    return json;
  }
  async function fetchJSON(){
    for (const u of CONFIG.JSON_CANDIDATES){
      try{ return await tryFetch(u); } catch(_){}
    }
    throw new Error('Sin fuente JSON disponible');
  }

  async function forceRefresh(){
    if (isFetching) return;
    btnRefresh.disabled = true;
    const t = btnRefresh.textContent;
    btnRefresh.textContent = 'Actualizando…';
    await loadAndRender(true);
    btnRefresh.textContent = t;
    btnRefresh.disabled = false;
  }

  async function loadAndRender(isForced){
    if (isForced!==true) isForced = false;
    if (paused && !isForced) return;
    if (isFetching) return;
    isFetching = true;
    try{
      const json = await fetchJSON();
      lastUpdateEl.textContent = new Date(json.lastUpdate || Date.now()).toLocaleString();
      renderStock(json.stock || []);

      const conv = transformItems(json.items || []);
      updateWellTitlesFromHeaders(conv);
      const map = itemsArrayToMap(conv);
      updateDOM(map);
      paintBadgesPerPozo(remainingPerPozo(conv));
      computeKPIs(conv);

      if (autoScroll) requestAnimationFrame(()=> scrollToLastWithData());
    }catch(e){
      console.error(e);
      setNet('ERROR', false, e && e.message || '');
      lastUpdateEl.innerHTML = '<span style="color:salmon">Error de conexión</span>';
    }finally{
      isFetching = false;
    }
  }

  function transformItems(items){
    if (!Array.isArray(items)) return [];
    return items.map(raw => {
      const o = {};
      o.fila = String(raw.Fila==null?'':raw.Fila);
      for (let i=1; i<=CONFIG.POZOS; i++){
        o['Seq'+i] = String(raw['SecuenciaPozo'+i] == null ? '' : raw['SecuenciaPozo'+i]);
        o['Pozo'+i] = String(raw['TPNPozo'+i] == null ? '' : raw['TPNPozo'+i]);
        o['Estado'+i] = String(raw['FechaFracPozo'+i] == null ? '' : raw['FechaFracPozo'+i]);
      }
      return o;
    });
  }
  function itemsArrayToMap(arr){
    const m = {};
    for (const it of arr){
      const k = (it.fila||'').trim();
      if (!k) continue;
      m[k] = it;
    }
    return m;
  }

  function pad2(n){ return String(n).padStart(2,'0'); }
  function excelToDate(n){
    const base = Date.UTC(1899,11,30);
    const ms = Math.round(Number(n) * 86400000);
    return new Date(base + ms);
  }
  function parseDateOnly(val){
    if (!val) return '';
    const s = String(val).trim();
    if (/^\d{5}(\.\d+)?$/.test(s)) {
      const d = excelToDate(Number(s));
      return `${pad2(d.getDate())}/${pad2(d.getMonth()+1)}/${d.getFullYear()}`;
    }
    const d2 = new Date(s);
    if (!isNaN(+d2)) return `${pad2(d2.getDate())}/${pad2(d2.getMonth()+1)}/${d2.getFullYear()}`;
    return s;
  }
  function parseDateTime(val){
    if (!val) return { html:'', has:false };
    const s = String(val).trim();
    if (/^\d{5}(\.\d+)?$/.test(s)) {
      const d = excelToDate(Number(s));
      const date = `${pad2(d.getDate())}/${pad2(d.getMonth()+1)}/${d.getFullYear()}`;
      const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
      return { html:`<span class="d">${date}</span><span class="t">${time}</span>`, has:true };
    }
    const d2 = new Date(s);
    if (!isNaN(+d2)){
      const date = `${pad2(d2.getDate())}/${pad2(d2.getMonth()+1)}/${d2.getFullYear()}`;
      const time = `${pad2(d2.getHours())}:${pad2(d2.getMinutes())}`;
      return { html:`<span class="d">${date}</span><span class="t">${time}</span>`, has:true };
    }
    return { html:'', has:false };
  }
  function isFechaValida(v){
    const s = String(v||'').trim();
    if (!s) return false;
    if (/^\d{5}(\.\d+)?$/.test(s)) return true;
    const d = new Date(s);
    return !isNaN(+d);
  }
  function isStop(v){ return String(v||'').trim().toUpperCase()==='STOP'; }
  function isAbortOrCancel(v){
    const s = String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
    return s.includes('ABORTADA') || s.includes('CANCELADA');
  }

  function updateWellTitlesFromHeaders(conv){
    const top = conv.find(it => (it.fila||'').trim()==='') || null;
    if (!top) return;
    for (let p=1; p<=CONFIG.POZOS; p++){
      const title = (top['Pozo'+p] || '').trim() || `POZO #${p}`;
      const el = wellsEl.querySelector(`.well[data-pozo="${p}"] .title`);
      if (el) el.childNodes[0].nodeValue = title + ' ';
    }
  }

  function updateDOM(map){
    for (let r=1; r<=CONFIG.ROWS; r++){
      const id = '#'+String(r).padStart(2,'0');
      const rowObj = map[id] || {};
      for (let p=1; p<=CONFIG.POZOS; p++){
        const body = document.querySelector(`#tbody-p${p} tr[data-row-id="${id}"]`);
        if (!body) continue;
        const tdFH = body.querySelector(`td[data-fh="${p}"]`);
        const tdTPN = body.querySelector(`td[data-tpn="${p}"]`);
        const tdFrac = body.querySelector(`td[data-frac="${p}"]`);

        const fh = parseDateTime(rowObj['Seq'+p]);
        tdFH.innerHTML = fh.html;
        tdTPN.textContent = (rowObj['Pozo'+p] || '').toString();
        const fracRaw = rowObj['Estado'+p];
        tdFrac.textContent = parseDateOnly(fracRaw);
        tdFrac.classList.toggle('stop', isStop(fracRaw));
      }
    }
    latestMap = map;
  }

  function hasDataForPozo(map, id, p){
    const it = map[id];
    if (!it) return false;
    const v1 = (it['Pozo'+p] || '').toString().trim();
    const v2 = it['Estado'+p];
    const vS = it['Seq'+p];
    return v1 || isFechaValida(v2) || isFechaValida(vS);
  }

  function scrollToLastWithData(){
    const visible = new Set(DISPLAY.view.visibleWells || [1,2,3,4,5,6]);
    for (const p of visible){
      const wrap = document.querySelector(`.tablewrap[data-tablewrap="${p}"]`);
      if (!wrap) continue;
      let lastIdx = 0;
      for (let r=1; r<=CONFIG.ROWS; r++){
        const id = '#'+String(r).padStart(2,'0');
        if (hasDataForPozo(latestMap, id, p)) lastIdx = r;
      }
      if (lastIdx>0){
        const tr = document.querySelector(`#tbody-p${p} tr[data-row-id="#${String(lastIdx).padStart(2,'0')}"]`);
        if (tr) wrap.scrollTo({ top: tr.offsetTop - 40, behavior:'smooth' });
      }
    }
  }

  function remainingPerPozo(conv){
    const rows = conv
      .filter(it => it.fila && it.fila.trim())
      .map(it => {
        const m = it.fila.trim().match(/^#?(\d+)/);
        return Object.assign({}, it, { _row: m ? parseInt(m[1],10) : NaN });
      })
      .filter(it => Number.isFinite(it._row))
      .sort((a,b)=> a._row - b._row);

    const res = new Array(CONFIG.POZOS).fill(0);

    for (let p=1; p<=CONFIG.POZOS; p++){
      let stop = null;
      for (let i=0; i<rows.length; i++){
        const v = (rows[i]['Estado'+p] || '').toString().trim().toUpperCase();
        if (v === 'STOP'){ stop = rows[i]._row; break; }
      }
      if (!stop) continue;

      let slots=0, hechas=0;
      for (let j=0; j<rows.length; j++){
        const r = rows[j];
        if (r._row >= stop) break;
        slots++;
        const cell = r['Estado'+p];
        if (isFechaValida(cell) || isAbortOrCancel(cell)) hechas++;
      }
      res[p-1] = Math.max(0, slots - hechas);
    }
    return res;
  }
  function paintBadgesPerPozo(arr){
    for (let p=1; p<=CONFIG.POZOS; p++){
      const b = document.querySelector(`[data-badge="${p}"]`);
      if (!b) continue;
      const val = arr[p-1] || 0;
      if (val>0){ b.textContent = val; b.hidden = false; } else { b.hidden = true; }
    }
  }

  function computeKPIs(conv){
    const rows = conv.filter(it => it.fila && it.fila.trim());
    let total = 0, hechas = 0;
    for (let p=1; p<=CONFIG.POZOS; p++){
      let stop = null;
      for (const r of rows){
        const v = (r['Estado'+p]||'').toString().trim().toUpperCase();
        const m = (r.fila||'').trim().match(/^#?(\d+)/);
        if (v==='STOP'){ stop = m?parseInt(m[1],10):null; break; }
      }
      if (!stop) continue;
      for (const r of rows){
        const m = (r.fila||'').trim().match(/^#?(\d+)/);
        const idx = m?parseInt(m[1],10):NaN;
        if (!Number.isFinite(idx) || idx>=stop) continue;
        total++;
        const cell = r['Estado'+p];
        if (isFechaValida(cell) || isAbortOrCancel(cell)) hechas++;
      }
    }
    const restantes = Math.max(0, total - hechas);
    kpiTotal.textContent = total;
    kpiDone.textContent = hechas;
    kpiRemain.textContent = restantes;

    const freq = new Map();
    for (const r of rows){
      for (let p=1; p<=CONFIG.POZOS; p++){
        const v = r['Estado'+p];
        if (!isFechaValida(v)) continue;
        const d = parseDateOnly(v);
        const [dd,mm,yy] = d.split('/').map(Number);
        const norm = `${yy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
        freq.set(norm, (freq.get(norm)||0)+1);
      }
    }
    const today = new Date(); today.setHours(0,0,0,0);
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate()-1);
    let cur = new Date(yesterday);
    const daily = [];
    for (let i=0; i<7; i++){
      const norm = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}-${String(cur.getDate()).padStart(2,'0')}`;
      daily.unshift(freq.get(norm)||0);
      cur.setDate(cur.getDate()-1);
    }
    const sum = daily.reduce((a,b)=>a+b,0);
    const avg = sum/7;
    kpiAvg.textContent = avg>0 ? (Math.round(avg*10)/10).toString().replace('.',',')+' etapas/día' : '—';

    let etaText = '—';
    if (avg>0 && restantes>0){
      const daysNeeded = Math.ceil(restantes/avg);
      const eta = new Date(today); eta.setDate(eta.getDate()+daysNeeded);
      etaText = `${pad2(eta.getDate())}/${pad2(eta.getMonth()+1)}/${eta.getFullYear()} (≈ ${daysNeeded} día${daysNeeded===1?'':'s'})';
    }
    kpiETA.textContent = etaText;
  }

  let lastStock = [];
  function canonicalizeName(s){
    let x = (s==null?'':String(s)).toUpperCase();
    x = x.normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    x = x.replace(/\s+/g,' ').trim();
    x = x.replace(/^GASOIL$/,'GAS OIL');
    return x;
  }
  function numFromString(s){
    if (!s) return NaN;
    const m = String(s).replace(',', '.').match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : NaN;
  }
  function renderStock(arr){
    lastStock = Array.isArray(arr)?arr:[];
    stockBar.innerHTML = '';
    for (const it of lastStock){
      const name = String(it.ITEM||'').trim();
      const canon = canonicalizeName(name);
      const valStr = String(it.STOCK==null?'':it.STOCK);
      const val = numFromString(valStr);
      const rule = STOCK_RULES[canon];
      let cls = 'stock-mid';
      if (rule && Number.isFinite(val)){
        if (val < rule.low) cls = 'stock-low';
        else if (val > rule.mid) cls = 'stock-high';
        else cls = 'stock-mid';
      }
      const pill = document.createElement('div');
      pill.className = `pill ${cls}`;
      const dot = document.createElement('span'); dot.className = 'dot';
      const txt = document.createElement('span'); txt.textContent = `${name}: ${valStr}`;
      pill.appendChild(dot); pill.appendChild(txt);
      stockBar.appendChild(pill);
    }
  }
  function mergeDetectedItems(){
    const detected = new Map(Object.entries(STOCK_RULES));
    for (const it of lastStock){
      const canon = canonicalizeName(it.ITEM);
      if (!detected.has(canon)){
        detected.set(canon, { display:String(it.ITEM||''), unit:'', low:0, mid:0 });
      }
    }
    STOCK_RULES = Object.fromEntries(detected.entries());
    drawRulesTable();
  }

  function openSettings(){
    setPozoFont.value = DISPLAY.pozoFont;
    setCellFont.value = DISPLAY.cellFont;
    setStockFont.value = DISPLAY.stockFont;

    setNightEnabled.checked = !!DISPLAY.nightDim.enabled;
    setNightStart.value = DISPLAY.nightDim.startHour;
    setNightEnd.value = DISPLAY.nightDim.endHour;
    setNightDim.value = Math.round((DISPLAY.nightDim.dimLevel||0.65)*100);

    setShiftEnabled.checked = !!DISPLAY.pixelShift.enabled;
    setShiftEvery.value = DISPLAY.pixelShift.intervalMin;
    setShiftPixels.value = DISPLAY.pixelShift.maxOffsetPx;

    drawRulesTable();
    buildWellChooser();

    modal.classList.add('show');
  }
  function saveSettings(){
    DISPLAY.pozoFont = clamp(+setPozoFont.value||20,12,36);
    DISPLAY.cellFont = clamp(+setCellFont.value||18,12,28);
    DISPLAY.stockFont = clamp(+setStockFont.value||14,10,24);

    DISPLAY.nightDim.enabled = !!setNightEnabled.checked;
    DISPLAY.nightDim.startHour = clamp(+setNightStart.value||1,0,23);
    DISPLAY.nightDim.endHour = clamp(+setNightEnd.value||6,0,23);
    DISPLAY.nightDim.dimLevel = clamp((+setNightDim.value||65)/100,0.2,1);

    DISPLAY.pixelShift.enabled = !!setShiftEnabled.checked;
    DISPLAY.pixelShift.intervalMin = clamp(+setShiftEvery.value||2,1,60);
    DISPLAY.pixelShift.maxOffsetPx = clamp(+setShiftPixels.value||2,0,10);

    const rows = [].slice.call(rulesBody.querySelectorAll('.rule-row'));
    const next = {};
    for (const r of rows){
      const name = r.querySelector('[data-f=name]').value;
      if (!name) continue;
      const canon = canonicalizeName(name);
      next[canon] = {
        display: name.trim(),
        unit: (r.querySelector('[data-f=unit]').value||'').trim(),
        low: +(r.querySelector('[data-f=low]').value||0),
        mid: +(r.querySelector('[data-f=mid]').value||0),
      };
    }
    STOCK_RULES = next;

    setPref('display:cfg', DISPLAY);
    setPref('stock:rules', STOCK_RULES);

    restartShift();
    restartNight();
  }

  function buildWellChooser(){
    wellChooser.innerHTML='';
    const current = (DISPLAY.view && Array.isArray(DISPLAY.view.visibleWells)) ? DISPLAY.view.visibleWells.slice() : [1,2,3,4,5,6];
    for (let p=1; p<=CONFIG.POZOS; p++){
      const lab = document.createElement('label');
      lab.style.display='inline-flex';
      lab.style.alignItems='center';
      lab.style.gap='6px';
      const chk = document.createElement('input'); chk.type='checkbox'; chk.value=String(p);
      chk.checked = current.indexOf(p)>=0;
      chk.onchange = () => {
        const set = new Set(DISPLAY.view && DISPLAY.view.visibleWells || []);
        if (chk.checked) set.add(p); else set.delete(p);
        let arr = Array.from(set).sort((a,b)=>a-b);
        if (arr.length===0){ arr=[1]; chk.checked=true; }
        DISPLAY.view = { visibleWells: arr };
      };
      lab.appendChild(chk);
      lab.appendChild(document.createTextNode(' Pozo '+p));
      wellChooser.appendChild(lab);
    }
  }
  function applyWellVisibility(){
    const visible = new Set(DISPLAY.view && Array.isArray(DISPLAY.view.visibleWells) ? DISPLAY.view.visibleWells : [1,2,3,4,5,6]);
    for (let p=1; p<=CONFIG.POZOS; p++){
      const card = document.querySelector(`.well[data-pozo="${p}"]`);
      if (card) card.classList.toggle('hide', !visible.has(p));
    }
  }

  function drawRulesTable(){
    rulesBody.innerHTML='';
    const entries = Object.entries(STOCK_RULES);
    for (const [,rule] of entries){
      addRuleRow(rule);
    }
  }
  function addRuleRow(rule){
    rule = rule || {};
    const row = document.createElement('div');
    row.className = 'rule-row';
    row.innerHTML = `
      <input data-f="name" placeholder="Nombre visible" value="${ (rule.display||'').replace(/"/g,'&quot;') }">
      <input data-f="unit" placeholder="ud/Tn/M3" value="${ (rule.unit||'').replace(/"/g,'&quot;') }">
      <input data-f="low" type="number" step="any" value="${ rule.low!=null?rule.low:'' }">
      <input data-f="mid" type="number" step="any" value="${ rule.mid!=null?rule.mid:'' }">
      <button type="button" class="btn secondary">Quitar</button>`;
    row.querySelector('button').onclick = ()=> row.remove();
    rulesBody.appendChild(row);
  }

  function setNet(status, ok, extra){
    net.innerHTML = `<span class="dot"></span> ${status}${extra?(' '+extra):''}`;
    net.style.background = ok ? 'rgba(0,180,60,.2)' : 'rgba(220,60,60,.25)';
    net.style.border = '1px solid '+(ok?'rgba(0,180,60,.35)':'rgba(220,60,60,.4)');
    net.classList.add('pill');
  }
  function clamp(v,a,b){ return Math.min(b, Math.max(a, v)); }
  function getPref(k,d){ try{ const v = localStorage.getItem(k); return v!==null?JSON.parse(v):d; }catch(_){ return d; } }
  function setPref(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(_){ } }

  function applyCSSVars(){
    document.documentElement.style.setProperty('--pozo-title', DISPLAY.pozoFont+'px');
    document.documentElement.style.setProperty('--cell', DISPLAY.cellFont+'px');
    document.documentElement.style.setProperty('--stock', DISPLAY.stockFont+'px');
  }

  function restartNight(){
    applyNightDim();
    if (window.__nightTimer) clearInterval(window.__nightTimer);
    window.__nightTimer = setInterval(applyNightDim, 5*60*1000);
  }
  function inRangeHour(h,a,b){ return (a<=b)?(h>=a&&h<b):(h>=a||h<b); }
  function applyNightDim(){
    const veil = document.getElementById('dimVeil');
    if (!DISPLAY.nightDim.enabled){ veil.style.setProperty('--night-alpha', 0); return; }
    const h = new Date().getHours();
    const on = inRangeHour(h, DISPLAY.nightDim.startHour, DISPLAY.nightDim.endHour);
    const alpha = on ? (1 - clamp(DISPLAY.nightDim.dimLevel, 0.2, 1)) : 0;
    veil.style.setProperty('--night-alpha', alpha.toString());
  }

  function restartShift(){
    if (window.__shiftTimer) clearInterval(window.__shiftTimer);
    document.documentElement.style.setProperty('--nudge-x', '0px');
    document.documentElement.style.setProperty('--nudge-y', '0px');
    if (!DISPLAY.pixelShift.enabled) return;
    const ms = Math.max(1, DISPLAY.pixelShift.intervalMin)*60*1000;
    window.__shiftTimer = setInterval(()=>{
      const m = Math.max(0, DISPLAY.pixelShift.maxOffsetPx|0);
      const x = (Math.floor(Math.random()*(m*2+1))-m);
      const y = (Math.floor(Math.random()*(m*2+1))-m);
      document.documentElement.style.setProperty('--nudge-x', x+'px');
      document.documentElement.style.setProperty('--nudge-y', y+'px');
    }, ms);
  }

})();
