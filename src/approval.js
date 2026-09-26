import { callWebApp, readPending } from './sheet.js';
import { S, isSignedIn, save } from './store.js';
import { toast } from './util.js';

export async function refreshPending() {
  if (!isSignedIn()) return [];
  try {
    return await readPending();
  } catch (err) {
    toast(err.message, 'error');
    return [];
  }
}

export const pendingCount = (status = 'Pending') =>
  S.pending.filter((c) => c.status === status).length;

export function myPending(tab) {
  if (!S.session) return [];
  return S.pending.filter(
    (c) => c.status === 'Pending' && c.requestedBy === S.session.label && (!tab || c.tab === tab)
  );
}

export function changeTargets(tab) {
  const mine = myPending(tab);
  return new Set(mine.map((c) => (c.payload && c.payload.id) || c.id || '').filter(Boolean));
}

export async function approve(changeId) {
  const res = await callWebApp('approveChange', { changeId });
  toast('Change applied.', 'success');
  return res;
}

export async function reject(changeId, reason = '') {
  const res = await callWebApp('rejectChange', { changeId, reason });
  toast('Change rejected.', 'info');
  return res;
}

export function changeLabel(change) {
  const target = (change.payload && (change.payload.title || change.payload.item || change.payload.section)) || '';
  if (change.op === 'delete') return `Delete: ${target || change.tab}`;
  if (change.op === 'update') return `Edit: ${target || change.tab}`;
  if (change.op === 'append') return `New: ${target || change.tab}`;
  return `${change.op} on ${change.tab}`;
}

export function changePreview(change) {
  const payload = change.payload || {};
  const after = Array.isArray(payload.values) ? payload.values : [];
  const before = Array.isArray(payload.before) ? payload.before : [];
  const label = after[1] || after[2] || before[1] || before[2] || '';
  return { before, after, label: String(label) };
}
