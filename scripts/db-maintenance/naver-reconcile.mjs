#!/usr/bin/env node
/**
 * Naver Local Search 재대조 — api/_food_index.json 행을 공식 API(openapi.naver.com)와 맞춰본다.
 *
 *   node scripts/db-maintenance/naver-reconcile.mjs --no-link --limit 300          (리포트만)
 *   node scripts/db-maintenance/naver-reconcile.mjs --no-link --apply --from-report <report.json>
 *   node scripts/db-maintenance/naver-reconcile.mjs --no-link --apply              (라이브 재조회 후 적용)
 *
 * 플래그: --no-link  --city KEY  --limit N  --apply  --from-report FILE  --out DIR
 * 키: process.env.NAVER_CLIENT_ID / NAVER_CLIENT_SECRET (값은 어디에도 출력·기록하지 않는다)
 * 네트워크: https://openapi.naver.com/v1/search/local.json 만. ≤5 req/s, 429 는 1초 뒤 1회 재시도,
 *   연속 실패 50회 중단, 요청 600건 하드캡(재시도 포함).
 * --apply 는 matched 행의 naverLink/roadAddress/telephone 만 쓴다(좌표·상호 불변, 한 줄 minified 유지).
 */
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = resolve(HERE, '..', '..', 'api', '_food_index.json');
const DEFAULT_OUT = 'E:/ai에이젼시만들기/outputs/home-dope-local-20261007/final-batch-20261010/maint';
const ENDPOINT = 'https://openapi.naver.com/v1/search/local.json';

export const NAME_MATCH = 0.8;
export const NAME_REVIEW = 0.6;
export const DIST_MATCH_M = 300;
export const DIST_REVIEW_M = 1000;
export const REQUEST_CAP = 600;
const APPLY_FIELDS = ['naverLink', 'roadAddress', 'telephone'];

// ── 순수 함수 ───────────────────────────────────────────────────────────
export const stripHtml = (s) =>
  String(s ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
export const normName = (s) => stripHtml(s).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

export function levenshtein(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

export function similarity(a, b) {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return 0;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

/** 행 상호(ko) 우선, 영문명은 title 과 비교 — 둘 중 높은 값. */
export const nameScore = (row, title) =>
  Math.max(similarity(row.name, title), row.nameEn ? similarity(row.nameEn, title) : 0);

/** Naver Local API 현재 버전: mapx/mapy = WGS84 경·위도 x 1e7 (정수 문자열). KATEC 변환 불필요. */
export function naverToWgs84(mapx, mapy) {
  const x = Number(mapx);
  const y = Number(mapy);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !x || !y) return null;
  return { lng: x / 1e7, lat: y / 1e7 };
}

export function haversineM(a, b) {
  const R = 6371008.8;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** 주소의 구/군 토큰 → 없으면 시 토큰 → 없으면 city 키. */
export function districtToken(row) {
  const toks = String(row.address || '').split(/\s+/);
  return (
    toks.find((t) => /^.+[구군]$/.test(t)) ||
    toks.find((t) => /^.+시$/.test(t) && !/(특별시|광역시|특별자치시)$/.test(t)) ||
    row.city ||
    ''
  );
}

export const buildQuery = (row) => `${stripHtml(row.name)} ${districtToken(row)}`.trim();

export const hasNoLink = (r) => !r.placeId && !r.googleMapsUrl && !r.naverLink;

const RANK = { matched: 2, review: 1, unmatched: 0 };

export function classify(score, distanceM) {
  if (distanceM == null) return score >= NAME_MATCH ? 'review' : 'unmatched'; // 좌표 없음 → 자동 매칭 불가
  if (score >= NAME_MATCH && distanceM <= DIST_MATCH_M) return 'matched';
  if (score >= NAME_REVIEW && distanceM <= DIST_REVIEW_M) return 'review';
  return 'unmatched';
}

const better = (a, b) => {
  if (!b) return true;
  if (RANK[a.status] !== RANK[b.status]) return RANK[a.status] > RANK[b.status];
  if (a.score !== b.score) return a.score > b.score;
  return (a.distanceM ?? 1e9) < (b.distanceM ?? 1e9);
};

export function evaluateRow(row, items) {
  let best = null;
  for (const it of items || []) {
    const title = stripHtml(it.title);
    const score = nameScore(row, title);
    const pt = naverToWgs84(it.mapx, it.mapy);
    const hasRowCoord = Number.isFinite(row.lat) && Number.isFinite(row.lng);
    const d = pt && hasRowCoord ? haversineM({ lat: row.lat, lng: row.lng }, pt) : null;
    const cand = { status: classify(score, d), score: +score.toFixed(3), distanceM: d == null ? null : Math.round(d), item: it, title, pt };
    if (better(cand, best)) best = cand;
  }
  if (!best) return { status: 'unmatched', score: 0, distanceM: null, title: null, proposed: {}, naverCoord: null };
  const it = best.item;
  const proposed = {};
  if (it.link) proposed.naverLink = it.link;
  if (it.roadAddress) proposed.roadAddress = it.roadAddress;
  if (it.telephone) proposed.telephone = it.telephone;
  if (it.category) proposed.category = it.category;
  return {
    status: best.status,
    score: best.score,
    distanceM: best.distanceM,
    title: best.title,
    naverAddress: it.address || '',
    proposed,
    naverCoord: best.pt,
  };
}

export function selectRows(rows, { noLink, city, limit }) {
  const out = [];
  rows.forEach((row, index) => {
    if (noLink && !hasNoLink(row)) return;
    if (city && row.city !== city) return;
    out.push({ row, index });
  });
  return Number.isFinite(limit) ? out.slice(0, limit) : out;
}

/** naverLink 허용 호스트: naver.com / naver.me 와 그 하위 도메인만 (API link 는 가게 홈페이지·SNS 일 수 있음). */
export function isNaverHost(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === 'naver.com' || h.endsWith('.naver.com') || h === 'naver.me' || h.endsWith('.naver.me');
  } catch {
    return false;
  }
}

/** matched 행의 naverLink/roadAddress/telephone 만 반영. 비-Naver link 는 rejectedLinks 로 보고만 하고 쓰지 않는다. 상호 불일치·행 수 변경은 throw. */
export function applyUpdates(rows, results) {
  const next = rows.map((r) => ({ ...r }));
  let updated = 0;
  const rejectedLinks = [];
  for (const r of results) {
    if (r.status !== 'matched') continue;
    const row = next[r.index];
    if (!row || row.name !== r.name) throw new Error(`apply: index ${r.index} 상호 불일치 — 중단`);
    let touched = false;
    for (const f of APPLY_FIELDS) {
      const v = r.proposed?.[f];
      if (f === 'naverLink' && v && !isNaverHost(v)) {
        rejectedLinks.push({ index: r.index, name: r.name, link: v });
        continue;
      }
      if (v && row[f] !== v) {
        row[f] = v;
        touched = true;
      }
    }
    if (touched) updated++;
  }
  if (next.length !== rows.length) throw new Error('apply: 행 수 변경 — 거부');
  return { rows: next, updated, rejectedLinks };
}

// ── 네트워크 ────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createClient({
  env = process.env,
  fetchImpl = globalThis.fetch,
  delayMs = 200,
  retryMs = 1000,
  cap = REQUEST_CAP,
  maxFails = 50,
} = {}) {
  const id = (env.NAVER_CLIENT_ID || '').trim();
  const secret = (env.NAVER_CLIENT_SECRET || '').trim();
  if (!id || !secret) throw new Error('NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수가 필요합니다 (값은 출력하지 않음)');
  const state = { requests: 0, consecutiveFails: 0, stopped: null };
  let last = 0;

  async function once(query) {
    if (state.requests >= cap) {
      state.stopped = 'request-cap';
      throw new Error('요청 상한 도달');
    }
    const wait = last + delayMs - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    state.requests++;
    const url = new URL(ENDPOINT);
    url.searchParams.set('query', query);
    url.searchParams.set('display', '5');
    return fetchImpl(url.toString(), { headers: { 'X-Naver-Client-Id': id, 'X-Naver-Client-Secret': secret } });
  }

  async function search(query) {
    if (state.stopped) throw new Error(`중단됨: ${state.stopped}`);
    try {
      let res = await once(query);
      if (res.status === 429) {
        await sleep(retryMs);
        res = await once(query);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      state.consecutiveFails = 0;
      return Array.isArray(j.items) ? j.items : [];
    } catch (e) {
      if (!state.stopped && ++state.consecutiveFails >= maxFails) state.stopped = 'consecutive-failures';
      throw e;
    }
  }
  return { search, state };
}

// ── 실행 ────────────────────────────────────────────────────────────────
export async function reconcile(rows, selected, client) {
  const results = [];
  for (const { row, index } of selected) {
    const base = {
      index,
      name: row.name,
      nameEn: row.nameEn || '',
      city: row.city,
      address: row.address,
      lat: row.lat,
      lng: row.lng,
      query: buildQuery(row),
    };
    try {
      const items = await client.search(base.query);
      results.push({ ...base, ...evaluateRow(row, items), resultCount: items.length });
    } catch (e) {
      results.push({ ...base, status: client.state.stopped ? 'skipped' : 'error', error: String(e.message).slice(0, 80), proposed: {} });
    }
  }
  return results;
}

export const countBy = (results) =>
  results.reduce((c, r) => {
    c[r.status] = (c[r.status] || 0) + 1;
    return c;
  }, {});
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

function toMarkdown(rep) {
  const L = [
    `# Naver 재대조 리포트 (${rep.generatedAt})`,
    '',
    `- 선택 ${rep.selected}행 · 요청 ${rep.requests}건 · 중단 사유: ${rep.stopped || '없음'}`,
    `- 카운트: ${JSON.stringify(rep.counts)}`,
    `- 좌표 변환: ${rep.coordConversion}`,
    '',
    '| # | 상태 | 점수 | 거리(m) | 상호 | Naver title | 주소 | roadAddress | 전화 |',
    '|---|---|---|---|---|---|---|---|---|',
  ];
  for (const r of rep.results) {
    L.push(`| ${r.index} | ${r.status} | ${r.score ?? ''} | ${r.distanceM ?? ''} | ${r.name} | ${r.title ?? ''} | ${r.address} | ${r.proposed?.roadAddress ?? ''} | ${r.proposed?.telephone ?? ''} |`);
  }
  return L.join('\n') + '\n';
}

function parseArgs(argv) {
  const a = { noLink: false, apply: false, city: null, limit: Infinity, fromReport: null, out: DEFAULT_OUT };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--no-link') a.noLink = true;
    else if (k === '--apply') a.apply = true;
    else if (k === '--city') a.city = argv[++i];
    else if (k === '--limit') a.limit = Number(argv[++i]);
    else if (k === '--from-report') a.fromReport = argv[++i];
    else if (k === '--out') a.out = argv[++i];
    else throw new Error(`알 수 없는 인자: ${k}`);
  }
  return a;
}

export async function main(argv, { env = process.env, fetchImpl, indexPath = INDEX_PATH, now = new Date() } = {}) {
  const args = parseArgs(argv);
  mkdirSync(args.out, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const rows = JSON.parse(readFileSync(indexPath, 'utf8'));
  let results;
  if (args.apply && args.fromReport) {
    results = JSON.parse(readFileSync(args.fromReport, 'utf8')).results;
  } else {
    const client = createClient({ env, fetchImpl });
    results = await reconcile(rows, selectRows(rows, args), client);
    const rep = {
      generatedAt: now.toISOString(),
      selected: results.length,
      requests: client.state.requests,
      stopped: client.state.stopped,
      counts: countBy(results),
      coordConversion: 'mapx/mapy / 1e7 = WGS84 lng/lat',
      results,
    };
    writeFileSync(join(args.out, `naver-reconcile-${stamp}.json`), JSON.stringify(rep, null, 1));
    writeFileSync(join(args.out, `naver-reconcile-${stamp}.md`), toMarkdown(rep));
    console.log(JSON.stringify({ selected: rep.selected, requests: rep.requests, stopped: rep.stopped, counts: rep.counts }));
  }
  if (!args.apply) return { results };
  const before = sha(indexPath);
  const { rows: next, updated, rejectedLinks } = applyUpdates(rows, results);
  if (updated > 0) {
    copyFileSync(indexPath, join(args.out, `_food_index.backup-${stamp}.json`));
    writeFileSync(indexPath, JSON.stringify(next));
  }
  const out = { updated, rejectedLinks, rowsBefore: rows.length, rowsAfter: next.length, sha256Before: before, sha256After: sha(indexPath) };
  console.log(JSON.stringify(out));
  return { results, ...out };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`naver-reconcile 실패: ${e.message}`);
    process.exit(1);
  });
}
