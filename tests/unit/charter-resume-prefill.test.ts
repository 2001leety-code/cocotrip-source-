/**
 * CharterNewPage 의 query-string → wizard prefill (buildCharterPrefill) regression.
 *
 * 버그(2026-06-12): src/pages/CharterNewPage.tsx 의 prefill useMemo 가 항상 4 키
 *   ({ origin, service, destinationKey, paxCount } — 값이 undefined 라도)를 반환했다.
 *   CharterWizard 는 `Object.keys(initialState).length > 0` 으로 "caller 가 명시 prefill
 *   했는가"를 판단해 24h resume(이어서하기) modal 을 억제한다 → length 가 항상 4 →
 *   빈 /charter 진입에서도 resume modal 이 영구 억제됨.
 *
 * fix: buildCharterPrefill 은 값이 실제로 있는 키만 반환 → 빈 진입은 {} (length 0).
 */
import { describe, it, expect } from 'vitest';
import { buildCharterPrefill } from '../../src/components/charter/charterQueryPrefill';

// URLSearchParams 호환 stub.
const P = (q: Record<string, string>) => new URLSearchParams(q);

describe('buildCharterPrefill — resume modal 억제 버그 차단', () => {
  it('빈 query → {} (Object.keys.length === 0, resume modal 살아있음)', () => {
    const r = buildCharterPrefill(P({}));
    expect(Object.keys(r).length).toBe(0);
  });

  it('무의미/무효 값만 → {} (length 0)', () => {
    // 무효 origin + 무효 service + 빈 pax → 아무 키도 안 채움.
    expect(Object.keys(buildCharterPrefill(P({ origin: 'ZZZ', service: 'nonsense' }))).length).toBe(0);
    expect(Object.keys(buildCharterPrefill(P({ pax: 'abc' }))).length).toBe(0);
  });

  it('유효 origin 1개만 → { origin } (length 1)', () => {
    const r = buildCharterPrefill(P({ origin: 'ICN' }));
    expect(r).toEqual({ origin: 'ICN' });
  });

  it('명시적 service 전달 → 그대로', () => {
    expect(buildCharterPrefill(P({ service: 'airport_transfer' }))).toEqual({ service: 'airport_transfer' });
    expect(buildCharterPrefill(P({ service: 'multi_day' }))).toEqual({ service: 'multi_day' });
  });

  it('레거시 tour=패키지키 → day_tour + destinationKey', () => {
    expect(buildCharterPrefill(P({ tour: 'dmz' }))).toEqual({ service: 'day_tour', destinationKey: 'dmz' });
  });

  it('레거시 tour=서비스키 → 그 서비스, destinationKey 없음', () => {
    expect(buildCharterPrefill(P({ tour: 'multi_day' }))).toEqual({ service: 'multi_day' });
  });

  it('destination 우선 (destination > destinationKey)', () => {
    expect(buildCharterPrefill(P({ destination: 'seoul-central', destinationKey: 'busan' })))
      .toEqual({ destinationKey: 'seoul-central' });
  });

  it('pax 숫자 파싱', () => {
    expect(buildCharterPrefill(P({ pax: '4' }))).toEqual({ paxCount: 4 });
    // NaN 방어
    expect(buildCharterPrefill(P({ pax: 'xx' }))).toEqual({});
  });

  it('전체 조합 — origin+service+destination+pax (CharterCTA 패턴)', () => {
    const r = buildCharterPrefill(P({ origin: 'ICN', service: 'airport_transfer', destinationKey: 'seoul-central', pax: '3' }));
    expect(r).toEqual({ origin: 'ICN', service: 'airport_transfer', destinationKey: 'seoul-central', paxCount: 3 });
    expect(Object.keys(r).length).toBe(4);
  });

  it('paxCount=0 같은 0 값은 falsy 가드 없이 보존 (Number.isNaN 만 거름)', () => {
    // pax=0 → '0' truthy 검사를 거치지만(parseInt('0')=0), 채워져야 함.
    expect(buildCharterPrefill(P({ pax: '0' }))).toEqual({ paxCount: 0 });
  });
});
