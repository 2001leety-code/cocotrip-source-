/* eslint-disable @typescript-eslint/no-explicit-any -- handler mocking scaffolding, matches sibling ai-planner-quick-*.test.ts pattern. */
/**
 * ai-planner-quick trust-hardening round 2 (2026-08-24, planner-trust-course)
 * — six independently reproduced P1s fixed in api/_shared/quickPreviewIntent.js
 * and api/ai-planner-quick.js: scalar raw-type bypass, destination/regions
 * conflict, dietary-narrative bypasses that avoid every denylisted
 * certification word, multi-style food AND requirement, ja-vs-zh field
 * language confusion, and Content-Type enforcement for no-Origin requests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

const BUSAN_TABLE_EN = '| Time | Spot | Transit | Insider Tip |\n|---|---|---|---|\n| 10:00 | Haeundae Night | Start point | Arrive early |\n| 12:00 | Busan Museum | Bus 15 min | Check the special exhibits |\n| 14:00 | Beomeosa | Walk 10 min | Visit during quiet hours |';
const BUSAN_NARRATIVE_EN = 'Explore Busan\'s beaches and markets on your first day in this coastal city.';
const BASE_BODY = { durationDays: 3, pax: 2, reservation_status: 'nothing', language: 'en' };

beforeEach(() => {
  generateContentMock.mockReset();
  checkIpRateLimitMock.mockReset();
  checkIpRateLimitMock.mockResolvedValue({ ok: true });
  process.env.GEMINI_API_KEY = 'test-key';
  delete process.env.VERCEL_ENV;
  delete process.env.NODE_ENV;
});

async function postJson(body: unknown, extraHeaders: Record<string, string> = {}) {
  const handler = (await import('../../api/ai-planner-quick.js')).default;
  const res = makeRes();
  await handler({ method: 'POST', headers: { host: 'unit.test', 'content-type': 'application/json', ...extraHeaders }, body } as any, res);
  return res;
}

describe('ai-planner-quick — scalar raw-type bypass (#1)', () => {
  it('durationDays as a singleton array is rejected before Gemini (Number([3])===3 would otherwise sneak through)', async () => {
    const res = await postJson({ regions: ['Busan'], ...BASE_BODY, durationDays: [3] });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).code).toBe('INVALID_REQUEST');
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it('pax as an object is rejected before Gemini', async () => {
    const res = await postJson({ regions: ['Busan'], ...BASE_BODY, pax: { valueOf: () => 2 } });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).code).toBe('INVALID_REQUEST');
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it('cityKey as a singleton array is rejected before Gemini (String(["seoul"])==="seoul" would otherwise sneak through)', async () => {
    const res = await postJson({ regions: ['Busan'], ...BASE_BODY, cityKey: ['seoul'] });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).code).toBe('INVALID_REQUEST');
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it('language as an object is rejected before Gemini', async () => {
    const res = await postJson({ regions: ['Busan'], ...BASE_BODY, language: { toString: () => 'en' } });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).code).toBe('INVALID_REQUEST');
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it('priceRange as a singleton array is rejected before Gemini', async () => {
    const res = await postJson({ regions: ['Busan'], ...BASE_BODY, priceRange: ['Any'] });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).code).toBe('INVALID_REQUEST');
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it('destination as an object is rejected before Gemini', async () => {
    const res = await postJson({ destination: { city: 'Seoul' }, ...BASE_BODY });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).code).toBe('INVALID_REQUEST');
    expect(generateContentMock).not.toHaveBeenCalled();
  });
});

describe('ai-planner-quick — destination/regions conflict (#2)', () => {
  it('destination="Busan" + regions=["Seoul"] mismatch -> 422 CITY_MISMATCH before Gemini', async () => {
    const res = await postJson({ destination: 'Busan', regions: ['Seoul'], ...BASE_BODY });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).code).toBe('CITY_MISMATCH');
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it('destination="부산" + regions=["Busan"] (matching aliases across languages) is accepted, not a mismatch', async () => {
    generateContentMock.mockResolvedValueOnce(geminiJsonResult({
      themes: ['Coastal'], marketingNarrative: BUSAN_NARRATIVE_EN, day1MarkdownTable: BUSAN_TABLE_EN,
    }));
    const res = await postJson({ destination: '부산', regions: ['Busan'], ...BASE_BODY });
    expect(JSON.parse(res.body).code).not.toBe('CITY_MISMATCH');
    expect(generateContentMock).toHaveBeenCalled();
  });
});

describe('ai-planner-quick — dietary narratives that avoid denylisted certification words (#3)', () => {
  const dietaryBody = { regions: ['Seoul'], ...BASE_BODY, dietaryRestrictions: ['Halal'] };
  const tableWithTrustedStop = (tip: string) =>
    '| Time | Spot | Transit | Insider Tip |\n|---|---|---|---|\n' +
    '| 10:00 | National Museum of Korea | Start point | Real Seoul candidate |\n' +
    `| 12:00 | Cherry Garden Restaurant (Halal) | Subway 10 min | ${tip} |\n` +
    '| 18:00 | Cherry Garden Annex | Taxi 10 min | Second trusted stop |';

  it('English "pork-free ... suitable for Muslim travelers" narrative (no halal/certified/muslim-friendly token) is rejected', async () => {
    generateContentMock.mockResolvedValue(geminiJsonResult({
      themes: ['Halal Seoul'],
      marketingNarrative: 'Every meal is pork-free and suitable for Muslim travelers on this first day.',
      day1MarkdownTable: tableWithTrustedStop('Trusted stop'),
    }));
    const res = await postJson(dietaryBody);
    expect(res.statusCode).not.toBe(200);
  });

  it('Korean "모든 음식에 돼지고기가 없습니다" narrative is rejected', async () => {
    generateContentMock.mockResolvedValue(geminiJsonResult({
      themes: ['할랄 서울'],
      marketingNarrative: '모든 음식에 돼지고기가 없습니다. 첫날 서울을 즐겨보세요 즐거운 여행 되세요.',
      day1MarkdownTable: tableWithTrustedStop('신뢰할 수 있는 곳'),
    }));
    const res = await postJson({ ...dietaryBody, language: 'ko' });
    expect(res.statusCode).not.toBe(200);
  });

  it('Japanese "すべて豚肉不使用です" narrative is rejected', async () => {
    generateContentMock.mockResolvedValue(geminiJsonResult({
      themes: ['ハラールソウル'],
      marketingNarrative: 'すべて豚肉不使用です。初日のソウルをお楽しみください、素敵な一日になりますように。',
      day1MarkdownTable: tableWithTrustedStop('信頼できるお店です'),
    }));
    const res = await postJson({ ...dietaryBody, language: 'ja' });
    expect(res.statusCode).not.toBe(200);
  });

  it('Chinese "所有餐食都不含猪肉" narrative is rejected', async () => {
    generateContentMock.mockResolvedValue(geminiJsonResult({
      themes: ['清真首尔'],
      marketingNarrative: '所有餐食都不含猪肉。第一天尽情探索首尔，祝您旅途愉快顺利。',
      day1MarkdownTable: tableWithTrustedStop('值得信赖的地方'),
    }));
    const res = await postJson({ ...dietaryBody, language: 'zh' });
    expect(res.statusCode).not.toBe(200);
  });
});

describe('ai-planner-quick — multiple food styles are an AND requirement (#4)', () => {
  it('Gangneung Seafood+Meat (Seafood exists, Meat does not) fails closed with PREFERENCE_DATA_UNAVAILABLE before Gemini', async () => {
    const res = await postJson({ regions: ['Gangneung'], ...BASE_BODY, dietPrefs: ['Seafood', 'Meat'] });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).code).toBe('PREFERENCE_DATA_UNAVAILABLE');
    expect(generateContentMock).not.toHaveBeenCalled();
  });
});

describe('ai-planner-quick — Japanese field language validation rejects Chinese-only text (#5)', () => {
  it('a Chinese-only theme ("主题") for a ja request is rejected', async () => {
    generateContentMock.mockResolvedValue(geminiJsonResult({
      themes: ['主题'],
      marketingNarrative: '釜山の美しいビーチと活気ある市場で1日目をお楽しみください。',
      day1MarkdownTable: '| 時間 | スポット | 交通 | ヒント |\n|---|---|---|---|\n| 10:00 | 海雲台夜 | 出発地 | 早めの到着がおすすめ |\n| 12:00 | 釜山博物館 | バス15分 | 特別展をチェック |\n| 14:00 | 梵魚寺 | 徒歩10分 | 静かな時間帯に訪問 |',
    }));
    const res = await postJson({ regions: ['Busan'], ...BASE_BODY, language: 'ja' });
    expect(res.statusCode).not.toBe(200);
  });

  it('a Chinese-only tip ("请提前到达") for a ja request is rejected', async () => {
    generateContentMock.mockResolvedValue(geminiJsonResult({
      themes: ['海の街'],
      marketingNarrative: '釜山の美しいビーチと活気ある市場で1日目をお楽しみください。',
      day1MarkdownTable: '| 時間 | スポット | 交通 | ヒント |\n|---|---|---|---|\n| 10:00 | 海雲台夜 | 出発地 | 请提前到达 |\n| 12:00 | 釜山博物館 | バス15分 | 特別展をチェック |\n| 14:00 | 梵魚寺 | 徒歩10分 | 静かな時間帯に訪問 |',
    }));
    const res = await postJson({ regions: ['Busan'], ...BASE_BODY, language: 'ja' });
    expect(res.statusCode).not.toBe(200);
  });

  it('a valid han-only Japanese theme (no kana, on the explicit server allowlist) is still accepted', async () => {
    generateContentMock.mockResolvedValueOnce(geminiJsonResult({
      themes: ['絶景'],
      marketingNarrative: '釜山の美しいビーチと活気ある市場で1日目をお楽しみください。',
      day1MarkdownTable: '| 時間 | スポット | 交通 | ヒント |\n|---|---|---|---|\n| 10:00 | 海雲台夜 | 出発地 | 早めの到着がおすすめ |\n| 12:00 | 釜山博物館 | バス15分 | 特別展をチェック |\n| 14:00 | 梵魚寺 | 徒歩10分 | 静かな時間帯に訪問 |',
    }));
    const res = await postJson({ regions: ['Busan'], ...BASE_BODY, language: 'ja' });
    expect(res.statusCode).toBe(200);
  });

  // 2026-08-24 (planner-trust-course B): structural replacement — a han-only
  // theme is now judged by an explicit allowlist, not a denylist. These lock
  // that arbitrary han-only Chinese text is rejected even when NONE of its
  // characters happen to be on the old (removed) denylist.
  it('a Chinese-only theme ("旅游景点", none of its characters on the old denylist) for a ja request is rejected', async () => {
    generateContentMock.mockResolvedValue(geminiJsonResult({
      themes: ['旅游景点'],
      marketingNarrative: '釜山の美しいビーチと活気ある市場で1日目をお楽しみください。',
      day1MarkdownTable: '| 時間 | スポット | 交通 | ヒント |\n|---|---|---|---|\n| 10:00 | 海雲台夜 | 出発地 | 早めの到着がおすすめ |\n| 12:00 | 釜山博物館 | バス15分 | 特別展をチェック |\n| 14:00 | 梵魚寺 | 徒歩10分 | 静かな時間帯に訪問 |',
    }));
    const res = await postJson({ regions: ['Busan'], ...BASE_BODY, language: 'ja' });
    expect(res.statusCode).not.toBe(200);
  });

  it('a second Chinese-only theme ("非常好") for a ja request is rejected', async () => {
    generateContentMock.mockResolvedValue(geminiJsonResult({
      themes: ['非常好'],
      marketingNarrative: '釜山の美しいビーチと活気ある市場で1日目をお楽しみください。',
      day1MarkdownTable: '| 時間 | スポット | 交通 | ヒント |\n|---|---|---|---|\n| 10:00 | 海雲台夜 | 出発地 | 早めの到着がおすすめ |\n| 12:00 | 釜山博物館 | バス15分 | 特別展をチェック |\n| 14:00 | 梵魚寺 | 徒歩10分 | 静かな時間帯に訪問 |',
    }));
    const res = await postJson({ regions: ['Busan'], ...BASE_BODY, language: 'ja' });
    expect(res.statusCode).not.toBe(200);
  });

  it('a kana-bearing Japanese theme ("美しい景色", not on the allowlist but has kana) is accepted', async () => {
    generateContentMock.mockResolvedValueOnce(geminiJsonResult({
      themes: ['美しい景色'],
      marketingNarrative: '釜山の美しいビーチと活気ある市場で1日目をお楽しみください。',
      day1MarkdownTable: '| 時間 | スポット | 交通 | ヒント |\n|---|---|---|---|\n| 10:00 | 海雲台夜 | 出発地 | 早めの到着がおすすめ |\n| 12:00 | 釜山博物館 | バス15分 | 特別展をチェック |\n| 14:00 | 梵魚寺 | 徒歩10分 | 静かな時間帯に訪問 |',
    }));
    const res = await postJson({ regions: ['Busan'], ...BASE_BODY, language: 'ja' });
    expect(res.statusCode).toBe(200);
  });
});

describe('ai-planner-quick — Content-Type enforcement applies to no-Origin requests too (#6)', () => {
  it('no-Origin request with text/plain Content-Type is rejected 415 before rate limiting/Gemini', async () => {
    const res = await postJson({ regions: ['Busan'], ...BASE_BODY }, { 'content-type': 'text/plain' });
    expect(res.statusCode).toBe(415);
    expect(JSON.parse(res.body).code).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect(checkIpRateLimitMock).not.toHaveBeenCalled();
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it('no-Origin request with valid application/json Content-Type proceeds normally', async () => {
    generateContentMock.mockResolvedValueOnce(geminiJsonResult({
      themes: ['Coastal'], marketingNarrative: BUSAN_NARRATIVE_EN, day1MarkdownTable: BUSAN_TABLE_EN,
    }));
    const res = await postJson({ regions: ['Busan'], ...BASE_BODY });
    expect(res.statusCode).toBe(200);
    expect(generateContentMock).toHaveBeenCalled();
  });
});
