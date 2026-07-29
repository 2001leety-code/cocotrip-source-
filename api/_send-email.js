/**
 * CocoTripKR — 이메일 자동 발송 모듈
 *
 * Gmail SMTP (Nodemailer) 사용
 * ENV: GMAIL_USER, GMAIL_APP_PASSWORD
 *
 * CONTEXT: CocoTripKR 자동화 유틸리티
 * NOTE: Netlify Functions에서 nodemailer 사용 (npm install nodemailer 필요)
 *
 * Security (PR #421, Audit CZ2 — 2026-05-13): all user-controlled fields
 * (customerName, pickupLocation, product, itinerary place names / meals /
 * tips, etc.) MUST go through escapeHtml() before being interpolated into
 * the HTML body. Pre-fix, a booking with
 * `customerName: '<img src=x onerror=alert(1)>'` would template that tag
 * straight into the confirmation email — at minimum a layout bug,
 * potentially XSS in vulnerable clients, and a phishing payload vector.
 */

import nodemailer from 'nodemailer';
import { escapeHtml, escapeAttr } from './_shared/escape.js';
import { checkGmailQuota, incrementGmailSentCount, GMAIL_QUOTA_EXCEEDED } from './_shared/gmail-quota.js';

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
  // PR #447 (Audit Z-H8): pre-check daily Gmail quota. If we're past 96%
  // throw GMAIL_QUOTA_EXCEEDED so the caller (customer-email-trigger /
  // PR #439) routes the message into pending_email_retries for next-day
  // retry — without the guard we'd hit Gmail's hard cap, get a 24h
  // account lockout, and silently drop every outgoing email.
  const quotaCheck = await checkGmailQuota();
  if (!quotaCheck.ok && quotaCheck.code === GMAIL_QUOTA_EXCEEDED) {
    const err = new Error(`${GMAIL_QUOTA_EXCEEDED}: ${quotaCheck.count}/${quotaCheck.quota} today — deferring to next-day retry`);
    err.code = GMAIL_QUOTA_EXCEEDED;
    err.count = quotaCheck.count;
    err.quota = quotaCheck.quota;
    // 🔴 발송 시도 **전** 실패 = 메일이 나가지 않은 것이 확실 → 호출부가 안전하게 재시도 가능.
    err.preSend = true;
    throw err;
  }

  let transporter;
  try {
    transporter = createTransporter();
  } catch (e) {
    e.preSend = true;   // env 미설정 등 — 아직 아무것도 보내지 않았다.
    throw e;
  }
  const from = `CocoTripKR <${process.env.GMAIL_USER}>`;

  // ⚠️ 여기서부터는 실패해도 **보냈는지 알 수 없다**. SMTP 에는 멱등 키가 없어서
  //   서버가 이미 받았는지 확인할 방법이 없다 → 호출부는 함부로 재발송하면 안 된다.
  const info = await transporter.sendMail({
    from,
    to,
    subject,
    text,
    html,
    attachments,
  });

  console.log('[send-email] 발송 성공:', info.messageId, '→', to);

  // Best-effort: bump the daily counter + fire 80% warn alert at threshold.
  // Fire-and-forget — counter accuracy < deliverability.
  void incrementGmailSentCount();

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
    // walletUrl is server-generated (Google Wallet API) but escape defensively
    // — if a future caller passes user input, we still produce safe HTML.
    const walletBtn = `
    <div style="text-align:center;margin:24px 0;">
      <a href="${escapeAttr(walletUrl)}" target="_blank"
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
          📅 Day ${escapeHtml(day.day)}${day.date ? ` — ${escapeHtml(day.date)}` : ''}
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
              <p style="margin:0;font-weight:bold;font-size:13px;color:#1a1a2e;">${escapeHtml(place.name || place.ko || '')}</p>
              ${place.category ? `<span style="display:inline-block;background:#f3f4f6;color:#6b7280;font-size:11px;padding:2px 8px;border-radius:10px;margin-top:3px;">${escapeHtml(place.category)}</span>` : ''}
              ${place.duration ? `<span style="color:#9ca3af;font-size:11px;margin-left:6px;">⏱ ${escapeHtml(place.duration)}</span>` : ''}
              ${place.tips ? `<p style="margin:4px 0 0;font-size:11px;color:#6b7280;">💡 ${escapeHtml(place.tips)}</p>` : ''}
            </div>
          </div>`;

        // 이동 정보 표시
        if (!isLast && place.transport) {
          const t = place.transport;
          html += `
          <div style="text-align:center;padding:4px 0;margin-bottom:8px;">
            <span style="display:inline-block;background:#f0f0ff;color:#7C5CFC;font-size:10px;padding:3px 10px;border-radius:10px;">
              ${t.mode === 'walk' ? '🚶' : t.mode === 'transit' ? '🚇' : '🚗'} ${escapeHtml(t.time || '')} ${t.distance ? `(${escapeHtml(t.distance)})` : ''}
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
        html += `<p style="margin:2px 0;font-size:11px;color:#6b7280;">• <strong>${escapeHtml(meal.type || '')}</strong>: ${escapeHtml(meal.name || meal.restaurant || '')} ${meal.price ? `(${escapeHtml(meal.price)})` : ''}</p>`;
      }
      html += `</div>`;
    }

    // 데일리 팁
    if (day.dailyTips && Array.isArray(day.dailyTips) && day.dailyTips.length > 0) {
      html += `
        <div style="margin-top:8px;background:#fffbeb;border-radius:6px;padding:8px 12px;">
          <p style="margin:0;font-size:11px;color:#92400e;">💡 ${day.dailyTips.map(escapeHtml).join(' | ')}</p>
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

// 기본(폴백) 확인 이메일 4언어 사전 — Gemini 이메일 생성 실패 시에만 쓰이는 템플릿.
// 2026-07-17: 영어 하드코딩이던 것을 language 파라미터 기준 ko/en/ja/zh 로 교체.
// 신규 문자열은 4언어 동시 유지(CLAUDE.md). reconciliation 고지·Wallet 버튼은
// 드문 경로 + 법적 정밀성 사유로 영어 유지.
const FALLBACK_EMAIL_STR = {
  en: {
    subject: (ref) => `[CocoTrip] Your Booking is Confirmed! 🎉 — ${ref}`,
    tagline: 'Korea Private Tour & Transfer Service',
    greeting: (name) => `Hi <strong>${name}</strong>,`,
    intro: "Your booking is confirmed. We're excited to take you on an amazing journey through Korea! 🇰🇷",
    summaryTitle: '📋 Booking Summary',
    service: 'Service', tourDate: 'Tour Date', pickup: 'Pickup', partySize: 'Party Size',
    amountPaid: 'Amount Paid', bookingRefLabel: 'Booking Ref', persons: 'person(s)', hotelLobby: 'Hotel Lobby',
    driverTitle: '🚐 Your Driver',
    notesTitle: '📌 Important Notes',
    note1: 'Please be ready <strong>10 minutes before</strong> pickup time',
    note2: 'Driver will hold a <strong>name sign</strong> at hotel lobby',
    note3: 'Contact driver via <strong>WhatsApp</strong> if needed',
    pdfNote: '📎 Your <strong>PDF Voucher</strong> is attached to this email.<br>Please show it to your driver on tour day.',
    footer: "We can't wait to show you the best of Korea! 🎌",
    textGreeting: (name) => `Hi ${name},`,
    textConfirmed: 'Your CocoTripKR booking is confirmed!',
    textNotes: ['Please be ready 10 minutes before pickup time', 'Driver will hold a name sign at hotel lobby', 'Your PDF voucher is attached — show it on tour day'],
  },
  ko: {
    subject: (ref) => `[CocoTrip] 예약이 확정되었습니다! 🎉 — ${ref}`,
    tagline: '한국 프라이빗 투어 & 차량 서비스',
    greeting: (name) => `<strong>${name}</strong>님, 안녕하세요!`,
    intro: '예약이 확정되었습니다. 멋진 한국 여행을 함께하게 되어 기쁩니다! 🇰🇷',
    summaryTitle: '📋 예약 요약',
    service: '서비스', tourDate: '이용 날짜', pickup: '픽업', partySize: '인원',
    amountPaid: '결제 금액', bookingRefLabel: '예약 번호', persons: '명', hotelLobby: '호텔 로비',
    driverTitle: '🚐 담당 드라이버',
    notesTitle: '📌 안내사항',
    note1: '픽업 시간 <strong>10분 전</strong>까지 준비해 주세요',
    note2: '기사가 호텔 로비에서 <strong>이름 피켓</strong>을 들고 대기합니다',
    note3: '필요 시 <strong>WhatsApp</strong>으로 기사에게 연락하세요',
    pdfNote: '📎 <strong>PDF 바우처</strong>가 이 이메일에 첨부되어 있습니다.<br>투어 당일 기사에게 보여주세요.',
    footer: '한국의 가장 멋진 모습을 보여드리겠습니다! 🎌',
    textGreeting: (name) => `${name}님, 안녕하세요!`,
    textConfirmed: 'CocoTripKR 예약이 확정되었습니다!',
    textNotes: ['픽업 시간 10분 전까지 준비해 주세요', '기사가 호텔 로비에서 이름 피켓을 들고 대기합니다', 'PDF 바우처 첨부 — 투어 당일 보여주세요'],
  },
  ja: {
    subject: (ref) => `[CocoTrip] ご予約が確定しました！ 🎉 — ${ref}`,
    tagline: '韓国プライベートツアー＆送迎サービス',
    greeting: (name) => `<strong>${name}</strong>様、こんにちは！`,
    intro: 'ご予約が確定しました。素敵な韓国の旅をご一緒できることを楽しみにしています！ 🇰🇷',
    summaryTitle: '📋 予約サマリー',
    service: 'サービス', tourDate: 'ご利用日', pickup: 'ピックアップ', partySize: '人数',
    amountPaid: 'お支払い金額', bookingRefLabel: '予約番号', persons: '名', hotelLobby: 'ホテルロビー',
    driverTitle: '🚐 担当ドライバー',
    notesTitle: '📌 ご案内',
    note1: 'ピックアップ時間の<strong>10分前</strong>までにご準備ください',
    note2: 'ドライバーがホテルロビーで<strong>ネームボード</strong>を持ってお待ちします',
    note3: '必要な場合は<strong>WhatsApp</strong>でドライバーにご連絡ください',
    pdfNote: '📎 <strong>PDFバウチャー</strong>がこのメールに添付されています。<br>ツアー当日ドライバーにご提示ください。',
    footer: '韓国の最高の姿をお見せします！ 🎌',
    textGreeting: (name) => `${name}様、こんにちは！`,
    textConfirmed: 'CocoTripKRのご予約が確定しました！',
    textNotes: ['ピックアップ時間の10分前までにご準備ください', 'ドライバーがホテルロビーでネームボードを持ってお待ちします', 'PDFバウチャー添付 — ツアー当日ご提示ください'],
  },
  zh: {
    subject: (ref) => `[CocoTrip] 您的预订已确认！ 🎉 — ${ref}`,
    tagline: '韩国私人旅游&包车服务',
    greeting: (name) => `<strong>${name}</strong>您好！`,
    intro: '您的预订已确认。期待与您一起开启精彩的韩国之旅！ 🇰🇷',
    summaryTitle: '📋 预订摘要',
    service: '服务', tourDate: '出行日期', pickup: '接送', partySize: '人数',
    amountPaid: '支付金额', bookingRefLabel: '预订编号', persons: '人', hotelLobby: '酒店大堂',
    driverTitle: '🚐 您的司机',
    notesTitle: '📌 温馨提示',
    note1: '请在接送时间<strong>前10分钟</strong>做好准备',
    note2: '司机将在酒店大堂<strong>举名牌</strong>等候',
    note3: '如有需要请通过<strong>WhatsApp</strong>联系司机',
    pdfNote: '📎 <strong>PDF凭证</strong>已附在本邮件中。<br>出行当天请出示给司机。',
    footer: '我们迫不及待想带您领略韩国之美！ 🎌',
    textGreeting: (name) => `${name}您好！`,
    textConfirmed: '您的CocoTripKR预订已确认！',
    textNotes: ['请在接送时间前10分钟做好准备', '司机将在酒店大堂举名牌等候', 'PDF凭证已附上 — 出行当天请出示'],
  },
};

export function buildDefaultConfirmationEmail(booking, walletUrl = null, itineraryData = null, language = 'en') {
  // PR #421 (CZ2): bookingRef appears in the subject (text/plain context, no
  // escape needed) and in HTML body (escape needed below). Build once.
  const bookingRef = booking.bookingRef || 'CT-' + Date.now();
  const L = FALLBACK_EMAIL_STR[language] || FALLBACK_EMAIL_STR.en;
  const subject = L.subject(bookingRef);

  const walletSection = walletUrl ? `
    <!-- Google Wallet 버튼 -->
    <div style="text-align:center;margin:28px 0;">
      <a href="${escapeAttr(walletUrl)}" target="_blank"
         style="display:inline-block;background:#1a1a2e;color:#C4956A;text-decoration:none;
                font-weight:bold;font-size:14px;padding:14px 32px;border-radius:10px;
                letter-spacing:0.5px;">🎫 Add to Google Wallet</a>
      <p style="color:#9ca3af;font-size:11px;margin-top:8px;">Shows on your lock screen automatically on tour day</p>
    </div>` : '';

  // 2026-05-04: 추정가 결제 (charter_custom_estimate) booking 의 정산 약관 안내.
  // 부산/대구/광주 등 zone fallback 결제는 wizard 가 권역 평균으로 가격을 산출하므로
  // 실제 운행 시 거리/소요시간 차이가 ±10% 이상이면 추가청구 또는 부분환불 발생.
  // 사용자가 결제 전 wizard 화면에서 동일 약관을 봤지만, 이메일에도 명시해야 사후
  // 분쟁 시 근거가 됨.
  const reconciliationNotice = booking.requiresReconciliation ? `
    <div style="background:#fffbeb;border-left:4px solid #f59e0b;border-radius:8px;padding:18px;margin:20px 0;">
      <h3 style="color:#92400e;margin:0 0 8px;font-size:14px;">⚠️ Estimate-Based Pricing — Reconciliation Notice</h3>
      <p style="margin:0;color:#78350f;font-size:13px;line-height:1.6;">
        Your booking was priced using a <strong>regional-average estimate</strong> (your destination is outside our pre-priced matrix).
        If the actual distance / driving duration differs from the estimate by <strong>more than ±10%</strong>,
        we will reconcile (additional charge or partial refund) within <strong>1 business day</strong> after the trip.
        You'll receive an itemized statement before any adjustment.
      </p>
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
    <p style="color:#aaa;margin:6px 0 0;font-size:12px;">${L.tagline}</p>
  </div>

  <div style="background:#fff;padding:30px;border-radius:0 0 12px 12px;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

    <p style="font-size:16px;margin-top:0;">${L.greeting(escapeHtml(booking.customerName || 'there'))}</p>
    <p style="color:#374151;">${L.intro}</p>

    <!-- 예약 요약 -->
    <div style="background:#eff6ff;border-left:4px solid #C4956A;border-radius:8px;padding:20px;margin:24px 0;">
      <h2 style="color:#1a1a2e;margin:0 0 14px;font-size:16px;">${L.summaryTitle}</h2>
      <table style="width:100%;border-collapse:collapse;">
        <tr style="background:#f9fafb;"><td style="padding:7px 8px;color:#6b7280;width:130px;font-size:13px;">${L.service}</td><td style="padding:7px 8px;font-weight:bold;font-size:13px;">${escapeHtml(booking.product || '-')}</td></tr>
        <tr><td style="padding:7px 8px;color:#6b7280;font-size:13px;">${L.tourDate}</td><td style="padding:7px 8px;font-weight:bold;font-size:13px;">${escapeHtml(booking.tourDate || '-')}</td></tr>
        <tr style="background:#f9fafb;"><td style="padding:7px 8px;color:#6b7280;font-size:13px;">${L.pickup}</td><td style="padding:7px 8px;font-size:13px;">${escapeHtml(booking.pickupLocation || L.hotelLobby)}</td></tr>
        <tr><td style="padding:7px 8px;color:#6b7280;font-size:13px;">${L.partySize}</td><td style="padding:7px 8px;font-size:13px;">${escapeHtml(booking.paxCount || '-')} ${L.persons}</td></tr>
        <tr style="background:#f9fafb;"><td style="padding:7px 8px;color:#6b7280;font-size:13px;">${L.amountPaid}</td><td style="padding:7px 8px;font-weight:bold;color:#059669;font-size:13px;">$${escapeHtml(booking.amountUSD || '0')} USD</td></tr>
        <tr><td style="padding:7px 8px;color:#6b7280;font-size:13px;">${L.bookingRefLabel}</td><td style="padding:7px 8px;font-family:monospace;font-size:13px;">${escapeHtml(bookingRef)}</td></tr>
      </table>
    </div>

    ${reconciliationNotice}

    ${walletSection}

    ${renderItineraryHTML(itineraryData)}

    <!-- 담당 드라이버 -->
    <div style="background:#f0fdf4;border-radius:8px;padding:18px;margin:20px 0;">
      <h3 style="color:#166534;margin:0 0 10px;font-size:14px;">${L.driverTitle}</h3>
      <p style="margin:0;font-size:15px;font-weight:bold;color:#1a1a2e;">Taeo</p>
      <p style="margin:6px 0 0;font-size:13px;color:#374151;">
        <a href="https://wa.me/821087140611" style="color:#25d366;text-decoration:none;font-weight:bold;">📱 WhatsApp: +82-10-8714-0611</a><br>
        <a href="mailto:cocotripkr@gmail.com" style="color:#6b7280;text-decoration:none;">✉️ cocotripkr@gmail.com</a>
      </p>
    </div>

    <!-- 안내사항 -->
    <h3 style="color:#374151;margin-top:22px;font-size:14px;">${L.notesTitle}</h3>
    <ul style="color:#4b5563;line-height:2;font-size:13px;padding-left:20px;">
      <li>${L.note1}</li>
      <li>${L.note2}</li>
      <li>${L.note3}</li>
    </ul>

    <!-- PDF 안내 -->
    <div style="background:#fafafa;border:1px dashed #d1d5db;border-radius:8px;padding:14px;margin:20px 0;text-align:center;">
      <p style="margin:0;color:#6b7280;font-size:12px;">${L.pdfNote}</p>
    </div>

    <!-- 푸터 -->
    <p style="text-align:center;color:#9ca3af;font-size:13px;margin-top:24px;">
      ${L.footer}<br>
      <a href="https://cocotripkr.com" style="color:#C4956A;text-decoration:none;font-weight:bold;">cocotripkr.com</a>
    </p>
  </div>
</body>
</html>`;

  const text = `${L.textGreeting(booking.customerName || 'there')}

${L.textConfirmed}

${L.bookingRefLabel}:  ${booking.bookingRef || '-'}
${L.service}:      ${booking.product || '-'}
${L.tourDate}:    ${booking.tourDate || '-'}
${L.pickup}:       ${booking.pickupLocation || L.hotelLobby}
${L.partySize}:   ${booking.paxCount || '-'} ${L.persons}
${L.amountPaid}:  $${booking.amountUSD || '0'} USD

Your Driver: Taeo
WhatsApp: +82-10-8714-0611
Email: cocotripkr@gmail.com
${booking.requiresReconciliation ? `
ESTIMATE-BASED PRICING:
This booking was priced using a regional-average estimate. If actual
distance / driving duration differs from the estimate by more than ±10%,
we'll reconcile (additional charge or partial refund) within 1 business
day after the trip. Itemized statement will be sent before any adjustment.
` : ''}
${L.notesTitle.replace(/^📌 /, '').toUpperCase()}:
- ${L.textNotes[0]}
- ${L.textNotes[1]}
- ${L.textNotes[2]}
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
