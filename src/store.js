import { debounce, nowIso, uid } from './util.js';
import { progressKey } from './schema.js';

const STORAGE_KEY = 'devpad.state';
const STATE_VERSION = 1;

function blankState() {
  return {
    version: STATE_VERSION,
    settings: {
      sheetId: '',
      webAppUrl: '',
      appVersion: '',
      setupDone: false,
      autoSync: true,
      lastSyncAt: '',
      lastSyncOk: false,
      lastError: ''
    },
    session: null,
    sites: [],
    activeHost: '',
    snippets: [],
    checklist: [],
    handbook: [],
    progress: {},
    pending: [],
    outbox: [],
    ui: {
      tab: 'snippets',
      q: '',
      lang: 'all',
      category: 'all',
      selectedSnippet: null,
      handbookQ: '',
      handbookSection: 'all',
      queueFilter: 'Pending',
      checklistScope: 'site'
    }
  };
}

export const S = blankState();

/**
 * Older builds queued progress writes with an empty host when no site was active.
 * The sheet rejects those with PROGRESS_KEY_REQUIRED, and because the flush used
 * to stop at the first failure they sat at the head of the queue forever, blocking
 * every later change. Re-stamp them onto a real host, and drop the ones that can
 * never be sent so the queue can drain again.
 */
function repairOutbox(entries, stored) {
  const sites = (stored && stored.sites) || [];
  const fallback = (stored && stored.activeHost) || (sites[0] && sites[0].host) || '';
  const kept = [];
  const dropped = [];
  for (const op of Array.isArray(entries) ? entries : []) {
    if (!op || typeof op !== 'object') continue;
    if (op.tab === 'Progress' && !op.host) {
      if (fallback) kept.push({ ...op, host: fallback });
      else dropped.push(op);
      continue;
    }
    if (op.tab === 'Progress' && !op.itemId) {
      dropped.push(op);
      continue;
    }
    kept.push(op);
  }
  if (dropped.length) {
    console.warn(`[devpad] dropped ${dropped.length} unsendable queued change(s)`);
  }
  S.repaired = { restamped: kept.length - (Array.isArray(entries) ? entries.length : 0) + dropped.length, dropped: dropped.length };
  return kept;
}

export async function loadState() {
  try {
    const got = await chrome.storage.local.get(STORAGE_KEY);
    const stored = got && got[STORAGE_KEY];
    if (stored && typeof stored === 'object') {
      const base = blankState();
      Object.assign(S, base, stored);
      S.settings = { ...base.settings, ...(stored.settings || {}) };
      S.ui = { ...base.ui, ...(stored.ui || {}) };
      S.progress = stored.progress || {};
      S.outbox = repairOutbox(stored.outbox || [], stored);
      S.pending = stored.pending || [];
      S.version = STATE_VERSION;
    }
  } catch (err) {
    console.warn('[devpad] state load failed', err);
  }
  return S;
}

const persist = () => chrome.storage.local.set({ [STORAGE_KEY]: S });

export const save = debounce(persist, 250);
export function saveNow() {
  save.cancel();
  return persist();
}

export function setUi(patch) {
  Object.assign(S.ui, patch);
  save();
}

export function setSettings(patch) {
  Object.assign(S.settings, patch);
  save();
}

export const isConfigured = () => !!(S.settings.sheetId && S.settings.webAppUrl);

export const isSignedIn = () => !!(S.session && S.session.userId && S.session.name);
export const isAdmin = () => isSignedIn() && S.session.role === 'admin';

export function setSession(session) {
  S.session = session;
  if (!session) {
    S.snippets = [];
    S.pending = [];
  }
  save();
}

export function progressFor(host, itemId) {
  return S.progress[progressKey(host, itemId)] || { done: false, note: '', updated: '' };
}

export function setProgressEntry(host, itemId, patch) {
  const key = progressKey(host, itemId);
  const current = S.progress[key] || { done: false, note: '', updated: '' };
  S.progress[key] = { ...current, ...patch, updated: nowIso() };
  save();
}

export function applyProgressRows(rows) {
  S.progress = {};
  for (const row of rows) {
    S.progress[progressKey(row.site, row.itemId)] = {
      done: !!row.done,
      note: row.note || '',
      updated: row.updated || ''
    };
  }
}

export function siteTally(host) {
  let total = 0;
  let done = 0;
  for (const item of S.checklist) {
    total += 1;
    if (progressFor(host, item.id).done) done += 1;
  }
  return { total, done };
}

export function findSite(host) {
  return S.sites.find((s) => s.host === host) || null;
}

export function upsertSite(host, patch = {}) {
  if (!host) return null;
  const existing = findSite(host);
  if (existing) {
    Object.assign(existing, patch, { lastSeen: nowIso() });
  } else {
    S.sites.push({
      row: 0,
      host,
      label: patch.label || host,
      added: nowIso(),
      lastSeen: nowIso()
    });
  }
  save();
  return findSite(host);
}

export function removeSite(host) {
  S.sites = S.sites.filter((s) => s.host !== host);
  if (S.activeHost === host) S.activeHost = S.sites[0]?.host || '';
  save();
}

export function pushOutbox(op) {
  const entry = { id: uid('op'), queuedAt: nowIso(), ...op };
  S.outbox.push(entry);
  save();
  return entry;
}

export function dropOutbox(id) {
  S.outbox = S.outbox.filter((o) => o.id !== id);
  save();
}

export async function resetLocalData({ keepSession = true } = {}) {
  const session = keepSession ? S.session : null;
  const settings = { ...S.settings };
  const activeHost = S.activeHost;
  Object.assign(S, blankState());
  S.settings = settings;
  S.session = session;
  S.activeHost = activeHost;
  await saveNow();
}
