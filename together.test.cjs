const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
let cells = Array.from({length:100}, () => ['']);
const sheet = {getRange:()=>({
  getValues:()=>cells.map(row=>row.slice()),
  setValues:rows=>{ cells=rows.map(row=>row.slice()); },
  setValue:value=>{ cells[0]=[value]; }
})};
let storedId;
const spreadsheet = {getSheetByName:()=>sheet, getId:()=> 'sheet-id'};
const context = {
  SpreadsheetApp:{getActiveSpreadsheet:()=>spreadsheet, openById:()=>spreadsheet, flush(){}},
  PropertiesService:{getScriptProperties:()=>({getProperty:()=>storedId,setProperty:(_, value)=>{storedId=value}})},
  LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})}
};
vm.runInNewContext(fs.readFileSync('together/Code.gs','utf8'), context);
storedId='sheet-id';
cells[0]=['!' + JSON.stringify({revision:0,data:{version:1,words:[],groups:[]}})];
const word = {id:'w',japanese:'猫',romaji:'neko',meaning:'con mèo',groups:[]};
const data = {version:1,words:[word],groups:[]};
assert.strictEqual(context.saveSharedData(0,data),1);
assert.strictEqual(context.getSharedData().data.words[0].japanese,'猫');
assert.throws(()=>context.saveSharedData(0,{version:1,words:[],groups:[]}), /thay đổi/);
assert.strictEqual(context.getSharedData().data.words.length,1);
assert.throws(()=>context.saveSharedData(1,{...data,words:[word,word]}), /không hợp lệ/);
assert.strictEqual(context.getSharedData().revision,1);
require('./together/build.cjs');
const html=fs.readFileSync('together/Index.html','utf8');
const script=html.match(/<script>([\s\S]*)<\/script><\/body>/);
assert(script);
new vm.Script(script[1]);
assert(html.includes('google.script.run'));
console.log('Learning Together checks passed');
