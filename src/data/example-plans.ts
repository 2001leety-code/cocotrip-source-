// Static example plans for the ad landing page "지역별 예시 플랜" showcase.
// 2026-06-28: 광고 랜딩용 정적 데이터. QuickPreviewCard 가 기대하는 day1MarkdownTable
//   (3컬럼 마크다운 표: 시간 | 명소 | 팁) 형식과 동일. 마크다운 표 형식은
//   api/ai-planner-quick.js 의 FALLBACK(L27-48) 과 일치시킴.
//   ⚠️ 모든 장소는 실재하는 대표 관광지만 사용. 가짜 장소/주소 금지.
//   i18n 4-lang(ko/en/ja/zh) 동시 작성 — 기계번역 티 안 나게 자연스럽게.

/** 4개 언어 동시 표기 (프로젝트 표준: src/i18n Language = 'ko' | 'en' | 'ja' | 'zh'). */
export interface ExamplePlanI18n<T = string> {
  ko: T;
  en: T;
  ja: T;
  zh: T;
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
   * 1일차 타임라인 마크다운 표 (QuickPreviewCard 의 day1MarkdownTable).
   * 형식: `| 시간 | 명소 | 팁 |` 3컬럼, 5행(10:00~18:00).
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
    day1Table: {
      ko: '| 시간 | 명소 | 팁 |\n|---|---|---|\n| 10:00 | 성산일출봉 | 정상까지 약 25분, 미끄럼 방지 운동화 |\n| 12:00 | 동문시장 | 흑돼지·갈치조림·오메기떡 맛보기 |\n| 14:00 | 천지연폭포 | 산책로 평탄, 야간 조명도 운치 |\n| 16:00 | 협재해수욕장 | 비양도 배경 에메랄드빛 바다 포토스팟 |\n| 18:00 | 한라산(어리목·영실 입구) | 가벼운 숲길 산책, 일몰 전 하산 권장 |',
      en: '| Time | Spot | Tip |\n|---|---|---|\n| 10:00 | Seongsan Ilchulbong | ~25 min hike to the crater rim; wear grippy shoes |\n| 12:00 | Dongmun Market | Try black pork, braised hairtail & omegi-tteok |\n| 14:00 | Cheonjiyeon Waterfall | Flat, easy boardwalk; lovely under night lights too |\n| 16:00 | Hyeopjae Beach | Emerald water with Biyangdo Island as your photo backdrop |\n| 18:00 | Hallasan (Eorimok / Yeongsil trailhead) | Easy forest stroll; head back down before sunset |',
      ja: '| 時間 | スポット | ヒント |\n|---|---|---|\n| 10:00 | 城山日出峰 | 頂上まで約25分、滑りにくい靴で |\n| 12:00 | 東門市場 | 黒豚・タチウオの煮付け・オメギ餅を味わう |\n| 14:00 | 天地淵滝 | 遊歩道は平坦、夜のライトアップも風情あり |\n| 16:00 | 挾才海水浴場 | 飛揚島を背景にエメラルドの海で撮影 |\n| 18:00 | 漢拏山(御里牧・霊室の入口) | 軽い森の散策、日没前の下山がおすすめ |',
      zh: '| 时间 | 景点 | 贴士 |\n|---|---|---|\n| 10:00 | 城山日出峰 | 登顶约需25分钟，请穿防滑运动鞋 |\n| 12:00 | 东门市场 | 品尝黑猪肉、炖带鱼与糯米饼(omegi) |\n| 14:00 | 天地渊瀑布 | 步道平缓，夜间灯光别有韵味 |\n| 16:00 | 挟才海水浴场 | 以飞扬岛为背景的翡翠海水拍照点 |\n| 18:00 | 汉拿山(御里牧·灵室登山口) | 轻松林间漫步，建议日落前下山 |',
    },
  },
];
