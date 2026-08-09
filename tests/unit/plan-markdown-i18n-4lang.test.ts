// planToMarkdown 4개 언어 잠금 (2026-08-08).
//
// 🔴 잠근 사고: "텍스트로 다운로드"(.md)가 **라벨을 전부 한국어로 고정**하고 있었다.
//   PDF 쪽은 이미 `planDetail.ui.pdf*` 사전을 쓰는데, 같은 문서의 마크다운 판만
//   `## ✈️ 도착 안내` · `### 일정` · `- 수단:` · `- 소요: N분` · `- 요금: N원` ·
//   `## 💰 일별 예산` · `## 🍴 추천 식당` · `호텔→역` 처럼 한글이 박혀 있었다.
//   영어·일본어·중국어 손님이 받는 파일에 한글 라벨이 그대로 나갔다.
//   (#1254 가 `'역'` 폴백 **한 개**만 고쳤다 — 나머지는 그대로였다.)
//
// 판정 방법: **데이터에 한글이 한 글자도 없는 플랜**을 넣는다. 그러면 en/ja/zh 출력에
//   남은 한글은 전부 "코드에 박힌 라벨" 이다 — 데이터 유래와 섞이지 않는다.
//   (ja/zh 는 한자·가나를 쓰므로 CJK 전체가 아니라 **한글 자모/음절 블록**만 본다.)
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { planToMarkdown } from '../../src/pages/PlanDetailPage/lib/planToMarkdown';
import { loadLocale } from '../../src/i18n';

// EN 만 eager 이고 ko/ja/zh 는 dynamic import 로 캐시에 들어온다(`src/i18n/index.ts`).
// 앱에서는 플랜 화면이 이미 그 언어로 렌더돼 있으므로 다운로드 시점엔 항상 로드돼 있다.
// 테스트는 그 상태를 직접 만든다. (예열 안 된 경우는 아래 '콜드 캐시' 테스트가 따로 잠근다.)
beforeAll(async () => {
  await Promise.all([loadLocale('ko'), loadLocale('ja'), loadLocale('zh')]);
});

/** 한글 음절 + 자모. 한자·가나는 포함하지 않는다(ja/zh 정상 출력과 구분). */
const HANGUL = /[가-힣ᄀ-ᇿ㄰-㆏]/;

/** 데이터 값에 한글이 하나도 없는 플랜 — 라벨 누수만 드러난다. */
const PLAN_NO_HANGUL = {
  planId: 'plan-i18n-test',
  input: {
    guestName: 'Alex',
    startDate: '2026-09-01',
    endDate: '2026-09-03',
    regions: ['Seoul', 'Busan'],
    pax: 2,
  },
  itinerary: {
    tour_title: 'Seoul & Busan Highlights',
    arrival_guide: {
      airport: 'ICN T1',
      steps: [
        { step: 1, title: 'Immigration', est_min: 30, description: 'Follow the signs.' },
        { step: 2, title: 'Baggage claim', est_min: 15 },
      ],
      route_to_hotel: { instruction: 'AREX to Seoul Station', est_min: 55, est_fare_krw: 9500 },
    },
    days: [
      {
        day: 1,
        date: '2026-09-01',
        city: 'Seoul',
        theme: 'City walk',
        stops: [
          {
            category: 'attraction',
            display_name: 'Gyeongbokgung',
            start_time: '10:00',
            end_time: '12:00',
            address: '161 Sajik-ro',
            entry_fee_krw: 3000,
            tip: 'Free with hanbok.',
          },
          {
            category: 'food',
            display_name: 'Tosokchon',
            start_time: '12:30',
            end_time: '13:30',
            transit_from_prev: { instruction: 'Walk 8 minutes', est_min: 8, est_fare_krw: 0 },
          },
        ],
      },
      {
        day: 2,
        date: '2026-09-02',
        city: 'Busan',
        intercity_transit: {
          mode: 'KTX',
          from_city_display: 'Seoul',
          to_city_display: 'Busan',
          from_station: 'Seoul Station',
          to_station: 'Busan Station',
          recommended_depart: '09:00',
          arrival_at: '11:45',
          est_min: 165,
          est_fare_krw: 59800,
          booking_url: 'https://www.letskorail.com',
          lodging_to_station: { instruction: 'Subway line 4', est_min: 20 },
          station_to_lodging: { instruction: 'Taxi', est_min: 12 },
        },
        stops: [
          { category: 'nature', display_name: 'Haeundae Beach', start_time: '13:00', end_time: '15:00' },
        ],
      },
    ],
    departure_guide: {
      airport: 'ICN T1',
      route_to_airport: { instruction: 'Limousine bus', est_min: 70, est_fare_krw: 17000 },
    },
    daily_budget_summary: [
      { day: 1, meals_krw: 50000, transport_krw: 12000, entry_fees_krw: 3000, total_krw: 65000 },
    ],
    t_money_recommended_load: 30000,
    recommended_restaurants: {
      general: [{ name: 'Jungsik', cuisine: 'Korean fine dining', rating: 4.7, address: '11 Seolleung-ro' }],
    },
  },
} as unknown as Parameters<typeof planToMarkdown>[0];

/** 한글이 남은 줄만 돌려준다 — 실패 메시지에서 어느 라벨인지 바로 보이게. */
function hangulLines(md: string): string[] {
  return md.split('\n').filter((l) => HANGUL.test(l));
}

describe('planToMarkdown — 라벨이 손님 언어를 따른다', () => {
  for (const lang of ['en', 'ja', 'zh'] as const) {
    it(`🔴 ${lang}: 출력에 한국어 라벨이 한 글자도 없다`, () => {
      const md = planToMarkdown(PLAN_NO_HANGUL, { language: lang });
      expect(md.length, '빈 출력이면 검사 자체가 무의미하다').toBeGreaterThan(200);
      expect(hangulLines(md), `${lang} 출력에 한글 라벨이 남았다`).toEqual([]);
    });
  }

  it('🔴 en: 사전 값이 실제로 쓰인다 (한글만 없애고 영어를 안 넣은 것 아님)', () => {
    const md = planToMarkdown(PLAN_NO_HANGUL, { language: 'en' });
    expect(md).toContain('Airport Arrival Guide');
    expect(md).toContain('To Hotel');
    expect(md).toContain('Route timeline');
    expect(md).toContain('Departure Guide');
    expect(md).toContain('To Airport');
    expect(md).toContain('Daily Budget Summary');
    expect(md).toContain('Recommended T-money load');
    expect(md).toContain('Must-visit restaurants nearby');
    expect(md).toContain('Entry');            // 입장료
    expect(md).toContain('min');              // 분 단위
    expect(md).toContain('Intercity Transit'); // 도시 간 이동
    expect(md).toContain('Station');           // 역
    expect(md).toContain('Stay');              // 호텔/숙소
  });

  it('🔴 ja: 일본어 사전 값이 쓰인다', () => {
    const md = planToMarkdown(PLAN_NO_HANGUL, { language: 'ja' });
    expect(md).toContain('空港到着ガイド');
    expect(md).toContain('出発ガイド');
    expect(md).toContain('日別予算まとめ');
    expect(md).toContain('都市間移動');
  });

  it('🔴 zh: 중국어 사전 값이 쓰인다', () => {
    const md = planToMarkdown(PLAN_NO_HANGUL, { language: 'zh' });
    expect(md).toContain('机场到达指南');
    expect(md).toContain('出发指南');
    expect(md).toContain('每日预算概览');
    expect(md).toContain('城市间移动');
  });

  it('ko: 한국어 손님에게는 그대로 한국어가 나온다 (영어로 갈아엎지 않았다)', () => {
    const md = planToMarkdown(PLAN_NO_HANGUL, { language: 'ko' });
    expect(md).toContain('공항 도착 가이드');
    expect(md).toContain('출발 가이드');
    expect(md).toContain('일별 예산 요약');
    expect(md).toContain('도시 간 이동');
    expect(md).toContain('꼭 가보면 좋은 곳');
  });

  it('언어 미지정이면 plan.input.language 를 따른다', () => {
    const en = planToMarkdown(
      { ...(PLAN_NO_HANGUL as Record<string, unknown>), input: { language: 'en' } } as never,
    );
    expect(hangulLines(en), 'input.language=en 인데 한글이 나왔다').toEqual([]);
  });

  it('🔴 예산표 일차 칸에 자리표시자가 새지 않는다 (zh 는 `第{n}天` 템플릿이다)', () => {
    // `ui.budgetDay` 는 en/ko/ja 가 낱말(`Day`·`일차`·`日目`)인데 zh 만 템플릿이다.
    // 그대로 열 이름에 쓰면 중국어 손님이 `第{n}天` 을 본다 — 실제 출력 눈검사로 잡은 결함.
    for (const lang of ['en', 'ko', 'ja', 'zh'] as const) {
      const md = planToMarkdown(PLAN_NO_HANGUL, { language: lang });
      expect(md, `${lang}: 자리표시자 노출`).not.toContain('{n}');
      expect(md, `${lang}: 자리표시자 노출`).not.toMatch(/\{\{\w+\}\}/);
    }
    expect(planToMarkdown(PLAN_NO_HANGUL, { language: 'zh' })).toContain('第1天');
    expect(planToMarkdown(PLAN_NO_HANGUL, { language: 'en' })).toContain('| Day 1 |');
  });

  it('🔴 예산표 일차 칸 어순이 언어마다 자연스럽다 (ko/ja 는 번호가 앞에 온다)', () => {
    // `일차 1`/`日目 1` 은 낱말 뒤에 번호를 붙인 어순 오류 — 자연스러운 표현은
    // `1일차`/`1日目` 처럼 번호가 앞에 온다. en/zh 는 원래도 맞는 어순이었다.
    expect(planToMarkdown(PLAN_NO_HANGUL, { language: 'en' })).toContain('| Day 1 |');
    expect(planToMarkdown(PLAN_NO_HANGUL, { language: 'ko' })).toContain('| 1일차 |');
    expect(planToMarkdown(PLAN_NO_HANGUL, { language: 'ja' })).toContain('| 1日目 |');
    expect(planToMarkdown(PLAN_NO_HANGUL, { language: 'zh' })).toContain('| 第1天 |');
  });

  it('🔴 사전이 아직 안 실린 순간의 폴백은 **영어**다 (한국어 아님)', async () => {
    // 예전 구현의 폴백은 라벨 자체가 한국어 하드코딩이었다 — 사전이 비면 전 언어 손님이
    // 한글을 받았다. 지금은 사전이 비어도 영어로 떨어져야 한다.
    vi.resetModules();
    const { planToMarkdown: cold } = await import('../../src/pages/PlanDetailPage/lib/planToMarkdown');
    const md = cold(PLAN_NO_HANGUL, { language: 'ja' });   // ja 사전 미로드 상태

    expect(hangulLines(md), '사전이 비었을 때 한글로 떨어지면 안 된다').toEqual([]);
    expect(md, '영어로 떨어져야 한다').toContain('Airport Arrival Guide');
  });

  it('데이터에 한글이 있으면 그대로 보존한다 (지명·안내문은 번역 대상이 아니다)', () => {
    const md = planToMarkdown(
      {
        input: { language: 'en' },
        itinerary: {
          tour_title: 'Trip',
          days: [{
            day: 1,
            stops: [{ category: 'food', display_name: '광장시장', address: '88 Changgyeonggung-ro' }],
          }],
        },
      } as never,
      { language: 'en' },
    );
    expect(md, '데이터 값은 손대지 않는다').toContain('광장시장');
  });
});
