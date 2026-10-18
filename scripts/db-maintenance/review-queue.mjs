// 검수 큐 생성 — api/_food_index.json 을 읽기만 한다.
//
// 사용: node scripts/db-maintenance/review-queue.mjs [--out DIR]
//   <out>/review-queue-unverified.csv : 식이 verification_status=unverified 전 행(+ 모스크 의심 행)
//       ai_curated 출처 행이 맨 앞(flag=ai_curated), 그 안/나머지는 city→tag 순.
//       모스크 의심 행(`한국이슬람교 서울중앙성원`)은 flag=not_a_restaurant? 로 최상단.
//   <out>/review-queue-no-link.csv    : naverLink·googleMapsUrl 둘 다 없는 행
// 운영자는 suggested_grade / evidence_url / reviewer / date 를 채우고 apply-review.mjs 로 검증한다.

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { toCsv } from './_csv.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = join(__dirname, '..', '..', 'api', '_food_index.json');
const MOSQUE_NAME = '한국이슬람교 서울중앙성원';

export const rowId = (r) => `${r.city}|${r.name}|${r.address}`;
const byCityTag = (a, b) => (a.city || '').localeCompare(b.city || '') || (a.tag || '').localeCompare(b.tag || '') || (a.name || '').localeCompare(b.name || '');
const rank = (r) => (r.name === MOSQUE_NAME ? 0 : /^ai_curated/.test(r.source || '') ? 1 : 2);

const QUEUE_COLS = ['flag', 'name', 'nameEn', 'city', 'tag', 'address', 'naverLink', 'googleMapsUrl', 'source', 'current_status', 'suggested_grade', 'evidence_url', 'reviewer', 'date', 'row_id'];
const NOLINK_COLS = ['name', 'nameEn', 'city', 'tag', 'address', 'source', 'verification_status', 'found_naver_link', 'row_id'];

export function buildQueues(rows) {
  const q = rows
    .filter((r) => r.verification_status === 'unverified' || r.name === MOSQUE_NAME)
    .sort((a, b) => rank(a) - rank(b) || byCityTag(a, b))
    .map((r) => ({
      flag: r.name === MOSQUE_NAME ? 'not_a_restaurant?' : rank(r) === 1 ? 'ai_curated' : '',
      name: r.name, nameEn: r.nameEn || '', city: r.city, tag: r.tag, address: r.address,
      naverLink: r.naverLink || '', googleMapsUrl: r.googleMapsUrl || '', source: r.source || '',
      current_status: r.verification_status || '', suggested_grade: '', evidence_url: '', reviewer: '', date: '', row_id: rowId(r),
    }));
  const nolink = rows
    .filter((r) => !r.naverLink && !r.googleMapsUrl)
    .sort(byCityTag)
    .map((r) => ({ name: r.name, nameEn: r.nameEn || '', city: r.city, tag: r.tag, address: r.address, source: r.source || '', verification_status: r.verification_status || '', found_naver_link: '', row_id: rowId(r) }));
  return { q, nolink };
}

export function writeQueues(rows, outDir) {
  const { q, nolink } = buildQueues(rows);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'review-queue-unverified.csv'), toCsv(QUEUE_COLS, q));
  writeFileSync(join(outDir, 'review-queue-no-link.csv'), toCsv(NOLINK_COLS, nolink));
  return { queue: q.length, nolink: nolink.length };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) {
  const i = process.argv.indexOf('--out');
  const r = writeQueues(JSON.parse(readFileSync(INDEX_PATH, 'utf-8')), (i > 0 && process.argv[i + 1]) || 'maint');
  console.log(`review-queue-unverified.csv ${r.queue}행 / review-queue-no-link.csv ${r.nolink}행`);
}
