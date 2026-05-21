/**
 * CocoTripKR — Track B Trend Cron: Reddit painpoint scanner.
 *
 * 매주 월요일 19:00 UTC (= 화요일 04:00 KST) 실행. vercel.json crons → cron-runner.js
 * 가 dispatch. 인증은 dispatcher (verifyCronRequest) 가 처리.
 *
 * 목적
 *   외국인 한국여행자 painpoint 자동 수집 — r/koreatravel / r/seoul / r/Korea /
 *   r/JapanTravel (비교 baseline) 의 1주 hot posts top 50 scrape → 한국 region +
 *   카테고리 keyword 추출 → score / comments_count threshold 이상이면 저장.
 *
 * 인증
 *   anonymous JSON endpoint (`https://www.reddit.com/r/<sub>/top.json`) 사용 —
 *   OAuth 불필요. 단 user-agent 필수 (Reddit ToS — 'cocotrip:trend-cron:v1').
 *   anonymous 60 req/min — region/subreddit 4개 × 1 호출 = 안전.
 *
 * Firestore schema
 *   user_painpoints/{reddit_post_id} = {
 *     reddit_post_id, subreddit, title, selftext, score, comments_count,
 *     url, detected_regions[], detected_categories[],
 *     scanned_at, created_at,
 *   }
 *
 * 임계값
 *   score >= 20 OR comments_count >= 10 → 저장. 그 외 skip.
 *
 * 실패 모드
 *   - Reddit 503/429 → 단일 subreddit skip + 다음 진행.
 *   - Firestore 미초기화 → 503 fail.
 *   - 개별 post parse 실패 → console.warn + 계속.
 *
 * 운영자 manual trigger
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *        "https://cocotripkr.com/api/cron-runner?job=scan-reddit-painpoints"
 */
import { initAdminDb } from '../_shared/firebase-admin.js';
import { sendErrorAlert } from '../_telegram.js';
import { captureError } from '../_shared/sentry.js';

const REDDIT_TIMEOUT_MS = 8000;
const PER_REQUEST_SLEEP_MS = 1500; // 1초 spacing (60 req/min anonymous cap)
const POSTS_PER_SUBREDDIT = 50;
const MIN_SCORE = 20;
const MIN_COMMENTS = 10;
const USER_AGENT = 'cocotrip:trend-cron:v1 (by /u/cocotripkr)';

const SUBREDDITS = [
  'koreatravel',  // 한국여행 핵심 painpoint
  'seoul',        // 서울 거주/체류 painpoint
  'Korea',        // 일반 한국 관련
  'JapanTravel',  // 비교 baseline — 같은 painpoint 의 일본 처리 시그널
];

// 한국 region keyword (소문자 매칭, 정규식 word-boundary)
const REGION_KEYWORDS = {
  seoul:   ['seoul', '서울'],
  busan:   ['busan', '부산'],
  jeju:    ['jeju', '제주'],
  gyeongju:['gyeongju', '경주'],
  jeonju:  ['jeonju', '전주'],
  gangneung:['gangneung', '강릉'],
  incheon: ['incheon', '인천'],
  dmz:     ['dmz', 'demilitarized'],
  daegu:   ['daegu', '대구'],
  daejeon: ['daejeon', '대전'],
  gwangju: ['gwangju', '광주'],
  suwon:   ['suwon', '수원'],
};

const CATEGORY_KEYWORDS = {
  food:      ['food', 'restaurant', 'eat', 'meal', 'lunch', 'dinner', 'breakfast', 'menu'],
  transport: ['subway', 'train', 'ktx', 'taxi', 'bus', 'metro', 'station', 't-money', 'tmoney'],
  hotel:     ['hotel', 'hostel', 'airbnb', 'accommodation', 'lodging', 'stay'],
  halal:     ['halal', 'muslim', 'mosque', 'islamic'],
  vegan:     ['vegan', 'vegetarian', 'plant-based'],
  visa:      ['visa', 'k-eta', 'keta', 'entry'],
  payment:   ['payment', 'card', 'cash', 'won', 'krw', 'currency'],
  language:  ['english', 'language', 'translation', 'menu'],
  shopping:  ['shopping', 'store', 'mall', 'market', 'tax-free'],
  safety:    ['scam', 'safety', 'danger', 'theft', 'crime'],
};

// ── 헬퍼 ──────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function detectKeywords(text, dict) {
  const lower = (text || '').toLowerCase();
  const hits = [];
  for (const [tag, kws] of Object.entries(dict)) {
    for (const kw of kws) {
      const re = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (re.test(lower)) {
        hits.push(tag);
        break;
      }
    }
  }
  return [...new Set(hits)];
}

/** Reddit JSON endpoint fetch — top of week. */
async function fetchSubredditTop(subreddit) {
  const url = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/top.json?t=week&limit=${POSTS_PER_SUBREDDIT}`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(REDDIT_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[scan-reddit-painpoints] r/${subreddit} HTTP ${res.status}`);
      return { ok: false, posts: [], error: `http_${res.status}` };
    }
    const data = await res.json();
    const children = data?.data?.children || [];
    const posts = children
      .map((c) => c?.data)
      .filter((d) => d && typeof d.id === 'string')
      .map((d) => ({
        id: d.id,
        reddit_post_id: d.name || `t3_${d.id}`,
        subreddit: d.subreddit || subreddit,
        title: String(d.title || '').slice(0, 500),
        selftext: String(d.selftext || '').slice(0, 2000),
        score: Number(d.score || 0),
        comments_count: Number(d.num_comments || 0),
        url: d.permalink ? `https://reddit.com${d.permalink}` : (d.url || ''),
        created_at_utc: Number(d.created_utc || 0),
      }));
    return { ok: true, posts };
  } catch (err) {
    console.warn(`[scan-reddit-painpoints] fetch error r/${subreddit}: ${err.message}`);
    return { ok: false, posts: [], error: err.message };
  }
}

async function persistPainpoint(db, { post, scannedAt }) {
  const text = `${post.title}\n${post.selftext}`;
  const regions = detectKeywords(text, REGION_KEYWORDS);
  const categories = detectKeywords(text, CATEGORY_KEYWORDS);

  // 한국과 무관한 r/JapanTravel post 는 regions 비면 스킵.
  if (post.subreddit === 'JapanTravel' && regions.length === 0) {
    return { stored: false, reason: 'japan_no_korea_keyword' };
  }

  const docRef = db.collection('user_painpoints').doc(post.reddit_post_id);
  await docRef.set(
    {
      reddit_post_id: post.reddit_post_id,
      subreddit: post.subreddit,
      title: post.title,
      selftext: post.selftext,
      score: post.score,
      comments_count: post.comments_count,
      url: post.url,
      detected_regions: regions,
      detected_categories: categories,
      scanned_at: scannedAt,
      created_at: post.created_at_utc
        ? new Date(post.created_at_utc * 1000).toISOString()
        : null,
    },
    { merge: true }
  );
  return { stored: true, regions, categories };
}

// ── Vercel handler ───────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const db = initAdminDb('cron/scan-reddit-painpoints');
  if (!db) {
    const msg = 'Firestore unavailable — FIREBASE_* env 확인';
    console.error('[scan-reddit-painpoints]', msg);
    try { await sendErrorAlert('scan-reddit-painpoints', new Error(msg)); } catch {}
    return res.status(503).json({ ok: false, error: msg });
  }

  const scannedAt = new Date().toISOString();
  const perSub = [];
  let totalStored = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  try {
    for (const sub of SUBREDDITS) {
      const r = await fetchSubredditTop(sub);
      if (!r.ok) {
        perSub.push({ subreddit: sub, fetched: 0, stored: 0, skipped: 0, error: r.error });
        totalErrors += 1;
        await sleep(PER_REQUEST_SLEEP_MS);
        continue;
      }

      let stored = 0;
      let skipped = 0;
      for (const post of r.posts) {
        if (post.score < MIN_SCORE && post.comments_count < MIN_COMMENTS) {
          skipped += 1;
          continue;
        }
        try {
          const persisted = await persistPainpoint(db, { post, scannedAt });
          if (persisted.stored) stored += 1;
          else skipped += 1;
        } catch (err) {
          totalErrors += 1;
          console.warn(`[scan-reddit-painpoints] persist error ${post.reddit_post_id}: ${err.message}`);
        }
      }
      perSub.push({ subreddit: sub, fetched: r.posts.length, stored, skipped });
      totalStored += stored;
      totalSkipped += skipped;
      await sleep(PER_REQUEST_SLEEP_MS);
    }

    console.log(
      `[scan-reddit-painpoints] done: subs=${SUBREDDITS.length} stored=${totalStored} skipped=${totalSkipped} errors=${totalErrors}`
    );
    return res.status(200).json({
      ok: true,
      scannedAt,
      subreddits: SUBREDDITS.length,
      stored: totalStored,
      skipped: totalSkipped,
      errors: totalErrors,
      perSub,
    });
  } catch (err) {
    console.error('[scan-reddit-painpoints] handler error:', err.message);
    try { await sendErrorAlert('scan-reddit-painpoints', err); } catch {}
    await captureError(err, { route: 'cron/scan-reddit-painpoints' });
    return res.status(500).json({ ok: false, error: err.message });
  }
}
