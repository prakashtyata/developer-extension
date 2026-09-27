import { S, loadState, save, saveNow, setSettings, isConfigured, isSignedIn, isAdmin, upsertSite } from './store.js';
import { readAll, flushOutbox, queueSite, outboxSummary, readableError } from './sheet.js';
import { refreshPending, pendingCount, myPending } from './approval.js';
import * as snippets from './ui/snippets.js';
import * as checklist from './ui/checklist.js';
import * as handbook from './ui/handbook.js';
import * as settings from './ui/settings.js';
import { el, clear, qs, normalizeHost, isLocalHost, relTime, toast, debounce } from './util.js';
import { slide, prefersReducedMotion } from './ui/nav.js';

const TABS = {
  snippets: { panel: '#panel-snippets', render: snippets.render },
  checklist: { panel: '#panel-checklist', render: checklist.render },
  handbook: { panel: '#panel-handbook', render: handbook.render }
};

let activeTab = 'snippets';
let lastDetectedHost = '';
let autosyncRunning = false;

function safeRender(name) {
  const tab = TABS[name];
  if (!tab) return;
  const root = qs(tab.panel);
  try {
    tab.render(root);
  } catch (err) {
    console.error(`[devpad] ${name} render failed`, err);
    clear(root);
    root.append(
      el('div', { class: 'empty' },
        el('p', { text: `The ${name} tab hit an error.` }),
        el('pre', { class: 'error-pre', text: String(err && err.message ? err.message : err) })
      )
    );
  }
}

function renderActive() {
  for (const [name, tab] of Object.entries(TABS)) {
    const node = qs(tab.panel);
    const active = name === activeTab;
    node.classList.toggle('panel-active', active);
    if (!active) node.classList.add('hidden');
    else node.classList.remove('hidden');
  }
  for (const btn of document.querySelectorAll('.tab')) {
    btn.classList.toggle('tab-active', btn.dataset.tab === activeTab);
  }
  safeRender(activeTab);
  renderHeader();
}

const TAB_ORDER = Object.keys(TABS);

function setTab(name) {
  if (!TABS[name] || name === activeTab) return;
  const from = TAB_ORDER.indexOf(activeTab);
  const to = TAB_ORDER.indexOf(name);
  const dir = from === -1 || to === -1 || to > from ? 'forward' : 'back';

  const leaving = qs(TABS[activeTab].panel);
  activeTab = name;
  S.ui.tab = name;
  save();
  renderActive();

  const entering = qs(TABS[name].panel);
  if (entering && !entering.classList.contains('hidden')) {
    slide(entering, dir, leaving && leaving !== entering ? leaving : null);
  }
}

function renderHeader() {
  const siteLine = qs('#site-line');
  const trackBtn = qs('#btn-track');
  const queueBadge = qs('#queue-badge');
  const roleChip = qs('#role-chip');

  clear(siteLine);
  if (lastDetectedHost) {
    const tracked = S.sites.some((s) => s.host === lastDetectedHost);
    siteLine.append(
      el('span', { text: tracked ? `${lastDetectedHost} - ${relTime(S.sites.find((s) => s.host === lastDetectedHost).lastSeen)}` : `${lastDetectedHost} - not tracked` })
    );
    if (trackBtn) {
      trackBtn.classList.toggle('hidden', tracked);
      trackBtn.onclick = async () => {
        const res = await queueSite(lastDetectedHost, lastDetectedHost);
        if (res && res.error) {
          toast(res.error, 'error');
          return;
        }
        upsertSite(lastDetectedHost, {});
        toast(`${lastDetectedHost} added to Sites.`, 'success');
        document.dispatchEvent(new CustomEvent('devpad:changed'));
      };
    }
  } else {
    siteLine.append(el('span', { class: 'muted', text: 'No site detected' }));
    if (trackBtn) trackBtn.classList.add('hidden');
  }

  clear(roleChip);
  if (S.session) {
    roleChip.append(
      el('span', {
        class: `chip chip-${S.session.role}`,
        text: S.session.name,
        title: `${S.session.name} (${S.session.role})`
      }),
      el('span', { class: 'muted tiny', text: S.session.role === 'admin' ? 'admin' : 'editor' })
    );
    roleChip.classList.remove('hidden');
  } else {
    roleChip.classList.add('hidden');
  }

  clear(queueBadge);
  if (isAdmin()) {
    const count = pendingCount('Pending');
    if (count) {
      queueBadge.classList.remove('hidden');
      queueBadge.append(el('span', { text: `${count} to approve` }));
      queueBadge.onclick = () => openDrawer('queue');
    } else {
      queueBadge.classList.add('hidden');
    }
  } else if (isSignedIn()) {
    const mine = myPending().length;
    if (mine) {
      queueBadge.classList.remove('hidden');
      queueBadge.append(el('span', { text: `${mine} pending` }));
      queueBadge.onclick = () => openDrawer('queue');
    } else {
      queueBadge.classList.add('hidden');
    }
  } else {
    queueBadge.classList.add('hidden');
  }

  const strip = qs('#offline-strip');
  const pending = outboxSummary();
  if (pending.count) {
    strip.classList.remove('hidden');
    // Say why it is stuck, otherwise a permanently failing queue just looks like
    // a slow network.
    const why = S.settings.lastError ? ` - ${S.settings.lastError}` : '';
    strip.textContent = `${pending.count} change${pending.count === 1 ? '' : 's'} waiting to sync${why}`;
  } else {
    strip.classList.add('hidden');
  }
}

function openDrawer(section = 'connection') {
  const drawer = qs('#drawer');
  const wasHidden = drawer.classList.contains('hidden');
  drawer.classList.remove('hidden');
  settings.openSection(section);
  if (wasHidden) slide(drawer, 'forward');
}

function closeDrawer() {
  const drawer = qs('#drawer');
  if (prefersReducedMotion()) {
    drawer.classList.add('hidden');
    return;
  }
  drawer.classList.add('drawer-out');
  const done = () => {
    drawer.classList.add('hidden');
    drawer.classList.remove('drawer-out');
  };
  drawer.addEventListener('animationend', done, { once: true });
  setTimeout(done, 260);
}

async function detectSite() {
  let host = '';
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tabs && tabs[0] && tabs[0].url;
    if (url && /^https?:/i.test(url)) host = normalizeHost(url);
  } catch {
    host = '';
  }
  if (host === lastDetectedHost) return;
  lastDetectedHost = host;

  if (host) {
    const known = S.sites.find((s) => s.host === host);
    if (known) {
      S.activeHost = host;
      known.lastSeen = new Date().toISOString();
      save();
    } else if (isLocalHost(host)) {
      S.activeHost = host;
    }
  }
  renderHeader();
  if (activeTab === 'checklist') safeRender('checklist');
}

async function doSync({ quiet = false } = {}) {
  if (!isConfigured()) {
    if (!quiet) toast('Sheet not configured yet - open Settings.', 'error');
    return;
  }
  try {
    const { problems } = await readAll();
    const flush = await flushOutbox();
    if (isSignedIn()) await refreshPending();
    if (flush && flush.error) {
      // Persist the reason so the strip can explain itself, and be honest about
      // what did not make it.
      setSettings({ lastSyncOk: false, lastError: flush.error });
      saveNow();
      renderHeader();
      if (!quiet) {
        toast(
          flush.blocked
            ? `${flush.error} (${flush.blocked} change${flush.blocked === 1 ? '' : 's'} still queued)`
            : flush.error,
          'error'
        );
      }
      renderActive();
      return;
    }
    if (flush && flush.flushed) setSettings({ lastSyncOk: true, lastError: '' });
    if (problems && problems.length) {
      toast(`Sync problems: ${problems[0]}`, 'error');
    } else if (!quiet) {
      toast('Synced.', 'success');
    }
    renderActive();
  } catch (err) {
    if (!quiet) toast(readableError(err.message), 'error');
  }
}

const maybeAutoSync = debounce(async () => {
  if (autosyncRunning || !isConfigured() || !S.settings.autoSync) return;
  const last = S.settings.lastSyncAt ? new Date(S.settings.lastSyncAt).getTime() : 0;
  if (Date.now() - last < 120000) return;
  autosyncRunning = true;
  try {
    await doSync({ quiet: true });
  } finally {
    autosyncRunning = false;
  }
}, 500);

export async function onSignedIn() {
  await doSync({ quiet: true });
  renderActive();
}

function wire() {
  for (const btn of document.querySelectorAll('.tab')) {
    btn.addEventListener('click', () => setTab(btn.dataset.tab));
  }

  qs('#btn-settings').addEventListener('click', () => openDrawer('connection'));
  qs('#btn-sync').addEventListener('click', () => doSync());
  qs('#drawer-close').addEventListener('click', closeDrawer);
  qs('#drawer').addEventListener('click', (e) => {
    if (e.target.id === 'drawer') closeDrawer();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !qs('#drawer').classList.contains('hidden')) closeDrawer();
  });

  document.addEventListener('devpad:changed', () => renderActive());
// Status-only updates repaint the header strip without rebuilding the open panel,
// so a failed save can be reported without discarding an in-progress edit.
document.addEventListener('devpad:status', () => renderHeader());

  window.addEventListener('focus', () => {
    detectSite();
    maybeAutoSync();
  });

  if (!isConfigured()) {
    openDrawer('connection');
    toast('Start with the Connection section in Settings.', 'info');
  }
}

async function boot() {
  await loadState();
  activeTab = TABS[S.ui.tab] ? S.ui.tab : 'snippets';
  settings.attach(qs('#drawer-body'));
  wire();
  renderActive();
  setTimeout(async () => {
    await detectSite();
    if (isSignedIn()) await refreshPending();
    maybeAutoSync();
  }, 350);
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'devpad:reopen') openDrawer(msg.section || 'connection');
    return false;
  });
}

boot();
