/**
 * Home copy — Korea Editorial Concierge (2026-08-10).
 *
 * Local 4-language dictionary rather than `src/i18n/locales/*.json`, following
 * the same rule FeatureOverview.tsx already uses: the home tree is a lazy
 * chunk, and en.json is eager. Adding ~90 strings there would spend the
 * remaining margin under the 143 KB first-paint gate (.size-limit.json) for
 * copy the first paint does not need. Keys still exist in all four languages —
 * `tests/unit/editorial-home-foundation.test.ts` fails if one drifts.
 *
 * Every claim below is checkable in code. See §5 of
 * docs/DESIGN-EDITORIAL-CONCIERGE.md for the claim → source table.
 * Do not add a number here that nothing computes.
 */

export type HomeLang = 'ko' | 'en' | 'ja' | 'zh';

/** Restaurant database facts. Mirrored from `api/_food_index.json`, which the
 *  frontend must not import (api/ and src/ never cross-import — the bundle
 *  would swallow a 3 MB index). `tests/unit/editorial-home-foundation.test.ts`
 *  recomputes both numbers from the real file and fails on drift. */
export const FOOD_DB = {
  restaurants: 3166,
  cities: 25,
} as const;

export interface HomeCopy {
  hero: {
    eyebrow: string;
    headline: string;
    lede: string;
    ctaPrimary: string;
    ctaSecondary: string;
    pickCity: string;
    otherCities: string;
    photoCredit: string;
  };
  ledger: {
    eyebrow: string;
    heading: string;
    lede: string;
    items: { figure: string; label: string; note: string }[];
    trustLine: string;
    limits: string;
  };
  modules: {
    eyebrow: string;
    heading: string;
    plan: { kicker: string; title: string; body: string; cta: string };
    charter: { kicker: string; title: string; body: string; cta: string };
    tours: { kicker: string; title: string; body: string; cta: string };
  };
  specimen: {
    eyebrow: string;
    heading: string;
    lede: string;
    sampleBadge: string;
    mapLink: string;
    dayLabel: string;
    stopsLabel: string;
  };
  /** 지역 페이지로 들어가는 유일한 공개 입구. 문구는 지역 지식을 주장하지 않는다 —
   *  각 지역이 무엇인지는 그 페이지의 i18n 이 이미 들고 있고, 여기서는 그 페이지가
   *  무엇을 담고 있는지만 말한다. */
  regions: {
    eyebrow: string;
    heading: string;
    lede: string;
  };
  closing: {
    reviewsEyebrow: string;
    reviewsHeading: string;
    reviewsBody: string;
    reviewsCta: string;
    trust: string[];
    guideEyebrow: string;
    guideHeading: string;
    guideCta: string;
    ctaHeading: string;
    ctaBody: string;
    ctaPrimary: string;
    ctaSecondary: string;
  };
  resume: { label: string; cta: string };
}

export const HOME_COPY: Record<HomeLang, HomeCopy> = {
  en: {
    hero: {
      eyebrow: 'Korea — itineraries, private tours, charter',
      headline: 'Tell us the trip. We write the Korea itinerary you can actually run.',
      lede: 'Your dates, cities, pace and dietary rules go in. What comes back is a timed day-by-day plan built on our own Korea database — real places, the transit leg between them, and a map pin on every stop.',
      ctaPrimary: 'Start your itinerary',
      ctaSecondary: 'See a finished plan',
      pickCity: 'Start with a city',
      otherCities: 'Somewhere else',
      photoCredit: 'Photography: Korea Tourism Organization',
    },
    ledger: {
      eyebrow: 'What the plan is built from',
      heading: 'Korea-only data, not a general travel search',
      lede: 'We do not hand your trip to a generic search index. Restaurants, routes and intercity legs come from data we maintain for Korea specifically, which is why a plan can be followed rather than only read.',
      items: [
        { figure: '3,166', label: 'restaurants in our Korea database', note: 'Coordinates on every entry, a cuisine type on nearly all of them, and a verification tier (operator-certified, Google-sourced, or unverified) for halal and vegan picks.' },
        { figure: '25', label: 'Korean cities covered', note: 'Seoul and Busan through Gyeongju, Jeonju, Sokcho, Yeosu and Tongyeong.' },
        { figure: 'Leg by leg', label: 'transit between stops, with its source', note: 'Where a route lookup returns a result we use its line, direction and duration. Where it does not, the leg is an estimate and the plan labels it as one.' },
      ],
      trustLine: 'Licensed Korean tour operator · payment through PayPal · English support, every day',
      limits: 'What we do not claim: live opening hours, live seat availability, or that every halal/vegan match is operator-certified — most are Google-sourced "friendly" listings, not certifications. Confirm anything medical or religious with the venue.',
    },
    modules: {
      eyebrow: 'Three ways to travel with us',
      heading: 'Plan it, ride it, or join a private tour',
      plan: {
        kicker: 'Written for you',
        title: 'A day-by-day Korea itinerary',
        body: 'Answer a short brief — dates, cities, how fast you like to move, what you cannot eat. You get timed stops, the transit leg between each one, restaurant picks filtered to your diet, and a map you can open on the street.',
        cta: 'Start the brief',
      },
      charter: {
        kicker: 'With a driver',
        title: 'Private vehicle and airport pickup',
        body: 'A van and an English-speaking driver for the day, the airport run, or a multi-day route. Prices are per vehicle and shown before you book — no per-head arithmetic at the end.',
        cta: 'See charter options',
      },
      tours: {
        kicker: 'Already routed',
        title: 'Private day tours',
        body: 'Fixed routes we run often, kept private to your group. Useful when you want someone else to have made the decisions.',
        cta: 'Browse tours',
      },
    },
    specimen: {
      eyebrow: 'Sample output',
      heading: 'This is what a day looks like',
      lede: 'Day one from three regions, exactly as the planner writes it: clock times, the transit leg between stops, and real coordinates behind every map link.',
      sampleBadge: 'Sample',
      mapLink: 'Open in maps',
      dayLabel: 'Day 1',
      stopsLabel: 'stops',
    },
    regions: {
      eyebrow: 'Regions',
      heading: 'Nine Korean regions, one page each',
      lede: 'Every page carries the same three things: what there is to see, a photo set for the place, and which of our tours and planner cities reach it.',
    },
    closing: {
      reviewsEyebrow: 'Reviews',
      reviewsHeading: 'We do not print a score we cannot show you',
      reviewsBody: 'There is no aggregate rating on this page because we do not have a verified feed to read one from. If you have travelled with us, the honest place to say so is Google.',
      reviewsCta: 'Review us on Google',
      trust: ['Licensed tour operator', 'English support, every day', 'Private guide and vehicle'],
      guideEyebrow: 'From the guide',
      guideHeading: 'Written before you need it',
      guideCta: 'All guides',
      ctaHeading: 'Start with the first day',
      ctaBody: 'The brief takes a few minutes. You can change the plan afterwards.',
      ctaPrimary: 'Start your itinerary',
      ctaSecondary: 'Talk to us first',
    },
    resume: { label: 'Your next trip', cta: 'Open plan' },
  },

  ko: {
    hero: {
      eyebrow: '한국 — 일정·프라이빗 투어·전세차량',
      headline: '여행 조건을 알려주세요. 그대로 실행할 수 있는 한국 일정을 씁니다.',
      lede: '날짜, 도시, 이동 속도, 못 먹는 음식을 넣으면 자체 한국 데이터로 시간대별 일정을 만들어 드립니다. 실재하는 장소, 장소 사이의 이동 구간, 그리고 모든 정거장의 지도 좌표까지 포함합니다.',
      ctaPrimary: '일정 만들기',
      ctaSecondary: '완성된 플랜 보기',
      pickCity: '도시부터 고르기',
      otherCities: '다른 지역',
      photoCredit: '사진: 한국관광공사',
    },
    ledger: {
      eyebrow: '일정을 만드는 재료',
      heading: '일반 여행 검색이 아니라 한국 전용 데이터',
      lede: '범용 검색 결과를 그대로 옮기지 않습니다. 식당, 이동 경로, 도시 간 구간 모두 한국을 위해 직접 관리하는 데이터에서 나옵니다. 그래서 읽고 마는 일정이 아니라 따라갈 수 있는 일정이 됩니다.',
      items: [
        { figure: '3,166', label: '자체 한국 식당 데이터', note: '전 항목에 좌표, 대부분에 음식 종류를 보유하며, 할랄·비건 항목에는 검증 등급(운영자 인증/구글 기반/미검증)을 표시합니다.' },
        { figure: '25', label: '수록 도시', note: '서울·부산부터 경주, 전주, 속초, 여수, 통영까지.' },
        { figure: '구간별', label: '정거장 사이 이동, 출처를 함께', note: '실시간 경로 조회가 되는 구간은 노선·방향·소요 시간을 그대로 씁니다. 안 되는 구간은 추정으로 계산하고, 플랜에 추정이라고 적습니다.' },
      ],
      trustLine: '관광사업 등록 업체 · PayPal 결제 · 영어 응대 상시',
      limits: '주장하지 않는 것: 실시간 영업시간, 실시간 좌석 현황, 모든 할랄·비건 매칭이 인증되었다는 보증(대부분은 구글 기반 "친화" 등급이며 인증이 아닙니다). 건강·종교 관련 사항은 반드시 현장에 직접 확인하세요.',
    },
    modules: {
      eyebrow: '함께 여행하는 세 가지 방법',
      heading: '일정을 만들거나, 차로 이동하거나, 프라이빗 투어에 함께하거나',
      plan: {
        kicker: '직접 작성',
        title: '일자별 한국 일정',
        body: '짧은 질문에 답하면 됩니다. 날짜, 도시, 선호하는 이동 속도, 못 먹는 음식. 시간이 찍힌 정거장, 각 구간의 이동 수단, 식이 조건으로 걸러낸 식당, 그리고 현장에서 바로 열 수 있는 지도를 받습니다.',
        cta: '조건 입력 시작',
      },
      charter: {
        kicker: '기사 포함',
        title: '전세차량과 공항 픽업',
        body: '하루 단위 밴과 영어 가능 기사, 공항 이동, 여러 날 코스까지. 가격은 차량 단위로 예약 전에 표시됩니다. 마지막에 인원수로 다시 계산하지 않습니다.',
        cta: '전세차량 보기',
      },
      tours: {
        kicker: '코스 확정',
        title: '프라이빗 데이 투어',
        body: '자주 운영하는 고정 코스를, 일행끼리만 프라이빗으로. 결정을 남에게 맡기고 싶을 때 좋습니다.',
        cta: '투어 둘러보기',
      },
    },
    specimen: {
      eyebrow: '실제 결과물',
      heading: '하루가 이렇게 나옵니다',
      lede: '세 개 지역의 1일차를, 플래너가 쓰는 형식 그대로. 시각, 정거장 사이 이동 구간, 그리고 모든 지도 링크 뒤의 실제 좌표까지.',
      sampleBadge: '예시',
      mapLink: '지도에서 열기',
      dayLabel: '1일차',
      stopsLabel: '곳',
    },
    regions: {
      eyebrow: '지역',
      heading: '한국 아홉 개 지역, 한 곳당 한 페이지',
      lede: '어느 페이지든 담는 것은 같습니다 — 무엇을 볼 수 있는지, 그 지역 사진 모음, 그리고 어떤 투어와 플래너 도시가 그 지역에 닿는지.',
    },
    closing: {
      reviewsEyebrow: '후기',
      reviewsHeading: '보여줄 수 없는 점수는 적지 않습니다',
      reviewsBody: '이 페이지에 종합 평점이 없는 이유는 간단합니다. 검증된 후기 데이터를 아직 연결하지 않았기 때문입니다. 함께 여행하셨다면 구글에 솔직하게 남겨 주세요.',
      reviewsCta: '구글에 후기 남기기',
      trust: ['관광사업 등록 업체', '영어 응대 상시', '프라이빗 가이드·차량'],
      guideEyebrow: '가이드',
      guideHeading: '필요해지기 전에 미리 써 둔 글',
      guideCta: '가이드 전체 보기',
      ctaHeading: '1일차부터 시작하세요',
      ctaBody: '조건 입력은 몇 분이면 됩니다. 만든 뒤에도 수정할 수 있습니다.',
      ctaPrimary: '일정 만들기',
      ctaSecondary: '먼저 문의하기',
    },
    resume: { label: '다가오는 여행', cta: '플랜 열기' },
  },

  ja: {
    hero: {
      eyebrow: '韓国 — 旅程・プライベートツアー・貸切車',
      headline: '旅の条件を教えてください。そのまま実行できる韓国の旅程をお作りします。',
      lede: '日付、都市、移動のペース、食べられないものを入力すると、独自の韓国データで時間ごとの旅程を作成します。実在する場所、場所と場所をつなぐ移動区間、そして全スポットの地図座標つきです。',
      ctaPrimary: '旅程をつくる',
      ctaSecondary: '完成した旅程を見る',
      pickCity: '都市から選ぶ',
      otherCities: 'ほかの地域',
      photoCredit: '写真：韓国観光公社',
    },
    ledger: {
      eyebrow: '旅程をつくる材料',
      heading: '一般的な旅行検索ではなく、韓国専用のデータ',
      lede: '汎用の検索結果をそのまま並べることはしません。レストラン、移動ルート、都市間の移動はすべて、韓国のために自社で管理しているデータから引いています。だから読むだけでなく、実際に辿れる旅程になります。',
      items: [
        { figure: '3,166', label: '自社の韓国レストランデータ', note: '全件に座標、ほぼ全件に料理ジャンルを保持し、ハラル・ビーガン項目には検証段階（運営者認証・Google由来・未検証）を表示します。' },
        { figure: '25', label: '収録都市', note: 'ソウル・釜山から慶州、全州、束草、麗水、統営まで。' },
        { figure: '区間ごと', label: 'スポット間の移動を、出典つきで', note: 'リアルタイム経路が取得できた区間は路線・方向・所要時間をそのまま使います。取得できない区間は推定で算出し、旅程にも推定と明記します。' },
      ],
      trustLine: '観光事業登録済み · PayPal決済 · 英語対応は毎日',
      limits: '主張しないこと：リアルタイムの営業時間、リアルタイムの空席状況、すべてのハラル・ビーガン一致が認証済みであるという保証（大半はGoogle由来の「フレンドリー」判定で認証ではありません）。健康・宗教に関わることは必ず現地でご確認ください。',
    },
    modules: {
      eyebrow: '一緒に旅する3つの方法',
      heading: '旅程をつくる、車で移動する、プライベートツアーに参加する',
      plan: {
        kicker: '個別に作成',
        title: '日ごとの韓国旅程',
        body: '短い質問に答えるだけです。日付、都市、好みの移動ペース、食べられないもの。時刻つきのスポット、区間ごとの移動手段、食事条件で絞り込んだレストラン、そして現地ですぐ開ける地図をお渡しします。',
        cta: '条件を入力する',
      },
      charter: {
        kicker: 'ドライバー付き',
        title: '貸切車と空港送迎',
        body: '1日単位のバンと英語が話せるドライバー、空港送迎、複数日のルートまで。料金は車両単位で予約前に表示します。最後に人数で計算し直すことはありません。',
        cta: '貸切車を見る',
      },
      tours: {
        kicker: 'ルート確定',
        title: 'プライベート日帰りツアー',
        body: 'よく催行している固定ルートを、お連れ様だけのプライベートで。判断を任せたいときに向いています。',
        cta: 'ツアーを見る',
      },
    },
    specimen: {
      eyebrow: '実際の出力',
      heading: '1日はこう出てきます',
      lede: '3地域の1日目を、プランナーが書く形式そのままで。時刻、スポット間の移動区間、そしてすべての地図リンクの裏にある実在の座標まで。',
      sampleBadge: 'サンプル',
      mapLink: '地図で開く',
      dayLabel: '1日目',
      stopsLabel: 'ヶ所',
    },
    regions: {
      eyebrow: '地域',
      heading: '韓国の9地域、1地域につき1ページ',
      lede: 'どのページも載せるものは同じです — 何が見られるか、その地域の写真、そしてどのツアーとプランナー対応都市がその地域に届くか。',
    },
    closing: {
      reviewsEyebrow: 'レビュー',
      reviewsHeading: 'お見せできない点数は書きません',
      reviewsBody: 'このページに総合評価がないのは、検証済みのレビューデータをまだ接続していないからです。ご一緒したことがあれば、正直なところをGoogleに残してください。',
      reviewsCta: 'Googleにレビューを書く',
      trust: ['観光事業登録済み', '英語対応は毎日', 'プライベートガイド・車両'],
      guideEyebrow: 'ガイド',
      guideHeading: '必要になる前に書いておいた記事',
      guideCta: 'ガイド一覧',
      ctaHeading: '1日目からはじめましょう',
      ctaBody: '条件の入力は数分です。作ったあとで変更もできます。',
      ctaPrimary: '旅程をつくる',
      ctaSecondary: 'まず相談する',
    },
    resume: { label: '次の旅', cta: 'プランを開く' },
  },

  zh: {
    hero: {
      eyebrow: '韩国 — 行程·私人包团·包车',
      headline: '告诉我们出行条件，我们写出可以直接执行的韩国行程。',
      lede: '输入日期、城市、行程节奏和饮食忌口，我们用自有的韩国数据生成分时段行程：真实存在的地点、地点之间的交通区间，以及每个站点的地图坐标。',
      ctaPrimary: '开始制定行程',
      ctaSecondary: '查看完整行程',
      pickCity: '先选城市',
      otherCities: '其他地区',
      photoCredit: '照片：韩国观光公社',
    },
    ledger: {
      eyebrow: '行程的原料',
      heading: '不是通用旅行搜索，而是韩国专用数据',
      lede: '我们不会把通用搜索结果直接搬过来。餐厅、路线和城际交通都来自我们专为韩国维护的数据，所以行程不只是能读，而是能照着走。',
      items: [
        { figure: '3,166', label: '自有韩国餐厅数据', note: '每条都带坐标，绝大多数带菜系信息；清真、纯素条目附验证等级(运营方认证/谷歌来源/未验证)。' },
        { figure: '25', label: '收录城市', note: '从首尔、釜山到庆州、全州、束草、丽水、统营。' },
        { figure: '逐段', label: '站点之间的交通，并标注来源', note: '能查到实时路径的路段，直接采用其线路、方向和耗时。查不到的路段按估算处理，并在行程里标明是估算。' },
      ],
      trustLine: '已注册旅行社 · PayPal 支付 · 英语支持全天候',
      limits: '我们不主张的：实时营业时间、实时余位、所有清真/纯素匹配均经认证(多数为谷歌来源的"友好"标注，非认证)。涉及健康或宗教的事项请务必向商家当面确认。',
    },
    modules: {
      eyebrow: '同行的三种方式',
      heading: '制定行程、包车出行，或参加私人团',
      plan: {
        kicker: '为你撰写',
        title: '逐日的韩国行程',
        body: '回答几个问题即可：日期、城市、喜欢的节奏、不能吃的东西。你会拿到带时刻的站点、每段之间的交通方式、按饮食条件筛过的餐厅，以及在路上就能打开的地图。',
        cta: '开始填写条件',
      },
      charter: {
        kicker: '含司机',
        title: '包车与机场接送',
        body: '按天计的商务车与会英语的司机，机场接送，或多日路线。价格按车辆计算并在预订前显示，不会在最后再按人头重算。',
        cta: '查看包车',
      },
      tours: {
        kicker: '路线已定',
        title: '私人一日游',
        body: '我们常发的固定路线，只属于你们一行人。想把决定交给别人时很合适。',
        cta: '浏览产品',
      },
    },
    specimen: {
      eyebrow: '真实产出',
      heading: '一天长这样',
      lede: '三个地区的第一天，就按行程生成的原样：时刻、站点之间的交通区间，以及每个地图链接背后的真实坐标。',
      sampleBadge: '示例',
      mapLink: '在地图中打开',
      dayLabel: '第1天',
      stopsLabel: '处',
    },
    regions: {
      eyebrow: '地区',
      heading: '韩国九个地区，每个地区一个页面',
      lede: '每个页面收录的内容相同：可以看什么、该地区的照片，以及哪些旅游产品和行程规划城市能到达该地区。',
    },
    closing: {
      reviewsEyebrow: '评价',
      reviewsHeading: '拿不出依据的分数，我们就不写',
      reviewsBody: '这个页面没有综合评分，是因为我们还没有接入可核验的评价数据源。如果你和我们同行过，最实在的地方是去 Google 留下真实评价。',
      reviewsCta: '去 Google 写评价',
      trust: ['已注册旅行社', '英语支持全天候', '私人向导与车辆'],
      guideEyebrow: '指南',
      guideHeading: '在你需要之前就写好的内容',
      guideCta: '全部指南',
      ctaHeading: '从第一天开始',
      ctaBody: '填写条件只要几分钟，生成之后还能修改。',
      ctaPrimary: '开始制定行程',
      ctaSecondary: '先联系我们',
    },
    resume: { label: '即将出发', cta: '打开行程' },
  },
};

export function pickHomeCopy(language: string): HomeCopy {
  return HOME_COPY[language as HomeLang] || HOME_COPY.en;
}

/** Destination chips. Keys must be in `CITY_KEYS` (WizardForm/cityKeys.ts, the
 *  allowlist PlannerPage validates `?prefillRegions=` against) or the deep link
 *  is dropped as unknown; photos are the committed KTO stills in
 *  public/city-thumbs/. */
export const HOME_CITIES: { key: string; photo: string; label: Record<HomeLang, string> }[] = [
  { key: 'seoul',    photo: '/city-thumbs/seoul.jpg',    label: { en: 'Seoul',    ko: '서울',   ja: 'ソウル',   zh: '首尔' } },
  { key: 'busan',    photo: '/city-thumbs/busan.jpg',    label: { en: 'Busan',    ko: '부산',   ja: '釜山',     zh: '釜山' } },
  { key: 'jeju',     photo: '/city-thumbs/jeju.jpg',     label: { en: 'Jeju',     ko: '제주',   ja: '済州',     zh: '济州' } },
  { key: 'gyeongju', photo: '/city-thumbs/gyeongju.jpg', label: { en: 'Gyeongju', ko: '경주',   ja: '慶州',     zh: '庆州' } },
  { key: 'gangneung', photo: '/city-thumbs/gangneung.jpg', label: { en: 'Gangneung', ko: '강릉', ja: '江陵',   zh: '江陵' } },
];

/** Guide posts — same three evergreen routes BlogTeaser curates. Real /guide pages. */
export const HOME_GUIDES = [
  { to: '/guide/seoul-cafe-guide-2026-best', title: 'Seoul Cafe Guide 2026: Best Neighborhoods & What to Know' },
  { to: '/guide/how-to-ace-your-first-k-pop-concert-in', title: 'How to Ace Your First K-Pop Concert in Korea' },
  { to: '/guide/how-to-find-halal-food-in-seoul-2026', title: 'How to Find Halal Food in Seoul' },
];
