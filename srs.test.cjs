const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const elements = new Map(), listeners = {}, store = new Map();
const element = key => {
  if (!elements.has(key)) elements.set(key, {hidden:true,value:'',innerHTML:'',textContent:'',addEventListener(){},querySelectorAll:()=>[],focus(){},elements:{}});
  return elements.get(key);
};
const w = (id, japanese, romaji, meaning) => ({id, japanese, romaji, meaning, groups:[]});
const words = [w('a','あ','a','một'), w('i','い','i','hai'), w('u','う','u','ba'), w('e','え','e','Việt Nam')];
const bridge = {postMessage(message) {
  const value = message.method === 'getSharedData' ? {revision:0,data:{version:1,groups:[],words}} : 1;
  setImmediate(()=>listeners.message({origin:'https://test.googleusercontent.com',source:bridge,data:{channel:'c',type:'result',id:message.id,value}}));
}};
const context = {
  URLSearchParams, location:{search:'?mode=together',pathname:'/'},
  document:{querySelector:element,querySelectorAll:()=>[],createElement:()=>({}),body:{appendChild(){}}},
  window:{addEventListener:(name,fn)=>{listeners[name]=fn}},
  localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
  crypto:{randomUUID:()=> 'c'}, setTimeout, clearTimeout, Blob, URL, console
};
vm.runInNewContext(fs.readFileSync('app.js','utf8').replace(/^import[^\n]+\n/, "const CLIENT_ID = 'test', TOGETHER_URL = 'https://script.google.com/test';\n"), context);
listeners.message({origin:'https://test.googleusercontent.com',source:bridge,data:{channel:'c',type:'ready'}});
const run = code => vm.runInNewContext(code, context);
const form = (o = {}) => ({elements:Object.fromEntries(Object.entries({group:'',mode:'jr',count:'10',format:'choice',scope:'all',...o}).map(([k,v])=>[k,{value:v}]))});
(async () => {
  for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
  context.f = form();
  assert.strictEqual(run('buildQuestions(f).length'), 4);                       // all words, choice
  assert(run('buildQuestions(f).every(q=>q.choices.length>=2 && q.choices.includes(q.word[q.to]))'));
  // answering updates Leitner boxes and persists to localStorage (shared mode)
  run("record(data.words[0], true); record(data.words[0], true); record(data.words[1], false)");
  const saved = JSON.parse(store.get('jp-lea-progress'));
  assert.strictEqual(saved.words.a.box, 2);
  assert.strictEqual(saved.words.a.due - saved.words.i.due, 3);                 // box 2 = +3 days
  assert.strictEqual(saved.words.i.box, 0);
  assert.strictEqual(Object.values(saved.days)[0], 3);
  // scopes: due excludes a (not due yet); weak only i
  context.f = form({scope:'due',format:'flashcard'});
  assert.strictEqual(run('buildQuestions(f).map(q=>q.word.id).sort().join()'), 'e,i,u');
  context.f = form({scope:'weak',format:'typing'});
  assert.strictEqual(run('buildQuestions(f).map(q=>q.word.id).join()'), 'i');
  context.f = form({scope:'due',mode:'mixed',count:'2'});
  assert.strictEqual(run('buildQuestions(f).length'), 2);
  // typing normalization: case/diacritics/spaces for Vietnamese+romaji, exact kana
  assert.strictEqual(run("fold('  Viet nam ','meaning')===fold('Việt Nam','meaning')"), true);
  assert.strictEqual(run("fold('か','japanese')===fold('が','japanese')"), false);
  // typing flow records the answer
  const typing = element('#typing-form'), input = {value:'U',disabled:false,focus(){}};
  typing.elements = {answer:input}; typing.querySelector = () => ({});
  run("questions=[{word:data.words[2],from:'japanese',to:'romaji',format:'typing'}];current=0;score=0;showQuestion()");
  typing.onsubmit({preventDefault(){}});
  assert.strictEqual(run('score'), 1);
  assert.strictEqual(JSON.parse(store.get('jp-lea-progress')).words.u.box, 1);
  // flashcard flow
  run("questions=[{word:data.words[3],from:'japanese',to:'meaning',format:'flashcard'}];current=0;score=0;showQuestion()");
  element('#flip').onclick();
  element('#knew').onclick();
  assert.strictEqual(run('score'), 1);
  // stats render
  run('renderStats()');
  const html = element('#stats-body').innerHTML;
  assert(html.includes('Chuỗi ngày học') && html.includes('Từ hay sai') && html.includes('い'));
  console.log('SRS checks passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
