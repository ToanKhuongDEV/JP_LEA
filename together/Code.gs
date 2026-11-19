// Create a bound Apps Script project in a dedicated spreadsheet.
const SHEET_NAME = 'LearningTogether';
const CHUNK_SIZE = 30000;
const CHUNKS = 100;

function doGet(e) {
  if (e && e.parameter && e.parameter.bridge === '1') {
    if (!/^[a-zA-Z0-9-]{1,64}$/.test(e.parameter.channel || '')) throw new Error('Yêu cầu không hợp lệ.');
    const page = HtmlService.createTemplateFromFile('Bridge');
    page.channel = e.parameter.channel;
    return page.evaluate().setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  return HtmlService.createHtmlOutputFromFile('Index').setTitle('Learning Together');
}

function sheet_() {
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!spreadsheetId) throw new Error('Hãy chạy setup trong Apps Script trước.');
  const sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('Chưa có trang LearningTogether. Hãy chạy setup trước.');
  return sheet;
}

function setup() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (spreadsheet.getSheetByName(SHEET_NAME)) throw new Error('Trang LearningTogether đã tồn tại; không thay thế dữ liệu.');
  const sheet = spreadsheet.insertSheet(SHEET_NAME);
  sheet.getRange(1, 1).setValue('!' + JSON.stringify({revision: 0, data: {version: 1, words: [], groups: []}}));
  SpreadsheetApp.flush();
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', spreadsheet.getId());
}

function read_() {
  const raw = sheet_().getRange(1, 1, CHUNKS, 1).getValues().map(row => {
    if (row[0] && (typeof row[0] !== 'string' || !row[0].startsWith('!'))) throw new Error('Dữ liệu bảng tính không hợp lệ.');
    return row[0] ? row[0].slice(1) : '';
  }).join('');
  if (!raw) throw new Error('Dữ liệu trống hoặc bị thay đổi trong bảng tính.');
  const state = JSON.parse(raw);
  if (!Number.isSafeInteger(state.revision) || state.revision < 0 || !valid_(state.data)) throw new Error('Dữ liệu trong bảng tính không hợp lệ.');
  return state;
}

function valid_(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.words) || !Array.isArray(data.groups)) return false;
  const ids = new Set();
  for (const g of data.groups) {
    if (!g || typeof g.id !== 'string' || !g.id || ids.has(g.id) || typeof g.name !== 'string' || !g.name.trim() || g.name.length > 80) return false;
    ids.add(g.id);
  }
  const words = new Set();
  for (const w of data.words) {
    if (!w || typeof w.id !== 'string' || !w.id || words.has(w.id) || typeof w.japanese !== 'string' || !w.japanese.trim() || w.japanese.length > 120 || typeof w.romaji !== 'string' || !w.romaji.trim() || w.romaji.length > 120 || typeof w.meaning !== 'string' || w.meaning.length > 160 || !Array.isArray(w.groups) || !w.groups.every(id => ids.has(id))) return false;
    words.add(w.id);
  }
  return true;
}

function getSharedData() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return read_(); } finally { lock.releaseLock(); }
}

function saveSharedData(revision, data) {
  if (!Number.isSafeInteger(revision) || !valid_(data)) throw new Error('Dữ liệu gửi lên không hợp lệ.');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const current = read_();
    if (current.revision !== revision) throw new Error('Dữ liệu chung đã thay đổi. Hãy tải bản sao, rồi tải lại trang trước khi sửa tiếp.');
    const next = {revision: revision + 1, data};
    const raw = JSON.stringify(next);
    if (raw.length > CHUNK_SIZE * CHUNKS) throw new Error('Dữ liệu chung đã vượt giới hạn lưu trữ.');
    const rows = Array.from({length: CHUNKS}, (_, i) => {
      const chunk = raw.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      return [chunk ? '!' + chunk : ''];
    });
    sheet_().getRange(1, 1, CHUNKS, 1).setValues(rows);
    SpreadsheetApp.flush();
    return next.revision;
  } finally { lock.releaseLock(); }
}
