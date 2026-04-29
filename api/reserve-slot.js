/**
 * Vercel API: Reserve Slot (임시 예약 잠금)
 * POST /api/reserve-slot
 *
 * Firestore Transaction으로 동시성 제어:
 * 1. availability/{date} 읽기
 * 2. 잔여 있으면 booked++ 및 reservations/{id} 생성 (5분 TTL)
 * 3. 없으면 거부
 */

import { initAdminDb } from './_shared/firebase-admin.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

// ── 표준 응답 래퍼 ──
const _ok  = (data) => ({ ok: true, data });
const _err = (msg, code = 'UNKNOWN_ERROR') => ({ ok: false, error: msg, code });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const JSON_CORS = { ...CORS, 'Content-Type': 'application/json' };

const DEFAULT_CAPACITY = {
  staria:   { total: 3 },
  sprinter: { total: 2 },
  bus:      { total: 1 },
};

const LOCK_TTL_MS = 5 * 60 * 1000; // 5분

function getFirestoreAdmin() {
  const db = initAdminDb('reserve-slot');
  if (!db) throw new Error('Firestore unavailable — check FIREBASE_* env vars');
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

    const { date, vehicleType, userId } = body;

    if (!date || !vehicleType) {
      res.writeHead(400, JSON_CORS);
      return res.end(JSON.stringify(_err('Missing date or vehicleType', 'MISSING_FIELDS')));
    }

    const capacity = DEFAULT_CAPACITY[vehicleType];
    if (!capacity) {
      res.writeHead(400, JSON_CORS);
      return res.end(JSON.stringify(_err(`Unknown vehicle: ${vehicleType}`, 'INVALID_VEHICLE')));
    }

    const db = getFirestoreAdmin();
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
        return { reserved: false, message: `No ${vehicleType} available on ${date}` };
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
        reserved: true,
        reservationId,
        message: `Slot reserved for 5 minutes`,
        expiresAt: now + LOCK_TTL_MS,
      };
    });

    const statusCode = result.reserved ? 200 : 409;
    res.writeHead(statusCode, JSON_CORS);
    return res.end(JSON.stringify(result.reserved ? _ok(result) : _err(result.message, 'SLOT_UNAVAILABLE')));

  } catch (err) {
    console.error('[reserve-slot] Error:', err);
    res.writeHead(500, JSON_CORS);
    return res.end(JSON.stringify(_err(err.message, 'INTERNAL_ERROR')));
  }
}
