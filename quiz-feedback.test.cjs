const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const source = fs.readFileSync('app.js', 'utf8');
const fn = source.slice(source.indexOf('function showQuestion()'), source.indexOf('\nasync function restoreSession()'));
function check(selected) {
  const buttons = ['0','1'].map(i => ({dataset:{choice:i}, classList:{values:[],add(c){this.values.push(c)}}}));
  const els = {'#quiz-play': {innerHTML:'',querySelectorAll:()=>buttons}, '#quiz-speak':{}, '#answer':{innerHTML:''}, '#next':{}};
  const context = {$: key => els[key], questions:[{word:{japanese:'a',romaji:'a'},from:'japanese',to:'romaji',choices:['a','b']}], current:0, score:0, esc:s=>s, speak:()=>{}, record:()=>{}};
  vm.runInNewContext(fn + '\nshowQuestion()', context);
  buttons[selected].onclick();
  assert(buttons[0].classList.values.includes('correct'));
  assert.strictEqual(buttons[1].classList.values.includes('incorrect'), selected === 1);
  assert(els['#answer'].innerHTML.includes(selected ? 'feedback incorrect' : 'feedback correct'));
  assert(buttons.every(x=>x.disabled));
}
check(0); check(1); console.log('Quiz feedback checks passed');
