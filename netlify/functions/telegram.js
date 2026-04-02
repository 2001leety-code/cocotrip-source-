/**
 * CocoTripKR ??Telegram Bot ?Œë¦¼ ëª¨ë“ˆ
 *
 * ?œì—°???”ë ˆê·¸ë¨?¼ë¡œ ?¤ì‹œê°??Œë¦¼ ?„ì†¡
 * ENV: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 *
 * CONTEXT: CocoTripKR ?ë™??? í‹¸ë¦¬í‹°
 */

const TELEGRAM_API = 'https://api.telegram.org';

/**
 * ?”ë ˆê·¸ë¨ ë©”ì‹œì§€ ?„ì†¡
 * @param {string} text - ë©”ì‹œì§€ ?ìŠ¤?? * @param {object} options - ì¶”ê? ?µì…˜
 * @returns {object} API ?‘ë‹µ
 */
export async function sendMessage(text, options = {}) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    console.error('[telegram] TELEGRAM_BOT_TOKEN ?ëŠ” TELEGRAM_CHAT_ID ë¯¸ì„¤??);
    throw new Error('Telegram ?˜ê²½ë³€?˜ê? ?¤ì •?˜ì? ?Šì•˜?µë‹ˆ??');
  }

  const payload = {
    chat_id: chatId,
    text,
    parse_mode: options.parseMode || 'HTML',  // HTML ?Œì‹± (êµµê²Œ, ?´íƒ¤ë¦???
    disable_web_page_preview: true,
    ...options,
  };

  const res = await fetch(`${TELEGRAM_API}/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!data.ok) {
    console.error('[telegram] ?„ì†¡ ?¤íŒ¨:', data);
    throw new Error(`Telegram ?„ì†¡ ?¤íŒ¨: ${data.description}`);
  }

  console.log('[telegram] ë©”ì‹œì§€ ?„ì†¡ ?±ê³µ, message_id:', data.result?.message_id);
  return data;
}

/**
 * ê¸?ë©”ì‹œì§€ë¥?4096???¨ìœ„ë¡?ë¶„í•  ?„ì†¡
 * @param {string} text
 */
export async function sendLongMessage(text) {
  const MAX_LEN = 4096;
  if (text.length <= MAX_LEN) {
    return sendMessage(text);
  }
  const parts = [];
  for (let i = 0; i < text.length; i += MAX_LEN) {
    parts.push(text.slice(i, i + MAX_LEN));
  }
  for (const part of parts) {
    await sendMessage(part);
    // ?°ì† ë©”ì‹œì§€ ?¬ì´ ì§§ì? ?œë ˆ??    await new Promise((r) => setTimeout(r, 300));
  }
}

/**
 * ???ˆì•½ ?Œë¦¼ (ë¹ ë¥¸ êµ¬ì¡°??ë²„ì „ ??Gemini ?†ì´)
 * @param {object} booking
 */
export async function sendBookingAlert(booking) {
  const kst = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const rate = booking.exchangeRate || 1380;
  const amountKRW = booking.amountKRW || Math.round(parseFloat(booking.amountUSD || 0) * rate);

  const msg = `?”” <b>???ˆì•½???¤ì–´?”ìŠµ?ˆë‹¤!</b>

?“‹ <b>?ˆì•½ ?•ë³´</b>
?â”?â”?â”?â”?â”?â”?â”??ê³ ê°ëª? ${booking.customerName || '-'}
?´ë©”?? ${booking.customerEmail || '-'}
?í’ˆ: ${booking.product || '-'}
? ì§œ: ${booking.tourDate || '-'}
?¸ì›: ${booking.paxCount || '-'}ëª?
?’° <b>ê²°ì œ ?•ë³´</b>
?â”?â”?â”?â”?â”?â”?â”??ê²°ì œ ê¸ˆì•¡: $${booking.amountUSD || '0'} USD
?í™” ?˜ì‚°: ??{amountKRW.toLocaleString()} (?˜ìœ¨ ${rate})
ì¿ í° ?ìš©: ${booking.couponApplied || '?†ìŒ'}
PayPal ê±°ë˜ID: <code>${booking.transactionId || '-'}</code>

?“Œ <b>?¤ìŒ ?¨ê³„</b>
- ë°”ìš°ì²?ë°œì†¡: ?ë™ ì²˜ë¦¬??- ?œë¼?´ë²„ ë°°ì •: ?•ì¸ ?„ìš”
- ê³ ê° ?•ì¸ ë©”ì‹œì§€: ?ë™ ë°œì†¡??
??${kst}`;

  return sendMessage(msg);
}

/**
 * ?ëŸ¬ ?Œë¦¼
 * @param {string} funcName - ?¨ìˆ˜ëª? * @param {Error} error
 */
export async function sendErrorAlert(funcName, error) {
  const kst = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const msg = `? ï¸ <b>?ë™???¤ë¥˜ ë°œìƒ</b>

?¨ìˆ˜: ${funcName}
?¤ë¥˜: ${error.message}
?œê°„: ${kst}

?˜ë™ ?•ì¸???„ìš”?©ë‹ˆ??`;

  return sendMessage(msg);
}

/**
 * ? ì”¨ ?•ìƒ ?Œë¦¼
 * @param {object} tourInfo
 * @param {object} weather
 */
export async function sendWeatherOkAlert(tourInfo, weather) {
  const msg = `?€ï¸?<b>?´ì¼ ? ì”¨ OK</b>

?¬ì–´: ${tourInfo.tourName || '-'}
ì§€?? ${tourInfo.region || '-'}
? ì”¨: ${weather.description || '-'} / ${weather.temperature || '-'}Â°C
?¹ì´?¬í•­: ?†ìŒ`;

  return sendMessage(msg);
}

export default {
  sendMessage,
  sendLongMessage,
  sendBookingAlert,
  sendErrorAlert,
  sendWeatherOkAlert,
};
