import { readCsv } from './csv.js';
import { CSV_TABS, KEYED_TABS, TABS, decodeRows, encodeRow, encodeRows } from './schema.js';
import { SEED } from './data.js';
import { S, save, saveNow, isConfigured, isAdmin, isSignedIn, pushOutbox, dropOutbox, applyProgressRows } from './store.js';
import { nowIso, toast } from './util.js';

const gvizUrl = (sheetId, tab) =>
  `https://docs.google.com/spreadsheets/d/${encodeURIComponent(
    sheetId
  )}/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent(tab)}`;

/** The sheet answers with SCREAMING_SNAKE codes; show the user a sentence instead. */
export function readableError(msg) {
  const raw = String(msg || '');
  const known = {
    INVALID_CREDENTIALS: 'That name and password do not match an active user.',
    NO_CREDENTIALS: 'Enter your name and password first.',
    ADMIN_REQUIRED: 'Only an admin can do that.',
    PROGRESS_KEY_REQUIRED: 'An older queued change had no site on it. It was dropped - try again.',
    PROGRESS_ARGS_REQUIRED: 'A checklist change was missing its site or item.',
    SHEET_ID_MISSING: 'No spreadsheet is configured yet.',
    NAME_REQUIRED: 'That name is required.',
    PASSWORD_REQUIRED: 'That password is required.',
    LABEL_REQUIRED: 'That name is required.',
    HOST_REQUIRED: 'That site is required.'
  };
  if (known[raw]) return known[raw];
  const tab = /^TAB_MISSING:\s*(.+)$/.exec(raw);
  if (tab) return `The sheet has no "${tab[1]}" tab yet. Run "Test connection & seed" in Settings.`;
  if (/PERMISSION|not accessible|Authorization/i.test(raw)) {
    return 'The web app cannot reach that spreadsheet. Check you deployed it as "Anyone" and own the sheet.';
  }
  return raw;
}

async function fetchCsv(sheetId, tab) {
  let res;
  try {
    res = await fetch(gvizUrl(sheetId, tab));
  } catch {
    throw new Error(`Network error while reading ${tab}. Are you online?`);
  }
  if (!res.ok) throw new Error(`Reading ${tab} failed (HTTP ${res.status}).`);
  const text = await res.text();
  if (/^\s*</.test(text) || /no permission|authorization error/i.test(text)) {
    throw new Error(`Sheet tab "${tab}" is not readable. Share the sheet "Anyone with the link" (Viewer).`);
  }
  return readCsv(text);
}

export async function callWebApp(action, payload = {}) {
  const url = (S.settings.webAppUrl || '').trim();
  if (!url) throw new Error('No web app URL set. Open Settings and paste the /exec URL.');
  const body = {
    action,
    sheetId: S.settings.sheetId,
    name: S.session ? S.session.name : '',
    password: S.session ? S.session.password : '',
    ...payload
  };
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (err) {
    // Chrome blocks cross-origin fetch without a host permission and reports it
    // as "Failed to fetch" / "NetworkError when attempting to fetch resource".
    throw new Error(
      `Could not reach the web app (${err && err.message ? err.message : 'network error'}). ` +
        'Check the /exec URL, and that manifest host_permissions includes https://script.google.com/*.'
    );
  }
  if (!res.ok) throw new Error(`Web app returned HTTP ${res.status}.`);
  let json;
  try {
    json = JSON.parse(await res.text());
  } catch {
    throw new Error('Web app returned a non-JSON response. Is the /exec URL correct?');
  }
  if (!json || json.ok !== true) {
    const err = new Error((json && json.error) || 'Web app call failed.');
    err.code = json && json.code;
    throw err;
  }
  return json;
}

export async function ping() {
  const res = await callWebApp('ping');
  S.settings.appVersion = res.version || '';
  save();
  return res;
}

/* ------------------------------------------------------------------ reads */

export async function readTab(tab) {
  if (KEYED_TABS.includes(tab)) {
    const res = await callWebApp('readTab', { tab });
    const rows = (res.rows || []).map((cells, i) => {
      const obj = { __row: i + 2 };
      (res.cols || []).forEach((c, cIdx) => {
        obj[c] = cells[cIdx] ?? '';
      });
      return obj;
    });
    return rows;
  }
  return fetchCsv(S.settings.sheetId, tab);
}

export async function readAll() {
  if (!isConfigured()) throw new Error('Sheet not configured yet. Open Settings to finish setup.');

  const problems = [];
  const load = async (tab) => {
    try {
      return decodeRows(tab, await readTab(tab));
    } catch (err) {
      problems.push(`${tab}: ${err.message}`);
      return null;
    }
  };

  const [checklist, handbook, progress, sites] = await Promise.all(CSV_TABS.map((t) => load(t)));
  const snippets = isSignedIn() ? await load('Snippets') : S.snippets;

  if (checklist) S.checklist = checklist;
  if (handbook) S.handbook = handbook;
  if (progress) applyProgressRows(progress);
  if (sites) {
    S.sites = sites;
    if (!S.sites.some((s) => s.host === S.activeHost)) S.activeHost = S.sites[0]?.host || '';
  }
  if (snippets) S.snippets = snippets;

  S.settings.lastSyncAt = nowIso();
  S.settings.lastSyncOk = problems.length === 0;
  S.settings.lastError = problems.join(' | ');
  save();

  return { problems, snippets: isSignedIn() ? snippets : null };
}

export async function readPending() {
  const res = await callWebApp('listPending', {});
  const rows = (res.rows || []).map((cells, i) => {
    const obj = { __row: i + 2 };
    (res.cols || []).forEach((c, cIdx) => {
      obj[c] = cells[cIdx] ?? '';
    });
    return obj;
  });
  S.pending = decodeRows('Pending', rows);
  save();
  return S.pending;
}

/* ----------------------------------------------------------------- writes */

export async function setupSheet() {
  if (!isConfigured()) throw new Error('Set the Sheet ID and the /exec URL first.');

  const payload = {};
  for (const [tab, cols] of Object.entries(TABS)) {
    if (tab === 'Users' || tab === 'Pending') {
      payload[tab] = { cols, seed: [] };
      continue;
    }
    const seed = encodeRows(tab, SEED[tab] || []);
    payload[tab] = { cols, seed };
  }
  const res = await callWebApp('setup', { payload });
  S.settings.setupDone = true;
  save();
  return res;
}

async function directWrite(op) {
  if (op.tab === 'Progress') {
    if (op.op === 'progressBulk') {
      return callWebApp('bulkProgress', { host: op.host, items: op.items || [] });
    }
    return callWebApp('setProgress', { host: op.host, itemId: op.itemId, done: op.done, note: op.note });
  }
  if (op.tab === 'Sites') {
    return callWebApp('registerSite', { host: op.host, label: op.label });
  }
  if (op.op === 'append') {
    return callWebApp('appendRow', { tab: op.tab, values: op.values });
  }
  if (op.op === 'update') {
    return callWebApp('updateRow', { tab: op.tab, row: op.row, id: op.id, values: op.values });
  }
  if (op.op === 'delete') {
    return callWebApp('deleteRow', { tab: op.tab, row: op.row, id: op.id });
  }
  throw new Error(`Unsupported write op: ${op.op}`);
}

export async function flushOutbox() {
  if (!S.outbox.length) return { flushed: 0, failed: 0, error: null };
  if (!isSignedIn()) return { flushed: 0, failed: S.outbox.length, error: 'Not signed in.' };

  let flushed = 0;
  let error = null;
  let blocked = 0;
  const responses = [];

  for (const op of [...S.outbox]) {
    try {
      let res;
      const shared = ['Snippets', 'Checklist', 'Handbook'].includes(op.tab);
      if (shared && !isAdmin()) {
        res = await callWebApp('submitChange', {
          op: op.op,
          tab: op.tab,
          row: op.row || 0,
          id: op.id || '',
          values: op.values || null
        });
      } else {
        res = await directWrite(op);
      }
      responses.push({ id: op.id, res });
      dropOutbox(op.id);
      flushed += 1;
    } catch (err) {
      // Keep going. Stopping here used to wedge the queue permanently: one bad
      // entry at the head meant nothing behind it ever synced again.
      blocked += 1;
      if (!error) error = readableError(err.message);
    }
  }

  if (flushed) await saveNow();
  return { flushed, failed: S.outbox.length, error, blocked, responses };
}

export function queueWrite(op) {
  pushOutbox(op);
  return flushOutbox();
}

export async function queueProgress(host, itemId, done, note) {
  // Catch this here: the sheet used to answer PROGRESS_KEY_REQUIRED, which reads
  // like a missing access key but actually meant an empty host or item id.
  if (!host) throw new Error('Pick a site first - progress is tracked per site.');
  if (!itemId) throw new Error('That checklist item has no id.');
  return queueWrite({ tab: 'Progress', op: 'progress', host, itemId, done, note });
}

export async function queueSite(host, label) {
  return queueWrite({ tab: 'Sites', op: 'site', host, label });
}

export async function queueAppend(tab, obj) {
  return queueWrite({ tab, op: 'append', id: obj.id, values: encodeRow(tab, obj), label: obj.title || obj.item || obj.host });
}

export async function queueUpdate(tab, obj, row) {
  return queueWrite({
    tab,
    op: 'update',
    row: row || obj.row || 0,
    id: obj.id || obj.host,
    values: encodeRow(tab, obj),
    label: obj.title || obj.item || obj.host
  });
}

export async function queueDelete(tab, obj) {
  return queueWrite({ tab, op: 'delete', row: obj.row || 0, id: obj.id || obj.host, label: obj.title || obj.item });
}

export function outboxSummary() {
  return { count: S.outbox.length, shared: S.outbox.filter((o) => ['Snippets', 'Checklist', 'Handbook'].includes(o.tab)).length };
}

export function announceQueue(result) {
  if (!result || !result.error) return;
  toast(result.error, 'error');
}
