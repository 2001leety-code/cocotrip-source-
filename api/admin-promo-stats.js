/**
 * GET /api/admin-promo-stats
 *
 * 여름 이벤트 프로모션 쿠폰 현황 집계.
 *   - 쿠폰 종류별(AI무료·차터·투어) 발급 수·사용 수·사용률
 *   - 프로모션 KPI: 가입 수(onboardingCouponsIssued==true), AI무료 쿠폰 사용 수, 무료→유료 전환율
 *
 * Firestore collectionGroup 쿼리 (users/{uid}/coupons, source=='onboarding').
 * plans 컬렉션에서 isFreeCoupon==true 플랜 집계.
 *
 * Admin 인증 필수 (verifyAdminToken).
 */
import { initAdminDb } from './_shared/firebase-admin.js';
import { verifyAdminToken } from './_shared/admin-auth.js';
import { captureError } from './_shared/sentry.js';
import { buildAdminJsonCors } from './_shared/cors.js';
import { computeFreeToPaidConversion } from './_shared/funnel-conversion.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const JSON_HEADERS_STATIC = { 'Cache-Control': 'no-store' };
const CORS_METHODS = 'GET, OPTIONS';

export default async function handler(req, res) {
  const JSON_HEADERS = {
    ...JSON_HEADERS_STATIC,
    ...buildAdminJsonCors(req, { methods: CORS_METHODS, headers: 'Authorization' }),
  };

  if (req.method === 'OPTIONS') {
    res.writeHead(200, JSON_HEADERS);
    return res.end();
  }
  if (req.method !== 'GET') {
    res.writeHead(405, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'GET only' }));
  }

  const auth = await verifyAdminToken(req);
  if (!auth.ok) {
    res.writeHead(auth.status, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: auth.error }));
  }

  const db = initAdminDb();
  if (!db) {
    res.writeHead(503, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'Firestore 초기화 실패' }));
  }

  try {
    // ── 1. onboarding 쿠폰 집계 (collectionGroup) ──
    // source=='onboarding' 인 쿠폰 전체 조회
    const couponsSnap = await db.collectionGroup('coupons')
      .where('source', '==', 'onboarding')
      .get();

    // 종류별 집계 버킷
    const buckets = {
      'ai-plan':      { issued: 0, used: 0 },
      'charter':      { issued: 0, used: 0 },
      'tour-package': { issued: 0, used: 0 },
      other:          { issued: 0, used: 0 },
    };

    for (const doc of couponsSnap.docs) {
      const data = doc.data();
      const scope = data.productScope || 'other';
      const key = buckets[scope] ? scope : 'other';
      buckets[key].issued++;
      if (data.isUsed === true) buckets[key].used++;
    }

    // ── 2. 프로모션 KPI: 가입 수 (onboardingCouponsIssued==true) ──
    // 버그헌트 D fix (2026-06-27): 전수 .get() → .count() 집계(가입자 늘어도 문서 안 읽음 — 읽기비용·15s 타임아웃 방지).
    const usersCountSnap = await db.collection('users')
      .where('onboardingCouponsIssued', '==', true)
      .count().get();
    const promoSignups = usersCountSnap.data().count;

    // ── 3. AI 무료 쿠폰으로 결제된 플랜 수 ──
    // planPersister 가 isFreeCoupon:true + paymentSource:'ai-coupon' 로 저장한다고 가정.
    const freePlansSnap = await db.collection('plans')
      .where('isFreeCoupon', '==', true)
      .get();
    const freePlanCount = freePlansSnap.size;

    // ── 4. 무료쿠폰 사용률 (가입자 중 무료 플랜을 실제 생성한 비율) ──
    // 버그헌트 E fix (2026-06-27): 이전 이름 conversionRate + "무료→유료 전환율" 주석은 오해 소지였음.
    //   실제 계산은 freePlanCount/promoSignups = '쿠폰 사용률'이지 유료 전환율이 아님(유료 전환은 무료 사용 후
    //   별도 유료 결제한 uid 를 세야 함 — 미구현). 운영자 예산 오판 방지 위해 이름·주석 정정.
    const aiUsed = buckets['ai-plan'].used;
    const freePlanUsageRate = promoSignups > 0
      ? Math.round((freePlanCount / promoSignups) * 100)
      : 0;

    // ── 5. 최근 무료 플랜 5건 (최신순) ──
    const recentFreePlans = [];
    if (!freePlansSnap.empty) {
      // 버그헌트 B+C fix (2026-06-27):
      //   B) plans.createdAt 은 ISO 문자열(숫자는 createdAtMs). .toMillis()(Firestore Timestamp 전용)는
      //      문자열에서 undefined → 정렬 무효 + 시각 null 이었음 → createdAtMs 우선(없으면 ISO 파싱).
      //   C) 필드명을 실제 plans 스키마로 교정: guestEmail / input.regions[] / itinerary.days.length
      //      (top-level userEmail/region/days 는 존재하지 않아 전부 '-' 였음).
      const planMs = (x) => x.createdAtMs || (x.createdAt ? Date.parse(x.createdAt) : 0);
      const sorted = freePlansSnap.docs
        .filter(d => planMs(d.data()))
        .sort((a, b) => planMs(b.data()) - planMs(a.data()))
        .slice(0, 5);

      for (const doc of sorted) {
        const d = doc.data();
        recentFreePlans.push({
          planId: doc.id,
          userEmail: d.guestEmail || d.email || null,
          createdAt: planMs(d) || null,
          region: (Array.isArray(d.input?.regions) ? d.input.regions[0] : null) || d.input?.area || d.destination || null,
          days: (Array.isArray(d.itinerary?.days) ? d.itinerary.days.length : null) || d.input?.durationDays || null,
        });
      }
    }

    // ── 6. 무료→유료 전환율 7일·30일 (PR-C, 2026-07-11 마케팅 지시서) ──
    // 연결 키: 무료 플랜의 email(guestEmail/email) → 이후 CONFIRMED bookings 의
    //   userEmail/payerEmail (소문자 비교). bookings 문서엔 uid 가 없어 이메일 연결
    //   (docs/ANALYTICS-FUNNEL.md). 윈도우: 무료 플랜 생성 시각 기준 +7일/+30일 내 결제.
    // 채널 = booking.attribution.first.utm_source (P1 스냅샷 — 없으면 'direct'),
    // 상품 = productType. 최근 90일 bookings 만 조회(읽기 비용 cap).
    let conversion;
    try {
      const freePlans = freePlansSnap.docs.map((doc) => doc.data());
      let bookings = [];
      if (freePlans.length > 0) {
        const since = new Date(Date.now() - 90 * 24 * 3600 * 1000);
        const bookingsSnap = await db.collection('bookings')
          .where('createdAt', '>=', since).get();
        bookings = bookingsSnap.docs.map((bdoc) => {
          const b = bdoc.data();
          return {
            ...b,
            createdAtMs: b.createdAt && typeof b.createdAt.toMillis === 'function' ? b.createdAt.toMillis() : 0,
          };
        });
      }
      conversion = computeFreeToPaidConversion(freePlans, bookings);
    } catch (convErr) {
      // 전환 집계 실패는 나머지 통계를 막지 않음 (fail-open)
      console.warn('[admin-promo-stats] conversion 집계 실패:', convErr.message);
      conversion = { freeUserBase: 0, converted7d: 0, converted30d: 0, rate7d: 0, rate30d: 0, byChannel: {}, byProduct: {}, note: '집계 실패: ' + convErr.message };
    }

    const data = {
      // 쿠폰 현황
      coupons: {
        aiPlan:      { ...buckets['ai-plan'],      rate: pct(buckets['ai-plan']) },
        charter:     { ...buckets['charter'],      rate: pct(buckets['charter']) },
        tourPackage: { ...buckets['tour-package'], rate: pct(buckets['tour-package']) },
        total: {
          issued: couponsSnap.size,
          used: Object.values(buckets).reduce((s, b) => s + b.used, 0),
        },
      },
      // 프로모션 KPI
      kpi: {
        promoSignups,      // onboarding 쿠폰 발급된 가입자 수
        aiCouponUsed: aiUsed,    // AI 무료쿠폰 실제 사용 수
        freePlanCount,     // isFreeCoupon==true 플랜 수
        freePlanUsageRate, // 프로모션 가입자 중 무료플랜 생성률(%) — '유료 전환율' 아님(버그헌트 E)
      },
      recentFreePlans,
      // PR-C (2026-07-11): 무료→유료 전환 퍼널 — 채널·상품별 포함
      conversion,
      generatedAt: Date.now(),
    };

    res.writeHead(200, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: true, data }));
  } catch (err) {
    captureError(err, { endpoint: 'admin-promo-stats' });
    console.error('[admin-promo-stats] error:', err);
    res.writeHead(500, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: err.message || 'internal error' }));
  }
}

function pct(bucket) {
  return bucket.issued > 0 ? Math.round((bucket.used / bucket.issued) * 100) : 0;
}
