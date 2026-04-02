import { Context } from "@netlify/functions";
import { CocoTripOrchestrator } from "./_ai_core/orchestrator";
import { TripRequest } from "./_ai_core/models";
import nodemailer from "nodemailer";
import { google } from "googleapis";

export const maxDuration = 300; 
export const runtime = 'nodejs'; // 혹은 'edge' (스트리밍 사용 시)

export default async (req: Request, context: Context) => {
  // CORS 처리
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    let rawBody: any = {};
    try {
      const text = await req.text();
      rawBody = JSON.parse(text || '{}');
      console.log("Request Body [planner-full]:", JSON.stringify(rawBody));
    } catch (e) {
      console.warn("Body parse error, using defaults", e);
    }

    const prefsRaw = rawBody.preferences || rawBody.theme || rawBody.categories;
    const prefsString = Array.isArray(prefsRaw) ? prefsRaw.join(', ') : (prefsRaw || "Free style");

    const requestData: TripRequest = {
      destination: rawBody.destination || (rawBody.regions && rawBody.regions[0]) || "서울 (Seoul)",
      startDate: rawBody.startDate || new Date().toISOString().split("T")[0],
      endDate: rawBody.endDate || new Date().toISOString().split("T")[0],
      durationDays: rawBody.durationDays || rawBody.duration || 3,
      preferences: prefsString,
      pax: rawBody.pax || rawBody.members || 4,
      language: rawBody.language || "en",
      vehicleType: rawBody.vehicleType || "staria"
    };

    const orchestrator = new CocoTripOrchestrator();

    // Server-Sent Events (SSE) 방식으로 프론트엔드에 실시간 로딩바 전송
    const stream = new ReadableStream({
      async start(controller) {
        let finalOutput = "";
        const heartbeat = setInterval(() => controller.enqueue(new TextEncoder().encode(": heartbeat\n\n")), 5000);
        try {
          for await (const chunk of orchestrator.streamRun(requestData)) {
            // chunk 에는 { step: 1, totalSteps: 5, agent: 'planner', result: AgentResult } 등이 담김
            const eventData = `data: ${JSON.stringify(chunk)}\n\n`;
            controller.enqueue(new TextEncoder().encode(eventData));
            if (chunk.step === chunk.totalSteps && chunk.result?.rawOutput) {
              finalOutput = chunk.result.rawOutput;
            }
          }
          
          // 연산 종료 후 이메일 및 스프레드시트 업데이트
          if (rawBody.email && finalOutput) {
            // ── 이메일 발송 (await 강제 — 함수 종료 방지) ──
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
                    <p style="margin-top:20px;font-size:11px;color:#555;text-align:center;">CocoTrip · cocotripkr.com · Unsubscribe anytime</p>
                  </div>`,
                });
                console.log("Email sent successfully to:", rawBody.email);
              } else {
                console.warn("GMAIL credentials not configured — skipping email");
              }
            } catch(e) {
              console.error("Email failed:", e);
            }
            
            try {
               const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
               const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.replace(/\\n/g, '\\n');
               const sheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
               
               if (clientEmail && privateKey && sheetId) {
                 const auth = new google.auth.JWT(clientEmail, undefined, privateKey, ['https://www.googleapis.com/auth/spreadsheets']);
                 const sheets = google.sheets({ version: 'v4', auth });
                 await sheets.spreadsheets.values.append({
                    spreadsheetId: sheetId,
                    range: 'Leads!A:E',
                    valueInputOption: 'USER_ENTERED',
                    requestBody: { values: [[new Date().toISOString(), rawBody.email, requestData.destination, requestData.preferences, "Funnel Captured"]] }
                 });
               }
            } catch(e) { console.error("Sheets failed:", e); }
          }
          
          clearInterval(heartbeat);
          controller.close();
        } catch (e: any) {
          console.error("Pipeline streaming error:", e);
          clearInterval(heartbeat);
          const errorEvent = `data: ${JSON.stringify({ error: e.message })}\n\n`;
          controller.enqueue(new TextEncoder().encode(errorEvent));
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      }
    });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: "Invalid Request", details: error.message }), {
      status: 400,
      headers: { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      }
    });
  }
};

// --- Vercel Native Wrapper ---
export default async function vercelHandler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    return res.status(200).end();
  }

  const event = {
    httpMethod: req.method,
    path: req.url.split('?')[0],
    body: typeof req.body === 'object' ? JSON.stringify(req.body) : (req.body || ''),
    queryStringParameters: req.query || {},
    headers: req.headers || {}
  };
  
  try {
    const result = await originalHandler(event, {});
    
    if (result && result.headers) {
      for (const [key, val] of Object.entries(result.headers)) {
        res.setHeader(key, val);
      }
    }
    if (result && result.statusCode) {
      let finalBody = result.body;
      if (typeof finalBody === 'string') {
        try { finalBody = JSON.parse(finalBody); } catch(e) {}
      }
      return res.status(result.statusCode).json(finalBody);
    }
    return res.status(200).json(result);
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
  