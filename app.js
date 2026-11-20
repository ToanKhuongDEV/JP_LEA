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
function mergeData(baseData, local, remote) {
  const remap = new Map(), seen = new Map(), groups = [];
  for (const g of mergeById(baseData.groups, local.groups, remote.groups)) {
    const key = g.name.toLowerCase();
    if (seen.has(key)) remap.set(g.id, seen.get(key)); else { seen.set(key, g.id); groups.push(g); }
  }
  const ids = new Set(groups.map(g => g.id));
  const words = mergeById(baseData.words, local.words, remote.words).map(w => ({...w, groups:[...new Set(w.groups.map(g => remap.get(g) || g))].filter(g => ids.has(g))}));
  return {...remote, groups, words};
}
const empty = () => ({version:1, words:[], groups:[]});
let base = empty(), data = empty(), token = '', fileId = '', remoteRevision = '', dirty = false, busy = false, editing = null, questions = [], current = 0, score = 0;
const status = text => $('#status').textContent = text;
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
    data = incoming;
  } else { fileId=''; remoteRevision=''; data=empty(); }
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
        if (meta.version !== remoteRevision) throw new Error('Dữ liệu trên Drive đã thay đổi ở thiết bị khác. Hãy tải lại trang trước khi sửa tiếp.');
        const saved = await api(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&fields=id,version`, {method:'PATCH',headers:{'Content-Type':'application/json'},body:snapshot});
        remoteRevision = saved.version;
      } else {
        const boundary = 'jpstudyboundary';
        const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({name:'japanese-study.json',parents:['appDataFolder']})}\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${snapshot}\r\n--${boundary}--`;
        const saved = await api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,version', {method:'POST',headers:{'Content-Type':`multipart/related; boundary=${boundary}`},body});
        fileId=saved.id; remoteRevision=saved.version;
      }
    }
    status(sharedMode ? (merged ? 'Đã lưu và hợp nhất với thay đổi của người khác' : 'Đã lưu dữ liệu chung') : 'Đã lưu trên Google Drive');
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
  if (dirty || busy) { alert('Có thay đổi chưa lưu. Hãy tải bản sao dữ liệu trước khi tải lại trang hoặc đổi tài khoản.'); return; }
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
    if(!confirm('Nhập bản sao sẽ thay thế danh sách hiện tại trên Drive. Tiếp tục?'))return;
    data=incoming; render(); save();
  } catch(err) { alert(`Không thể nhập: ${err.message}`); }
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
      if(words.some(x=>x.id===w.id)) continue;
      words.push({...w, groups:[...new Set(w.groups.map(g=>groupIds.get(g)))]}); added++;
    }
    data={...data,groups,words}; render(); save();
    alert(`Đã thêm ${added} từ; bỏ qua ${incoming.words.length-added} từ có ID trùng.`);
  } catch(err) { alert(`Không thể nhập: ${err.message}`); }
  finally { e.target.value=''; }
};
function options(selected='') { return '<option value="">Tất cả nhóm</option>'+data.groups.map(g=>`<option value="${esc(g.id)}" ${g.id===selected?'selected':''}>${esc(g.name)}</option>`).join(''); }
function render() {
  const filter=$('#filter-group').value, quiz=$('#quiz-group').value;
  $('#filter-group').innerHTML=options(filter); $('#quiz-group').innerHTML=options(quiz);
  renderWords();
  $('#group-list').innerHTML=data.groups.length ? data.groups.map(g=>`<div class="row"><div><strong>${esc(g.name)}</strong><p>${data.words.filter(w=>w.groups.includes(g.id)).length} từ</p></div><div class="row-actions"><button data-rename="${esc(g.id)}">Đổi tên</button><button data-delete-group="${esc(g.id)}">Xóa</button></div></div>`).join('') : '<p>Chưa có nhóm nào. Tạo một nhóm để bắt đầu.</p>';
}
function renderWords() {
  const q=$('#search').value.trim().toLowerCase(), group=$('#filter-group').value;
  const words=data.words.filter(w=>(!group||w.groups.includes(group))&&[w.japanese,w.romaji,w.meaning].some(x=>x.toLowerCase().includes(q)));
  $('#word-list').innerHTML=words.length ? words.map(w=>`<div class="row"><div><strong>${esc(w.japanese)}</strong> <span>${esc(w.romaji)}</span><p>${esc(w.meaning || 'Chưa có nghĩa tiếng Việt')}</p><div class="tags">${w.groups.map(g=>esc(data.groups.find(x=>x.id===g)?.name||'')).filter(Boolean).join(' · ')}</div></div><div class="row-actions"><button data-speak="${esc(w.id)}" aria-label="Phát âm ${esc(w.japanese)}">🔊</button><button data-edit="${esc(w.id)}">Sửa</button><button data-delete="${esc(w.id)}">Xóa</button></div></div>`).join('') : '<p>Chưa có từ phù hợp. Hãy thêm từ mới nhé.</p>';
}
function speak(text) { if (!('speechSynthesis' in window)) return alert('Trình duyệt không hỗ trợ phát âm.'); const voices=speechSynthesis.getVoices(); const voice=voices.find(v=>v.lang.toLowerCase().startsWith('ja')); if (!voice) return alert('Thiết bị chưa có giọng đọc tiếng Nhật.'); const u=new SpeechSynthesisUtterance(text); u.lang='ja-JP'; u.voice=voice; speechSynthesis.cancel(); speechSynthesis.speak(u); }
document.querySelector('nav').onclick=e=>{ const b=e.target.closest('[data-tab]'); if(!b)return; document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('active',x===b)); document.querySelectorAll('.panel').forEach(x=>x.hidden=x.id!==b.dataset.tab); if(b.dataset.tab==='stats')renderStats(); };
$('#search').oninput=renderWords; $('#filter-group').onchange=renderWords;
$('#group-form').onsubmit=e=>{ e.preventDefault(); const name=e.target.elements.name.value.trim(); if(!name)return; if(data.groups.some(g=>g.name.toLowerCase()===name.toLowerCase()))return alert('Tên nhóm đã tồn tại.'); data.groups.push({id:id(),name}); e.target.reset(); render(); save(); };
$('#group-list').onclick=e=>{ const rename=e.target.dataset.rename, del=e.target.dataset.deleteGroup, g=data.groups.find(x=>x.id===(rename||del)); if(!g)return; if(rename){ const name=prompt('Tên nhóm:',g.name)?.trim(); if(!name)return; if(data.groups.some(x=>x.id!==g.id&&x.name.toLowerCase()===name.toLowerCase()))return alert('Tên nhóm đã tồn tại.'); g.name=name; } else { if(!confirm('Xóa nhóm này? Các từ vẫn được giữ lại.'))return; data.groups=data.groups.filter(x=>x.id!==del); data.words.forEach(w=>w.groups=w.groups.filter(x=>x!==del)); } render(); save(); };
function openWord(w) { editing=w?.id||null; const f=$('#word-form'); f.reset(); f.elements.japanese.value=w?.japanese||''; f.elements.romaji.value=w?.romaji||''; f.elements.meaning.value=w?.meaning||''; $('#dialog-title').textContent=w?'Sửa từ':'Thêm từ mới'; $('#word-groups').innerHTML=data.groups.length?data.groups.map(g=>`<label><input type="checkbox" name="group" value="${esc(g.id)}" ${w?.groups.includes(g.id)?'checked':''}>${esc(g.name)}</label>`).join(''):'Chưa có nhóm. Bạn có thể tạo nhóm trước.'; $('#word-dialog').showModal(); }
$('#add-word').onclick=()=>openWord(); $('#cancel').onclick=()=>$('#word-dialog').close();
$('#word-form').onsubmit=e=>{ e.preventDefault(); const f=e.target, japanese=f.elements.japanese.value.trim(), romaji=f.elements.romaji.value.trim(), meaning=f.elements.meaning.value.trim(); if(!japanese||!romaji)return; const word={id:editing||id(),japanese,romaji,meaning,groups:[...f.querySelectorAll('[name=group]:checked')].map(x=>x.value)}; if(editing) data.words[data.words.findIndex(w=>w.id===editing)]=word; else data.words.push(word); $('#word-dialog').close(); render(); save(); };
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
function record(word, correct) {
  const s=store(), p=s.words[word.id]||{box:0,due:0,correct:0,wrong:0}, d=today();
  if (correct) { p.correct++; p.box=Math.min(p.box+1,intervals.length-1); p.due=d+intervals[p.box]; }
  else { p.wrong++; p.box=0; p.due=d; }
  s.words[word.id]=p; s.days[d]=(s.days[d]||0)+1; persistProgress();
}
const fold=(text,to)=>to==='japanese' ? String(text).normalize('NFC').replace(/\s/g,'') : String(text).normalize('NFD').replace(/\p{M}/gu,'').replace(/đ/gi,'d').toLowerCase().replace(/[\s'’\-.,!?]/g,'');
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
function quizHeader(q) { return `<p>Câu ${current+1}/${questions.length} · ${quizLabels[q.from]} → ${quizLabels[q.to]}</p><h2>${esc(q.word[q.from])}</h2><button class="secondary" id="quiz-speak" type="button">🔊 Phát âm</button>`; }
function answered(q, correct) {
  record(q.word, correct); if (correct) score++;
  $('#answer').innerHTML=`<p class="feedback ${correct?'correct':'incorrect'}">${correct?'Chính xác!':'Chưa đúng. Đáp án: '+esc(q.word[q.to])}</p><button id="next">${current+1===questions.length?'Xem kết quả':'Câu tiếp theo'}</button>`;
  $('#next').onclick=()=>{ current++; showQuestion(); }; $('#next').focus();
}
function showTyping(q) {
  $('#quiz-play').innerHTML=quizHeader(q)+'<form id="typing-form" autocomplete="off"><input name="answer" aria-label="Câu trả lời" placeholder="Gõ đáp án" required><button>Kiểm tra</button></form><div id="answer"></div>';
  $('#quiz-speak').onclick=()=>speak(q.word.japanese);
  const form=$('#typing-form'); form.elements.answer.focus();
  form.onsubmit=ev=>{ ev.preventDefault(); const input=form.elements.answer; input.disabled=true; form.querySelector('button').disabled=true; answered(q, fold(input.value,q.to)===fold(q.word[q.to],q.to)); };
}
function showFlash(q) {
  $('#quiz-play').innerHTML=quizHeader(q)+'<div id="answer"><button id="flip">Lật thẻ</button></div>';
  $('#quiz-speak').onclick=()=>speak(q.word.japanese);
  $('#flip').onclick=()=>{
    $('#answer').innerHTML=`<h2 class="flash-back">${esc(q.word[q.to])}</h2><div class="actions"><button class="secondary" id="forgot">Chưa nhớ</button><button id="knew">Đã nhớ</button></div>`;
    const rate=ok=>{ record(q.word,ok); if (ok) score++; current++; showQuestion(); };
    $('#forgot').onclick=()=>rate(false); $('#knew').onclick=()=>rate(true);
  };
}
function streak(days) { let d=today(), n=0; if (!days[d]) d--; while (days[d]) { n++; d--; } return n; }
function renderStats() {
  const s=store(), d=today(), entries=data.words.map(w=>({w,p:s.words[w.id]}));
  const seen=entries.filter(x=>x.p), total=seen.reduce((n,x)=>n+x.p.correct+x.p.wrong,0), right=seen.reduce((n,x)=>n+x.p.correct,0);
  const tiles=[['Tổng số từ',data.words.length],['Chưa học',entries.length-seen.length],['Đang học',seen.filter(x=>x.p.box<3).length],['Đã thuộc',seen.filter(x=>x.p.box>=3).length],['Đến hạn ôn hôm nay',seen.filter(x=>x.p.due<=d).length],['Chuỗi ngày học',streak(s.days)],['Số lượt trả lời hôm nay',s.days[d]||0],['Tỉ lệ đúng',total?Math.round(right/total*100)+'%':'–']];
  const weak=seen.filter(x=>x.p.wrong>0).sort((a,b)=>b.p.wrong-a.p.wrong).slice(0,10);
  $('#stats-note').textContent=sharedMode?'Tiến độ học chỉ lưu trên thiết bị này, không chia sẻ với người khác.':'Tiến độ học được lưu cùng dữ liệu trên Google Drive của bạn.';
  $('#stats-body').innerHTML=`<div class="stat-grid">${tiles.map(([k,v])=>`<div class="stat"><strong>${v}</strong><span>${k}</span></div>`).join('')}</div><h3>Từ hay sai</h3>`+(weak.length?weak.map(x=>`<div class="row"><div><strong>${esc(x.w.japanese)}</strong> <span>${esc(x.w.romaji)}</span><p>${esc(x.w.meaning)}</p></div><div>Sai ${x.p.wrong} · Đúng ${x.p.correct}</div></div>`).join(''):'<p>Chưa có từ nào bị sai.</p>');
}
function showQuestion(){if(current>=questions.length){$('#quiz-play').innerHTML=`<h3>Hoàn thành! 🎉</h3><p>Bạn trả lời đúng/nhớ được ${score}/${questions.length} câu.</p><p>Chọn lại cài đặt và bắt đầu để luyện thêm.</p>`;return;} const q=questions[current], labels={japanese:'Tiếng Nhật',romaji:'Romaji',meaning:'Tiếng Việt'}; if(q.format==='typing')return showTyping(q); if(q.format==='flashcard')return showFlash(q); $('#quiz-play').innerHTML=`<p>Câu ${current+1}/${questions.length} · ${labels[q.from]} → ${labels[q.to]}</p><h2>${esc(q.word[q.from])}</h2><button class="secondary" id="quiz-speak">🔊 Phát âm</button><div>${q.choices.map((x,i)=>`<button class="choice" data-choice="${i}">${esc(x)}</button>`).join('')}</div><div id="answer"></div>`; $('#quiz-speak').onclick=()=>speak(q.word.japanese); $('#quiz-play').querySelectorAll('[data-choice]').forEach(b=>b.onclick=()=>{ const correct=q.choices[Number(b.dataset.choice)]===q.word[q.to]; if(correct)score++; record(q.word,correct); $('#quiz-play').querySelectorAll('[data-choice]').forEach(x=>{ x.disabled=true; if(q.choices[Number(x.dataset.choice)]===q.word[q.to]) x.classList.add('correct'); else if(x===b) x.classList.add('incorrect'); }); $('#answer').innerHTML=`<p class="feedback ${correct?'correct':'incorrect'}">${correct?'Chính xác!':'Chưa đúng. Đáp án: '+esc(q.word[q.to])}</p><button id="next">${current+1===questions.length?'Xem kết quả':'Câu tiếp theo'}</button>`; $('#next').onclick=()=>{current++;showQuestion();}; }); }



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
