import { S, isSignedIn, isAdmin } from '../store.js';
import { el, clear, toast } from '../util.js';

let keyInput = null;
let statusNode = null;
let busy = false;

export const isLocked = () => !isSignedIn();

export function renderLock(container) {
  clear(container);

  const box = el('div', { class: 'lock' });
  box.append(
    el('div', { class: 'lock-icon', text: '\u{1F512}' }),
    el('h2', { text: 'Snippets are locked' }),
    el('p', { class: 'muted', text: 'Enter your access key to view, copy and edit the snippet library.' })
  );

  keyInput = el('input', {
    class: 'input',
    type: 'password',
    placeholder: 'wpd_...',
    autocomplete: 'off',
    spellcheck: false,
    onkeydown: (e) => {
      if (e.key === 'Enter') submit();
    }
  });

  statusNode = el('div', { class: 'lock-status' });

  const submit = async () => {
    if (busy) return;
    const key = keyInput.value.trim();
    if (!key) return;
    busy = true;
    statusNode.textContent = 'Checking key...';
    statusNode.className = 'lock-status';
    const { authenticate } = await import('../auth.js');
    const { onSignedIn } = await import('../main.js');
    try {
      await authenticate(key);
      statusNode.textContent = '';
      toast('Signed in.', 'success');
      await onSignedIn();
    } catch (err) {
      statusNode.textContent = err.message;
      statusNode.className = 'lock-status lock-status-error';
      keyInput.select();
    } finally {
      busy = false;
    }
  };

  box.append(
    keyInput,
    el('button', { class: 'btn btn-primary', text: 'Unlock', onclick: submit }),
    statusNode
  );

  const help = el('details', { class: 'lock-help' });
  help.append(
    el('summary', { text: 'No key yet?' }),
    el('p', {
      class: 'muted',
      text: 'An admin creates keys from Settings > Access. The first admin key is created by the "Create first admin key" button in Settings.'
    })
  );
  box.append(help);

  container.append(box);
  setTimeout(() => keyInput && keyInput.focus(), 30);
}

export function editorHint() {
  if (isAdmin()) return 'Your changes save straight to the sheet.';
  return 'Your changes are queued and need admin approval before they appear for everyone.';
}

export function currentUserChip() {
  if (!S.session) return null;
  return el('span', {
    class: `chip chip-${S.session.role}`,
    text: `${S.session.label} - ${S.session.role === 'admin' ? 'Admin' : 'Editor'}`
  });
}
