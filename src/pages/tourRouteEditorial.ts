import type { I18nString } from '@/data/tours';

export interface TourRouteEditorialLink {
  href: string;
  label: I18nString;
  description: I18nString;
}

export interface TourRouteEditorial {
  context: I18nString;
  links: TourRouteEditorialLink[];
}

export const TOUR_ROUTE_LABELS: Record<string, I18nString> = {
  eyebrow: {
    ko: '공개 일정 기준',
    en: 'Published itinerary',
    ja: '公開中の日程基準',
    zh: '以公开行程为准',
  },
  title: {
    ko: '이 투어의 실제 동선',
    en: 'How this tour moves',
    ja: 'このツアーの実際の動線',
    zh: '本行程的实际路线',
  },
  duration: {
    ko: '총 소요',
    en: 'Total duration',
    ja: '所要時間',
    zh: '总时长',
  },
  stops: {
    ko: '공개 정류장',
    en: 'Listed stops',
    ja: '公開スポット',
    zh: '公开站点',
  },
  localSchedule: {
    ko: '현지 일정',
    en: 'On-site schedule',
    ja: '現地日程',
    zh: '当地行程',
  },
  stopOrder: {
    ko: '방문 순서',
    en: 'Stop order',
    ja: '訪問順',
    zh: '游览顺序',
  },
  related: {
    ko: '지역·여행 가이드',
    en: 'Region & trip guides',
    ja: '地域・旅行ガイド',
    zh: '地区与旅行指南',
  },
};

const TOUR_ROUTE_EDITORIAL: Record<string, TourRouteEditorial> = {
  'tour-seoul-city': {
    context: {
      ko: '서울 도심 안에서 궁궐과 한옥 골목을 시작으로 쇼핑 거리, 남산, 전통시장, 한강까지 순서대로 이동합니다.',
      en: 'This route stays within central Seoul, moving from a palace and hanok lanes through shopping, Namsan, a traditional market, and the Han River.',
      ja: 'ソウル都心で、宮殿と韓屋の路地からショッピング街、南山、伝統市場、漢江へと順に巡ります。',
      zh: '路线集中在首尔市中心，从宫殿与韩屋小巷依次前往购物街、南山、传统市场和汉江。',
    },
    links: [
      {
        href: '/region/seoul',
        label: {
          ko: '서울 지역 안내',
          en: 'Explore Seoul',
          ja: 'ソウル地域ガイド',
          zh: '首尔地区指南',
        },
        description: {
          ko: '투어 전후에 더 둘러볼 서울 명소를 확인하세요.',
          en: 'See more Seoul places to visit before or after the tour.',
          ja: 'ツアーの前後に立ち寄れるソウルの見どころを確認できます。',
          zh: '查看行程前后还可游览的首尔景点。',
        },
      },
      {
        href: '/guide/how-to-rent-hanbok-explore-seoul',
        label: {
          ko: '경복궁·한복 방문 가이드',
          en: 'Gyeongbokgung & hanbok guide',
          ja: '景福宮・韓服ガイド',
          zh: '景福宫与韩服指南',
        },
        description: {
          ko: '첫 정류장의 한복 대여와 궁궐 관람 팁을 확인하세요.',
          en: 'Read practical hanbok-rental and palace-visit tips for the first stop.',
          ja: '最初の立ち寄り先に役立つ韓服レンタルと宮殿見学のポイントです。',
          zh: '查看首站所需的韩服租赁与宫殿参观实用提示。',
        },
      },
    ],
  },
  'tour-ganghwa': {
    context: {
      ko: '서울↔강화도 왕복 이동을 포함하며, 강화도에서는 전등사에서 시작해 인삼한정식 점심, 광성보, 동막해변 순으로 이동합니다.',
      en: 'The day includes a Seoul–Ganghwa round trip; on Ganghwa Island, the listed route runs from Jeondeungsa to a ginseng-set lunch, Gwangseongbo Fortress, and Dongmak Beach.',
      ja: 'ソウル〜江華島の往復移動を含み、島内では伝灯寺から人参定食の昼食、広城堡、東幕海辺の順に巡ります。',
      zh: '行程包含首尔与江华岛往返；岛内路线从传灯寺开始，依次前往人参定食午餐、广城堡和东幕海边。',
    },
    links: [
      {
        href: '/region/ganghwa',
        label: {
          ko: '강화도 지역 안내',
          en: 'Explore Ganghwa',
          ja: '江華島地域ガイド',
          zh: '江华岛地区指南',
        },
        description: {
          ko: '강화도의 역사·자연 명소를 더 살펴보세요.',
          en: 'See more of Ganghwa Island\'s historic and natural places.',
          ja: '江華島の歴史と自然の見どころをさらに確認できます。',
          zh: '进一步了解江华岛的历史与自然景点。',
        },
      },
      {
        href: '/guide/best-temple-stays-in-korea-2026-guide',
        label: {
          ko: '한국 사찰 체험 가이드',
          en: 'Korean temple experience guide',
          ja: '韓国寺院体験ガイド',
          zh: '韩国寺院体验指南',
        },
        description: {
          ko: '전등사 방문 전 사찰 예절과 체험 방식을 살펴보세요.',
          en: 'Review temple etiquette and experience formats before Jeondeungsa.',
          ja: '伝灯寺を訪れる前に、寺院での作法と体験方法を確認できます。',
          zh: '前往传灯寺前，先了解寺院礼仪与体验方式。',
        },
      },
    ],
  },
  'tour-gyeongju': {
    context: {
      ko: '서울↔경주 왕복 이동을 포함하며, 불국사·석굴암 권역에서 시작해 경주 한정식, 대릉원·천마총, 동궁과 월지가 있는 도심으로 이어집니다.',
      en: 'The day includes a Seoul–Gyeongju round trip, starting with Bulguksa and Seokguram before continuing to lunch, Daereungwon and Cheonmachong, and Donggung Palace and Wolji Pond.',
      ja: 'ソウル〜慶州の往復移動を含み、仏国寺・石窟庵から始まり、慶州韓定食、大陵苑・天馬塚、東宮と月池へ進みます。',
      zh: '行程包含首尔与庆州往返，从佛国寺、石窟庵开始，之后前往庆州韩定食、大陵苑与天马冢、东宫与月池。',
    },
    links: [
      {
        href: '/region/gyeongju',
        label: {
          ko: '경주 지역 안내',
          en: 'Explore Gyeongju',
          ja: '慶州地域ガイド',
          zh: '庆州地区指南',
        },
        description: {
          ko: '신라 유적과 경주 지역의 다른 볼거리를 확인하세요.',
          en: 'See more Silla heritage and places across Gyeongju.',
          ja: '新羅の遺跡と慶州のほかの見どころを確認できます。',
          zh: '查看更多新罗遗迹与庆州景点。',
        },
      },
      {
        href: '/guide/gyeongju-koreas-open-air-museum-guide',
        label: {
          ko: '경주 여행 실전 가이드',
          en: 'Practical Gyeongju travel guide',
          ja: '慶州旅行実用ガイド',
          zh: '庆州旅行实用指南',
        },
        description: {
          ko: '불국사·석굴암·대릉원·동궁과 월지의 이동 정보를 이어서 확인하세요.',
          en: 'Continue with transport context for Bulguksa, Seokguram, Daereungwon, and Wolji Pond.',
          ja: '仏国寺、石窟庵、大陵苑、月池へ移動する際の情報を確認できます。',
          zh: '继续查看佛国寺、石窟庵、大陵苑与月池的交通信息。',
        },
      },
    ],
  },
};

export const TOUR_ROUTE_EDITORIAL_IDS = Object.keys(TOUR_ROUTE_EDITORIAL);

export function getTourRouteEditorial(tourId: string): TourRouteEditorial | undefined {
  return TOUR_ROUTE_EDITORIAL[tourId];
}
