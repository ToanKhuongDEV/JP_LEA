const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const elements = new Map(), listeners = {};
const element = key => {
  if (!elements.has(key)) elements.set(key, {hidden:true,value:'',innerHTML:'',textContent:'',addEventListener(){},querySelectorAll:()=>[]});
  return elements.get(key);
};
let frame, revision = 0, saved, calls = [];
const bridge = {postMessage(message) {
  calls.push(message.method);
  let value;
  if (message.method === 'getSharedData') value = {revision:0,data:{version:1,groups:[],words:[]}};
  else { assert.strictEqual(message.args[0], revision); saved=message.args[1]; value=++revision; }
  setImmediate(()=>listeners.message({origin:'https://test.googleusercontent.com',source:bridge,data:{channel:'channel-1',type:'result',id:message.id,value}}));
}};
const context = {
  URLSearchParams, location:{search:'?mode=together',pathname:'/'},
  document:{querySelector:element,querySelectorAll:()=>[],createElement:()=>frame={},body:{appendChild(){}}},
  window:{addEventListener:(name,fn)=>{listeners[name]=fn}},
  localStorage:{getItem:()=>null,setItem(){},removeItem(){}},
  crypto:{randomUUID:()=> 'channel-1'}, setTimeout, clearTimeout, Blob, URL, console,
  fetch:()=>{throw Error('Shared mode must not call Drive');}
};
const source=fs.readFileSync('app.js','utf8').replace(/^import[^\n]+\n/, "const CLIENT_ID = 'test', TOGETHER_URL = 'https://script.google.com/test';\n");
vm.runInNewContext(source,context);
assert(frame.src.includes('bridge=1'));
listeners.message({origin:'https://evil.example',source:bridge,data:{channel:'channel-1',type:'ready'}});
assert.deepStrictEqual(calls,[]);
listeners.message({origin:'https://test.googleusercontent.com',source:bridge,data:{channel:'channel-1',type:'ready'}});
setImmediate(()=>setImmediate(()=>{
  assert.strictEqual(element('#content').hidden,false);
  assert.strictEqual(element('#login').hidden,true);
  const form={elements:{name:{value:'Nhóm'}},reset(){}};
  element('#group-form').onsubmit({preventDefault(){},target:form});
  setImmediate(()=>setImmediate(()=>{
    assert.deepStrictEqual(calls,['getSharedData','saveSharedData']);
    assert.strictEqual(saved.groups[0].name,'Nhóm');
    assert.strictEqual(element('#status').textContent,'Đã lưu dữ liệu chung');
    console.log('Shared mode checks passed');
  }));
}));
