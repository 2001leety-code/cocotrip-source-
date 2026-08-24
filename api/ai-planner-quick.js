/**
 * Vercel API Route: AI Planner Quick (1-page preview)
 * Rewrites from /api/ai-planner-quick
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getSpotContext } from './_spots_helper.js';
import { FieldValue } from 'firebase-admin/firestore';
import { initAdminDb } from './_shared/firebase-admin.js';
import { checkIpRateLimit, getClientIp } from './_shared/ip-rate-limit.js';

// ── Firebase Admin (카운터 전용, 공유 헬퍼 사용) ──────────────────────
const counterDb = initAdminDb('quick');

export const maxDuration = 60;
export const config = { runtime: 'nodejs' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ── 표준 응답 래퍼 ──
const _ok  = (data) => ({ ok: true, data });
const _err = (msg, code = 'UNKNOWN_ERROR') => ({ ok: false, error: msg, code });

const FALLBACK = {
  en: {
    themes: ['Seoul Highlights'],
    marketingNarrative: 'Your personalized Seoul itinerary is being prepared. Please try again in a moment.',
    day1MarkdownTable: '### Day 1 Preview\n| Time | Spot | Transit | Tip |\n|---|---|---|---|\n| 10:00 | Gyeongbokgung Palace | Start point | Arrive early to avoid crowds |\n| 12:00 | Gwangjang Market | Subway Line 1, 8 min | Try bindaetteok & mayak gimbap |\n| 14:00 | Bukchon Hanok Village | Walk 12 min | Best photo spots on the hill |\n| 16:00 | Insadong Tea Street | Walk 7 min | Traditional tea experience |\n| 18:00 | Namsan Tower | Bus 02, 15 min | Sunset view from the top |',
  },
  ko: {
    themes: ['서울 핵심 여행'],
    marketingNarrative: '맞춤형 서울 여행 일정을 준비하고 있습니다.',
    day1MarkdownTable: '### 1일차 미리보기\n| 시간 | 명소 | 교통 | 팁 |\n|---|---|---|---|\n| 10:00 | 경복궁 | 출발지 | 오전에 방문 추천 |\n| 12:00 | 광장시장 | 지하철 1호선 8분 | 빈대떡, 마약김밥 필수 |\n| 14:00 | 북촌한옥마을 | 도보 12분 | 언덕 위 포토스팟 |\n| 16:00 | 인사동 | 도보 7분 | 전통 찻집 체험 |\n| 18:00 | 남산타워 | 버스 02번 15분 | 일몰 시간 맞춰 방문 |',
  },
  ja: {
    themes: ['ソウルハイライト'],
    marketingNarrative: 'パーソナライズされたソウル旅程を準備中です。',
    day1MarkdownTable: '### Day 1 プレビュー\n| 時間 | スポット | 交通 | ヒント |\n|---|---|---|---|\n| 10:00 | 景福宮 | 出発地 | 午前中がおすすめ |\n| 12:00 | 広蔵市場 | 地下鉄1号線8分 | ビンデトッ＆麻薬キンパ |\n| 14:00 | 北村韓屋村 | 徒歩12分 | 丘の上がフォトスポット |\n| 16:00 | 仁寺洞 | 徒歩7分 | 伝統茶体験 |\n| 18:00 | Nソウルタワー | バス02番15分 | 夕日がベスト |',
  },
  zh: {
    themes: ['首尔精华'],
    marketingNarrative: '正在为您准备个性化首尔行程。',
    day1MarkdownTable: '### 第1天预览\n| 时间 | 景点 | 交通 | 贴士 |\n|---|---|---|---|\n| 10:00 | 景福宫 | 出发地 | 建议上午参观 |\n| 12:00 | 广藏市场 | 地铁1号线8分钟 | 必尝绿豆煎饼 |\n| 14:00 | 北村韩屋村 | 步行12分钟 | 山坡上拍照最佳 |\n| 16:00 | 仁寺洞 | 步行7分钟 | 传统茶馆体验 |\n| 18:00 | 南山塔 | 公交02路15分钟 | 日落时分最美 |',
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
가성비 선택 시: 시장/길거리 음식 우선 (₩5,000-12,000). 고급 선택 시: 미슐랭 레스토랑 (₩50,000+).` : ''}

반드시 아래 JSON 형태로만 응답하세요 (다른 텍스트 없이):
{
  "themes": ["테마1", "테마2"],
  "marketingNarrative": "이 여행의 매력을 3문장으로 설명",
  "day1MarkdownTable": "| 시간 | 명소 | 교통 | 팁 |\\n|---|---|---|---|\\n| 10:00 | 명소이름 | 출발지 | 실용 팁 |\\n| 12:00 | 명소이름 | 지하철 4호선 12분 | 실용 팁 |"
}

교통 칼럼 규칙:
- "교통" 칼럼에는 이전 장소에서 현재 장소까지의 이동 수단을 적으세요 (예: "지하철 4호선 12분", "도보 8분", "버스 02번 15분", "택시 10분").
- 첫 번째 장소(출발지)는 "출발지"로 표기하세요.
- 4개 칼럼(시간|명소|교통|팁)을 빠짐없이 채우세요.`,
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
If Meal budget is "Budget": Prioritize street food and markets (₩5,000-12,000). If "Premium": Recommend Michelin-listed restaurants (₩50,000+).
Reflect these preferences in ALL meal/food recommendations.` : ''}

RESPOND ONLY with this exact JSON format (no other text):
{
  "themes": ["Theme 1", "Theme 2"],
  "marketingNarrative": "A compelling 2-3 sentence description of why this trip is amazing",
  "day1MarkdownTable": "| Time | Spot | Transit | Insider Tip |\\n|---|---|---|---|\\n| 10:00 | Spot Name | Start point | Practical tip |\\n| 12:00 | Spot Name | Subway Line 4, 12 min | Practical tip |\\n| 14:00 | Spot Name | Walk 8 min | Practical tip |\\n| 16:00 | Spot Name | Bus 02, 15 min | Practical tip |\\n| 18:00 | Spot Name | Taxi 10 min | Practical tip |"
}

RULES:
- Include 5-7 time slots from morning to evening
- The "Transit" column = how to get from the PREVIOUS spot to the CURRENT spot (e.g. "Subway Line 4, 12 min", "Walk 8 min", "Bus 02, 15 min", "Taxi 10 min"). For the first spot, write "Start point".
- Fill ALL 4 columns (Time | Spot | Transit | Insider Tip) for every row — never leave Transit blank.
- Each tip must be specific and useful (subway exit numbers, best menu items, photo angles)
- Use real, verified places that exist in Korea
- Make the narrative exciting and personal`,
    user: `Destination: ${destination}, Interests: ${preferences || 'culture, food, photos'}, Trip: ${durationDays} days (Day 1 preview). Group size: ${pax}.${foodNote}`,
  };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, CORS); return res.end(); }
  if (req.method !== 'POST') { res.writeHead(405, { ...CORS, 'Content-Type': 'application/json' }); return res.end(JSON.stringify(_err('Method Not Allowed', 'METHOD_NOT_ALLOWED'))); }

  try {
    // 비용 DoS 방지: 무인증 + Gemini 호출 엔드포인트라 무한 호출 시 API 비용 폭주.
    // per-IP 시간당 10건(정상 미리보기엔 충분). 초과 429. counterDb null/장애 시 fail-open(정상 유저 보호).
    const rate = await checkIpRateLimit({ db: counterDb, ip: getClientIp(req), collection: 'quick_plan_rate_limits', maxRequests: 10, errorLabel: 'plan previews' });
    if (!rate.ok) {
      res.writeHead(rate.status, { ...CORS, 'Content-Type': 'application/json', 'Retry-After': String(rate.retryAfterSec) });
      return res.end(JSON.stringify(_err(rate.error, 'RATE_LIMITED')));
    }

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
    // WizardForm sends Halal/Vegan/Vegetarian via the canonical `dietaryRestrictions`
    // field (data.tsx DIETARY_RESTRICTION_KEYS) — only these 3 (+None) ever land there.
    // `allergies` is a deprecated inbound alias from old clients/revision links — only
    // halal/vegan/vegetarian are promoted from it; any medical allergen values
    // (Nuts/Shellfish/Gluten/Dairy) are silently dropped.
    const dietPrefs = Array.isArray(rawBody.dietPrefs) ? rawBody.dietPrefs : [];
    const dietaryRestrictions = Array.isArray(rawBody.dietaryRestrictions) ? rawBody.dietaryRestrictions : [];
    const legacyAllergies = Array.isArray(rawBody.allergies) ? rawBody.allergies : [];
    const dietFromLegacyAllergies = legacyAllergies.filter((a) => /^(halal|vegan|vegetarian)$/i.test(String(a || '')));
    const dietAll = [...new Set([...dietPrefs, ...dietaryRestrictions, ...dietFromLegacyAllergies])];
    const priceRange = rawBody.priceRange || 'Any';
    const foodPrefParts = [];
    if (dietAll.length) foodPrefParts.push(`Diet: ${dietAll.join(', ')}`);
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
        // 2026-05-05 (P2 fix): cold start + Gemini SDK init + API round-trip 합산이
        // 18s 초과 가능 → 첫 attempt 만 30s, 이후 attempt 는 warm 가정 18s.
        // 진단: response length 843→692→122 패턴이 timeout 시점 단축 시사.
        const timeoutMs = attempt === 0 ? 30000 : 18000;
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let result;
        try {
          result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: fullUserPrompt }] }],
            systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
            // thinkingBudget:0 — 2.5-flash 는 thinking 토큰이 maxOutputTokens 에서 차감돼
            // 2000 예산이 잘린 JSON(truncated) 원인 (mood-parse-schedule 2026-07-03 동일 버그 fix).
            generationConfig: { temperature: 0.7, maxOutputTokens: 2000, thinkingConfig: { thinkingBudget: 0 }, responseMimeType: 'application/json' },
          });
        } finally {
          clearTimeout(timer);
        }
        // 사용량 실측 기록(비용 가시화 2026-07-09) — fire-and-forget, 실패해도 본 흐름 영향 0.
        import('./_shared/apiUsageRecorder.js').then((m) => m.recordUsageFromResponse('planner-quick', 'gemini-2.5-flash', result.response)).catch(() => {});

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
    res.end(JSON.stringify(_ok(json)));

    // ── 비동기 카운터 기록 (응답 후 실행 — 사용자 대기 없음) ──
    // B9-31 (2026-05-09): 명시적 3s timeout + 1회 retry + 최종 silent fallback.
    // 기존: Firestore 가 매달리면 deadline-exceeded 가 .catch 로 떨어져 console.warn
    //       매번 출력 → Vercel 로그 noise. counter 미증가는 비핵심이라 silent OK.
    if (counterDb) {
      const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
      const monthKey = `${kst.getFullYear()}-${String(kst.getMonth() + 1).padStart(2, '0')}`;
      const dayKey = `${monthKey}-${String(kst.getDate()).padStart(2, '0')}`;
      const inc = FieldValue.increment(1);

      const incrementWithRetry = async (label, runFn) => {
        for (let i = 0; i < 2; i++) {
          try {
            await Promise.race([
              runFn(),
              new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000)),
            ]);
            return;
          } catch (e) {
            if (i === 1) console.info(`[quick] ${label} increment failed (non-fatal):`, e.message);
          }
        }
      };

      // 월별 카운터
      incrementWithRetry('counter', () =>
        counterDb.collection('api_stats').doc(monthKey).set(
          { quickCount: inc, lastUpdated: new Date().toISOString() },
          { merge: true }
        )
      );
      // 일별 카운터
      incrementWithRetry('daily counter', () =>
        counterDb.collection('api_stats').doc(monthKey)
          .collection('daily').doc(dayKey).set(
            { quickCount: inc, lastUpdated: new Date().toISOString() },
            { merge: true }
          )
      );
    }

  } catch (error) {
    console.error('Quick planner error:', error);
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(_ok(FALLBACK.en)));
  }
}
