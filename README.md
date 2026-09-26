# WP Dev Pad

A Chrome MV3 side panel with three tabs — **Snippets**, **Checklist**, **Handbook** — backed by a single Google Sheet.
Reads use the public gviz CSV endpoint (no OAuth, no API key); writes go through one Apps Script web app, which is
also where access keys are checked and where editor changes wait for admin approval.

## What it does

- **Snippets** — a shared, searchable code library with syntax highlighting (CodeMirror 6), language/category/tag
  filters, and copy/edit/delete. Search and list share the tab; opening a snippet slides the detail in to take over
  the full tab, with a back button in its header. The whole tab is locked until you enter an access key.
- **Checklist** — items grouped by usage (Pre-Deploy, Theme, SEO, Security, Go-Live, …) with a per-site tally.
  The panel detects the site in the active tab and keeps a separate done/notes record for each one.
- **Handbook** — WordPress developer notes in markdown, with highlighted code blocks, section tree and full-text search.

## Roles

| Role | Can do | Needs approval |
| --- | --- | --- |
| `admin` | Everything, including approving changes and managing keys | No — writes land immediately |
| `editor` | Everything except approving or managing keys | Yes, for Snippets, Checklist items and Handbook articles |

Checklist **ticks and notes**, and the site registry, are never queued — they are per-person work tracking, not shared content.

## Setup (once)

### 1. Build and load the extension

```bash
npm install
npm run build
```

Then `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select this folder (`wp-dev-pad`).
`dist/` is generated; the panel loads `dist/`, never `src/`. Run `npm run watch` while developing and hit
**Reload** on the extension card after each build.

### 2. Create the spreadsheet

1. Create an empty Google Sheet.
2. **Share → Anyone with the link → Viewer.** The CSV read path needs this.
3. Copy the Sheet ID (or the whole URL) — the panel accepts either.

### 3. Deploy the web app

1. `apps-script.gs` in this folder is the script. Copy it into `Extensions → Apps Script` in a new project.
2. **Deploy → New deployment → Web app.**
   - Execute as: **Me**
   - Who has access: **Anyone**
3. Copy the `/exec` URL.

### 4. Finish in the panel

Open the side panel → the Settings drawer opens on **Connection**, which walks you through three steps:

| Step | Screen | What it does |
| --- | --- | --- |
| 1 | **Google Sheet** | Paste the Sheet ID or full URL (the app extracts the ID) |
| 2 | **Web app** | Paste the `/exec` URL from your deployment |
| 3 | **Test and seed** | `Test connection` pings the web app and shows its version (`Web app OK (version 4)`), `Create tabs & seed` creates the 7 tabs and writes starter snippets, checklist and handbook, `Sync now` reads all tabs into local storage |

`Next` and `Back` move between steps; the dots at the top show where you are.
Once the sheet is seeded the section switches to a single scrollable form.

Then **Access → Create first admin key**. The key is shown **once** — the sheet only keeps its SHA-256 hash.
Use that key to sign in, then create editor keys for other people in **Access → People**.

## Spreadsheet layout

| Tab | Columns | Written by |
| --- | --- | --- |
| `Snippets` | `id, title, language, category, description, code, tags, updated` | admin, or approved changes |
| `Checklist` | `id, category, item, detail, order` | admin, or approved changes |
| `Handbook` | `id, section, title, content` | admin, or approved changes |
| `Progress` | `site, itemId, done, note, updated` | any signed-in key, immediately |
| `Sites` | `host, label, added, lastSeen` | any signed-in key, immediately |
| `Users` | `keyId, label, role, keyHash, createdAt, active, lastSeen` | web app only |
| `Pending` | `changeId, op, tab, row, payload, requestedBy, requestedAt, status, decidedBy, decidedAt, reason` | web app only |

`Progress` is keyed on `site + itemId` (not on the item text), so renaming a checklist item never orphans a tally.
`Pending` rows are never deleted, so the tab doubles as the audit log.

## Editing starter content

`src/data.js` is the single source of truth for the seed. Edit it, then press **Create tabs & seed** again — it only
fills tabs that are still empty. Checklist item ids are load-bearing: `Progress` rows key off them, so keep
`chk_*` ids stable when you reorder or reword items.

## Web app actions

`ping` · `bootstrap` · `authenticate` · `readTab` · `setup` · `appendRow` · `updateRow` · `deleteRow` ·
`setProgress` · `bulkProgress` · `registerSite` · `deleteSite` · `submitChange` · `listPending` ·
`approveChange` · `rejectChange` · `listUsers` · `manageUser`

Every action is `POST`ed as JSON and answers `{ ok: true, ... }` or `{ ok: false, error }`.
`updateRow` and `deleteRow` re-verify the id in column A before writing, so a queued change can never clobber a
neighbouring row.

## Offline and queued writes

Everything is local-first. A change updates local storage instantly, is appended to an outbox, then flushed to the
sheet (700 ms debounce). If the web app is unreachable the strip under the header counts what is waiting. Snippets
cannot be *fetched* offline because that read is key-gated, but the last authenticated copy stays viewable and
signing out wipes it.

## When something silently does nothing

- The extension was not reloaded at `chrome://extensions` after a file change.
- `npm run build` was not run — the panel loads `dist/`.
- The web app deployment is old. **Test connection** prints the version; the script version is in `apps-script.gs`
  (`var VERSION`). Bump it whenever you change the script so the check is meaningful.
- The sheet is not shared "Anyone with the link", so the CSV reads fail.
- You are an editor and the change is sitting in **Approvals** waiting for an admin.

## Checks

```bash
npm run smoke    # csv / markdown / schema / seed-content assertions
npm run ui       # builds unminified, then boots the panel in jsdom and clicks through it
npm run probe    # runs dist/ in headless Chrome/Edge and reads painted colors
npm run verify   # smoke + build + UI walkthrough + real-browser probe
npm run icons    # regenerate icons/*.png
```

`npm run ui` drives the real bundle through three states — unconfigured, admin signed in, editor signed in —
and asserts the drawer, the three-step Connection wizard, all five settings sections, the snippet list, search,
CodeMirror, the checklist tally, the approval queue, the left/right slide transitions, the reduced-motion
path and the snippet full-tab takeover. It needs no Chrome and no network. When you add UI code, run it before
reloading the extension: it catches the class of failure where one thrown error silently blanks a panel.

It also inspects the live CodeMirror instance: the grammar has to be installed in the editor state, the document
has to parse, and the palette colours have to appear on real rendered token spans. That is the only way to catch
"the theme looks fine but every snippet is still plain text" without a browser.

`npm run probe` goes one step further and is the reason highlighting bugs stopped being guesswork: it copies
`dist/` to a temp folder, stubs the `chrome.*` APIs, opens the panel in headless Chrome/Edge, clicks a snippet and
reads `getComputedStyle()` off the rendered token spans. If the palette is not actually painted, it fails. Set
`CHROME_PATH` if your browser is not in a standard location.

### Reloading after a build

`npm run build` only rewrites `dist/`. Chrome keeps the old bundle until you press **Reload** on the extension card
at `chrome://extensions`, and an already-open side panel keeps its old document until you close and reopen it. If a
fix "does not show up", check that pair first.

## Layout

```
manifest.json        MV3 config, points at dist/
build.mjs            esbuild bundle + static copy
apps-script.gs       the only writer for the sheet
sidepanel/           sidepanel.html + sidepanel.css (copied to dist/)
src/
  main.js            boot, tabs, site detection, autosync
  store.js           state shape, chrome.storage.local, merge rules
  sheet.js           gviz reads, web app writes, outbox
  auth.js            key sign-in and user management
  approval.js        pending queue read/approve/reject
  schema.js          tab columns, encode/decode, language list
  data.js            starter snippets, checklist, handbook
  csv.js             RFC 4180 reader (snippet code has commas and newlines)
  editor.js          CodeMirror 6 factory + highlight palettes
  markdown.js        escape-first markdown renderer
  ui/                snippets, checklist, handbook, lock, queue, users, settings
  ui/nav.js          slide/stagger helpers shared by every view change
tools/               icon generator, smoke test, jsdom UI walkthrough
```

## Motion

Every navigation step slides horizontally: forward enters from the right, back enters from the left, and the
view you are leaving is pushed the opposite way. The direction comes from what you clicked (tab order, opening a
record, going back), never from a guess. Classes are removed on `animationend` and by a timeout, so a dropped
frame can never leave a view stuck off-screen, and everything is disabled under
`prefers-reduced-motion: reduce`.

## A note on the security model

The gviz read path requires the sheet to be publicly readable, so `Checklist`, `Handbook`, `Progress` and `Sites`
are readable by anyone who has the sheet URL. Keying the **write** path is enforced properly (hashed keys, checked
server side, every call re-verified). Keying the **read** path is only enforced for `Snippets`, which is why that
tab goes through the web app. If you need the other tabs private too, drop them from `CSV_TABS` in `src/schema.js`
and route them through `readTab`.
