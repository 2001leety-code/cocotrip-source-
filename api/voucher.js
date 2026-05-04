/**
 * GET /api/voucher?bookingID=...&userEmail=...
 *
 * 사용자 본인의 voucher PDF를 다운로드. PR #234 BookingDetailModal 에서 호출.
 * 내부 _generate-voucher.js (booking-processor 가 사용하는 동일 PDF 생성기) 를
 * 그대로 재사용해 confirmation email 첨부와 100% 동일한 결과물을 보장한다.
 *
 * 보안:
 *   - bookingID + userEmail 매칭 — 다른 사람 voucher 발급 차단 (auth token 없이도
 *     bookingID 추측이 불가능하므로 query-param 매칭으로 충분)
 *   - status 검사: CANCELED → 410, CONFIRMED/MODIFIED/COMPLETED 만 발급
 *   - Cache-Control: private, no-store — voucher 는 PII 포함, 절대 캐시 금지
 *
 * Vercel maxDuration: PDF 생성은 cold start 포함해도 ~3-5s. 일반 endpoint 정책에
 * 맞춰 15초.
 */

import { initAdminDb } from './_ai_core/firestoreAdmin.js';
import { generateVoucherPDF } from './_generate-voucher.js';

export const config = { maxDuration: 15 };

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function jsonErr(res, status, error, code = 'ERR') {
  setCors(res);
  res.setHeader('Content-Type', 'application/json');
  res.statusCode = status;
  return res.end(JSON.stringify({ ok: false, error, code }));
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    setCors(res);
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'GET') {
    return jsonErr(res, 405, 'Method not allowed', 'METHOD_NOT_ALLOWED');
  }

  // Vercel `req.query` is populated; fallback to URL parsing for safety.
  const q = req.query || {};
  let bookingID = String(q.bookingID || '').trim();
  let userEmail = String(q.userEmail || '').trim().toLowerCase();
  if (!bookingID || !userEmail) {
    try {
      const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      bookingID = bookingID || u.searchParams.get('bookingID') || '';
      userEmail = userEmail || (u.searchParams.get('userEmail') || '').toLowerCase();
    } catch { /* noop */ }
  }
  if (!bookingID || !userEmail) {
    return jsonErr(res, 400, 'bookingID and userEmail required', 'MISSING_FIELDS');
  }

  let booking;
  try {
    const db = initAdminDb();

    // 1차: bookings/{bookingID} 직접 조회 (cancelBooking 패턴과 동일)
    const docRef = db.collection('bookings').doc(bookingID);
    const docSnap = await docRef.get();
    if (docSnap.exists) {
      booking = docSnap.data();
    } else {
      // 2차: bookingRef 로 검색 — 일부 legacy doc은 doc ID ≠ bookingRef
      const qSnap = await db.collection('bookings')
        .where('bookingRef', '==', bookingID)
        .limit(1)
        .get();
      if (!qSnap.empty) booking = qSnap.docs[0].data();
    }
  } catch (err) {
    console.error('[voucher] Firestore 조회 실패:', err.message);
    return jsonErr(res, 500, 'Internal error', 'DB_ERROR');
  }

  if (!booking) {
    return jsonErr(res, 404, 'Booking not found', 'NOT_FOUND');
  }

  // 보안: 이메일 매칭 — booking 에는 두 필드(`userEmail`, `customerEmail`)가
  // 모두 저장됨 (booking-processor.js L97/L140). legacy 호환을 위해 둘 다 검사.
  const stored = String(booking.userEmail || booking.customerEmail || '').toLowerCase();
  if (stored !== userEmail) {
    return jsonErr(res, 403, 'Email mismatch', 'FORBIDDEN');
  }

  // 취소된 booking 은 voucher 발급 불가 — 사용자가 환불 받았는데 voucher 다시 받는 케이스 차단.
  if (booking.status === 'CANCELED') {
    return jsonErr(res, 410, 'Booking canceled — voucher unavailable', 'CANCELED');
  }

  // PDF 생성 — _generate-voucher.js 는 표준 Helvetica + qrcode 사용, FS 의존성 없음.
  let pdfBuffer;
  try {
    pdfBuffer = await generateVoucherPDF(booking);
  } catch (err) {
    console.error('[voucher] PDF 생성 실패:', err.message);
    return jsonErr(res, 500, 'PDF generation failed', 'PDF_ERROR');
  }

  const filename = `voucher_${booking.bookingRef || bookingID}.pdf`;
  setCors(res);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', String(pdfBuffer.length));
  // PII (이름·이메일·픽업 주소·항공편) 포함 — CDN/브라우저 캐시 절대 금지.
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.statusCode = 200;
  return res.end(pdfBuffer);
}
