/**
 * Vercel API Route: AI Planner (SSE Streaming)
 * 
 * 원본: netlify/functions/ai-planner.ts
 * Vercel Edge Runtime으로 60초 타임아웃 + SSE 스트리밍
 */

import { CocoTripOrchestrator } from '../netlify/functions/ai_core/orchestrator.js';

export const maxDuration = 300; 

export const config = {
  runtime: 'nodejs',
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, CORS_HEADERS);
    return res.end();
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Method Not Allowed' }));
  }

  try {
    let rawBody = req.body;
    if (typeof rawBody === 'string') {
      try { rawBody = JSON.parse(rawBody); } catch (e) { rawBody = {}; }
    }
    rawBody = rawBody || {};
    
    console.log("Request Body [ai-planner.js]:", JSON.stringify(rawBody));
    
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

    // SSE 헤더 설정
    res.writeHead(200, {
      ...CORS_HEADERS,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // 스트리밍 전송 및 504 타임아웃 방지용 heartbeat 추가
    const heartbeatInterval = setInterval(() => {
      res.write(`: heartbeat\n\n`); // SSE 주석(빈 데이터) 전송
    }, 5000); // 5초마다

    try {
      for await (const chunk of orchestrator.streamRun(requestData)) {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
    } finally {
      clearInterval(heartbeatInterval);
    }

    res.end();

  } catch (error) {
    console.error('Pipeline error:', error);
    if (!res.headersSent) {
      res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    }
    res.end(JSON.stringify({ error: 'Invalid Request', details: error.message }));
  }
}
