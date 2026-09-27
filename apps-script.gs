/**
 * WP Dev Pad - Google Apps Script web app.
 *
 * The only writer for the spreadsheet. The extension reads with the public
 * gviz CSV endpoint and writes through this script, which is also where sign-in\n * credentials are checked and where editor changes wait for admin approval.
 *
 * Deploy: Deploy > New deployment > Web app
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * Every action takes { action, sheetId, key, ...payload } as JSON in the POST
 * body and answers with { ok: true, ... } or { ok: false, error: '...' }.
 */

var VERSION = 5;

var TABS = {
  Snippets: ['id', 'title', 'language', 'category', 'description', 'code', 'tags', 'updated'],
  Checklist: ['id', 'category', 'item', 'detail', 'order'],
  Handbook: ['id', 'section', 'title', 'content'],
  Progress: ['site', 'itemId', 'done', 'note', 'updated'],
  Sites: ['host', 'label', 'added', 'lastSeen'],
  Users: ['userId', 'name', 'password', 'role', 'createdAt', 'active', 'lastSeen'],
  Pending: ['changeId', 'op', 'tab', 'row', 'payload', 'requestedBy', 'requestedAt', 'status', 'decidedBy', 'decidedAt', 'reason']
};

var ACTIONS = {
  ping: fnPing,
  authenticate: fnAuthenticate,
  readTab: fnReadTab,
  setup: fnSetup,
  appendRow: fnAppendRow,
  updateRow: fnUpdateRow,
  deleteRow: fnDeleteRow,
  setProgress: fnSetProgress,
  bulkProgress: fnBulkProgress,
  registerSite: fnRegisterSite,
  deleteSite: fnDeleteSite,
  submitChange: fnSubmitChange,
  listPending: fnListPending,
  approveChange: fnApproveChange,
  rejectChange: fnRejectChange,
  listUsers: fnListUsers,
  manageUser: fnManageUser
};

/* ------------------------------------------------------------------ plumbing */

function doGet() {
  return json_({ ok: true, version: VERSION, name: 'wp-dev-pad' });
}

function doPost(e) {
  var payload = {};
  try {
    payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'BAD_JSON' });
  }
  try {
    var action = String(payload.action || '');
    var fn = ACTIONS[action];
    if (!fn) return json_({ ok: false, error: 'UNKNOWN_ACTION: ' + action });
    var result = fn(payload) || {};
    if (result.ok === false) return json_(result);
    return json_(Object.assign({ ok: true }, result));
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function ss_(p) {
  var id = String((p && p.sheetId) || '').trim();
  if (!id) throw new Error('SHEET_ID_MISSING');
  return SpreadsheetApp.openById(id);
}

function tab_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) throw new Error('TAB_MISSING: ' + name + ' (run "Create tabs & seed")');
  return sh;
}

function cols_(sh) {
  var last = sh.getLastColumn();
  if (last < 1) return [];
  return sh.getRange(1, 1, 1, last).getValues()[0].map(function (c) {
    return String(c);
  });
}

function indexOf_(cols, name) {
  return cols.indexOf(name);
}

/** Row values (excluding the header) for a whole tab. */
function readAll_(sh) {
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { cols: cols_(sh), rows: [] };
  var values = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();
  var rows = values.filter(function (r) {
    return r.some(function (c) {
      return String(c) !== '';
    });
  });
  return { cols: cols_(sh), rows: rows };
}

/** Find a row by the value in column A. Returns the 1-based row or 0. */
function findRow_(sh, id) {
  if (id === '' || id === null || id === undefined) return 0;
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return 0;
  var ids = sh.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return 0;
}

/** setValues is RAW, so a cell starting with "=" stays text. */
function writeRow_(sh, row, values) {
  sh.getRange(row, 1, 1, values.length).setNumberFormat('@').setValues([values]);
  return row;
}

function appendRow_(sh, values) {
  return writeRow_(sh, sh.getLastRow() + 1, values);
}

function nowIso_() {
  return new Date().toISOString();
}

/* ---------------------------------------------------------------------- auth */

function newUserId_() {
  return 'u_' + Utilities.getUuid().split('-')[0];
}

/**
 * Credentials are a name and a password typed by the user, both stored in plain
 * text on the Users tab. There is no key to generate, copy or paste, and no
 * separate verification step: matching the row is the whole check.
 */
function findUserRow_(sh, name, password) {
  var want = String(name || '').trim().toLowerCase();
  var pass = String(password == null ? '' : password);
  if (!want) return 0;
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return 0;
  var cols = cols_(sh);
  var nameCol = indexOf_(cols, 'name') + 1;
  var passCol = indexOf_(cols, 'password') + 1;
  var activeCol = indexOf_(cols, 'active') + 1;
  var values = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][nameCol - 1]).trim().toLowerCase() !== want) continue;
    // A blank password cell means the row is not set up to sign in yet.
    if (passCol > 0 && String(values[i][passCol - 1]) !== pass) continue;
    if (activeCol > 0 && String(values[i][activeCol - 1]).trim().toUpperCase() === 'FALSE') return 0;
    return i + 2;
  }
  return 0;
}

function user_(p) {
  var name = String((p && p.name) || '').trim();
  var password = (p && p.password) != null ? String(p.password) : '';
  if (!name) return null;
  var sh;
  try {
    sh = ss_(p).getSheetByName('Users');
  } catch (err) {
    return null;
  }
  if (!sh) return null;
  var row = findUserRow_(sh, name, password);
  if (!row) return null;
  var cols = cols_(sh);
  var values = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
  var data = {};
  cols.forEach(function (c, i) {
    data[c] = String(values[i]);
  });
  sh.getRange(row, indexOf_(cols, 'lastSeen') + 1).setValue(nowIso_());
  return { row: row, userId: data.userId, name: data.name, role: data.role };
}

function requireUser_(p) {
  var user = user_(p);
  if (!user) throw new Error('INVALID_CREDENTIALS');
  return user;
}

function requireAdmin_(p) {
  var user = requireUser_(p);
  if (user.role !== 'admin') throw new Error('ADMIN_REQUIRED');
  return user;
}

/* --------------------------------------------------------------------- setup */

function ensureTab_(ss, name, cols) {
  var sh = ss.getSheetByName(name);
  var created = false;
  if (!sh) {
    sh = ss.insertSheet(name);
    created = true;
  } else if (String(sh.getRange(1, 1).getValue()) !== String(cols[0])) {
    // Never clear an existing tab. A schema change must be done by hand so a
    // stray or hostile setup call cannot wipe live data.
    throw new Error('TAB_HEADER_MISMATCH: ' + name + ' starts with "' + sh.getRange(1, 1).getValue() + '", expected "' + cols[0] + '"');
  }
  if (created || String(sh.getRange(1, 1).getValue()) !== String(cols[0])) {
    sh.getRange(1, 1, 1, cols.length).setNumberFormat('@').setValues([cols]);
  }
  sh.setFrozenRows(1);
  return { sh: sh, created: created };
}

function removeBlankDefaults_(ss) {
  var protectedNames = Object.keys(TABS);
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var sh = sheets[i];
    var name = sh.getName();
    if (protectedNames.indexOf(name) !== -1) continue;
    if (name !== 'Sheet1' && name !== 'Sheet 1') continue;
    if (sh.getLastRow() > 1) continue;
    ss.deleteSheet(sh);
  }
}

function fnSetup(p) {
  var ss = ss_(p);
  // First run has no users yet, so setup is open. Once any user exists it is a
  // privileged operation and must present one.
  var users = ss.getSheetByName('Users');
  if (users && users.getLastRow() > 1) requireUser_(p);

  var payload = p.payload || {};
  var created = [];

  Object.keys(TABS).forEach(function (name) {
    var spec = payload[name] || {};
    var cols = spec.cols && spec.cols.length ? spec.cols : TABS[name];
    var result = ensureTab_(ss, name, cols);
    if (result.created) created.push(name);
    var sh = result.sh;
    if (sh.getLastRow() > 1) return;
    var seed = spec.seed || [];
    if (seed.length) sh.getRange(2, 1, seed.length, cols.length).setNumberFormat('@').setValues(seed);
  });

  removeBlankDefaults_(ss);
  return { version: VERSION, created: created };
}

function fnPing() {
  return { version: VERSION };
}

function fnAuthenticate(p) {
  var user = user_(p);
  if (!user) return { ok: false, error: 'INVALID_CREDENTIALS' };
  return { userId: user.userId, name: user.name, role: user.role };
}

function fnListUsers(p) {
  requireAdmin_(p);
  var sh = tab_(ss_(p), 'Users');
  var data = readAll_(sh);
  // Blank the password column: the admin already knows the passwords, and the
  // client has no use for them.
  var pwCol = indexOf_(data.cols, 'password');
  var rows = data.rows.map(function (r) {
    return pwCol >= 0 ? r.slice(0, pwCol).concat(['']).concat(r.slice(pwCol + 1)) : r;
  });
  return { cols: data.cols, rows: rows };
}

  function fnManageUser(p) {
    requireAdmin_(p);
    var sh = tab_(ss_(p), 'Users');
    var cols = cols_(sh);
    // The sub-action arrives as userAction. Accept a bare action= too, but never
    // treat the dispatcher key itself as the sub-action.
    var action = String(p.userAction || (p.action && p.action !== 'manageUser' ? p.action : '') || '');
    var userId = String(p.userId || '');
  
    if (action === 'add') {
      var name = String(p.name || '').trim();
      var password = String(p.password == null ? '' : p.password);
      var role = p.role === 'admin' ? 'admin' : 'editor';
      if (!name) throw new Error('NAME_REQUIRED');
      if (!password) throw new Error('PASSWORD_REQUIRED');
      var id = newUserId_();
      appendRow_(sh, [id, name, password, role, nowIso_(), 'TRUE', '']);
      return { userId: id, name: name, role: role };
    }
  
    var row = findRow_(sh, userId);
    if (!row) throw new Error('USER_NOT_FOUND');
  
    if (action === 'setRole') {
      sh.getRange(row, indexOf_(cols, 'role') + 1).setValue(p.role === 'admin' ? 'admin' : 'editor');
      return { userId: userId, role: p.role };
    }
    if (action === 'setPassword') {
      var pw = String(p.password == null ? '' : p.password);
      if (!pw) throw new Error('PASSWORD_REQUIRED');
      sh.getRange(row, indexOf_(cols, 'password') + 1).setValue(pw);
      return { userId: userId };
    }
    if (action === 'rename') {
      var to = String(p.name || '').trim();
      if (!to) throw new Error('NAME_REQUIRED');
      sh.getRange(row, indexOf_(cols, 'name') + 1).setValue(to);
      return { userId: userId, name: to };
    }
    if (action === 'revoke' || action === 'restore') {
      sh.getRange(row, indexOf_(cols, 'active') + 1).setValue(action === 'revoke' ? 'FALSE' : 'TRUE');
      return { userId: userId, active: action !== 'revoke' };
    }
    throw new Error('UNKNOWN_USER_ACTION');
  }

/* --------------------------------------------------------------------- reads */

function fnReadTab(p) {
  requireUser_(p);
  var sh = tab_(ss_(p), String(p.tab || ''));
  return readAll_(sh);
}

/* -------------------------------------------------------------------- writes */

function fnAppendRow(p) {
  requireAdmin_(p);
  var sh = tab_(ss_(p), String(p.tab || ''));
  var values = p.values || [];
  return { row: appendRow_(sh, values) };
}

function fnUpdateRow(p) {
  requireAdmin_(p);
  var sh = tab_(ss_(p), String(p.tab || ''));
  var values = p.values || [];
  var id = String(p.id || (values[0] !== undefined ? values[0] : ''));
  var row = Number(p.row) || 0;

  if (row > 0 && String(sh.getRange(row, 1).getValue()) === id) {
    return { row: writeRow_(sh, row, values), mode: 'updated' };
  }
  var found = findRow_(sh, id);
  if (found) return { row: writeRow_(sh, found, values), mode: 'updated' };
  return { row: appendRow_(sh, values), mode: 'appended' };
}

function fnDeleteRow(p) {
  requireAdmin_(p);
  var sh = tab_(ss_(p), String(p.tab || ''));
  var id = String(p.id || '');
  var row = Number(p.row) || 0;

  if (row > 0 && String(sh.getRange(row, 1).getValue()) === id) {
    sh.deleteRow(row);
    return { deleted: true, row: row };
  }
  var found = findRow_(sh, id);
  if (found) {
    sh.deleteRow(found);
    return { deleted: true, row: found };
  }
  return { deleted: false };
}

function fnSetProgress(p) {
  requireUser_(p);
  var sh = tab_(ss_(p), 'Progress');
  var cols = cols_(sh);
  var host = String(p.host || '');
  var itemId = String(p.itemId || '');
  if (!host || !itemId) throw new Error('PROGRESS_ARGS_REQUIRED');

  var lastRow = sh.getLastRow();
  var row = 0;
  if (lastRow > 1) {
    var values = sh.getRange(2, 1, lastRow - 1, 3).getValues();
    for (var i = 0; i < values.length; i++) {
      if (String(values[i][0]) === host && String(values[i][1]) === itemId) {
        row = i + 2;
        break;
      }
    }
  }

  var cells = [p.done ? 'TRUE' : '', String(p.note || ''), nowIso_()];
  if (row) {
    sh.getRange(row, indexOf_(cols, 'done') + 1, 1, 3).setNumberFormat('@').setValues([cells]);
  } else {
    row = appendRow_(sh, [host, itemId].concat(cells));
  }
  return { row: row };
}

function fnBulkProgress(p) {
  requireUser_(p);
  var items = p.items || [];
  for (var i = 0; i < items.length; i++) {
    fnSetProgress({
      sheetId: p.sheetId,
      name: p.name,
      password: p.password,
      host: p.host,
      itemId: items[i].itemId,
      done: items[i].done,
      note: items[i].note
    });
  }
  return { updated: items.length };
}

function fnRegisterSite(p) {
  requireUser_(p);
  var sh = tab_(ss_(p), 'Sites');
  var cols = cols_(sh);
  var host = String(p.host || '');
  if (!host) throw new Error('HOST_REQUIRED');
  var row = findRow_(sh, host);
  var label = String(p.label || host);
  if (row) {
    sh.getRange(row, indexOf_(cols, 'label') + 1).setValue(label);
    sh.getRange(row, indexOf_(cols, 'lastSeen') + 1).setValue(nowIso_());
  } else {
    row = appendRow_(sh, [host, label, nowIso_(), nowIso_()]);
  }
  return { row: row };
}

function fnDeleteSite(p) {
  requireUser_(p);
  var sh = tab_(ss_(p), 'Sites');
  var row = findRow_(sh, String(p.host || ''));
  if (row) sh.deleteRow(row);
  return { deleted: !!row };
}

/* ----------------------------------------------------------------- approvals */

function fnSubmitChange(p) {
  var user = requireUser_(p);
  var sh = tab_(ss_(p), 'Pending');
  var name = String(p.tab || '');
  if (!TABS[name]) throw new Error('UNKNOWN_TAB');
  if (['Progress', 'Sites', 'Users', 'Pending'].indexOf(name) !== -1) {
    throw new Error('TAB_NOT_QUEUED');
  }

  var op = String(p.op || '');
  var values = p.values || [];
  var id = String(p.id || (values[0] !== undefined ? values[0] : ''));
  var before = [];

  var target = ss_(p).getSheetByName(name);
  if (target && op !== 'append') {
    var row = Number(p.row) || 0;
    if (!row) row = findRow_(target, id);
    if (row && row <= target.getLastRow()) {
      before = target.getRange(row, 1, 1, target.getLastColumn()).getValues()[0];
    }
  }

  var changeId = 'c_' + Utilities.getUuid().split('-')[0];
  var payload = JSON.stringify({ values: values, before: before, id: id });
  appendRow_(sh, [
    changeId,
    op,
    name,
    Number(p.row) || 0,
    payload,
    user.label,
    nowIso_(),
    'Pending',
    '',
    '',
    ''
  ]);
  return { changeId: changeId };
}

function fnListPending(p) {
  var user = requireUser_(p);
  var sh = tab_(ss_(p), 'Pending');
  var data = readAll_(sh);
  if (user.role === 'admin') return { cols: data.cols, rows: data.rows };

  var byCol = indexOf_(data.cols, 'requestedBy');
  var rows = data.rows.filter(function (r) {
    return String(r[byCol]) === String(user.label);
  });
  return { cols: data.cols, rows: rows };
}

function pendingRow_(sh, changeId) {
  var cols = cols_(sh);
  var idCol = indexOf_(cols, 'changeId');
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return 0;
  var values = sh.getRange(2, idCol + 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]) === String(changeId)) return i + 2;
  }
  return 0;
}

function fnApproveChange(p) {
  var user = requireAdmin_(p);
  var ss = ss_(p);
  var sh = tab_(ss, 'Pending');
  var cols = cols_(sh);
  var row = pendingRow_(sh, String(p.changeId || ''));
  if (!row) throw new Error('CHANGE_NOT_FOUND');

  var values = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
  var rec = {};
  cols.forEach(function (c, i) {
    rec[c] = String(values[i]);
  });
  if (rec.status !== 'Pending') throw new Error('ALREADY_DECIDED');

  var payload = {};
  try {
    payload = JSON.parse(rec.payload || '{}');
  } catch (err) {
    throw new Error('BAD_CHANGE_PAYLOAD');
  }

  var target = tab_(ss, rec.tab);
  var applied = { mode: 'none' };

  if (rec.op === 'append') {
    applied = { mode: 'appended', row: appendRow_(target, payload.values || []) };
  } else if (rec.op === 'update') {
    var tRow = Number(rec.row) || 0;
    var id = String(payload.id || (payload.values && payload.values[0]) || '');
    if (tRow > 0 && String(target.getRange(tRow, 1).getValue()) === id) {
      applied = { mode: 'updated', row: writeRow_(target, tRow, payload.values || []) };
    } else {
      var found = findRow_(target, id);
      applied = found
        ? { mode: 'updated', row: writeRow_(target, found, payload.values || []) }
        : { mode: 'appended', row: appendRow_(target, payload.values || []) };
    }
  } else if (rec.op === 'delete') {
    var dRow = Number(rec.row) || 0;
    var dId = String(payload.id || '');
    var target2 = dRow > 0 && String(target.getRange(dRow, 1).getValue()) === dId ? dRow : findRow_(target, dId);
    if (target2) {
      target.deleteRow(target2);
      applied = { mode: 'deleted', row: target2 };
    }
  } else {
    throw new Error('UNKNOWN_OP');
  }

  sh.getRange(row, indexOf_(cols, 'status') + 1).setValue('Approved');
  sh.getRange(row, indexOf_(cols, 'decidedBy') + 1).setValue(user.label);
  sh.getRange(row, indexOf_(cols, 'decidedAt') + 1).setValue(nowIso_());

  return { applied: applied, row: row };
}

function fnRejectChange(p) {
  var user = requireAdmin_(p);
  var sh = tab_(ss_(p), 'Pending');
  var cols = cols_(sh);
  var row = pendingRow_(sh, String(p.changeId || ''));
  if (!row) throw new Error('CHANGE_NOT_FOUND');

  sh.getRange(row, indexOf_(cols, 'status') + 1).setValue('Rejected');
  sh.getRange(row, indexOf_(cols, 'decidedBy') + 1).setValue(user.label);
  sh.getRange(row, indexOf_(cols, 'decidedAt') + 1).setValue(nowIso_());
  sh.getRange(row, indexOf_(cols, 'reason') + 1).setValue(String(p.reason || ''));
  return { row: row };
}
