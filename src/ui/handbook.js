import { S, save, setUi, isAdmin, isSignedIn } from '../store.js';
import { queueUpdate, queueAppend, queueDelete, readAll, flushOutbox } from '../sheet.js';
import { changeTargets } from '../approval.js';
import { makeEditor } from '../editor.js';
import { parseMarkdown } from '../markdown.js';
import { el, clear, copyText, toast, uid, debounce } from '../util.js';
import { editorHint } from './lock.js';
import { slide, stagger } from './nav.js';

let editor = null;
let codeEditors = [];
let current = null;
let editing = false;
let isNewRecord = false;
let rootNode = null;

const sections = () => Array.from(new Set(S.handbook.map((h) => h.section || 'General'))).sort();

function matches(article, q) {
  if (!q) return true;
  const hay = [article.title, article.section, article.content].join(' ').toLowerCase();
  return hay.includes(q);
}

function renderBlock(block) {
  if (block.type === 'html') {
    const node = el('div', { class: 'prose' });
    node.innerHTML = block.html;
    return node;
  }
  const host = el('div', { class: 'code-block' });
  const inst = makeEditor({
    parent: host,
    doc: block.code,
    language: block.lang,
    readOnly: true
  });
  codeEditors.push(inst);
  return host;
}

function renderArticle(dir) {
  clear(rootNode);
  codeEditors = [];
  if (editor) {
    editor.destroy();
    editor = null;
  }

  if (!current) {
    const list = el('div', { class: 'hb-list' });
    const q = (S.ui.handbookQ || '').trim();
    const section = S.ui.handbookSection || 'all';
    const items = S.handbook.filter((a) => matches(a, q.toLowerCase()) && (section === 'all' || a.section === section));

    if (!items.length) {
      const message = !S.handbook.length
        ? 'No articles yet. Run "Create tabs & seed" in Settings, then Sync.'
        : section !== 'all' && !S.handbook.some((a) => a.section === section)
          ? 'No articles in that section.'
          : 'Nothing matches that search.';
      list.append(el('div', { class: 'empty' }, el('p', { text: message })));
    } else {
      let lastSection = null;
      for (const article of items) {
        if (article.section !== lastSection) {
          lastSection = article.section;
          list.append(el('div', { class: 'row-group', text: lastSection }));
        }
        list.append(
          el('button', {
            class: 'row',
            onclick: () => {
              current = article;
              renderArticle('forward');
            }
          },
            el('span', { class: 'row-title', text: article.title }),
            el('span', { class: 'row-meta' }, el('span', { class: 'chip', text: article.section }))
          )
        );
      }
    }
    rootNode.append(list);
    if (dir) slide(rootNode, dir);
    stagger(list);
    return;
  }

  if (editing) {
    renderEditor();
    return;
  }

  const pendingIds = changeTargets('Handbook');
  const isPending = pendingIds.has(current.id);

  const article = el('article', { class: 'hb-article' });
  article.append(
    el('div', { class: 'detail-head' },
      el('button', {
        class: 'back-btn',
        text: '‹ Index',
        title: 'Back to the article list',
        onclick: () => {
          current = null;
          renderArticle('back');
        }
      }),
      el('h2', { text: current.title }),
      el('span', { class: 'chip', text: current.section })
    ),
    isPending ? el('div', { class: 'notice notice-warn' }, el('strong', { text: 'Pending approval. ' }), 'An admin has to approve this edit.') : null
  );

  const body = el('div', { class: 'hb-body' });
  for (const block of parseMarkdown(current.content)) body.append(renderBlock(block));
  article.append(body);

  article.append(
    el('div', { class: 'detail-actions' },
      el('button', {
        class: 'btn',
        text: 'Copy markdown',
        onclick: async () => {
          const ok = await copyText(current.content);
          toast(ok ? 'Markdown copied.' : 'Copy failed.', ok ? 'success' : 'error');
        }
      }),
      el('button', {
        class: 'btn btn-primary',
        text: 'Edit',
        onclick: () => {
          editing = true;
          renderArticle();
        }
      }),
      el('button', {
        class: 'btn',
        text: 'Delete',
        onclick: async () => {
          if (!confirm(`Delete "${current.title}"?`)) return;
          if (current.row) {
            const res = await queueDelete('Handbook', current);
            if (res && res.error) {
              toast(res.error, 'error');
              return;
            }
            if (!isAdmin()) toast('Deletion queued for approval.', 'info');
          }
          S.handbook = S.handbook.filter((h) => h.id !== current.id);
          S.outbox = S.outbox.filter((o) => !(o.tab === 'Handbook' && o.id === current.id));
          save();
          current = null;
          renderArticle();
        }
      }),
      el('span', { class: 'spacer' })
    )
  );

  rootNode.append(article);
  setTimeout(() => codeEditors.forEach((c) => c.remeasure()), 20);
  if (dir) slide(rootNode, dir);
}

function collectEditor() {
  const titleEl = document.querySelector('#hb-title');
  const sectionEl = document.querySelector('#hb-section');
  if (titleEl) current.title = titleEl.value.trim();
  if (sectionEl) current.section = sectionEl.value.trim() || 'General';
  if (editor) current.content = editor.getDoc();
}

async function saveArticle() {
  collectEditor();
  if (!current.title) {
    toast('Give the article a title.', 'error');
    return;
  }
  const existing = S.handbook.find((h) => h.id === current.id);
  let result;
  try {
    result = existing && existing.row
      ? await queueUpdate('Handbook', current, existing.row)
      : await queueAppend('Handbook', current);
  } catch (err) {
    toast(err.message, 'error');
    return;
  }
  if (result && result.error) {
    toast(result.error, 'error');
    return;
  }
  if (!existing) {
    S.handbook.push(current);
    save();
  }
  const row = (result.responses || []).map((r) => r.res && r.res.row).find(Boolean);
  if (row) current.row = row;
  save();
  editing = false;
  isNewRecord = false;
  toast(isAdmin() ? 'Saved to the sheet.' : 'Queued for admin approval.', isAdmin() ? 'success' : 'info');
  renderArticle();
}

function renderEditor() {
  clear(rootNode);
  const host = el('div', { class: 'editor-host editor-host-tall' });
  rootNode.append(
    el('div', { class: 'detail-head' }, el('h2', { text: isNewRecord ? 'New article' : 'Edit article' })),
    el('div', { class: 'grid2' },
      el('label', { class: 'field' }, el('span', { class: 'field-label', text: 'Title' }),
        el('input', { class: 'input', id: 'hb-title', value: current.title, spellcheck: false })),
      el('label', { class: 'field' }, el('span', { class: 'field-label', text: 'Section' }),
        el('input', { class: 'input', id: 'hb-section', value: current.section, list: 'hb-sections', spellcheck: false }))
    ),
    el('datalist', { id: 'hb-sections' }, sections().map((s) => el('option', { value: s }))),
    host,
    el('div', { class: 'detail-actions' },
      el('button', { class: 'btn btn-primary', text: 'Save', onclick: saveArticle }),
      el('button', {
        class: 'btn',
        text: 'Cancel',
        onclick: () => {
          editing = false;
          if (isNewRecord) {
            current = null;
            isNewRecord = false;
          }
          renderArticle();
        }
      }),
      el('span', { class: 'spacer' }),
      el('span', { class: 'muted tiny', text: editorHint() })
    )
  );
  if (editor) editor.destroy();
  editor = makeEditor({
    parent: host,
    doc: current.content,
    language: 'markdown',
    placeholder: '## Heading\n\nWrite in markdown. Fenced blocks get highlighted.',
    onSave: saveArticle
  });
  setTimeout(() => editor && editor.remeasure(), 20);
}

export function render(root) {
  rootNode = root;

  if (root.firstChild && current) {
    renderArticle();
    return;
  }

  clear(root);
  editing = false;
  isNewRecord = false;
  current = null;

  const q = S.ui.handbookQ || '';
  const section = S.ui.handbookSection || 'all';

  const search = el('input', {
    class: 'input',
    type: 'search',
    value: q,
    placeholder: 'Search the handbook...',
    spellcheck: false,
    oninput: debounce((e) => {
      setUi({ handbookQ: e.target.value });
      renderArticle();
    }, 150)
  });

  const sectionSel = el('select', {
    class: 'input input-sm',
    onchange: (e) => {
      setUi({ handbookSection: e.target.value });
      renderArticle();
    }
  },
    [el('option', { value: 'all', text: 'All sections', selected: section === 'all' })].concat(
      sections().map((s) => el('option', { value: s, text: s, selected: s === section }))
    )
  );

  root.append(
    el('div', { class: 'toolbar' },
      search,
      el('div', { class: 'toolbar-row' },
        sectionSel,
        isSignedIn()
          ? el('button', {
              class: 'btn btn-primary btn-sm',
              text: '+ Article',
              onclick: () => {
                current = { row: 0, id: uid('hb'), section: section === 'all' ? 'General' : section, title: 'New article', content: '' };
                editing = true;
                isNewRecord = true;
                renderArticle();
              }
            })
          : null
      )
    )
  );
  renderArticle();
}

export async function refresh() {
  await readAll().catch(() => {});
  render();
}

export function destroy() {
  if (editor) editor.destroy();
  editor = null;
  codeEditors.forEach((c) => c.destroy());
  codeEditors = [];
}
