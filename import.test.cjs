const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const elements = new Map();
const element = key => {
  if (!elements.has(key)) elements.set(key, {value:'', hidden:true, innerHTML:'', textContent:'', addEventListener(){}, querySelectorAll:()=>[]});
  return elements.get(key);
};
const alerts = [];
const context = {document:{querySelector:element, querySelectorAll:()=>[]}, window:{addEventListener(){}}, localStorage:{getItem:()=>null, setItem(){}, removeItem(){}}, crypto:{randomUUID:()=> 'new-id'}, fetch:async()=>({ok:true,status:200,json:async()=>({id:'file',version:'1'})}), setTimeout, clearTimeout, Blob, URL};
const source = fs.readFileSync('app.js','utf8').replace(/^import[^\n]+\n/, 'const CLIENT_ID = "";\n');
vm.runInNewContext(source, context);
const current = {version:1, groups:[{id:'old',name:'Hiragana'}], words:[{id:'existing',japanese:'あ',romaji:'a',meaning:'',groups:['old']}]};
vm.runInNewContext('data=' + JSON.stringify(current), context);
const importFile = async value => element('#import-words-file').onchange({target:{files:[{text:async()=>value}],value:'chosen'}});
(async()=>{
  const incoming = JSON.parse(fs.readFileSync('hiragana.json','utf8'));
  incoming.words.push({id:'existing',japanese:'あ',romaji:'a',meaning:'',groups:['hiragana-basic']});
  await importFile(JSON.stringify(incoming));
  let result = vm.runInNewContext('JSON.stringify(data)', context);
  result = JSON.parse(result);
  assert.strictEqual(result.words.length, 46); // hiragana 'あ' trùng chữ + romaji với từ đã có nên bị bỏ qua
  assert.strictEqual(result.groups.length, 1);
  assert(result.words.every(w=>w.groups[0]==='old'));
  const before = JSON.stringify(result);
  await importFile(JSON.stringify({version:1,words:[{id:'bad',japanese:'x',romaji:'x',meaning:'',groups:['missing']}],groups:[]}));
  assert.strictEqual(vm.runInNewContext('JSON.stringify(data)', context), before);
  assert(element('#toast').textContent.includes('Không thể nhập'));
  console.log('JSON import checks passed');
})().catch(error=>{console.error(error);process.exitCode=1});

