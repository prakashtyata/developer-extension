import { callWebApp } from './sheet.js';
import { S, setSession, isSignedIn, isAdmin, save } from './store.js';
import { nowIso, toast } from './util.js';

export { isSignedIn, isAdmin };

/**
 * Sign-in is a name and a password that the admin typed into the Users tab.
 * There is no key to generate or paste, and no second verification step.
 */
export async function authenticate(rawName, rawPassword) {
  const name = String(rawName || '').trim();
  const password = String(rawPassword == null ? '' : rawPassword);
  if (!name || !password) throw new Error('Enter your name and password.');

  const res = await callWebApp('authenticate', { name, password });
  const session = {
    name,
    password,
    userId: res.userId,
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
    toast('Enter your name and password first.', 'error');
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
