import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUsdToKrw: vi.fn(),
  verifyUserToken: vi.fn(),
  initAdminDb: vi.fn(),
  captureError: vi.fn(),
}));
const snapshots: Array<{ id: string; data: Record<string, unknown> }> = [];

vi.mock('../../api/_exchange-rate.js', () => ({ getUsdToKrw: mocks.getUsdToKrw, getUsdToKrwRaw: async () => 1450 }));
vi.mock('../../api/_shared/user-auth.js', () => ({ verifyUserToken: mocks.verifyUserToken }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: mocks.initAdminDb }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: mocks.captureError }));
vi.mock('../../api/_shared/paypal.js', () => ({
  getPaypalAccessToken: async () => ({ accessToken: 'synthetic-token', baseUrl: 'https://paypal.invalid' }),
  resolveIsSandbox: () => true,
}));

import handler from '../../api/applyPromoCode.js';
import createPaypalOrder from '../../api/createPaypalOrder.js';
import { verifyCouponForCharge } from '../../api/_shared/coupon-charge.js';

function makeResponse() {
  const res = {
    statusCode: 0,
    body: '',
    writeHead(status: number) { res.statusCode = status; },
    end(body = '') { res.body = body; },
  };
  return res;
}

function makePromoDb() {
  return {
    collection(name: string) {
      if (name === 'admin') {
        return { doc: () => ({ get: async () => ({ exists: false, data: () => ({}) }) }) };
      }
      if (name === 'global_promo_usage') {
        return { doc: () => ({ get: async () => ({ exists: false, data: () => ({}) }) }) };
      }
      if (name === 'users') {
        const couponSnapshot = { exists: true, data: () => ({
          code: 'WELCOME5', isUsed: false, type: 'percent', value: 5,
          productScope: 'charter',
        }) };
        const query = {
          where() { return query; },
          limit() { return query; },
          get: async () => ({
            empty: false,
            docs: [{ id: 'synthetic-coupon', data: () => couponSnapshot.data() }],
          }),
        };
        return {
          doc: () => ({ collection: () => ({
            doc: () => ({ get: async () => couponSnapshot }),
            where: () => query.where(),
            limit: () => query.limit(),
            get: () => query.get(),
          }) }),
        };
      }
      if (name === 'paypal_order_snapshots') {
        return { doc: (id: string) => ({ set: async (data: Record<string, unknown>) => { snapshots.push({ id, data }); } }) };
      }
      throw new Error('unexpected collection');
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  snapshots.length = 0;
  mocks.getUsdToKrw.mockResolvedValue(1400);
  mocks.verifyUserToken.mockResolvedValue({ ok: true, uid: 'synthetic-user' });
  mocks.initAdminDb.mockReturnValue(makePromoDb());
});

describe('applyPromoCode AI planner coupon policy', () => {
  it.each([
    { code: 'WELCOME5' },
    { codes: ['COCO5', 'WELCOME5'] },
  ])('rejects AI planner coupon or promo requests before lookup', async (codes) => {
    const res = makeResponse();
    await handler({
      method: 'POST',
      headers: {},
      body: { productType: 'ai-planner-full', originalPrice: 13300, ...codes },
    } as Parameters<typeof handler>[0], res as Parameters<typeof handler>[1]);

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({
      ok: false,
      code: 'AI_PLANNER_NO_COUPON',
    });
    expect(mocks.verifyUserToken).not.toHaveBeenCalled();
    expect(mocks.getUsdToKrw).not.toHaveBeenCalled();
    expect(mocks.initAdminDb).not.toHaveBeenCalled();
  });

  it('keeps global promos available to other products', async () => {
    const res = makeResponse();
    await handler({
      method: 'POST',
      headers: {},
      body: { productType: 'charter_seoul_city', code: 'COCO5', originalPrice: 20000 },
    } as Parameters<typeof handler>[0], res as Parameters<typeof handler>[1]);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data).toMatchObject({
      valid: true,
      originalPrice: 20000,
      savedAmount: 1000,
      discountedPrice: 19000,
    });
  });

  it('keeps valid personal coupons available to their scoped product', async () => {
    const res = makeResponse();
    await handler({
      method: 'POST',
      headers: {},
      body: { productType: 'charter_seoul_city', code: 'WELCOME5', originalPrice: 20000 },
    } as Parameters<typeof handler>[0], res as Parameters<typeof handler>[1]);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data).toMatchObject({
      valid: true,
      discountRate: 0.05,
      originalPrice: 20000,
      savedAmount: 1000,
      discountedPrice: 19000,
    });
  });

  it('keeps charter-scoped coupons available to the exact Seoul night SKU', async () => {
    const res = makeResponse();
    await handler({
      method: 'POST',
      headers: {},
      body: { productType: 'tour_seoul_night', code: 'WELCOME5', originalPrice: 20000 },
    } as Parameters<typeof handler>[0], res as Parameters<typeof handler>[1]);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data).toMatchObject({
      valid: true,
      discountRate: 0.05,
      originalPrice: 20000,
      savedAmount: 1000,
      discountedPrice: 19000,
    });

    const chargedCoupon = await verifyCouponForCharge(
      makePromoDb() as Parameters<typeof verifyCouponForCharge>[0],
      'synthetic-user',
      'synthetic-coupon',
      'tour_seoul_night',
    );
    expect(chargedCoupon).toMatchObject({ valid: true, kind: 'percent', discountPct: 5 });
    expect(20000 * (1 - (chargedCoupon.valid ? chargedCoupon.discountPct! : 0) / 100)).toBe(19000);
  });

  it('same night coupon preview and real create-order handler apply the same discount', async () => {
    const oldFlag = process.env.FEATURE_DISCOUNT_V2;
    const oldFetch = global.fetch;
    process.env.FEATURE_DISCOUNT_V2 = 'true';
    try {
      const promoRes = makeResponse();
      const listPriceKRW = 49 * 1350;
      await handler({
        method: 'POST', headers: {},
        body: { productType: 'tour_seoul_night', code: 'WELCOME5', originalPrice: listPriceKRW },
      } as Parameters<typeof handler>[0], promoRes as Parameters<typeof handler>[1]);
      expect(promoRes.statusCode).toBe(200);
      const preview = JSON.parse(promoRes.body).data;

      global.fetch = vi.fn(async () => ({
        ok: true, status: 201, json: async () => ({ id: 'SYNTHETIC_ORDER', status: 'CREATED' }),
      })) as typeof fetch;
      const orderRes = makeResponse();
      await createPaypalOrder({
        method: 'POST', headers: {},
        body: {
          productType: 'tour_seoul_night', passengers: 1, dateStart: '2099-12-24',
          couponDocId: 'synthetic-coupon', couponUserId: 'synthetic-user',
        },
      } as Parameters<typeof createPaypalOrder>[0], orderRes as Parameters<typeof createPaypalOrder>[1]);

      expect(orderRes.statusCode).toBe(200);
      const order = JSON.parse(orderRes.body);
      expect(order.data.krwAmount).toBe(Math.round(preview.discountedPrice));
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].data).toMatchObject({
        productType: 'tour_seoul_night',
        expectedKRW: Math.round(preview.discountedPrice),
      });
      expect(snapshots[0].data.expectedUSD).toBe(order.data.usdAmount);
    } finally {
      if (oldFlag === undefined) delete process.env.FEATURE_DISCOUNT_V2;
      else process.env.FEATURE_DISCOUNT_V2 = oldFlag;
      global.fetch = oldFetch;
    }
  });
});
