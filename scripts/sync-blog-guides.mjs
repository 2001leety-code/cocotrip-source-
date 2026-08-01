// blogspot 새 글 → /guide 동기화 (추가 전용).
//
// Brain 봇이 cocotripkr.blogspot.com 에 새 글을 쓰면 이 스크립트가:
//   공개 피드 수집 → HTML 변환 → src/content/guides/<slug>.json 생성
//   → _index.json 갱신 → public/sitemap.xml 에 URL 추가
// seoRoutes·프리렌더·잠금테스트는 전부 _index.json 파생이라 나머지는 자동.
//
// 추가 전용 원칙 (2026-08-01 강화 — 감사에서 나온 결함 3개 수리):
//   ① 기존 글 JSON 은 절대 덮어쓰지 않는다 — blogspot 원문이 "요약+링크" 스텁으로
//      교체되더라도 로컬 전문이 원본으로 남는다.
//   ② _index.json 도 **로컬 파일이 원천** — 피드 기준 재구성 금지. 피드에서 빠진
//      로컬 글이 목록·색인에서 소리 없이 증발하던 구조를 제거했다.
//   ③ slug 충돌(연/월만 다른 동명 slug)은 조용히 스킵하지 않고 **에러로 중단**한다
//      (sourceUrl 대조 — 기록이 없으면 판별 불가로 역시 에러).
//   ④ --check 는 차이를 발견하면 **exit 1** — 자동화에서 드리프트가 성공으로
//      위장되지 않는다. (스텁 교체 뒤에는 차이가 '정상'이므로 --check 는
//      스텁 전환 전 파리티 검증 용도다.)
//
// 사용:
//   node scripts/sync-blog-guides.mjs           # 새 글 동기화
//   node scripts/sync-blog-guides.mjs --check   # 변환 파리티 자가검증(쓰기 없음, 차이=exit 1)
//   node scripts/sync-blog-guides.mjs --dry-run # 뭘 추가할지 보여주고 쓰기 없음
//
// 실행 후: npm run build && npx vitest run tests/unit/sitemap-canonical-consistency.test.ts
//          → 브랜치 커밋 → PR. 색인 요청은 node scripts/submit-indexnow.mjs

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { entryToGuide, classifyExisting, buildIndexFromLocalMeta } from './sync-blog-guides.lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GUIDES_DIR = path.join(ROOT, 'src', 'content', 'guides');
const INDEX_PATH = path.join(GUIDES_DIR, '_index.json');
const SITEMAP_PATH = path.join(ROOT, 'public', 'sitemap.xml');
const FEED_URL = 'https://cocotripkr.blogspot.com/feeds/posts/default?alt=json&max-results=500';

const CHECK = process.argv.includes('--check');
const DRY = process.argv.includes('--dry-run');

const res = await fetch(FEED_URL);
if (!res.ok) throw new Error(`feed fetch ${res.status}`);
const feed = (await res.json()).feed;
const guides = (feed.entry || []).map(entryToGuide).filter(Boolean);
console.log(`blogspot 피드: ${guides.length}편`);

const localFiles = readdirSync(GUIDES_DIR).filter((f) => f.endsWith('.json') && f !== '_index.json');
const readLocal = (slug) => JSON.parse(readFileSync(path.join(GUIDES_DIR, `${slug}.json`), 'utf8'));
const localSlugs = new Set(localFiles.map((f) => f.replace(/\.json$/, '')));

if (CHECK) {
  // 파이프라인 자가검증 — 피드 재변환 결과가 저장본과 일치하는가.
  let same = 0;
  let diffCount = 0;
  for (const g of guides) {
    if (!localSlugs.has(g.slug)) { console.log(`  로컬에 없음(신규 후보): ${g.slug}`); continue; }
    const stored = readLocal(g.slug);
    const diffs = ['title', 'description', 'published', 'html'].filter(
      (k) => JSON.stringify(stored[k]) !== JSON.stringify(g[k]),
    );
    if (JSON.stringify([...stored.labels].sort()) !== JSON.stringify([...g.labels].sort())) diffs.push('labels');
    if (diffs.length === 0) { same++; continue; }
    diffCount++;
    console.log(`  차이: ${g.slug} → ${diffs.join(', ')}`);
    for (const k of diffs) {
      if (k === 'html') {
        let i = 0;
        while (stored.html[i] === g.html[i]) i++;
        console.log(`    html @${i}: stored=${JSON.stringify(stored.html.slice(i - 30, i + 60))}`);
        console.log(`             feed  =${JSON.stringify(g.html.slice(i - 30, i + 60))}`);
      } else {
        console.log(`    ${k}: stored=${JSON.stringify(stored[k])} feed=${JSON.stringify(g[k])}`);
      }
    }
  }
  console.log(`일치 ${same} / ${guides.length}`);
  // 🔴 차이가 있으면 실패로 끝난다 — exit 0 이면 자동화가 드리프트를 성공으로 읽는다.
  process.exit(diffCount > 0 ? 1 : 0);
}

// slug 충돌 검사 — 같은 slug 인데 다른 글(sourceUrl 불일치)이면 조용한 스킵 금지.
const collisions = [];
for (const g of guides) {
  if (!localSlugs.has(g.slug)) continue;
  const verdict = classifyExisting(readLocal(g.slug).sourceUrl, g.sourceUrl);
  if (verdict === 'collision') collisions.push(`${g.slug}: 로컬≠피드 (${g.sourceUrl})`);
  if (verdict === 'unknown') collisions.push(`${g.slug}: 로컬 JSON 에 sourceUrl 없음 — 동일 글 여부 판별 불가`);
}
if (collisions.length) {
  console.error('🔴 slug 충돌/판별불가 — 새 글이 조용히 증발하는 것을 막기 위해 중단:');
  for (const c of collisions) console.error('  ' + c);
  process.exit(1);
}

const fresh = guides.filter((g) => !localSlugs.has(g.slug));
if (fresh.length === 0) {
  console.log('새 글 없음 — 할 일 없음.');
  process.exit(0);
}

for (const g of fresh) console.log(`  신규: ${g.published} ${g.slug}`);
if (DRY) { console.log('(dry-run — 쓰기 생략)'); process.exit(0); }

// 개별 글 JSON — 추가 전용 (기존 파일 불변)
for (const g of fresh) writeFileSync(path.join(GUIDES_DIR, `${g.slug}.json`), JSON.stringify(g));

// _index.json — 로컬 파일 전체에서 재구성 (피드가 아니라 로컬이 원천).
// 기존 CRLF·1-space 스타일 보존(diff 최소화).
const allSlugs = [...new Set([...localFiles.map((f) => f.replace(/\.json$/, '')), ...fresh.map((g) => g.slug)])];
writeFileSync(
  INDEX_PATH,
  JSON.stringify(buildIndexFromLocalMeta(allSlugs.map(readLocal)), null, 1).replace(/\n/g, '\r\n'),
);

// sitemap — 마지막 /guide/ 줄 뒤에 삽입 (잠금테스트가 seoRoutes 와 대조해 검산).
const sitemap = readFileSync(SITEMAP_PATH, 'utf8');
const lines = sitemap.split('\n');
let lastGuide = -1;
lines.forEach((l, i) => { if (l.includes('cocotripkr.com/guide/')) lastGuide = i; });
if (lastGuide === -1) throw new Error('sitemap 에 /guide/ 항목이 없음 — 수동 확인 필요');
const eol = lines[lastGuide].endsWith('\r') ? '\r' : '';
const inserts = fresh.map((g) => `  <url><loc>https://cocotripkr.com/guide/${g.slug}</loc></url>${eol}`);
lines.splice(lastGuide + 1, 0, ...inserts);
writeFileSync(SITEMAP_PATH, lines.join('\n'));

console.log(`완료: ${fresh.length}편 추가. 다음 →`);
console.log('  npm run build && npx vitest run tests/unit/sitemap-canonical-consistency.test.ts');
console.log('  커밋·PR 후 배포되면: node scripts/submit-indexnow.mjs');
