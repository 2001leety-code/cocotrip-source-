/* eslint-disable @typescript-eslint/no-explicit-any -- handler mocking scaffolding, matches sibling ai-planner-quick-*.test.ts pattern. */
/**
 * 2026-11-02 — Claude 엔진(llm_use_claude ON)에서 1일차 무료 미리보기(/api/ai-planner-quick, role quick → claude-haiku-5-5)가
 *   운영에서 502 GEMINI_ERROR 로 실패한 두 원인 재현·고정(실호출 0):
 *   1) 출력 한도: 호출부 maxOutputTokens 2000(Gemini thinkingBudget 0 전제)이 Claude max_tokens 로 그대로 → out=2000 에서 JSON 잘림
 *      → 어댑터가 JSON 응답에만 여유(CLAUDE_JSON_OUTPUT_HEADROOM)를 더하고, 스키마 없는 JSON 요청에도 "JSON 하나만" 지시.
 *   2) 이름 매칭: 인덱스 이름 "Adm’s Mandi"(U+2019 굽은 아포스트로피) ≠ 모델의 "Adm's Mandi" → exact 후보 0 → 검증 실패
 *      → normalizeName 이 굽은 아포스트로피·따옴표도 ASCII 처럼 지운다(정확 일치·모호성 거절은 그대로).
 *   Gemini 경로(요청·응답 모양)는 바뀌지 않는다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildClaudeRequest, CLAUDE_JSON_OUTPUT_HEADROOM } from '../../api/_shared/llm/claude.js';
import { describeDietaryEvidence, TRUSTED_DIETARY_STATUS } from '../../api/_shared/dietary-trust.js';

const checkIpRateLimitMock = vi.fn(async () => ({ ok: true }));
vi.mock('../../api/_shared/ip-rate-limit.js', () => ({ checkIpRateLimit: (...a: any[]) => checkIpRateLimitMock(...a), getClientIp: () => '1.2.3.4' }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => ({}) }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { increment: () => 'INC' } }));
vi.mock('../../api/_shared/apiUsageRecorder.js', () => ({ recordUsageFromResponse: () => {} }));
const generateContentMock = vi.fn();
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class { getGenerativeModel() { return { generateContent: (...a: any[]) => generateContentMock(...a) }; } },
}));

function makeRes(): any {
  const res: any = { statusCode: undefined, headers: {}, body: '', writeHead(s: number, h?: any) { res.statusCode = s; if (h) Object.assign(res.headers, h); return res; }, end(s?: string) { if (s != null) res.body = s; return res; } };
  return res;
}
const json = (obj: Record<string, unknown>) => ({ response: { text: () => JSON.stringify(obj), usageMetadata: undefined } });
async function postJson(body: unknown) {
  const handler = (await import('../../api/ai-planner-quick.js')).default;
  const res = makeRes();
  await handler({ method: 'POST', headers: { host: 'unit.test', 'content-type': 'application/json' }, body } as any, res);
  return res;
}
const table = (food: string) => '| Time | Spot | Transit | Insider Tip |\n|---|---|---|---|\n'
  + '| 10:00 | National Museum of Korea | Start point | interesting exhibit |\n'
  + '| 12:00 | National Folk Museum | Walk 5 min | family friendly stop |\n'
  + `| 14:00 | ${food} | Subway 10 min | relaxed lunch near the station exit |`;
const MODEL = { themes: ['Worry-Free Dining Day'], marketingNarrative: 'This spot respects every dietary boundary you shared and welcomes you with total confidence.' };
const QUICK_GEN = { temperature: 0.7, maxOutputTokens: 2000, thinkingConfig: { thinkingBudget: 0 }, responseMimeType: 'application/json' };

beforeEach(() => {
  generateContentMock.mockReset();
  checkIpRateLimitMock.mockReset();
  checkIpRateLimitMock.mockResolvedValue({ ok: true });
  process.env.GEMINI_API_KEY = 'test-key';
  delete process.env.VERCEL_ENV;
  delete process.env.NODE_ENV;
});

describe('1 — Claude adapter: JSON output headroom + JSON-only instruction (prod: out=2000 → Unterminated string)', () => {
  const req = (generationConfig: Record<string, unknown>, extra: Record<string, unknown> = {}) => buildClaudeRequest({
    modelId: 'claude-haiku-5-5', role: 'quick', config: {}, maxTokensCap: 32000,
    request: { contents: [{ role: 'user', parts: [{ text: 'u' }] }], systemInstruction: { role: 'system', parts: [{ text: 'SYS' }] }, generationConfig }, ...extra,
  });
  it('quick (responseMimeType json, no schema, 2000) → max_tokens 2000 + headroom, and the system says "exactly one JSON object"', () => {
    const out = req(QUICK_GEN);
    expect(out.max_tokens).toBe(2000 + CLAUDE_JSON_OUTPUT_HEADROOM);
    expect(out.max_tokens).toBeGreaterThanOrEqual(6000);
    expect(out.system).toBe('SYS\n\nReturn exactly one JSON object and nothing else (no markdown fences, no commentary).');
    expect(out).not.toHaveProperty('temperature');
  });
  it('free text (chat 350, no JSON) is unchanged — no headroom, no JSON instruction', () => {
    const out = req({ maxOutputTokens: 350 });
    expect(out.max_tokens).toBe(350);
    expect(out.system).toBe('SYS');
  });
  it('the cap still wins (planner main 65535 → 32000) and a schema request also gets the headroom', () => {
    expect(req({ maxOutputTokens: 65535, responseMimeType: 'application/json' }).max_tokens).toBe(32000);
    const schema = req({ maxOutputTokens: 4000, responseMimeType: 'application/json', responseSchema: { type: 'OBJECT', properties: { a: { type: 'STRING' } }, required: ['a'] } });
    expect(schema.max_tokens).toBe(4000 + CLAUDE_JSON_OUTPUT_HEADROOM);
    expect(schema.output_config.format.type).toBe('json_schema');
    expect(schema.system).toBe('SYS'); // structured output — no extra instruction
  });
});

// 3 — 전체 일정(main/block, claude-sonnet-5-5)도 같은 류의 위험: food-name-match(검증기·재방문 정책의 식당 행 식별)는
//   trim+소문자만 했고, 목록 "• Adm’s Mandi (Adm’s Mandi)"(이름 = nameEn)의 통째 복사를 별칭에서 뺐다.
describe('3 — full planner food-row identity (food-name-match): same fixes, still exact + unique', () => {
  const ROW = { name: 'Adm’s Mandi', nameEn: 'Adm’s Mandi', city: 'seoul', tag: 'halal', address: '서울 용산구 이태원동' };
  const OTHER = { name: '해포', nameEn: 'Haepo', city: 'seoul', address: '서울 종로구' };
  it.each([["Adm's Mandi"], ["Adm's Mandi (Adm's Mandi)"], ['Adm’s Mandi (Adm’s Mandi)'], ['ADM’S MANDI']])('"%s" → the Adm’s Mandi row', async (name) => {
    const { findSelectedFoodRow } = await import('../../api/_shared/food-name-match.js');
    expect(findSelectedFoodRow({ name, city: 'seoul' }, [ROW, OTHER], { dayCity: 'seoul' })).toBe(ROW);
  });
  it('no fuzzy or cross-row match: a different name, or one row\'s name with another row\'s English name, finds nothing', async () => {
    const { findSelectedFoodRow } = await import('../../api/_shared/food-name-match.js');
    expect(findSelectedFoodRow({ name: "Adm's Mandi Grill", city: 'seoul' }, [ROW, OTHER], { dayCity: 'seoul' })).toBeNull();
    expect(findSelectedFoodRow({ name: "Adm's Mandi (Haepo)", city: 'seoul' }, [ROW, OTHER], { dayCity: 'seoul' })).toBeNull();
    expect(findSelectedFoodRow({ name: '해포 (Haepo)', city: 'seoul' }, [ROW, OTHER], { dayCity: 'seoul' })).toBe(OTHER); // existing rule kept
  });
});

// 4 — r2: 시험 주소 실측(서울·할랄·3일, claude-haiku-5-5) 1차 시도 = "Model authored a dietary/certification/safety claim".
//   두 번째 시도는 첫 시도와 같은 프롬프트였다 → 실패 사유별 고정 교정 한 줄을 user 메시지 끝에 붙인다(검증 기준 그대로, 첫 시도 불변).
describe('4 — retry tells the model why attempt 1 was rejected (fixed line, no echo, first prompt unchanged)', () => {
  const body = { regions: ['Seoul'], durationDays: 3, pax: 2, reservation_status: 'nothing', language: 'en', dietaryRestrictions: ['Halal'] };
  const userText = (call: number) => generateContentMock.mock.calls[call][0].contents[0].parts[0].text as string;
  const ok = () => json({ ...MODEL, day1MarkdownTable: table('Adm’s Mandi') });

  it('dietary claim → attempt 2 = attempt 1 prompt + the dietary correction → 200 (claim check unchanged)', async () => {
    generateContentMock.mockResolvedValueOnce(json({ ...MODEL, day1MarkdownTable: table('Adm’s Mandi').replace('relaxed lunch near the station exit', 'certified halal kitchen') }));
    generateContentMock.mockResolvedValueOnce(ok());
    const res = await postJson(body);
    expect(res.statusCode, res.body).toBe(200);
    expect(generateContentMock).toHaveBeenCalledTimes(2);
    const extra = userText(1).slice(userText(0).length);
    expect(userText(1).startsWith(userText(0))).toBe(true);
    expect(extra).toMatch(/^\n\nYour previous answer was rejected: it contained dietary\/certification\/safety wording/);
    expect(extra).toContain('CERTIFIED/FRIENDLY');
    expect(extra).not.toContain('certified halal kitchen'); // model text never echoed
  });
  it('ops log: a rejected claim logs one [QUICK_CLAIM] line (field, index, fixed denylist word only); a clean answer logs none', async () => {
    const warn = vi.spyOn(console, 'warn');
    try {
      generateContentMock.mockResolvedValueOnce(json({ ...MODEL, day1MarkdownTable: table('Adm’s Mandi').replace('relaxed lunch near the station exit', 'Certified Halal kitchen by Mr Kim') }));
      generateContentMock.mockResolvedValueOnce(ok());
      expect((await postJson(body)).statusCode).toBe(200);
      const lines = warn.mock.calls.map((c) => String(c[0])).filter((s) => s.startsWith('[QUICK_CLAIM]'));
      expect(lines).toEqual(['[QUICK_CLAIM] field=tip idx=2 token=certified']); // 첫 일치 낱말(소문자)
      expect(lines.join('')).not.toContain('Kim');
      warn.mockClear();
      generateContentMock.mockReset();
      generateContentMock.mockResolvedValueOnce(ok());
      expect((await postJson(body)).statusCode).toBe(200);
      expect(warn.mock.calls.filter((c) => String(c[0]).startsWith('[QUICK_CLAIM]'))).toHaveLength(0);
    } finally { warn.mockRestore(); }
  });
  it('the same claim on both attempts is still rejected → 502 (no loosening)', async () => {
    generateContentMock.mockResolvedValue(json({ ...MODEL, day1MarkdownTable: table('Adm’s Mandi').replace('relaxed lunch near the station exit', 'Muslim friendly spot') }));
    const res = await postJson(body);
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).code).toBe('GEMINI_ERROR');
  });
  // Astra P2: the table-error reason always says "no Start-point token in Spot" — a table error must get the table/JSON line, not the name line.
  const TABLE_LINE = /the JSON fields or the table format were wrong/;
  it.each([
    ['wrong header', (t: string) => t.replace('| Time | Spot | Transit | Insider Tip |', '| Hour | Place | Transit | Tip |')],
    ['empty cell', (t: string) => t.replace('interesting exhibit', ' ')],
    ['two rows', (t: string) => t.split('\n').slice(0, 4).join('\n')],
    ['Start point in the Spot column', (t: string) => t.replace('National Folk Museum', 'Start point')],
  ])('table error (%s) → table/JSON correction, not the name correction → 200', async (_label, mutate) => {
    generateContentMock.mockResolvedValueOnce(json({ ...MODEL, day1MarkdownTable: mutate(table('Adm’s Mandi')) }));
    generateContentMock.mockResolvedValueOnce(ok());
    const res = await postJson(body);
    expect(res.statusCode, res.body).toBe(200);
    const extra = userText(1).slice(userText(0).length);
    expect(extra).toMatch(TABLE_LINE);
    expect(extra).not.toMatch(/Spot name did not match/);
  });
  it('reason → line (direct): a real Start-point Spot reason gets the name line; the table reason gets the table line', async () => {
    const { retryCorrectionFor } = await import('../../api/ai-planner-quick.js');
    expect(retryCorrectionFor(new Error('"Start point" is a Start-point token, not a valid Spot'))).toMatch(/Spot name did not match/);
    expect(retryCorrectionFor(new Error('Day 1 table missing or malformed for "en" (need the exact 4-cell en header in order, valid times, non-empty cells, exactly 3 Spot rows, no Start-point token in Spot)'))).toMatch(TABLE_LINE);
    expect(retryCorrectionFor(Object.assign(new Error('GEMINI_TIMEOUT'), { isTimeout: true }))).toBe('');
  });
  it('unknown Spot name → name correction, without the model\'s name → 200', async () => {
    generateContentMock.mockResolvedValueOnce(json({ ...MODEL, day1MarkdownTable: table('Adm’s Mandi (Itaewon Branch Zzz)') }));
    generateContentMock.mockResolvedValueOnce(ok());
    const res = await postJson(body);
    expect(res.statusCode, res.body).toBe(200);
    const extra = userText(1).slice(userText(0).length);
    expect(extra).toMatch(/a Spot name did not match the candidate lists/);
    expect(extra).toContain('do not add parentheses');
    expect(extra).not.toContain('Zzz');
  });
  it('cut-off JSON → JSON-only correction', async () => {
    generateContentMock.mockResolvedValueOnce({ response: { text: () => '{"themes": ["A"], "marketingNarrative": "unterminated', usageMetadata: undefined } });
    generateContentMock.mockResolvedValueOnce(ok());
    const res = await postJson(body);
    expect(res.statusCode, res.body).toBe(200);
    expect(userText(1).slice(userText(0).length)).toBe('\n\nYour previous answer was rejected: it was not one complete JSON object. Return exactly one JSON object and nothing else.');
  });
  it('timeout or a transport error → attempt 2 prompt is byte-identical to attempt 1 (no correction)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      generateContentMock.mockImplementationOnce((_r: any, opts: any) => new Promise((_, rej) => opts.signal.addEventListener('abort', () => rej(new Error('aborted')))));
      generateContentMock.mockResolvedValueOnce(ok());
      const p = postJson(body);
      await vi.advanceTimersByTimeAsync(31000);
      expect((await p).statusCode).toBe(200);
      expect(userText(1)).toBe(userText(0));
    } finally { vi.useRealTimers(); }
    generateContentMock.mockReset();
    generateContentMock.mockRejectedValueOnce(new Error('503 Service Unavailable'));
    generateContentMock.mockResolvedValueOnce(ok());
    expect((await postJson(body)).statusCode).toBe(200);
    expect(userText(1)).toBe(userText(0));
  });
  it('first attempt prompt (Gemini default path) is the same with or without a later retry', async () => {
    generateContentMock.mockResolvedValueOnce(ok());
    expect((await postJson(body)).statusCode).toBe(200);
    const single = generateContentMock.mock.calls[0][0];
    generateContentMock.mockReset();
    generateContentMock.mockResolvedValueOnce(json({ ...MODEL, day1MarkdownTable: table('Nowhere Diner') }));
    generateContentMock.mockResolvedValueOnce(ok());
    expect((await postJson(body)).statusCode).toBe(200);
    expect(generateContentMock.mock.calls[0][0]).toEqual(single); // contents + systemInstruction + generationConfig
    expect(single.contents[0].parts[0].text).not.toContain('Your previous answer was rejected');
  });
});

// 5 — r3: 운영 실측(#1481 뒤) 식이 손님만 계속 실패 — 프롬프트가 "등급(CERTIFIED/FRIENDLY)을 그대로 전달" + "인증 주장 금지"를 함께 줘
//   Claude 가 이름·팁에 "(FRIENDLY, 비인증)"·certified 를 붙였다. 식이 손님 = "등급 쓰지 말 것", 식이 없는 손님 = 종전 문장 그대로.
describe('5 — diet guests are told not to write the tier; everyone else keeps the old sentence', () => {
  const OLD = {
    ko: '목록에 적힌 등급(CERTIFIED/FRIENDLY)을 그대로 전달하세요.',
    ja: 'リストの等級（CERTIFIED/FRIENDLY）をそのまま伝えてください。',
    zh: '如实转达列表中标注的等级（CERTIFIED/FRIENDLY）。',
    en: 'pass along the tier written there (CERTIFIED vs. FRIENDLY) exactly as given.',
  };
  const NEW = {
    ko: '등급(CERTIFIED/FRIENDLY)·인증 여부는 쓰지 마세요',
    ja: '等級（CERTIFIED/FRIENDLY）や認証の有無は書かないでください',
    zh: '不要写出等级（CERTIFIED/FRIENDLY）或认证情况',
    en: 'Never write the tier (CERTIFIED/FRIENDLY) or any certification status yourself',
  };
  const TIP_GUIDE = { // r3b: 금지만이 아니라 대신 쓸 것
    ko: '팁 칸에는 그 장소 자체(볼거리·분위기·추천 시간대·동선)만 짧게 쓰세요',
    ja: 'ヒント欄にはその場所自体（見どころ・雰囲気・おすすめの時間帯・動線）だけを短く書いてください',
    zh: '贴士栏只简短写该地点本身（看点、氛围、推荐时段、动线）',
    en: 'Keep each tip short and about the place itself',
  };
  // 운영 실측: 서울 채식 ko 1차 "No stop names a restaurant from the trusted dietary-safe list" — 검증은 요구하는데 첫 프롬프트엔 없었다.
  const ONE_TRUSTED_MEAL = {
    ko: '"VERIFIED ... DIETARY-SAFE RESTAURANTS" 목록의 식당을 점심 또는 저녁 식사 장소로 최소 1곳 넣으세요',
    ja: '「VERIFIED ... DIETARY-SAFE RESTAURANTS」リストの店を、昼食または夕食の場所として最低1か所入れてください',
    zh: '请至少安排1家"VERIFIED ... DIETARY-SAFE RESTAURANTS"列表中的餐厅作为午餐或晚餐地点',
    en: 'Include at least one restaurant from the "VERIFIED ... DIETARY-SAFE RESTAURANTS" list as the lunch or dinner stop',
  };
  // 운영 실측(#1482 뒤): 영어 손님 팁의 한글 1자 = 언어 검사 거절 → 이름은 Spot 칸에만, 팁은 손님 언어로만.
  const NAMES_IN_SPOT_ONLY = {
    ko: ['팁·서사·테마는 한국어로만 쓰고, 식당·장소 이름은 명소 칸에만 쓰세요', '명소 칸의 식당 이름은 목록에 적힌 이름 그대로'],
    ja: ['ヒント・紹介文・テーマは日本語だけで書き、店名・スポット名はスポット欄だけに書いてください', 'スポット欄の店名はリストに書かれた名前のまま'],
    zh: ['贴士、介绍和主题只用中文书写，餐厅和地点名称只写在地点栏', '地点栏的餐厅名称请严格按列表中的名称书写'],
    en: ['put restaurant and place names only in the Spot column (no Korean or other non-English letters in any tip)', 'In the Spot column, write each restaurant name exactly as it appears in the list'],
  };
  const firstCall = async (body: Record<string, unknown>) => {
    generateContentMock.mockResolvedValue(json({ themes: [], marketingNarrative: '' }));
    await postJson(body);
    const req = generateContentMock.mock.calls[0][0];
    return { system: req.systemInstruction.parts[0].text as string, user: req.contents[0].parts[0].text as string };
  };
  it.each(['ko', 'ja', 'zh', 'en'] as const)('%s Halal guest: no "pass the tier along" sentence, the "do not write it" sentence instead, and the list header no longer says "say so"', async (lang) => {
    const { system, user } = await firstCall({ regions: ['Seoul'], durationDays: 3, pax: 2, reservation_status: 'nothing', language: lang, dietaryRestrictions: ['Halal'] });
    expect(system).not.toContain(OLD[lang]);
    expect(system).toContain(NEW[lang]);
    expect(system).toContain('VERIFIED ... DIETARY-SAFE RESTAURANTS'); // 목록 밖 식당 금지 문장은 그대로
    expect(user).toContain('DIETARY-SAFE RESTAURANTS');
    expect(user).not.toContain('say so');
    expect(user).toContain('Never write the tier or any certification status yourself');
  });
  it.each(['ko', 'ja', 'zh', 'en'] as const)('%s guest with food styles but no safety diet: the old sentence is still there, the new one is not', async (lang) => {
    const { system, user } = await firstCall({ regions: ['Seoul'], durationDays: 3, pax: 2, reservation_status: 'nothing', language: lang, dietPrefs: ['Seafood'] });
    expect(system).toContain(OLD[lang]);
    expect(system).not.toContain(NEW[lang]);
    expect(system).not.toContain(TIP_GUIDE[lang]);
    for (const s of NAMES_IN_SPOT_ONLY[lang]) expect(system).not.toContain(s);
    expect(system).not.toContain(ONE_TRUSTED_MEAL[lang]);
    expect(user).not.toContain('DIETARY-SAFE RESTAURANTS');
  });

  // r3b: 목록 줄의 ⚠️ 근거 문장·"(not certified)" 는 모델이 팁에 옮겨 거절되던 원천 — 모델용 목록에서 뺐다(서버가 같은 문장을 붙인다).
  it.each(['ko', 'ja', 'zh', 'en'] as const)('%s Halal/Vegan guest: the model-facing list carries no evidence sentence and no "(not certified)"; the tip guide is in the prompt', async (lang) => {
    for (const diet of ['Halal', 'Vegan']) {
      generateContentMock.mockReset();
      const { system, user } = await firstCall({ regions: ['Seoul'], durationDays: 3, pax: 2, reservation_status: 'nothing', language: lang, dietaryRestrictions: [diet] });
      expect(user).toContain('DIETARY-SAFE RESTAURANTS');
      for (const status of TRUSTED_DIETARY_STATUS) {
        for (const l of ['ko', 'ja', 'zh', 'en']) expect(user, `${status}/${l}`).not.toContain(describeDietaryEvidence(status, l));
      }
      expect(user).not.toContain('(not certified)');
      expect(user).not.toContain('⚠️');
      expect(user).toMatch(/\[(HALAL|VEGAN) — (CERTIFIED|FRIENDLY)\]/); // 이름·주소·등급 태그는 유지
      expect(system).toContain(TIP_GUIDE[lang]);
      for (const s of NAMES_IN_SPOT_ONLY[lang]) expect(system).toContain(s);
      expect(system).toContain(ONE_TRUSTED_MEAL[lang]);
    }
  });
  it('guest-facing tip is unchanged: the server still attaches the evidence sentence to the matched restaurant row', async () => {
    generateContentMock.mockResolvedValueOnce(json({ ...MODEL, day1MarkdownTable: table('Adm’s Mandi') }));
    const res = await postJson({ regions: ['Seoul'], durationDays: 3, pax: 2, reservation_status: 'nothing', language: 'en', dietaryRestrictions: ['Halal'] });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.body as string;
    expect(TRUSTED_DIETARY_STATUS.filter((s: string) => s === 'halal_certified' || s === 'muslim_friendly').some((s: string) => body.includes(JSON.stringify(describeDietaryEvidence(s, 'en')).slice(1, -1)))).toBe(true);
    expect(body).not.toContain('relaxed lunch near the station exit'); // 모델 팁은 그대로 버려진다
  });
});

describe('2 — quick exact-candidate matching: typographic apostrophe (prod: "Adm\'s Mandi (Adm\'s Mandi)")', () => {
  const body = { regions: ['Seoul'], durationDays: 3, pax: 2, reservation_status: 'nothing', language: 'en', dietaryRestrictions: ['Halal'] };
  it.each([
    ["Adm's Mandi (Adm's Mandi)"], // Claude prod spelling — straight apostrophe, same name repeated in parentheses
    ["Adm's Mandi"],
    ['Adm’s Mandi'], // index spelling (U+2019)
  ])('"%s" resolves to the supplied candidate "Adm’s Mandi" → 200', async (food) => {
    generateContentMock.mockResolvedValueOnce(json({ ...MODEL, day1MarkdownTable: table(food) }));
    const res = await postJson(body);
    expect(res.statusCode, res.body).toBe(200);
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['Adms Mandi Grill'], // a different name — still no fuzzy match
    ["Adm's Mandi (Cherry Garden Restaurant)"], // base and parenthetical are two DIFFERENT candidates — never merged
  ])('"%s" is still rejected (exact identity only) → no 200', async (food) => {
    generateContentMock.mockResolvedValue(json({ ...MODEL, day1MarkdownTable: table(food) }));
    const res = await postJson(body);
    expect(res.statusCode).not.toBe(200);
  });
});
