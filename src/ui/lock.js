import { S, isSignedIn, isAdmin } from '../store.js';
import { el, clear, toast } from '../util.js';

let nameInput = null;
let passInput = null;
let statusNode = null;
let busy = false;

export const isLocked = () => !isSignedIn();

export function renderLock(container) {
  clear(container);

  const box = el('div', { class: 'lock' });
  box.append(
    el('div', { class: 'lock-icon', text: '\u{1F512}' }),
    el('h2', { text: 'Sign in' }),
    el('p', { class: 'muted', text: 'Use the name and password an admin added for you on the Users tab.' })
  );

  nameInput = el('input', {
    class: 'input',
    type: 'text',
    placeholder: 'Your name',
    autocomplete: 'username',
    spellcheck: false,
    onkeydown: (e) => {
      if (e.key === 'Enter') submit();
    }
  });

  passInput = el('input', {
    class: 'input',
    type: 'password',
    placeholder: 'Password',
    autocomplete: 'current-password',
    spellcheck: false,
    onkeydown: (e) => {
      if (e.key === 'Enter') submit();
    }
  });

  statusNode = el('div', { class: 'lock-status' });

  const submit = async () => {
    if (busy) return;
    const name = nameInput.value.trim();
    const password = passInput.value;
    if (!name || !password) {
      statusNode.textContent = 'Enter your name and password.';
      statusNode.className = 'lock-status lock-status-error';
      return;
    }
    busy = true;
    statusNode.textContent = 'Signing in...';
    statusNode.className = 'lock-status';
    const { authenticate } = await import('../auth.js');
    const { onSignedIn } = await import('../main.js');
    try {
      await authenticate(name, password);
      statusNode.textContent = '';
      toast('Signed in.', 'success');
      await onSignedIn();
    } catch (err) {
      statusNode.textContent = err.message;
      statusNode.className = 'lock-status lock-status-error';
      passInput.select();
    } finally {
      busy = false;
    }
  };

  box.append(
    nameInput,
    passInput,
    el('button', { class: 'btn btn-primary', text: 'Sign in', onclick: submit }),
    statusNode
  );

  const help = el('details', { class: 'lock-help' });
  help.append(
    el('summary', { text: 'No access yet?' }),
    el('p', {
      class: 'muted',
      text: 'Ask an admin to add a row to the Users tab on the spreadsheet with your name, a password and role=admin or editor.'
    })
  );
  box.append(help);

  container.append(box);
  setTimeout(() => nameInput && nameInput.focus(), 30);
}

export function editorHint() {
  if (isAdmin()) return 'Your changes save straight to the sheet.';
  return 'Your changes are queued and need admin approval before they appear for everyone.';
}

export function currentUserChip() {
  if (!S.session) return null;
  return el('span', {
    class: `chip chip-${S.session.role}`,
    text: `${S.session.name} - ${S.session.role === 'admin' ? 'Admin' : 'Editor'}`
  });
}
