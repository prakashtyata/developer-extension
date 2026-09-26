import { S, save, setUi, isAdmin, progressFor, setProgressEntry, siteTally, upsertSite } from '../store.js';
import { queueProgress, queueWrite, queueAppend, queueDelete } from '../sheet.js';
import { changeTargets } from '../approval.js';
import { el, clear, pct, toast, debounce, uid } from '../util.js';

const openNotes = new Set();
const collapsed = new Set();
let notesSave = null;

function itemsByCategory() {
  const map = new Map();
  for (const item of S.checklist) {
    const key = item.category || 'Uncategorised';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  for (const list of map.values()) list.sort((a, b) => (a.order || 0) - (b.order || 0) || a.item.localeCompare(b.item));
  return map;
}

function bar(done, total) {
  const p = pct(done, total);
  return el('div', { class: 'bar' }, el('i', { style: { width: `${p}%` } }));
}

function noteEditor(item, host, rerender) {
  const entry = progressFor(host, item.id);
  const input = el('input', {
    class: 'input input-sm',
    value: entry.note || '',
    placeholder: `Note for "${item.item}"`,
    oninput: (e) => {
      const value = e.target.value;
      setProgressEntry(host, item.id, { note: value });
      notesSave(item.id, host, value);
    }
  });
  return el('div', { class: 'note-row' }, el('span', { class: 'note-label', text: 'Note' }), input);
}

function tickRow(item, host, rerender) {
  const entry = progressFor(host, item.id);
  const isPendingChange = changeTargets('Checklist').has(item.id);

  const box = el('input', {
    type: 'checkbox',
    checked: !!entry.done,
    onchange: async (e) => {
      const done = e.target.checked;
      if (!host) {
        e.target.checked = !!entry.done;
        toast('Pick a site first - progress is tracked per site.', 'error');
        return;
      }
      setProgressEntry(host, item.id, { done });
      row.classList.toggle('item-done', done);
      updateCategoryCounts();
      try {
        const res = await queueProgress(host, item.id, done, entry.note || '');
        if (res && res.error) toast(res.error, 'error');
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });

  const noteOpen = openNotes.has(item.id);
  const noteBtn = el('button', {
    class: 'btn btn-icon' + (entry.note ? ' has-note' : ''),
    text: '\u{1F4DD}',
    title: 'Note',
    onclick: () => {
      if (openNotes.has(item.id)) openNotes.delete(item.id);
      else openNotes.add(item.id);
      rerender();
    }
  });

  const row = el('div', { class: 'item' + (entry.done ? ' item-done' : '') },
    el('label', { class: 'item-main' },
      box,
      el('span', { class: 'item-text' },
        el('span', { text: item.item }),
        item.detail ? el('span', { class: 'item-detail', text: item.detail }) : null,
        isPendingChange ? el('span', { class: 'chip chip-pending', text: 'pending' }) : null
      )
    ),
    noteBtn
  );

  const wrap = el('div', { class: 'item-wrap' }, row);
  if (noteOpen) wrap.append(noteEditor(item, host, rerender));
  return wrap;
}

let categoryNodes = new Map();

function updateCategoryCounts() {
  const host = activeHost();
  for (const [category, node] of categoryNodes) {
    const items = itemsByCategory().get(category) || [];
    const done = items.filter((i) => progressFor(host, i.id).done).length;
    node.querySelector('.cat-count').textContent = `${done}/${items.length}`;
    node.querySelector('.bar i').style.width = `${pct(done, items.length)}%`;
  }
  const overall = siteTally(host);
  const barNode = document.querySelector('#check-overall .bar i');
  const countNode = document.querySelector('#check-overall-count');
  if (barNode) barNode.style.width = `${pct(overall.done, overall.total)}%`;
  if (countNode) countNode.textContent = `${overall.done}/${overall.total}`;
}

async function resetCategory(category, host) {
  const items = itemsByCategory().get(category) || [];
  if (!items.length) return;
  if (!confirm(`Clear all ${items.length} ticks in "${category}" for ${host}?`)) return;
  for (const item of items) setProgressEntry(host, item.id, { done: false });
  const res = await queueWrite({
    tab: 'Progress',
    op: 'progressBulk',
    host,
    items: items.map((i) => ({ itemId: i.id, done: false, note: progressFor(host, i.id).note || '' }))
  });
  if (res && res.error) toast(res.error, 'error');
  render();
}

function manageBlock(rerender) {
  const form = el('form', {
    class: 'manage-form',
    onsubmit: async (e) => {
      e.preventDefault();
      const category = form.querySelector('[name=category]').value.trim();
      const item = form.querySelector('[name=item]').value.trim();
      const detail = form.querySelector('[name=detail]').value.trim();
      if (!category || !item) {
        toast('Category and item are required.', 'error');
        return;
      }
      const obj = { row: 0, id: uid('chk'), category, item, detail, order: 0 };
      S.checklist.push(obj);
      save();
      const res = await queueAppend('Checklist', obj);
      if (res && res.error) toast(res.error, 'error');
      else toast(isAdmin() ? 'Checklist item added.' : 'Queued for approval.', isAdmin() ? 'success' : 'info');
      form.reset();
      rerender();
    }
  },
    el('input', { class: 'input input-sm', name: 'category', placeholder: 'Category', list: 'cat-list' }),
    el('input', { class: 'input input-sm', name: 'item', placeholder: 'Checklist item' }),
    el('input', { class: 'input input-sm', name: 'detail', placeholder: 'Detail (optional)' }),
    el('button', { class: 'btn btn-sm btn-primary', type: 'submit', text: 'Add item' })
  );

  const existing = Array.from(new Set(S.checklist.map((c) => c.category))).sort();

  return el('details', { class: 'manage' },
    el('summary', { text: 'Manage checklist items' }),
    form,
    el('datalist', { id: 'cat-list' }, existing.map((c) => el('option', { value: c }))),
    el('p', { class: 'muted tiny', text: 'Checklist edits are shared content, so an editor needs admin approval.' })
  );
}

export function render(root) {
  clear(root);
  categoryNodes = new Map();

  notesSave = debounce(async (itemId, host, value) => {
    if (!host) {
      toast('Pick a site first - notes are saved per site.', 'error');
      return;
    }
    const entry = progressFor(host, itemId);
    try {
      const res = await queueProgress(host, itemId, entry.done, value);
      if (res && res.error) toast(res.error, 'error');
    } catch (err) {
      toast(err.message, 'error');
    }
  }, 700);

  if (!S.sites.length) {
    root.append(
      el('div', { class: 'empty' },
        el('p', { text: 'No sites yet.' }),
        el('p', { class: 'muted', text: 'Open a site tab, then use "Track this site" in the header. Or add one in Settings.' })
      )
    );
    return;
  }

  const rerender = () => render(root);

  // A <select> with no matching option still shows its first entry, so an empty
  // S.activeHost looked like a site was chosen while every write went out with
  // host='' and the sheet rejected it. Fall back to the first tracked site.
  let host = S.activeHost;
  if (!host && S.sites.length) {
    host = S.sites[0].host;
    S.activeHost = host;
    save();
  }

  const siteSel = el('select', {
    class: 'input input-sm',
    onchange: (e) => {
      S.activeHost = e.target.value;
      save();
      rerender();
    }
  }, S.sites.map((s) => el('option', { value: s.host, text: s.label || s.host, selected: s.host === host })));

  const overall = siteTally(host);

  const head = el('div', { class: 'check-head' },
    el('div', { class: 'toolbar-row' },
      siteSel,
      el('span', { class: 'chip', text: `${S.checklist.length} items` })
    ),
    el('div', { class: 'overall', id: 'check-overall' },
      bar(overall.done, overall.total),
      el('span', { id: 'check-overall-count', class: 'overall-count', text: `${overall.done}/${overall.total}` })
    )
  );

  const list = el('div', { class: 'check-list' });
  for (const [category, items] of itemsByCategory()) {
    const done = items.filter((i) => progressFor(S.activeHost, i.id).done).length;
    const isOpen = !collapsed.has(category);

    const headEl = el('header', { class: 'cat-head' },
      el('span', { class: 'caret', text: isOpen ? '\u25BE' : '\u25B8' }),
      el('span', { class: 'cat-name', text: category }),
      bar(done, items.length),
      el('span', { class: 'cat-count', text: `${done}/${items.length}` }),
      el('button', {
        class: 'btn btn-icon',
        text: '\u21BA',
        title: 'Clear this category',
        onclick: async (e) => {
          e.stopPropagation();
          await resetCategory(category, host);
        }
      }),
      el('button', {
        class: 'btn btn-icon btn-danger',
        text: '\u2715',
        title: 'Delete category (shared, needs approval if you are an editor)',
        onclick: async (e) => {
          e.stopPropagation();
          if (!confirm(`Delete the whole "${category}" category (${items.length} items)?`)) return;
          for (const item of items) {
            S.checklist = S.checklist.filter((c) => c.id !== item.id);
            if (item.row) await queueDelete('Checklist', item);
            else S.outbox = S.outbox.filter((o) => !(o.tab === 'Checklist' && o.id === item.id));
          }
          save();
          toast(isAdmin() ? 'Category deleted.' : 'Deletion queued for approval.', isAdmin() ? 'success' : 'info');
          rerender();
        }
      })
    );
    headEl.addEventListener('click', () => {
      if (isOpen) collapsed.add(category);
      else collapsed.delete(category);
      rerender();
    });

    const body = el('div', { class: 'cat-body' });
    for (const item of items) body.append(tickRow(item, host, rerender));

    const section = el('section', { class: 'cat' + (isOpen ? ' cat-open' : '') }, headEl);
    if (isOpen) section.append(body);
    categoryNodes.set(category, section);
    list.append(section);
  }

  root.append(head, list, manageBlock(rerender));
}

/** Kept in sync with the host the checklist is actually showing. */
function activeHost() {
  return S.activeHost || (S.sites[0] && S.sites[0].host) || '';
}

export function trackCurrentSite(host) {
  upsertSite(host, {});
  S.activeHost = host;
  save();
}
