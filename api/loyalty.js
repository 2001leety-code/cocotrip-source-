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

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

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

async function getFirestoreAdmin() {
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');

  if (!getApps().length) {
    let credential = null;

    // 방법 1: ai-planner-full.js와 동일한 개별 환경변수 (권장)
    const projectId = (process.env.FIREBASE_PROJECT_ID || '').trim();
    const clientEmail = (process.env.FIREBASE_CLIENT_EMAIL || '').trim();
    let rawKey = (process.env.FIREBASE_PRIVATE_KEY || '')
      .replace(/^\uFEFF/, '')
      .replace(/^["']|["']$/g, '')
      .replace(/\\n/g, '\n')
      .trim();

    if (projectId && clientEmail && rawKey) {
      // PEM 키 정리 (ai-planner-full.js와 동일)
      const pemMatch = rawKey.match(/-----BEGIN[^-]*-----([^-]+)-----END[^-]*-----/s);
      if (pemMatch) {
        const base64Clean = pemMatch[1].replace(/\s+/g, '');
        const lines = base64Clean.match(/.{1,64}/g) || [];
        rawKey = '-----BEGIN PRIVATE KEY-----\n' + lines.join('\n') + '\n-----END PRIVATE KEY-----\n';
      }
      credential = cert({ projectId, clientEmail, privateKey: rawKey });
    }
    // 방법 2: base64 인코딩된 서비스 계정 JSON (폴백)
    else if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
      const serviceAccount = JSON.parse(
        Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf8')
      );
      credential = cert(serviceAccount);
    }

    if (!credential) throw new Error('No Firebase credentials found');
    initializeApp({ credential });
  }
  return getFirestore();
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, CORS);
    return res.end();
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { ...CORS, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};

    const { action, userId } = body;

    if (!action || !userId) {
      res.writeHead(400, { ...CORS, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Missing action or userId' }));
    }

    const db = await getFirestoreAdmin();
    const { FieldValue } = await import('firebase-admin/firestore');
    const userRef = db.collection('users').doc(userId);

    // ════════════════════════════════════════════════════════
    // ACTION: earn — 투어 완료 시 포인트 적립
    // ════════════════════════════════════════════════════════
    if (action === 'earn') {
      const { amountUSD, bookingRef, description } = body;

      if (!amountUSD) {
        res.writeHead(400, { ...CORS, 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Missing amountUSD for earn' }));
      }

      const result = await db.runTransaction(async (tx) => {
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

        // 포인트 이력 추가
        const logRef = db.collection('users').doc(userId).collection('pointHistory').doc();
        tx.set(logRef, {
          type: 'earn',
          amount: earnedCoins,
          balance: newBalance,
          description: description || `Tour completed: $${amountUSD} (${newTier.name} ${(newTier.earnRate * 100).toFixed(1)}%)`,
          bookingRef: bookingRef || null,
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
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, ...result }));
    }

    // ════════════════════════════════════════════════════════
    // ACTION: spend — 결제 시 포인트 사용
    // ════════════════════════════════════════════════════════
    if (action === 'spend') {
      const { coins, description, couponId } = body;

      if (!coins || coins <= 0) {
        res.writeHead(400, { ...CORS, 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Invalid coins amount' }));
      }

      const result = await db.runTransaction(async (tx) => {
        const userSnap = await tx.get(userRef);
        if (!userSnap.exists) throw new Error('User not found');

        const currentCoins = userSnap.data().tripCoins || 0;
        if (currentCoins < coins) throw new Error('Insufficient Trip Coins');

        const newBalance = currentCoins - coins;

        tx.update(userRef, { tripCoins: newBalance });

        // 쿠폰 ID가 함께 전달된 경우 isUsed 처리
        if (couponId) {
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
          description: description || `Used ${coins} Trip Coins`,
          createdAt: Date.now(),
        });

        return { spent: coins, newBalance };
      });

      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, ...result }));
    }

    // ════════════════════════════════════════════════════════
    // ACTION: use-coupon — 쿠폰 사용 처리
    // ════════════════════════════════════════════════════════
    if (action === 'use-coupon') {
      const { couponId } = body;

      if (!couponId) {
        res.writeHead(400, { ...CORS, 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Missing couponId' }));
      }

      const couponRef = db.collection('users').doc(userId).collection('coupons').doc(couponId);
      await couponRef.update({
        isUsed: true,
        usedAt: FieldValue.serverTimestamp(),
      });

      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, message: 'Coupon marked as used' }));
    }

    // ════════════════════════════════════════════════════════
    // ACTION: earn-share — 플랜 공유 시 보너스 코인 지급
    // 중복 방지: users/{uid}/shareRewards/{planId}
    // ════════════════════════════════════════════════════════
    if (action === 'earn-share') {
      const { planId, shareMethod } = body;
      const REWARD_COINS = 20;

      if (!planId) {
        res.writeHead(400, { ...CORS, 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Missing planId for earn-share' }));
      }

      // 소유 플랜인지 검증 (타인 플랜 공유로 farming 방지)
      const planSnap = await db.collection('plans').doc(planId).get();
      if (!planSnap.exists) {
        res.writeHead(404, { ...CORS, 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Plan not found' }));
      }
      const planData = planSnap.data();
      if (planData.uid !== userId) {
        res.writeHead(403, { ...CORS, 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Not your plan' }));
      }

      const result = await db.runTransaction(async (tx) => {
        const rewardRef = db.collection('users').doc(userId)
          .collection('shareRewards').doc(planId);
        const rewardSnap = await tx.get(rewardRef);

        if (rewardSnap.exists) {
          return { alreadyRewarded: true, newBalance: null };
        }

        const userSnap = await tx.get(userRef);
        const currentCoins = userSnap.exists ? (userSnap.data().tripCoins || 0) : 0;
        const newBalance = currentCoins + REWARD_COINS;

        // 유저 코인 증가 (유저 문서가 없으면 생성)
        if (userSnap.exists) {
          tx.update(userRef, { tripCoins: newBalance });
        } else {
          tx.set(userRef, {
            tripCoins: REWARD_COINS,
            tier: 'Bronze',
            totalSpentUSD: 0,
            bookingCount: 0,
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
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, ...result }));
    }

    // ════════════════════════════════════════════════════════
    // ACTION: redeem-coupon — 코인 → 쿠폰 교환
    // ════════════════════════════════════════════════════════
    if (action === 'redeem-coupon') {
      const { coins } = body;

      // 교환 레이트 테이블 (서버 신뢰 소스 — 클라이언트 값 무시)
      const REDEMPTION_TABLE = {
        500:  { usdValue: 5,  label: 'Trip Coins redemption — $5 OFF' },
        1000: { usdValue: 10, label: 'Trip Coins redemption — $10 OFF' },
        2000: { usdValue: 25, label: 'Trip Coins redemption — $25 OFF (Bonus)' },
      };

      const plan = REDEMPTION_TABLE[coins];
      if (!plan) {
        res.writeHead(400, { ...CORS, 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Invalid redemption tier' }));
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

        // 2) 쿠폰 문서 생성
        const couponRef = db.collection('users').doc(userId).collection('coupons').doc();
        const now = Date.now();
        const expiresAt = now + 90 * 24 * 3600 * 1000;

        tx.set(couponRef, {
          code,
          type: 'fixed',
          value: plan.usdValue,
          currency: 'USD',
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

        return { couponId: couponRef.id, code, value: plan.usdValue, expiresAt, newBalance };
      });

      console.log('[loyalty] redeem-coupon:', userId, result);
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, ...result }));
    }

    // Unknown action
    res.writeHead(400, { ...CORS, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: `Unknown action: ${action}` }));

  } catch (err) {
    console.error('[loyalty] Error:', err);
    res.writeHead(500, { ...CORS, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: err.message }));
  }
}
