/**
 * CocoTripKR ???„ê¸° ?ë™ ?˜ì§‘ (?¤ì?ì¤??¨ìˆ˜)
 *
 * ë§¤ì¼ ?¤ì „ 11:00 KST (= UTC 02:00) ?¤í–‰
 * ?´ì œ ?„ë£Œ???¬ì–´ ê³ ê°?ê²Œ ?„ê¸° ?”ì²­ ?´ë©”???ë™ ë°œì†¡
 *
 * CONTEXT: CocoTripKR ?ë™???¤ì?ì¤??¨ìˆ˜
 * SCHEDULE: 0 2 * * * (UTC) = ë§¤ì¼ KST 11:00
 */

// import { schedule } from '@netlify/functions'; // DISABLED
import { sendReviewRequest } from './send-email.js';
import { sendMessage, sendErrorAlert } from './telegram.js';
import { generateReviewRequestEmail } from './ai-employees.js';
import { getYesterdayBookings } from './google-sheets.js';

const retargetTask = async () => {
  console.log('[review-scheduler] ?„ê¸° ?˜ì§‘ ?¤ì?ì¤??œì‘');

  try {
    const yesterdayRows = await getYesterdayBookings();

    // ?íƒœê°€ '?•ì •' ?ëŠ” '?„ë£Œ'??ê±´ë§Œ ?„ê¸° ?”ì²­
    const completedTours = yesterdayRows.filter(row => {
      const status = row[14] || '';
      return status === '?•ì •' || status === '?„ë£Œ';
    });

    if (completedTours.length === 0) {
      console.log('[review-scheduler] ?´ì œ ?„ë£Œ ?¬ì–´ ?†ìŒ');
      return { statusCode: 200, body: 'No completed tours' };
    }

    console.log(`[review-scheduler] ${completedTours.length}ê±??„ê¸° ?”ì²­ ?€??);
    let sentCount = 0;

    for (const row of completedTours) {
      const email = row[2];
      const name = row[1] || 'Guest';
      const product = row[4] || 'Korea Tour';
      const tourDate = row[5] || '';

      if (!email) continue;

      try {
        // AIë¡?ê°œì¸?”ëœ ?„ê¸° ?”ì²­ ?´ë©”???ì„±
        let emailContent;
        try {
          emailContent = await generateReviewRequestEmail({
            customerName: name,
            product,
            tourDate,
          });
        } catch (aiErr) {
          console.warn('[review-scheduler] AI ?´ë©”???ì„± ?¤íŒ¨, ê¸°ë³¸ ?œí”Œë¦??¬ìš©');
          emailContent = buildDefaultReviewEmail(name, product, tourDate);
        }

        await sendReviewRequest(email, emailContent);
        sentCount++;
        console.log(`[review-scheduler] ?„ê¸° ?”ì²­ ë°œì†¡: ${email}`);
      } catch (err) {
        console.error(`[review-scheduler] ë°œì†¡ ?¤íŒ¨ (${email}):`, err.message);
      }
    }

    await sendMessage(`â­?<b>?„ê¸° ?”ì²­ ë¦¬í¬??/b>\n\n?´ì œ ?„ë£Œ ?¬ì–´: ${completedTours.length}ê±?n?„ê¸° ?”ì²­ ë°œì†¡: ${sentCount}ê±?n\nGoogle ë¦¬ë·° + TripAdvisor ? ë„ ?¬í•¨`);
    return { statusCode: 200, body: `Sent ${sentCount} review requests` };

  } catch (err) {
    console.error('[review-scheduler] ?¤ë¥˜:', err.message);
    try { await sendErrorAlert('review-scheduler', err); } catch {}
    return { statusCode: 500, body: err.message };
  }
};

// ?€?€ ê¸°ë³¸ ?„ê¸° ?”ì²­ ?´ë©”???œí”Œë¦??€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
function buildDefaultReviewEmail(name, product, tourDate) {
  const subject = `How was your tour with CocoTripKR? ?‡°?‡·`;
  const html = `
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f3f4f6;">
  <div style="background:#1a1a2e;border-radius:12px 12px 0 0;padding:28px 30px;text-align:center;">
    <h1 style="color:#7C5CFC;margin:0;font-size:26px;letter-spacing:2px;">COCOTRIPKR</h1>
  </div>
  <div style="background:#fff;padding:30px;border-radius:0 0 12px 12px;">
    <p>Hi <strong>${name}</strong>,</p>
    <p>Thank you for choosing CocoTripKR for your <strong>${product}</strong> on ${tourDate}!</p>
    <p>We'd love to hear about your experience. Your feedback helps other travelers discover Korea!</p>
    
    <div style="text-align:center;margin:28px 0;">
      <a href="https://g.page/r/CocoTripKR/review" target="_blank"
         style="display:inline-block;background:#7C5CFC;color:#fff;text-decoration:none;font-weight:bold;font-size:14px;padding:14px 32px;border-radius:10px;">
        â­?Leave a Google Review
      </a>
    </div>
    
    <div style="text-align:center;margin:16px 0;">
      <a href="https://www.tripadvisor.com/UserReview" target="_blank"
         style="display:inline-block;background:#34e0a1;color:#1a1a2e;text-decoration:none;font-weight:bold;font-size:13px;padding:12px 28px;border-radius:10px;">
        ?“ Review on TripAdvisor
      </a>
    </div>
    
    <p style="color:#9ca3af;font-size:12px;text-align:center;margin-top:24px;">
      Your review means the world to us! ê°ì‚¬?©ë‹ˆ???™
    </p>
  </div>
</body></html>`;

  const text = `Hi ${name},\n\nThank you for your ${product} tour on ${tourDate}!\nWe'd love your feedback:\n\nGoogle Review: https://g.page/r/CocoTripKR/review\nTripAdvisor: https://www.tripadvisor.com/UserReview\n\nThank you! ??CocoTripKR Team`;

  return { subject, html, text };
}

// DISABLED: ë¹„ìš© ìµœì ?”ë? ?„í•´ ë¹„í™œ?±í™” (2026-04-02)
// export const handler = schedule('0 2 * * *', retargetTask);
export const handler = async () => ({ statusCode: 200, body: 'disabled' });
