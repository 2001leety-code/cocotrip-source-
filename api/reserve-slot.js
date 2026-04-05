/**
 * Vercel API: Reserve Slot (임시 예약 잠금)
 * POST /api/reserve-slot
 *
 * Firestore Transaction으로 동시성 제어:
 * 1. availability/{date} 읽기
 * 2. 잔여 있으면 booked++ 및 reservations/{id} 생성 (5분 TTL)
 * 3. 없으면 거부
 */

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const DEFAULT_CAPACITY = {
  staria:   { total: 3 },
  sprinter: { total: 2 },
  bus:      { total: 1 },
};

const LOCK_TTL_MS = 5 * 60 * 1000; // 5분

async function getFirestoreAdmin() {
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');

  if (!getApps().length) {
    const serviceAccount = JSON.parse(
      Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '', 'base64').toString('utf8')
    );
    initializeApp({ credential: cert(serviceAccount) });
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

    const { date, vehicleType, userId } = body;

    if (!date || !vehicleType) {
      res.writeHead(400, { ...CORS, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, message: 'Missing date or vehicleType' }));
    }

    const capacity = DEFAULT_CAPACITY[vehicleType];
    if (!capacity) {
      res.writeHead(400, { ...CORS, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, message: `Unknown vehicle: ${vehicleType}` }));
    }

    const db = await getFirestoreAdmin();
    const { FieldValue } = await import('firebase-admin/firestore');
    const availRef = db.collection('availability').doc(date);
    const reservationId = `RSV-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // ── Firestore Transaction (동시성 제어) ──
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(availRef);
      const now = Date.now();

      let vehicleData;
      if (snap.exists) {
        vehicleData = snap.data().vehicles?.[vehicleType] || {
          total: capacity.total,
          booked: 0,
          bookings: [],
        };
      } else {
        vehicleData = {
          total: capacity.total,
          booked: 0,
          bookings: [],
        };
      }

      // 잔여 확인
      if (vehicleData.booked >= vehicleData.total) {
        return { success: false, message: `No ${vehicleType} available on ${date}` };
      }

      // 슬롯 예약
      vehicleData.booked += 1;
      vehicleData.bookings.push(reservationId);

      // availability 도큐먼트 업데이트
      const updateData = {
        date,
        [`vehicles.${vehicleType}`]: vehicleData,
        updatedAt: FieldValue.serverTimestamp(),
      };

      if (snap.exists) {
        tx.update(availRef, updateData);
      } else {
        tx.set(availRef, {
          date,
          vehicles: { [vehicleType]: vehicleData },
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      // reservation 도큐먼트 생성 (5분 TTL 잠금)
      const resRef = db.collection('reservations').doc(reservationId);
      tx.set(resRef, {
        date,
        vehicleType,
        userId: userId || 'guest',
        createdAt: now,
        expiresAt: now + LOCK_TTL_MS,
        status: 'locked',
      });

      return {
        success: true,
        reservationId,
        message: `Slot reserved for 5 minutes`,
        expiresAt: now + LOCK_TTL_MS,
      };
    });

    const statusCode = result.success ? 200 : 409;
    res.writeHead(statusCode, { ...CORS, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(result));

  } catch (err) {
    console.error('[reserve-slot] Error:', err);
    res.writeHead(500, { ...CORS, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: false, message: err.message }));
  }
}
