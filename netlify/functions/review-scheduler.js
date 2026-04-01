/**
 * CocoTripKR — 후기 자동 수집 (스케줄 함수)
 *
 * 매일 오전 11:00 KST (= UTC 02:00) 실행
 * 어제 완료된 투어 고객에게 후기 요청 이메일 자동 발송
 *
 * CONTEXT: CocoTripKR 자동화 스케줄 함수
 * SCHEDULE: 0 2 * * * (UTC) = 매일 KST 11:00
 */

import { schedule } from '@netlify/functions';
import { sendReviewRequest } from './send-email.js';
import { sendMessage, sendErrorAlert } from './telegram.js';
import { generateReviewRequestEmail } from './ai-employees.js';
import { getYesterdayBookings } from './google-sheets.js';

const retargetTask = async () => {
  console.log('[review-scheduler] 후기 수집 스케줄 시작');

  try {
    const yesterdayRows = await getYesterdayBookings();

    // 상태가 '확정' 또는 '완료'인 건만 후기 요청
    const completedTours = yesterdayRows.filter(row => {
      const status = row[14] || '';
      return status === '확정' || status === '완료';
    });

    if (completedTours.length === 0) {
      console.log('[review-scheduler] 어제 완료 투어 없음');
      return { statusCode: 200, body: 'No completed tours' };
    }

    console.log(`[review-scheduler] ${completedTours.length}건 후기 요청 대상`);
    let sentCount = 0;

    for (const row of completedTours) {
      const email = row[2];
      const name = row[1] || 'Guest';
      const product = row[4] || 'Korea Tour';
      const tourDate = row[5] || '';

      if (!email) continue;

      try {
        // AI로 개인화된 후기 요청 이메일 생성
        let emailContent;
        try {
          emailContent = await generateReviewRequestEmail({
            customerName: name,
            product,
            tourDate,
          });
        } catch (aiErr) {
          console.warn('[review-scheduler] AI 이메일 생성 실패, 기본 템플릿 사용');
          emailContent = buildDefaultReviewEmail(name, product, tourDate);
        }

        await sendReviewRequest(email, emailContent);
        sentCount++;
        console.log(`[review-scheduler] 후기 요청 발송: ${email}`);
      } catch (err) {
        console.error(`[review-scheduler] 발송 실패 (${email}):`, err.message);
      }
    }

    await sendMessage(`⭐ <b>후기 요청 리포트</b>\n\n어제 완료 투어: ${completedTours.length}건\n후기 요청 발송: ${sentCount}건\n\nGoogle 리뷰 + TripAdvisor 유도 포함`);
    return { statusCode: 200, body: `Sent ${sentCount} review requests` };

  } catch (err) {
    console.error('[review-scheduler] 오류:', err.message);
    try { await sendErrorAlert('review-scheduler', err); } catch {}
    return { statusCode: 500, body: err.message };
  }
};

// ── 기본 후기 요청 이메일 템플릿 ─────────────────────────────────────
function buildDefaultReviewEmail(name, product, tourDate) {
  const subject = `How was your tour with CocoTripKR? 🇰🇷`;
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
        ⭐ Leave a Google Review
      </a>
    </div>
    
    <div style="text-align:center;margin:16px 0;">
      <a href="https://www.tripadvisor.com/UserReview" target="_blank"
         style="display:inline-block;background:#34e0a1;color:#1a1a2e;text-decoration:none;font-weight:bold;font-size:13px;padding:12px 28px;border-radius:10px;">
        📝 Review on TripAdvisor
      </a>
    </div>
    
    <p style="color:#9ca3af;font-size:12px;text-align:center;margin-top:24px;">
      Your review means the world to us! 감사합니다 🙏
    </p>
  </div>
</body></html>`;

  const text = `Hi ${name},\n\nThank you for your ${product} tour on ${tourDate}!\nWe'd love your feedback:\n\nGoogle Review: https://g.page/r/CocoTripKR/review\nTripAdvisor: https://www.tripadvisor.com/UserReview\n\nThank you! — CocoTripKR Team`;

  return { subject, html, text };
}

export const handler = schedule('0 2 * * *', retargetTask);
