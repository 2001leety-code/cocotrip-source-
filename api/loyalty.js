/**
 * Vercel API: Loyalty System
 * POST /api/loyalty
 *
 * Actions:
 * - earn: 투어 완료 시 포인트 적립 + 등급 재계산
 * - spend: 포인트 사용 (결제 시)
 * - use-coupon: 쿠폰 사용 처리
 *
 * Firestore Transaction으로 포인트 정합성 보장
 */
import { initAdminDb } from './_shared/firebase-admin.js';
import { captureError } from './_shared/sentry.js';
import { verifyUserToken } from './_shared/user-auth.js';
// 운영자 테스트 결제 식별 SSOT — 매출 카운터와 동일 기준으로 포인트도 제외한다.
import { isAdminBypassOrderId } from './_shared/admin-bypass-detector.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

// ── 표준 응답 래퍼 ──────────────────────────────────────────────────
const _ok  = (data) => ({ ok: true, data });
const _err = (msg, code = 'UNKNOWN_ERROR') => ({ ok: false, error: msg, code });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const JSON_CORS = { ...CORS, 'Content-Type': 'application/json' };

// 등급 기준 & 적립률
const TIERS = [
  { name: 'Platinum', minSpent: 1000, minBookings: 15, earnRate: 0.03 },
  { name: 'Gold',     minSpent: 500,  minBookings: 7,  earnRate: 0.02 },
  { name: 'Silver',   minSpent: 200,  minBookings: 3,  earnRate: 0.015 },
  { name: 'Bronze',   minSpent: 0,    minBookings: 0,  earnRate: 0.01 },
];

function calculateTier(totalSpentUSD, bookingCount) {
  for (const t of TIERS) {
    if (totalSpentUSD >= t.minSpent || bookingCount >= t.minBookings) {
      return t;
    }
  }
  return TIERS[TIERS.length - 1];
}

// batch 9 fix (B9-3, 2026-05-09): 어드민 본인 매칭 — 쿠폰 무제한 사용 분기.
// ADMIN_BYPASS_EMAILS env 우선 (paymentGate.js 와 동일 source), 미설정 시 hardcoded fallback.
const HARDCODED_ADMIN_EMAILS = ['2001leety@gmail.com'];
function isAdminUser(userSnap) {
  const email = ((userSnap?.data?.()?.email) || '').toLowerCase().trim();
  if (!email) return false;
  const raw = (process.env.ADMIN_BYPASS_EMAILS || '').trim();
  const allowed = raw
    ? raw.split(',').map(e => e.toLowerCase().trim()).filter(Boolean)
    : HARDCODED_ADMIN_EMAILS;
  return allowed.includes(email);
}

async function getFirestoreAdmin() {
  const db = initAdminDb('loyalty');
  if (!db) throw new Error('No Firebase credentials found');
  return db;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, CORS);
    return res.end();
  }
  if (req.method !== 'POST') {
    res.writeHead(405, JSON_CORS);
    return res.end(JSON.stringify(_err('Method not allowed', 'METHOD_NOT_ALLOWED')));
  }

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};

    const { action } = body;

    if (!action) {
      res.writeHead(400, JSON_CORS);
      return res.end(JSON.stringify(_err('Missing action', 'MISSING_FIELDS')));
    }

    // 🔴 IDOR fix (보안): 신원(userId)을 액션별 신뢰 경계에 맞춰 해소한다.
    //   - earn: 내부 서비스 토큰 경로(아래 INTERNAL_API_TOKEN 게이트). booking-processor 가
    //           결제 검증 후 "대상 게스트 uid" 를 body.userId 로 전달하므로 body.userId 사용.
    //   - 그 외(spend/use-coupon/earn-share/redeem-coupon): 클라이언트 호출 = 본인 코인/쿠폰만
    //           조작 가능해야 함. body.userId 신뢰 시 타인 uid 로 코인 탈취/쿠폰 소각(IDOR).
    //           verifyUserToken 의 auth.uid 로만 본인 문서 조작. (PR #418 "body 신뢰 종료" 패턴.)
    let userId;
    if (action === 'earn') {
      userId = body.userId;
      if (!userId) {
        res.writeHead(400, JSON_CORS);
        return res.end(JSON.stringify(_err('Missing userId', 'MISSING_FIELDS')));
      }
    } else {
      const auth = await verifyUserToken(req);
      if (!auth.ok) {
        res.writeHead(auth.status, JSON_CORS);
        return res.end(JSON.stringify(_err(auth.error, 'AUTH_REQUIRED')));
      }
      userId = auth.uid;
    }

    const db = await getFirestoreAdmin();
    const { FieldValue } = await import('firebase-admin/firestore');
    const userRef = db.collection('users').doc(userId);

    // ════════════════════════════════════════════════════════
    // ACTION: earn — 투어 완료 시 포인트 적립
    // ════════════════════════════════════════════════════════
    if (action === 'earn') {
      // 🔴 SAFETY (CRITICAL): earn = 코인 발급 경로 = 실 할인(돈). 인증 없이 amountUSD 를
      //   신뢰하면 외부에서 무제한 코인 minting → redeem-coupon 으로 할인쿠폰 교환 → 결제 할인.
      //   earn 은 서버(booking-processor)가 결제 검증 후 호출하는 신뢰 경로뿐이므로 내부 서비스
      //   토큰 필수. 토큰 미설정/불일치(외부 호출) = 403 (fail-closed).
      //   운영자 셋업: Vercel env INTERNAL_API_TOKEN 설정 후 fresh 배포 1회 필요(#754).
      const internalToken = (process.env.INTERNAL_API_TOKEN || '').trim();
      const reqToken = String(req.headers['x-internal-token'] || '').trim();
      if (!internalToken || reqToken !== internalToken) {
        res.writeHead(403, JSON_CORS);
        return res.end(JSON.stringify(_err('earn is internal-only', 'FORBIDDEN')));
      }
      const { bookingRef, description, captureId, ledgerKey } = body;
      const amountUSD = Number(body.amountUSD);
      if (!Number.isFinite(amountUSD) || amountUSD <= 0) {
        res.writeHead(400, JSON_CORS);
        return res.end(JSON.stringify(_err('Invalid amountUSD for earn', 'INVALID_AMOUNT')));
      }

      // 🔴 2026-07-28: 운영자 테스트 결제는 원장에서 제외한다.
      //   매출 카운터(api_stats)는 이미 같은 prefix 로 제외하고 있었는데 포인트만 빠져 있어
      //   운영자 테스트가 등급·코인을 올렸다. 같은 SSOT helper 로 통일.
      //   MANUAL- 은 실입금이므로 제외 대상이 아니다(helper 규약).
      if (isAdminBypassOrderId(bookingRef)) {
        console.log('[loyalty] earn skipped — admin/test order:', bookingRef);
        res.writeHead(200, JSON_CORS);
        return res.end(JSON.stringify(_ok({ skipped: 'admin-bypass or test order', earnedCoins: 0 })));
      }

      // 🔴 2026-07-28: 멱등. bookingRef 당 적립 1회.
      //   호출부(booking-processor)에 선점 마커가 있지만, 마커는 예약 처리 재시도 시
      //   해제되고 다른 호출부가 생기면 무방비다. 코인 발급은 돈이므로 발급 지점 자체가
      //   멱등이어야 한다 → pointHistory 문서 ID 를 bookingRef 로 고정해 트랜잭션 안에서
      //   존재 여부를 확인한다(같은 트랜잭션이라 동시 호출도 하나만 통과).
      // 🔴 2026-07-29: 멱등 키를 **PayPal orderID** 로 고정한다.
      //   이전엔 bookingRef(CT-YYYYMMDD-XXX)를 썼는데, 이 번호는 booking-processor 가
      //   호출마다 새로 만들 수 있다(externalBookingRef 미전달 시 generateBookingRef()).
      //   같은 결제를 재처리하면 다른 CT 번호 → 다른 문서 ID → **이중 적립**이 뚫린다.
      //   PayPal orderID 는 결제 1건에 영구 고정이라 멱등 키로 유일하게 안전하다.
      //   ledgerKey 미전달(레거시 호출)만 bookingRef 로 폴백한다.
      const idemSource = ledgerKey || bookingRef;
      const earnLogId = idemSource ? `earn_${String(idemSource).replace(/\//g, '_')}` : null;

      const result = await db.runTransaction(async (tx) => {
        if (earnLogId) {
          const dupRef = db.collection('users').doc(userId).collection('pointHistory').doc(earnLogId);
          const dupSnap = await tx.get(dupRef);
          if (dupSnap.exists) {
            const prev = dupSnap.data() || {};
            return { duplicate: true, earnedCoins: 0, alreadyEarnedCoins: prev.amount || 0 };
          }
        }
        const userSnap = await tx.get(userRef);
        if (!userSnap.exists) throw new Error('User not found');

        const userData = userSnap.data();
        const currentCoins = userData.tripCoins || 0;
        const currentSpent = userData.totalSpentUSD || 0;
        const currentCount = userData.bookingCount || 0;

        // 적립률 계산 (현재 등급 기준)
        const newSpent = currentSpent + amountUSD;
        const newCount = currentCount + 1;
        const newTier = calculateTier(newSpent, newCount);

        // 포인트 적립 (USD → coins, 1 USD = 100 coins 기준, earnRate 적용)
        const earnedCoins = Math.round(amountUSD * 100 * newTier.earnRate);
        const newBalance = currentCoins + earnedCoins;

        // 유저 업데이트
        tx.update(userRef, {
          tripCoins: newBalance,
          totalSpentUSD: newSpent,
          bookingCount: newCount,
          tier: newTier.name,
          tierUpdatedAt: FieldValue.serverTimestamp(),
        });

        // 포인트 이력 추가 — bookingRef 가 있으면 문서 ID 를 고정해 재호출이 덮어쓰기가
        // 되게 한다(새 문서 추가 = 이중 적립). bookingRef 가 없으면 기존대로 자동 ID.
        const logRef = earnLogId
          ? db.collection('users').doc(userId).collection('pointHistory').doc(earnLogId)
          : db.collection('users').doc(userId).collection('pointHistory').doc();
        tx.set(logRef, {
          type: 'earn',
          amount: earnedCoins,
          balance: newBalance,
          description: description || `Tour completed: $${amountUSD} (${newTier.name} ${(newTier.earnRate * 100).toFixed(1)}%)`,
          bookingRef: bookingRef || null,
          // 멱등 키(=PayPal orderID). 대사 시 결제 1건 ↔ 적립 1건을 이걸로 맞춘다.
          ledgerKey: idemSource || null,
          // 2026-07-29: 이 적립이 어느 PayPal capture 에서 나왔는지 남긴다.
          //   대사(reconciliation) 때 "결제 없는 적립"을 즉시 가려낼 수 있다.
          captureId: captureId || null,
          createdAt: Date.now(),
        });

        return {
          earnedCoins,
          newBalance,
          newTier: newTier.name,
          earnRate: newTier.earnRate,
          totalSpent: newSpent,
          bookingCount: newCount,
        };
      });

      console.log('[loyalty] earn:', result);
      res.writeHead(200, JSON_CORS);
      return res.end(JSON.stringify(_ok(result)));
    }

    // ════════════════════════════════════════════════════════
    // ACTION: spend — 결제 시 포인트 사용
    // ════════════════════════════════════════════════════════
    if (action === 'spend') {
      const { coins, description, couponId } = body;

      if (!coins || coins <= 0) {
        res.writeHead(400, JSON_CORS);
        return res.end(JSON.stringify(_err('Invalid coins amount', 'INVALID_AMOUNT')));
      }

      const result = await db.runTransaction(async (tx) => {
        const userSnap = await tx.get(userRef);
        if (!userSnap.exists) throw new Error('User not found');

        // batch 9 fix (B9-3): 어드민 본인은 쿠폰 isUsed 마킹 skip — 같은 쿠폰 무제한 재사용.
        // tripCoins 차감은 그대로 (쿠폰만 무제한, 포인트는 정상 차감).
        const isAdmin = isAdminUser(userSnap);

        const currentCoins = userSnap.data().tripCoins || 0;
        if (currentCoins < coins) throw new Error('Insufficient Trip Coins');

        const newBalance = currentCoins - coins;

        tx.update(userRef, { tripCoins: newBalance });

        // 쿠폰 ID가 함께 전달된 경우 isUsed 처리 — admin 은 skip.
        if (couponId && !isAdmin) {
          const couponRef = db.collection('users').doc(userId).collection('coupons').doc(couponId);
          tx.update(couponRef, {
            isUsed: true,
            usedAt: FieldValue.serverTimestamp(),
          });
        }

        const logRef = db.collection('users').doc(userId).collection('pointHistory').doc();
        tx.set(logRef, {
          type: 'spend',
          amount: -coins,
          balance: newBalance,
          description: description || `Used ${coins} Trip Coins${isAdmin ? ' (admin, coupon kept active)' : ''}`,
          createdAt: Date.now(),
        });

        return { spent: coins, newBalance, adminCouponKept: isAdmin };
      });

      res.writeHead(200, JSON_CORS);
      return res.end(JSON.stringify(_ok(result)));
    }

    // ════════════════════════════════════════════════════════
    // ACTION: use-coupon — 쿠폰 사용 처리
    // ════════════════════════════════════════════════════════
    if (action === 'use-coupon') {
      const { couponId } = body;

      if (!couponId) {
        res.writeHead(400, JSON_CORS);
        return res.end(JSON.stringify(_err('Missing couponId', 'MISSING_FIELDS')));
      }

      // batch 9 fix (B9-3): 어드민은 isUsed 마킹 skip + 감사 기록.
      const userSnap = await userRef.get();
      if (isAdminUser(userSnap)) {
        const adminEmail = (userSnap.data()?.email || '').toLowerCase().trim();
        console.log('[loyalty] ADMIN coupon use — isUsed skipped:', adminEmail, '| coupon:', couponId);
        // 비치명적 — 실패해도 200 OK
        db.collection('admin_coupon_audit').add({
          adminEmail,
          userId,
          couponId,
          action: 'use-coupon',
          usedAt: new Date().toISOString(),
        }).catch((e) => console.warn('[loyalty] admin_coupon_audit write failed:', e.message));
        res.writeHead(200, JSON_CORS);
        return res.end(JSON.stringify(_ok({ message: 'Admin coupon — isUsed not marked', admin: true })));
      }

      const couponRef = db.collection('users').doc(userId).collection('coupons').doc(couponId);
      await couponRef.update({
        isUsed: true,
        usedAt: FieldValue.serverTimestamp(),
      });

      res.writeHead(200, JSON_CORS);
      return res.end(JSON.stringify(_ok({ message: 'Coupon marked as used' })));
    }

    // ════════════════════════════════════════════════════════
    // ACTION: earn-share — 플랜 공유 시 보너스 코인 지급
    // 중복 방지: users/{uid}/shareRewards/{planId}
    // ════════════════════════════════════════════════════════
    if (action === 'earn-share') {
      const { planId, shareMethod } = body;
      const REWARD_COINS = 20;
      const DAILY_SHARE_LIMIT = 5;

      if (!planId) {
        res.writeHead(400, JSON_CORS);
        return res.end(JSON.stringify(_err('Missing planId for earn-share', 'MISSING_FIELDS')));
      }

      // 소유 플랜인지 검증 (타인 플랜 공유로 farming 방지)
      const planSnap = await db.collection('plans').doc(planId).get();
      if (!planSnap.exists) {
        res.writeHead(404, JSON_CORS);
        return res.end(JSON.stringify(_err('Plan not found', 'NOT_FOUND')));
      }
      const planData = planSnap.data();
      if (planData.uid !== userId) {
        res.writeHead(403, JSON_CORS);
        return res.end(JSON.stringify(_err('Not your plan', 'FORBIDDEN')));
      }

      const result = await db.runTransaction(async (tx) => {
        const rewardRef = db.collection('users').doc(userId)
          .collection('shareRewards').doc(planId);
        const rewardSnap = await tx.get(rewardRef);

        if (rewardSnap.exists) {
          return { alreadyRewarded: true, newBalance: null };
        }

        // ── P2-7: 일일 상한 체크 (UTC 자정 기준) ──
        const todayUTC = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
        const userSnap = await tx.get(userRef);
        const userData = userSnap.exists ? userSnap.data() : {};
        const currentCoins = userData.tripCoins || 0;
        const shareStats = userData.shareStats || {};

        // 날짜가 바뀌었으면 카운트 리셋
        const dailyDate = shareStats.dailyDate || '';
        const dailyCount = dailyDate === todayUTC ? (shareStats.dailyCount || 0) : 0;

        if (dailyCount >= DAILY_SHARE_LIMIT) {
          // 일일 한도 초과 — 중복 방지 마커는 생성하되 코인 0
          tx.set(rewardRef, {
            planId,
            rewardedAt: FieldValue.serverTimestamp(),
            coinsAwarded: 0,
            shareMethod: shareMethod || 'unknown',
            dailyLimitHit: true,
          });
          return { alreadyRewarded: false, newBalance: currentCoins, earnedCoins: 0, dailyLimitHit: true };
        }

        const newBalance = currentCoins + REWARD_COINS;

        // 유저 코인 증가 + 일일 카운트 업데이트
        if (userSnap.exists) {
          tx.update(userRef, {
            tripCoins: newBalance,
            shareStats: { dailyDate: todayUTC, dailyCount: dailyCount + 1 },
          });
        } else {
          tx.set(userRef, {
            tripCoins: REWARD_COINS,
            tier: 'Bronze',
            totalSpentUSD: 0,
            bookingCount: 0,
            shareStats: { dailyDate: todayUTC, dailyCount: 1 },
          });
        }

        // 중복 방지 마커 생성
        tx.set(rewardRef, {
          planId,
          rewardedAt: FieldValue.serverTimestamp(),
          coinsAwarded: REWARD_COINS,
          shareMethod: shareMethod || 'unknown',
        });

        // 포인트 이력 기록
        const logRef = db.collection('users').doc(userId)
          .collection('pointHistory').doc();
        tx.set(logRef, {
          type: 'earn',
          amount: REWARD_COINS,
          balance: newBalance,
          description: `Share bonus (plan ${planId.slice(0, 8)})`,
          createdAt: Date.now(),
        });

        return { alreadyRewarded: false, newBalance, earnedCoins: REWARD_COINS };
      });

      console.log('[loyalty] earn-share:', userId, planId, result);
      res.writeHead(200, JSON_CORS);
      return res.end(JSON.stringify(_ok(result)));
    }

    // ════════════════════════════════════════════════════════
    // ACTION: redeem-coupon — 코인 → 쿠폰 교환
    // ════════════════════════════════════════════════════════
    if (action === 'redeem-coupon') {
      const { coins } = body;

      // 2026-05-05 (운영자 정책): 모든 쿠폰 = percent type. AI 플래너 적용 거부
      // (digital product, applyPromoCode 의 productScope 가드).
      // Charter / Tour 만 적용 가능 — productScope 별 1장씩 발행.
      // 기존 fixed-USD 쿠폰 (legacy) 은 그대로 사용 가능 (호환성 유지).
      const REDEMPTION_TABLE = {
        500:  { percent: 5,  label: 'Trip Coins redemption — 5% OFF' },
        1000: { percent: 10, label: 'Trip Coins redemption — 10% OFF' },
        2000: { percent: 15, label: 'Trip Coins redemption — 15% OFF (Bonus)' },
      };

      const plan = REDEMPTION_TABLE[coins];
      if (!plan) {
        res.writeHead(400, JSON_CORS);
        return res.end(JSON.stringify(_err('Invalid redemption tier', 'INVALID_TIER')));
      }

      // 쿠폰 코드 생성 (6자, crypto 기반)
      const { randomBytes } = await import('crypto');
      const code = 'SAVE-' + randomBytes(3).toString('hex').toUpperCase();

      const result = await db.runTransaction(async (tx) => {
        const userSnap = await tx.get(userRef);
        if (!userSnap.exists) throw new Error('User not found');

        const currentCoins = userSnap.data().tripCoins || 0;
        if (currentCoins < coins) throw new Error('Insufficient Trip Coins');

        const newBalance = currentCoins - coins;

        // 1) 유저 코인 차감
        tx.update(userRef, { tripCoins: newBalance });

        // 2) 쿠폰 문서 생성 — percent type, productScope 미지정(차터/투어 모두 가능)
        //    AI 플래너 결제는 applyPromoCode 의 productScope 가드로 reject.
        const couponRef = db.collection('users').doc(userId).collection('coupons').doc();
        const now = Date.now();
        const expiresAt = now + 90 * 24 * 3600 * 1000;

        tx.set(couponRef, {
          code,
          type: 'percent',
          value: plan.percent,
          label: plan.label,
          minOrderUSD: 0,
          isUsed: false,
          expiresAt,
          createdAt: now,
          source: 'coin_redemption',
          coinsSpent: coins,
        });

        // 3) 포인트 이력
        const logRef = db.collection('users').doc(userId).collection('pointHistory').doc();
        tx.set(logRef, {
          type: 'spend',
          amount: -coins,
          balance: newBalance,
          description: `Redeemed ${coins} coins → ${plan.label}`,
          createdAt: now,
        });

        return { couponId: couponRef.id, code, percent: plan.percent, label: plan.label, expiresAt, newBalance };
      });

      console.log('[loyalty] redeem-coupon:', userId, result);
      res.writeHead(200, JSON_CORS);
      return res.end(JSON.stringify(_ok(result)));
    }

    // Unknown action
    res.writeHead(400, JSON_CORS);
    return res.end(JSON.stringify(_err(`Unknown action: ${action}`, 'UNKNOWN_ACTION')));

  } catch (err) {
    console.error('[loyalty] Error:', err);
    await captureError(err, { route: '/api/loyalty', method: req.method });
    res.writeHead(500, JSON_CORS);
    return res.end(JSON.stringify(_err(err.message, 'INTERNAL_ERROR')));
  }
}
