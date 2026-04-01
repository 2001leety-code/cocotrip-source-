import { handler as originalHandler } from '../netlify/functions/reddit-monitor.js';

export const maxDuration = 60; // 60s timeout for heavy AI/Payment tasks

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
};

export default async function handler(req, res) {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(200).end();
  }

  // Netlify Event 객체 흉내내기 (매핑)
  const event = {
    httpMethod: req.method,
    body: typeof req.body === 'object' ? JSON.stringify(req.body) : req.body,
    queryStringParameters: req.query || {},
    headers: req.headers || {}
  };

  try {
    const context = {}; // Fake netlify context
    const result = await originalHandler(event, context);
    
    if (result && result.headers) {
      for (const [key, val] of Object.entries(result.headers)) {
         res.setHeader(key, val);
      }
    }
    
    if (result && result.statusCode) {
      let finalBody = result.body;
      
      // 파싱
      if (typeof finalBody === 'string') {
        try {
          finalBody = JSON.parse(finalBody);
        } catch(e) {}
      }
      return res.status(result.statusCode).json(finalBody);
    }
    
    res.status(200).json(result);
  } catch (err) {
    console.error('Vercel API Adapter Error:', err);
    res.status(500).json({ error: err.message });
  }
}