const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
// Sentence data sanity
const bank = JSON.parse(fs.readFileSync('sentences.json','utf8')).sentences;
assert(bank.length >= 20);
assert.strictEqual(new Set(bank.map(s=>s.id)).size, bank.length);
for (const s of bank) {
  assert(Array.isArray(s.tokens) && s.tokens.length >= 2 && s.tokens.every(t=>t && typeof t==='string'), s.id);
  assert.strictEqual(s.kana, s.tokens.join(''), s.id);
  assert(s.ja && s.romaji && s.vi, s.id);
}
const elements = new Map(), listeners = {}, spoken = [];
const element = key => {
  if (!elements.has(key)) elements.set(key, {hidden:true,value:'',innerHTML:'',textContent:'',addEventListener(){},querySelectorAll:()=>[],focus(){}});
  return elements.get(key);
};
class FakeRecognition { start() { FakeRecognition.last = this; } }
const context = {
  URLSearchParams, location:{search:'?mode=together',pathname:'/'},
  document:{querySelector:element,querySelectorAll:()=>[],createElement:()=>({}),body:{appendChild(){}}},
  window:{addEventListener:(n,f)=>{listeners[n]=f}, speechSynthesis:{}, SpeechRecognition:FakeRecognition},
  speechSynthesis:{getVoices:()=>[{lang:'ja-JP',name:'Kyoko'},{lang:'ja_JP',name:'Google 日本語'},{lang:'en-US',name:'Google US'}],cancel(){},speak:u=>spoken.push(u)},
  SpeechSynthesisUtterance:class { constructor(t){ this.text=t; } },
  fetch:async()=>({ok:true,json:async()=>({sentences:bank})}),
  localStorage:{getItem:()=>null,setItem(){},removeItem(){}},
  crypto:{randomUUID:()=> 'c'}, setTimeout, clearTimeout, Blob, URL, console, alert(){}
};
context.window.speechSynthesis = context.speechSynthesis;
vm.runInNewContext(fs.readFileSync('app.js','utf8').replace(/^import[^\n]+\n/, "const CLIENT_ID = 'test', TOGETHER_URL = 'https://script.google.com/test';\n"), context);
const run = code => vm.runInNewContext(code, context);
const tick = () => new Promise(r => setImmediate(r));
const btn = dataset => ({dataset, id:dataset.id||''});
(async () => {
  // similarity / scoring
  assert.strictEqual(run("similarity('わたしはがくせいです','わたしは がくせいです。')"), 1);
  assert(run("pronScore(['私は学生です','わたしはがくせい'],['わたしはがくせいです','私は学生です'])") === 1);
  assert(run("similarity('ねこ','いぬ')") < 0.5);
  // TTS prefers the Google Japanese voice and honours rate
  run("speak('こんにちは',0.6)");
  assert.strictEqual(spoken[0].voice.name, 'Google 日本語'); assert.strictEqual(spoken[0].rate, 0.6);
  // sentence builder
  element('#sentence-form').onsubmit({preventDefault(){}, target:{elements:{count:{value:'3'}}}});
  await tick(); await tick();
  const st = () => run('sState');
  const s = st().s;
  assert(element('#sentence-play').innerHTML.includes(s.vi));
  const click = dataset => element('#sentence-play').onclick({target:{closest:()=>({dataset,id:dataset.id})}});
  // wrong order first (reverse), check -> incorrect
  for (const t of [...s.tokens].reverse()) { const chip = st().chips.find(c=>c.t===t && !st().chosen.includes(c.i)); click({chip:String(chip.i),zone:'bank'}); }
  if (s.tokens.join('') !== [...s.tokens].reverse().join('')) { click({id:'sentence-check'}); assert(element('#sentence-result').innerHTML.includes('incorrect')); }
  click({id:'sentence-next'});
  const s2 = st().s;
  for (const t of s2.tokens) { const chip = st().chips.find(c=>c.t===t && !st().chosen.includes(c.i)); click({chip:String(chip.i),zone:'bank'}); }
  click({id:'sentence-check'});
  assert(element('#sentence-result').innerHTML.includes('feedback correct'));
  assert.strictEqual(run('sScore'), 1);
  // chip can be removed from the answer zone
  click({id:'sentence-next'});
  click({chip:String(st().chips[0].i),zone:'bank'}); assert.strictEqual(st().chosen.length,1);
  click({chip:String(st().chips[0].i),zone:'answer'}); assert.strictEqual(st().chosen.length,0);
  
  // pronunciation flow
  element('#pron-form').onsubmit({preventDefault(){}, target:{elements:{source:{value:'sentences'},count:{value:'1'}}}});
  await tick(); await tick();
  const item = run('pron.items[0]');
  const pclick = kind => element('#pron-play').onclick({target:{closest:()=>({dataset:{pron:kind}})}});
  pclick('mic');
  assert.strictEqual(FakeRecognition.last.lang, 'ja-JP');
  FakeRecognition.last.onresult({results:[[{transcript:item.text}]]});
  assert(element('#pron-result').innerHTML.includes('feedback correct') && element('#pron-result').innerHTML.includes('100%'));
  assert.strictEqual(run('pron.ok'), 1);
  pclick('mic'); FakeRecognition.last.onerror({error:'not-allowed'});
  assert(element('#pron-result').innerHTML.includes('micro'));
  pclick('mic'); FakeRecognition.last.onresult({results:[[{transcript:'ぜんぜんちがう'}]]});
  assert(element('#pron-result').innerHTML.includes('feedback incorrect'));
  pclick('next');
  assert(element('#pron-play').innerHTML.includes('Hoàn thành'));
  // unsupported browser
  delete context.window.SpeechRecognition;
  element('#pron-form').onsubmit({preventDefault(){}, target:{elements:{source:{value:'sentences'},count:{value:'1'}}}});
  await tick(); await tick(); pclick('mic');
  assert(element('#pron-result').innerHTML.includes('chưa hỗ trợ'));
  console.log('Speech and sentence checks passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
