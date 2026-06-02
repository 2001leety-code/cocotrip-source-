/**
 * 차터 transfer 가격 backend SSOT + 프론트 일치 가드 (2026-06-02, 차터 편도km×1500).
 * 운영자 예시(서울→부산 400km 편도 627,000 / 왕복 1,188,000) 회귀 고정 + 프론트==백엔드.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { calcTransferQuote as feQuote } from '../../src/lib/transferQuote';
import {
  calcTransferQuote as beQuote,
  resolveTransferCheckoutKrw,
} from '../../api/_shared/charter-transfer-price.js';

const SPEC = JSON.parse(readFileSync(join(process.cwd(), 'api/_pricing_spec.json'), 'utf-8'));

describe('calcTransferQuote — 운영자 예시 (서울→부산 400km)', () => {
  it('편도 staria → 627,000 (600,000 −30,000 5% +57,000 VAT)', () => {
    const q = beQuote({ km: 400, tripType: 'oneway', vehicle: 'staria' })!;
    expect(q.base).toBe(600_000);
    expect(q.coupon).toBe(30_000);
    expect(q.vat).toBe(57_000);
    expect(q.total).toBe(627_000);
  });
  it('왕복 staria → 1,188,000 (1,200,000 −120,000 10% +108,000 VAT)', () => {
    const q = beQuote({ km: 400, tripType: 'roundtrip', vehicle: 'staria' })!;
    expect(q.distanceKm).toBe(800);
    expect(q.base).toBe(1_200_000);
    expect(q.coupon).toBe(120_000);
    expect(q.total).toBe(1_188_000);
  });
  it('스프린터 ×2', () => {
    expect(beQuote({ km: 400, tripType: 'oneway', vehicle: 'sprinter' })!.base).toBe(1_200_000);
  });
  it('bus/vip → null', () => {
    expect(beQuote({ km: 400, tripType: 'oneway', vehicle: 'bus' })).toBeNull();
  });
});

describe('transfer 프론트 == 백엔드 (byte-identical)', () => {
  for (const vehicle of ['staria', 'sprinter']) {
    for (const km of [50, 210, 400]) {
      for (const tripType of ['oneway', 'roundtrip'] as const) {
        it(`${vehicle} ${km}km ${tripType}`, () => {
          expect(feQuote({ km, tripType, vehicle })).toEqual(beQuote({ km, tripType, vehicle }));
        });
      }
    }
  }
});

describe('resolveTransferCheckoutKrw — 결제 게이트', () => {
  const body = { originKey: 'SEL_METRO', destKey: 'BUSAN', tripType: 'oneway', vehicle: 'staria' };
  it('플래그 OFF → null', () => {
    expect(resolveTransferCheckoutKrw(SPEC, body, false)).toBeNull();
  });
  it('플래그 ON + matrix → total (편도)', () => {
    const km = (SPEC.distance_matrix['SEL_METRO→BUSAN'] || {}).km;
    expect(resolveTransferCheckoutKrw(SPEC, body, true)).toBe(
      beQuote({ km, tripType: 'oneway', vehicle: 'staria' })!.total,
    );
  });
  it('matrix 미존재 → null', () => {
    expect(resolveTransferCheckoutKrw(SPEC, { ...body, destKey: 'VOID' }, true)).toBeNull();
  });
  it('client km 변조 무시', () => {
    const honest = resolveTransferCheckoutKrw(SPEC, body, true);
    const tampered = resolveTransferCheckoutKrw(SPEC, { ...body, km: 99999 } as never, true);
    expect(tampered).toBe(honest);
  });
});
