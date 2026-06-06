/**
 * cart PR2b — 예약창 "장바구니 담기" = 완전 결제 항목 (회귀 가드).
 * PR1 카드 담기는 productType+tourId 만 = 결제 불가(불완전). 올바른 진입 = TourBookingDialog
 * (날짜·인원·픽업·메모 입력 후). 카드 진입 제거 + dialog 완전 booking 을 source 레벨로 가드.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dialogSrc = readFileSync(resolve(process.cwd(), 'src/components/tours/TourBookingDialog.tsx'), 'utf8');
const cardSrc = readFileSync(resolve(process.cwd(), 'src/components/tours/TourCard.tsx'), 'utf8');

describe('cart PR2b — 예약창 담기 = 완전 항목', () => {
  it('TourBookingDialog 가 CartAddButton import + 사용', () => {
    expect(dialogSrc).toMatch(/import\s*\{[^}]*CartAddButton[^}]*\}\s*from\s*['"]@\/components\/CartButton['"]/);
    expect(dialogSrc).toMatch(/<CartAddButton/);
  });

  it('완전 booking 전달 — 가격 식별(passengers/durationDays) + fulfillment(dateStart/pickupLocation)', () => {
    // 예약창 상태에서 구성 (PayPalBookingButton 의 passengers={pax} 와 구분되는 객체 키 형태)
    expect(dialogSrc).toMatch(/passengers:\s*pax/);
    expect(dialogSrc).toMatch(/durationDays:\s*days/);
    expect(dialogSrc).toMatch(/dateStart:\s*date/);
    expect(dialogSrc).toMatch(/pickupLocation:\s*pickupAddress/);
  });

  it('TourCard 는 CartAddButton 미사용 (불완전 productType-only 진입 제거)', () => {
    expect(cardSrc).not.toMatch(/CartAddButton/);
  });
});
