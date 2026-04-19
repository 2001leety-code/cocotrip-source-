/**
 * Email notification + Google Sheets lead recording.
 * Extracted verbatim from api/ai-planner-full.js L544-578, L1254-1271.
 */

export async function sendNotificationEmail({ email, guestName, tourTitle, planId, planUrl }) {
  const gmailUser = (process.env.GMAIL_USER || '').trim();
  const gmailPass = (process.env.GMAIL_APP_PASSWORD || '').trim();
  if (!gmailUser || !gmailPass || !email) return;

  const fullPlanUrl = `https://cocotripkr.com${planUrl}`;
  const html = `<!DOCTYPE html><html><body style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f8f9fa;">
  <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:32px;border-radius:16px;text-align:center;margin-bottom:24px;">
    <h1 style="color:#fff;margin:0 0 8px;font-size:22px;">Your CocoTrip Plan is Ready ✨</h1>
    <p style="color:#a78bfa;margin:0;font-size:14px;">${tourTitle || 'Your Korea Itinerary'}</p>
  </div>
  <p style="font-size:16px;color:#333;">Hi ${guestName},</p>
  <p style="font-size:14px;color:#555;line-height:1.6;">Your AI-curated Korea itinerary is ready! View the full plan with maps, budget breakdown, airport arrival guide, and PDF download.</p>
  <div style="text-align:center;margin:32px 0;">
    <a href="${fullPlanUrl}" style="background:linear-gradient(135deg,#a855f7,#ec4899);color:#fff;padding:16px 48px;border-radius:30px;text-decoration:none;font-weight:700;font-size:16px;display:inline-block;">View Your Full Itinerary</a>
  </div>
  <div style="border-top:1px solid #e5e7eb;padding-top:16px;margin-top:32px;">
    <p style="font-size:12px;color:#9ca3af;text-align:center;">Plan ID: ${planId}<br>WhatsApp: +82-10-8714-0611 · cocotripkr.com</p>
  </div></body></html>`;

  try {
    const { default: nodemailer } = await import('nodemailer');
    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: gmailUser, pass: gmailPass } });
    await transporter.sendMail({
      from: `"CocoTrip" <${gmailUser}>`,
      to: email,
      subject: `✅ Your CocoTrip Plan: ${tourTitle || 'Korea Itinerary'}`,
      html,
    });
    console.log('[ai-planner-full] Email sent to:', email);
  } catch (e) {
    console.warn('[ai-planner-full] Email failed:', e.message);
  }
}

export async function recordLeadToSheets({ email, guestName, area, styles, pax, planId }) {
  if (!email) return;
  try {
    const { google } = await import('googleapis');
    const sheetClientEmail = (process.env.GOOGLE_CLIENT_EMAIL || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();
    const sheetPrivateKey = (process.env.GOOGLE_PRIVATE_KEY || process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '').replace(/\\n/g, '\n').trim();
    const sheetId = (process.env.GOOGLE_SHEETS_SPREADSHEET_ID || '').trim();
    if (sheetClientEmail && sheetPrivateKey && sheetId) {
      const auth = new google.auth.JWT(sheetClientEmail, undefined, sheetPrivateKey, ['https://www.googleapis.com/auth/spreadsheets']);
      const sheets = google.sheets({ version: 'v4', auth });
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId, range: 'Leads!A:G', valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[new Date().toISOString(), email, guestName, area, styles.join(', '), pax, `Plan: ${planId}`]] },
      });
    }
  } catch (e) { console.warn('[planner] Sheets error:', e.message); }
}
