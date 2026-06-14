/**
 * bughunt-charter-cart-id — 버그 #12 회귀 테스트
 *
 * 수정 전: id = charter-{productType}-{origin}-{dest}-{date}-{pax}
 *   → 같은 경로·날짜·인원이지만 vehicle/tripType/durationDays 가 달라도 동일 id → 소리 없이 첫째 덮어씀.
 *
 * 수정 후: id = ...-{vehicle}-{tripType}-{durationDays}
 *   → 가격 결정 키 3개 포함 → 다른 구성 = 다른 id (UX 소실 해소).
 *   → 동일 구성 = 동일 id (dedup 유지).
 */
import { describe, it, expect } from 'vitest';
import { buildCharterCartItem } from '@/components/charter/charterCartItem';
import type { ResolvedPayment } from '@/components/charter/resolveProductType';
import type { WizardState } from '@/components/charter/types';

// 공통 base state (ICN → 강남, 2026-09-01, 2인)
const BASE_STATE: Partial<WizardState> = {
  origin: 'ICN',
  destinationKey: 'gangnam',
  startDate: '2026-09-01',
  paxCount: 2,
  vehicle: 'staria',
  service: 'transfer',
};

// 공통 base resolved (charter_transfer, oneway, staria)
const BASE_RESOLVED: ResolvedPayment = {
  productType: 'charter_transfer',
  priceKRW: 138000,
  passengers: 2,
  payable: true,
  originKey: 'ICN',
  destKey: 'gangnam',
  tripType: 'oneway',
};

function makeState(overrides: Partial<WizardState> = {}): WizardState {
  return { ...BASE_STATE, ...overrides } as WizardState;
}

function makeResolved(overrides: Partial<ResolvedPayment> = {}): ResolvedPayment {
  return { ...BASE_RESOLVED, ...overrides };
}

// ──────────────────────────────────────────────────────────
// 1. tripType 만 다른 두 항목 → 다른 id (핵심 버그 #12)
// ──────────────────────────────────────────────────────────
describe('버그 #12 — tripType 이 다르면 서로 다른 cart id', () => {
  it('oneway vs roundtrip — id 불일치', () => {
    const itemOneway = buildCharterCartItem(
      makeState(),
      makeResolved({ tripType: 'oneway', priceKRW: 138000 }),
    );
    const itemRoundtrip = buildCharterCartItem(
      makeState(),
      makeResolved({ tripType: 'roundtrip', priceKRW: 248400 }),
    );
    expect(itemOneway).not.toBeNull();
    expect(itemRoundtrip).not.toBeNull();
    expect(itemOneway!.id).not.toBe(itemRoundtrip!.id);
  });
});

// ──────────────────────────────────────────────────────────
// 2. vehicle 만 다른 두 항목 → 다른 id
// ──────────────────────────────────────────────────────────
describe('버그 #12 — vehicle 이 다르면 서로 다른 cart id', () => {
  it('staria vs sprinter — id 불일치', () => {
    const itemStaria = buildCharterCartItem(
      makeState({ vehicle: 'staria' }),
      makeResolved({ priceKRW: 138000 }),
    );
    const itemSprinter = buildCharterCartItem(
      makeState({ vehicle: 'sprinter' }),
      makeResolved({ priceKRW: 276000 }),
    );
    expect(itemStaria).not.toBeNull();
    expect(itemSprinter).not.toBeNull();
    expect(itemStaria!.id).not.toBe(itemSprinter!.id);
  });
});

// ──────────────────────────────────────────────────────────
// 3. durationDays 만 다른 두 항목 → 다른 id (multiday)
// ──────────────────────────────────────────────────────────
describe('버그 #12 — durationDays 가 다르면 서로 다른 cart id', () => {
  it('2박 vs 3박 — id 불일치', () => {
    const item2d = buildCharterCartItem(
      makeState({ service: 'multi_day', startDate: '2026-09-01', endDate: '2026-09-02' }),
      makeResolved({ productType: 'charter_multiday', durationDays: 2, tripType: undefined }),
    );
    const item3d = buildCharterCartItem(
      makeState({ service: 'multi_day', startDate: '2026-09-01', endDate: '2026-09-03' }),
      makeResolved({ productType: 'charter_multiday', durationDays: 3, tripType: undefined }),
    );
    expect(item2d).not.toBeNull();
    expect(item3d).not.toBeNull();
    expect(item2d!.id).not.toBe(item3d!.id);
  });
});

// ──────────────────────────────────────────────────────────
// 4. 완전히 동일한 구성 → 동일 id (dedup 유지)
// ──────────────────────────────────────────────────────────
describe('버그 #12 — 동일 구성은 동일 id (dedup 유지)', () => {
  it('완전히 같은 입력 두 번 → id 동일', () => {
    const itemA = buildCharterCartItem(makeState(), makeResolved());
    const itemB = buildCharterCartItem(makeState(), makeResolved());
    expect(itemA).not.toBeNull();
    expect(itemB).not.toBeNull();
    expect(itemA!.id).toBe(itemB!.id);
  });
});

// ──────────────────────────────────────────────────────────
// 5. id 포맷에 vehicle/tripType/durationDays 포함 확인
// ──────────────────────────────────────────────────────────
describe('버그 #12 — id 포맷 검증 (새 필드 포함 여부)', () => {
  it('id 에 vehicle("staria") 포함', () => {
    const item = buildCharterCartItem(makeState({ vehicle: 'staria' }), makeResolved());
    expect(item).not.toBeNull();
    expect(item!.id).toContain('staria');
  });

  it('id 에 tripType("oneway") 포함', () => {
    const item = buildCharterCartItem(makeState(), makeResolved({ tripType: 'oneway' }));
    expect(item).not.toBeNull();
    expect(item!.id).toContain('oneway');
  });

  it('id 에 durationDays 포함 (multiday)', () => {
    const item = buildCharterCartItem(
      makeState({ service: 'multi_day', startDate: '2026-09-01', endDate: '2026-09-02' }),
      makeResolved({ productType: 'charter_multiday', durationDays: 2, tripType: undefined }),
    );
    expect(item).not.toBeNull();
    expect(item!.id).toContain('2');
  });
});

// ──────────────────────────────────────────────────────────
// 6. payable=false / charter_custom_estimate → null 반환 (기존 가드 회귀)
// ──────────────────────────────────────────────────────────
describe('버그 #12 — buildCharterCartItem 기존 가드 회귀', () => {
  it('payable=false → null', () => {
    const item = buildCharterCartItem(makeState(), makeResolved({ payable: false }));
    expect(item).toBeNull();
  });

  it('charter_custom_estimate → null', () => {
    const item = buildCharterCartItem(
      makeState(),
      makeResolved({ productType: 'charter_custom_estimate' }),
    );
    expect(item).toBeNull();
  });

  it('priceKRW=0 → null', () => {
    const item = buildCharterCartItem(makeState(), makeResolved({ priceKRW: 0 }));
    expect(item).toBeNull();
  });
});
