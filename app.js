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
const empty = () => ({version:1, words:[], groups:[]});
let data = empty(), token = '', fileId = '', remoteRevision = '', dirty = false, busy = false, editing = null, questions = [], current = 0, score = 0;
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
    data = shared.data; remoteRevision = shared.revision; return;
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
  try {
    while (dirty) {
      dirty = false; status(sharedMode ? 'Đang lưu dữ liệu chung…' : 'Đang lưu lên Drive…');
      const snapshot = JSON.stringify(data);
      if (sharedMode) {
        remoteRevision = await sharedCall('saveSharedData', remoteRevision, JSON.parse(snapshot));
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
    status(sharedMode ? 'Đã lưu dữ liệu chung' : 'Đã lưu trên Google Drive');
  } catch(e) { dirty=true; status(`Chưa lưu: ${e.message}`); }
  finally { busy=false; $('#retry').hidden=!dirty; }
}
window.addEventListener('beforeunload', e => { if (dirty || busy) { e.preventDefault(); e.returnValue=''; } });
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
document.querySelector('nav').onclick=e=>{ const b=e.target.closest('[data-tab]'); if(!b)return; document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('active',x===b)); document.querySelectorAll('.panel').forEach(x=>x.hidden=x.id!==b.dataset.tab); };
$('#search').oninput=renderWords; $('#filter-group').onchange=renderWords;
$('#group-form').onsubmit=e=>{ e.preventDefault(); const name=e.target.elements.name.value.trim(); if(!name)return; if(data.groups.some(g=>g.name.toLowerCase()===name.toLowerCase()))return alert('Tên nhóm đã tồn tại.'); data.groups.push({id:id(),name}); e.target.reset(); render(); save(); };
$('#group-list').onclick=e=>{ const rename=e.target.dataset.rename, del=e.target.dataset.deleteGroup, g=data.groups.find(x=>x.id===(rename||del)); if(!g)return; if(rename){ const name=prompt('Tên nhóm:',g.name)?.trim(); if(!name)return; if(data.groups.some(x=>x.id!==g.id&&x.name.toLowerCase()===name.toLowerCase()))return alert('Tên nhóm đã tồn tại.'); g.name=name; } else { if(!confirm('Xóa nhóm này? Các từ vẫn được giữ lại.'))return; data.groups=data.groups.filter(x=>x.id!==del); data.words.forEach(w=>w.groups=w.groups.filter(x=>x!==del)); } render(); save(); };
function openWord(w) { editing=w?.id||null; const f=$('#word-form'); f.reset(); f.elements.japanese.value=w?.japanese||''; f.elements.romaji.value=w?.romaji||''; f.elements.meaning.value=w?.meaning||''; $('#dialog-title').textContent=w?'Sửa từ':'Thêm từ mới'; $('#word-groups').innerHTML=data.groups.length?data.groups.map(g=>`<label><input type="checkbox" name="group" value="${esc(g.id)}" ${w?.groups.includes(g.id)?'checked':''}>${esc(g.name)}</label>`).join(''):'Chưa có nhóm. Bạn có thể tạo nhóm trước.'; $('#word-dialog').showModal(); }
$('#add-word').onclick=()=>openWord(); $('#cancel').onclick=()=>$('#word-dialog').close();
$('#word-form').onsubmit=e=>{ e.preventDefault(); const f=e.target, japanese=f.elements.japanese.value.trim(), romaji=f.elements.romaji.value.trim(), meaning=f.elements.meaning.value.trim(); if(!japanese||!romaji)return; const word={id:editing||id(),japanese,romaji,meaning,groups:[...f.querySelectorAll('[name=group]:checked')].map(x=>x.value)}; if(editing) data.words[data.words.findIndex(w=>w.id===editing)]=word; else data.words.push(word); $('#word-dialog').close(); render(); save(); };
$('#word-list').onclick=e=>{ const b=e.target.closest('button'); if(!b)return; const key=b.dataset.speak||b.dataset.edit||b.dataset.delete, w=data.words.find(x=>x.id===key); if(!w)return; if(b.dataset.speak)speak(w.japanese); else if(b.dataset.edit)openWord(w); else if(confirm(`Xóa từ ${w.japanese}?`)){data.words=data.words.filter(x=>x.id!==key);render();save();} };
const modes={rj:['romaji','japanese'],jr:['japanese','romaji'],jv:['japanese','meaning'],vj:['meaning','japanese']};
function shuffle(a){ for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a; }
$('#quiz-form').onsubmit=e=>{ e.preventDefault(); const f=e.target, group=f.elements.group.value, mode=f.elements.mode.value, count=Number(f.elements.count.value), pool=data.words.filter(w=>!group||w.groups.includes(group)); const candidates=[]; for(const [key,[from,to]] of Object.entries(modes)){ if(mode!=='mixed'&&mode!==key)continue; for(const w of pool){ if(!w[from]||!w[to])continue; const answers=[...new Set(pool.filter(x=>x[from]&&x[to]).map(x=>x[to]))].filter(x=>x!==w[to]); if(answers.length<1)continue; candidates.push({word:w,from,to,choices:shuffle([w[to],...shuffle(answers).slice(0,3)])}); } } questions=shuffle(candidates).slice(0,count); current=0;score=0; if(!questions.length){$('#quiz-play').innerHTML='<p>Cần ít nhất 2 đáp án khác nhau trong nhóm đã chọn. Hãy thêm từ hoặc nghĩa.</p>';return;} showQuestion(); };
function showQuestion(){if(current>=questions.length){$('#quiz-play').innerHTML=`<h3>Hoàn thành! 🎉</h3><p>Bạn trả lời đúng ${score}/${questions.length} câu.</p><p>Chọn lại cài đặt và bắt đầu để luyện thêm.</p>`;return;} const q=questions[current], labels={japanese:'Tiếng Nhật',romaji:'Romaji',meaning:'Tiếng Việt'}; $('#quiz-play').innerHTML=`<p>Câu ${current+1}/${questions.length} · ${labels[q.from]} → ${labels[q.to]}</p><h2>${esc(q.word[q.from])}</h2><button class="secondary" id="quiz-speak">🔊 Phát âm</button><div>${q.choices.map((x,i)=>`<button class="choice" data-choice="${i}">${esc(x)}</button>`).join('')}</div><div id="answer"></div>`; $('#quiz-speak').onclick=()=>speak(q.word.japanese); $('#quiz-play').querySelectorAll('[data-choice]').forEach(b=>b.onclick=()=>{ const correct=q.choices[Number(b.dataset.choice)]===q.word[q.to]; if(correct)score++; $('#quiz-play').querySelectorAll('[data-choice]').forEach(x=>{ x.disabled=true; if(q.choices[Number(x.dataset.choice)]===q.word[q.to]) x.classList.add('correct'); else if(x===b) x.classList.add('incorrect'); }); $('#answer').innerHTML=`<p class="feedback ${correct?'correct':'incorrect'}">${correct?'Chính xác!':'Chưa đúng. Đáp án: '+esc(q.word[q.to])}</p><button id="next">${current+1===questions.length?'Xem kết quả':'Câu tiếp theo'}</button>`; $('#next').onclick=()=>{current++;showQuestion();}; }); }



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
    render(); $('#content').hidden = false; $('#backup').hidden = false;
    status('Đã kết nối Learning Together');
  }).catch(e => status('Không thể tải dữ liệu chung: ' + e.message));
} else restoreSession();
