import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, placeholder as cmPlaceholder, drawSelection, highlightActiveLine } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { HighlightStyle, syntaxHighlighting, LanguageSupport, StreamLanguage, syntaxTree, Language } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { php } from '@codemirror/lang-php';
import { sql } from '@codemirror/lang-sql';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { yaml } from '@codemirror/lang-yaml';
import { xml } from '@codemirror/lang-xml';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { diff } from '@codemirror/legacy-modes/mode/diff';
import { tags } from '@lezer/highlight';

const t = tags;

/**
 * Literal palettes, not CSS custom properties. CodeMirror injects its own
 * stylesheet and picks the style up at mount time, so `var(--x)` only worked by
 * luck of cascade order. Two palettes are selected at mount and swapped live.
 */
const PALETTE = {
  light: {
    comment: '#6a737d', keyword: '#b02a8f', string: '#1a7f37', number: '#0550ae',
    func: '#6639ba', type: '#953800', tag: '#116329', attr: '#0550ae', var: '#953800',
    op: '#57606a', punct: '#6e7781', heading: '#0550ae', link: '#0969da', invalid: '#cf222e', constant: '#0550ae'
  },
  dark: {
    comment: '#8b949e', keyword: '#ff7b72', string: '#a5d6ff', number: '#79c0ff',
    func: '#d2a8ff', type: '#ffa657', tag: '#7ee787', attr: '#79c0ff', var: '#ffa657',
    op: '#c9d1d9', punct: '#8b949e', heading: '#79c0ff', link: '#a5d6ff', invalid: '#ff7b72', constant: '#79c0ff'
  }
};

/** Every tag used below is checked against the installed @lezer/highlight. */
function buildHighlightStyle(scheme) {
  const c = PALETTE[scheme] || PALETTE.light;
  return HighlightStyle.define([
    { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: c.comment, fontStyle: 'italic' },
    {
      tag: [t.keyword, t.moduleKeyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword,
        t.self, t.null, t.atom, t.bool],
      color: c.keyword,
      fontWeight: '600'
    },
    { tag: [t.string, t.special(t.string), t.docString, t.regexp], color: c.string },
    { tag: [t.number, t.integer, t.float], color: c.number },
    { tag: [t.constant(t.variableName), t.standard(t.variableName)], color: c.constant },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName, t.labelName], color: c.func },
    { tag: [t.typeName, t.className, t.namespace, t.changed, t.modifier], color: c.type },
    { tag: [t.tagName, t.angleBracket, t.quote], color: c.tag },
    { tag: [t.propertyName, t.attributeName, t.attributeValue], color: c.attr },
    { tag: [t.definition(t.variableName), t.definition(t.propertyName), t.variableName, t.local(t.variableName)],
      color: c.var },
    { tag: [t.operator, t.derefOperator, t.arithmeticOperator, t.logicOperator, t.compareOperator,
      t.updateOperator, t.escape, t.processingInstruction, t.contentSeparator], color: c.op },
    { tag: [t.punctuation, t.separator, t.bracket, t.paren, t.squareBracket, t.brace, t.definition(t.propertyName)],
      color: c.punct },
    { tag: [t.annotation, t.modifier], color: c.type },
    { tag: [t.heading, t.heading1, t.heading2, t.heading3, t.strong], color: c.heading, fontWeight: '700' },
    { tag: [t.link, t.url, t.monospace], color: c.link, textDecoration: 'underline' },
    { tag: [t.emphasis], color: c.string, fontStyle: 'italic' },
    { tag: [t.strikethrough], color: c.comment, textDecoration: 'line-through' },
    { tag: [t.list], color: c.punct },
    { tag: [t.meta, t.documentMeta, t.annotation], color: c.comment },
    { tag: [t.character, t.escape, t.invalid], color: c.invalid }
  ]);
}

const HIGHLIGHT_STYLES = { light: buildHighlightStyle('light'), dark: buildHighlightStyle('dark') };

/** The set of tags the theme above can actually colour. Used by the smoke test. */
export const HIGHLIGHTED_TAGS = [
  'comment', 'keyword', 'string', 'number', 'function', 'typeName', 'tagName', 'propertyName',
  'variableName', 'operator', 'punctuation', 'heading', 'link', 'emphasis', 'invalid'
];

function isDark() {
  try {
    return !!window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}


/**
 * Language table. The keys match LANGUAGES in schema.js, which is also what the
 * Snippets dropdown offers, so the two stay in step.
 */
const LANGUAGES = {
  php: () => php(),
  javascript: () => javascript(),
  typescript: () => javascript({ typescript: true }),
  html: () => html(),
  xml: () => xml(),
  css: () => css(),
  scss: () => css({ dialect: 'scss' }),
  bash: () => StreamLanguage.define(shell),
  sql: () => sql(),
  json: () => json(),
  yaml: () => yaml(),
  python: () => python(),
  markdown: () => markdown(),
  diff: () => StreamLanguage.define(diff),
  plaintext: () => []
};

const langCache = new Map();

/**
 * A language factory returns either an array of extensions, a LanguageSupport
 * (most packages), or a bare Language (StreamLanguage.define). All three are valid
 * inputs to `extensions`, so pass anything non-empty straight through.
 *
 * This used to test `support.language || support.extension`, which is only true
 * for LanguageSupport. A bare Language has neither, so bash and diff silently got
 * `[]` and rendered as plain text forever.
 */
function toExtensions(support) {
  if (!support) return [];
  return Array.isArray(support) ? support.filter(Boolean) : [support];
}

/**
 * Live editors, mirrored onto globalThis so the jsdom harness can inspect
 * highlighting. Without a seam like this there is no way to tell a broken
 * theme from a browser that simply cannot be screenshotted here.
 */
const live = new Set();
if (typeof globalThis !== 'undefined') globalThis.__wpdEditors = live;

export function loadLanguage(name) {
  const key = String(name || 'plaintext').toLowerCase();
  if (!langCache.has(key)) {
    const factory = LANGUAGES[key];
    try {
      langCache.set(key, Promise.resolve(factory ? factory() : []));
    } catch (err) {
      langCache.set(key, Promise.resolve([]));
    }
  }
  return langCache.get(key);
}

export function makeEditor({
  parent,
  doc = '',
  language = 'plaintext',
  readOnly = false,
  placeholder = '',
  onChange = null,
  onSave = null,
  onRun = null
} = {}) {
  const langCompartment = new Compartment();
  const readOnlyCompartment = new Compartment();
  const styleCompartment = new Compartment();
  let scheme = isDark() ? 'dark' : 'light';

  const extraKeys = [
    {
      key: 'Mod-s',
      preventDefault: true,
      run: () => (onSave ? onSave() : false)
    },
    {
      key: 'Mod-Enter',
      preventDefault: true,
      run: () => (onRun ? onRun() : false)
    },
    {
      key: 'Escape',
      run: () => {
        if (onRun) return false;
        parent.dispatchEvent(new CustomEvent('editor-escape', { bubbles: true }));
        return false;
      }
    }
  ];

  let suppress = false;

  const state = EditorState.create({
    doc: String(doc ?? ''),
    extensions: [
      // After basicSetup: CodeMirror combines highlight styles in array order and
      // basicSetup ships its own (defaultHighlightStyle). Ours has to come later
      // to win, otherwise the default greys win and the panel looks unhighlighted.
      basicSetup,
      styleCompartment.of(syntaxHighlighting(HIGHLIGHT_STYLES[scheme])),
      drawSelection(),
      highlightActiveLine(),
      EditorView.lineWrapping,
      keymap.of(extraKeys),
      cmPlaceholder(placeholder),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged || suppress) return;
        if (onChange) onChange(update.state.doc.toString());
      }),
      EditorView.theme({
        '&': { height: '100%', fontSize: '12.5px' },
        '.cm-scroller': { fontFamily: 'var(--mono)', overflow: 'auto' },
        '.cm-content': { padding: '10px 0' },
        '.cm-gutters': { background: 'transparent', borderRight: '1px solid var(--border)' },
        '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--accent)' }
      }),
      langCompartment.of([]),
      readOnlyCompartment.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)])
    ]
  });

  const view = new EditorView({ state, parent });

  // Follow the OS theme without rebuilding the editor.
  let mq = null;
  try {
    mq = window.matchMedia('(prefers-color-scheme: dark)');
  } catch {
    mq = null;
  }
  const onScheme = () => {
    const next = isDark() ? 'dark' : 'light';
    if (next === scheme) return;
    scheme = next;
    view.dispatch({ effects: styleCompartment.reconfigure(syntaxHighlighting(HIGHLIGHT_STYLES[next])) });
  };
  if (mq && typeof mq.addEventListener === 'function') mq.addEventListener('change', onScheme);

  let currentLang = null;
  const setLanguage = async (name) => {
    const next = String(name || 'plaintext').toLowerCase();
    if (next === currentLang) return;
    currentLang = next;
    const support = await loadLanguage(next);
    if (currentLang === next) {
      const exts = toExtensions(support);
      view.dispatch({ effects: langCompartment.reconfigure(exts) });
    }
  };
  setLanguage(language);

  const handle = {
    view,
    getDoc: () => view.state.doc.toString(),
    setDoc(next) {
      suppress = true;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: String(next ?? '') }
      });
      suppress = false;
    },
    setLanguage,
    setReadOnly(value) {
      view.dispatch({
        effects: readOnlyCompartment.reconfigure([
          EditorState.readOnly.of(!!value),
          EditorView.editable.of(!value)
        ])
      });
    },
    focus: () => view.focus(),
    remeasure: () => view.requestMeasure(),
    /**
     * Facts about highlighting, for the test harness. Reading the real syntax
     * tree and the injected stylesheet is the only way to tell "highlighting is
     * broken" from "highlighting works but I cannot see it in jsdom".
     */
    debug() {
      const sheetText = Array.from(document.querySelectorAll('style'))
        .map((s) => s.textContent || '')
        .join('\n');
      const wanted = PALETTE[scheme];
      // The visible tree depends on layout, which jsdom does not do, so rely on
      // the root node type plus what actually got rendered and coloured.
      const tree = syntaxTree(view.state);
      const spans = Array.from(view.dom.querySelectorAll('.cm-line span[class]'));
      const classNames = spans.flatMap((s) => Array.from(s.classList));
      const colorsUsed = new Set();
      for (const cls of classNames) {
        const m = sheetText.match(new RegExp(`\\.${cls}\\s*\\{[^}]*color:\\s*(#[0-9a-fA-F]{3,8})`));
        if (m) colorsUsed.add(m[1].toLowerCase());
      }
      const palette = new Set(Object.values(wanted).map((hex) => String(hex).toLowerCase()));
      return {
        lang: currentLang,
        hasLanguageField: !!view.state.field(Language.state, false),
        scheme,
        topType: tree.type.name,
        tokenSpans: spans.length,
        distinctColors: colorsUsed.size,
        // The node names actually present, so a language that renders flat can be
        // diagnosed from evidence instead of guessing which tag to map next.
        nodeNames: Array.from(new Set((function () {
          const seen = [];
          tree.iterate({ enter: (n) => { seen.push(n.name); } });
          return seen;
        })())).slice(0, 40),
        paletteColorsOnTokens: Array.from(colorsUsed).filter((c) => palette.has(c)).length,
        paletteInjected: Object.values(wanted).filter((hex) =>
          sheetText.toLowerCase().includes(String(hex).toLowerCase())).length,
        paletteSize: Object.keys(wanted).length
      };
    },
    destroy() {
      live.delete(handle);
      if (mq && typeof mq.removeEventListener === 'function') mq.removeEventListener('change', onScheme);
      view.destroy();
    }
  };

  live.add(handle);
  return handle;
}
