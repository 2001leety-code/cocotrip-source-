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
    title: { ko: '🌸 지금 바로 가야 할 봄꽃 명소', en: '🌸 Must-Visit Spring Spots Right Now', ja: '🌸 今すぐ行くべき春の名所', zh: '🌸 现在必去的春花名胜' },
    subtitle: { ko: '3월 말~4월, 벚꽃·유채꽃 절정 시즌', en: 'Late March~April: Cherry Blossoms & Canola Flowers at Peak', ja: '3月末〜4月、桜・菜の花が満開', zh: '3月末至4月，樱花与油菜花绽放' },
    emoji: '🌸',
    urgency: { ko: '⚡ 지금이 딱! 2주 후면 끝나요', en: '⚡ Now or Never! Ends in 2 weeks', ja: '⚡ 今だけ！2週間後には終わります', zh: '⚡ 现在最佳！2周后就结束了' },
    spots: [
      {
        name: '진해 군항제', nameEn: 'Jinhae Gunhangje Cherry Blossom Festival',
        location: '경남 창원 진해구', locationEn: 'Jinhae, Changwon, South Gyeongsang',
        highlight: '국내 최대 규모 벚꽃축제, 36만 그루 벚나무', highlightEn: "Korea's largest cherry blossom festival with 360,000 trees",
        period: '3월 28일 ~ 4월 6일', periodEn: 'Mar 28 ~ Apr 6',
        tip: '여좌천 로망스다리는 반드시 오전 7시 이전 방문', tipEn: 'Visit Yeojwacheon Romance Bridge before 7AM to avoid crowds',
      },
      {
        name: '여의도 벚꽃축제', nameEn: 'Yeouido Cherry Blossom Festival',
        location: '서울 영등포구', locationEn: 'Yeongdeungpo, Seoul',
        highlight: '윤중로 1,800그루 왕벚나무 터널, 서울 도심 최고 명소', highlightEn: "1,800 cherry trees along Yunjungno — Seoul's top blossom spot",
        period: '3월 29일 ~ 4월 6일', periodEn: 'Mar 29 ~ Apr 6',
        tip: '주말 극심한 혼잡 — 평일 오전 방문 또는 전세차량으로 이동 추천', tipEn: 'Extremely crowded on weekends — visit weekday morning or use charter car',
      },
      {
        name: '경주 대릉원 벚꽃길', nameEn: 'Gyeongju Daereungwon Cherry Blossom Walk',
        location: '경북 경주시', locationEn: 'Gyeongju, North Gyeongsang',
        highlight: '천년 신라 고분과 벚꽃의 환상적 조합, 무료 입장', highlightEn: 'Stunning combo of ancient Silla tombs and cherry blossoms — free entry',
        period: '3월 말 ~ 4월 초', periodEn: 'Late March ~ Early April',
        tip: '야간 22시까지 운영 — 벚꽃 야경이 압도적으로 아름다움', tipEn: 'Open until 10PM — the night cherry blossom view is breathtaking',
      },
      {
        name: '하동 십리벚꽃길', nameEn: 'Hadong Shimni Cherry Blossom Road',
        location: '경남 하동군', locationEn: 'Hadong, South Gyeongsang',
        highlight: '섬진강변 4km 벚꽃 드라이브 코스, 한국에서 가장 아름다운 길 100선', highlightEn: "4km riverside cherry blossom drive — one of Korea's 100 most beautiful roads",
        period: '3월 말 ~ 4월 초', periodEn: 'Late March ~ Early April',
        tip: '구례 산수유마을과 같은 날 묶어서 방문하면 효율적', tipEn: 'Combine with Gurye Sansuyu Village for an efficient day trip',
      },
      {
        name: '남해 독일마을 유채꽃', nameEn: 'Namhae German Village Canola Flowers',
        location: '경남 남해군', locationEn: 'Namhae, South Gyeongsang',
        highlight: '유럽풍 마을 + 노란 유채꽃밭의 이색적 풍경, SNS 핫스팟', highlightEn: 'European-style village + yellow canola fields — major SNS hotspot',
        period: '3월 말 ~ 4월 중순', periodEn: 'Late March ~ Mid April',
        tip: '꽃밭은 오전 햇빛에 가장 아름답게 촬영됨 — 오전 방문 필수', tipEn: 'Best photos in morning light — morning visit strongly recommended',
      },
    ],
  },
  summer: {
    title: { ko: '☀️ 지금 바로 가야 할 여름 명소', en: '☀️ Must-Visit Summer Spots Right Now', ja: '☀️ 今すぐ行くべき夏の名所', zh: '☀️ 现在必去的夏季景点' },
    subtitle: { ko: '6~8월 해수욕장·계곡·축제 시즌', en: 'June~August: Beaches, Valleys & Festivals', ja: '6〜8月 海水浴・渓谷・フェスシーズン', zh: '6至8月 海滩、溪谷与节庆季' },
    emoji: '🌊',
    urgency: { ko: '⚡ 여름 성수기 시작! 지금 예약하세요', en: '⚡ Peak summer starts! Book now', ja: '⚡ 夏のピークシーズン開始！今すぐ予約', zh: '⚡ 夏季旺季开始！立即预订' },
    spots: [
      { name: '부산 해운대 해수욕장', nameEn: 'Haeundae Beach, Busan', location: '부산 해운대구', locationEn: 'Haeundae, Busan', highlight: '한국 최고의 해변, 연간 방문객 1,500만 명', highlightEn: "Korea's top beach — 15M annual visitors", period: '7월~8월 성수기', periodEn: 'July~August peak season', tip: '아침 7시 이전 방문 시 한산하게 즐길 수 있음', tipEn: 'Arrive before 7AM for a peaceful experience' },
      { name: '강릉 경포해변', nameEn: 'Gyeongpo Beach, Gangneung', location: '강원도 강릉시', locationEn: 'Gangneung, Gangwon', highlight: '동해안 최대 해수욕장, 강릉 카페거리와 함께', highlightEn: "East Coast's largest beach with famous café street", period: '7월~8월', periodEn: 'July~August', tip: '해변 근처 안목해변 커피거리 필수 방문', tipEn: 'Must visit Anmok Beach coffee street nearby' },
      { name: '한탄강 래프팅', nameEn: 'Hantan River Rafting', location: '강원도 철원·경기 연천', locationEn: 'Cheorwon/Yeoncheon, Gangwon', highlight: '주상절리 협곡 사이를 달리는 스릴 만점 래프팅', highlightEn: 'Thrilling rafting through volcanic column gorges', period: '6월~8월', periodEn: 'June~August', tip: '사전 예약 필수, 우천 시 더욱 스릴 있음', tipEn: 'Advance booking required — more thrilling after rain' },
      { name: '지리산 노고단', nameEn: 'Nogodan Peak, Jirisan', location: '전남 구례·경남 함양', locationEn: 'Gurye/Hamyang, South Gyeongsang', highlight: '한국 3대 명산, 운해(구름바다) 장관', highlightEn: "One of Korea's top 3 mountains with stunning sea of clouds", period: '연중 (여름 운해 최고)', periodEn: 'Year-round (summer sea of clouds best)', tip: '일출 시 운해 최고 — 전날 노고단 대피소 예약 필수', tipEn: 'Sunrise sea of clouds is best — book Nogodan shelter day before' },
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
