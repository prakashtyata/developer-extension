import { escapeHtml } from './util.js';

/**
 * Tiny, escape-first markdown renderer. Everything is HTML-escaped before any
 * formatting runs, so article content can never inject markup. Code fences are
 * returned as separate blocks so the UI can hand them to CodeMirror for
 * highlighting instead of a second highlighter.
 */

function safeLink(text, url) {
  const href = String(url || '').trim();
  if (!/^(https?:\/\/|mailto:|\/|#)/i.test(href)) return text;
  const external = /^https?:/i.test(href);
  const attrs = external ? ' target="_blank" rel="noopener noreferrer"' : '';
  return `<a href="${href}"${attrs}>${text}</a>`;
}

export function renderInline(src) {
  let out = escapeHtml(src);
  const codes = [];
  out = out.replace(/`([^`\n]+)`/g, (_, code) => {
    codes.push(code);
    return `\u0000${codes.length - 1}\u0000`;
  });
  out = out.replace(/\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, (_, text, url) => safeLink(text, url));
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[\s(>])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');
  out = out.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
  return out;
}

const HEADING = /^(#{1,4})\s+(.*)$/;
const BULLET = /^[-*]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const RULE = /^(---|\*\*\*|___)$/;

/** Returns [{ type:'html', html } | { type:'code', code, lang }] */
export function parseMarkdown(src) {
  const lines = String(src ?? '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0;

  const flushList = (items, ordered) => {
    if (!items.length) return;
    const tag = ordered ? 'ol' : 'ul';
    blocks.push({ type: 'html', html: `<${tag}>${items.map((t) => `<li>${renderInline(t)}</li>`).join('')}</${tag}>` });
  };

  while (i < lines.length) {
    const line = lines[i];

    if (line.trimStart().startsWith('```')) {
      const lang = line.trim().slice(3).trim();
      const buf = [];
      i += 1;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        buf.push(lines[i]);
        i += 1;
      }
      i += 1;
      blocks.push({ type: 'code', code: buf.join('\n'), lang: lang || 'plaintext' });
      continue;
    }

    if (line.trim() === '') {
      i += 1;
      continue;
    }

    if (RULE.test(line.trim())) {
      blocks.push({ type: 'html', html: '<hr />' });
      i += 1;
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      const level = heading[1].length;
      blocks.push({ type: 'html', html: `<h${level + 2}>${renderInline(heading[2])}</h${level + 2}>` });
      i += 1;
      continue;
    }

    if (BULLET.test(line)) {
      const items = [];
      while (i < lines.length && BULLET.test(lines[i])) {
        items.push(lines[i].match(BULLET)[1]);
        i += 1;
      }
      flushList(items, false);
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''));
        i += 1;
      }
      flushList(items, true);
      continue;
    }

    if (QUOTE.test(line)) {
      const items = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        items.push(lines[i].match(QUOTE)[1]);
        i += 1;
      }
      blocks.push({ type: 'html', html: `<blockquote>${items.map(renderInline).join('<br />')}</blockquote>` });
      continue;
    }

    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !HEADING.test(lines[i]) &&
      !BULLET.test(lines[i]) &&
      !QUOTE.test(lines[i]) &&
      !RULE.test(lines[i].trim()) &&
      !lines[i].trimStart().startsWith('```')
    ) {
      para.push(lines[i]);
      i += 1;
    }
    blocks.push({ type: 'html', html: `<p>${para.map(renderInline).join('<br />')}</p>` });
  }

  return blocks;
}
