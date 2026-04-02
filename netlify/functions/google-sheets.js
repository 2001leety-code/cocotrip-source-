/**
 * CocoTripKR ??Google Sheets ?°ë™ ëª¨ë“ˆ
 *
 * Google Sheets API v4 (?œë¹„??ê³„ì • ?¸ì¦)
 * ?œíŠ¸ëª? "ì½”ì½”?¸ë¦½ ?ˆì•½ ê´€ë¦?
 *
 * CONTEXT: CocoTripKR ?ë™??? í‹¸ë¦¬í‹°
 * ENV: GOOGLE_SHEETS_SPREADSHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_KEY
 */

// Google Sheets API - ?œë¹„??ê³„ì • JWT ?¸ì¦
// googleapis ?¨í‚¤ì§€ ?†ì´ fetch + JWTë¡?ì§ì ‘ êµ¬í˜„ (Netlify Functions ê²½ëŸ‰??

const SHEETS_BASE_URL = 'https://sheets.googleapis.com/v4/spreadsheets';
const SHEET_NAME = '?œíŠ¸1';

// ì»¬ëŸ¼ ?œì„œ (A~R)
const COLUMNS = [
  '?ˆì•½?¼ì‹œ',      // A
  'ê³ ê°ëª?,        // B
  '?´ë©”??,        // C
  '?„í™”ë²ˆí˜¸',      // D
  '?í’ˆ',          // E
  '?¬ì–´? ì§œ',      // F
  'ì¶œë°œì§€',        // G
  '?„ì°©ì§€',        // H
  '?¸ì›',          // I
  'ì°¨ëŸ‰',          // J
  'ê²°ì œê¸ˆì•¡(USD)', // K
  '?í™”?˜ì‚°',      // L
  'ì¿ í°',          // M
  'PayPalê±°ëž˜ID',  // N
  '?íƒœ',          // O
  '?œë¼?´ë²„',      // P
  'ë°”ìš°ì²˜ë°œ??,    // Q
  'ë©”ëª¨',          // R
];

// ?€?€ JWT ? í° ?ì„± (?œë¹„??ê³„ì •?? ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
async function getAccessToken() {
  const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  // GOOGLE_PRIVATE_KEY: PEM key with literal \n (or base64 JSON fallback)
  let privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  if (!privateKey && process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    const keyJson = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf8'));
    privateKey = keyJson.private_key;
  }

  if (!serviceAccountEmail || !privateKey) {
    throw new Error('Google ?œë¹„??ê³„ì • ?˜ê²½ë³€?˜ê? ?¤ì •?˜ì? ?Šì•˜?µë‹ˆ??');
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

  // Base64URL ?¸ì½”??  const base64url = (obj) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');

  const signInput = `${base64url(header)}.${base64url(payload)}`;

  // Web Crypto APIë¡?RS256 ?œëª…
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

  // JWTë¡?Access Token êµí™˜
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
    throw new Error(`Google ? í° ë°œê¸‰ ?¤íŒ¨: ${JSON.stringify(tokenData)}`);
  }
  return tokenData.access_token;
}

// ?€?€ ?ˆì•½ ê¸°ë¡ ì¶”ê? (??ì¶”ê?) ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
/**
 * Google Sheets???ˆì•½ ?•ë³´ ????ì¶”ê?
 * @param {object} booking - ?ˆì•½ ?°ì´?? * @returns {object} API ?‘ë‹µ
 */
export async function appendBooking(booking) {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error('GOOGLE_SHEETS_SPREADSHEET_ID ë¯¸ì„¤??);

  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

  const row = [
    now,                                    // A: ?ˆì•½?¼ì‹œ
    booking.customerName || '',             // B: ê³ ê°ëª?    booking.customerEmail || '',            // C: ?´ë©”??    booking.customerPhone || '',            // D: ?„í™”ë²ˆí˜¸
    booking.product || '',                  // E: ?í’ˆ
    booking.tourDate || '',                 // F: ?¬ì–´? ì§œ
    booking.pickupLocation || '',           // G: ì¶œë°œì§€
    booking.dropoffLocation || '',          // H: ?„ì°©ì§€
    booking.paxCount || '',                 // I: ?¸ì›
    booking.vehicleType || '',              // J: ì°¨ëŸ‰
    booking.amountUSD || '',                // K: ê²°ì œê¸ˆì•¡(USD)
    booking.amountKRW || '',                // L: ?í™”?˜ì‚°
    booking.couponApplied || '?†ìŒ',        // M: ì¿ í°
    booking.transactionId || '',            // N: PayPalê±°ëž˜ID
    '?€ê¸?,                                 // O: ?íƒœ
    '',                                     // P: ?œë¼?´ë²„ (ë¯¸ë°°??
    'ë¯¸ë°œ??,                               // Q: ë°”ìš°ì²˜ë°œ??    booking.memo || '',                     // R: ë©”ëª¨
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
  if (data.error) throw new Error(`Sheets ì¶”ê? ?¤íŒ¨: ${data.error.message}`);
  console.log('[google-sheets] ?ˆì•½ ê¸°ë¡ ì¶”ê? ?„ë£Œ:', data.updates?.updatedRange);
  return data;
}

// ?€?€ ?ˆì•½ ?íƒœ ?…ë°?´íŠ¸ ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
/**
 * PayPal ê±°ëž˜IDë¡??‰ì„ ì°¾ì•„ ?íƒœ ?…ë°?´íŠ¸
 * @param {string} transactionId - PayPal ê±°ëž˜ID
 * @param {string} status - '?•ì •'|'?„ë£Œ'|'ì·¨ì†Œ'|'?€ê¸?
 * @returns {boolean}
 */
export async function updateBookingStatus(transactionId, status) {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error('GOOGLE_SHEETS_SPREADSHEET_ID ë¯¸ì„¤??);

  const accessToken = await getAccessToken();
  const range = `${SHEET_NAME}!A:R`;

  // ?„ì²´ ?°ì´???½ê¸°
  const readRes = await fetch(
    `${SHEETS_BASE_URL}/${spreadsheetId}/values/${encodeURIComponent(range)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const readData = await readRes.json();
  const rows = readData.values || [];

  // N??index 13) = PayPalê±°ëž˜IDë¡???ì°¾ê¸°
  const rowIndex = rows.findIndex((row) => row[13] === transactionId);
  if (rowIndex === -1) {
    console.warn('[google-sheets] ê±°ëž˜IDë¥?ì°¾ì„ ???†ìŒ:', transactionId);
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
  if (updateData.error) throw new Error(`?íƒœ ?…ë°?´íŠ¸ ?¤íŒ¨: ${updateData.error.message}`);
  console.log('[google-sheets] ?íƒœ ?…ë°?´íŠ¸:', transactionId, '??, status);
  return true;
}

// ?€?€ ?´ì œ ?ˆì•½ ?°ì´???½ê¸° (?¼ì¼ ë¦¬í¬?¸ìš©) ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
/**
 * ?´ì œ ? ì§œ???ˆì•½ ?‰ë“¤??ë°˜í™˜
 * @returns {Array} ?ˆì•½ ??ë°°ì—´
 */
export async function getYesterdayBookings() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error('GOOGLE_SHEETS_SPREADSHEET_ID ë¯¸ì„¤??);

  const accessToken = await getAccessToken();
  const range = `${SHEET_NAME}!A:R`;

  const res = await fetch(
    `${SHEETS_BASE_URL}/${spreadsheetId}/values/${encodeURIComponent(range)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const data = await res.json();
  const rows = data.values || [];

  // ?´ì œ ? ì§œ (KST)
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yDateStr = yesterday.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });

  // ?¤ë” ?œì™¸, ?´ì œ ? ì§œ ?‰ë§Œ ?„í„°
  return rows.slice(1).filter((row) => {
    const rowDate = row[0] || '';
    return rowDate.startsWith(yDateStr);
  });
}

// ?€?€ ?¤ëŠ˜ ?¬ì–´ ?¼ì • ?½ê¸° ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
/**
 * ?¤ëŠ˜ ?¬ì–´ ? ì§œ(F?????ˆì•½ ëª©ë¡
 * @returns {Array}
 */
export async function getTodayTours() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error('GOOGLE_SHEETS_SPREADSHEET_ID ë¯¸ì„¤??);

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
    return tourDate.includes(todayStr) && (row[14] === '?•ì •' || row[14] === '?€ê¸?);
  });
}

// ?€?€ ?´ì¼ ?¬ì–´ ?¼ì • ?½ê¸° (? ì”¨ ?•ì¸?? ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
/**
 * ?´ì¼ ?¬ì–´ ?ˆì•½ ëª©ë¡
 * @returns {Array}
 */
export async function getTomorrowTours() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error('GOOGLE_SHEETS_SPREADSHEET_ID ë¯¸ì„¤??);

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
    return tourDate.includes(tomorrowStr) && (row[14] === '?•ì •' || row[14] === '?€ê¸?);
  });
}

// ?€?€ ?´ë²ˆ ì£?ì´?ë§¤ì¶œ ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
/**
 * ?´ë²ˆ ì£??ˆì•½ ?°ì´?°ë¡œ ì§‘ê³„ ë°˜í™˜
 * @returns {object} { totalUSD, count, byProduct }
 */
export async function getWeekSummary() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error('GOOGLE_SHEETS_SPREADSHEET_ID ë¯¸ì„¤??);

  const accessToken = await getAccessToken();
  const range = `${SHEET_NAME}!A:R`;

  const res = await fetch(
    `${SHEETS_BASE_URL}/${spreadsheetId}/values/${encodeURIComponent(range)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const data = await res.json();
  const rows = data.values || [];

  // ?´ë²ˆ ì£??”ìš”??ê¸°ì?
  const now = new Date();
  const dayOfWeek = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  monday.setHours(0, 0, 0, 0);

  const weekRows = rows.slice(1).filter((row) => {
    const rowDateStr = row[0] || '';
    // ? ì§œ ?Œì‹± ?œë„
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
    const product = row[4] || 'ê¸°í?';
    if (!byProduct[product]) byProduct[product] = { count: 0, totalUSD: 0 };
    byProduct[product].count += 1;
    byProduct[product].totalUSD += parseFloat(row[10]) || 0;
  });

  return { totalUSD: totalUSD.toFixed(2), count: weekRows.length, byProduct };
}

export default {
  appendBooking,
  updateBookingStatus,
  getYesterdayBookings,
  getTodayTours,
  getTomorrowTours,
  getWeekSummary,
  COLUMNS,
};
