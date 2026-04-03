/**
 * CocoTripKR — 구글 블로그 자동 발행
 *
 * content-generator.js에서 생성된 블로그 콘텐츠를 Blogger API로 자동 발행
 * 영어/일어/중어 3개 언어 동시 발행 + 제휴 링크 자동 삽입
 *
 * HTTP 엔드포인트: POST /api/blog-publisher
 * (텔레그램 봇 Webhook 또는 수동 호출)
 *
 * ENV: BLOGGER_BLOG_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_KEY
 */

import { sendMessage, sendErrorAlert } from '../_telegram.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const BLOGGER_API = 'https://www.googleapis.com/blogger/v3/blogs';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

// ── Blogger API용 OAuth2 토큰 ─────────────────────────────────────
async function getBloggerToken() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!privateKey && process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    const keyJson = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf8'));
    privateKey = keyJson.private_key;
  }
  if (!email || !privateKey) throw new Error('서비스 계정 미설정');

  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  const signInput = `${b64({alg:'RS256',typ:'JWT'})}.${b64({iss:email,scope:'https://www.googleapis.com/auth/blogger',aud:'https://oauth2.googleapis.com/token',exp:now+3600,iat:now})}`;
  const pemContent = privateKey.replace('-----BEGIN PRIVATE KEY-----','').replace('-----END PRIVATE KEY-----','').replace(/\n/g,'');
  const binaryKey = Uint8Array.from(atob(pemContent), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey('pkcs8', binaryKey, {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'}, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signInput));
  const jwt = `${signInput}.${Buffer.from(sig).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'')}`;
  const res = await fetch('https://oauth2.googleapis.com/token', { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body: new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:jwt}) });
  const data = await res.json();
  if (!data.access_token) throw new Error('Blogger 토큰 발급 실패');
  return data.access_token;
}

// ── AI 블로그 포스트 생성 (3개 언어) ────────────────────────────────
async function generateBlogPost(topic, language = 'en') {
  const langMap = { en: 'English', ja: 'Japanese', zh: 'Simplified Chinese' };
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: `You are an SEO expert travel blogger for CocoTripKR.
Write a complete blog post in ${langMap[language] || 'English'}.
- 1500+ words, well-structured with H2/H3 headings
- Include practical tips, specific prices in KRW and USD
- Naturally include 2-3 affiliate links to cocotripkr.com (charter, planner, pickup pages)
- Use HTML formatting (<h2>, <p>, <a>, <strong>, <ul>, etc.)
- Include a compelling meta description
- End with a clear CTA to book at cocotripkr.com
Output JSON: { "title": "...", "content": "<html>...", "labels": ["tag1","tag2"], "metaDescription": "..." }`
  });
  const result = await model.generateContent(`Write a complete SEO blog post about: "${topic}" in ${langMap[language]}. Include affiliate links to https://cocotripkr.com/charter and https://cocotripkr.com/planner`);
  const text = result.response.text();
  const match = text.match(/\{[\s\S]*\}/);
  return match ? JSON.parse(match[0]) : null;
}

// ── Blogger API 포스트 발행 ──────────────────────────────────────
async function publishToBlgger(blogId, accessToken, post) {
  const res = await fetch(`${BLOGGER_API}/${blogId}/posts/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      kind: 'blogger#post',
      title: post.title,
      content: post.content,
      labels: post.labels || [],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Blogger 발행 실패: ${data.error.message}`);
  return data;
}

// ── 메인 핸들러 ──────────────────────────────────────────────────────
const originalHandler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'POST only' }) };

  try {
    const body = JSON.parse(event.body || '{}');
    const topic = body.topic || 'Best Private Tours in Seoul 2026';
    const languages = body.languages || ['en', 'ja', 'zh'];
    const blogId = process.env.BLOGGER_BLOG_ID;

    if (!blogId) {
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ status: 'skipped', reason: 'BLOGGER_BLOG_ID not set' }) };
    }

    const accessToken = await getBloggerToken();
    const results = [];

    for (const lang of languages) {
      try {
        console.log(`[blog-publisher] ${lang} 포스트 생성 중...`);
        const post = await generateBlogPost(topic, lang);

        if (post) {
          const published = await publishToBlgger(blogId, accessToken, post);
          results.push({ lang, title: post.title, url: published.url, status: 'published' });
          console.log(`[blog-publisher] ${lang} 발행 완료:`, published.url);
        }
      } catch (err) {
        results.push({ lang, status: 'error', error: err.message });
        console.error(`[blog-publisher] ${lang} 발행 실패:`, err.message);
      }
    }

    // 텔레그램 결과 보고
    const reportLines = results.map(r =>
      r.status === 'published'
        ? `✅ [${r.lang.toUpperCase()}] ${r.title}\n   ${r.url}`
        : `❌ [${r.lang.toUpperCase()}] ${r.error}`
    );

    await sendMessage(`📝 <b>블로그 자동 발행 완료</b>\n\n${reportLines.join('\n\n')}`);

    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ success: true, results }) };

  } catch (err) {
    console.error('[blog-publisher] 오류:', err.message);
    try { await sendErrorAlert('blog-publisher', err); } catch {}
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: err.message }) };
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
  