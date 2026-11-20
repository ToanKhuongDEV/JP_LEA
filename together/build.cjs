const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');
let app = fs.readFileSync('app.js', 'utf8');
const style = fs.readFileSync('style.css', 'utf8');
function replaceOnce(source, from, to) {
  if (source.split(from).length !== 2) throw Error('Could not locate: ' + from.slice(0, 60));
  return source.replace(from, to);
}
app = replaceOnce(app, /^import[^\n]+\n/.exec(app)[0], "const CLIENT_ID = 'shared';\n");
app = app.replace(/^const sharedMode = [^\n]+\n/m, 'const sharedMode = true;\n');
const bridgeStart = app.indexOf('let sharedCall;');
const bridgeEnd = app.indexOf('async function api(');
if (bridgeStart < 0 || bridgeEnd < 0) throw Error('Could not locate bridge');
app = app.slice(0, bridgeStart) + `const sharedCall = (method, ...args) => new Promise((resolve, reject) =>
  google.script.run.withSuccessHandler(resolve).withFailureHandler(reject)[method](...args));
` + app.slice(bridgeEnd);
html = html.replace('<link rel="stylesheet" href="style.css?v=3">', '<style>' + style + '</style>');
html = html.replace('<script src="https://accounts.google.com/gsi/client" async defer></script>', '');
html = html.replace(/<script type="module" src="app\.js[^"]*"><\/script>/, '');
html = html.replace('<div class="account-main">', '<div class="account-main"><style>#remember-label,#login,#restore,#together-link {display:none}</style>');
html = html.replace('</body>', '<script>' + app.replace(/<\/script/gi, '<\\/script') + '</script></body>');
fs.writeFileSync('together/Index.html', html);
