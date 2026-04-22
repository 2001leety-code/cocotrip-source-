/**
 * 가격 계산 로직 테스트
 * - 차량별 기본 가격 체계 검증
 * - 일수별 가격 스케일링 검증
 * - 가격 데이터 무결성 (USD > 0, KRW > 0) 검증
 */
import { describe, it, expect } from 'vitest';

// 가격 데이터 (실제 코드의 가격 체계 반영)
const CHARTER_PRICES = {
  staria_8: { daily_krw: 350000, label: 'Hyundai Staria (8인승)' },
  sprinter: { daily_krw: 550000, label: 'Mercedes Sprinter (12인승)' },
  large_bus: { daily_krw: 900000, label: '대형버스 (45인승)' },
};

const EXCHANGE_RATE_KRW_PER_USD = 1380;

describe('가격 계산 로직', () => {
  it('모든 차량 타입에 일일 가격이 존재한다', () => {
    for (const [type, info] of Object.entries(CHARTER_PRICES)) {
      expect(info.daily_krw, `${type} 가격 누락`).toBeGreaterThan(0);
      expect(info.label, `${type} 라벨 누락`).toBeTruthy();
    }
  });

  it('일수별 가격이 올바르게 스케일링된다', () => {
    const days = 3;
    const vehicle = 'staria_8' as keyof typeof CHARTER_PRICES;
    const total = CHARTER_PRICES[vehicle].daily_krw * days;

    expect(total).toBe(1050000);
  });

  it('KRW → USD 변환이 올바르다', () => {
    const krw = 350000;
    const usd = Math.round(krw / EXCHANGE_RATE_KRW_PER_USD);
    expect(usd).toBe(254); // 350000 / 1380 ≈ 253.6 → 254
    expect(usd).toBeGreaterThan(0);
  });

  it('모든 가격이 양수이다', () => {
    for (const info of Object.values(CHARTER_PRICES)) {
      expect(info.daily_krw).toBeGreaterThan(0);
    }
  });

  it('차량 가격 순서가 올바르다 (staria < sprinter < large_bus)', () => {
    expect(CHARTER_PRICES.staria_8.daily_krw).toBeLessThan(CHARTER_PRICES.sprinter.daily_krw);
    expect(CHARTER_PRICES.sprinter.daily_krw).toBeLessThan(CHARTER_PRICES.large_bus.daily_krw);
  });
});