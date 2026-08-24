/* eslint-disable @typescript-eslint/no-explicit-any -- 핸들러 모킹 스캐폴딩 (quick-planner-rate-limit.test.ts 패턴 재사용). */
/**
 * ai-planner-quick honesty rewrite (2026-08-24, planner-trust-course).
 *
 * Locks: special_request is read and reaches the prompt; a non-Seoul
 * destination never gets the old fixed-Seoul-sample fallback; ja/zh get
 * their own native-language prompt and a mismatched-language response is
 * rejected; multi-city order is resolved from the first requested city, not
 * a seoul-priority keyword chain; a response that never validates returns an
 * explicit error (never HTTP 200 fallback content); a valid response carries
 * inputCoverage.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../api/_shared/ip-rate-limit.js', () => ({
  checkIpRateLimit: async () => ({ ok: true }),
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

// 2026-08-24 (strict per-stop validation): every named stop must match an
// exact-city verified candidate — "Haeundae Beach"/"Jagalchi Market" aren't
// in the attractions index (only museum/temple/night_spot categories exist),
// so use real candidate names from api/_attractions_index.json's busan rows.
const BUSAN_TABLE_EN = '| Time | Spot | Transit | Insider Tip |\n|---|---|---|---|\n| 10:00 | Haeundae Night | Start point | Arrive early |\n| 12:00 | Busan Museum | Bus 15 min | Check the special exhibits |\n| 14:00 | Beomeosa | Walk 10 min | Visit during quiet hours |';
const BUSAN_NARRATIVE_EN = 'Explore Busan\'s beaches and markets on your first day in this coastal city.';

beforeEach(() => {
  generateContentMock.mockReset();
  process.env.GEMINI_API_KEY = 'test-key';
});

describe('ai-planner-quick — special_request reaches the prompt', () => {
  it('forwards special_request into the Gemini user prompt', async () => {
    generateContentMock.mockResolvedValueOnce(geminiJsonResult({
      themes: ['Coastal'], marketingNarrative: BUSAN_NARRATIVE_EN, day1MarkdownTable: BUSAN_TABLE_EN,
    }));
    const handler = (await import('../../api/ai-planner-quick.js')).default;
    const res = makeRes();
    await handler({
      method: 'POST', headers: { host: 'unit.test', 'content-type': 'application/json' },
      body: { regions: ['Busan'], durationDays: 3, pax: 2, reservation_status: 'nothing', language: 'en', special_request: 'I want to see a sunrise on day one' },
    } as any, res);

    expect(res.statusCode).toBe(200);
    const call = generateContentMock.mock.calls[0][0];
    const userText = call.contents[0].parts[0].text as string;
    expect(userText).toContain('I want to see a sunrise on day one');
  });
});

describe('ai-planner-quick — non-Seoul destination never gets the Seoul fallback', () => {
  it('a Busan request that never validates returns an explicit error, not a Seoul sample with HTTP 200', async () => {
    // Every attempt returns malformed JSON -> all 3 retries exhausted.
    generateContentMock.mockResolvedValue({ response: { text: () => 'not json at all', usageMetadata: undefined } });
    const handler = (await import('../../api/ai-planner-quick.js')).default;
    const res = makeRes();
    await handler({ method: 'POST', headers: { host: 'unit.test', 'content-type': 'application/json' }, body: { regions: ['Busan'], durationDays: 3, pax: 2, reservation_status: 'nothing', language: 'en' } } as any, res);

    expect(res.statusCode).not.toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('GEMINI_ERROR');
    // The old fallback always said "Seoul Highlights" / a Gyeongbokgung Day 1 — must not appear.
    expect(res.body).not.toMatch(/Seoul Highlights|Gyeongbokgung/i);
  });

  it('a Busan response that comes back as a Seoul itinerary is rejected (destination-consistency check)', async () => {
    generateContentMock.mockResolvedValue(geminiJsonResult({
      themes: ['Seoul Highlights'],
      marketingNarrative: 'Discover Seoul\'s palaces and markets on your first day.',
      day1MarkdownTable: '| Time | Spot | Transit | Tip |\n|---|---|---|---|\n| 10:00 | Gyeongbokgung Palace | Start point | Arrive early |\n| 12:00 | Gwangjang Market | Subway 8 min | Try street food |',
    }));
    const handler = (await import('../../api/ai-planner-quick.js')).default;
    const res = makeRes();
    await handler({ method: 'POST', headers: { host: 'unit.test', 'content-type': 'application/json' }, body: { regions: ['Busan'], durationDays: 3, pax: 2, reservation_status: 'nothing', language: 'en' } } as any, res);

    expect(res.statusCode).not.toBe(200);
    expect(JSON.parse(res.body).ok).toBe(false);
    // 2026-08-24 (D.2): server budget is 2 model attempts, not 3 — exhausted
    // both, each rejected for the same reason.
    expect(generateContentMock).toHaveBeenCalledTimes(2);
  });
});

describe('ai-planner-quick — multi-city order (no seoul-priority collapse)', () => {
  it('requesting ["Busan", "Seoul"] anchors day-1 local context on Busan, the first requested city (not Seoul)', async () => {
    generateContentMock.mockResolvedValueOnce(geminiJsonResult({
      themes: ['Coastal'], marketingNarrative: BUSAN_NARRATIVE_EN, day1MarkdownTable: BUSAN_TABLE_EN,
    }));
    const handler = (await import('../../api/ai-planner-quick.js')).default;
    const res = makeRes();
    await handler({ method: 'POST', headers: { host: 'unit.test', 'content-type': 'application/json' }, body: { regions: ['Busan', 'Seoul'], durationDays: 3, pax: 2, reservation_status: 'nothing', language: 'en' } } as any, res);

    expect(res.statusCode).toBe(200);
    // Grounded on Busan attractions, not Seoul — the prompt sent to Gemini
    // must carry the Busan-only verified attractions block.
    const call = generateContentMock.mock.calls[0][0];
    const userText = call.contents[0].parts[0].text as string;
    expect(userText).toContain('VERIFIED BUSAN ATTRACTIONS');
  });
});

describe('ai-planner-quick — ja/zh get native-language prompts, not reused English', () => {
  it('ja: a valid Japanese response is accepted', async () => {
    generateContentMock.mockResolvedValueOnce(geminiJsonResult({
      themes: ['海の街'],
      marketingNarrative: '釜山の美しいビーチと活気ある市場で1日目をお楽しみください。',
      day1MarkdownTable: '| 時間 | スポット | 交通 | ヒント |\n|---|---|---|---|\n| 10:00 | 海雲台夜 | 出発地 | 早めの到着がおすすめ |\n| 12:00 | 釜山博物館 | バス15分 | 特別展をチェック |\n| 14:00 | 梵魚寺 | 徒歩10分 | 静かな時間帯に訪問 |',
    }));
    const handler = (await import('../../api/ai-planner-quick.js')).default;
    const res = makeRes();
    await handler({ method: 'POST', headers: { host: 'unit.test', 'content-type': 'application/json' }, body: { regions: ['Busan'], durationDays: 3, pax: 2, reservation_status: 'nothing', language: 'ja' } } as any, res);

    expect(res.statusCode).toBe(200);
    const call = generateContentMock.mock.calls[0][0];
    expect(call.systemInstruction.parts[0].text).toContain('日本語');
  });

  it('ja: an English response for a ja request is rejected (language-mismatch check)', async () => {
    generateContentMock.mockResolvedValue(geminiJsonResult({
      themes: ['Coastal'], marketingNarrative: BUSAN_NARRATIVE_EN, day1MarkdownTable: BUSAN_TABLE_EN,
    }));
    const handler = (await import('../../api/ai-planner-quick.js')).default;
    const res = makeRes();
    await handler({ method: 'POST', headers: { host: 'unit.test', 'content-type': 'application/json' }, body: { regions: ['Busan'], durationDays: 3, pax: 2, reservation_status: 'nothing', language: 'ja' } } as any, res);

    expect(res.statusCode).not.toBe(200);
    expect(JSON.parse(res.body).ok).toBe(false);
  });

  it('zh: system prompt is distinct from the ja/en ones (not the reused English prompt)', async () => {
    generateContentMock.mockResolvedValueOnce(geminiJsonResult({
      themes: ['海滨城市'],
      marketingNarrative: '在釜山的第一天，探索美丽的海滩和热闹的市场。',
      day1MarkdownTable: '| 时间 | 地点 | 交通 | 贴士 |\n|---|---|---|---|\n| 10:00 | 海云台夜 | 出发地 | 建议早到 |\n| 12:00 | 釜山博物馆 | 公交15分钟 | 关注特别展览 |\n| 14:00 | 梵鱼寺 | 步行10分钟 | 建议安静时段前往 |',
    }));
    const handler = (await import('../../api/ai-planner-quick.js')).default;
    const res = makeRes();
    await handler({ method: 'POST', headers: { host: 'unit.test', 'content-type': 'application/json' }, body: { regions: ['Busan'], durationDays: 3, pax: 2, reservation_status: 'nothing', language: 'zh' } } as any, res);

    expect(res.statusCode).toBe(200);
    const call = generateContentMock.mock.calls[0][0];
    expect(call.systemInstruction.parts[0].text).toContain('中文');
  });
});

describe('ai-planner-quick — inputCoverage on a successful response', () => {
  it('reports which wizard fields the preview actually used', async () => {
    generateContentMock.mockResolvedValueOnce(geminiJsonResult({
      themes: ['Coastal'], marketingNarrative: BUSAN_NARRATIVE_EN, day1MarkdownTable: BUSAN_TABLE_EN,
    }));
    const handler = (await import('../../api/ai-planner-quick.js')).default;
    const res = makeRes();
    await handler({
      method: 'POST', headers: { host: 'unit.test', 'content-type': 'application/json' },
      body: {
        regions: ['Busan'], durationDays: 3, pax: 2, reservation_status: 'nothing', language: 'en', startDate: '2026-09-01', endDate: '2026-09-03',
        arrival_airport: 'PUS', tourPace: 'full', special_request: 'sunrise please',
      },
    } as any, res);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.inputCoverage).toMatchObject({
      destination: true, dates: true, airport: true, pace: true, specialRequest: true,
    });
    expect(Array.isArray(body.data.reflectedConditions)).toBe(true);
    expect(body.data.reflectedConditions.length).toBeGreaterThan(0);
  });
});

describe('ai-planner-quick — strict per-stop validation (planner-trust-course adversarial)', () => {
  it('adversarial: one real Busan candidate plus four invented/Seoul stops is rejected, not accepted for one match', async () => {
    generateContentMock.mockResolvedValue(geminiJsonResult({
      themes: ['Mixed'],
      marketingNarrative: 'A whirlwind first day mixing Busan and other spots.',
      day1MarkdownTable:
        '| Time | Spot | Transit | Insider Tip |\n|---|---|---|---|\n' +
        '| 09:00 | Haeundae Night | Start point | Real Busan candidate |\n' +
        '| 11:00 | Gyeongbokgung Palace | Subway 8 min | Seoul landmark, not Busan |\n' +
        '| 13:00 | Everland Fantasy Zone | Bus 20 min | Invented, not in any index |\n' +
        '| 15:00 | N Seoul Tower | Taxi 15 min | Seoul landmark, not Busan |\n' +
        '| 17:00 | Made Up Sky Deck | Walk 5 min | Fully invented |',
    }));
    const handler = (await import('../../api/ai-planner-quick.js')).default;
    const res = makeRes();
    await handler({ method: 'POST', headers: { host: 'unit.test', 'content-type': 'application/json' }, body: { regions: ['Busan'], durationDays: 3, pax: 2, reservation_status: 'nothing', language: 'en' } } as any, res);

    expect(res.statusCode).not.toBe(200);
    expect(JSON.parse(res.body).ok).toBe(false);
  });

  it('adversarial: one trusted dietary restaurant plus one invented restaurant is rejected', async () => {
    generateContentMock.mockResolvedValue(geminiJsonResult({
      themes: ['Halal Seoul'],
      marketingNarrative: 'A halal-friendly first day exploring Seoul.',
      day1MarkdownTable:
        '| Time | Spot | Transit | Insider Tip |\n|---|---|---|---|\n' +
        '| 10:00 | National Museum of Korea | Start point | Real Seoul candidate |\n' +
        '| 12:00 | Cherry Garden Restaurant (Halal) | Subway 10 min | Trusted halal candidate |\n' +
        '| 18:00 | Zorbaz Purple Lantern Diner | Taxi 10 min | Invented restaurant, not on the trusted list |',
    }));
    const handler = (await import('../../api/ai-planner-quick.js')).default;
    const res = makeRes();
    await handler({
      method: 'POST', headers: { host: 'unit.test', 'content-type': 'application/json' },
      body: { regions: ['Seoul'], durationDays: 3, pax: 2, reservation_status: 'nothing', language: 'en', dietaryRestrictions: ['Halal'] },
    } as any, res);

    expect(res.statusCode).not.toBe(200);
    expect(JSON.parse(res.body).ok).toBe(false);
  });

});

// 2026-08-24 (planner-trust-course #8): Suwon has exactly 1 attraction-index
// row and 0 food-index rows — below the 3-candidate floor on its own. The
// strict korea_spots reader (api/_spots_helper.js getExactCitySpotCandidates)
// fills that gap with the real Suwon-Hwaseong group so Suwon now clears
// preflight and reaches Gemini, instead of always failing closed.
describe('ai-planner-quick — Suwon thin-city fallback (korea_spots strict reader, #8)', () => {
  it('preflight: Suwon clears the 3-candidate floor via the korea_spots Suwon-Hwaseong group and reaches Gemini', async () => {
    generateContentMock.mockResolvedValueOnce(geminiJsonResult({
      themes: ['Heritage'],
      marketingNarrative: 'Discover Suwon\'s UNESCO fortress and royal palace on your first day.',
      day1MarkdownTable:
        '| Time | Spot | Transit | Insider Tip |\n|---|---|---|---|\n' +
        '| 10:00 | Hwaseong Fortress | Start point | Walk the fortress wall |\n' +
        '| 13:00 | Hwaseong Haenggung Palace | Walk 10 min | Catch the guard ceremony |\n' +
        '| 15:00 | Suwon Hwaseong Museum | Walk 5 min | Learn the fortress history |',
    }));
    const handler = (await import('../../api/ai-planner-quick.js')).default;
    const res = makeRes();
    await handler({ method: 'POST', headers: { host: 'unit.test', 'content-type': 'application/json' }, body: { regions: ['Suwon'], durationDays: 3, pax: 2, reservation_status: 'nothing', language: 'en' } } as any, res);

    expect(generateContentMock).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.data.spotDetails)).toBe(true);
    expect(body.data.spotDetails).toHaveLength(3);
  });
});

describe('ai-planner-quick — korea_spots strict reader cross-city rejection (#8)', () => {
  it('Suwon-Hwaseong places never leak to a different city, and the generic "gyeonggi" bucket never matches directly', async () => {
    const { getExactCitySpotCandidates } = await import('../../api/_spots_helper.js');
    const suwonNames = getExactCitySpotCandidates('suwon').map((c: any) => c.name.en);
    expect(suwonNames).toContain('Hwaseong Fortress');
    expect(getExactCitySpotCandidates('gyeongju').map((c: any) => c.name.en))
      .not.toEqual(expect.arrayContaining(suwonNames));
    expect(getExactCitySpotCandidates('seoul').map((c: any) => c.name.en))
      .not.toEqual(expect.arrayContaining(suwonNames));
    // 'gyeonggi' itself is not a UI city key — must never match via the raw bucket field.
    expect(getExactCitySpotCandidates('gyeonggi')).toEqual([]);
  });
});

describe('ai-planner-quick — missing destination fails fast, no fabricated "Seoul"', () => {
  it('returns 422 MISSING_DESTINATION without calling Gemini', async () => {
    const handler = (await import('../../api/ai-planner-quick.js')).default;
    const res = makeRes();
    await handler({ method: 'POST', headers: { host: 'unit.test', 'content-type': 'application/json' }, body: { language: 'en' } } as any, res);

    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).code).toBe('MISSING_DESTINATION');
    expect(generateContentMock).not.toHaveBeenCalled();
  });
});
