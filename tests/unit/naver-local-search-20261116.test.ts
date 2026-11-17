/**
 * 2026-11-16 — Naver 장소 검색 공용 모듈 + 관광지 고르기(순수).
 *   식이 손님(legacy) 플랜의 영어 이름 관광지("Hongdae Mural Street", 주소 "서울 마포구 와우산로29길")는 주소 지도 조회가 못 찾아
 *   좌표 없음 → 앞뒤 구간이 가짜 "25분 · 5 km" 였다. 운영 장소 검색 실측(11/16~17): 영어 이름 14건 중 13건은 1순위가 그 관광지,
 *   "Insadong" 1순위는 호텔, "Myeongdong Street" → 마포구 분식집, "Garosu-gil" → 강남구 술집(틀림) — 분류·동네·거리가 맞을 때만 받는다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const axiosGetMock = vi.hoisted(() => vi.fn());
vi.mock('axios', () => ({ default: { get: axiosGetMock } }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => null }));
vi.mock('../../api/_shared/ip-rate-limit.js', () => ({ checkIpRateLimit: async () => ({ ok: true }), getClientIp: () => '1.2.3.4' }));
vi.mock('../../api/_shared/translator.js', () => ({ translatePlaceName: async (text: string) => ({ text, source: 'original' }) }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: vi.fn(async () => {}) }));
vi.mock('../../api/_shared/llm/index.js', () => ({ createLlmModel: () => { throw new Error('no LLM in tests'); }, resolveLlmModel: () => 'mock' }));

import * as shared from '../../api/_shared/naverLocalSearch.js';
import * as placeSearch from '../../api/place-search.js';
import {
  koreanDistrict, pickAttractionHit, localGeoNames, localGeoAliases, needsLocalGeo, localGeoMealRuleCliffs, localGeoMealMoved, LOCAL_GEO_NEAR_KM,
} from '../../api/_ai_core/agents/RouteAgent.js';

const KEYS = { NAVER_LOCAL_SEARCH_CLIENT_ID: 'a', NAVER_LOCAL_SEARCH_SECRET: 'b', NAVER_CLIENT_ID: 'c', NAVER_CLIENT_SECRET: 'd' };
const raw = (title: string, category: string, address: string, lat: number, lng: number) =>
  ({ title, category, address, roadAddress: '', mapx: String(Math.round(lng * 1e7)), mapy: String(Math.round(lat * 1e7)) });

describe('searchNaverLocal — 실패는 null, 결과 없음은 [], throw 없음', () => {
  beforeEach(() => { axiosGetMock.mockReset(); });

  it('키가 없으면 부르지 않고 null', async () => {
    expect(await shared.searchNaverLocal('홍대 벽화거리', { env: {} })).toBeNull();
    expect(axiosGetMock).not.toHaveBeenCalled();
  });
  it('검색어가 2자 미만이면 부르지 않고 []', async () => {
    expect(await shared.searchNaverLocal(' a ', { env: KEYS })).toEqual([]);
    expect(axiosGetMock).not.toHaveBeenCalled();
  });
  it('200 → 태그 지운 이름·분류·주소 + WGS84 좌표, display 5 · 시간 제한 2초로 부른다', async () => {
    axiosGetMock.mockResolvedValueOnce({ status: 200, data: { items: [raw('<b>홍대</b>벽화거리', '여행,명소', '서울특별시 마포구 상수동 72-36', 37.5517967, 126.924103), { title: 'x', mapx: 'bad', mapy: 'bad' }] } });
    const out = await shared.searchNaverLocal('Hongdae Mural Street', { env: KEYS });
    expect(out).toEqual([{ title: '홍대벽화거리', category: '여행,명소', address: '서울특별시 마포구 상수동 72-36', roadAddress: '', lat: 37.5517967, lng: 126.924103 }]);
    const [url, opts] = axiosGetMock.mock.calls[0];
    expect(url).toBe('https://openapi.naver.com/v1/search/local.json');
    expect(opts.params).toEqual({ query: 'Hongdae Mural Street', display: 5, sort: 'random' });
    expect(opts.timeout).toBeGreaterThan(1990);
    expect(opts.timeout).toBeLessThanOrEqual(2000);
  });
  it('키쌍을 여러 개 시도해도 검색 한 번 전체가 시간 제한 안 — 느린 거부 뒤 남은 시간만, 다 쓰면 다음 키를 부르지 않고 null', async () => {
    let clock = 5_000_000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    try {
      axiosGetMock.mockImplementationOnce(async () => { clock += 1500; return { status: 401, data: {} }; })
        .mockImplementationOnce(async () => { clock += 600; return { status: 401, data: {} }; });
      const env3 = { ...KEYS, NAVER_DEVELOPERS_CLIENT_ID: 'e', NAVER_DEVELOPERS_SECRET: 'f' };
      expect(await shared.searchNaverLocal('경복궁', { env: env3 })).toBeNull();
      expect(axiosGetMock.mock.calls.map(([, o]) => o.timeout)).toEqual([2000, 500]);
    } finally {
      nowSpy.mockRestore();
    }
  });
  it('401 이면 다음 키쌍으로 다시 부른다', async () => {
    axiosGetMock.mockResolvedValueOnce({ status: 401, data: {} }).mockResolvedValueOnce({ status: 200, data: { items: [] } });
    expect(await shared.searchNaverLocal('인사동', { env: KEYS })).toEqual([]);
    expect(axiosGetMock.mock.calls.map(([, o]) => o.headers['X-Naver-Client-Id'])).toEqual(['a', 'c']);
  });
  it.each([
    ['429', () => axiosGetMock.mockResolvedValue({ status: 429, data: {} })],
    ['500', () => axiosGetMock.mockResolvedValue({ status: 500, data: {} })],
    ['모든 키 거부', () => axiosGetMock.mockResolvedValue({ status: 403, data: {} })],
    ['시간 초과(throw)', () => axiosGetMock.mockImplementation(async () => { throw new Error('timeout of 2000ms exceeded'); })],
  ])('%s → null', async (_name, arrange) => {
    arrange();
    expect(await shared.searchNaverLocal('해운대', { env: KEYS })).toBeNull();
  });
  it('차터 자동완성(place-search)은 같은 함수를 그대로 다시 내보낸다', () => {
    expect(placeSearch.naverCoordToWgs84).toBe(shared.naverCoordToWgs84);
    expect(placeSearch.resolveCredentialCandidates).toBe(shared.resolveCredentialCandidates);
    expect(placeSearch.searchWithCredentialFallback).toBe(shared.searchWithCredentialFallback);
  });
});

describe('koreanDistrict — 주소 앞 두 낱말의 시도·시군구', () => {
  it.each([
    ['서울 마포구 와우산로29길', { sido: '서울', sigungu: '마포구' }],
    ['서울특별시 마포구 상수동 72-36', { sido: '서울', sigungu: '마포구' }],
    ['경북 경주시 교촌길', { sido: '경북', sigungu: '경주시' }],
    ['경상북도 경주시 인왕동', { sido: '경북', sigungu: '경주시' }],
    ['전북특별자치도 전주시 완산구', { sido: '전북', sigungu: '전주시' }],
    ['강원특별자치도 강릉시 창해로', { sido: '강원', sigungu: '강릉시' }],
    ['제주특별자치도 서귀포시 중문관광로', { sido: '제주', sigungu: '서귀포시' }],
    ['부산 중구 비프광장로', { sido: '부산', sigungu: '중구' }],
  ])('%s', (address, expected) => {
    expect(koreanDistrict(address)).toEqual(expected);
  });
  it.each(['', '  ', 'Mapo-gu, Seoul', '서울', '세종특별자치시 한누리대로', 'Hongdae'])('%j → null', (address) => {
    expect(koreanDistrict(address)).toBeNull();
  });
});

describe('pickAttractionHit — 관광 분류 + 같은 시도·시군구 + (이름이 같음 | 검색 1순위이고 그날 숙소·stop 20km 안)', () => {
  const hongdae = { title: '홍대벽화거리', category: '여행,명소>거리,골목', address: '서울특별시 마포구 상수동 72-36', roadAddress: '', lat: 37.5517967, lng: 126.924103 };
  const near = [{ lat: 37.5636, lng: 126.9826 }]; // 명동 숙소
  const opts = { names: ['Hongdae Mural Street'], address: '서울 마포구 와우산로29길', near };

  it('운영 실측: 영어 이름 검색 1순위 홍대벽화거리 → 받는다', () => {
    expect(pickAttractionHit([hongdae], opts)).toBe(hongdae);
  });
  it('식당·병원·술집·호텔·카페·가게(운영 실측 "Myeongdong Street"·"Garosu-gil"·"Insadong" 1순위 같은 것) → 받지 않는다', () => {
    for (const category of ['음식점>분식', '음식점>일식>이자카야', '병원,의원>피부과', '숙박>호텔', '카페,디저트>카페', '쇼핑,유통>화장품', '']) {
      expect(pickAttractionHit([{ ...hongdae, category }], opts), category).toBeNull();
    }
  });
  it('여행·문화 + 절(불국사·조계사)·시장(광장시장)·쇼핑몰(롯데월드몰) 분류는 받는다(운영 실측)', () => {
    for (const category of ['여행,명소>테마파크', '문화,예술>고궁', '불교>절,사찰', '쇼핑,유통>시장', '쇼핑,유통>쇼핑복합시설']) {
      expect(pickAttractionHit([{ ...hongdae, category }], opts), category).not.toBeNull();
    }
  });
  it('다른 구 · 같은 이름의 다른 도시 구(부산 중구 ≠ 서울 중구) → 받지 않는다', () => {
    expect(pickAttractionHit([{ ...hongdae, address: '서울특별시 강남구 신사동 1' }], opts)).toBeNull();
    const biff = { title: '비프광장', category: '여행,명소', address: '서울특별시 중구 남포동', roadAddress: '', lat: 37.56, lng: 126.98 };
    expect(pickAttractionHit([biff], { names: ['BIFF Square'], address: '부산 중구 비프광장로', near })).toBeNull();
  });
  it('도로명 주소로도 동네를 맞춘다', () => {
    const palace = { title: '경복궁', category: '문화,예술>고궁', address: '', roadAddress: '서울특별시 종로구 사직로 161', lat: 37.5796, lng: 126.977 };
    expect(pickAttractionHit([palace], { names: ['Gyeongbokgung Palace'], address: '서울 종로구 사직로', near })).toBe(palace);
  });
  it('1순위가 관광지가 아니면 둘째는 받지 않는다 — 이름이 정확히 같으면 순위와 무관', () => {
    const eatery = { ...hongdae, title: '홍대 벽화 국수', category: '음식점>국수' };
    const street = { ...hongdae, title: '홍대 걷고싶은거리' };
    expect(pickAttractionHit([eatery, hongdae], opts)).toBeNull();
    expect(pickAttractionHit([eatery, hongdae], { ...opts, names: ['홍대 벽화거리', 'Hongdae Mural Street'] })).toBe(hongdae);
    expect(pickAttractionHit([street, hongdae], { ...opts, names: ['홍대 벽화거리'] })).toBe(hongdae);
    expect(pickAttractionHit([street, hongdae], opts)).toBe(street); // 영어 이름뿐이면 검색 1순위(같은 구·가까움)
  });
  it('같은 시군구여도 그날 숙소·좌표 있는 stop 어디서도 20km 넘으면 받지 않는다(검토 11/17: 주상절리 → 54km 떨어진 성산일출봉)', () => {
    const seongsan = { title: '성산일출봉', category: '여행,명소>산', address: '제주특별자치도 서귀포시 성산읍 성산리 1', roadAddress: '', lat: 33.4589, lng: 126.9425 };
    const o = { names: ['Jungmun Daepo Jusangjeolli Cliff'], address: '제주 서귀포시 이어도로' };
    const jungmunHotel = { lat: 33.2496, lng: 126.4123 };
    expect(pickAttractionHit([seongsan], { ...o, near: [jungmunHotel] })).toBeNull();
    expect(pickAttractionHit([seongsan], { ...o, near: [jungmunHotel, { lat: 33.45, lng: 126.9 }] })).toBe(seongsan); // 그날 다른 stop 이 옆이면
    expect(pickAttractionHit([seongsan], { ...o, near: [] })).toBeNull();
    expect(LOCAL_GEO_NEAR_KM).toBe(20);
  });
  it('좌표가 없거나 0,0 인 항목은 받지 않는다', () => {
    expect(pickAttractionHit([{ ...hongdae, lat: 0, lng: 0 }], opts)).toBeNull();
    expect(pickAttractionHit([{ ...hongdae, lat: null, lng: null }], opts)).toBeNull();
  });
  it('주소로 동네를 못 읽으면: 이름이 정확히 같고 20km 안만 — 멀거나 영어 이름뿐이면 null', () => {
    expect(pickAttractionHit([hongdae], { names: ['홍대 벽화거리'], address: '', near })).toBe(hongdae);
    expect(pickAttractionHit([hongdae], { names: ['홍대 벽화거리'], address: '', near: [{ lat: 35.16, lng: 129.16 }] })).toBeNull();
    expect(pickAttractionHit([hongdae], { names: ['Hongdae Mural Street'], address: 'Mapo-gu', near })).toBeNull();
    expect(pickAttractionHit([hongdae], { names: ['홍대 벽화거리'], address: '', near: [] })).toBeNull();
    expect(pickAttractionHit([{ ...hongdae, title: '홍대 벽화 카페' }], { names: ['홍대 벽화거리'], address: '', near })).toBeNull();
  });
  it('결과가 비었거나 배열이 아니면 null', () => {
    expect(pickAttractionHit([], opts)).toBeNull();
    expect(pickAttractionHit(null as never, opts)).toBeNull();
  });
});

describe('localGeoNames · localGeoAliases · needsLocalGeo', () => {
  it('검색어 = 괄호 덧말을 지운 이름 — 한글 먼저, 중복 제거', () => {
    expect(localGeoNames({ name: 'Hongdae Mural Street', display_name: '홍대 벽화거리 (Mural Street)', name_en: 'Hongdae Mural Street' })).toEqual(['홍대 벽화거리', 'Hongdae Mural Street']);
    expect(localGeoNames({ name: 'Hongdae Mural Street (홍대 벽화거리)' })).toEqual(['Hongdae Mural Street']);
    expect(localGeoNames({ name: 'x' })).toEqual([]);
  });
  it('괄호 안 한글 = 이름 맞추기용 별칭(검색어 아님) — 영어 괄호·1자는 뺀다(검토 11/17: "(가회동)"으로 검색하면 엉뚱한 곳)', () => {
    expect(localGeoAliases({ name: 'Hongdae Mural Street (홍대 벽화거리)' })).toEqual(['홍대 벽화거리']);
    expect(localGeoAliases({ name: 'N Seoul Tower (남산) (야경 명소)', display_name: 'N Seoul Tower (남산)' })).toEqual(['남산', '야경 명소']);
    expect(localGeoAliases({ name: 'Gyeongbokgung (Palace)', name_ko: '경복궁 (궁)' })).toEqual([]);
    expect(localGeoAliases({})).toEqual([]);
  });
  it('legacy 관광 분류(landmark·culture·nature·shopping·kpop)만 · 블록 아님 · 좌표 없음', () => {
    for (const category of ['culture', 'landmark', 'nature', 'shopping', 'kpop', 'Culture']) expect(needsLocalGeo({ category, name: 'A' }), category).toBe(true);
    expect(needsLocalGeo({ category: 'culture', name: 'A', lat: 37.5, lng: 126.9 })).toBe(false);
    expect(needsLocalGeo({ category: 'culture', name: 'A', source_block_id: 'seoul-hongdae' })).toBe(false);
    for (const category of ['lodging', 'airport', 'airport_transfer', 'travel', 'food', 'FOOD', 'cafe', 'dessert', 'restaurant', 'nightlife', '', undefined]) {
      expect(needsLocalGeo({ category, name: 'A' }), String(category)).toBe(false);
    }
    expect(needsLocalGeo(null)).toBe(false);
  });
});

describe('localGeoMealRuleCliffs · localGeoMealMoved — 끼니 판정 경계(검토 11/17: 17시·마지막 날만 시험했다)', () => {
  it('경계 = 06:00 · 11:00 · 17:00 · 22:00 · 투어 종료(못 읽으면 뺀다)', () => {
    expect(localGeoMealRuleCliffs(1260)).toEqual([360, 660, 1020, 1320, 1260]);
    expect(localGeoMealRuleCliffs(-1)).toEqual([360, 660, 1020, 1320]);
    expect(localGeoMealRuleCliffs(NaN)).toEqual([360, 660, 1020, 1320]);
  });
  const cliffs = localGeoMealRuleCliffs(1260); // 투어 종료 21:00
  it.each([
    [359, 360], [360, 359], // 06:00
    [659, 660], [660, 659], // 11:00
    [1019, 1020], [1020, 1019], // 17:00
    [1259, 1260], [1260, 1259], // 21:00 투어 종료
    [1319, 1320], [1320, 1319], // 22:00
  ])('%i → %i 은 경계를 넘는다', (was, now) => {
    expect(localGeoMealMoved(was, now, cliffs, false)).toBe(true);
  });
  it.each([[700, 800], [800, 700], [1100, 1200], [361, 659], [1321, 1400], [700, 700]])('%i → %i 은 경계를 안 넘는다', (was, now) => {
    expect(localGeoMealMoved(was, now, cliffs, false)).toBe(false);
  });
  it('마지막 날은 조금이라도 늦어지면 true — 같거나 빨라지면 경계 기준', () => {
    expect(localGeoMealMoved(700, 701, cliffs, true)).toBe(true);
    expect(localGeoMealMoved(701, 700, cliffs, true)).toBe(false);
    expect(localGeoMealMoved(700, 700, cliffs, true)).toBe(false);
    expect(localGeoMealMoved(1021, 1019, cliffs, true)).toBe(true);
  });
});
