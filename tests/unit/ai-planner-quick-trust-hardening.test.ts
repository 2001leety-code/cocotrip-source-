/* eslint-disable @typescript-eslint/no-explicit-any -- handler mocking scaffolding, matches sibling ai-planner-quick-*.test.ts pattern. */
/**
 * ai-planner-quick trust-hardening (2026-08-24, planner-trust-course) —
 * covers the gaps an independent adversarial review found in the partial
 * implementation: reservation_status now required at the boundary, transit
 * honesty (model transit text never survives), dietary tip REPLACE (not
 * append) + fail-closed on model-authored certification claims, real
 * food-style (Seafood/Meat/Street) candidate filtering, Temple-preference
 * negative coverage, deferred (unsupported) category keys, and endpoint
 * hardening (origin allowlist + rate-limiter fail-closed on degrade).
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

beforeEach(() => {
  generateContentMock.mockReset();
  checkIpRateLimitMock.mockReset();
  checkIpRateLimitMock.mockResolvedValue({ ok: true });
  process.env.GEMINI_API_KEY = 'test-key';
  delete process.env.VERCEL_ENV;
  delete process.env.NODE_ENV;
});

describe('ai-planner-quick — reservation_status is required at the boundary (#1)', () => {
  it('reservation_status never sent -> 422 MISSING_RESERVATION_STATUS, no Gemini call', async () => {
    const handler = (await import('../../api/ai-planner-quick.js')).default;
    const res = makeRes();
    await handler({ method: 'POST', headers: { host: 'unit.test', 'content-type': 'application/json' }, body: { regions: ['Busan'], durationDays: 3, pax: 2, language: 'en' } } as any, res);
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).code).toBe('MISSING_RESERVATION_STATUS');
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it('reservation_status sent blank -> 422 MISSING_RESERVATION_STATUS', async () => {
    const handler = (await import('../../api/ai-planner-quick.js')).default;
    const res = makeRes();
    await handler({ method: 'POST', headers: { host: 'unit.test', 'content-type': 'application/json' }, body: { regions: ['Busan'], durationDays: 3, pax: 2, language: 'en', reservation_status: '' } } as any, res);
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).code).toBe('MISSING_RESERVATION_STATUS');
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it('reservation_status sent garbage -> 422 INVALID_RESERVATION_STATUS', async () => {
    const handler = (await import('../../api/ai-planner-quick.js')).default;
    const res = makeRes();
    await handler({ method: 'POST', headers: { host: 'unit.test', 'content-type': 'application/json' }, body: { regions: ['Busan'], durationDays: 3, pax: 2, language: 'en', reservation_status: 'yolo' } } as any, res);
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).code).toBe('INVALID_RESERVATION_STATUS');
    expect(generateContentMock).not.toHaveBeenCalled();
  });
});

describe('ai-planner-quick — transit honesty (#6)', () => {
  it('impossible model transit ("KTX 1 min") never reaches the response — replaced with the deterministic notice', async () => {
    generateContentMock.mockResolvedValueOnce(geminiJsonResult({
      themes: ['Coastal'],
      marketingNarrative: 'Explore Busan\'s beaches and markets on your first day in this coastal city.',
      day1MarkdownTable:
        '| Time | Spot | Transit | Insider Tip |\n|---|---|---|---|\n' +
        '| 10:00 | Haeundae Night | KTX 1 min | Arrive early |\n' +
        '| 12:00 | Busan Museum | KTX 1 min | Check the special exhibits |\n' +
        '| 14:00 | Beomeosa | KTX 1 min | Visit during quiet hours |',
    }));
    const handler = (await import('../../api/ai-planner-quick.js')).default;
    const res = makeRes();
    await handler({ method: 'POST', headers: { host: 'unit.test', 'content-type': 'application/json' }, body: { regions: ['Busan'], durationDays: 3, pax: 2, reservation_status: 'nothing', language: 'en' } } as any, res);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.day1MarkdownTable).not.toContain('KTX 1 min');
    expect(body.data.day1MarkdownTable).toContain('Detailed route is calculated in the full itinerary');
  });
});

describe('ai-planner-quick — dietary tip replace + certification-claim fail-closed (#5)', () => {
  it('a model-authored "certified halal" claim in the narrative is rejected even though the evidence tier is friendly-not-certified', async () => {
    generateContentMock.mockResolvedValue(geminiJsonResult({
      themes: ['Halal Seoul'],
      marketingNarrative: 'Enjoy a certified halal first day exploring Seoul with total peace of mind.',
      day1MarkdownTable:
        '| Time | Spot | Transit | Insider Tip |\n|---|---|---|---|\n' +
        '| 10:00 | National Museum of Korea | Start point | Real Seoul candidate |\n' +
        '| 12:00 | Cherry Garden Restaurant (Halal) | Subway 10 min | Trusted halal candidate |\n' +
        '| 18:00 | Cherry Garden Annex | Taxi 10 min | Second trusted stop |',
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

describe('ai-planner-quick — real food-style support (Seafood/Meat/Street, #4)', () => {
  it('Seafood style tags/filters exact-city candidates into the response spotDetails', async () => {
    generateContentMock.mockResolvedValueOnce(geminiJsonResult({
      themes: ['Seafood'],
      marketingNarrative: 'Savor Busan\'s freshest seafood on your first day in this coastal city.',
      day1MarkdownTable:
        '| Time | Spot | Transit | Insider Tip |\n|---|---|---|---|\n' +
        '| 10:00 | Haeundae Night | Start point | Arrive early |\n' +
        '| 12:00 | Clam View Haeundae Main Branch | Bus 15 min | Fresh clams |\n' +
        '| 14:00 | Beomeosa | Walk 10 min | Visit during quiet hours |',
    }));
    const handler = (await import('../../api/ai-planner-quick.js')).default;
    const res = makeRes();
    await handler({
      method: 'POST', headers: { host: 'unit.test', 'content-type': 'application/json' },
      body: { regions: ['Busan'], durationDays: 3, pax: 2, reservation_status: 'nothing', language: 'en', dietPrefs: ['Seafood'] },
    } as any, res);

    expect(res.statusCode).toBe(200);
    const call = generateContentMock.mock.calls[0][0];
    const userText = call.contents[0].parts[0].text as string;
    expect(userText).toContain('[SEAFOOD]');
  });

  it('a style with zero exact-city matches fails closed with PREFERENCE_DATA_UNAVAILABLE before Gemini', async () => {
    // Daegu has 0 exact-city "Meat"-style-matching general food rows.
    const handler = (await import('../../api/ai-planner-quick.js')).default;
    const res = makeRes();
    await handler({
      method: 'POST', headers: { host: 'unit.test', 'content-type': 'application/json' },
      body: { regions: ['Daegu'], durationDays: 3, pax: 2, reservation_status: 'nothing', language: 'en', dietPrefs: ['Meat'] },
    } as any, res);

    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).code).toBe('PREFERENCE_DATA_UNAVAILABLE');
    expect(generateContentMock).not.toHaveBeenCalled();
  });
});

describe('ai-planner-quick — Temple preference: model ignoring it is rejected (#7)', () => {
  it('a Temple request answered with only non-temple food stops is rejected (filtered-set validation, not unfiltered)', async () => {
    generateContentMock.mockResolvedValue(geminiJsonResult({
      themes: ['Food'],
      marketingNarrative: 'A delicious first day sampling Busan\'s best restaurants.',
      day1MarkdownTable:
        '| Time | Spot | Transit | Insider Tip |\n|---|---|---|---|\n' +
        '| 10:00 | 364 Grilled Lamb&Hanwoo Dumplings | Start point | Great lamb skewers |\n' +
        '| 12:00 | ALOHA RESTAURANT JEONPO | Bus 15 min | Hawaiian-Korean fusion |\n' +
        '| 14:00 | Bueokgan Haeundae Branch | Walk 10 min | Local favorite |',
    }));
    const handler = (await import('../../api/ai-planner-quick.js')).default;
    const res = makeRes();
    await handler({
      method: 'POST', headers: { host: 'unit.test', 'content-type': 'application/json' },
      body: { regions: ['Busan'], durationDays: 3, pax: 2, reservation_status: 'nothing', language: 'en', categories: ['Temple'] },
    } as any, res);

    expect(res.statusCode).not.toBe(200);
    expect(JSON.parse(res.body).ok).toBe(false);
  });
});

describe('ai-planner-quick — deferred (unsupported) category keys (#7)', () => {
  it('an unsupported category key (Kpop) is returned as deferredCategories, never silently reflected', async () => {
    generateContentMock.mockResolvedValueOnce(geminiJsonResult({
      themes: ['Heritage'],
      marketingNarrative: 'Explore Beomeosa temple and Busan\'s coast on your first day.',
      day1MarkdownTable:
        '| Time | Spot | Transit | Insider Tip |\n|---|---|---|---|\n' +
        '| 10:00 | Beomeosa | Start point | Visit during quiet hours |\n' +
        '| 12:00 | Haedong Yonggungsa | Bus 15 min | Seaside temple |\n' +
        '| 14:00 | Gammosa | Walk 10 min | Quiet local temple |',
    }));
    const handler = (await import('../../api/ai-planner-quick.js')).default;
    const res = makeRes();
    await handler({
      method: 'POST', headers: { host: 'unit.test', 'content-type': 'application/json' },
      body: { regions: ['Busan'], durationDays: 3, pax: 2, reservation_status: 'nothing', language: 'en', categories: ['Temple', 'Kpop'] },
    } as any, res);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.deferredCategories).toEqual(['Kpop']);
  });
});

describe('ai-planner-quick — endpoint hardening: origin allowlist (#9)', () => {
  it('an allowlisted origin gets Access-Control-Allow-Origin echoed back', async () => {
    checkIpRateLimitMock.mockResolvedValueOnce({ ok: false, status: 429, retryAfterSec: 60, error: 'x' });
    const handler = (await import('../../api/ai-planner-quick.js')).default;
    const res = makeRes();
    await handler({ method: 'POST', headers: { host: 'unit.test', origin: 'https://cocotripkr.com', 'content-type': 'application/json' }, body: {} } as any, res);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('https://cocotripkr.com');
    expect(res.headers['Vary']).toBe('Origin');
  });

  it('a non-allowlisted origin gets no Access-Control-Allow-Origin header', async () => {
    checkIpRateLimitMock.mockResolvedValueOnce({ ok: false, status: 429, retryAfterSec: 60, error: 'x' });
    const handler = (await import('../../api/ai-planner-quick.js')).default;
    const res = makeRes();
    await handler({ method: 'POST', headers: { host: 'unit.test', origin: 'https://evil.example.com', 'content-type': 'application/json' }, body: {} } as any, res);
    expect(res.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('a request with no Origin header (server-to-server) is not blocked and gets no ACAO header', async () => {
    checkIpRateLimitMock.mockResolvedValueOnce({ ok: false, status: 429, retryAfterSec: 60, error: 'x' });
    const handler = (await import('../../api/ai-planner-quick.js')).default;
    const res = makeRes();
    await handler({ method: 'POST', headers: { host: 'unit.test', 'content-type': 'application/json' }, body: {} } as any, res);
    expect(res.statusCode).toBe(429); // still processed normally
    expect(res.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });
});

describe('ai-planner-quick — endpoint hardening: rate-limiter degrade fails closed (#9)', () => {
  it('checkIpRateLimit degraded (DB unavailable) -> 503 before Gemini, never silently proceeds', async () => {
    checkIpRateLimitMock.mockResolvedValueOnce({ ok: true, degraded: true });
    const handler = (await import('../../api/ai-planner-quick.js')).default;
    const res = makeRes();
    await handler({ method: 'POST', headers: { host: 'unit.test', 'content-type': 'application/json' }, body: { regions: ['Busan'], durationDays: 3, pax: 2, reservation_status: 'nothing', language: 'en' } } as any, res);
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body).code).toBe('RATE_PROTECTION_DEGRADED');
    expect(generateContentMock).not.toHaveBeenCalled();
  });
});
