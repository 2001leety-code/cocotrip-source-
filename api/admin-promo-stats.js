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
    const usersSnap = await db.collection('users')
      .where('onboardingCouponsIssued', '==', true)
      .get();
    const promoSignups = usersSnap.size;

    // ── 3. AI 무료 쿠폰으로 결제된 플랜 수 ──
    // planPersister 가 isFreeCoupon:true + paymentSource:'ai-coupon' 로 저장한다고 가정.
    const freePlansSnap = await db.collection('plans')
      .where('isFreeCoupon', '==', true)
      .get();
    const freePlanCount = freePlansSnap.size;

    // ── 4. 무료→유료 전환율 계산 ──
    // AI무료 쿠폰 사용자 중 이후 유료 플랜을 구매한 비율.
    // 단순화: 무료쿠폰 사용 수 대비 가입자(프로모션) 기준으로 산출.
    const aiUsed = buckets['ai-plan'].used;
    const conversionRate = promoSignups > 0
      ? Math.round((freePlanCount / promoSignups) * 100)
      : 0;

    // ── 5. 최근 무료 플랜 5건 (최신순) ──
    const recentFreePlans = [];
    if (!freePlansSnap.empty) {
      const sorted = freePlansSnap.docs
        .filter(d => d.data().createdAt)
        .sort((a, b) => {
          const ta = a.data().createdAt?.toMillis?.() || 0;
          const tb = b.data().createdAt?.toMillis?.() || 0;
          return tb - ta;
        })
        .slice(0, 5);

      for (const doc of sorted) {
        const d = doc.data();
        recentFreePlans.push({
          planId: doc.id,
          userEmail: d.userEmail || d.email || null,
          createdAt: d.createdAt?.toMillis?.() || null,
          region: d.region || d.destination || null,
          days: d.days || null,
        });
      }
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
        conversionRate,    // 프로모션 가입자 중 무료플랜 사용률(%)
      },
      recentFreePlans,
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
