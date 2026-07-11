import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query, orderBy, serverTimestamp, writeBatch, getDocs }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ===================== FIREBASE CONFIG (sama dengan app piutang) =====================
const firebaseConfig = {
  apiKey: "AIzaSyCx2bGvF9Szh7-q4PPiZxvGwPPxjc4Kt30",
  authDomain: "warna-indah.firebaseapp.com",
  projectId: "warna-indah",
  storageBucket: "warna-indah.firebasestorage.app",
  messagingSenderId: "888220688334",
  appId: "1:888220688334:web:89fcbcf1d375448c8a159f"
};
const COLL = 'stok_items'; // koleksi khusus app ini — terpisah dari 'transaksi'
const AUDIT_COLL = 'stok_audit_logs';
const ARCHIVE_COLL = 'stok_opname_archives';
const SALES_COLL = 'stok_penjualan';
const SALES_IMPORT_COLL = 'stok_penjualan_imports';

// ===================== HELPERS =====================
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const pad2 = n => String(n).padStart(2,'0');
const num = v => { const n = Math.round((parseFloat(v)||0)*100)/100; return n.toLocaleString('id-ID',{maximumFractionDigits:2}); };
const rpNum = v => Math.round(parseFloat(v)||0).toLocaleString('id-ID');
const rp = v => 'Rp ' + rpNum(v);
// Pemisah ribuan untuk input harga: simpan angka polos, tampilkan dengan titik ribuan (format Indonesia)
const onlyDigits = s => String(s ?? '').replace(/[^\d]/g,'');
const grpRibu = d => { const x = onlyDigits(d); return x ? parseInt(x,10).toLocaleString('id-ID') : ''; };
window.grpRibuG = grpRibu; window.onlyDigitsG = onlyDigits;
const parseId = v => { let s = String(v ?? '').trim(); if(!s) return 0;
  if(s.includes(',')) s = s.replace(/\./g,'').replace(',','.');
  return parseFloat(s.replace(/[^0-9.\-]/g,'')) || 0; };
const isoToDisp = iso => { if(!iso) return ''; const p = String(iso).split('-'); return p.length===3 ? p[2]+'/'+p[1]+'/'+p[0] : iso; };
const dispToIso = d => { const p = String(d||'').trim().split('/'); return p.length===3 ? p[2]+'-'+pad2(parseInt(p[1])||1)+'-'+pad2(parseInt(p[0])||1) : ''; };
function showMsg(id, txt, ms=3500){ const el=$(id); el.textContent=txt; el.style.display='block'; if(ms) setTimeout(()=>el.style.display='none', ms); }
const todayIso = () => new Date().toISOString().slice(0,10);
const userEmail = () => auth && auth.currentUser ? auth.currentUser.email : '';

function validIsoDate(iso){
  const m = String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m) return false;
  const y = parseInt(m[1],10), mo = parseInt(m[2],10), d = parseInt(m[3],10);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function parseImportDate(raw){
  let s = String(raw ?? '').trim();
  if(!s) return { iso: todayIso(), ok: true, empty: true };
  s = s.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');
  if(/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)){
    const [y,m,d] = s.split('-').map(Number);
    const iso = `${y}-${pad2(m)}-${pad2(d)}`;
    return { iso, ok: validIsoDate(iso), empty: false };
  }
  const bulan = {
    jan:1, januari:1, january:1,
    feb:2, februari:2, february:2,
    mar:3, maret:3, march:3,
    apr:4, april:4,
    mei:5, may:5,
    jun:6, juni:6, june:6,
    jul:7, juli:7, july:7,
    agu:8, ags:8, agust:8, agustus:8, aug:8, august:8,
    sep:9, sept:9, september:9,
    okt:10, oktober:10, oct:10, october:10,
    nov:11, november:11,
    des:12, desember:12, dec:12, december:12
  };
  const mText = s.toLowerCase().match(/^(\d{1,2})[\s\-/.,]+([a-z]+)[\s\-/.,]+(\d{2,4})$/i);
  if(mText && bulan[mText[2]]){
    let y = parseInt(mText[3],10);
    if(y < 100) y += 2000;
    const iso = `${y}-${pad2(bulan[mText[2]])}-${pad2(parseInt(mText[1],10))}`;
    return { iso, ok: validIsoDate(iso), empty: false };
  }
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if(m){
    let y = parseInt(m[3],10);
    if(y < 100) y += 2000;
    const iso = `${y}-${pad2(parseInt(m[2],10))}-${pad2(parseInt(m[1],10))}`;
    return { iso, ok: validIsoDate(iso), empty: false };
  }
  if(/^\d+(\.\d+)?$/.test(s)){
    const serial = parseFloat(s);
    if(serial > 20000 && serial < 80000){
      const d = new Date(Date.UTC(1899,11,30) + serial * 86400000);
      return { iso: d.toISOString().slice(0,10), ok: true, empty: false };
    }
  }
  return { iso: '', ok: false, empty: false, raw: s };
}

async function auditLog(action, detail={}){
  try {
    await addDoc(collection(db, AUDIT_COLL), {
      action, detail, user: userEmail(), createdAt: serverTimestamp()
    });
  } catch(e) {
    console.warn('Audit log gagal:', e);
  }
}

async function readCollectionSafe(name){
  try {
    const snap = await getDocs(collection(db, name));
    return snap.docs.map(d=>({ id:d.id, ...d.data() }));
  } catch(e) {
    console.warn('Backup gagal membaca', name, e);
    return { error: e.message };
  }
}

window.exportBackup = async function(){
  $('backupOk').style.display='none';
  $('backupErr').style.display='none';
  try {
    const data = {
      exportedAt: new Date().toISOString(),
      projectId: firebaseConfig.projectId,
      collections: {
        [COLL]: await readCollectionSafe(COLL),
        [SALES_COLL]: await readCollectionSafe(SALES_COLL),
        [SALES_IMPORT_COLL]: await readCollectionSafe(SALES_IMPORT_COLL),
        [AUDIT_COLL]: await readCollectionSafe(AUDIT_COLL),
        [ARCHIVE_COLL]: await readCollectionSafe(ARCHIVE_COLL)
      }
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `backup-stok-${todayIso()}.json`;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(a.href);
    document.body.removeChild(a);
    showMsg('backupOk','✔ Backup JSON berhasil dibuat.', 6000);
    await auditLog('backup_export', { collections:Object.keys(data.collections) });
  } catch(e){
    showMsg('backupErr','Gagal membuat backup: '+e.message, 8000);
  }
};

function drumStr(kg, isiDrum){
  if(!isiDrum || isiDrum <= 0 || kg === 0) return '';
  const neg = kg < 0; const a = Math.abs(kg);
  const d = Math.floor(a / isiDrum);
  const sisa = Math.round((a - d*isiDrum)*100)/100;
  let s = '';
  if(d > 0) s += d + ' drum';
  if(sisa > 0) s += (d>0?' + ':'') + num(sisa);
  if(!s) s = '0';
  return (neg?'−(':'') + s + (neg?')':'');
}

// ===================== STATE =====================
let auth=null, db=null, unsub=null, unsubSales=null, unsubSaleImports=null;
let items = [];
let sales = [];
let saleImports = [];
let curTab = 'dash';
let fltMinusOn = false, fisBelumOn = false, fltTerjualOn = false, fltBelumTerjualOn = false;
let editDocId = null, histDocId = null, histMutEdit = null, saleEditId = null, saleCreateMutation = null;
let importRows = [];
let jualRows = [];
let mixRows = [];
let lastSaleImport = null;
let importJenis = 'keluar';         // pilihan manual masuk/keluar
let fisikDraft = {};
let stokEditMode = false;
let stokDraft = {};                 // {docId: {nama,kat,sat,isiDrum,stokAwal,harga}}
let mutDraft = {};                  // {itemId#idx: {jenis,tanggal,qty,pihak,noNota,barang}}
let mutPage = 1;                    // halaman aktif tab Semua Mutasi

const sumMut = (it, jenis) => (it.mutasi||[]).filter(m=>m.jenis===jenis).reduce((s,m)=>s+(parseFloat(m.qty)||0),0);
const teoritisOf = it => (parseFloat(it.stokAwal)||0) + sumMut(it,'masuk') - sumMut(it,'keluar');
const fisikKgOf = it => it.fisik ? (parseFloat(it.fisik.drum)||0)*(parseFloat(it.isiDrum)||0) + (parseFloat(it.fisik.eceran)||0) : null;
const selisihOf = it => { const f = fisikKgOf(it); return f===null ? null : Math.round((f - teoritisOf(it))*100)/100; };
const hargaOf = it => parseFloat(it.harga)||0;
const nilaiOf = it => teoritisOf(it) * hargaOf(it);
const soldItemIds = () => new Set(sales.map(s=>s.itemId).filter(Boolean));

// ===================== FIREBASE INIT =====================
const fbApp = initializeApp(firebaseConfig);
auth = getAuth(fbApp);
db = getFirestore(fbApp);
$('connBadge').textContent = '⬤ Terhubung: ' + firebaseConfig.projectId;
$('connBadge').className = 'badge badge-on';

onAuthStateChanged(auth, user => {
  if(user){
    $('gate').style.display='none'; $('app').style.display='block';
    $('userBox').style.display='inline'; $('userBox').textContent = user.email;
    $('logoutBtn').style.display='inline-block';
    updateJenisSeg();
    startListening();
  } else {
    $('gate').style.display='block'; $('app').style.display='none';
    $('userBox').style.display='none'; $('logoutBtn').style.display='none';
    if(unsub){ unsub(); unsub=null; }
    if(unsubSales){ unsubSales(); unsubSales=null; }
    if(unsubSaleImports){ unsubSaleImports(); unsubSaleImports=null; }
  }
});

window.doLogin = async function(){
  $('authErr').style.display='none';
  const btn = $('loginBtn'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Masuk...';
  try { await signInWithEmailAndPassword(auth, $('authEmail').value.trim(), $('authPass').value); }
  catch(e){
    const m = {'auth/invalid-credential':'Email atau password salah.','auth/user-not-found':'Akun tidak ditemukan.','auth/wrong-password':'Password salah.','auth/invalid-email':'Format email salah.','auth/too-many-requests':'Terlalu banyak percobaan — tunggu sebentar.'};
    showMsg('authErr', m[e.code] || ('Gagal masuk: '+e.message), 6000);
  }
  btn.disabled = false; btn.textContent = 'Masuk';
};
window.doLogout = function(){ if(auth) signOut(auth); };

function startListening(){
  if(unsub) unsub();
  if(unsubSales) unsubSales();
  if(unsubSaleImports) unsubSaleImports();
  const q = query(collection(db, COLL), orderBy('nama'));
  unsub = onSnapshot(q, snap => {
    items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAll();
  }, err => {
    alert('Gagal membaca database: '+err.message+'\n\nCek Rules Firestore — koleksi "'+COLL+'" harus diizinkan untuk user login.');
  });
  const sq = query(collection(db, SALES_COLL), orderBy('tanggal'));
  unsubSales = onSnapshot(sq, snap => {
    sales = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if(curTab==='dash') renderDash();
    if(curTab==='lapjual'){ renderLaporanJual(); renderRekonsiliasi(); }
    renderRekonBadge();
  }, err => {
    console.warn('Gagal membaca penjualan:', err);
  });
  unsubSaleImports = onSnapshot(collection(db, SALES_IMPORT_COLL), snap => {
    saleImports = snap.docs.map(d => ({ id:d.id, ...d.data() }))
      .sort((a,b)=>String(b.createdAtIso||'').localeCompare(String(a.createdAtIso||'')));
    const latest = saleImports.find(x=>x.status==='active' && (parseInt(x.jumlah)||0)>0);
    lastSaleImport = latest || null;
    if($('undoSaleBtn')) $('undoSaleBtn').style.display = latest ? 'inline-block' : 'none';
    if($('saleImportHistory')) renderSaleImportHistory();
  }, err => {
    console.warn('Gagal membaca riwayat import penjualan:', err);
  });
}

function normalizeName(s){
  return String(s||'').trim().toLowerCase().replace(/\s+/g,' ');
}

function makeSaleRef(r){
  return ['jual', r.tanggal, r.noNota||'', r.pelanggan||'', r.namaRaw||'', r.qty, r.harga].join('|').toLowerCase();
}

function qtyKey(v){
  return String(Math.round((parseFloat(v)||0)*1000)/1000);
}

function mutasiLooseKeys({tanggal, pihak='', noNota='', nama='', qty=0}){
  const t = String(tanggal||'');
  const p = normalizeName(pihak);
  const nota = String(noNota||'').trim().toLowerCase();
  const n = normalizeName(nama);
  const q = qtyKey(qty);
  const keys = [
    ['keluar', t, p, n, q].join('|'),
    [t, p, n, q].join('|'),
    ['keluar', t, nota, n, q].join('|'),
    [t, nota, n, q].join('|')
  ];
  if(!p) keys.push([t, n, q].join('|'));
  return keys;
}

function reconciliationKey(tanggal, pihak, nama, qty){
  return [String(tanggal||''), normalizeName(pihak), normalizeName(nama), qtyKey(qty)].join('|');
}

function reconciliationData(){
  const mutations = [];
  items.forEach(it => (it.mutasi||[]).forEach((m,idx) => {
    if(m.jenis==='keluar') mutations.push({ itemId:it.id, itemNama:it.nama, idx, ...m });
  }));
  const activeMutations = mutations.filter(m=>!m.nonSale);
  const ignoredMutations = mutations.filter(m=>m.nonSale);
  const saleBuckets = new Map();
  sales.forEach(s => {
    const key = reconciliationKey(s.tanggal,s.pelanggan,s.namaBarang||s.namaNota,s.qty);
    if(!saleBuckets.has(key)) saleBuckets.set(key,[]);
    saleBuckets.get(key).push(s);
  });
  const usedSales = new Set();
  const missingSales = [];
  let matched = 0;
  activeMutations.forEach(m => {
    const key = reconciliationKey(m.tanggal,m.pihak,m.itemNama,m.qty);
    const match = (saleBuckets.get(key)||[]).find(s=>!usedSales.has(s.id));
    if(match){ usedSales.add(match.id); matched++; }
    else missingSales.push(m);
  });
  const missingMutations = sales.filter(s=>!usedSales.has(s.id));
  return { matched, missingSales, missingMutations, ignoredMutations };
}

function renderRekonBadge(){
  const el = $('rekonBadge'); if(!el) return;
  const r = reconciliationData();
  const total = r.missingSales.length + r.missingMutations.length;
  el.className = 'tag ' + (total ? 'tag-dup' : 'tag-masuk');
  el.textContent = total ? `${total} perlu diperiksa` : 'Semua cocok';
}

function validJualRows(){
  return jualRows.filter(r => r.checked && !r.dupSales && !r.invalidDate && findExact(r.target) && r.qty > 0 && r.harga > 0);
}

function inspectJualSelection(kurangiStok){
  const selected = jualRows.filter(r=>r.checked);
  const errors = [];
  const warnings = [];
  const badDate = selected.filter(r=>r.invalidDate).length;
  const noItem = selected.filter(r=>!findExact(r.target)).length;
  const badQty = selected.filter(r=>!(parseFloat(r.qty)>0)).length;
  const badPrice = selected.filter(r=>!(parseFloat(r.harga)>0)).length;
  const duplicate = selected.filter(r=>r.dupSales).length;
  if(badDate) errors.push(`${badDate} tanggal tidak valid`);
  if(noItem) errors.push(`${noItem} barang belum cocok dengan master stok`);
  if(badQty) errors.push(`${badQty} qty kosong atau nol`);
  if(badPrice) errors.push(`${badPrice} harga kosong atau nol`);
  if(duplicate) errors.push(`${duplicate} baris sudah ada di laporan`);

  const noCustomer = selected.filter(r=>!String(r.pelanggan||'').trim()).length;
  if(noCustomer) warnings.push(`${noCustomer} baris tanpa nama pelanggan`);

  const extremePrice = selected.filter(r => {
    const master = parseFloat(r.hargaMaster)||0;
    const harga = parseFloat(r.harga)||0;
    return master>0 && (harga < master*0.5 || harga > master*2);
  });
  if(extremePrice.length){
    warnings.push(`${extremePrice.length} harga sangat jauh dari harga master (di bawah 50% atau di atas 200%)`);
  }

  if(kurangiStok){
    const qtyByItem = {};
    selected.forEach(r => {
      const it = findExact(r.target); if(!it) return;
      qtyByItem[it.id] = (qtyByItem[it.id]||0) + (parseFloat(r.qty)||0);
    });
    const minus = Object.entries(qtyByItem).map(([id,qty]) => {
      const it = items.find(x=>x.id===id);
      return it ? { nama:it.nama, akhir:Math.round((teoritisOf(it)-qty)*100)/100, sat:it.sat||'kg' } : null;
    }).filter(x=>x && x.akhir<0);
    if(minus.length){
      const contoh = minus.slice(0,4).map(x=>`${x.nama} menjadi ${num(x.akhir)} ${x.sat}`).join('; ');
      warnings.push(`${minus.length} barang akan menjadi minus: ${contoh}${minus.length>4?'; dan lainnya':''}`);
    }
  }
  return { selected, errors, warnings };
}

// ===================== MATCHING NAMA =====================
function findExact(nama){
  if(!nama) return null;
  const n = normalizeName(nama);
  return items.find(it => normalizeName(it.nama) === n) || null;
}
function trigrams(s){ const set=new Set(); const p=' '+s+' '; for(let i=0;i<p.length-2;i++) set.add(p.slice(i,i+3)); return set; }
function similarity(a,b){ const ta=trigrams(a), tb=trigrams(b); let c=0; ta.forEach(t=>{if(tb.has(t))c++;}); return (2*c)/(ta.size+tb.size); }
function fuzzyFind(nama){
  if(!nama || nama.trim().length < 2) return null;
  const n = nama.trim().toLowerCase();
  const t1 = items.find(it => { const m = it.nama.toLowerCase(); return m.includes(n) || n.includes(m); });
  if(t1) return t1;
  const words = n.split(/\s+/).filter(w=>w.length>=3);
  if(words.length){
    const t2 = items.find(it => words.every(w => it.nama.toLowerCase().includes(w)));
    if(t2) return t2;
  }
  let best=null, bs=0;
  items.forEach(it => { const s = similarity(n, it.nama.toLowerCase()); if(s>bs){bs=s;best=it;} });
  return bs >= 0.30 ? best : null;
}

// ===================== TABS & RENDER =====================
window.setTab = function(t){
  curTab = t;
  ['dash','stok','jual','lapjual','imp','campur','mutasi','fisik'].forEach(x => {
    $('tb_'+x).className = 'tab-btn' + (x===t?' act':'');
    $('tab_'+x).style.display = x===t ? 'block':'none';
  });
  if(t==='campur' && !mixRows.length) resetMixForm(false);
  renderAll();
};

function renderAll(){
  renderChips();
  renderKatOptions();
  if(curTab==='dash') renderDash();
  if(curTab==='stok') renderStok();
  if(curTab==='lapjual'){ renderLaporanJual(); renderSaleImportHistory(); renderRekonsiliasi(); }
  if(curTab==='campur') renderMix();
  if(curTab==='mutasi') renderMutasi();
  if(curTab==='fisik') renderFisik();
  renderRekonBadge();
  $('itemList').innerHTML = items.map(it=>`<option value="${esc(it.nama)}">`).join('');
}

function renderKatOptions(){
  const kats = [...new Set(items.map(it=>it.kat).filter(Boolean))].sort();
  ['fltKat','fisKat'].forEach(id => {
    const sel = $(id); const cur = sel.value;
    sel.innerHTML = '<option value="">Semua kategori</option>' + kats.map(k=>`<option${k===cur?' selected':''}>${esc(k)}</option>`).join('');
  });
  $('katList').innerHTML = kats.map(k=>`<option value="${esc(k)}">`).join('');
}

function renderChips(){
  const total = items.length;
  const dihitung = items.filter(it=>it.fisik).length;
  const selisih = items.filter(it=>{ const s = selisihOf(it); return s!==null && Math.abs(s) > 0.01; }).length;
  const minus = items.filter(it=>teoritisOf(it) < -0.01).length;
  const nilaiTotal = items.reduce((s,it)=>s+nilaiOf(it),0);
  const adaHarga = items.some(it=>hargaOf(it)>0);
  let html = `
    <div class="chip teal"><div class="lbl">Total barang</div><div class="val">${total}</div></div>
    <div class="chip green"><div class="lbl">Sudah dihitung fisik</div><div class="val">${dihitung} / ${total}</div></div>
    <div class="chip ${selisih>0?'red':'green'}"><div class="lbl">Ada selisih</div><div class="val">${selisih}</div></div>
    <div class="chip ${minus>0?'warn':'green'}"><div class="lbl">Stok teoritis minus</div><div class="val">${minus}</div></div>`;
  if(adaHarga) html += `<div class="chip blue"><div class="lbl">Nilai stok teoritis</div><div class="val" style="font-size:16px">${rp(nilaiTotal)}</div></div>`;
  $('chips').innerHTML = html;
}

function renderSalesDashboard(){
  if(!$('dashSalesSum')) return;
  const today = todayIso();
  const monthPrefix = today.slice(0,7);
  const todaySales = sales.filter(s=>s.tanggal===today);
  const monthSales = sales.filter(s=>String(s.tanggal||'').startsWith(monthPrefix));
  const totalAll = sales.reduce((a,s)=>a+(parseFloat(s.subtotal)||0),0);
  const totalToday = todaySales.reduce((a,s)=>a+(parseFloat(s.subtotal)||0),0);
  const totalMonth = monthSales.reduce((a,s)=>a+(parseFloat(s.subtotal)||0),0);
  const priceDiff = sales.filter(s=>s.hargaMaster && Math.abs(parseFloat(s.selisihHarga)||0) > 0);
  $('dashSalesSum').innerHTML = `<span>Hari ini: <b>${rp(totalToday)}</b></span>
    <span>Bulan ini: <b>${rp(totalMonth)}</b></span>
    <span>Total tercatat: <b>${rp(totalAll)}</b></span>
    <span>Baris penjualan: <b>${sales.length}</b></span>
    <span>Harga beda master: <b>${priceDiff.length}</b></span>`;

  const byCust = {};
  sales.forEach(s=>{
    const k = s.pelanggan || '(tanpa pelanggan)';
    if(!byCust[k]) byCust[k] = 0;
    byCust[k] += parseFloat(s.subtotal)||0;
  });
  const cust = Object.entries(byCust).sort((a,b)=>b[1]-a[1]).slice(0,8);
  $('dashSalesCust').innerHTML = cust.length
    ? cust.map(([k,v])=>`<tr><td class="nama-cell">${esc(k)}</td><td class="r" style="font-weight:700">${rp(v)}</td></tr>`).join('')
    : `<tr><td colspan="2" class="empty">Belum ada penjualan.</td></tr>`;

  const byItem = {};
  sales.forEach(s=>{
    const k = s.namaBarang || s.namaNota || '(tanpa barang)';
    if(!byItem[k]) byItem[k] = { qty:0, total:0, sat:s.sat||'' };
    byItem[k].qty += parseFloat(s.qty)||0;
    byItem[k].total += parseFloat(s.subtotal)||0;
  });
  const itemRows = Object.entries(byItem).sort((a,b)=>b[1].total-a[1].total).slice(0,8);
  $('dashSalesItems').innerHTML = itemRows.length
    ? itemRows.map(([k,v])=>`<tr><td class="nama-cell">${esc(k)}</td><td class="r">${num(v.qty)} ${esc(v.sat)}</td><td class="r" style="font-weight:700">${rp(v.total)}</td></tr>`).join('')
    : `<tr><td colspan="3" class="empty">Belum ada penjualan.</td></tr>`;

  const diffRows = priceDiff
    .sort((a,b)=>Math.abs(parseFloat(b.selisihHarga)||0)-Math.abs(parseFloat(a.selisihHarga)||0))
    .slice(0,10);
  $('dashSalesPrice').innerHTML = diffRows.length
    ? diffRows.map(s=>{
      const d = parseFloat(s.selisihHarga)||0;
      return `<tr>
        <td>${isoToDisp(s.tanggal)}</td>
        <td>${esc(s.pelanggan||'')}</td>
        <td class="nama-cell">${esc(s.namaBarang||s.namaNota||'')}</td>
        <td class="r">${rp(s.harga)}</td>
        <td class="r">${rp(s.hargaMaster)}</td>
        <td class="r ${d<0?'neg':'pos'}">${d>0?'+':''}${rp(d)}</td>
      </tr>`;
    }).join('')
    : `<tr><td colspan="6" class="empty">Belum ada harga yang beda dari master.</td></tr>`;
}

function renderDash(){
  renderSalesDashboard();
  // ---- Top movers ----
  const masuk = items.map(it=>({it, q:sumMut(it,'masuk')})).filter(x=>x.q>0).sort((a,b)=>b.q-a.q).slice(0,8);
  const keluar = items.map(it=>({it, q:sumMut(it,'keluar')})).filter(x=>x.q>0).sort((a,b)=>b.q-a.q).slice(0,8);
  const maxMasuk = masuk.length ? masuk[0].q : 1;
  const maxKeluar = keluar.length ? keluar[0].q : 1;
  $('dashTopMasuk').innerHTML = masuk.length
    ? masuk.map(({it,q})=>`<tr>
        <td class="nama-cell">${esc(it.nama)}<span class="kat">${esc(it.kat||'')}</span></td>
        <td class="r bar-cell"><div class="bar-fill masuk" style="width:${(q/maxMasuk*100).toFixed(0)}%"></div><span class="bar-txt" style="color:#1e7a45;font-weight:700">${num(q)} ${esc(it.sat||'kg')}</span></td></tr>`).join('')
    : `<tr><td colspan="2" class="empty">Belum ada barang masuk.</td></tr>`;
  $('dashTopKeluar').innerHTML = keluar.length
    ? keluar.map(({it,q})=>`<tr>
        <td class="nama-cell">${esc(it.nama)}<span class="kat">${esc(it.kat||'')}</span></td>
        <td class="r bar-cell"><div class="bar-fill keluar" style="width:${(q/maxKeluar*100).toFixed(0)}%"></div><span class="bar-txt" style="color:#b7600a;font-weight:700">${num(q)} ${esc(it.sat||'kg')}</span></td></tr>`).join('')
    : `<tr><td colspan="2" class="empty">Belum ada barang keluar.</td></tr>`;

  // ---- Ringkasan kategori ----
  const cats = {};
  items.forEach(it=>{
    const k = it.kat || '(tanpa kategori)';
    if(!cats[k]) cats[k] = { n:0, kg:0, nilai:0 };
    cats[k].n++; cats[k].kg += teoritisOf(it); cats[k].nilai += nilaiOf(it);
  });
  const catArr = Object.entries(cats).sort((a,b)=> b[1].nilai - a[1].nilai || b[1].kg - a[1].kg);
  const adaHarga = items.some(it=>hargaOf(it)>0);
  const totRow = catArr.reduce((t,[,v])=>({n:t.n+v.n,kg:t.kg+v.kg,nilai:t.nilai+v.nilai}),{n:0,kg:0,nilai:0});
  $('dashKat').innerHTML = catArr.length
    ? catArr.map(([k,v])=>`<tr>
        <td class="nama-cell">${esc(k)}</td>
        <td class="r">${v.n}</td>
        <td class="r ${v.kg<-0.01?'neg':''}" style="font-weight:600">${num(v.kg)}</td>
        <td class="r">${adaHarga ? (v.nilai>0?rp(v.nilai):'<span class="zero">-</span>') : '<span class="zero">—</span>'}</td></tr>`).join('')
      + `<tr style="background:#fafafa"><td style="font-weight:700">TOTAL</td><td class="r" style="font-weight:700">${totRow.n}</td><td class="r" style="font-weight:700">${num(totRow.kg)}</td><td class="r" style="font-weight:700">${adaHarga?rp(totRow.nilai):'—'}</td></tr>`
    : `<tr><td colspan="4" class="empty">Belum ada barang.</td></tr>`;

  // ---- Selisih ----
  const sel = items.map(it=>({it, s:selisihOf(it)})).filter(x=>x.s!==null && Math.abs(x.s)>0.01)
    .sort((a,b)=>Math.abs(b.s)-Math.abs(a.s)).slice(0,10);
  $('dashSelisih').innerHTML = sel.length
    ? sel.map(({it,s})=>`<tr>
        <td class="nama-cell">${esc(it.nama)}<span class="kat">${esc(it.kat||'')}</span></td>
        <td class="r">${num(teoritisOf(it))}</td>
        <td class="r">${num(fisikKgOf(it))}</td>
        <td class="r ${s<0?'neg':'pos'}">${s>0?'+':''}${num(s)}</td></tr>`).join('')
    : `<tr><td colspan="4" class="empty">Tidak ada selisih — atau belum ada hitungan fisik.</td></tr>`;

  // ---- Minus ----
  const minus = items.filter(it=>teoritisOf(it) <= 0.01 && (it.stokAwal>0 || (it.mutasi||[]).length))
    .sort((a,b)=>teoritisOf(a)-teoritisOf(b)).slice(0,12);
  $('dashMinus').innerHTML = minus.length
    ? minus.map(it=>`<tr>
        <td class="nama-cell">${esc(it.nama)}<span class="kat">${esc(it.kat||'')}</span></td>
        <td class="r">${num(it.stokAwal)}</td>
        <td class="r">${num(sumMut(it,'masuk'))}</td>
        <td class="r">${num(sumMut(it,'keluar'))}</td>
        <td class="r ${teoritisOf(it)<-0.01?'neg':'zero'}">${num(teoritisOf(it))}</td></tr>`).join('')
    : `<tr><td colspan="5" class="empty">Tidak ada stok minus 🎉</td></tr>`;

  // ---- Mutasi terakhir ----
  const muts = [];
  items.forEach(it => (it.mutasi||[]).forEach(m => muts.push({...m, nama: it.nama})));
  muts.sort((a,b)=>String(b.tanggal).localeCompare(String(a.tanggal)));
  $('dashMutasi').innerHTML = muts.length
    ? muts.slice(0,15).map(m=>`<tr>
        <td>${isoToDisp(m.tanggal)}</td>
        <td><span class="tag ${m.jenis==='masuk'?'tag-masuk':'tag-keluar'}">${m.jenis==='masuk'?'MASUK':'KELUAR'}</span></td>
        <td class="nama-cell">${esc(m.nama)}</td>
        <td style="color:#888">${esc(m.pihak||'')}</td>
        <td class="r">${num(m.qty)}</td></tr>`).join('')
    : `<tr><td colspan="5" class="empty">Belum ada mutasi. Import dari app nota di tab 📋 Import Mutasi.</td></tr>`;
}

// ===================== TAB STOK =====================
window.toggleFltMinus = function(){ fltMinusOn = !fltMinusOn; $('fltMinus').classList.toggle('active', fltMinusOn); renderStok(); };
window.toggleFltTerjual = function(){
  fltTerjualOn = !fltTerjualOn;
  if(fltTerjualOn) fltBelumTerjualOn = false;
  $('fltTerjual').classList.toggle('active', fltTerjualOn);
  $('fltBelumTerjual').classList.toggle('active', fltBelumTerjualOn);
  renderStok();
};
window.toggleFltBelumTerjual = function(){
  fltBelumTerjualOn = !fltBelumTerjualOn;
  if(fltBelumTerjualOn) fltTerjualOn = false;
  $('fltTerjual').classList.toggle('active', fltTerjualOn);
  $('fltBelumTerjual').classList.toggle('active', fltBelumTerjualOn);
  renderStok();
};

function filteredItems(cariId, katId, minusOnly){
  const cari = $(cariId).value.trim().toLowerCase();
  const kat = $(katId).value;
  let list = items;
  if(cari) list = list.filter(it => it.nama.toLowerCase().includes(cari));
  if(kat) list = list.filter(it => it.kat === kat);
  if(minusOnly) list = list.filter(it => teoritisOf(it) < -0.01);
  if(cariId==='fltCari'){
    const sold = soldItemIds();
    if(fltTerjualOn) list = list.filter(it => sold.has(it.id));
    if(fltBelumTerjualOn) list = list.filter(it => !sold.has(it.id));
  }
  return list;
}

window.renderStok = function(){
  if(stokEditMode){ renderStokEdit(); return; }
  const list = filteredItems('fltCari','fltKat', fltMinusOn);
  const tbody = $('stokBody');
  if(!list.length){ tbody.innerHTML = `<tr><td colspan="10" class="empty">${items.length?'Tidak ada yang cocok dengan filter.':'Belum ada barang. Klik "➕ Tambah barang" atau "📥 Import master".'}</td></tr>`; return; }
  tbody.innerHTML = list.map(it => {
    const teo = teoritisOf(it), fis = fisikKgOf(it), s = selisihOf(it);
    const isi = parseFloat(it.isiDrum)||0;
    const stHtml = s===null ? '<span class="st st-belum">BELUM</span>'
      : Math.abs(s)<=0.01 ? '<span class="st st-cocok">COCOK</span>'
      : '<span class="st st-selisih">SELISIH</span>';
    return `<tr>
      <td class="nama-cell">${esc(it.nama)}<span class="kat">${esc(it.kat||'')} · ${esc(it.sat||'kg')}${hargaOf(it)>0?' · '+rp(hargaOf(it)):''}</span></td>
      <td class="r">${isi>0?num(isi):'<span class="zero">-</span>'}</td>
      <td class="r">${num(it.stokAwal)}</td>
      <td class="r" style="color:#1e7a45">${sumMut(it,'masuk')>0?num(sumMut(it,'masuk')):'-'}</td>
      <td class="r" style="color:#b7600a">${sumMut(it,'keluar')>0?num(sumMut(it,'keluar')):'-'}</td>
      <td class="r ${teo<-0.01?'neg':''}" style="font-weight:700">${num(teo)}${isi>0?`<span class="drum-note">${drumStr(teo,isi)}</span>`:''}</td>
      <td class="r">${fis===null?'<span class="zero">-</span>':num(fis)}</td>
      <td class="r">${s===null?'<span class="zero">-</span>':`<span class="${s<0?'neg':s>0?'pos':'zero'}">${s>0?'+':''}${num(s)}</span>`}</td>
      <td>${stHtml}</td>
      <td style="white-space:nowrap">
        <button class="icon-btn" onclick="openHist('${it.id}')" title="Riwayat mutasi">📜</button>
        <button class="icon-btn" onclick="openEdit('${it.id}')" title="Ubah barang / isi drum">✏️</button>
      </td>
    </tr>`;
  }).join('');
};

// ===================== EDIT MASSAL MASTER =====================
window.toggleStokEdit = function(){
  stokEditMode = !stokEditMode;
  stokDraft = {};
  $('stokEditBtn').className = 'btn btn-sm ' + (stokEditMode ? 'btn-g' : 'btn-line');
  $('stokEditBtn').textContent = stokEditMode ? '✅ Sedang edit massal' : '✏️ Edit massal';
  $('stokNormal').style.display = stokEditMode ? 'none' : 'block';
  $('stokEdit').style.display = stokEditMode ? 'block' : 'none';
  if(stokEditMode) renderStokEdit(); else renderStok();
};

function stokDraftGet(it){
  if(!stokDraft[it.id]) stokDraft[it.id] = {
    nama: it.nama||'', kat: it.kat||'', sat: it.sat||'kg',
    isiDrum: it.isiDrum ? String(it.isiDrum) : '', stokAwal: it.stokAwal!=null ? String(it.stokAwal) : '',
    harga: it.harga ? String(it.harga) : ''
  };
  return stokDraft[it.id];
}
function stokRowChanged(it){
  const d = stokDraft[it.id]; if(!d) return false;
  return d.nama.trim() !== (it.nama||'')
    || d.kat.trim() !== (it.kat||'')
    || (d.sat.trim()||'kg') !== (it.sat||'kg')
    || parseId(d.isiDrum) !== (parseFloat(it.isiDrum)||0)
    || parseId(d.stokAwal) !== (parseFloat(it.stokAwal)||0)
    || parseId(d.harga) !== (parseFloat(it.harga)||0);
}

function renderStokEdit(){
  const list = filteredItems('fltCari','fltKat', fltMinusOn);
  const tbody = $('stokEditBody');
  if(!list.length){ tbody.innerHTML = `<tr><td colspan="7" class="empty">${items.length?'Tidak ada yang cocok dengan filter.':'Belum ada barang.'}</td></tr>`; updateStokEditBar(); return; }
  tbody.innerHTML = list.map(it => {
    const d = stokDraftGet(it);
    return `<tr id="serow_${it.id}">
      <td><input class="edit-inp" value="${esc(d.nama)}" oninput="stokEditChange('${it.id}','nama',this.value)"></td>
      <td><input class="edit-inp" list="katList" value="${esc(d.kat)}" oninput="stokEditChange('${it.id}','kat',this.value)"></td>
      <td><input class="edit-inp" value="${esc(d.sat)}" oninput="stokEditChange('${it.id}','sat',this.value)"></td>
      <td><input class="edit-inp r" inputmode="decimal" value="${esc(d.isiDrum)}" oninput="stokEditChange('${it.id}','isiDrum',this.value)"></td>
      <td><input class="edit-inp r" inputmode="decimal" value="${esc(d.stokAwal)}" oninput="stokEditChange('${it.id}','stokAwal',this.value)"></td>
      <td><input class="edit-inp r" inputmode="numeric" value="${esc(grpRibu(d.harga))}" oninput="stokHargaInput(this,'${it.id}')"></td>
      <td class="r"><span id="sedot_${it.id}" style="color:#b7600a;font-weight:700;visibility:hidden">●</span></td>
    </tr>`;
  }).join('');
  updateStokEditBar();
}

window.stokEditChange = function(id, field, val){
  const it = items.find(x=>x.id===id); if(!it) return;
  stokDraftGet(it)[field] = val;
  const dot = $('sedot_'+id);
  if(dot) dot.style.visibility = stokRowChanged(it) ? 'visible' : 'hidden';
  // highlight changed inputs in this row
  const row = $('serow_'+id);
  if(row){ const changed = stokRowChanged(it); row.querySelectorAll('.edit-inp').forEach(inp=>inp.classList.toggle('changed', changed)); }
  updateStokEditBar();
};

window.stokHargaInput = function(el, id){
  const digits = onlyDigits(el.value);
  el.value = grpRibu(digits);        // tampilkan dengan titik ribuan
  stokEditChange(id, 'harga', digits); // simpan angka polos
};

function updateStokEditBar(){
  const n = items.filter(it => stokRowChanged(it)).length;
  const btn = $('stokSaveAllBtn'), cnt = $('stokEditCount');
  btn.disabled = n === 0;
  btn.textContent = n>0 ? `💾 Simpan ${n} perubahan` : '💾 Simpan semua perubahan';
  cnt.textContent = n>0 ? `${n} baris diubah — belum disimpan.` : 'Belum ada perubahan.';
}

window.stokSaveAll = async function(){
  const changed = items.filter(it => stokRowChanged(it));
  if(!changed.length) return;
  // validasi nama kosong / duplikat
  const finalNames = new Map();
  for(const it of changed){
    const d = stokDraft[it.id];
    const nm = d.nama.trim();
    if(!nm){ alert(`Nama barang tidak boleh kosong (lihat baris "${it.nama}").`); return; }
  }
  for(const it of items){
    const d = stokDraft[it.id];
    const nm = (d ? d.nama : it.nama).trim().toLowerCase();
    if(finalNames.has(nm)){
      alert(`Nama barang duplikat: "${d ? d.nama.trim() : it.nama}". Perbaiki dulu supaya import mutasi tidak salah target.`);
      return;
    }
    finalNames.set(nm, it.id);
  }
  const btn = $('stokSaveAllBtn'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Menyimpan...';
  try {
    let batch = writeBatch(db), inBatch = 0;
    for(const it of changed){
      const d = stokDraft[it.id];
      batch.update(doc(db, COLL, it.id), {
        nama: d.nama.trim(), kat: d.kat.trim(), sat: d.sat.trim()||'kg',
        isiDrum: parseId(d.isiDrum), stokAwal: parseId(d.stokAwal), harga: parseId(d.harga)
      });
      inBatch++;
      if(inBatch >= 400){ await batch.commit(); batch = writeBatch(db); inBatch = 0; }
    }
    if(inBatch>0) await batch.commit();
    await auditLog('stok_edit_massal', { jumlah: changed.length });
    stokDraft = {};
    // onSnapshot akan re-render; pastikan bar reset
    setTimeout(()=>{ if(stokEditMode) renderStokEdit(); }, 300);
  } catch(e){
    alert('Gagal menyimpan: '+e.message);
    btn.disabled = false; btn.textContent = '💾 Coba lagi';
  }
};

// ===================== IMPORT HARGA =====================
window.toggleHargaImp = function(){
  const b = $('hImpBody'); const open = b.style.display !== 'none';
  b.style.display = open ? 'none':'block';
};

let hargaParsed = [];

function cleanHeader(h){
  return String(h||'').toLowerCase().replace(/\s+/g,' ').replace(/[().]/g,'').trim();
}

function splitPasteLines(raw){
  return raw.replace(/\r/g,'').split('\n')
    .map(l => l.split('\t').map(c => String(c||'').trim()));
}

function parseHargaValue(v){
  const digits = onlyDigits(v);
  return digits ? parseInt(digits,10) : 0;
}

function unitMassFactor(sat){
  const key = String(sat||'').trim().toLowerCase().replace(/\./g,'');
  const factors = {
    kg:1, kilogram:1,
    ons:0.1, ounce:0.1,
    g:0.001, gr:0.001, gram:0.001
  };
  return factors[key] || null;
}

function normalizeSaleUnit(qty, sat, harga, subtotal, masterSat){
  const from = unitMassFactor(sat);
  const to = unitMassFactor(masterSat);
  if(!from || !to){
    return { qty, sat:sat||masterSat||'kg', harga, subtotal, converted:false };
  }
  const normalizedQty = Math.round((qty * from / to) * 1000000) / 1000000;
  const normalizedHarga = Math.round((harga * to / from) * 100) / 100;
  return {
    qty:normalizedQty,
    sat:masterSat||sat||'kg',
    harga:normalizedHarga,
    subtotal:subtotal || Math.round(normalizedQty * normalizedHarga),
    converted:Math.abs(normalizedQty-qty)>0.000001 || normalizeName(sat)!==normalizeName(masterSat)
  };
}

function normalizeStockQty(qty, sat, masterSat){
  const from = unitMassFactor(sat);
  const to = unitMassFactor(masterSat);
  if(!from || !to) return { qty, sat:sat||masterSat||'kg', converted:false };
  const normalizedQty = Math.round((qty * from / to) * 1000000) / 1000000;
  return {
    qty:normalizedQty,
    sat:masterSat||sat||'kg',
    converted:Math.abs(normalizedQty-qty)>0.000001 || normalizeName(sat)!==normalizeName(masterSat)
  };
}

window.parseHarga = function(){
  $('hImpErr').style.display='none';
  $('hImpPrev').innerHTML=''; hargaParsed=[];
  const raw = $('hImpTsv').value.trim();
  if(!raw){ showMsg('hImpErr','Paste data harga dulu.'); return; }
  const lines = splitPasteLines(raw).filter(r => r.some(c => c));
  if(lines.length < 2){ showMsg('hImpErr','Data terlalu sedikit. Paste baris judul dan minimal 1 baris barang.', 6000); return; }
  const header = lines[0].map(cleanHeader);
  const findCol = (kandidat, hindari=[]) => header.findIndex(h =>
    kandidat.some(k => h.includes(k)) && !hindari.some(k => h.includes(k)));
  const iNama = findCol(['nama barang','nama produk','nama','barang','produk','item'], ['no']);
  const iHarga = findCol(['harga','price','hrg']);
  if(iNama < 0 || iHarga < 0){
    showMsg('hImpErr','Kolom "Nama Barang" dan/atau "Harga" tidak ditemukan. Pastikan baris pertama adalah judul kolom.', 8000);
    return;
  }

  let nCocok=0, nLewat=0, nTidak=0, nSama=0;
  const seen = new Set();
  for(let i=1;i<lines.length;i++){
    const r = lines[i];
    const nama = String(r[iNama]||'').trim();
    const harga = parseHargaValue(r[iHarga]);
    if(!nama || /^[-—\s]+/.test(nama) || !harga){ nLewat++; continue; }
    const key = nama.toLowerCase();
    if(seen.has(key)) continue;
    seen.add(key);
    const exact = findExact(nama);
    const fuzzy = exact ? null : fuzzyFind(nama);
    const it = exact || fuzzy;
    if(!it){ nTidak++; hargaParsed.push({ nama, harga, target:null, fuzzy:false, checked:false }); continue; }
    const sama = hargaOf(it) === harga;
    if(sama) nSama++; else nCocok++;
    hargaParsed.push({
      nama, harga, target: it.nama, itemId: it.id, hargaLama: hargaOf(it),
      fuzzy: !!fuzzy, checked: !!exact && !sama
    });
  }
  if(!hargaParsed.length){ showMsg('hImpErr','Tidak ada baris harga yang bisa dibaca.', 6000); return; }

  const contoh = hargaParsed.slice(0,12).map((p,i)=>`
    <tr>
      <td><input type="checkbox" id="hImpC_${i}" ${p.checked?'checked':''} ${!p.itemId || p.hargaLama===p.harga?'disabled':''} onchange="hargaCheck(${i},this.checked)" style="width:15px;height:15px"></td>
      <td class="nama-cell">${esc(p.nama)}</td>
      <td>${p.target ? esc(p.target) : '<span style="color:#c0392b;font-weight:700">Tidak ketemu</span>'} ${p.fuzzy?'<span class="tag tag-fuzzy">fuzzy</span>':''}</td>
      <td class="r">${p.itemId ? rp(p.hargaLama) : '<span class="zero">-</span>'}</td>
      <td class="r" style="font-weight:700">${rp(p.harga)}</td>
    </tr>`).join('');

  $('hImpPrev').innerHTML = `
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
      <span class="tag" style="background:#e8f4f4;color:#0e7c7b">Nama: kolom ${iNama+1}</span>
      <span class="tag" style="background:#e8f4f4;color:#0e7c7b">Harga: kolom ${iHarga+1}</span>
      <span class="tag tag-masuk">${nCocok} siap update</span>
      ${nSama?`<span class="tag">${nSama} harga sudah sama</span>`:''}
      ${nTidak?`<span class="tag tag-dup">${nTidak} nama tidak ketemu</span>`:''}
      ${nLewat?`<span class="tag">${nLewat} baris dilewati</span>`:''}
    </div>
    <div class="tbl-wrap"><table>
      <thead><tr><th style="width:30px"></th><th>Nama di paste</th><th>Barang stok</th><th class="r">Harga lama</th><th class="r">Harga baru</th></tr></thead>
      <tbody>${contoh}</tbody>
    </table></div>
    ${hargaParsed.length>12?`<div class="hint" style="margin-top:5px">Preview menampilkan 12 dari ${hargaParsed.length} baris terbaca.</div>`:''}
    <div style="display:flex;gap:8px;margin-top:10px;align-items:center;flex-wrap:wrap">
      <button class="btn btn-t btn-sm" onclick="importHargaGo()" id="hImpBtn">💾 Update harga tercentang</button>
      <span class="hint" style="margin:0">Baris fuzzy tidak dicentang otomatis supaya tidak salah barang.</span>
    </div>`;
};

window.hargaCheck = function(i, checked){
  if(hargaParsed[i]) hargaParsed[i].checked = checked;
};

window.importHargaGo = async function(){
  const rows = hargaParsed.filter(p => p.checked && p.itemId && p.harga > 0 && p.harga !== p.hargaLama);
  if(!rows.length){ showMsg('hImpErr','Tidak ada harga valid yang dicentang.', 5000); return; }
  const btn = $('hImpBtn'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Menyimpan...';
  try {
    let batch = writeBatch(db), n = 0;
    for(const p of rows){
      batch.update(doc(db, COLL, p.itemId), { harga: p.harga });
      n++;
      if(n >= 400){ await batch.commit(); batch = writeBatch(db); n = 0; }
    }
    if(n > 0) await batch.commit();
    await auditLog('import_harga', { jumlah: rows.length });
    showMsg('hImpOk', `✔ ${rows.length} harga berhasil diperbarui.`, 7000);
    $('hImpTsv').value=''; $('hImpPrev').innerHTML=''; hargaParsed=[];
  } catch(e){
    showMsg('hImpErr','Gagal update harga: '+e.message, 8000);
    btn.disabled = false; btn.textContent = '💾 Coba lagi';
  }
};

// ===================== IMPORT MASTER =====================
window.toggleMasterImp = function(){
  const b = $('mImpBody'); const open = b.style.display !== 'none';
  b.style.display = open ? 'none':'block';
};

let masterParsed = [];

window.parseMaster = function(){
  $('mImpErr').style.display='none';
  $('mImpPrev').innerHTML=''; masterParsed=[];
  const raw = $('mImpTsv').value.trim();
  if(!raw){ showMsg('mImpErr','Paste data dulu.'); return; }
  const lines = raw.split('\n').map(l=>l.split('\t'));
  const header = lines[0].map(h=>h.trim().toLowerCase());

  const findCol = (kandidat, hindari=[]) => header.findIndex(h =>
    kandidat.some(k => h.includes(k)) && !hindari.some(k => h.includes(k)));
  const iNama = findCol(['nama barang','nama produk','nama','barang','produk','item'], ['no']);
  if(iNama < 0){ showMsg('mImpErr','Kolom "Nama" tidak ditemukan di baris judul. Pastikan baris pertama adalah judul kolom dan ada kolom bernama Nama / Nama Barang.', 9000); return; }
  const iKat  = findCol(['kategori','kat']);
  const iSat  = findCol(['satuan','sat']);
  const iIsi  = findCol(['isi/drum','isi drum','isi per drum','per drum','isidrum','drum'], ['sisa','stok']);
  const iHarga= findCol(['harga','price','hrg']);
  const iAwal = findCol(['stok awal','stock awal','stok','stock','awal','total','jumlah','sisa','qty'], ['drum','isi','harga']);

  const existing = new Map(items.map(it=>[it.nama.toLowerCase(), it]));
  let nBaru=0, nAda=0;
  for(let i=1;i<lines.length;i++){
    const r = lines[i];
    const nama = String(r[iNama]||'').trim();
    if(!nama) continue;
    const sudahAda = existing.has(nama.toLowerCase());
    if(sudahAda) nAda++; else nBaru++;
    masterParsed.push({
      nama, sudahAda,
      kat:  iKat>=0  ? String(r[iKat]||'').trim() : '',
      sat: (iSat>=0  ? String(r[iSat]||'').trim() : '') || 'kg',
      isiDrum: iIsi>=0  ? parseId(r[iIsi])  : 0,
      harga: iHarga>=0 ? (parseInt(onlyDigits(r[iHarga]))||0) : 0,
      stokAwal: iAwal>=0 ? parseId(r[iAwal]) : 0
    });
  }
  if(!masterParsed.length){ showMsg('mImpErr','Tidak ada baris data di bawah baris judul.', 6000); return; }

  const colTag = (label, i) => `<span class="tag" style="${i>=0?'background:#e8f4f4;color:#0e7c7b':'background:#f0f0ee;color:#999'}">${label}: ${i>=0?'✓ kolom '+(i+1)+' ("'+esc(lines[0][i].trim())+'")':'– kosong'}</span>`;
  const contoh = masterParsed.slice(0,5).map(p=>`<tr>
      <td class="nama-cell">${esc(p.nama)}${p.sudahAda?' <span class="tag tag-dup">sudah ada</span>':''}</td>
      <td>${esc(p.kat)||'<span class="zero">-</span>'}</td>
      <td>${esc(p.sat)}</td>
      <td class="r">${p.isiDrum>0?num(p.isiDrum):'<span class="zero">0</span>'}</td>
      <td class="r">${p.harga>0?rp(p.harga):'<span class="zero">-</span>'}</td>
      <td class="r" style="font-weight:700${p.stokAwal?'':';color:#c0392b'}">${num(p.stokAwal)}</td>
    </tr>`).join('');
  const semuaNol = masterParsed.every(p=>p.stokAwal===0);
  $('mImpPrev').innerHTML = `
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
      ${colTag('Nama',iNama)} ${colTag('Kategori',iKat)} ${colTag('Sat',iSat)} ${colTag('Isi/Drum',iIsi)} ${colTag('Harga',iHarga)} ${colTag('Stok Awal',iAwal)}
    </div>
    ${iAwal<0||semuaNol?`<div class="err-msg" style="display:block;margin:0 0 8px">⚠ ${iAwal<0?'Kolom stok awal tidak terdeteksi':'Semua stok awal terbaca 0'} — cek judul kolom stok di Excel Anda (harus mengandung: Stok / Total / Jumlah / Sisa / Awal).</div>`:''}
    <div class="hint" style="margin:0 0 4px">Contoh ${Math.min(5,masterParsed.length)} baris pertama dari ${masterParsed.length} baris terbaca:</div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>Nama</th><th>Kategori</th><th>Sat</th><th class="r">Isi/Drum</th><th class="r">Harga</th><th class="r">Stok Awal</th></tr></thead>
      <tbody>${contoh}</tbody>
    </table></div>
    <div style="display:flex;gap:10px;margin-top:10px;align-items:center;flex-wrap:wrap">
      <button class="btn btn-t btn-sm" onclick="importMasterGo()" id="mImpBtn">💾 Import ${masterParsed.length} barang</button>
      ${nAda?`<label style="font-size:12px;color:#666;display:flex;align-items:center;gap:6px;cursor:pointer">
        <input type="checkbox" id="mImpUpdate" checked style="width:15px;height:15px">
        perbarui ${nAda} barang yang sudah ada (timpa kategori, sat, isi/drum, harga &amp; stok awal — riwayat mutasi tetap aman)
      </label>`:''}
    </div>
    <div class="hint" style="margin-top:4px">${nBaru} barang baru${nAda?`, ${nAda} sudah ada di daftar stok`:''}.</div>`;
};

window.importMasterGo = async function(){
  if(!masterParsed.length) return;
  const updateMode = $('mImpUpdate') ? $('mImpUpdate').checked : false;
  const existing = new Map(items.map(it=>[it.nama.toLowerCase(), it]));
  const btn = $('mImpBtn'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Import...';
  let nBaru=0, nUpdate=0, nSkip=0;
  try {
    let batch = writeBatch(db), inBatch = 0;
    const sudahDiproses = new Set();
    for(const p of masterParsed){
      const key = p.nama.toLowerCase();
      if(sudahDiproses.has(key)) continue;
      sudahDiproses.add(key);
      const ada = existing.get(key);
      if(ada){
        if(!updateMode){ nSkip++; continue; }
        batch.update(doc(db, COLL, ada.id), { nama:p.nama, kat:p.kat, sat:p.sat, isiDrum:p.isiDrum, harga:p.harga, stokAwal:p.stokAwal });
        nUpdate++;
      } else {
        batch.set(doc(collection(db, COLL)), { nama:p.nama, kat:p.kat, sat:p.sat, isiDrum:p.isiDrum, harga:p.harga, stokAwal:p.stokAwal, mutasi:[], fisik:null, createdAt: serverTimestamp() });
        nBaru++;
      }
      inBatch++;
      if(inBatch >= 400){ await batch.commit(); batch = writeBatch(db); inBatch = 0; }
    }
    if(inBatch > 0) await batch.commit();
    await auditLog('import_master', { barangBaru: nBaru, diperbarui: nUpdate, dilewati: nSkip });
    showMsg('mImpOk', `✔ Selesai: ${nBaru} barang baru, ${nUpdate} diperbarui${nSkip?`, ${nSkip} dilewati`:''}.`, 7000);
    $('mImpTsv').value=''; $('mImpPrev').innerHTML=''; masterParsed=[];
  } catch(e){
    showMsg('mImpErr','Gagal: '+e.message, 8000);
    btn.disabled = false; btn.textContent = '💾 Coba lagi';
  }
};

// ===================== IMPORT PENJUALAN =====================
window.parseJual = function(){
  $('jualErr').style.display='none';
  $('jualPreview').innerHTML=''; jualRows=[];
  if(!items.length){ showMsg('jualErr','Daftar stok masih kosong — import master barang dulu di tab 📦 Stok.', 7000); return; }
  const raw = $('jualTsv').value.trim();
  if(!raw){ showMsg('jualErr','Paste data penjualan dulu.'); return; }
  const lines = splitPasteLines(raw).filter(r => r.some(c => c));
  if(lines.length < 2){ showMsg('jualErr','Data terlalu sedikit. Paste baris judul dan minimal 1 baris penjualan.', 6000); return; }
  const header = lines[0].map(cleanHeader);
  const idxAny = (...names) => header.findIndex(h => names.some(n => h === n || h.includes(n)));
  const iTgl = idxAny('tanggal','tgl','date');
  const iPelanggan = idxAny('pelanggan','customer','pembeli');
  const iKota = idxAny('kota','city');
  const iNota = idxAny('no.nota','no nota','nonota','nota','invoice','faktur');
  const iNama = idxAny('nama barang','nama','barang','produk','item');
  const iQty = idxAny('qty','jumlah','qnt','quantity');
  const iSat = idxAny('sat','satuan','unit');
  const iHarga = idxAny('harga jual','harga','price');
  const iSubtotal = idxAny('subtotal','sub total','total');
  const iHargaMaster = header.findIndex(h => h.includes('harga master'));
  if(iTgl < 0 || iPelanggan < 0 || iNama < 0 || iQty < 0 || iHarga < 0){
    showMsg('jualErr','Kolom wajib belum lengkap. Harus ada: Tanggal, Pelanggan, Nama Barang, Qty, dan Harga.', 9000);
    return;
  }

  const salesRefs = new Set();
  const mutasiRefs = new Set();
  sales.forEach(s => { if(s.ref) salesRefs.add(s.ref); });
  items.forEach(it => (it.mutasi||[]).forEach(m => {
    if(m.ref) mutasiRefs.add(String(m.ref).toLowerCase());
    mutasiLooseKeys({ tanggal:m.tanggal, pihak:m.pihak, noNota:m.noNota, nama:it.nama, qty:m.qty }).forEach(k=>mutasiRefs.add(k));
  }));

  for(let i=1;i<lines.length;i++){
    const r = lines[i]; if(r.length < 2) continue;
    if(cleanHeader(r[iTgl]) === 'tanggal' || cleanHeader(r[iNama]) === 'nama barang') continue;
    const namaRaw = String(r[iNama]||'').trim();
    const sourceQty = parseId(r[iQty]);
    const sourceHarga = parseHargaValue(r[iHarga]);
    if(!namaRaw || sourceQty <= 0 || sourceHarga <= 0) continue;
    const parsedDate = parseImportDate(r[iTgl]);
    const tanggal = parsedDate.iso;
    const pelanggan = String(r[iPelanggan]||'').trim();
    const kota = iKota>=0 ? String(r[iKota]||'').trim() : '';
    const noNota = iNota>=0 ? String(r[iNota]||'').trim() : '';
    const sourceSat = iSat>=0 ? String(r[iSat]||'kg').trim() : 'kg';
    const sourceSubtotal = iSubtotal>=0 ? (parseHargaValue(r[iSubtotal]) || Math.round(sourceQty * sourceHarga)) : Math.round(sourceQty * sourceHarga);
    const hargaMasterSheet = iHargaMaster>=0 ? parseHargaValue(r[iHargaMaster]) : 0;
    const exact = findExact(namaRaw);
    const fuzzy = exact ? null : fuzzyFind(namaRaw);
    const match = exact || fuzzy;
    const normalized = normalizeSaleUnit(sourceQty, sourceSat, sourceHarga, sourceSubtotal, match ? match.sat : sourceSat);
    const { qty, sat, harga, subtotal } = normalized;
    const row = {
      tanggal, pelanggan, kota, noNota, namaRaw, qty, sat, harga, subtotal, hargaMasterSheet,
      sourceQty, sourceSat, sourceHarga, sourceSubtotal, unitConverted:normalized.converted,
      target: match ? match.nama : '', itemId: match ? match.id : '',
      fuzzy: !!fuzzy, invalidDate: !parsedDate.ok,
      rawTanggal: parsedDate.raw || String(r[iTgl]||'').trim()
    };
    row.hargaMaster = match ? hargaOf(match) : hargaMasterSheet;
    row.selisihHarga = row.hargaMaster ? harga - row.hargaMaster : 0;
    row.ref = makeSaleRef(row);
    row.dupSales = salesRefs.has(row.ref);
    const cekNama = match ? match.nama : namaRaw;
    const legacyRef = ['keluar', tanggal, noNota, namaRaw, sourceQty].join('|').toLowerCase();
    row.dupMutasi = mutasiRefs.has(row.ref) || mutasiRefs.has(legacyRef)
      || mutasiLooseKeys({ tanggal, pihak:pelanggan, noNota, nama:cekNama, qty }).some(k=>mutasiRefs.has(k))
      || mutasiLooseKeys({ tanggal, pihak:pelanggan, noNota, nama:namaRaw, qty }).some(k=>mutasiRefs.has(k));
    row.dup = row.dupSales || row.dupMutasi;
    row.checked = !!exact && !row.dupSales && !row.dupMutasi && !row.invalidDate;
    jualRows.push(row);
  }
  if(!jualRows.length){ showMsg('jualErr','Tidak ada baris penjualan valid yang terbaca.', 6000); return; }

  const nDup = jualRows.filter(r=>r.dup).length;
  const nDupSales = jualRows.filter(r=>r.dupSales).length;
  const nDupMutasi = jualRows.filter(r=>r.dupMutasi).length;
  const nMutasiOnly = jualRows.filter(r=>!r.dupSales && r.dupMutasi).length;
  const nBadDate = jualRows.filter(r=>r.invalidDate).length;
  const nNoMatch = jualRows.filter(r=>!r.target).length;
  const nFuzzy = jualRows.filter(r=>r.fuzzy).length;
  const total = jualRows.filter(r=>r.checked).reduce((s,r)=>s+r.subtotal,0);
  $('jualPreview').innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
      <span class="tag tag-keluar" style="font-size:12px;padding:3px 12px">Terbaca ${jualRows.length} baris penjualan</span>
      <span class="tag tag-masuk">Siap simpan: ${jualRows.filter(r=>r.checked).length} baris · ${rp(total)}</span>
      ${nDup?`<span class="tag tag-dup">${nDup} kemungkinan duplikat</span>`:''}
      ${nDupSales?`<span class="tag tag-dup">${nDupSales} sudah ada di laporan</span>`:''}
      ${nDupMutasi?`<span class="tag tag-dup">${nDupMutasi} sudah ada di mutasi stok</span>`:''}
      ${nBadDate?`<span class="tag tag-dup">${nBadDate} tanggal tidak terbaca</span>`:''}
      ${nNoMatch?`<span class="tag tag-fuzzy">${nNoMatch} barang tidak ketemu</span>`:''}
      ${nFuzzy?`<span class="tag tag-fuzzy">${nFuzzy} cocok mirip, wajib cek</span>`:''}
    </div>
    ${nMutasiOnly?`<div class="hint" style="margin:0 0 8px;color:#b7600a">Ada ${nMutasiOnly} baris yang sudah mengurangi stok lewat mutasi, tapi belum ada di laporan penjualan. Kalau ingin melengkapi laporan, centang baris itu lalu pakai <b>Simpan penjualan saja</b>.</div>`:''}
    <div class="tbl-wrap"><table class="prev-tbl">
      <thead><tr>
        <th style="width:30px"><input type="checkbox" onchange="jualToggleAll(this.checked)" style="width:15px;height:15px"></th>
        <th style="width:78px">Tanggal</th>
        <th>Pelanggan</th>
        <th>Nama di nota</th>
        <th style="min-width:200px">→ Barang stok</th>
        <th class="r">Qty</th>
        <th class="r">Harga</th>
        <th class="r">Master</th>
        <th class="r">Subtotal</th>
        <th style="width:100px"></th>
      </tr></thead>
      <tbody>${jualRows.map((r,i)=>jualRowHtml(r,i)).join('')}</tbody>
    </table></div>
    <div style="display:flex;gap:8px;margin-top:10px;align-items:center;flex-wrap:wrap">
      <button class="btn btn-line" onclick="doJualImport(false)" id="jualOnlyBtn">💾 Simpan penjualan saja</button>
      <button class="btn btn-t" onclick="doJualImport(true)" id="jualStockBtn">💾 Simpan & kurangi stok</button>
      <button class="btn btn-line" onclick="resetJualImport()">Reset</button>
      <span class="hint" style="margin:0">Harga disimpan per transaksi. Master harga barang tidak diubah.</span>
    </div>
    <div class="ok-msg" id="jualOk"></div>`;
};

function jualRowHtml(r, i){
  const cls = r.target ? (r.fuzzy ? 'warn' : 'ok') : 'warn';
  const dateHtml = r.invalidDate
    ? `<span style="color:#c0392b;font-weight:700">Tanggal salah</span><br><span style="color:#aaa">${esc(r.rawTanggal||'-')}</span>`
    : isoToDisp(r.tanggal);
  return `<tr id="jualRow_${i}">
    <td><input type="checkbox" id="jualC_${i}" ${r.checked?'checked':''} onchange="jualCheck(${i},this.checked)" style="width:15px;height:15px"></td>
    <td>${dateHtml}</td>
    <td style="color:#666;font-size:11.5px">${esc(r.pelanggan)}${r.kota?'<br><span style="color:#aaa">'+esc(r.kota)+'</span>':''}</td>
    <td style="font-size:11.5px;color:#666">${esc(r.namaRaw)}</td>
    <td><input class="${cls}" list="itemList" value="${esc(r.target)}" oninput="jualOnTarget(${i},this)" onchange="jualNormalizeTarget(${i},this)" placeholder="Pilih barang stok..."></td>
    <td class="r" style="min-width:118px">
      <input class="r" style="width:68px;text-align:right" inputmode="decimal" value="${String(r.qty).replace('.',',')}" oninput="jualOnQty(${i},this.value)">
      <span style="display:inline-block;min-width:24px">${esc(r.sat)}</span>
      ${r.unitConverted?`<span class="drum-note">${num(r.sourceQty)} ${esc(r.sourceSat)} → standar</span>`:''}
    </td>
    <td class="r">${rp(r.harga)}</td>
    <td class="r">${r.hargaMaster?`${rp(r.hargaMaster)}${r.selisihHarga?`<br><span class="${r.selisihHarga<0?'neg':'pos'}">${r.selisihHarga>0?'+':''}${rp(r.selisihHarga)}</span>`:''}`:'<span class="zero">-</span>'}</td>
    <td class="r" style="font-weight:700" id="jualSubtotal_${i}">${rp(r.subtotal)}</td>
    <td style="font-size:10.5px">
      ${r.dupSales?'<span class="tag tag-dup">sudah di laporan</span> ':''}
      ${r.dupMutasi?'<span class="tag tag-dup">sudah di mutasi</span> ':''}
      ${r.fuzzy?'<span class="tag tag-fuzzy">fuzzy</span>':''}
      ${r.invalidDate?'<span class="tag tag-dup">tanggal</span>':''}
      ${!r.target?'<span style="color:#b7600a">pilih</span>':''}
    </td>
  </tr>`;
}

window.jualCheck = function(i, checked){
  if(jualRows[i]) jualRows[i].checked = checked;
};

window.jualOnTarget = function(i, inp){
  const exact = findExact(inp.value);
  const row = jualRows[i];
  row.target = inp.value;
  row.itemId = exact ? exact.id : '';
  row.hargaMaster = exact ? hargaOf(exact) : 0;
  row.selisihHarga = row.hargaMaster ? row.harga - row.hargaMaster : 0;
  row.fuzzy = false;
  inp.className = exact ? 'ok' : 'warn';
};

window.jualNormalizeTarget = function(i, inp){
  const row = jualRows[i];
  const exact = findExact(inp.value);
  if(!row || !exact) return;
  const normalized = normalizeSaleUnit(
    row.sourceQty ?? row.qty,
    row.sourceSat ?? row.sat,
    row.sourceHarga ?? row.harga,
    row.sourceSubtotal ?? row.subtotal,
    exact.sat
  );
  Object.assign(row, {
    target:exact.nama, itemId:exact.id,
    qty:normalized.qty, sat:normalized.sat, harga:normalized.harga, subtotal:normalized.subtotal,
    unitConverted:normalized.converted,
    hargaMaster:hargaOf(exact), fuzzy:false
  });
  row.selisihHarga = row.hargaMaster ? row.harga-row.hargaMaster : 0;
  row.ref = makeSaleRef(row);
  const tr = $('jualRow_'+i);
  if(tr) tr.outerHTML = jualRowHtml(row,i);
};

window.jualOnQty = function(i, value){
  const row = jualRows[i]; if(!row) return;
  row.qty = parseId(value);
  row.subtotal = Math.round(row.qty * row.harga);
  row.ref = makeSaleRef(row);
  const el = $('jualSubtotal_'+i);
  if(el) el.textContent = rp(row.subtotal);
};

window.jualToggleAll = function(v){
  jualRows.forEach((r,i)=>{
    r.checked = v && !r.invalidDate && !r.dupSales && !!findExact(r.target);
    const c=$('jualC_'+i); if(c) c.checked=r.checked;
  });
};

window.resetJualImport = function(){
  jualRows = [];
  $('jualTsv').value = '';
  $('jualPreview').innerHTML = '';
  $('jualErr').style.display = 'none';
};

window.doJualImport = async function(kurangiStok){
  const check = inspectJualSelection(kurangiStok);
  if(!check.selected.length){
    showMsg('jualErr','Belum ada baris yang dicentang.', 5000);
    return;
  }
  if(check.errors.length){
    showMsg('jualErr','Belum bisa disimpan: '+check.errors.join(' · ')+'. Perbaiki atau hilangkan centang pada baris tersebut.', 9000);
    return;
  }
  const rows = validJualRows();
  if(!rows.length){ showMsg('jualErr','Tidak ada baris penjualan valid yang dicentang.', 5000); return; }
  if(kurangiStok && rows.some(r=>r.dupMutasi)){
    showMsg('jualErr','Ada baris tercentang yang sudah ada di mutasi stok. Pakai "Simpan penjualan saja" untuk melengkapi laporan, atau hilangkan centangnya.', 8000);
    return;
  }
  if(check.warnings.length){
    const lanjut = confirm('PERINGATAN SEBELUM SIMPAN\n\n• '+check.warnings.join('\n• ')+'\n\nData tetap boleh disimpan. Sudah diperiksa dan ingin melanjutkan?');
    if(!lanjut) return;
  }
  const btnOnly = $('jualOnlyBtn'), btnStock = $('jualStockBtn');
  if(btnOnly) btnOnly.disabled = true;
  if(btnStock) btnStock.disabled = true;
  const activeBtn = kurangiStok ? btnStock : btnOnly;
  if(activeBtn) activeBtn.innerHTML = '<span class="spinner"></span> Menyimpan...';
  try {
    const importRef = doc(collection(db, SALES_IMPORT_COLL));
    const prepared = rows.map(r => {
      const it = findExact(r.target);
      return { r, it, saleRef:doc(collection(db, SALES_COLL)) };
    });
    const byItem = {};
    if(kurangiStok){
      prepared.forEach(({r,it,saleRef}) => {
        if(!byItem[it.id]) byItem[it.id] = { it, add: [] };
        byItem[it.id].add.push({
          jenis:'keluar', tanggal:r.tanggal, qty:r.qty, sat:r.sat,
          pihak:r.pelanggan, noNota:r.noNota, ref:r.ref,
          hargaJual:r.harga, subtotal:r.subtotal, sumber:'penjualan',
          saleId:saleRef.id, importGroupId:importRef.id
        });
      });
    }
    let batch = writeBatch(db), n = 0;
    const saleDocs = [];
    for(const {r,it,saleRef} of prepared){
      saleDocs.push({
        id:saleRef.id, ref:r.ref, itemId:it.id, stockDeducted:!!kurangiStok,
        subtotal:r.subtotal, importGroupId:importRef.id
      });
      batch.set(saleRef, {
        tanggal:r.tanggal, pelanggan:r.pelanggan, kota:r.kota, noNota:r.noNota,
        itemId:it.id, namaBarang:it.nama, namaNota:r.namaRaw,
        qty:r.qty, sat:r.sat, harga:r.harga, subtotal:r.subtotal,
        hargaMaster:r.hargaMaster||0, selisihHarga:r.selisihHarga||0,
        stockDeducted: !!kurangiStok,
        ref:r.ref, importGroupId:importRef.id,
        createdBy:userEmail(), createdAt:serverTimestamp()
      });
      n++;
    }
    if(kurangiStok){
      for(const id of Object.keys(byItem)){
        const { it, add } = byItem[id];
        batch.update(doc(db, COLL, id), { mutasi: [...(it.mutasi||[]), ...add] });
        n++;
      }
    }
    const total = rows.reduce((s,r)=>s+r.subtotal,0);
    batch.set(importRef, {
      jumlah:rows.length, jumlahAktif:rows.length, total, totalAktif:total, stockDeducted:!!kurangiStok,
      status:'active', saleIds:saleDocs.map(x=>x.id),
      createdBy:userEmail(), createdAt:serverTimestamp(), createdAtIso:new Date().toISOString()
    });
    await batch.commit();
    lastSaleImport = {
      id:importRef.id, saleDocs, jumlah:rows.length, total,
      stockDeducted:!!kurangiStok, status:'active', createdAtIso:new Date().toISOString()
    };
    $('undoSaleBtn').style.display = 'inline-block';
    await auditLog(kurangiStok ? 'import_penjualan_stok' : 'import_penjualan_saja', { jumlah: rows.length, total, barang: Object.keys(byItem).length });
    showMsg('jualOk', `✔ ${rows.length} baris penjualan disimpan. Total ${rp(total)}.${kurangiStok?' Stok sudah dikurangi.':' Stok tidak diubah.'}`, 8000);
    $('jualTsv').value='';
    setTimeout(()=>{ $('jualPreview').innerHTML=''; jualRows=[]; }, 2500);
  } catch(e){
    showMsg('jualErr','Gagal menyimpan penjualan: '+e.message, 8000);
    if(btnOnly){ btnOnly.disabled = false; btnOnly.textContent = '💾 Simpan penjualan saja'; }
    if(btnStock){ btnStock.disabled = false; btnStock.textContent = '💾 Simpan & kurangi stok'; }
  }
};

window.undoLastSaleImport = async function(){
  if(!lastSaleImport || !lastSaleImport.id){
    alert('Belum ada import penjualan terakhir untuk dibatalkan.');
    return;
  }
  await undoSaleImport(lastSaleImport.id);
};

window.undoSaleImport = async function(importId){
  const imp = saleImports.find(x=>x.id===importId) || (lastSaleImport && lastSaleImport.id===importId ? lastSaleImport : null);
  if(!imp || imp.status!=='active'){
    alert('Kelompok import ini sudah dibatalkan atau tidak ditemukan.');
    return;
  }
  let groupSales = sales.filter(s=>s.importGroupId===importId);
  if(!groupSales.length && lastSaleImport && lastSaleImport.id===importId && lastSaleImport.saleDocs){
    groupSales = lastSaleImport.saleDocs;
  }
  const n = groupSales.length;
  if(!n){
    alert('Tidak ada penjualan aktif dalam kelompok ini.');
    return;
  }
  const msg = `Batalkan satu kelompok import (${n} baris, total ${rp(groupSales.reduce((a,s)=>a+(parseFloat(s.subtotal)||0),0))})?\n\n` +
    (imp.stockDeducted ? 'Data laporan akan dihapus dan semua mutasi stok terkait ikut dihapus.' : 'Data laporan akan dihapus. Stok tidak berubah.');
  if(!confirm(msg)) return;
  try {
    const batch = writeBatch(db);
    groupSales.forEach(s => batch.delete(doc(db, SALES_COLL, s.id)));
    if(imp.stockDeducted){
      const itemIds = new Set(groupSales.map(s=>s.itemId).filter(Boolean));
      for(const itemId of itemIds){
        const it = items.find(x=>x.id===itemId); if(!it) continue;
        const saleIds = new Set(groupSales.filter(s=>s.itemId===itemId).map(s=>s.id));
        const refs = new Set(groupSales.filter(s=>s.itemId===itemId).map(s=>s.ref));
        const mutasi = (it.mutasi||[]).filter(m =>
          m.importGroupId !== importId && !saleIds.has(m.saleId) &&
          !(m.sumber==='penjualan' && refs.has(m.ref)));
        batch.update(doc(db, COLL, itemId), { mutasi });
      }
    }
    batch.update(doc(db, SALES_IMPORT_COLL, importId), {
      status:'undone', undoneAt:serverTimestamp(), undoneAtIso:new Date().toISOString(),
      undoneBy:userEmail(), jumlahAktif:0
    });
    await batch.commit();
    await auditLog('undo_import_penjualan', { importGroupId:importId, jumlah:n, stockDeducted:!!imp.stockDeducted });
    if(lastSaleImport && lastSaleImport.id===importId) lastSaleImport = null;
    $('undoSaleBtn').style.display = 'none';
    showMsg(curTab==='lapjual'?'lapJualOk':'jualErr','Kelompok import penjualan sudah dibatalkan.', 7000);
  } catch(e){
    const target = curTab==='lapjual' ? 'lapJualOk' : 'jualErr';
    showMsg(target,'Gagal membatalkan import: '+e.message, 8000);
  }
};

function filteredSales(){
  const cari = $('lapJualCari') ? $('lapJualCari').value.trim().toLowerCase() : '';
  const dari = $('lapJualDari') ? $('lapJualDari').value : '';
  const sampai = $('lapJualSampai') ? $('lapJualSampai').value : '';
  let list = [...sales];
  if(dari) list = list.filter(s => String(s.tanggal||'') >= dari);
  if(sampai) list = list.filter(s => String(s.tanggal||'') <= sampai);
  if(cari) list = list.filter(s =>
    String(s.pelanggan||'').toLowerCase().includes(cari) ||
    String(s.kota||'').toLowerCase().includes(cari) ||
    String(s.noNota||'').toLowerCase().includes(cari) ||
    String(s.namaBarang||s.namaNota||'').toLowerCase().includes(cari));
  list.sort((a,b)=>String(b.tanggal||'').localeCompare(String(a.tanggal||'')) || String(a.pelanggan||'').localeCompare(String(b.pelanggan||'')));
  return list;
}

window.renderLaporanJual = function(){
  if(!$('lapJualBody')) return;
  const list = filteredSales();
  const total = list.reduce((s,x)=>s+(parseFloat(x.subtotal)||0),0);
  const qty = list.reduce((s,x)=>s+(parseFloat(x.qty)||0),0);
  const pelanggan = new Set(list.map(x=>x.pelanggan).filter(Boolean)).size;
  const stokDeducted = list.filter(x=>x.stockDeducted).length;
  $('lapJualSum').innerHTML = `<span>Baris: <b>${list.length}</b></span>
    <span>Pelanggan: <b>${pelanggan}</b></span>
    <span>Total qty: <b>${num(qty)}</b></span>
    <span>Total jual: <b>${rp(total)}</b></span>
    <span>Sudah kurangi stok: <b>${stokDeducted}</b></span>`;
  if(!list.length){
    $('lapJualBody').innerHTML = `<tr><td colspan="9" class="empty">${sales.length?'Tidak ada penjualan yang cocok dengan filter.':'Belum ada data penjualan.'}</td></tr>`;
    return;
  }
  $('lapJualBody').innerHTML = list.map(s => {
    const diff = parseFloat(s.selisihHarga)||0;
    return `<tr>
      <td>${isoToDisp(s.tanggal)}</td>
      <td class="nama-cell">${esc(s.pelanggan||'')}<span class="kat">${esc(s.noNota||'')}</span></td>
      <td>${esc(s.kota||'')}</td>
      <td class="nama-cell">${esc(s.namaBarang||s.namaNota||'')}<span class="kat">${s.hargaMaster?`Master ${rp(s.hargaMaster)}${diff?` · <span class="${diff<0?'neg':'pos'}">${diff>0?'+':''}${rp(diff)}</span>`:''}`:''}</span></td>
      <td class="r">${num(s.qty)} ${esc(s.sat||'')}</td>
      <td class="r">${rp(s.harga)}</td>
      <td class="r" style="font-weight:700">${rp(s.subtotal)}</td>
      <td>${s.stockDeducted?'<span class="tag tag-keluar">keluar</span>':'<span class="tag">tidak</span>'}</td>
      <td style="white-space:nowrap">
        <button class="icon-btn" onclick="editSale('${s.id}')" title="Edit penjualan">✏️</button>
        <button class="icon-btn danger" onclick="deleteSale('${s.id}')" title="Hapus penjualan">✕</button>
      </td>
    </tr>`;
  }).join('');
};

window.toggleRekonsiliasi = function(){
  const wrap = $('rekonWrap'), btn = $('rekonToggle');
  const open = wrap.style.display !== 'none';
  wrap.style.display = open ? 'none' : 'block';
  btn.textContent = open ? 'Buka pemeriksaan' : 'Tutup pemeriksaan';
  if(!open) renderRekonsiliasi();
};

function renderRekonsiliasi(){
  renderRekonBadge();
  const el = $('rekonContent'); if(!el) return;
  const r = reconciliationData();
  const mutRows = r.missingSales.map(m=>`<tr>
    <td>${isoToDisp(m.tanggal)}</td>
    <td>${esc(m.pihak||'')}</td>
    <td class="nama-cell">${esc(m.itemNama)}</td>
    <td class="r">${num(m.qty)} ${esc(m.sat||'')}</td>
    <td style="white-space:nowrap">
      <button class="btn btn-t btn-sm" onclick="openSaleFromMutation('${m.itemId}',${m.idx})">Buat penjualan</button>
      <button class="btn btn-line btn-sm" onclick="markMutationNonSale('${m.itemId}',${m.idx},true)">Bukan penjualan</button>
    </td>
  </tr>`).join('');
  const saleRows = r.missingMutations.map(s=>`<tr>
    <td>${isoToDisp(s.tanggal)}</td>
    <td>${esc(s.pelanggan||'')}</td>
    <td class="nama-cell">${esc(s.namaBarang||s.namaNota||'')}</td>
    <td class="r">${num(s.qty)} ${esc(s.sat||'')}</td>
    <td><button class="btn btn-t btn-sm" onclick="applySaleToStock('${s.id}')">Buat mutasi stok</button></td>
  </tr>`).join('');
  const ignoredRows = r.ignoredMutations.map(m=>`<tr>
    <td>${isoToDisp(m.tanggal)}</td>
    <td>${esc(m.pihak||'')}</td>
    <td class="nama-cell">${esc(m.itemNama)}</td>
    <td class="r">${num(m.qty)} ${esc(m.sat||'')}</td>
    <td><button class="btn btn-line btn-sm" onclick="markMutationNonSale('${m.itemId}',${m.idx},false)">Kembalikan</button></td>
  </tr>`).join('');
  el.innerHTML = `
    <div class="mut-sum">
      <span>Cocok: <b>${r.matched}</b></span>
      <span style="color:#b7600a">Belum masuk laporan: <b>${r.missingSales.length}</b></span>
      <span style="color:#c0392b">Belum masuk stok: <b>${r.missingMutations.length}</b></span>
      <span>Bukan penjualan: <b>${r.ignoredMutations.length}</b></span>
    </div>
    <div class="card-title" style="margin-top:12px">Mutasi keluar belum masuk laporan penjualan</div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>Tanggal</th><th>Pihak</th><th>Barang</th><th class="r">Qty</th><th style="width:230px"></th></tr></thead>
      <tbody>${mutRows||'<tr><td colspan="5" class="empty">Tidak ada. Semua mutasi keluar sudah cocok.</td></tr>'}</tbody>
    </table></div>
    <div class="card-title" style="margin-top:16px">Penjualan belum memiliki mutasi stok</div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>Tanggal</th><th>Pelanggan</th><th>Barang</th><th class="r">Qty</th><th style="width:140px"></th></tr></thead>
      <tbody>${saleRows||'<tr><td colspan="5" class="empty">Tidak ada. Semua penjualan sudah cocok.</td></tr>'}</tbody>
    </table></div>
    ${ignoredRows?`<div class="card-title" style="margin-top:16px">Ditandai bukan penjualan</div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>Tanggal</th><th>Pihak</th><th>Barang</th><th class="r">Qty</th><th style="width:110px"></th></tr></thead>
      <tbody>${ignoredRows}</tbody>
    </table></div>`:''}`;
}

window.markMutationNonSale = async function(itemId, idx, value){
  const it = items.find(x=>x.id===itemId), m = it && (it.mutasi||[])[idx];
  if(!it || !m) return;
  const text = value ? 'Tandai mutasi ini sebagai bukan penjualan?' : 'Kembalikan mutasi ini ke pemeriksaan penjualan?';
  if(!confirm(text)) return;
  const arr = [...(it.mutasi||[])];
  arr[idx] = {
    ...m, nonSale:!!value,
    nonSaleAt:value ? new Date().toISOString() : '',
    nonSaleBy:value ? userEmail() : ''
  };
  try {
    await updateDoc(doc(db,COLL,itemId),{ mutasi:arr });
    await auditLog(value?'mutasi_bukan_penjualan':'mutasi_kembali_rekonsiliasi',{ barang:it.nama, tanggal:m.tanggal, qty:m.qty });
  } catch(e){ alert('Gagal memperbarui mutasi: '+e.message); }
};

window.applySaleToStock = async function(id){
  const s = sales.find(x=>x.id===id); if(!s) return;
  const it = items.find(x=>x.id===s.itemId) || findExact(s.namaBarang);
  if(!it){ alert('Barang stok tidak ditemukan. Edit nama barang penjualan terlebih dahulu.'); return; }
  const akhir = teoritisOf(it) - (parseFloat(s.qty)||0);
  const warning = akhir<0 ? `\n\nPerhatian: stok ${it.nama} akan menjadi ${num(akhir)} ${it.sat||'kg'}.` : '';
  if(!confirm(`Buat mutasi stok keluar untuk penjualan ${s.pelanggan||''} - ${it.nama} ${num(s.qty)} ${s.sat||''}?${warning}`)) return;
  try {
    const linked = { ...s, stockDeducted:true };
    const batch = writeBatch(db);
    batch.update(doc(db,SALES_COLL,id),{ stockDeducted:true, updatedAt:serverTimestamp(), updatedBy:userEmail() });
    batch.update(doc(db,COLL,it.id),{ mutasi:[...(it.mutasi||[]),saleMutationFor(linked,it)] });
    await batch.commit();
    await auditLog('rekonsiliasi_buat_mutasi',{ saleId:id, barang:it.nama, qty:s.qty });
    showMsg('lapJualOk','Mutasi stok berhasil dibuat.',5000);
  } catch(e){ alert('Gagal membuat mutasi stok: '+e.message); }
};

function renderSaleImportHistory(){
  const el = $('saleImportHistory'); if(!el) return;
  if(!saleImports.length){
    el.innerHTML = '<div class="empty">Belum ada riwayat kelompok import. Import berikutnya akan tercatat di sini.</div>';
    return;
  }
  el.innerHTML = `<div class="tbl-wrap"><table>
    <thead><tr><th>Waktu import</th><th class="r">Baris</th><th class="r">Total</th><th>Stok</th><th>Status</th><th style="width:110px"></th></tr></thead>
    <tbody>${saleImports.slice(0,30).map(imp => {
      const aktif = imp.status === 'active';
      const dt = imp.createdAtIso ? new Date(imp.createdAtIso) : null;
      const waktu = dt && !isNaN(dt) ? dt.toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short'}) : '-';
      const jumlahAktif = imp.jumlahAktif === undefined ? imp.jumlah : imp.jumlahAktif;
      return `<tr>
        <td>${esc(waktu)}<span class="kat">${esc(imp.createdBy||'')}</span></td>
        <td class="r">${num(jumlahAktif||0)}</td>
        <td class="r" style="font-weight:700">${rp(imp.totalAktif===undefined ? imp.total : imp.totalAktif)}</td>
        <td>${imp.stockDeducted?'<span class="tag tag-keluar">dikurangi</span>':'<span class="tag">tidak</span>'}</td>
        <td>${aktif?'<span class="tag tag-masuk">aktif</span>':imp.status==='empty'?'<span class="tag">habis dihapus</span>':'<span class="tag tag-dup">dibatalkan</span>'}</td>
        <td>${aktif && jumlahAktif>0?`<button class="btn btn-r btn-sm" onclick="undoSaleImport('${imp.id}')">Batalkan</button>`:''}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>
  ${saleImports.length>30?'<div class="hint" style="margin-top:6px">Menampilkan 30 kelompok import terbaru.</div>':''}`;
}

window.toggleSaleImportHistory = function(){
  const wrap = $('saleImportHistoryWrap');
  const btn = $('saleHistoryToggle');
  const open = wrap.style.display !== 'none';
  wrap.style.display = open ? 'none' : 'block';
  btn.textContent = open ? 'Lihat riwayat' : 'Tutup riwayat';
  if(!open) renderSaleImportHistory();
};

window.lapJualResetDate = function(){
  $('lapJualDari').value = '';
  $('lapJualSampai').value = '';
  renderLaporanJual();
};

window.copyLaporanJual = function(){
  const list = filteredSales();
  if(!list.length){ alert('Tidak ada data laporan untuk dicopy.'); return; }
  const header = ['Tanggal','Pelanggan','Kota','No Nota','Barang','Qty','Sat','Harga','Harga Master','Selisih Harga','Subtotal','Stok Dikurangi'].join('\t');
  const rows = list.map(s => [
    isoToDisp(s.tanggal), s.pelanggan||'', s.kota||'', s.noNota||'', s.namaBarang||s.namaNota||'',
    String(s.qty||0).replace('.',','), s.sat||'', s.harga||0, s.hargaMaster||'', s.selisihHarga||'',
    s.subtotal||0, s.stockDeducted?'YA':'TIDAK'
  ].join('\t'));
  const tsv = header + '\n' + rows.join('\n');
  navigator.clipboard.writeText(tsv).then(()=>showMsg('lapJualOk','✔ Laporan berhasil dicopy.'))
  .catch(()=>{
    const ta = document.createElement('textarea');
    ta.value = tsv; ta.style.position='fixed'; ta.style.opacity='0';
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
    showMsg('lapJualOk','✔ Laporan berhasil dicopy.');
  });
};

function saleMutationFor(s, it){
  return {
    jenis:'keluar', tanggal:s.tanggal, qty:parseFloat(s.qty)||0, sat:s.sat||'kg',
    pihak:s.pelanggan||'', noNota:s.noNota||'', ref:s.ref,
    hargaJual:parseFloat(s.harga)||0, subtotal:parseFloat(s.subtotal)||0, sumber:'penjualan',
    saleId:s.id, importGroupId:s.importGroupId||''
  };
}

function removeSaleMutation(item, sale){
  const arr = [...(item.mutasi||[])];
  let idx = arr.findIndex(m => sale.id && m.saleId === sale.id);
  if(idx < 0) idx = arr.findIndex(m => m.sumber==='penjualan' && m.ref === sale.ref);
  if(idx >= 0) arr.splice(idx, 1);
  return arr;
}

async function syncSaleMutation(batch, oldSale, newSale){
  if(!oldSale.stockDeducted) return;
  const oldItem = items.find(it => it.id === oldSale.itemId) || findExact(oldSale.namaBarang);
  const newItem = items.find(it => it.id === newSale.itemId) || findExact(newSale.namaBarang);
  if(!oldItem || !newItem) throw new Error('Barang stok untuk mutasi penjualan tidak ditemukan.');
  const oldArr = removeSaleMutation(oldItem, oldSale);
  const newMut = saleMutationFor(newSale, newItem);
  if(oldItem.id === newItem.id){
    oldArr.push(newMut);
    batch.update(doc(db, COLL, oldItem.id), { mutasi: oldArr });
  } else {
    batch.update(doc(db, COLL, oldItem.id), { mutasi: oldArr });
    batch.update(doc(db, COLL, newItem.id), { mutasi: [...(newItem.mutasi||[]), newMut] });
  }
}

window.editSale = function(id){
  const s = sales.find(x=>x.id===id); if(!s) return;
  saleCreateMutation = null;
  saleEditId = id;
  $('saleEditTitle').textContent = 'Edit Penjualan';
  $('seBarang').disabled = false;
  $('saleEditErr').style.display='none';
  $('saleEditSub').textContent = s.stockDeducted ? 'Penjualan ini sudah mengurangi stok. Jika qty/barang/tanggal diubah, mutasi stok ikut diperbarui.' : 'Penjualan ini tidak mengurangi stok.';
  $('seTanggal').value = s.tanggal || todayIso();
  $('sePelanggan').value = s.pelanggan || '';
  $('seKota').value = s.kota || '';
  $('seNota').value = s.noNota || '';
  $('seBarang').value = s.namaBarang || s.namaNota || '';
  $('seSat').value = s.sat || 'kg';
  $('seQty').value = String(s.qty||'').replace('.',',');
  $('seHarga').value = s.harga ? grpRibu(s.harga) : '';
  updateSaleEditCalc();
  $('saleModal').classList.add('show');
};

window.openSaleFromMutation = function(itemId,idx){
  const it = items.find(x=>x.id===itemId), m = it && (it.mutasi||[])[idx];
  if(!it || !m) return;
  saleEditId = null;
  saleCreateMutation = { itemId, idx };
  $('saleEditTitle').textContent = 'Buat Penjualan dari Mutasi';
  $('saleEditSub').textContent = 'Stok sudah berkurang. Lengkapi harga jual lalu simpan ke laporan penjualan.';
  $('saleEditErr').style.display='none';
  $('seTanggal').value = m.tanggal || todayIso();
  $('sePelanggan').value = m.pihak || '';
  $('seKota').value = '';
  $('seNota').value = m.noNota || '';
  $('seBarang').value = it.nama;
  $('seBarang').disabled = true;
  $('seSat').value = m.sat || it.sat || 'kg';
  $('seQty').value = String(m.qty||'').replace('.',',');
  $('seHarga').value = it.harga ? grpRibu(it.harga) : '';
  updateSaleEditCalc();
  $('saleModal').classList.add('show');
};

window.closeSaleEdit = function(){
  saleEditId = null;
  saleCreateMutation = null;
  $('seBarang').disabled = false;
  $('saleModal').classList.remove('show');
};

window.updateSaleEditCalc = function(){
  if(!$('saleEditCalc')) return;
  const it = findExact($('seBarang').value);
  const qty = parseId($('seQty').value);
  const harga = parseHargaValue($('seHarga').value);
  const subtotal = Math.round(qty * harga);
  const master = it ? hargaOf(it) : 0;
  const diff = master ? harga - master : 0;
  $('saleEditCalc').innerHTML = `<span>Subtotal: <b>${rp(subtotal)}</b></span>
    <span>Harga master: <b>${master?rp(master):'-'}</b></span>
    <span>Selisih: <b class="${diff<0?'neg':diff>0?'pos':''}">${master?(diff>0?'+':'')+rp(diff):'-'}</b></span>`;
};

['seBarang','seQty','seHarga'].forEach(id => setTimeout(()=>{ const el=$(id); if(el) el.addEventListener('input', updateSaleEditCalc); },0));

async function saveSaleFromMutation(){
  const src = saleCreateMutation;
  const it = src && items.find(x=>x.id===src.itemId);
  const m = it && (it.mutasi||[])[src.idx];
  if(!it || !m){ showMsg('saleEditErr','Mutasi asal sudah berubah. Tutup lalu buka pemeriksaan kembali.',7000); return; }
  const pd = parseImportDate($('seTanggal').value);
  const qty = parseId($('seQty').value);
  const harga = parseHargaValue($('seHarga').value);
  if(!pd.ok){ showMsg('saleEditErr','Tanggal tidak valid.',6000); return; }
  if(qty<=0){ showMsg('saleEditErr','Qty harus lebih dari 0.',6000); return; }
  if(harga<=0){ showMsg('saleEditErr','Harga harus lebih dari 0.',6000); return; }
  const pelanggan = $('sePelanggan').value.trim();
  if(!pelanggan && !confirm('Nama pelanggan masih kosong. Tetap simpan?')) return;
  const noNota = $('seNota').value.trim();
  const sat = $('seSat').value.trim()||'kg';
  const hargaMaster = hargaOf(it);
  const saleRef = doc(collection(db,SALES_COLL));
  const ref = makeSaleRef({ tanggal:pd.iso,noNota,pelanggan,namaRaw:it.nama,qty,harga });
  const subtotal = Math.round(qty*harga);
  const sale = {
    id:saleRef.id, tanggal:pd.iso, pelanggan, kota:$('seKota').value.trim(), noNota,
    itemId:it.id, namaBarang:it.nama, namaNota:it.nama, qty, sat, harga, subtotal,
    hargaMaster, selisihHarga:hargaMaster ? harga-hargaMaster : 0,
    stockDeducted:true, ref, sumber:'rekonsiliasi',
    createdBy:userEmail(), createdAt:serverTimestamp()
  };
  const arr = [...(it.mutasi||[])];
  arr[src.idx] = {
    ...m, jenis:'keluar', tanggal:pd.iso, pihak:pelanggan, noNota, qty, sat,
    hargaJual:harga, subtotal, ref, sumber:'penjualan', saleId:saleRef.id,
    nonSale:false, nonSaleAt:'', nonSaleBy:''
  };
  const btn=$('saleEditSaveBtn'); btn.disabled=true; btn.innerHTML='<span class="spinner"></span> Menyimpan...';
  try {
    const batch=writeBatch(db);
    const {id,...payload}=sale;
    batch.set(saleRef,payload);
    batch.update(doc(db,COLL,it.id),{mutasi:arr});
    await batch.commit();
    await auditLog('rekonsiliasi_buat_penjualan',{saleId:saleRef.id,barang:it.nama,qty,total:subtotal});
    closeSaleEdit();
    showMsg('lapJualOk','Penjualan berhasil dibuat dari mutasi stok.',5000);
  } catch(e){ showMsg('saleEditErr','Gagal membuat penjualan: '+e.message,8000); }
  btn.disabled=false; btn.textContent='💾 Simpan';
}

window.saveSaleEdit = async function(){
  if(saleCreateMutation) return saveSaleFromMutation();
  const s = sales.find(x=>x.id===saleEditId); if(!s) return;
  $('saleEditErr').style.display='none';
  const pd = parseImportDate($('seTanggal').value);
  if(!pd.ok){ showMsg('saleEditErr','Tanggal tidak valid.', 6000); return; }
  const it = findExact($('seBarang').value);
  if(!it){ showMsg('saleEditErr','Barang stok tidak ditemukan. Pilih nama persis dari master barang.', 7000); return; }
  const qty = parseId($('seQty').value);
  if(qty <= 0){ showMsg('saleEditErr','Qty harus lebih dari 0.', 6000); return; }
  const harga = parseHargaValue($('seHarga').value);
  if(harga <= 0){ showMsg('saleEditErr','Harga harus lebih dari 0.', 6000); return; }
  const subtotal = Math.round(qty * harga);
  const hargaMaster = hargaOf(it);
  const updated = {
    ...s, tanggal:pd.iso, pelanggan:$('sePelanggan').value.trim(), kota:$('seKota').value.trim(), noNota:$('seNota').value.trim(),
    itemId:it.id, namaBarang:it.nama, qty, sat:($('seSat').value.trim()||'kg'), harga, subtotal,
    hargaMaster, selisihHarga:hargaMaster ? harga - hargaMaster : 0
  };
  updated.ref = makeSaleRef({
    tanggal:updated.tanggal, noNota:updated.noNota, pelanggan:updated.pelanggan,
    namaRaw:updated.namaNota||updated.namaBarang, qty:updated.qty, harga:updated.harga
  });
  const btn = $('saleEditSaveBtn'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Menyimpan...';
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, SALES_COLL, saleEditId), {
      tanggal:updated.tanggal, pelanggan:updated.pelanggan, kota:updated.kota, noNota:updated.noNota,
      itemId:updated.itemId, namaBarang:updated.namaBarang, qty:updated.qty, sat:updated.sat,
      harga:updated.harga, subtotal:updated.subtotal,
      hargaMaster:updated.hargaMaster, selisihHarga:updated.selisihHarga, ref:updated.ref,
      updatedAt:serverTimestamp(), updatedBy:userEmail()
    });
    await syncSaleMutation(batch, s, updated);
    if(s.importGroupId){
      const imp = saleImports.find(x=>x.id===s.importGroupId);
      if(imp){
        const currentTotal = imp.totalAktif===undefined ? imp.total : imp.totalAktif;
        batch.update(doc(db, SALES_IMPORT_COLL, s.importGroupId), {
          totalAktif:Math.max(0,(parseFloat(currentTotal)||0)-(parseFloat(s.subtotal)||0)+subtotal),
          updatedAt:serverTimestamp()
        });
      }
    }
    await batch.commit();
    await auditLog('penjualan_edit', { id:saleEditId, pelanggan:updated.pelanggan, barang:updated.namaBarang, subtotal:updated.subtotal, stockDeducted:!!updated.stockDeducted });
    closeSaleEdit();
    showMsg('lapJualOk','✔ Penjualan berhasil diperbarui.', 5000);
  } catch(e){ showMsg('saleEditErr','Gagal edit penjualan: '+e.message, 8000); }
  btn.disabled = false; btn.textContent = '💾 Simpan';
};

window.deleteSale = async function(id){
  const s = sales.find(x=>x.id===id); if(!s) return;
  const msg = `Hapus penjualan ${s.pelanggan||''} - ${s.namaBarang||s.namaNota||''} ${num(s.qty)} ${s.sat||''}?\n\n` +
    (s.stockDeducted ? 'Mutasi stok keluar yang terkait juga akan dihapus.' : 'Stok tidak akan berubah karena penjualan ini tidak mengurangi stok.');
  if(!confirm(msg)) return;
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, SALES_COLL, id));
    if(s.stockDeducted){
      const it = items.find(x=>x.id===s.itemId) || findExact(s.namaBarang);
      if(!it) throw new Error('Barang stok untuk menghapus mutasi tidak ditemukan.');
      batch.update(doc(db, COLL, it.id), { mutasi: removeSaleMutation(it, s) });
    }
    if(s.importGroupId){
      const imp = saleImports.find(x=>x.id===s.importGroupId);
      if(imp){
        const currentCount = imp.jumlahAktif===undefined ? imp.jumlah : imp.jumlahAktif;
        const currentTotal = imp.totalAktif===undefined ? imp.total : imp.totalAktif;
        const nextCount = Math.max(0,(parseInt(currentCount)||0)-1);
        batch.update(doc(db, SALES_IMPORT_COLL, s.importGroupId), {
          jumlahAktif:nextCount,
          totalAktif:Math.max(0,(parseFloat(currentTotal)||0)-(parseFloat(s.subtotal)||0)),
          status:nextCount ? 'active' : 'empty',
          updatedAt:serverTimestamp()
        });
      }
    }
    await batch.commit();
    await auditLog('penjualan_hapus', { id, pelanggan:s.pelanggan||'', barang:s.namaBarang||'', subtotal:s.subtotal||0, stockDeducted:!!s.stockDeducted });
    showMsg('lapJualOk','✔ Penjualan berhasil dihapus.', 5000);
  } catch(e){ alert('Gagal hapus penjualan: '+e.message); }
};

// ===================== MODAL EDIT BARANG =====================
window.openEdit = function(id){
  editDocId = id;
  $('eErr').style.display='none';
  if(id){
    const it = items.find(x=>x.id===id); if(!it) return;
    $('emTitle').textContent = '✏️ Ubah Barang';
    $('eNama').value = it.nama; $('eKat').value = it.kat||''; $('eSat').value = it.sat||'kg';
    $('eIsiDrum').value = it.isiDrum||''; $('eAwal').value = it.stokAwal||''; $('eHarga').value = it.harga?grpRibu(it.harga):'';
    $('eDelBtn').style.display = 'inline-block';
    const isi = parseFloat(it.isiDrum)||0;
    $('eDrumHint').textContent = isi>0 ? `Contoh: teoritis saat ini ${num(teoritisOf(it))} ${it.sat||'kg'} = ${drumStr(teoritisOf(it),isi)}` : '';
  } else {
    $('emTitle').textContent = '➕ Tambah Barang';
    $('eNama').value=''; $('eKat').value=''; $('eSat').value='kg'; $('eIsiDrum').value=''; $('eAwal').value=''; $('eHarga').value='';
    $('eDelBtn').style.display='none'; $('eDrumHint').textContent='';
  }
  $('editModal').classList.add('show');
  setTimeout(()=>$('eNama').focus(), 100);
};
window.closeEdit = function(){ editDocId=null; $('editModal').classList.remove('show'); };

window.saveEdit = async function(){
  $('eErr').style.display='none';
  const nama = $('eNama').value.trim();
  if(!nama){ showMsg('eErr','Nama belum diisi.'); return; }
  const dupe = items.find(it => it.nama.toLowerCase() === nama.toLowerCase() && it.id !== editDocId);
  if(dupe){ showMsg('eErr','Nama barang ini sudah ada.'); return; }
  const payload = {
    nama, kat: $('eKat').value.trim(), sat: $('eSat').value.trim()||'kg',
    isiDrum: parseId($('eIsiDrum').value), stokAwal: parseId($('eAwal').value), harga: parseInt(onlyDigits($('eHarga').value))||0
  };
  const btn = $('eSaveBtn'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Menyimpan...';
  try {
    if(editDocId) await updateDoc(doc(db, COLL, editDocId), payload);
    else await addDoc(collection(db, COLL), { ...payload, mutasi: [], fisik: null, createdAt: serverTimestamp() });
    await auditLog(editDocId ? 'barang_update' : 'barang_tambah', { nama });
    closeEdit();
  } catch(e){ showMsg('eErr','Gagal: '+e.message, 6000); }
  btn.disabled = false; btn.textContent = '💾 Simpan';
};

window.delItemFromModal = async function(){
  const it = items.find(x=>x.id===editDocId); if(!it) return;
  if(!confirm(`Hapus barang "${it.nama}"?\nSemua riwayat mutasi dan hitungan fisiknya ikut terhapus.`)) return;
  try { await deleteDoc(doc(db, COLL, editDocId)); await auditLog('barang_hapus', { id: editDocId, nama: it.nama }); closeEdit(); }
  catch(e){ showMsg('eErr','Gagal: '+e.message, 6000); }
};

// ===================== MODAL RIWAYAT =====================
window.openHist = function(id){
  histDocId = id;
  refreshHist();
  $('histModal').classList.add('show');
};
window.closeHist = function(){
  closeHistMutEdit();
  histDocId=null;
  $('histModal').classList.remove('show');
};

function refreshHist(){
  const it = items.find(x=>x.id===histDocId); if(!it){ closeHist(); return; }
  $('hmTitle').textContent = '📜 ' + it.nama;
  $('hmSub').textContent = `Stok awal ${num(it.stokAwal)} ${it.sat||'kg'} · masuk ${num(sumMut(it,'masuk'))} · keluar ${num(sumMut(it,'keluar'))} · teoritis ${num(teoritisOf(it))}`;
  const muts = (it.mutasi||[]).map((m,i)=>({...m,_i:i})).sort((a,b)=>String(b.tanggal).localeCompare(String(a.tanggal)));
  $('hmList').innerHTML = muts.length
    ? muts.map(m=>`<div class="hist-row">
        <span style="color:#888;width:74px;flex-shrink:0">${isoToDisp(m.tanggal)}</span>
        <span class="tag ${m.jenis==='masuk'?'tag-masuk':'tag-keluar'}">${m.jenis==='masuk'?'MASUK':'KELUAR'}</span>
        <span style="font-weight:600">${num(m.qty)} ${esc(m.sat||'')}</span>
        <span style="color:#888;flex:1">${esc(m.pihak||'')} ${m.noNota?'· '+esc(m.noNota):''}</span>
        <button class="icon-btn" onclick="openHistMutEdit(${m._i})" title="Edit mutasi">✏️</button>
        <button class="icon-btn danger" onclick="delMutasi(${m._i})">✕</button>
      </div>`).join('')
    : `<div class="hist-row" style="color:#bbb">Belum ada mutasi untuk barang ini.</div>`;
}

window.openHistMutEdit = function(idx){
  const it = items.find(x=>x.id===histDocId), m = it && (it.mutasi||[])[idx];
  if(!it || !m) return;
  const linked = linkedSaleForMutation(m,it.nama);
  histMutEdit = { itemId:it.id, idx };
  $('histMutErr').style.display='none';
  $('histMutSub').textContent = linked
    ? `Terhubung ke penjualan ${linked.pelanggan||''}. Perubahan barang, tanggal, qty, pihak, dan nota akan diterapkan juga ke laporan penjualan.`
    : 'Mutasi ini belum terhubung ke laporan penjualan.';
  $('hmJenis').value = m.jenis||'keluar';
  $('hmJenis').disabled = !!linked;
  $('hmTanggal').value = m.tanggal||todayIso();
  $('hmBarang').value = it.nama;
  $('hmQty').value = String(m.qty||'').replace('.',',');
  $('hmPihak').value = m.pihak||'';
  $('hmNota').value = m.noNota||'';
  $('histMutModal').classList.add('show');
};

window.closeHistMutEdit = function(){
  histMutEdit=null;
  if($('hmJenis')) $('hmJenis').disabled=false;
  if($('histMutModal')) $('histMutModal').classList.remove('show');
};

window.saveHistMutEdit = async function(){
  if(!histMutEdit) return;
  $('histMutErr').style.display='none';
  const tanggal=$('hmTanggal').value;
  if(!validIsoDate(tanggal)){ showMsg('histMutErr','Tanggal tidak valid.',5000); return; }
  const barang=$('hmBarang').value.trim();
  if(!findExact(barang)){ showMsg('histMutErr','Barang tidak ditemukan. Pilih nama persis dari daftar.',6000); return; }
  const qty=parseId($('hmQty').value);
  if(qty<=0){ showMsg('histMutErr','Qty harus lebih dari 0.',5000); return; }
  const d={
    jenis:$('hmJenis').value, tanggal, barang, qty,
    pihak:$('hmPihak').value, noNota:$('hmNota').value
  };
  await saveMutationChange(histMutEdit.itemId,histMutEdit.idx,d,$('histMutSaveBtn'));
  if($('histMutSaveBtn')){ $('histMutSaveBtn').disabled=false; $('histMutSaveBtn').textContent='Simpan'; }
};

window.delMutasi = async function(i){
  await deleteMutation(histDocId,i,'mutasi_hapus_riwayat');
  if(histDocId) setTimeout(refreshHist,400);
};

// ===================== IMPORT MUTASI (jenis manual) =====================
window.setImportJenis = function(j){ importJenis = j; updateJenisSeg(); };
function updateJenisSeg(){
  const m = $('segMasuk'), k = $('segKeluar');
  if(!m||!k) return;
  m.className = importJenis==='masuk' ? 'on-masuk' : '';
  k.className = importJenis==='keluar' ? 'on-keluar' : '';
  const note = $('impJenisNote');
  if(note) note.innerHTML = importJenis==='masuk'
    ? 'Mode: <b style="color:#1e7a45">BARANG MASUK</b> — stok akan <b>bertambah</b>.'
    : 'Mode: <b style="color:#b7600a">BARANG KELUAR</b> — stok akan <b>berkurang</b>.';
}

window.parseImport = function(){
  $('impErr').style.display='none';
  $('impPreview').innerHTML=''; importRows=[];
  if(!items.length){ showMsg('impErr','Daftar stok masih kosong — import master barang dulu di tab 📦 Stok.', 7000); return; }
  const raw = $('impTsv').value.trim();
  if(!raw){ showMsg('impErr','Paste data TSV dulu.'); return; }
  const lines = raw.split('\n').map(l=>l.split('\t'));
  const header = lines[0].map(h=>h.trim().toLowerCase());
  const idxAny = (...names) => header.findIndex(h => names.some(n => h === n || h.includes(n)));

  const jenis = importJenis;   // <<< dari pilihan manual, bukan auto
  const iNama = idxAny('nama barang','nama','barang','produk');
  const iQty  = idxAny('qty','jumlah','qnt','quantity');
  if(iNama < 0 || iQty < 0){ showMsg('impErr','Kolom "Nama Barang" / "Qty" tidak ditemukan di baris judul.', 7000); return; }
  const iTgl   = idxAny('tanggal','tgl','date');
  const iPihak = jenis==='masuk' ? idxAny('supplier','pemasok','pihak','vendor')
                                 : idxAny('pelanggan','customer','pihak','buyer');
  const iNota  = idxAny('no.nota','no nota','nonota','nota','invoice','faktur');
  const iSat   = idxAny('sat','satuan','unit');

  const existingRefs = new Set();
  items.forEach(it => (it.mutasi||[]).forEach(m => { if(m.ref) existingRefs.add(m.ref); }));

  for(let i=1;i<lines.length;i++){
    const r = lines[i]; if(r.length < 2) continue;
    const namaRaw = String(r[iNama]||'').trim();
    const sourceQty = parseId(r[iQty]);
    if(!namaRaw || sourceQty <= 0) continue;
    const parsedDate = iTgl>=0 ? parseImportDate(r[iTgl]) : { iso: todayIso(), ok: true, empty: true };
    const tanggal = parsedDate.iso;
    const pihak = iPihak>=0 ? String(r[iPihak]||'').trim() : '';
    const noNota = iNota>=0 ? String(r[iNota]||'').trim() : '';
    const sourceSat = iSat>=0 ? String(r[iSat]||'kg').trim() : 'kg';

    const exact = findExact(namaRaw);
    const fuzzy = exact ? null : fuzzyFind(namaRaw);
    const match = exact || fuzzy;
    const normalized = normalizeStockQty(sourceQty, sourceSat, match ? match.sat : sourceSat);
    const qty = normalized.qty;
    const sat = normalized.sat;
    const ref = [jenis, tanggal, noNota, namaRaw, qty].join('|').toLowerCase();
    const legacyRef = [jenis, tanggal, noNota, namaRaw, sourceQty].join('|').toLowerCase();
    const dup = existingRefs.has(ref) || existingRefs.has(legacyRef);
    importRows.push({
      jenis, tanggal, pihak, noNota, sat, qty, namaRaw, ref,
      sourceQty, sourceSat, unitConverted:normalized.converted,
      target: match ? match.nama : '',
      fuzzy: !!fuzzy,
      invalidDate: !parsedDate.ok,
      rawTanggal: parsedDate.raw || String(iTgl>=0 ? (r[iTgl]||'') : '').trim(),
      dup,
      checked: !!exact && !dup && parsedDate.ok
    });
  }
  if(!importRows.length){ showMsg('impErr','Tidak ada baris valid.', 6000); return; }

  const nDup = importRows.filter(r=>r.dup).length;
  const nNoMatch = importRows.filter(r=>!r.target).length;
  const nFuzzy = importRows.filter(r=>r.fuzzy).length;
  const nBadDate = importRows.filter(r=>r.invalidDate).length;
  $('impPreview').innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
      <span class="tag ${jenis==='masuk'?'tag-masuk':'tag-keluar'}" style="font-size:12px;padding:3px 12px">Disimpan sebagai: BARANG ${jenis.toUpperCase()} — ${importRows.length} baris</span>
      ${nDup?`<span class="tag tag-dup">${nDup} kemungkinan duplikat (tidak dicentang)</span>`:''}
      ${nNoMatch?`<span class="tag tag-fuzzy">${nNoMatch} tidak ketemu — pilih manual atau hilangkan centang</span>`:''}
      ${nFuzzy?`<span class="tag tag-fuzzy">${nFuzzy} cocok mirip, wajib dicek manual</span>`:''}
      ${nBadDate?`<span class="tag tag-dup">${nBadDate} tanggal tidak terbaca</span>`:''}
    </div>
    <div class="tbl-wrap"><table class="prev-tbl">
      <thead><tr>
        <th style="width:30px"><input type="checkbox" id="impAll" onchange="impToggleAll(this.checked)" style="width:15px;height:15px"></th>
        <th style="width:78px">Tanggal</th>
        <th>Pihak</th>
        <th>Nama di nota</th>
        <th style="min-width:200px">→ Barang stok</th>
        <th class="r" style="width:80px">Qty</th>
        <th style="width:100px"></th>
      </tr></thead>
      <tbody id="impBody2">${importRows.map((r,i)=>impRowHtml(r,i)).join('')}</tbody>
    </table></div>
    <div style="display:flex;gap:8px;margin-top:10px;align-items:center;flex-wrap:wrap">
      <button class="btn ${jenis==='masuk'?'btn-g':'btn-t'}" onclick="doImport()" id="impGoBtn">💾 Simpan mutasi terpilih (${jenis.toUpperCase()})</button>
      <span class="hint" style="margin:0">Baris fuzzy / tanggal salah sengaja tidak dicentang otomatis. Cek dulu sebelum simpan.</span>
    </div>
    <div class="ok-msg" id="impOk"></div>`;
};

function impRowHtml(r, i){
  const cls = r.target ? (r.fuzzy ? 'warn' : 'ok') : 'warn';
  const dateHtml = r.invalidDate
    ? `<span style="color:#c0392b;font-weight:700">Tanggal salah</span><br><span style="color:#aaa">${esc(r.rawTanggal||'-')}</span>`
    : isoToDisp(r.tanggal);
  return `<tr>
    <td><input type="checkbox" id="impC_${i}" ${r.checked?'checked':''} onchange="importRows[${i}].checked=this.checked" style="width:15px;height:15px"></td>
    <td>${dateHtml}</td>
    <td style="color:#888;font-size:11.5px">${esc(r.pihak)}${r.noNota?'<br><span style="color:#bbb;font-size:10.5px">'+esc(r.noNota)+'</span>':''}</td>
    <td style="font-size:11.5px;color:#666">${esc(r.namaRaw)}</td>
    <td><input class="${cls}" list="itemList" value="${esc(r.target)}" oninput="impOnTarget(${i},this)" placeholder="Pilih barang stok..."></td>
    <td>
      <input class="r" style="width:74px;text-align:right" value="${String(r.qty).replace('.',',')}" oninput="importRows[${i}].qty=parseIdG(this.value)">
      <span style="display:inline-block;min-width:24px">${esc(r.sat)}</span>
      ${r.unitConverted?`<span class="drum-note">${num(r.sourceQty)} ${esc(r.sourceSat)} → standar</span>`:''}
    </td>
    <td style="font-size:10.5px">
      ${r.dup?'<span class="tag tag-dup">duplikat?</span> ':''}
      ${r.fuzzy?'<span class="tag tag-fuzzy">🔀 fuzzy</span>':''}
      ${r.invalidDate?'<span class="tag tag-dup">tanggal</span>':''}
      ${!r.target?'<span style="color:#b7600a">⚠ pilih</span>':''}
    </td>
  </tr>`;
}
window.parseIdG = parseId;
window.impOnTarget = function(i, inp){
  importRows[i].target = inp.value;
  const exact = findExact(inp.value);
  importRows[i].fuzzy = false;
  inp.className = exact ? 'ok' : 'warn';
};
window.impToggleAll = function(v){ importRows.forEach((r,i)=>{ r.checked=v && !r.invalidDate && !r.dup; const c=$('impC_'+i); if(c) c.checked=r.checked; }); };

window.doImport = async function(){
  const rows = importRows.filter(r => r.checked && !r.invalidDate && r.target && findExact(r.target) && r.qty > 0);
  if(!rows.length){ showMsg('impErr','Tidak ada baris valid yang dicentang.', 5000); return; }
  if(importJenis==='keluar'){
    const qtyByItem = {};
    rows.forEach(r => {
      const it = findExact(r.target);
      qtyByItem[it.id] = (qtyByItem[it.id]||0) + (parseFloat(r.qty)||0);
    });
    const minus = Object.entries(qtyByItem).map(([id,qty]) => {
      const it = items.find(x=>x.id===id);
      return it && teoritisOf(it)-qty<0 ? `${it.nama} menjadi ${num(teoritisOf(it)-qty)} ${it.sat||'kg'}` : '';
    }).filter(Boolean);
    if(minus.length){
      const lanjut = confirm(`PERINGATAN STOK MINUS\n\n${minus.slice(0,6).map(x=>'• '+x).join('\n')}${minus.length>6?`\n• dan ${minus.length-6} barang lainnya`:''}\n\nMutasi tetap boleh disimpan. Sudah diperiksa dan ingin melanjutkan?`);
      if(!lanjut) return;
    }
  }
  const btn = $('impGoBtn'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Menyimpan...';
  try {
    const byItem = {};
    rows.forEach(r => {
      const it = findExact(r.target);
      if(!byItem[it.id]) byItem[it.id] = { it, add: [] };
      byItem[it.id].add.push({ jenis:r.jenis, tanggal:r.tanggal, qty:r.qty, sat:r.sat, pihak:r.pihak, noNota:r.noNota, ref:r.ref });
    });
    for(const id of Object.keys(byItem)){
      const { it, add } = byItem[id];
      await updateDoc(doc(db, COLL, id), { mutasi: [...(it.mutasi||[]), ...add] });
    }
    await auditLog('import_mutasi', { jenis: importJenis, jumlah: rows.length, barang: Object.keys(byItem).length });
    showMsg('impOk', `✔ ${rows.length} mutasi (${importJenis}) disimpan ke ${Object.keys(byItem).length} barang.`, 6000);
    $('impTsv').value='';
    setTimeout(()=>{ $('impPreview').innerHTML=''; importRows=[]; }, 2500);
  } catch(e){
    showMsg('impErr','Gagal menyimpan: '+e.message, 7000);
    btn.disabled = false; btn.textContent = '💾 Coba lagi';
  }
};

// ===================== CAMPUR / PRODUKSI PRODUK =====================
function blankMixRow(){
  return { nama:'', qty:'', sat:'' };
}

function mixRowItem(r){
  return findExact(r.nama);
}

function mixRowNormalized(r){
  const it = mixRowItem(r);
  if(!it) return null;
  const sourceQty = parseId(r.qty);
  const sourceSat = String(r.sat || it.sat || 'kg').trim();
  const normalized = normalizeStockQty(sourceQty, sourceSat, it.sat || sourceSat);
  return {
    it,
    sourceQty,
    sourceSat,
    qty: normalized.qty,
    sat: normalized.sat,
    converted: normalized.converted
  };
}

window.resetMixForm = function(clearMsg=true){
  if($('mixTanggal')) $('mixTanggal').value = todayIso();
  if($('mixNota')) $('mixNota').value = '';
  if($('mixHasil')) $('mixHasil').value = '';
  if($('mixQty')) $('mixQty').value = '';
  mixRows = [blankMixRow(), blankMixRow()];
  if(clearMsg){
    if($('mixErr')) $('mixErr').style.display = 'none';
    if($('mixOk')) $('mixOk').style.display = 'none';
  }
  renderMix();
};

window.addMixRow = function(){
  mixRows.push(blankMixRow());
  renderMix();
};

window.delMixRow = function(i){
  mixRows.splice(i,1);
  if(!mixRows.length) mixRows.push(blankMixRow());
  renderMix();
};

window.mixRowChanged = function(i, field, value){
  if(!mixRows[i]) return;
  mixRows[i][field] = value;
  if(field === 'nama'){
    const it = findExact(value);
    if(it) mixRows[i].sat = it.sat || mixRows[i].sat || 'kg';
  }
  renderMix();
};

window.renderMixSummary = function(){
  if(!$('mixSummary')) return;
  const hasil = findExact($('mixHasil').value);
  const hasilQty = parseId($('mixQty').value);
  const bahan = mixRows.map(mixRowNormalized).filter(Boolean);
  const totalBahan = bahan.reduce((s,r)=>s+(parseFloat(r.qty)||0),0);
  const hasilTxt = hasil && hasilQty>0 ? `${num(hasilQty)} ${hasil.sat||''} ${hasil.nama}` : 'belum lengkap';
  $('mixSummary').innerHTML = `<span>Hasil: <b>${esc(hasilTxt)}</b></span>
    <span>Bahan valid: <b>${bahan.length}</b></span>
    <span>Total qty bahan: <b>${num(totalBahan)}</b></span>`;
  const hint = $('mixHasilHint');
  if(hint) hint.innerHTML = hasil ? `Standar satuan hasil: <b>${esc(hasil.sat||'')}</b> · stok sekarang: <b>${num(teoritisOf(hasil))} ${esc(hasil.sat||'')}</b>` : 'Pilih barang hasil dari daftar stok.';
};

window.renderMix = function(){
  if(!$('mixBody')) return;
  if($('mixTanggal') && !$('mixTanggal').value) $('mixTanggal').value = todayIso();
  $('mixBody').innerHTML = mixRows.map((r,i)=>{
    const it = findExact(r.nama);
    const sat = r.sat || (it ? it.sat : '');
    const available = it ? `${num(teoritisOf(it))} ${esc(it.sat||'')}` : '-';
    return `<tr>
      <td><input class="edit-inp ${it?'ok':'warn'}" list="itemList" value="${esc(r.nama)}" placeholder="Pilih bahan..." oninput="mixRowChanged(${i},'nama',this.value)"></td>
      <td><input class="edit-inp r" inputmode="decimal" value="${esc(r.qty)}" placeholder="0" oninput="mixRowChanged(${i},'qty',this.value)"></td>
      <td><input class="edit-inp" value="${esc(sat)}" placeholder="${esc(it ? (it.sat||'') : 'kg')}" oninput="mixRowChanged(${i},'sat',this.value)"></td>
      <td class="r">${available}</td>
      <td class="r"><button class="icon-btn danger" onclick="delMixRow(${i})">✕</button></td>
    </tr>`;
  }).join('');
  renderMixSummary();
  renderMixHistory();
};

function validateMix(){
  const tanggal = $('mixTanggal').value || todayIso();
  const noNota = $('mixNota').value.trim();
  const hasil = findExact($('mixHasil').value);
  const hasilQty = parseId($('mixQty').value);
  const errors = [];
  if(!validIsoDate(tanggal)) errors.push('Tanggal belum benar.');
  if(!hasil) errors.push('Barang hasil harus dipilih dari daftar stok.');
  if(hasilQty <= 0) errors.push('Jumlah hasil harus lebih dari 0.');

  const rows = mixRows.map((r,i)=>({ ...mixRowNormalized(r), idx:i, raw:r })).filter(r=>r.raw.nama || r.raw.qty);
  const bahan = rows.filter(r=>r.it && r.qty > 0);
  rows.forEach(r => {
    if(!r.it) errors.push(`Baris bahan ${r.idx+1}: barang belum cocok dengan daftar stok.`);
    else if(r.sourceQty <= 0) errors.push(`Baris bahan ${r.idx+1}: qty harus lebih dari 0.`);
  });
  if(!bahan.length) errors.push('Minimal isi 1 bahan campuran.');

  const seen = new Set();
  bahan.forEach(r => {
    if(hasil && r.it.id === hasil.id) errors.push(`Bahan "${r.it.nama}" tidak boleh sama dengan barang hasil.`);
    if(seen.has(r.it.id)) errors.push(`Bahan "${r.it.nama}" dobel. Gabungkan qty-nya dalam satu baris.`);
    seen.add(r.it.id);
  });

  bahan.forEach(r => {
    const tersedia = teoritisOf(r.it);
    if(r.qty - tersedia > 0.000001){
      errors.push(`Stok bahan "${r.it.nama}" tidak cukup. Tersedia ${num(tersedia)} ${r.it.sat||''}, diminta ${num(r.qty)} ${r.sat||''}.`);
    }
  });

  return { tanggal, noNota, hasil, hasilQty, bahan, errors };
}

window.saveMix = async function(){
  if($('mixErr')) $('mixErr').style.display='none';
  if($('mixOk')) $('mixOk').style.display='none';
  const v = validateMix();
  if(v.errors.length){
    showMsg('mixErr', v.errors.join(' '), 9000);
    return;
  }
  const bahanTxt = v.bahan.map(r=>`• ${r.it.nama}: ${num(r.qty)} ${r.sat||''}`).join('\n');
  if(!confirm(`Simpan campuran ini?\n\nHASIL\n• ${v.hasil.nama}: ${num(v.hasilQty)} ${v.hasil.sat||''}\n\nBAHAN KELUAR\n${bahanTxt}`)) return;

  const btn = $('mixSaveBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Menyimpan...';
  try {
    const mixId = `mix-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const noNota = v.noNota || `Campur ${isoToDisp(v.tanggal)}`;
    const batch = writeBatch(db);
    const bahanInfo = v.bahan.map(r=>({ itemId:r.it.id, nama:r.it.nama, qty:r.qty, sat:r.sat, sourceQty:r.sourceQty, sourceSat:r.sourceSat }));

    v.bahan.forEach(r => {
      const mut = {
        jenis:'keluar',
        tanggal:v.tanggal,
        qty:r.qty,
        sat:r.sat,
        pihak:'Campur Produk',
        noNota,
        ref:`${mixId}|bahan|${r.it.id}`,
        mixId,
        mixRole:'bahan',
        mixTargetId:v.hasil.id,
        mixTargetNama:v.hasil.nama
      };
      batch.update(doc(db, COLL, r.it.id), { mutasi:[...(r.it.mutasi||[]), mut] });
    });

    const hasilMut = {
      jenis:'masuk',
      tanggal:v.tanggal,
      qty:v.hasilQty,
      sat:v.hasil.sat || 'kg',
      pihak:'Campur Produk',
      noNota,
      ref:`${mixId}|hasil|${v.hasil.id}`,
      mixId,
      mixRole:'hasil',
      mixBahan:bahanInfo
    };
    batch.update(doc(db, COLL, v.hasil.id), { mutasi:[...(v.hasil.mutasi||[]), hasilMut] });
    await batch.commit();
    await auditLog('campur_produk', { mixId, tanggal:v.tanggal, hasil:{ itemId:v.hasil.id, nama:v.hasil.nama, qty:v.hasilQty, sat:v.hasil.sat }, bahan:bahanInfo, noNota });
    showMsg('mixOk', `✔ Campuran disimpan. ${v.bahan.length} bahan dikurangi dan ${v.hasil.nama} ditambah.`, 7000);
    resetMixForm(false);
  } catch(e){
    showMsg('mixErr','Gagal menyimpan campuran: '+e.message, 9000);
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Simpan campuran';
  }
};

function renderMixHistory(){
  if(!$('mixHistory')) return;
  const grouped = {};
  allMutasi().filter(m=>m.mixId).forEach(m => {
    if(!grouped[m.mixId]) grouped[m.mixId] = { mixId:m.mixId, tanggal:m.tanggal, hasil:null, bahan:[] };
    if(String(m.tanggal||'') > String(grouped[m.mixId].tanggal||'')) grouped[m.mixId].tanggal = m.tanggal;
    if(m.mixRole === 'hasil') grouped[m.mixId].hasil = m;
    if(m.mixRole === 'bahan') grouped[m.mixId].bahan.push(m);
  });
  const list = Object.values(grouped).sort((a,b)=>String(b.tanggal).localeCompare(String(a.tanggal))).slice(0,20);
  $('mixHistory').innerHTML = list.length ? list.map(g => {
    const h = g.hasil;
    const bahan = g.bahan.map(b=>`${esc(b.itemNama)} ${num(b.qty)} ${esc(b.sat||'')}`).join('<br>');
    return `<tr>
      <td>${isoToDisp(g.tanggal)}</td>
      <td>${h ? esc(h.itemNama) : '<span style="color:#aaa">hasil tidak ditemukan</span>'}</td>
      <td style="font-size:11.5px;color:#666">${bahan || '-'}</td>
      <td class="r">${h ? `${num(h.qty)} ${esc(h.sat||'')}` : '-'}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="4" class="empty">Belum ada campuran produk.</td></tr>';
}

// ===================== SEMUA MUTASI (BULK EDIT) =====================
function allMutasi(){
  const arr = [];
  items.forEach(it => (it.mutasi||[]).forEach((m, idx) => {
    arr.push({ itemId: it.id, itemNama: it.nama, idx, ...m });
  }));
  arr.sort((a,b)=>String(b.tanggal).localeCompare(String(a.tanggal)));
  return arr;
}

window.mutFilterChanged = function(){ mutPage = 1; renderMutasi(); };
window.mutResetDate = function(){ $('mutDari').value=''; $('mutSampai').value=''; mutPage=1; renderMutasi(); };
window.mutGoPage = function(p){ mutPage = p; renderMutasi(); };

window.renderMutasi = function(){
  const cari = $('mutCari').value.trim().toLowerCase();
  const fj = $('mutJenis').value;
  const dari = $('mutDari').value;      // '' atau 'yyyy-mm-dd'
  const sampai = $('mutSampai').value;
  let list = allMutasi();
  if(fj) list = list.filter(m => m.jenis === fj);
  if(dari) list = list.filter(m => String(m.tanggal) >= dari);
  if(sampai) list = list.filter(m => String(m.tanggal) <= sampai);
  if(cari) list = list.filter(m =>
    m.itemNama.toLowerCase().includes(cari) ||
    String(m.pihak||'').toLowerCase().includes(cari) ||
    String(m.noNota||'').toLowerCase().includes(cari));

  // ringkasan hasil filter
  const total = list.length;
  const sumMasuk = list.filter(m=>m.jenis==='masuk').reduce((s,m)=>s+(parseFloat(m.qty)||0),0);
  const sumKeluar = list.filter(m=>m.jenis==='keluar').reduce((s,m)=>s+(parseFloat(m.qty)||0),0);
  const rentang = (dari||sampai) ? `${dari?isoToDisp(dari):'awal'} — ${sampai?isoToDisp(sampai):'terakhir'}` : 'semua tanggal';
  $('mutSum').innerHTML = `<span>Rentang: <b>${rentang}</b></span>
    <span>Baris: <b>${total}</b></span>
    <span style="color:#1e7a45">Total masuk: <b>${num(sumMasuk)}</b></span>
    <span style="color:#b7600a">Total keluar: <b>${num(sumKeluar)}</b></span>`;

  const tbody = $('mutBody');
  if(!total){
    tbody.innerHTML = `<tr><td colspan="7" class="empty">${items.some(it=>(it.mutasi||[]).length)?'Tidak ada mutasi yang cocok dengan filter.':'Belum ada mutasi. Import dulu di tab 📋 Import Mutasi.'}</td></tr>`;
    $('mutPager').innerHTML='';
    return;
  }

  // pagination
  const pageSize = parseInt($('mutPageSize').value) || 50;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if(mutPage > totalPages) mutPage = totalPages;
  if(mutPage < 1) mutPage = 1;
  const start = (mutPage-1)*pageSize;
  const pageList = list.slice(start, start + pageSize);

  tbody.innerHTML = pageList.map(m => {
    const key = m.itemId+'#'+m.idx;
    const d = mutDraft[key];
    const jenis = d ? d.jenis : m.jenis;
    const tanggal = d ? d.tanggal : m.tanggal;
    const barang = d ? d.barang : m.itemNama;
    const qty = d ? d.qty : m.qty;
    const pihak = d ? d.pihak : (m.pihak||'');
    const noNota = d ? d.noNota : (m.noNota||'');
    const changed = !!d;
    return `<tr id="mutrow_${key.replace('#','_')}">
      <td><select class="edit-inp" onchange="mutChange('${key}','jenis',this.value)">
        <option value="masuk"${jenis==='masuk'?' selected':''}>Masuk</option>
        <option value="keluar"${jenis==='keluar'?' selected':''}>Keluar</option>
      </select></td>
      <td><input class="edit-inp" type="date" value="${esc(tanggal)}" onchange="mutChange('${key}','tanggal',this.value)"></td>
      <td><input class="edit-inp" list="itemList" value="${esc(barang)}" onchange="mutChange('${key}','barang',this.value)"></td>
      <td><input class="edit-inp r" inputmode="decimal" value="${String(qty).replace('.',',')}" oninput="mutChange('${key}','qty',this.value)"></td>
      <td><input class="edit-inp" value="${esc(pihak)}" oninput="mutChange('${key}','pihak',this.value)"></td>
      <td><input class="edit-inp" value="${esc(noNota)}" oninput="mutChange('${key}','noNota',this.value)"></td>
      <td style="white-space:nowrap">
        <button class="icon-btn" id="mutsave_${key.replace('#','_')}" onclick="mutSave('${m.itemId}',${m.idx})" ${changed?'':'disabled style="opacity:.35"'}>💾</button>
        <button class="icon-btn danger" onclick="mutDel('${m.itemId}',${m.idx})">✕</button>
      </td>
    </tr>`;
  }).join('');

  // pager controls
  if(totalPages <= 1){
    $('mutPager').innerHTML = `<span class="pinfo">Menampilkan semua ${total} baris.</span>`;
  } else {
    const from = start + 1, to = Math.min(start + pageSize, total);
    $('mutPager').innerHTML = `
      <span class="pinfo">Menampilkan <b>${from}–${to}</b> dari <b>${total}</b> baris</span>
      <span style="display:flex;gap:6px;align-items:center">
        <button onclick="mutGoPage(1)" ${mutPage===1?'disabled':''}>« Awal</button>
        <button onclick="mutGoPage(${mutPage-1})" ${mutPage===1?'disabled':''}>‹ Sebelumnya</button>
        <span class="pinfo">Hal. ${mutPage} / ${totalPages}</span>
        <button onclick="mutGoPage(${mutPage+1})" ${mutPage===totalPages?'disabled':''}>Berikutnya ›</button>
        <button onclick="mutGoPage(${totalPages})" ${mutPage===totalPages?'disabled':''}>Akhir »</button>
      </span>`;
  }
};

window.mutChange = function(key, field, val){
  const [itemId, idxS] = key.split('#'); const idx = parseInt(idxS);
  const it = items.find(x=>x.id===itemId); if(!it) return;
  const m = (it.mutasi||[])[idx]; if(!m) return;
  if(!mutDraft[key]) mutDraft[key] = {
    jenis: m.jenis, tanggal: m.tanggal, barang: it.nama,
    qty: m.qty, pihak: m.pihak||'', noNota: m.noNota||''
  };
  mutDraft[key][field] = val;
  const row = $('mutrow_'+key.replace('#','_'));
  if(row) row.querySelectorAll('.edit-inp').forEach(inp=>inp.classList.add('changed'));
  const btn = $('mutsave_'+key.replace('#','_'));
  if(btn){ btn.disabled=false; btn.removeAttribute('style'); }
};

window.mutSave = async function(itemId, idx){
  const key = itemId+'#'+idx;
  const d = mutDraft[key]; if(!d) return;
  const btn = $('mutsave_'+key.replace('#','_'));
  await saveMutationChange(itemId,idx,d,btn);
};

function linkedSaleForMutation(m,itemName){
  if(m.saleId){
    const byId = sales.find(s=>s.id===m.saleId);
    if(byId) return byId;
  }
  if(m.ref){
    const byRef = sales.filter(s=>s.ref===m.ref);
    if(byRef.length===1) return byRef[0];
  }
  if(m.jenis!=='keluar') return null;
  const key = reconciliationKey(m.tanggal,m.pihak,itemName,m.qty);
  const exact = sales.filter(s=>reconciliationKey(s.tanggal,s.pelanggan,s.namaBarang||s.namaNota,s.qty)===key);
  return exact.length===1 ? exact[0] : null;
}

async function saveMutationChange(itemId,idx,d,btn=null){
  const it = items.find(x=>x.id===itemId); if(!it) return;
  const arr = [...(it.mutasi||[])];
  const orig = arr[idx]; if(!orig) return;
  const qty = parseId(d.qty);
  if(qty <= 0){ alert('Qty harus lebih dari 0.'); return; }
  const newM = { ...orig, jenis:d.jenis, tanggal:d.tanggal, qty, pihak:d.pihak.trim(), noNota:d.noNota.trim() };

  const targetNama = d.barang.trim();
  const targetItem = findExact(targetNama);
  if(!targetItem){ alert(`Barang "${targetNama}" tidak ada di daftar stok. Pilih nama yang persis sama dari daftar.`); return; }

  const linkedSale = linkedSaleForMutation(orig,it.nama);
  if(linkedSale && newM.jenis!=='keluar'){
    alert('Mutasi ini terhubung ke penjualan, sehingga jenisnya harus tetap Keluar. Hapus penjualannya lebih dulu jika memang bukan transaksi penjualan.');
    return;
  }
  if(btn){ btn.disabled=true; btn.textContent='…'; }
  try {
    const batch = writeBatch(db);
    if(linkedSale){
      const harga = parseFloat(linkedSale.harga)||0;
      const subtotal = Math.round(qty*harga);
      const hargaMaster = hargaOf(targetItem);
      const ref = makeSaleRef({
        tanggal:newM.tanggal, noNota:newM.noNota, pelanggan:newM.pihak,
        namaRaw:linkedSale.namaNota||targetItem.nama, qty, harga
      });
      newM.ref = ref;
      newM.saleId = linkedSale.id;
      newM.sumber = 'penjualan';
      newM.hargaJual = harga;
      newM.subtotal = subtotal;
      batch.update(doc(db,SALES_COLL,linkedSale.id),{
        tanggal:newM.tanggal, pelanggan:newM.pihak, noNota:newM.noNota,
        itemId:targetItem.id, namaBarang:targetItem.nama, qty,
        subtotal, hargaMaster, selisihHarga:hargaMaster ? harga-hargaMaster : 0,
        ref, stockDeducted:true, updatedAt:serverTimestamp(), updatedBy:userEmail()
      });
      if(linkedSale.importGroupId){
        const imp = saleImports.find(x=>x.id===linkedSale.importGroupId);
        if(imp){
          const currentTotal = imp.totalAktif===undefined ? imp.total : imp.totalAktif;
          batch.update(doc(db,SALES_IMPORT_COLL,linkedSale.importGroupId),{
            totalAktif:Math.max(0,(parseFloat(currentTotal)||0)-(parseFloat(linkedSale.subtotal)||0)+subtotal),
            updatedAt:serverTimestamp()
          });
        }
      }
    }
    if(targetItem.id !== itemId){
      // pindah ke barang lain
      arr.splice(idx,1);
      const tArr = [...(targetItem.mutasi||[]), newM];
      batch.update(doc(db, COLL, itemId), { mutasi: arr });
      batch.update(doc(db, COLL, targetItem.id), { mutasi: tArr });
    } else {
      arr[idx] = newM;
      batch.update(doc(db, COLL, itemId), { mutasi: arr });
    }
    await batch.commit();
    await auditLog('mutasi_edit', {
      dariBarang: it.nama, keBarang: targetItem.nama, jenis: newM.jenis, qty: newM.qty,
      tanggal: newM.tanggal, saleId:linkedSale?linkedSale.id:''
    });
    mutDraft = {}; // index bisa bergeser → reset semua draft, onSnapshot re-render
    if(histMutEdit) closeHistMutEdit();
    if(histDocId) setTimeout(refreshHist,300);
  } catch(e){
    alert('Gagal: '+e.message);
    if(btn){ btn.disabled=false; btn.textContent='💾'; }
  }
}

window.mutDel = async function(itemId, idx){
  await deleteMutation(itemId,idx,'mutasi_hapus');
};

async function deleteMutation(itemId,idx,auditAction){
  const it = items.find(x=>x.id===itemId); if(!it) return;
  const m = (it.mutasi||[])[idx]; if(!m) return;
  const linked = linkedSaleForMutation(m,it.nama);
  const note = linked ? '\n\nLaporan penjualan tetap disimpan, tetapi akan ditandai belum memiliki mutasi stok.' : '';
  if(!confirm(`Hapus mutasi ${m.jenis} ${num(m.qty)} (${it.nama}) tanggal ${isoToDisp(m.tanggal)}?${note}`)) return;
  const arr = (it.mutasi||[]).filter((_,x)=>x!==idx);
  try {
    mutDraft = {};
    const batch=writeBatch(db);
    batch.update(doc(db,COLL,itemId),{mutasi:arr});
    if(linked){
      batch.update(doc(db,SALES_COLL,linked.id),{
        stockDeducted:false, updatedAt:serverTimestamp(), updatedBy:userEmail()
      });
    }
    await batch.commit();
    await auditLog(auditAction,{barang:it.nama,jenis:m.jenis,qty:m.qty,tanggal:m.tanggal,saleId:linked?linked.id:''});
  }
  catch(e){ alert('Gagal: '+e.message); }
}

// ===================== HITUNG FISIK =====================
window.toggleFisBelum = function(){ fisBelumOn = !fisBelumOn; $('fisBelum').classList.toggle('active', fisBelumOn); renderFisik(); };

window.renderFisik = function(){
  let list = filteredItems('fisCari','fisKat', false);
  if(fisBelumOn) list = list.filter(it => !it.fisik);
  const tbody = $('fisikBody');
  if(!list.length){ tbody.innerHTML = `<tr><td colspan="7" class="empty">${items.length?'Tidak ada yang cocok dengan filter.':'Belum ada barang.'}</td></tr>`; return; }
  tbody.innerHTML = list.map(it => {
    const teo = teoritisOf(it);
    const isi = parseFloat(it.isiDrum)||0;
    const draft = fisikDraft[it.id];
    const drum = draft ? draft.drum : (it.fisik ? it.fisik.drum : '');
    const ecer = draft ? draft.eceran : (it.fisik ? it.fisik.eceran : '');
    const kg = (parseId(drum)*isi) + parseId(ecer);
    const has = String(drum).trim()!=='' || String(ecer).trim()!=='';
    const s = has ? Math.round((kg - teo)*100)/100 : null;
    const changed = !!draft;
    return `<tr>
      <td class="nama-cell">${esc(it.nama)}<span class="kat">${esc(it.kat||'')} · ${esc(it.sat||'kg')}${isi>0?' · 1 drum = '+num(isi):''}</span></td>
      <td class="r" style="font-weight:600">${num(teo)}${isi>0?`<span class="drum-note">${drumStr(teo,isi)}</span>`:''}</td>
      <td class="r">${isi>0?`<input class="fis-inp${changed?' changed':''}" inputmode="decimal" value="${drum}" oninput="fisChange('${it.id}','drum',this.value)" placeholder="0">`:'<span class="zero">-</span>'}</td>
      <td class="r"><input class="fis-inp${changed?' changed':''}" style="width:80px" inputmode="decimal" value="${ecer}" oninput="fisChange('${it.id}','eceran',this.value)" placeholder="0"></td>
      <td class="r fis-kg" id="fisKg_${it.id}">${has?num(kg):'-'}</td>
      <td class="r" id="fisSel_${it.id}">${s===null?'<span class="zero">-</span>':`<span class="${s<0?'neg':s>0?'pos':'zero'}">${s>0?'+':''}${num(s)}</span>`}</td>
      <td>
        <button class="icon-btn" id="fisSave_${it.id}" onclick="fisSave('${it.id}')" ${changed?'':'disabled style="opacity:.35"'}>💾 Simpan</button>
      </td>
    </tr>`;
  }).join('');
};

window.fisChange = function(id, f, v){
  const it = items.find(x=>x.id===id); if(!it) return;
  if(!fisikDraft[id]) fisikDraft[id] = {
    drum: it.fisik ? it.fisik.drum : '',
    eceran: it.fisik ? it.fisik.eceran : ''
  };
  fisikDraft[id][f] = v;
  const isi = parseFloat(it.isiDrum)||0;
  const kg = parseId(fisikDraft[id].drum)*isi + parseId(fisikDraft[id].eceran);
  const teo = teoritisOf(it);
  const s = Math.round((kg - teo)*100)/100;
  const kgEl = $('fisKg_'+id); if(kgEl) kgEl.textContent = num(kg);
  const selEl = $('fisSel_'+id); if(selEl) selEl.innerHTML = `<span class="${s<0?'neg':s>0?'pos':'zero'}">${s>0?'+':''}${num(s)}</span>`;
  const btn = $('fisSave_'+id); if(btn){ btn.disabled=false; btn.removeAttribute('style'); }
};

window.fisSave = async function(id){
  const it = items.find(x=>x.id===id); if(!it || !fisikDraft[id]) return;
  const d = fisikDraft[id];
  const fisik = {
    drum: parseId(d.drum), eceran: parseId(d.eceran),
    tanggal: new Date().toISOString().slice(0,10)
  };
  const btn = $('fisSave_'+id); if(btn){ btn.disabled=true; btn.textContent='...'; }
  try {
    await updateDoc(doc(db, COLL, id), { fisik });
    await auditLog('fisik_simpan', { barang: it.nama, fisikKg: fisikKgOf({ ...it, fisik }) });
    delete fisikDraft[id];
  } catch(e){ alert('Gagal: '+e.message); }
};

window.kunciOpname = async function(){
  const dihitung = items.filter(it=>it.fisik);
  if(!dihitung.length){ alert('Belum ada barang yang dihitung fisik.'); return; }
  const belum = items.length - dihitung.length;
  const periodId = 'opname_' + Date.now();
  const msg = `Kunci opname & mulai periode baru?\n\n` +
    `• ${dihitung.length} barang yang SUDAH dihitung → stok awal baru = hasil fisik\n` +
    (belum ? `• ${belum} barang yang BELUM dihitung → stok awal baru = stok teoritis\n` : '') +
    `• Arsip opname akan dibuat dulu di koleksi "${ARCHIVE_COLL}"\n` +
    `• Setelah arsip berhasil, riwayat mutasi & hitungan fisik direset ke 0\n\nTindakan ini besar dan perlu dicek matang.`;
  if(!confirm(msg)) return;
  const typed = prompt('Untuk melanjutkan, ketik: KUNCI');
  if(typed !== 'KUNCI'){ alert('Dibatalkan. Opname belum dikunci.'); return; }
  try {
    let batch = writeBatch(db), n = 0;
    for(const it of items){
      const f = fisikKgOf(it);
      const newAwal = f !== null ? f : teoritisOf(it);
      batch.set(doc(collection(db, ARCHIVE_COLL)), {
        periodId,
        itemId: it.id,
        nama: it.nama || '',
        kat: it.kat || '',
        sat: it.sat || 'kg',
        isiDrum: parseFloat(it.isiDrum)||0,
        harga: hargaOf(it),
        stokAwalLama: parseFloat(it.stokAwal)||0,
        totalMasuk: sumMut(it,'masuk'),
        totalKeluar: sumMut(it,'keluar'),
        teoritis: Math.round(teoritisOf(it)*100)/100,
        fisikKg: f,
        selisih: selisihOf(it),
        stokAwalBaru: Math.round(newAwal*100)/100,
        mutasi: it.mutasi || [],
        fisik: it.fisik || null,
        lockedBy: userEmail(),
        lockedAt: serverTimestamp()
      });
      batch.update(doc(db, COLL, it.id), { stokAwal: Math.round(newAwal*100)/100, mutasi: [], fisik: null });
      n++;
      if(n % 200 === 0){ await batch.commit(); batch = writeBatch(db); }
    }
    await batch.commit();
    await auditLog('opname_kunci', { periodId, totalBarang: items.length, dihitung: dihitung.length, belum });
    fisikDraft = {};
    alert(`✔ Opname dikunci.\nArsip periode: ${periodId}\nPeriode baru dimulai dengan stok awal dari hasil hitung.`);
  } catch(e){ alert('Gagal: '+e.message); }
};

// ===================== COPY STOK TSV =====================
window.copyStok = function(){
  const list = filteredItems('fltCari','fltKat', fltMinusOn);
  if(!list.length){ alert('Tidak ada data untuk dicopy.'); return; }
  const header = ['Nama','Kategori','Sat','Isi/Drum','Harga','Stok Awal','Masuk','Keluar','Teoritis','Teoritis (drum)','Nilai','Fisik','Selisih','Status'].join('\t');
  const rows = list.map(it => {
    const teo = teoritisOf(it), fis = fisikKgOf(it), s = selisihOf(it);
    const isi = parseFloat(it.isiDrum)||0;
    const st = s===null ? 'BELUM' : Math.abs(s)<=0.01 ? 'COCOK' : 'SELISIH';
    const fmtN = v => String(Math.round(v*100)/100).replace('.',',');
    return [it.nama, it.kat||'', it.sat||'kg', isi||'', hargaOf(it)||'', fmtN(it.stokAwal||0),
      fmtN(sumMut(it,'masuk')), fmtN(sumMut(it,'keluar')), fmtN(teo),
      isi>0?drumStr(teo,isi):'', hargaOf(it)>0?Math.round(nilaiOf(it)):'',
      fis===null?'':fmtN(fis), s===null?'':fmtN(s), st].join('\t');
  });
  const tsv = header + '\n' + rows.join('\n');
  navigator.clipboard.writeText(tsv).then(()=>showMsg('stokOk','✔ Berhasil dicopy! Langsung paste (Ctrl+V) di Google Sheet.'))
  .catch(()=>{
    const ta = document.createElement('textarea');
    ta.value = tsv; ta.style.position='fixed'; ta.style.opacity='0';
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
    showMsg('stokOk','✔ Berhasil dicopy!');
  });
};

document.addEventListener('keydown', e=>{ if(e.key==='Escape'){ window.closeHist(); window.closeEdit(); } });

// ===================== INIT =====================
updateJenisSeg();
setTab('dash');
