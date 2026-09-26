import { S, save, saveNow, setSettings, setUi, isAdmin, isSignedIn } from '../store.js';
import { LANGUAGES, SNIPPET_CATEGORIES } from '../schema.js';
import { queueAppend, queueUpdate, queueDelete, readAll, flushOutbox } from '../sheet.js';
import { changeTargets, myPending } from '../approval.js';
import { makeEditor } from '../editor.js';
import { el, clear, copyText, toast, uid, nowIso, debounce, fmtDate, asList } from '../util.js';
import { renderLock, isLocked, editorHint } from './lock.js';
import { slide, stagger } from './nav.js';

let shell = null;
let editor = null;
let current = null;
let isNewRecord = false;
let listNode = null;

/**
 * A save that quietly does nothing is the worst failure mode here, so every
 * failure goes to the toast, the console, and the header strip at once.
 */
function reportWriteFailure(message) {
  const text = message || 'Save failed.';
  console.error('[devpad] snippet save failed:', text, S.outbox);
  setSettings({ lastSyncOk: false, lastError: text });
  saveNow();
  // Header only: devpad:changed would rebuild the panel and throw away whatever
  // the user is still typing into this editor.
  document.dispatchEvent(new CustomEvent('devpad:status'));
  toast(text, 'error');
}
let detailNode = null;
let splitNode = null;

const filterSnippets = () => {
  const q = (S.ui.q || '').trim().toLowerCase();
  const lang = S.ui.lang;
  const category = S.ui.category;
  return S.snippets.filter((s) => {
    if (lang !== 'all' && s.language !== lang) return false;
    if (category !== 'all' && s.category !== category) return false;
    if (!q) return true;
    const hay = [s.title, s.description, s.language, s.category, asList(s.tags).join(' '), s.code]
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });
};

function snippetRow(snippet, pendingIds) {
  const isPending = pendingIds.has(snippet.id);
  const row = el('button', {
    class: 'row' + (current && current.id === snippet.id ? ' row-active' : ''),
    onclick: () => select(snippet.id)
  });
  row.append(
    el('span', { class: 'row-title', text: snippet.title || 'Untitled' }),
    el('span', { class: 'row-meta' },
      el('span', { class: 'chip chip-lang', text: snippet.language }),
      el('span', { class: 'chip', text: snippet.category }),
      isPending ? el('span', { class: 'chip chip-pending', text: 'pending' }) : null
    )
  );
  return row;
}

function refreshList() {
  if (!listNode) return;
  clear(listNode);
  const pendingIds = changeTargets('Snippets');
  const items = filterSnippets();

  if (!items.length) {
    listNode.append(
      el('div', { class: 'empty' },
        el('p', { text: S.snippets.length ? 'No snippets match those filters.' : 'No snippets yet.' }),
        S.snippets.length
          ? el('button', {
              class: 'btn btn-sm',
              text: 'Clear filters',
              onclick: () => {
                setUi({ q: '', lang: 'all', category: 'all' });
                render();
              }
            })
          : el('p', { class: 'muted', text: 'Use New snippet, or seed the starter set from Settings.' })
      )
    );
    return;
  }

  const byCategory = new Map();
  for (const s of items) {
    const key = s.category || 'Other';
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key).push(s);
  }
  for (const [category, list] of byCategory) {
    listNode.append(el('div', { class: 'row-group', text: `${category} (${list.length})` }));
    for (const s of list) listNode.append(snippetRow(s, pendingIds));
  }
}

function field(label, node, hint) {
  return el('label', { class: 'field' }, el('span', { class: 'field-label', text: label }), node,
    hint ? el('span', { class: 'field-hint', text: hint }) : null);
}

function collectFields(root) {
  if (!current) return;
  current.title = root.querySelector('#snip-title').value.trim();
  current.language = root.querySelector('#snip-language').value;
  current.category = root.querySelector('#snip-category').value.trim() || 'Other';
  current.description = root.querySelector('#snip-description').value.trim();
  current.tags = asList(root.querySelector('#snip-tags').value);
  current.code = editor ? editor.getDoc() : current.code;
  current.updated = nowIso();
}

async function saveCurrent() {
  if (!current) return;
  try {
    await runSave();
  } catch (err) {
    // A throw in here used to be an invisible unhandled rejection: no feedback on
    // the button, nothing written, no message. Never again.
    const btn = shell && shell.root && shell.root.querySelector('#snip-save');
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Save';
    }
    reportWriteFailure((err && err.message) || String(err));
  }
}

async function runSave() {
  // `shell` is { root }, not an element. Calling shell.querySelector threw a
  // TypeError on the first line, which is why Save appeared to do nothing at all.
  const root = shell.root.querySelector('#snip-detail');
  collectFields(root);

  if (!current.title) {
    toast('Give the snippet a title first.', 'error');
    return;
  }

  const existing = S.snippets.find((s) => s.id === current.id);
  const btn = root.querySelector('#snip-save');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  let result;
  try {
    result = existing && existing.row
      ? await queueUpdate('Snippets', current, existing.row)
      : await queueAppend('Snippets', current);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Save';
    reportWriteFailure(err.message);
    return;
  }

  btn.disabled = false;
  btn.textContent = 'Save';

  if (result && result.error) {
    reportWriteFailure(result.error);
    return;
  }

  // A write can also "succeed" as a queue entry while never reaching the sheet.
  // If anything is still queued afterwards, say so instead of claiming success.
  const stuck = (S.outbox || []).filter((o) => o.tab === 'Snippets').length;
  if (stuck) {
    reportWriteFailure(`${stuck} change${stuck === 1 ? '' : 's'} still waiting to sync - not in the sheet yet.`);
    return;
  }

  if (!existing) {
    S.snippets.unshift(current);
    save();
  }
  const row = (result.responses || []).map((r) => r.res && r.res.row).find(Boolean);
  if (row) current.row = row;
  save();

  isNewRecord = false;
  if (isAdmin()) {
    toast('Saved to the sheet.', 'success');
  } else {
    toast('Queued for admin approval.', 'info');
  }
  render();
}

async function deleteCurrent() {
  if (!current) return;
  if (!confirm(`Delete "${current.title}"?`)) return;

  const target = S.snippets.find((s) => s.id === current.id);
  if (target && target.row) {
    let result;
    try {
      result = await queueDelete('Snippets', target);
    } catch (err) {
      reportWriteFailure((err && err.message) || String(err));
      return;
    }
    if (result && result.error) {
      reportWriteFailure(result.error);
      return;
    }
    if (!isAdmin()) {
      toast('Deletion queued for approval.', 'info');
      S.snippets = S.snippets.filter((s) => s.id !== current.id);
      S.outbox = S.outbox.filter((o) => !(o.tab === 'Snippets' && o.id === current.id));
      save();
    }
  } else {
    S.snippets = S.snippets.filter((s) => s.id !== current.id);
    S.outbox = S.outbox.filter((o) => !(o.tab === 'Snippets' && o.id === current.id));
    save();
  }
  current = null;
  setUi({ selectedSnippet: null });
  render();
}

function select(id) {
  const snippet = S.snippets.find((s) => s.id === id);
  if (!snippet || (current && current.id === id)) return;
  const had = !!current;
  current = JSON.parse(JSON.stringify(snippet));
  isNewRecord = false;
  setUi({ selectedSnippet: id });
  renderDetail(had ? 'back' : 'forward');
  refreshList();
}

function newSnippet() {
  current = {
    row: 0,
    id: uid('snip'),
    title: 'Untitled snippet',
    language: 'php',
    category: 'Other',
    description: '',
    code: '',
    tags: [],
    updated: nowIso()
  };
  isNewRecord = true;
  setUi({ selectedSnippet: current.id });
  renderDetail('forward');
  refreshList();
}

function renderDetail(dir) {
  if (!detailNode) return;
  clear(detailNode);
  // Two states only: the list owns the tab, or the detail does. The detail is
  // never on screen while the list is.
  const open = !!current;
  if (splitNode) splitNode.classList.toggle('split-takeover', open);
  if (!open) {
    if (dir) slide(listNode, dir);
    stagger(listNode);
    return;
  }

  const pendingIds = changeTargets('Snippets');
  const isPending = pendingIds.has(current.id);

  const titleInput = el('input', { class: 'input', id: 'snip-title', value: current.title, spellcheck: false });
  titleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') titleInput.blur();
  });

  const langSel = el('select', {
    class: 'input',
    id: 'snip-language',
    // Re-highlight immediately, otherwise the editor keeps the old grammar until
    // the snippet is reopened.
    onchange: (e) => {
      current.language = e.target.value;
      if (editor) editor.setLanguage(current.language);
    }
  },
    LANGUAGES.map((l) => el('option', { value: l.id, text: l.label, selected: l.id === current.language })));

  const catList = el('datalist', { id: 'cat-options' },
    SNIPPET_CATEGORIES.map((c) => el('option', { value: c })));
  const catInput = el('input', {
    class: 'input',
    id: 'snip-category',
    value: current.category,
    list: 'cat-options',
    spellcheck: false
  });

  const editorHost = el('div', { class: 'editor-host' });

  const actions = el('div', { class: 'detail-actions' },
    el('button', {
      class: 'btn',
      text: 'Copy',
      onclick: async () => {
        const ok = await copyText(editor.getDoc());
        toast(ok ? 'Code copied.' : 'Copy failed.', ok ? 'success' : 'error');
      }
    }),
    el('button', { class: 'btn btn-primary', id: 'snip-save', text: 'Save', onclick: saveCurrent }),
    el('button', { class: 'btn', text: 'Delete', onclick: deleteCurrent }),
    el('span', { class: 'spacer' }),
    el('span', { class: 'muted tiny', text: current.updated ? `updated ${fmtDate(current.updated)}` : '' })
  );

  const pending = isPending
    ? el('div', { class: 'notice notice-warn' },
        el('strong', { text: 'Pending approval. ' }),
        'An admin has to approve this before other people see it.'
      )
    : null;

  detailNode.append(
    el('div', { class: 'detail-head' },
      el('button', {
        class: 'back-btn',
        text: '‹ Snippets',
        title: 'Back to the snippet list',
        onclick: closeDetail
      }),
      el('h2', { text: isNewRecord ? 'New snippet' : 'Snippet' }),
      isAdmin() ? el('span', { class: 'chip chip-admin', text: 'saves live' })
        : el('span', { class: 'chip chip-editor', text: 'needs approval' })
    ),
    pending,
    el('div', { class: 'grid2' },
      field('Title', titleInput),
      field('Language', langSel),
      field('Category', catInput),
      field('Tags', el('input', {
        class: 'input',
        id: 'snip-tags',
        value: asList(current.tags).join(', '),
        placeholder: 'nonce, security',
        spellcheck: false
      }), 'comma separated')
    ),
    field('Description', el('input', {
      class: 'input',
      id: 'snip-description',
      value: current.description,
      placeholder: 'When and why to use this',
      spellcheck: false
    })),
    actions,
    editorHost,
    el('p', { class: 'muted tiny', text: editorHint() })
  );

  if (editor) editor.destroy();
  editor = makeEditor({
    parent: editorHost,
    doc: current.code,
    language: current.language,
    placeholder: '// paste or write your code here',
    onSave: saveCurrent
  });
  editorHost.addEventListener('editor-escape', () => {
    closeDetail();
    return;
  });
  setTimeout(() => editor && editor.remeasure(), 20);
  if (dir) slide(detailNode, dir, listNode);
  stagger(listNode);
}

function closeDetail() {
  if (!current) return;
  current = null;
  isNewRecord = false;
  setUi({ selectedSnippet: null });
  renderDetail('back');
  refreshList();
}

function mount(root) {
  clear(root);
  const search = el('input', {
    class: 'input',
    type: 'search',
    value: S.ui.q || '',
    placeholder: 'Search title, tags, code...',
    spellcheck: false,
    oninput: debounce((e) => {
      setUi({ q: e.target.value });
      refreshList();
    }, 150)
  });

  const langSel = el('select', { class: 'input input-sm', onchange: (e) => { setUi({ lang: e.target.value }); refreshList(); } },
    [el('option', { value: 'all', text: 'All languages', selected: S.ui.lang === 'all' })].concat(
      LANGUAGES.map((l) => el('option', { value: l.id, text: l.label, selected: l.id === S.ui.lang }))
    ));

  const catSel = el('select', { class: 'input input-sm', onchange: (e) => { setUi({ category: e.target.value }); refreshList(); } },
    [el('option', { value: 'all', text: 'All categories', selected: S.ui.category === 'all' })].concat(
      Array.from(new Set(S.snippets.map((s) => s.category || 'Other')))
        .sort()
        .map((c) => el('option', { value: c, text: c, selected: c === S.ui.category }))
    ));

  listNode = el('div', { class: 'list' });
  detailNode = el('div', { class: 'detail', id: 'snip-detail' });
  splitNode = el('div', { class: 'split' },
    el('div', { class: 'list-pane' },
      el('div', { class: 'toolbar' },
        search,
        el('div', { class: 'toolbar-row' }, langSel, catSel)
      ),
      listNode,
      el('div', { class: 'list-footer' },
        el('button', { class: 'btn btn-primary btn-block', text: '+ New snippet', onclick: newSnippet })
      )
    ),
    detailNode
  );

  root.append(splitNode);

  shell = { root };
}

export function render(root = shell && shell.root) {
  if (isLocked()) {
    if (editor) {
      editor.destroy();
      editor = null;
    }
    current = null;
    listNode = null;
    detailNode = null;
    splitNode = null;
    shell = null;
    renderLock(root);
    return;
  }

  // Internal callers (save, delete) call render() with no argument, so fall back to
  // the root we mounted into. A missing root used to throw "cannot read properties
  // of undefined (reading 'contains')" straight after a successful write.
  if (!root) return;
  if (!shell || !root.contains(listNode)) {
    if (editor) {
      editor.destroy();
      editor = null;
    }
    mount(root);
  }

  if (!current && S.ui.selectedSnippet) {
    const found = S.snippets.find((s) => s.id === S.ui.selectedSnippet);
    if (found) current = JSON.parse(JSON.stringify(found));
  }

  refreshList();
  renderDetail();
}

export async function refresh() {
  if (!isSignedIn()) return;
  await readAll().catch(() => {});
  await flushOutbox();
  render();
}

export function destroy() {
  if (editor) editor.destroy();
  editor = null;
  shell = null;
  current = null;
}
