import { S, isAdmin, isSignedIn, setUi } from '../store.js';
import { approve, reject, refreshPending, changeLabel, changePreview, pendingCount } from '../approval.js';
import { readAll, flushOutbox } from '../sheet.js';
import { el, clear, fmtDate, toast } from '../util.js';

const DIFF_COLS = {
  Snippets: ['id', 'title', 'language', 'category', 'description', 'code', 'tags', 'updated'],
  Checklist: ['id', 'category', 'item', 'detail', 'order'],
  Handbook: ['id', 'section', 'title', 'content']
};

function rowPreview(tab, before, after) {
  const names = DIFF_COLS[tab] || [];
  const trim = (v) => {
    const s = String(v ?? '');
    return s.length > 120 ? `${s.slice(0, 120)}...` : s;
  };
  const rows = [];
  for (let i = 1; i < Math.max(before.length, after.length); i++) {
    const b = before[i] ?? '';
    const a = after[i] ?? '';
    if (String(b) === String(a)) continue;
    rows.push(
      el('div', { class: 'diff-row' },
        el('span', { class: 'diff-col', text: names[i] || `col${i}` }),
        el('span', { class: 'diff-old', text: trim(b) || '(empty)' }),
        el('span', { class: 'diff-arrow', text: '\u2192' }),
        el('span', { class: 'diff-new', text: trim(a) || '(empty)' })
      )
    );
  }
  if (!rows.length) rows.push(el('div', { class: 'muted tiny', text: 'No field-level changes recorded.' }));
  return el('div', { class: 'diff' }, rows);
}

function changeCard(change, readOnly, rerender) {
  const pending = change.status === 'Pending';
  const { before, after } = changePreview(change);

  const actions = pending && !readOnly
    ? el('div', { class: 'detail-actions' },
        el('button', {
          class: 'btn btn-primary btn-sm',
          text: 'Approve',
          onclick: async () => {
            try {
              await approve(change.changeId);
              await readAll().catch(() => {});
              await flushOutbox();
              await refreshPending();
            } catch (err) {
              toast(err.message, 'error');
            }
            rerender();
          }
        }),
        el('button', {
          class: 'btn btn-sm',
          text: 'Reject',
          onclick: async () => {
            const reason = prompt('Reason (optional):', '') || '';
            try {
              await reject(change.changeId, reason);
              await refreshPending();
            } catch (err) {
              toast(err.message, 'error');
            }
            rerender();
          }
        })
      )
    : el('div', { class: 'muted tiny' },
        pending
          ? 'Waiting for an admin to approve or reject this.'
          : `${change.status} by ${change.decidedBy || 'unknown'} - ${fmtDate(change.decidedAt)}${change.reason ? ` - ${change.reason}` : ''}`
      );

  return el('article', { class: 'queue-card' + (pending ? '' : ' queue-done') },
    el('header', { class: 'queue-head' },
      el('strong', { text: changeLabel(change) }),
      el('span', { class: 'chip', text: change.tab }),
      el('span', { class: 'chip chip-role', text: change.requestedBy || 'unknown' })
    ),
    el('div', { class: 'muted tiny', text: `requested ${fmtDate(change.requestedAt)}${change.targetRow ? ` - row ${change.targetRow}` : ''}` }),
    pending ? rowPreview(change.tab, before, after) : null,
    actions
  );
}

export function render(root) {
  clear(root);

  if (!isSignedIn()) {
    root.append(
      el('div', { class: 'empty' },
        el('p', { text: 'Not signed in.' }),
        el('p', { class: 'muted', text: 'Enter an access key in Settings > Access to see change requests.' })
      )
    );
    return;
  }

  const readOnly = !isAdmin();
  const filter = S.ui.queueFilter || 'Pending';
  const rows = S.pending.filter((c) => (filter === 'History' ? c.status !== 'Pending' : c.status === 'Pending'));
  const rerender = () => render(root);

  const tabs = el('div', { class: 'segmented' },
    el('button', {
      class: 'seg' + (filter === 'Pending' ? ' seg-active' : ''),
      text: `Pending (${pendingCount('Pending')})`,
      onclick: () => {
        setUi({ queueFilter: 'Pending' });
        refreshPending().then(rerender);
      }
    }),
    el('button', {
      class: 'seg' + (filter === 'History' ? ' seg-active' : ''),
      text: 'History',
      onclick: () => {
        setUi({ queueFilter: 'History' });
        rerender();
      }
    }),
    el('button', { class: 'seg seg-action', text: 'Refresh', onclick: () => refreshPending().then(rerender) })
  );

  root.append(tabs);

  if (!rows.length) {
    root.append(
      el('div', { class: 'empty' },
        el('p', {
          text: filter === 'Pending'
            ? (readOnly ? 'You have nothing waiting for approval.' : 'Nothing waiting for approval.')
            : 'No decided changes yet.'
        })
      )
    );
    return;
  }

  for (const change of rows) root.append(changeCard(change, readOnly, rerender));
}
