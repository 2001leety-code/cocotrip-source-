#!/usr/bin/env node
/**
 * Offline customer UI capture harness (2026-10-17).
 *
 * Real Chromium screenshots/videos of the local app at http://127.0.0.1:<port>, nothing else.
 * - Fresh browser context per cell (no profile, no storage state), service workers blocked.
 * - HTTP + WebSocket routing installed before the first navigation:
 *   exact local origin = static app assets; known `/api/*` = explicit synthetic fixtures below;
 *   unknown `/api/*` = aborted and recorded as a failure; every external request = aborted
 *   (map tiles answered locally with a flat synthetic tile, reported as a simulated map).
 * - Second layer: dead proxy 127.0.0.1:9 with only `127.0.0.1:<port>` bypassed (`<-loopback>;127.0.0.1:<port>`), background networking off.
 *   This is application-level cooperative isolation, not an OS guarantee.
 * - Phone widths are Chromium mobile emulation (isMobile + hasTouch), not physical devices.
 * - No form is submitted, no login/inquiry is touched, no order is created. The charter journey types
 *   clearly synthetic values into Step 5 (no customer, no submission) and presses Proceed to Pay, which
 *   only opens the payment panel; the PayPal button itself is never pressed. Results are evidence for
 *   human review, never a PASS: a screenshot only proves a frame was captured. See CAPTURE-20261017.md.
 * - Must be launched through the approved Run-Offline profile (see CAPTURE-20261017.md), never directly.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';

const RUNS_ROOT = 'E:\\ai에이젼시만들기\\versions\\cocotrip-integration-20261017-preservation\\runs';
const GROUPS = ['home', 'planner', 'result', 'tours', 'charter', 'map', 'static', 'account'];
const HEIGHTS = { 360: 800, 390: 844, 430: 932, 1024: 768, 1440: 1000 };
// Phones: Chromium mobile emulation at DPR 2 (below the 2.6-3 of most current phones, keeps
// full-page PNGs a manageable size). Desktop widths: plain desktop Chromium at DPR 1.
const DEVICE = {
  360: { isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  390: { isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  430: { isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  1024: { isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
  1440: { isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
};
const LANGS = ['ko', 'en', 'ja', 'zh'];
const LOCALES = { ko: 'ko-KR', en: 'en-US', ja: 'ja-JP', zh: 'zh-CN' };
const TOUR_SLUG = 'seoul-city-full-day';
const STATIC_PATHS = ['/links', '/whatsapp-support', '/terms', '/privacy', '/travel-terms', '/about', '/account-deletion'];
// charterWizard.next in src/i18n/locales/{ko,en,ja,zh}.json:2256 (read by charter/wizard-i18n.ts).
const CHARTER_NEXT = { ko: '다음', en: 'Next', ja: '次へ', zh: '下一步' };
// Step4PaxVehicle.tsx vehiclePaxRangeLabel('staria_9', lang): the 9-seat option's passenger range.
const STARIA9_RANGE = { ko: '1~7인', en: '1-7 pax', ja: '1~7名', zh: '1~7人' };
// charterWizard.payProceed in src/i18n/locales/*.json:2258 (Step 6 in-flow button and phone bar).
const CHARTER_PAY = { ko: '결제 진행', en: 'Proceed to Pay', ja: '決済へ進む', zh: '前往支付' };
// BookingInfoForm.tsx STR[lang].flightNoPh.
const FLIGHT_PH = { ko: '예: KE5760, OZ521', en: 'e.g. KE5760, OZ521', ja: '例: KE5760、OZ521', zh: '例: KE5760、OZ521' };
// Charter Step 5 values. Clearly synthetic, not a customer; typed locally, never submitted or sent.
// Phone: NANP 555-01xx fiction pattern after the language's default dial; flight: ZZ placeholder code.
const SYNTHETIC_STEP5 = { lastName: 'TEST', firstName: 'SYNTHETIC', nationalNumber: '5550100000', flightNo: 'ZZ0000', daysAhead: 30 };
// PayPalBookingButton.tsx:410-412: no VITE_PAYPAL_CLIENT_ID -> onError(p.paypalSdkError, else this); the
// charter PaymentPanel passes p={{}}, so this exact text means no SDK request was even attempted.
const PAYPAL_NO_CLIENT_ID = 'PayPal client ID not configured.';
const PAYPAL_HOST = /(^|\.)paypal(objects)?\.com$/i;
// TourBookingDialog.tsx I18N: next / missingFields / step2Title.
const TOUR_NEXT = { ko: '결제 단계로', en: 'Continue to payment', ja: '決済へ進む', zh: '前往支付' };
const TOUR_MISSING = { ko: '필수 항목을 모두 입력해주세요', en: 'Please fill in all required fields', ja: '必須項目をすべて入力してください', zh: '请填写所有必填项' };
const TOUR_STEP2 = { ko: '2단계 — 연락처·픽업', en: 'Step 2 — Contact & Pickup', ja: 'ステップ 2 — 連絡先・ピックアップ', zh: '第 2 步 — 联系方式·接送' };
// Earliest tour date the harness picks: well past the 8h tour cutoff (lib/bookingCutoff).
const TOUR_DATE_MIN_DAYS = 7;
// Failure kinds that mean a request left the declared fixtures (or a page tried a side effect).
const SIDE_EFFECT_KINDS = new Set(['unknown-api', 'fixture-request-mismatch', 'blocked-side-effect', 'local-non-get', 'blocked-websocket', 'escaped-route-reached-proxy', 'popup']);
// Representative video cells: one phone, one desktop; both motion settings each.
const VIDEO_CELLS = [{ width: 390, lang: 'en' }, { width: 1440, lang: 'ko' }];
const VIDEO_FLOWS = ['home', 'planner', 'charter', 'tours'];
const SHARED_SOURCE = /^\/api\/_shared\/[^?]+\.js$/;
const TILE_HOST = /^([a-d]\.)?basemaps\.cartocdn\.com$/;
const TILE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e9e5dc"/></svg>';
const ANALYTICS_HOSTS = ['googletagmanager.com', 'google-analytics.com', 'analytics.google.com', 'googleadservices.com', 'doubleclick.net', 'posthog.com'];
// Chromium's own log line for a subresource the harness aborted; only counted as expected when
// the message location is a URL this cell actually aborted (see classifyConsole).
const BLOCKED_LOAD = /^Failed to load resource: net::ERR_BLOCKED_BY_CLIENT$/;
const BLOCKED_FETCH = /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS) (\S+) net::ERR_BLOCKED_BY_CLIENT$/;
// Firestore SDK offline lines; only expected after this cell aborted a firestore.googleapis.com
// request. Any other Firestore text stays unclassified (= failure).
const FIRESTORE_OFFLINE = /^\[?@firebase\/firestore:?\]?.*(Could not reach Cloud Firestore backend|WebChannelConnection RPC '(Listen|Write)' stream \S+ transport errored)/;
const PLAYWRIGHT_CHROMIUM = /[\\/]ms-playwright[\\/]chromium(_headless_shell)?-\d+[\\/]chrome-win(64)?[\\/](chrome|chrome-headless-shell|headless_shell)\.exe$/i;

// ── Synthetic fixtures (shapes reused from tests/e2e/*-local.spec.ts) ─────────────────────────

// plan-result-night-local.spec.ts planFixture: 2 days × 2 stops, public synthetic places.
const PLAN_COPY = {
  ko: { title: '서울 2일 실행 일정', theme: '도심과 한강', theme2: '남산과 시장', stop: '경복궁', nextStop: '북촌한옥마을', day2Stop: '남산서울타워', day2NextStop: '광장시장', note: '지하철 조회 결과를 확인하세요.', city: '서울' },
  en: { title: 'Two days in Seoul', theme: 'City and river', theme2: 'Namsan and markets', stop: 'Gyeongbokgung Palace', nextStop: 'Bukchon Hanok Village', day2Stop: 'N Seoul Tower', day2NextStop: 'Gwangjang Market', note: 'Check the measured subway leg.', city: 'Seoul' },
  ja: { title: 'ソウル2日間の実行日程', theme: '都心と漢江', theme2: '南山と市場', stop: '景福宮', nextStop: '北村韓屋村', day2Stop: 'Nソウルタワー', day2NextStop: '広蔵市場', note: '地下鉄の検索結果を確認してください。', city: 'ソウル' },
  zh: { title: '首尔两日执行行程', theme: '市区与汉江', theme2: '南山与市场', stop: '景福宫', nextStop: '北村韩屋村', day2Stop: 'N首尔塔', day2NextStop: '广藏市场', note: '请查看地铁查询结果。', city: '首尔' },
};

function planFixture(lang, state) {
  const t = PLAN_COPY[lang];
  const subway = (min, transfers, walk) => ({ method: 'subway', est_min: min, fare: 1500, transfers, walk_min: walk });
  return {
    id: `offline-synthetic-${state}-${lang}`,
    isPublic: true,
    status: state === 'error' ? 'error' : 'ready',
    input: { language: lang, area: t.city, regions: ['seoul'], startDate: '2026-09-12', adults: 2 },
    itinerary: {
      tour_title: t.title,
      days: [
        { day: 1, date: '2026-09-12', city: t.city, theme: t.theme, stops: [
          { start_time: '09:00', stay_min: 90, category: 'attraction', display_name: t.stop, address: '161 Sajik-ro, Jongno-gu, Seoul', lat: 37.5796, lng: 126.977, tip: t.note },
          { start_time: '11:10', stay_min: 70, category: 'culture', display_name: t.nextStop, address: '37 Gyedong-gil, Jongno-gu, Seoul', lat: 37.5826, lng: 126.983, transit_from_prev: subway(20, 0, 6) },
        ] },
        { day: 2, date: '2026-09-13', city: t.city, theme: t.theme2, stops: [
          { start_time: '10:00', stay_min: 80, category: 'attraction', display_name: t.day2Stop, address: '105 Namsangongwon-gil, Yongsan-gu, Seoul', lat: 37.5512, lng: 126.9882 },
          { start_time: '12:10', stay_min: 60, category: 'food', display_name: t.day2NextStop, address: '88 Changgyeonggung-ro, Jongno-gu, Seoul', lat: 37.5701, lng: 126.9996, transit_from_prev: subway(25, 1, 8) },
        ] },
      ],
      // RecommendedRestaurant contract (src/pages/PlanDetailPage/types.ts): general bucket only, no
      // dietary buckets/labels, no googleMapsUrl. Fictional OFFLINE TEST entries, not real businesses.
      recommended_restaurants: { general: [
        { name: '오프라인 테스트 식당 A (가상)', nameEn: 'OFFLINE TEST Restaurant A (synthetic)', cuisine: 'Korean (test)', cuisineKo: '한식 (테스트)', dong: '테스트동', dongEn: 'Test-dong', address: '0 Offline Test-ro, Seoul (synthetic)', rating: 4.5, reviewCount: 120, nearestStopKm: 0.4 },
        { name: '오프라인 테스트 식당 B (가상)', nameEn: 'OFFLINE TEST Restaurant B (synthetic)', cuisine: 'Noodles (test)', cuisineKo: '면 요리 (테스트)', address: '1 Offline Test-ro, Seoul (synthetic)', reviewCount: 45, nearestStopKm: 1.2 },
      ] },
    },
  };
}

// planner-preview-night-local.spec.ts QUICK_DATA (ko, verbatim) plus en/ja/zh variants of the same
// shape: headers are CANONICAL_HEADERS in src/pages/PlannerPage/lib/quickPreviewContract.ts, 3 ascending
// unique rows, one detail per row with the same identity fields. Synthetic copy, not model output.
const QUICK_COPY = {
  ko: {
    headers: ['시간', '명소', '교통', '팁'],
    themes: ['야경', '미식'],
    narrative: '서울의 첫날 밤을 산책과 야경, 늦은 식사로 채우는 미리보기입니다.',
    spots: ['북촌 한옥마을', '남산서울타워', '광장시장'],
    transit: ['출발 지점', '버스 20분', '지하철 15분'],
    tips: ['해 질 녘 골목이 가장 조용합니다', '케이블카 대기줄은 저녁에 짧아집니다', '빈대떡은 반 장씩 나눠 주문하세요'],
    reflected: ['서울', '3일', '음식', '사진'],
    address: '서울 종로구 계동길 37',
  },
  en: {
    headers: ['Time', 'Spot', 'Transit', 'Insider Tip'],
    themes: ['Night views', 'Food'],
    narrative: 'A preview that fills your first evening in Seoul with a walk, night views and a late meal.',
    spots: ['Bukchon Hanok Village', 'N Seoul Tower', 'Gwangjang Market'],
    transit: ['Starting point', 'Bus 20 min', 'Subway 15 min'],
    tips: ['The alleys are quietest around sunset', 'The cable car queue is shorter in the evening', 'Order bindaetteok by the half to share'],
    reflected: ['Seoul', '3 days', 'Food', 'Photo'],
    address: '37 Gyedong-gil, Jongno-gu, Seoul',
  },
  ja: {
    headers: ['時間', 'スポット', '交通', 'ヒント'],
    themes: ['夜景', 'グルメ'],
    narrative: 'ソウル初日の夜を散策と夜景、遅めの食事で過ごすプレビューです。',
    spots: ['北村韓屋村', 'Nソウルタワー', '広蔵市場'],
    transit: ['出発地点', 'バス20分', '地下鉄15分'],
    tips: ['夕暮れ時の路地がいちばん静かです', 'ケーブルカーの列は夜に短くなります', 'ピンデトッは半分ずつ注文しましょう'],
    reflected: ['ソウル', '3日', 'グルメ', '写真'],
    address: '37 Gyedong-gil, Jongno-gu, Seoul',
  },
  zh: {
    headers: ['时间', '地点', '交通', '贴士'],
    themes: ['夜景', '美食'],
    narrative: '用散步、夜景和一顿晚餐填满首尔第一晚的预览。',
    spots: ['北村韩屋村', 'N首尔塔', '广藏市场'],
    transit: ['出发地点', '公交20分钟', '地铁15分钟'],
    tips: ['傍晚时分的小巷最安静', '缆车排队在晚上会短一些', '绿豆煎饼可以点半份分着吃'],
    reflected: ['首尔', '3天', '美食', '拍照'],
    address: '37 Gyedong-gil, Jongno-gu, Seoul',
  },
};

function quickFixture(lang) {
  const c = QUICK_COPY[lang];
  const times = ['17:00', '19:00', '21:00'];
  return {
    themes: c.themes,
    marketingNarrative: c.narrative,
    day1MarkdownTable: [
      `| ${c.headers.join(' | ')} |`,
      '|---|---|---|---|',
      ...times.map((time, i) => `| ${time} | ${c.spots[i]} | ${c.transit[i]} | ${c.tips[i]} |`),
    ].join('\n'),
    reflectedConditions: c.reflected,
    deferredCategories: ['Shopping'],
    spotDetails: [
      { type: 'spot', spot: c.spots[0], candidateId: 'syn-spot-1', name: c.spots[0], address: c.address },
      { type: 'attraction', spot: c.spots[1], candidateId: 'syn-attr-2', key: 'namsan_tower', lat: 37.5512, lng: 126.9882 },
      { type: 'food', spot: c.spots[2], candidateId: 'syn-food-3', placeId: 'ChIJsyntheticGwangjang01' },
    ],
  };
}

function postBody(req) {
  try {
    const body = req.postDataJSON();
    return body && typeof body === 'object' ? body : null;
  } catch {
    return null;
  }
}

/**
 * The quick preview fixture only answers the request the wizard builds from the first Quick Start
 * preset ("3 days Seoul") in this cell's language, as planner-preview-night-local.spec.ts asserts.
 */
function quickRequestMismatch(body, cell) {
  if (!body) return 'body is not JSON';
  if (body.language !== cell.lang) return `language=${String(body.language)}`;
  if (body.cityKey !== 'seoul') return `cityKey=${String(body.cityKey)}`;
  if (body.durationDays !== 3) return `durationDays=${String(body.durationDays)}`;
  if (!Array.isArray(body.regions) || body.regions.length === 0) return 'regions empty';
  if (!/^(ICN|GMP)/.test(String(body.arrival_airport))) return 'arrival_airport is not ICN/GMP';
  return '';
}

/** Explicit `/api/*` contracts. Anything not matched here is aborted and recorded as a failure. */
function apiFixture(req, url, cell) {
  const method = req.method();
  const p = url.pathname;
  if (p === '/api/promo-config' && method === 'GET') {
    // PromoBanner/PromoPopup: ok with no banner and a disabled popup = no promotion shown.
    return { id: 'promo-config:none', body: { ok: true, banner: null, popup: { enabled: false } } };
  }
  if (p === '/api/reviews') {
    if (method === 'GET') return { id: 'reviews:get:empty', body: { reviews: [] } };
    const body = method === 'POST' ? postBody(req) : null;
    const action = body && typeof body.action === 'string' ? body.action : '';
    if (action === 'list' || action === 'aggregate') return { id: `reviews:${action}:empty`, body: { reviews: [], aggregates: {} } };
  }
  if (p === '/api/get-plan' && method === 'GET' && !url.searchParams.has('token')) {
    const m = /^offline-synthetic-(normal|error)-(ko|en|ja|zh)$/.exec(url.searchParams.get('planId') || '');
    if (m) return { id: `get-plan:${m[1]}:${m[2]}`, body: { ok: true, plan: planFixture(m[2], m[1]) } };
  }
  if (p === '/api/ai-planner-quick' && method === 'POST' && cell.allowQuick) {
    const body = postBody(req);
    const mismatch = quickRequestMismatch(body, cell);
    if (mismatch) return { reject: `ai-planner-quick request does not match the synthetic preset: ${mismatch}` };
    cell.quickRequest = { language: body.language, cityKey: body.cityKey, durationDays: body.durationDays, regions: body.regions.length, arrivalAirport: String(body.arrival_airport).slice(0, 3) };
    return { id: `ai-planner-quick:synthetic-${cell.lang}`, body: { ok: true, data: quickFixture(cell.lang) } };
  }
  return null;
}

// ── CLI + safety checks ─────────────────────────────────────────────────────────────────────

function fail(message) {
  console.error(`[capture] ${message}`);
  process.exit(1);
}

function listOption(raw, allowed, name, fallback) {
  if (!raw) return fallback;
  const items = raw.split(',').map((s) => s.trim()).filter(Boolean);
  for (const item of items) if (!allowed.includes(item)) fail(`--${name}: unknown value "${item}" (allowed: ${allowed.join(',')})`);
  return [...new Set(items)];
}

function readOptions() {
  let values;
  try {
    ({ values } = parseArgs({
      strict: true,
      options: {
        'base-url': { type: 'string' },
        out: { type: 'string' },
        group: { type: 'string' },
        width: { type: 'string' },
        lang: { type: 'string' },
        'static-motion': { type: 'string' },
        'video-flow': { type: 'string' },
        'browser-executable': { type: 'string' },
        'plan-only': { type: 'boolean' },
      },
    }));
  } catch (error) {
    fail(error.message);
  }

  const baseRaw = values['base-url'] || '';
  const baseMatch = /^http:\/\/127\.0\.0\.1:(\d{4,5})\/?$/.exec(baseRaw);
  if (!baseMatch) fail('--base-url must be exactly http://127.0.0.1:<port> (numeric loopback, no other host or path)');
  const port = Number(baseMatch[1]);
  if (port < 1024 || port > 65535) fail('--base-url port must be 1024-65535');
  const base = new URL(`http://127.0.0.1:${port}`);

  const groups = listOption(values.group, [...GROUPS, 'video'], 'group', GROUPS);
  const widths = listOption(values.width, Object.keys(HEIGHTS), 'width', Object.keys(HEIGHTS)).map(Number);
  const langs = listOption(values.lang, LANGS, 'lang', LANGS);
  const videoFlows = listOption(values['video-flow'], VIDEO_FLOWS, 'video-flow', VIDEO_FLOWS);
  if (values['video-flow'] && !groups.includes('video')) fail('--video-flow needs --group video');
  const staticMotion = values['static-motion'] || 'reduce';
  if (staticMotion !== 'reduce' && staticMotion !== 'no-preference') fail('--static-motion must be reduce or no-preference');

  let executable = '';
  if (values['browser-executable']) {
    // Only a Playwright-managed Chromium build; the guard profile is what actually approves the exe.
    executable = values['browser-executable'];
    if (!path.isAbsolute(executable)) fail('--browser-executable must be an absolute path');
    if (!PLAYWRIGHT_CHROMIUM.test(executable)) fail('--browser-executable must be a Playwright Chromium build (...\\ms-playwright\\chromium[_headless_shell]-<rev>\\chrome-win[64]\\<exe>)');
    if (!fs.existsSync(executable) || !fs.statSync(executable).isFile()) fail('--browser-executable does not exist or is not a file');
  }

  const planOnly = values['plan-only'] === true;
  let out = '';
  if (!planOnly) {
    if (!values.out || !path.isAbsolute(values.out)) fail(`--out must be an absolute path under ${RUNS_ROOT}`);
    out = path.resolve(values.out);
    const rel = path.relative(RUNS_ROOT, out);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) fail(`--out must be a new directory inside ${RUNS_ROOT}`);
    if (fs.existsSync(out)) fail(`--out already exists; refusing to overwrite an earlier run: ${out}`);
  }
  return { base, port, groups, widths, langs, staticMotion, videoFlows, executable, planOnly, out };
}

// ── Small utilities ─────────────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const msg = (error) => String((error && error.message) || error).split('\n')[0].slice(0, 300);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const redact = (url) => `${url.origin}${url.pathname}`.slice(0, 200);
const exactText = (text) => new RegExp(`^\\s*${escapeRe(text)}\\s*$`);
/** KST calendar date (YYYY-MM-DD) `offsetDays` from now; contexts run with timezoneId Asia/Seoul. */
const kstIso = (offsetDays = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' })
  .format(new Date(Date.now() + offsetDays * 86400000));

/** Side-effect failures recorded since failure index `since` (requests outside the declared fixtures). */
function newSideEffects(cell, since) {
  return cell.failures.slice(since).filter((f) => SIDE_EFFECT_KINDS.has(f.kind)).map((f) => `${f.kind}: ${f.detail}`);
}

class Unverified extends Error {}

async function waitUntil(check, timeout, label) {
  if (!(await pollFor(check, timeout))) throw new Error(`timed out waiting for ${label}`);
}

/** Like waitUntil, but returns false on timeout so the caller marks the state explicitly. */
async function pollFor(check, timeout) {
  const end = Date.now() + timeout;
  for (;;) {
    if (await check()) return true;
    if (Date.now() > end) return false;
    await sleep(150);
  }
}

function fileRecord(run, file) {
  const data = fs.readFileSync(file);
  return { path: path.relative(run.out, file), bytes: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') };
}

function writeReceipt(run, complete) {
  const receipt = { ...run.meta, complete, finishedAt: complete ? new Date().toISOString() : null, totals: totals(run), cells: run.cells };
  const tmp = path.join(run.out, 'receipt.json.tmp');
  fs.writeFileSync(tmp, JSON.stringify(receipt, null, 2));
  fs.renameSync(tmp, path.join(run.out, 'receipt.json'));
}

function totals(run) {
  const t = { cells: run.cells.length, captured: 0, withFailures: 0, partiallyUnverified: 0, failures: 0, unverifiedStates: 0, unverifiedItems: 0, screenshotErrors: 0, files: 0 };
  for (const cell of run.cells) {
    if (cell.status === 'captured') t.captured += 1;
    if (cell.status === 'captured-with-failures') t.withFailures += 1;
    if (cell.status === 'partially-unverified') t.partiallyUnverified += 1;
    t.failures += cell.failures.length;
    t.unverifiedStates += cell.states.filter((s) => s.status === 'unverified' || s.status === 'not-reached').length;
    t.unverifiedItems += cell.unverified.length;
    t.screenshotErrors += cell.captureErrors;
    t.files += cell.states.reduce((n, s) => n + (s.files ? s.files.length : 0), 0) + cell.videos.length;
  }
  return t;
}

// ── Browser context + network guard ─────────────────────────────────────────────────────────

function classifyExternal(url, method) {
  const host = url.hostname.toLowerCase();
  if (host === 'fonts.googleapis.com' || host === 'fonts.gstatic.com') return { category: 'font', unexpected: false };
  if (ANALYTICS_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return { category: 'analytics', unexpected: false };
  if (host === 'firestore.googleapis.com') {
    const write = /\/Write\//.test(url.pathname);
    return { category: write ? 'firestore-write' : 'firestore-read', unexpected: write };
  }
  if (/(^|\.)(identitytoolkit|securetoken)\.googleapis\.com$/.test(host)) return { category: 'auth', unexpected: true };
  const read = method === 'GET' || method === 'HEAD';
  return { category: read ? 'external-read' : 'external-write', unexpected: !read };
}

/**
 * Console lines are expected only when they are the browser's report of a request this cell's
 * route handler aborted (exact URL match), or a Firestore SDK offline line after this cell actually
 * aborted a Firestore request. Everything else is unclassified.
 */
function classifyConsole(cell, text, locationUrl) {
  if (BLOCKED_LOAD.test(text)) return cell.abortedUrls.has(locationUrl) ? 'harness-aborted-request' : 'unmatched-blocked-load';
  const fetchLine = BLOCKED_FETCH.exec(text);
  if (fetchLine) return cell.abortedUrls.has(fetchLine[2]) ? 'harness-aborted-request' : 'unmatched-blocked-load';
  if (FIRESTORE_OFFLINE.test(text) && cell.firestoreAborted > 0) return 'harness-aborted-firestore';
  return 'unclassified';
}

function newCell(run, group, width, lang, motion, flow) {
  const dir = group === 'video'
    ? path.join(run.out, 'videos', flow, `${width}-${lang}-${motion}`)
    : path.join(run.out, 'shots', group, `${width}-${lang}`);
  fs.mkdirSync(dir, { recursive: true });
  return {
    group, flow: flow || null, width, height: HEIGHTS[width], device: DEVICE[width], lang, motion, dir, status: 'pending', serverKind: null,
    states: [], videos: [], failures: [], unverified: [], console: [], blocked: [], blockedTotal: 0, websockets: [],
    fixtureHits: {}, sourceModules: 0, captureErrors: 0, allowQuick: false, quickRequest: null, halted: null, motionProbe: null,
    abortedUrls: new Set(), firestoreAborted: 0, pointer: { firstActivation: null }, currentState: null,
  };
}

async function openContext(browser, run, cell, extra) {
  const context = await browser.newContext({
    viewport: { width: cell.width, height: cell.height },
    ...DEVICE[cell.width],
    serviceWorkers: 'block',
    reducedMotion: cell.motion,
    locale: LOCALES[cell.lang],
    timezoneId: 'Asia/Seoul',
    acceptDownloads: false,
    ...extra,
  });
  context.setDefaultTimeout(15000);
  const base = run.base;
  const aborted = new WeakSet();
  const hit = (id) => { cell.fixtureHits[id] = (cell.fixtureHits[id] || 0) + 1; };
  const abort = async (route, req, url) => {
    aborted.add(req);
    cell.abortedUrls.add(url.href);
    await route.abort('blockedbyclient');
  };

  await context.addInitScript(({ origin, lang }) => {
    if (window.location.origin !== origin) return;
    try {
      localStorage.setItem('cocotrip_lang', lang);
      localStorage.setItem('coco_promo_banner_dismissed_v1', 'true');
      localStorage.setItem('cocotrip_cookie_consent', 'dismissed');
    } catch { /* storage unavailable: language falls back, html lang check records it */ }
  }, { origin: base.origin, lang: cell.lang });

  await context.routeWebSocket(/.*/, (ws) => {
    let url = null;
    try { url = new URL(ws.url()); } catch { /* recorded as unparsable below */ }
    const local = !!url && url.host === base.host;
    cell.websockets.push({ url: url ? redact(url) : 'unparsable', local });
    if (!local) cell.failures.push({ kind: 'blocked-websocket', detail: url ? redact(url) : 'unparsable' });
    ws.close({ code: 1008, reason: 'offline capture harness' });
  });

  await context.route('**/*', async (route) => {
    const req = route.request();
    const method = req.method();
    try {
      const url = new URL(req.url());
      if (url.origin !== base.origin) {
        if (url.protocol === 'https:' && TILE_HOST.test(url.hostname) && method === 'GET') {
          hit('synthetic-map-tile');
          return await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: TILE_SVG });
        }
        const c = classifyExternal(url, method);
        cell.blockedTotal += 1;
        if (c.category.startsWith('firestore')) cell.firestoreAborted += 1;
        if (cell.blocked.length < 300) cell.blocked.push({ category: c.category, method, url: redact(url), type: req.resourceType() });
        else cell.blockedListTruncated = true;
        if (c.unexpected) cell.failures.push({ kind: 'blocked-side-effect', detail: `${c.category} ${method} ${redact(url)}` });
        return await abort(route, req, url);
      }
      if (url.pathname.startsWith('/api/')) {
        if (method === 'GET' && SHARED_SOURCE.test(url.pathname)) {
          // Vite dev serves api/_shared/*.js as source modules imported by src/ (see vite.config.ts bypass).
          cell.sourceModules += 1;
          return await route.continue();
        }
        const fixture = apiFixture(req, url, cell);
        if (fixture && fixture.reject) {
          cell.failures.push({ kind: 'fixture-request-mismatch', detail: fixture.reject });
          return await abort(route, req, url);
        }
        if (fixture) {
          hit(fixture.id);
          return await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture.body) });
        }
        cell.failures.push({ kind: 'unknown-api', detail: `${method} ${url.pathname}` });
        return await abort(route, req, url);
      }
      if (method !== 'GET' && method !== 'HEAD') {
        cell.failures.push({ kind: 'local-non-get', detail: `${method} ${url.pathname}` });
        return await abort(route, req, url);
      }
      return await route.continue();
    } catch (error) {
      cell.failures.push({ kind: 'route-handler-error', detail: msg(error) });
      aborted.add(req);
      await route.abort('failed').catch((e) => cell.failures.push({ kind: 'route-abort-error', detail: msg(e) }));
    }
  });

  context.on('response', (response) => {
    try {
      const url = new URL(response.url());
      if (url.origin === base.origin && response.status() >= 400) {
        cell.failures.push({ kind: 'local-http-error', detail: `${response.status()} ${url.pathname}` });
      }
    } catch (error) {
      cell.unverified.push({ kind: 'response-url-unparsable', detail: msg(error) });
    }
  });
  context.on('requestfailed', (req) => {
    if (aborted.has(req)) return;
    const text = (req.failure() && req.failure().errorText) || '';
    let local = false;
    try { local = new URL(req.url()).origin === base.origin; } catch { /* non-URL: counted as non-local */ }
    if (text.includes('ERR_ABORTED')) {
      // Cancelled by the page itself (navigation, media range, AbortController). Not a failure,
      // but not proven harmless either: listed and the cell stays partially unverified.
      cell.unverified.push({ kind: 'request-cancelled-by-page', detail: `${req.resourceType()} ${req.url().slice(0, 160)}` });
      return;
    }
    cell.failures.push({ kind: local ? 'local-request-failed' : 'escaped-route-reached-proxy', detail: `${text} ${req.url().slice(0, 160)}` });
  });

  let main = null;
  context.on('page', (page) => {
    if (!main) { main = page; return; }
    cell.failures.push({ kind: 'popup', detail: page.url().slice(0, 160) });
    page.close().catch((e) => cell.failures.push({ kind: 'popup-close-error', detail: msg(e) }));
  });

  const page = await context.newPage();
  page.on('pageerror', (error) => cell.failures.push({ kind: 'page-error', detail: msg(error) }));
  page.on('dialog', (dialog) => {
    cell.failures.push({ kind: 'dialog', detail: `${dialog.type()}: ${dialog.message().slice(0, 120)}` });
    dialog.dismiss().catch((e) => cell.failures.push({ kind: 'dialog-dismiss-error', detail: msg(e) }));
  });
  page.on('download', (download) => cell.failures.push({ kind: 'download', detail: download.suggestedFilename() }));
  page.on('console', (message) => {
    const type = message.type();
    if (type !== 'error' && type !== 'warning') return;
    const text = message.text();
    const location = message.location() || {};
    const classified = classifyConsole(cell, text, location.url || '');
    // Every error/warning is recorded; nothing is dropped.
    cell.console.push({ type, classified, text: text.slice(0, 400), url: (location.url || '').slice(0, 200) });
    if (type === 'error' && (classified === 'unclassified' || classified === 'unmatched-blocked-load')) {
      cell.failures.push({ kind: 'console-error', detail: text.slice(0, 200) });
    }
  });
  return { context, page };
}

// ── Measurements + capture ──────────────────────────────────────────────────────────────────

/** Runs in the page: heading, overflow, fixed layers, visible CTA and price geometry with hit tests. */
function pageMetrics({ nextLabel }) {
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0;
  };
  const box = (r) => ({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
  const describe = (el) => {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls ? `.${cls}` : ''}`;
  };
  const hitTest = (el) => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    if (cx < 0 || cx > vw || cy < 0 || cy > vh) return { inViewport: false, hit: null, occludedBy: null };
    const top = document.elementFromPoint(cx, cy);
    const ok = !!top && (top === el || el.contains(top));
    return { inViewport: true, hit: ok, occludedBy: ok || !top ? null : describe(top) };
  };
  const ctaSet = new Set(document.querySelectorAll('.ec-btn-primary, .home-dope-btn--primary, .wizard-res-cta, .charter-funnel-action, button[type="submit"]'));
  document.querySelectorAll('.charter-funnel-wizard button').forEach((b) => { if ((b.textContent || '').trim() === nextLabel) ctaSet.add(b); });
  const ctas = [...ctaSet].filter(visible).slice(0, 12).map((el) => ({
    el: describe(el),
    text: (el.innerText || '').trim().slice(0, 60),
    disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
    box: box(el.getBoundingClientRect()),
    ...hitTest(el),
  }));
  const prices = [...document.querySelectorAll('[class*="price"]')]
    .filter((el) => visible(el) && (el.innerText || '').trim().length > 0 && (el.innerText || '').trim().length <= 60)
    .slice(0, 12)
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { el: describe(el), text: el.innerText.trim(), box: box(r), clippedLeft: r.left < -1, clippedRight: r.right > vw + 1, ...hitTest(el) };
    });
  const fixed = [...document.body.querySelectorAll('*')]
    .filter((el) => { const p = getComputedStyle(el).position; return (p === 'fixed' || p === 'sticky') && visible(el); })
    .slice(0, 12)
    .map((el) => ({ el: describe(el), position: getComputedStyle(el).position, box: box(el.getBoundingClientRect()) }));
  const heading = [...document.querySelectorAll('h1')].find(visible) || [...document.querySelectorAll('h2, [role="heading"]')].find(visible);
  // Planner date calendar (read only). Visible area = viewport ∩ the padding box of every ancestor
  // (panel included) whose computed overflow-x/y is not `visible`; an outer card rect alone is not
  // proof. Month labels and weekday headers are measured by their text glyphs (Range), day and nav
  // buttons by their boxes; each must lie wholly inside that intersection and buttons keep 44x44.
  const calendarBounds = (() => {
    const panel = document.querySelector('.wizard-date-calendar');
    if (!panel || !visible(panel)) return null;
    const fbox = (r) => ({ x: +r.left.toFixed(1), y: +r.top.toFixed(1), r: +r.right.toFixed(1), b: +r.bottom.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) });
    // The viewport bounds X only: rows below the fold are a page scroll, not a clip.
    let clip = { left: 0, top: -1e6, right: vw, bottom: 1e6 };
    const chain = [];
    for (let el = panel; el && el !== document.documentElement; el = el.parentElement) {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const clipsX = s.overflowX !== 'visible';
      const clipsY = s.overflowY !== 'visible';
      if (!clipsX && !clipsY) continue;
      // padding box = border box minus borders (scrollbars are excluded by clientWidth/Height).
      const pl = r.left + el.clientLeft;
      const pt = r.top + el.clientTop;
      const pad = { left: pl, top: pt, right: pl + el.clientWidth, bottom: pt + el.clientHeight };
      if (clipsX) { clip.left = Math.max(clip.left, pad.left); clip.right = Math.min(clip.right, pad.right); }
      if (clipsY) { clip.top = Math.max(clip.top, pad.top); clip.bottom = Math.min(clip.bottom, pad.bottom); }
      chain.push({ el: describe(el), overflowX: s.overflowX, overflowY: s.overflowY, rect: fbox(r), paddingBox: fbox({ ...pad, width: pad.right - pad.left, height: pad.bottom - pad.top }), clientWidth: el.clientWidth, scrollWidth: el.scrollWidth, scrollLeft: el.scrollLeft });
    }
    const inside = (r) => r.left >= clip.left - 0.5 && r.right <= clip.right + 0.5 && r.top >= clip.top - 0.5 && r.bottom <= clip.bottom + 0.5;
    const visW = (r) => Math.max(0, Math.min(r.right, clip.right) - Math.max(r.left, clip.left));
    const visH = (r) => Math.max(0, Math.min(r.bottom, clip.bottom) - Math.max(r.top, clip.top));
    const textRect = (el) => { const rg = document.createRange(); rg.selectNodeContents(el); const r = rg.getBoundingClientRect(); return r.width > 0 ? r : el.getBoundingClientRect(); };
    const glyph = (el) => { const r = textRect(el); return { el: describe(el), text: (el.textContent || '').trim().slice(0, 40), text_box: fbox(r), visible: inside(r) }; };
    const button = (el) => { const r = el.getBoundingClientRect(); const w = visW(r); const h = visH(r); return { el: describe(el), text: (el.textContent || '').trim().slice(0, 20), box: fbox(r), visibleW: +w.toFixed(1), visibleH: +h.toFixed(1), visible: inside(r), ok44: w >= 43.5 && h >= 43.5 }; };
    const monthLabels = [...panel.querySelectorAll('.rdp-caption_label')].map(glyph);
    const weekdays = [...panel.querySelectorAll('.rdp-weekday')].map(glyph);
    const days = [...panel.querySelectorAll('.rdp-day_button')].map(button);
    const nav = [...panel.querySelectorAll('.rdp-button_previous, .rdp-button_next')].map(button);
    const clipped = [...monthLabels, ...weekdays, ...days, ...nav].filter((e) => !e.visible).map((e) => ({ el: e.el, text: e.text, at: e.text_box || e.box }));
    const under44 = [...days, ...nav].filter((e) => !e.ok44).map((e) => ({ el: e.el, text: e.text, visibleW: e.visibleW, visibleH: e.visibleH }));
    return {
      panel: box(panel.getBoundingClientRect()),
      panelScroll: { left: panel.scrollLeft, scrollWidth: panel.scrollWidth, clientWidth: panel.clientWidth },
      clipAncestors: chain,
      visibleArea: fbox({ ...clip, width: clip.right - clip.left, height: clip.bottom - clip.top }),
      monthLabels,
      weekdays,
      selected: [...panel.querySelectorAll('.rdp-selected .rdp-day_button')].map(button),
      dayButtons: days.length,
      dayButtonsUnder44: days.filter((e) => !e.ok44).length,
      days,
      navButtons: nav,
      clipped,
      under44,
      fits: clipped.length === 0 && under44.length === 0,
    };
  })();
  return {
    url: window.location.href,
    htmlLang: document.documentElement.lang,
    title: document.title,
    heading: heading ? (heading.getAttribute('aria-label') || heading.innerText || '').trim().slice(0, 160) : null,
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    scrollY: Math.round(window.scrollY),
    scrollHeight: document.documentElement.scrollHeight,
    viewport: { w: vw, h: vh, visualScale: window.visualViewport ? window.visualViewport.scale : null },
    devicePixelRatio: window.devicePixelRatio,
    coarsePointer: window.matchMedia('(pointer: coarse)').matches,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    fixed,
    ctas,
    prices,
    calendarBounds,
  };
}

/** Best-effort settle; outcomes are recorded on the state, never silently dropped. */
async function settle(page) {
  const result = { networkIdle: true, fontsAndFrames: true };
  await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => { result.networkIdle = false; });
  await page.evaluate(() => document.fonts.ready.then(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }))).catch((e) => { result.fontsAndFrames = msg(e); });
  return result;
}

/** Read-only pointer media snapshot (matchMedia is queried, never overridden). */
const pointerMedia = (page) => page.evaluate(() => ({
  coarse: window.matchMedia('(pointer: coarse)').matches,
  fine: window.matchMedia('(pointer: fine)').matches,
  hover: window.matchMedia('(hover: hover)').matches,
  maxTouchPoints: navigator.maxTouchPoints,
  vw: window.innerWidth,
  vh: window.innerHeight,
  dpr: window.devicePixelRatio,
})).catch((error) => ({ error: msg(error) }));

/** Why a snapshot does not match the cell's emulated primary pointer ('' = matches). */
function pointerMismatch(cell, snap) {
  if (!snap || snap.error) return `pointer media not read (${snap ? snap.error : 'missing'})`;
  const touch = cell.device.hasTouch;
  const off = [];
  if (snap.coarse !== touch) off.push(`coarse=${snap.coarse}`);
  if (snap.fine === touch) off.push(`fine=${snap.fine}`);
  return off.length ? `${off.join(' ')} on a ${touch ? 'touch' : 'desktop'} cell` : '';
}

/**
 * The one way the harness activates a control: touch cells tap (Playwright touchscreen), desktop
 * cells click. locator.click() sends mouse events even when the context has hasTouch. The first
 * activation in a cell records pointer media before and after it, to locate a coarse→fine flip.
 */
async function activate(ctx, locator) {
  const { page, cell } = ctx;
  const first = !cell.pointer.firstActivation;
  const before = first ? await pointerMedia(page) : null;
  if (cell.device.hasTouch) await locator.tap();
  else await locator.click();
  if (!first) return;
  const after = await pointerMedia(page);
  const state = cell.currentState;
  cell.pointer.firstActivation = { state, inputType: cell.device.hasTouch ? 'tap' : 'click', before, after };
  for (const [when, snap] of [['before', before], ['after', after]]) {
    const off = pointerMismatch(cell, snap);
    if (off) cell.unverified.push({ kind: 'pointer-media-unverified', state, detail: `${when} first activation: ${off}` });
  }
}

/** Ticks a checkbox. Desktop keeps locator.check(); touch taps it (only if unticked) and then verifies it is checked. */
async function tick(ctx, locator) {
  if (!ctx.cell.device.hasTouch) return locator.check();
  if (!(await locator.isChecked())) await activate(ctx, locator);
  if (!(await pollFor(() => locator.isChecked(), 3000))) throw new Error('checkbox not checked after tap');
}

/** 8-bit RGB/RGBA non-interlaced PNG (what Chromium's Page.captureScreenshot emits) -> RGBA rows. Anything else throws. */
function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('tile is not a PNG');
  let off = 8;
  let ihdr = null;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') ihdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!ihdr || ihdr.depth !== 8 || ![2, 6].includes(ihdr.color) || ihdr.interlace !== 0) throw new Error(`unsupported tile PNG ${JSON.stringify(ihdr)}`);
  const { w, h } = ihdr;
  const bpp = ihdr.color === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  if (raw.length !== h * (stride + 1)) throw new Error('tile PNG data length mismatch');
  const out = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i += 1) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let p;
      if (filter === 0) p = 0;
      else if (filter === 1) p = a;
      else if (filter === 2) p = b;
      else if (filter === 3) p = (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else throw new Error(`bad PNG filter ${filter}`);
      line[i] = (line[i] + p) & 255;
    }
    for (let x = 0; x < w; x += 1) {
      const o = (y * w + x) * 4;
      line.copy(out, o, x * bpp, x * bpp + 3);
      out[o + 3] = bpp === 4 ? line[x * bpp + 3] : 255;
    }
    prev = line;
  }
  return { w, h, rgba: out };
}

function encodePng(w, h, rgba) {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y += 1) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * Full-page PNG without Chromium's captureBeyondViewport. Playwright 1.62.1 fullPage sends
 * Page.captureScreenshot{clip: document, captureBeyondViewport: true} and nothing else; in pilot 4 that
 * call alone flipped the phone cells to pointer fine / hover / maxTouchPoints 256 (desktop: 0 -> 256),
 * before the pixels were taken, and it stayed that way. Here the window is scrolled across the document
 * and each viewport is a real Page.captureScreenshot{captureBeyondViewport: false} of the visible area
 * (the same CDP call the viewport shot makes), placed losslessly at its scroll offset in one PNG.
 * Viewport size, DPR, touch and mobile emulation are never touched. Limits: position:fixed/sticky
 * elements appear once per tile, and scroll-driven UI shows its state at each tile's scroll offset.
 * Scroll position and caret colour are restored and the CDP session detached; any error (including a
 * failed restore or detach) throws and nothing is written.
 */
async function stitchedFullPage(page, file) {
  const origin = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  const session = await page.context().newCDPSession(page);
  const problems = [];
  let result = null;
  let png = null;
  try {
    const m = await page.evaluate(() => {
      const b = document.body;
      const d = document.documentElement;
      const carets = [];
      document.querySelectorAll('input,textarea,[contenteditable]').forEach((el) => {
        carets.push([el, el.style.getPropertyValue('caret-color'), el.style.getPropertyPriority('caret-color')]);
        el.style.setProperty('caret-color', 'transparent', 'important');
      });
      Object.defineProperty(window, '__captureCarets', { value: carets, configurable: true });
      return {
        width: Math.max(b.scrollWidth, d.scrollWidth, b.offsetWidth, d.offsetWidth, b.clientWidth, d.clientWidth),
        height: Math.max(b.scrollHeight, d.scrollHeight, b.offsetHeight, d.offsetHeight, b.clientHeight, d.clientHeight),
        cw: d.clientWidth,
        ch: d.clientHeight,
        dpr: window.devicePixelRatio,
        scale: window.visualViewport ? window.visualViewport.scale : 1,
      };
    });
    if (m.scale !== 1) throw new Error(`visual viewport scale ${m.scale} (pinch zoom) not supported`);
    const W = Math.round(m.width * m.dpr);
    const H = Math.round(m.height * m.dpr);
    if (W * H * 4 > 512 * 1024 * 1024) throw new Error(`full page ${W}x${H}px too large`);
    const canvas = Buffer.alloc(W * H * 4);
    const offsets = (total, view) => {
      const list = [];
      for (let v = 0; v < total - view; v += view) list.push(v);
      list.push(Math.max(0, total - view));
      return list;
    };
    const coveredX = [];
    const coveredY = [];
    let tiles = 0;
    for (const ty of offsets(m.height, m.ch)) {
      for (const tx of offsets(m.width, m.cw)) {
        const at = await page.evaluate(([x, y]) => new Promise((resolve) => {
          window.scrollTo({ left: x, top: y, behavior: 'instant' });
          requestAnimationFrame(() => requestAnimationFrame(() => resolve({ x: window.scrollX, y: window.scrollY })));
        }), [tx, ty]);
        // A raw CDP clip rasterises at clip.scale device px per CSS px (the emulated DPR is not applied),
        // so ask for m.dpr explicitly: genuine 2x raster on phones, 1x on desktop, no resampling here.
        const shot = await session.send('Page.captureScreenshot', {
          format: 'png', captureBeyondViewport: false, clip: { x: at.x, y: at.y, width: m.cw, height: m.ch, scale: m.dpr },
        });
        const tile = decodePng(Buffer.from(shot.data, 'base64'));
        if (tile.w !== Math.round(m.cw * m.dpr) || tile.h !== Math.round(m.ch * m.dpr)) throw new Error(`tile ${tile.w}x${tile.h} != viewport ${m.cw}x${m.ch}@${m.dpr}`);
        const px = Math.round(at.x * m.dpr);
        const py = Math.round(at.y * m.dpr);
        const cols = Math.min(tile.w, W - px);
        for (let y = 0; y < tile.h && py + y < H; y += 1) {
          tile.rgba.copy(canvas, ((py + y) * W + px) * 4, y * tile.w * 4, (y * tile.w + cols) * 4);
        }
        coveredX.push([px, px + tile.w]);
        coveredY.push([py, py + tile.h]);
        tiles += 1;
      }
    }
    const covers = (spans, total) => {
      let end = 0;
      for (const [a, b] of spans.sort((p, q) => p[0] - q[0])) {
        if (a > end) return false;
        end = Math.max(end, b);
      }
      return end >= total;
    };
    if (!covers(coveredX, W) || !covers(coveredY, H)) throw new Error('scrolling did not reach every part of the document (tiles leave a gap)');
    const heightAfter = await page.evaluate(() => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight));
    result = { method: 'scroll-stitched viewport CDP captures (captureBeyondViewport false)', tiles, cssSize: [m.width, m.height], heightAfter, viewport: [m.cw, m.ch], dpr: m.dpr, rasterScale: m.dpr, tilePx: [Math.round(m.cw * m.dpr), Math.round(m.ch * m.dpr)] };
    png = encodePng(W, H, canvas);
  } catch (error) {
    problems.push(msg(error));
  }
  const restore = await page.evaluate((o) => new Promise((resolve) => {
    for (const [el, value, priority] of window.__captureCarets || []) el.style.setProperty('caret-color', value, priority);
    delete window.__captureCarets;
    window.scrollTo({ left: o.x, top: o.y, behavior: 'instant' });
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(Math.abs(window.scrollX - o.x) < 1 && Math.abs(window.scrollY - o.y) < 1)));
  }), origin).catch((e) => msg(e));
  if (restore !== true) problems.push(`scroll/caret restore failed: ${restore === false ? 'scroll position differs' : restore}`);
  await session.detach().catch((e) => problems.push(`CDP detach failed: ${msg(e)}`));
  if (problems.length) throw new Error(problems.join('; '));
  fs.writeFileSync(file, png);
  return result;
}

async function capture(run, page, cell, name, full) {
  const entry = { state: name, files: [] };
  entry.settle = await settle(page);
  try {
    entry.metrics = await page.evaluate(pageMetrics, { nextLabel: CHARTER_NEXT[cell.lang] });
  } catch (error) {
    entry.metricsError = msg(error);
    cell.failures.push({ kind: 'metrics-error', state: name, detail: entry.metricsError });
  }
  const cal = entry.metrics && entry.metrics.calendarBounds;
  if (cal && !cal.fits) {
    cell.failures.push({ kind: 'calendar-clipped', state: name, detail: JSON.stringify({ clipped: cal.clipped.slice(0, 8), under44: cal.under44.slice(0, 8), visibleArea: cal.visibleArea }).slice(0, 600) });
  }
  // Pointer media around each screenshot: shows whether a viewport or full-page shot changes it.
  entry.pointer = { beforeShot: await pointerMedia(page) };
  for (const kind of full ? ['viewport', 'full'] : ['viewport']) {
    const file = path.join(cell.dir, `${name}.${kind}.png`);
    try {
      if (kind === 'full') entry.fullPage = await stitchedFullPage(page, file);
      else await page.screenshot({ path: file, caret: 'hide', timeout: 30000 });
      entry.files.push(fileRecord(run, file));
    } catch (error) {
      cell.captureErrors += 1;
      cell.failures.push({ kind: 'screenshot-error', state: name, detail: msg(error) });
    }
    entry.pointer[kind === 'full' ? 'afterFull' : 'afterViewport'] = await pointerMedia(page);
  }
  const off = Object.entries(entry.pointer).map(([when, snap]) => {
    const m = pointerMismatch(cell, snap);
    return m ? `${when}: ${m}` : '';
  }).filter(Boolean);
  if (off.length) {
    entry.pointerUnverified = off.join('; ');
    cell.unverified.push({ kind: 'pointer-media-unverified', state: name, detail: entry.pointerUnverified });
  }
  return entry;
}

/**
 * One capture state. Sequential journeys halt after a failed state (later states = not-reached);
 * `independent` states navigate on their own. A failed state is still captured so the
 * user-visible error/loading screen is preserved. An action may return `{ unverified: reason }`:
 * the frame is kept but the state is `unverified`, never `captured`.
 */
async function step(ctx, name, action, options = {}) {
  const { run, page, cell } = ctx;
  if (cell.halted && !options.independent) {
    cell.states.push({ state: name, status: 'not-reached', reason: cell.halted });
    return false;
  }
  cell.currentState = name;
  let error = null;
  let soft = null;
  try {
    const result = action ? await action() : null;
    if (result && result.unverified) soft = result.unverified;
  } catch (e) {
    if (e instanceof Unverified) {
      cell.states.push({ state: name, status: 'unverified', reason: e.message });
      return false;
    }
    error = msg(e);
  }
  const entry = await capture(run, page, cell, name, options.full === true);
  // A pointer media flip keeps the frame but never lets the state count as captured.
  entry.status = error ? 'error' : soft || entry.pointerUnverified ? 'unverified' : 'captured';
  if (soft || entry.pointerUnverified) entry.reason = [soft, entry.pointerUnverified && `pointer media: ${entry.pointerUnverified}`].filter(Boolean).join('; ');
  if (options.note) entry.note = options.note;
  if (options.record) {
    try {
      Object.assign(entry, await options.record());
    } catch (e) {
      entry.recordError = msg(e);
      cell.failures.push({ kind: 'record-error', state: name, detail: entry.recordError });
    }
  }
  if (error) {
    entry.error = error;
    cell.failures.push({ kind: 'state-error', state: name, detail: error });
    if (!options.independent) cell.halted = `${name}: ${error}`;
  }
  cell.states.push(entry);
  if (options.after) {
    try {
      await options.after();
    } catch (e) {
      cell.failures.push({ kind: 'after-error', state: name, detail: msg(e) });
      if (!options.independent) cell.halted = `${name} (after): ${msg(e)}`;
    }
  }
  return !error;
}

function unverified(cell, name, reason) {
  cell.states.push({ state: name, status: 'unverified', reason });
}

async function open(ctx, target, ready) {
  const { run, page, cell } = ctx;
  await page.goto(new URL(target, run.base).href, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => {
    const root = document.getElementById('root');
    return !!root && root.childElementCount > 0;
  }, null, { timeout: 30000 });
  const kind = (await page.evaluate(() => !!document.querySelector('script[src^="/@vite/client"]'))) ? 'vite-dev' : 'built-preview';
  if (!run.meta.serverKind) run.meta.serverKind = kind;
  if (kind !== run.meta.serverKind) cell.failures.push({ kind: 'server-kind-changed', detail: `${run.meta.serverKind} -> ${kind}` });
  cell.serverKind = kind;
  if (ready) await ready();
  // Timeout here is not swallowed: the exact check below records the mismatch as a failure.
  await page.waitForFunction((lang) => document.documentElement.lang === lang, cell.lang, { timeout: 5000 }).catch(() => {});
  const htmlLang = await page.evaluate(() => document.documentElement.lang);
  if (htmlLang !== cell.lang) cell.failures.push({ kind: 'lang-mismatch', detail: `${target}: html lang="${htmlLang}"` });
}

const visibleWait = (locator, timeout = 20000) => locator.first().waitFor({ state: 'visible', timeout });
const scrollTo = (page, selector, block = 'start') => page.evaluate(([sel, b]) => {
  const el = document.querySelector(sel);
  if (!el) throw new Error(`missing ${sel}`);
  el.scrollIntoView({ block: b, behavior: 'instant' });
}, [selector, block]);

/** Exactly one visible element, or an error naming the count (no silent `.first()` guess). */
async function only(locator, label) {
  const n = await locator.count();
  if (n !== 1) throw new Error(`expected exactly one visible ${label}, found ${n}`);
  return locator.first();
}

/**
 * Runs in the page: scrolls the window so the top of `selector` sits just under the visible
 * fixed/sticky top bars (measured from their DOM rects, re-measured after each scroll because a
 * sticky bar can unstick). ok only if the target top is below the bars and its top section wins the
 * centre hit test (not covered by a top bar or the phone bottom CTA). Only the two charter funnel
 * sections below may be framed; any other selector is refused without scrolling.
 */
function frameFunnelTop(selector) {
  const allowed = ['.charter-funnel-receipt', '.charter-funnel-payment', '.charter-funnel-receipt-rows', '.charter-funnel-summary-panel'];
  if (!allowed.includes(selector)) return { ok: false, reason: `selector not allowed: ${String(selector).slice(0, 80)}` };
  const receipt = document.querySelector(selector);
  if (!receipt) return { ok: false, reason: `no ${selector}` };
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const describe = (el) => `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''}`;
  const topBars = () => [...document.body.querySelectorAll('*')].filter((el) => {
    const s = getComputedStyle(el);
    if ((s.position !== 'fixed' && s.position !== 'sticky') || s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
    if (el.contains(receipt) || receipt.contains(el)) return false;
    const r = el.getBoundingClientRect();
    return r.height > 0 && r.top <= 1 && r.bottom > 0 && r.bottom <= vh / 2 && r.width >= vw / 2;
  });
  let headerBottom = 0;
  let bars = [];
  for (let pass = 0; pass < 3; pass += 1) {
    bars = topBars();
    headerBottom = bars.reduce((max, el) => Math.max(max, el.getBoundingClientRect().bottom), 0);
    const delta = receipt.getBoundingClientRect().top - (headerBottom + 8);
    if (Math.abs(delta) < 1) break;
    window.scrollTo({ top: window.scrollY + delta, behavior: 'instant' });
  }
  const r = receipt.getBoundingClientRect();
  const px = r.left + r.width / 2;
  const py = Math.min(r.top + 24, r.top + r.height / 2);
  const top = py >= 0 && py <= vh ? document.elementFromPoint(px, py) : null;
  const hit = !!top && (top === receipt || receipt.contains(top));
  const result = {
    target: selector,
    headerBottom: Math.round(headerBottom),
    topBars: bars.slice(0, 4).map(describe),
    targetTop: Math.round(r.top),
    scrollY: Math.round(window.scrollY),
    topHit: hit,
    occludedBy: hit || !top ? null : describe(top),
  };
  if (r.top < headerBottom - 1) return { ok: false, reason: `${selector} top ${Math.round(r.top)} is under the top bar (bottom ${Math.round(headerBottom)})`, ...result };
  if (!hit) return { ok: false, reason: `${selector} top section not hit at (${Math.round(px)},${Math.round(py)}): ${result.occludedBy || 'outside viewport'}`, ...result };
  return { ok: true, ...result };
}

/**
 * Runs in the page, read-only (no scrolling, no style writes): measures what the charter funnel
 * actually renders — computed styles, text, clipping and viewport visibility — for the
 * breadcrumb ('origin'), quote detail rows ('quote') and payment summary + PayPal book button
 * ('payment'). `expectations` lists measured misses; the caller decides how to mark the state.
 */
function measureCharterPresentation(kind) {
  const vh = window.innerHeight;
  const rendered = (el) => !!el && el.getClientRects().length > 0;
  const box = (el) => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) }; };
  const inViewport = (el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= vh && r.height > 0; };
  const clipped = (el) => el.scrollWidth > el.clientWidth + 1;
  const rgba = (c) => { const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const contrast = (fg, bg) => {
    const f = rgba(fg); const b = rgba(bg);
    if (!f || !b) return null;
    const mixed = [0, 1, 2].map((i) => f[i] * f[3] + b[i] * (1 - f[3]));
    const [hi, lo] = [lum(mixed), lum(b)].sort((x, y) => y - x);
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
  };
  const expectations = [];
  if (kind === 'origin') {
    const back = document.querySelector('.charter-funnel-back');
    const badge = document.querySelector('.charter-funnel-badge');
    const out = { kind, scrollY: Math.round(window.scrollY), back: null, badge: null, gap: null };
    if (rendered(back)) out.back = { text: back.textContent.trim(), ...box(back), inViewport: inViewport(back) };
    if (rendered(badge)) out.badge = { text: badge.textContent.trim(), ...box(badge), inViewport: inViewport(badge) };
    if (out.back && out.badge) out.gap = out.badge.top - out.back.bottom;
    if (!out.back?.inViewport) expectations.push('breadcrumb (.charter-funnel-back) not fully in the viewport');
    return { ...out, expectations };
  }
  if (kind === 'quote') {
    const summaryRows = [...document.querySelectorAll('.charter-funnel-summary-row')].filter(rendered).map((row) => {
      const value = row.querySelector('p:last-child');
      return { label: (row.querySelector('p')?.textContent || '').trim(), value: (value?.textContent || '').trim(), clipped: value ? clipped(value) : null, whiteSpace: value ? getComputedStyle(value).whiteSpace : null, ...box(row), inViewport: inViewport(row) };
    });
    const receiptRows = [...document.querySelectorAll('.charter-funnel-receipt-row')].filter(rendered).map((row) => {
      const [label, value] = row.querySelectorAll('span');
      return { label: (label?.textContent || '').trim(), value: (value?.textContent || '').trim(), clipped: value ? clipped(value) : null, ...box(row), inViewport: inViewport(row) };
    });
    for (const r of summaryRows) if (r.clipped) expectations.push(`summary row "${r.label}" value clipped`);
    if (summaryRows.length && !summaryRows.some((r) => r.inViewport)) expectations.push('no quote summary row fully in the viewport');
    if (!summaryRows.length && receiptRows.length && !receiptRows.some((r) => r.inViewport)) expectations.push('no quote receipt row fully in the viewport');
    return { kind, scrollY: Math.round(window.scrollY), summaryRows, receiptRows, expectations };
  }
  const summary = [...document.querySelectorAll('.charter-funnel-payment .charter-funnel-payment-summary .charter-funnel-row')].filter(rendered).map((row) => {
    const value = row.querySelector('.charter-funnel-row-value');
    const s = value ? getComputedStyle(value) : null;
    return { label: (row.querySelector('.charter-funnel-row-label')?.textContent || '').trim(), value: (value?.textContent || '').trim(), clipped: value ? clipped(value) : null, whiteSpace: s?.whiteSpace ?? null, textOverflow: s?.textOverflow ?? null, overflow: s?.overflowX ?? null, height: box(row).height };
  });
  for (const r of summary) if (r.clipped || r.textOverflow === 'ellipsis') expectations.push(`payment summary "${r.label}" value clipped/ellipsis`);
  const buttons = [...document.querySelectorAll('.charter-funnel-payment .cocotrip-mobile-paypal > button')].filter((b) => rendered(b) && b.querySelector(':scope > .flex-col'));
  const out = { kind, summary, bookButtonCount: buttons.length, button: null };
  if (buttons.length === 1) {
    const b = buttons[0];
    const bs = getComputedStyle(b);
    const bg = bs.backgroundColor;
    const col = b.querySelector(':scope > .flex-col');
    const vat = col.querySelector(':scope > span:last-child');
    const strike = col.querySelector('.line-through');
    const amount = [...col.querySelectorAll(':scope > div > span')].find((s) => !s.classList.contains('line-through')) || null;
    const read = (el) => { if (!el) return null; const s = getComputedStyle(el); return { text: el.textContent.trim(), color: s.color, fontSize: s.fontSize, textDecoration: s.textDecorationLine, contrast: contrast(s.color, bg) }; };
    out.button = { background: bg, color: bs.color, disabled: b.disabled, opacity: bs.opacity, amount: read(amount), strike: read(strike), vat: read(vat), krw: read(col.querySelector(':scope > div > span:last-child')) };
    if (out.button.vat?.fontSize !== '13px') expectations.push(`VAT caption font-size ${out.button.vat?.fontSize}, expected 13px`);
    if (!(out.button.vat?.contrast >= 4.5)) expectations.push(`VAT caption contrast ${out.button.vat?.contrast} on ${bg}, expected >= 4.5`);
    if (!(out.button.amount?.contrast >= 4.5)) expectations.push(`amount contrast ${out.button.amount?.contrast} on ${bg}, expected >= 4.5`);
    if (!(out.button.krw?.contrast >= 4.5)) expectations.push(`KRW secondary contrast ${out.button.krw?.contrast} on ${bg}, expected >= 4.5`);
    if (strike && out.button.strike?.textDecoration !== 'line-through') expectations.push('promo original price lost its line-through');
  } else {
    expectations.push(`expected exactly one PayPal book button in the payment panel, found ${buttons.length}`);
  }
  return { ...out, expectations };
}

// ── Shared journey pieces (screenshots and videos use the same real UI steps) ───────────────

function plannerParts(ctx) {
  const { page, cell } = ctx;
  const stage = (name) => page.locator(`.wizard-stage--${name}`);
  const desktop = cell.width >= 768; // WizardStep0Destination phone query: (max-width: 767.98px)
  return {
    stage,
    desktop,
    next: () => page.locator('.wizard-stage .ec-btn.ec-btn-primary').last(),
    intro: page.getByRole('dialog').filter({ has: page.locator('#ai-intro-title') }),
    openPlanner: () => open(ctx, '/planner', () => visibleWait(page.locator('.wizard-res-row'))),
    /** First Quick Start preset ("3 days Seoul"). Phones: inside the closed <details> after the city grid. */
    async pickPreset() {
      let presets = stage('dest').locator('.ec-option-sm:visible');
      if (!desktop) {
        const details = stage('dest').locator('details.wizard-quick-start');
        if ((await details.count()) !== 1) throw new Error('phone Quick Start <details> not rendered');
        if (!(await details.evaluate((el) => el.open))) await activate(ctx, details.locator('summary.wizard-quick-start__summary'));
        presets = details.locator('.ec-option-sm:visible');
      }
      if ((await presets.count()) < 1) throw new Error('no visible Quick Start preset');
      await activate(ctx, presets.first());
      const pressedCity = stage('dest').locator('.wizard-city-grid .ec-option[aria-pressed="true"]');
      await waitUntil(async () => (await pressedCity.count()) === 1, 5000, 'exactly one pressed city after the preset');
      return {
        selectedCity: ((await pressedCity.locator('.wizard-city-name').textContent()) || '').trim(),
        pressedActivities: await stage('dest').locator('.wizard-pick-grid .ec-option[aria-pressed="true"]').count(),
      };
    },
  };
}

function charterParts(ctx) {
  const { page, cell } = ctx;
  const label = CHARTER_NEXT[cell.lang];
  // In-flow button (>=640px) and the fixed phone bar (<768px) both live inside .charter-funnel-wizard.
  const nextButtons = () => page.locator('.charter-funnel-wizard button:visible').filter({ hasText: exactText(label) });
  const payButtons = () => page.locator('.charter-funnel-wizard button:visible').filter({ hasText: exactText(CHARTER_PAY[cell.lang]) });
  return {
    label,
    nextButtons,
    payButtons,
    nextButton: () => only(nextButtons(), `charter "${label}" button`),
    nextState: async () => {
      const count = await nextButtons().count();
      return { nextLabel: label, nextCount: count, nextDisabled: count === 1 ? await nextButtons().first().isDisabled() : null };
    },
    payState: async () => {
      const count = await payButtons().count();
      return { payLabel: CHARTER_PAY[cell.lang], payCount: count, payDisabled: count === 1 ? await payButtons().first().isDisabled() : null };
    },
    vehicleReady: () => visibleWait(page.locator('.charter-funnel-wizard .charter-funnel-option-sub').filter({ hasText: exactText(STARIA9_RANGE[cell.lang]) })),
  };
}

/**
 * TourBookingDialog calendar (react-day-picker v9: `td[data-day=YYYY-MM-DD]`, data-disabled/-outside/-hidden).
 * Clicks the first day the app itself leaves enabled on or after `minIso` (cutoff and blocked
 * days are disabled by the component), moving at most two months forward.
 */
async function pickTourDate(ctx, popover, minIso) {
  for (let month = 0; month < 3; month += 1) {
    const iso = await popover.evaluate((root, min) => [...root.querySelectorAll('td[data-day]')]
      .filter((td) => !td.hasAttribute('data-disabled') && !td.hasAttribute('data-outside') && !td.hasAttribute('data-hidden'))
      .map((td) => td.getAttribute('data-day'))
      .filter((day) => day >= min)
      .sort()[0] || null, minIso);
    if (iso) {
      await activate(ctx, await only(popover.locator(`td[data-day="${iso}"] button`), `calendar day ${iso}`));
      return { iso, minIso, todayKst: kstIso(0), monthsAdvanced: month };
    }
    await activate(ctx, await only(popover.locator('button.rdp-button_next'), 'calendar next-month button'));
  }
  throw new Error(`no enabled calendar day on or after ${minIso} within 3 months`);
}

// ── Page groups ─────────────────────────────────────────────────────────────────────────────

const FLOWS = {
  async home(ctx) {
    const { page } = ctx;
    const ready = async () => {
      await visibleWait(page.locator('.home-dope'));
      await visibleWait(page.getByRole('heading', { level: 1 }));
    };
    await step(ctx, 'home-top', () => open(ctx, '/', ready), { full: true });
    await step(ctx, 'home-sample-day', () => scrollTo(page, '#sample-day'));
    await step(ctx, 'home-menu-open', async () => {
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      const toggle = page.locator('header.home-dope-chrome button[aria-expanded]:not([aria-haspopup])').first();
      if (!(await toggle.count()) || !(await toggle.isVisible())) throw new Unverified('menu toggle is not rendered at this width');
      await activate(ctx, toggle);
      await visibleWait(page.locator('[role="dialog"].home-dope-menu'), 5000);
    }, { after: () => page.keyboard.press('Escape') });
    await step(ctx, 'home-chat-open', async () => {
      const trigger = page.locator('button.home-dope-chat-trigger');
      await activate(ctx, trigger);
      await visibleWait(page.locator('#chat-widget-panel'), 5000);
    }, { note: 'chat panel opened only; nothing typed or sent', after: () => activate(ctx, page.locator('button.home-dope-chat-trigger')) });
  },

  async planner(ctx) {
    const { page, cell } = ctx;
    const { stage, desktop, next, intro, openPlanner, pickPreset } = plannerParts(ctx);
    // Same panel framing as planner-expansion-local.spec.ts: question panel just under the fixed header.
    const framePanel = () => page.evaluate(() => {
      const header = document.querySelector('header');
      const offset = (header ? header.getBoundingClientRect().height : 64) + 8;
      const panel = document.querySelector('.planner-question');
      if (panel) window.scrollTo({ top: window.scrollY + panel.getBoundingClientRect().top - offset, behavior: 'instant' });
    });

    if (desktop) {
      // Independent: a missing intro is recorded, the journey continues from step 1.
      await step(ctx, 'planner-intro', async () => {
        await openPlanner();
        await intro.waitFor({ state: 'visible', timeout: 8000 });
      }, { independent: true });
    }
    await step(ctx, 'planner-reservation', async () => {
      if (!desktop) {
        await openPlanner();
        await sleep(600);
        if (await intro.count()) throw new Error('intro dialog opened below 768px');
        return;
      }
      await page.keyboard.press('Escape');
      if (await intro.isVisible()) await activate(ctx, intro.getByRole('button', { name: 'Close', exact: true }).first());
      await intro.waitFor({ state: 'hidden', timeout: 5000 });
    }, { full: true });
    await step(ctx, 'planner-destination-missing', async () => {
      await activate(ctx, page.locator('.wizard-res-row').first());
      await activate(ctx, page.locator('.wizard-res-cta'));
      await visibleWait(stage('dest'));
      await activate(ctx, next());
      await visibleWait(stage('dest').locator('.ec-error-note'), 5000);
      await framePanel();
    });
    let preset = null;
    await step(ctx, 'planner-destination-selected', async () => {
      preset = await pickPreset();
      await framePanel();
    }, { record: async () => ({ preset, destinationPrice: await page.locator('.wizard-dest-ticket__price').allInnerTexts() }) });
    await step(ctx, 'planner-food', async () => {
      await activate(ctx, next());
      await visibleWait(stage('food'));
      const style = stage('food').locator('.grid > .ec-option').first();
      await activate(ctx, style);
      await waitUntil(async () => (await style.getAttribute('aria-pressed')) === 'true', 5000, 'food style pressed');
      await framePanel();
    });
    await step(ctx, 'planner-details-missing', async () => {
      await activate(ctx, next());
      await visibleWait(stage('details'));
      await activate(ctx, next());
      await visibleWait(stage('details').locator('.ec-error-note'), 5000);
      await framePanel();
    });
    await step(ctx, 'planner-details', async () => {
      const airport = stage('details').locator('[aria-haspopup="listbox"]').first();
      const before = ((await airport.textContent()) || '').trim();
      await activate(ctx, airport);
      await activate(ctx, page.locator('[role="option"]:visible').first());
      await waitUntil(async () => ((await airport.textContent()) || '').trim() !== before, 5000, 'airport selection');
      await framePanel();
    });
    await step(ctx, 'planner-review', async () => {
      await activate(ctx, next());
      await visibleWait(stage('review'));
      await framePanel();
    }, { full: true, record: async () => ({ reviewCtaEnabled: await stage('review').locator('.wizard-review-cta .ec-btn-primary').isEnabled() }) });

    const copy = QUICK_COPY[cell.lang];
    const fixtureId = `ai-planner-quick:synthetic-${cell.lang}`;
    await step(ctx, 'planner-preview', async () => {
      cell.allowQuick = true;
      try {
        await activate(ctx, stage('review').locator('.wizard-review-cta .ec-btn-primary'));
        await visibleWait(page.getByTestId('quick-preview-card'), 20000);
        let last = -1;
        await waitUntil(async () => {
          const y = await page.evaluate(() => window.scrollY);
          const still = y === last;
          last = y;
          return still;
        }, 6000, 'preview auto-scroll to settle');
      } finally {
        cell.allowQuick = false;
      }
      if (cell.fixtureHits[fixtureId] !== 1) throw new Error(`expected exactly one ${fixtureId} request`);
      const card = page.getByTestId('quick-preview-card');
      const rows = await card.locator('.ec-timeline-row').count();
      if (rows !== 3) throw new Error(`preview card shows ${rows} rows, expected 3`);
      if (!((await card.innerText()) || '').includes(copy.spots[1])) throw new Error('preview card does not show the synthetic second stop');
    }, {
      full: true,
      note: `free quick preview answered by the local synthetic ${cell.lang} fixture (same shape as planner-preview-night-local.spec.ts); no generation, purchase or login`,
      record: async () => ({ quickRequest: cell.quickRequest }),
    });
  },

  async result(ctx) {
    const { page, cell } = ctx;
    const copy = PLAN_COPY[cell.lang];
    await step(ctx, 'result-intro', () => open(ctx, `/my-plans/offline-synthetic-normal-${cell.lang}`,
      () => visibleWait(page.getByTestId('plan-document-ready'))), { full: true, note: 'synthetic plan via /api/get-plan fixture' });
    await step(ctx, 'result-timeline', async () => {
      const dayTabs = page.getByTestId('section-tabs-scroll').getByRole('tab').filter({ hasText: /Day\s*\d|\d+\s*일|\d+\s*日|第\s*\d+\s*天/ });
      await activate(ctx, dayTabs.first());
      const firstStop = page.getByRole('button', { name: new RegExp(escapeRe(copy.stop)) }).first();
      await activate(ctx, firstStop);
      await waitUntil(async () => (await firstStop.getAttribute('aria-expanded')) === 'true', 5000, 'first stop expanded');
    });
    await step(ctx, 'result-map', async () => {
      const map = page.getByTestId('day-route-map').first();
      await map.scrollIntoViewIfNeeded();
      await visibleWait(map, 8000);
      const tiles = await pollFor(async () => (await map.locator('.leaflet-tile-loaded').count()) > 0, 8000);
      if (!tiles) return { unverified: 'no synthetic map tile reported loaded within 8s; frame kept, map not shown working' };
      return null;
    }, {
      note: 'SIMULATED map: tiles are local flat synthetic tiles; the live basemap is not verified',
      record: async () => ({ syntheticTileResponses: cell.fixtureHits['synthetic-map-tile'] || 0 }),
    });
    // PlanDetailPage/index.tsx:617 renders RecommendedRestaurants from itinerary.recommended_restaurants (fixture above).
    const recCards = page.locator('article.plan-night-rec-card');
    await step(ctx, 'result-restaurants', async () => {
      const card = recCards.filter({ hasText: 'OFFLINE TEST Restaurant A' }).or(recCards.filter({ hasText: '오프라인 테스트 식당 A' })).first();
      await card.scrollIntoViewIfNeeded();
      await visibleWait(card, 5000);
      const box = await card.boundingBox();
      const vp = page.viewportSize();
      if (!box || box.y < 0 || box.y + box.height > vp.height) throw new Error(`restaurant card not inside the viewport: ${JSON.stringify(box)}`);
    }, {
      note: 'synthetic OFFLINE TEST restaurants (general bucket only, no dietary buckets) via /api/get-plan fixture',
      record: async () => {
        const section = recCards.first().locator('xpath=ancestor::section[1]');
        return {
          restaurantCardCount: await recCards.count(),
          restaurantCardTexts: (await recCards.allInnerTexts()).map((s) => s.replace(/\s+/g, ' ').trim().slice(0, 200)),
          restaurantSectionHeadings: await section.locator('h2, h3').allInnerTexts(),
          dietaryWarning: /halal|vegan|할랄|비건|ハラール|ヴィーガン|清真|素食/i.test(await section.innerText()) ? 'dietary text present' : 'none rendered (general bucket only)',
        };
      },
    });
    // PlanDetailPage/index.tsx:434 renders components/ErrorState.tsx (data-testid="plan-error-state").
    await step(ctx, 'result-error', () => open(ctx, `/my-plans/offline-synthetic-error-${cell.lang}`,
      () => visibleWait(page.getByTestId('plan-error-state'))), { independent: true, note: 'synthetic plan with status=error' });
  },

  async tours(ctx) {
    const { page, cell } = ctx;
    await step(ctx, 'tours-list', () => open(ctx, '/tours', () => visibleWait(page.getByTestId('tours-grid'))),
      { full: true, independent: true, note: 'Firestore blocked; catalogue is the static fallback' });
    const detailReady = await step(ctx, 'tour-detail', () => open(ctx, `/tours/${TOUR_SLUG}?localTourState=ready`,
      () => visibleWait(page.getByTestId('tour-detail-ready'))),
    { full: true, independent: true, note: 'localhost-only ready fixture (src/hooks/useTour.ts) over the static tour' });
    // Everything below runs on this detail page, in order; a missing page stops the journey.
    if (!detailReady) cell.halted = 'tour-detail: page not ready';

    const refund = page.locator('[role="dialog"].cocotrip-mobile-refund-modal');
    await step(ctx, 'tour-refund-policy', async () => {
      await activate(ctx, await only(page.locator('button.tour-detail-booking-refund:visible'), 'refund policy trigger'));
      await visibleWait(refund, 5000);
      if ((await refund.locator('tbody tr').count()) < 1) throw new Error('refund policy table has no rows');
    }, {
      note: 'existing RefundPolicyModal, read only; closed with its own Close button',
      record: async () => ({ refundRows: await refund.locator('tbody tr').allInnerTexts() }),
      after: async () => {
        await activate(ctx, await only(refund.locator('[data-slot="dialog-close"]'), 'refund modal Close button'));
        await refund.waitFor({ state: 'hidden', timeout: 5000 });
      },
    });

    // TourBookingDialog: Step 1 options → Step 2 contact. Nothing is typed, ticked or paid.
    const dialog = page.locator('[role="dialog"].cocotrip-mobile-booking-dialog');
    const header = dialog.locator('[data-slot="dialog-header"]');
    const footer = dialog.locator('[data-slot="dialog-footer"]');
    const popover = page.locator('.cocotrip-mobile-booking-popover');
    const tourNext = () => footer.locator('button:visible').filter({ hasText: exactText(TOUR_NEXT[cell.lang]) });
    const dateTrigger = () => dialog.locator('button[aria-haspopup="dialog"]:visible');
    const nextInfo = async () => {
      const count = await tourNext().count();
      return { tourNextLabel: TOUR_NEXT[cell.lang], tourNextCount: count, tourNextDisabled: count === 1 ? await tourNext().first().isDisabled() : null };
    };
    const expectNext = async (disabled, when) => {
      const n = await nextInfo();
      if (n.tourNextCount !== 1 || n.tourNextDisabled !== disabled) {
        throw new Error(`${when}: expected exactly one ${disabled ? 'disabled' : 'enabled'} "${n.tourNextLabel}", found count=${n.tourNextCount} disabled=${n.tourNextDisabled}`);
      }
    };
    await step(ctx, 'tour-booking-step1', async () => {
      await activate(ctx, await only(page.locator('[data-testid="tour-detail-book-cta"]:visible'), 'tour booking CTA'));
      await visibleWait(dialog, 5000);
      await expectNext(true, 'Step 1 before a date');
    }, { record: nextInfo, note: 'real booking CTA → dialog Step 1 as opened (no date yet)' });
    let picked = null;
    await step(ctx, 'tour-booking-calendar', async () => {
      await activate(ctx, await only(dateTrigger(), 'tour date trigger'));
      await visibleWait(popover, 5000);
      picked = await pickTourDate(ctx, popover, kstIso(TOUR_DATE_MIN_DAYS));
    }, { record: async () => ({ picked }), note: `first day the calendar leaves enabled at least ${TOUR_DATE_MIN_DAYS} days ahead (KST)` });
    await step(ctx, 'tour-booking-step1-date', async () => {
      await page.keyboard.press('Escape');
      await popover.waitFor({ state: 'hidden', timeout: 5000 });
      if (!(await dialog.isVisible())) throw new Error('Escape closed the booking dialog, not only the calendar');
      const shown = ((await (await only(dateTrigger(), 'tour date trigger')).innerText()) || '').trim();
      if (shown !== picked.iso) throw new Error(`date trigger shows "${shown}", expected ${picked.iso}`);
      await expectNext(false, 'Step 1 after the date');
    }, { record: async () => ({ picked, ...(await nextInfo()) }), note: 'default pax kept; no add-on toggled' });
    await step(ctx, 'tour-booking-step2-blank', async () => {
      await activate(ctx, await only(tourNext(), `"${TOUR_NEXT[cell.lang]}" button`));
      await visibleWait(header.getByText(TOUR_STEP2[cell.lang], { exact: true }), 5000);
      const form = dialog.locator('.cocotrip-mobile-booking-form');
      await visibleWait(form, 5000);
      const blank = await form.evaluate((root) => ({
        filled: [...root.querySelectorAll('input:not([type="checkbox"]):not([type="hidden"]), textarea')]
          .filter((el) => el.value !== '').map((el) => el.getAttribute('placeholder') || el.type),
        checked: [...root.querySelectorAll('input[type="checkbox"]')].filter((el) => el.checked).length,
      }));
      if (blank.filled.length) throw new Error(`Step 2 is not blank: ${blank.filled.join(', ')}`);
      if (blank.checked) throw new Error(`Step 2 has ${blank.checked} ticked checkbox(es)`);
      const notice = await only(footer.locator('button:visible').filter({ hasText: exactText(TOUR_MISSING[cell.lang]) }), 'missing-fields payment notice');
      if (!(await notice.isDisabled())) throw new Error('missing-fields payment notice is not disabled');
    }, {
      note: 'Step 2 left blank: no contact typed, no address search, no terms ticked; payment shown only as the disabled notice. Dialog closed with Escape',
      record: async () => ({ footerText: ((await footer.innerText()) || '').slice(0, 600) }),
      after: async () => {
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'hidden', timeout: 5000 });
      },
    });
  },

  async charter(ctx) {
    const { page, cell } = ctx;
    const { label, nextButton, nextState, payButtons, payState, vehicleReady } = charterParts(ctx);
    const advance = async () => {
      const button = await nextButton();
      if (await button.isDisabled()) throw new Error('Next is disabled');
      await activate(ctx, button);
    };
    await step(ctx, 'charter-origin', () => open(ctx, '/charter', () => visibleWait(page.locator('[data-origin-code="ICN"]'))), {
      full: true,
      // Read-only breadcrumb/badge measurement at the unscrolled top frame (recorded, not asserted).
      record: async () => ({ ...(await nextState()), presentation: await page.evaluate(measureCharterPresentation, 'origin') }),
    });
    await step(ctx, 'charter-origin-selected', () => activate(ctx, page.locator('[data-origin-code="ICN"]')), { record: nextState });
    await step(ctx, 'charter-service', async () => {
      await advance();
      await visibleWait(page.locator('[data-service="airport_transfer"]'));
    }, { record: nextState });
    await step(ctx, 'charter-service-selected', () => activate(ctx, page.locator('[data-service="airport_transfer"]')), { record: nextState });
    await step(ctx, 'charter-destination', async () => {
      await advance();
      await visibleWait(page.locator('[data-testid="charter-destination-card"]'));
    }, { full: true, record: nextState });
    await step(ctx, 'charter-destination-selected', () => activate(ctx, page.locator('[data-testid="charter-destination-card"]').first()), { record: nextState });
    await step(ctx, 'charter-vehicle', async () => {
      await advance();
      await vehicleReady();
    }, { full: true, record: nextState });
    await step(ctx, 'charter-schedule', async () => {
      await advance();
      await visibleWait(page.locator('input[type="date"]'));
      const s = await nextState();
      if (s.nextCount !== 1) throw new Error(`blank schedule: expected exactly one "${label}" button, found ${s.nextCount}`);
      if (s.nextDisabled !== true) throw new Error(`blank schedule: "${label}" is not disabled`);
    }, { full: true, record: nextState, note: 'blank Step 5 as reached: nothing typed; Next asserted exactly one and disabled' });

    // Step 5 → 6 with clearly synthetic values only (SYNTHETIC_STEP5). Each field below is one that
    // CharterWizard canAdvance case 5 requires for ICN airport_transfer; pickup time keeps the 09:00 default.
    const synthetic = { ...SYNTHETIC_STEP5, date: kstIso(SYNTHETIC_STEP5.daysAhead) };
    const body = page.locator('.charter-funnel-step-body');
    const agreeRows = body.locator('.customer-booking-agree-row input[type="checkbox"]');
    const fillOne = async (locator, what, value) => (await only(locator, what)).fill(value);
    await step(ctx, 'charter-schedule-filled', async () => {
      await fillOne(body.locator('input[type="date"]:visible'), 'schedule date input', synthetic.date);
      await fillOne(body.getByPlaceholder('HONG', { exact: true }), 'last name input', synthetic.lastName);
      await fillOne(body.getByPlaceholder('GILDONG', { exact: true }), 'first name input', synthetic.firstName);
      await fillOne(body.locator('.cocotrip-mobile-booking-form input[inputmode="tel"]'), 'phone number input', synthetic.nationalNumber);
      await fillOne(body.getByPlaceholder(FLIGHT_PH[cell.lang], { exact: true }), 'flight number input', synthetic.flightNo);
      await activate(ctx, await only(body.locator('button:visible').filter({ hasText: exactText('T1') }), 'terminal T1 button'));
      // One required-consent box: the wizard's single termsAgreed. Marketing (4th row) stays unticked.
      if ((await agreeRows.count()) !== 4) throw new Error(`expected 4 consent rows, found ${await agreeRows.count()}`);
      await tick(ctx, agreeRows.first());
      const ticks = await agreeRows.evaluateAll((els) => els.map((el) => el.checked));
      if (ticks.join() !== 'true,true,true,false') throw new Error(`consent rows after one required tick: ${ticks.join()}`);
      const s = await nextState();
      if (s.nextCount !== 1 || s.nextDisabled !== false) throw new Error(`filled schedule: expected exactly one enabled "${label}", found count=${s.nextCount} disabled=${s.nextDisabled}`);
    }, {
      full: true,
      note: 'SYNTHETIC test values, not a customer: typed locally, no address search, no flight lookup, no login, nothing submitted or consented for real',
      record: async () => ({ ...(await nextState()), synthetic, consentRows: await agreeRows.evaluateAll((els) => els.map((el) => el.checked)) }),
    });
    let framing = null;
    await step(ctx, 'charter-quote', async () => {
      const since = cell.failures.length;
      await advance();
      await visibleWait(page.locator('.charter-funnel-receipt'));
      await settle(page);
      const leaks = newSideEffects(cell, since);
      if (leaks.length) throw new Error(`request outside the declared fixtures on the way to Step 6: ${leaks.join('; ')}`);
      const s = await nextState();
      if (s.nextCount !== 0) throw new Error(`Step 6 still shows ${s.nextCount} "${label}" button(s)`);
      // Step 5's scroll position carries over (viewport showed footer FAQ + sticky CTA): frame the receipt top.
      framing = await page.evaluate(frameFunnelTop, '.charter-funnel-receipt');
      if (!framing.ok) return { unverified: `receipt top not framed under the top bar: ${framing.reason}` };
      return null;
    }, {
      full: true,
      note: 'Step 6 quote receipt as computed by the app (no quote fixture); scrolled only to frame the receipt top under the fixed/sticky top bar; Proceed to Pay not pressed here',
      record: async () => ({
        framing,
        ...(await nextState()),
        ...(await payState()),
        receipt: ((await page.locator('.charter-funnel-quote-document').first().innerText()) || '').slice(0, 2000),
      }),
    });
    let detailsFraming = null;
    let quotePresentation = null;
    await step(ctx, 'charter-quote-details', async () => {
      // Desktop (>=1024) shows the sticky Trip summary aside (destination row); phones show the receipt rows only.
      const target = (await page.locator('.charter-funnel-summary-panel:visible').count()) === 1 ? '.charter-funnel-summary-panel' : '.charter-funnel-receipt-rows';
      detailsFraming = await page.evaluate(frameFunnelTop, target);
      await settle(page);
      quotePresentation = await page.evaluate(measureCharterPresentation, 'quote');
      const soft = [];
      if (!detailsFraming.ok) soft.push(`quote detail rows not framed under the top bar: ${detailsFraming.reason}`);
      if (quotePresentation.expectations.length) soft.push(`presentation: ${quotePresentation.expectations.join('; ')}`);
      const s = await payState();
      if (s.payCount !== 1) soft.push(`expected one "${s.payLabel}" button, found ${s.payCount}`);
      return soft.length ? { unverified: soft.join('; ') } : null;
    }, {
      full: true,
      note: 'Step 6 quote detail rows (desktop Trip summary aside or phone receipt rows); real window scroll only, nothing pressed, quote/price untouched',
      record: async () => ({ framing: detailsFraming, presentation: quotePresentation, ...(await payState()) }),
    });
    let paymentFraming = null;
    let paymentPresentation = null;
    await step(ctx, 'charter-payment-config-error', async () => {
      const since = cell.failures.length;
      const pay = await only(payButtons(), `charter "${CHARTER_PAY[cell.lang]}" button`);
      if (await pay.isDisabled()) throw new Error('Proceed to Pay is disabled');
      // CharterWizard handleProceedPayment: clears the local snapshot and calls onComplete → PaymentPanel. No request.
      await activate(ctx, pay);
      await visibleWait(page.locator('.charter-funnel-payment'));
      const panelError = page.locator('.charter-funnel-payment .customer-paypal-error');
      await visibleWait(panelError, 10000);
      await settle(page);
      const text = ((await (await only(panelError, 'PayPal error box')).locator('p').first().innerText()) || '').trim();
      if (text !== PAYPAL_NO_CLIENT_ID) throw new Error(`payment panel error is not the empty-credential message: "${text.slice(0, 160)}"`);
      if (await page.evaluate(() => !!document.getElementById('paypal-sdk'))) throw new Error('a PayPal SDK <script> was inserted');
      const sdk = cell.blocked.filter((b) => { try { return PAYPAL_HOST.test(new URL(b.url).hostname); } catch { return false; } });
      if (sdk.length) throw new Error(`PayPal request attempted: ${sdk.map((b) => `${b.method} ${b.url}`).join('; ')}`);
      const leaks = newSideEffects(cell, since);
      if (leaks.length) throw new Error(`request outside the declared fixtures after Proceed to Pay: ${leaks.join('; ')}`);
      // Step 6's scroll position carries over (phone viewport showed FAQ/footer): frame the payment panel top.
      paymentFraming = await page.evaluate(frameFunnelTop, '.charter-funnel-payment');
      const soft = [];
      if (cell.blockedListTruncated) soft.push('blocked-request list truncated at 300 entries; absence of a PayPal request not provable');
      if (!paymentFraming.ok) soft.push(`payment panel top not framed under the top bar: ${paymentFraming.reason}`);
      // Computed styles as rendered (no style writes): VAT 13px + contrast >= 4.5 on the PayPal blue, summary values unclipped.
      paymentPresentation = await page.evaluate(measureCharterPresentation, 'payment');
      if (paymentPresentation.expectations.length) soft.push(`presentation: ${paymentPresentation.expectations.join('; ')}`);
      if (soft.length) return { unverified: soft.join('; ') };
      return null;
    }, {
      full: true,
      note: 'offline CONFIGURATION state only: no PayPal client ID, so no SDK and no PayPal button flow. The PayPal/book button, Retry and QR are never pressed; this is not a payment verification. Scrolled only to frame the payment panel top under the fixed/sticky top bar',
      record: async () => ({ framing: paymentFraming, presentation: paymentPresentation, panelText: ((await page.locator('.charter-funnel-payment').first().innerText()) || '').slice(0, 1200) }),
    });
  },

  async map(ctx) {
    const { run, page } = ctx;
    const shell = page.getByTestId('map-editorial-shell');
    const shellState = async () => ({ dataState: await shell.getAttribute('data-state') });
    // MapPage.tsx:368-378 pageState → data-state. The state must actually be the expected one.
    const expectShellState = async (expected) => {
      if (await pollFor(async () => (await shell.getAttribute('data-state')) === expected, 5000)) return;
      throw new Error(`map data-state="${await shell.getAttribute('data-state')}" after 5s, expected "${expected}"`);
    };
    await step(ctx, 'map-signed-out', async () => {
      await open(ctx, '/map', () => visibleWait(shell));
      await expectShellState('signed-out');
    }, { full: true, independent: true, record: shellState });
    if (run.meta.serverKind !== 'vite-dev') {
      const reason = run.meta.serverKind
        ? 'MapPage ?__fixture is import.meta.env.DEV-only; not available on a built preview server'
        : 'server kind unknown (first local page never loaded); DEV-only map fixture not attempted';
      unverified(ctx.cell, 'map-simulated-normal', reason);
      unverified(ctx.cell, 'map-fixture-error', reason);
      return;
    }
    await step(ctx, 'map-simulated-normal', async () => {
      await open(ctx, '/map?__fixture=normal', () => visibleWait(page.getByTestId('day-route-map')));
      const tiles = await pollFor(async () => (await page.locator('.leaflet-tile-loaded').count()) > 0, 8000);
      if (!tiles) return { unverified: 'no synthetic map tile reported loaded within 8s; frame kept, map not shown working' };
      return null;
    }, {
      full: true, independent: true, record: shellState,
      note: 'SIMULATED map: DEV fixture refs + local flat synthetic tiles; the live map and real routes are not verified',
    });
    await step(ctx, 'map-fixture-error', async () => {
      await open(ctx, '/map?__fixture=error', () => visibleWait(shell));
      await expectShellState('error');
    }, { independent: true, record: shellState });
  },

  async static(ctx) {
    const { page } = ctx;
    for (const target of STATIC_PATHS) {
      await step(ctx, `static${target.replace(/\//g, '-')}`, () => open(ctx, target, () => visibleWait(page.locator('h1, h2, main'))),
        { full: true, independent: true });
    }
  },

  async account(ctx) {
    const { page } = ctx;
    const note = 'signed-out only; no login (Google/phone/LINE) attempted';
    for (const target of ['/my-plans', '/mypage']) {
      await step(ctx, `account${target.replace(/\//g, '-')}-signed-out`, async () => {
        await open(ctx, target, () => visibleWait(page.locator('h1, h2, main')));
        await sleep(1200); // auth state resolution (no persisted user)
      }, { full: true, independent: true, note });
    }
  },
};

// ── Videos: short real-UI recordings of focus and press on the changed buttons ──────────────

/** Tab until `selector` holds focus; returns whether it got there and whether :focus-visible matched. */
async function tabTo(page, selector, max = 40) {
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press('Tab');
    const state = await page.evaluate((sel) => {
      const el = document.activeElement;
      if (!el || !el.matches(sel)) return null;
      return { focusVisible: el.matches(':focus-visible'), outline: getComputedStyle(el).outlineStyle };
    }, selector);
    if (state) {
      await sleep(700);
      return { reached: true, tabs: i + 1, ...state };
    }
  }
  return { reached: false, tabs: max };
}

// Touch hold stays under Chromium's default 500ms long-press, so no contextmenu/long-press gesture.
const TOUCH_HOLD_MS = 350;

/**
 * Visible press without activation. Records the computed transform before and while held (the
 * shared press is translateY(1px); reduced motion = none), whether :active matched, and the input type.
 * - Desktop (mouse): pointer down on the centre, hold 500ms, move off, release elsewhere. No click.
 * - Touch cells (cdp-touch): CDP Input.dispatchTouchEvent touchStart on the centre, hold, then
 *   touchCancel (never touchEnd), so no tap/click is generated. Cancel and detach always run. If the
 *   centre is unstable or not on the control, no touch is sent and the press is returned unverified.
 */
async function holdPress(ctx, locator) {
  const { page, cell } = ctx;
  await locator.scrollIntoViewIfNeeded();
  // The same box on two consecutive reads: no scroll or layout shift still moving the centre.
  let b = null;
  const stableBox = await pollFor(async () => {
    const prev = b;
    b = await locator.boundingBox();
    return !!b && !!prev && Math.abs(b.x - prev.x) < 0.5 && Math.abs(b.y - prev.y) < 0.5 && Math.abs(b.width - prev.width) < 0.5 && Math.abs(b.height - prev.height) < 0.5;
  }, 3000);
  if (!b) throw new Error('press target has no box');
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  const before = await locator.evaluate((el) => getComputedStyle(el).transform);
  // Whether the press point is actually on the control (not on an overlay covering it).
  const hitAtCenter = await locator.evaluate((el, [px, py]) => {
    const top = document.elementFromPoint(px, py);
    return !!top && (top === el || el.contains(top));
  }, [x, y]);
  const readHeld = () => locator.evaluate((el) => ({ transform: getComputedStyle(el).transform, active: el.matches(':active') }));

  if (!cell.device.hasTouch) {
    await page.mouse.move(x, y);
    await sleep(300);
    await page.mouse.down();
    await sleep(500);
    const held = await readHeld();
    await page.mouse.move(x, Math.max(2, b.y - 60), { steps: 4 });
    await page.mouse.up();
    await sleep(500);
    return { inputType: 'mouse', stableBox, before, held: held.transform, activeWhileHeld: held.active, hitAtCenter };
  }

  const result = { inputType: 'cdp-touch', stableBox, before, held: null, activeWhileHeld: null, hitAtCenter, holdMs: TOUCH_HOLD_MS, touchCancelled: false };
  if (!stableBox) return { ...result, unverified: 'touch not sent: target centre not stable within 3s' };
  if (!hitAtCenter) return { ...result, unverified: 'touch not sent: centre point is not on the control' };
  let session = null;
  let sent = false;
  try {
    session = await page.context().newCDPSession(page);
    sent = true; // from here on a touch may be down: the finally block always cancels it
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await sleep(TOUCH_HOLD_MS);
    const held = await readHeld();
    result.held = held.transform;
    result.activeWhileHeld = held.active;
  } catch (error) {
    result.unverified = `CDP touch hold not completed: ${msg(error)}`;
  } finally {
    if (session) {
      if (sent) {
        try {
          await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
          result.touchCancelled = true;
        } catch (error) {
          result.cancelError = msg(error);
        }
      }
      await session.detach().catch((error) => { result.detachError = msg(error); });
    }
  }
  if (sent && !result.touchCancelled) throw new Error(`touchCancel failed after touchStart, a touch may still be down: ${result.cancelError}`);
  await sleep(500);
  return result;
}

/**
 * Motion-probe observations that did not happen as the video claims: a Tab target not reached or
 * without :focus-visible, a held press whose pointer missed the control or never matched :active,
 * or a `*Pressed` control that was not rendered and so never pressed. Each one is reported, never success.
 */
function unverifiedObservations(probe) {
  const found = [];
  for (const [key, value] of Object.entries(probe)) {
    if (value && typeof value === 'object' && 'reached' in value) {
      if (!value.reached) found.push(`${key}: Tab never reached the target (${value.tabs} tabs)`);
      else if (!value.focusVisible) found.push(`${key}: focused, but :focus-visible did not match`);
    } else if (value && typeof value === 'object' && 'activeWhileHeld' in value) {
      if (value.unverified) found.push(`${key} (${value.inputType}): ${value.unverified}`);
      else if (!value.hitAtCenter) found.push(`${key} (${value.inputType}): press point is not on the control`);
      else if (!value.activeWhileHeld) found.push(`${key} (${value.inputType}): control did not match :active while held`);
      if (value.detachError) found.push(`${key}: CDP session detach failed: ${value.detachError}`);
    } else if (/Pressed$/.test(key) && value !== true) {
      found.push(`${key}: control not rendered/visible, so never pressed`);
    }
  }
  return found;
}

const VIDEO_SCRIPTS = {
  /** Clouds, keyboard focus, sky toggle and pass pause presses, sample tab, CTA → /planner. */
  async home(ctx, probe) {
    const { page } = ctx;
    await open(ctx, '/', () => visibleWait(page.locator('.home-dope')));
    await sleep(2500);
    Object.assign(probe, await page.evaluate(() => {
      const v = document.querySelector('.home-dope-sky__video');
      return { skyVideo: !!v, readyState: v ? v.readyState : null, paused: v ? v.paused : null };
    }));
    probe.primaryCtaFocus = await tabTo(page, '.home-dope-btn--primary', 30);
    const sky = page.locator('.home-dope-sky-toggle');
    probe.skyTogglePressed = false;
    if ((await sky.count()) && (await sky.isVisible())) {
      await activate(ctx, sky);
      await sleep(900);
      await activate(ctx, sky);
      probe.skyTogglePressed = true;
      await sleep(900);
    }
    const pause = page.locator('.home-dope-pass__pause');
    probe.passPausePressed = false;
    if ((await pause.count()) && (await pause.isVisible())) {
      await activate(ctx, pause);
      probe.passPausePressed = true;
      await sleep(700);
    }
    for (let i = 0; i < 4; i += 1) {
      await page.evaluate(() => window.scrollBy({ top: 450, behavior: 'instant' }));
      await sleep(350);
    }
    await scrollTo(page, '#sample-day');
    const tab = page.locator('#sample-day [role="tab"]').nth(1);
    probe.sampleTabPressed = false;
    if (await tab.count()) {
      await activate(ctx, tab);
      probe.sampleTabPressed = true;
      await sleep(900);
    }
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await sleep(600);
    const cta = page.locator('.home-dope-hero .home-dope-btn--primary:visible').first();
    if (!ctx.cell.device.hasTouch) await cta.hover(); // desktop-only: a hover has no touch equivalent
    await sleep(400);
    await activate(ctx, cta);
    await page.waitForURL(/\/planner/, { timeout: 10000 });
    await sleep(1500);
  },

  /** Reservation → destination → food → details → review; press held on Next and on the free-preview CTA, never released on them. */
  async planner(ctx, probe) {
    const { page } = ctx;
    const { stage, desktop, next, intro, openPlanner, pickPreset } = plannerParts(ctx);
    await openPlanner();
    await sleep(900);
    probe.introVisible = await intro.isVisible();
    if (probe.introVisible) {
      await page.keyboard.press('Escape');
      await intro.waitFor({ state: 'hidden', timeout: 5000 });
    }
    await activate(ctx, page.locator('.wizard-res-row').first());
    await sleep(500);
    probe.reservationCtaFocus = await tabTo(page, '.wizard-res-cta');
    await activate(ctx, page.locator('.wizard-res-cta'));
    await visibleWait(stage('dest'));
    probe.preset = await pickPreset();
    await sleep(700);
    await activate(ctx, next());
    await visibleWait(stage('food'));
    const style = stage('food').locator('.grid > .ec-option').first();
    await activate(ctx, style);
    await sleep(500);
    probe.foodNextPress = await holdPress(ctx, next());
    await activate(ctx, next());
    await visibleWait(stage('details'));
    const airport = stage('details').locator('[aria-haspopup="listbox"]').first();
    await activate(ctx, airport);
    await activate(ctx, page.locator('[role="option"]:visible').first());
    await sleep(500);
    probe.detailsNextFocus = await tabTo(page, '.wizard-stage--details .ec-btn.ec-btn-primary');
    probe.detailsNextPress = await holdPress(ctx, next());
    await activate(ctx, next());
    await visibleWait(stage('review'));
    await sleep(600);
    // Held, then released elsewhere (mouse) or cancelled (touch): no click, so /api/ai-planner-quick is never called (allowQuick stays false).
    probe.reviewCtaPress = await holdPress(ctx, stage('review').locator('.wizard-review-cta .ec-btn-primary'));
    probe.desktop = desktop;
    await sleep(1000);
  },

  /** Origin → service → destination; focus and held press on the real Next control for this width. */
  async charter(ctx, probe) {
    const { page } = ctx;
    const { nextButton } = charterParts(ctx);
    await open(ctx, '/charter', () => visibleWait(page.locator('[data-origin-code="ICN"]')));
    await sleep(800);
    probe.originFocus = await tabTo(page, '[data-origin-code="ICN"]');
    await activate(ctx, page.locator('[data-origin-code="ICN"]'));
    await sleep(600);
    probe.originNextPress = await holdPress(ctx, await nextButton());
    await activate(ctx, await nextButton());
    await visibleWait(page.locator('[data-service="airport_transfer"]'));
    await activate(ctx, page.locator('[data-service="airport_transfer"]'));
    await sleep(600);
    await activate(ctx, await nextButton());
    await visibleWait(page.locator('[data-testid="charter-destination-card"]'));
    await activate(ctx, page.locator('[data-testid="charter-destination-card"]').first());
    await sleep(600);
    probe.destinationNextPress = await holdPress(ctx, await nextButton());
    await sleep(1000);
  },

  /** Catalogue grid: keyboard focus ring on a card link, held press on a card (released off it, no navigation). */
  async tours(ctx, probe) {
    const { page } = ctx;
    await open(ctx, '/tours', () => visibleWait(page.getByTestId('tours-grid')));
    await sleep(1000);
    probe.cardFocus = await tabTo(page, '.tours-catalog-grid .tour-catalog-card-link', 60);
    const card = page.locator('.tours-catalog-grid .tour-catalog-card-link:visible').first();
    probe.cardPress = await holdPress(ctx, card);
    for (let i = 0; i < 3; i += 1) {
      await page.evaluate(() => window.scrollBy({ top: 400, behavior: 'instant' }));
      await sleep(450);
    }
    if (new URL(page.url()).pathname !== '/tours') throw new Error(`press navigated away: ${page.url()}`);
    await sleep(800);
  },
};

// ── Runners ─────────────────────────────────────────────────────────────────────────────────

function finalize(run, cell) {
  if (cell.failures.length || cell.states.some((s) => s.status === 'error')) cell.status = 'captured-with-failures';
  else if (cell.unverified.length || cell.states.some((s) => s.status === 'unverified' || s.status === 'not-reached')) cell.status = 'partially-unverified';
  else cell.status = 'captured';
  delete cell.allowQuick;
  delete cell.halted;
  delete cell.abortedUrls;
  delete cell.currentState;
  cell.dir = path.relative(run.out, cell.dir);
}

async function runCell(browser, run, group, width, lang) {
  const cell = newCell(run, group, width, lang, run.staticMotion);
  console.log(`[capture] ${group} ${width} ${lang}`);
  let context = null;
  try {
    const opened = await openContext(browser, run, cell, {});
    context = opened.context;
    await FLOWS[group]({ run, page: opened.page, cell });
  } catch (error) {
    cell.failures.push({ kind: 'cell-error', detail: msg(error) });
  } finally {
    if (context) await context.close().catch((e) => cell.failures.push({ kind: 'context-close-error', detail: msg(e) }));
  }
  finalize(run, cell);
  run.cells.push(cell);
  writeReceipt(run, false);
}

async function runVideoCell(browser, run, flow, width, lang) {
  for (const motion of ['no-preference', 'reduce']) {
    const cell = newCell(run, 'video', width, lang, motion, flow);
    console.log(`[capture] video ${flow} ${width} ${lang} ${motion}`);
    cell.motionProbe = {};
    cell.currentState = `${flow}-video-${motion}`;
    let context = null;
    let video = null;
    let scriptError = null;
    try {
      const opened = await openContext(browser, run, cell, { recordVideo: { dir: path.join(cell.dir, 'raw'), size: { width, height: HEIGHTS[width] } } });
      context = opened.context;
      video = opened.page.video();
      const ctx = { run, page: opened.page, cell };
      await VIDEO_SCRIPTS[flow](ctx, cell.motionProbe);
      cell.motionProbe.reducedMotion = await opened.page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      cell.pointer.videoEnd = await pointerMedia(opened.page);
      const off = pointerMismatch(cell, cell.pointer.videoEnd);
      if (off) cell.unverified.push({ kind: 'pointer-media-unverified', state: cell.currentState, detail: `end of video script: ${off}` });
    } catch (error) {
      scriptError = msg(error);
      cell.failures.push({ kind: 'video-script-error', detail: scriptError });
    } finally {
      if (context) await context.close().catch((e) => cell.failures.push({ kind: 'context-close-error', detail: msg(e) }));
    }
    if (video) {
      const dest = path.join(cell.dir, `${flow}-${motion}.webm`);
      try {
        await video.saveAs(dest);
        await video.delete().catch((e) => cell.unverified.push({ kind: 'raw-video-not-deleted', detail: msg(e) }));
        cell.videos.push(fileRecord(run, dest));
      } catch (error) {
        cell.captureErrors += 1;
        cell.failures.push({ kind: 'video-save-error', detail: msg(error) });
      }
    } else {
      cell.captureErrors += 1;
      cell.failures.push({ kind: 'video-missing', detail: 'no video recorded (context failed or ffmpeg unavailable)' });
    }
    const observations = unverifiedObservations(cell.motionProbe);
    for (const detail of observations) cell.unverified.push({ kind: 'motion-observation-unverified', detail });
    // Pointer media flips (first activation or end of script) also keep the video unverified.
    for (const u of cell.unverified) if (u.kind === 'pointer-media-unverified') observations.push(`pointer media ${u.detail}`);
    const status = scriptError || !cell.videos.length ? 'error' : observations.length ? 'unverified' : 'captured';
    cell.states.push({
      state: `${flow}-video-${motion}`, status,
      ...(scriptError ? { error: scriptError } : {}),
      ...(observations.length ? { reason: observations.join('; ') } : {}),
    });
    finalize(run, cell);
    run.cells.push(cell);
    writeReceipt(run, false);
  }
}

async function main() {
  const opts = readOptions();
  const cellPlan = [];
  for (const group of opts.groups.filter((g) => g !== 'video')) {
    for (const width of opts.widths) for (const lang of opts.langs) cellPlan.push({ group, width, lang });
  }
  if (opts.groups.includes('video')) {
    const videoCells = VIDEO_CELLS.filter((v) => opts.widths.includes(v.width) && opts.langs.includes(v.lang));
    if (!videoCells.length) fail(`--group video: no representative video cell (${VIDEO_CELLS.map((v) => `${v.width}-${v.lang}`).join(', ')}) left after --width/--lang`);
    for (const flow of opts.videoFlows) {
      for (const v of videoCells) cellPlan.push({ group: 'video', flow, width: v.width, lang: v.lang, motions: ['no-preference', 'reduce'] });
    }
  }
  if (opts.planOnly) {
    console.log(JSON.stringify({ baseURL: opts.base.origin, staticMotion: opts.staticMotion, devices: DEVICE, cells: cellPlan }, null, 2));
    return 0;
  }

  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  fs.mkdirSync(opts.out); // throws if a run with this name appeared meanwhile
  const run = {
    out: opts.out,
    base: opts.base,
    staticMotion: opts.staticMotion,
    cells: [],
    meta: {
      harness: 'scripts/integration/customer-capture-20261017.mjs',
      startedAt: new Date().toISOString(),
      baseURL: opts.base.origin,
      serverKind: null,
      node: process.version,
      browser: null,
      browserExecutable: opts.executable || 'playwright-default',
      selection: { groups: opts.groups, widths: opts.widths, langs: opts.langs, staticMotion: opts.staticMotion, videoFlows: opts.groups.includes('video') ? opts.videoFlows : [] },
      devices: DEVICE,
      isolation: [
        'fresh context per cell, no storage state, service workers blocked',
        'HTTP+WebSocket routes installed before navigation; external aborted; unknown /api aborted and recorded',
        `dead proxy http://127.0.0.1:9, bypass only 127.0.0.1:${opts.port}; background networking disabled`,
        'application-level cooperative isolation, not an OS/network guarantee',
      ],
      emulation: 'phones = Chromium isMobile+hasTouch+DPR 2 with the default desktop Chromium user agent; not WebKit, not a physical device',
      verdict: 'NOT A PASS: evidence for human review. A screenshot or video only proves a frame was captured; statuses describe capture, not visual or functional correctness.',
    },
  };
  writeReceipt(run, false);

  let browser = null;
  let fatal = null;
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: opts.executable || undefined,
      // Raw proxy flags instead of launch({ proxy }): Playwright would append <-loopback> LAST, which
      // overrides the explicit origin. Here <-loopback> first drops Chromium's implicit loopback bypass,
      // then the exact origin re-adds only 127.0.0.1:<port> (Chromium net/docs/proxy.md).
      args: [
        '--proxy-server=http://127.0.0.1:9', `--proxy-bypass-list=<-loopback>;127.0.0.1:${opts.port}`,
        '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-default-apps',
        '--disable-domain-reliability', '--no-pings', '--no-first-run', '--no-default-browser-check',
      ],
    });
    run.meta.browser = `chromium ${browser.version()}`;
    for (const item of cellPlan) {
      if (item.group === 'video') await runVideoCell(browser, run, item.flow, item.width, item.lang);
      else await runCell(browser, run, item.group, item.width, item.lang);
    }
  } catch (error) {
    fatal = msg(error);
    run.meta.fatal = fatal;
  } finally {
    if (browser) await browser.close().catch((e) => { run.meta.browserCloseError = msg(e); });
  }
  writeReceipt(run, !fatal);

  const t = totals(run);
  console.log(`[capture] receipt: ${path.join(run.out, 'receipt.json')}`);
  console.log(`[capture] cells=${t.cells} captured=${t.captured} withFailures=${t.withFailures} partiallyUnverified=${t.partiallyUnverified} failures=${t.failures} unverifiedStates=${t.unverifiedStates} unverifiedItems=${t.unverifiedItems} captureErrors=${t.screenshotErrors} files=${t.files}`);
  if (fatal) { console.error(`[capture] fatal: ${fatal}`); return 1; }
  // A browser that did not close cleanly may still hold the profile or a child process: a failure, never 0.
  if (run.meta.browserCloseError) console.error(`[capture] browser.close failed: ${run.meta.browserCloseError}`);
  if (t.failures > 0 || t.screenshotErrors > 0 || run.meta.browserCloseError) return 2;
  if (t.unverifiedStates > 0 || t.unverifiedItems > 0) return 3;
  return 0;
}

main().then((code) => { process.exitCode = code; }, (error) => {
  console.error(`[capture] fatal: ${msg(error)}`);
  process.exitCode = 1;
});
