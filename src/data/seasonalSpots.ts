// src/data/seasonalSpots.ts
// 시즌별 추천 여행지 — AI 플래너 자동 첨부용

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export function getCurrentSeason(): Season {
  const month = new Date().getMonth() + 1;
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
}

interface LangMap { ko: string; en: string; ja: string; zh: string; }

interface SeasonalSpot {
  name: string; nameEn: string;
  location: string; locationEn: string;
  highlight: string; highlightEn: string;
  period: string; periodEn: string;
  tip: string; tipEn: string;
}

interface SeasonData {
  title: LangMap;
  subtitle: LangMap;
  emoji: string;
  urgency: LangMap;
  spots: SeasonalSpot[];
}

export const SEASONAL_SPOTS: Record<Season, SeasonData> = {
  spring: {
    title: { ko: '🌸 지금 바로 가야 할 봄 명소', en: '🌸 Must-Visit Spring Spots Right Now', ja: '🌸 今すぐ行くべき春の名所', zh: '🌸 现在必去的春季名胜' },
    subtitle: { ko: '4~5월, 철쭉·장미·신록이 피어나는 계절', en: 'April~May: Azaleas, Roses & Fresh Green Season', ja: '4〜5月、ツツジ・バラ・新緑の季節', zh: '4至5月，杜鹃花·玫瑰·新绿的季节' },
    emoji: '🌸',
    urgency: { ko: '⚡ 벚꽃 시즌 마무리 → 철쭉·장미 시즌 시작!', en: '⚡ Cherry blossoms ending → Azalea & Rose season begins!', ja: '⚡ 桜シーズン終了 → ツツジ・バラシーズン開始！', zh: '⚡ 樱花季结束 → 杜鹃花·玫瑰季开始！' },
    spots: [
      {
        name: '황매산 철쭉제', nameEn: 'Hwangmaesan Azalea Festival',
        location: '경남 합천·산청', locationEn: 'Hapcheon/Sancheong, South Gyeongsang',
        highlight: '해발 1,108m 산 정상 철쭉 군락지, 핑크빛 융단 장관', highlightEn: 'Pink azalea carpet at 1,108m summit — breathtaking mountain scenery',
        period: '5월 1일 ~ 5월 10일', periodEn: 'May 1 ~ May 10',
        tip: '주말 주차 대란 — 전세차량 이용 시 VIP 주차장 접근 가능', tipEn: 'Weekend parking chaos — charter car allows VIP parking access',
      },
      {
        name: '곡성 세계장미축제', nameEn: 'Gokseong World Rose Festival',
        location: '전남 곡성군', locationEn: 'Gokseong, South Jeolla',
        highlight: '1,004종 장미 정원, 기차마을과 함께 즐기는 로맨틱 여행지', highlightEn: '1,004 rose varieties in a romantic garden with a heritage train village',
        period: '5월 22일 ~ 5월 31일', periodEn: 'May 22 ~ May 31',
        tip: '섬진강 레일바이크와 세트로 즐기면 완벽한 하루', tipEn: 'Combine with Seomjingang rail bike for a perfect day trip',
      },
      {
        name: '담양 대나무축제', nameEn: 'Damyang Bamboo Festival',
        location: '전남 담양군', locationEn: 'Damyang, South Jeolla',
        highlight: '죽녹원 대나무 숲 산책, 시원한 초록 힐링', highlightEn: 'Juknokwon bamboo forest walk — refreshing green healing',
        period: '5월 1일 ~ 5월 5일', periodEn: 'May 1 ~ May 5',
        tip: '메타세쿼이아 가로수길도 함께 방문 — 드라이브 코스 최적', tipEn: 'Also visit Metasequoia Road nearby — perfect drive course',
      },
      {
        name: '남해 독일마을 유채꽃', nameEn: 'Namhae German Village Canola Flowers',
        location: '경남 남해군', locationEn: 'Namhae, South Gyeongsang',
        highlight: '유럽풍 마을 + 노란 유채꽃밭의 이색적 풍경, SNS 핫스팟', highlightEn: 'European-style village + yellow canola fields — major SNS hotspot',
        period: '3월 말 ~ 4월 중순', periodEn: 'Late March ~ Mid April',
        tip: '꽃밭은 오전 햇빛에 가장 아름답게 촬영됨 — 오전 방문 필수', tipEn: 'Best photos in morning light — morning visit strongly recommended',
      },
      {
        name: '서울재즈페스티벌', nameEn: 'Seoul Jazz Festival',
        location: '서울 올림픽공원', locationEn: 'Olympic Park, Seoul',
        highlight: '아시아 최대 재즈 페스티벌, 세계적 아티스트 라인업', highlightEn: "Asia's largest jazz festival with world-class artist lineup",
        period: '5월 22일 ~ 5월 24일', periodEn: 'May 22 ~ May 24',
        tip: '공연 후 대중교통 혼잡 — 코코트립 전세차량으로 편하게 귀환', tipEn: 'Public transport crowded after show — CocoTrip charter for easy return',
      },
    ],
  },
  summer: {
    title: { ko: '☀️ 지금 바로 가야 할 여름 명소', en: '☀️ Must-Visit Summer Spots Right Now', ja: '☀️ 今すぐ行くべき夏の名所', zh: '☀️ 现在必去的夏季景点' },
    subtitle: { ko: '6~8월 해수욕장·페스티벌·계곡 시즌', en: 'June~August: Beaches, Festivals & Valleys', ja: '6〜8月 海水浴・フェス・渓谷シーズン', zh: '6至8月 海滩、音乐节与溪谷季' },
    emoji: '🌊',
    urgency: { ko: '⚡ 여름 축제 시즌 시작! 지금 예약하세요', en: '⚡ Summer festival season starts! Book now', ja: '⚡ 夏フェスシーズン開始！今すぐ予約', zh: '⚡ 夏季音乐节开始！立即预订' },
    spots: [
      { name: '워터밤 서울 2026', nameEn: 'WATERBOMB Seoul 2026', location: '경기도 일산 킨텍스', locationEn: 'KINTEX, Ilsan, Gyeonggi-do', highlight: '한국 최대 여름 워터 페스티벌 + K-pop 공연, 3일간', highlightEn: "Korea's biggest summer water festival with K-pop — 3 days", period: '7월 24일 ~ 7월 26일', periodEn: 'Jul 24 ~ Jul 26', tip: '공연 후 대중교통 마비 — 코코트립 전세차량 강력 추천', tipEn: 'Public transport paralyzed after show — CocoTrip charter essential' },
      { name: '인천 펜타포트 락 페스티벌', nameEn: 'Incheon Pentaport Rock Festival', location: '인천 송도 달빛축제공원', locationEn: 'Songdo Moonlight Park, Incheon', highlight: '한국 대표 록 페스티벌, 3일간 라이브 공연', highlightEn: "Korea's premier rock festival — 3 days of live music", period: '7월 31일 ~ 8월 2일', periodEn: 'Jul 31 ~ Aug 2', tip: '캠핑존 조기 마감 — 서울 숙소 + 전세차량 왕복이 효율적', tipEn: 'Camping zone fills fast — Seoul hotel + charter car roundtrip is efficient' },
      { name: '부산 해운대 해수욕장', nameEn: 'Haeundae Beach, Busan', location: '부산 해운대구', locationEn: 'Haeundae, Busan', highlight: '한국 최고의 해변, 연간 방문객 1,500만 명', highlightEn: "Korea's top beach — 15M annual visitors", period: '7월~8월 성수기', periodEn: 'July~August peak season', tip: '아침 7시 이전 방문 시 한산하게 즐길 수 있음', tipEn: 'Arrive before 7AM for a peaceful experience' },
      { name: '강릉 경포해변', nameEn: 'Gyeongpo Beach, Gangneung', location: '강원도 강릉시', locationEn: 'Gangneung, Gangwon', highlight: '동해안 최대 해수욕장, 강릉 카페거리와 함께', highlightEn: "East Coast's largest beach with famous café street", period: '7월~8월', periodEn: 'July~August', tip: '해변 근처 안목해변 커피거리 필수 방문', tipEn: 'Must visit Anmok Beach coffee street nearby' },
      { name: '보령 머드축제', nameEn: 'Boryeong Mud Festival', location: '충남 보령시', locationEn: 'Boryeong, South Chungcheong', highlight: '세계적으로 유명한 외국인 최애 여름 축제', highlightEn: "World-famous summer festival — foreigners' top pick", period: '7월 중순 2주간', periodEn: 'Mid-July, 2 weeks', tip: '외국인 비율 70% 이상 — 전세차량으로 편하게 이동 추천', tipEn: 'Over 70% foreign visitors — charter car highly recommended' },
    ],
  },
  autumn: {
    title: { ko: '🍂 지금 바로 가야 할 단풍 명소', en: '🍂 Must-Visit Autumn Foliage Spots', ja: '🍂 今すぐ行くべき紅葉の名所', zh: '🍂 现在必去的红叶名胜' },
    subtitle: { ko: '9~11월 단풍·억새·국화 시즌', en: 'Sep~Nov: Autumn Leaves, Silver Grass & Chrysanthemums', ja: '9〜11月 紅葉・ススキ・菊のシーズン', zh: '9至11月 红叶、芒草与菊花季' },
    emoji: '🍁',
    urgency: { ko: '⚡ 단풍 절정! 이번 주가 하이라이트', en: '⚡ Peak foliage! This week is the highlight', ja: '⚡ 紅葉ピーク！今週がハイライト', zh: '⚡ 红叶顶峰！本周是高光时刻' },
    spots: [
      { name: '설악산 국립공원', nameEn: 'Seoraksan National Park', location: '강원도 속초·인제', locationEn: 'Sokcho/Inje, Gangwon', highlight: '한국 최고의 단풍 명소, 케이블카로 정상 조망', highlightEn: "Korea's top autumn foliage spot with cable car to summit", period: '10월 초~중순', periodEn: 'Early~Mid October', tip: '권금성 케이블카 현장 대기 2~3시간 — 온라인 사전 예약 필수', tipEn: 'Cable car wait 2-3hrs on site — online advance booking required' },
      { name: '내장산 국립공원', nameEn: 'Naejangsan National Park', location: '전북 정읍', locationEn: 'Jeongeup, North Jeolla', highlight: '단풍 색이 가장 진한 곳, 터널 모양 단풍길', highlightEn: 'Deepest autumn colors in Korea with tunnel-shaped foliage path', period: '10월 말~11월 초', periodEn: 'Late Oct~Early Nov', tip: '주말 극심한 혼잡 — 반드시 전세차량 이용 권장', tipEn: 'Extremely crowded weekends — charter car strongly recommended' },
      { name: '남이섬 은행나무길', nameEn: 'Nami Island Ginkgo Tree Road', location: '강원도 춘천 가평', locationEn: 'Gapyeong, Gangwon', highlight: '노란 은행나무 터널, 사계절 명소이나 가을이 최고조', highlightEn: 'Yellow ginkgo tunnel — year-round attraction at its autumn peak', period: '10월 중순~11월 초', periodEn: 'Mid Oct~Early Nov', tip: '아침 일찍 방문 시 안개와 단풍의 환상적 조합 가능', tipEn: 'Early morning visit = stunning mist + autumn leaves combo' },
      { name: '한라산 단풍', nameEn: 'Hallasan Mountain Autumn Foliage', location: '제주도', locationEn: 'Jeju Island', highlight: '한국 최고봉의 단풍, 영실코스 철쭉과 단풍의 조화', highlightEn: "Korea's highest peak with stunning foliage on Yeongsil Trail", period: '10월 중순~11월 초', periodEn: 'Mid Oct~Early Nov', tip: '성판악·관음사 코스는 편도 4~5시간 — 체력 준비 필수', tipEn: 'Seongpanak/Gwaneumsa trails take 4-5hrs one way — prepare physically' },
      { name: '경주 불국사·석굴암', nameEn: 'Gyeongju Bulguksa & Seokguram', location: '경북 경주시', locationEn: 'Gyeongju, North Gyeongsang', highlight: 'UNESCO 세계문화유산 + 단풍의 조화, 가을이 가장 아름다운 시기', highlightEn: 'UNESCO World Heritage + autumn foliage — most beautiful in fall', period: '10월 말~11월 초', periodEn: 'Late Oct~Early Nov', tip: '석굴암은 오전 일찍 방문 — 인파 피해 조용하게 감상 가능', tipEn: 'Visit Seokguram early morning to enjoy it quietly without crowds' },
    ],
  },
  winter: {
    title: { ko: '❄️ 지금 바로 가야 할 겨울 명소', en: '❄️ Must-Visit Winter Spots Right Now', ja: '❄️ 今すぐ行くべき冬の名所', zh: '❄️ 现在必去的冬季景点' },
    subtitle: { ko: '12~2월 스키·눈꽃·K-pop 시상식 시즌', en: 'Dec~Feb: Skiing, Snow Flowers & K-pop Award Shows', ja: '12〜2月 スキー・雪の花・K-POP授賞式シーズン', zh: '12至2月 滑雪、雪花与K-pop颁奖典礼季' },
    emoji: '⛷️',
    urgency: { ko: '⚡ 스키 시즌 막바지 + K-pop 시상식 출동!', en: '⚡ Ski season finale + K-pop award shows!', ja: '⚡ スキーシーズン終盤＋K-POP授賞式！', zh: '⚡ 滑雪季尾声 + K-pop颁奖典礼！' },
    spots: [
      { name: '용평 스키리조트', nameEn: 'Yongpyong Ski Resort', location: '강원도 평창', locationEn: 'Pyeongchang, Gangwon', highlight: '2018 동계올림픽 개최지, 한국 최대 스키 리조트', highlightEn: "2018 Winter Olympics venue — Korea's largest ski resort", period: '12월~3월', periodEn: 'December~March', tip: '드라마 겨울연가 촬영지 — K-drama 팬에게도 필수 방문지', tipEn: 'Filming location of Winter Sonata — a must for K-drama fans too' },
      { name: '태백산 눈꽃축제', nameEn: 'Taebaeksan Snow Flower Festival', location: '강원도 태백시', locationEn: 'Taebaek, Gangwon', highlight: '눈꽃 군락지와 얼음 분수, 겨울 동화 속 풍경', highlightEn: 'Snow flower clusters & ice fountains — a winter fairytale landscape', period: '1월 말~2월 초', periodEn: 'Late January~Early February', tip: '기온이 -15도 이하 — 방한용품 철저히 준비', tipEn: 'Temperatures drop to -15°C — prepare thorough cold weather gear' },
      { name: '인스파이어 아레나 K-pop 시상식', nameEn: 'Inspire Arena K-pop Award Shows', location: '인천 영종도', locationEn: 'Yeongdo, Incheon', highlight: 'SBS 가요대전·MMA·MAMA 등 연말 K-pop 시상식 집결지', highlightEn: 'Venue for SBS Gayo Daejeon, MMA, MAMA year-end K-pop shows', period: '11월~12월', periodEn: 'November~December', tip: '공연 후 대중교통 귀환 어려움 — 코코트립 셔틀 예약 필수!', tipEn: 'Public transport extremely difficult after show — Cocotrip shuttle is essential!' },
      { name: '남이섬 겨울 설경', nameEn: 'Nami Island Winter Snow Scenery', location: '강원도 가평', locationEn: 'Gapyeong, Gangwon', highlight: '눈 덮인 메타세쿼이아길, 드라마 겨울연가 배경지', highlightEn: 'Snow-covered metasequoia road — backdrop of Winter Sonata K-drama', period: '12월~2월', periodEn: 'December~February', tip: '눈 온 다음날 방문 시 최고의 설경 — 기상 확인 필수', tipEn: 'Best visited day after snowfall — always check weather forecast' },
      { name: '강릉 정동진 해돋이', nameEn: 'Jeongdongjin Sunrise, Gangneung', location: '강원도 강릉시', locationEn: 'Gangneung, Gangwon', highlight: '한국에서 가장 유명한 새해 해돋이 명소', highlightEn: "Korea's most famous New Year sunrise spot", period: '12월 31일~1월 1일', periodEn: 'Dec 31~Jan 1', tip: '1월 1일 전날부터 수십만 명 몰림 — 반드시 전세차량 사전 예약', tipEn: 'Hundreds of thousands arrive Dec 31 — charter car advance booking essential' },
    ],
  },
};
