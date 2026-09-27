/**
 * Boots the built panel in jsdom and clicks through the UI.
 * Run: node build.mjs --check && node tools/dom-smoke.mjs
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'dist/sidepanel.html'), 'utf8');
const bundle = readFileSync(resolve(root, 'dist/sidepanel.js'), 'utf8');

let failed = 0;
const check = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else {
    failed += 1;
    console.log(`  FAIL ${name} ${extra}`);
  }
};

const failures = [];
process.on('unhandledRejection', (err) => failures.push(err));

const stub = (win) => {
  win.HTMLElement = win.HTMLElement;
  if (!win.ResizeObserver) win.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
};

/**
 * Fake the Apps Script endpoint so queued writes have somewhere to go.
 * `rejectItemIds` makes one specific queued op fail, which is how we prove a bad
 * entry no longer wedges everything behind it.
 */
const installFetch = (win, { rejectItemIds = [] } = {}) => {
  const calls = [];
  win.fetch = async (url, init) => {
    let body = {};
    try {
      body = JSON.parse((init && init.body) || '{}');
    } catch {}
    calls.push({ url: String(url), action: body.action, body });
    if (rejectItemIds.includes(body.itemId)) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: false, error: 'PROGRESS_ARGS_REQUIRED' })
      };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, version: 5, row: 2 }) };
  };
  return calls;
};

function makeDom(seedState, tabUrl) {
  const errorLog = [];
  const IGNORE = /getClientRects|getBoundingClientRect|not implemented|createRange/i;
  const note = (e) => {
    const msg = (e && (e.message || e.detail)) || String(e);
    if (!IGNORE.test(msg)) errorLog.push(e);
  };
  const vc = new VirtualConsole();
  vc.on('jsdomError', note);
  vc.on('error', (...a) => note(a.join(' ')));

  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const win = dom.window;
  stub(win);

  globalThis.window = win;
  globalThis.document = win.document;
  Object.defineProperty(globalThis, 'navigator', { value: win.navigator, configurable: true });
  globalThis.HTMLElement = win.HTMLElement;
  globalThis.Node = win.Node;
  globalThis.CustomEvent = win.CustomEvent;
  globalThis.Event = win.Event;
  globalThis.Blob = win.Blob;
  globalThis.FileReader = win.FileReader;
  globalThis.getComputedStyle = win.getComputedStyle.bind(win);
  globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  globalThis.ResizeObserver = win.ResizeObserver;

  const store = seedState ? { 'devpad.state': seedState } : { 'devpad.state': undefined };
  const chromeStub = {
    storage: {
      local: {
        get: async (k) => (typeof k === 'string' ? { [k]: store[k] } : {}),
        set: async (obj) => Object.assign(store, obj)
      },
      onChanged: { addListener() {} }
    },
    runtime: { onMessage: { addListener() {} }, sendMessage: async () => {} },
    tabs: { query: async () => [{ url: tabUrl || 'https://www.example.com/some-page' }] }
  };
  globalThis.chrome = chromeStub;
  win.chrome = chromeStub;

  try {
    win.eval(bundle);
  } catch (err) {
    errorLog.push(err);
  }
  dom.errorLog = errorLog;
  dom.store = store;
  return dom;
}

const isHidden = (node) => node.classList.contains('hidden');
const $ = (sel) => window.document.querySelector(sel);

const click = (node) => {
  node.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
};
const dom = makeDom(null);
const { window } = dom;
const errors = dom.errorLog;

await new Promise((r) => setTimeout(r, 700));

console.log('boot');
check('no load-time error', errors.length === 0, errors.map((e) => e.message).join(' | '));
check('snippets panel rendered', $('#panel-snippets').children.length > 0, `${$('#panel-snippets').children.length} children`);
check('snippets locked without a sign-in', !!$('.lock'), 'no .lock element');
check('lock screen asks for a name, not a key', !$('.lock').textContent.includes('access key'), $('.lock').textContent.slice(0, 80));
check('lock screen has both fields', !!$('.lock input[type="text"]') && !!$('.lock input[type="password"]'),
  `text=${!!$('.lock input[type="text"]')} password=${!!$('.lock input[type="password"]')}`);
check('lock screen has a sign-in button', $('.lock').textContent.includes('Sign in'), $('.lock').textContent.slice(0, 60));
check('header site line populated', $('#site-line').textContent.includes('example.com'), $('#site-line').textContent);
check('checklist panel hidden initially', isHidden($('#panel-checklist')));

console.log('settings button');
check('drawer auto-opens when unconfigured', !isHidden($('#drawer')));
click($('#drawer-close'));
await new Promise((r) => setTimeout(r, 320));
check('drawer close button hides it', isHidden($('#drawer')));
check('drawer out class is cleaned up', !$('#drawer').classList.contains('drawer-out'), $('#drawer').className);
click($('#btn-settings'));
await new Promise((r) => setTimeout(r, 150));
check('drawer reopens on settings click', !isHidden($('#drawer')));
check('drawer has nav tabs', window.document.querySelectorAll('.drawer-tab').length === 5,
  `${window.document.querySelectorAll('.drawer-tab').length} tabs`);
check('connection section rendered', $('#drawer-body').textContent.includes('Google Sheet'));
check('stepper shows 3 dots', window.document.querySelectorAll('#drawer-body .stepper-dot').length === 3,
  `${window.document.querySelectorAll('#drawer-body .stepper-dot').length} dots`);
check('first dot is current', window.document.querySelectorAll('#drawer-body .stepper-dot-now').length === 1);
check('step 1 label', $('#drawer-body .stepper-label').textContent.includes('Step 1 of 3 - Google Sheet'),
  $('#drawer-body .stepper-label').textContent);
check('step 1 shows one input', window.document.querySelectorAll('#drawer-body input').length === 1,
  `${window.document.querySelectorAll('#drawer-body input').length} inputs`);
check('field labels are not empty', window.document.querySelectorAll('#drawer-body .field').length === 1
  && $('#drawer-body .field').textContent.trim().length > 5);
check('back is disabled on first step', window.document.querySelector('#drawer-body .step-back').disabled === true);

console.log('first-run wizard navigation');
const body = () => $('#drawer-body');
const nextBtn = () => Array.from(window.document.querySelectorAll('#drawer-body .step-nav .btn')).pop();
nextBtn().click();
await new Promise((r) => setTimeout(r, 40));
check('step 2 reached', body().querySelector('.stepper-label').textContent.includes('Step 2 of 3 - Web app'),
  body().querySelector('.stepper-label').textContent);
check('step 2 slid in from the right', body().querySelector('.step-body').classList.contains('slide-in-forward'));
check('step 1 dot marked done', body().querySelectorAll('.stepper-dot-done').length === 1);
check('step 2 hint mentions exec', body().textContent.includes('/exec URL'));

nextBtn().click();
await new Promise((r) => setTimeout(r, 40));
check('step 3 reached', body().querySelector('.stepper-label').textContent.includes('Step 3 of 3 - Test and seed'),
  body().querySelector('.stepper-label').textContent);
check('two dots marked done', body().querySelectorAll('.stepper-dot-done').length === 2);
check('step 3 has three action buttons', body().querySelectorAll('.btn-row button').length === 3,
  `${body().querySelectorAll('.btn-row button').length} buttons`);
check('status list has 5 rows', body().querySelectorAll('.status-list > div').length === 5,
  `${body().querySelectorAll('.status-list > div').length} rows`);
check('step 3 test/seed/sync buttons', ['Test connection', 'Create tabs & seed', 'Sync now'].every((t) => body().textContent.includes(t)));
check('step 3 has no first-admin-key bootstrap', !body().textContent.includes('Create first admin key'));

const backBtn = () => body().querySelector('.step-nav .step-back');
backBtn().click();
await new Promise((r) => setTimeout(r, 40));
check('back returns to step 2', body().querySelector('.stepper-label').textContent.includes('Step 2 of 3 - Web app'));
check('step 2 slid in from the left', body().querySelector('.step-body').classList.contains('slide-in-back'));
check('back now enabled', body().querySelector('.step-nav .step-back').disabled === false);
check('only one step body rendered', body().querySelectorAll('.step-body').length === 1,
  `${body().querySelectorAll('.step-body').length} bodies`);

// Let the animation timers drain and confirm nothing is left stuck.
await new Promise((r) => setTimeout(r, 500));
check('slide classes cleaned up', !body().querySelector('.step-body').className.includes('slide-'),
  body().querySelector('.step-body').className);

console.log('drawer sections');
const sectionNames = Array.from(window.document.querySelectorAll('.drawer-tab')).map((n) => n.textContent);
for (const [i, expected] of ['Connection', 'Access', 'Approvals', 'Sites', 'Data'].entries()) {
  check(`section ${i} is ${expected}`, sectionNames[i] === expected, sectionNames[i]);
}
click(window.document.querySelectorAll('.drawer-tab')[1]);
await new Promise((r) => setTimeout(r, 80));
check('access section explains the prerequisite', $('#drawer-body').textContent.includes('Finish the Connection section first'));
click(window.document.querySelectorAll('.drawer-tab')[3]);
await new Promise((r) => setTimeout(r, 80));
check('sites section renders', $('#drawer-body').textContent.includes('Add a site'));
click(window.document.querySelectorAll('.drawer-tab')[4]);
await new Promise((r) => setTimeout(r, 80));
check('data section renders', $('#drawer-body').textContent.includes('Export JSON'));
click(window.document.querySelectorAll('.drawer-tab')[0]);
await new Promise((r) => setTimeout(r, 80));
check('connection section keeps its step after tabbing away', ($('#drawer-body .stepper-label') || { textContent: 'missing' }).textContent.includes('Step 2 of 3'),
  ($('#drawer-body .stepper-label') || { textContent: 'missing' }).textContent);

console.log('close and tabs');
click($('#drawer-close'));
await new Promise((r) => setTimeout(r, 320));
check('drawer closes', isHidden($('#drawer')));

click(window.document.querySelector('.tab[data-tab="checklist"]'));
await new Promise((r) => setTimeout(r, 40));
check('forward tab slides in from the right', $('#panel-checklist').classList.contains('slide-in-forward'));
await new Promise((r) => setTimeout(r, 120));
check('checklist tab active', $('#panel-checklist').classList.contains('panel-active'));
check('previous panel was pushed left', $('#panel-snippets').classList.contains('slide-push-left'),
  $('#panel-snippets').className);
check('checklist shows no-sites state', $('#panel-checklist').textContent.includes('No sites yet'), $('#panel-checklist').textContent.slice(0, 60));

click(window.document.querySelector('.tab[data-tab="handbook"]'));
await new Promise((r) => setTimeout(r, 200));
check('handbook tab active', $('#panel-handbook').classList.contains('panel-active'));
check('handbook renders list or empty', $('#panel-handbook').children.length > 0);
check('handbook empty state explains seeding', $('#panel-handbook').textContent.includes('No articles yet'));

click(window.document.querySelector('.tab[data-tab="snippets"]'));
await new Promise((r) => setTimeout(r, 80));
check('snippets tab active again', $('#panel-snippets').classList.contains('panel-active'));
check('still locked', !!$('.lock'));

console.log('offline queue strip');
check('no stray error strip', isHidden($('#offline-strip')));

console.log('configured + signed in (scenario 2)');
const seededState = {
  version: 1,
  settings: {
    sheetId: '1SheetIdGoesHere0000000',
    webAppUrl: 'https://script.google.com/macros/s/AKfy/exec',
    appVersion: '5',
    setupDone: true,
    autoSync: true,
    lastSyncAt: '2026-09-26T10:00:00.000Z',
    lastSyncOk: true,
    lastError: ''
  },
  session: { userId: 'u1', name: 'Me', password: 'pw1', role: 'admin' },
  sites: [
    { row: 2, host: 'example.com', label: 'example.com', added: '2026-09-01T00:00:00.000Z', lastSeen: '2026-09-26T00:00:00.000Z' },
    { row: 3, host: 'shop.test', label: 'Shop', added: '2026-09-02T00:00:00.000Z', lastSeen: '2026-09-25T00:00:00.000Z' }
  ],
  activeHost: 'example.com',
  snippets: [
    { row: 2, id: 'wp_head_cleanup', title: 'Clean wp_head', language: 'php', category: 'hooks', description: 'Strip emoji + generator', code: "<?php\nremove_action('wp_head', 'print_emoji_detection_script', 7);", tags: 'head,cleanup', updated: '2026-09-20T00:00:00.000Z' },
    { row: 3, id: 'wp_defer_js', title: 'Defer JS', language: 'js', category: 'performance', description: '', code: "add_filter('script_loader_tag', function ($t) { return $t; });", tags: 'perf', updated: '2026-09-21T00:00:00.000Z' }
  ],
  checklist: [
    { row: 2, id: 'chk_1', category: 'Pre-Deploy', item: 'Enable maintenance mode', detail: '', order: '1' },
    { row: 3, id: 'chk_2', category: 'Pre-Deploy', item: 'Purge page cache', detail: '', order: '2' },
    { row: 4, id: 'chk_3', category: 'Security', item: 'Force HTTPS', detail: '', order: '1' }
  ],
  handbook: [
    { row: 2, id: 'hb_1', section: 'Blocks', title: 'Inner blocks', content: '## Inner blocks\n\nUse `innerBlocks`.', updated: '2026-09-22T00:00:00.000Z' }
  ],
  progress: {
    'example.com::chk_1': { done: true, note: '', updated: '2026-09-25T00:00:00.000Z' },
    'example.com::chk_2': { done: true, note: 'done in staging', updated: '2026-09-25T00:00:00.000Z' }
  },
  pending: [
    { row: 2, changeId: 'c1', op: 'append', tab: 'Snippets', row: 0, payload: { id: 'x', title: 'T' }, requestedBy: 'Me', requestedAt: '2026-09-26T00:00:00.000Z', status: 'Pending', decidedBy: '', decidedAt: '', reason: '' }
  ],
  outbox: [],
  ui: { tab: 'snippets', q: '', lang: 'all', category: 'all', selectedSnippet: null, handbookQ: '', handbookSection: 'all', queueFilter: 'Pending', checklistScope: 'site' }
};
const dom2 = makeDom(seededState);
const errors2 = dom2.errorLog;

await new Promise((r) => setTimeout(r, 800));
const d2 = dom2.window.document;
const q2 = (s) => d2.querySelector(s);
const all2 = (s) => Array.from(d2.querySelectorAll(s));
const click2 = (n) => n.dispatchEvent(new dom2.window.MouseEvent('click', { bubbles: true, cancelable: true }));
const wait2 = (ms) => new Promise((r) => setTimeout(r, ms));

check('2: no load-time error', errors2.length === 0, errors2.map((e) => (e.message || e) + '').join(' | '));
check('2: drawer stays closed when configured', isHidden(q2('#drawer')));
check('2: snippets unlocked', !q2('.lock'), 'still showing .lock');
check('2: both snippets listed', all2('#panel-snippets .row').length === 2, `${all2('#panel-snippets .row').length} rows`);
check('2: snippet titles visible', q2('#panel-snippets').textContent.includes('Clean wp_head') && q2('#panel-snippets').textContent.includes('Defer JS'));
check('2: language filter options', all2('#panel-snippets select').length >= 2, `${all2('#panel-snippets select').length} selects`);
 check('2: new snippet button sits in the list footer', !!q2('#panel-snippets .list-footer .btn-primary')
   && q2('#panel-snippets .list-footer .btn-primary').textContent.includes('New snippet'),
   q2('#panel-snippets .list-footer') ? q2('#panel-snippets .list-footer').textContent : 'no footer');
 check('2: toolbar no longer duplicates the create button',
   q2('#panel-snippets .toolbar').textContent.indexOf('New snippet') === -1,
   q2('#panel-snippets .toolbar').textContent.replace(/\s+/g, ' '));
check('2: role chip shows name and role', /admin/i.test(q2('#role-chip').textContent) && !q2('#role-chip').classList.contains('hidden'),
  `${q2('#role-chip').textContent} hidden=${q2('#role-chip').classList.contains('hidden')}`);
check('2: queue strip hidden with empty outbox', isHidden(q2('#offline-strip')));

console.log('2: snippet search + editor');
{
  // The snippets panel only renders when it is the active tab, so select it first.
  click2(all2('.tab[data-tab="snippets"]')[0]);
  await new Promise((r) => setTimeout(r, 150));
  const first = q2('#panel-snippets .list .row');
  check('snippet list has rows', !!first, `${all2('#panel-snippets .list .row').length} rows`);
  click2(first);
  await new Promise((r) => setTimeout(r, 60));
  const detail = q2('#snip-detail');
  check('detail takes over the whole tab', q2('#panel-snippets .split').classList.contains('split-takeover'),
    q2('#panel-snippets .split').className);
  check('snippet detail slides in from the right', detail.classList.contains('slide-in-forward'), detail.className);
  check('snippet detail has a back control', !!detail.querySelector('.back-btn'));
  check('back control is labelled', detail.querySelector('.back-btn').textContent.includes('Snippets'),
    detail.querySelector('.back-btn').textContent);
  click2(detail.querySelector('.back-btn'));
  await new Promise((r) => setTimeout(r, 60));
  check('closing detail slides the list back in from the left',
    q2('#panel-snippets .list').classList.contains('slide-in-back'), q2('#panel-snippets .list').className);
 check('list mode leaves the detail empty and unclaimed',
   !q2('#panel-snippets .split').classList.contains('split-takeover')
   && q2('#snip-detail').textContent.trim() === '',
   `takeover=${q2('#panel-snippets .split').classList.contains('split-takeover')} detail="${q2('#snip-detail').textContent.trim()}"`);
 check('list comes back with the search box', !!q2('#panel-snippets .toolbar input[type="search"]'));
}

// jsdom never loads sidepanel.css, so layout rules are checked as source.
{
  const css = readFileSync(resolve(root, 'sidepanel/sidepanel.css'), 'utf8');
  const hidesDetail = /\.split\s*>\s*\.detail\s*\{[^}]*display:\s*none/.test(css);
  const fullList = /\.split\s*>\s*\.list-pane\s*\{[^}]*height:\s*100%/.test(css);
  const squeeze = /\.split-takeover\s*>\s*\.list-pane\s*\{[^}]*display:\s*none/.test(css);
  const full = /\.split-takeover\s*>\s*\.detail\s*\{[^}]*height:\s*100%/.test(css);
  check('list mode hides the detail pane', hidesDetail);
  check('list mode gives the list full height', fullList);
  check('takeover hides the list pane', squeeze);
  check('takeover gives the detail full height', full);
  check('no leftover split grid', !/grid-template-rows:\s*minmax\(130px/.test(css));
  check('motion honours prefers-reduced-motion', /@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(css));
}

console.log('2: create from the footer');
{
  click2(q2('#panel-snippets .list-footer .btn-primary'));
  await new Promise((r) => setTimeout(r, 120));
  check('footer button opens a new snippet', q2('#snip-title') !== null);
  check('new snippet takes over the tab', q2('#panel-snippets .split').classList.contains('split-takeover'),
    q2('#panel-snippets .split').className);
  check('new snippet is titled as new', q2('#panel-snippets .detail-head h2').textContent === 'New snippet',
    q2('#panel-snippets .detail-head h2').textContent);
  check('new snippet has a back button', !!q2('#snip-detail .back-btn'));
  click2(q2('#snip-detail .back-btn'));
  await new Promise((r) => setTimeout(r, 120));
  check('back discards the draft and returns to the list',
    !q2('#panel-snippets .split').classList.contains('split-takeover'),
    q2('#panel-snippets .split').className);
  check('no draft was added to the list', all2('#panel-snippets .list .row').length === 2,
    `${all2('#panel-snippets .list .row').length} rows`);
}

console.log('2: syntax highlighting');
{
  // Pick a snippet whose language has a real grammar, so the tree is non-trivial.
  const rows = all2('#panel-snippets .list .row');
  let target = null;
  for (const r of rows) {
    if (/php|javascript|typescript|json|sql|python|html|css/i.test(r.textContent)) { target = r; break; }
  }
  check('found a snippet with a real grammar', !!target, rows.map((r) => r.textContent.replace(/\s+/g, ' ').slice(0, 40)).join(' | '));
  click2(target);
  await new Promise((r) => setTimeout(r, 300));
  const editors = Array.from(dom2.window.__wpdEditors || []);
  check('editor registered for inspection', editors.length > 0, `${editors.length} editors`);
  const debugInfo = editors.map((e) => {
    try {
      return e.debug();
    } catch (err) {
      return { error: String(err && err.message) };
    }
  });
  const info = debugInfo.filter((d) => !d.error && d.nodeCount > 5).pop()
    || debugInfo[debugInfo.length - 1] || null;
  check('editor exposes debug info', !!info && !info.error, info && info.error ? info.error : 'none');
  if (info) {
    check(`language loaded (${info.lang})`, info.lang && info.lang !== 'plaintext', info.lang);
    check('language field installed in editor state', info.hasLanguageField === true, JSON.stringify(info));
    check('grammar produced a real root node', !!info.topType && info.topType !== 'Text', info.topType);
    check('editor rendered token spans', info.tokenSpans > 0, `${info.tokenSpans} spans`);
    check('tokens are coloured from our palette', info.paletteColorsOnTokens > 0,
      `${info.paletteColorsOnTokens} palette colours on tokens, ${info.distinctColors} distinct`);
    check('theme colours reached the stylesheet', info.paletteInjected >= 10,
      `${info.paletteInjected}/${info.paletteSize} palette colours present`);
  }

  // Switching the language dropdown has to re-highlight, not just store the value.
  const sel = q2('#snip-language');
  const before = Array.from(dom2.window.__wpdEditors).map((e) => e.debug().lang);
  sel.value = 'python';
  sel.dispatchEvent(new dom2.window.Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 250));
  const after = Array.from(dom2.window.__wpdEditors).map((e) => e.debug().lang);
  check('language dropdown re-highlights the editor', after.includes('python'),
    `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
  const pyInfo = Array.from(dom2.window.__wpdEditors).map((e) => e.debug()).pop();
  check('python grammar is active after the switch', pyInfo.hasLanguageField === true && pyInfo.tokenSpans > 0,
    JSON.stringify(pyInfo));
}

console.log('2: reduced motion');
{
  // Close the detail the highlighting block opened, so the next click is a real
  // navigation (select() ignores re-selecting the record already open).
  const backNow = q2('#snip-detail .back-btn');
  if (backNow) click2(backNow);
  await new Promise((r) => setTimeout(r, 80));
  // nav.js reads matchMedia at call time, so a stub is enough to exercise it.
  dom2.window.matchMedia = (q) => ({ matches: /reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
  const row = all2('#panel-snippets .list .row')[0];
  check('reduced motion: still a row to click', !!row);
  click2(row);
  await new Promise((r) => setTimeout(r, 80));
  check('reduced motion: detail opens instantly without animation',
    !q2('#snip-detail').className.includes('slide-'), q2('#snip-detail').className);
  check('reduced motion: detail still rendered', q2('#snip-detail').textContent.includes('Title'));
  delete dom2.window.matchMedia;
}
const search = all2('#panel-snippets input').find((n) => n.type === 'search');
if (search) {
  search.value = 'defer';
  search.dispatchEvent(new dom2.window.Event('input', { bubbles: true }));
  await wait2(300);
  check('2: search filters to 1 row', all2('#panel-snippets .row').length === 1, `${all2('#panel-snippets .row').length} rows`);
  search.value = '';
  search.dispatchEvent(new dom2.window.Event('input', { bubbles: true }));
  await wait2(300);
  check('2: clearing search restores 2 rows', all2('#panel-snippets .row').length === 2, `${all2('#panel-snippets .row').length} rows`);
} else check('2: search box found', false, 'no search input in snippets panel');

const firstRow = q2('#panel-snippets .row');
if (firstRow) {
  click2(firstRow);
  await wait2(500);
  check('2: opening a snippet mounts CodeMirror', !!q2('#panel-snippets .cm-editor'), 'no .cm-editor');
  check('2: code visible in editor', !!q2('#panel-snippets .cm-content') && q2('#panel-snippets .cm-content').textContent.includes('remove_action'),
    q2('#panel-snippets .cm-content') ? q2('#panel-snippets .cm-content').textContent.slice(0, 60) : 'no .cm-content');
  check('2: copy button present', q2('#panel-snippets').textContent.includes('Copy'));
} else {
  check('2: snippet row clickable', false, 'no rows rendered');
}

console.log('2: checklist');
click2(d2.querySelector('.tab[data-tab="checklist"]'));
await wait2(250);
check('2: checklist rows rendered', all2('#panel-checklist .item').length === 3, `${all2('#panel-checklist .item').length} rows`);
check('2: categories shown', q2('#panel-checklist').textContent.includes('Pre-Deploy') && q2('#panel-checklist').textContent.includes('Security'));
const checked = all2('#panel-checklist input[type="checkbox"]').filter((n) => n.checked);
check('2: 2 items ticked for example.com', checked.length === 2, `${checked.length} ticked`);
check('2: tally shown in header', /\d+\s*\/\s*3/.test(q2('#panel-checklist').textContent),
  q2('#panel-checklist').textContent.replace(/\s+/g, ' ').slice(0, 80));

console.log('2: checklist with no active host');
{
  // Reproduces the reported bug from a cold boot: sites are tracked but nothing is
  // selected, so the <select> showed the first site while writes sent host='' and
  // the sheet rejected them with the misleading PROGRESS_KEY_REQUIRED.
  const dom4 = makeDom({
    ...JSON.parse(JSON.stringify(seededState)),
    activeHost: '',
    progress: { 'shop.test::chk_1': { done: true, note: '', updated: '2026-09-25T00:00:00.000Z' } },
    ui: { ...seededState.ui, tab: 'checklist' }
  }, 'https://news.ycombinator.com/');
  const errors4 = dom4.errorLog;
  await new Promise((r) => setTimeout(r, 800));
  const d4 = dom4.window.document;
  const q4 = (s) => d4.querySelector(s);
  const all4 = (s) => Array.from(d4.querySelectorAll(s));
  const wait4 = (ms) => new Promise((r) => setTimeout(r, ms));

  check('4: no load-time error', errors4.length === 0, errors4.map((e) => (e.message || e) + '').join(' | '));
  const sel = q4('#panel-checklist select');
  check('4: site picker falls back to a real site', !!sel && !!sel.value, sel ? sel.value : 'no select');
  check('4: fallback is the first tracked site', sel && sel.value === 'example.com', sel ? sel.value : 'none');
  check('4: counts come from the displayed site, not an empty host',
    q4('#check-overall-count').textContent === '0/3', q4('#check-overall-count').textContent);

  // Tick an item, then confirm progress was recorded against the displayed site.
  const boxes = all4('#panel-checklist input[type="checkbox"]');
  check('4: rows rendered', boxes.length === 3, `${boxes.length}`);
  boxes[0].checked = true;
  boxes[0].dispatchEvent(new dom4.window.Event('change', { bubbles: true }));
  await wait4(600);
  const state = dom4.store['devpad.state'];
  check('4: progress stored under the displayed host', !!(state.progress || {})['example.com::chk_1'],
    Object.keys(state.progress || {}).join(', '));
  check('4: nothing was written with an empty host',
    !Object.keys(state.progress || {}).some((k) => k.startsWith('::')),
    Object.keys(state.progress || {}).join(', '));
  check('4: header tally updated to 1/3', q4('#check-overall-count').textContent === '1/3',
    q4('#check-overall-count').textContent);
  check('4: no REQUIRED error surfaced',
    !q4('#toasts').textContent.includes('REQUIRED') && !q4('#panel-checklist').textContent.includes('REQUIRED'),
    q4('#toasts').textContent.replace(/\s+/g, ' ').slice(0, 90));
  if (errors4.length) console.log('jsdom errors (4): ' + errors4.map((e) => e.message).join(' | '));
}

console.log('2: saving a snippet reaches the sheet');
{
  // The save button had no automated coverage at all, which is how "clicking Save
  // does nothing and shows no sign of working" could ship.
  const calls2 = installFetch(dom2.window);
  // Open a row the way a user does, then save it.
  const row2 = all2('#panel-snippets .list .row').find((r) => /Defer JS/.test(r.textContent));
  check('2: a snippet row to edit', !!row2, `${all2('#panel-snippets .list .row').length} rows`);
  row2.click();
  await wait2(400);
  const saveBtn = q2('#snip-save');
  check('2: the save button exists in the detail', !!saveBtn, 'no #snip-save');
  check('2: the title field exists', !!q2('#snip-title'), 'no #snip-title');

  if (saveBtn) {
    // Give it a visible change so the write is observable.
    const title2 = q2('#snip-title');
    title2.value = 'Defer JS edited';
    saveBtn.click();
    await wait2(700);
    const actions = calls2.map((c) => c.action);
    check('2: saving posted to the web app',
      actions.some((a) => a === 'updateRow' || a === 'appendRow'), `actions: ${[...new Set(actions)].join(', ') || 'none'}`);
    const write = calls2.find((c) => c.action === 'updateRow' || c.action === 'appendRow');
    check('2: the write carried a real payload', !!write && !!(write.body.values || write.body.row),
      write ? JSON.stringify(write.body).slice(0, 120) : 'no write');
    const toasts = q2('#toasts').textContent.replace(/\s+/g, ' ');
    check('2: the user was told the outcome', /Saved|approval|failed|waiting/i.test(toasts), toasts.slice(0, 100));
    check('2: the edit is not still queued', (dom2.store['devpad.state'].outbox || []).length === 0,
      `outbox=${(dom2.store['devpad.state'].outbox || []).length}`);
  }
}

console.log('2: handbook article');
click2(d2.querySelector('.tab[data-tab="handbook"]'));
await wait2(300);
check('2: handbook lists the article', q2('#panel-handbook').textContent.includes('Inner blocks'), q2('#panel-handbook').textContent.replace(/\s+/g, ' ').slice(0, 60));
const hbRow = all2('#panel-handbook .row')[0];
if (hbRow) {
  click2(hbRow);
  await wait2(350);
  check('2: article body rendered', q2('#panel-handbook').textContent.includes('innerBlocks'));
  check('2: back button present', q2('#panel-handbook').querySelector('.back-btn') !== null
   && q2('#panel-handbook .back-btn').textContent.includes('Index'),
   q2('#panel-handbook .back-btn') ? q2('#panel-handbook .back-btn').textContent : 'missing');
  check('2: article view slides in from the right', q2('#panel-handbook').classList.contains('slide-in-forward'),
    q2('#panel-handbook').className);
  click2(q2('#panel-handbook .back-btn'));
  await wait2(120);
  check('2: handbook index slides back in', q2('#panel-handbook').classList.contains('slide-in-back'),
    `class="${q2('#panel-handbook').className}" stillArticle=${q2('#panel-handbook').textContent.includes('innerBlocks')} backBtns=${all2('#panel-handbook .back-btn').length} rows=${all2('#panel-handbook .row').length}`);
  check('2: article list is back', q2('#panel-handbook').textContent.includes('Inner blocks'));
}

console.log('2: drawer as admin');
click2(q2('#btn-settings'));
await wait2(200);
check('2: connection status shows version', q2('#drawer-body').textContent.includes('Web app version'));
check('2: drawer has 5 section tabs', all2('.drawer-tab').length === 5, `${all2('.drawer-tab').length} tabs`);
click2(all2('.drawer-tab')[1]);
await wait2(250);
check('2: access shows session', q2('#drawer-body').textContent.includes('Sign out'));
check('2: first admin block gone for everyone', !q2('#drawer-body').textContent.includes('Create first admin key'));
check('2: admin gets People management', q2('#drawer-body').textContent.includes('People'), q2('#drawer-body').textContent.replace(/\s+/g, ' ').slice(0, 120));
click2(all2('.drawer-tab')[2]);
await wait2(300);
check('2: approvals lists the pending change', q2('#drawer-body').textContent.includes('Snippets'), q2('#drawer-body').textContent.replace(/\s+/g, ' ').slice(0, 90));
check('2: approve button for admin', q2('#drawer-body').textContent.includes('Approve'));
click2(all2('.drawer-tab')[3]);
await wait2(150);
check('2: sites section lists both sites', q2('#drawer-body').textContent.includes('example.com') && q2('#drawer-body').textContent.includes('shop.test'));
check('2: site tallies listed', /\d+\s*\/\s*\d+/.test(q2('#drawer-body').textContent), q2('#drawer-body').textContent.replace(/\s+/g, ' ').slice(0, 120));

console.log('2: editor role (read-only approvals)');
const dom3 = makeDom({
  ...JSON.parse(JSON.stringify(seededState)),
  session: { userId: 'u2', name: 'Ed', password: 'pw2', role: 'editor' }
});
const errors3 = dom3.errorLog;
await new Promise((r) => setTimeout(r, 800));
const d3 = dom3.window.document;
const q3 = (s) => d3.querySelector(s);
const all3 = (s) => Array.from(d3.querySelectorAll(s));
check('3: no load-time error', errors3.length === 0, errors3.map((e) => (e.message || e) + '').join(' | '));
check('3: snippets unlocked for editor', !q3('.lock'));
q3('#btn-settings').dispatchEvent(new dom3.window.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 200));
all3('.drawer-tab')[2].dispatchEvent(new dom3.window.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 200));
check('3: editor sees queue without Approve', !q3('#drawer-body').textContent.includes('Approve'), q3('#drawer-body').textContent.replace(/\s+/g, ' ').slice(0, 90));
all3('.drawer-tab')[1].dispatchEvent(new dom3.window.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 150));
check('3: editor gets no People management', !q3('#drawer-body').textContent.includes('People'));
check('3: editor sees admin-approval notice', q3('#drawer-body').textContent.includes('queued until an admin'));

console.log('5: a stuck change must not block the rest of the queue');
{
  // The reported symptom was "10 changes waiting to sync" that never drained,
  // because the flush stopped at the first failure and one unsendable progress
  // op sat at the head of the FIFO.
  const state5 = JSON.parse(JSON.stringify(seededState));
  state5.ui = { ...state5.ui, tab: 'checklist' };
  state5.outbox = [
    { id: 'o_bad', tab: 'Progress', op: 'progress', host: 'example.com', itemId: 'chk_bad', done: true, note: '', createdAt: '2026-09-26T10:00:00.000Z' },
    { id: 'o_1', tab: 'Progress', op: 'progress', host: 'example.com', itemId: 'chk_2', done: true, note: '', createdAt: '2026-09-26T10:00:01.000Z' },
    { id: 'o_2', tab: 'Progress', op: 'progress', host: 'example.com', itemId: 'chk_3', done: true, note: '', createdAt: '2026-09-26T10:00:02.000Z' }
  ];
  const dom5 = makeDom(state5, 'https://news.ycombinator.com/');
  const errors5 = dom5.errorLog;
  const calls5 = installFetch(dom5.window, { rejectItemIds: ['chk_bad'] });
  await new Promise((r) => setTimeout(r, 800));
  const d5 = dom5.window.document;
  const q5 = (s) => d5.querySelector(s);
  const after = () => (dom5.store['devpad.state'].outbox || []).map((o) => o.id);

  // Force a flush the way a tick or the sync button would.
  q5('#panel-checklist input[type="checkbox"]');
  const box = d5.querySelectorAll('#panel-checklist input[type="checkbox"]')[0];
  box.checked = true;
  box.dispatchEvent(new dom5.window.Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 700));

  const tried = calls5.filter((c) => c.action === 'setProgress').map((c) => c.body.itemId);
  check('5: every queued change was attempted, not just the first',
    tried.includes('chk_bad') && tried.includes('chk_2') && tried.includes('chk_3'),
    `attempted: ${tried.join(', ')}`);
  check('5: the good changes behind the bad one were dropped from the queue',
    !after().includes('o_1') && !after().includes('o_2'), `still queued: ${after().join(', ')}`);
  check('5: only the unsendable change is left', after().length === 1 && after()[0] === 'o_bad',
    `still queued: ${after().join(', ')}`);
  check('5: the reason is human readable, not a raw code',
    !q5('#toasts').textContent.includes('_REQUIRED'), q5('#toasts').textContent.replace(/\s+/g, ' ').slice(0, 90));
  check('5: no load-time error', errors5.length === 0, errors5.map((e) => (e.message || e) + '').join(' | '));
  if (errors5.length) console.log('jsdom errors (5): ' + errors5.map((e) => e.message).join(' | '));
}

console.log('\nasync failures: ' + (failures.length ? failures.map((f) => f && f.message).join(' | ') : 'none'));
if (errors.length) console.log('jsdom errors: ' + errors.map((e) => e.message).join(' | '));
if (errors2.length) console.log(`jsdom errors (2): ${errors2.length} -> ` + errors2.map((e) => JSON.stringify({
  msg: e && e.message, type: e && e.type, str: String(e), stack: e && e.stack && String(e.stack).slice(0, 300)
})).join(' | '));
if (errors3.length) console.log('jsdom errors (3): ' + errors3.map((e) => e.message).join(' | '));

const bad = failed || errors.length || errors2.length || errors3.length || failures.length;
console.log(bad ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(bad ? 1 : 0);
