// destinationKeyMap — 한글/영문 자유 입력 → distance_matrix 영문 키 정규화.
// Step3 destinationCustom + useQuoteCalculator + resolveProductType에서 공용.
//
// 전국 시·군 + 광역시·자치구 단위 등록 (~200개).
// matrixKey 있는 21개는 자동 견적, 없는 곳은 datalist에서 별도견적 안내.

interface MapEntry {
  matrixKey: string | null;   // null = 매트릭스 없음 → needsCustomQuote 분기
  labels: string[];           // 사용자 입력 후보 (한글 + 영문 + 별칭)
  display: string;            // datalist 표시 라벨
}

// ─────────────────────────────────────────────────────────
// 매트릭스에 있는 21개 키 — 자동 견적 가능
// ─────────────────────────────────────────────────────────
const MATCHED: MapEntry[] = [
  // 서울특별시
  { matrixKey: 'SEL_METRO',   labels: ['서울', '서울시', '서울시내', '서울특별시', 'seoul', 'seoul metro', 'seoul city', '명동', '홍대', '종로', '마포', '용산', '이태원', '광화문', '동대문', '인사동', '북촌', '서대문', '중구', '성수', '여의도', 'myeongdong', 'hongdae', 'jongno', 'mapo', 'yongsan', 'itaewon', 'gwanghwamun', 'dongdaemun', 'insadong', 'bukchon', 'seongsu', 'yeouido'], display: '서울 시내 (Seoul Metro)' },
  { matrixKey: 'SEL_GANGNAM', labels: ['강남', '잠실', '송파', '서초', '강남구', '서초구', '송파구', 'gangnam', 'jamsil', 'songpa', 'seocho'], display: '서울 강남·잠실 (Gangnam)' },
  // 부산
  { matrixKey: 'BUSAN',       labels: ['부산', '부산시', '부산광역시', '부산시내', 'busan', 'busan city', '해운대', '광안', '광안리', '동래', '감천', '서면', '영도', '센텀시티', '광안대교', '태종대', 'haeundae', 'gwangan', 'gwangalli', 'dongnae', 'gamcheon', 'seomyeon', 'centum', 'taejongdae'], display: '부산 (Busan)' },
  // 제주
  { matrixKey: 'JEJU_METRO',  labels: ['제주', '제주시', '제주특별자치도', 'jeju', 'jeju metro', 'jeju city'], display: '제주 시내 (Jeju Metro)' },
  { matrixKey: 'SEOGWIPO',    labels: ['서귀포', '서귀포시', 'seogwipo'], display: '서귀포 (Seogwipo)' },
  { matrixKey: 'SEONGSAN',    labels: ['성산', '성산일출봉', 'seongsan', 'seongsan ilchulbong'], display: '성산 (Seongsan)' },
  { matrixKey: 'HALLASAN',    labels: ['한라산', 'hallasan'], display: '한라산 (Hallasan)' },
  // 강원
  { matrixKey: 'GANGNEUNG',   labels: ['강릉', '강릉시', '경포대', '정동진', 'gangneung', 'gyeongpodae', 'jeongdongjin'], display: '강릉 (Gangneung)' },
  { matrixKey: 'SOKCHO',      labels: ['속초', '속초시', 'sokcho', '설악산', '설악', '낙산사', 'seoraksan', 'naksansa'], display: '속초·설악 (Sokcho)' },
  { matrixKey: 'CHUNCHEON',   labels: ['춘천', '춘천시', 'chuncheon'], display: '춘천 (Chuncheon)' },
  { matrixKey: 'PYEONGCHANG', labels: ['평창', '평창군', '용평', '알펜시아', '하이원', '비발디', '월정사', '대관령', 'pyeongchang', 'yongpyong', 'alpensia', 'high1', 'vivaldi'], display: '평창·용평·알펜시아 (Pyeongchang)' },
  // 경기
  { matrixKey: 'SUWON',       labels: ['수원', '수원시', '수원화성', '용인', '용인시', '에버랜드', '한국민속촌', 'suwon', 'yongin', 'everland', 'korean folk village'], display: '수원·용인 (Suwon / Yongin)' },
  { matrixKey: 'GAPYEONG',    labels: ['가평', '가평군', '남이섬', '쁘띠프랑스', '아침고요', '아침고요수목원', '레일바이크', '에델바이스', '자라섬', '청평', 'gapyeong', 'nami', 'nami island', 'petite france', 'morning calm', 'rail bike'], display: '가평·남이섬 (Gapyeong / Nami)' },
  // 충청
  { matrixKey: 'DAEJEON',     labels: ['대전', '대전시', '대전광역시', 'daejeon'], display: '대전 (Daejeon)' },
  { matrixKey: 'DAMYANG',     labels: ['단양', '단양군', '담양', '담양군', '죽녹원', '메타세쿼이아', 'danyang', 'damyang'], display: '담양·단양 (Damyang / Danyang)' },
  // 경상
  { matrixKey: 'GYEONGJU',    labels: ['경주', '경주시', '불국사', '석굴암', '동궁과월지', '첨성대', '대릉원', 'gyeongju', 'bulguksa', 'seokguram'], display: '경주 (Gyeongju)' },
  { matrixKey: 'ANDONG',      labels: ['안동', '안동시', '하회마을', '병산서원', 'andong', 'hahoe'], display: '안동·하회 (Andong)' },
  { matrixKey: 'DAEGU',       labels: ['대구', '대구시', '대구광역시', 'daegu'], display: '대구 (Daegu)' },
  // 전라
  { matrixKey: 'JEONJU',      labels: ['전주', '전주시', '한옥마을', '경기전', 'jeonju', 'hanok village'], display: '전주 (Jeonju)' },
  { matrixKey: 'YEOSU',       labels: ['여수', '여수시', '오동도', '여수해상케이블카', 'yeosu'], display: '여수 (Yeosu)' },
];

// ─────────────────────────────────────────────────────────
// 매트릭스에 없는 시·군 — datalist 노출 + 별도견적 분기
// 한국의 모든 시(市) + 주요 군(郡) 망라
// ─────────────────────────────────────────────────────────
const UNMATCHED: MapEntry[] = [
  // 광역시 (매트릭스에 도착지로 없음)
  { matrixKey: null, labels: ['인천', '인천시', '인천광역시', 'incheon city'], display: '인천 (Incheon) — 별도견적' },
  { matrixKey: null, labels: ['광주', '광주시', '광주광역시', 'gwangju'], display: '광주 (Gwangju) — 별도견적' },
  { matrixKey: null, labels: ['울산', '울산시', '울산광역시', 'ulsan'], display: '울산 (Ulsan) — 별도견적' },
  { matrixKey: null, labels: ['세종', '세종시', '세종특별자치시', 'sejong'], display: '세종 (Sejong) — 별도견적' },

  // 경기도
  { matrixKey: null, labels: ['성남', '성남시', '분당', '판교', 'seongnam', 'bundang', 'pangyo'], display: '성남·분당 (Seongnam) — 별도견적' },
  { matrixKey: null, labels: ['부천', '부천시', 'bucheon'], display: '부천 (Bucheon) — 별도견적' },
  { matrixKey: null, labels: ['안산', '안산시', 'ansan'], display: '안산 (Ansan) — 별도견적' },
  { matrixKey: null, labels: ['안양', '안양시', 'anyang'], display: '안양 (Anyang) — 별도견적' },
  { matrixKey: null, labels: ['평택', '평택시', 'pyeongtaek'], display: '평택 (Pyeongtaek) — 별도견적' },
  { matrixKey: null, labels: ['시흥', '시흥시', 'siheung'], display: '시흥 (Siheung) — 별도견적' },
  { matrixKey: null, labels: ['김포', '김포시', 'gimpo'], display: '김포 (Gimpo) — 별도견적' },
  { matrixKey: null, labels: ['광주(경기)', '광주시(경기)', 'gwangju gyeonggi'], display: '광주 (경기·Gwangju Gyeonggi) — 별도견적' },
  { matrixKey: null, labels: ['광명', '광명시', 'gwangmyeong'], display: '광명 (Gwangmyeong) — 별도견적' },
  { matrixKey: null, labels: ['군포', '군포시', 'gunpo'], display: '군포 (Gunpo) — 별도견적' },
  { matrixKey: null, labels: ['오산', '오산시', 'osan'], display: '오산 (Osan) — 별도견적' },
  { matrixKey: null, labels: ['의정부', '의정부시', 'uijeongbu'], display: '의정부 (Uijeongbu) — 별도견적' },
  { matrixKey: null, labels: ['양주', '양주시', 'yangju'], display: '양주 (Yangju) — 별도견적' },
  { matrixKey: null, labels: ['구리', '구리시', 'guri'], display: '구리 (Guri) — 별도견적' },
  { matrixKey: null, labels: ['남양주', '남양주시', 'namyangju'], display: '남양주 (Namyangju) — 별도견적' },
  { matrixKey: null, labels: ['파주', '파주시', '임진각', '판문점', 'paju', 'imjingak', 'panmunjom'], display: '파주·DMZ (Paju) — 별도견적' },
  { matrixKey: null, labels: ['화성', '화성시', '화성행궁', 'hwaseong'], display: '화성 (Hwaseong) — 별도견적' },
  { matrixKey: null, labels: ['포천', '포천시', '포천아트밸리', '허브아일랜드', 'pocheon'], display: '포천 (Pocheon) — 별도견적' },
  { matrixKey: null, labels: ['양평', '양평군', '두물머리', 'yangpyeong', 'dumulmeori'], display: '양평·두물머리 (Yangpyeong) — 별도견적' },
  { matrixKey: null, labels: ['여주', '여주시', 'yeoju'], display: '여주 (Yeoju) — 별도견적' },
  { matrixKey: null, labels: ['이천', '이천시', 'icheon'], display: '이천 (Icheon) — 별도견적' },
  { matrixKey: null, labels: ['안성', '안성시', 'anseong'], display: '안성 (Anseong) — 별도견적' },
  { matrixKey: null, labels: ['하남', '하남시', '미사', 'hanam', 'misa'], display: '하남 (Hanam) — 별도견적' },
  { matrixKey: null, labels: ['의왕', '의왕시', 'uiwang'], display: '의왕 (Uiwang) — 별도견적' },
  { matrixKey: null, labels: ['과천', '과천시', 'gwacheon'], display: '과천 (Gwacheon) — 별도견적' },
  { matrixKey: null, labels: ['동두천', '동두천시', 'dongducheon'], display: '동두천 (Dongducheon) — 별도견적' },
  { matrixKey: null, labels: ['연천', '연천군', 'yeoncheon'], display: '연천 (Yeoncheon) — 별도견적' },

  // 강원도
  { matrixKey: null, labels: ['원주', '원주시', 'wonju'], display: '원주 (Wonju) — 별도견적' },
  { matrixKey: null, labels: ['동해', '동해시', 'donghae'], display: '동해 (Donghae) — 별도견적' },
  { matrixKey: null, labels: ['태백', '태백시', 'taebaek'], display: '태백 (Taebaek) — 별도견적' },
  { matrixKey: null, labels: ['삼척', '삼척시', 'samcheok'], display: '삼척 (Samcheok) — 별도견적' },
  { matrixKey: null, labels: ['홍천', '홍천군', 'hongcheon'], display: '홍천 (Hongcheon) — 별도견적' },
  { matrixKey: null, labels: ['횡성', '횡성군', 'hoengseong'], display: '횡성 (Hoengseong) — 별도견적' },
  { matrixKey: null, labels: ['영월', '영월군', 'yeongwol'], display: '영월 (Yeongwol) — 별도견적' },
  { matrixKey: null, labels: ['정선', '정선군', 'jeongseon'], display: '정선 (Jeongseon) — 별도견적' },
  { matrixKey: null, labels: ['철원', '철원군', 'cheorwon'], display: '철원 (Cheorwon) — 별도견적' },
  { matrixKey: null, labels: ['화천', '화천군', 'hwacheon'], display: '화천 (Hwacheon) — 별도견적' },
  { matrixKey: null, labels: ['양구', '양구군', 'yanggu'], display: '양구 (Yanggu) — 별도견적' },
  { matrixKey: null, labels: ['인제', '인제군', 'inje'], display: '인제 (Inje) — 별도견적' },
  { matrixKey: null, labels: ['고성(강원)', '고성군(강원)', 'goseong gangwon'], display: '고성 (강원·Goseong Gangwon) — 별도견적' },
  { matrixKey: null, labels: ['양양', '양양군', '서피비치', 'yangyang', 'surfy beach'], display: '양양 (Yangyang) — 별도견적' },

  // 충청북도
  { matrixKey: null, labels: ['청주', '청주시', 'cheongju'], display: '청주 (Cheongju) — 별도견적' },
  { matrixKey: null, labels: ['충주', '충주시', 'chungju'], display: '충주 (Chungju) — 별도견적' },
  { matrixKey: null, labels: ['제천', '제천시', 'jecheon'], display: '제천 (Jecheon) — 별도견적' },
  { matrixKey: null, labels: ['진천', '진천군', 'jincheon'], display: '진천 (Jincheon) — 별도견적' },
  { matrixKey: null, labels: ['괴산', '괴산군', 'goesan'], display: '괴산 (Goesan) — 별도견적' },
  { matrixKey: null, labels: ['음성', '음성군', 'eumseong'], display: '음성 (Eumseong) — 별도견적' },
  { matrixKey: null, labels: ['영동', '영동군', 'yeongdong'], display: '영동 (Yeongdong) — 별도견적' },
  { matrixKey: null, labels: ['보은', '보은군', 'boeun'], display: '보은 (Boeun) — 별도견적' },
  { matrixKey: null, labels: ['옥천', '옥천군', 'okcheon'], display: '옥천 (Okcheon) — 별도견적' },
  { matrixKey: null, labels: ['증평', '증평군', 'jeungpyeong'], display: '증평 (Jeungpyeong) — 별도견적' },

  // 충청남도
  { matrixKey: null, labels: ['천안', '천안시', 'cheonan'], display: '천안 (Cheonan) — 별도견적' },
  { matrixKey: null, labels: ['공주', '공주시', 'gongju'], display: '공주 (Gongju) — 별도견적' },
  { matrixKey: null, labels: ['보령', '보령시', '대천', 'boryeong', 'daecheon'], display: '보령·대천 (Boryeong) — 별도견적' },
  { matrixKey: null, labels: ['아산', '아산시', 'asan'], display: '아산 (Asan) — 별도견적' },
  { matrixKey: null, labels: ['서산', '서산시', 'seosan'], display: '서산 (Seosan) — 별도견적' },
  { matrixKey: null, labels: ['논산', '논산시', 'nonsan'], display: '논산 (Nonsan) — 별도견적' },
  { matrixKey: null, labels: ['계룡', '계룡시', 'gyeryong'], display: '계룡 (Gyeryong) — 별도견적' },
  { matrixKey: null, labels: ['당진', '당진시', 'dangjin'], display: '당진 (Dangjin) — 별도견적' },
  { matrixKey: null, labels: ['금산', '금산군', 'geumsan'], display: '금산 (Geumsan) — 별도견적' },
  { matrixKey: null, labels: ['부여', '부여군', 'buyeo'], display: '부여 (Buyeo) — 별도견적' },
  { matrixKey: null, labels: ['서천', '서천군', 'seocheon'], display: '서천 (Seocheon) — 별도견적' },
  { matrixKey: null, labels: ['청양', '청양군', 'cheongyang'], display: '청양 (Cheongyang) — 별도견적' },
  { matrixKey: null, labels: ['홍성', '홍성군', 'hongseong'], display: '홍성 (Hongseong) — 별도견적' },
  { matrixKey: null, labels: ['예산', '예산군', 'yesan'], display: '예산 (Yesan) — 별도견적' },
  { matrixKey: null, labels: ['태안', '태안군', '안면도', 'taean', 'anmyeondo'], display: '태안·안면도 (Taean) — 별도견적' },

  // 전라북도
  { matrixKey: null, labels: ['군산', '군산시', 'gunsan'], display: '군산 (Gunsan) — 별도견적' },
  { matrixKey: null, labels: ['익산', '익산시', 'iksan'], display: '익산 (Iksan) — 별도견적' },
  { matrixKey: null, labels: ['정읍', '정읍시', 'jeongeup'], display: '정읍 (Jeongeup) — 별도견적' },
  { matrixKey: null, labels: ['남원', '남원시', 'namwon'], display: '남원 (Namwon) — 별도견적' },
  { matrixKey: null, labels: ['김제', '김제시', 'gimje'], display: '김제 (Gimje) — 별도견적' },
  { matrixKey: null, labels: ['완주', '완주군', 'wanju'], display: '완주 (Wanju) — 별도견적' },
  { matrixKey: null, labels: ['진안', '진안군', 'jinan'], display: '진안 (Jinan) — 별도견적' },
  { matrixKey: null, labels: ['무주', '무주군', 'muju'], display: '무주 (Muju) — 별도견적' },
  { matrixKey: null, labels: ['장수', '장수군', 'jangsu'], display: '장수 (Jangsu) — 별도견적' },
  { matrixKey: null, labels: ['임실', '임실군', 'imsil'], display: '임실 (Imsil) — 별도견적' },
  { matrixKey: null, labels: ['순창', '순창군', 'sunchang'], display: '순창 (Sunchang) — 별도견적' },
  { matrixKey: null, labels: ['고창', '고창군', 'gochang'], display: '고창 (Gochang) — 별도견적' },
  { matrixKey: null, labels: ['부안', '부안군', 'buan'], display: '부안 (Buan) — 별도견적' },

  // 전라남도
  { matrixKey: null, labels: ['목포', '목포시', 'mokpo'], display: '목포 (Mokpo) — 별도견적' },
  { matrixKey: null, labels: ['순천', '순천시', '순천만', 'suncheon', 'suncheon bay'], display: '순천·순천만 (Suncheon) — 별도견적' },
  { matrixKey: null, labels: ['나주', '나주시', 'naju'], display: '나주 (Naju) — 별도견적' },
  { matrixKey: null, labels: ['광양', '광양시', 'gwangyang'], display: '광양 (Gwangyang) — 별도견적' },
  { matrixKey: null, labels: ['곡성', '곡성군', 'gokseong'], display: '곡성 (Gokseong) — 별도견적' },
  { matrixKey: null, labels: ['구례', '구례군', '지리산', 'gurye', 'jirisan'], display: '구례·지리산 (Gurye) — 별도견적' },
  { matrixKey: null, labels: ['고흥', '고흥군', 'goheung'], display: '고흥 (Goheung) — 별도견적' },
  { matrixKey: null, labels: ['보성', '보성군', '녹차밭', 'boseong', 'green tea'], display: '보성·녹차밭 (Boseong) — 별도견적' },
  { matrixKey: null, labels: ['화순', '화순군', 'hwasun'], display: '화순 (Hwasun) — 별도견적' },
  { matrixKey: null, labels: ['장흥', '장흥군', 'jangheung'], display: '장흥 (Jangheung) — 별도견적' },
  { matrixKey: null, labels: ['강진', '강진군', 'gangjin'], display: '강진 (Gangjin) — 별도견적' },
  { matrixKey: null, labels: ['해남', '해남군', '땅끝마을', 'haenam'], display: '해남·땅끝 (Haenam) — 별도견적' },
  { matrixKey: null, labels: ['영암', '영암군', 'yeongam'], display: '영암 (Yeongam) — 별도견적' },
  { matrixKey: null, labels: ['무안', '무안군', 'muan'], display: '무안 (Muan) — 별도견적' },
  { matrixKey: null, labels: ['함평', '함평군', 'hampyeong'], display: '함평 (Hampyeong) — 별도견적' },
  { matrixKey: null, labels: ['영광', '영광군', 'yeonggwang'], display: '영광 (Yeonggwang) — 별도견적' },
  { matrixKey: null, labels: ['장성', '장성군', 'jangseong'], display: '장성 (Jangseong) — 별도견적' },
  { matrixKey: null, labels: ['완도', '완도군', 'wando'], display: '완도 (Wando) — 별도견적' },
  { matrixKey: null, labels: ['진도', '진도군', 'jindo'], display: '진도 (Jindo) — 별도견적' },
  { matrixKey: null, labels: ['신안', '신안군', '증도', 'sinan', 'jeungdo'], display: '신안·증도 (Sinan) — 별도견적' },

  // 경상북도
  { matrixKey: null, labels: ['포항', '포항시', '호미곶', 'pohang', 'homigot'], display: '포항·호미곶 (Pohang) — 별도견적' },
  { matrixKey: null, labels: ['김천', '김천시', 'gimcheon'], display: '김천 (Gimcheon) — 별도견적' },
  { matrixKey: null, labels: ['구미', '구미시', 'gumi'], display: '구미 (Gumi) — 별도견적' },
  { matrixKey: null, labels: ['영주', '영주시', '부석사', 'yeongju', 'buseoksa'], display: '영주·부석사 (Yeongju) — 별도견적' },
  { matrixKey: null, labels: ['영천', '영천시', 'yeongcheon'], display: '영천 (Yeongcheon) — 별도견적' },
  { matrixKey: null, labels: ['상주', '상주시', 'sangju'], display: '상주 (Sangju) — 별도견적' },
  { matrixKey: null, labels: ['문경', '문경시', '새재', 'mungyeong', 'saejae'], display: '문경 (Mungyeong) — 별도견적' },
  { matrixKey: null, labels: ['경산', '경산시', 'gyeongsan'], display: '경산 (Gyeongsan) — 별도견적' },
  { matrixKey: null, labels: ['군위', '군위군', 'gunwi'], display: '군위 (Gunwi) — 별도견적' },
  { matrixKey: null, labels: ['의성', '의성군', 'uiseong'], display: '의성 (Uiseong) — 별도견적' },
  { matrixKey: null, labels: ['청송', '청송군', 'cheongsong'], display: '청송 (Cheongsong) — 별도견적' },
  { matrixKey: null, labels: ['영양', '영양군', 'yeongyang'], display: '영양 (Yeongyang) — 별도견적' },
  { matrixKey: null, labels: ['영덕', '영덕군', 'yeongdeok'], display: '영덕 (Yeongdeok) — 별도견적' },
  { matrixKey: null, labels: ['청도', '청도군', 'cheongdo'], display: '청도 (Cheongdo) — 별도견적' },
  { matrixKey: null, labels: ['고령', '고령군', 'goryeong'], display: '고령 (Goryeong) — 별도견적' },
  { matrixKey: null, labels: ['성주', '성주군', 'seongju'], display: '성주 (Seongju) — 별도견적' },
  { matrixKey: null, labels: ['칠곡', '칠곡군', 'chilgok'], display: '칠곡 (Chilgok) — 별도견적' },
  { matrixKey: null, labels: ['예천', '예천군', 'yecheon'], display: '예천 (Yecheon) — 별도견적' },
  { matrixKey: null, labels: ['봉화', '봉화군', 'bonghwa'], display: '봉화 (Bonghwa) — 별도견적' },
  { matrixKey: null, labels: ['울진', '울진군', 'uljin'], display: '울진 (Uljin) — 별도견적' },
  { matrixKey: null, labels: ['울릉', '울릉도', '울릉군', '독도', 'ulleung', 'ulleungdo', 'dokdo'], display: '울릉도·독도 (Ulleung / Dokdo) — 별도견적' },

  // 경상남도
  { matrixKey: null, labels: ['창원', '창원시', '마산', '진해', 'changwon', 'masan', 'jinhae'], display: '창원·마산·진해 (Changwon) — 별도견적' },
  { matrixKey: null, labels: ['진주', '진주시', 'jinju'], display: '진주 (Jinju) — 별도견적' },
  { matrixKey: null, labels: ['통영', '통영시', '한산도', 'tongyeong', 'hansando'], display: '통영·한산도 (Tongyeong) — 별도견적' },
  { matrixKey: null, labels: ['사천', '사천시', 'sacheon'], display: '사천 (Sacheon) — 별도견적' },
  { matrixKey: null, labels: ['김해', '김해시', 'gimhae'], display: '김해 (Gimhae) — 별도견적' },
  { matrixKey: null, labels: ['밀양', '밀양시', 'miryang'], display: '밀양 (Miryang) — 별도견적' },
  { matrixKey: null, labels: ['거제', '거제시', '거제도', '외도', 'geoje', 'oedo'], display: '거제·외도 (Geoje) — 별도견적' },
  { matrixKey: null, labels: ['양산', '양산시', '통도사', 'yangsan', 'tongdosa'], display: '양산·통도사 (Yangsan) — 별도견적' },
  { matrixKey: null, labels: ['의령', '의령군', 'uiryeong'], display: '의령 (Uiryeong) — 별도견적' },
  { matrixKey: null, labels: ['함안', '함안군', 'haman'], display: '함안 (Haman) — 별도견적' },
  { matrixKey: null, labels: ['창녕', '창녕군', '우포늪', 'changnyeong', 'upo'], display: '창녕·우포늪 (Changnyeong) — 별도견적' },
  { matrixKey: null, labels: ['고성(경남)', '고성군(경남)', 'goseong gyeongnam'], display: '고성 (경남·Goseong Gyeongnam) — 별도견적' },
  { matrixKey: null, labels: ['남해', '남해군', '남해도', 'namhae'], display: '남해 (Namhae) — 별도견적' },
  { matrixKey: null, labels: ['하동', '하동군', '쌍계사', 'hadong'], display: '하동·쌍계사 (Hadong) — 별도견적' },
  { matrixKey: null, labels: ['산청', '산청군', 'sancheong'], display: '산청 (Sancheong) — 별도견적' },
  { matrixKey: null, labels: ['함양', '함양군', 'hamyang'], display: '함양 (Hamyang) — 별도견적' },
  { matrixKey: null, labels: ['거창', '거창군', 'geochang'], display: '거창 (Geochang) — 별도견적' },
  { matrixKey: null, labels: ['합천', '합천군', '해인사', 'hapcheon', 'haeinsa'], display: '합천·해인사 (Hapcheon) — 별도견적' },
];

const ENTRIES: MapEntry[] = [...MATCHED, ...UNMATCHED];

function normalize(input: string): string {
  return input.trim().toLowerCase().replace(/[\s·\-_]/g, '');
}

// 매트릭스 키 정규화 — 매트릭스에 있는 21개 키만 반환 (null = 별도견적)
export function normalizeDestinationToMatrixKey(input: string): string | null {
  if (!input) return null;
  const cleaned = normalize(input);
  if (cleaned.length < 1) return null;

  // 1) 정확 매칭 (MATCHED 우선)
  for (const entry of ENTRIES) {
    for (const label of entry.labels) {
      if (normalize(label) === cleaned) return entry.matrixKey;
    }
  }
  // 2) 부분 매칭 — 입력이 라벨에 포함되거나 라벨이 입력에 포함 (3자 이상)
  for (const entry of ENTRIES) {
    for (const label of entry.labels) {
      const nl = normalize(label);
      if (cleaned.length >= 2 && nl.includes(cleaned)) return entry.matrixKey;
      if (nl.length >= 3 && cleaned.includes(nl)) return entry.matrixKey;
    }
  }
  return null;
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

// 자동완성 후보 — Step3Destination의 <datalist>가 사용
export function getDestinationSuggestions(input?: string): { value: string; matrixKey: string | null; display: string }[] {
  const list: { value: string; matrixKey: string | null; display: string }[] = [];
  for (const entry of ENTRIES) {
    for (const label of entry.labels) {
      list.push({ value: label, matrixKey: entry.matrixKey, display: entry.display });
    }
  }
  if (!input || input.length < 1) return list.slice(0, 50);
  const cleaned = normalize(input);
  return list.filter(s => normalize(s.value).includes(cleaned)).slice(0, 50);
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
