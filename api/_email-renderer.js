/**
 * CocoTrip HTML Email Renderer
 * api/_email-renderer.js
 *
 * JSON itinerary → 아름다운 HTML 이메일 변환
 * 모든 날것의 JSON(lat/lng/naverUrl 등)은 이 함수에서 처리하지 않음
 */

const VEHICLE_LABELS = {
  staria_8: 'Staria Van (1-8 pax)',
  sprinter: 'Sprinter (9-15 pax)',
  large_bus: 'Large Bus (16+ pax)',
  staria: 'Staria Van',
  default: 'Private Vehicle',
};

const CATEGORY_EMOJI = {
  culture: '🏛',
  food: '🍜',
  shopping: '🛍',
  nature: '🌿',
  landmark: '📸',
  kpop: '🎵',
  default: '📍',
};

function vehicleLabel(v) {
  return VEHICLE_LABELS[v] || VEHICLE_LABELS.default;
}

function categoryEmoji(c) {
  return CATEGORY_EMOJI[(c || '').toLowerCase()] || CATEGORY_EMOJI.default;
}

function formatKRW(n) {
  if (!n || isNaN(n)) return '';
  return new Intl.NumberFormat('ko-KR').format(n) + '원';
}

function buildStopsHtml(stops = []) {
  return stops.map((stop, idx) => {
    const emoji = categoryEmoji(stop.category);
    const nameKo = stop.name_ko || stop.name || '';
    const nameEn = stop.name_en || stop.nameEn || '';
    const tip = stop.tip_en || stop.tip || '';
    const stay = stop.stay_min || stop.stayDuration || 60;
    const cat = stop.category || '';

    return `
      <tr>
        <td style="padding:0 0 24px 0;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <!-- Timeline dot + line -->
              <td width="32" valign="top" style="padding-top:4px;">
                <div style="width:12px;height:12px;border-radius:50%;background:#a855f7;border:2px solid white;margin:0 auto;box-shadow:0 0 0 2px rgba(168,85,247,0.3);"></div>
                ${idx < stops.length - 1 ? '<div style="width:2px;background:#f0f0f8;margin:4px auto 0;height:100%;min-height:40px;"></div>' : ''}
              </td>
              <!-- Stop content -->
              <td style="padding-left:12px;">
                <div style="display:flex;align-items:baseline;gap:8px;">
                  <span style="font-size:11px;font-weight:700;color:#a855f7;min-width:40px;">${String(idx + 1).padStart(2, '0')}</span>
                  <span style="font-size:15px;font-weight:800;color:#1a1a2e;">${emoji} ${nameKo}</span>
                </div>
                ${nameEn ? `<div style="font-size:11px;color:#aaa;margin:2px 0 6px 52px;">${nameEn}</div>` : ''}
                ${tip ? `<div style="font-size:13px;color:#555;line-height:1.65;margin-left:52px;margin-bottom:8px;">${tip}</div>` : ''}
                <div style="margin-left:52px;display:flex;gap:8px;flex-wrap:wrap;">
                  ${cat ? `<span style="font-size:10px;padding:2px 10px;border-radius:20px;background:#f5f0ff;color:#7c3aed;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">${cat}</span>` : ''}
                  <span style="font-size:10px;padding:2px 10px;border-radius:20px;background:#f0f8ff;color:#0077cc;font-weight:600;">⏱ ~${stay} min</span>
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
  }).join('');
}

function buildDaysHtml(days = []) {
  return days.map((day, idx) => {
    const stops = day.stops || day.places || [];
    const theme = day.theme || day.title || `Day ${day.day || idx + 1}`;
    const date = day.date || '';

    return `
      <!-- DAY ${idx + 1} -->
      <tr><td style="padding:0 0 32px 0;">
        <!-- Day header -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;">
          <tr>
            <td width="44">
              <div style="width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,#a855f7,#ec4899);display:flex;align-items:center;justify-content:center;text-align:center;line-height:44px;">
                <span style="color:white;font-size:18px;font-weight:900;">${day.day || idx + 1}</span>
              </div>
            </td>
            <td style="padding-left:14px;">
              <div style="font-size:15px;font-weight:800;color:#1a1a2e;">${theme}</div>
              ${date ? `<div style="font-size:11px;color:#aaa;">${date}</div>` : ''}
            </td>
          </tr>
        </table>
        <!-- Stops timeline -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="padding-left:8px;">
          ${buildStopsHtml(stops)}
        </table>
      </td></tr>
      <tr><td style="border-top:1px solid #f0f0f8;padding-bottom:28px;"></td></tr>`;
  }).join('');
}

/**
 * Main render function
 * @param {Object} params
 * @param {string} params.guestName
 * @param {string} params.orderID
 * @param {string} params.tourTitle
 * @param {string} params.tourDate
 * @param {string} params.vehicle
 * @param {number} params.pax
 * @param {number} params.durationDays
 * @param {number} params.amountUSD
 * @param {number} params.amountKRW
 * @param {string} params.language
 * @param {Array}  params.days - array of day objects with stops
 * @param {string} params.promoCode
 */
export function renderBookingEmail({ guestName, orderID, tourTitle, tourDate, vehicle, pax,
  durationDays, amountUSD, amountKRW, days = [], language = 'en', promoCode = '' }) {

  const totalStops = days.reduce((acc, d) => acc + (d.stops || d.places || []).length, 0);
  const daysLabel = durationDays === 1 ? '1 Day' : `${durationDays} Days`;

  const includesHtml = `
    <tr><td style="padding:2px 0;font-size:12px;color:#444;"><span style="color:#34d399;font-weight:700;">✓</span> Private ${vehicleLabel(vehicle)}</td></tr>
    <tr><td style="padding:2px 0;font-size:12px;color:#444;"><span style="color:#34d399;font-weight:700;">✓</span> Professional Driver (8h base)</td></tr>
    <tr><td style="padding:2px 0;font-size:12px;color:#444;"><span style="color:#34d399;font-weight:700;">✓</span> Fuel, Tolls, Parking</td></tr>
    <tr><td style="padding:2px 0;font-size:12px;color:#444;"><span style="color:#34d399;font-weight:700;">✓</span> Hotel Pickup & Drop-off</td></tr>
    <tr><td style="padding:2px 0;font-size:12px;color:#444;"><span style="color:#ef4444;font-weight:700;">✗</span> Entrance Fees & Meals</td></tr>
    <tr><td style="padding:2px 0;font-size:12px;color:#444;"><span style="color:#ef4444;font-weight:700;">✗</span> Personal Expenses</td></tr>`;

  const promoSection = promoCode ? `
    <div style="margin-top:10px;font-size:12px;color:#888;">
      Use code <strong style="color:#a855f7;">${promoCode}</strong> for 20% off (first 50 bookings)
    </div>` : '';

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>CocoTrip — Your Tour Confirmation</title></head>
<body style="margin:0;padding:0;background:#f5f5f8;font-family:'Helvetica Neue',Arial,sans-serif;">

<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f8;padding:20px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;border-radius:16px;overflow:hidden;box-shadow:0 4px 32px rgba(0,0,0,0.12);">

  <!-- HEADER -->
  <tr><td style="background:linear-gradient(135deg,#1a1a2e 0%,#2d1b4e 100%);padding:40px 32px 32px;text-align:center;">
    <div style="font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,0.5);margin-bottom:14px;">COCOTRIPKR</div>
    <div style="display:inline-block;background:linear-gradient(135deg,#fbbf24,#f59e0b);color:#1a1a2e;padding:4px 16px;border-radius:20px;font-size:10px;font-weight:800;letter-spacing:2px;margin-bottom:14px;">✅ CONFIRMED</div>
    <h1 style="font-size:22px;font-weight:900;color:white;margin:0 0 6px;">${tourTitle || 'Your Korea Private Tour'}</h1>
    <p style="font-size:12px;color:rgba(255,255,255,0.45);margin:0;">Curated exclusively for ${guestName || 'you'} · CocoTrip AI</p>
  </td></tr>

  <!-- OVERVIEW STRIP -->
  <tr><td style="background:white;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-bottom:1px solid #f0f0f8;">
      <tr>
        <td style="text-align:center;padding:14px 8px;border-right:1px solid #f0f0f8;">
          <div style="font-size:18px;margin-bottom:2px;">📅</div>
          <div style="font-size:9px;color:#aaa;text-transform:uppercase;letter-spacing:1px;">Duration</div>
          <div style="font-size:13px;font-weight:800;color:#1a1a2e;">${daysLabel}</div>
        </td>
        <td style="text-align:center;padding:14px 8px;border-right:1px solid #f0f0f8;">
          <div style="font-size:18px;margin-bottom:2px;">📍</div>
          <div style="font-size:9px;color:#aaa;text-transform:uppercase;letter-spacing:1px;">Stops</div>
          <div style="font-size:13px;font-weight:800;color:#1a1a2e;">${totalStops} Places</div>
        </td>
        <td style="text-align:center;padding:14px 8px;border-right:1px solid #f0f0f8;">
          <div style="font-size:18px;margin-bottom:2px;">🚐</div>
          <div style="font-size:9px;color:#aaa;text-transform:uppercase;letter-spacing:1px;">Vehicle</div>
          <div style="font-size:13px;font-weight:800;color:#1a1a2e;">${vehicleLabel(vehicle).split('(')[0].trim()}</div>
        </td>
        <td style="text-align:center;padding:14px 8px;">
          <div style="font-size:18px;margin-bottom:2px;">👥</div>
          <div style="font-size:9px;color:#aaa;text-transform:uppercase;letter-spacing:1px;">Guests</div>
          <div style="font-size:13px;font-weight:800;color:#1a1a2e;">${pax} pax</div>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- BODY -->
  <tr><td style="background:white;padding:28px 32px;">

    <!-- Booking ref -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8f8fc;border-radius:10px;padding:14px 20px;margin-bottom:28px;">
      <tr>
        <td style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;">Booking ID</td>
        <td style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;">Tour Date</td>
      </tr>
      <tr>
        <td style="font-size:14px;font-weight:800;color:#a855f7;">${orderID || '—'}</td>
        <td style="font-size:14px;font-weight:800;color:#1a1a2e;">${tourDate || '—'}</td>
      </tr>
    </table>

    <!-- ITINERARY DAYS -->
    <h2 style="font-size:14px;font-weight:800;color:#1a1a2e;letter-spacing:1px;text-transform:uppercase;border-bottom:2px solid #f0f0f8;padding-bottom:10px;margin-bottom:20px;">🗺 Your Itinerary</h2>
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      ${buildDaysHtml(days)}
    </table>

    <!-- INCLUDES -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8f8fc;border-radius:10px;padding:20px;margin-bottom:24px;">
      <tr><td style="font-size:12px;font-weight:800;color:#1a1a2e;text-transform:uppercase;letter-spacing:1px;padding-bottom:12px;">What's Included</td></tr>
      ${includesHtml}
    </table>

    <!-- CTA / PRICING -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:linear-gradient(135deg,#f5f0ff,#fff0f8);border-radius:12px;padding:24px;text-align:center;margin-bottom:24px;">
      <tr><td>
        ${amountKRW ? `<div style="font-size:26px;font-weight:900;color:#1a1a2e;margin-bottom:4px;">${formatKRW(amountKRW)}</div>` : ''}
        ${amountUSD ? `<div style="font-size:13px;color:#888;margin-bottom:16px;">~$${amountUSD} USD · ${vehicleLabel(vehicle)}</div>` : ''}
        <a href="https://wa.me/821087140611" style="display:inline-block;padding:14px 40px;background:linear-gradient(135deg,#a855f7,#ec4899);color:white;text-decoration:none;border-radius:30px;font-weight:700;font-size:14px;letter-spacing:0.5px;">💬 WhatsApp Your Driver</a>
        ${promoSection}
      </td></tr>
    </table>

    <!-- CONTACT -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:8px;">
      <tr>
        <td style="font-size:12px;color:#666;line-height:1.8;">
          📞 WhatsApp: <a href="https://wa.me/821087140611" style="color:#a855f7;text-decoration:none;">+82-10-8714-0611</a><br>
          🌐 <a href="https://cocotripkr.com" style="color:#a855f7;text-decoration:none;">cocotripkr.com</a><br>
          ✉️ <a href="mailto:info@cocotripkr.com" style="color:#a855f7;text-decoration:none;">info@cocotripkr.com</div>
        </td>
      </tr>
    </table>

  </td></tr>

  <!-- FOOTER -->
  <tr><td style="background:#1a1a2e;padding:24px 32px;text-align:center;">
    <div style="font-size:11px;color:rgba(255,255,255,0.4);line-height:1.8;">
      CocoTripKR · Korea Private Tour & Transfer<br>
      <a href="https://cocotripkr.com" style="color:rgba(255,255,255,0.3);text-decoration:none;">cocotripkr.com</a> · 
      Kakao: cocotripkr · WhatsApp: +82-10-8714-0611<br>
      <span style="color:rgba(255,255,255,0.2);font-size:10px;">This itinerary was curated by CocoTrip AI and may be adjusted based on traffic conditions.</span>
    </div>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;
}

/**
 * Plain text fallback for email clients that don't support HTML
 */
export function renderBookingEmailText({ guestName, orderID, tourTitle, tourDate, vehicle, pax, amountUSD, amountKRW, days = [] }) {
  const lines = [
    `CocoTrip — Booking Confirmation`,
    `=====================================`,
    `Dear ${guestName || 'Guest'},`,
    `Your tour "${tourTitle}" is confirmed!`,
    ``,
    `Booking ID: ${orderID}`,
    `Tour Date: ${tourDate}`,
    `Vehicle: ${vehicleLabel(vehicle)}`,
    `Guests: ${pax}`,
    amountUSD ? `Total: $${amountUSD} USD (≈ ${formatKRW(amountKRW)})` : '',
    ``,
    `--- ITINERARY ---`,
  ];

  for (const day of days) {
    lines.push(`\nDay ${day.day || ''} — ${day.theme || ''}`);
    for (const s of (day.stops || day.places || [])) {
      lines.push(`  ${s.order || ''}. ${s.name_ko || s.name || ''} (${s.name_en || s.nameEn || ''})`);
      if (s.tip_en || s.tip) lines.push(`     → ${s.tip_en || s.tip}`);
    }
  }

  lines.push(`\n--- INCLUDED ---`);
  lines.push(`✓ Private Vehicle & Driver`);
  lines.push(`✓ Fuel, Tolls, Parking`);
  lines.push(`✗ Meals, Entrance Fees`);
  lines.push(`\nWhatsApp: +82-10-8714-0611`);
  lines.push(`cocotripkr.com`);

  return lines.filter(Boolean).join('\n');
}
