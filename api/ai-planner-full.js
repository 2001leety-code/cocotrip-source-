/**
 * Vercel API Route: AI Planner Full (SSE streaming + email + sheets)
 * Rewrites from /api/ai-planner-full
 */
import { CocoTripOrchestrator } from './_ai_core/orchestrator.js';
import nodemailer from 'nodemailer';

export const maxDuration = 300;
export const config = { runtime: 'nodejs' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, CORS); return res.end(); }
  if (req.method !== 'POST') { res.writeHead(405, { ...CORS, 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Method Not Allowed' })); }

  try {
    let rawBody = req.body;
    if (typeof rawBody === 'string') { try { rawBody = JSON.parse(rawBody); } catch { rawBody = {}; } }
    rawBody = rawBody || {};

    console.log("Request Body [ai-planner-full.js]:", JSON.stringify(rawBody));

    const prefsRaw = rawBody.preferences || rawBody.theme || rawBody.categories;
    const prefsString = Array.isArray(prefsRaw) ? prefsRaw.join(', ') : (prefsRaw || 'Seoul Hotspots');

    const requestData = {
      destination: rawBody.destination || (rawBody.regions && rawBody.regions[0]) || 'Seoul',
      startDate: rawBody.startDate || new Date().toISOString().split('T')[0],
      endDate: rawBody.endDate || new Date().toISOString().split('T')[0],
      durationDays: rawBody.durationDays || rawBody.duration || 3,
      preferences: prefsString,
      pax: rawBody.pax || rawBody.members || 2,
      language: rawBody.language || 'en',
      vehicleType: rawBody.vehicleType || 'staria',
    };

    const orchestrator = new CocoTripOrchestrator();

    // SSE 헤더
    res.writeHead(200, {
      ...CORS,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const heartbeatInterval = setInterval(() => {
      res.write(`: heartbeat\n\n`);
    }, 5000);

    let finalOutput = '';
    try {
      for await (const chunk of orchestrator.streamRun(requestData)) {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        if (chunk.step === chunk.totalSteps && chunk.result?.rawOutput) {
          finalOutput = chunk.result.rawOutput;
        }
      }

      // 이메일 발송 (await 강제 — 함수 종료 방지)
      if (rawBody.email && finalOutput) {
        try {
          let parsedStr = finalOutput;
          const match = parsedStr.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
          if (match) parsedStr = match[1];
          const parsed = JSON.parse(parsedStr);
          const mdReport = parsed.markdownReport || JSON.stringify(parsed.itinerary ?? parsed, null, 2);

          const gmailUser = process.env.GMAIL_USER;
          const gmailPass = process.env.GMAIL_APP_PASSWORD;

          if (gmailUser && gmailPass) {
            const transporter = nodemailer.createTransport({
              service: 'gmail',
              auth: { user: gmailUser, pass: gmailPass },
            });
            await transporter.sendMail({
              from: `"CocoTrip VVIP Planner" <${gmailUser}>`,
              to: rawBody.email,
              subject: `[CocoTrip VVIP] ${requestData.destination} — ${requestData.durationDays}일 맞춤 플랜 도착`,
              html: `<div style="font-family:'Helvetica Neue',Arial,sans-serif;background:#0c1220;color:#FFF;padding:32px;border-radius:16px;max-width:600px;margin:auto;">
                <div style="text-align:center;margin-bottom:24px;">
                  <h1 style="font-size:22px;letter-spacing:3px;background:linear-gradient(90deg,#7C5CFC,#EA537E);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">VVIP KOREA TOUR</h1>
                  <p style="color:#a0a0c0;font-size:13px;margin-top:4px;">Curated exclusively by CocoTrip AI Experts</p>
                </div>
                <div style="background:rgba(255,255,255,0.05);padding:24px;border-radius:12px;border:1px solid rgba(124,92,252,0.25);">
                  <p style="white-space:pre-wrap;line-height:1.75;color:#E2E8F0;font-size:14px;">${mdReport.replace(/\n/g, '<br/>')}</p>
                </div>
                <div style="margin-top:28px;text-align:center;">
                  <a href="https://cocotripkr.com/charter" style="display:inline-block;background:linear-gradient(90deg,#7C5CFC,#EA537E);color:#fff;padding:14px 32px;border-radius:30px;font-weight:bold;text-decoration:none;font-size:14px;">Book Your Private Van</a>
                </div>
              </div>`,
            });
            console.log("Email sent to:", rawBody.email);
          }
        } catch (e) {
          console.error("Email failed:", e);
        }

        // Google Sheets 기록
        try {
          const { google } = await import('googleapis');
          const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
          const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.replace(/\\n/g, '\n');
          const sheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
          if (clientEmail && privateKey && sheetId) {
            const auth = new google.auth.JWT(clientEmail, undefined, privateKey, ['https://www.googleapis.com/auth/spreadsheets']);
            const sheets = google.sheets({ version: 'v4', auth });
            await sheets.spreadsheets.values.append({
              spreadsheetId: sheetId, range: 'Leads!A:E', valueInputOption: 'USER_ENTERED',
              requestBody: { values: [[new Date().toISOString(), rawBody.email, requestData.destination, requestData.preferences, "Funnel Captured"]] },
            });
          }
        } catch (e) { console.error("Sheets failed:", e); }
      }

    } finally {
      clearInterval(heartbeatInterval);
    }

    res.end();

  } catch (error) {
    console.error('Pipeline error:', error);
    if (!res.headersSent) {
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    }
    res.end(JSON.stringify({ error: 'Invalid Request', details: error.message }));
  }
}
