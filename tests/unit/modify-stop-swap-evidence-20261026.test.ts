/**
 * 2026-10-26 적대적 검증 — 무료 수정 API stop_swap 이 옛 식당의 식이 근거·안내문·주소·좌표를 새 식당에 남기던 결함.
 *
 * 전: swapped = { ...oldStop, 일부 덮어쓰기 } → 옛 stop 의 dietary_evidence(halal_certified)·tip("운영자 인증 확인")이
 *     친화 등급(muslim_friendly) 새 식당에 그대로 남아 저장됐다 — 신뢰 등급 SSOT(dietaryEvidenceFor) 우회.
 * 후: 식당 종속 값은 새 행에서만 다시 만든다(revisitPolicy.applyFoodRowToStop). 일정 값(order·시각·체류)은 보존.
 */
import { describe, it, expect } from 'vitest';
import { applyStopSwap } from '../../api/ai-planner-modify.js';
import { statusMatchesTag, describeDietaryEvidence } from '../../api/_shared/dietary-trust.js';

const CERT_TIP_EN = describeDietaryEvidence('halal_certified', 'en');

function itinerary() {
  return {
    days: [{
      day: 1,
      stops: [
        { order: 1, name: '호텔', category: 'lodging' },
        {
          order: 2, name: '옛인증식당', category: 'food', start_time: '12:00', stay_min: 60,
          address: '서울 옛주소 1', lat: 37.5, lng: 126.9, tag: 'halal', dietary_tags: ['halal'],
          dietary_evidence: [{ diet: 'halal', tag: 'halal', verification_status: 'halal_certified' }],
          tip: CERT_TIP_EN, recommended_items: ['옛 메뉴'], reservation_phone: '02-000-0000',
        },
        { order: 3, name: '호텔', category: 'lodging' },
      ],
    }],
  };
}
const classified = { target: { day_index: 1, stop_order: 2, stop_name: '식당' }, raw_text: '1일차 식당 바꿔줘' };
const friendlyRow = {
  name: '새친화식당', nameEn: 'New Friendly', city: 'seoul', tag: 'halal', verification_status: 'muslim_friendly',
  address: '서울특별시 중구 세종대로 110', lat: 37.5665, lng: 126.978, rating: 4.6, reviewCount: 120,
};

describe('applyStopSwap — 식당 종속 값은 새 행에서만', () => {
  it('친화 등급 식당으로 바뀌면 근거·안내문도 친화 등급(인증 문구 잔존 0)', () => {
    const it0 = itinerary();
    const r = applyStopSwap({ itinerary: it0, classified, dietPrefs: ['Halal'], foodIndex: [friendlyRow], area: 'seoul', language: 'en' });
    expect(r.ok).toBe(true);
    const s = it0.days[0].stops[1] as Record<string, unknown>;
    expect(s.name).toBe('새친화식당');
    expect(s.dietary_evidence).toEqual([{ diet: 'halal', tag: 'halal', verification_status: 'muslim_friendly' }]);
    expect(s.tip).toBe(describeDietaryEvidence('muslim_friendly', 'en'));
    expect(String(s.tip)).not.toBe(CERT_TIP_EN);
    expect(s.address).toBe('서울특별시 중구 세종대로 110');
    expect([s.lat, s.lng]).toEqual([37.5665, 126.978]);
    expect(s).not.toHaveProperty('recommended_items');
    expect(s).not.toHaveProperty('reservation_phone');
    expect(s.tag).toBe('halal');
    expect(s.dietary_tags).toEqual(['halal']);
    // 일정 값 보존
    expect([s.order, s.start_time, s.stay_min, s.category]).toEqual([2, '12:00', 60, 'food']);
    expect(String(s.personalization_reasoning)).toContain('Swap (user-requested)');
  });
  it('손님 언어로 안내문(ko)', () => {
    const it0 = itinerary();
    applyStopSwap({ itinerary: it0, classified, dietPrefs: ['Halal'], foodIndex: [friendlyRow], area: 'seoul', language: 'ko' });
    expect((it0.days[0].stops[1] as Record<string, unknown>).tip).toBe(describeDietaryEvidence('muslim_friendly', 'ko'));
  });
  it('식이 없는 손님: 옛 식당의 식이 근거·태그가 새 식당에 남지 않는다', () => {
    const it0 = itinerary();
    const plain = { name: '맛집', city: 'seoul', rating: 4.8, reviewCount: 300, address: '서울 새주소', lat: 37.55, lng: 126.99 };
    const r = applyStopSwap({ itinerary: it0, classified, dietPrefs: [], foodIndex: [plain], area: 'seoul' });
    expect(r.ok).toBe(true);
    const s = it0.days[0].stops[1] as Record<string, unknown>;
    expect(s.name).toBe('맛집');
    expect(s).not.toHaveProperty('dietary_evidence');
    expect(s).not.toHaveProperty('tag');
    expect(s.dietary_tags).toEqual([]);
    expect(String(s.tip)).not.toBe(CERT_TIP_EN);
  });
});

describe('applyStopSwap — 같은 식당 재선택(재시도) 경로', () => {
  it('두 번째 후보로 교체만 — 첫 후보의 주소·좌표가 남지 않고 공유 foodIndex 행도 바뀌지 않는다', () => {
    const it0 = itinerary();
    const first = { name: '옛인증식당', city: 'seoul', rating: 4.9, reviewCount: 900, address: '서울 첫후보 주소', lat: 37.51, lng: 126.91, nameEn: 'Old Certified', googleMapsUrl: 'https://maps.example/old' };
    const second = { name: '둘째식당', city: 'seoul', rating: 4.1, reviewCount: 50 };
    const foodIndex = [first, second];
    const before = JSON.stringify(foodIndex);
    const r = applyStopSwap({ itinerary: it0, classified, dietPrefs: [], foodIndex, area: 'seoul' });
    expect(r.ok).toBe(true);
    const s = it0.days[0].stops[1] as Record<string, unknown>;
    expect(s.name).toBe('둘째식당');
    expect(s).not.toHaveProperty('address');
    expect(s).not.toHaveProperty('lat');
    expect(s.display_name).toBe('둘째식당');
    expect(s).not.toHaveProperty('googleMapsUrl');
    expect(JSON.stringify(foodIndex)).toBe(before);
  });
});

describe('statusMatchesTag — 프로토타입 키는 계열이 아니다', () => {
  it('constructor·__proto__·toString 은 false', () => {
    expect(statusMatchesTag('constructor', 'constructor')).toBe(false);
    expect(statusMatchesTag('__proto__', '__proto__')).toBe(false);
    expect(statusMatchesTag('halal_certified', 'toString')).toBe(false);
  });
});
