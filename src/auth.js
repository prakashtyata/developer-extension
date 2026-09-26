import { callWebApp } from './sheet.js';
import { S, setSession, isSignedIn, isAdmin, save } from './store.js';
import { nowIso, toast } from './util.js';

export { isSignedIn, isAdmin };

export async function authenticate(rawKey) {
  const key = String(rawKey || '').trim();
  if (!key) throw new Error('Enter an access key.');

  const res = await callWebApp('authenticate', { key });
  const session = {
    key,
    keyId: res.keyId,
    label: res.label,
    role: res.role,
    since: nowIso()
  };
  setSession(session);
  save();
  return session;
}

export function signOut() {
  setSession(null);
  save();
}

export function requireSignedIn() {
  if (!isSignedIn()) {
    toast('Enter your access key first.', 'error');
    return false;
  }
  return true;
}

export function requireAdmin() {
  if (!isAdmin()) {
    toast('Admin access required for that action.', 'error');
    return false;
  }
  return true;
}

export async function bootstrapAdmin() {
  const res = await callWebApp('bootstrap', {});
  return res;
}

export async function listUsers() {
  const res = await callWebApp('listUsers', {});
  const rows = (res.rows || []).map((cells, i) => {
    const obj = { __row: i + 2 };
    (res.cols || []).forEach((c, cIdx) => {
      obj[c] = cells[cIdx] ?? '';
    });
    return obj;
  });
  return rows;
}

export async function manageUser(action, payload = {}) {
  // `userAction`, not `action`: the dispatcher key would be overwritten by the spread.
  return callWebApp('manageUser', { userAction: action, ...payload });
}

export const roleLabel = () => {
  if (!S.session) return '';
  return S.session.role === 'admin' ? 'Admin' : 'Editor';
};
