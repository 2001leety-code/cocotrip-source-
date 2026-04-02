/**
 * CocoTripKR ??PDF Î∞îÏö∞Ï≤??êÎèô ?ùÏÑ±
 *
 * pdfkit + qrcode ?¨Ïö© (?úÏ? Helvetica ?∞Ìä∏, ?åÏùº ?úÏä§??Î∂àÌïÑ??
 * booking-processor.js?êÏÑú ?∏Ï∂ú?òÎäî ?†Ìã∏Î¶¨Ìã∞ (HTTP handler ?ÜÏùå)
 *
 * CONTEXT: CocoTripKR ?êÎèô???†Ìã∏Î¶¨Ìã∞
 */

import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

const BRAND_DARK = '#1a1a2e';
const BRAND_GOLD = '#C4956A';
const TEXT_DARK  = '#1a1a1a';
const TEXT_GRAY  = '#6b7280';

function safeText(str = '') {
  return String(str).replace(/[^\x20-\x7E\u00C0-\u024F]/g, '?');
}

/**
 * PDF Î∞îÏö∞Ï≤??ùÏÑ±
 * @param {object} booking - ?àÏïΩ ?∞Ïù¥??(booking-processor??booking Í∞ùÏ≤¥)
 * @returns {Promise<Buffer>} PDF Î∞îÏù¥?àÎ¶¨ Î≤ÑÌçº
 */
export async function generateVoucherPDF(booking) {
  return new Promise(async (resolve, reject) => {
    try {
      const chunks = [];
      const doc = new PDFDocument({
        size: 'A4',
        margin: 0,
        info: {
          Title:   `CocoTripKR Voucher ??${booking.bookingRef || 'CT'}`,
          Author:  'CocoTripKR',
          Subject: 'Korea Private Tour Voucher',
        },
      });

      doc.on('data',  (chunk) => chunks.push(chunk));
      doc.on('end',   () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const W = doc.page.width;   // 595
      const H = doc.page.height;  // 842
      const M = 50;               // Ï¢åÏö∞ ?¨Î∞±

      // ?Ä?Ä Î∞∞Í≤Ω ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
      doc.rect(0, 0, W, H).fill('#ffffff');

      // ?Ä?Ä ?ÅÎã® ?§Îçî Î∞??Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
      doc.rect(0, 0, W, 120).fill(BRAND_DARK);

      doc.fillColor(BRAND_GOLD)
         .font('Helvetica-Bold')
         .fontSize(28)
         .text('COCOTRIPKR', M, 30, { characterSpacing: 3 });

      doc.fillColor('#aaaaaa')
         .font('Helvetica')
         .fontSize(10)
         .text('Korea Private Tour & Transfer Service', M, 70);

      doc.fillColor(BRAND_GOLD)
         .font('Helvetica-Bold')
         .fontSize(12)
         .text('OFFICIAL VOUCHER', W - M - 150, 48, { width: 150, align: 'right' });

      doc.fillColor('#888888')
         .font('Helvetica')
         .fontSize(8)
         .text('cocotripkr.com', W - M - 150, 66, { width: 150, align: 'right' });

      // ?Ä?Ä ?àÏïΩ Î≤àÌò∏ Î∞ïÏä§ ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
      const refBoxY = 140;
      doc.roundedRect(M, refBoxY, W - M * 2, 66, 8).fill('#eff6ff');

      doc.fillColor('#1d4ed8')
         .font('Helvetica')
         .fontSize(9)
         .text('BOOKING REFERENCE', M + 18, refBoxY + 12);

      doc.fillColor(BRAND_DARK)
         .font('Helvetica-Bold')
         .fontSize(22)
         .text(safeText(booking.bookingRef || 'CT-PENDING'), M + 18, refBoxY + 26, { characterSpacing: 1 });

      doc.fillColor(TEXT_GRAY)
         .font('Helvetica')
         .fontSize(8)
         .text(`Transaction: ${booking.transactionId || '-'}`, M + 18, refBoxY + 54);

      // ?Ä?Ä ?àÏïΩ ?ïÎ≥¥ ?πÏÖò ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
      const infoY = 230;
      doc.fillColor(BRAND_DARK)
         .font('Helvetica-Bold')
         .fontSize(12)
         .text('BOOKING DETAILS', M, infoY);

      doc.moveTo(M, infoY + 18).lineTo(W - M, infoY + 18).lineWidth(1).stroke(BRAND_GOLD);

      const rows = [
        ['Guest Name',   safeText(booking.customerName)],
        ['Service',      safeText(booking.product)],
        ['Tour Date',    safeText(booking.tourDate)],
        ['Pickup',       safeText(booking.pickupLocation || 'Hotel Lobby')],
        ['Destination',  safeText(booking.dropoffLocation || '-')],
        ['Party Size',   `${booking.paxCount || 1} person(s)`],
        ['Vehicle',      safeText(booking.vehicleType || 'Staria')],
        ['Amount Paid',  `$${booking.amountUSD} USD  (approx. KRW ${(booking.amountKRW || 0).toLocaleString()})`],
      ];

      let rowY = infoY + 28;
      rows.forEach(([label, value], i) => {
        doc.rect(M, rowY, W - M * 2, 24).fill(i % 2 === 0 ? '#f9fafb' : '#ffffff');

        doc.fillColor(TEXT_GRAY)
           .font('Helvetica')
           .fontSize(8.5)
           .text(label, M + 10, rowY + 7.5, { width: 110 });

        doc.fillColor(TEXT_DARK)
           .font('Helvetica-Bold')
           .fontSize(8.5)
           .text(value || '-', M + 125, rowY + 7.5, { width: W - M * 2 - 135 });

        rowY += 24;
      });

      // ?Ä?Ä ?¥Îãπ Í∏∞ÏÇ¨ Î∞ïÏä§ ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
      const driverY = rowY + 20;
      doc.roundedRect(M, driverY, W - M * 2, 78, 8).fill('#f0fdf4');

      doc.fillColor('#166534')
         .font('Helvetica-Bold')
         .fontSize(10)
         .text('Your Driver', M + 16, driverY + 12);

      doc.fillColor(BRAND_DARK)
         .font('Helvetica-Bold')
         .fontSize(16)
         .text('Taeo', M + 16, driverY + 26);

      doc.fillColor(TEXT_GRAY)
         .font('Helvetica')
         .fontSize(9.5)
         .text('WhatsApp: +82-10-8714-0611', M + 16, driverY + 46)
         .text('Email: cocotripkr@gmail.com',  M + 16, driverY + 62);

      // ?Ä?Ä Ï£ºÏùò?¨Ìï≠ + QR ÏΩîÎìú ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
      const notesY = driverY + 96;

      // Ï£ºÏùò?¨Ìï≠ (Ï¢åÏ∏°)
      doc.fillColor(BRAND_DARK)
         .font('Helvetica-Bold')
         .fontSize(11)
         .text('IMPORTANT NOTES', M, notesY);

      doc.fillColor(TEXT_DARK)
         .font('Helvetica')
         .fontSize(9.5)
         .text('??Please be ready 10 minutes before pickup time', M, notesY + 18, { width: 320 })
         .text('??Contact driver via WhatsApp if needed',          M, notesY + 35, { width: 320 })
         .text('??Driver will hold a sign with your name at hotel lobby', M, notesY + 52, { width: 320 });

      // QR ÏΩîÎìú (?∞Ï∏°)
      try {
        const qrBuffer = await QRCode.toBuffer('https://cocotripkr.com', {
          type:   'png',
          width:  100,
          margin: 1,
          color:  { dark: BRAND_DARK, light: '#ffffff' },
        });

        const qrX = W - M - 108;
        const qrY = notesY - 8;
        doc.roundedRect(qrX - 8, qrY - 8, 124, 124, 6).fill('#f9fafb');
        doc.image(qrBuffer, qrX, qrY, { width: 100 });

        doc.fillColor(TEXT_GRAY)
           .font('Helvetica')
           .fontSize(7)
           .text('cocotripkr.com', qrX, qrY + 106, { width: 100, align: 'center' });
      } catch (qrErr) {
        console.warn('[generate-voucher] QR ?ùÏÑ± ?§Ìå® (Í≥ÑÏÜç ÏßÑÌñâ):', qrErr.message);
      }

      // ?Ä?Ä ?òÎã® Íµ¨Î∂Ñ???Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
      const footerDivY = H - 70;
      doc.moveTo(M, footerDivY).lineTo(W - M, footerDivY).lineWidth(0.5).stroke('#e5e7eb');

      doc.fillColor(TEXT_GRAY)
         .font('Helvetica')
         .fontSize(8)
         .text('This voucher is valid only for the service and date listed above. Non-transferable.', M, footerDivY + 8, { width: W - M * 2, align: 'center' });

      // ?Ä?Ä ?òÎã® ?∏ÌÑ∞ Î∞??Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
      doc.rect(0, H - 44, W, 44).fill(BRAND_DARK);

      doc.fillColor(BRAND_GOLD)
         .font('Helvetica-Bold')
         .fontSize(9)
         .text('COCOTRIPKR', M, H - 32, { characterSpacing: 2 });

      doc.fillColor('#888888')
         .font('Helvetica')
         .fontSize(7.5)
         .text('cocotripkr.com  ?? cocotripkr@gmail.com  ?? WhatsApp +82-10-8714-0611', M, H - 18, {
           width: W - M * 2,
         });

      doc.fillColor(BRAND_GOLD)
         .font('Helvetica-Bold')
         .fontSize(8)
         .text('CONFIRMED ??, W - M - 90, H - 30, { width: 90, align: 'right' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

export default { generateVoucherPDF };
