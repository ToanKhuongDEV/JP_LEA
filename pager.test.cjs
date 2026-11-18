const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const elements = new Map();
const element = key => {
  if (!elements.has(key)) elements.set(key, {hidden:true,value:'',innerHTML:'',textContent:'',addEventListener(){},querySelectorAll:()=>[],scrollIntoView(){}});
  return elements.get(key);
};
const context = {document:{querySelector:element,querySelectorAll:()=>[]}, window:{addEventListener(){}}, localStorage:{getItem:()=>null,setItem(){},removeItem(){}}, crypto:{randomUUID:()=>'id'}, setTimeout, Blob, URL, console, alert(){}};
vm.runInNewContext(fs.readFileSync('app.js','utf8').replace(/^import[^\n]+\n/, 'const CLIENT_ID = "";\n'), context);
const run = code => vm.runInNewContext(code, context);
const rows = () => (element('#word-list').innerHTML.match(/class="row"/g) || []).length;
const click = page => element('#word-pager').onclick({target:{closest:()=>({dataset:{page},disabled:false})}});
const words = Array.from({length:45}, (_, i) => ({id:'w'+i, japanese:'語'+i, romaji:'go'+i, meaning:i%2?'lẻ':'chẵn', groups:[]}));
run('data={version:1,groups:[],words:' + JSON.stringify(words) + '}; render();');
assert.strictEqual(rows(), 20);
assert(element('#word-pager').innerHTML.includes('Trang 1/3') && element('#word-pager').innerHTML.includes('45 từ'));
assert(/data-page="prev" disabled/.test(element('#word-pager').innerHTML));
click('next'); click('next');
assert.strictEqual(rows(), 5);
assert(element('#word-pager').innerHTML.includes('Trang 3/3') && /data-page="next" disabled/.test(element('#word-pager').innerHTML));
click('prev'); assert.strictEqual(rows(), 20);
// searching resets to page 1; small result sets show no pager buttons
click('next'); element('#search').value = 'lẻ'; element('#search').oninput();
assert.strictEqual(rows(), 20); assert(element('#word-pager').innerHTML.includes('Trang 1/2'));
element('#search').value = '语'; element('#search').oninput();
assert.strictEqual(rows(), 0);
element('#search').value = '語4'; element('#search').oninput();
assert.strictEqual(rows(), 6); assert(!element('#word-pager').innerHTML.includes('data-page'));
// deleting the last item on the last page clamps to a valid page
element('#search').value = ''; element('#search').oninput(); click('next'); click('next');
run('data.words=data.words.slice(0,40); render()');
assert.strictEqual(rows(), 20); assert(element('#word-pager').innerHTML.includes('Trang 2/2'));
console.log('Pagination checks passed');
