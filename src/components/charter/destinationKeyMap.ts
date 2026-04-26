// destinationKeyMap — 한글/영문 자유 입력 → distance_matrix 영문 키 정규화
//                     + 권역 분류 (zone fallback)
// Step3 destinationCustom + useQuoteCalculator + resolveProductType 공용.
//
// 매트릭스 21개 키는 자동 견적 가능, 매트릭스 외 ~180개는 권역 평균 km로 fallback.

export type Zone = 'capital' | 'chungcheong' | 'gangwon' | 'honam' | 'yeongnam' | 'jeju';

interface MapEntry {
  matrixKey: string | null;   // null = 매트릭스 없음 → zone fallback 시도
  zone: Zone;
  labels: string[];
  display: string;
}

// 권역별 서울 출발 평균 km / hours — 매트릭스 미존재 도시의 fallback에 사용
// origin이 SEL_METRO/ICN/GMP일 때만 적용. 다른 출발지는 needsCustomQuote.
export const ZONE_DEFAULTS: Record<Zone, { km: number; hours: number; label: string }> = {
  capital:     { km: 50,  hours: 1.0, label: '수도권' },
  chungcheong: { km: 200, hours: 2.5, label: '충청권' },
  gangwon:     { km: 250, hours: 3.0, label: '강원권' },
  honam:       { km: 370, hours: 4.0, label: '호남권' },
  yeongnam:    { km: 420, hours: 4.5, label: '영남권' },
  jeju:        { km: 0,   hours: 0,   label: '제주권' }, // 도선료/항공료 별도
};

// 매트릭스 키 → zone 매핑
const MATRIX_KEY_TO_ZONE: Record<string, Zone> = {
  SEL_METRO: 'capital',
  SEL_GANGNAM: 'capital',
  SUWON: 'capital',
  GAPYEONG: 'capital',
  GANGNEUNG: 'gangwon',
  SOKCHO: 'gangwon',
  CHUNCHEON: 'gangwon',
  PYEONGCHANG: 'gangwon',
  DAEJEON: 'chungcheong',
  DAMYANG: 'honam',     // 매트릭스 SEL_METRO→DAMYANG 300km — 전남 담양 기준
  GYEONGJU: 'yeongnam',
  ANDONG: 'yeongnam',
  DAEGU: 'yeongnam',
  BUSAN: 'yeongnam',
  BUS_METRO: 'yeongnam',
  JEONJU: 'honam',
  YEOSU: 'honam',
  JEJU_METRO: 'jeju',
  SEOGWIPO: 'jeju',
  SEONGSAN: 'jeju',
  HALLASAN: 'jeju',
};

// ─────────────────────────────────────────────────────────
// 매트릭스 21개 키 — 자동 견적 가능
// ─────────────────────────────────────────────────────────
const MATCHED: MapEntry[] = [
  // 서울특별시
  { matrixKey: 'SEL_METRO',   zone: 'capital', labels: ['서울', '서울시', '서울시내', '서울특별시', 'seoul', 'seoul metro', 'seoul city', '명동', '홍대', '종로', '마포', '용산', '이태원', '광화문', '동대문', '인사동', '북촌', '서대문', '중구', '성수', '여의도', 'myeongdong', 'hongdae', 'jongno', 'mapo', 'yongsan', 'itaewon', 'gwanghwamun', 'dongdaemun', 'insadong', 'bukchon', 'seongsu', 'yeouido'], display: '서울 시내 (Seoul Metro)' },
  { matrixKey: 'SEL_GANGNAM', zone: 'capital', labels: ['강남', '잠실', '송파', '서초', '강남구', '서초구', '송파구', 'gangnam', 'jamsil', 'songpa', 'seocho'], display: '서울 강남·잠실 (Gangnam)' },
  // 부산
  { matrixKey: 'BUSAN',       zone: 'yeongnam', labels: ['부산', '부산시', '부산광역시', '부산시내', 'busan', 'busan city', '해운대', '광안', '광안리', '동래', '감천', '서면', '영도', '센텀시티', '광안대교', '태종대', 'haeundae', 'gwangan', 'gwangalli', 'dongnae', 'gamcheon', 'seomyeon', 'centum', 'taejongdae'], display: '부산 (Busan)' },
  // 제주
  { matrixKey: 'JEJU_METRO',  zone: 'jeju', labels: ['제주', '제주시', '제주특별자치도', 'jeju', 'jeju metro', 'jeju city'], display: '제주 시내 (Jeju Metro)' },
  { matrixKey: 'SEOGWIPO',    zone: 'jeju', labels: ['서귀포', '서귀포시', 'seogwipo'], display: '서귀포 (Seogwipo)' },
  { matrixKey: 'SEONGSAN',    zone: 'jeju', labels: ['성산', '성산일출봉', 'seongsan', 'seongsan ilchulbong'], display: '성산 (Seongsan)' },
  { matrixKey: 'HALLASAN',    zone: 'jeju', labels: ['한라산', 'hallasan'], display: '한라산 (Hallasan)' },
  // 강원
  { matrixKey: 'GANGNEUNG',   zone: 'gangwon', labels: ['강릉', '강릉시', '경포대', '정동진', 'gangneung', 'gyeongpodae', 'jeongdongjin'], display: '강릉 (Gangneung)' },
  { matrixKey: 'SOKCHO',      zone: 'gangwon', labels: ['속초', '속초시', 'sokcho', '설악산', '설악', '낙산사', 'seoraksan', 'naksansa'], display: '속초·설악 (Sokcho)' },
  { matrixKey: 'CHUNCHEON',   zone: 'gangwon', labels: ['춘천', '춘천시', 'chuncheon'], display: '춘천 (Chuncheon)' },
  { matrixKey: 'PYEONGCHANG', zone: 'gangwon', labels: ['평창', '평창군', '용평', '알펜시아', '하이원', '비발디', '월정사', '대관령', 'pyeongchang', 'yongpyong', 'alpensia', 'high1', 'vivaldi'], display: '평창·용평·알펜시아 (Pyeongchang)' },
  // 경기
  { matrixKey: 'SUWON',       zone: 'capital', labels: ['수원', '수원시', '수원화성', '용인', '용인시', '에버랜드', '한국민속촌', 'suwon', 'yongin', 'everland', 'korean folk village'], display: '수원·용인 (Suwon / Yongin)' },
  { matrixKey: 'GAPYEONG',    zone: 'capital', labels: ['가평', '가평군', '남이섬', '쁘띠프랑스', '아침고요', '아침고요수목원', '레일바이크', '에델바이스', '자라섬', '청평', 'gapyeong', 'nami', 'nami island', 'petite france', 'morning calm', 'rail bike'], display: '가평·남이섬 (Gapyeong / Nami)' },
  // 충청
  { matrixKey: 'DAEJEON',     zone: 'chungcheong', labels: ['대전', '대전시', '대전광역시', 'daejeon'], display: '대전 (Daejeon)' },
  { matrixKey: 'DAMYANG',     zone: 'honam', labels: ['담양', '담양군', '죽녹원', '메타세쿼이아', 'damyang'], display: '담양 (Damyang) — 전남' },
  // 경상
  { matrixKey: 'GYEONGJU',    zone: 'yeongnam', labels: ['경주', '경주시', '불국사', '석굴암', '동궁과월지', '첨성대', '대릉원', 'gyeongju', 'bulguksa', 'seokguram'], display: '경주 (Gyeongju)' },
  { matrixKey: 'ANDONG',      zone: 'yeongnam', labels: ['안동', '안동시', '하회마을', '병산서원', 'andong', 'hahoe'], display: '안동·하회 (Andong)' },
  { matrixKey: 'DAEGU',       zone: 'yeongnam', labels: ['대구', '대구시', '대구광역시', 'daegu'], display: '대구 (Daegu)' },
  // 전라
  { matrixKey: 'JEONJU',      zone: 'honam', labels: ['전주', '전주시', '한옥마을', '경기전', 'jeonju', 'hanok village'], display: '전주 (Jeonju)' },
  { matrixKey: 'YEOSU',       zone: 'honam', labels: ['여수', '여수시', '오동도', '여수해상케이블카', 'yeosu'], display: '여수 (Yeosu)' },
];

// ─────────────────────────────────────────────────────────
// 매트릭스 미존재 — zone fallback 가격 (출발지 SEL/ICN/GMP일 때 적용)
// ─────────────────────────────────────────────────────────
const UNMATCHED: MapEntry[] = [
  // 광역시 (도착지 매트릭스 없음, 권역 fallback 적용)
  { matrixKey: null, zone: 'capital',     labels: ['인천', '인천시', '인천광역시', 'incheon city'], display: '인천 (Incheon) — 수도권' },
  { matrixKey: null, zone: 'honam',       labels: ['광주', '광주시', '광주광역시', 'gwangju'], display: '광주 (Gwangju) — 호남권' },
  { matrixKey: null, zone: 'yeongnam',    labels: ['울산', '울산시', '울산광역시', 'ulsan'], display: '울산 (Ulsan) — 영남권' },
  { matrixKey: null, zone: 'chungcheong', labels: ['세종', '세종시', '세종특별자치시', 'sejong'], display: '세종 (Sejong) — 충청권' },

  // 경기도 (capital)
  { matrixKey: null, zone: 'capital', labels: ['성남', '성남시', '분당', '판교', 'seongnam', 'bundang', 'pangyo'], display: '성남·분당 (Seongnam)' },
  { matrixKey: null, zone: 'capital', labels: ['부천', '부천시', 'bucheon'], display: '부천 (Bucheon)' },
  { matrixKey: null, zone: 'capital', labels: ['안산', '안산시', 'ansan'], display: '안산 (Ansan)' },
  { matrixKey: null, zone: 'capital', labels: ['안양', '안양시', 'anyang'], display: '안양 (Anyang)' },
  { matrixKey: null, zone: 'capital', labels: ['평택', '평택시', 'pyeongtaek'], display: '평택 (Pyeongtaek)' },
  { matrixKey: null, zone: 'capital', labels: ['시흥', '시흥시', 'siheung'], display: '시흥 (Siheung)' },
  { matrixKey: null, zone: 'capital', labels: ['김포', '김포시', 'gimpo'], display: '김포 (Gimpo)' },
  { matrixKey: null, zone: 'capital', labels: ['광명', '광명시', 'gwangmyeong'], display: '광명 (Gwangmyeong)' },
  { matrixKey: null, zone: 'capital', labels: ['군포', '군포시', 'gunpo'], display: '군포 (Gunpo)' },
  { matrixKey: null, zone: 'capital', labels: ['오산', '오산시', 'osan'], display: '오산 (Osan)' },
  { matrixKey: null, zone: 'capital', labels: ['의정부', '의정부시', 'uijeongbu'], display: '의정부 (Uijeongbu)' },
  { matrixKey: null, zone: 'capital', labels: ['양주', '양주시', 'yangju'], display: '양주 (Yangju)' },
  { matrixKey: null, zone: 'capital', labels: ['구리', '구리시', 'guri'], display: '구리 (Guri)' },
  { matrixKey: null, zone: 'capital', labels: ['남양주', '남양주시', 'namyangju'], display: '남양주 (Namyangju)' },
  { matrixKey: null, zone: 'capital', labels: ['파주', '파주시', '임진각', '판문점', 'paju', 'imjingak', 'panmunjom'], display: '파주·DMZ (Paju)' },
  { matrixKey: null, zone: 'capital', labels: ['화성', '화성시', '화성행궁', 'hwaseong'], display: '화성 (Hwaseong)' },
  { matrixKey: null, zone: 'capital', labels: ['포천', '포천시', '포천아트밸리', '허브아일랜드', 'pocheon'], display: '포천 (Pocheon)' },
  { matrixKey: null, zone: 'capital', labels: ['양평', '양평군', '두물머리', 'yangpyeong', 'dumulmeori'], display: '양평·두물머리 (Yangpyeong)' },
  { matrixKey: null, zone: 'capital', labels: ['여주', '여주시', 'yeoju'], display: '여주 (Yeoju)' },
  { matrixKey: null, zone: 'capital', labels: ['이천', '이천시', 'icheon'], display: '이천 (Icheon)' },
  { matrixKey: null, zone: 'capital', labels: ['안성', '안성시', 'anseong'], display: '안성 (Anseong)' },
  { matrixKey: null, zone: 'capital', labels: ['하남', '하남시', '미사', 'hanam', 'misa'], display: '하남 (Hanam)' },
  { matrixKey: null, zone: 'capital', labels: ['의왕', '의왕시', 'uiwang'], display: '의왕 (Uiwang)' },
  { matrixKey: null, zone: 'capital', labels: ['과천', '과천시', 'gwacheon'], display: '과천 (Gwacheon)' },
  { matrixKey: null, zone: 'capital', labels: ['동두천', '동두천시', 'dongducheon'], display: '동두천 (Dongducheon)' },
  { matrixKey: null, zone: 'capital', labels: ['연천', '연천군', 'yeoncheon'], display: '연천 (Yeoncheon)' },

  // 강원도 (gangwon)
  { matrixKey: null, zone: 'gangwon', labels: ['원주', '원주시', 'wonju'], display: '원주 (Wonju)' },
  { matrixKey: null, zone: 'gangwon', labels: ['동해', '동해시', 'donghae'], display: '동해 (Donghae)' },
  { matrixKey: null, zone: 'gangwon', labels: ['태백', '태백시', 'taebaek'], display: '태백 (Taebaek)' },
  { matrixKey: null, zone: 'gangwon', labels: ['삼척', '삼척시', 'samcheok'], display: '삼척 (Samcheok)' },
  { matrixKey: null, zone: 'gangwon', labels: ['홍천', '홍천군', 'hongcheon'], display: '홍천 (Hongcheon)' },
  { matrixKey: null, zone: 'gangwon', labels: ['횡성', '횡성군', 'hoengseong'], display: '횡성 (Hoengseong)' },
  { matrixKey: null, zone: 'gangwon', labels: ['영월', '영월군', 'yeongwol'], display: '영월 (Yeongwol)' },
  { matrixKey: null, zone: 'gangwon', labels: ['정선', '정선군', 'jeongseon'], display: '정선 (Jeongseon)' },
  { matrixKey: null, zone: 'gangwon', labels: ['철원', '철원군', 'cheorwon'], display: '철원 (Cheorwon)' },
  { matrixKey: null, zone: 'gangwon', labels: ['화천', '화천군', 'hwacheon'], display: '화천 (Hwacheon)' },
  { matrixKey: null, zone: 'gangwon', labels: ['양구', '양구군', 'yanggu'], display: '양구 (Yanggu)' },
  { matrixKey: null, zone: 'gangwon', labels: ['인제', '인제군', 'inje'], display: '인제 (Inje)' },
  { matrixKey: null, zone: 'gangwon', labels: ['고성(강원)', '고성군(강원)', 'goseong gangwon'], display: '고성 (강원·Goseong)' },
  { matrixKey: null, zone: 'gangwon', labels: ['양양', '양양군', '서피비치', 'yangyang', 'surfy beach'], display: '양양 (Yangyang)' },

  // 충청북도 (chungcheong)
  { matrixKey: null, zone: 'chungcheong', labels: ['청주', '청주시', 'cheongju'], display: '청주 (Cheongju)' },
  { matrixKey: null, zone: 'chungcheong', labels: ['충주', '충주시', 'chungju'], display: '충주 (Chungju)' },
  { matrixKey: null, zone: 'chungcheong', labels: ['제천', '제천시', 'jecheon'], display: '제천 (Jecheon)' },
  { matrixKey: null, zone: 'chungcheong', labels: ['단양', '단양군', 'danyang'], display: '단양 (Danyang) — 충북' },
  { matrixKey: null, zone: 'chungcheong', labels: ['진천', '진천군', 'jincheon'], display: '진천 (Jincheon)' },
  { matrixKey: null, zone: 'chungcheong', labels: ['괴산', '괴산군', 'goesan'], display: '괴산 (Goesan)' },
  { matrixKey: null, zone: 'chungcheong', labels: ['음성', '음성군', 'eumseong'], display: '음성 (Eumseong)' },
  { matrixKey: null, zone: 'chungcheong', labels: ['영동', '영동군', 'yeongdong'], display: '영동 (Yeongdong)' },
  { matrixKey: null, zone: 'chungcheong', labels: ['보은', '보은군', 'boeun'], display: '보은 (Boeun)' },
  { matrixKey: null, zone: 'chungcheong', labels: ['옥천', '옥천군', 'okcheon'], display: '옥천 (Okcheon)' },
  { matrixKey: null, zone: 'chungcheong', labels: ['증평', '증평군', 'jeungpyeong'], display: '증평 (Jeungpyeong)' },

  // 충청남도 (chungcheong)
  { matrixKey: null, zone: 'chungcheong', labels: ['천안', '천안시', 'cheonan'], display: '천안 (Cheonan)' },
  { matrixKey: null, zone: 'chungcheong', labels: ['공주', '공주시', 'gongju'], display: '공주 (Gongju)' },
  { matrixKey: null, zone: 'chungcheong', labels: ['보령', '보령시', '대천', 'boryeong', 'daecheon'], display: '보령·대천 (Boryeong)' },
  { matrixKey: null, zone: 'chungcheong', labels: ['아산', '아산시', 'asan'], display: '아산 (Asan)' },
  { matrixKey: null, zone: 'chungcheong', labels: ['서산', '서산시', 'seosan'], display: '서산 (Seosan)' },
  { matrixKey: null, zone: 'chungcheong', labels: ['논산', '논산시', 'nonsan'], display: '논산 (Nonsan)' },
  { matrixKey: null, zone: 'chungcheong', labels: ['계룡', '계룡시', 'gyeryong'], display: '계룡 (Gyeryong)' },
  { matrixKey: null, zone: 'chungcheong', labels: ['당진', '당진시', 'dangjin'], display: '당진 (Dangjin)' },
  { matrixKey: null, zone: 'chungcheong', labels: ['금산', '금산군', 'geumsan'], display: '금산 (Geumsan)' },
  { matrixKey: null, zone: 'chungcheong', labels: ['부여', '부여군', 'buyeo'], display: '부여 (Buyeo)' },
  { matrixKey: null, zone: 'chungcheong', labels: ['서천', '서천군', 'seocheon'], display: '서천 (Seocheon)' },
  { matrixKey: null, zone: 'chungcheong', labels: ['청양', '청양군', 'cheongyang'], display: '청양 (Cheongyang)' },
  { matrixKey: null, zone: 'chungcheong', labels: ['홍성', '홍성군', 'hongseong'], display: '홍성 (Hongseong)' },
  { matrixKey: null, zone: 'chungcheong', labels: ['예산', '예산군', 'yesan'], display: '예산 (Yesan)' },
  { matrixKey: null, zone: 'chungcheong', labels: ['태안', '태안군', '안면도', 'taean', 'anmyeondo'], display: '태안·안면도 (Taean)' },

  // 전라북도 (honam)
  { matrixKey: null, zone: 'honam', labels: ['군산', '군산시', 'gunsan'], display: '군산 (Gunsan)' },
  { matrixKey: null, zone: 'honam', labels: ['익산', '익산시', 'iksan'], display: '익산 (Iksan)' },
  { matrixKey: null, zone: 'honam', labels: ['정읍', '정읍시', 'jeongeup'], display: '정읍 (Jeongeup)' },
  { matrixKey: null, zone: 'honam', labels: ['남원', '남원시', 'namwon'], display: '남원 (Namwon)' },
  { matrixKey: null, zone: 'honam', labels: ['김제', '김제시', 'gimje'], display: '김제 (Gimje)' },
  { matrixKey: null, zone: 'honam', labels: ['완주', '완주군', 'wanju'], display: '완주 (Wanju)' },
  { matrixKey: null, zone: 'honam', labels: ['진안', '진안군', 'jinan'], display: '진안 (Jinan)' },
  { matrixKey: null, zone: 'honam', labels: ['무주', '무주군', 'muju'], display: '무주 (Muju)' },
  { matrixKey: null, zone: 'honam', labels: ['장수', '장수군', 'jangsu'], display: '장수 (Jangsu)' },
  { matrixKey: null, zone: 'honam', labels: ['임실', '임실군', 'imsil'], display: '임실 (Imsil)' },
  { matrixKey: null, zone: 'honam', labels: ['순창', '순창군', 'sunchang'], display: '순창 (Sunchang)' },
  { matrixKey: null, zone: 'honam', labels: ['고창', '고창군', 'gochang'], display: '고창 (Gochang)' },
  { matrixKey: null, zone: 'honam', labels: ['부안', '부안군', 'buan'], display: '부안 (Buan)' },

  // 전라남도 (honam)
  { matrixKey: null, zone: 'honam', labels: ['목포', '목포시', 'mokpo'], display: '목포 (Mokpo)' },
  { matrixKey: null, zone: 'honam', labels: ['순천', '순천시', '순천만', 'suncheon', 'suncheon bay'], display: '순천·순천만 (Suncheon)' },
  { matrixKey: null, zone: 'honam', labels: ['나주', '나주시', 'naju'], display: '나주 (Naju)' },
  { matrixKey: null, zone: 'honam', labels: ['광양', '광양시', 'gwangyang'], display: '광양 (Gwangyang)' },
  { matrixKey: null, zone: 'honam', labels: ['곡성', '곡성군', 'gokseong'], display: '곡성 (Gokseong)' },
  { matrixKey: null, zone: 'honam', labels: ['구례', '구례군', '지리산', 'gurye', 'jirisan'], display: '구례·지리산 (Gurye)' },
  { matrixKey: null, zone: 'honam', labels: ['고흥', '고흥군', 'goheung'], display: '고흥 (Goheung)' },
  { matrixKey: null, zone: 'honam', labels: ['보성', '보성군', '녹차밭', 'boseong', 'green tea'], display: '보성·녹차밭 (Boseong)' },
  { matrixKey: null, zone: 'honam', labels: ['화순', '화순군', 'hwasun'], display: '화순 (Hwasun)' },
  { matrixKey: null, zone: 'honam', labels: ['장흥', '장흥군', 'jangheung'], display: '장흥 (Jangheung)' },
  { matrixKey: null, zone: 'honam', labels: ['강진', '강진군', 'gangjin'], display: '강진 (Gangjin)' },
  { matrixKey: null, zone: 'honam', labels: ['해남', '해남군', '땅끝마을', 'haenam'], display: '해남·땅끝 (Haenam)' },
  { matrixKey: null, zone: 'honam', labels: ['영암', '영암군', 'yeongam'], display: '영암 (Yeongam)' },
  { matrixKey: null, zone: 'honam', labels: ['무안', '무안군', 'muan'], display: '무안 (Muan)' },
  { matrixKey: null, zone: 'honam', labels: ['함평', '함평군', 'hampyeong'], display: '함평 (Hampyeong)' },
  { matrixKey: null, zone: 'honam', labels: ['영광', '영광군', 'yeonggwang'], display: '영광 (Yeonggwang)' },
  { matrixKey: null, zone: 'honam', labels: ['장성', '장성군', 'jangseong'], display: '장성 (Jangseong)' },
  { matrixKey: null, zone: 'honam', labels: ['완도', '완도군', 'wando'], display: '완도 (Wando)' },
  { matrixKey: null, zone: 'honam', labels: ['진도', '진도군', 'jindo'], display: '진도 (Jindo)' },
  { matrixKey: null, zone: 'honam', labels: ['신안', '신안군', '증도', 'sinan', 'jeungdo'], display: '신안·증도 (Sinan)' },

  // 경상북도 (yeongnam)
  { matrixKey: null, zone: 'yeongnam', labels: ['포항', '포항시', '호미곶', 'pohang', 'homigot'], display: '포항·호미곶 (Pohang)' },
  { matrixKey: null, zone: 'yeongnam', labels: ['김천', '김천시', 'gimcheon'], display: '김천 (Gimcheon)' },
  { matrixKey: null, zone: 'yeongnam', labels: ['구미', '구미시', 'gumi'], display: '구미 (Gumi)' },
  { matrixKey: null, zone: 'yeongnam', labels: ['영주', '영주시', '부석사', 'yeongju', 'buseoksa'], display: '영주·부석사 (Yeongju)' },
  { matrixKey: null, zone: 'yeongnam', labels: ['영천', '영천시', 'yeongcheon'], display: '영천 (Yeongcheon)' },
  { matrixKey: null, zone: 'yeongnam', labels: ['상주', '상주시', 'sangju'], display: '상주 (Sangju)' },
  { matrixKey: null, zone: 'yeongnam', labels: ['문경', '문경시', '새재', 'mungyeong', 'saejae'], display: '문경 (Mungyeong)' },
  { matrixKey: null, zone: 'yeongnam', labels: ['경산', '경산시', 'gyeongsan'], display: '경산 (Gyeongsan)' },
  { matrixKey: null, zone: 'yeongnam', labels: ['군위', '군위군', 'gunwi'], display: '군위 (Gunwi)' },
  { matrixKey: null, zone: 'yeongnam', labels: ['의성', '의성군', 'uiseong'], display: '의성 (Uiseong)' },
  { matrixKey: null, zone: 'yeongnam', labels: ['청송', '청송군', 'cheongsong'], display: '청송 (Cheongsong)' },
  { matrixKey: null, zone: 'yeongnam', labels: ['영양', '영양군', 'yeongyang'], display: '영양 (Yeongyang)' },
  { matrixKey: null, zone: 'yeongnam', labels: ['영덕', '영덕군', 'yeongdeok'], display: '영덕 (Yeongdeok)' },
  { matrixKey: null, zone: 'yeongnam', labels: ['청도', '청도군', 'cheongdo'], display: '청도 (Cheongdo)' },
  { matrixKey: null, zone: 'yeongnam', labels: ['고령', '고령군', 'goryeong'], display: '고령 (Goryeong)' },
  { matrixKey: null, zone: 'yeongnam', labels: ['성주', '성주군', 'seongju'], display: '성주 (Seongju)' },
  { matrixKey: null, zone: 'yeongnam', labels: ['칠곡', '칠곡군', 'chilgok'], display: '칠곡 (Chilgok)' },
  { matrixKey: null, zone: 'yeongnam', labels: ['예천', '예천군', 'yecheon'], display: '예천 (Yecheon)' },
  { matrixKey: null, zone: 'yeongnam', labels: ['봉화', '봉화군', 'bonghwa'], display: '봉화 (Bonghwa)' },
  { matrixKey: null, zone: 'yeongnam', labels: ['울진', '울진군', 'uljin'], display: '울진 (Uljin)' },
  { matrixKey: null, zone: 'yeongnam', labels: ['울릉', '울릉도', '울릉군', '독도', 'ulleung', 'ulleungdo', 'dokdo'], display: '울릉도·독도 (Ulleung / Dokdo) — 별도견적' },

  // 경상남도 (yeongnam)
  { matrixKey: null, zone: 'yeongnam', labels: ['창원', '창원시', '마산', '진해', 'changwon', 'masan', 'jinhae'], display: '창원·마산·진해 (Changwon)' },
  { matrixKey: null, zone: 'yeongnam', labels: ['진주', '진주시', 'jinju'], display: '진주 (Jinju)' },
  { matrixKey: null, zone: 'yeongnam', labels: ['통영', '통영시', '한산도', 'tongyeong', 'hansando'], display: '통영·한산도 (Tongyeong)' },
  { matrixKey: null, zone: 'yeongnam', labels: ['사천', '사천시', 'sacheon'], display: '사천 (Sacheon)' },
  { matrixKey: null, zone: 'yeongnam', labels: ['김해', '김해시', 'gimhae'], display: '김해 (Gimhae)' },
  { matrixKey: null, zone: 'yeongnam', labels: ['밀양', '밀양시', 'miryang'], display: '밀양 (Miryang)' },
  { matrixKey: null, zone: 'yeongnam', labels: ['거제', '거제시', '거제도', '외도', 'geoje', 'oedo'], display: '거제·외도 (Geoje)' },
  { matrixKey: null, zone: 'yeongnam', labels: ['양산', '양산시', '통도사', 'yangsan', 'tongdosa'], display: '양산·통도사 (Yangsan)' },
  { matrixKey: null, zone: 'yeongnam', labels: ['의령', '의령군', 'uiryeong'], display: '의령 (Uiryeong)' },
  { matrixKey: null, zone: 'yeongnam', labels: ['함안', '함안군', 'haman'], display: '함안 (Haman)' },
  { matrixKey: null, zone: 'yeongnam', labels: ['창녕', '창녕군', '우포늪', 'changnyeong', 'upo'], display: '창녕·우포늪 (Changnyeong)' },
  { matrixKey: null, zone: 'yeongnam', labels: ['고성(경남)', '고성군(경남)', 'goseong gyeongnam'], display: '고성 (경남·Goseong)' },
  { matrixKey: null, zone: 'yeongnam', labels: ['남해', '남해군', '남해도', 'namhae'], display: '남해 (Namhae)' },
  { matrixKey: null, zone: 'yeongnam', labels: ['하동', '하동군', '쌍계사', 'hadong'], display: '하동·쌍계사 (Hadong)' },
  { matrixKey: null, zone: 'yeongnam', labels: ['산청', '산청군', 'sancheong'], display: '산청 (Sancheong)' },
  { matrixKey: null, zone: 'yeongnam', labels: ['함양', '함양군', 'hamyang'], display: '함양 (Hamyang)' },
  { matrixKey: null, zone: 'yeongnam', labels: ['거창', '거창군', 'geochang'], display: '거창 (Geochang)' },
  { matrixKey: null, zone: 'yeongnam', labels: ['합천', '합천군', '해인사', 'hapcheon', 'haeinsa'], display: '합천·해인사 (Hapcheon)' },
];

const ENTRIES: MapEntry[] = [...MATCHED, ...UNMATCHED];

function normalize(input: string): string {
  return input.trim().toLowerCase().replace(/[\s·\-_]/g, '');
}

// ─────────────────────────────────────────────────────────
// API
// ─────────────────────────────────────────────────────────

// 매트릭스 키 정규화 — 매트릭스에 있는 21개 키만 반환 (null = zone fallback 또는 별도견적)
export function normalizeDestinationToMatrixKey(input: string): string | null {
  if (!input) return null;
  const cleaned = normalize(input);
  if (cleaned.length < 1) return null;

  for (const entry of ENTRIES) {
    for (const label of entry.labels) {
      if (normalize(label) === cleaned) return entry.matrixKey;
    }
  }
  for (const entry of ENTRIES) {
    for (const label of entry.labels) {
      const nl = normalize(label);
      if (cleaned.length >= 2 && nl.includes(cleaned)) return entry.matrixKey;
      if (nl.length >= 3 && cleaned.includes(nl)) return entry.matrixKey;
    }
  }
  return null;
}

// 입력 → 권역 매핑 (zone fallback 위해 사용)
export function getZoneForInput(input: string): Zone | null {
  if (!input) return null;
  const cleaned = normalize(input);

  for (const entry of ENTRIES) {
    for (const label of entry.labels) {
      if (normalize(label) === cleaned) return entry.zone;
    }
  }
  for (const entry of ENTRIES) {
    for (const label of entry.labels) {
      const nl = normalize(label);
      if (cleaned.length >= 2 && nl.includes(cleaned)) return entry.zone;
      if (nl.length >= 3 && cleaned.includes(nl)) return entry.zone;
    }
  }
  return null;
}

// 매트릭스 키 → 권역 매핑
export function getZoneForMatrixKey(matrixKey: string): Zone | null {
  return MATRIX_KEY_TO_ZONE[matrixKey] ?? null;
}

// 매트릭스 lookup METRO ↔ city 키 fallback
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

// 자동완성 후보
export function getDestinationSuggestions(input?: string): { value: string; matrixKey: string | null; display: string; zone: Zone }[] {
  const list: { value: string; matrixKey: string | null; display: string; zone: Zone }[] = [];
  for (const entry of ENTRIES) {
    for (const label of entry.labels) {
      list.push({ value: label, matrixKey: entry.matrixKey, display: entry.display, zone: entry.zone });
    }
  }
  if (!input || input.length < 1) return list.slice(0, 50);
  const cleaned = normalize(input);
  return list.filter(s => normalize(s.value).includes(cleaned)).slice(0, 50);
}

// day_tour 패키지 키 매핑
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
