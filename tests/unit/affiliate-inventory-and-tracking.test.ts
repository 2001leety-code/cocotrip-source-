/**
 * 제휴 링크 인벤토리·추적 회귀 잠금 (2026-07-30, 판촉 P0).
 *
 * 잠그는 불변식
 *   1. 출발지=도착지 항공 링크 0 (운영에 `dcity=Seoul&acity=Seoul` 이 실제로 나가 있었다)
 *   2. 출발지를 언어로 추정하지 않는다
 *   3. 제휴 링크를 만드는 파일이 두 벌로 갈리지 않는다
 *   4. 추적 없는 제휴 `<a>` 0 — 링크가 있으면 클릭 측정이 붙어 있다
 *   5. 클릭 이벤트에 URL·uid·planId·이메일을 담지 않는다
 *   6. 노출은 카드별로 기록한다(컨테이너 일괄 금지)
 *   7. 제휴 ID 하드코딩을 새 노출로 확대하지 않는다(fail-closed)
 *   8. 분석 도구는 쿠키 동의 후에만 시작한다
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

/** 제휴 링크를 실제로 노출하는 파일 전수. 새 자리가 생기면 여기 추가해야 한다. */
const AFFILIATE_SURFACES = [
  'src/sections/HeroCards.tsx',
  'src/pages/TourDetailPage.tsx',
  'src/pages/ToursPage.tsx',
  'src/components/WizardForm/ZoneRecommender.tsx',
  'src/components/home/TripEssentialsCards.tsx',
  'src/pages/PlanDetailPage/components/StopCard.tsx',
  'src/pages/PlanDetailPage/components/ads/EsimAd.tsx',
  'src/pages/PlanDetailPage/components/ads/HotelAd.tsx',
  'src/pages/PlanDetailPage/components/ads/FlightAd.tsx',
  'src/pages/PlanDetailPage/components/ads/TrainsAd.tsx',
  'src/pages/PlanDetailPage/components/ads/CarRentalAd.tsx',
  'src/pages/PlanDetailPage/components/AccommodationRecommendation.tsx',
];

describe('① 항공 링크: 출발지=도착지 0', () => {
  const src = read('src/config/affiliateLinks.ts');

  it('🔴 dcity 와 acity 가 같은 링크는 만들 수 없다', () => {
    // 같은 값이면 dcity 를 아예 빼는 분기가 있어야 한다.
    expect(src).toContain('origin.toLowerCase() !== dest.toLowerCase()');
    // 출발지를 모를 때 목적지만 넣는 경로가 있어야 한다.
    expect(src).toMatch(/acity=\$\{encodeURIComponent\(dest\)\}`/);
  });

  it('🔴 출발지를 언어로 추정하는 표(DEFAULT_DCITY)가 사라졌다', () => {
    expect(src).not.toContain('DEFAULT_DCITY');
    // language 를 두 번째 인자로 받던 시절의 시그니처도 없어야 한다.
    expect(src).not.toMatch(/buildFlightLink\([^)]*language/);
  });

  it('호출부가 출발지를 넘기지 않는다 (모르는 값을 만들어내지 않는다)', () => {
    for (const f of ['src/sections/HeroCards.tsx', 'src/pages/PlanDetailPage/components/ads/FlightAd.tsx']) {
      const s = read(f);
      const calls = s.match(/buildFlightLink\([^)]*\)/g) || [];
      expect(calls.length, f).toBeGreaterThan(0);
      for (const c of calls) {
        // 인자가 하나(도착 공항)뿐이어야 한다.
        expect(c.split(',').length, `${f}: ${c}`).toBe(1);
      }
    }
  });
});

describe('② 제휴 파라미터 조립은 한 곳', () => {
  it('🔴 affiliateLinks.ts 외에는 Allianceid 를 조립하지 않는다', () => {
    const offenders: string[] = [];
    for (const f of [...AFFILIATE_SURFACES, 'src/data/hotels.ts']) {
      if (!existsSync(resolve(process.cwd(), f))) continue;
      const s = read(f);
      if (/Allianceid=\$\{/.test(s) || /SID=\$\{/.test(s)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });

  it('data/hotels.ts 가 SSOT 를 가져다 쓴다', () => {
    const s = read('src/data/hotels.ts');
    expect(s).toContain('tripAffiliateQuery');
    expect(s).not.toContain('VITE_TRIPCOM_AFFILIATE_ID');   // 자체 env 읽기 금지
  });
});

describe('③ 추적 없는 제휴 링크 0', () => {
  it('🔴 제휴 노출 파일 전부가 클릭 측정을 부른다', () => {
    const missing: string[] = [];
    for (const f of AFFILIATE_SURFACES) {
      if (!existsSync(resolve(process.cwd(), f))) continue;
      const s = read(f);
      const hasAffiliateLink = /build(Accommodation|Flight|Esim|Train|Car|Attraction|HotelList|ZoneHotel)/.test(s)
        || /affiliateUrl/.test(s);
      if (!hasAffiliateLink) continue;
      const tracked = /trackAffiliateClick|AffiliateCard/.test(s);
      if (!tracked) missing.push(f);
    }
    expect(missing).toEqual([]);
  });

  it('🔴 죽은 측정 함수를 남겨두지 않는다', () => {
    const analytics = read('src/lib/analytics.ts');
    // trackEsimClick 은 정의만 있고 호출처가 0건이었다 → 정의를 없앴는지 확인.
    expect(analytics).not.toContain('export function trackEsimClick');
  });
});

describe('④ 익명 측정 규격', () => {
  const src = read('src/lib/affiliateTracking.ts');

  it('🔴 다섯 필드만 내보낸다', () => {
    // toProps 가 만드는 키 집합
    expect(src).toMatch(/product:\s*p\.product/);
    expect(src).toMatch(/placement:\s*p\.placement/);
    expect(src).toMatch(/language:\s*p\.language/);
    expect(src).toContain('out.city = p.city');
    expect(src).toContain('out.link_key = p.linkKey');
  });

  it('🔴 전송되는 속성에 URL·uid·planId·이메일이 없다 (실제 호출로 확인)', async () => {
    // 주석에 단어가 있는지가 아니라 **밖으로 나가는 값**을 본다.
    const ga: Array<[string, Record<string, unknown> | undefined]> = [];
    const ph: Array<[string, Record<string, unknown> | undefined]> = [];
    vi.doMock('../../src/lib/analytics', () => ({
      trackEvent: (n: string, p2?: Record<string, unknown>) => { ga.push([n, p2]); },
    }));
    vi.doMock('../../src/lib/posthog', () => ({
      track: async (n: string, p2?: Record<string, unknown>) => { ph.push([n, p2]); },
    }));
    vi.resetModules();
    const mod = await import('../../src/lib/affiliateTracking');

    mod.trackAffiliateClick({
      product: 'hotel', placement: 'tour_detail_hotels',
      language: 'ko', city: 'seoul', linkKey: 'lotte',
    });

    expect(ga).toHaveLength(1);
    expect(ph).toHaveLength(1);
    const [name, props] = ga[0];
    expect(name).toBe('affiliate_click');
    expect(Object.keys(props || {}).sort())
      .toEqual(['city', 'language', 'link_key', 'placement', 'product']);
    expect(ph[0][1]).toEqual(props);
    vi.doUnmock('../../src/lib/analytics');
    vi.doUnmock('../../src/lib/posthog');
  });

  it('선택 값이 없으면 빈 문자열을 보내지 않는다', async () => {
    const ga: Array<[string, Record<string, unknown> | undefined]> = [];
    vi.doMock('../../src/lib/analytics', () => ({
      trackEvent: (n: string, p2?: Record<string, unknown>) => { ga.push([n, p2]); },
    }));
    vi.doMock('../../src/lib/posthog', () => ({ track: async () => {} }));
    vi.resetModules();
    const mod = await import('../../src/lib/affiliateTracking');
    mod.trackAffiliateClick({ product: 'flight', placement: 'home_hero_cards', language: 'en' });
    expect(Object.keys(ga[0][1] || {}).sort()).toEqual(['language', 'placement', 'product']);
    vi.doUnmock('../../src/lib/analytics');
    vi.doUnmock('../../src/lib/posthog');
  });

  it('🔴 GA4 와 PostHog 양쪽에 보낸다', () => {
    expect(src).toContain("trackEvent('affiliate_click'");
    expect(src).toContain("posthogTrack('affiliate_click'");
    expect(src).toContain("trackEvent('affiliate_impression'");
    expect(src).toContain("posthogTrack('affiliate_impression'");
    // PostHog 이벤트 이름이 화이트리스트에 있어야 실제로 나간다.
    const ph = read('src/lib/posthog.ts');
    expect(ph).toContain("'affiliate_click'");
    expect(ph).toContain("'affiliate_impression'");
  });

  it('세션 중복 방지가 있다', () => {
    expect(src).toContain('sessionStorage');
    expect(src).toContain('aff_seen:');
  });

  it('🔴 IntersectionObserver 가 없으면 노출을 기록하지 않는다', () => {
    // "일단 기록" 하면 보이지 않은 카드가 봤다고 남는다.
    expect(src).toMatch(/typeof IntersectionObserver === 'undefined'\) return \(\) => \{\}/);
  });
});

describe('⑤ 보이지 않은 카드의 허위 노출 0', () => {
  it('🔴 PreTripSlide 가 컨테이너 하나로 제휴 6종을 찍지 않는다', () => {
    const s = read('src/pages/PlanDetailPage/components/PreTripSlide.tsx');
    for (const banned of ["trackAdImpression('esim'", "trackAdImpression('hotel'",
      "trackAdImpression('flight'", "trackAdImpression('train'"]) {
      expect(s, banned).not.toContain(banned);
    }
  });

  it('제휴 카드가 각자 관찰한다', () => {
    for (const f of ['EsimAd', 'HotelAd', 'FlightAd', 'TrainsAd', 'CarRentalAd']) {
      const s = read(`src/pages/PlanDetailPage/components/ads/${f}.tsx`);
      // 카드 꺼데기가 AffiliateCard 여야 그 카드가 보일 때만 노출이 기록된다.
      expect(s, f).toContain('<AffiliateCard payload=');
      expect(s, f).toContain('</AffiliateCard>');
    }
  });

  it('🔴 ref 를 렌더 중에 읽지 않는다', () => {
    // 훅이 ref 객체를 밖으로 넘기면 호출부가 `aff.ref` 를 렌더 중에 읽게 된다.
    // ref 는 AffiliateCard 안에만 있고 밖으로 나가지 않는다.
    const lib = read('src/lib/affiliateTracking.ts');
    expect(lib).not.toContain('useAffiliateCard');
    const card = read('src/components/AffiliateCard.tsx');
    expect(card).toContain('useRef<HTMLDivElement | null>(null)');
    expect(card).toContain('ref={ref}');
  });
});

describe('⑥ 제휴 ID 하드코딩을 새 노출로 확대하지 않는다', () => {
  it('🔴 모바일 홈 신규 카드는 플래그 + 설정 둘 다 있어야 켜진다', () => {
    const s = read('src/components/home/TripEssentialsCards.tsx');
    expect(s).toContain('VITE_FEATURE_HOME_AFFILIATE');
    expect(s).toContain('isAffiliateConfigured()');
    // 컴포넌트 안에서도 한 번 더 막는다.
    expect(s).toContain('if (!shouldShowHomeAffiliate()) return null;');
  });

  it('🔴 설정 판정이 값 형식까지 본다', () => {
    const s = read('src/config/affiliateLinks.ts');
    expect(s).toContain('export function isAffiliateConfigured');
    expect(s).toMatch(/\/\^\\d\{4,\}\$\//);   // 숫자 4자리 이상
  });

  it('호출부도 렌더 전에 걸러 준다', () => {
    const s = read('src/pages/MobileHomeV2.tsx');
    expect(s).toContain('shouldShowHomeAffiliate()');
  });
});

describe('⑦ 쿠키 동의 전에는 분석 도구를 켜지 않는다', () => {
  it('🔴 main.tsx 가 무조건 initGA/bootPostHog 를 부르지 않는다', () => {
    const s = read('src/main.tsx');
    expect(s).toContain('hasAnalyticsConsent()');
    // 게이트 밖에서 직접 호출하는 줄이 없어야 한다.
    expect(s).not.toMatch(/^initGA\(\);/m);
    expect(s).not.toMatch(/^bootPostHog\(\);/m);
  });

  it('🔴 PostHog 는 lazy-init 경로까지 막힌다', () => {
    // 부팅 경로(bootPostHog)만 막았더니 운영에서 여전히 posthog.com 요청이 나갔다.
    // track() 이 한 번이라도 불리면 ensureInit 이 SDK 를 켜버렸기 때문이다.
    // SDK 가 켜지는 문은 ensureInit 하나뿐이므로 거기서 막는다.
    const ph = read('src/lib/posthog.ts');
    expect(ph).toContain("import { hasAnalyticsConsent } from './consent';");
    const init = ph.slice(ph.indexOf('async function ensureInit'), ph.indexOf('initPromise = ('));
    expect(init).toContain('if (!hasAnalyticsConsent()) return null;');
  });

  it('GA4 는 initGA 없이 요청이 나가지 않는다', () => {
    const ga = read('src/lib/analytics.ts');
    // gtag.js 삽입은 initGA 한 곳에서만.
    expect((ga.match(/googletagmanager/g) || []).length).toBe(1);
    // 전송 함수는 window.gtag 가 없으면 즉시 반환.
    expect(ga).toContain('if (!GA_ID || !window.gtag) return;');
  });

  it('🔴 "닫기" 는 거부로 본다', () => {
    const consent = read('src/lib/consent.ts');
    expect(consent).toContain("v === 'accepted'");
    expect(consent).toMatch(/readConsent\(\) === 'accepted'/);
    const banner = read('src/components/CookieBanner.tsx');
    expect(banner).toContain("setConsent('dismissed')");
    // 배너가 localStorage 를 직접 쓰지 않는다(두 곳이 어긋나는 원인).
    expect(banner).not.toContain('localStorage.setItem');
  });
});

describe('⑧ 한국어 화면의 대상 영어·{price} 0', () => {
  it('🔴 예약 상품 라벨이 {price} 를 그대로 노출하지 않는다', () => {
    const s = read('src/components/MyBookingsTab.tsx');
    expect(s).toContain('fillPrice(labels[norm]');
  });

  it('🔴 포인트 내역 빈 상태가 i18n 을 쓴다', () => {
    const s = read('src/pages/MyPage.tsx');
    expect(s).not.toContain('>No point activity yet.<');
    expect(s).toContain('mp.pointEmpty');
  });

  it('🔴 서버가 영어로 저장한 보정 원장을 화면에서 번역한다', () => {
    const s = read('src/pages/MyPage.tsx');
    expect(s).toContain('describePointLog(log.description, language)');
    const t = read('src/lib/pointLogText.ts');
    expect(t).toContain('Ledger correction: removed AI-plan estimates');
    // 저장값은 바꾸지 않는다 — 모르는 문장은 원문 반환.
    expect(t).toContain('return raw;');
  });

  it('누적 예약 수와 목록 개수를 구분해 설명한다', () => {
    expect(read('src/pages/MyPage.tsx')).toContain('mp.statBookingsNote');
    expect(read('src/components/MyBookingsTab.tsx')).toContain('mbCountNote');
  });
});

describe('⑨ 프로모션 CTA 목적지가 문구와 맞는다', () => {
  it('🔴 무료 AI 일정을 앞세운 문구가 /planner 로 간다', () => {
    const front = read('src/components/PromoBanner.tsx');
    const server = read('api/_shared/promo-config.js');
    expect(front).toContain("const CTA_HREF = '/planner';");
    expect(server).toContain("ctaHref: '/planner',");
    // 프론트만 고치고 서버 DEFAULT 를 빼먹는 사고가 과거에 있었다 → 둘 다 확인.
    expect(front).toContain('Start free plan');
    expect(server).toContain('Start free plan');
  });

  it('플래너 입력 화면이 무료·쿠폰·유료를 나눠 적는다', () => {
    const s = read('src/pages/PlannerPage/components/AiPlannerPricingNote.tsx');
    for (const k of ['free', 'coupon', 'paid']) expect(s).toContain(`${k}:`);
    // 가격 문자열을 여기서 만들지 않는다 — 주석 설명은 제외하고 **코드**만 본다.
    expect(s).toContain('formatAiPlannerUsd');
    const code = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
    expect(code).not.toMatch(/\$9\.90/);
  });
});
