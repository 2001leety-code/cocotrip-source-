/**
 * _exchange-rate.js — 환율 조회 공통 유틸
 *
 * 사용처: applyPromoCode, booking-processor, createPaypalOrder, daily-report
 * 비즈니스 로직:
 *   - getExchangeRate() — 풀 메타데이터 (source/fetchedAt 포함) + Firestore 6h 캐시
 *   - getUsdToKrw({cap}) — 쿠폰 보호용 cap 적용 (기본 1500) — legacy
 *   - getUsdToKrwRaw() — 결제 KRW 환산용 cap 없음 — legacy
 *
 * API 호출 순서 (fallback chain):
 *   1. exchangerate-api.com (env EXCHANGE_RATE_API_KEY 사용 시 안정 — 1500 req/month 무료)
 *   2. exchangerate-api.com (open free tier, 키 없이)
 *   3. frankfurter.app (ECB 기반 무료, 평일만 갱신)
 *   4. Naver Finance scraping (의존성 없음, fragile)
 *   5. fallback hardcoded 1380 (마지막 안전망)
 *
 * 캐시:
 *   - Firestore `system/exchange_rate` 도큐먼트
 *   - TTL 6h (fetchedAt 비교)
 *   - 캐시 만료/조회 실패 시 외부 API 호출 → 캐시 갱신
 */

// P1 #5 fix (2026-05-13): RATE_CAP 1350 → 1500. 실시세 ~1430 이 기존 cap 1350 위로 올라가 매번 cap kick-in.
// 1500 cap 은 정책 환율 1430 위에 ~5% headroom — 단기 spike 흡수 + 의미 있는 보호.
// FALLBACK_RATE 1380 → 1430 (정책 환율 = SSOT pricing_spec.policy_krw_per_usd 와 일치).
const RATE_CAP = 1500;
const FALLBACK_RATE = 1430;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const FETCH_TIMEOUT_MS = 4500;

// ── Firestore 캐시 ───────────────────────────────────────────────────────
async function readCache() {
  try {
    const { initAdminDb } = await import('./_shared/firebase-admin.js');
    const db = initAdminDb('exchange-rate');
    if (!db) return null;
    const snap = await db.collection('system').doc('exchange_rate').get();
    if (!snap.exists) return null;
    const data = snap.data() || {};
    if (!data.krwPerUsd || !data.fetchedAt) return null;
    const fetchedAt = data.fetchedAt.toDate ? data.fetchedAt.toDate() : new Date(data.fetchedAt);
    if (!(fetchedAt instanceof Date) || isNaN(fetchedAt.getTime())) return null;
    return {
      krwPerUsd: Number(data.krwPerUsd),
      usdPerKrw: Number(data.usdPerKrw) || (1 / Number(data.krwPerUsd)),
      fetchedAt,
      source: data.source || 'cache',
    };
  } catch (e) {
    console.warn('[exchange-rate] cache read failed:', e.message);
    return null;
  }
}

async function writeCache({ krwPerUsd, usdPerKrw, source, fetchedAt }) {
  try {
    const { initAdminDb } = await import('./_shared/firebase-admin.js');
    const db = initAdminDb('exchange-rate');
    if (!db) return;
    await db.collection('system').doc('exchange_rate').set({
      krwPerUsd,
      usdPerKrw,
      source,
      fetchedAt,
    }, { merge: false });
  } catch (e) {
    console.warn('[exchange-rate] cache write failed:', e.message);
  }
}

function isCacheFresh(fetchedAt) {
  if (!fetchedAt) return false;
  return (Date.now() - fetchedAt.getTime()) < CACHE_TTL_MS;
}

// ── 외부 API 호출자들 ────────────────────────────────────────────────────
async function fetchFromExchangerateApiKeyed(timeout) {
  const apiKey = (process.env.EXCHANGE_RATE_API_KEY || '').trim();
  if (!apiKey) return null;
  try {
    const url = `https://v6.exchangerate-api.com/v6/${apiKey}/pair/USD/KRW`;
    const res = await fetch(url, { signal: AbortSignal.timeout(timeout) });
    if (!res.ok) return null;
    const json = await res.json();
    if (json.result !== 'success') return null;
    const rate = Number(json.conversion_rate);
    if (!rate || rate <= 0) return null;
    return { krwPerUsd: rate, source: 'exchangerate-api(keyed)' };
  } catch { return null; }
}

async function fetchFromExchangerateApiOpen(timeout) {
  try {
    const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD', {
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const rate = Number(json?.rates?.KRW);
    if (!rate || rate <= 0) return null;
    return { krwPerUsd: rate, source: 'exchangerate-api(open)' };
  } catch { return null; }
}

async function fetchFromFrankfurter(timeout) {
  try {
    const res = await fetch('https://api.frankfurter.app/latest?from=USD&to=KRW', {
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const rate = Number(json?.rates?.KRW);
    if (!rate || rate <= 0) return null;
    return { krwPerUsd: rate, source: 'frankfurter.app' };
  } catch { return null; }
}

async function fetchFromNaverFinance(timeout) {
  // Naver Finance — fragile scraping. HTML 구조 변경 시 작동 안 함.
  // 환율 페이지: USD/KRW
  try {
    const res = await fetch('https://finance.naver.com/marketindex/exchangeDetail.naver?marketindexCd=FX_USDKRW', {
      signal: AbortSignal.timeout(timeout),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CocoTripBot/1.0)',
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    // <p class="no_today"><em><span class="...">1,380<span ...>.50</span>
    // 또는 <strong>1,380.50</strong> 등 다양한 패턴 시도
    const patterns = [
      /<p[^>]*class="[^"]*no_today[^"]*"[^>]*>[\s\S]*?<em[^>]*>([\d,]+\.\d+)/,
      /id="quote_p"[^>]*>([\d,]+\.\d+)/,
      />([\d,]{4,})\s*<\/em>/,
    ];
    for (const re of patterns) {
      const m = html.match(re);
      if (m) {
        const rate = Number(String(m[1]).replace(/,/g, ''));
        if (rate && rate > 0) return { krwPerUsd: rate, source: 'naver-finance' };
      }
    }
    return null;
  } catch { return null; }
}

// ── 메인 fetch (캐시 우선) ──────────────────────────────────────────────
async function fetchFresh() {
  const fetchers = [
    fetchFromExchangerateApiKeyed,
    fetchFromExchangerateApiOpen,
    fetchFromFrankfurter,
    fetchFromNaverFinance,
  ];

  for (const fn of fetchers) {
    try {
      const result = await fn(FETCH_TIMEOUT_MS);
      if (result && result.krwPerUsd > 0) {
        const fetchedAt = new Date();
        const out = {
          krwPerUsd: result.krwPerUsd,
          usdPerKrw: 1 / result.krwPerUsd,
          source: result.source,
          fetchedAt,
        };
        // best-effort 캐시 쓰기 (실패 무시)
        await writeCache(out);
        return out;
      }
    } catch (e) {
      console.warn(`[exchange-rate] fetcher ${fn.name} failed:`, e.message);
    }
  }

  // 모두 실패 → fallback
  return {
    krwPerUsd: FALLBACK_RATE,
    usdPerKrw: 1 / FALLBACK_RATE,
    source: 'fallback-hardcoded',
    fetchedAt: new Date(),
  };
}

/**
 * 환율 풀 메타데이터 조회 (Firestore 6h 캐시)
 * @returns {Promise<{ krwPerUsd: number, usdPerKrw: number, fetchedAt: Date, source: string }>}
 */
export async function getExchangeRate() {
  const cached = await readCache();
  if (cached && isCacheFresh(cached.fetchedAt)) {
    return cached;
  }
  return fetchFresh();
}

/**
 * USD→KRW 환율 조회 (cap 적용)
 * @param {{ cap?: number, timeout?: number }} opts
 * @returns {Promise<number>} 환율 (cap된 값)
 */
export async function getUsdToKrw(opts = {}) {
  const cap = opts.cap ?? RATE_CAP;
  try {
    const { krwPerUsd } = await getExchangeRate();
    if (krwPerUsd && krwPerUsd > 0) return Math.min(krwPerUsd, cap);
  } catch (e) {
    console.warn('[exchange-rate] getUsdToKrw failed:', e.message);
  }
  return Math.min(FALLBACK_RATE, cap);
}

/**
 * USD→KRW 환율 조회 (cap 없음 — booking-processor용 실제 환율)
 * @returns {Promise<number>}
 */
export async function getUsdToKrwRaw() {
  return getUsdToKrw({ cap: Infinity });
}
