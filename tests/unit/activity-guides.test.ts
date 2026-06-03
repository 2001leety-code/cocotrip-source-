/**
 * 활동 가이드 회귀 가드 (2026-06-03). 운영자 아이디어: plan 의 무료 활동(따릉이/러닝/트레킹)에
 * 6살용 how-to 탭. 가드: 활동 감지(activity_meta + 따릉이 키워드) + 콘텐츠 4개국어 완전성.
 */
import { describe, it, expect } from 'vitest';
import { detectActivities, hasActivityGuide, ACTIVITY_GUIDES, buildMapLink, buildActivityGuideHtml } from '../../src/lib/activityGuides';

const LANGS = ['ko', 'en', 'ja', 'zh'] as const;
const day = (over: Record<string, unknown> = {}) => ({ day: 1, theme: '', stops: [], ...over });

describe('detectActivities — 활동 감지', () => {
  it('trekking (activity_meta) → kind=trekking', () => {
    const r = detectActivities({ itinerary: { days: [day({ day: 2, activity_meta: { activity_type: 'trekking' }, theme: '북한산' })] } });
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe('trekking');
    expect(r[0].dayNumber).toBe(2);
  });

  it('running_route → kind=running', () => {
    const r = detectActivities({ itinerary: { days: [day({ activity_meta: { activity_type: 'running_route' } })] } });
    expect(r[0]?.kind).toBe('running');
  });

  it('따릉이 (theme/stop 키워드, city_day 라 activity_meta 없음) → kind=bike', () => {
    const r = detectActivities({ itinerary: { days: [day({ theme: '한강 자전거 + 여의도 (따릉이 라이딩)', stops: [{ display_name: '따릉이 여의도 대여', lat: 37.5, lng: 126.9 }] })] } });
    expect(r[0]?.kind).toBe('bike');
    expect(r[0]?.startName).toContain('따릉이');
  });

  it('일반 day → 감지 0', () => {
    const r = detectActivities({ itinerary: { days: [day({ theme: '경복궁 + 인사동', stops: [{ display_name: '경복궁' }] })] } });
    expect(r).toEqual([]);
  });

  it('null day / 빈 plan → graceful []', () => {
    expect(detectActivities(null)).toEqual([]);
    expect(detectActivities({ itinerary: { days: [null] } })).toEqual([]);
    expect(detectActivities({})).toEqual([]);
  });

  it('hasActivityGuide', () => {
    expect(hasActivityGuide({ itinerary: { days: [day({ activity_meta: { activity_type: 'trekking' } })] } })).toBe(true);
    expect(hasActivityGuide({ itinerary: { days: [day()] } })).toBe(false);
  });

  it('buildMapLink — 네이버 지도 검색 링크 + 인코딩', () => {
    expect(buildMapLink('따릉이 여의도')).toBe('https://map.naver.com/p/search/' + encodeURIComponent('따릉이 여의도'));
    expect(buildMapLink('')).toBe('https://map.naver.com/p/search/' + encodeURIComponent('한강')); // 빈 입력 → 한강 폴백(인코딩됨)
  });
});

describe('ACTIVITY_GUIDES — 4개국어 완전성 (누락 시 fail)', () => {
  for (const kind of ['bike', 'running', 'trekking'] as const) {
    for (const lang of LANGS) {
      it(`${kind}/${lang} — title·intro·steps·warnings·mapLabel 모두 채워짐`, () => {
        const g = ACTIVITY_GUIDES[kind][lang];
        expect(g, `${kind}/${lang} 누락`).toBeTruthy();
        expect(g.title.length).toBeGreaterThan(0);
        expect(g.intro.length).toBeGreaterThan(0);
        expect(g.mapLabel.length).toBeGreaterThan(0);
        expect(g.steps.length).toBeGreaterThanOrEqual(5);
        expect(g.warnings.length).toBeGreaterThanOrEqual(1);
        expect(g.steps.every((s) => s.trim().length > 0)).toBe(true);
      });
    }
  }

  it('따릉이 가이드 — 외국카드 3D Secure 함정 경고 포함 (SAFETY: 6살이 결제 막히면 멈춤)', () => {
    // 모든 언어 warnings 에 카드 실패 우회 안내가 있어야 함
    for (const lang of LANGS) {
      const w = ACTIVITY_GUIDES.bike[lang].warnings.join(' ');
      expect(/Discover Seoul Pass|Climate|기후동행|気候|气候/i.test(w), `bike/${lang} 카드 우회 누락`).toBe(true);
    }
  });
});

describe('buildActivityGuideHtml — PDF 렌더 (화면과 동일 SSOT, #786 PDF 누락 갭 봉합)', () => {
  const bikePlan = { itinerary: { days: [day({ theme: '한강 자전거 + 여의도 (따릉이 라이딩)', stops: [{ display_name: '따릉이 여의도 대여', lat: 37.5, lng: 126.9 }] })] } };

  it('활동 없으면 빈 문자열 (additive, byte-identical)', () => {
    expect(buildActivityGuideHtml({ itinerary: { days: [day({ theme: '경복궁', stops: [{ display_name: '경복궁' }] })] } }, 'en')).toBe('');
    expect(buildActivityGuideHtml(null, 'en')).toBe('');
  });

  it('따릉이 day → 제목·단계·지도링크 포함 HTML', () => {
    const html = buildActivityGuideHtml(bikePlan, 'en');
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain('<h4'); // 활동 카드
    expect(html).toContain('<ol'); // 번호 단계
    expect(html).toContain('map.naver.com'); // 코스 지도 링크
  });

  it('🔴 SAFETY: 따릉이 외국카드 경고가 PDF HTML 에 렌더 (오프라인 여행 참조 — 결제 막힘 예방)', () => {
    // 화면뿐 아니라 다운로드 PDF 에도 외국카드 우회 안내가 들어가야 함 (#786 갭의 핵심)
    expect(/Discover Seoul Pass|Climate/i.test(buildActivityGuideHtml(bikePlan, 'en'))).toBe(true);
    expect(buildActivityGuideHtml(bikePlan, 'ko')).toContain('기후동행');
  });

  it('4개국어 heading 렌더', () => {
    expect(buildActivityGuideHtml(bikePlan, 'ko')).toContain('활동 가이드');
    expect(buildActivityGuideHtml(bikePlan, 'en')).toContain('Activity Guide');
    expect(buildActivityGuideHtml(bikePlan, 'ja')).toContain('アクティビティガイド');
    expect(buildActivityGuideHtml(bikePlan, 'zh')).toContain('活动指南');
  });

  it('같은 종류 day 2개 → 카드 1개로 dedup (kind 당 1회)', () => {
    const two = { itinerary: { days: [
      day({ day: 1, theme: '따릉이 라이딩 A', stops: [{ display_name: '여의도' }] }),
      day({ day: 2, theme: '따릉이 라이딩 B', stops: [{ display_name: '뚝섬' }] }),
    ] } };
    const html = buildActivityGuideHtml(two, 'en');
    expect((html.match(/<h4/g) || []).length).toBe(1); // bike 카드 1개만
  });

  it('트레킹 day → 트레킹 가이드 + 경고(겨울 아이젠/일몰) 렌더', () => {
    const trek = { itinerary: { days: [day({ activity_meta: { activity_type: 'trekking' }, theme: '북한산', stops: [{ display_name: '북한산우이역' }] })] } };
    const html = buildActivityGuideHtml(trek, 'ko');
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain('<h4');
  });
});
