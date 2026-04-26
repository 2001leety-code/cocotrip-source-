// destinationKeyMap — 한글/영문 자유 입력 → distance_matrix 영문 키 정규화.
// Step3 destinationCustom + useQuoteCalculator + resolveProductType에서 공용.
//
// 매트릭스 키는 모두 대문자 영문 (예: 'DAMYANG', 'GYEONGJU').
// 사용자는 한글/영문/혼용으로 입력하므로 이 사전이 매핑 시도.
// 미매칭 시 null → 별도견적 분기로 진입.

const RAW_MAP: Record<string, string> = {
  // 광역시·수도권
  '서울': 'SEL_METRO', 'seoul': 'SEL_METRO',
  '부산': 'BUS_METRO', 'busan': 'BUS_METRO',
  '제주': 'JEJU_METRO', 'jeju': 'JEJU_METRO',
  '제주시': 'JEJU_METRO',
  '서귀포': 'SEOGWIPO', 'seogwipo': 'SEOGWIPO',
  '성산': 'SEONGSAN', 'seongsan': 'SEONGSAN', '성산일출봉': 'SEONGSAN',
  '한라산': 'HALLASAN', 'hallasan': 'HALLASAN',

  // 강원
  '강릉': 'GANGNEUNG', 'gangneung': 'GANGNEUNG',
  '속초': 'SOKCHO', 'sokcho': 'SOKCHO',
  '춘천': 'CHUNCHEON', 'chuncheon': 'CHUNCHEON',
  '평창': 'PYEONGCHANG', 'pyeongchang': 'PYEONGCHANG',
  '용평': 'PYEONGCHANG', 'yongpyong': 'PYEONGCHANG',
  '알펜시아': 'PYEONGCHANG', 'alpensia': 'PYEONGCHANG',

  // 경기
  '수원': 'SUWON', 'suwon': 'SUWON',
  '용인': 'SUWON', 'yongin': 'SUWON',
  '가평': 'GAPYEONG', 'gapyeong': 'GAPYEONG',
  '남이섬': 'GAPYEONG', 'nami': 'GAPYEONG',

  // 충청
  '대전': 'DAEJEON', 'daejeon': 'DAEJEON',
  '단양': 'DAMYANG', // 사용자 보고 케이스: '단양' (충북 단양) → 매트릭스 키는 'DAMYANG' (전남 담양과 동일 키)
  '담양': 'DAMYANG', 'damyang': 'DAMYANG',

  // 경상
  '경주': 'GYEONGJU', 'gyeongju': 'GYEONGJU',
  '안동': 'ANDONG', 'andong': 'ANDONG',
  '대구': 'DAEGU', 'daegu': 'DAEGU',
  '울산': 'BUS_METRO', // 울산 도착 매트릭스 없음 → 부산 시내로 폴백 (가장 가까운 광역시)

  // 전라
  '전주': 'JEONJU', 'jeonju': 'JEONJU',
  '여수': 'YEOSU', 'yeosu': 'YEOSU',
  '광주': 'GWANGJU_CITY', // 매트릭스 미존재. 미매칭으로 처리되어 별도견적 분기.
  '순천': 'SUNCHEON_CITY', // 매트릭스 미존재
  '보성': 'BOSEONG_CITY', // 매트릭스 미존재

  // DMZ / 파주 — DMZ 패키지(dmz)와 별개로 매트릭스에 키 없음
  // 사용자가 'DMZ'/'파주' 자유 입력하면 day_tour의 dmz 패키지로 폴백
  // 단, 이건 destinationKey vs destinationCustom 구분이므로 Step3에서 처리.
};

// 정규화: 공백/특수문자 제거, 소문자, 짧은 부분 매칭 시도
function normalize(input: string): string {
  return input.trim().toLowerCase().replace(/[\s·\-_]/g, '');
}

// 매트릭스 키 (ICN→DAMYANG 같은 raw key의 우측)
export function normalizeDestinationToMatrixKey(input: string): string | null {
  if (!input) return null;
  const cleaned = normalize(input);

  // 1) 정확 매칭
  for (const [k, v] of Object.entries(RAW_MAP)) {
    if (normalize(k) === cleaned) return v;
  }
  // 2) 부분 매칭 (입력이 키를 포함하거나, 키가 입력을 포함)
  for (const [k, v] of Object.entries(RAW_MAP)) {
    const nk = normalize(k);
    if (cleaned.includes(nk) || nk.includes(cleaned)) {
      // 너무 짧은 부분 매칭은 오감지 위험 → 3자 이상만 허용
      if (Math.min(nk.length, cleaned.length) >= 3) return v;
    }
  }
  return null;
}

// day_tour 패키지 키 매핑 (자유 입력 → DAILY_TOUR_PRICES 키)
const DAY_TOUR_KEYWORD_MAP: Record<string, string> = {
  'dmz': 'dmz', '비무장지대': 'dmz', 'panmunjom': 'dmz', '판문점': 'dmz', '임진각': 'dmz', '파주': 'dmz',
  '서울시내': 'seoul-city', 'seoulcity': 'seoul-city',
  '서울근교': 'seoul-suburb', 'seoulsuburb': 'seoul-suburb',
  '경주전주': 'gyeongju-jeonju', 'gyeongjujeonju': 'gyeongju-jeonju',
  '강원도': 'gangwon', 'gangwon': 'gangwon',
  '스키': 'ski-resort', 'ski': 'ski-resort',
  '부산투어': 'busan-day', 'busanday': 'busan-day',
};

export function normalizeToDayTourKey(input: string): string | null {
  if (!input) return null;
  const cleaned = normalize(input);
  for (const [k, v] of Object.entries(DAY_TOUR_KEYWORD_MAP)) {
    if (normalize(k) === cleaned) return v;
  }
  for (const [k, v] of Object.entries(DAY_TOUR_KEYWORD_MAP)) {
    const nk = normalize(k);
    if (cleaned.includes(nk) || nk.includes(cleaned)) {
      if (Math.min(nk.length, cleaned.length) >= 3) return v;
    }
  }
  return null;
}
