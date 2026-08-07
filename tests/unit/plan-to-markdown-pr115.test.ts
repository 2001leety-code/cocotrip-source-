/**
 * P115 (2026-05-20) regression slot — plan → Markdown export.
 *
 * PDF fallback: 사용자가 PDF 깨지면 "텍스트로 다운로드" 클릭 → .md 파일 받음.
 * 메모장/Notion/Apple Notes 호환. 사진 X, 텍스트만.
 *
 * Verifies:
 *   1. planToMarkdown 출력에 핵심 섹션 모두 포함 (Header / Arrival /
 *      Days / Intercity / Departure / Budget / Recommended)
 *   2. multi-city plan 의 intercity_transit 가 KTX/공항 정보 + bookend (P111)
 *      표시
 *   3. malformed input graceful (empty plan / missing fields)
 *   4. Markdown 특수문자 escape — | (테이블) 만 처리
 *   5. UTF-8 한글/이모지/일본어/중국어 모두 보존
 */
import { describe, it, expect } from 'vitest';
import { planToMarkdown } from '../../src/pages/PlanDetailPage/lib/planToMarkdown';

const SAMPLE_PLAN: any = {
  planId: '4792076e-93f2-418d-90e3-1feb1657f5b8',
  input: {
    guestName: 'Guest',
    regions: ['서울', '부산'],
    pax: 2,
    startDate: '2026-05-21',
    endDate: '2026-05-25',
    language: 'ko',
    vehicle: 'staria_8',
  },
  itinerary: {
    tour_title: '게스트님의 5일간의 서울 & 부산 미식, 사진, 사찰 여행',
    arrival_guide: {
      airport: 'ICN T1',
      steps: [
        { step: 1, title: '입국심사', est_min: 30, description: 'KETA 보유 시 패스트트랙' },
      ],
      route_to_hotel: {
        instruction: 'AREX Express',
        est_min: 45,
        est_fare_krw: 9500,
      },
    },
    departure_guide: {
      airport: 'ICN T1',
      route_to_airport: {
        instruction: 'AREX Express',
        est_min: 45,
        est_fare_krw: 9500,
      },
    },
    days: [
      {
        day: 1, date: '2026-05-21', city: 'Seoul', theme: '서울 도착, 명동의 밤',
        stops: [
          { order: 1, start_time: '15:45', end_time: '17:45', category: 'lodging',
            name: '명동 호텔', display_name: 'Myeongdong Hotel',
            address: '서울특별시 중구 명동', tip: '체크인 후 휴식',
            naverMapUrl: 'https://map.naver.com/v5/x' },
          { order: 2, start_time: '18:02', end_time: '19:02', category: 'food',
            name: '몽벨리 명동점', display_name: 'Mongvely 2nd Branch',
            address: '서울특별시 중구 명동3길 44', entry_fee_krw: 20000 },
        ],
      },
      {
        day: 3, date: '2026-05-23', city: 'Busan', theme: '부산으로 이동, 해변의 사찰',
        intercity_transit: {
          mode: 'KTX',
          from_city: 'Seoul', to_city: 'Busan',
          from_city_display: '서울', to_city_display: '부산',
          from_station: '서울역', to_station: '부산역',
          recommended_depart: '09:00', arrival_at: '11:45',
          est_min: 165, est_fare_krw: 59800,
          booking_url: 'https://www.letskorail.com',
          instruction: '서울역에서 KTX 약 2시간 45분',
          // P111: enrichment 가 채웠다고 가정한 bookend
          lodging_to_station: {
            instruction: '지하철 4호선 서울역',
            est_min: 25,
          },
          station_to_lodging: {
            instruction: '지하철 2호선 해운대',
            est_min: 50,
          },
        },
        stops: [
          { order: 1, start_time: '12:25', category: 'lodging',
            name: '명동 호텔', display_name: 'Myeongdong Hotel',
            address: '서울특별시 중구 명동' },
          { order: 2, start_time: '15:48', end_time: '16:48', category: 'food',
            name: '부산역 돼지국밥 맛집', display_name: 'Busan Station Pork Soup',
            address: '부산광역시 동구 초량동' },
        ],
      },
    ],
    daily_budget_summary: [
      { day: 1, food_krw: 50000, transit_krw: 5000, entry_krw: 20000, total_krw: 75000 },
    ],
    t_money_recommended_load: 30000,
    recommended_restaurants: {
      korean: [
        { name: '봉피양 평양냉면', cuisine: 'korean', rating: 4.7, address: '서울 중구...' },
      ],
    },
  },
};

describe('planToMarkdown — core structure', () => {
  it('renders title heading + meta line', () => {
    const md = planToMarkdown(SAMPLE_PLAN);
    expect(md).toContain('# 게스트님의 5일간의 서울 & 부산 미식, 사진, 사찰 여행');
    expect(md).toContain('📅 2026-05-21 ~ 2026-05-25');
    expect(md).toContain('📍 서울 · 부산');
    expect(md).toContain('👥 2 pax');
  });

  it('includes arrival_guide section with airport label', () => {
    const md = planToMarkdown(SAMPLE_PLAN);
    expect(md).toContain('## ✈️ 도착 안내 (ICN T1)');
    expect(md).toContain('1. **입국심사** (30분)');
    expect(md).toContain('AREX Express');
    expect(md).toContain('9,500원');
  });

  it('renders each day with theme + stops time range', () => {
    const md = planToMarkdown(SAMPLE_PLAN);
    expect(md).toContain('## Day 1 (2026-05-21)');
    expect(md).toContain('> 서울 도착, 명동의 밤');
    expect(md).toContain('**15:45-17:45**');
    expect(md).toContain('🛏️ **Myeongdong Hotel**');
    expect(md).toContain('🍽️ **Mongvely 2nd Branch**');
  });

  it('renders intercity transit (KTX) with bookend (P111 enrichment)', () => {
    const md = planToMarkdown(SAMPLE_PLAN);
    expect(md).toContain('### 🚆 도시 간 이동 (서울 → 부산)');
    expect(md).toContain('**서울역 → 부산역**');
    expect(md).toContain('출발 시간: 09:00');
    expect(md).toContain('도착 시간: 11:45');
    expect(md).toContain('165분');
    expect(md).toContain('59,800원');
    expect(md).toContain('https://www.letskorail.com');
    // P111 bookend rendering
    expect(md).toContain('🛏️→🚆 호텔→서울역');
    expect(md).toContain('🚆→🛏️ 부산역→호텔');
  });

  it('falls back to i18n "Station" (not hardcoded Korean 역) when from_station/to_station missing, EN', () => {
    const dayWithoutStationNames = {
      ...SAMPLE_PLAN.itinerary.days[1],
      intercity_transit: {
        ...SAMPLE_PLAN.itinerary.days[1].intercity_transit,
        from_station: undefined,
        to_station: undefined,
      },
    };
    const plan = {
      ...SAMPLE_PLAN,
      itinerary: {
        ...SAMPLE_PLAN.itinerary,
        days: [SAMPLE_PLAN.itinerary.days[0], dayWithoutStationNames],
      },
    };
    const md = planToMarkdown(plan, { language: 'en' });
    expect(md).toContain('🛏️→🚆 호텔→Station');
    expect(md).toContain('🚆→🛏️ Station→호텔');
    expect(md).not.toContain('호텔→역');
    expect(md).not.toContain('역→호텔');
  });

  it('renders departure_guide + budget table + recommended restaurants', () => {
    const md = planToMarkdown(SAMPLE_PLAN);
    expect(md).toContain('## 🛫 출발 안내 (ICN T1)');
    expect(md).toContain('## 💰 일별 예산');
    expect(md).toContain('| Day | Food | Transit | Entry | Total |');
    expect(md).toContain('| Day 1 | 50,000원 |');
    expect(md).toContain('T-money 추천 충전액**: 30,000원');
    expect(md).toContain('## 🍴 추천 식당 (Must-visit)');
    expect(md).toContain('봉피양 평양냉면');
  });

  it('includes footer with planId + lang + generation date', () => {
    const md = planToMarkdown(SAMPLE_PLAN);
    expect(md).toContain('Generated by CocoTrip');
    expect(md).toContain('Language: ko');
    expect(md).toContain('Plan ID: 4792076e-93f2-418d-90e3-1feb1657f5b8');
  });

  it('preserves UTF-8 (한글/일본어/중국어/이모지)', () => {
    const md = planToMarkdown({
      ...SAMPLE_PLAN,
      itinerary: { ...SAMPLE_PLAN.itinerary, tour_title: '한글 日本語 中文 🇰🇷' },
    });
    expect(md).toContain('한글');
    expect(md).toContain('日本語');
    expect(md).toContain('中文');
    expect(md).toContain('🇰🇷');
  });

  it('escapes table pipes (|) to prevent markdown table break', () => {
    const md = planToMarkdown({
      ...SAMPLE_PLAN,
      itinerary: { ...SAMPLE_PLAN.itinerary, tour_title: 'A | B' },
    });
    expect(md).toContain('# A \\| B');
  });
});

describe('planToMarkdown — graceful degradation', () => {
  it('returns empty string for null/undefined plan', () => {
    expect(planToMarkdown(null)).toBe('');
    expect(planToMarkdown(undefined)).toBe('');
  });

  it('handles empty itinerary safely (no throws)', () => {
    expect(() => planToMarkdown({} as any)).not.toThrow();
    expect(() => planToMarkdown({ itinerary: {} } as any)).not.toThrow();
    expect(() => planToMarkdown({ itinerary: { days: [] } } as any)).not.toThrow();
  });

  it('renders minimal plan without arrival/departure/intercity', () => {
    const minimal = {
      itinerary: {
        days: [{ day: 1, stops: [{ order: 1, name: '도시락', start_time: '12:00', category: 'food' }] }],
      },
    };
    const md = planToMarkdown(minimal as any);
    expect(md).toContain('## Day 1');
    expect(md).toContain('도시락');
    // No arrival_guide / departure_guide / intercity_transit sections.
    expect(md).not.toContain('도착 안내');
    expect(md).not.toContain('출발 안내');
    expect(md).not.toContain('도시 간 이동');
  });

  it('optional planUrl 포함되면 link 표시', () => {
    const md = planToMarkdown(SAMPLE_PLAN, { planUrl: 'https://cocotripkr.com/my-plans/xyz' });
    expect(md).toContain('🔗 Online: https://cocotripkr.com/my-plans/xyz');
  });
});
