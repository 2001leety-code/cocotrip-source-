/**
 * Vercel API: Check Availability
 * GET /api/check-availability?date=2026-05-01&vehicle=staria
 *
 * Firestore availability/{YYYY-MM-DD} 도큐먼트 조회
 * 없으면 기본 재고로 응답 (가용)
 */

import { initAdminDb } from './_shared/firebase-admin.js';
import { captureError } from './_shared/sentry.js';

export const maxDuration = 10;
export const config = { runtime: 'nodejs' };

// ── 표준 응답 래퍼 ──
const _ok  = (data) => ({ ok: true, data });
const _err = (msg, code = 'UNKNOWN_ERROR') => ({ ok: false, error: msg, code });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const JSON_CORS = { ...CORS, 'Content-Type': 'application/json' };

// 기본 재고 설정 (날짜별 도큐먼트가 없을 때)
const DEFAULT_CAPACITY = {
  staria:   { total: 3 },
  sprinter: { total: 2 },
  bus:      { total: 1 },
};

function getFirestoreAdmin() {
  const db = initAdminDb('check-availability');
  if (!db) throw new Error('Firestore unavailable — check FIREBASE_* env vars');
  return db;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, CORS);
    return res.end();
  }

  try {
    const { date, vehicle } = req.query;

    if (!date || !vehicle) {
      res.writeHead(400, JSON_CORS);
      return res.end(JSON.stringify(_err('Missing date or vehicle parameter', 'MISSING_FIELDS')));
    }

    const db = getFirestoreAdmin();
    const docRef = db.collection('availability').doc(date);
    const snap = await docRef.get();

    const capacity = DEFAULT_CAPACITY[vehicle];
    if (!capacity) {
      res.writeHead(400, JSON_CORS);
      return res.end(JSON.stringify(_err(`Unknown vehicle type: ${vehicle}`, 'INVALID_VEHICLE')));
    }

    let booked = 0;
    let total = capacity.total;

    if (snap.exists) {
      const data = snap.data();
      const vData = data.vehicles?.[vehicle];
      if (vData) {
        booked = vData.booked || 0;
        total = vData.total || capacity.total;
      }
    }

    const remaining = total - booked;

    res.writeHead(200, JSON_CORS);
    return res.end(JSON.stringify(_ok({
      available: remaining > 0,
      remaining,
      total,
      date,
      vehicle,
      message: remaining > 0
        ? `${remaining} ${vehicle}(s) available`
        : `Fully booked on ${date}`,
    })));

  } catch (err) {
    console.error('[check-availability] Error:', err);
    await captureError(err, { route: '/api/check-availability', method: req.method });
    res.writeHead(500, JSON_CORS);
    return res.end(JSON.stringify(_err(err.message, 'INTERNAL_ERROR')));
  }
}
