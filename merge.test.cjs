const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const elements = new Map(), listeners = {};
const element = key => {
  if (!elements.has(key)) elements.set(key, {hidden:true,value:'',innerHTML:'',textContent:'',addEventListener(){},querySelectorAll:()=>[]});
  return elements.get(key);
};
const w = (id, japanese, groups = []) => ({id, japanese, romaji:id, meaning:'', groups});
let frame, serverRevision = 1, server = {version:1,groups:[{id:'g1',name:'Chung'}],words:[w('a','あ',['g1']), w('b','い',['g1'])]};
let saves = 0, conflictOnce = true;
const bridge = {postMessage(message) {
  let value, error;
  if (message.method === 'getSharedData') value = {revision:serverRevision, data:JSON.parse(JSON.stringify(server))};
  else if (conflictOnce) {
    conflictOnce = false; // another person adds a word, a same-named group, and deletes "b" meanwhile
    server = {version:1,groups:[{id:'g1',name:'Chung'},{id:'g2',name:'nhóm mới'}],words:[w('a','あ',['g1']), w('r','う',['g2'])]};
    serverRevision++; error = 'Dữ liệu chung đã thay đổi.';
  } else { saves++; assert.strictEqual(message.args[0], serverRevision); server = message.args[1]; value = ++serverRevision; }
  setImmediate(()=>listeners.message({origin:'https://test.googleusercontent.com',source:bridge,data:{channel:'c',type:'result',id:message.id,value,error}}));
}};
const context = {
  URLSearchParams, location:{search:'?mode=together',pathname:'/'},
  document:{querySelector:element,querySelectorAll:()=>[],createElement:()=>frame={},body:{appendChild(){}}},
  window:{addEventListener:(name,fn)=>{listeners[name]=fn}},
  localStorage:{getItem:()=>null,setItem(){},removeItem(){}},
  crypto:{randomUUID:()=> 'c'}, setTimeout, clearTimeout, Blob, URL, console
};
const source = fs.readFileSync('app.js','utf8').replace(/^import[^\n]+\n/, "const CLIENT_ID = 'test', TOGETHER_URL = 'https://script.google.com/test';\n");
vm.runInNewContext(source, context);
listeners.message({origin:'https://test.googleusercontent.com',source:bridge,data:{channel:'c',type:'ready'}});
const tick = () => new Promise(r => setImmediate(r));
(async () => {
  for (let i = 0; i < 5; i++) await tick();
  assert.strictEqual(element('#content').hidden, false);
  assert.strictEqual(element('#refresh').hidden, false);
  // local: delete "a", edit nothing else, add same-named group with a word
  element('#group-form').onsubmit({preventDefault(){},target:{elements:{name:{value:'Nhóm Mới'}},reset(){}}});
  for (let i = 0; i < 12; i++) await tick();
  assert.strictEqual(saves, 1);
  assert.strictEqual(JSON.stringify(server.words.map(x=>x.id).sort()), '["a","r"]');
  assert.strictEqual(JSON.stringify(server.groups.map(g=>g.name)), '["Chung","nhóm mới"]');
  assert.strictEqual(element('#status').textContent, 'Đã lưu và hợp nhất với thay đổi của người khác');
  // refresh picks up a remote change when nothing is pending
  server = {...server, words:[...server.words, w('z','え')]}; serverRevision++;
  element('#refresh').onclick();
  for (let i = 0; i < 6; i++) await tick();
  assert(element('#word-list').innerHTML.includes('え'));
  console.log('Merge checks passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
