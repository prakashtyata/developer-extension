import { S, saveNow, setSettings, isConfigured, isSignedIn, isAdmin, removeSite, resetLocalData, siteTally, upsertSite } from '../store.js';
import { ping, setupSheet, readAll, flushOutbox, queueSite, outboxSummary } from '../sheet.js';
import { authenticate, signOut } from '../auth.js';
import { render as renderQueue } from './queue.js';
import { render as renderUsers } from './users.js';
import { el, clear, downloadJson, pickFile, toast, relTime, pct, debounce, normalizeHost } from '../util.js';
import { slide } from './nav.js';

const SECTIONS = [
  { id: 'connection', label: 'Connection' },
  { id: 'access', label: 'Access' },
  { id: 'queue', label: 'Approvals' },
  { id: 'sites', label: 'Sites' },
  { id: 'data', label: 'Data' }
];

let section = 'connection';
let host = null;
let messageNode = null;

export function openSection(id) {
  section = SECTIONS.some((s) => s.id === id) ? id : 'connection';
  render();
}

function say(text, kind = 'info') {
  if (!messageNode) return;
  messageNode.textContent = text;
  messageNode.className = `drawer-msg drawer-msg-${kind}`;
}

export function extractSheetId(value) {
  const raw = String(value || '').trim();
  const m = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(raw)) return raw;
  return '';
}

function field(label, node, hint) {
  return el('label', { class: 'field' }, el('span', { class: 'field-label', text: label }), node,
    hint ? el('span', { class: 'field-hint', text: hint }) : null);
}

const STEPS = [
  { id: 'sheet', title: 'Google Sheet', hint: 'Point the panel at your spreadsheet.' },
  { id: 'webapp', title: 'Web app', hint: 'Paste the /exec URL from your deployment.' },
  { id: 'seed', title: 'Test and seed', hint: 'Create the 7 tabs, then write starter content.' }
];

let step = 0;
let stepDirection = 'forward';
let stepNodes = {};

function stepperBar(current) {
  return el('div', {},
    el('div', { class: 'stepper' },
      STEPS.map((s, i) => el('span', {
        class: 'stepper-dot' + (i < current ? ' stepper-dot-done' : i === current ? ' stepper-dot-now' : ''),
        title: s.title
      }))
    ),
    el('div', { class: 'stepper-label' },
      el('strong', { text: `Step ${current + 1} of ${STEPS.length} - ${STEPS[current].title}` }),
      el('span', { text: STEPS[current].hint })
    )
  );
}

/** Redraw only the step bodies, so the slide can play between them. */
function renderSteps(host) {
  // Clear everything this function owns. Removing just the bodies would stack up
  // stepper bars and nav rows, one per step visited.
  clear(host);
  stepNodes = {};

  const sheetInput = el('input', {
    class: 'input',
    placeholder: '1AbCdEf... or the full Sheet URL',
    value: S.settings.sheetId,
    spellcheck: false
  });
  sheetInput.addEventListener('input', debounce(() => {
    setSettings({ sheetId: extractSheetId(sheetInput.value) });
  }, 300));

  const appInput = el('input', {
    class: 'input',
    placeholder: 'https://script.google.com/macros/s/AKfy.../exec',
    value: S.settings.webAppUrl,
    spellcheck: false
  });
  appInput.addEventListener('input', debounce(() => setSettings({ webAppUrl: appInput.value.trim() }), 300));

  const bodies = {
    sheet: el('div', { class: 'step-body' },
      field('Sheet ID or URL', sheetInput, 'Create an empty spreadsheet, then share it "Anyone with the link" (Viewer).')
    ),
    webapp: el('div', { class: 'step-body' },
      field('/exec URL', appInput, 'Apps Script > Deploy > New deployment > Web app. Execute as: Me. Access: Anyone.')
    ),
    seed: el('div', { class: 'step-body' })
  };

  const status = el('div', { class: 'status-list' },
    el('div', {}, el('strong', { text: 'Sheet ID: ' }), el('code', { text: S.settings.sheetId || 'not set' })),
    el('div', {}, el('strong', { text: 'Web app: ' }), el('code', { text: S.settings.webAppUrl ? 'set' : 'not set' })),
    el('div', {}, el('strong', { text: 'Web app version: ' }), el('code', { text: S.settings.appVersion || 'unknown' })),
    el('div', {}, el('strong', { text: 'Tabs created: ' }), el('code', { text: S.settings.setupDone ? 'yes' : 'no' })),
    el('div', {}, el('strong', { text: 'Last sync: ' }), el('code', { text: S.settings.lastSyncAt ? relTime(S.settings.lastSyncAt) : 'never' }))
  );

  bodies.seed.append(
    el('div', { class: 'btn-row' },
      el('button', {
        class: 'btn',
        text: 'Test connection',
        onclick: async () => {
          say('Contacting the web app...');
          try {
            const res = await ping();
            setSettings({ appVersion: String(res.version) });
            say(`Web app OK (version ${res.version}).`, 'good');
          } catch (err) {
            say(err.message, 'bad');
          }
          renderSteps(stepNodes.seed);
        }
      }),
      el('button', {
        class: 'btn',
        text: 'Create tabs & seed',
        onclick: async () => {
          say('Creating tabs and writing starter content...');
          try {
            const res = await setupSheet();
            setSettings({ setupDone: true });
            say(`Done. Created: ${(res.created || []).join(', ') || 'nothing new'}.`, 'good');
            document.dispatchEvent(new CustomEvent('devpad:changed'));
            renderSteps(stepNodes.seed);
          } catch (err) {
            say(err.message, 'bad');
          }
        }
      }),
      el('button', {
        class: 'btn',
        text: 'Sync now',
        onclick: async () => {
          say('Syncing...');
          try {
            const { problems } = await readAll();
            await flushOutbox();
            say(problems.length ? `Synced with problems: ${problems.join(' | ')}` : 'Synced.', problems.length ? 'bad' : 'good');
            renderSteps(stepNodes.seed);
          } catch (err) {
            say(err.message, 'bad');
          }
        }
      })
    ),
    status
  );

  const goto = (next, dir) => {
    stepDirection = dir;
    step = Math.max(0, Math.min(STEPS.length - 1, next));
    renderSteps(host);
  };

  bodies.seed.append(
    el('div', { class: 'step-nav' },
      el('button', { class: 'step-back', text: 'Back', onclick: () => goto(step - 1, 'back') }),
      el('button', { class: 'btn', text: 'Go to sign in', onclick: () => openSection('access') })
    )
  );

  const nav = el('div', { class: 'step-nav' },
    el('button', {
      class: 'step-back',
      text: 'Back',
      disabled: step === 0,
      onclick: () => goto(step - 1, 'back')
    }),
    el('button', {
      class: 'btn btn-primary',
      text: step === STEPS.length - 1 ? 'Done' : 'Next',
      onclick: () => (step === STEPS.length - 1 ? goto(0, 'back') : goto(step + 1, 'forward'))
    })
  );

  const current = bodies[STEPS[step].id];
  host.append(stepperBar(step), current, nav);
  stepNodes = bodies;
  slide(current, stepDirection);
  sheetInput.focus();
}

/** True once both endpoints are set and the sheet has been seeded. */
function setupComplete() {
  return isConfigured() && !!S.settings.setupDone;
}

function renderConnection(root) {
  if (!setupComplete()) {
    renderSteps(root);
    return;
  }

  const sheetInput = el('input', {
    class: 'input',
    placeholder: '1AbCdEf... or the full Sheet URL',
    value: S.settings.sheetId,
    spellcheck: false
  });
  sheetInput.addEventListener('input', debounce(() => {
    setSettings({ sheetId: extractSheetId(sheetInput.value) });
  }, 300));

  const appInput = el('input', {
    class: 'input',
    placeholder: 'https://script.google.com/macros/s/AKfy.../exec',
    value: S.settings.webAppUrl,
    spellcheck: false
  });
  appInput.addEventListener('input', debounce(() => setSettings({ webAppUrl: appInput.value.trim() }), 300));

  const status = el('div', { class: 'status-list' },
    el('div', {}, el('strong', { text: 'Sheet ID: ' }), el('code', { text: S.settings.sheetId || 'not set' })),
    el('div', {}, el('strong', { text: 'Web app: ' }), el('code', { text: S.settings.webAppUrl ? 'set' : 'not set' })),
    el('div', {}, el('strong', { text: 'Web app version: ' }), el('code', { text: S.settings.appVersion || 'unknown' })),
    el('div', {}, el('strong', { text: 'Tabs created: ' }), el('code', { text: S.settings.setupDone ? 'yes' : 'no' })),
    el('div', {}, el('strong', { text: 'Last sync: ' }), el('code', { text: S.settings.lastSyncAt ? relTime(S.settings.lastSyncAt) : 'never' }))
  );

  root.append(
    el('h3', { text: '1. Google Sheet' }),
    field('Sheet ID or URL', sheetInput, 'Create an empty spreadsheet, then share it "Anyone with the link" (Viewer).'),
    el('h3', { text: '2. Web app' }),
    field('/exec URL', appInput, 'Apps Script > Deploy > New deployment > Web app. Execute as: Me. Access: Anyone.'),
    el('h3', { text: '3. Test and seed' }),
    el('div', { class: 'btn-row' },
      el('button', {
        class: 'btn',
        text: 'Test connection',
        onclick: async () => {
          say('Contacting the web app...');
          try {
            const res = await ping();
            setSettings({ appVersion: String(res.version) });
            say(`Web app OK (version ${res.version}).`, 'good');
            render();
          } catch (err) {
            say(err.message, 'bad');
          }
        }
      }),
      el('button', {
        class: 'btn',
        text: 'Create tabs & seed',
        onclick: async () => {
          say('Creating tabs and writing starter content...');
          try {
            const res = await setupSheet();
            setSettings({ setupDone: true });
            say(`Done. Created: ${(res.created || []).join(', ') || 'nothing new'}.`, 'good');
            document.dispatchEvent(new CustomEvent('devpad:changed'));
            render();
          } catch (err) {
            say(err.message, 'bad');
          }
        }
      }),
      el('button', {
        class: 'btn',
        text: 'Sync now',
        onclick: async () => {
          say('Syncing...');
          try {
            const { problems } = await readAll();
            await flushOutbox();
            say(problems.length ? `Synced with problems: ${problems.join(' | ')}` : 'Synced.', problems.length ? 'bad' : 'good');
            render();
          } catch (err) {
            say(err.message, 'bad');
          }
        }
      })
    ),
    status
  );
}

function renderAccess(root) {
  if (!isConfigured()) {
    root.append(el('p', { class: 'muted', text: 'Finish the Connection section first.' }));
    return;
  }

  if (isSignedIn()) {
    root.append(
      el('div', { class: 'session' },
        el('div', {},
          el('strong', { text: S.session.name }),
          el('span', { class: `chip chip-${S.session.role}`, text: S.session.role === 'admin' ? 'Admin' : 'Editor' })
        ),
        el('p', { class: 'muted tiny', text: S.session.role === 'admin'
          ? 'Your changes are written to the sheet immediately.'
          : 'Your changes to snippets, checklist items and articles are queued until an admin approves them.' })
      ),
      el('div', { class: 'btn-row' },
        el('button', {
          class: 'btn',
          text: 'Sign out',
          onclick: () => {
            signOut();
            document.dispatchEvent(new CustomEvent('devpad:changed'));
            render();
          }
        })
      )
    );
  } else {
    const nameInput = el('input', { class: 'input', type: 'text', placeholder: 'Your name', autocomplete: 'username', spellcheck: false });
    const passInput = el('input', { class: 'input', type: 'password', placeholder: 'Password', autocomplete: 'current-password', spellcheck: false });
    root.append(
      el('h3', { text: 'Sign in' }),
      field('Name', nameInput),
      field('Password', passInput),
      el('div', { class: 'btn-row' },
        el('button', {
          class: 'btn btn-primary',
          text: 'Sign in',
          onclick: async () => {
            say('Signing in...');
            try {
              const session = await authenticate(nameInput.value.trim(), passInput.value);
              say(`Signed in as ${session.name} (${session.role}).`, 'good');
              document.dispatchEvent(new CustomEvent('devpad:changed'));
              render();
            } catch (err) {
              say(err.message, 'bad');
            }
          }
        })
      ),
      el('p', {
        class: 'muted tiny',
        text: 'No account yet? An admin adds a row to the Users tab on the spreadsheet with your name, a password and a role of admin or editor. Nothing else is needed.'
      })
    );
  }

  if (isAdmin()) {
    root.append(el('hr', {}), el('h3', { text: 'People' }));
    const usersHost = el('div');
    root.append(usersHost);
    renderUsers(usersHost);
  }
}

function renderSites(root) {
  if (!S.sites.length) {
    root.append(el('p', { class: 'muted', text: 'No sites tracked yet. Open a site tab and use "Track this site".' }));
  }
  for (const site of S.sites) {
    const tally = siteTally(site.host);
    root.append(
      el('div', { class: 'site-row' },
        el('div', { class: 'site-info' },
          el('strong', { text: site.label || site.host }),
          el('div', { class: 'muted tiny', text: site.host }),
          el('div', { class: 'bar bar-sm' }, el('i', { style: { width: `${pct(tally.done, tally.total)}%` } })),
          el('div', { class: 'muted tiny', text: `${tally.done}/${tally.total} done - last seen ${relTime(site.lastSeen)}` })
        ),
        el('div', { class: 'row-actions' },
          el('button', {
            class: 'btn btn-sm',
            text: 'Open',
            onclick: () => {
              window.open(`https://${site.host}`, '_blank');
            }
          }),
          el('button', {
            class: 'btn btn-sm btn-danger',
            text: 'Remove',
            onclick: () => {
              if (!confirm(`Stop tracking ${site.host}? Progress rows stay in the sheet.`)) return;
              removeSite(site.host);
              document.dispatchEvent(new CustomEvent('devpad:changed'));
              render();
            }
          })
        )
      )
    );
  }

  const input = el('input', { class: 'input', placeholder: 'example.com', spellcheck: false });
  root.append(
    el('hr', {}),
    el('h3', { text: 'Add a site' }),
    el('div', { class: 'form-row' },
      input,
      el('button', {
        class: 'btn btn-primary btn-sm',
        text: 'Add',
        onclick: async () => {
          const host = normalizeHost(input.value);
          if (!host) {
            toast('That does not look like a domain.', 'error');
            return;
          }
          const res = await queueSite(host, host);
          if (res && res.error) {
            toast(res.error, 'error');
            return;
          }
          upsertSite(host, {});
          input.value = '';
          document.dispatchEvent(new CustomEvent('devpad:changed'));
          render();
        }
      })
    )
  );
}

function renderData(root) {
  const queue = outboxSummary();
  root.append(
    el('h3', { text: 'Local data' }),
    el('div', { class: 'status-list' },
      el('div', {}, el('strong', { text: 'Snippets: ' }), el('code', { text: S.snippets.length })),
      el('div', {}, el('strong', { text: 'Checklist items: ' }), el('code', { text: S.checklist.length })),
      el('div', {}, el('strong', { text: 'Handbook articles: ' }), el('code', { text: S.handbook.length })),
      el('div', {}, el('strong', { text: 'Sites: ' }), el('code', { text: S.sites.length })),
      el('div', {}, el('strong', { text: 'Queued writes: ' }), el('code', { text: `${queue.count} (${queue.shared} shared)` }))
    ),
    el('div', { class: 'btn-row' },
      el('button', {
        class: 'btn',
        text: 'Export JSON',
        onclick: () => downloadJson(`devpad-${new Date().toISOString().slice(0, 10)}.json`, {
          settings: { sheetId: S.settings.sheetId, webAppUrl: S.settings.webAppUrl },
          sites: S.sites,
          snippets: S.snippets,
          checklist: S.checklist,
          handbook: S.handbook,
          progress: S.progress
        })
      }),
      el('button', {
        class: 'btn',
        text: 'Import JSON',
        onclick: async () => {
          const file = await pickFile();
          if (!file) return;
          try {
            const data = JSON.parse(file.text);
            if (Array.isArray(data.snippets)) S.snippets = data.snippets;
            if (Array.isArray(data.checklist)) S.checklist = data.checklist;
            if (Array.isArray(data.handbook)) S.handbook = data.handbook;
            if (Array.isArray(data.sites)) S.sites = data.sites;
            if (data.progress) S.progress = data.progress;
            await saveNow();
            toast('Imported into local storage. Sync to push changes to the sheet.', 'success');
            document.dispatchEvent(new CustomEvent('devpad:changed'));
            render();
          } catch (err) {
            toast(`Import failed: ${err.message}`, 'error');
          }
        }
      }),
      el('button', {
        class: 'btn btn-danger',
        text: 'Reset local data',
        onclick: async () => {
          if (!confirm('Clear the local cache? The Google Sheet is untouched.')) return;
          await resetLocalData({ keepSession: true });
          document.dispatchEvent(new CustomEvent('devpad:changed'));
          render();
        }
      })
    ),
    el('h3', { text: 'When something does nothing' }),
    el('ul', { class: 'help-list' },
      el('li', { text: 'Reload the extension at chrome://extensions after any file change.' }),
      el('li', { text: 'Run npm run build first - the panel loads dist/, not src/.' }),
      el('li', { text: 'An old web app deployment looks like a missing feature. Press Test connection and compare the version.' }),
      el('li', { text: 'Reads fail if the sheet is not shared "Anyone with the link" (Viewer).' })
    )
  );
}

export function render() {
  if (!host) return;
  clear(host);

  const nav = el('div', { class: 'drawer-nav' },
    SECTIONS.map((s) =>
      el('button', {
        class: 'drawer-tab' + (section === s.id ? ' drawer-tab-active' : ''),
        text: s.label,
        onclick: () => {
          section = s.id;
          render();
        }
      })
    )
  );

  const body = el('div', { class: 'drawer-content' });
  messageNode = el('div', { class: 'drawer-msg' });

  if (section === 'connection') renderConnection(body);
  else if (section === 'access') renderAccess(body);
  else if (section === 'queue') renderQueue(body);
  else if (section === 'sites') renderSites(body);
  else renderData(body);

  host.append(nav, body, messageNode);
}

export function attach(node) {
  host = node;
}
