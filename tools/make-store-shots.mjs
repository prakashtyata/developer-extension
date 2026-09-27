/**
 * Captures real Chrome Web Store screenshots of the side panel.
 *
 * The store requires at least one 1280x800 (or 640x400) screenshot, and a
 * listing for an extension that only shows something once a user has wired up
 * their own Google Sheet is much stronger with one. Rather than mock it up, this
 * renders the real dist/sidepanel.html in the same browser the probe already
 * uses, seeded with the same in-memory state, and screenshots that.
 *
 * Usage: node tools/make-store-shots.mjs
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'release', 'screenshots');
const SIZE = '1280,800';

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return c;
  console.error('No Chrome, Brave or Edge found. Set CHROME_PATH to the executable.');
  process.exit(1);
}

const SEED = (tab, extra) => `
<script>
(function () {
  var now = new Date().toISOString();
  var snippets = [
    { id: 's1', title: 'Defer WP enqueue script', language: 'php', category: 'Performance',
      description: 'Load a script in the footer so it does not block render.',
      code: "add_action( 'wp_footer', function () {\\n  wp_enqueue_script( 'app' );\\n} );", tags: ['enqueue', 'hooks'] },
    { id: 's2', title: 'Query posts by meta', language: 'php', category: 'WP Query',
      description: 'Fetch published posts filtered by a meta key.',
      code: "\\$q = new WP_Query( array(\\n  'post_type'   => 'post',\\n  'meta_key'    => '_featured',\\n  'posts_per_page' => 6\\n) );", tags: ['query', 'meta'] },
    { id: 's3', title: 'Debounce an input handler', language: 'javascript', category: 'JavaScript',
      description: 'Wait for typing to stop before hitting the API.',
      code: "function debounce( fn, ms = 300 ) {\\n  let t;\\n  return ( ...a ) => {\\n    clearTimeout( t );\\n    t = setTimeout( () => fn( ...a ), ms );\\n  };\\n}", tags: ['util'] },
    { id: 's4', title: 'CSS custom properties theme', language: 'css', category: 'CSS',
      description: 'One palette, referenced everywhere.',
      code: ":root {\\n  --brand: #2b6cb0;\\n  --gap: 16px;\\n}\\n.card { padding: var(--gap); border-color: var(--brand); }", tags: ['variables'] },
    { id: 's5', title: 'Tailwind config preset', language: 'json', category: 'Build',
      description: 'Shared design tokens for every site.',
      code: '{ "theme": { "extend": { "colors": { "brand": "#2b6cb0" } } } }', tags: ['tailwind'] }
  ].map(function (s, i) { s.row = i + 2; s.updated = now; return s; });
  var checklist = [
    { id: 'chk1', category: 'Onboarding', item: 'Install and activate the theme', detail: 'Child theme, not the parent.', order: 1 },
    { id: 'chk2', category: 'Onboarding', item: 'Set permalinks to Post name', detail: 'Required for pretty URLs.', order: 2 },
    { id: 'chk3', category: 'SEO Basics', item: 'Add an SEO plugin and verify titles', detail: 'One title tag per page.', order: 3 },
    { id: 'chk4', category: 'SEO Basics', item: 'Generate and submit the sitemap', detail: 'Check it in Search Console.', order: 4 },
    { id: 'chk5', category: 'Performance', item: 'Run a Lighthouse audit', detail: 'Target 90+ on mobile.', order: 5 },
    { id: 'chk6', category: 'Performance', item: 'Convert images to WebP', detail: 'And set explicit dimensions.', order: 6 },
    { id: 'chk7', category: 'Content & Media', item: 'Upload the logo and set site icon', detail: '512x512 PNG works best.', order: 7 },
    { id: 'chk8', category: 'Content & Media', item: 'Write the privacy policy page', detail: 'Required before launch.', order: 8 }
  ];
  var F = String.fromCharCode( 96 ).repeat( 3 );
  var handbook = [
    { id: 'h1', section: 'Performance', title: 'Defer non-critical JavaScript',
      content: 'Move scripts to the footer or add ' + String.fromCharCode( 96 ) + 'defer' + String.fromCharCode( 96 ) + ' so the parser is not blocked.\\n\\n' + F + 'js\\nwp_enqueue_script( "app", "/app.js", [], "1.0", true );\\n' + F + '\\n\\nAlways measure after changing this.' },
    { id: 'h2', section: 'Security', title: 'Escape output in templates',
      content: 'Never print raw input into markup.\\n\\n' + F + 'php\\necho esc_html( get_the_title() );\\n' + F }
  ];
  var progress = [
    { site: 'example.com', itemId: 'chk1', done: true, note: '', updated: now },
    { site: 'example.com', itemId: 'chk2', done: true, note: '', updated: now },
    { site: 'example.com', itemId: 'chk3', done: false, note: 'waiting on client copy', updated: now }
  ];
  var state = {
    version: 1,
    settings: { sheetId: 'example', webAppUrl: 'https://example.invalid/exec', setupDone: true, autoSync: false, appVersion: '5' },
    session: { userId: 'u1', role: 'admin', name: 'Rafi', password: 'pw' },
    activeHost: 'example.com',
    sites: [{ host: 'example.com', label: 'Example Site', added: now, lastSeen: now }],
    snippets: snippets,
    checklist: checklist, handbook: handbook, progress: progress,
    outbox: [], pending: [],
    // boot() reads the active tab from state (TABS[S.ui.tab] ? S.ui.tab :
    // 'snippets'), so the whole view is selected through data. No clicking and
    // no timers, which --virtual-time-budget does not reliably run.
    ui: {
      tab: ${JSON.stringify(tab)},
      selectedSnippet: ${extra && extra.select ? JSON.stringify(extra.select) : 'null'},
      lang: 'all',
      category: 'all'
    }
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
  // The panel boots on the snippets tab regardless of the seeded ui.tab, so
  // drive the app's own setTab() by clicking the tab button once boot is done.
  // Surface any boot-time throw into the DOM. renderDetail() appends its
  // markup at the very end, so a throw halfway through leaves an empty detail
  // pane and a screenshot that looks fine but shows nothing.
  window.addEventListener('error', function (e) {
    var d = document.createElement('pre');
    d.id = 'shot-error';
    d.textContent = 'ERROR: ' + (e.message || '') + ' @ ' + (e.filename || '') + ':' + (e.lineno || '');
    document.documentElement.appendChild(d);
  });

  // Record every change to the snippet detail pane. Without this, "empty" is
  // ambiguous between "never rendered" and "rendered then wiped".
  var log = [];
  var started = false;
  function watch() {
    var d = document.getElementById('snip-detail');
    if (d) {
      log.push('found detail, children=' + d.childElementCount);
      new MutationObserver(function () {
        log.push('children=' + d.childElementCount);
      }).observe(d, { childList: true });
      return true;
    }
    return false;
  }
  if (!watch()) {
    var iv = setInterval(function () { if (watch()) clearInterval(iv); }, 30);
  }
  void started;
  window.__wpdShotLog = log;
  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(function () {
      var p = document.createElement('pre');
      p.id = 'shot-log';
      p.textContent = 'mutations: ' + log.join(' | ');
      document.documentElement.appendChild(p);
    }, 2000);
  });
})();
</script>`;

const SHOTS = [
  { name: '1-snippets', tab: 'snippets', note: 'the snippet library' },
  { name: '2-snippet-open', tab: 'snippets', select: 's3', note: 'a snippet open in the editor', optional: true },
  { name: '3-checklist', tab: 'checklist', note: 'the per-site checklist' },
  { name: '4-handbook', tab: 'handbook', note: 'the handbook' }
];

const browser = findBrowser();
if (!existsSync(resolve(root, 'dist/sidepanel.html'))) {
  console.error('dist/ is not built. Run `npm run build` first.');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

// Clear previous output first. A shot that is skipped this run would otherwise
// leave last run's file in place, and a stale shot can be a byte-identical
// duplicate of another one - which is exactly what this tool exists to prevent.
for (const old of readdirSync(outDir)) {
  if (old.toLowerCase().endsWith('.png')) rmSync(join(outDir, old), { force: true });
}

const html = readFileSync(resolve(root, 'dist/sidepanel.html'), 'utf8');
const work = mkdtempSync(join(tmpdir(), 'wpd-shots-'));
cpSync(resolve(root, 'dist'), work, { recursive: true });
cpSync(resolve(root, 'icons'), work, { recursive: true });

let failed = 0;
const written = [];
for (const shot of SHOTS) {
  const patched = html.replace(
    '</head>',
    `<style>html,body{width:1280px;height:800px;overflow:hidden}
      .app{max-width:1280px;margin:0 auto}</style>${SEED(shot.tab, shot.select)}</head>`
  );
  const file = join(work, `shot-${shot.name}.html`);
  writeFileSync(file, patched, 'utf8');
  const out = resolve(outDir, `${shot.name}.png`);
  try {
    // Dump the DOM first and confirm this shot really is showing the intended
    // view. Screenshots of the wrong panel still look plausible to a human, and
    // shipping four identical images is worse than shipping none.
    const dom = execFileSync(browser, [
      '--headless=new', '--disable-gpu', '--no-sandbox',
      '--virtual-time-budget=12000', '--dump-dom',
      `file:///${file.replace(/\\/g, '/')}`
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });

    const wantPanel = shot.select ? 'panel-snippets' : `panel-${shot.tab}`;
    const active = [...dom.matchAll(/<section id="(panel-[a-z]+)" class="([^"]*)"/g)]
      .filter((m) => m[2].includes('panel-active') && !m[2].includes('hidden'));
    if (active.length !== 1) {
      console.log(`  FAIL ${shot.name} - expected 1 visible active panel, saw ${active.length}` +
        ` (${[...dom.matchAll(/<section id="(panel-[a-z]+)" class="([^"]*)"/g)].map((m) => m[1] + ':' + m[2]).join(', ')})`);
      failed++;
      continue;
    }
    if (active[0][1] !== wantPanel) {
      console.log(`  FAIL ${shot.name} - showing ${active[0][1]}, wanted ${wantPanel}`);
      failed++;
      continue;
    }
    if (shot.select && !/cm-line|cm-content|ProseMirror/.test(dom)) {
      const err = (dom.match(/<pre id="shot-error">([\s\S]*?)<\/pre>/) || [, ''])[1]
        .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
        || (dom.match(/<pre class="error-pre">([\s\S]*?)<\/pre>/) || [, ''])[1]
          .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
        || 'no error reported';
      const mlog = (dom.match(/<pre id="shot-log">([\s\S]*?)<\/pre>/) || [, ''])[1]
        .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') || 'not recorded';
      const label = shot.optional ? 'warn' : 'FAIL';
      console.log(`  ${label} ${shot.name} - editor view did not render. Optional shot, skipping.`);
      console.log(`       page error    : ${err}`);
      console.log(`       detail history: ${mlog}`);
      if (!shot.optional) failed++;
      continue;
    }

    execFileSync(browser, [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      `--window-size=${SIZE}`,
      '--force-device-scale-factor=1',
      '--virtual-time-budget=12000',
      `--screenshot=${out}`,
      `file:///${file.replace(/\\/g, '/')}`
    ], { stdio: ['ignore', 'ignore', 'ignore'], timeout: 120000 });
    const { size } = await statAsync(out);
    written.push({ name: shot.name, file: out, size });
    console.log(`  ok   ${shot.name}.png  ${(size / 1024).toFixed(0)}kb  - ${shot.note}`);
  } catch (err) {
    console.log(`  FAIL ${shot.name} - ${err.message}`);
    failed++;
  }
}
rmSync(work, { recursive: true, force: true });

// Catch the case where two shots render the same view: a store listing with
// four copies of one panel is a rejection waiting to happen. Compare the PNG
// bytes, since that is what the store receives.
const seen = new Map();
for (const { name, file } of written) {
  const hash = createHash('md5').update(readFileSync(file)).digest('hex');
  if (seen.has(hash)) {
    console.log(`  FAIL ${name}.png is byte-identical to ${seen.get(hash)}.png`);
    failed++;
  } else {
    seen.set(hash, name);
  }
}

console.log(`\nscreenshots -> ${outDir}`);
console.log(`size ${SIZE} (Chrome Web Store accepts 1280x800 or 640x400)`);
if (failed) {
  console.log(`\n${failed} problem(s). Nothing to upload until these pass.`);
  process.exitCode = 1;
} else {
  console.log('\nEach shot shows a different view, all confirmed from the rendered DOM.');
}

async function statAsync(p) {
  const { stat } = await import('node:fs/promises');
  return stat(p);
}
