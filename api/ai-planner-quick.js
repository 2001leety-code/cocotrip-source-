/**
 * Vercel API Route: AI Planner Quick (1-page preview)
 * Rewrites from /api/ai-planner-quick
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getSpotContext } from './_spots_helper.js';

export const maxDuration = 60;
export const config = { runtime: 'nodejs' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const FALLBACK = {
  en: {
    themes: ['Seoul Highlights'],
    marketingNarrative: 'Your personalized Seoul itinerary is being prepared. Please try again in a moment.',
    day1MarkdownTable: '### Day 1 Preview\n| Time | Spot | Tip |\n|---|---|---|\n| 10:00 | Gyeongbokgung Palace | Arrive early to avoid crowds |\n| 12:00 | Gwangjang Market | Try bindaetteok & mayak gimbap |\n| 14:00 | Bukchon Hanok Village | Best photo spots on the hill |\n| 16:00 | Insadong Tea Street | Traditional tea experience |\n| 18:00 | Namsan Tower | Sunset view from the top |',
  },
  ko: {
    themes: ['서울 핵심 여행'],
    marketingNarrative: '맞춤형 서울 여행 일정을 준비하고 있습니다.',
    day1MarkdownTable: '### 1일차 미리보기\n| 시간 | 명소 | 팁 |\n|---|---|---|\n| 10:00 | 경복궁 | 오전에 방문 추천 |\n| 12:00 | 광장시장 | 빈대떡, 마약김밥 필수 |\n| 14:00 | 북촌한옥마을 | 언덕 위 포토스팟 |\n| 16:00 | 인사동 | 전통 찻집 체험 |\n| 18:00 | 남산타워 | 일몰 시간 맞춰 방문 |',
  },
  ja: {
    themes: ['ソウルハイライト'],
    marketingNarrative: 'パーソナライズされたソウル旅程を準備中です。',
    day1MarkdownTable: '### Day 1 プレビュー\n| 時間 | スポット | ヒント |\n|---|---|---|\n| 10:00 | 景福宮 | 午前中がおすすめ |\n| 12:00 | 広蔵市場 | ビンデトッ＆麻薬キンパ |\n| 14:00 | 北村韓屋村 | 丘の上がフォトスポット |\n| 16:00 | 仁寺洞 | 伝統茶体験 |\n| 18:00 | Nソウルタワー | 夕日がベスト |',
  },
  zh: {
    themes: ['首尔精华'],
    marketingNarrative: '正在为您准备个性化首尔行程。',
    day1MarkdownTable: '### 第1天预览\n| 时间 | 景点 | 贴士 |\n|---|---|---|\n| 10:00 | 景福宫 | 建议上午参观 |\n| 12:00 | 广藏市场 | 必尝绿豆煎饼 |\n| 14:00 | 北村韩屋村 | 山坡上拍照最佳 |\n| 16:00 | 仁寺洞 | 传统茶馆体验 |\n| 18:00 | 南山塔 | 日落时分最美 |',
  },
};

function buildPrompt(lang, destination, preferences, durationDays, pax, foodPrefs) {
  const foodNote = foodPrefs ? `\nFood preferences: ${foodPrefs}` : '';
  if (lang === 'ko') {
    return {
      system: `당신은 한국 여행 전문 플래너입니다.
외국인 관광객을 위한 매력적인 1일차 여행 프리뷰를 작성하세요.
${foodPrefs ? `
식사 추천 — 엄격 규칙 (절대 위반 금지):
${foodPrefs}

Halal 포함 시: 할랄 인증 식당만 추천 (예: 이태원 Eid, Murree, Yang Good). 돼지고기/비할랄 제외.
Vegan 포함 시: 100% 식물성 식당/메뉴만 추천. 비빔밥(계란/고기 제외), 콩국수, 사찰음식. 젓갈/멸치육수 포함 메뉴 절대 제외.
알러지 지정 시: 안전 최우선 사항. 해당 알러지 식재료 포함 메뉴 절대 금지. 팁에 "⚠️ 식당에 알러지 알리기" 추가.
가성비 선택 시: 시장/길거리 음식 우선 (₩5,000-12,000). 고급 선택 시: 미슐랭 레스토랑 (₩50,000+).` : ''}

반드시 아래 JSON 형태로만 응답하세요 (다른 텍스트 없이):
{
  "themes": ["테마1", "테마2"],
  "marketingNarrative": "이 여행의 매력을 3문장으로 설명",
  "day1MarkdownTable": "| 시간 | 명소 | 팁 |\\n|---|---|---|\\n| 10:00 | 명소이름 | 실용 팁 |"
}`,
      user: `목적지: ${destination}, 관심사: ${preferences}, ${durationDays}일 여행 중 1일차. ${pax}명.${foodNote}`,
    };
  }

  // English (default for EN, JA, ZH — all get English output for international travelers)
  return {
    system: `You are CocoTrip's expert Korea travel planner.
Create an exciting Day 1 preview itinerary for international tourists.
${foodPrefs ? `
MEAL PLANNING — STRICT RULES (NEVER VIOLATE):
${foodPrefs}

If Diet includes "Halal": ONLY recommend halal-certified restaurants (e.g. Eid, Murree, Yang Good in Itaewon). NEVER suggest pork or non-halal meat.
If Diet includes "Vegan": ONLY recommend plant-based options. Korean vegan dishes: Bibimbap (no egg/meat), Kongguksu, temple food. NEVER suggest fish sauce or anchovy stock.
If Allergies are listed: This is SAFETY-CRITICAL. NEVER recommend any dish containing the allergen. Add "⚠️ Inform restaurant of allergy" in tips.
If Meal budget is "Budget": Prioritize street food and markets (₩5,000-12,000). If "Premium": Recommend Michelin-listed restaurants (₩50,000+).
Reflect these preferences in ALL meal/food recommendations.` : ''}

RESPOND ONLY with this exact JSON format (no other text):
{
  "themes": ["Theme 1", "Theme 2"],
  "marketingNarrative": "A compelling 2-3 sentence description of why this trip is amazing",
  "day1MarkdownTable": "| Time | Spot | Insider Tip |\\n|---|---|---|\\n| 10:00 | Spot Name | Practical tip |\\n| 12:00 | Spot Name | Practical tip |\\n| 14:00 | Spot Name | Practical tip |\\n| 16:00 | Spot Name | Practical tip |\\n| 18:00 | Spot Name | Practical tip |"
}

RULES:
- Include 5-7 time slots from morning to evening
- Each tip must be specific and useful (subway exit numbers, best menu items, photo angles)
- Use real, verified places that exist in Korea
- Make the narrative exciting and personal`,
    user: `Destination: ${destination}, Interests: ${preferences || 'culture, food, photos'}, Trip: ${durationDays} days (Day 1 preview). Group size: ${pax}.${foodNote}`,
  };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, CORS); return res.end(); }
  if (req.method !== 'POST') { res.writeHead(405, { ...CORS, 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Method Not Allowed' })); }

  try {
    let rawBody = req.body;
    if (typeof rawBody === 'string') { try { rawBody = JSON.parse(rawBody); } catch { rawBody = {}; } }
    rawBody = rawBody || {};

    const lang = rawBody.language || 'en';
    const destination = rawBody.destination || (rawBody.regions && rawBody.regions[0]) || 'Seoul';
    const prefsRaw = rawBody.preferences || rawBody.theme || rawBody.categories;
    const preferences = Array.isArray(prefsRaw) ? prefsRaw.join(', ') : (prefsRaw || 'K-food, culture');
    const durationDays = rawBody.durationDays || rawBody.duration || 3;
    const pax = rawBody.pax || rawBody.members || 2;

    // ── Food preferences ──
    const dietPrefs = Array.isArray(rawBody.dietPrefs) ? rawBody.dietPrefs : [];
    const allergies = Array.isArray(rawBody.allergies) ? rawBody.allergies : [];
    const priceRange = rawBody.priceRange || 'Any';
    const foodPrefParts = [];
    if (dietPrefs.length) foodPrefParts.push(`Diet: ${dietPrefs.join(', ')}`);
    if (allergies.length) foodPrefParts.push(`Allergies/Avoid: ${allergies.join(', ')}`);
    if (priceRange && priceRange !== 'Any') foodPrefParts.push(`Meal budget: ${priceRange}`);
    const foodPrefs = foodPrefParts.length > 0 ? foodPrefParts.join('. ') : '';

    const apiKey = process.env.GEMINI_API_KEY || '';
    if (!apiKey) throw new Error('API Key configuration missing');

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const spotContext = getSpotContext(destination);
    const { system: systemPrompt, user: userPrompt } = buildPrompt(lang, destination, preferences, durationDays, pax, foodPrefs);
    const fullUserPrompt = userPrompt + (spotContext ? `\n\nLocal data:\n${spotContext}` : '');

    // ── Gemini 호출 + JSON 파싱 (최대 3회 재시도) ──
    const MAX_RETRIES = 3;
    let json = null;
    let lastError = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 18000);
        let result;
        try {
          result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: fullUserPrompt }] }],
            systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
            generationConfig: { temperature: 0.7, maxOutputTokens: 2000, responseMimeType: 'application/json' },
          });
        } finally {
          clearTimeout(timer);
        }

        const text = result.response.text();
        console.log(`[AI-Planner] Attempt ${attempt + 1} response length: ${text.length}`);

        // 1차: 코드블록 추출
        let finalJsonStr = text;
        const matchBlock = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (matchBlock) finalJsonStr = matchBlock[1];

        // 2차: 가장 바깥 { ... } 추출
        if (!finalJsonStr.trim().startsWith('{')) {
          const first = finalJsonStr.indexOf('{');
          const last  = finalJsonStr.lastIndexOf('}');
          if (first !== -1 && last > first) finalJsonStr = finalJsonStr.slice(first, last + 1);
        }

        json = JSON.parse(finalJsonStr);

        // 유효성 검증 — 최소한 marketingNarrative가 있어야 함
        if (!json.marketingNarrative || json.marketingNarrative.length < 10) {
          throw new Error('Response too short or missing narrative');
        }
        break; // 파싱 + 검증 성공

      } catch (parseErr) {
        lastError = parseErr;
        console.warn(`[AI-Planner] Attempt ${attempt + 1}/${MAX_RETRIES} failed:`, parseErr.message);
        if (attempt < MAX_RETRIES - 1) {
          await new Promise(r => setTimeout(r, 800));
        }
      }
    }

    // 최종 실패 시 언어별 폴백
    if (!json) {
      console.error('[AI-Planner] All retries exhausted, returning fallback:', lastError?.message);
      json = FALLBACK[lang] || FALLBACK.en;
    }

    // ── 타입 정규화 ──
    if (json.marketingNarrative && typeof json.marketingNarrative !== 'string') {
      json.marketingNarrative = JSON.stringify(json.marketingNarrative);
    }
    if (json.day1MarkdownTable && typeof json.day1MarkdownTable !== 'string') {
      json.day1MarkdownTable = JSON.stringify(json.day1MarkdownTable, null, 2);
    }
    if (!Array.isArray(json.themes)) {
      json.themes = typeof json.themes === 'string' ? [json.themes] : [];
    }
    if (typeof json.day1MarkdownTable === 'string') {
      json.day1MarkdownTable = json.day1MarkdownTable.replace(/\\n/g, '\n');
    }

    // ── 누락 필드 폴백 보완 ──
    const fb = FALLBACK[lang] || FALLBACK.en;
    if (!json.marketingNarrative || json.marketingNarrative.trim().length < 10) {
      json.marketingNarrative = fb.marketingNarrative;
    }
    if (!json.day1MarkdownTable || json.day1MarkdownTable.trim().length < 20) {
      json.day1MarkdownTable = fb.day1MarkdownTable;
      console.log('[AI-Planner] day1MarkdownTable missing from Gemini — using fallback table');
    }
    if (!json.themes || json.themes.length === 0) {
      json.themes = fb.themes;
    }

    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(json));

  } catch (error) {
    console.error('Quick planner error:', error);
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(FALLBACK.en));
  }
}
