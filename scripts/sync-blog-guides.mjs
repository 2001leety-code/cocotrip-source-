// Blogger 후보 → cocotripkr.com/guide 동기화.
//
// 대표 원문은 항상 https://cocotripkr.com/guide/<slug> 이다. Blogger 공개 피드는
// 후보 수집 통로일 뿐 승인 근거가 아니다. 새 글을 쓰려면
// config/legacy-blogger-guide-import-ledger.json 에 현재 콘텐츠 지문과 검토 결과가 있어야 한다.
// 이 경로는 2026-08-22까지 쌓인 11건을 격리·정리하는 이관 전용이다. 이후 새 글의
// 장기 정본은 Brain content_queue 승인 manifest → 웹 projection 계약을 쓴다.
//
// 사용:
//   node scripts/sync-blog-guides.mjs --audit   # 후보/승인 상태 출력, 쓰기 없음(기본값)
//   node scripts/sync-blog-guides.mjs --check   # CI 드리프트 검사, 미검토·미동기화면 실패
//   node scripts/sync-blog-guides.mjs --apply   # manifest 가 완결된 경우 승인 글만 추가
//   node scripts/sync-blog-guides.mjs --dry-run # --audit 별칭
//
// 안전선:
//   - 공개 피드에 있다는 이유만으로는 절대 쓰지 않는다.
//   - 새 후보 하나라도 pending/invalid 이면 --apply 전체를 쓰기 전에 중단한다.
//   - approved 는 quality verdict=pass + score>=92 만 인정한다.
//   - rejected/hold 는 가져오지 않으며, 기존 로컬 글은 덮어쓰거나 삭제하지 않는다.
//   - 승인 후 제목/본문/날짜/라벨이 바뀌면 SHA-256 불일치로 다시 막힌다.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  entryToGuide,
  buildIndexFromLocalMeta,
  classifyGuideCandidates,
  buildPendingReview,
  GUIDE_CANONICAL_BASE,
  BLOGGER_NEWS_LABEL,
  classifyFeedAgainstLocal,
} from './sync-blog-guides.lib.mjs';
import { auditGuideHtml } from './guide-html-safety.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GUIDES_DIR = path.join(ROOT, 'src', 'content', 'guides');
const INDEX_PATH = path.join(GUIDES_DIR, '_index.json');
const SITEMAP_PATH = path.join(ROOT, 'public', 'sitemap.xml');
const MANIFEST_PATH = path.join(ROOT, 'config', 'legacy-blogger-guide-import-ledger.json');
// 2026-10-24: 검토된 Blogger 뉴스 기사 원장 — teaser 검사에서 건너뛸 글(slug + published 연-월). 없으면 빈 목록.
const NEWS_LEDGER_PATH = path.join(ROOT, 'config', 'blogger-news-posts.json');
const FEED_URL = 'https://cocotripkr.blogspot.com/feeds/posts/default?alt=json&max-results=500';

const args = new Set(process.argv.slice(2));
const knownArgs = new Set(['--audit', '--check', '--apply', '--dry-run']);
for (const arg of args) if (!knownArgs.has(arg)) throw new Error(`unknown option: ${arg}`);
const selectedModes = ['--audit', '--check', '--apply', '--dry-run'].filter((arg) => args.has(arg));
if (selectedModes.length > 1) throw new Error(`choose one mode: ${selectedModes.join(', ')}`);

const MODE = args.has('--apply')
  ? 'apply'
  : args.has('--check')
    ? 'check'
    : 'audit';

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const response = await fetch(FEED_URL);
if (!response.ok) throw new Error(`feed fetch ${response.status}`);
const payload = await response.json();
const guides = ((payload.feed && payload.feed.entry) || []).map(entryToGuide).filter(Boolean);
for (const guide of guides) {
  const htmlAudit = auditGuideHtml(guide.html);
  guide.html = htmlAudit.html;
  Object.defineProperty(guide, 'sanitizationChanged', {
    value: htmlAudit.changed,
    enumerable: false,
  });
}
console.log(`Blogger feed: ${guides.length} guides (mode=${MODE})`);

const duplicateFeedSlugs = [...new Set(guides
  .filter((guide, index) => guides.findIndex((item) => item.slug === guide.slug) !== index)
  .map((guide) => guide.slug))];
const duplicateFeedSources = [...new Set(guides
  .filter((guide, index) => guides.findIndex((item) => item.sourceUrl === guide.sourceUrl) !== index)
  .map((guide) => guide.sourceUrl))];
if (duplicateFeedSlugs.length || duplicateFeedSources.length) {
  throw new Error(`duplicate feed identity: slugs=${duplicateFeedSlugs.join(',')} sources=${duplicateFeedSources.join(',')}`);
}

const localFiles = readdirSync(GUIDES_DIR).filter((file) => file.endsWith('.json') && file !== '_index.json');
const readLocal = (slug) => JSON.parse(readFileSync(path.join(GUIDES_DIR, `${slug}.json`), 'utf8'));
const localSlugs = new Set(localFiles.map((file) => file.replace(/\.json$/, '')));

let newsLedger = [];
try { newsLedger = JSON.parse(readFileSync(NEWS_LEDGER_PATH, 'utf8')); } catch (error) {
  if (error && error.code !== 'ENOENT') throw error; // 깨진 원장은 조용히 무시하지 않는다
}
if (!Array.isArray(newsLedger)) throw new Error(`${path.basename(NEWS_LEDGER_PATH)} must be a JSON array`);

// 같은 slug 인데 다른 Blogger 글이면 조용히 스킵하지 않는다.
// cutoff 이후 글 중 검토된 뉴스(원장·라벨)만 teaser 검사에서 건너뛴다.
const { collisions, postCutoffTeasers, newsPosts, candidates } = classifyFeedAgainstLocal({ guides, localSlugs, readLocal, newsLedger });
for (const guide of postCutoffTeasers) console.log(`  TEASER ${guide.published} ${guide.slug}`);
const newsCount = (kind) => newsPosts.filter((n) => n.kind === kind).length;
console.log(`news(ledger)=${newsCount('ledger')} news(label)=${newsCount('label')}`);
for (const { guide, kind } of newsPosts) console.log(`  NEWS(${kind}) ${guide.published} ${guide.slug}`);
if (collisions.length) {
  for (const collision of collisions) console.error(`COLLISION ${collision}`);
  console.error(`  뉴스 기사라면: 검토 후 config/blogger-news-posts.json 에 slug·published 를 추가하거나 Brain 발행기가 '${BLOGGER_NEWS_LABEL}' 라벨을 붙인다.`);
  process.exit(1);
}

const reviewState = classifyGuideCandidates(candidates, manifest);

console.log(
  `Candidates ${candidates.length}: approved=${reviewState.approved.length}, `
  + `rejected=${reviewState.rejected.length}, hold=${reviewState.held.length}, `
  + `pending=${reviewState.pending.length}, invalid=${reviewState.invalid.length}`,
);

for (const item of reviewState.approved) console.log(`  APPROVED ${item.guide.published} ${item.guide.slug}`);
for (const item of reviewState.rejected) console.log(`  REJECTED ${item.guide.published} ${item.guide.slug}`);
for (const item of reviewState.held) console.log(`  HOLD ${item.guide.published} ${item.guide.slug}`);
for (const guide of candidates) {
  if (guide.sanitizationChanged) console.log(`  SANITIZED ${guide.published} ${guide.slug}`);
}
for (const item of reviewState.invalid) {
  const slug = item.guide ? item.guide.slug : 'manifest';
  const hash = item.contentSha256 ? ` currentSha256=${item.contentSha256}` : '';
  console.error(`  INVALID ${slug}: ${item.reason}${hash}`);
}

if (reviewState.pending.length) {
  console.log('Pending review records (copy, then fill the decision and reviewer fields):');
  console.log(JSON.stringify(reviewState.pending.map((item) => buildPendingReview(item.guide)), null, 2));
}

if (MODE === 'audit') {
  console.log('Audit only: no files changed.');
  process.exit(0);
}

if (MODE === 'check') {
  const driftCount = reviewState.pending.length + reviewState.invalid.length + reviewState.approved.length;
  if (driftCount > 0) {
    console.error('Guide drift detected: review pending/invalid or approved content not yet synced.');
    process.exit(1);
  }
  console.log('Guide import state is closed: no unreviewed or approved-unsynced candidates.');
  process.exit(0);
}

// --apply is all-or-nothing at the review gate. A single unknown candidate blocks every write.
if (reviewState.pending.length || reviewState.invalid.length) {
  console.error('Apply refused: every candidate needs an exact valid approved/rejected/hold review. No files changed.');
  process.exit(1);
}

const fresh = reviewState.approved.map((item) => item.guide);
if (fresh.length === 0) {
  console.log('No approved guides to add. No files changed.');
  process.exit(0);
}

// 모든 파생 결과를 먼저 계산·검증한 뒤에만 쓰기를 시작한다.
const localDocs = localFiles.map((file) => readLocal(file.replace(/\.json$/, '')));
const nextIndex = JSON.stringify(buildIndexFromLocalMeta([...localDocs, ...fresh]), null, 1).replace(/\n/g, '\r\n');
const sitemap = readFileSync(SITEMAP_PATH, 'utf8');
const sitemapLines = sitemap.split('\n');
let lastGuide = -1;
sitemapLines.forEach((line, index) => { if (line.includes(`${GUIDE_CANONICAL_BASE}/`)) lastGuide = index; });
if (lastGuide === -1) throw new Error('sitemap has no /guide/ entry');
for (const guide of fresh) {
  const canonicalUrl = `${GUIDE_CANONICAL_BASE}/${guide.slug}`;
  if (sitemap.includes(`<loc>${canonicalUrl}</loc>`)) {
    throw new Error(`sitemap already contains approved candidate without local file: ${canonicalUrl}`);
  }
}
const eol = sitemapLines[lastGuide].endsWith('\r') ? '\r' : '';
const inserts = fresh.map((guide) => `  <url><loc>${GUIDE_CANONICAL_BASE}/${guide.slug}</loc></url>${eol}`);
sitemapLines.splice(lastGuide + 1, 0, ...inserts);
const nextSitemap = sitemapLines.join('\n');

for (const guide of fresh) {
  writeFileSync(path.join(GUIDES_DIR, `${guide.slug}.json`), JSON.stringify(guide));
}
writeFileSync(INDEX_PATH, nextIndex);
writeFileSync(SITEMAP_PATH, nextSitemap);

console.log(`Added ${fresh.length} approved guides. Canonical destination: ${GUIDE_CANONICAL_BASE}/<slug>`);
console.log('Next: npm run build && npx vitest run tests/unit/sync-blog-guides.test.ts tests/unit/sitemap-canonical-consistency.test.ts');
