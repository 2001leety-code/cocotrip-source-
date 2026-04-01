/**
 * CocoTripKR — 미예약 고객 재타겟팅 (스케줄 함수)
 *
 * 매일 오전 10:00 KST (= UTC 01:00) 실행
 * Google Sheets에서 상태가 '대기'이고 48시간 경과한 건을 찾아 이메일 발송
 *
 * CONTEXT: CocoTripKR 자동화 스케줄 함수
 * SCHEDULE: 0 1 * * * (UTC) = 매일 KST 10:00
 */

import { schedule } from '@netlify/functions';
import { sendRetargetingEmail } from './send-email.js';
import { sendMessage, sendErrorAlert } from './telegram.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const SHEETS_BASE_URL = 'https://sheets.googleapis.com/v4/spreadsheets';
const SHEET_NAME = '시트1';

// ── JWT 토큰 (google-sheets.js와 동일 로직) ──────────────────────────
async function getAccessToken() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!privateKey && process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    const keyJson = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf8'));
    privateKey = keyJson.private_key;
  }
  if (!email || !privateKey) throw new Error('Google 서비스 계정 미설정');

  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  const signInput = `${b64({alg:'RS256',typ:'JWT'})}.${b64({iss:email,scope:'https://www.googleapis.com/auth/spreadsheets',aud:'https://oauth2.googleapis.com/token',exp:now+3600,iat:now})}`;
  const pemContent = privateKey.replace('-----BEGIN PRIVATE KEY-----','').replace('-----END PRIVATE KEY-----','').replace(/\n/g,'');
  const binaryKey = Uint8Array.from(atob(pemContent), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey('pkcs8', binaryKey, {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'}, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signInput));
  const jwt = `${signInput}.${Buffer.from(sig).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'')}`;
  const res = await fetch('https://oauth2.googleapis.com/token', { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body: new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:jwt}) });
  const data = await res.json();
  if (!data.access_token) throw new Error('토큰 발급 실패');
  return data.access_token;
}

// ── AI 재타겟팅 이메일 생성 ────────────────────────────────────────────
async function generateRetargetEmail(booking) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: `You are a friendly travel consultant for CocoTripKR (cocotripkr.com).
Write a warm follow-up email to a customer who showed interest but hasn't booked yet.
Tone: friendly, not pushy. Mention their specific service interest.
Include a 10% early bird discount code: COCO10
Output JSON: { "subject": "...", "html": "...", "text": "..." }
HTML should be a complete styled email matching CocoTripKR brand (dark navy #1a1a2e, accent #E84B8A).`
  });
  const result = await model.generateContent(`Customer: ${booking.customerName || 'Guest'}, interested in: ${booking.product || 'Korea Tour'}, email: ${booking.customerEmail}`);
  const text = result.response.text();
  const match = text.match(/\{[\s\S]*\}/);
  return match ? JSON.parse(match[0]) : null;
}

// ── 메인 핸들러 ──────────────────────────────────────────────────────
const retargetTask = async () => {
  console.log('[retarget] 재타겟팅 스케줄 시작');

  try {
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
    if (!spreadsheetId) { console.log('[retarget] SPREADSHEET_ID 미설정 — 종료'); return { statusCode: 200, body: 'skipped' }; }

    const accessToken = await getAccessToken();
    const res = await fetch(`${SHEETS_BASE_URL}/${spreadsheetId}/values/${encodeURIComponent(`${SHEET_NAME}!A:R`)}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const data = await res.json();
    const rows = data.values || [];

    const now = new Date();
    const HOURS_48 = 48 * 60 * 60 * 1000;

    // 헤더 제외, 상태가 '대기'이고 48시간 경과한 건
    const staleBookings = rows.slice(1).filter(row => {
      const status = row[14] || '';
      const bookingDate = row[0] || '';
      if (status !== '대기') return false;
      try {
        const d = new Date(bookingDate);
        return (now - d) > HOURS_48;
      } catch { return false; }
    });

    if (staleBookings.length === 0) {
      console.log('[retarget] 재타겟팅 대상 없음');
      return { statusCode: 200, body: 'No targets' };
    }

    console.log(`[retarget] ${staleBookings.length}건 재타겟팅 대상 발견`);
    let sentCount = 0;

    for (const row of staleBookings.slice(0, 5)) { // 하루 최대 5건
      const email = row[2];
      const name = row[1] || 'Guest';
      const product = row[4] || 'Korea Tour';

      if (!email) continue;

      try {
        const emailContent = await generateRetargetEmail({ customerName: name, customerEmail: email, product });
        if (emailContent) {
          await sendRetargetingEmail(email, emailContent);
          sentCount++;
          console.log(`[retarget] 이메일 발송: ${email}`);
        }
      } catch (err) {
        console.error(`[retarget] 발송 실패 (${email}):`, err.message);
      }
    }

    await sendMessage(`📧 <b>재타겟팅 리포트</b>\n\n대상: ${staleBookings.length}건\n발송: ${sentCount}건\n할인코드: COCO10 적용`);
    return { statusCode: 200, body: `Sent ${sentCount} emails` };

  } catch (err) {
    console.error('[retarget] 오류:', err.message);
    try { await sendErrorAlert('retarget-scheduler', err); } catch {}
    return { statusCode: 500, body: err.message };
  }
};

export const handler = schedule('0 1 * * *', retargetTask);
