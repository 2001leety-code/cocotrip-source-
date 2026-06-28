// Static example plans for the ad landing page "지역별 예시 플랜" showcase.
// 2026-06-28: 광고 랜딩용 정적 데이터.
//   운영자 지적: 기존 "시간|명소|팁" 3컬럼 표는 경쟁사 AI 결과와 똑같이 평범.
//   → 실제 플랜(PlanDetailPage)처럼 "구간별 교통(지하철 호선/버스 노선 + 소요분)" +
//     번호핀 좌표 + 분단위 동선을 가진 stop 배열(`stops`)로 확장.
//   ⚠️ 실재성 보장: 모든 명소·좌표·교통 노선은 실재하는 것만 사용.
//     - 좌표(lat/lng): 각 명소의 공개 위경도(소수 4자리, ±수십 m 오차 내 대표 지점).
//     - 교통: 확실한 노선만 명시(예 "지하철 3호선"). 불확실하면 보수적으로
//       "지하철 약 N분"/"도보 N분" 수준으로만 기재. 없는 역명/노선 절대 금지.
//   i18n 4-lang(ko/en/ja/zh) 동시 작성 — 기계번역 티 안 나게 자연스럽게.
//
//   기존 day1Table(마크다운 표)은 하위호환을 위해 유지(혹시 표 형식을 쓰는 곳 대비).
//   새 렌더러(ExampleTimelineCard)는 `stops`를 우선 사용.

/** 4개 언어 동시 표기 (프로젝트 표준: src/i18n Language = 'ko' | 'en' | 'ja' | 'zh'). */
export interface ExamplePlanI18n<T = string> {
  ko: T;
  en: T;
  ja: T;
  zh: T;
}

/** 구간 교통 수단 — 실제 플랜 TransitFromPrev.method 와 의미 일치. */
export type ExampleTransitMode = 'subway' | 'bus' | 'walk' | 'car' | 'subway+bus';

/** 이전 stop → 현재 stop 사이의 실재 교통 정보(예시용 단순화). */
export interface ExampleTransit {
  mode: ExampleTransitMode;
  /** 소요(분). 실재 노선의 통상 소요 기준 보수적 추정. */
  estMin: number;
  /**
   * 4-lang 한 줄 안내. 실재 노선/호선만 기재(예 "지하철 3호선 · 12분").
   * 불확실하면 "지하철 약 N분" 수준으로 보수적으로.
   */
  label: ExamplePlanI18n;
}

/** 1일차 타임라인의 한 정거장(실재 명소). */
export interface ExampleStop {
  /** "10:00" 형식 시작 시각. */
  time: string;
  /** 사용자 언어 표시 명소명. */
  name: ExamplePlanI18n;
  /** 사용자 언어 한 줄 팁. */
  tip: ExamplePlanI18n;
  /** 실재 명소 대표 좌표(위도). 지도 핀/링크용. */
  lat: number;
  /** 실재 명소 대표 좌표(경도). */
  lng: number;
  /** 이전 stop → 이 stop 구간 교통. 첫 stop 은 없음(undefined). */
  transit?: ExampleTransit;
}

export interface ExamplePlan {
  /** 안정적인 지역 키 (라우팅/매핑용). */
  region: 'seoul' | 'busan' | 'jeju';
  /** 칩/헤더에 표시할 지역명. */
  regionLabel: ExamplePlanI18n;
  /** 여행 테마 태그 (QuickPreviewCard 의 themes 와 동일 역할). */
  themes: ExamplePlanI18n<string[]>;
  /** 2~3문장 마케팅 내러티브 (QuickPreviewCard 의 marketingNarrative). */
  narrative: ExamplePlanI18n;
  /**
   * ⭐ 풍부한 1일차 타임라인 — 실제 플랜처럼 구간 교통 + 좌표 포함.
   * 새 렌더러(ExampleTimelineCard)의 1순위 데이터.
   */
  stops: ExampleStop[];
  /**
   * (하위호환) 1일차 타임라인 마크다운 표 — `| 시간 | 명소 | 팁 |` 3컬럼.
   * 기존 QuickPreviewCard 폴백 경로 대비 유지.
   */
  day1Table: ExamplePlanI18n;
}

export const EXAMPLE_PLANS: ExamplePlan[] = [
  // ── 서울 ───────────────────────────────────────────────────────────
  {
    region: 'seoul',
    regionLabel: { ko: '서울', en: 'Seoul', ja: 'ソウル', zh: '首尔' },
    themes: {
      ko: ['힐링', '핵심명소'],
      en: ['Healing', 'Highlights'],
      ja: ['癒し', '定番スポット'],
      zh: ['疗愈', '经典必游'],
    },
    narrative: {
      ko: '600년 왕조의 궁궐에서 골목 끝 한옥까지, 서울의 옛것과 지금이 한 골목 안에 포개집니다. 시장의 김 오르는 먹거리로 배를 채우고, 해 질 무렵 남산 전망대에서 도시 전체를 눈에 담는 하루입니다.',
      en: 'From a 600-year-old royal palace to a hidden hanok lane, old and new Seoul fold into a single afternoon. Fuel up on steaming market street food, then catch the whole city lit up at dusk from Namsan.',
      ja: '600年の王朝の宮殿から路地裏の韓屋まで、ソウルの昔と今がひとつの街並みに重なります。市場の湯気立つ屋台で腹を満たし、夕暮れの南山展望台から街全体を見渡す一日です。',
      zh: '从六百年王朝的宫殿到巷尾的韩屋，首尔的古与今在同一条街上交叠。先在市场用热气腾腾的小吃填饱肚子，再于黄昏时分在南山饱览整座城市的灯火。',
    },
    stops: [
      {
        time: '10:00',
        name: { ko: '경복궁', en: 'Gyeongbokgung Palace', ja: '景福宮', zh: '景福宫' },
        tip: {
          ko: '한복 입으면 입장료 무료, 10시 수문장 교대식',
          en: 'Free entry in hanbok; catch the 10am guard ceremony',
          ja: '韓服着用で入場無料、10時の守門将交代式',
          zh: '穿韩服免门票，10点有守门将换岗仪式',
        },
        lat: 37.5796,
        lng: 126.9770,
        // 첫 stop — 구간 교통 없음
      },
      {
        time: '12:00',
        name: { ko: '광장시장', en: 'Gwangjang Market', ja: '広蔵市場', zh: '广藏市场' },
        tip: {
          ko: '빈대떡·마약김밥, 평일 점심이 덜 붐빔',
          en: 'Try bindaetteok & mayak gimbap; quieter on weekday lunch',
          ja: 'ビンデトッ・麻薬キンパ、平日昼が空いている',
          zh: '必尝绿豆煎饼与麻药紫菜包饭，工作日午餐人少',
        },
        lat: 37.5701,
        lng: 126.9997,
        transit: {
          // 경복궁역(3호선) → 종로3가역(1호선) — 3호선으로 안국·종로3가 한 정거장권. 보수적 추정.
          mode: 'subway',
          estMin: 12,
          label: {
            ko: '지하철 3호선 · 약 12분',
            en: 'Subway Line 3 · ~12 min',
            ja: '地下鉄3号線 · 約12分',
            zh: '地铁3号线 · 约12分',
          },
        },
      },
      {
        time: '14:00',
        name: { ko: '북촌한옥마을', en: 'Bukchon Hanok Village', ja: '北村韓屋村', zh: '北村韩屋村' },
        tip: {
          ko: '8경 포토스팟, 주민 거주지라 정숙',
          en: 'Walk the "8 views"; keep quiet, people live here',
          ja: '北村八景の撮影スポット、住宅街なので静かに',
          zh: '北村八景拍照点，居民区请保持安静',
        },
        lat: 37.5826,
        lng: 126.9850,
        transit: {
          // 종로3가 → 안국역(3호선) 후 북촌 도보. 짧은 구간이라 도보 안내로 보수적 처리.
          mode: 'walk',
          estMin: 15,
          label: {
            ko: '안국역 방면 도보 · 약 15분',
            en: 'Walk toward Anguk Stn · ~15 min',
            ja: '安国駅方面へ徒歩 · 約15分',
            zh: '步行往安国站方向 · 约15分',
          },
        },
      },
      {
        time: '16:00',
        name: { ko: '인사동', en: 'Insadong', ja: '仁寺洞', zh: '仁寺洞' },
        tip: {
          ko: '쌈지길에서 전통차·기념품 쇼핑',
          en: 'Shop tea & crafts in the Ssamziegil spiral mall',
          ja: 'サムジキルで伝統茶・お土産探し',
          zh: '在Ssamziegil逛传统茶与文创纪念品',
        },
        lat: 37.5740,
        lng: 126.9856,
        transit: {
          // 북촌 → 인사동은 매우 가까움(도보권).
          mode: 'walk',
          estMin: 12,
          label: {
            ko: '도보 · 약 12분',
            en: 'Walk · ~12 min',
            ja: '徒歩 · 約12分',
            zh: '步行 · 约12分',
          },
        },
      },
      {
        time: '18:00',
        name: { ko: '남산서울타워', en: 'Namsan Seoul Tower', ja: 'Nソウルタワー', zh: '南山首尔塔' },
        tip: {
          ko: '일몰 30분 전 케이블카 탑승 추천',
          en: 'Take the cable car ~30 min before sunset',
          ja: '日没30分前のケーブルカーがおすすめ',
          zh: '建议日落前约30分钟搭缆车上山',
        },
        lat: 37.5512,
        lng: 126.9882,
        transit: {
          // 인사동 → 남산: 명동/남산케이블카로 차량 이동 후 케이블카. 차량+케이블카 보수적 추정.
          mode: 'car',
          estMin: 20,
          label: {
            ko: '차량 + 남산 케이블카 · 약 20분',
            en: 'Car + Namsan cable car · ~20 min',
            ja: '車 + 南山ケーブルカー · 約20分',
            zh: '乘车 + 南山缆车 · 约20分',
          },
        },
      },
    ],
    day1Table: {
      ko: '| 시간 | 명소 | 팁 |\n|---|---|---|\n| 10:00 | 경복궁 | 한복 입으면 입장료 무료, 10시 수문장 교대식 |\n| 12:00 | 광장시장 | 빈대떡·마약김밥, 평일 점심이 덜 붐빔 |\n| 14:00 | 북촌한옥마을 | 8경 포토스팟, 주민 거주지라 정숙 |\n| 16:00 | 인사동 | 쌈지길에서 전통차·기념품 쇼핑 |\n| 18:00 | 남산서울타워 | 일몰 30분 전 케이블카 탑승 추천 |',
      en: '| Time | Spot | Tip |\n|---|---|---|\n| 10:00 | Gyeongbokgung Palace | Free entry in hanbok; catch the 10am guard ceremony |\n| 12:00 | Gwangjang Market | Try bindaetteok & mayak gimbap; quieter on weekday lunch |\n| 14:00 | Bukchon Hanok Village | Walk the "8 views"; keep quiet, people live here |\n| 16:00 | Insadong | Shop tea & crafts in the Ssamziegil spiral mall |\n| 18:00 | Namsan Seoul Tower | Take the cable car ~30 min before sunset |',
      ja: '| 時間 | スポット | ヒント |\n|---|---|---|\n| 10:00 | 景福宮 | 韓服着用で入場無料、10時の守門将交代式 |\n| 12:00 | 広蔵市場 | ビンデトッ・麻薬キンパ、平日昼が空いている |\n| 14:00 | 北村韓屋村 | 北村八景の撮影スポット、住宅街なので静かに |\n| 16:00 | 仁寺洞 | サムジキルで伝統茶・お土産探し |\n| 18:00 | Nソウルタワー | 日没30分前のケーブルカーがおすすめ |',
      zh: '| 时间 | 景点 | 贴士 |\n|---|---|---|\n| 10:00 | 景福宫 | 穿韩服免门票，10点有守门将换岗仪式 |\n| 12:00 | 广藏市场 | 必尝绿豆煎饼与麻药紫菜包饭，工作日午餐人少 |\n| 14:00 | 北村韩屋村 | 北村八景拍照点，居民区请保持安静 |\n| 16:00 | 仁寺洞 | 在Ssamziegil逛传统茶与文创纪念品 |\n| 18:00 | 南山首尔塔 | 建议日落前约30分钟搭缆车上山 |',
    },
  },

  // ── 부산 ───────────────────────────────────────────────────────────
  {
    region: 'busan',
    regionLabel: { ko: '부산', en: 'Busan', ja: 'プサン', zh: '釜山' },
    themes: {
      ko: ['바다', '감성'],
      en: ['Seaside', 'Vibes'],
      ja: ['海', '感性'],
      zh: ['海滨', '文艺'],
    },
    narrative: {
      ko: '파도 소리로 하루를 열고 노을빛 해변으로 마무리하는 항구 도시. 산비탈을 알록달록 물들인 벽화 마을과 펄떡이는 수산시장, 그리고 절벽 끝 바다 전망까지 부산의 매력을 압축한 하루입니다.',
      en: 'A harbor city that opens with crashing waves and closes on a sunset beach. Pastel hillside murals, a market full of just-caught seafood, and dramatic cliff-edge ocean views pack Busan\'s best into one day.',
      ja: '波音で一日を始め、夕焼けの浜辺で締めくくる港町。山肌を彩る壁画村、活気あふれる魚市場、そして断崖からの海の眺めまで、プサンの魅力を凝縮した一日です。',
      zh: '以海浪声开启、以晚霞海滩收尾的港口城市。山坡上斑斓的壁画村、活蹦乱跳的水产市场，再到悬崖边的辽阔海景，将釜山的精华浓缩于一日。',
    },
    stops: [
      {
        time: '10:00',
        name: { ko: '해운대해수욕장', en: 'Haeundae Beach', ja: '海雲台海水浴場', zh: '海云台海水浴场' },
        tip: {
          ko: '아침 산책로가 한산, 동백섬 누리마루 연결',
          en: 'Quiet at dawn; stroll out to Dongbaek Island & Nurimaru',
          ja: '朝の散歩道は人が少なく、椿島ヌリマルへ続く',
          zh: '清晨步道清静，可步行至冬柏岛与Nurimaru',
        },
        lat: 35.1587,
        lng: 129.1604,
      },
      {
        time: '12:00',
        name: { ko: '자갈치시장', en: 'Jagalchi Market', ja: 'チャガルチ市場', zh: '札嘎其市场' },
        tip: {
          ko: '2층 회센터에서 즉석 회·해물탕',
          en: 'Pick fresh fish downstairs, eat it sliced upstairs',
          ja: '1階で魚を選び2階で刺身・海鮮鍋',
          zh: '楼下挑鲜鱼，楼上现切生鱼片与海鲜汤',
        },
        lat: 35.0967,
        lng: 129.0306,
        transit: {
          // 해운대역(2호선) → 자갈치역(1호선), 서면 환승. 도시 횡단이라 보수적 추정.
          mode: 'subway',
          estMin: 50,
          label: {
            ko: '지하철 2호선→1호선(서면 환승) · 약 50분',
            en: 'Subway L2→L1 (transfer at Seomyeon) · ~50 min',
            ja: '地下鉄2号線→1号線(西面で乗換) · 約50分',
            zh: '地铁2号线→1号线(西面换乘) · 约50分',
          },
        },
      },
      {
        time: '14:00',
        name: { ko: '감천문화마을', en: 'Gamcheon Culture Village', ja: '甘川文化村', zh: '甘川文化村' },
        tip: {
          ko: '어린왕자 포토스팟, 편한 신발 필수',
          en: 'Snap the Little Prince statue; wear comfy shoes',
          ja: '星の王子さま像が撮影スポット、歩きやすい靴を',
          zh: '小王子雕像拍照点，建议穿好走的鞋',
        },
        lat: 35.0976,
        lng: 129.0107,
        transit: {
          // 자갈치 → 감천문화마을: 토성역 + 마을버스(2·2-2·1-1) 또는 차량. 보수적 차량 안내.
          mode: 'car',
          estMin: 15,
          label: {
            ko: '차량(또는 토성역+마을버스) · 약 15분',
            en: 'Car (or Toseong Stn + village bus) · ~15 min',
            ja: '車(または土城駅+村バス) · 約15分',
            zh: '乘车(或土城站+社区巴士) · 约15分',
          },
        },
      },
      {
        time: '16:00',
        name: { ko: '광안리해변', en: 'Gwangalli Beach', ja: '広安里海水浴場', zh: '广安里海滩' },
        tip: {
          ko: '카페거리, 광안대교 배경 인증샷',
          en: 'Cafe strip with the Gwangan Bridge as backdrop',
          ja: 'カフェ通り、広安大橋を背景に一枚',
          zh: '咖啡街，以广安大桥为背景打卡',
        },
        lat: 35.1532,
        lng: 129.1187,
        transit: {
          // 감천 → 광안리: 도시 횡단. 차량 보수적 추정.
          mode: 'car',
          estMin: 35,
          label: {
            ko: '차량 · 약 35분',
            en: 'Car · ~35 min',
            ja: '車 · 約35分',
            zh: '乘车 · 约35分',
          },
        },
      },
      {
        time: '18:00',
        name: { ko: '태종대', en: 'Taejongdae', ja: '太宗台', zh: '太宗台' },
        tip: {
          ko: '다누비 열차로 절벽 전망대, 일몰 명소',
          en: 'Ride the Danubi train to clifftop sunset lookouts',
          ja: 'ダヌビ列車で断崖の展望台へ、夕日の名所',
          zh: '搭Danubi小火车上悬崖观景台，赏日落名所',
        },
        lat: 35.0531,
        lng: 129.0856,
        transit: {
          mode: 'car',
          estMin: 30,
          label: {
            ko: '차량 · 약 30분',
            en: 'Car · ~30 min',
            ja: '車 · 約30分',
            zh: '乘车 · 约30分',
          },
        },
      },
    ],
    day1Table: {
      ko: '| 시간 | 명소 | 팁 |\n|---|---|---|\n| 10:00 | 해운대해수욕장 | 아침 산책로가 한산, 동백섬 누리마루 연결 |\n| 12:00 | 자갈치시장 | 2층 회센터에서 즉석 회·해물탕 |\n| 14:00 | 감천문화마을 | 어린왕자 포토스팟, 편한 신발 필수 |\n| 16:00 | 광안리해변 | 카페거리, 광안대교 배경 인증샷 |\n| 18:00 | 태종대 | 다누비 열차로 절벽 전망대, 일몰 명소 |',
      en: '| Time | Spot | Tip |\n|---|---|---|\n| 10:00 | Haeundae Beach | Quiet at dawn; stroll out to Dongbaek Island & Nurimaru |\n| 12:00 | Jagalchi Market | Pick fresh fish downstairs, eat it sliced upstairs |\n| 14:00 | Gamcheon Culture Village | Snap the Little Prince statue; wear comfy shoes |\n| 16:00 | Gwangalli Beach | Cafe strip with the Gwangan Bridge as backdrop |\n| 18:00 | Taejongdae | Ride the Danubi train to clifftop sunset lookouts |',
      ja: '| 時間 | スポット | ヒント |\n|---|---|---|\n| 10:00 | 海雲台海水浴場 | 朝の散歩道は人が少なく、椿島ヌリマルへ続く |\n| 12:00 | チャガルチ市場 | 1階で魚を選び2階で刺身・海鮮鍋 |\n| 14:00 | 甘川文化村 | 星の王子さま像が撮影スポット、歩きやすい靴を |\n| 16:00 | 広安里海水浴場 | カフェ通り、広安大橋を背景に一枚 |\n| 18:00 | 太宗台 | ダヌビ列車で断崖の展望台へ、夕日の名所 |',
      zh: '| 时间 | 景点 | 贴士 |\n|---|---|---|\n| 10:00 | 海云台海水浴场 | 清晨步道清静，可步行至冬柏岛与Nurimaru |\n| 12:00 | 札嘎其市场 | 楼下挑鲜鱼，楼上现切生鱼片与海鲜汤 |\n| 14:00 | 甘川文化村 | 小王子雕像拍照点，建议穿好走的鞋 |\n| 16:00 | 广安里海滩 | 咖啡街，以广安大桥为背景打卡 |\n| 18:00 | 太宗台 | 搭Danubi小火车上悬崖观景台，赏日落名所 |',
    },
  },

  // ── 제주 ───────────────────────────────────────────────────────────
  {
    region: 'jeju',
    regionLabel: { ko: '제주', en: 'Jeju', ja: 'チェジュ', zh: '济州' },
    themes: {
      ko: ['자연', '바다'],
      en: ['Nature', 'Ocean'],
      ja: ['自然', '海'],
      zh: ['自然', '海岛'],
    },
    narrative: {
      ko: '화산이 빚은 봉우리에서 에메랄드빛 모래 해변까지, 섬 전체가 하나의 자연 박물관입니다. 일출봉 능선을 오르고, 폭포의 물안개를 맞고, 한라산 숲길에 잠시 발을 들이는 제주의 결정판 하루입니다.',
      en: 'From a volcanic crater peak to emerald-clear sand beaches, the whole island is one open-air nature museum. Climb the Sunrise Peak ridge, feel the spray off a waterfall, and step into Hallasan\'s forest trails on this quintessential Jeju day.',
      ja: '火山が生んだ峰からエメラルド色の砂浜まで、島全体がひとつの自然博物館です。日の出峰の稜線を登り、滝のしぶきを浴び、漢拏山の森の道に足を踏み入れる、チェジュの真髄の一日です。',
      zh: '从火山造就的山峰到翡翠色的沙滩，整座岛屿就是一座露天自然博物馆。登上日出峰山脊、迎接瀑布的水雾、踏入汉拿山的林间小径，这是济州的精髓一日。',
    },
    stops: [
      {
        time: '10:00',
        name: { ko: '성산일출봉', en: 'Seongsan Ilchulbong', ja: '城山日出峰', zh: '城山日出峰' },
        tip: {
          ko: '정상까지 약 25분, 미끄럼 방지 운동화',
          en: '~25 min hike to the crater rim; wear grippy shoes',
          ja: '頂上まで約25分、滑りにくい靴で',
          zh: '登顶约需25分钟，请穿防滑运动鞋',
        },
        lat: 33.4581,
        lng: 126.9425,
      },
      {
        time: '12:00',
        name: { ko: '동문시장', en: 'Dongmun Market', ja: '東門市場', zh: '东门市场' },
        tip: {
          ko: '흑돼지·갈치조림·오메기떡 맛보기',
          en: 'Try black pork, braised hairtail & omegi-tteok',
          ja: '黒豚・タチウオの煮付け・オメギ餅を味わう',
          zh: '品尝黑猪肉、炖带鱼与糯米饼(omegi)',
        },
        lat: 33.5114,
        lng: 126.5274,
        transit: {
          // 제주는 도시철도 없음 → 차량/버스. 성산~제주시 동문시장은 섬 횡단이라 보수적 추정.
          mode: 'car',
          estMin: 60,
          label: {
            ko: '차량 · 약 60분 (제주는 도시철도 없음)',
            en: 'Car · ~60 min (no metro on Jeju)',
            ja: '車 · 約60分 (済州に都市鉄道なし)',
            zh: '乘车 · 约60分 (济州无城市轨道)',
          },
        },
      },
      {
        time: '14:00',
        name: { ko: '천지연폭포', en: 'Cheonjiyeon Waterfall', ja: '天地淵滝', zh: '天地渊瀑布' },
        tip: {
          ko: '산책로 평탄, 야간 조명도 운치',
          en: 'Flat, easy boardwalk; lovely under night lights too',
          ja: '遊歩道は平坦、夜のライトアップも風情あり',
          zh: '步道平缓，夜间灯光别有韵味',
        },
        lat: 33.2470,
        lng: 126.5540,
        transit: {
          // 동문시장(제주시) → 천지연폭포(서귀포): 평화로/516 경유 차량. 보수적 추정.
          mode: 'car',
          estMin: 60,
          label: {
            ko: '차량 · 약 60분',
            en: 'Car · ~60 min',
            ja: '車 · 約60分',
            zh: '乘车 · 约60分',
          },
        },
      },
      {
        time: '16:00',
        name: { ko: '협재해수욕장', en: 'Hyeopjae Beach', ja: '挾才海水浴場', zh: '挟才海水浴场' },
        tip: {
          ko: '비양도 배경 에메랄드빛 바다 포토스팟',
          en: 'Emerald water with Biyangdo Island as your photo backdrop',
          ja: '飛揚島を背景にエメラルドの海で撮影',
          zh: '以飞扬岛为背景的翡翠海水拍照点',
        },
        lat: 33.3940,
        lng: 126.2396,
        transit: {
          mode: 'car',
          estMin: 70,
          label: {
            ko: '차량 · 약 70분',
            en: 'Car · ~70 min',
            ja: '車 · 約70分',
            zh: '乘车 · 约70分',
          },
        },
      },
      {
        time: '18:00',
        name: {
          ko: '한라산(어리목 입구)',
          en: 'Hallasan (Eorimok trailhead)',
          ja: '漢拏山(御里牧入口)',
          zh: '汉拿山(御里牧登山口)',
        },
        tip: {
          ko: '가벼운 숲길 산책, 일몰 전 하산 권장',
          en: 'Easy forest stroll; head back down before sunset',
          ja: '軽い森の散策、日没前の下山がおすすめ',
          zh: '轻松林间漫步，建议日落前下山',
        },
        lat: 33.3870,
        lng: 126.4926,
        transit: {
          mode: 'car',
          estMin: 50,
          label: {
            ko: '차량 · 약 50분',
            en: 'Car · ~50 min',
            ja: '車 · 約50分',
            zh: '乘车 · 约50分',
          },
        },
      },
    ],
    day1Table: {
      ko: '| 시간 | 명소 | 팁 |\n|---|---|---|\n| 10:00 | 성산일출봉 | 정상까지 약 25분, 미끄럼 방지 운동화 |\n| 12:00 | 동문시장 | 흑돼지·갈치조림·오메기떡 맛보기 |\n| 14:00 | 천지연폭포 | 산책로 평탄, 야간 조명도 운치 |\n| 16:00 | 협재해수욕장 | 비양도 배경 에메랄드빛 바다 포토스팟 |\n| 18:00 | 한라산(어리목·영실 입구) | 가벼운 숲길 산책, 일몰 전 하산 권장 |',
      en: '| Time | Spot | Tip |\n|---|---|---|\n| 10:00 | Seongsan Ilchulbong | ~25 min hike to the crater rim; wear grippy shoes |\n| 12:00 | Dongmun Market | Try black pork, braised hairtail & omegi-tteok |\n| 14:00 | Cheonjiyeon Waterfall | Flat, easy boardwalk; lovely under night lights too |\n| 16:00 | Hyeopjae Beach | Emerald water with Biyangdo Island as your photo backdrop |\n| 18:00 | Hallasan (Eorimok / Yeongsil trailhead) | Easy forest stroll; head back down before sunset |',
      ja: '| 時間 | スポット | ヒント |\n|---|---|---|\n| 10:00 | 城山日出峰 | 頂上まで約25分、滑りにくい靴で |\n| 12:00 | 東門市場 | 黒豚・タチウオの煮付け・オメギ餅を味わう |\n| 14:00 | 天地淵滝 | 遊歩道は平坦、夜のライトアップも風情あり |\n| 16:00 | 挾才海水浴場 | 飛揚島を背景にエメラルドの海で撮影 |\n| 18:00 | 漢拏山(御里牧・霊室の入口) | 軽い森の散策、日没前の下山がおすすめ |',
      zh: '| 时间 | 景点 | 贴士 |\n|---|---|---|\n| 10:00 | 城山日出峰 | 登顶约需25分钟，请穿防滑运动鞋 |\n| 12:00 | 东门市场 | 品尝黑猪肉、炖带鱼与糯米饼(omegi) |\n| 14:00 | 天地渊瀑布 | 步道平缓，夜间灯光别有韵味 |\n| 16:00 | 挟才海水浴场 | 以飞扬岛为背景的翡翠海水拍照点 |\n| 18:00 | 汉拿山(御里牧·灵室登山口) | 轻松林间漫步，建议日落前下山 |',
    },
  },
];
