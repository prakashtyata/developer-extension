# Chrome Web Store submission

Everything the dashboard asks for, in the order it asks for it.

## 1. Before you can upload

- [ ] A Google account with a one-off **$5 developer registration fee**, paid at
      <https://chrome.google.com/webstore/devregister>.
- [ ] Verify the listing is only visible to you while it is in review
      (Visibility → Private). Unpublish during review or accept that other people
      can install it.
- [ ] Host `PRIVACY.md` somewhere public and put that URL in Privacy practices.
      The dashboard requires a **public URL**, not a file in the zip.

## 2. Package

```bash
npm run build
npm run store:zip
```

That writes `release/wp-dev-pad-<version>.zip`. The script refuses to package if
the manifest is missing an icon, if a path the manifest points at is absent, or
if `dist/` has not been built. It contains `manifest.json`, `dist/` and
`icons/`, and nothing else — no source, no tests, and not `apps-script.gs`.

Upload that zip. Then bump `version` in `manifest.json` before every later
upload; the store rejects a re-upload of a version it has already seen.

### Two descriptions, two limits

The dashboard has a description box, and `manifest.json` has another. They are
different fields with different limits, and the store's error names the one it
means:

| Where | Limit | Too long gives you |
| --- | --- | --- |
| Store listing description | 16,000 | a review rejection |
| `manifest.json` `description` | **132** | `There was a problem uploading your file` |

An over-long `manifest.json` description is an **upload** failure, not a review
verdict, so it never reaches a reviewer. The build refuses to package above 132
and the packaged zip is checked again after it is written.

### Check any zip before you upload it

```bash
npm run store:check -- <path-to-zip>
```

This reads the archive rather than the working tree, so it reports the file you
would actually upload: version, description length, and whether the shape is
acceptable. Exit code is non-zero when the package will be rejected.

> Do not zip the project folder by hand. A folder zip puts `manifest.json` one
> level down, where the store cannot see it, and drags in `node_modules/`,
> `src/`, `tools/`, source maps and `apps-script.gs` — the Apps Script backend
> would become public to anyone who unzips the package. Only the
> `release/` zip is shaped correctly. Run `store:check` on anything else first.

## 3. Listing copy

**Category:** Developer Tools → Workflow & Planning
(or Productivity → Task Management)

**Language:** English (United States)

**Short description** (max 132 characters):

> WordPress snippets, site checklists and a handbook, kept in sync with one Google Sheet.

**Detailed description** (max 16,000 characters):

> WP Dev Pad is a side panel for WordPress work. It keeps your code snippets,
> per-site checklists and a small handbook in a Google Sheet you own, so the whole
> team edits the same library instead of passing code around in chat.
>
> **Snippets.** A searchable library with copy buttons, tags, categories and
> syntax highlighting, so the code you saved reads clearly when you come back to
> it. Select code and copy, or copy a whole snippet with one click.
>
> **Checklist.** A WordPress launch and maintenance checklist per site. Tick items
> off, add a note, and watch the progress bar for the site you currently have
> open. The panel reads the active tab's hostname so it always shows the right
> site.
>
> **Handbook.** Short reference articles written in Markdown, with code blocks
> and syntax highlighting.
>
> **Approvals.** Editors can propose changes instead of writing straight to the
> shared sheet. An admin reviews each one and approves or rejects it, so the
> snippet library stays curated without blocking the team.
>
> **People.** Add people by name and password. Editors queue their changes;
> admins write directly.
>
> **Your data stays in your sheet.** There is no analytics, no advertising and no
> third-party server. The extension talks only to the Google Sheet and Apps Script
> web app you configure, and works offline by queueing writes until you are back
> online.
>
> Sign-in is required because the snippet library is shared with your team, not
> published publicly.

### Do not list the supported languages

An earlier revision of this description ended with a run-on list of every
language the editor highlights:

> JavaScript, TypeScript, HTML, CSS, SCSS, JSON, YAML, Python, SQL, Bash, XML,
> Markdown, diff and plain text.

Chrome rejected it for **keyword spam** (Routing ID FZSL), quoting that line
verbatim. The list was accurate, but it is exactly the shape an automated
metadata check looks for: a dense run of unrelated, comma-separated terms with
no sentences around them. Naming them does not help the reader choose the
extension, and PHP alone is the only one that matters for a WordPress tool.

Say "syntax highlighting" and let the extension speak for itself. The same
applies to anything else in this file that reads as a bare enumeration: the
permission names in section 5 are fine, because each is followed by a sentence
explaining what it does, but do not add a language list, a feature matrix, or a
list of supported CMS platforms anywhere in the listing copy.

## 4. Privacy practices

- **Single purpose description** (the question that trips most submissions):
  > WP Dev Pad is a developer reference and task tracker for WordPress work. It
  > stores code snippets, a per-site checklist and reference articles in a Google
  > Sheet the user configures, and shows them in a side panel. The snippet library
  > is shared with a team, so the extension requires sign-in before it will
  > display or modify that shared data.
- **Privacy policy URL:** your hosted copy of `PRIVACY.md`
- **Remote code:** No. The extension bundles all of its JavaScript and downloads
  nothing at runtime.
- **Data usage declarations.** Answer yes to the ones that apply and no to the
  rest. The honest list for this build:

  | Declaration | Answer | Why |
  | --- | --- | --- |
  | Website content | **Yes** | Snippets and handbook articles are written to the user's own sheet, and the extension reads the active tab's hostname |
  | User activity | **Yes** | Sign-in name, last-seen time, and change-request history are stored in the user's own sheet |
  | User-provided content | **Yes** | Snippets, checklist notes, handbook articles and passwords are the content the user supplies |
  | Browsing history | **No** | Only the active tab's hostname is read, to choose the checklist, and it is not sent anywhere but the user's own sheet |
  | Bookmarks / History / Downloads / Location / Financial / Health / Personal communications / Advertising / Web browsing | **No** | Not used |
  | Data sold to third parties | **No** | |
  | Data used for creditworthiness, lending or advertising | **No** | |
  | Data for unrelated purposes | **No** | |

- **Certification:** tick the boxes that apply — no ads, no data selling, no
  unrelated use, and you can explain the single purpose above.

## 5. Permission justifications

The review form asks why each permission is needed. Use these answers verbatim.

**`storage`**
> Stores the user's snippets, checklist progress and session in chrome.storage.local
> so the side panel can load instantly and retry queued writes when offline.

**`sidePanel`**
> The extension's entire interface is a Chrome side panel.

**`tabs`**
> Reads only the hostname of the user's currently active tab, in order to show the
> checklist for the site they are working on. It does not read page content, does
> not read other tabs, and does not send the hostname anywhere except the user's
> own Google Sheet.

**`clipboardWrite`**
> Copies a snippet, or the selected text inside the code editor, to the clipboard
> when the user presses the Copy button.

**`https://docs.google.com/*`**
> Reads the user's spreadsheet to display snippets, checklist items, handbook
> articles and progress.

**`https://script.google.com/*`**
> Sends the user's own writes — snippet edits, checklist progress, change
> approvals — to the Apps Script web app the user deployed and configured.

## 6. Screenshots

The store wants at least one, at **1280x800** or **640x400**.

These are generated for you:

```
npm run build
npm run store:shots
```

That writes `release/screenshots/*.png` at 1280x800 by rendering the real
built panel in a browser, so they cannot drift from the actual UI. Each shot is
checked against the rendered DOM before it is written, and the run fails if two
shots come out identical — a listing with four copies of one panel looks worse
than a listing with one honest screenshot.

Upload `1-snippets.png`, `3-checklist.png` and `4-handbook.png`. They are the
three strongest: they show what the extension is for without needing the reader
to have a Google Sheet of their own.

`2-snippet-open.png` (a snippet open in the CodeMirror editor) is best effort
and is skipped when the editor does not render in the headless harness. To
capture it by hand:

1. `npm run build`, then load the unpacked extension.
2. Open `chrome://extensions` → enable Developer mode → **Load unpacked**.
3. Sign in, open the side panel and widen it to 1280px.
4. Open a snippet, then capture at 1280x800.

The 128x128 icon in `icons/` is the store icon. It is generated without an
alpha channel (`npm run icons`), because the store listing icon is safest as an
opaque square PNG.

## 7. If it is rejected

The most common reasons, in the order they happen:

- **Permission justification missing or vague** — paste section 5 as-is.
- **Single purpose unclear** — the answer in section 4 is written to satisfy
  this; do not paraphrase it into something shorter.
- **The extension does nothing without a Google Sheet** — this is a real
  objection. It is answered by the single purpose statement: the shared snippet
  library *is* the feature. If it comes back, the strongest fix is to add a
  screenshot of the working panel to the listing, which is what section 6 is for.
- **Privacy policy unreachable** — the URL must be public. A `file://` path or a
  link to a private repository page will be rejected.

Rejection emails name a specific item. Fix that one item, bump the version in
`manifest.json`, re-run `npm run store:zip` and upload again.
