const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const elements = new Map(), store = new Map();
const element = key => {
  if (!elements.has(key)) elements.set(key, {hidden:true,value:'',innerHTML:'',textContent:'',addEventListener(){},querySelectorAll:()=>[],focus(){},elements:{},classList:{contains:()=>false}});
  return elements.get(key);
};
const w = (id, japanese, romaji, meaning, groups = []) => ({id, japanese, romaji, meaning, groups});
let remote, patched = null, remoteVersion = '1';
const fetchMock = async (url, options = {}) => {
  const ok = body => ({ok:true,status:200,json:async()=>body});
  if (options.method === 'PATCH') { patched = JSON.parse(options.body); remote = patched; remoteVersion = '3'; return ok({id:'f',version:'3'}); }
  if (url.includes('alt=media')) return ok(JSON.parse(JSON.stringify(remote)));
  return ok({version:remoteVersion});
};
const context = {
  URLSearchParams, location:{search:'',pathname:'/'},
  document:{querySelector:element,querySelectorAll:()=>[],createElement:()=>({}),body:{appendChild(){}}},
  window:{addEventListener(){}}, fetch:fetchMock,
  localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
  crypto:{randomUUID:()=> 'new'}, setTimeout, clearTimeout, Blob, URL, console, confirm:()=>true
};
vm.runInNewContext(fs.readFileSync('app.js','utf8').replace(/^import[^\n]+\n/, "const CLIENT_ID = 'test';\n"), context);
const run = code => vm.runInNewContext(code, context);
(async () => {
  // --- mergeProgress keeps the most-practised record and max day counts
  const merged = run(`mergeProgress({words:{a:{correct:3,wrong:0,box:3,due:5}},days:{1:4},sentences:{s1:{vj:true}}},{words:{a:{correct:1,wrong:0,box:1,due:2},b:{correct:1,wrong:0,box:1,due:2}},days:{1:2,2:1},sentences:{s1:{jv:true}}})`);
  assert.strictEqual(merged.words.a.correct, 3); assert(merged.words.b); assert.strictEqual(merged.days[1], 4);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(merged.sentences.s1)), {vj:true,jv:true});

  // --- Drive conflict: merge instead of rejecting
  const base = {version:1,groups:[],words:[w('a','あ','a','một')]};
  remote = {version:1,groups:[],words:[w('a','あ','a','một'),w('r','う','u','ba')],progress:{words:{},days:{9:1}}};
  run(`token='t'; fileId='f'; remoteRevision='1'; base=${JSON.stringify(base)}; data=${JSON.stringify({...base,words:[w('a','あ','a','một'),w('l','い','i','hai')],progress:{words:{},days:{9:5}}})}`);
  remoteVersion = '2';
  await run('save()');
  assert(patched, 'đã ghi lên Drive');
  assert.deepStrictEqual(patched.words.map(x=>x.id).sort(), ['a','l','r']);
  assert.strictEqual(patched.progress.days[9], 5);
  assert(element('#status').textContent.includes('hợp nhất'));

  // --- duplicate word is rejected (same japanese + romaji)
  run(`data=${JSON.stringify({version:1,groups:[],words:[w('a','あ','a','một')]})}; editing=null`);
  const form = values => ({preventDefault(){}, target:{elements:Object.fromEntries(Object.entries(values).map(([k,v])=>[k,{value:v}])), querySelectorAll:()=>[]}});
  element('#word-dialog').close = () => {};
  element('#word-form').onsubmit(form({japanese:'あ',romaji:'A',meaning:'x'}));
  assert.strictEqual(run('data.words.length'), 1);
  assert(element('#toast').textContent.includes('đã có'));
  element('#word-form').onsubmit(form({japanese:'い',romaji:'i',meaning:'hai'}));
  assert.strictEqual(run('data.words.length'), 2);

  // --- restore keeps current progress when the backup has none
  run(`data.progress={words:{a:{correct:2,wrong:0,box:2,due:3}},days:{}}`);
  const file = {text:async()=>JSON.stringify({version:1,groups:[],words:[w('z','ん','n','x')]})};
  await element('#restore-file').onchange({target:{files:[file],value:'x'}});
  assert.strictEqual(run('data.words.length'), 1);
  assert.strictEqual(run('data.progress.words.a.correct'), 2);

  // --- typing: synonyms and parentheses accepted, near-miss detected, override undoes the wrong answer
  assert(run("acceptable('con mèo, mèo (nhà)','meaning').includes(fold('mèo','meaning'))"));
  run(`data.words=[${JSON.stringify(w('m','ねこ','neko','con mèo, mèo'))}]; data.progress={words:{},days:{}}`);
  const typing = element('#typing-form'), input = {value:'con meo',disabled:false,focus(){}};
  typing.elements = {answer:input}; typing.querySelector = () => ({});
  run("questions=[{word:data.words[0],from:'japanese',to:'meaning',format:'typing'}];current=0;score=0;showQuestion()");
  assert(element('#quiz-play').innerHTML.includes('id="quiz-speak"'));
  typing.onsubmit({preventDefault(){}});
  assert.strictEqual(run('score'), 1);
  input.value = 'con mao'; input.disabled = false;
  run("questions=[{word:data.words[0],from:'japanese',to:'meaning',format:'typing'}];current=0;score=0;showQuestion()");
  typing.onsubmit({preventDefault(){}});
  assert.strictEqual(run('score'), 0);
  assert(element('#answer').innerHTML.includes('Gần đúng') && element('#answer').innerHTML.includes('id="override"'));
  const wrongBefore = run('data.progress.words.m.wrong');
  element('#override').onclick();
  assert.strictEqual(run('score'), 1);
  assert.strictEqual(run('data.progress.words.m.wrong'), wrongBefore - 1);

  // --- answer-spoiler: speak button hidden when the answer is Japanese
  run("questions=[{word:data.words[0],from:'meaning',to:'japanese',format:'typing'}];current=0;score=0;showQuestion()");
  assert(/id="quiz-speak" type="button" hidden/.test(element('#quiz-play').innerHTML));

  // --- due counts
  run(`data.words=[${JSON.stringify(w('x','あ','a','1'))},${JSON.stringify(w('y','い','i','2'))},${JSON.stringify(w('z','う','u','3'))}]; data.progress={words:{x:{box:1,due:0,correct:1,wrong:0},y:{box:1,due:99999999,correct:1,wrong:0}},days:{}}`);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(run('dueCounts()'))), {due:1,fresh:1});

  // --- sentence hint drops a wrong tail, places the next correct chip and marks hinted
  run(`sentenceBank=[{id:'t',tokens:['わたし','は','がくせい'],viTokens:['Tôi'],vi:'Tôi',romaji:''}]`);
  run(`sState={s:sentenceBank[0],dir:'vj',chips:[{t:'は',i:0},{t:'わたし',i:1},{t:'がくせい',i:2},{t:'を',i:3}],chosen:[3],checked:false}; hintSentence(sState)`);
  assert.deepStrictEqual(JSON.parse(run('JSON.stringify(sState.chosen)')), [1]);
  assert.strictEqual(run('sState.hinted'), true);
  console.log('Improvement checks passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
