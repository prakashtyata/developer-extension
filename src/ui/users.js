import { isAdmin, listUsers, manageUser } from '../auth.js';
import { el, clear, fmtDate, toast } from '../util.js';

function keyReveal(key, label) {
  const box = el('div', { class: 'notice notice-good' },
    el('strong', { text: `Key for ${label}: ` }),
    el('code', { class: 'keycode', text: key })
  );
  const copyBtn = el('button', {
    class: 'btn btn-sm',
    text: 'Copy key',
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(key);
        toast('Key copied.', 'success');
      } catch {
        toast('Copy failed - select the key manually.', 'error');
      }
    }
  });
  return el('div', {}, el('p', { class: 'muted tiny', text: 'Shown once. It is stored in the sheet as a hash and cannot be recovered.' }), box, copyBtn);
}

export function render(root) {
  clear(root);

  if (!isAdmin()) {
    root.append(
      el('div', { class: 'empty' },
        el('p', { text: 'Admin only.' }),
        el('p', { class: 'muted', text: 'Only admins can add or revoke access keys.' })
      )
    );
    return;
  }

  const listHost = el('div', { class: 'user-list' });

  const rerender = () => render(root);

  const load = async () => {
    clear(listHost);
    listHost.append(el('p', { class: 'muted', text: 'Loading...' }));
    try {
      const users = await listUsers();
      clear(listHost);
      if (!users.length) {
        listHost.append(el('p', { class: 'muted', text: 'No users yet.' }));
        return;
      }
      for (const u of users) {
        const active = String(u.active).toUpperCase() !== 'FALSE';
        listHost.append(
          el('div', { class: 'user-row' + (active ? '' : ' user-inactive') },
            el('div', {},
              el('div', {}, el('strong', { text: u.label || u.keyId }), el('span', { class: 'chip chip-role', text: u.role })),
              el('div', { class: 'muted tiny', text: `added ${fmtDate(u.createdAt)}${u.lastSeen ? ` - last seen ${fmtDate(u.lastSeen)}` : ' - never used'}` })
            ),
            el('div', { class: 'row-actions' },
              el('button', {
                class: 'btn btn-sm',
                text: u.role === 'admin' ? 'Make editor' : 'Make admin',
                onclick: async () => {
                  try {
                    await manageUser('setRole', { keyId: u.keyId, role: u.role === 'admin' ? 'editor' : 'admin' });
                    toast('Role updated.', 'success');
                    rerender();
                  } catch (err) {
                    toast(err.message, 'error');
                  }
                }
              }),
              el('button', {
                class: 'btn btn-sm' + (active ? ' btn-danger' : ''),
                text: active ? 'Revoke' : 'Restore',
                onclick: async () => {
                  try {
                    await manageUser(active ? 'revoke' : 'restore', { keyId: u.keyId });
                    toast(active ? 'Key revoked.' : 'Key restored.', 'success');
                    rerender();
                  } catch (err) {
                    toast(err.message, 'error');
                  }
                }
              })
            )
          )
        );
      }
    } catch (err) {
      clear(listHost);
      listHost.append(el('p', { class: 'muted', text: err.message }));
    }
  };

  const labelInput = el('input', { class: 'input input-sm', placeholder: 'Name (e.g. Rafi - editor)' });
  const roleSel = el('select', { class: 'input input-sm' },
    el('option', { value: 'editor', text: 'Editor (needs approval)' }),
    el('option', { value: 'admin', text: 'Admin (full access)' })
  );
  const created = el('div');

  const form = el('form', {
    class: 'form-row',
    onsubmit: async (e) => {
      e.preventDefault();
      const label = labelInput.value.trim();
      if (!label) {
        toast('Give the person a name.', 'error');
        return;
      }
      try {
        const res = await manageUser('add', { label, role: roleSel.value });
        clear(created);
        created.append(keyReveal(res.key, label));
        labelInput.value = '';
        load();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  },
    labelInput,
    roleSel,
    el('button', { class: 'btn btn-primary btn-sm', type: 'submit', text: 'Create key' })
  );

  root.append(
    el('h3', { text: 'Access keys' }),
    el('p', { class: 'muted tiny', text: 'Keys are stored as SHA-256 hashes. An editor can do everything except approve; an editor\'s changes to snippets, checklist items and handbook articles are queued until an admin approves them.' }),
    form,
    created,
    el('hr', {}),
    listHost
  );

  load();
}
