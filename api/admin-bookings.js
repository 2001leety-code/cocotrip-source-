/**
 * Vercel API Route: Admin Bookings List
 * GET /api/admin-bookings
 * Headers: Authorization: Bearer <Firebase-ID-token>
 *
 * Google Sheets 'Bookings' 시트에서 최근 예약 50건을 읽어 JSON으로 반환.
 * 인증: Firebase ID token (verifyIdToken) + ADMIN_EMAIL 검증.
 */
import { verifyAdminToken } from './_shared/admin-auth.js';
import { captureError } from './_shared/sentry.js';

// response.js는 CommonJS(module.exports) — Vercel ESM 런타임에서 named import 실패 사례 있어
// 단순 wrapper는 inline 정의로 의존 제거.
const _ok  = (data) => ({ ok: true, data });
const _err = (msg, code = 'UNKNOWN_ERROR') => ({ ok: false, error: msg, code });

export const config = { runtime: 'nodejs' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(res, status, body) {
  res.writeHead(status, { ...CORS, 'Content-Type': 'application/json' });
  return res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, CORS); return res.end(); }
  if (req.method !== 'GET') {
    return json(res, 405, _err('Method Not Allowed', 'METHOD_NOT_ALLOWED'));
  }

  const tokenAuth = await verifyAdminToken(req);
  if (!tokenAuth.ok) {
    return json(res, tokenAuth.status, { ok: false, error: tokenAuth.error, code: 'AUTH_FAILED' });
  }

  try {
    const { google } = await import('googleapis');
    const clientEmail = (process.env.GOOGLE_CLIENT_EMAIL || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();
    const privateKey = (process.env.GOOGLE_PRIVATE_KEY || process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '').replace(/\\n/g, '\n').trim();
    const sheetId = (process.env.GOOGLE_SHEETS_SPREADSHEET_ID || '').trim();

    if (!clientEmail || !privateKey || !sheetId) {
      return json(res, 500, _err('Google Sheets credentials not configured', 'CREDENTIALS_MISSING'));
    }

    const sheetsAuth = new google.auth.JWT(clientEmail, undefined, privateKey, [
      'https://www.googleapis.com/auth/spreadsheets.readonly',
    ]);
    const sheets = google.sheets({ version: 'v4', auth: sheetsAuth });

    // Bookings 시트에서 읽기 (A:Z 전체 범위)
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Bookings!A:Z',
    });

    const rows = response.data.values || [];
    if (rows.length < 2) {
      return json(res, 200, _ok({ bookings: [], total: 0 }));
    }

    // 첫 행 = 헤더, 나머지 = 데이터
    const headers = rows[0].map(h => h.toString().trim().toLowerCase());
    const dataRows = rows.slice(1);

    // 최신순 정렬 (마지막 행이 최신) → 역순으로 최대 50건
    const bookings = dataRows.slice(-50).reverse().map((row, idx) => {
      const obj = { id: `row-${dataRows.length - idx}` };
      headers.forEach((h, i) => {
        obj[h] = row[i] || '';
      });
      return obj;
    });

    return json(res, 200, _ok({ bookings, total: dataRows.length }));

  } catch (error) {
    console.error('[admin-bookings] Error:', error.message);
    await captureError(error, { route: '/api/admin-bookings', method: req.method });
    return json(res, 500, _err('Failed to fetch bookings', 'FETCH_ERROR'));
  }
}
