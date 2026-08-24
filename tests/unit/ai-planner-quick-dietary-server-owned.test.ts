/* eslint-disable @typescript-eslint/no-explicit-any -- handler mocking scaffolding, matches sibling ai-planner-quick-*.test.ts pattern. */
/**
 * ai-planner-quick dietary server-owned prose (2026-08-24, planner-trust-course A)
 * — the prior six-fix pass validated the model's dietary wording against a
 * keyword denylist (DIETARY_CLAIM_RE), which the pass's own report admitted
 * cannot enumerate every paraphrase of a false dietary-safety claim. These
 * tests lock the structural replacement: in dietary mode, marketingNarrative,
 * themes, and EVERY table tip are unconditionally rebuilt from deterministic
 * localized server-owned text after validation — never the model's own
 * wording, regardless of whether the denylist caught anything.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { describeDietaryEvidence } from '../../api/_shared/dietary-trust.js';

const checkIpRateLimitMock = vi.fn(async () => ({ ok: true }));
vi.mock('../../api/_shared/ip-rate-limit.js', () => ({
  checkIpRateLimit: (...a: any[]) => checkIpRateLimitMock(...a),
  getClientIp: () => '1.2.3.4',
}));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => ({}) }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { increment: () => 'INC' } }));
vi.mock('../../api/_shared/apiUsageRecorder.js', () => ({ recordUsageFromResponse: () => {} }));

const generateContentMock = vi.fn();
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() { return { generateContent: (...a: any[]) => generateContentMock(...a) }; }
  },
}));

function makeRes(): any {
  const res: any = {
    statusCode: undefined, headers: {}, body: '',
    writeHead(s: number, h?: any) { res.statusCode = s; if (h) Object.assign(res.headers, h); return res; },
    end(s?: string) { if (s != null) res.body = s; return res; },
  };
  return res;
}
function geminiJsonResult(obj: Record<string, unknown>) {
  return { response: { text: () => JSON.stringify(obj), usageMetadata: undefined } };
}
async function postJson(body: unknown) {
  const handler = (await import('../../api/ai-planner-quick.js')).default;
  const res = makeRes();
  await handler({ method: 'POST', headers: { host: 'unit.test', 'content-type': 'application/json' }, body } as any, res);
  return res;
}

// Real exact-city Seoul candidates (api/_food_index.json / attractions index) —
// same "Cherry Garden Restaurant (Halal)" trusted row used by the sibling
// hardening test files. Two real attraction candidates fill the other two
// (non-food) stops so the whole table resolves against real identities.
const SEOUL_HALAL_TABLE_EN =
  '| Time | Spot | Transit | Insider Tip |\n|---|---|---|---|\n' +
  '| 10:00 | National Museum of Korea | Start point | interesting exhibit |\n' +
  '| 12:00 | National Folk Museum | Walk 5 min | family friendly stop |\n' +
  '| 14:00 | Cherry Garden Restaurant (Halal) | Subway 10 min | model tip that should never survive |';
const SEOUL_HALAL_TABLE_KO =
  '| 시간 | 명소 | 교통 | 팁 |\n|---|---|---|---|\n' +
  '| 10:00 | 국립중앙박물관 | 출발지 | 흥미로운 전시입니다 |\n' +
  '| 12:00 | 국립민속박물관 | 도보 5분 | 가족 여행에 좋습니다 |\n' +
  '| 14:00 | Cherry Garden Restaurant (Halal) | 지하철 10분 | 절대 남으면 안 되는 모델 문구 |';

beforeEach(() => {
  generateContentMock.mockReset();
  checkIpRateLimitMock.mockReset();
  checkIpRateLimitMock.mockResolvedValue({ ok: true });
  process.env.GEMINI_API_KEY = 'test-key';
  delete process.env.VERCEL_ENV;
  delete process.env.NODE_ENV;
});

describe('ai-planner-quick — dietary mode server-owned prose replaces arbitrary model wording (planner-trust-course A)', () => {
  it('an English paraphrase with NO denylisted certification word never reaches the 200 response', async () => {
    const modelNarrative = 'This spot respects every dietary boundary you shared and welcomes you with total confidence.';
    const modelTheme = 'Worry-Free Dining Day';
    generateContentMock.mockResolvedValueOnce(geminiJsonResult({
      themes: [modelTheme],
      marketingNarrative: modelNarrative,
      day1MarkdownTable: SEOUL_HALAL_TABLE_EN,
    }));
    const res = await postJson({
      regions: ['Seoul'], durationDays: 3, pax: 2, reservation_status: 'nothing', language: 'en',
      dietaryRestrictions: ['Halal'],
    });
    expect(res.statusCode).toBe(200);
    // The arbitrary model wording must not survive into the response at all.
    expect(res.body).not.toContain(modelNarrative);
    expect(res.body).not.toContain(modelTheme);
    expect(res.body).not.toContain('model tip that should never survive');

    const body = JSON.parse(res.body);
    expect(body.data.marketingNarrative).toContain('Halal');
    expect(Array.isArray(body.data.themes)).toBe(true);
    expect(body.data.themes.join(' ')).toContain('Halal');

    const rows = body.data.day1MarkdownTable.split('\n').slice(2);
    const tipOf = (spotSubstr: string) => rows.find((l: string) => l.includes(spotSubstr))?.split('|')[4]?.trim();
    expect(tipOf('Cherry Garden')).toBe(describeDietaryEvidence('muslim_friendly', 'en'));
    const museumTip = tipOf('National Museum of Korea');
    const folkTip = tipOf('National Folk Museum');
    expect(museumTip).not.toBe('interesting exhibit');
    expect(folkTip).not.toBe('family friendly stop');
    expect(museumTip).toBe(folkTip); // both non-food stops get the same deterministic neutral note
  });

  it('a Korean paraphrase with no denylisted word never reaches the 200 response, and the override is itself Korean', async () => {
    const modelNarrative = '이곳은 여러분이 공유한 모든 조건을 존중하며 자신 있게 맞이합니다 즐거운 여행 되세요.';
    const modelTheme = '걱정없는 식사 여행';
    generateContentMock.mockResolvedValueOnce(geminiJsonResult({
      themes: [modelTheme],
      marketingNarrative: modelNarrative,
      day1MarkdownTable: SEOUL_HALAL_TABLE_KO,
    }));
    const res = await postJson({
      regions: ['Seoul'], durationDays: 3, pax: 2, reservation_status: 'nothing', language: 'ko',
      dietaryRestrictions: ['Halal'],
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(modelNarrative);
    expect(res.body).not.toContain(modelTheme);

    const body = JSON.parse(res.body);
    expect(body.data.marketingNarrative).toContain('할랄');
    // Exact language expectation: no Latin letters, no Han, all script Hangul.
    expect(/[A-Za-z]/.test(body.data.marketingNarrative)).toBe(false);
    expect(/[一-鿿]/.test(body.data.marketingNarrative)).toBe(false);
    expect(/[가-힣]/.test(body.data.marketingNarrative)).toBe(true);

    const rows = body.data.day1MarkdownTable.split('\n').slice(2);
    const tipOf = (spotSubstr: string) => rows.find((l: string) => l.includes(spotSubstr))?.split('|')[4]?.trim();
    expect(tipOf('Cherry Garden')).toBe(describeDietaryEvidence('muslim_friendly', 'ko'));
  });

  // Regression coverage for the four language variants the prior denylist
  // pass already caught (a bypass here would mean the structural fix
  // regressed the existing keyword defense-in-depth, not just the new gap).
  const KNOWN_PHRASES: Array<{ lang: string; phrase: string; table: string }> = [
    {
      lang: 'en',
      phrase: 'Every meal is pork-free and suitable for Muslim travelers on this first day.',
      table: SEOUL_HALAL_TABLE_EN,
    },
    {
      lang: 'ko',
      phrase: '모든 음식에 돼지고기가 없습니다 첫날 서울을 즐겨보세요 즐거운 여행 되세요.',
      table: SEOUL_HALAL_TABLE_KO,
    },
  ];
  for (const { lang, phrase, table } of KNOWN_PHRASES) {
    it(`the known ${lang} "no denylisted token but still a false claim" phrase never appears in the response body`, async () => {
      generateContentMock.mockResolvedValue(geminiJsonResult({
        themes: [lang === 'ko' ? '할랄 서울' : 'Halal Seoul'],
        marketingNarrative: phrase,
        day1MarkdownTable: table,
      }));
      const res = await postJson({
        regions: ['Seoul'], durationDays: 3, pax: 2, reservation_status: 'nothing', language: lang,
        dietaryRestrictions: ['Halal'],
      });
      expect(res.body).not.toContain(phrase);
    });
  }
});

describe('ai-planner-quick — non-dietary mode preserves valid localized model prose', () => {
  it('an ordinary (no dietaryRestrictions) request keeps the model-authored narrative/themes unchanged', async () => {
    const modelNarrative = 'Explore Seoul\'s palaces and markets on your first day in this historic city.';
    const modelTheme = 'Historic Seoul';
    generateContentMock.mockResolvedValueOnce(geminiJsonResult({
      themes: [modelTheme],
      marketingNarrative: modelNarrative,
      day1MarkdownTable:
        '| Time | Spot | Transit | Insider Tip |\n|---|---|---|---|\n' +
        '| 10:00 | National Museum of Korea | Start point | interesting exhibit |\n' +
        '| 12:00 | National Folk Museum | Walk 5 min | family friendly stop |\n' +
        '| 14:00 | War Memorial of Korea | Subway 10 min | moving history |',
    }));
    const res = await postJson({ regions: ['Seoul'], durationDays: 3, pax: 2, reservation_status: 'nothing', language: 'en' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.marketingNarrative).toBe(modelNarrative);
    expect(body.data.themes).toEqual([modelTheme]);
  });
});
