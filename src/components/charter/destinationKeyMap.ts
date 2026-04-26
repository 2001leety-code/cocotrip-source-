// destinationKeyMap — 한글/영문 자유 입력 → distance_matrix 영문 키 정규화.
// Step3 destinationCustom + useQuoteCalculator + resolveProductType에서 공용.
//
// 매트릭스 키는 모두 대문자 영문 (예: 'DAMYANG', 'GYEONGJU').
// 사용자는 한글/영문/혼용으로 입력하므로 이 사전이 매핑 시도.
// 미매칭 시 null → 별도견적 분기로 진입.

// ── 매핑 사전 ──
// label: 사용자에게 보여줄 한글/영문 표기 (datalist 자동완성용)
// matrixKey: distance_matrix의 우측 키 (origin→KEY)
// label은 normalize 함수로 키화되어 매칭 시도
interface MapEntry {
  matrixKey: string;
  labels: string[];   // 사용자 입력 후보 (한국어 + 영문 + 별칭)
  display: string;    // datalist 옵션에 보여줄 대표 라벨
}

const ENTRIES: MapEntry[] = [
  // ── 광역시·수도권 ──
  { matrixKey: 'SEL_METRO',   labels: ['서울', '서울시', '서울 시내', 'seoul', 'seoul metro', 'seoul city', '명동', '홍대', '종로', '마포', '용산', '이태원', 'myeongdong', 'hongdae', 'jongno', 'mapo', 'yongsan', 'itaewon'], display: '서울 시내 (Seoul Metro)' },
  { matrixKey: 'SEL_GANGNAM', labels: ['강남', '잠실', '송파', '서초', '강남구', 'gangnam', 'jamsil', 'songpa', 'seocho'], display: '강남·잠실·송파 (Seoul Gangnam)' },
  { matrixKey: 'BUSAN',       labels: ['부산', '부산시', '부산 시내', 'busan', 'busan city', '해운대', '광안', '동래', '감천', '서면', 'haeundae', 'gwangan', 'dongnae', 'gamcheon', 'seomyeon'], display: '부산 (Busan)' },
  { matrixKey: 'JEJU_METRO',  labels: ['제주', '제주시', 'jeju', 'jeju metro', 'jeju city'], display: '제주 시내 (Jeju Metro)' },
  { matrixKey: 'SEOGWIPO',    labels: ['서귀포', 'seogwipo'], display: '서귀포 (Seogwipo)' },
  { matrixKey: 'SEONGSAN',    labels: ['성산', '성산일출봉', 'seongsan', 'seongsan ilchulbong'], display: '성산 (Seongsan)' },
  { matrixKey: 'HALLASAN',    labels: ['한라산', 'hallasan'], display: '한라산 (Hallasan)' },

  // ── 강원도 ──
  { matrixKey: 'GANGNEUNG',   labels: ['강릉', 'gangneung'], display: '강릉 (Gangneung)' },
  { matrixKey: 'SOKCHO',      labels: ['속초', 'sokcho', '설악산', 'seoraksan'], display: '속초·설악 (Sokcho)' },
  { matrixKey: 'CHUNCHEON',   labels: ['춘천', 'chuncheon'], display: '춘천 (Chuncheon)' },
  { matrixKey: 'PYEONGCHANG', labels: ['평창', '용평', '알펜시아', '하이원', 'pyeongchang', 'yongpyong', 'alpensia', 'high1'], display: '평창·용평·알펜시아 (Pyeongchang)' },

  // ── 경기 ──
  { matrixKey: 'SUWON',       labels: ['수원', '용인', '에버랜드', 'suwon', 'yongin', 'everland'], display: '수원·용인 (Suwon / Yongin)' },
  { matrixKey: 'GAPYEONG',    labels: ['가평', '남이섬', '쁘띠프랑스', '아침고요', 'gapyeong', 'nami', 'nami island', 'petite france'], display: '가평·남이섬 (Gapyeong / Nami)' },

  // ── 충청 ──
  { matrixKey: 'DAEJEON',     labels: ['대전', 'daejeon'], display: '대전 (Daejeon)' },
  { matrixKey: 'DAMYANG',     labels: ['단양', '담양', 'danyang', 'damyang'], display: '담양·단양 (Damyang / Danyang)' },

  // ── 경상 ──
  { matrixKey: 'GYEONGJU',    labels: ['경주', '불국사', '석굴암', 'gyeongju', 'bulguksa', 'seokguram'], display: '경주 (Gyeongju)' },
  { matrixKey: 'ANDONG',      labels: ['안동', '하회마을', 'andong', 'hahoe'], display: '안동·하회 (Andong)' },
  { matrixKey: 'DAEGU',       labels: ['대구', 'daegu'], display: '대구 (Daegu)' },

  // ── 전라 ──
  { matrixKey: 'JEONJU',      labels: ['전주', '한옥마을', 'jeonju', 'hanok village'], display: '전주 (Jeonju)' },
  { matrixKey: 'YEOSU',       labels: ['여수', 'yeosu'], display: '여수 (Yeosu)' },
];

// 매트릭스에 없지만 사용자가 자주 입력할 수 있는 지역 — 별도견적 안내로 자연스럽게 분기되어 무방
const UNMATCHED_LIKELY: string[] = [
  '광주', '광주광역시', 'gwangju',
  '울산', '울산광역시', 'ulsan',
  '인천 시내', 'incheon city',
  '순천', 'suncheon',
  '보성', 'boseong',
  '포항', 'pohang',
  '창원', '마산', '진해', 'changwon', 'masan', 'jinhae',
  '김해', 'gimhae',
];

function normalize(input: string): string {
  return input.trim().toLowerCase().replace(/[\s·\-_]/g, '');
}

// 매트릭스 키 (ICN→DAMYANG 같은 raw key의 우측)
export function normalizeDestinationToMatrixKey(input: string): string | null {
  if (!input) return null;
  const cleaned = normalize(input);
  if (cleaned.length < 1) return null;

  // 1) 정확 매칭
  for (const entry of ENTRIES) {
    for (const label of entry.labels) {
      if (normalize(label) === cleaned) return entry.matrixKey;
    }
  }
  // 2) 부분 매칭 — 입력이 라벨에 포함되거나 라벨이 입력에 포함 (단, 짧은 입력 오감지 방지)
  for (const entry of ENTRIES) {
    for (const label of entry.labels) {
      const nl = normalize(label);
      if (cleaned.length >= 2 && nl.includes(cleaned)) return entry.matrixKey;
      if (nl.length >= 3 && cleaned.includes(nl)) return entry.matrixKey;
    }
  }
  return null;
}

// 매트릭스 lookup 시 METRO ↔ city 키 fallback
// 예: dest=BUSAN, origin=PUS → 1차 PUS→BUSAN 없음 → 2차 PUS→BUS_METRO ✓
//     dest=BUS_METRO, origin=ICN → 1차 ICN→BUS_METRO 없음 → 2차 ICN→BUSAN ✓
const METRO_FALLBACK: Record<string, string> = {
  BUSAN: 'BUS_METRO',
  BUS_METRO: 'BUSAN',
  SEOUL: 'SEL_METRO',
  SEL: 'SEL_METRO',
};

export function getMatrixKeyAlternatives(matrixKey: string): string[] {
  const alt = METRO_FALLBACK[matrixKey];
  return alt ? [matrixKey, alt] : [matrixKey];
}

// 자동완성 후보 — Step3Destination의 <datalist>가 사용
// 입력이 짧을 때 (예: "dan") 매칭되는 라벨을 모두 보여줌
export function getDestinationSuggestions(input?: string): { value: string; matrixKey: string | null; display: string }[] {
  const list: { value: string; matrixKey: string | null; display: string }[] = [];
  for (const entry of ENTRIES) {
    for (const label of entry.labels) {
      list.push({ value: label, matrixKey: entry.matrixKey, display: entry.display });
    }
  }
  // 매트릭스 미존재지만 입력 자주 — 별도견적 안내
  for (const u of UNMATCHED_LIKELY) {
    list.push({ value: u, matrixKey: null, display: `${u} (별도 견적)` });
  }
  if (!input || input.length < 1) return list.slice(0, 30);
  const cleaned = normalize(input);
  return list.filter(s => normalize(s.value).includes(cleaned)).slice(0, 30);
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
