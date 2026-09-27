# Privacy Policy for WP Dev Pad

**Last updated: 27 September 2026**

## Summary

WP Dev Pad stores its data in a Google Sheet that you own and control. The
extension does not use analytics, does not contain advertising, and does not
send your data to the extension author or to any third party. The only servers
the extension talks to are `script.google.com` and `docs.google.com`, which are
the Google Apps Script and Google Sheets endpoints you configure yourself.

## What the extension stores

| Data | Where it is stored | Why |
| --- | --- | --- |
| Sign-in name and password | The `Users` tab of your Google Sheet, in plain text | To check who is signing in |
| Code snippets | The `Snippets` tab of your Google Sheet | The snippet library |
| Checklist progress and notes | The `Checklist` and `Progress` tabs | Per-site progress |
| Handbook articles | The `Handbook` tab | Reference material |
| Tracked site hostnames | The `Sites` tab | To show the checklist for the current site |
| Pending change requests | The `Pending` tab | Editor changes waiting for admin approval |
| A copy of the above | `chrome.storage.local` on your own machine | To load the panel instantly and to retry writes when offline |
| Spreadsheet ID, web app URL, session | `chrome.storage.local` | Configuration and staying signed in |

**Anyone who can open your Google Sheet in plain text can read the passwords in
the `Users` tab.** That is a deliberate trade-off in exchange for signing in
with a name and password instead of a generated access key. Keep the
spreadsheet shared with as few people as possible, and do not reuse a password
you use elsewhere. If you would rather not store passwords in plain text, store
a one-time random string in the password column and treat that string as a
password.

## What the extension transmits

- Reads: the `Snippets`, `Checklist`, `Handbook`, `Progress`, `Sites` and
  `Pending` tabs of your spreadsheet, using Google's public CSV endpoint.
- Writes: snippet edits, checklist progress, notes, site registrations, pending
  change requests and approvals, sent as JSON to the web app URL you provide.

Nothing is transmitted anywhere else. There is no telemetry, no crash reporting
and no remote configuration.

## Permissions and why they are needed

| Permission | Why |
| --- | --- |
| `storage` | Keeps your data and session on your own machine |
| `sidePanel` | The extension is a side panel |
| `tabs` | Reads the current tab's hostname so the right site's checklist is shown. It reads no page content. |
| `clipboardWrite` | Copies a snippet when you press Copy |
| `https://docs.google.com/*` | Reads your spreadsheet |
| `https://script.google.com/*` | Writes to your spreadsheet through your own Apps Script deployment |

The extension contains no remotely hosted code. All of its JavaScript is bundled
into the package at build time and runs locally.

## Deleting your data

- Remove a snippet, checklist item or article from the extension, or delete the
  row in the spreadsheet.
- Revoke someone's access by setting `active` to `FALSE` in the `Users` tab, or
  delete their row.
- Remove everything the extension has stored by clearing site data for the
  extension at `chrome://extensions` → WP Dev Pad → Details → Storage → Clear.
- Delete the spreadsheet to remove everything the extension wrote.

## Children

The extension is a developer tool intended for adults and is not directed at
children.

## Changes

If this policy changes, the updated version will be in the extension's
repository alongside the code.
