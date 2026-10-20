// 최소 CSV 읽기/쓰기(따옴표·쉼표·줄바꿈 처리). Excel 한글 호환을 위해 BOM 을 붙인다.
export function toCsv(cols, rows) {
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\r\n') + '\r\n';
}

export function parseCsv(text) {
  const t = text.replace(/^﻿/, '');
  const recs = [];
  let rec = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { rec.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; rec.push(f); f = ''; recs.push(rec); rec = []; }
    else f += c;
  }
  if (f || rec.length) { rec.push(f); recs.push(rec); }
  const [head, ...body] = recs.filter((r) => r.some((x) => x !== ''));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}
