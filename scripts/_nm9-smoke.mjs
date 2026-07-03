// nodemailer v9 API compatibility smoke — no network, no credentials.
// Verifies the exact surface our code uses: createTransport({service,auth}),
// sendMail({from,to,subject,text,html,attachments:[{filename,content(Buffer),contentType}]}).
import nodemailer from 'nodemailer';
import { createRequire } from 'module';

// v9 dropped the `.version` export — read package.json instead.
const ver = createRequire(import.meta.url)('nodemailer/package.json').version;
console.log('[smoke] nodemailer version:', ver);
if (!ver.startsWith('9.')) { console.error('[smoke] FAIL: expected 9.x'); process.exit(1); }

// 1) service:'gmail' shorthand must still resolve (build transport, no connect).
const gmail = nodemailer.createTransport({ service: 'gmail', auth: { user: 'x@gmail.com', pass: 'app-pass' } });
if (!gmail || typeof gmail.sendMail !== 'function') { console.error('[smoke] FAIL: gmail transport'); process.exit(1); }
console.log('[smoke] service:gmail transport OK, host=', gmail.options?.host);

// 2) jsonTransport send with attachment Buffer (mirrors sendBookingConfirmation pdfBuffer).
const t = nodemailer.createTransport({ jsonTransport: true });
const info = await t.sendMail({
  from: 'CocoTripKR <x@gmail.com>',
  to: 'guest@example.com',
  subject: 'Booking Confirmed — CT-1',
  text: 'plain body',
  html: '<b>html body</b>',
  attachments: [
    { filename: 'CocoTripKR_Voucher.pdf', content: Buffer.from('%PDF-1.4 fake'), contentType: 'application/pdf' },
    { filename: 'CocoTripKR_Voucher.txt', content: 'voucher text', contentType: 'text/plain; charset=utf-8' },
  ],
});
const msg = JSON.parse(info.message);
const ok = info.messageId && msg.subject === 'Booking Confirmed — CT-1'
  && Array.isArray(msg.attachments) && msg.attachments.length === 2
  && msg.attachments[0].filename === 'CocoTripKR_Voucher.pdf';
if (!ok) { console.error('[smoke] FAIL: sendMail payload', info.message); process.exit(1); }
console.log('[smoke] sendMail+attachments OK, messageId=', info.messageId);
console.log('[smoke] PASS — v9 API compatible with CocoTrip usage');
