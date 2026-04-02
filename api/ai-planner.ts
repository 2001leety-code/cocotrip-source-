import { Context } from "@netlify/functions";
import { CocoTripOrchestrator } from "./_ai_core/orchestrator";
import { TripRequest } from "./_ai_core/models";

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
        try {
          for await (const chunk of orchestrator.streamRun(requestData)) {
            // chunk 에는 { step: 1, totalSteps: 5, agent: 'planner', result: AgentResult } 등이 담김
            const eventData = `data: ${JSON.stringify(chunk)}\n\n`;
            controller.enqueue(new TextEncoder().encode(eventData));
          }
          controller.close();
        } catch (e: any) {
          console.error("Pipeline streaming error:", e);
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
  