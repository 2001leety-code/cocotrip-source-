// 회귀 잠금 (2026-07-28) — KTO 사진 지역 오분류.
//
// 한국관광공사가 촬영지를 `전남광주통합특별시 여수시 …` 로 표기하기 시작하면서
// 수집 스크립트의 광역 키워드 '광주'가 시 키워드보다 먼저 걸려, 여수 사진 48장이
// 전부 gwangju/ 폴더로 들어갔다. 그 결과 "검증된 여수 사진 0장" 이라는 잘못된 결론이
// 났고 위저드 여수 칩만 사진이 비어 있었다.
// 이 테스트가 시(市) 우선 판정을 잠근다.
import { describe, it, expect } from 'vitest';
import { classifyRegion } from '../../scripts/lib/kto-region.mjs';

const item = (location: string, keyword = '') => ({
  galTitle: '',
  galPhotographyLocation: location,
  galSearchKeyword: keyword,
  galPhotographer: '',
});

describe('classifyRegion — 시(市) 키워드가 광역보다 우선', () => {
  it('전남광주통합특별시 여수시 → jeonnam (gwangju 아님)', () => {
    expect(classifyRegion(item('전남광주통합특별시 여수시 종화동, 하멜등대'))).toBe('jeonnam');
    expect(classifyRegion(item('전남광주통합특별시 여수시 돌산읍'))).toBe('jeonnam');
  });

  it('같은 계열 도시들도 함께 교정된다', () => {
    expect(classifyRegion(item('전남광주통합특별시 순천시 순천만'))).toBe('jeonnam');
    expect(classifyRegion(item('전남광주통합특별시 목포시'))).toBe('jeonnam');
    expect(classifyRegion(item('전북특별자치도 전주시 완산구'))).toBe('jeonbuk');
    expect(classifyRegion(item('경상남도 통영시'))).toBe('gyeongnam');
  });

  it('진짜 광주 사진은 여전히 gwangju', () => {
    expect(classifyRegion(item('광주광역시 동구 국립아시아문화전당'))).toBe('gwangju');
  });

  it('시 키워드가 없으면 기존 광역 판정 그대로', () => {
    expect(classifyRegion(item('서울특별시 종로구 경복궁'))).toBe('seoul');
    expect(classifyRegion(item('제주특별자치도 서귀포시'))).toBe('jeju');
  });
});
