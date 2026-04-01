/**
 * CocoTripKR — 이메일 자동 발송 모듈
 *
 * Gmail SMTP (Nodemailer) 사용
 * ENV: GMAIL_USER, GMAIL_APP_PASSWORD
 *
 * CONTEXT: CocoTripKR 자동화 유틸리티
 * NOTE: Netlify Functions에서 nodemailer 사용 (npm install nodemailer 필요)
 */

import nodemailer from 'nodemailer';

// ── Gmail Transporter ──────────────────────────────────────────────────
function createTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;

  if (!user || !pass) {
    throw new Error('GMAIL_USER 또는 GMAIL_APP_PASSWORD 환경변수가 설정되지 않았습니다.');
  }

  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });
}

/**
 * 이메일 발송 (공통)
 * @param {object} mailOptions - { to, subject, html, text }
 * @returns {object} Nodemailer 응답
 */
export async function sendEmail({ to, subject, html, text, attachments = [] }) {
  const transporter = createTransporter();
  const from = `CocoTripKR <${process.env.GMAIL_USER}>`;

  const info = await transporter.sendMail({
    from,
    to,
    subject,
    text,
    html,
    attachments,
  });

  console.log('[send-email] 발송 성공:', info.messageId, '→', to);
  return info;
}

/**
 * 예약 확인 이메일 발송
 * @param {string} toEmail - 고객 이메일
 * @param {object} emailContent - AI가 생성한 { subject, html, text }
 * @param {string} voucherText - 바우처 텍스트 (fallback 첨부)
 * @param {Buffer|null} pdfBuffer - PDF 바우처 버퍼 (우선)
 * @param {string|null} walletUrl - Google Wallet 저장 링크
 */
export async function sendBookingConfirmation(toEmail, emailContent, voucherText, pdfBuffer = null, walletUrl = null) {
  const attachments = [];

  if (pdfBuffer) {
    attachments.push({
      filename:    'CocoTripKR_Voucher.pdf',
      content:     pdfBuffer,
      contentType: 'application/pdf',
    });
  } else if (voucherText) {
    attachments.push({
      filename:    'CocoTripKR_Voucher.txt',
      content:     voucherText,
      contentType: 'text/plain; charset=utf-8',
    });
  }

  // walletUrl이 있으면 이메일 HTML에 Wallet 버튼 삽입
  let finalHtml = emailContent.html;
  if (walletUrl && finalHtml) {
    const walletBtn = `
    <div style="text-align:center;margin:24px 0;">
      <a href="${walletUrl}" target="_blank"
         style="display:inline-block;background:#1a1a2e;color:#C4956A;text-decoration:none;
                font-weight:bold;font-size:14px;padding:14px 28px;border-radius:10px;
                letter-spacing:0.5px;">
        🎫 Add to Google Wallet
      </a>
      <p style="color:#9ca3af;font-size:11px;margin-top:8px;">Tap your pass on tour day — shows on lock screen automatically</p>
    </div>`;
    finalHtml = finalHtml.replace('</body>', `${walletBtn}</body>`);
  }

  return sendEmail({
    to:          toEmail,
    subject:     emailContent.subject,
    html:        finalHtml || emailContent.html,
    text:        emailContent.text,
    attachments,
  });
}

/**
 * 후기 요청 이메일 발송 (투어 완료 24시간 후)
 * @param {string} toEmail
 * @param {object} emailContent - AI가 생성한 { subject, html, text }
 */
export async function sendReviewRequest(toEmail, emailContent) {
  return sendEmail({
    to: toEmail,
    subject: emailContent.subject,
    html: emailContent.html,
    text: emailContent.text,
  });
}

/**
 * 재타겟팅 이메일 발송 (미예약 고객)
 * @param {string} toEmail
 * @param {object} emailContent
 */
export async function sendRetargetingEmail(toEmail, emailContent) {
  return sendEmail({
    to: toEmail,
    subject: emailContent.subject,
    html: emailContent.html,
    text: emailContent.text,
  });
}

/**
 * 기본 예약 확인 이메일 HTML 템플릿 (Gemini 호출 없이 빠른 발송용)
 * @param {object} booking
 * @param {string|null} walletUrl - Google Wallet 링크 (선택)
 * @returns {object} { subject, html, text }
 */
/**
 * AI 플래너 일정을 이메일 HTML로 렌더링
 * @param {Array} itinerary - DayItinerary[] 배열
 * @returns {string} HTML 문자열
 */
function renderItineraryHTML(itinerary) {
  if (!itinerary || !Array.isArray(itinerary) || itinerary.length === 0) return '';

  let html = `
    <div style="margin:28px 0;border-top:2px solid #C4956A;padding-top:20px;">
      <h2 style="color:#1a1a2e;margin:0 0 16px;font-size:18px;text-align:center;">🗺️ Your Travel Itinerary</h2>`;

  for (const day of itinerary) {
    html += `
      <div style="margin-bottom:20px;">
        <div style="background:#1a1a2e;color:#C4956A;padding:10px 16px;border-radius:8px 8px 0 0;font-weight:bold;font-size:14px;">
          📅 Day ${day.day}${day.date ? ` — ${day.date}` : ''}
        </div>
        <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;padding:12px 16px;">`;

    if (day.places && Array.isArray(day.places)) {
      for (let i = 0; i < day.places.length; i++) {
        const place = day.places[i];
        const num = i + 1;
        const isLast = i === day.places.length - 1;

        html += `
          <div style="display:flex;align-items:flex-start;gap:10px;${!isLast ? 'margin-bottom:12px;padding-bottom:12px;border-bottom:1px dashed #e5e7eb;' : ''}">
            <div style="min-width:28px;height:28px;background:${num === 1 ? '#10b981' : isLast ? '#ef4444' : '#7C5CFC'};color:#fff;border-radius:50%;text-align:center;line-height:28px;font-size:12px;font-weight:bold;">${num}</div>
            <div style="flex:1;">
              <p style="margin:0;font-weight:bold;font-size:13px;color:#1a1a2e;">${place.name || place.ko || ''}</p>
              ${place.category ? `<span style="display:inline-block;background:#f3f4f6;color:#6b7280;font-size:11px;padding:2px 8px;border-radius:10px;margin-top:3px;">${place.category}</span>` : ''}
              ${place.duration ? `<span style="color:#9ca3af;font-size:11px;margin-left:6px;">⏱ ${place.duration}</span>` : ''}
              ${place.tips ? `<p style="margin:4px 0 0;font-size:11px;color:#6b7280;">💡 ${place.tips}</p>` : ''}
            </div>
          </div>`;

        // 이동 정보 표시
        if (!isLast && place.transport) {
          const t = place.transport;
          html += `
          <div style="text-align:center;padding:4px 0;margin-bottom:8px;">
            <span style="display:inline-block;background:#f0f0ff;color:#7C5CFC;font-size:10px;padding:3px 10px;border-radius:10px;">
              ${t.mode === 'walk' ? '🚶' : t.mode === 'transit' ? '🚇' : '🚗'} ${t.time || ''} ${t.distance ? `(${t.distance})` : ''}
            </span>
          </div>`;
        }
      }
    }

    // 식사 정보
    if (day.meals && Array.isArray(day.meals) && day.meals.length > 0) {
      html += `
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid #e5e7eb;">
          <p style="margin:0 0 6px;font-size:12px;font-weight:bold;color:#374151;">🍽️ Recommended Meals</p>`;
      for (const meal of day.meals) {
        html += `<p style="margin:2px 0;font-size:11px;color:#6b7280;">• <strong>${meal.type || ''}</strong>: ${meal.name || meal.restaurant || ''} ${meal.price ? `(${meal.price})` : ''}</p>`;
      }
      html += `</div>`;
    }

    // 데일리 팁
    if (day.dailyTips && Array.isArray(day.dailyTips) && day.dailyTips.length > 0) {
      html += `
        <div style="margin-top:8px;background:#fffbeb;border-radius:6px;padding:8px 12px;">
          <p style="margin:0;font-size:11px;color:#92400e;">💡 ${day.dailyTips.join(' | ')}</p>
        </div>`;
    }

    html += `
        </div>
      </div>`;
  }

  html += `</div>`;
  return html;
}

/**
 * AI 플래너 일정을 텍스트로 렌더링 (plain text 이메일용)
 * @param {Array} itinerary
 * @returns {string}
 */
function renderItineraryText(itinerary) {
  if (!itinerary || !Array.isArray(itinerary) || itinerary.length === 0) return '';

  let text = '\n━━━━━ YOUR TRAVEL ITINERARY ━━━━━\n\n';
  for (const day of itinerary) {
    text += `📅 Day ${day.day}${day.date ? ` — ${day.date}` : ''}\n`;
    text += '─────────────────────\n';
    if (day.places && Array.isArray(day.places)) {
      for (let i = 0; i < day.places.length; i++) {
        const p = day.places[i];
        text += `  ${i + 1}. ${p.name || p.ko || ''} ${p.category ? `[${p.category}]` : ''} ${p.duration ? `(${p.duration})` : ''}\n`;
        if (p.tips) text += `     💡 ${p.tips}\n`;
        if (!( i === day.places.length - 1) && p.transport) {
          const t = p.transport;
          text += `     → ${t.mode || ''} ${t.time || ''} ${t.distance ? `(${t.distance})` : ''}\n`;
        }
      }
    }
    if (day.meals && Array.isArray(day.meals)) {
      for (const m of day.meals) {
        text += `  🍽 ${m.type || ''}: ${m.name || m.restaurant || ''} ${m.price ? `(${m.price})` : ''}\n`;
      }
    }
    text += '\n';
  }
  return text;
}

export function buildDefaultConfirmationEmail(booking, walletUrl = null, itineraryData = null) {
  const subject = `[CocoTrip] Your Booking is Confirmed! 🎉 — ${booking.bookingRef || 'CT-' + Date.now()}`;

  const walletSection = walletUrl ? `
    <!-- Google Wallet 버튼 -->
    <div style="text-align:center;margin:28px 0;">
      <a href="${walletUrl}" target="_blank"
         style="display:inline-block;background:#1a1a2e;color:#C4956A;text-decoration:none;
                font-weight:bold;font-size:14px;padding:14px 32px;border-radius:10px;
                letter-spacing:0.5px;">🎫 Add to Google Wallet</a>
      <p style="color:#9ca3af;font-size:11px;margin-top:8px;">Shows on your lock screen automatically on tour day</p>
    </div>` : '';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Booking Confirmed — CocoTripKR</title>
</head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f3f4f6;">

  <!-- 헤더 -->
  <div style="background:#1a1a2e;border-radius:12px 12px 0 0;padding:28px 30px;text-align:center;">
    <h1 style="color:#C4956A;margin:0;font-size:26px;letter-spacing:2px;">COCOTRIPKR</h1>
    <p style="color:#aaa;margin:6px 0 0;font-size:12px;">Korea Private Tour & Transfer Service</p>
  </div>

  <div style="background:#fff;padding:30px;border-radius:0 0 12px 12px;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

    <p style="font-size:16px;margin-top:0;">Hi <strong>${booking.customerName || 'there'}</strong>, 안녕하세요!</p>
    <p style="color:#374151;">Your booking is confirmed. We're excited to take you on an amazing journey through Korea! 🇰🇷</p>

    <!-- 예약 요약 -->
    <div style="background:#eff6ff;border-left:4px solid #C4956A;border-radius:8px;padding:20px;margin:24px 0;">
      <h2 style="color:#1a1a2e;margin:0 0 14px;font-size:16px;">📋 Booking Summary</h2>
      <table style="width:100%;border-collapse:collapse;">
        <tr style="background:#f9fafb;"><td style="padding:7px 8px;color:#6b7280;width:130px;font-size:13px;">Service</td><td style="padding:7px 8px;font-weight:bold;font-size:13px;">${booking.product || '-'}</td></tr>
        <tr><td style="padding:7px 8px;color:#6b7280;font-size:13px;">Tour Date</td><td style="padding:7px 8px;font-weight:bold;font-size:13px;">${booking.tourDate || '-'}</td></tr>
        <tr style="background:#f9fafb;"><td style="padding:7px 8px;color:#6b7280;font-size:13px;">Pickup</td><td style="padding:7px 8px;font-size:13px;">${booking.pickupLocation || 'Hotel Lobby'}</td></tr>
        <tr><td style="padding:7px 8px;color:#6b7280;font-size:13px;">Party Size</td><td style="padding:7px 8px;font-size:13px;">${booking.paxCount || '-'} person(s)</td></tr>
        <tr style="background:#f9fafb;"><td style="padding:7px 8px;color:#6b7280;font-size:13px;">Amount Paid</td><td style="padding:7px 8px;font-weight:bold;color:#059669;font-size:13px;">$${booking.amountUSD || '0'} USD</td></tr>
        <tr><td style="padding:7px 8px;color:#6b7280;font-size:13px;">Booking Ref</td><td style="padding:7px 8px;font-family:monospace;font-size:13px;">${booking.bookingRef || '-'}</td></tr>
      </table>
    </div>

    ${walletSection}

    ${renderItineraryHTML(itineraryData)}

    <!-- 담당 드라이버 -->
    <div style="background:#f0fdf4;border-radius:8px;padding:18px;margin:20px 0;">
      <h3 style="color:#166534;margin:0 0 10px;font-size:14px;">🚐 Your Driver</h3>
      <p style="margin:0;font-size:15px;font-weight:bold;color:#1a1a2e;">Taeo</p>
      <p style="margin:6px 0 0;font-size:13px;color:#374151;">
        <a href="https://wa.me/821087140611" style="color:#25d366;text-decoration:none;font-weight:bold;">📱 WhatsApp: +82-10-8714-0611</a><br>
        <a href="mailto:cocotripkr@gmail.com" style="color:#6b7280;text-decoration:none;">✉️ cocotripkr@gmail.com</a>
      </p>
    </div>

    <!-- 안내사항 -->
    <h3 style="color:#374151;margin-top:22px;font-size:14px;">📌 Important Notes</h3>
    <ul style="color:#4b5563;line-height:2;font-size:13px;padding-left:20px;">
      <li>Please be ready <strong>10 minutes before</strong> pickup time</li>
      <li>Driver will hold a <strong>name sign</strong> at hotel lobby</li>
      <li>Contact driver via <strong>WhatsApp</strong> if needed</li>
    </ul>

    <!-- PDF 안내 -->
    <div style="background:#fafafa;border:1px dashed #d1d5db;border-radius:8px;padding:14px;margin:20px 0;text-align:center;">
      <p style="margin:0;color:#6b7280;font-size:12px;">📎 Your <strong>PDF Voucher</strong> is attached to this email.<br>Please show it to your driver on tour day.</p>
    </div>

    <!-- 푸터 -->
    <p style="text-align:center;color:#9ca3af;font-size:13px;margin-top:24px;">
      We can't wait to show you the best of Korea! 🎌<br>
      <a href="https://cocotripkr.com" style="color:#C4956A;text-decoration:none;font-weight:bold;">cocotripkr.com</a>
    </p>
  </div>
</body>
</html>`;

  const text = `Hi ${booking.customerName || 'there'},

Your CocoTripKR booking is confirmed!

Booking Ref:  ${booking.bookingRef || '-'}
Service:      ${booking.product || '-'}
Tour Date:    ${booking.tourDate || '-'}
Pickup:       ${booking.pickupLocation || 'Hotel Lobby'}
Party Size:   ${booking.paxCount || '-'} person(s)
Amount Paid:  $${booking.amountUSD || '0'} USD

Your Driver: Taeo
WhatsApp: +82-10-8714-0611
Email: cocotripkr@gmail.com

IMPORTANT:
- Please be ready 10 minutes before pickup time
- Driver will hold a name sign at hotel lobby
- Your PDF voucher is attached — show it on tour day
${walletUrl ? `
Google Wallet: ${walletUrl}
` : ''}${renderItineraryText(itineraryData)}
Need help? cocotripkr.com

CocoTripKR Team`;

  return { subject, html, text };
}

export default {
  sendEmail,
  sendBookingConfirmation,
  sendReviewRequest,
  sendRetargetingEmail,
  buildDefaultConfirmationEmail,
};
