/**
 * P126 (2026-05-21) regression slot — Wizard "이어 작성하시겠습니까?" 모달이
 * 사용자가 wizard 만 열고 닫았을 뿐인데 발화하는 false positive 차단.
 *
 * Pre-fix: src/components/WizardForm/index.tsx 의 hasContent 검사가
 * `dateRangeFrom` 만으로도 true → autosave 가 mount 시 tomorrow default 를
 * 항상 저장 → 재방문 시 모달 발화.
 *
 * Post-fix: hasMeaningfulWizardContent helper (src/components/WizardForm/
 * snapshotContent.ts) 가 명시적 사용자 시그널만 인정 — dateRangeFrom 제외,
 * dateRangeTo / mainCity / reservationStatus / freeText 등.
 */
import { describe, it, expect } from 'vitest';
import { hasMeaningfulWizardContent, PAX_INPUT_DEFAULT } from '../../src/components/WizardForm/snapshotContent';

describe('hasMeaningfulWizardContent — P126 false-positive 차단', () => {
  it('빈 snapshot → false', () => {
    expect(hasMeaningfulWizardContent({})).toBe(false);
  });

  it('null / undefined → false', () => {
    expect(hasMeaningfulWizardContent(null)).toBe(false);
    expect(hasMeaningfulWizardContent(undefined)).toBe(false);
  });

  it('default paxInput=2 + dateRangeTo null → false (P126 core regression)', () => {
    // 사용자가 wizard 페이지만 열고 닫음. dateRange.from=tomorrow auto-init 됐지만
    // dateRangeTo 는 미선택. autosave 가 500ms 후 저장한 snapshot — 의미 X.
    expect(hasMeaningfulWizardContent({
      paxInput: PAX_INPUT_DEFAULT,
      dateRangeTo: null,
    })).toBe(false);
  });

  it('reservationStatus 설정 (step 0 시그널) → true', () => {
    expect(hasMeaningfulWizardContent({ reservationStatus: 'booked' })).toBe(true);
    expect(hasMeaningfulWizardContent({ reservationStatus: 'no' })).toBe(true);
  });

  // P151 (2026-05-22): mainCity 단독은 도시 칩 1번 클릭 → 의미있는 콘텐츠 threshold 미달.
  // mainCity + 추가 1개 이상의 명시적 행동이 있어야 true.
  it('mainCity 단독 → false (P151)', () => {
    expect(hasMeaningfulWizardContent({ mainCity: '서울' })).toBe(false);
    expect(hasMeaningfulWizardContent({ mainCity: 'Seoul' })).toBe(false);
  });

  it('mainCity + activities → true (P151 조합)', () => {
    expect(hasMeaningfulWizardContent({ mainCity: '서울', selectedActivities: ['Food'] })).toBe(true);
    expect(hasMeaningfulWizardContent({ mainCity: 'Busan', dateRangeTo: '2026-07-01' })).toBe(true);
    expect(hasMeaningfulWizardContent({ mainCity: '제주', freeText: 'hiking' })).toBe(true);
    expect(hasMeaningfulWizardContent({ mainCity: 'Seoul', hotelAddress: '명동 호텔' })).toBe(true);
    expect(hasMeaningfulWizardContent({ mainCity: 'Seoul', arrivalTerminal: 'ICN1' })).toBe(true);
  });

  it('selectedActivities 1개 이상 → true', () => {
    expect(hasMeaningfulWizardContent({ selectedActivities: ['Food'] })).toBe(true);
    expect(hasMeaningfulWizardContent({ selectedActivities: [] })).toBe(false);
  });

  it('freeText 입력 → true', () => {
    expect(hasMeaningfulWizardContent({ freeText: 'HYBE building' })).toBe(true);
  });

  it('dietPrefs / dietaryRestrictions 입력 → true', () => {
    expect(hasMeaningfulWizardContent({ dietPrefs: ['halal'] })).toBe(true);
    expect(hasMeaningfulWizardContent({ dietaryRestrictions: ['peanuts'] })).toBe(true);
    expect(hasMeaningfulWizardContent({ dietPrefs: [] })).toBe(false);
  });

  it('dateRangeTo 명시 → true (end-date 는 사용자 선택)', () => {
    expect(hasMeaningfulWizardContent({ dateRangeTo: '2026-06-01' })).toBe(true);
  });

  it('arrivalTerminal / hotelAddress / arrivalTime / departureTime 입력 → true', () => {
    expect(hasMeaningfulWizardContent({ arrivalTerminal: 'ICN1' })).toBe(true);
    expect(hasMeaningfulWizardContent({ hotelAddress: '명동 호텔' })).toBe(true);
    expect(hasMeaningfulWizardContent({ arrivalTime: '23:05' })).toBe(true);
    expect(hasMeaningfulWizardContent({ departureTime: '09:00' })).toBe(true);
  });

  it('bucketDishes 입력 → true', () => {
    expect(hasMeaningfulWizardContent({ bucketDishes: ['kbbq'] })).toBe(true);
  });

  it('paxInput 기본 "2" → false, "3" 등 변경값 → true', () => {
    expect(hasMeaningfulWizardContent({ paxInput: '2' })).toBe(false);
    expect(hasMeaningfulWizardContent({ paxInput: '3' })).toBe(true);
    expect(hasMeaningfulWizardContent({ paxInput: '1' })).toBe(true);
    // empty string paxInput → false (사용자 미입력)
    expect(hasMeaningfulWizardContent({ paxInput: '' })).toBe(false);
  });

  it('실제 사용자 패턴 — 도시 + 날짜 + 인원 → true', () => {
    expect(hasMeaningfulWizardContent({
      mainCity: 'Seoul',
      selectedActivities: ['Food', 'Photo'],
      dateRangeTo: '2026-06-05',
      paxInput: '3',
    })).toBe(true);
  });

  it('실제 noise 패턴 — wizard 열기만 + close → false', () => {
    // mount 시 tomorrow auto-init + 사용자 0 액션. autosave snapshot 의 노이즈.
    expect(hasMeaningfulWizardContent({
      paxInput: PAX_INPUT_DEFAULT,
      dateRangeTo: null,
      arrivalTerminal: '',
      hotelAddress: '',
      arrivalTime: '',
      departureTime: '',
      mainCity: '',
      freeText: '',
      selectedActivities: [],
      dietPrefs: [],
      dietaryRestrictions: [],
      bucketDishes: [],
    })).toBe(false);
  });
});
