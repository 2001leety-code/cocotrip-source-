import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_DIR = path.join(__dirname, '..', 'api');

if (!fs.existsSync(API_DIR)) {
  fs.mkdirSync(API_DIR, { recursive: true });
}

// 1. 유틸리티가 아닌 엔드포인트 목록
const endpoints = [
  'applyPromoCode.js', 'blog-publisher.js', 'booking-processor.js',
  'capturePaypalOrder.js', 'chat.js', 'competitor-monitor.js',
  'content-generator.js', 'createPaypalOrder.js', 'daily-report.js',
  'enrichPlan.js', 'generateTravelPlan.js', 'place-validator.js',
  'reddit-monitor.js', 'retarget-scheduler.js', 'review-scheduler.js',
  'traffic-alert.js', 'weather-check.js'
];

endpoints.forEach(filename => {
  const bridgeContent = `
import { handler as originalHandler } from '../netlify/functions/${filename}';

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
`;
  const destPath = path.join(API_DIR, filename);
  fs.writeFileSync(destPath, bridgeContent.trim());
  console.log("Bridged " + filename);
});

console.log('17 netlify endpoints migrated!');
