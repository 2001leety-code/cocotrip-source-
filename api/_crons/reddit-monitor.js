/**
 * CocoTripKR — Reddit 모니터링 (스케줄 함수)
 *
 * 매일 오후 2:00 KST (= UTC 05:00) 실행
 * r/korea, r/travel, r/kpop에서 키워드 스캔 → 잠재 고객 발견 시 텔레그램 알림
 *
 * CONTEXT: CocoTripKR 마케팅 자동화
 * SCHEDULE: 0 5 * * * (UTC) = 매일 KST 14:00
 */

import { sendMessage, sendLongMessage, sendErrorAlert } from '../_telegram.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const SUBREDDITS = ['korea', 'travel', 'kpop', 'koreatravel', 'seoul'];
const KEYWORDS = [
  'private tour korea', 'airport pickup seoul', 'incheon transfer',
  'korea driver', 'seoul driver', 'korea transportation',
  'kpop concert transport', 'korea family trip', 'korea itinerary',
  'charter car korea', 'korea van rental', 'private car seoul',
  'busan tour', 'jeju tour', 'gyeongju tour',
  'korea with kids', 'korea honeymoon', 'korea road trip'
];

// ── Reddit JSON API (인증 불필요) ──────────────────────────────────────
async function fetchSubredditPosts(subreddit) {
  try {
    const url = `https://www.reddit.com/r/${subreddit}/new.json?limit=25&t=day`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'CocoTripKR-Bot/1.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.data?.children || []).map(c => ({
      title: c.data.title || '',
      selftext: (c.data.selftext || '').slice(0, 500),
      url: `https://reddit.com${c.data.permalink}`,
      author: c.data.author || '',
      subreddit: c.data.subreddit || subreddit,
      created: c.data.created_utc || 0,
      score: c.data.score || 0,
    }));
  } catch (err) {
    console.warn(`[reddit] r/${subreddit} 스캔 실패:`, err.message);
    return [];
  }
}

// ── 키워드 매칭 ──────────────────────────────────────────────────────
function matchesKeywords(post) {
  const text = `${post.title} ${post.selftext}`.toLowerCase();
  return KEYWORDS.filter(kw => text.includes(kw));
}

// ── AI 답변 초안 생성 ────────────────────────────────────────────────
async function generateReplyDraft(post) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash-lite',
    systemInstruction: `You are a helpful travel assistant who knows Korea well.
Write a friendly, helpful Reddit comment for a traveler asking about Korea.
- Be genuinely helpful, NOT promotional
- Naturally mention "I've used CocoTripKR for private tours" only if relevant
- Keep it under 200 words
- Sound like a real person, not a bot
- Include specific local tips`
  });
  const result = await model.generateContent(`Reddit post from r/${post.subreddit}:\nTitle: ${post.title}\nBody: ${post.selftext}`);
  return result.response.text();
}

// ── 메인 핸들러 ──────────────────────────────────────────────────────
const redditTask = async () => {
  console.log('[reddit-monitor] Reddit 스캔 시작');

  try {
    const allPosts = [];

    // 모든 서브레딧 병렬 스캔
    const results = await Promise.allSettled(
      SUBREDDITS.map(sub => fetchSubredditPosts(sub))
    );

    results.forEach(r => {
      if (r.status === 'fulfilled') allPosts.push(...r.value);
    });

    console.log(`[reddit-monitor] 총 ${allPosts.length}개 포스트 스캔`);

    // 키워드 매칭
    const matches = allPosts
      .map(post => ({ ...post, matched: matchesKeywords(post) }))
      .filter(post => post.matched.length > 0)
      .sort((a, b) => b.matched.length - a.matched.length)
      .slice(0, 5); // 상위 5개만

    if (matches.length === 0) {
      console.log('[reddit-monitor] 매칭 포스트 없음');
      return { statusCode: 200, body: 'No matches found' };
    }

    console.log(`[reddit-monitor] ${matches.length}개 잠재 고객 포스트 발견`);

    // 가장 유망한 포스트 3개에 대해 AI 답변 초안 생성
    let alertMsg = `🔍 <b>Reddit 잠재 고객 발견!</b>\n\n`;

    for (let i = 0; i < Math.min(matches.length, 3); i++) {
      const post = matches[i];
      alertMsg += `━━━ ${i + 1}번 ━━━\n`;
      alertMsg += `📌 r/${post.subreddit}: <b>${post.title.slice(0, 60)}</b>\n`;
      alertMsg += `🔗 ${post.url}\n`;
      alertMsg += `🏷 키워드: ${post.matched.join(', ')}\n`;

      try {
        const draft = await generateReplyDraft(post);
        alertMsg += `\n💬 <b>추천 답변 초안:</b>\n<i>${draft.slice(0, 400)}</i>\n\n`;
      } catch {
        alertMsg += `\n💬 AI 답변 생성 실패 — 수동 확인 필요\n\n`;
      }
    }

    alertMsg += `\n총 매칭: ${matches.length}건 / 스캔: ${allPosts.length}개 포스트`;
    await sendLongMessage(alertMsg);

    return { statusCode: 200, body: `Found ${matches.length} matches` };

  } catch (err) {
    console.error('[reddit-monitor] 오류:', err.message);
    try { await sendErrorAlert('reddit-monitor', err); } catch {}
    return { statusCode: 500, body: err.message };
  }
};

const originalHandler = redditTask;

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
  