// nodemailer v9 REAL SMTP e2e — sends ONE test email to self (GMAIL_USER → GMAIL_USER).
// Mirrors production path: service:'gmail' + app password + html/text + PDF-ish Buffer attachment.
// Usage: node scripts/_nm9-e2e-send.mjs  (reads GMAIL_USER / GMAIL_APP_PASSWORD from env)
import nodemailer from 'nodemailer';
import { createRequire } from 'module';

const ver = createRequire(import.meta.url)('nodemailer/package.json').version;
const user = (process.env.GMAIL_USER || '').trim();
const pass = (process.env.GMAIL_APP_PASSWORD || '').trim();
if (!user || !pass) { console.error('[e2e] GMAIL_USER / GMAIL_APP_PASSWORD missing'); process.exit(1); }

const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });

const info = await transporter.sendMail({
  from: `CocoTripKR <${user}>`,
  to: user, // self-send only — no customer contact
  subject: `[TEST] nodemailer v${ver} upgrade smoke — safe to delete`,
  text: `nodemailer ${ver} real-SMTP e2e. Booking-confirmation path shape. Safe to delete.`,
  html: `<div style="font-family:Arial;padding:16px;">
    <h2 style="color:#1a1a2e;">nodemailer v${ver} e2e ✅</h2>
    <p>Production path shape: <code>service:'gmail'</code> + app password + html/text + attachment Buffer.</p>
    <p style="color:#9ca3af;font-size:12px;">Sent by _nm9-e2e-send.mjs — safe to delete.</p>
  </div>`,
  attachments: [
    { filename: 'voucher-test.txt', content: 'nodemailer v9 attachment path OK', contentType: 'text/plain; charset=utf-8' },
  ],
});
console.log('[e2e] SENT messageId=', info.messageId);
console.log('[e2e] accepted=', JSON.stringify(info.accepted), 'rejected=', JSON.stringify(info.rejected));
console.log('[e2e] response=', info.response);
process.exit(info.rejected && info.rejected.length ? 1 : 0);
