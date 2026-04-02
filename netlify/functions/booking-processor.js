/**
 * CocoTripKR ???ˆì•½ ì²˜ë¦¬ ?¤ì??¤íŠ¸?ˆì´?? * POST /.netlify/functions/booking-processor
 *
 * capturePaypalOrder ?±ê³µ ???´ë??ìœ¼ë¡??¸ì¶œ?? * ?¤í–‰ ?œì„œ:
 *  1. Google Sheets???ˆì•½ ê¸°ë¡ ì¶”ê?
 *  2. USD/KRW ?˜ìœ¨ ì¡°íšŒ
 *  3. ?ˆì•½ ë²ˆí˜¸ ?ì„± (CT-YYYYMMDD-?œë²ˆ)
 *  4. Gemini 1?????”ë ˆê·¸ëž¨ ?Œë¦¼ ë©”ì‹œì§€ ?ì„±
 *  5. ?”ë ˆê·¸ëž¨ ???œì—°???Œë¦¼ ?„ì†¡
 *  6. Gemini 2?????•ì¸ ?´ë©”??+ ë°”ìš°ì²??ìŠ¤???ì„±
 *  7. Gmail ??ê³ ê° ?•ì¸ ?´ë©”??ë°œì†¡
 *  8. Google Sheets ?íƒœ ??'?•ì •' ?…ë°?´íŠ¸
 *
 * CONTEXT: CocoTripKR ?ë™??ë©”ì¸ ?¨ìˆ˜
 * ENV: ëª¨ë“  ê´€???˜ê²½ë³€???„ìš”
 */

import { appendBooking, updateBookingStatus } from './google-sheets.js';
import { sendBookingAlert, sendErrorAlert, sendMessage } from './telegram.js';
import { sendBookingConfirmation, buildDefaultConfirmationEmail } from './send-email.js';
import {
  generateBookingAlert,
  generateConfirmationEmail,
  generateVoucherText,
} from './ai-employees.js';
import { generateVoucherPDF } from './generate-voucher.js';
import { createWalletPass }   from './create-wallet-pass.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function respond(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

// ?€?€ ?ˆì•½ ë²ˆí˜¸ ?ì„± (CT-YYYYMMDD-?œë²ˆ) ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
function generateBookingRef() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const dateStr = kst.toISOString().slice(0, 10).replace(/-/g, '');
  const seq = Math.floor(Math.random() * 900) + 100; // 100~999
  return `CT-${dateStr}-${seq}`;
}

// ?€?€ ?˜ìœ¨ ì¡°íšŒ (exchangerate-api.com ë¬´ë£Œ ?Œëžœ) ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
async function getUSDKRWRate() {
  try {
    const res = await fetch(
      'https://api.exchangerate-api.com/v4/latest/USD',
      { signal: AbortSignal.timeout(5000) }
    );
    const data = await res.json();
    return data.rates?.KRW || 1380;
  } catch {
    return 1380; // ê¸°ë³¸ ?˜ìœ¨ fallback
  }
}

// ?€?€ ê³ ê° ?¸ì–´ ê°ì? (ê°„ë‹¨ ?´ë¦¬?¤í‹±) ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
function detectLanguage(email = '', name = '') {
  // ?´ë©”???„ë©”?¸ìœ¼ë¡??€??ì¶”ì •
  if (email.endsWith('.jp') || /[\u3040-\u30FF]/.test(name)) return 'ja';
  if (email.endsWith('.cn') || /[\u4E00-\u9FFF]/.test(name)) return 'zh';
  if (/[\uAC00-\uD7AF]/.test(name)) return 'ko';
  return 'en';
}

// ?€?€ ë©”ì¸ ?¸ë“¤???€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  let body;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }

  const {
    orderID,
    payerEmail,
    payerName,
    amount,     // USD amount string
    // ?ˆì•½ ?ì„¸ ?•ë³´ (?„ë¡ ?¸ì—???¨ê»˜ ?„ë‹¬)
    product,
    tourDate,
    pickupLocation,
    dropoffLocation,
    paxCount,
    vehicleType,
    customerPhone,
    couponApplied,
    memo,
    itineraryData,
  } = body;

  if (!orderID || !payerEmail) {
    return respond(400, { error: 'orderID?€ payerEmail?€ ?„ìˆ˜?…ë‹ˆ??' });
  }

  console.log('[booking-processor] ?ˆì•½ ì²˜ë¦¬ ?œìž‘:', { orderID, payerEmail, amount });

  const bookingRef = generateBookingRef();
  let exchangeRate = 1380;
  let amountKRW = 0;

  // ?€?€ Step 1: ?˜ìœ¨ ì¡°íšŒ ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
  try {
    exchangeRate = await getUSDKRWRate();
    amountKRW = Math.round(parseFloat(amount || 0) * exchangeRate);
    console.log('[booking-processor] ?˜ìœ¨:', exchangeRate, '??KRW:', amountKRW);
  } catch (err) {
    console.warn('[booking-processor] ?˜ìœ¨ ì¡°íšŒ ?¤íŒ¨, ê¸°ë³¸ê°??¬ìš©:', err.message);
  }

  const booking = {
    bookingRef,
    transactionId: orderID,
    customerName: payerName || 'Guest',
    customerEmail: payerEmail,
    customerPhone: customerPhone || '',
    product: product || 'ì½”ì½”?¸ë¦½ ?œë¹„??,
    tourDate: tourDate || 'ë¯¸ì •',
    pickupLocation: pickupLocation || '',
    dropoffLocation: dropoffLocation || '',
    paxCount: paxCount || 1,
    vehicleType: vehicleType || '?¤í?ë¦¬ì•„',
    amountUSD: parseFloat(amount || 0).toFixed(2),
    amountKRW,
    exchangeRate,
    couponApplied: couponApplied || '?†ìŒ',
    memo: memo || '',
  };

  const language = detectLanguage(payerEmail, payerName);
  const results = { bookingRef, steps: {} };

  // ?€?€ Step 2: Google Sheets ?ˆì•½ ê¸°ë¡ ì¶”ê? ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
  try {
    await appendBooking(booking);
    results.steps.sheets = 'ok';
    console.log('[booking-processor] Sheets ê¸°ë¡ ?„ë£Œ');
  } catch (err) {
    results.steps.sheets = `error: ${err.message}`;
    console.error('[booking-processor] Sheets ê¸°ë¡ ?¤íŒ¨:', err.message);
    // ë¹„ì¹˜ëª…ì  ?¤ë¥˜ ??ê³„ì† ì§„í–‰
  }

  // ?€?€ Step 3: ?”ë ˆê·¸ëž¨ ?Œë¦¼ ?„ì†¡ ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
  try {
    let telegramMsg;
    try {
      telegramMsg = await generateBookingAlert(booking);
    } catch (aiErr) {
      console.warn('[booking-processor] AI ?Œë¦¼ ?ì„± ?¤íŒ¨, ê¸°ë³¸ ?•ì‹ ?¬ìš©:', aiErr.message);
      telegramMsg = null;
    }
    if (telegramMsg) {
      await sendMessage(telegramMsg);
    } else {
      await sendBookingAlert(booking);
    }
    results.steps.telegram = 'ok';
    console.log('[booking-processor] ?”ë ˆê·¸ëž¨ ?Œë¦¼ ?„ì†¡ ?„ë£Œ');
  } catch (err) {
    results.steps.telegram = `error: ${err.message}`;
    console.error('[booking-processor] ?”ë ˆê·¸ëž¨ ?„ì†¡ ?¤íŒ¨:', err.message);
  }

  // ?€?€ Step 4: PDF ë°”ìš°ì²??ì„± ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
  let pdfBuffer = null;
  try {
    pdfBuffer = await generateVoucherPDF(booking);
    results.steps.pdf = 'ok';
    console.log('[booking-processor] PDF ë°”ìš°ì²??ì„± ?„ë£Œ, ?¬ê¸°:', pdfBuffer.length, 'bytes');
  } catch (err) {
    results.steps.pdf = `error: ${err.message}`;
    console.error('[booking-processor] PDF ?ì„± ?¤íŒ¨ (ê³„ì† ì§„í–‰):', err.message);
  }

  // ?€?€ Step 5: Google Wallet ?¨ìŠ¤ ?ì„± (?¹ì¸ ?„ë£Œ ???œì„±?? ?€?€?€?€?€?€?€?€?€?€?€?€?€
  let walletUrl = null;
  try {
    walletUrl = await createWalletPass(booking);
    results.steps.wallet = walletUrl ? 'ok' : 'skipped (credentials not set)';
    if (walletUrl) console.log('[booking-processor] Google Wallet ë§í¬ ?ì„± ?„ë£Œ');
  } catch (err) {
    results.steps.wallet = `error: ${err.message}`;
    console.error('[booking-processor] Wallet ?ì„± ?¤íŒ¨ (ê³„ì† ì§„í–‰):', err.message);
  }

  // ?€?€ Step 6: ê³ ê° ?•ì¸ ?´ë©”??ë°œì†¡ (PDF ì²¨ë? + Wallet ë§í¬) ?€?€?€?€?€?€?€?€?€?€?€
  try {
    let emailContent;
    let voucherText = '';
    try {
      [emailContent, voucherText] = await Promise.all([
        generateConfirmationEmail(booking, language),
        generateVoucherText(booking),
      ]);
    } catch (aiErr) {
      console.warn('[booking-processor] AI ?´ë©”???ì„± ?¤íŒ¨, ê¸°ë³¸ ?œí”Œë¦??¬ìš©:', aiErr.message);
      emailContent = buildDefaultConfirmationEmail(booking, walletUrl, itineraryData);
    }
    await sendBookingConfirmation(payerEmail, emailContent, voucherText, pdfBuffer, walletUrl);
    results.steps.email = 'ok';
    console.log('[booking-processor] ê³ ê° ?´ë©”??ë°œì†¡ ?„ë£Œ:', payerEmail);
  } catch (err) {
    results.steps.email = `error: ${err.message}`;
    console.error('[booking-processor] ?´ë©”??ë°œì†¡ ?¤íŒ¨:', err.message);
  }

  // ?€?€ Step 7: Google Sheets ?íƒœ '?•ì •'?¼ë¡œ ?…ë°?´íŠ¸ ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
  try {
    await updateBookingStatus(orderID, '?•ì •');
    results.steps.sheetsUpdate = 'ok';
  } catch (err) {
    results.steps.sheetsUpdate = `error: ${err.message}`;
    console.error('[booking-processor] ?íƒœ ?…ë°?´íŠ¸ ?¤íŒ¨:', err.message);
  }

  // ?€?€ ?¤ë¥˜ê°€ ?ˆì—ˆ?¤ë©´ ?œì—°?˜ê»˜ ?Œë¦¼ ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
  const failedSteps = Object.entries(results.steps)
    .filter(([, v]) => v.startsWith('error'))
    .map(([k, v]) => `${k}: ${v}`);

  if (failedSteps.length > 0) {
    try {
      await sendErrorAlert(
        'booking-processor',
        new Error(`?¼ë? ?¨ê³„ ?¤íŒ¨:\n${failedSteps.join('\n')}`)
      );
    } catch {}
  }

  console.log('[booking-processor] ?ˆì•½ ì²˜ë¦¬ ?„ë£Œ:', results);
  return respond(200, { success: true, bookingRef, steps: results.steps });
};

export default { handler };
