/**
 * 2026-11-16 — Naver 장소 검색 공용 모듈 + 관광지 고르기(순수).
 *   식이 손님(legacy) 플랜의 영어 이름 관광지("Hongdae Mural Street", 주소 "서울 마포구 와우산로29길")는 주소 지도 조회가 못 찾아
 *   좌표 없음 → 앞뒤 구간이 가짜 "25분 · 5 km" 였다. 운영 장소 검색 실측(11/16): 홍대벽화거리·인사동·해운대·비프광장 맞음,
 *   "Myeongdong Street" → 마포구 분식집, "Garosu-gil" → 강남구 술집(틀림) — 분류·동네가 맞을 때만 받아야 한다.
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
import { koreanDistrict, pickAttractionHit, localGeoNames, needsLocalGeo } from '../../api/_ai_core/agents/RouteAgent.js';

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
    expect(opts.timeout).toBe(2000);
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

describe('pickAttractionHit — 여행·문화 분류 + 같은 시도·시군구만', () => {
  const hongdae = { title: '홍대벽화거리', category: '여행,명소', address: '서울특별시 마포구 상수동 72-36', roadAddress: '', lat: 37.5517967, lng: 126.924103 };
  const opts = { names: ['Hongdae Mural Street'], address: '서울 마포구 와우산로29길' };

  it('홍대벽화거리 → 받는다', () => {
    expect(pickAttractionHit([hongdae], opts)).toBe(hongdae);
  });
  it('식당·병원·술집(운영 실측 "Myeongdong Street"·"Garosu-gil" 같은 것) → 받지 않는다', () => {
    const items = [
      { ...hongdae, title: '명동분식', category: '음식점>분식' },
      { ...hongdae, title: '가로수길 이자카야', category: '음식점>일식>이자카야' },
      { ...hongdae, title: '마포 피부과', category: '병원,의원>피부과' },
    ];
    expect(pickAttractionHit(items, opts)).toBeNull();
  });
  it('다른 구 · 같은 이름의 다른 도시 구(부산 중구 ≠ 서울 중구) → 받지 않는다', () => {
    expect(pickAttractionHit([{ ...hongdae, address: '서울특별시 강남구 신사동 1' }], opts)).toBeNull();
    const biff = { title: '비프광장', category: '여행,명소', address: '서울특별시 중구 남포동', roadAddress: '', lat: 37.56, lng: 126.98 };
    expect(pickAttractionHit([biff], { names: ['BIFF Square'], address: '부산 중구 비프광장로' })).toBeNull();
  });
  it('도로명 주소로도 맞춘다, 고궁(문화,예술>고궁)도 받는다', () => {
    const palace = { title: '경복궁', category: '문화,예술>고궁', address: '', roadAddress: '서울특별시 종로구 사직로 161', lat: 37.5796, lng: 126.977 };
    expect(pickAttractionHit([palace], { names: ['Gyeongbokgung Palace'], address: '서울 종로구 사직로' })).toBe(palace);
  });
  it('식당이 먼저 나오고 맞는 곳이 둘째면 둘째, 이름이 정확히 같은 것이 검색 순서보다 먼저', () => {
    const eatery = { ...hongdae, title: '홍대 벽화 국수', category: '음식점>국수' };
    const street = { ...hongdae, title: '홍대 걷고싶은거리' };
    expect(pickAttractionHit([eatery, hongdae], opts)).toBe(hongdae);
    expect(pickAttractionHit([street, hongdae], { ...opts, names: ['홍대 벽화거리', 'Hongdae Mural Street'] })).toBe(hongdae);
    expect(pickAttractionHit([street, hongdae], opts)).toBe(street);
  });
  it('좌표가 없거나 0,0 인 항목은 받지 않는다', () => {
    expect(pickAttractionHit([{ ...hongdae, lat: 0, lng: 0 }], opts)).toBeNull();
    expect(pickAttractionHit([{ ...hongdae, lat: null, lng: null }], opts)).toBeNull();
  });
  it('주소로 동네를 못 읽으면: 한글 이름과 정확히 같고 숙소 20km 안만 — 멀거나 영어 이름뿐이면 null', () => {
    const near = { lat: 37.5636, lng: 126.9826 }; // 명동
    expect(pickAttractionHit([hongdae], { names: ['홍대 벽화거리'], address: '', near })).toBe(hongdae);
    expect(pickAttractionHit([hongdae], { names: ['홍대 벽화거리'], address: '', near: { lat: 35.16, lng: 129.16 } })).toBeNull();
    expect(pickAttractionHit([hongdae], { names: ['Hongdae Mural Street'], address: 'Mapo-gu', near })).toBeNull();
    expect(pickAttractionHit([hongdae], { names: ['홍대 벽화거리'], address: '', near: null })).toBeNull();
    expect(pickAttractionHit([{ ...hongdae, title: '홍대 벽화 카페' }], { names: ['홍대 벽화거리'], address: '', near })).toBeNull();
  });
  it('결과가 비었거나 배열이 아니면 null', () => {
    expect(pickAttractionHit([], opts)).toBeNull();
    expect(pickAttractionHit(null as never, opts)).toBeNull();
  });
});

describe('localGeoNames · needsLocalGeo', () => {
  it('괄호 덧말을 지우고 한글 먼저, 중복 제거', () => {
    expect(localGeoNames({ name: 'Hongdae Mural Street', display_name: '홍대 벽화거리 (Mural Street)', name_en: 'Hongdae Mural Street' })).toEqual(['홍대 벽화거리', 'Hongdae Mural Street']);
    expect(localGeoNames({ name: 'x' })).toEqual([]);
  });
  it('관광 stop · 블록 아님 · 좌표 없음만', () => {
    expect(needsLocalGeo({ category: 'culture', name: 'A' })).toBe(true);
    expect(needsLocalGeo({ category: 'culture', name: 'A', lat: 37.5, lng: 126.9 })).toBe(false);
    expect(needsLocalGeo({ category: 'culture', name: 'A', source_block_id: 'seoul-hongdae' })).toBe(false);
    for (const category of ['lodging', 'airport', 'airport_transfer', 'travel', 'food', 'FOOD']) expect(needsLocalGeo({ category, name: 'A' }), category).toBe(false);
    expect(needsLocalGeo(null)).toBe(false);
  });
});
