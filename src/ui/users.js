import { isAdmin, listUsers, manageUser } from '../auth.js';
import { el, clear, fmtDate, toast } from '../util.js';

export function render(root) {
  clear(root);

  if (!isAdmin()) {
    root.append(
      el('div', { class: 'empty' },
        el('p', { text: 'Admin only.' }),
        el('p', { class: 'muted', text: 'Only admins can add or revoke sign-ins.' })
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
              el('div', {}, el('strong', { text: u.name || u.userId }), el('span', { class: 'chip chip-role', text: u.role })),
              el('div', { class: 'muted tiny', text: `added ${fmtDate(u.createdAt)}${u.lastSeen ? ` - last seen ${fmtDate(u.lastSeen)}` : ' - never signed in'}` })
            ),
            el('div', { class: 'row-actions' },
              el('button', {
                class: 'btn btn-sm',
                text: u.role === 'admin' ? 'Make editor' : 'Make admin',
                onclick: async () => {
                  try {
                    await manageUser('setRole', { userId: u.userId, role: u.role === 'admin' ? 'editor' : 'admin' });
                    toast('Role updated.', 'success');
                    rerender();
                  } catch (err) {
                    toast(err.message, 'error');
                  }
                }
              }),
              el('button', {
                class: 'btn btn-sm',
                text: 'Set password',
                onclick: async () => {
                  const next = window.prompt(`New password for ${u.name || u.userId}:`);
                  if (next == null) return;
                  if (!next) {
                    toast('Password cannot be empty.', 'error');
                    return;
                  }
                  try {
                    await manageUser('setPassword', { userId: u.userId, password: next });
                    toast('Password updated.', 'success');
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
                    await manageUser(active ? 'revoke' : 'restore', { userId: u.userId });
                    toast(active ? 'Access revoked.' : 'Access restored.', 'success');
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

  const nameInput = el('input', { class: 'input input-sm', placeholder: 'Name (e.g. Rafi)' });
  const passInput = el('input', { class: 'input input-sm', type: 'text', placeholder: 'Password', autocomplete: 'off' });
  const roleSel = el('select', { class: 'input input-sm' },
    el('option', { value: 'editor', text: 'Editor (needs approval)' }),
    el('option', { value: 'admin', text: 'Admin (full access)' })
  );

  const form = el('form', {
    class: 'form-row',
    onsubmit: async (e) => {
      e.preventDefault();
      const name = nameInput.value.trim();
      const password = passInput.value;
      if (!name || !password) {
        toast('Enter a name and a password.', 'error');
        return;
      }
      try {
        await manageUser('add', { name, password, role: roleSel.value });
        toast(`${name} can now sign in.`, 'success');
        nameInput.value = '';
        passInput.value = '';
        load();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  },
    nameInput,
    passInput,
    roleSel,
    el('button', { class: 'btn btn-primary btn-sm', type: 'submit', text: 'Add user' })
  );

  root.append(
    el('h3', { text: 'People' }),
    el('p', { class: 'muted tiny', text: 'Add a name and password here, or type a row straight into the Users tab on the spreadsheet - both work. The person signs in with exactly these two values and nothing else. An editor can do everything except approve; an editor\'s changes to snippets, checklist items and handbook articles are queued until an admin approves them.' }),
    form,
    el('hr', {}),
    listHost
  );

  load();
}
