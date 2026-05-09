// B9-33 (2026-05-09): 호텔 주소 → 직행 공항버스 hub 매핑.
//
// 배경: ODsay (RouteAgent) 는 호텔→공항 경로로 지하철 환승 위주 결과를 자주 반환.
// 사용자 신고 — 짐 많을 때 6015/6005 직행 공항버스가 환승 0회로 더 편한데
// DepartureGuide 에 해당 옵션이 노출되지 않음. 명동·강남 등 주요 hub 출발 호텔의
// 경우 직행 버스 카드를 추가해 사용자가 선택할 수 있도록 한다.
//
// 데이터 출처: 인천공항 6000번대 리무진 노선 (한국 공항 리무진 / 칼리무진).
// 가격/소요시간은 일반 정보 — 트래픽/시즌에 따라 변동, 사용자가 prod 검증 시 수정 가능.
// ICN T1/T2 모두 정차하므로 별도 분기 불필요.

export type AirportBusHubKey =
  | 'myeongdong'
  | 'hongdae'
  | 'jongno'
  | 'dongdaemun'
  | 'gangnam'
  | 'jamsil'
  | 'gapyeong';

export interface AirportBusInfo {
  /** 노선 번호 (사용자에게 표시) */
  busNo: string;
  /** 정류장 위치 (한국어 짧은 라벨) */
  stopKo: string;
  /** 정류장 위치 (영어 짧은 라벨) */
  stopEn: string;
  /** 일반 소요 시간 (분) — 트래픽 평균치 */
  durationMin: number;
  /** 1인 운임 (KRW) */
  priceKRW: number;
  /** 환승 횟수 (직행은 0) */
  transfers: number;
}

/** Hub 키 → 추천 버스 노선 메타데이터. */
export const AIRPORT_BUS_BY_HUB: Record<AirportBusHubKey, AirportBusInfo> = {
  myeongdong: {
    busNo: '6015',
    stopKo: '명동역 6번 출구',
    stopEn: 'Myeongdong Stn Exit 6',
    durationMin: 60,
    priceKRW: 17000,
    transfers: 0,
  },
  hongdae: {
    busNo: '6015',
    stopKo: '홍대입구역',
    stopEn: 'Hongik Univ. Stn',
    durationMin: 70,
    priceKRW: 17000,
    transfers: 0,
  },
  jongno: {
    busNo: '6015',
    stopKo: '종로 (광화문 인근)',
    stopEn: 'Jongno (near Gwanghwamun)',
    durationMin: 65,
    priceKRW: 17000,
    transfers: 0,
  },
  dongdaemun: {
    busNo: '6015',
    stopKo: '동대문',
    stopEn: 'Dongdaemun',
    durationMin: 70,
    priceKRW: 17000,
    transfers: 0,
  },
  gangnam: {
    busNo: '6005',
    stopKo: '강남역',
    stopEn: 'Gangnam Stn',
    durationMin: 75,
    priceKRW: 17000,
    transfers: 0,
  },
  jamsil: {
    busNo: '6005',
    stopKo: '잠실역',
    stopEn: 'Jamsil Stn',
    durationMin: 80,
    priceKRW: 17000,
    transfers: 0,
  },
  gapyeong: {
    busNo: '6020',
    stopKo: '가평/남이섬',
    stopEn: 'Gapyeong/Nami Island',
    durationMin: 150,
    priceKRW: 30000,
    transfers: 0,
  },
};

/**
 * 호텔 주소 / zone 라벨에서 hub 키워드 추출.
 * 한국어 + 영문(romanization) + 변종(Myeong-dong, Hong-dae 등) 모두 매칭.
 *
 * @param raw  호텔 주소 또는 zone 표현 (한/영 혼합 OK)
 * @returns 매칭된 hub key. 매칭 실패 시 null.
 */
export function detectHubFromAddress(raw: string | null | undefined): AirportBusHubKey | null {
  if (!raw) return null;
  // 소문자 + 공백/하이픈 제거 — Myeong-dong / Myeongdong / MyeongDong 모두 myeongdong 으로 정규화
  const norm = raw.toLowerCase().replace(/[\s\-_]/g, '');

  // 한국어 키워드는 원본 그대로 검사 (정규화 영향 없음)
  if (raw.includes('명동')) return 'myeongdong';
  if (raw.includes('홍대') || raw.includes('홍익')) return 'hongdae';
  // "종로" 와 "종로구" 모두 매칭. "종각" 도 종로 인근.
  if (raw.includes('종로') || raw.includes('광화문') || raw.includes('종각')) return 'jongno';
  if (raw.includes('동대문')) return 'dongdaemun';
  // "강남" / "강남구" / "역삼"(강남역 인근)
  if (raw.includes('강남') || raw.includes('역삼') || raw.includes('신논현')) return 'gangnam';
  if (raw.includes('잠실') || raw.includes('송파')) return 'jamsil';
  if (raw.includes('가평') || raw.includes('남이섬')) return 'gapyeong';

  // 영문 — Myeong-dong, Hongdae, Gangnam, Jamsil 등.
  if (norm.includes('myeongdong')) return 'myeongdong';
  if (norm.includes('hongdae') || norm.includes('hongik')) return 'hongdae';
  if (norm.includes('jongno') || norm.includes('gwanghwamun')) return 'jongno';
  if (norm.includes('dongdaemun')) return 'dongdaemun';
  if (norm.includes('gangnam') || norm.includes('yeoksam')) return 'gangnam';
  if (norm.includes('jamsil') || norm.includes('songpa')) return 'jamsil';
  if (norm.includes('gapyeong') || norm.includes('namiisland') || norm.includes('nami')) return 'gapyeong';

  return null;
}

/**
 * 4 언어 hub 라벨 — DepartureGuide 헤더에 "🏨 명동에서 출발" 형태로 표시.
 * 키 추가 시 detectHubFromAddress 도 함께 업데이트할 것.
 */
export const HUB_LABELS: Record<AirportBusHubKey, { ko: string; en: string; ja: string; zh: string }> = {
  myeongdong: { ko: '명동', en: 'Myeongdong', ja: '明洞', zh: '明洞' },
  hongdae: { ko: '홍대', en: 'Hongdae', ja: '弘大', zh: '弘大' },
  jongno: { ko: '종로', en: 'Jongno', ja: '鍾路', zh: '钟路' },
  dongdaemun: { ko: '동대문', en: 'Dongdaemun', ja: '東大門', zh: '东大门' },
  gangnam: { ko: '강남', en: 'Gangnam', ja: '江南', zh: '江南' },
  jamsil: { ko: '잠실', en: 'Jamsil', ja: '蚕室', zh: '蚕室' },
  gapyeong: { ko: '가평', en: 'Gapyeong', ja: '加平', zh: '加平' },
};
