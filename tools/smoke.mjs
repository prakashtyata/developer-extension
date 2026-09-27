/**
 * Pure-logic checks for the pieces that do not need Chrome.
 * Run: node tools/smoke.mjs
 */
import { readFileSync } from 'node:fs';
import { parseCsv, rowsToObjects, readCsv } from '../src/csv.js';import { parseMarkdown, renderInline } from '../src/markdown.js';
import { TABS, SCHEMA, encodeRows, decodeRows, progressKey, LANGUAGES } from '../src/schema.js';
import { DEFAULT_SNIPPETS, DEFAULT_CHECKLIST, DEFAULT_HANDBOOK } from '../src/data.js';
import { normalizeHost, escapeHtml, debounce, slugify } from '../src/util.js';
import { tags as HIGHLIGHT_TAGS } from '@lezer/highlight';

let failed = 0;
const check = (name, cond, extra = '') => {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name} ${extra}`);
  }
};

console.log('csv');
const tricky = 'id,code\r\ns1,"line1, with comma\nline2 ""quoted"""\r\ns2,plain\r\n\r\n';
const rows = parseCsv(tricky);
check('row count includes trailing blank line', rows.length === 4, JSON.stringify(rows.map((r) => r.length)));
check('embedded newline + comma + escaped quotes', rows[1][1] === 'line1, with comma\nline2 "quoted"');
const objs = readCsv(tricky);
check('blank rows dropped', objs.length === 2);
check('physical row number kept', objs[1].__row === 3, `got ${objs[1] && objs[1].__row}`);
check('rowsToObjects tolerates empty input', rowsToObjects([]).length === 0);

console.log('util');
check('normalizeHost strips scheme/www/path', normalizeHost('https://www.Example.com/some/page?x=1') === 'example.com');
check('normalizeHost keeps localhost port', normalizeHost('http://localhost:3000/wp') === 'localhost:3000');
check('normalizeHost empty', normalizeHost('') === '');
check('escapeHtml', escapeHtml('<b>"x"</b>') === '&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
check('slugify', slugify('Hello, World! 42') === 'hello-world-42');

console.log('markdown');
const blocks = parseMarkdown('# Title\n\nSome **bold** text.\n\n- one\n- two\n\n```php\n<?php echo 1;\n```\n');
check('block types', blocks.map((b) => b.type).join(',') === 'html,html,html,code', blocks.map((b) => b.type).join(','));
check('fence captured', blocks[3].code === '<?php echo 1;', JSON.stringify(blocks[3] && blocks[3].code));
check('fence language', blocks[3].lang === 'php');
check('inline bold', renderInline('a **b** c') === 'a <strong>b</strong> c');
check('inline code span', renderInline('use `esc_html()` now') === 'use <code>esc_html()</code> now');
check('script tag escaped', !renderInline('<script>alert(1)</script>').includes('<script'));
check('js link stripped', renderInline('[x](javascript:alert(1))') === 'x', renderInline('[x](javascript:alert(1))'));
check('http link kept', renderInline('[x](https://a.test/p?q=1)').includes('href="https://a.test/p?q=1"'));

console.log('schema');
for (const [tab, cols] of Object.entries(TABS)) {
  check(`${tab} columns unique`, new Set(cols).size === cols.length);
}
const enc = encodeRows('Snippets', DEFAULT_SNIPPETS);
check('snippet encode width', enc.every((r) => r.length === TABS.Snippets.length));
check('snippet tags joined', enc[0][6] === DEFAULT_SNIPPETS[0].tags.join(', '));
const back = decodeRows('Snippets', rowsToObjects([TABS.Snippets, ...enc]));
check('snippet round trip title', back[0].title === DEFAULT_SNIPPETS[0].title);
check('snippet round trip code', back[0].code === DEFAULT_SNIPPETS[0].code);
check('snippet round trip tags', back[1].tags.join('|') === DEFAULT_SNIPPETS[1].tags.join('|'));
check('progress done parsing', decodeRows('Progress', rowsToObjects([TABS.Progress, ['a.com', 'chk_x', 'TRUE', '', '']]))[0].done === true);
check('progress blank is not done', decodeRows('Progress', rowsToObjects([TABS.Progress, ['a.com', 'chk_x', '', '', '']]))[0].done === false);
check('pending payload parsed', decodeRows('Pending', rowsToObjects([TABS.Pending, ['c_1', 'update', 'Snippets', 3, '{"id":"x"}', 'Rafi', '', 'Pending', '', '', '']]))[0].payload.id === 'x');
check('pending bad payload does not throw', decodeRows('Pending', rowsToObjects([TABS.Pending, ['c_1', 'update', 'S', 3, 'not json', '', '', 'Pending', '', '', '']]))[0].payload.id === undefined);
check('progressKey', progressKey('a.com', 'chk_x') === 'a.com::chk_x');
check('Users/Handbook encode throws', (() => {
  try {
    SCHEMA.Users.encode({});
    return false;
  } catch {
    return true;
  }
})());

console.log('seed content');
check('snippets present', DEFAULT_SNIPPETS.length >= 20, DEFAULT_SNIPPETS.length);
check('snippet ids unique', new Set(DEFAULT_SNIPPETS.map((s) => s.id)).size === DEFAULT_SNIPPETS.length);
check('snippet languages known', DEFAULT_SNIPPETS.every((s) => LANGUAGES.some((l) => l.id === s.language)), DEFAULT_SNIPPETS.filter((s) => !LANGUAGES.some((l) => l.id === s.language)).map((s) => s.language).join(','));
const fetchSnippet = DEFAULT_SNIPPETS.find((s) => s.id === 'snip_js_fetch_rest');
check('template holes survive as literal text', fetchSnippet.code.includes('${window.DevPadData.restUrl}') && fetchSnippet.code.includes('${res.status}'));
check('no undefined from bad interpolation', !DEFAULT_SNIPPETS.some((s) => s.code.includes('undefined')));
check('checklist items >= 50', DEFAULT_CHECKLIST.length >= 50, DEFAULT_CHECKLIST.length);
check('checklist ids unique', new Set(DEFAULT_CHECKLIST.map((c) => c.id)).size === DEFAULT_CHECKLIST.length);
check('every category has items', new Set(DEFAULT_CHECKLIST.map((c) => c.category)).size >= 8);
check('handbook articles >= 15', DEFAULT_HANDBOOK.length >= 15, DEFAULT_HANDBOOK.length);
check('handbook ids unique', new Set(DEFAULT_HANDBOOK.map((h) => h.id)).size === DEFAULT_HANDBOOK.length);
check('handbook has fenced code', DEFAULT_HANDBOOK.every((h) => h.content.includes('```')));
const mdBlocks = parseMarkdown(DEFAULT_HANDBOOK[0].content);
check('handbook parses to blocks', mdBlocks.length > 3, mdBlocks.length);
check('handbook has code blocks', mdBlocks.some((b) => b.type === 'code'));

console.log('debounce');
const order = [];
const fn = debounce((v) => order.push(v), 10);
fn(1);
fn(2);
fn.cancel();
fn(3);
await new Promise((r) => setTimeout(r, 40));
check('cancel drops pending', order.length === 1 && order[0] === 3, order.join(','));

console.log('apps script contract');
const gs = readFileSync(new URL('../apps-script.gs', import.meta.url), 'utf8');
const actionBlock = gs.match(/var ACTIONS = \{([\s\S]*?)\n\};/);
const actions = actionBlock ? [...actionBlock[1].matchAll(/(\w+):\s*fn\w+/g)].map((m) => m[1]) : [];
const RESERVED = ['add', 'setRole', 'revoke', 'restore', 'append', 'update', 'delete', 'progress', 'site'];
check('actions parsed from script', actions.length === 17, actions.join(','));
check('bootstrap action is gone', !actions.includes('bootstrap'), actions.join(','));
check('script is version 5', /var VERSION = 5;/.test(gs));
check('no sub-action shadows the dispatcher', !actions.some((a) => RESERVED.includes(a)),
  actions.filter((a) => RESERVED.includes(a)).join(','));
check('manageUser reads userAction, not action', /p\.userAction/.test(gs) && /var action = String\(p\.userAction/.test(gs));

console.log('name + password sign-in');
const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
check('Users tab has no key columns', !/keyHash/.test(gs) && !/'keyId'/.test(gs), 'key columns still present');
check('Users tab stores name and password', /Users: \['userId', 'name', 'password', 'role'/.test(gs));
check('auth matches on name and password', /findUserRow_\(sh, name, password\)/.test(gs));
check('no key generation left', !/generateKey_|wpd_/.test(gs), 'key generator still present');
check('no hashing left', !/sha256_/.test(gs), 'sha256 still present');
check('client sends name and password', /name: S\.session \? S\.session\.name/.test(src('sheet.js')) && /password: S\.session \? S\.session\.password/.test(src('sheet.js')));
check('client session has no key field', !/session\.key\b/.test(src('sheet.js') + src('auth.js') + src('store.js')));
check('client authenticates with name + password', /authenticate\(rawName, rawPassword\)/.test(src('auth.js')));

console.log('web app url guard');
const sheetSrc = src('sheet.js');
check('rejects a non-/exec url', sheetSrc.includes('/exec\\/?$/.test(url)'), 'no /exec guard');
check('names the /dev mistake specifically', sheetSrc.includes('not a deployment URL') && sheetSrc.includes('Deploy > Manage deployments'), 'no /dev hint');
check('html reply is explained, not raw', sheetSrc.includes('HTML page instead of JSON') && sheetSrc.includes('doPost function'), 'no html explanation');
check('unknown action names itself', /UNKNOWN_ACTION/.test(sheetSrc) && sheetSrc.includes('different versions'), 'no unknown-action hint');
check('every action has a function', actions.every((a) => new RegExp(`function fn${a[0].toUpperCase()}${a.slice(1)}\\b`).test(gs)),
  actions.filter((a) => !new RegExp(`function fn${a[0].toUpperCase()}${a.slice(1)}\\b`).test(gs)).join(','));
check('client sends userAction', /callWebApp\('manageUser', \{ userAction: action/.test(readFileSync(new URL('../src/auth.js', import.meta.url), 'utf8')));

console.log('highlighter');
{
  // Importing the real module executes buildHighlightStyle(), which is the only
  // reliable way to catch a bad tag reference (e.g. calling a plain tag as if it
  // were a combinator). A regex over the source would happily pass while the
  // bundle throws on load.
  const editorSrc = readFileSync(new URL('../src/editor.js', import.meta.url), 'utf8');
  const { HIGHLIGHTED_TAGS } = await import('../src/editor.js');
  check('editor module builds its highlight styles', !!HIGHLIGHTED_TAGS);
  check('HIGHLIGHTED_TAGS is a non-empty array', Array.isArray(HIGHLIGHTED_TAGS) && HIGHLIGHTED_TAGS.length > 0,
    `${HIGHLIGHTED_TAGS && HIGHLIGHTED_TAGS.length} tags`);
  check('every documented highlight tag resolves', HIGHLIGHTED_TAGS.every((name) => HIGHLIGHT_TAGS[name] !== undefined),
    HIGHLIGHTED_TAGS.filter((name) => HIGHLIGHT_TAGS[name] === undefined).join(', '));

  // Every `t.<name>` reference must exist on @lezer/highlight's tags object.
  const referenced = [...editorSrc.matchAll(/\bt\.([A-Za-z0-9_]+)/g)].map((m) => m[1]);
  const missing = [...new Set(referenced)].filter((r) => !(r in HIGHLIGHT_TAGS));
  check('all highlight tags exist in @lezer/highlight', missing.length === 0, `missing: ${missing.join(', ')}`);

  // Only the documented combinators may be called, never a plain Tag.
  const combinators = new Set(['special', 'constant', 'function', 'definition', 'local', 'standard']);
  const called = [...editorSrc.matchAll(/\bt\.([A-Za-z0-9_]+)\s*\(/g)].map((m) => m[1]);
  const badCalls = [...new Set(called)].filter((c) => !combinators.has(c));
  check('only real tag combinators are called', badCalls.length === 0, `not combinators: ${badCalls.join(', ')}`);

  check('no var() colors in highlight style', !/color:\s*'var\(--/.test(editorSrc));
  check('both palettes defined', /light:\s*\{/.test(editorSrc) && /dark:\s*\{/.test(editorSrc));
  check('language table covers every schema language', (() => {
    const table = editorSrc.slice(editorSrc.indexOf('const LANGUAGES = {'), editorSrc.indexOf('const langCache'));
    const ids = [...table.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]);
    const wanted = LANGUAGES.map((l) => l.id);
    return wanted.every((w) => ids.includes(w)) && ids.length === wanted.length;
  })());
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
