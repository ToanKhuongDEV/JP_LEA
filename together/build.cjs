const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');
let app = fs.readFileSync('app.js', 'utf8');
const style = fs.readFileSync('style.css', 'utf8');
app = app.replace(/^import[^\n]+\n/, "const CLIENT_ID = 'shared';\n");
app = app.replace("if (!CLIENT_ID) $('#setup').hidden = false;", '');
const bridgeStart = app.indexOf('let sharedCall;');
const bridgeEnd = app.indexOf('async function api(');
if (bridgeStart < 0 || bridgeEnd < 0) throw Error('Could not locate bridge');
app = app.slice(0, bridgeStart) + app.slice(bridgeEnd);
const start = app.indexOf('async function load()');
const end = app.indexOf("window.addEventListener('beforeunload'");
if (start < 0 || end < 0) throw Error('Could not locate storage functions');
app = app.slice(0, start) + `
const sharedCall = (method, ...args) => new Promise((resolve, reject) =>
  google.script.run.withSuccessHandler(resolve).withFailureHandler(reject)[method](...args));
async function load() {
  const shared = await sharedCall('getSharedData');
  data = shared.data;
  remoteRevision = shared.revision;
}
async function save() {
  dirty = true; status('Chưa đồng bộ');
  if (busy) return;
  busy = true;
  try {
    while (dirty) {
      dirty = false; status('Đang lưu dữ liệu chung…');
      const snapshot = JSON.parse(JSON.stringify(data));
      remoteRevision = await sharedCall('saveSharedData', remoteRevision, snapshot);
    }
    status('Đã lưu dữ liệu chung');
  } catch (e) { dirty = true; status('Chưa lưu: ' + e.message); }
  finally { busy = false; $('#retry').hidden = !dirty; }
}
` + app.slice(end);
const login = app.indexOf("$('#login').onclick");
const retry = app.indexOf("$('#retry').onclick");
if (login < 0 || retry < 0) throw Error('Could not locate login');
app = app.slice(0, login) + app.slice(retry);
const session = app.indexOf('async function restoreSession()');
if (session < 0) throw Error('Could not locate session restore');
app = app.slice(0, session) + `
status('Đang tải dữ liệu chung…');
load().then(() => {
  render(); $('#content').hidden = false; $('#backup').hidden = false;
  status('Đã kết nối Learning Together');
}).catch(e => status('Không thể tải dữ liệu chung: ' + e.message));
`;
html = html.replace('<link rel="stylesheet" href="style.css?v=3">', '<style>' + style + '</style>');
html = html.replace('<script src="https://accounts.google.com/gsi/client" async defer></script>', '');
html = html.replace(/<script type="module" src="app\.js[^"]*"><\/script>/, '');
html = html.replace('<div class="account-main">', '<div class="account-main"><style>#remember-label,#login,#restore,#together-link {display:none}</style>');
html = html.replace('</body>', '<script>' + app.replace(/<\/script/gi, '<\\/script') + '</script></body>');
fs.writeFileSync('together/Index.html', html);
