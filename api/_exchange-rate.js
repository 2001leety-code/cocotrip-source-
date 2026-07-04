/**
 * _exchange-rate.js — 환율 조회 공통 유틸
 *
 * 사용처: applyPromoCode, booking-processor, createPaypalOrder, daily-report
 * 비즈니스 로직:
 *   - getExchangeRate() — 풀 메타데이터 (source/fetchedAt 포함) + Firestore 6h 캐시
 *   - getUsdToKrw({cap}) — 쿠폰 보호용 cap 적용 — legacy
 *   - getUsdToKrwRaw() — 결제 KRW 환산용 — floor 1450 적용 (운영자 정책 2026-05-13)
 *
 * 환율 정책 (운영자 결정 2026-05-13):
 *   - floor 1450 — live rate < 1450 → 1450 사용 (운영자 보호: USD 가격 underprice 방지)
 *   - 위로는 cap 없음 — live rate >= 1450 → live rate 그대로 (실시세 반영)
 *   - sanity max 2000 — fetch 오류로 비정상 spike (예: 5000) 차단
 *
 * API 호출 순서 (fallback chain):
 *   1. exchangerate-api.com (env EXCHANGE_RATE_API_KEY 사용 시 안정 — 1500 req/month 무료)
 *   2. exchangerate-api.com (open free tier, 키 없이)
 *   3. frankfurter.app (ECB 기반 무료, 평일만 갱신)
 *   4. Naver Finance scraping (의존성 없음, fragile)
 *   5. fallback hardcoded 1450 (마지막 안전망 — floor 와 동일)
 *
 * 캐시:
 *   - Firestore `system/exchange_rate` 도큐먼트
 *   - TTL 6h (fetchedAt 비교)
 *   - 캐시 만료/조회 실패 시 외부 API 호출 → 캐시 갱신
 */

// 운영자 정책 2026-05-13: floor 1450 (운영자 보호) + 위로는 실시세. sanity max 2000.
// 이전 (5/13 PR #386): cap 1500 (실시세 cap 위로 못 올라감) — 1492.50 실시세 시점 cap 99.5% 소진.
// 새 정책: live rate 가 1450 이하 (USD 강세 → KRW 약세 → 사용자 USD 가격이 underprice 보임) 만 floor 적용.
//          1450 위 (KRW 약세 → USD 가격 자연스럽게 비싸짐) 는 실시세 그대로 — 운영자 입장 정상.
const RATE_FLOOR = 1450;
const RATE_SANITY_MAX = 2000;
const FALLBACK_RATE = 1450;
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
    const ref = db.collection('system').doc('exchange_rate');
    // 급변 감지: 직전 캐시 rate 대비 3%+ 변화 시 운영자 알림 (가격·마케팅 타이밍 판단용).
    // floor 1450/sanity 2000 은 결제 보호일 뿐 "급변 사실"은 안 알려줌 → 여기서 통지. throttle 로 dedup.
    try {
      const prev = await ref.get();
      const prevRate = prev.exists ? Number(prev.data()?.krwPerUsd) : 0;
      if (prevRate > 0 && Number.isFinite(krwPerUsd) && krwPerUsd > 0) {
        const pct = (Math.abs(krwPerUsd - prevRate) / prevRate) * 100;
        if (pct >= 3) {
          const { throttledTelegramAlert } = await import('./_shared/telegram-throttle.js');
          await throttledTelegramAlert({
            key: 'fx-spike',
            message: `💱 환율 급변 감지\n직전 ₩${Math.round(prevRate)} → 현재 ₩${Math.round(krwPerUsd)} (${pct.toFixed(1)}% 변화)\nsource: ${source}\n→ USD 가격·마케팅 타이밍 점검 (floor/sanity 는 결제 보호용, 급변 통지는 별도)`,
            severity: pct >= 7 ? 'high' : 'medium',
          });
        }
      }
    } catch (alertErr) {
      console.warn('[exchange-rate] spike alert failed:', alertErr.message);
    }
    await ref.set({
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
 * floor/sanity 정책 적용 — 운영자 결정 2026-05-13.
 * live rate < RATE_FLOOR (1450) → RATE_FLOOR 사용
 * RATE_FLOOR <= live rate <= RATE_SANITY_MAX → live rate 그대로
 * live rate > RATE_SANITY_MAX (2000) → fetch 오류로 간주 → FALLBACK_RATE
 *
 * @param {number} rate live rate (외부 API 또는 캐시)
 * @returns {number} 정책 적용 환율
 */
export function applyRatePolicy(rate) {
  if (!Number.isFinite(rate) || rate <= 0) return FALLBACK_RATE;
  if (rate > RATE_SANITY_MAX) return FALLBACK_RATE; // 비정상 spike 차단
  if (rate < RATE_FLOOR) return RATE_FLOOR;          // floor 적용
  return rate;                                       // 실시세 그대로
}

/**
 * USD→KRW 환율 조회 (cap 적용 — legacy)
 * @param {{ cap?: number, timeout?: number }} opts
 * @returns {Promise<number>} 환율 (cap된 값)
 */
export async function getUsdToKrw(opts = {}) {
  const cap = opts.cap || RATE_SANITY_MAX; // mojibake guard 정책: nullish 대신 || (cap 은 항상 양수)
  try {
    const { krwPerUsd } = await getExchangeRate();
    if (krwPerUsd && krwPerUsd > 0) return Math.min(applyRatePolicy(krwPerUsd), cap);
  } catch (e) {
    console.warn('[exchange-rate] getUsdToKrw failed:', e.message);
  }
  return Math.min(FALLBACK_RATE, cap);
}

/**
 * USD→KRW 환율 조회 (booking-processor용 실제 환율 + floor 정책 적용).
 * 운영자 정책 2026-05-13: floor 1450 + 위로 실시세 그대로.
 * @returns {Promise<number>}
 */
export async function getUsdToKrwRaw() {
  try {
    const { krwPerUsd } = await getExchangeRate();
    if (krwPerUsd && krwPerUsd > 0) return applyRatePolicy(krwPerUsd);
  } catch (e) {
    console.warn('[exchange-rate] getUsdToKrwRaw failed:', e.message);
  }
  return FALLBACK_RATE;
}
