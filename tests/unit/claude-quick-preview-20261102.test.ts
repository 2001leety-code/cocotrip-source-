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
