import { Context } from "@netlify/functions";
import { CocoTripOrchestrator } from "./ai_core/orchestrator";
import { TripRequest } from "./ai_core/models";
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
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const rawBody = await req.json();
    const requestData: TripRequest = {
      destination: rawBody.destination || "서울 (Seoul)",
      startDate: rawBody.startDate || new Date().toISOString().split("T")[0],
      endDate: rawBody.endDate || new Date().toISOString().split("T")[0],
      durationDays: rawBody.durationDays || 3,
      preferences: rawBody.preferences || "K-pop, K-food",
      pax: rawBody.pax || 4,
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
            try {
              let parsedStr = finalOutput;
              const match = parsedStr.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
              if (match) parsedStr = match[1];
              const parsed = JSON.parse(parsedStr);
              const mdReport = parsed.markdownReport || JSON.stringify(parsed.itinerary, null, 2);
              
              const transporter = nodemailer.createTransport({
                 service: 'gmail',
                 auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
              });
              
              await transporter.sendMail({
                 from: `"CocoTrip VVIP Planner" <${process.env.GMAIL_USER}>`,
                 to: rawBody.email,
                 subject: `[CocoTrip VIP] Your 3-Day Custom K-Tour Itinerary`,
                 html: `<div style="font-family: Arial, sans-serif; background: #0c1220; color: #FFF; padding: 30px; border-radius: 12px; max-width: 600px; margin: auto;">
                    <div style="text-align: center; margin-bottom: 20px;">
                      <h1 style="color: #7C5CFC; letter-spacing: 2px;">VVIP KOREA TOUR</h1>
                      <p style="color: #c0b283; font-size: 14px;">Perfectly curated by our AI experts</p>
                    </div>
                    <div style="background: rgba(255,255,255,0.05); padding: 20px; border-radius: 8px; border: 1px solid rgba(124,92,252,0.3);">
                      <p style="white-space: pre-wrap; line-height: 1.6; color: #E2E8F0;">${mdReport.replace(/\\n/g, '<br/>')}</p>
                    </div>
                    <div style="margin-top: 30px; text-align: center;">
                       <a href="https://cocotripkr.com/charter" style="background: linear-gradient(to right, #7C5CFC, #EA537E); color: white; padding: 15px 30px; text-decoration: none; border-radius: 30px; font-weight: bold; display: inline-block;">Book Your Private Van</a>
                    </div>
                 </div>`
              });
            } catch(e) { console.error("Email failed:", e); }
            
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
