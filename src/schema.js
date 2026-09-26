import { nowIso } from './util.js';

export const TABS = {
  Snippets: ['id', 'title', 'language', 'category', 'description', 'code', 'tags', 'updated'],
  Checklist: ['id', 'category', 'item', 'detail', 'order'],
  Handbook: ['id', 'section', 'title', 'content'],
  Progress: ['site', 'itemId', 'done', 'note', 'updated'],
  Sites: ['host', 'label', 'added', 'lastSeen'],
  Users: ['keyId', 'label', 'role', 'keyHash', 'createdAt', 'active', 'lastSeen'],
  Pending: [
    'changeId',
    'op',
    'tab',
    'row',
    'payload',
    'requestedBy',
    'requestedAt',
    'status',
    'decidedBy',
    'decidedAt',
    'reason'
  ]
};

/** Tabs read through the public gviz CSV endpoint (fast, no key needed). */
export const CSV_TABS = ['Checklist', 'Handbook', 'Progress', 'Sites'];
/** Tabs read through the Apps Script web app (key verified server side). */
export const KEYED_TABS = ['Snippets'];
/** Tabs whose content is shared, so editor writes go to the approval queue. */
export const APPROVAL_TABS = ['Snippets', 'Checklist', 'Handbook'];

const str = (v) => (v === null || v === undefined ? '' : String(v));
const bool = (v) => str(v).toUpperCase() === 'TRUE' || str(v).toLowerCase() === 'done';

export const LANGUAGES = [
  { id: 'php', label: 'PHP' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'html', label: 'HTML' },
  { id: 'xml', label: 'XML' },
  { id: 'css', label: 'CSS' },
  { id: 'scss', label: 'SCSS' },
  { id: 'bash', label: 'Shell / Bash' },
  { id: 'sql', label: 'SQL' },
  { id: 'json', label: 'JSON' },
  { id: 'yaml', label: 'YAML' },
  { id: 'python', label: 'Python' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'diff', label: 'Diff' },
  { id: 'plaintext', label: 'Plain text' }
];

export const SNIPPET_CATEGORIES = [
  'Theme',
  'Plugin',
  'ACF / Fields',
  'Query',
  'Hooks',
  'Enqueue / Assets',
  'Shortcode',
  'REST / AJAX',
  'Cron',
  'Security',
  'SEO',
  'Database',
  'Dev / CLI',
  'Other'
];

const asTags = (v) =>
  str(v)
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

export const SCHEMA = {
  Snippets: {
    decode(r) {
      return {
        row: r.__row,
        id: str(r.id),
        title: str(r.title),
        language: str(r.language) || 'plaintext',
        category: str(r.category) || 'Other',
        description: str(r.description),
        code: str(r.code),
        tags: asTags(r.tags),
        updated: str(r.updated)
      };
    },
    encode(s) {
      return [
        s.id,
        s.title,
        s.language,
        s.category,
        s.description,
        s.code,
        asTags(s.tags).join(', '),
        s.updated || nowIso()
      ];
    }
  },

  Checklist: {
    decode(r) {
      return {
        row: r.__row,
        id: str(r.id),
        category: str(r.category),
        item: str(r.item),
        detail: str(r.detail),
        order: Number(r.order) || 0
      };
    },
    encode(c) {
      return [c.id, c.category, c.item, c.detail, c.order ?? 0];
    }
  },

  Handbook: {
    decode(r) {
      return {
        row: r.__row,
        id: str(r.id),
        section: str(r.section),
        title: str(r.title),
        content: str(r.content)
      };
    },
    encode(h) {
      return [h.id, h.section, h.title, h.content];
    }
  },

  Progress: {
    decode(r) {
      return {
        row: r.__row,
        site: str(r.site),
        itemId: str(r.itemId),
        done: bool(r.done),
        note: str(r.note),
        updated: str(r.updated)
      };
    },
    encode(p) {
      return [p.site, p.itemId, p.done ? 'TRUE' : '', p.note || '', p.updated || nowIso()];
    }
  },

  Sites: {
    decode(r) {
      return {
        row: r.__row,
        host: str(r.host),
        label: str(r.label),
        added: str(r.added),
        lastSeen: str(r.lastSeen)
      };
    },
    encode(s) {
      return [s.host, s.label || s.host, s.added || nowIso(), s.lastSeen || ''];
    }
  },

  Users: {
    decode(r) {
      return {
        row: r.__row,
        keyId: str(r.keyId),
        label: str(r.label),
        role: str(r.role),
        createdAt: str(r.createdAt),
        active: str(r.active).toUpperCase() !== 'FALSE',
        lastSeen: str(r.lastSeen)
      };
    },
    encode() {
      throw new Error('Users rows are only written by the web app');
    }
  },

  Pending: {
    decode(r) {
      let payload = {};
      try {
        payload = JSON.parse(str(r.payload) || '{}');
      } catch {
        payload = {};
      }
      return {
        row: r.__row,
        changeId: str(r.changeId),
        op: str(r.op),
        tab: str(r.tab),
        targetRow: Number(r.row) || 0,
        payload,
        requestedBy: str(r.requestedBy),
        requestedAt: str(r.requestedAt),
        status: str(r.status) || 'Pending',
        decidedBy: str(r.decidedBy),
        decidedAt: str(r.decidedAt),
        reason: str(r.reason)
      };
    },
    encode() {
      throw new Error('Pending rows are only written by the web app');
    }
  }
};

export function decodeRows(tab, rows) {
  const def = SCHEMA[tab];
  if (!def) throw new Error(`Unknown tab: ${tab}`);
  return (rows || []).map(def.decode);
}

export function encodeRow(tab, obj) {
  const def = SCHEMA[tab];
  if (!def) throw new Error(`Unknown tab: ${tab}`);
  return def.encode(obj);
}

export function encodeRows(tab, list) {
  return (list || []).map((obj) => encodeRow(tab, obj));
}

export const progressKey = (host, itemId) => `${host}::${itemId}`;

export function isApprovalTab(tab) {
  return APPROVAL_TABS.includes(tab);
}
