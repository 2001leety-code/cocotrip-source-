/**
 * Public-facing promise truthfulness guard (fix/public-promise-truthfulness, 2026-08-11).
 *
 * Several screens claimed things CocoTrip does not actually do:
 *  - "24/7" support (real hours: weekdays 10:00-18:00, per footer.hours SSOT / CS phone).
 *  - "No Hidden Fees" (real: tolls/parking are included, but meals and admission are
 *    NOT — see GLOBAL_INCLUDED/GLOBAL_EXCLUDED in src/data/tours.ts).
 *  - Loyalty tier "benefits" (season coupons, priority vehicle, VIP KakaoTalk, airport
 *    lounge) that no server code ever grants — only the Trip Coins earn rate in
 *    api/_shared/loyalty-policy.js is real.
 *  - A static "Popular"/"Best Value" ribbon on tour cards with no aggregation behind it.
 *  - An empty community feed claiming "travelers and locals are here to help" when
 *    there are, by definition, zero posts yet.
 *
 * Source-level regression tests (no Firebase, no render) so these do not silently
 * come back — mirrors the pattern in tests/unit/no-fake-tour-ratings.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { LOYALTY_TIERS } from '../../api/_shared/loyalty-policy.js';

const root = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

describe('AuthRequired — 로그인 벽 지원 시간 claim', () => {
  const src = read('src/components/AuthRequired.tsx');

  it('24/7 또는 24시간 지원을 주장하지 않는다', () => {
    expect(src).not.toMatch(/24\/7/);
    expect(src).not.toMatch(/24시간/);
    expect(src).not.toMatch(/24時間/);
    expect(src).not.toMatch(/24小时/);
  });

  it('실제 평일 지원 시간을 4개 언어 모두 안내한다', () => {
    expect(src).toMatch(/평일 10~18시/);
    expect(src).toMatch(/Weekday support, 10am–6pm/);
    expect(src).toMatch(/平日10時~18時/);
    expect(src).toMatch(/工作日10-18点/);
  });
});

describe('TrustBadges — 홈 신뢰 배지', () => {
  const src = read('src/components/TrustBadges.tsx');

  it('24/7 지원과 "숨은 비용 없음" 류 무근거 문구가 없다', () => {
    expect(src).not.toMatch(/24\/7/);
    expect(src).not.toMatch(/24시간/);
    expect(src).not.toMatch(/24時間/);
    expect(src).not.toMatch(/24小时/);
    expect(src).not.toMatch(/No hidden fees/i);
    expect(src).not.toMatch(/숨은 비용 없음/);
    expect(src).not.toMatch(/隠れた費用なし/);
    expect(src).not.toMatch(/无隐藏费用/);
  });

  it('실제 포함 항목(톨비·주차비)만 주장한다', () => {
    expect(src).toMatch(/Tolls & parking incl\./);
    expect(src).toMatch(/톨비·주차비 포함/);
  });
});

describe('ToursPage — 투어 목록 신뢰 배지', () => {
  const src = read('src/pages/ToursPage.tsx');

  it('"No Hidden Fees"/"24/7" 라벨이 없다', () => {
    expect(src).not.toMatch(/No Hidden Fees/);
    expect(src).not.toMatch(/'24\/7'/);
  });

  it('포함/제외를 실제 SSOT(GLOBAL_INCLUDED/EXCLUDED)와 맞춰 안내한다', () => {
    expect(src).toMatch(/톨비·주차비 포함/);
    expect(src).toMatch(/식사·입장료 별도/);
    expect(src).toMatch(/Meals & Admission Extra/);
  });

  it('영어 지원 배지가 실제 평일 시간으로 표기된다', () => {
    expect(src).toMatch(/평일 10~18시/);
    expect(src).toMatch(/Weekdays 10am–6pm/);
  });
});

describe('MyPage — 등급 혜택은 적립률만 표시', () => {
  const src = read('src/pages/MyPage.tsx');
  // 정확한 삭제 대상 문구만 검사 — '쿠폰'/'coupon' 자체는 실제 쿠폰함 기능(coupons 탭)에
  // 정당하게 쓰이므로 광범위 매칭하지 않는다. 등급 "혜택"으로 표기됐던 근거 없는 항목만 검사.
  const forbidden = [
    /Welcome 5% coupon/i, /season coupon/i, /Priority support/i, /Priority vehicle/i,
    /VIP KakaoTalk/i, /Airport lounge/i,
    '가입 축하 5% 쿠폰', '시즌 $', '우선 응대', '차량 우선 배정', 'VIP 카카오톡', '공항 라운지',
  ];

  it('시즌 쿠폰·우선 응대·차량·VIP 카카오톡·공항 라운지 등 서버가 지급하지 않는 혜택 문구가 없다', () => {
    for (const pattern of forbidden) {
      expect(src).not.toMatch(pattern);
    }
  });

  it('등급 혜택 렌더는 locale JSON 의 tierBenefitList 를 더 이상 신뢰하지 않는다', () => {
    // 회귀 원인: mp.tierBenefitList (locale JSON) 이 근거 없는 혜택을 다시 주입할 수 있었다.
    expect(src).not.toMatch(/dict\.tierBenefitList/);
    expect(src).not.toMatch(/tierBenefits\(mp/);
  });

  it('TIER_EARN_PCT 가 api/_shared/loyalty-policy.js 의 실제 적립률과 일치한다', () => {
    const byName = Object.fromEntries(LOYALTY_TIERS.map((t) => [t.name, t.earnRate]));
    const pctMatch = src.match(/TIER_EARN_PCT[^]*?=\s*{([^}]*)}/);
    expect(pctMatch, 'TIER_EARN_PCT literal not found in MyPage.tsx').toBeTruthy();
    const body = pctMatch![1];
    const extracted: Record<string, number> = {};
    for (const m of body.matchAll(/(\w+):\s*'([\d.]+)%'/g)) {
      extracted[m[1]] = Number(m[2]) / 100;
    }
    expect(extracted).toEqual({
      Bronze: byName.Bronze,
      Silver: byName.Silver,
      Gold: byName.Gold,
      Platinum: byName.Platinum,
    });
  });
});

describe('TourCard — 정적 Popular/Best Value 배지 제거', () => {
  const src = read('src/components/tours/TourCard.tsx');

  it('Popular/Best Value 는 카드 배지 후보에서 제외된다', () => {
    expect(src).toMatch(/UNGROUNDED_BADGE_TAGS\s*=\s*new Set\(\['Popular', 'Best Value'\]\)/);
    expect(src).toMatch(/tour\.tags\.find\(\(tag\) => !UNGROUNDED_BADGE_TAGS\.has\(tag\)\)/);
  });

  it('primaryTag 가 없을 때 배지를 렌더하지 않는다(조건부 렌더)', () => {
    expect(src).toMatch(/\{primaryTag && tagStyle && \(/);
  });
});

describe('CommunityPage — 빈 피드에 무근거 참여 claim 없음', () => {
  const src = read('src/pages/CommunityPage.tsx');

  it('0건 상태에서 "여행자와 현지인이 도와준다" 류 문구가 없다', () => {
    expect(src).not.toMatch(/travelers and locals are here to help/);
    expect(src).not.toMatch(/여행자와 현지인이 함께 답해드립니다/);
    expect(src).not.toMatch(/旅行者と現地の人が答えます/);
    expect(src).not.toMatch(/旅行者和当地人都会来帮你/);
  });
});

describe('MyPage — AI Planner 폴백 표기', () => {
  it('nav 폴백이 실제 locale 값과 같은 "Trip Planner" 를 쓴다 ("AI Planner" 아님)', () => {
    const src = read('src/pages/MyPage.tsx');
    expect(src).not.toMatch(/\?\?\s*'AI Planner'/);
    expect(src).toMatch(/t\.nav\.planner \|\| 'Trip Planner'/);
  });
});

/**
 * Follow-up pass (PR #1276, 2026-08-11 — after PR #1275 merge): the truthfulness sweep
 * above deliberately skipped locale JSON (footer.support24h, mypage.tierBenefitList) and
 * anything PR #1275 was about to rewrite (MobileHome, GoogleReviews, CharterPage, Header,
 * BookingInfoForm, HeroCards, RegionDetail, MapPage, FeatureOverview, MobileHomeV2).
 * With #1275 merged, this section closes those out.
 */
const LOCALE_LANGS = ['ko', 'en', 'ja', 'zh'] as const;
const locale = (lang: string) => JSON.parse(read(`src/i18n/locales/${lang}.json`));

const NO_24H_PATTERNS = [/24\/7/, /24시간/, /24時間/, /24小时/, /round-the-clock/i];

describe('Header — 지원 배지', () => {
  const src = read('src/sections/Header.tsx');

  it('"24/7" 을 하드코딩하지 않는다', () => {
    expect(src).not.toMatch(/>24\/7</);
  });

  it('실제 평일 지원 시간을 4개 언어로 안내한다', () => {
    expect(src).toMatch(/평일 10~18시/);
    expect(src).toMatch(/Weekdays 10am–6pm/);
    expect(src).toMatch(/平日10~18時/);
    expect(src).toMatch(/工作日10-18点/);
  });
});

describe('MobileHome — 홈 서비스 버튼 · 신뢰 배지 · 배너', () => {
  const src = read('src/sections/MobileHome.tsx');

  it('svcPlanner/trustSupport/heroProofSupport/aiBannerTitle 폴백에 24/7·AI 브랜딩이 없다', () => {
    expect(src).not.toMatch(/'AI Planner'/);
    expect(src).not.toMatch(/'24\/7\\nSupport'/);
    expect(src).not.toMatch(/'24\/7 English'/);
    expect(src).not.toMatch(/'AI Itinerary Generator'/);
  });

  it('heroSubtitle 폴백이 24\\/7 지원을 주장하지 않는다', () => {
    expect(src).not.toMatch(/24\/7 English support included/);
  });

  for (const lang of LOCALE_LANGS) {
    it(`${lang}.json mobileHome 키에 24시간류 지원 claim 이 없다`, () => {
      const mh = locale(lang).mobileHome;
      for (const pattern of NO_24H_PATTERNS) {
        expect(mh.trustSupport).not.toMatch(pattern);
        expect(mh.heroSubtitle).not.toMatch(pattern);
        expect(mh.heroProofSupport).not.toMatch(pattern);
      }
    });

    it(`${lang}.json mobileHome.svcPlanner/aiBannerTitle 에 AI 접두가 없다`, () => {
      const mh = locale(lang).mobileHome;
      expect(mh.svcPlanner).not.toMatch(/^AI/);
      expect(mh.aiBannerTitle).not.toMatch(/^AI/);
    });
  }
});

describe('GoogleReviews — 신뢰 신호', () => {
  const src = read('src/sections/GoogleReviews.tsx');

  it('trustSupport 폴백이 24/7 을 주장하지 않는다', () => {
    expect(src).not.toMatch(/'24\/7 English support'/);
  });

  for (const lang of LOCALE_LANGS) {
    it(`${lang}.json googleReviews.trustSupport 에 24시간류 claim 이 없다`, () => {
      const value = locale(lang).googleReviews.trustSupport;
      for (const pattern of NO_24H_PATTERNS) expect(value).not.toMatch(pattern);
    });
  }
});

describe('CharterPage — 포함사항 배지', () => {
  const src = read('src/pages/CharterPage.tsx');

  it('included2 폴백이 언어와 무관하게 고정 한국어가 아니고, 24시간 claim 도 없다', () => {
    expect(src).not.toMatch(/included2 \?\? '영어 소통 가능 기사 · 24시간 지원'/);
  });

  for (const lang of LOCALE_LANGS) {
    it(`${lang}.json charterPage.included2 에 24시간류 claim 이 없다`, () => {
      const value = locale(lang).charterPage.included2;
      for (const pattern of NO_24H_PATTERNS) expect(value).not.toMatch(pattern);
    });
  }
});

describe('BookingInfoForm — 신뢰 배지 (차터/투어 공용 예약폼)', () => {
  const src = read('src/components/booking/BookingInfoForm.tsx');

  it('trust3 가 24시간/24-7 지원을 주장하지 않는다 (4개 언어) — freeCancel24h 등 취소 기한 표기는 별개라 제외', () => {
    const trust3Lines = src.match(/trust3:\s*'[^']*'/g) || [];
    expect(trust3Lines.length).toBeGreaterThanOrEqual(4);
    for (const line of trust3Lines) {
      for (const pattern of NO_24H_PATTERNS) expect(line).not.toMatch(pattern);
    }
  });

  it('trust1Sub 가 "추가요금 없음" 류 blanket claim 을 하지 않는다 (같은 폼이 초과시간·심야할증을 명시)', () => {
    expect(src).not.toMatch(/별도 추가요금 없음/);
    expect(src).not.toMatch(/no extra charges/i);
    expect(src).not.toMatch(/追加料金なし/);
    expect(src).not.toMatch(/无额外费用/);
  });
});

describe('MyPage — 등급 혜택 locale JSON (dead key 이지만 재발 방지용 정합)', () => {
  const forbidden = [
    /season coupon/i, /Priority support/i, /Priority vehicle/i, /VIP KakaoTalk/i, /Airport lounge/i,
    '시즌 $', '우선 응대', '차량 우선 배정', 'VIP 카카오톡', '공항 라운지',
    'シーズン$', '優先サポート', '車両の優先手配', 'VIP カカオトーク', '空港ラウンジ',
    '季度 $', '优先客服', '优先安排车辆', 'VIP KakaoTalk 客服', '机场贵宾室',
  ];

  for (const lang of LOCALE_LANGS) {
    it(`${lang}.json mypage.tierBenefitList 에 서버가 지급하지 않는 혜택 문구가 없다`, () => {
      const list = JSON.stringify(locale(lang).mypage.tierBenefitList);
      for (const pattern of forbidden) expect(list).not.toMatch(pattern);
    });
  }
});

describe('AI 중심 제품명 정리 — 홈/지역/지도/기능 총람 (플래너 자체 화면 제외)', () => {
  it('HeroCards.tsx plannerTitle 폴백에 "AI" 접두가 없다', () => {
    const src = read('src/sections/HeroCards.tsx');
    expect(src).not.toMatch(/plannerTitle \|\| 'AI /);
  });

  it('RegionDetail.tsx aiPlannerCta 폴백에 "AI Planner" 가 없다', () => {
    const src = read('src/pages/RegionDetail.tsx');
    expect(src).not.toMatch(/aiPlannerCta \|\| 'AI Planner'/);
  });

  it('MapPage.tsx 의 startPlanner 로컬 사전에 AI 접두가 없다 (4개 언어)', () => {
    const src = read('src/pages/MapPage.tsx');
    expect(src).not.toMatch(/startPlanner: 'Start AI Planner'/);
    expect(src).not.toMatch(/startPlanner: 'AI 플래너 시작'/);
    expect(src).not.toMatch(/startPlanner: 'AIプランナーを開始'/);
    expect(src).not.toMatch(/startPlanner: '开始AI规划'/);
  });

  it('FeatureOverview.tsx 6기능 총람의 플래너 항목에 "AI" 접두가 없다 (4개 언어)', () => {
    const src = read('src/sections/FeatureOverview.tsx');
    expect(src).not.toMatch(/\['AI Planner',/);
    expect(src).not.toMatch(/\['AI 플래너',/);
    expect(src).not.toMatch(/\['AIプランナー',/);
    expect(src).not.toMatch(/\['AI行程规划',/);
  });

  for (const lang of LOCALE_LANGS) {
    it(`${lang}.json heroCards.plannerTitle/regionDetail.aiPlannerCta 에 "AI" 접두가 없다`, () => {
      const j = locale(lang);
      expect(j.heroCards.plannerTitle).not.toMatch(/^AI/);
      expect(j.regionDetail.aiPlannerCta).not.toMatch(/^AI/);
    });

    it(`${lang}.json mobileHomeV2.catPlanner/aiCardTitle 에 "AI" 접두가 없다`, () => {
      const j = locale(lang);
      expect(j.mobileHomeV2.catPlanner).not.toMatch(/^AI/);
      expect(j.mobileHomeV2.aiCardTitle).not.toMatch(/^AI/);
    });
  }
});
