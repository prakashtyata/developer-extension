/**
 * Real-browser check for syntax highlighting.
 *
 * jsdom cannot lay out CodeMirror, so it cannot prove colors are painted. This
 * runs the built side panel in headless Edge/Chrome with the chrome.* APIs
 * stubbed, then reads getComputedStyle() off real token spans. That is the only
 * check that catches "the theme looks right but the user sees plain text".
 *
 * Run: npm run build && npm run probe
 * Set CHROME_PATH if the browser is somewhere unusual.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
if (!existsSync(join(dist, 'sidepanel.html'))) {
  console.error('dist/ is missing. Run: npm run build');
  process.exit(1);
}

function findBrowser() {
  // Any Chromium works, not just the ones in the default locations. If your Chrome
  // is installed somewhere unusual, point CHROME_PATH at it: the probe has to be
  // able to run in the same browser the user is actually using.
  const candidates = [
    process.env.CHROME_PATH,
    process.env.PROBE_BROWSER,
    // Brave first: it is the browser this is actually used in, so a browser
    // specific rendering problem shows up here instead of shipping.
    'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    join(process.env.LOCALAPPDATA || '', 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'),
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    join(process.env.LOCALAPPDATA || '', 'Microsoft\\Edge\\Application\\msedge.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium'
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    console.error('No Chrome or Edge found. Set CHROME_PATH to the executable.');
    process.exit(1);
  }
  console.log(`using browser: ${found}`);
  return found;
}

const CHROME_STUB = `<script>
(function () {
  var now = new Date().toISOString();
  // One snippet per language in the table. The old probe only ever loaded php and
  // css, which is how a language could ship permanently unhighlighted while the
  // probe stayed green.
  var SAMPLES = [
    ['php', '<?php\\n// note\\nfunction demo(\\$_a): int { return 1 + 2; }'],
    ['javascript', '// note\\nfunction demo(a) { return a + 1; }\\nconst s = "text";'],
    ['typescript', 'interface A { b: number }\\nconst f = (a: A): number => a.b;'],
    ['html', '<div class="a">text</div>'],
    ['xml', '<root><item id="1">x</item></root>'],
    ['css', '.a { color: red; }\\n/* note */'],
    ['scss', '$c: red;\\n.a { color: $c; &:hover { top: 0; } }'],
    ['bash', '#!/bin/bash\\n# note\\nfor f in *.txt; do echo "$f"; done'],
    ['sql', 'SELECT id, name FROM users WHERE id > 10; -- note'],
    ['json', '{"a": 1, "b": [true, null], "c": "s"}'],
    ['yaml', 'a: 1\\nb:\\n  - x\\n  - y'],
    ['python', '# note\\ndef demo(a):\\n    return a + 1'],
    ['markdown', '# Title\\n\\n- item\\n\\n**bold** and [link](http://x)'],
    ['diff', '--- a/x.txt\\n+++ b/x.txt\\n@@ -1 +1 @@\\n-old\\n+new'],
    ['plaintext', 'just some words with no grammar']
  ];
  var snippets = SAMPLES.map(function (s, i) {
    return { row: i + 2, id: 's' + i, title: s[0] + ' probe', language: s[0],
             category: 'Other', description: 'd', code: s[1], tags: [], updated: now };
  });
  var state = {
    version: 1,
    settings: { sheetId: 'probe', webAppUrl: 'https://example.invalid/exec', setupDone: true, autoSync: false },
    session: { userId: 'k1', role: 'admin', name: 'Probe', password: 'pw' },
    activeHost: 'example.com',
    sites: [{ host: 'example.com', label: 'Example', added: now, lastSeen: now }],
    snippets: snippets,
    checklist: [], handbook: [], progress: [], outbox: [], pending: [],
    ui: { tab: 'snippets', selectedSnippet: null, lang: 'all', category: 'all' }
  };
  window.chrome = {
    storage: { local: {
      get: function () { return Promise.resolve({ 'devpad.state': state }); },
      set: function () { return Promise.resolve(); }
    } },
    tabs: { query: function () { return Promise.resolve([{ url: 'https://example.com/' }]); } },
    runtime: {
      onInstalled: { addListener: function () {} },
      onMessage: { addListener: function () {} },
      sendMessage: function () { return Promise.resolve({}); },
      getURL: function (p) { return p; },
      lastError: null
    },
    sidePanel: { setPanelBehavior: function () {} }
  };
})();
</script>`;

const PROBE = `<script>
(function () {
  function report(obj) {
    var pre = document.createElement('pre');
    pre.id = 'probe-result';
    pre.textContent = JSON.stringify(obj);
    document.body.appendChild(pre);
  }
  function sample(editor) {
    var spans = Array.from(editor.view.dom.querySelectorAll('.cm-line span[class]'));
    var colors = {};
    spans.forEach(function (s) {
      var c = getComputedStyle(s).color;
      colors[c] = (colors[c] || 0) + 1;
    });
    var d = editor.debug();
    return {
      lang: d.lang,
      topType: d.topType,
      nodeNames: d.nodeNames,
      spanCount: spans.length,
      distinctColors: Object.keys(colors).length,
      colors: colors,
      samples: spans.slice(0, 6).map(function (s) {
        return { text: (s.textContent || '').slice(0, 16), color: getComputedStyle(s).color };
      })
    };
  }
  function visible(node) {
    return !!node && getComputedStyle(node).display !== 'none' && node.getBoundingClientRect().height > 0;
  }
  setTimeout(function () {
    try {
      var out = { editors: [], listMode: null, detailMode: null };
      var split = document.querySelector('#panel-snippets .split');
      var detail = document.querySelector('#snip-detail');
      var listPane = document.querySelector('#panel-snippets .list-pane');
      out.listMode = {
        detailHidden: !visible(detail),
        listVisible: visible(listPane),
        listHeight: listPane ? Math.round(listPane.getBoundingClientRect().height) : 0
      };

      // Open every snippet in turn - Back between each, because the list is hidden
      // while a detail is open. Sample as we go, since old editors get destroyed.
      var titles = Array.from(document.querySelectorAll('#panel-snippets .list .row'))
        .map(function (r) { return r.getAttribute('data-id') || r.textContent.trim().slice(0, 24); });
      out.rowCount = titles.length;
      out.languages = titles;
      var i = 0;
      function openAndSample(cb) {
        // The editor is created after the language promise resolves, so poll
        // instead of assuming it is there after a fixed delay.
        var tries = 0;
        (function poll() {
          var live = Array.from(window.__wpdEditors || []);
          if (live.length || tries++ > 12) return cb(live);
          setTimeout(poll, 60);
        })();
      }
      function step() {
        if (i >= titles.length) {
          out.count = out.editors.length;
          report(out);
          return;
        }
        var idx = i;
        var rows = Array.from(document.querySelectorAll('#panel-snippets .list .row'));
        var row = rows[idx];
        if (!row) { i++; setTimeout(step, 60); return; }
        row.click();
        setTimeout(function () {
          if (idx === 0) {
            out.detailMode = {
              detailVisible: visible(detail),
              listHidden: !visible(listPane),
              detailHeight: detail ? Math.round(detail.getBoundingClientRect().height) : 0,
              hasBackButton: !!(detail && detail.querySelector('.back-btn'))
            };
          }
              openAndSample(function (live) {
            try {
              if (live.length) {
                var s = sample(live[live.length - 1]);
                s.requested = titles[idx];
                out.editors.push(s);
              } else {
                out.editors.push({ lang: '?' + titles[idx], topType: null, spanCount: 0, distinctColors: 0, colors: {}, samples: [], requested: titles[idx] });
              }
              var back = detail && detail.querySelector('.back-btn');
              if (back) back.click();
            } catch (err3) {
              out.editors.push({ lang: '!' + titles[idx], topType: null, spanCount: 0, distinctColors: 0, colors: {}, samples: [], error: String(err3) });
            }
            i++;
            setTimeout(step, 150);
          });
        }, 260);
      }
      setTimeout(step, 400);
    } catch (err) {
      report({ error: String((err && err.stack) || err) });
    }
  }, 1500);
})();
</script>`;

const work = mkdtempSync(join(tmpdir(), 'wpd-probe-'));
try {
  cpSync(dist, work, { recursive: true });
  const html = readFileSync(join(work, 'sidepanel.html'), 'utf8');
  const patched = html.replace(
    '<script src="./sidepanel.js"></script>',
    `${CHROME_STUB}\n<script src="./sidepanel.js"></script>\n${PROBE}`
  );
  if (patched === html) {
    console.error('Could not find the bundle script tag in dist/sidepanel.html');
    process.exit(1);
  }
  writeFileSync(join(work, 'sidepanel.html'), patched, 'utf8');

  const browser = findBrowser();
  const url = `file:///${join(work, 'sidepanel.html').replace(/\\/g, '/')}`;
  const dom = execFileSync(browser, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--virtual-time-budget=45000',
    '--dump-dom',
    url
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });

  const m = dom.match(/<pre id="probe-result">([\s\S]*?)<\/pre>/);
  if (!m) {
    console.error('The probe never ran. Is the bundle throwing on load?');
    process.exit(1);
  }
  const result = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));

  if (result.error) {
    console.error('Probe threw: ' + result.error);
    process.exit(1);
  }

  let failed = 0;
  const check = (name, cond, extra = '') => {
    console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`);
    if (!cond) failed++;
  };

  console.log(`headless probe: ${result.count} editor(s) from ${result.rowCount} snippet(s)`);
  check('an editor was created', result.count > 0, `${result.count}`);

  const lm = result.listMode || {};
  check('list mode: list fills the tab', lm.listVisible === true && lm.listHeight > 200, `height=${lm.listHeight}`);
  check('list mode: detail is not shown', lm.detailHidden === true, `hidden=${lm.detailHidden}`);
  const dm = result.detailMode || {};
  check('clicking a snippet shows the detail', dm.detailVisible === true, `height=${dm.detailHeight}`);
  check('clicking a snippet hides the list', dm.listHidden === true, `listHidden=${dm.listHidden}`);
  check('detail has a back button', dm.hasBackButton === true);
  check('each view fills the whole tab on its own',
    Math.abs((dm.detailHeight || 0) - (lm.listHeight || 0)) < 8,
    `detail=${dm.detailHeight} list=${lm.listHeight}`);

  // Every language must actually parse and paint tokens. plaintext is the one
  // deliberate exception: it has no grammar, so flat text is correct.
  // yaml and diff only have to tokenise - their upstream grammars emit almost no
  // highlight tags (@lezer/highlight has no diff tags at all, lang-yaml tags only
  // `meta`), so a flat palette there is a property of the grammar, not a bug here.
  const SPARSE = { yaml: 'lang-yaml only tags meta', diff: 'no diff tags exist in @lezer/highlight' };
  const byLang = {};
  for (const ed of result.editors || []) byLang[ed.lang] = ed;
  const langs = Object.keys(byLang);
  console.log(`\nchecking ${langs.length} language(s): ${langs.join(', ')}`);
  for (const lang of langs) {
    const ed = byLang[lang];
    if (!ed) {
      check(`${lang}: editor was created`, false, 'no editor found');
      continue;
    }
    const parsed = !!ed.topType && ed.topType !== 'Text' && ed.spanCount > 0;
    if (lang === 'plaintext') {
      check('plaintext: stays plain by design', ed.distinctColors <= 1, JSON.stringify(ed.colors));
      continue;
    }
    if (SPARSE[lang]) {
      check(`${lang}: tokenised (sparse grammar: ${SPARSE[lang]})`, parsed,
        `root=${ed.topType || 'none'} spans=${ed.spanCount} colors=${ed.distinctColors}`);
      console.log(`       node names present: ${JSON.stringify(ed.nodeNames || [])}`);
      continue;
    }
    const flat = ed.distinctColors <= 1;
    check(`${lang}: highlighted (${ed.spanCount} spans, ${ed.distinctColors} colors)`, parsed && !flat,
      `root=${ed.topType || 'none'} ${JSON.stringify(ed.colors)}`);
    if (flat) console.log(`       node names present: ${JSON.stringify(ed.nodeNames || [])}`);
  }

  // Show the actual painted colors for every language, so a regression is visible
  // in the log and not just as a FAIL line.
  for (const ed of result.editors || []) {
    console.log(`\n${ed.lang} (root node: ${ed.topType || 'none'}, ${ed.spanCount} spans)`);
    for (const s of ed.samples || []) console.log(`       ${JSON.stringify(s.text)} -> ${s.color}`);
  }

  console.log(failed ? `\n${failed} probe check(s) failed` : '\nhighlighting is painted in a real browser');
  process.exit(failed ? 1 : 0);
} finally {
  rmSync(work, { recursive: true, force: true });
}
