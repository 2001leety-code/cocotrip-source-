// 검수 CSV 적용기 — 기본 --dry. api/_food_index.json 은 절대 쓰지 않는다(산출물 직접 수정 금지).
//
// 사용: node scripts/db-maintenance/apply-review.mjs <filled.csv> [--out DIR] [--apply]
//   --dry(기본)  : 무엇이 바뀔지 출력만.
//   --apply      : <out>/review-patch.json 에 {row_id: {바뀔 필드}} 만 기록 → 원천(food_data)에 반영 후 build-food-index.
// 바꾸는 필드는 verification_status / source_url / verified_by / verified_at 4개뿐.
// 거부 규칙: ① 알 수 없는 row_id ② 허용 등급 밖 ③ 식이 계열 불일치(할랄 행에 비건 등급 등)
//            ④ 등급을 unverified 에서 올리는데 evidence_url 이 http(s) 가 아님 ⑤ 올릴 때 reviewer/date 누락.
// suggested_grade 가 빈 행은 건너뛴다. 등급을 내리는(→ unverified) 건 근거 없이도 허용.

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseCsv } from './_csv.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = join(__dirname, '..', '..', 'api', '_food_index.json');
const FAMILY = {
  halal: ['muslim_friendly', 'halal_certified'],
  vegan: ['vegan_options', 'vegan_restaurant'],
  vegetarian: ['vegan_options', 'vegan_restaurant'],
};
const rowId = (r) => `${r.city}|${r.name}|${r.address}`;

export function planReview(rows, csvRows) {
  const byId = new Map(rows.map((r) => [rowId(r), r]));
  const changes = [], refused = [];
  for (const c of csvRows) {
    const grade = (c.suggested_grade || '').trim();
    if (!grade) continue;
    const refuse = (reason) => refused.push({ row_id: c.row_id, name: c.name, grade, reason });
    const row = byId.get(c.row_id);
    if (!row) { refuse('unknown row_id'); continue; }
    const claim = row.dietary_claim;
    const allowed = ['unverified', ...(FAMILY[claim] || [])];
    if (!allowed.includes(grade)) { refuse(`grade not allowed for claim ${claim}`); continue; }
    const raising = grade !== 'unverified' && grade !== row.verification_status;
    const evidence = (c.evidence_url || '').trim();
    if (raising && !/^https?:\/\/\S+$/.test(evidence)) { refuse('raise without evidence_url'); continue; }
    if (raising && (!(c.reviewer || '').trim() || !(c.date || '').trim())) { refuse('raise without reviewer/date'); continue; }
    if (grade === row.verification_status) continue;
    const after = { verification_status: grade };
    if (raising) Object.assign(after, { source_url: evidence, verified_by: c.reviewer.trim(), verified_at: c.date.trim() });
    changes.push({ row_id: c.row_id, name: row.name, before: { verification_status: row.verification_status }, after });
  }
  return { changes, refused };
}

function arg(name) { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; }

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) {
  const csvPath = process.argv[2];
  if (!csvPath || csvPath.startsWith('--')) { console.error('usage: apply-review.mjs <filled.csv> [--out DIR] [--apply]'); process.exit(2); }
  const rows = JSON.parse(readFileSync(INDEX_PATH, 'utf-8'));
  const { changes, refused } = planReview(rows, parseCsv(readFileSync(csvPath, 'utf-8')));
  for (const c of changes) console.log(`CHANGE ${c.name}: ${c.before.verification_status} -> ${c.after.verification_status}`);
  for (const r of refused) console.log(`REFUSE ${r.name}: ${r.reason}`);
  console.log(`${process.argv.includes('--apply') ? 'APPLY' : 'DRY'}: ${changes.length} change / ${refused.length} refused`);
  if (process.argv.includes('--apply')) {
    const out = arg('--out') || 'maint';
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'review-patch.json'), JSON.stringify(Object.fromEntries(changes.map((c) => [c.row_id, c.after])), null, 2));
  }
  process.exit(refused.length ? 1 : 0);
}
