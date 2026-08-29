/**
 * Crawled-not-indexed 지역 7개의 선택 안내 (2026-08-29).
 *
 * 사실 원천은 세 곳뿐이다.
 *   - 지역명·소개·명소: src/i18n/locales/{ko,en,ja,zh}.json 의 regionDetail
 *   - 실제 판매 코스·순서: src/data/tours.ts (화면에서는 id로 다시 찾아 실시간 렌더)
 *   - 플래너 대상 도시 여부: src/components/WizardForm/data.ts 의 CITY_CHIPS
 *
 * 이 파일은 새 관광 사실이나 운영시간을 만들지 않는다. 이미 공개된 명소를 어떤 여행 목적에
 * 맞춰 읽을지, 고정 상품과 자유 일정 중 무엇을 고를지만 설명한다.
 */

export type RegionDecisionLanguage = 'ko' | 'en' | 'ja' | 'zh';

type LocalizedText = Record<RegionDecisionLanguage, string>;

type ProductFlow = {
  kind: 'tour';
  tourId: string;
};

type EditorialFlow = {
  kind: 'editorial';
  lead: LocalizedText;
  steps: LocalizedText[];
};

export type RegionDecisionGuide = {
  bestFor: LocalizedText;
  movement: LocalizedText;
  flow: ProductFlow | EditorialFlow;
  relatedTourIds: string[];
  relatedRegion?: {
    id: string;
    title: LocalizedText;
    description: LocalizedText;
  };
  actions?: Array<'planner' | 'charter'>;
};

export const INDEXING_CONTENT_REGION_IDS = [
  'paju',
  'ganghwa',
  'busan',
  'danyang',
  'incheon',
  'gyeongju',
  'jeonju',
] as const;

type IndexingContentRegionId = (typeof INDEXING_CONTENT_REGION_IDS)[number];

export const REGION_DECISION_GUIDES: Record<IndexingContentRegionId, RegionDecisionGuide> = {
  paju: {
    bestFor: {
      ko: '임진각·DMZ 평화의 길처럼 분단의 현장을 이해하는 여행과 헤이리·출판도시의 예술·책 공간 중 무엇을 우선할지 먼저 고르고 싶은 여행자에게 맞습니다.',
      en: 'Paju suits travelers choosing between a border-history day around Imjingak and the DMZ Peace Trail, and an art-and-books day around Heyri and Paju Book City.',
      ja: '臨津閣・DMZ平和の道を中心に境界の歴史を学ぶ日と、ヘイリ・出版都市で芸術や本に触れる日のどちらを優先するか決めたい方に向いています。',
      zh: '坡州适合想先在两种主题中做选择的旅行者：以临津阁、DMZ和平之路为主的边境历史之旅，或以Heyri艺术村、出版都市为主的艺术与书籍之旅。',
    },
    movement: {
      ko: '현재 고정 상품은 임진각에서 시작해 제3땅굴·도라산 전망대·도라산역으로 이어지는 DMZ 중심 코스입니다. 헤이리·프로방스·출판도시가 주목적이면 같은 상품에 포함됐다고 가정하지 말고 전세 차량 경로를 따로 문의하세요.',
      en: 'The current set product is a DMZ-focused route from Imjingak through the 3rd Tunnel, Dorasan Observatory and Dorasan Station. If Heyri, Provence or Paju Book City is your priority, do not assume they are part of that product; ask for a separate charter route.',
      ja: '現在の既定商品は、臨津閣から第3トンネル・都羅山展望台・都羅山駅へ進むDMZ中心のコースです。ヘイリ、プロヴァンス、出版都市が主目的なら同じ商品に含まれると考えず、別の貸切ルートをご相談ください。',
      zh: '当前固定产品以DMZ为中心，从临津阁依次前往第三隧道、都罗山观景台和都罗山站。若主要想去Heyri、普罗旺斯或出版都市，请不要默认它们包含在同一产品内，应另行咨询包车路线。',
    },
    flow: { kind: 'tour', tourId: 'tour-dmz' },
    relatedTourIds: ['tour-dmz'],
    actions: ['charter'],
  },
  ganghwa: {
    bestFor: {
      ko: '전등사·강화도성·고인돌 같은 역사 유적과 갯벌·일몰·루지 같은 야외 경험을 한 섬에서 비교해 고르고 싶은 여행자에게 맞습니다.',
      en: 'Ganghwa suits travelers who want to choose among historic sites such as Jeondeungsa, Ganghwaseong Fortress and the dolmens, plus outdoor options such as mudflats, sunset and luge.',
      ja: '伝燈寺・江華城・支石墓などの歴史遺産と、干潟・夕日・リュージュなどの屋外体験を一つの島で比べて選びたい方に向いています。',
      zh: '江华岛适合想在同一座岛上比较并选择历史遗迹与户外体验的旅行者，例如传灯寺、江华城、支石墓，以及滩涂、日落和雪橇。',
    },
    movement: {
      ko: '현재 고정 상품은 서울 왕복 차량으로 전등사·광성보·동막해변을 순서대로 잇습니다. 동막해변이나 갯벌이 핵심이면 물때 확인 안내를 먼저 보고, 역사 유적 중심이면 야외 체험을 필수 일정처럼 잡지 않아도 됩니다.',
      en: 'The current set product uses a round-trip vehicle from Seoul and links Jeondeungsa, Gwangseongbo Fortress and Dongmak Beach in sequence. If the beach or mudflat is your priority, check the tide guidance first; a history-led day does not need to treat the outdoor activity as mandatory.',
      ja: '現在の既定商品はソウル往復の車両で、伝燈寺・広城堡・東幕海辺を順に結びます。海辺や干潟が目的なら先に潮の案内を確認し、歴史遺産が中心なら屋外体験を必須にする必要はありません。',
      zh: '当前固定产品以首尔往返车辆依次连接传灯寺、广城堡和东幕海边。若海边或滩涂是重点，请先查看潮汐提示；若以历史遗迹为主，也不必把户外体验设为必选。',
    },
    flow: { kind: 'tour', tourId: 'tour-ganghwa' },
    relatedTourIds: ['tour-ganghwa'],
    relatedRegion: {
      id: 'incheon',
      title: { ko: '인천 여행 판단', en: 'Compare Incheon', ja: '仁川と比較', zh: '比较仁川' },
      description: {
        ko: '차이나타운·개항장·송도처럼 인천 시내가 더 중요한지 비교합니다.',
        en: 'Compare whether Chinatown, the Open Port Area and Songdo are a better fit than an island-led day.',
        ja: 'チャイナタウン・開港場・松島など、仁川市内を中心にする方が合うか比べられます。',
        zh: '比较唐人街、开港场、松岛等仁川市区内容是否比海岛主题更适合。',
      },
    },
  },
  busan: {
    bestFor: {
      ko: '해운대·광안리의 해안 풍경, 감천문화마을, 자갈치시장과 도심 전망을 하루 안에서 이어 보고 싶은 여행자에게 맞습니다.',
      en: 'Busan suits travelers who want one day connecting the coast at Haeundae and Gwangalli with Gamcheon Culture Village, Jagalchi Market and a city viewpoint.',
      ja: '海雲台・広安里の海辺、甘川文化村、チャガルチ市場と市街の展望を1日でつなげて見たい方に向いています。',
      zh: '釜山适合想在一天内串联海云台、广安里的海岸风景，以及甘川文化村、札嘎其市场和城市观景点的旅行者。',
    },
    movement: {
      ko: '현재 상품은 감천문화마을→자갈치시장→용두산공원→광안리→해운대 순서이며 픽업 장소는 별도 협의 항목입니다. 여러 구역을 하루에 잇는 코스이므로 출발 위치부터 확정한 뒤 단일 해변 일정과 비교하세요.',
      en: 'The current product runs Gamcheon → Jagalchi → Yongdusan → Gwangalli → Haeundae, and the pickup location is arranged separately. Because it connects several districts in one day, confirm the starting point before comparing it with a single-beach plan.',
      ja: '現在の商品は甘川文化村→チャガルチ市場→龍頭山公園→広安里→海雲台の順で、送迎場所は別途相談です。複数エリアを1日で結ぶため、出発地点を確定してから一つのビーチに絞る日程と比較してください。',
      zh: '当前产品按甘川文化村→札嘎其市场→龙头山公园→广安里→海云台的顺序进行，接送地点需另行协商。由于一天会串联多个区域，请先确认出发点，再与只安排一个海滩的方案比较。',
    },
    flow: { kind: 'tour', tourId: 'tour-busan-day' },
    relatedTourIds: ['tour-busan-day', 'tour-multicity-3d'],
    relatedRegion: {
      id: 'gyeongju',
      title: { ko: '경주와 연결하기', en: 'Connect Gyeongju', ja: '慶州につなぐ', zh: '衔接庆州' },
      description: {
        ko: '현재 멀티시티 상품이 부산과 경주를 함께 다룹니다. 두 도시를 잇는 일정인지 비교합니다.',
        en: 'The current multi-city product covers Busan and Gyeongju together; compare whether a connected trip fits better.',
        ja: '現在のマルチシティ商品は釜山と慶州を一緒に巡ります。2都市を結ぶ旅が合うか比べられます。',
        zh: '当前多城市产品同时涵盖釜山与庆州，可比较串联两座城市的行程是否更合适。',
      },
    },
  },
  danyang: {
    bestFor: {
      ko: '도담삼봉과 남한강 풍경을 보고, 잔도 걷기·스카이워크·동굴처럼 몸을 움직이는 자연 일정을 하루의 중심에 두고 싶은 여행자에게 맞습니다.',
      en: 'Danyang suits travelers who want Namhangang River scenery at Dodamsambong and an active nature day built around the cliff trail, skywalk and cave.',
      ja: '島潭三峯と南漢江の景色に加え、桟道歩き・スカイウォーク・洞窟など体を動かす自然体験を1日の中心にしたい方に向いています。',
      zh: '丹阳适合想欣赏岛潭三峰与南汉江风景，并把栈道步行、天空步道和洞窟等活动作为一日重点的旅行者。',
    },
    movement: {
      ko: '현재 고정 상품은 서울 왕복 당일 코스로 도담삼봉에서 시작해 잔도·스카이워크·고수동굴을 잇습니다. 걷는 구간, 높은 전망대, 서늘하고 미끄러운 동굴 안내를 함께 확인하고 하루 전체를 비워 두는 편이 맞습니다.',
      en: 'The current set product is a round trip from Seoul linking Dodamsambong, the cliff trail, Mancheonha Skywalk and Gosu Cave. Review the walking, height and cool/slippery cave notes together and treat it as a full-day commitment.',
      ja: '現在の既定商品はソウル往復の日帰りで、島潭三峯から桟道・万天下スカイウォーク・高首洞窟を結びます。歩行、高所、涼しく滑りやすい洞窟の注意をまとめて確認し、丸1日を確保するのが適しています。',
      zh: '当前固定产品为首尔往返一日路线，连接岛潭三峰、丹阳江栈道、万天河天空步道和高首洞窟。请一并查看步行、高处及洞内凉湿易滑的提示，并按完整一天安排。',
    },
    flow: { kind: 'tour', tourId: 'tour-danyang' },
    relatedTourIds: ['tour-danyang'],
    actions: ['charter'],
  },
  incheon: {
    bestFor: {
      ko: '인천국제공항을 한국 여행의 출발점으로 삼으면서 차이나타운·개항장의 문화, 송도의 현대 도시 풍경, 월미도의 바다 중 우선순위를 고르고 싶은 여행자에게 맞습니다.',
      en: 'Incheon suits travelers using the international airport as their gateway while deciding among the culture of Chinatown and the Open Port Area, modern Songdo, and the sea at Wolmido.',
      ja: '仁川国際空港を韓国旅行の入口にしつつ、チャイナタウン・開港場の文化、松島の現代都市景観、月尾島の海から優先順位を選びたい方に向いています。',
      zh: '仁川适合以仁川国际机场作为韩国旅行入口，同时想在唐人街与开港场文化、松岛现代城市景观、月尾岛海景之间确定重点的旅行者。',
    },
    movement: {
      ko: '현재 공개된 인천 연계 상품은 강화도 중심의 서울 왕복 코스입니다. 공항 이동이 포함됐다고 가정하지 말고 픽업 조건을 상품 페이지에서 확인하세요. 인천 시내가 목적이면 아래 세 갈래 중 하나를 먼저 정한 뒤 플래너로 동선을 만드세요.',
      en: 'The current published product linked to Incheon is a Seoul round trip focused on Ganghwa. Do not assume airport transfer is included; check the pickup terms on the product page. For an Incheon city day, choose one of the three tracks below before building the route in the planner.',
      ja: '現在公開されている仁川関連商品は、江華島を中心とするソウル往復コースです。空港送迎が含まれると決めつけず、商品ページで送迎条件をご確認ください。仁川市内が目的なら、下の3つから軸を一つ選んでプランナーで動線を作ります。',
      zh: '当前公开的仁川相关产品，是以江华岛为主的首尔往返路线。请勿默认包含机场接送，应在产品页面确认接送条件。若重点是仁川市区，请先从下方三条主线中选一条，再用规划工具安排动线。',
    },
    flow: {
      kind: 'editorial',
      lead: {
        ko: '지역 소개의 명소를 선택하기 쉽게 나눈 제안이며, 예약된 투어 일정은 아닙니다.',
        en: 'These are decision tracks built from the listed attractions, not a booked tour itinerary.',
        ja: '掲載名所を選びやすく分けた案であり、予約済みツアーの行程ではありません。',
        zh: '以下是根据页面所列景点整理的选择方向，并非已预订的旅游行程。',
      },
      steps: [
        {
          ko: '항구도시의 문화가 우선이면 차이나타운과 개항장을 중심에 둡니다.',
          en: 'For port-city culture, center the day on Chinatown and the Open Port Area.',
          ja: '港町の文化を優先するなら、チャイナタウンと開港場を中心にします。',
          zh: '若优先体验港口城市文化，可把唐人街和开港场作为主线。',
        },
        {
          ko: '현대 도시 풍경이 우선이면 송도 센트럴파크를 중심으로 잡습니다.',
          en: 'For a modern city landscape, make Songdo Central Park the anchor.',
          ja: '現代都市の景観を優先するなら、松島セントラルパークを軸にします。',
          zh: '若优先现代城市景观，可把松岛中央公园作为核心。',
        },
        {
          ko: '바다와 놀이공원이 우선이면 월미도를 고르고, 섬의 역사와 자연이 목적이면 강화도 페이지와 상품을 따로 비교합니다.',
          en: 'Choose Wolmido for the sea and amusement park; if island history and nature matter more, compare the Ganghwa page and product separately.',
          ja: '海と遊園地なら月尾島を選び、島の歴史と自然が目的なら江華島ページと商品を別に比較します。',
          zh: '若重视大海与游乐园可选月尾岛；若更看重海岛历史与自然，则应另行比较江华岛页面及产品。',
        },
      ],
    },
    relatedTourIds: ['tour-ganghwa'],
    relatedRegion: {
      id: 'ganghwa',
      title: { ko: '강화도 일정 비교', en: 'Compare Ganghwa', ja: '江華島と比較', zh: '比较江华岛' },
      description: {
        ko: '고인돌·전등사·갯벌처럼 섬의 역사와 자연이 주목적일 때 확인합니다.',
        en: 'Use this when the island history and nature of the dolmens, Jeondeungsa and mudflats are the priority.',
        ja: '支石墓・伝燈寺・干潟など、島の歴史と自然が主目的ならこちらを確認します。',
        zh: '若支石墓、传灯寺、滩涂等海岛历史与自然是重点，可查看此页。',
      },
    },
    actions: ['planner'],
  },
  gyeongju: {
    bestFor: {
      ko: '불국사·석굴암의 불교 유산에서 대릉원·첨성대의 신라 왕경 이야기까지 한 흐름으로 보고 싶은 역사 중심 여행자에게 맞습니다.',
      en: 'Gyeongju suits history-led travelers who want one narrative from the Buddhist heritage of Bulguksa and Seokguram to the Silla royal story at Daereungwon and Cheomseongdae.',
      ja: '仏国寺・石窟庵の仏教遺産から、大陵苑・瞻星台の新羅王京の物語まで一つの流れで見たい歴史重視の方に向いています。',
      zh: '庆州适合重视历史、想从佛国寺与石窟庵的佛教遗产一路了解至大陵苑、瞻星台所呈现的新罗王都故事的旅行者。',
    },
    movement: {
      ko: '현재 선택지는 서울 왕복 경주 1일 상품과 서울·경주·부산 3일 멀티시티 상품입니다. 한 도시의 유적을 깊게 볼지, 세 도시 이동 중 경주를 하루 넣을지 먼저 고르면 상품 두 개를 같은 일정처럼 겹쳐 보지 않게 됩니다.',
      en: 'The current choices are a Gyeongju day product with a Seoul round trip and a three-day Seoul–Gyeongju–Busan product. Decide whether you want one city in depth or Gyeongju as a day within a three-city journey, rather than treating both products as the same schedule.',
      ja: '現在はソウル往復の慶州1日商品と、ソウル・慶州・釜山3日間のマルチシティ商品があります。一都市を深く見るか、3都市移動の中で慶州を1日巡るかを先に決めると、二つの商品を同じ行程として混同しません。',
      zh: '当前可选首尔往返的庆州一日产品，或首尔—庆州—釜山三日多城市产品。请先决定是深入游览一座城市，还是在三城旅程中安排庆州一天，避免把两种产品当成同一行程。',
    },
    flow: { kind: 'tour', tourId: 'tour-gyeongju' },
    relatedTourIds: ['tour-gyeongju', 'tour-multicity-3d'],
    relatedRegion: {
      id: 'busan',
      title: { ko: '부산과 연결하기', en: 'Connect Busan', ja: '釜山につなぐ', zh: '衔接釜山' },
      description: {
        ko: '현재 멀티시티 상품의 다음 축인 부산 해안 일정을 비교합니다.',
        en: 'Compare the Busan coast that forms the next leg of the current multi-city product.',
        ja: '現在のマルチシティ商品の次の軸となる釜山の海岸日程を比較します。',
        zh: '比较当前多城市产品下一段的釜山海岸行程。',
      },
    },
  },
  jeonju: {
    bestFor: {
      ko: '한옥마을과 경기전의 전통 공간, 전주비빔밥, 한지 공예를 한 도시에서 천천히 경험하고 싶은 여행자에게 맞습니다.',
      en: 'Jeonju suits travelers who want an unhurried day of traditional spaces at Hanok Village and Gyeonggijeon, Jeonju bibimbap and hanji craft.',
      ja: '韓屋村と慶基殿の伝統空間、全州ビビンバ、韓紙工芸を一つの都市でゆっくり体験したい方に向いています。',
      zh: '全州适合想在一座城市中慢慢体验韩屋村与庆基殿的传统空间、全州拌饭及韩纸工艺的旅行者。',
    },
    movement: {
      ko: '전주는 현재 고정 투어 상품이 없고 여행 플래너 대상 도시입니다. 아래 흐름은 명소를 고르는 제안이지 예약 코스가 아닙니다. 시간표가 필요하면 플래너를 쓰고, 차량과 기사가 필요하면 전세 차량으로 따로 문의하세요.',
      en: 'Jeonju currently has no set tour product and is covered by the trip planner. The flow below helps choose attractions; it is not a booked route. Use the planner for a timed itinerary, or ask separately for a charter if you need a vehicle and driver.',
      ja: '全州には現在既定のツアー商品がなく、旅行プランナーの対象都市です。下の流れは名所選びの案で、予約コースではありません。時刻付き旅程はプランナーを使い、車両とドライバーが必要なら貸切をご相談ください。',
      zh: '全州目前没有固定旅游产品，但属于行程规划工具覆盖城市。下方流程用于帮助选择景点，并非已预订路线。需要带时间的行程可使用规划工具；需要车辆与司机则另行咨询包车。',
    },
    flow: {
      kind: 'editorial',
      lead: {
        ko: '지역 소개에 있는 다섯 명소를 하루의 관심사 순서로 정리한 제안입니다.',
        en: 'This is a suggested order of interests using the five attractions listed on this page.',
        ja: 'このページに掲載された5つの名所を、1日の関心順に整理した案です。',
        zh: '这是把本页列出的五处内容按一日兴趣顺序整理的建议。',
      },
      steps: [
        {
          ko: '전주한옥마을과 경기전에서 전통 건축과 조선 왕실 이야기를 먼저 봅니다.',
          en: 'Begin with traditional architecture and the Joseon royal story at Jeonju Hanok Village and Gyeonggijeon.',
          ja: '全州韓屋村と慶基殿で、伝統建築と朝鮮王室の物語から始めます。',
          zh: '先在全州韩屋村与庆基殿了解传统建筑和朝鲜王室故事。',
        },
        {
          ko: '전주비빔밥을 식사 축으로 두고, 손으로 만드는 경험을 원하면 한지체험을 더합니다.',
          en: 'Make Jeonju bibimbap the meal anchor, then add a hanji experience if hands-on craft matters to you.',
          ja: '食事は全州ビビンバを軸にし、手仕事を体験したければ韓紙体験を加えます。',
          zh: '以全州拌饭作为用餐重点，若想体验手作，可加入韩纸体验。',
        },
        {
          ko: '마지막에는 오목대에서 한옥마을 전경을 보는 선택지를 둡니다.',
          en: 'Keep Omokdae as the closing option for a view over Hanok Village.',
          ja: '最後は梧木台から韓屋村を見渡す選択肢を置きます。',
          zh: '最后可选择在梧木台俯瞰韩屋村。',
        },
      ],
    },
    relatedTourIds: [],
    actions: ['planner', 'charter'],
  },
};

export function getRegionDecisionGuide(regionId: string): RegionDecisionGuide | undefined {
  if (!Object.prototype.hasOwnProperty.call(REGION_DECISION_GUIDES, regionId)) return undefined;
  return REGION_DECISION_GUIDES[regionId as IndexingContentRegionId];
}
