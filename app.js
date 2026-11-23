import { CLIENT_ID, TOGETHER_URL } from './config.js';
const $ = s => document.querySelector(s);
const sharedMode = typeof location !== 'undefined' && new URLSearchParams(location.search).get('mode') === 'together';
if (typeof TOGETHER_URL !== 'undefined' && TOGETHER_URL) {
  $('#together-link').href = sharedMode ? location.pathname : '?mode=together';
  $('#together-link').textContent = sharedMode ? '← Khu vực cá nhân' : 'Learning Together →';
  $('#together-link').hidden = false;
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const id = () => crypto.randomUUID();
const clone = v => JSON.parse(JSON.stringify(v));
function mergeById(baseItems, local, remote) {
  const b = new Map(baseItems.map(x => [x.id, x])), l = new Map(local.map(x => [x.id, x])), have = new Set(remote.map(x => x.id));
  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y), out = [];
  for (const r of remote) {
    const mine = l.get(r.id), old = b.get(r.id);
    if (mine) out.push(old && same(mine, old) ? r : mine);
    else if (!old) out.push(r);
  }
  for (const mine of local) {
    if (have.has(mine.id)) continue;
    const old = b.get(mine.id);
    if (!old || !same(mine, old)) out.push(mine);
  }
  return out;
}
function mergeProgress(a, b) {
  if (!a || !b) return a || b;
  const words = {...b.words}, days = {...b.days};
  for (const [k, p] of Object.entries(a.words || {})) { const q = words[k]; if (!q || p.correct + p.wrong >= q.correct + q.wrong) words[k] = p; }
  for (const [k, n] of Object.entries(a.days || {})) days[k] = Math.max(n, days[k] || 0);
  const sentences = {...(b.sentences || {})};
  for (const [k, r] of Object.entries(a.sentences || {})) sentences[k] = {...sentences[k], ...r};
  return {...b, words, days, sentences};
}
function mergeData(baseData, local, remote) {
  const remap = new Map(), seen = new Map(), groups = [];
  for (const g of mergeById(baseData.groups, local.groups, remote.groups)) {
    const key = g.name.toLowerCase();
    if (seen.has(key)) remap.set(g.id, seen.get(key)); else { seen.set(key, g.id); groups.push(g); }
  }
  const ids = new Set(groups.map(g => g.id));
  const words = mergeById(baseData.words, local.words, remote.words).map(w => ({...w, groups:[...new Set(w.groups.map(g => remap.get(g) || g))].filter(g => ids.has(g))}));
  const merged = {...remote, groups, words}, progress = mergeProgress(local.progress, remote.progress);
  if (progress) merged.progress = progress;
  return merged;
}
const empty = () => ({version:1, words:[], groups:[]});
let base = empty(), data = empty(), token = '', fileId = '', remoteRevision = '', dirty = false, busy = false, editing = null, questions = [], current = 0, score = 0;
const status = text => $('#status').textContent = text;
let toastTimer = 0;
function notify(text) { const el = $('#toast'); el.textContent = text; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 5000); }
const scope = 'https://www.googleapis.com/auth/drive.appdata';
const rememberKey = 'jp-lea-remember';
const sessionKey = 'jp-lea-session';
$('#remember').checked = localStorage.getItem(rememberKey) !== 'false';
$('#remember').onchange = () => {
  localStorage.setItem(rememberKey, String($('#remember').checked));
  if (!$('#remember').checked) localStorage.removeItem(sessionKey);
};
if (!CLIENT_ID && !sharedMode) $('#setup').hidden = false;
let sharedCall;
if (sharedMode && typeof TOGETHER_URL !== 'undefined' && TOGETHER_URL) {
  const channel = crypto.randomUUID(), pending = new Map();
  let bridge, bridgeOrigin, sequence = 0;
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Không kết nối được Learning Together. Hãy thử tải lại trang.')), 30000);
    window.addEventListener('message', event => {
      const message = event.data;
      if (!message || message.channel !== channel || !/^https:\/\/[a-z0-9-]+\.googleusercontent\.com$/i.test(event.origin)) return;
      if (message.type === 'ready' && !bridge) {
        bridge = event.source; bridgeOrigin = event.origin; clearTimeout(timer); resolve();
      } else if (event.source === bridge && event.origin === bridgeOrigin && message.type === 'result' && pending.has(message.id)) {
        const call = pending.get(message.id); pending.delete(message.id); clearTimeout(call.timer);
        if (message.error) call.reject(new Error(message.error)); else call.resolve(message.value);
      }
    });
    const frame = document.createElement('iframe');
    frame.hidden = true;
    frame.src = TOGETHER_URL + '?bridge=1&channel=' + encodeURIComponent(channel);
    document.body.appendChild(frame);
  });
  sharedCall = async (method, ...args) => {
    await ready;
    return new Promise((resolve, reject) => {
      const requestId = ++sequence;
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('Yêu cầu hết thời gian chờ. Hãy thử lại.')); }, 30000);
      pending.set(requestId, {resolve, reject, timer});
      bridge.postMessage({channel, id:requestId, method, args}, bridgeOrigin);
    });
  };
}
async function api(url, options = {}) {
  const response = await fetch(url, {...options, headers:{Authorization:`Bearer ${token}`, ...options.headers}});
  if (response.status === 401) localStorage.removeItem(sessionKey);
  if (!response.ok) throw new Error(response.status === 401 ? 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.' : `Google Drive báo lỗi ${response.status}.`);
  return response.status === 204 ? null : response.json();
}
async function load() {
  if (sharedMode) {
    if (!sharedCall) throw new Error('Learning Together chưa được cấu hình.');
    const shared = await sharedCall('getSharedData');
    data = shared.data; remoteRevision = shared.revision; base = clone(data); return;
  }
  const found = await api('https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q='+encodeURIComponent("name = 'japanese-study.json' and trashed = false")+'&fields=files(id,version)&pageSize=100');
  if (found.files.length > 1) throw new Error('Có nhiều bản dữ liệu trên Drive. Không thể tự chọn bản an toàn.');
  if (found.files.length) {
    fileId = found.files[0].id; remoteRevision = found.files[0].version;
    const incoming = await api(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
    if (incoming.version !== 1 || !Array.isArray(incoming.words) || !Array.isArray(incoming.groups)) throw new Error('Dữ liệu Drive không đúng định dạng.');
    data = incoming; base = clone(data);
  } else { fileId=''; remoteRevision=''; data=empty(); base=empty(); }
}
async function save() {
  dirty = true; status('Chưa đồng bộ');
  if (busy) return;
  busy = true;
  let merged = false;
  try {
    while (dirty) {
      dirty = false; status(sharedMode ? 'Đang lưu dữ liệu chung…' : 'Đang lưu lên Drive…');
      const snapshot = JSON.stringify(data);
      if (sharedMode) {
        for (let attempt = 0; ; attempt++) {
          try {
            const sent = attempt ? JSON.stringify(data) : snapshot;
            remoteRevision = await sharedCall('saveSharedData', remoteRevision, JSON.parse(sent)); base = JSON.parse(sent); break;
          } catch (e) {
            if (attempt >= 3 || !/đã thay đổi/.test(e.message)) throw e;
            const remote = await sharedCall('getSharedData');
            data = mergeData(base, data, remote.data); base = clone(remote.data); remoteRevision = remote.revision; merged = true; render();
          }
        }
      } else if (fileId) {
        const meta = await api(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=version`);
        let body = snapshot;
        if (meta.version !== remoteRevision) {
          const remote = await api(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
          if (remote.version !== 1 || !Array.isArray(remote.words) || !Array.isArray(remote.groups)) throw new Error('Dữ liệu Drive không đúng định dạng.');
          data = mergeData(base, data, remote); remoteRevision = meta.version; merged = true; render(); body = JSON.stringify(data);
        }
        const saved = await api(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&fields=id,version`, {method:'PATCH',headers:{'Content-Type':'application/json'},body});
        remoteRevision = saved.version; base = JSON.parse(body);
      } else {
        const boundary = 'jpstudyboundary';
        const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({name:'japanese-study.json',parents:['appDataFolder']})}\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${snapshot}\r\n--${boundary}--`;
        const saved = await api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,version', {method:'POST',headers:{'Content-Type':`multipart/related; boundary=${boundary}`},body});
        fileId=saved.id; remoteRevision=saved.version; base=JSON.parse(snapshot);
      }
    }
    status(merged ? (sharedMode ? 'Đã lưu và hợp nhất với thay đổi của người khác' : 'Đã lưu và hợp nhất với thay đổi từ thiết bị khác') : sharedMode ? 'Đã lưu dữ liệu chung' : 'Đã lưu trên Google Drive');
  } catch(e) { dirty=true; status(`Chưa lưu: ${e.message}`); }
  finally { busy=false; $('#retry').hidden=!dirty; }
}
let lastRefresh = Date.now();
async function refresh(manual) {
  if (!sharedMode || !sharedCall) return;
  if (busy || dirty) { if (manual) status('Đang có thay đổi chưa lưu, chưa thể làm mới.'); return; }
  lastRefresh = Date.now();
  if (manual) status('Đang làm mới…');
  try {
    const remote = await sharedCall('getSharedData');
    if (busy || dirty) return;
    if (remote.revision !== remoteRevision) { data = remote.data; remoteRevision = remote.revision; base = clone(data); render(); status('Đã cập nhật thay đổi mới của người khác'); }
    else if (manual) status('Dữ liệu chung đã là bản mới nhất');
  } catch (e) { if (manual) status('Không thể làm mới: ' + e.message); }
}
$('#refresh').onclick = () => refresh(true);
if (sharedMode && typeof document.addEventListener === 'function') document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - lastRefresh > 15000) refresh(false);
});
window.addEventListener('beforeunload', e => { if (dirty || busy || saveTimer) { e.preventDefault(); e.returnValue=''; } });
$('#login').onclick = () => {
  if (!CLIENT_ID) { $('#setup').hidden=false; return; }
  if (!window.google?.accounts?.oauth2) { status('Google chưa tải xong, hãy thử lại.'); return; }
  if (dirty || busy) { notify('Có thay đổi chưa lưu. Hãy tải bản sao dữ liệu trước khi tải lại trang hoặc đổi tài khoản.'); return; }
  google.accounts.oauth2.initTokenClient({client_id:CLIENT_ID,scope,callback:async response => {
    if (response.error) { status('Không thể đăng nhập Google.'); return; }
    localStorage.removeItem(sessionKey);
    token=response.access_token;
    if ($('#remember').checked && response.expires_in > 0) {
      localStorage.setItem(sessionKey, JSON.stringify({token, expires: Date.now() + Number(response.expires_in) * 1000}));
    }
    $('#content').hidden=true; status('Đang tải dữ liệu…');
    try { await load(); dirty=false; render(); localStorage.setItem(rememberKey, String($('#remember').checked)); $('#content').hidden=false; $('#backup').hidden=false; $('#restore').hidden=false; $('#login').textContent='Đổi tài khoản'; status('Đã kết nối Google Drive'); }
    catch(e) { status(e.message); }
  },error_callback:()=>status('Đăng nhập bị hủy hoặc gặp lỗi.')}).requestAccessToken({prompt: token || !$('#remember').checked ? 'select_account' : ''});
};
$('#retry').onclick=save;
$('#backup').onclick=()=>{ const a=document.createElement('a'); const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})); a.href=url; a.download='japanese-study-backup.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); };
$('#restore').onclick=()=>$('#restore-file').click();
$('#restore-file').onchange=async e=>{
  const file=e.target.files[0]; if(!file)return;
  try {
    const incoming=JSON.parse(await file.text());
    if(incoming.version!==1 || !Array.isArray(incoming.words) || !Array.isArray(incoming.groups) || !incoming.groups.every(g=>typeof g.id==='string'&&typeof g.name==='string') || !incoming.words.every(w=>typeof w.id==='string'&&typeof w.japanese==='string'&&typeof w.romaji==='string'&&typeof w.meaning==='string'&&Array.isArray(w.groups)&&w.groups.every(g=>typeof g==='string'))) throw new Error('File không đúng định dạng.');
    if(!confirm('Nhập bản sao sẽ thay thế danh sách từ hiện tại trên Drive'+(incoming.progress?' và cả tiến độ học':' (tiến độ học hiện tại được giữ lại)')+'. Tiếp tục?'))return;
    const oldProgress=data.progress; data=incoming; if(!validStore(incoming.progress)&&validStore(oldProgress)) data.progress=oldProgress; render(); save();
  } catch(err) { notify(`Không thể nhập: ${err.message}`); }
  finally { e.target.value=''; }
};
$('#import-words').onclick=()=>$('#import-words-file').click();
$('#import-words-file').onchange=async e=>{
  const file=e.target.files[0]; if(!file)return;
  try {
    const incoming=JSON.parse(await file.text());
    if(!incoming || incoming.version!==1 || !Array.isArray(incoming.words) || !Array.isArray(incoming.groups) || !incoming.groups.every(g=>g && typeof g.id==='string' && g.id && typeof g.name==='string' && g.name.trim()) || new Set(incoming.groups.map(g=>g.id)).size!==incoming.groups.length || !incoming.words.every(w=>w && typeof w.id==='string' && w.id && typeof w.japanese==='string' && w.japanese.trim() && typeof w.romaji==='string' && w.romaji.trim() && typeof w.meaning==='string' && Array.isArray(w.groups) && w.groups.every(g=>typeof g==='string' && incoming.groups.some(x=>x.id===g)))) throw new Error('File kh\u00f4ng \u0111\u00fang \u0111\u1ecbnh d\u1ea1ng.');
    const groups=[...data.groups], words=[...data.words], groupIds=new Map();
    for(const g of incoming.groups) {
      let existing=groups.find(x=>x.id===g.id && x.name.toLowerCase()===g.name.toLowerCase()) || groups.find(x=>x.name.toLowerCase()===g.name.toLowerCase());
      if(!existing) { existing={...g, id:groups.some(x=>x.id===g.id)?id():g.id}; groups.push(existing); }
      groupIds.set(g.id, existing.id);
    }
    let added=0;
    for(const w of incoming.words) {
      if(words.some(x=>x.id===w.id||wordKey(x)===wordKey(w))) continue;
      words.push({...w, groups:[...new Set(w.groups.map(g=>groupIds.get(g)))]}); added++;
    }
    data={...data,groups,words}; render(); save();
    notify(`Đã thêm ${added} từ; bỏ qua ${incoming.words.length-added} từ đã có (trùng ID hoặc trùng chữ + romaji).`);
  } catch(err) { notify(`Không thể nhập: ${err.message}`); }
  finally { e.target.value=''; }
};
const wordKey=w=>String(w.japanese).normalize('NFC').replace(/\s/g,'')+'|'+String(w.romaji).toLowerCase().replace(/\s/g,'');
function options(selected='') { return '<option value="">Tất cả nhóm</option>'+data.groups.map(g=>`<option value="${esc(g.id)}" ${g.id===selected?'selected':''}>${esc(g.name)}</option>`).join(''); }
function render() {
  const filter=$('#filter-group').value, quiz=$('#quiz-group').value;
  $('#filter-group').innerHTML=options(filter); $('#quiz-group').innerHTML=options(quiz);
  renderWords();
  updateDue();
  $('#group-list').innerHTML=data.groups.length ? data.groups.map(g=>`<div class="row"><div><strong>${esc(g.name)}</strong><p>${data.words.filter(w=>w.groups.includes(g.id)).length} từ</p></div><div class="row-actions"><button data-rename="${esc(g.id)}">Đổi tên</button><button data-delete-group="${esc(g.id)}">Xóa</button></div></div>`).join('') : '<p>Chưa có nhóm nào. Tạo một nhóm để bắt đầu.</p>';
}
const pageSize=20; let wordPage=1;
function renderWords() {
  const q=$('#search').value.trim().toLowerCase(), group=$('#filter-group').value;
  const words=data.words.filter(w=>(!group||w.groups.includes(group))&&[w.japanese,w.romaji,w.meaning].some(x=>x.toLowerCase().includes(q)));
  const pages=Math.max(1,Math.ceil(words.length/pageSize)); wordPage=Math.min(Math.max(1,wordPage),pages);
  const shown=words.slice((wordPage-1)*pageSize,wordPage*pageSize);
  $('#word-list').innerHTML=shown.length ? shown.map(w=>`<div class="row"><div><strong>${esc(w.japanese)}</strong> <span>${esc(w.romaji)}</span><p>${esc(w.meaning || 'Chưa có nghĩa tiếng Việt')}</p><div class="tags">${w.groups.map(g=>esc(data.groups.find(x=>x.id===g)?.name||'')).filter(Boolean).join(' · ')}</div></div><div class="row-actions"><button data-speak="${esc(w.id)}" aria-label="Phát âm ${esc(w.japanese)}">🔊</button><button data-edit="${esc(w.id)}">Sửa</button><button data-delete="${esc(w.id)}">Xóa</button></div></div>`).join('') : '<p>Chưa có từ phù hợp. Hãy thêm từ mới nhé.</p>';
  $('#word-pager').innerHTML=words.length>pageSize ? `<button type="button" class="secondary" data-page="prev" ${wordPage===1?'disabled':''}>← Trước</button><span>Trang ${wordPage}/${pages} · ${words.length} từ</span><button type="button" class="secondary" data-page="next" ${wordPage===pages?'disabled':''}>Sau →</button>` : words.length ? `<span>${words.length} từ</span>` : '';
}
$('#word-pager').onclick=e=>{ const b=e.target.closest('button'); if(!b||b.disabled)return; wordPage+=b.dataset.page==='next'?1:-1; renderWords(); $('#word-list').scrollIntoView?.({block:'start'}); };
function pickVoice() { const ja=speechSynthesis.getVoices().filter(v=>v.lang.toLowerCase().replace('_','-').startsWith('ja')); return ja.find(v=>/google/i.test(v.name))||ja[0]; }
function speak(text, rate=0.9) { if (!('speechSynthesis' in window)) return notify('Trình duyệt không hỗ trợ phát âm.'); const voice=pickVoice(); if (!voice) return notify('Thiết bị chưa có giọng đọc tiếng Nhật.'); const u=new SpeechSynthesisUtterance(text); u.lang='ja-JP'; u.voice=voice; u.rate=rate; speechSynthesis.cancel(); speechSynthesis.speak(u); }
document.querySelector('nav').onclick=e=>{ const b=e.target.closest('[data-tab]'); if(!b)return; document.querySelectorAll('nav button').forEach(x=>{x.classList.toggle('active',x===b); x.setAttribute?.('aria-selected',String(x===b));}); document.querySelectorAll('.panel').forEach(x=>x.hidden=x.id!==b.dataset.tab); if(b.dataset.tab==='stats')renderStats(); if(b.dataset.tab==='quiz')updateDue(); if(b.dataset.tab==='sentences'||b.dataset.tab==='pron')loadSentences().then(updateLevelUI).catch(()=>{}); };
$('#search').oninput=()=>{ wordPage=1; renderWords(); }; $('#filter-group').onchange=()=>{ wordPage=1; renderWords(); };
$('#group-form').onsubmit=e=>{ e.preventDefault(); const name=e.target.elements.name.value.trim(); if(!name)return; if(data.groups.some(g=>g.name.toLowerCase()===name.toLowerCase()))return notify('Tên nhóm đã tồn tại.'); data.groups.push({id:id(),name}); e.target.reset(); render(); save(); };
$('#group-list').onclick=e=>{ const rename=e.target.dataset.rename, del=e.target.dataset.deleteGroup, g=data.groups.find(x=>x.id===(rename||del)); if(!g)return; if(rename){ const name=prompt('Tên nhóm:',g.name)?.trim(); if(!name)return; if(data.groups.some(x=>x.id!==g.id&&x.name.toLowerCase()===name.toLowerCase()))return notify('Tên nhóm đã tồn tại.'); g.name=name; } else { if(!confirm('Xóa nhóm này? Các từ vẫn được giữ lại.'))return; data.groups=data.groups.filter(x=>x.id!==del); data.words.forEach(w=>w.groups=w.groups.filter(x=>x!==del)); } render(); save(); };
function openWord(w) { editing=w?.id||null; const f=$('#word-form'); f.reset(); f.elements.japanese.value=w?.japanese||''; f.elements.romaji.value=w?.romaji||''; f.elements.meaning.value=w?.meaning||''; $('#dialog-title').textContent=w?'Sửa từ':'Thêm từ mới'; $('#word-groups').innerHTML=data.groups.length?data.groups.map(g=>`<label><input type="checkbox" name="group" value="${esc(g.id)}" ${w?.groups.includes(g.id)?'checked':''}>${esc(g.name)}</label>`).join(''):'Chưa có nhóm. Bạn có thể tạo nhóm trước.'; $('#word-dialog').showModal(); }
$('#add-word').onclick=()=>openWord(); $('#cancel').onclick=()=>$('#word-dialog').close();
$('#word-form').onsubmit=e=>{ e.preventDefault(); const f=e.target, japanese=f.elements.japanese.value.trim(), romaji=f.elements.romaji.value.trim(), meaning=f.elements.meaning.value.trim(); if(!japanese||!romaji)return; if(!editing&&data.words.some(w=>wordKey(w)===wordKey({japanese,romaji}))) return notify('Từ này đã có trong danh sách.'); const word={id:editing||id(),japanese,romaji,meaning,groups:[...f.querySelectorAll('[name=group]:checked')].map(x=>x.value)}; if(editing) data.words[data.words.findIndex(w=>w.id===editing)]=word; else data.words.push(word); $('#word-dialog').close(); render(); save(); };
$('#word-list').onclick=e=>{ const b=e.target.closest('button'); if(!b)return; const key=b.dataset.speak||b.dataset.edit||b.dataset.delete, w=data.words.find(x=>x.id===key); if(!w)return; if(b.dataset.speak)speak(w.japanese); else if(b.dataset.edit)openWord(w); else if(confirm(`Xóa từ ${w.japanese}?`)){data.words=data.words.filter(x=>x.id!==key);render();save();} };
const modes={rj:['romaji','japanese'],jr:['japanese','romaji'],jv:['japanese','meaning'],vj:['meaning','japanese']};
function shuffle(a){ for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a; }
const intervals=[0,1,3,7,14,30], progressKey='jp-lea-progress', quizLabels={japanese:'Tiếng Nhật',romaji:'Romaji',meaning:'Tiếng Việt'};
let sharedProgress=null, saveTimer=0;
const today=()=>{ const d=new Date(); return Math.floor((d.getTime()-d.getTimezoneOffset()*6e4)/864e5); };
const validStore=p=>p&&typeof p==='object'&&p.words&&typeof p.words==='object'&&p.days&&typeof p.days==='object';
function store() {
  if (sharedMode) {
    if (!sharedProgress) { try { sharedProgress=JSON.parse(localStorage.getItem(progressKey)); } catch { sharedProgress=null; } if (!validStore(sharedProgress)) sharedProgress={words:{},days:{}}; }
    return sharedProgress;
  }
  if (!validStore(data.progress)) data.progress={words:{},days:{}};
  return data.progress;
}
function persistProgress() {
  if (sharedMode) { try { localStorage.setItem(progressKey,JSON.stringify(sharedProgress)); } catch {} return; }
  status('Chưa đồng bộ'); clearTimeout(saveTimer); saveTimer=setTimeout(()=>{ saveTimer=0; save(); },3000);
}
let lastRec=null;
function undoRecord() {
  if (!lastRec) return; const s=store();
  if (lastRec.old) s.words[lastRec.id]=lastRec.old; else delete s.words[lastRec.id];
  s.days[lastRec.d]=Math.max(0,(s.days[lastRec.d]||1)-1); lastRec=null;
}
function dueCounts() { const s=store(), d=today(); let due=0, fresh=0; for (const w of data.words) { const p=s.words[w.id]; if (!p) fresh++; else if (p.due<=d) due++; } return {due,fresh}; }
function updateDue() {
  const {due,fresh}=dueCounts(), badge=$('#due-badge'), box=$('#due-box');
  badge.hidden=!due; badge.textContent=String(due); box.hidden=!(due+fresh);
  $('#due-text').textContent=`Hôm nay: ${due} từ đến hạn ôn, ${fresh} từ mới chưa học.`;
}
$('#review-now').onclick=()=>{
  const f=$('#quiz-form'), {due,fresh}=dueCounts(), e=f.elements;
  e.scope.value='due'; e.group.value=''; e.format.value='flashcard'; e.mode.value='jv'; e.count.value=String(Math.max(1,Math.min(20,due+fresh)));
  f.requestSubmit ? f.requestSubmit() : f.onsubmit({preventDefault(){},target:f});
};
function record(word, correct) {
  const s=store(), old=s.words[word.id], p=old?{...old}:{box:0,due:0,correct:0,wrong:0}, d=today();
  lastRec={id:word.id,old:old?{...old}:null,d};
  if (correct) { p.correct++; p.box=Math.min(p.box+1,intervals.length-1); p.due=d+intervals[p.box]; }
  else { p.wrong++; p.box=0; p.due=d; }
  s.words[word.id]=p; s.days[d]=(s.days[d]||0)+1; persistProgress(); updateDue();
}
const fold=(text,to)=>to==='japanese' ? String(text).normalize('NFC').replace(/\s/g,'') : String(text).normalize('NFD').replace(/\p{M}/gu,'').replace(/đ/gi,'d').toLowerCase().replace(/[\s'’\-.,!?]/g,'');
const acceptable=(text,to)=>{ const t=String(text), parts=to==='meaning'?t.split(/[,;\/、]/):[]; return [...new Set([t,...parts].flatMap(x=>[x,x.replace(/[(（].*?[)）]/g,'')]).map(x=>fold(x,to)).filter(Boolean))]; };
function buildQuestions(f) {
  const group=f.elements.group.value, mode=f.elements.mode.value, count=Number(f.elements.count.value), format=f.elements.format.value, scope=f.elements.scope.value, d=today(), s=store();
  const groupPool=data.words.filter(w=>!group||w.groups.includes(group));
  const pool=groupPool.filter(w=>{ const p=s.words[w.id]; return scope==='due' ? !p||p.due<=d : scope==='weak' ? p&&p.wrong>0&&p.box<3 : true; });
  let candidates=[];
  for (const [key,[from,to]] of Object.entries(modes)) {
    if (mode!=='mixed'&&mode!==key) continue;
    for (const w of pool) {
      if (!w[from]||!w[to]) continue;
      if (format!=='choice') { candidates.push({word:w,from,to,format}); continue; }
      const answers=[...new Set(groupPool.filter(x=>x[from]&&x[to]).map(x=>x[to]))].filter(x=>x!==w[to]);
      if (answers.length<1) continue;
      candidates.push({word:w,from,to,format,choices:shuffle([w[to],...shuffle(answers).slice(0,3)])});
    }
  }
  candidates=shuffle(candidates);
  if (scope!=='all') { const seen=new Set(); candidates=candidates.filter(q=>!seen.has(q.word.id)&&seen.add(q.word.id)); }
  if (scope==='weak') candidates.sort((a,b)=>(s.words[b.word.id]?.wrong||0)-(s.words[a.word.id]?.wrong||0));
  return candidates.slice(0,count);
}
$('#quiz-form').onsubmit=e=>{ e.preventDefault(); questions=buildQuestions(e.target); current=0; score=0; if(!questions.length){$('#quiz-play').innerHTML='<p>Không có câu hỏi phù hợp. Hãy đổi nguồn từ, nhóm hoặc hình thức, hoặc thêm từ và nghĩa (trắc nghiệm cần ít nhất 2 đáp án khác nhau).</p>';return;} showQuestion(); };
function quizHeader(q) { return `<p>Câu ${current+1}/${questions.length} · ${quizLabels[q.from]} → ${quizLabels[q.to]}</p><h2>${esc(q.word[q.from])}</h2><button class="secondary" id="quiz-speak" type="button" ${q.to==='japanese'?'hidden':''}>🔊 Phát âm</button>`; }
function showAnswer(q, correct, near) {
  const speak=$('#quiz-speak'); if (speak) speak.hidden=false;
  const extra=correct?'':(near?'<p class="near">Gần đúng, có thể bạn chỉ gõ sai chính tả.</p>':'')+'<button type="button" class="secondary" id="override">Tôi đã đúng</button> ';
  $('#answer').innerHTML=`<p class="feedback ${correct?'correct':'incorrect'}">${correct?'Chính xác!':'Chưa đúng. Đáp án: '+esc(q.word[q.to])}</p>${extra}<button id="next">${current+1===questions.length?'Xem kết quả':'Câu tiếp theo'}</button>`;
  $('#next').onclick=()=>{ current++; showQuestion(); }; $('#next').focus();
  const ov=$('#override'); if (ov) ov.onclick=()=>{ undoRecord(); record(q.word,true); score++; showAnswer(q,true,false); };
}
function answered(q, correct, near) { record(q.word, correct); if (correct) score++; showAnswer(q, correct, near); }
function showTyping(q) {
  $('#quiz-play').innerHTML=quizHeader(q)+'<form id="typing-form" autocomplete="off"><input name="answer" aria-label="Câu trả lời" placeholder="Gõ đáp án" required><button>Kiểm tra</button></form><div id="answer"></div>';
  $('#quiz-speak').onclick=()=>speak(q.word.japanese);
  const form=$('#typing-form'); form.elements.answer.focus();
  form.onsubmit=ev=>{ ev.preventDefault(); const input=form.elements.answer; input.disabled=true; form.querySelector('button').disabled=true; const typed=fold(input.value,q.to), accepted=acceptable(q.word[q.to],q.to), ok=accepted.includes(typed); answered(q, ok, !ok&&accepted.some(a=>similarity(typed,a)>=0.75)); };
}
function showFlash(q) {
  $('#quiz-play').innerHTML=quizHeader(q)+'<div id="answer"><button id="flip">Lật thẻ</button></div>';
  $('#quiz-speak').onclick=()=>speak(q.word.japanese);
  $('#flip').onclick=()=>{
    $('#quiz-speak').hidden=false;
    $('#answer').innerHTML=`<h2 class="flash-back">${esc(q.word[q.to])}</h2><div class="actions"><button class="secondary" id="forgot">Chưa nhớ</button><button id="knew">Đã nhớ</button></div>`;
    const rate=ok=>{ record(q.word,ok); if (ok) score++; current++; showQuestion(); };
    $('#forgot').onclick=()=>rate(false); $('#knew').onclick=()=>rate(true);
  };
}
function streak(days) { let d=today(), n=0; if (!days[d]) d--; while (days[d]) { n++; d--; } return n; }
function renderStats() {
  const s=store(), d=today(), entries=data.words.map(w=>({w,p:s.words[w.id]}));
  const seen=entries.filter(x=>x.p), total=seen.reduce((n,x)=>n+x.p.correct+x.p.wrong,0), right=seen.reduce((n,x)=>n+x.p.correct,0);
  const lv=levelStats(), tiles=[...(lv.length?[['Câu mẫu đã thuộc',lv.reduce((n,x)=>n+x.known,0)+'/'+lv.reduce((n,x)=>n+x.total,0)]]:[]),['Tổng số từ',data.words.length],['Chưa học',entries.length-seen.length],['Đang học',seen.filter(x=>x.p.box<3).length],['Đã thuộc',seen.filter(x=>x.p.box>=3).length],['Đến hạn ôn hôm nay',seen.filter(x=>x.p.due<=d).length],['Chuỗi ngày học',streak(s.days)],['Số lượt trả lời hôm nay',s.days[d]||0],['Tỉ lệ đúng',total?Math.round(right/total*100)+'%':'–']];
  const weak=seen.filter(x=>x.p.wrong>0).sort((a,b)=>b.p.wrong-a.p.wrong).slice(0,10);
  $('#stats-note').textContent=sharedMode?'Tiến độ học chỉ lưu trên thiết bị này, không chia sẻ với người khác.':'Tiến độ học được lưu cùng dữ liệu trên Google Drive của bạn.';
  $('#stats-body').innerHTML=`<div class="stat-grid">${tiles.map(([k,v])=>`<div class="stat"><strong>${v}</strong><span>${k}</span></div>`).join('')}</div><h3>Từ hay sai</h3>`+(weak.length?weak.map(x=>`<div class="row"><div><strong>${esc(x.w.japanese)}</strong> <span>${esc(x.w.romaji)}</span><p>${esc(x.w.meaning)}</p></div><div>Sai ${x.p.wrong} · Đúng ${x.p.correct}</div></div>`).join(''):'<p>Chưa có từ nào bị sai.</p>');
}
function markActivity() { const s=store(), d=today(); s.days[d]=(s.days[d]||0)+1; persistProgress(); }
const levelNames={1:'Dễ',2:'Vừa',3:'Khó'}, decoyCount={1:1,2:2,3:3};
const levelOf=x=>x.level||1;
const dirNames={vj:'Việt → Nhật',jv:'Nhật → Việt',mix:'Xen kẽ cả hai'};
function sentenceKnown(x, dir='mix') { const r=store().sentences?.[x.id]; return dir==='mix' ? r?.vj===true&&r?.jv===true : r?.[dir]===true; }
function levelStats(dir='mix') { return [1,2,3].map(l=>{ const list=(sentenceBank||[]).filter(x=>levelOf(x)===l); return {level:l,total:list.length,known:list.filter(x=>sentenceKnown(x,dir)).length}; }).filter(x=>x.total); }
function pickSentences(level, count, dir='vj') {
  const list=(sentenceBank||[]).filter(x=>!level||levelOf(x)===level);
  return shuffle(list).sort((a,b)=>sentenceKnown(a,dir)-sentenceKnown(b,dir)||levelOf(a)-levelOf(b)).slice(0,count);
}
function updateLevelUI() {
  const sf=$('#sentence-form').elements, dir=sf?.dir?.value||'vj', stats=levelStats(dir); if (!stats.length) return;
  const suggest=(stats.find(x=>x.known/x.total<0.8)||stats[stats.length-1]).level;
  const fill=(select, label)=>{
    if (!select) return;
    const chosen=select.dataset?.touched ? select.value : String(suggest);
    select.innerHTML=`<option value="0">Tất cả mức</option>`+stats.map(x=>`<option value="${x.level}">${levelNames[x.level]} (${label(x)})</option>`).join('');
    select.value=chosen; select.onchange=()=>{ select.dataset.touched='1'; };
  };
  fill(sf?.level, x=>`${x.known}/${x.total} câu đã thuộc`);
  fill($('#pron-form').elements?.level, x=>`${x.total} câu`);
  if (sf?.dir) sf.dir.onchange=updateLevelUI;
  $('#level-hint').textContent=`Gợi ý: nên luyện mức ${levelNames[suggest]} trước. Mức "Dễ" dùng câu ngắn, ít thẻ gây nhiễu; mức "Khó" có câu dài, phủ định và nhiều trợ từ.`;
}
let sentenceBank=null, sentenceSet=[], sentenceDirs=[], sIndex=0, sScore=0, sState=null;
async function loadSentences() {
  if (sentenceBank) return sentenceBank;
  const response=await fetch('sentences.json');
  if (!response.ok) throw new Error('Không tải được danh sách câu mẫu.');
  const json=await response.json();
  if (!Array.isArray(json.sentences)||!json.sentences.length) throw new Error('Danh sách câu mẫu không hợp lệ.');
  if (!json.sentences.every(x=>Array.isArray(x.tokens)&&x.tokens.length&&Array.isArray(x.viTokens)&&x.viTokens.length)) throw new Error('Danh sách câu mẫu không hợp lệ.');
  sentenceBank=json.sentences; updateLevelUI(); return sentenceBank;
}
$('#sentence-form').onsubmit=async e=>{
  e.preventDefault(); const f=e.target.elements, count=Number(f.count.value), dir=f.dir?.value||'vj';
  try {
    await loadSentences(); sentenceSet=pickSentences(Number(f.level?.value)||0,count,dir); sIndex=0; sScore=0;
    sentenceDirs=sentenceSet.map(x=>{ if (dir!=='mix') return dir; const open=['vj','jv'].filter(d=>!sentenceKnown(x,d)), pool=open.length?open:['vj','jv']; return pool[Math.floor(Math.random()*pool.length)]; });
    showSentence();
  } catch (err) { $('#sentence-play').innerHTML=`<p>${esc(err.message)}</p>`; }
};
const sentenceTokens=(x,dir)=>dir==='jv'?x.viTokens:x.tokens;
const sentenceText=(tokens,dir)=>dir==='jv'?tokens.join(' ').toLowerCase():tokens.join('');
function showSentence() {
  if (sIndex>=sentenceSet.length) { $('#sentence-play').innerHTML=`<h3>Hoàn thành! 🎉</h3><p>Bạn ghép đúng ${sScore}/${sentenceSet.length} câu.</p><p>Chọn số câu và bắt đầu để luyện thêm.</p>`; return; }
  const s=sentenceSet[sIndex], dir=sentenceDirs[sIndex]||'vj', own=sentenceTokens(s,dir), ownKeys=new Set(own.map(t=>t.toLowerCase())), seen=new Set();
  const pool=sentenceBank.flatMap(x=>sentenceTokens(x,dir)).filter(t=>{ const k=t.toLowerCase(); if (ownKeys.has(k)||seen.has(k)) return false; seen.add(k); return true; });
  const decoys=shuffle(pool).slice(0,decoyCount[levelOf(s)]||2);
  sState={s, dir, chips:shuffle([...own,...decoys].map((t,i)=>({t,i}))), chosen:[], checked:false};
  drawSentence();
}
function drawSentence() {
  const st=sState, text=i=>st.chips.find(c=>c.i===i).t, bank=st.chips.filter(c=>!st.chosen.includes(c.i));
  const chip=(i,zone)=>`<button type="button" class="chip" data-chip="${i}" data-zone="${zone}" ${st.checked?'disabled':'draggable="true"'}>${esc(text(i))}</button>`;
  const prompt=st.dir==='jv' ? `<h2>${esc(st.s.tokens.join(' '))}</h2><p>${esc(st.s.romaji)}</p><button type="button" class="secondary" data-say="1">🔊 Nghe</button> <button type="button" class="secondary" data-say="1" data-rate="0.6">🐢 Chậm</button>` : `<h2>${esc(st.s.vi)}</h2>`;
  $('#sentence-play').innerHTML=`<p>Câu ${sIndex+1}/${sentenceSet.length} · Dịch sang tiếng ${st.dir==='jv'?'Việt':'Nhật'}</p>${prompt}<div class="sentence-answer" aria-label="Câu của bạn">${st.chosen.map(i=>chip(i,'answer')).join('')}</div><div class="sentence-bank">${bank.map(c=>chip(c.i,'bank')).join('')}</div><div id="sentence-result"></div><div class="actions"><button type="button" class="secondary" id="sentence-clear" ${st.chosen.length&&!st.checked?'':'disabled'}>Xóa hết</button><button type="button" class="secondary" id="sentence-hint" ${st.checked?'disabled':''}>💡 Gợi ý</button><button type="button" id="sentence-check" ${st.chosen.length&&!st.checked?'':'disabled'}>Kiểm tra</button></div>`;
}
function hintSentence(st) {
  const want=sentenceTokens(st.s,st.dir), norm=t=>st.dir==='jv'?t.toLowerCase():t, text=i=>st.chips.find(c=>c.i===i).t;
  let n=0; while (n<st.chosen.length&&n<want.length&&norm(text(st.chosen[n]))===norm(want[n])) n++;
  st.chosen=st.chosen.slice(0,n); if (n>=want.length) return;
  const chip=st.chips.find(c=>!st.chosen.includes(c.i)&&norm(c.t)===norm(want[n]));
  if (chip) { st.chosen.push(chip.i); st.hinted=true; }
}
const dropZone=e=>e.target.closest?.('.sentence-answer,.sentence-bank');
$('#sentence-play').ondragstart=e=>{ const c=e.target.closest?.('[data-chip]'); if (!c||!sState||sState.checked) return; e.dataTransfer.setData('text/plain',c.dataset.chip); e.dataTransfer.effectAllowed='move'; };
$('#sentence-play').ondragover=e=>{ if (dropZone(e)) e.preventDefault(); };
$('#sentence-play').ondrop=e=>{
  const zone=dropZone(e), st=sState, raw=e.dataTransfer?.getData('text/plain'); if (!zone||!st||st.checked||!raw) return; e.preventDefault();
  const i=Number(raw); if (!st.chips.some(c=>c.i===i)) return;
  st.chosen=st.chosen.filter(x=>x!==i);
  if (zone.classList.contains('sentence-answer')) {
    const target=e.target.closest('[data-chip]'), at=target&&target.dataset.zone==='answer'?st.chosen.indexOf(Number(target.dataset.chip)):-1;
    if (at>=0) st.chosen.splice(at,0,i); else st.chosen.push(i);
  }
  drawSentence();
};
$('#sentence-play').onclick=e=>{
  const st=sState, b=e.target.closest('button'); if (!st||!b) return;
  if (b.dataset.say) return speak(st.s.tokens.join(''), Number(b.dataset.rate)||0.9);
  if (b.id==='sentence-next') { sIndex++; return showSentence(); }
  if (st.checked) return;
  if (b.id==='sentence-clear') { st.chosen=[]; return drawSentence(); }
  if (b.id==='sentence-hint') { hintSentence(st); return drawSentence(); }
  if (b.dataset.chip!==undefined) {
    const i=Number(b.dataset.chip);
    st.chosen = b.dataset.zone==='bank' ? [...st.chosen,i] : st.chosen.filter(x=>x!==i); drawSentence();
  } else if (b.id==='sentence-check') {
    st.checked=true; const answer=sentenceText(st.chosen.map(i=>st.chips.find(c=>c.i===i).t),st.dir), ok=answer===sentenceText(sentenceTokens(st.s,st.dir),st.dir);
    const credit=ok&&!st.hinted; if (credit) sScore++; const records=(store().sentences ||= {}); records[st.s.id]={...records[st.s.id],[st.dir]:credit}; markActivity(); drawSentence();
    const shown=st.dir==='jv' ? `<strong>${esc(st.s.vi)}</strong>` : `<strong>${esc(st.s.tokens.join(' '))}</strong><br>${esc(st.s.romaji)}`;
    $('#sentence-result').innerHTML=`<p class="feedback ${ok?'correct':'incorrect'}">${ok?'Chính xác!':'Chưa đúng.'}</p>${ok&&st.hinted?'<p>Bạn đã dùng gợi ý nên câu này chưa được tính là thuộc.</p>':''}<p>${shown}</p>${st.dir==='jv'?'':'<button type="button" class="secondary" data-say="1">🔊 Nghe</button> <button type="button" class="secondary" data-say="1" data-rate="0.6">🐢 Chậm</button> '}<button type="button" id="sentence-next">${sIndex+1===sentenceSet.length?'Xem kết quả':'Câu tiếp theo'}</button>`;
  }
};
const speechNorm=t=>String(t).normalize('NFC').replace(/[\s、。，．,.?？!！「」]/g,'');
function similarity(a, b) {
  const x=[...speechNorm(a)], y=[...speechNorm(b)]; if (!x.length||!y.length) return 0;
  let prev=Array.from({length:y.length+1},(_,i)=>i);
  for (let i=1;i<=x.length;i++) { const cur=[i]; for (let j=1;j<=y.length;j++) cur[j]=Math.min(prev[j]+1,cur[j-1]+1,prev[j-1]+(x[i-1]===y[j-1]?0:1)); prev=cur; }
  return 1-prev[y.length]/Math.max(x.length,y.length);
}
const pronScore=(heard, targets)=>Math.max(0,...heard.flatMap(h=>targets.map(t=>similarity(h,t))));
let pron=null;
$('#pron-form').onsubmit=async e=>{
  e.preventDefault(); const f=e.target.elements, count=Number(f.count.value);
  try {
    let items;
    if (f.source.value==='tokens') {
      const lv=Number(f.level?.value)||0, seen=new Set(); items=[];
      for (const x of (await loadSentences()).filter(x=>!lv||levelOf(x)===lv)) x.tokens.forEach((t,k)=>{
        if ([...t].length<2||seen.has(t)) return; seen.add(t);
        items.push({text:t,targets:[...new Set([t,x.tokenJa?.[k]].filter(Boolean))],romaji:x.tokenRomaji?.[k]||'',vi:''});
      });
    } else if (f.source.value==='sentences') { const lv=Number(f.level?.value)||0; items=(await loadSentences()).filter(x=>!lv||levelOf(x)===lv).map(x=>({text:x.tokens.join(''),targets:[x.tokens.join(''),x.ja].filter(Boolean),romaji:x.romaji,vi:x.vi})); }
    else items=data.words.filter(w=>w.japanese).map(w=>({text:w.japanese,targets:[w.japanese],romaji:w.romaji,vi:w.meaning}));
    if (!items.length) { $('#pron-play').innerHTML='<p>Chưa có nội dung để luyện. Hãy thêm từ vựng trước.</p>'; return; }
    pron={items:shuffle(items).slice(0,count),i:0,ok:0,busy:false}; showPron();
  } catch (err) { $('#pron-play').innerHTML=`<p>${esc(err.message)}</p>`; }
};
function showPron() {
  if (pron.i>=pron.items.length) { $('#pron-play').innerHTML=`<h3>Hoàn thành! 🎉</h3><p>Bạn phát âm tốt ${pron.ok}/${pron.items.length} mục.</p>`; return; }
  const it=pron.items[pron.i];
  $('#pron-play').innerHTML=`<p>Mục ${pron.i+1}/${pron.items.length}</p><h2>${esc(it.text)}</h2><p>${esc(it.romaji)}${it.vi?' · '+esc(it.vi):''}</p><div class="actions"><button type="button" class="secondary" data-pron="say">🔊 Nghe</button><button type="button" class="secondary" data-pron="slow">🐢 Chậm</button><button type="button" id="pron-mic" data-pron="mic">🎤 Nói</button></div><div id="pron-result" aria-live="polite"></div>`;
}
$('#pron-play').onclick=e=>{
  const b=e.target.closest('button'); if (!b||!pron) return; const it=pron.items[pron.i], kind=b.dataset.pron;
  if (kind==='say') speak(it.text); else if (kind==='slow') speak(it.text,0.6);
  else if (kind==='next') { pron.i++; showPron(); }
  else if (kind==='mic') listen(it);
};
function listen(it) {
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition, out=$('#pron-result');
  if (!SR) { out.innerHTML='<p class="feedback incorrect">Trình duyệt này chưa hỗ trợ nhận diện giọng nói. Hãy dùng Chrome hoặc Edge.</p>'; return; }
  if (pron.busy) return;
  const r=new SR(); r.lang='ja-JP'; r.interimResults=false; r.maxAlternatives=3; pron.busy=true;
  out.innerHTML='<p>Đang nghe… hãy nói bằng tiếng Nhật.</p>'; $('#pron-mic').disabled=true;
  let handled=false;
  const finish=html=>{ pron.busy=false; const mic=$('#pron-mic'); if (mic) mic.disabled=false; out.innerHTML=html; };
  r.onresult=ev=>{
    handled=true; const heard=[...ev.results[0]].map(a=>a.transcript), score=pronScore(heard,it.targets), pct=Math.round(score*100), good=score>=0.8;
    if (good) pron.ok++; markActivity();
    finish(`<p>Bạn nói: <strong>${esc(heard[0])}</strong></p><p class="feedback ${good?'correct':'incorrect'}">${good?'Rất tốt!':score>=0.5?'Gần đúng, thử lại nhé.':'Chưa đúng, hãy nghe lại và thử lần nữa.'} (${pct}%)</p><button type="button" class="secondary" data-pron="mic">Thử lại</button> <button type="button" data-pron="next">${pron.i+1===pron.items.length?'Xem kết quả':'Mục tiếp theo'}</button>`);
  };
  r.onerror=ev=>{ handled=true; finish(`<p class="feedback incorrect">${ev.error==='not-allowed'||ev.error==='service-not-allowed'?'Hãy cho phép trình duyệt dùng micro.':ev.error==='no-speech'?'Không nghe thấy giọng nói, thử lại nhé.':'Không nhận diện được: '+esc(ev.error)}</p><button type="button" data-pron="mic">Thử lại</button>`); };
  r.onend=()=>{ if (!handled) finish('<p class="feedback incorrect">Không nghe thấy giọng nói, thử lại nhé.</p><button type="button" data-pron="mic">Thử lại</button>'); };
  try { r.start(); } catch { finish('<p class="feedback incorrect">Không thể bật micro.</p>'); }
}
if (typeof document.addEventListener === 'function') document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
  const tag = e.target?.tagName || ''; if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
  const press = sel => { const el = document.querySelector(sel); if (el && !el.disabled) { e.preventDefault(); el.click(); return true; } return false; };
  if (!$('#quiz').hidden) {
    if (/^[1-9]$/.test(e.key)) {
      if (press(`#quiz-play [data-choice="${Number(e.key) - 1}"]`)) return;
      if (e.key === '1') press('#forgot'); else if (e.key === '2') press('#knew');
    } else if (e.key === 'Enter' && tag !== 'BUTTON') press('#next') || press('#flip');
  } else if (!$('#sentences').hidden && e.key === 'Enter' && tag !== 'BUTTON') press('#sentence-next') || press('#sentence-check');
});
function showQuestion() {
  if (current >= questions.length) {
    $('#quiz-play').innerHTML = `<h3>Hoàn thành! 🎉</h3><p>Bạn trả lời đúng/nhớ được ${score}/${questions.length} câu.</p><p>Chọn lại cài đặt và bắt đầu để luyện thêm.</p>`;
    return;
  }
  const q = questions[current], labels = {japanese:'Tiếng Nhật', romaji:'Romaji', meaning:'Tiếng Việt'};
  if (q.format === 'typing') return showTyping(q);
  if (q.format === 'flashcard') return showFlash(q);
  const choices = q.choices.map((x, i) => `<button class="choice" data-choice="${i}"><span class="kbd">${i + 1}</span>${esc(x)}</button>`).join('');
  $('#quiz-play').innerHTML = `<p>Câu ${current + 1}/${questions.length} · ${labels[q.from]} → ${labels[q.to]}</p><h2>${esc(q.word[q.from])}</h2><button class="secondary" id="quiz-speak" ${q.to === 'japanese' ? 'hidden' : ''}>🔊 Phát âm</button><div>${choices}</div><div id="answer"></div>`;
  $('#quiz-speak').onclick = () => speak(q.word.japanese);
  const buttons = $('#quiz-play').querySelectorAll('[data-choice]');
  buttons.forEach(b => b.onclick = () => {
    const correct = q.choices[Number(b.dataset.choice)] === q.word[q.to];
    if (correct) score++;
    record(q.word, correct);
    buttons.forEach(x => {
      x.disabled = true;
      if (q.choices[Number(x.dataset.choice)] === q.word[q.to]) x.classList.add('correct');
      else if (x === b) x.classList.add('incorrect');
    });
    $('#quiz-speak').hidden = false;
    $('#answer').innerHTML = `<p class="feedback ${correct ? 'correct' : 'incorrect'}">${correct ? 'Chính xác!' : 'Chưa đúng. Đáp án: ' + esc(q.word[q.to])}</p><button id="next">${current + 1 === questions.length ? 'Xem kết quả' : 'Câu tiếp theo'}</button>`;
    $('#next').onclick = () => { current++; showQuestion(); };
    $('#next').focus?.();
  });
}



async function restoreSession() {
  if (!CLIENT_ID || !$('#remember').checked) return;
  let saved;
  try { saved = JSON.parse(localStorage.getItem(sessionKey)); } catch { localStorage.removeItem(sessionKey); return; }
  if (!saved || typeof saved.token !== 'string' || !Number.isFinite(saved.expires) || saved.expires <= Date.now()) {
    localStorage.removeItem(sessionKey);
    return;
  }
  token = saved.token;
  status('Đang tải dữ liệu…');
  try {
    await load();
    render();
    $('#content').hidden = false;
    $('#backup').hidden = false;
    $('#restore').hidden = false;
    $('#login').textContent = 'Đổi tài khoản';
    status('Đã kết nối Google Drive');
  } catch (e) {
    token = '';
    status(e.message);
  }
}
if (sharedMode) {
  $('#login').hidden = true;
  $('#remember-label').hidden = true;
  $('#storage-note').textContent = 'Dữ liệu chung được lưu trong Google Sheets.';
  status('Đang tải dữ liệu chung…');
  load().then(() => {
    render(); $('#content').hidden = false; $('#backup').hidden = false; $('#refresh').hidden = false;
    status('Đã kết nối Learning Together');
  }).catch(e => status('Không thể tải dữ liệu chung: ' + e.message));
} else restoreSession();
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof location !== 'undefined' && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
