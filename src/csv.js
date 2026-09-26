/**
 * Minimal RFC 4180 CSV reader. Handles quoted fields containing commas,
 * escaped quotes (""), and embedded newlines - all three show up in the
 * Snippets tab because snippet code is stored inside cells.
 */
export function parseCsv(text) {
  const src = String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let touched = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      quoted = true;
      touched = true;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      touched = true;
      continue;
    }
    if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      touched = false;
      continue;
    }
    field += c;
    touched = true;
  }
  if (field !== '' || touched || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** First row is the header; returns array of objects. Blank rows are dropped. */
export function rowsToObjects(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const header = rows[0].map((h) => String(h).trim());
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    if (!cells || cells.every((c) => String(c ?? '').trim() === '')) continue;
    const obj = { __row: i + 1 };
    for (let c = 0; c < header.length; c++) obj[header[c]] = cells[c] ?? '';
    out.push(obj);
  }
  return out;
}

export function readCsv(text) {
  return rowsToObjects(parseCsv(text));
}
