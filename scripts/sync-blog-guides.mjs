// blogspot 새 글 → /guide 동기화 (추가 전용).
//
// Brain 봇이 cocotripkr.blogspot.com 에 새 글을 쓰면 이 스크립트가:
//   공개 피드 수집 → HTML 변환 → src/content/guides/<slug>.json 생성
//   → _index.json 갱신 → public/sitemap.xml 에 URL 추가
// seoRoutes·프리렌더·잠금테스트는 전부 _index.json 파생이라 나머지는 자동.
//
// 기존 파일은 절대 덮어쓰지 않는다 — blogspot 원문이 나중에 "요약+링크" 스텁으로
// 교체되더라도(중복 색인 정리 계획) 로컬 전문이 원본으로 남아야 하기 때문.
//
// 사용:
//   node scripts/sync-blog-guides.mjs           # 새 글 동기화
//   node scripts/sync-blog-guides.mjs --check   # 기존 글 변환 파리티 자가검증(쓰기 없음)
//   node scripts/sync-blog-guides.mjs --dry-run # 뭘 추가할지 보여주고 쓰기 없음
//
// 실행 후: npm run build && npx vitest run tests/unit/sitemap-canonical-consistency.test.ts
//          → 브랜치 커밋 → PR. 색인 요청은 node scripts/submit-indexnow.mjs

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GUIDES_DIR = path.join(ROOT, 'src', 'content', 'guides');
const INDEX_PATH = path.join(GUIDES_DIR, '_index.json');
const SITEMAP_PATH = path.join(ROOT, 'public', 'sitemap.xml');
const FEED_URL = 'https://cocotripkr.blogspot.com/feeds/posts/default?alt=json&max-results=500';

const CHECK = process.argv.includes('--check');
const DRY = process.argv.includes('--dry-run');

const decodeEntities = (s) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

// 자기 도메인 절대링크 → 상대경로. utm_* 만 제거, 기능 쿼리(dietary= 등)는 보존.
// href='...' 작은따옴표 변형도 반드시 처리.
// blogspot 글 링크 → /guide/<slug>, blogspot 홈 → /guide (중복 사이트로 유출 방지).
function transformHtml(html) {
  return html
    .replace(
      /(href=)(["'])https?:\/\/(?:www\.)?cocotripkr\.com(\/[^"'?#]*)?(?:\?([^"'#]*))?(#[^"']*)?\2/g,
      (_, pre, q, p, query, hash) => {
        const kept = (query || '')
          .split('&')
          .filter((kv) => kv && !/^(amp;)?utm_/.test(kv))
          .join('&');
        return `${pre}${q}${p || '/'}${kept ? `?${kept}` : ''}${hash || ''}${q}`;
      },
    )
    .replace(
      /(href=)(["'])https?:\/\/cocotripkr\.blogspot\.com\/\d{4}\/\d{2}\/([a-z0-9-]+)\.html(?:[?#][^"']*)?\2/g,
      (_, pre, q, slug) => `${pre}${q}/guide/${slug}${q}`,
    )
    .replace(/(href=)(["'])https?:\/\/cocotripkr\.blogspot\.com\/?\2/g, (_, pre, q) => `${pre}${q}/guide${q}`);
}

function extractDescription(html) {
  const m = html.match(/<p class="post-summary"><em>([\s\S]*?)<\/em>/);
  if (m) return decodeEntities(m[1].replace(/<[^>]+>/g, '')).trim();
  const text = decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  return text.length > 155 ? `${text.slice(0, 155).trim()}…` : text;
}

function entryToGuide(e) {
  const alt = (e.link || []).find((l) => l.rel === 'alternate');
  if (!alt) return null;
  const slug = alt.href.split('/').pop().replace(/\.html$/, '');
  const html = transformHtml(e.content.$t);
  return {
    slug,
    title: e.title.$t,
    description: extractDescription(html),
    published: e.published.$t.slice(0, 10),
    updated: e.updated.$t.slice(0, 10),
    labels: (e.category || []).map((c) => c.term).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())),
    html,
  };
}

const res = await fetch(FEED_URL);
if (!res.ok) throw new Error(`feed fetch ${res.status}`);
const feed = (await res.json()).feed;
const guides = (feed.entry || []).map(entryToGuide).filter(Boolean);
console.log(`blogspot 피드: ${guides.length}편`);

const localSlugs = new Set(
  readdirSync(GUIDES_DIR).filter((f) => f.endsWith('.json') && f !== '_index.json').map((f) => f.replace(/\.json$/, '')),
);

if (CHECK) {
  // 파이프라인 자가검증 — 피드 재변환 결과가 저장본과 일치하는가.
  let same = 0;
  for (const g of guides) {
    const p = path.join(GUIDES_DIR, `${g.slug}.json`);
    if (!existsSync(p)) { console.log(`  로컬에 없음(신규 후보): ${g.slug}`); continue; }
    const stored = JSON.parse(readFileSync(p, 'utf8'));
    const diffs = ['title', 'description', 'published', 'html'].filter(
      (k) => JSON.stringify(stored[k]) !== JSON.stringify(g[k]),
    );
    if (JSON.stringify([...stored.labels].sort()) !== JSON.stringify([...g.labels].sort())) diffs.push('labels');
    if (diffs.length === 0) { same++; continue; }
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
  process.exit(0);
}

const fresh = guides.filter((g) => !localSlugs.has(g.slug));
if (fresh.length === 0) {
  console.log('새 글 없음 — 할 일 없음.');
  process.exit(0);
}

for (const g of fresh) console.log(`  신규: ${g.published} ${g.slug}`);
if (DRY) { console.log('(dry-run — 쓰기 생략)'); process.exit(0); }

// 개별 글 JSON
for (const g of fresh) writeFileSync(path.join(GUIDES_DIR, `${g.slug}.json`), JSON.stringify(g));

// _index.json — 피드 순서(최신순). 기존 CRLF·1-space 스타일 보존(diff 최소화).
const index = guides
  .filter((g) => localSlugs.has(g.slug) || fresh.includes(g))
  .map(({ html, ...meta }) => meta);
writeFileSync(INDEX_PATH, JSON.stringify(index, null, 1).replace(/\n/g, '\r\n'));

// sitemap — 마지막 /guide/ 줄 뒤에 삽입 (잠금테스트가 seoRoutes 와 대조해 검산).
let sitemap = readFileSync(SITEMAP_PATH, 'utf8');
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
