/**
 * CocoTripKR — PDF 바우처 자동 생성
 *
 * Renders the booking voucher via Puppeteer + @sparticuz/chromium (same
 * stack as api/pdf/generate.js). Chromium ships with CJK system fonts so
 * Korean / Japanese / Chinese names + addresses render natively.
 *
 * PR #424 (Audit CZ5 — 2026-05-13): replaced PDFKit + Helvetica + safeText()
 * pipeline. Pre-fix every non-Latin character in customerName /
 * pickupLocation / product etc. was stripped to `?`, so Korean tourists
 * got a voucher with `???` instead of their name. Helvetica only carries
 * Latin glyphs; PDFKit's standard fonts don't include CJK, and bundling a
 * full CJK TTF in the function package would add ~16 MB. The Chromium
 * binary path already powers api/pdf/generate.js and includes CJK
 * fallbacks at no extra cost.
 *
 * Signature is unchanged so booking-processor.js + api/voucher.js callers
 * keep working: `generateVoucherPDF(booking) → Promise<Buffer>`.
 *
 * CONTEXT: CocoTripKR 자동화 유틸리티
 */

import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import QRCode from 'qrcode';
import { Buffer } from 'buffer';
import { escapeHtml, escapeAttr } from './_shared/escape.js';

const BRAND_DARK = '#1a1a2e';
const BRAND_GOLD = '#C4956A';

/**
 * Build the voucher HTML. Booking fields are escaped (PR #421 helper)
 * because this is real user input rendered into Chromium → PDF.
 */
function buildVoucherHtml(booking, qrDataUrl) {
  const bookingRef = escapeHtml(booking.bookingRef || 'CT-PENDING');
  const transactionId = escapeHtml(booking.transactionId || '-');
  const customerName = escapeHtml(booking.customerName || '');
  const product = escapeHtml(booking.product || '');
  const tourDate = escapeHtml(booking.tourDate || '');
  const pickupLocation = escapeHtml(booking.pickupLocation || 'Hotel Lobby');
  const dropoffLocation = escapeHtml(booking.dropoffLocation || '-');
  const paxCount = escapeHtml(booking.paxCount || 1);
  const vehicleType = escapeHtml(booking.vehicleType || 'Staria');
  const amountUSD = escapeHtml(booking.amountUSD || '0');
  const amountKRW = (booking.amountKRW || 0).toLocaleString('en-US');

  const reconciliationNotice = booking.requiresReconciliation
    ? `
      <div class="reconciliation">
        <h3>Estimate-Based Pricing — Reconciliation Notice (±10%)</h3>
        <p>Your booking was priced using a regional-average estimate
        (destination outside our pre-priced matrix). If the actual distance /
        driving duration differs from the estimate by more than ±10%, we
        will reconcile (additional charge or partial refund) within 1
        business day after the trip. An itemized statement will be sent
        before any adjustment. (See your confirmation email for KO/JA/ZH
        translations.)</p>
      </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>CocoTripKR Voucher</title>
<style>
  /* @sparticuz/chromium ships system CJK fonts — these stacks cover EN+KR+JA+ZH. */
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body {
    font-family: 'Noto Sans KR', 'Noto Sans CJK KR', 'Apple SD Gothic Neo',
                 'Malgun Gothic', 'Helvetica Neue', Arial, sans-serif;
    margin: 0;
    padding: 0;
    color: #1a1a1a;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .header {
    background: ${BRAND_DARK};
    padding: 30px 50px;
    color: ${BRAND_GOLD};
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
  }
  .header h1 { margin: 0; font-size: 28px; letter-spacing: 3px; font-weight: 700; }
  .header .tagline { color: #aaa; font-size: 10px; margin-top: 6px; }
  .header .voucher-tag {
    text-align: right;
    color: ${BRAND_GOLD};
    font-weight: 700;
    font-size: 12px;
  }
  .header .voucher-tag .domain { color: #888; font-size: 8px; margin-top: 4px; font-weight: 400; }

  .ref-box {
    margin: 22px 50px 0;
    padding: 14px 18px;
    background: #eff6ff;
    border-radius: 8px;
  }
  .ref-box .label { color: #1d4ed8; font-size: 9px; font-weight: 600; letter-spacing: 1px; }
  .ref-box .ref { color: ${BRAND_DARK}; font-size: 22px; font-weight: 700; margin: 6px 0 4px; letter-spacing: 1px; }
  .ref-box .tx { color: #6b7280; font-size: 8px; }

  .section { margin: 28px 50px 0; }
  .section h2 {
    color: ${BRAND_DARK};
    font-size: 12px;
    margin: 0 0 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid ${BRAND_GOLD};
    font-weight: 700;
    letter-spacing: 1px;
  }
  table.details { width: 100%; border-collapse: collapse; }
  table.details tr:nth-child(odd) td { background: #f9fafb; }
  table.details td { padding: 7px 10px; font-size: 9.5px; }
  table.details td.label { color: #6b7280; width: 130px; }
  table.details td.value { color: #1a1a1a; font-weight: 700; }

  .reconciliation {
    margin: 18px 50px 0;
    padding: 14px;
    background: #fffbeb;
    border: 1px solid #f59e0b;
    border-radius: 8px;
  }
  .reconciliation h3 { color: #92400e; font-size: 10px; margin: 0 0 6px; }
  .reconciliation p { color: #78350f; font-size: 8.5px; line-height: 1.5; margin: 0; }

  .driver {
    margin: 20px 50px 0;
    padding: 14px 16px;
    background: #f0fdf4;
    border-radius: 8px;
  }
  .driver .label { color: #166534; font-size: 10px; font-weight: 700; }
  .driver .name { color: ${BRAND_DARK}; font-size: 16px; font-weight: 700; margin: 6px 0; }
  .driver .contact { color: #6b7280; font-size: 9.5px; line-height: 1.6; }

  .notes-qr {
    display: flex;
    gap: 16px;
    margin: 24px 50px 0;
    align-items: flex-start;
  }
  .notes { flex: 1; }
  .notes h3 { color: ${BRAND_DARK}; font-size: 11px; margin: 0 0 8px; }
  .notes ul { margin: 0; padding-left: 16px; font-size: 9.5px; color: #1a1a1a; line-height: 1.7; }
  .qr-box {
    width: 124px;
    text-align: center;
    background: #f9fafb;
    border-radius: 6px;
    padding: 8px;
  }
  .qr-box img { width: 100px; height: 100px; display: block; margin: 0 auto; }
  .qr-box .caption { color: #6b7280; font-size: 7px; margin-top: 4px; }

  .divider { margin: 40px 50px 12px; border-top: 0.5px solid #e5e7eb; }
  .non-transferable { text-align: center; color: #6b7280; font-size: 8px; margin: 0 50px; }

  .footer {
    background: ${BRAND_DARK};
    color: ${BRAND_GOLD};
    padding: 12px 50px;
    margin-top: 18px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .footer .brand { font-weight: 700; font-size: 9px; letter-spacing: 2px; }
  .footer .links { color: #888; font-size: 7.5px; }
  .footer .confirmed { color: ${BRAND_GOLD}; font-weight: 700; font-size: 8px; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <h1>COCOTRIPKR</h1>
      <div class="tagline">Korea Private Tour &amp; Transfer Service</div>
    </div>
    <div class="voucher-tag">
      OFFICIAL VOUCHER
      <div class="domain">cocotripkr.com</div>
    </div>
  </div>

  <div class="ref-box">
    <div class="label">BOOKING REFERENCE</div>
    <div class="ref">${bookingRef}</div>
    <div class="tx">Transaction: ${transactionId}</div>
  </div>

  <div class="section">
    <h2>BOOKING DETAILS</h2>
    <table class="details">
      <tr><td class="label">Guest Name</td><td class="value">${customerName || '-'}</td></tr>
      <tr><td class="label">Service</td><td class="value">${product || '-'}</td></tr>
      <tr><td class="label">Tour Date</td><td class="value">${tourDate || '-'}</td></tr>
      <tr><td class="label">Pickup</td><td class="value">${pickupLocation}</td></tr>
      <tr><td class="label">Destination</td><td class="value">${dropoffLocation}</td></tr>
      <tr><td class="label">Party Size</td><td class="value">${paxCount} person(s)</td></tr>
      <tr><td class="label">Vehicle</td><td class="value">${vehicleType}</td></tr>
      <tr><td class="label">Amount Paid</td><td class="value">$${amountUSD} USD (approx. KRW ${amountKRW})</td></tr>
    </table>
  </div>

  ${reconciliationNotice}

  <div class="driver">
    <div class="label">Your Driver</div>
    <div class="name">Taeo</div>
    <div class="contact">
      WhatsApp: +82-10-8714-0611<br>
      Email: cocotripkr@gmail.com
    </div>
  </div>

  <div class="notes-qr">
    <div class="notes">
      <h3>IMPORTANT NOTES</h3>
      <ul>
        <li>Please be ready 10 minutes before pickup time</li>
        <li>Contact driver via WhatsApp if needed</li>
        <li>Driver will hold a sign with your name at hotel lobby</li>
      </ul>
    </div>
    <div class="qr-box">
      <img src="${escapeAttr(qrDataUrl)}" alt="QR" />
      <div class="caption">cocotripkr.com</div>
    </div>
  </div>

  <div class="divider"></div>
  <div class="non-transferable">
    This voucher is valid only for the service and date listed above. Non-transferable.
  </div>

  <div class="footer">
    <span class="brand">COCOTRIPKR</span>
    <span class="links">cocotripkr.com &nbsp;•&nbsp; cocotripkr@gmail.com &nbsp;•&nbsp; WhatsApp +82-10-8714-0611</span>
    <span class="confirmed">CONFIRMED ✓</span>
  </div>
</body>
</html>`;
}

/**
 * PDF 바우처 생성 (Puppeteer + @sparticuz/chromium).
 *
 * @param {object} booking - booking-processor 의 booking 객체
 * @returns {Promise<Buffer>} PDF binary
 */
export async function generateVoucherPDF(booking) {
  // Pre-render the QR as a data URL so Chromium doesn't need an extra
  // network roundtrip to fetch an image.
  let qrDataUrl = '';
  try {
    qrDataUrl = await QRCode.toDataURL('https://cocotripkr.com', {
      type: 'image/png',
      width: 100,
      margin: 1,
      color: { dark: BRAND_DARK, light: '#ffffff' },
    });
  } catch (qrErr) {
    console.warn('[generate-voucher] QR data-url failed (rendering blank):', qrErr.message);
    qrDataUrl = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  }

  const html = buildVoucherHtml(booking, qrDataUrl);

  let browser = null;
  try {
    browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
      defaultViewport: { width: 800, height: 1200, deviceScaleFactor: 2 },
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
    // Wait for CJK system fonts to be ready before rasterising.
    await page.evaluateHandle('document.fonts.ready');
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
    return Buffer.from(pdfBuffer);
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
  }
}

export default { generateVoucherPDF };
