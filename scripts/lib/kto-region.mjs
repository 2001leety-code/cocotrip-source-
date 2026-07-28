/**
 * KTO 사진 갤러리 — 촬영지 텍스트 → 지역 폴더 분류.
 *
 * collect-kto-photo-gallery.mjs 에서 분리(2026-07-28). 이유는 두 가지:
 *  1. 그 스크립트는 shebang + 최상단 main() 실행이라 테스트에서 import 할 수 없다.
 *  2. 아래 오분류가 3주 넘게 잠복했다 — 잠금 테스트가 붙을 자리가 필요했다.
 *
 * 🔴 오분류 (2026-07-28 발견): 한국관광공사가 촬영지를 `전남광주통합특별시 여수시 …`
 *    로 표기하면서 광역 키워드 '광주'가 시(市) 키워드보다 먼저 걸려, 여수 사진 48장이
 *    전부 gwangju/ 폴더로 저장됐다. 그 결과 "검증된 여수 사진 0장"이라는 잘못된 결론이
 *    나 위저드 여수 칩만 사진 없이 아이콘 폴백으로 남아 있었다.
 *    → 시 단위 키워드를 광역보다 **먼저** 본다.
 */

/** 광역 단위 키워드 (기존 순서 유지). */
export const REGION_KEYWORDS = [
  ['seoul', ['서울', 'seoul']],
  ['busan', ['부산', 'busan']],
  ['jeju', ['제주', 'jeju']],
  ['incheon', ['인천', 'incheon']],
  ['gyeonggi', ['경기', '수원', '파주', '가평', '양평', '포천']],
  ['gangwon', ['강원', '춘천', '속초', '강릉', '평창', '양양', '정선']],
  ['chungbuk', ['충북', '충청북도', '단양', '제천', '청주']],
  ['chungnam', ['충남', '충청남도', '공주', '부여', '천안']],
  ['daejeon', ['대전']],
  ['sejong', ['세종']],
  ['daegu', ['대구']],
  ['gyeongbuk', ['경북', '경상북도', '경주', '안동', '포항']],
  ['gyeongnam', ['경남', '경상남도', '통영', '거제', '진주']],
  ['ulsan', ['울산']],
  ['gwangju', ['광주']],
  ['jeonbuk', ['전북', '전라북도', '전주', '군산']],
  ['jeonnam', ['전남', '전라남도', '여수', '순천', '목포', '담양']],
];

/**
 * 시(市) 단위 키워드 — 광역보다 **먼저** 본다.
 * 광역 이름이 섞인 신표기(`전남광주통합특별시 여수시`)를 바로잡는 유일한 지점.
 */
export const CITY_FIRST_KEYWORDS = [
  ['jeonnam', ['여수', '순천', '목포', '담양', '보성', '해남', '완도']],
  ['jeonbuk', ['전주', '군산', '남원', '고창']],
  ['gyeongnam', ['통영', '거제', '진주', '남해', '하동']],
  ['gyeongbuk', ['경주', '안동', '포항', '영주']],
  ['gangwon', ['춘천', '속초', '강릉', '평창', '양양', '정선']],
  ['gyeonggi', ['수원', '파주', '가평', '양평', '포천']],
];

/** 분류에 쓰는 텍스트 — 제목·촬영지·검색어·촬영자를 이어 붙인다. */
export function regionTextOf(item) {
  return [
    item.galTitle,
    item.galPhotographyLocation,
    item.galSearchKeyword,
    item.galPhotographer,
  ].filter(Boolean).join(' ');
}

/** 촬영지 텍스트 → 지역 키. 못 찾으면 'unknown-region'. */
export function classifyRegion(item) {
  const text = regionTextOf(item).toLowerCase();
  for (const [region, keywords] of CITY_FIRST_KEYWORDS) {
    if (keywords.some((keyword) => text.includes(keyword.toLowerCase()))) return region;
  }
  for (const [region, keywords] of REGION_KEYWORDS) {
    if (keywords.some((keyword) => text.includes(keyword.toLowerCase()))) return region;
  }
  return 'unknown-region';
}
