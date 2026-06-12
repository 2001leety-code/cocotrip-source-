/* eslint-disable @typescript-eslint/no-explicit-any -- 핸들러/Firestore 모킹 스캐폴딩(auth-idor-pr418 패턴). */
/**
 * applyPromoCode — FEATURE_DISCOUNT_V2 ON 시 EARLY50 표시 게이트 회귀 (2026-06-12 결제 버그헌트).
 *
 * 버그: 청구 경로(createPaypalOrder L229 `!discountV2 && EARLY50`)는 v2 ON 에서 EARLY50 을
 * 청구가에 반영 안 하는데, 표시 경로(applyPromoCode)는 v2 와 무관하게 20% 할인을 보여줬다
 * → 손님은 20% 할인 화면을 보고 정가 청구(표시≠청구=오과금) + 캠페인 한도 헛소진.
 * fix: 두 경로가 같은 FEATURE_DISCOUNT_V2 플래그를 읽어 v2 ON 시 EARLY50 동일하게 비활성.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

function fakeDb(): any {
  const fake: any = {};
  fake.collection = () => fake;
  fake.doc = () => fake;
  fake.get = async () => ({ exists: false, data: () => ({}) }); // global_promo_usage 0
  return fake;
}

vi.mock('../../api/_exchange-rate.js', () => ({ getUsdToKrw: async () => 1400 }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => fakeDb() }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: vi.fn() }));

type MockRes = { statusCode?: number; body: string; writeHead: (s: number, h?: any) => MockRes; end: (s?: string) => MockRes };
function makeRes(): MockRes {
  const res: any = {
    statusCode: undefined, body: '',
    writeHead(s: number) { res.statusCode = s; return res; },
    end(s?: string) { if (s != null) res.body = s; return res; },
  };
  return res;
}
function req(body: object) {
  return { method: 'POST', url: '/api/applyPromoCode', headers: { host: 'unit.test' }, body };
}

describe('applyPromoCode — EARLY50 v2 게이트', () => {
  const ENV = process.env.FEATURE_DISCOUNT_V2;
  beforeEach(() => { delete process.env.FEATURE_DISCOUNT_V2; });
  afterEach(() => { if (ENV === undefined) delete process.env.FEATURE_DISCOUNT_V2; else process.env.FEATURE_DISCOUNT_V2 = ENV; });

  it('v2 OFF(기본): EARLY50 → 20% 할인 표시 (현행 유지)', async () => {
    delete process.env.FEATURE_DISCOUNT_V2;
    const handler = (await import('../../api/applyPromoCode.js')).default;
    const res = makeRes();
    await handler(req({ code: 'EARLY50', originalPrice: 100 }) as any, res as any);
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body).data;
    expect(data.valid).toBe(true);
    expect(data.discountRate).toBe(0.20);
  });

  it('v2 ON: EARLY50 → INVALID_CODE (표시 차단, 청구 경로와 일치)', async () => {
    process.env.FEATURE_DISCOUNT_V2 = 'true';
    const handler = (await import('../../api/applyPromoCode.js')).default;
    const res = makeRes();
    await handler(req({ code: 'EARLY50', originalPrice: 100 }) as any, res as any);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe('INVALID_CODE');
  });

  it('v2 ON: COCO5 는 영향 없음 (EARLY50 만 게이트)', async () => {
    process.env.FEATURE_DISCOUNT_V2 = 'true';
    const handler = (await import('../../api/applyPromoCode.js')).default;
    const res = makeRes();
    await handler(req({ code: 'COCO5', originalPrice: 100 }) as any, res as any);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.discountRate).toBe(0.05);
  });
});
