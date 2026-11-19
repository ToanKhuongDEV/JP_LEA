const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const source = fs.readFileSync('app.js', 'utf8').replace(/^import[^\n]+\n/, 'const CLIENT_ID = "test";\n');
async function check(saved, remember = 'true') {
  const store = new Map([['jp-lea-remember', remember]]);
  if (saved !== null) store.set('jp-lea-session', saved);
  const elements = new Map();
  const element = key => {
    if (!elements.has(key)) elements.set(key, {hidden: true, value: '', checked: false, innerHTML: '', textContent: '', addEventListener() {}, querySelectorAll: () => []});
    return elements.get(key);
  };
  let calls = 0;
  const context = {document: {querySelector: element, querySelectorAll: () => []}, window: {addEventListener() {}}, localStorage: {getItem: k => store.get(k) ?? null, setItem: (k,v) => store.set(k,v), removeItem: k => store.delete(k)}, fetch: async () => { calls++; return {ok:true, status:200, json:async()=>({files:[]})}; }, crypto: {randomUUID: () => 'id'}, setTimeout, Blob, URL, console};
  vm.runInNewContext(source, context);
  await new Promise(resolve => setImmediate(resolve));
  return {store, elements, calls};
}
(async () => {
  let result = await check(JSON.stringify({token:'test-token',expires:Date.now()+60000}));
  assert.strictEqual(result.calls, 1);
  assert.strictEqual(result.elements.get('#content').hidden, false);
  result.elements.get('#remember').checked = false;
  result.elements.get('#remember').onchange();
  assert.strictEqual(result.store.has('jp-lea-session'), false);
  result = await check(JSON.stringify({token:'expired',expires:Date.now()-1}));
  assert.strictEqual(result.calls, 0);
  assert.strictEqual(result.store.has('jp-lea-session'), false);
  result = await check('{bad json');
  assert.strictEqual(result.calls, 0);
  assert.strictEqual(result.store.has('jp-lea-session'), false);
  result = await check(JSON.stringify({token:'test-token',expires:Date.now()+60000}), 'false');
  assert.strictEqual(result.calls, 0);
  console.log('Session restore checks passed');
})().catch(error => { console.error(error); process.exitCode=1; });
