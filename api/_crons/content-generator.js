/**
 * CocoTripKR — SNS 콘텐츠 자동 생성 (스케줄 함수)
 *
 * 매일 오전 8:00 KST (= UTC 23:00 전날) 실행
 * Gemini가 TikTok 스크립트, Instagram 캡션, 블로그 SEO 포스트 자동 생성
 * 텔레그램으로 승인 요청 전송
 *
 * CONTEXT: CocoTripKR 마케팅 자동화
 * SCHEDULE: 0 23 * * * (UTC) = 매일 KST 08:00
 */

import { sendLongMessage, sendErrorAlert } from './_telegram.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

// ── 오늘의 트렌드 토픽 (시즌/이벤트 기반) ────────────────────────────
function getTodayTopic() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const dayOfWeek = now.getDay();

  const seasonalTopics = {
    3: ['벚꽃 시즌 서울 드라이브', '여의도 벚꽃 프라이빗 투어', '진해 벚꽃축제 전세차량'],
    4: ['서울 봄꽃 명소 TOP 5', '경주 벚꽃 로드트립', '가평 봄 카페 투어'],
    5: ['석가탄신일 연휴 여행', '어린이날 가족 투어', '서울 루프탑 시즌'],
    6: ['제주도 여름 프라이빗 투어', '부산 해운대 셔틀', '한강 야경 투어'],
    7: ['보령 머드축제 셔틀', 'K-pop 콘서트 시즌', '여름 계곡 투어'],
    8: ['광복절 연휴 투어', '강릉 여름 드라이브', '속초 해변 투어'],
    9: ['추석 연휴 공항 픽업', '가을 단풍 투어 예약', '경주 가을 여행'],
    10: ['단풍 시즌 설악산', '전주 한옥마을 가을', '남이섬 단풍 투어'],
    11: ['김장 체험 투어', '겨울 준비 서울 쇼핑', 'BTS 성지순례 투어'],
    12: ['크리스마스 서울 야경', '스키장 셔틀 서비스', '연말 가평 투어'],
    1: ['설날 연휴 공항 픽업', '겨울 온천 투어', '평창 스키 셔틀'],
    2: ['발렌타인 커플 투어', '매화 시즌 시작', '제주 봄 여행 사전예약'],
  };

  const topics = seasonalTopics[month] || ['한국 프라이빗 투어의 매력'];
  const idx = (day + dayOfWeek) % topics.length;
  return topics[idx];
}

// ── AI 콘텐츠 생성 ──────────────────────────────────────────────────
async function generateContent(topic) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: `You are a viral content creator for CocoTripKR (cocotripkr.com), a premium Korea private tour service.
Create content that feels authentic and trendy, NOT corporate.

Output JSON with this exact structure:
{
  "tiktok": {
    "hook": "First 3 seconds hook (must stop scrolling)",
    "script": "Full 30-60 second script with visual directions",
    "hashtags": "#tag1 #tag2 ...",
    "sound": "Trending sound suggestion"
  },
  "instagram": {
    "caption": "Instagram caption (engaging, with line breaks)",
    "hashtags": "30 relevant hashtags",
    "reelIdea": "15-second reel concept",
    "bestTimeToPost": "HH:MM KST"
  },
  "blog": {
    "title": "SEO-optimized blog title (English)",
    "titleJa": "Japanese version",
    "titleZh": "Chinese version",
    "metaDescription": "155 chars max",
    "outline": ["H2 heading 1", "H2 heading 2", "..."],
    "keywords": ["keyword1", "keyword2", "..."],
    "affiliateAnchors": ["natural anchor text for CocoTripKR links"]
  }
}`
  });

  const result = await model.generateContent(`Today's topic: "${topic}"\nCreate viral SNS content for all platforms. Make it feel like a real travel influencer, not an ad.`);
  const text = result.response.text();
  const match = text.match(/\{[\s\S]*\}/);
  return match ? JSON.parse(match[0]) : null;
}

// ── 메인 핸들러 ──────────────────────────────────────────────────────
const contentTask = async () => {
  console.log('[content-generator] SNS 콘텐츠 생성 시작');

  try {
    const topic = getTodayTopic();
    console.log('[content-generator] 오늘의 토픽:', topic);

    const content = await generateContent(topic);

    if (!content) {
      await sendLongMessage('⚠️ SNS 콘텐츠 생성 실패 — AI 응답 파싱 오류');
      return { statusCode: 200, body: 'Generation failed' };
    }

    // 텔레그램으로 승인 요청 전송
    const msg = `🎬 <b>오늘의 SNS 콘텐츠 (승인 대기)</b>
📌 토픽: ${topic}

━━━ TikTok ━━━
🪝 <b>Hook:</b> ${content.tiktok?.hook || '-'}

📝 <b>스크립트:</b>
<i>${(content.tiktok?.script || '').slice(0, 300)}</i>

🎵 추천 사운드: ${content.tiktok?.sound || '-'}
${content.tiktok?.hashtags || ''}

━━━ Instagram ━━━
📸 <b>캡션:</b>
<i>${(content.instagram?.caption || '').slice(0, 300)}</i>

🎞 <b>릴스 아이디어:</b> ${content.instagram?.reelIdea || '-'}
⏰ 최적 게시 시간: ${content.instagram?.bestTimeToPost || '-'}

━━━ Blog (SEO) ━━━
📝 <b>${content.blog?.title || '-'}</b>
🇯🇵 ${content.blog?.titleJa || '-'}
🇨🇳 ${content.blog?.titleZh || '-'}

📋 아웃라인:
${(content.blog?.outline || []).map((h, i) => `  ${i+1}. ${h}`).join('\n')}

🔑 키워드: ${(content.blog?.keywords || []).join(', ')}

👆 승인하시면 블로그 자동 발행됩니다`;

    await sendLongMessage(msg);
    console.log('[content-generator] 콘텐츠 생성 및 전송 완료');
    return { statusCode: 200, body: 'Content generated' };

  } catch (err) {
    console.error('[content-generator] 오류:', err.message);
    try { await sendErrorAlert('content-generator', err); } catch {}
    return { statusCode: 500, body: err.message };
  }
};

const originalHandler = schedule('0 23 * * *', contentTask);

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
  