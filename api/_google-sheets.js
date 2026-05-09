/**
 * CocoTripKR — Google Sheets 연동 모듈
 *
 * Google Sheets API v4 (서비스 계정 인증)
 * 시트명: "코코트립 예약 관리"
 *
 * CONTEXT: CocoTripKR 자동화 유틸리티
 * ENV: GOOGLE_SHEETS_SPREADSHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_KEY
 */

// Google Sheets API - 서비스 계정 JWT 인증
// googleapis 패키지 없이 fetch + JWT로 직접 구현 (Netlify Functions 경량화)

const SHEETS_BASE_URL = 'https://sheets.googleapis.com/v4/spreadsheets';
const SHEET_NAME = '시트1';

// 컬럼 순서 (A~R)
const COLUMNS = [
  '예약일시',      // A
  '고객명',        // B
  '이메일',        // C
  '전화번호',      // D
  '상품',          // E
  '투어날짜',      // F
  '출발지',        // G
  '도착지',        // H
  '인원',          // I
  '차량',          // J
  '결제금액(USD)', // K
  '원화환산',      // L
  '쿠폰',          // M
  'PayPal거래ID',  // N
  '상태',          // O
  '드라이버',      // P
  '바우처발송',    // Q
  '메모',          // R
];

// B9-31 (2026-05-09): env 누락 시 1회만 info 로그 + caller 가 graceful skip 가능하도록
// SkippedError sentinel 던짐. 기존 throw 패턴은 booking-processor / daily-report 가
// catch 후 `err.message` 만 출력 → Vercel 로그에 매 호출마다 동일 메시지 누적되던 noise.
let _envWarnedOnce = false;
class SheetsEnvSkipped extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'SheetsEnvSkipped';
    this.skipped = true;
  }
}

// ── JWT 토큰 생성 (서비스 계정용) ──────────────────────────────────────
async function getAccessToken() {
  const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  // GOOGLE_PRIVATE_KEY: PEM key with literal \n (or base64 JSON fallback)
  let privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  if (!privateKey && process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    const keyJson = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf8'));
    privateKey = keyJson.private_key;
  }

  if (!serviceAccountEmail || !privateKey) {
    if (!_envWarnedOnce) {
      console.info('[google-sheets] env not configured — skipping (set GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY to enable)');
      _envWarnedOnce = true;
    }
    throw new SheetsEnvSkipped('google-sheets env missing');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: serviceAccountEmail,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  // Base64URL 인코딩
  const base64url = (obj) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');

  const signInput = `${base64url(header)}.${base64url(payload)}`;

  // Web Crypto API로 RS256 서명
  const pemContent = privateKey
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\n/g, '');
  const binaryKey = Uint8Array.from(atob(pemContent), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signInput)
  );

  const sigBase64 = Buffer.from(signature)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  const jwt = `${signInput}.${sigBase64}`;

  // JWT로 Access Token 교환
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error(`Google 토큰 발급 실패: ${JSON.stringify(tokenData)}`);
  }
  return tokenData.access_token;
}

// ── 예약 기록 추가 (행 추가) ──────────────────────────────────────────
/**
 * Google Sheets에 예약 정보 한 행 추가
 * @param {object} booking - 예약 데이터
 * @returns {object} API 응답
 */
export async function appendBooking(booking) {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!spreadsheetId) {
    if (!_envWarnedOnce) {
      console.info('[google-sheets] GOOGLE_SHEETS_SPREADSHEET_ID not set — skipping');
      _envWarnedOnce = true;
    }
    throw new SheetsEnvSkipped('GOOGLE_SHEETS_SPREADSHEET_ID missing');
  }

  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

  const row = [
    now,                                    // A: 예약일시
    booking.customerName || '',             // B: 고객명
    booking.customerEmail || '',            // C: 이메일
    booking.customerPhone || '',            // D: 전화번호
    booking.product || '',                  // E: 상품
    booking.tourDate || '',                 // F: 투어날짜
    booking.pickupLocation || '',           // G: 출발지
    booking.dropoffLocation || '',          // H: 도착지
    booking.paxCount || '',                 // I: 인원
    booking.vehicleType || '',              // J: 차량
    booking.amountUSD || '',                // K: 결제금액(USD)
    booking.amountKRW || '',                // L: 원화환산
    booking.couponApplied || '없음',        // M: 쿠폰
    booking.transactionId || '',            // N: PayPal거래ID
    '대기',                                 // O: 상태
    '',                                     // P: 드라이버 (미배정)
    '미발송',                               // Q: 바우처발송
    booking.memo || '',                     // R: 메모
  ];

  const accessToken = await getAccessToken();
  const range = `${SHEET_NAME}!A:R`;

  const res = await fetch(
    `${SHEETS_BASE_URL}/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: [row] }),
    }
  );

  const data = await res.json();
  if (data.error) throw new Error(`Sheets 추가 실패: ${data.error.message}`);
  console.log('[google-sheets] 예약 기록 추가 완료:', data.updates?.updatedRange);
  return data;
}

// ── 예약 상태 업데이트 ──────────────────────────────────────────────────
/**
 * PayPal 거래ID로 행을 찾아 상태 업데이트
 * @param {string} transactionId - PayPal 거래ID
 * @param {string} status - '확정'|'완료'|'취소'|'대기'
 * @returns {boolean}
 */
export async function updateBookingStatus(transactionId, status) {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!spreadsheetId) {
    if (!_envWarnedOnce) {
      console.info('[google-sheets] GOOGLE_SHEETS_SPREADSHEET_ID not set — skipping');
      _envWarnedOnce = true;
    }
    throw new SheetsEnvSkipped('GOOGLE_SHEETS_SPREADSHEET_ID missing');
  }

  const accessToken = await getAccessToken();
  const range = `${SHEET_NAME}!A:R`;

  // 전체 데이터 읽기
  const readRes = await fetch(
    `${SHEETS_BASE_URL}/${spreadsheetId}/values/${encodeURIComponent(range)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const readData = await readRes.json();
  const rows = readData.values || [];

  // N열(index 13) = PayPal거래ID로 행 찾기
  const rowIndex = rows.findIndex((row) => row[13] === transactionId);
  if (rowIndex === -1) {
    console.warn('[google-sheets] 거래ID를 찾을 수 없음:', transactionId);
    return false;
  }

  const updateRange = `${SHEET_NAME}!O${rowIndex + 1}`;
  const updateRes = await fetch(
    `${SHEETS_BASE_URL}/${spreadsheetId}/values/${encodeURIComponent(updateRange)}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: [[status]] }),
    }
  );
  const updateData = await updateRes.json();
  if (updateData.error) throw new Error(`상태 업데이트 실패: ${updateData.error.message}`);
  console.log('[google-sheets] 상태 업데이트:', transactionId, '→', status);
  return true;
}

// ── 어제 예약 데이터 읽기 (일일 리포트용) ────────────────────────────────
/**
 * 어제 날짜의 예약 행들을 반환
 * @returns {Array} 예약 행 배열
 */
export async function getYesterdayBookings() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!spreadsheetId) {
    if (!_envWarnedOnce) {
      console.info('[google-sheets] GOOGLE_SHEETS_SPREADSHEET_ID not set — skipping');
      _envWarnedOnce = true;
    }
    throw new SheetsEnvSkipped('GOOGLE_SHEETS_SPREADSHEET_ID missing');
  }

  const accessToken = await getAccessToken();
  const range = `${SHEET_NAME}!A:R`;

  const res = await fetch(
    `${SHEETS_BASE_URL}/${spreadsheetId}/values/${encodeURIComponent(range)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const data = await res.json();
  const rows = data.values || [];

  // 어제 날짜 (KST)
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yDateStr = yesterday.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });

  // 헤더 제외, 어제 날짜 행만 필터
  return rows.slice(1).filter((row) => {
    const rowDate = row[0] || '';
    return rowDate.startsWith(yDateStr);
  });
}

// ── 오늘 투어 일정 읽기 ──────────────────────────────────────────────────
/**
 * 오늘 투어 날짜(F열)인 예약 목록
 * @returns {Array}
 */
export async function getTodayTours() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!spreadsheetId) {
    if (!_envWarnedOnce) {
      console.info('[google-sheets] GOOGLE_SHEETS_SPREADSHEET_ID not set — skipping');
      _envWarnedOnce = true;
    }
    throw new SheetsEnvSkipped('GOOGLE_SHEETS_SPREADSHEET_ID missing');
  }

  const accessToken = await getAccessToken();
  const range = `${SHEET_NAME}!A:R`;

  const res = await fetch(
    `${SHEETS_BASE_URL}/${spreadsheetId}/values/${encodeURIComponent(range)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const data = await res.json();
  const rows = data.values || [];

  const todayStr = new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });

  return rows.slice(1).filter((row) => {
    const tourDate = row[5] || '';
    return tourDate.includes(todayStr) && (row[14] === '확정' || row[14] === '대기');
  });
}

// ── 내일 투어 일정 읽기 (날씨 확인용) ───────────────────────────────────
/**
 * 내일 투어 예약 목록
 * @returns {Array}
 */
export async function getTomorrowTours() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!spreadsheetId) {
    if (!_envWarnedOnce) {
      console.info('[google-sheets] GOOGLE_SHEETS_SPREADSHEET_ID not set — skipping');
      _envWarnedOnce = true;
    }
    throw new SheetsEnvSkipped('GOOGLE_SHEETS_SPREADSHEET_ID missing');
  }

  const accessToken = await getAccessToken();
  const range = `${SHEET_NAME}!A:R`;

  const res = await fetch(
    `${SHEETS_BASE_URL}/${spreadsheetId}/values/${encodeURIComponent(range)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const data = await res.json();
  const rows = data.values || [];

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });

  return rows.slice(1).filter((row) => {
    const tourDate = row[5] || '';
    return tourDate.includes(tomorrowStr) && (row[14] === '확정' || row[14] === '대기');
  });
}

// ── 이번 주 총 매출 ──────────────────────────────────────────────────────
/**
 * 이번 주 예약 데이터로 집계 반환
 * @returns {object} { totalUSD, count, byProduct }
 */
export async function getWeekSummary() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!spreadsheetId) {
    if (!_envWarnedOnce) {
      console.info('[google-sheets] GOOGLE_SHEETS_SPREADSHEET_ID not set — skipping');
      _envWarnedOnce = true;
    }
    throw new SheetsEnvSkipped('GOOGLE_SHEETS_SPREADSHEET_ID missing');
  }

  const accessToken = await getAccessToken();
  const range = `${SHEET_NAME}!A:R`;

  const res = await fetch(
    `${SHEETS_BASE_URL}/${spreadsheetId}/values/${encodeURIComponent(range)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const data = await res.json();
  const rows = data.values || [];

  // 이번 주 월요일 기준
  const now = new Date();
  const dayOfWeek = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  monday.setHours(0, 0, 0, 0);

  const weekRows = rows.slice(1).filter((row) => {
    const rowDateStr = row[0] || '';
    // 날짜 파싱 시도
    try {
      const rowDate = new Date(rowDateStr);
      return rowDate >= monday;
    } catch {
      return false;
    }
  });

  const totalUSD = weekRows.reduce((sum, row) => sum + (parseFloat(row[10]) || 0), 0);
  const byProduct = {};
  weekRows.forEach((row) => {
    const product = row[4] || '기타';
    if (!byProduct[product]) byProduct[product] = { count: 0, totalUSD: 0 };
    byProduct[product].count += 1;
    byProduct[product].totalUSD += parseFloat(row[10]) || 0;
  });

  return { totalUSD: totalUSD.toFixed(2), count: weekRows.length, byProduct };
}

// SkippedError sentinel — caller 가 env 누락(skipped) 과 실제 API 오류를 구분.
// `err instanceof SheetsEnvSkipped` 또는 `err?.skipped === true` 둘 다 가능.
export { SheetsEnvSkipped };

export default {
  appendBooking,
  updateBookingStatus,
  getYesterdayBookings,
  getTodayTours,
  getTomorrowTours,
  getWeekSummary,
  COLUMNS,
  SheetsEnvSkipped,
};
