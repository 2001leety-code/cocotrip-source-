/**
 * 투어 영수증 프론트(src/lib/tourQuote) == 백엔드(api/_shared/tour-price) SSOT 일치 가드
 * (2026-06-02, 요금 견적 영수증 UI). 멀티데이 #764 패턴 — 표시 견적가 ≠ 결제가 사고 방지.
 */
import { describe, it, expect } from 'vitest';
import { calcTourQuote as feQuote, tourDistanceSurcharge as feSurcharge } from '../../src/lib/tourQuote';
import { calcTourQuote as beQuote, tourDistanceSurcharge as beSurcharge } from '../../api/_shared/tour-price.js';

describe('투어 영수증 — 프론트 == 백엔드 (byte-identical)', () => {
  for (const vehicle of ['staria', 'sprinter']) {
    for (const km of [0, 30, 45, 70, 85, 210, 400]) {
      it(`${vehicle} km=${km} 영수증 항목 전부 일치`, () => {
        expect(feQuote({ km, vehicle })).toEqual(beQuote({ km, vehicle }));
      });
    }
  }

  it('거리추가 함수 일치 (경계값 포함)', () => {
    for (const km of [0, 30, 31, 50, 51, 85, 100, 101, 210]) {
      expect(feSurcharge(km)).toBe(beSurcharge(km));
    }
  });

  it('bus/vip → 둘 다 null', () => {
    expect(feQuote({ km: 50, vehicle: 'bus' })).toBeNull();
    expect(beQuote({ km: 50, vehicle: 'bus' })).toBeNull();
  });

  it('알려진 케이스: 춘천 85km staria 총액 527,725 (양쪽)', () => {
    expect(feQuote({ km: 85, vehicle: 'staria' })?.total).toBe(527_725);
    expect(beQuote({ km: 85, vehicle: 'staria' })?.total).toBe(527_725);
  });
});
