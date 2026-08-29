/**
 * /region/<id> 공개 정보 섹션 (2026-08-06).
 *
 * 왜 만드는가: GSC 실측에서 지역 페이지 9개가 크롤러 기준 **1,611~1,747자** 였다.
 * 색인된 `/charter` 는 4,980자, 색인이 거부된 `/planner` 는 939자였다 — 지역 페이지는
 * 그 사이 위험 구간에 통째로 들어 있다. 페이지가 가진 고유 본문이 소개문 한 단락(135~218자)
 * 과 명소 5개 카드뿐이라서 그렇다.
 *
 * 🔴 갔다가 거부당한 페이지(`Crawled – not indexed`)는 안 가본 페이지보다 나쁘다. 구글이
 *    다시 오지 않아 사람이 색인 요청으로 밀어넣어야 한다(`/planner` 가 그 상태였다).
 *    그래서 색인 요청을 넣기 **전에** 본문을 채운다.
 *
 * 원칙 (`CharterSeoInfo`·`PlannerSeoInfo` 와 동일)
 *   - 숨은 문구·키워드 나열 금지. 여기 있는 문장은 전부 화면에 보이고 사람이 읽는 내용이다.
 *   - 🔴 **지역 소개를 지어내지 않는다.** 이 파일에는 "경주는 신라의 수도였다" 류의 새 사실이
 *     한 줄도 없다. 지역 지식은 이미 i18n `regionDetail.<id>` 에 있고 위쪽에서 렌더된다.
 *     여기서 더하는 건 **우리가 그 지역에서 실제로 파는 것**뿐이다:
 *       투어    = data/tours (`getToursByRegion`) — 제목·시간·인원·가격·기사 언어
 *       포함사항 = data/tours GLOBAL_INCLUDED / GLOBAL_EXCLUDED
 *       플래너   = WizardForm/data CITY_CHIPS 에 그 도시가 있나 (없으면 없다고 쓴다)
 *       마감    = lib/bookingCutoff TOUR_CUTOFF_HOURS
 *       플랜 가격 = lib/aiPlannerPrice
 *   - 그래서 9개 페이지의 본문이 서로 다르다. 같은 문단을 9벌 찍으면 얇은 것보다 나쁘다.
 *
 * ⚠️ 가격은 **USD 만** 쓴다. 원화를 같이 적으면 표시 환율(1430)과 청구 환율이 갈리는
 *    `charterUsd` 함정에 그대로 들어간다. 투어 카드(`TourCard`)도 USD 를 먼저 보여준다.
 */
import type { Translations } from '@/i18n';
import { getToursByRegion, GLOBAL_INCLUDED, GLOBAL_EXCLUDED } from '@/data/tours';
import type { Tour } from '@/data/tours';
import { REGION_TOUR_SOURCE, MULTICITY_REGIONS } from '@/components/region/regionTourSource';
import { CITY_CHIPS } from '@/components/WizardForm/data';
import { TOUR_CUTOFF_HOURS } from '@/lib/bookingCutoff';
import { formatAiPlannerUsd } from '@/lib/aiPlannerPrice';
import { useJsonLd } from '@/hooks/useJsonLd';
import { buildFaqJsonLd } from '@/lib/jsonLd';
import { withEunNeun, withEulReul } from '@/components/region/koreanParticle';
import { getRegionDecisionGuide } from '@/components/region/regionDecisionContent';

type Lang = 'ko' | 'en' | 'ja' | 'zh';

function pickLang(language: string | null | undefined): Lang {
  return language === 'ko' || language === 'ja' || language === 'zh' ? language : 'en';
}

/** 투어 1건을 한 줄로. 값은 전부 상품 데이터에서 온다. */
function tourLine(tour: Tour, lang: Lang): string {
  const hours = tour.durationHours
    ? HOURS_LABEL[lang](tour.durationHours)
    : DAYS_LABEL[lang](tour.durationDays);
  const price = `$${tour.priceFrom.toLocaleString()}`;
  const priceLabel = tour.priceUnit === 'per_person' ? PER_PERSON[lang](price) : PER_GROUP[lang](price);
  const langs = (tour.driverLanguages || ['en']).map((l) => DRIVER_LANG[lang][l]).join(' · ');
  return `${tour.title[lang]} — ${tour.summary[lang]} (${hours} · ${PAX[lang](tour.maxPax)} · ${priceLabel} · ${DRIVER[lang]}: ${langs})`;
}

const HOURS_LABEL: Record<Lang, (n: number) => string> = {
  ko: (n) => `${n}시간`,
  en: (n) => `${n} hours`,
  ja: (n) => `${n}時間`,
  zh: (n) => `${n}小时`,
};
const DAYS_LABEL: Record<Lang, (n: number) => string> = {
  ko: (n) => `${n}일`,
  en: (n) => (n === 1 ? '1 day' : `${n} days`),
  ja: (n) => `${n}日`,
  zh: (n) => `${n}天`,
};
const PAX: Record<Lang, (n: number) => string> = {
  ko: (n) => `최대 ${n}명`,
  en: (n) => `up to ${n} people`,
  ja: (n) => `最大${n}名`,
  zh: (n) => `最多${n}人`,
};
const PER_GROUP: Record<Lang, (p: string) => string> = {
  ko: (p) => `차량 1대 ${p}부터`,
  en: (p) => `from ${p} per vehicle`,
  ja: (p) => `車両1台 ${p}から`,
  zh: (p) => `每车 ${p} 起`,
};
const PER_PERSON: Record<Lang, (p: string) => string> = {
  ko: (p) => `1인 ${p}부터`,
  en: (p) => `from ${p} per person`,
  ja: (p) => `1名 ${p}から`,
  zh: (p) => `每人 ${p} 起`,
};
const DRIVER: Record<Lang, string> = { ko: '기사 언어', en: 'driver speaks', ja: 'ドライバー対応言語', zh: '司机语言' };
const DRIVER_LANG: Record<Lang, Record<'en' | 'ja' | 'zh', string>> = {
  ko: { en: '영어', ja: '일본어', zh: '중국어' },
  en: { en: 'English', ja: 'Japanese', zh: 'Chinese' },
  ja: { en: '英語', ja: '日本語', zh: '中国語' },
  zh: { en: '英语', ja: '日语', zh: '中文' },
};

type Vars = {
  region: string;
  tourCount: number;
  tourTitles: string;
  plannerCovered: boolean;
  plannerPrice: string;
  cutoffHours: number;
};

const COPY: Record<Lang, {
  decisionTitle: string;
  bestForTitle: string;
  flowTitle: Record<'tour' | 'editorial', string>;
  movementTitle: string;
  relatedTitle: string;
  tourFlowLead: (tourTitle: string) => string;
  actionLink: (action: 'planner' | 'charter', region: string) => { title: string; description: string };
  waysTitle: string;
  ways: (v: Vars) => string[];
  toursTitle: (v: Vars) => string;
  toursIntro: (v: Vars) => string;
  toursNone: (v: Vars) => string;
  includedTitle: string;
  includedLabel: string;
  excludedLabel: string;
  faqTitle: string;
  faq: (v: Vars) => Array<[string, string]>;
}> = {
  ko: {
    decisionTitle: '하루를 고르기 전 판단할 것',
    bestForTitle: '이런 여행자에게 맞아요',
    flowTitle: {
      tour: '공개 상품의 실제 동선',
      editorial: '하루 구성 제안 (예약 일정 아님)',
    },
    movementTitle: '도착·이동 판단',
    relatedTitle: '다음 계획으로 연결',
    tourFlowLead: (tourTitle) => `현재 ${tourTitle} 상품 데이터에 적힌 순서입니다. 예약 전 상품 상세에서 최신 일정을 다시 확인하세요.`,
    actionLink: (action, region) => action === 'planner'
      ? { title: `${region} 일정 만들기`, description: '여행 플래너에서 날짜와 조건을 넣고 시간표와 이동 경로를 만듭니다.' }
      : { title: `${region} 전세 차량 문의`, description: '고정 상품과 다른 명소를 원하면 차량과 기사 중심의 자유 경로를 문의합니다.' },
    waysTitle: '코코트립으로 가는 방법',
    ways: ({ region, tourCount, plannerCovered, plannerPrice }) => [
      tourCount > 0
        ? `정해진 투어 예약 — ${region} 코스가 이미 짜여 있습니다. 차량과 기사가 포함되고 픽업 장소에서 만납니다.`
        : `전세 차량 — ${withEunNeun(region)} 정해진 투어 상품이 아직 없어서, 차량과 기사를 시간 단위로 빌려 손님이 원하는 곳으로 갑니다.`,
      '전세 차량 — 일정을 손님이 정하고 차량과 기사만 빌립니다. 공항 픽업, 하루 대절, 여러 날 장거리 모두 됩니다.',
      plannerCovered
        ? `여행 플래너 — 도시·날짜·여행 조건을 넣으면 ${withEulReul(region)} 포함한 일정이 한국 현지 데이터로 자동 작성됩니다. 지하철·버스 실제 경로와 도보 지도가 붙고 PDF 로 받습니다. 전체 일정 ${plannerPrice}, 뼈대 미리보기는 무료입니다.`
        : `여행 플래너 — 현재 ${withEunNeun(region)} 자동 일정 대상 도시가 아닙니다. ${withEunNeun(region)} 전세 차량으로 가고, 자동 일정은 대상 도시에서 쓰시면 됩니다.`,
    ],
    toursTitle: ({ region }) => `${region} 투어 상품`,
    toursIntro: ({ region, tourCount }) => `${region}에서 예약할 수 있는 투어 ${tourCount}건입니다. 아래 값은 상품 정보 그대로이고, 실제 결제 금액은 인원과 날짜에 따라 예약 화면에서 확정됩니다.`,
    toursNone: ({ region }) => `${withEunNeun(region)} 정해진 투어 상품이 아직 없습니다. 전세 차량으로 방문하실 수 있고, 원하시는 코스를 알려 주시면 견적을 드립니다.`,
    includedTitle: '요금에 포함되는 것',
    includedLabel: '포함',
    excludedLabel: '불포함',
    faqTitle: '자주 묻는 질문',
    faq: ({ region, tourCount, tourTitles, plannerCovered, plannerPrice, cutoffHours }) => {
      const rows: Array<[string, string]> = [];
      rows.push([
        `${region} 투어는 어떤 게 있나요?`,
        tourCount > 0
          ? `${tourCount}건입니다 — ${tourTitles}. 전용 차량과 기사가 포함되고, 기사는 영어로 안내합니다.`
          : `정해진 투어 상품은 아직 없습니다. 전세 차량으로 방문하실 수 있고, 가고 싶은 곳을 알려 주시면 코스와 견적을 만들어 드립니다.`,
      ]);
      rows.push([
        '언제까지 예약해야 하나요?',
        `투어는 출발 ${cutoffHours}시간 전까지 예약할 수 있습니다. 그보다 촉박하면 전세 차량으로 문의해 주세요.`,
      ]);
      rows.push([
        '취소하면 환불되나요?',
        '이용 24시간 이상 전에 취소하면 100% 환불입니다. 24시간 미만 취소와 노쇼는 환불이 없습니다.',
      ]);
      rows.push([
        '한국어를 못해도 되나요?',
        '됩니다. 기사가 영어로 안내하고, 투어에 따라 일본어·중국어도 가능합니다. 화면과 일정은 영어·한국어·일본어·중국어로 제공합니다.',
      ]);
      rows.push([
        '요금에 무엇이 포함되나요?',
        `${GLOBAL_INCLUDED.map((h) => h.text.ko).join(' · ')} 가 포함됩니다. ${GLOBAL_EXCLUDED.map((h) => h.text.ko).join(' · ')} 는 포함되지 않습니다.`,
      ]);
      rows.push([
        plannerCovered ? `${region} 일정을 직접 짜고 싶으면?` : `${withEulReul(region)} 자동 일정으로 짤 수 있나요?`,
        plannerCovered
          ? `여행 플래너를 쓰시면 됩니다. 날짜·항공편과 여행 조건을 넣으면 한국 현지 데이터로 ${region} 일정을 시각까지 붙여 만들고, 장소 사이 지하철·버스 경로와 도보 지도가 함께 나옵니다. 전체 일정 ${plannerPrice}, 뼈대 미리보기는 무료입니다.`
          : `현재 ${withEunNeun(region)} 자동 일정 대상 도시가 아닙니다. ${region} 방문은 전세 차량이나 투어로 예약해 주세요.`,
      ]);
      return rows;
    },
  },
  en: {
    decisionTitle: 'Decide before shaping the day',
    bestForTitle: 'Who this region fits',
    flowTitle: {
      tour: 'Route in the published product',
      editorial: 'Suggested day shape (not a booked itinerary)',
    },
    movementTitle: 'Arrival and movement decision',
    relatedTitle: 'Continue planning',
    tourFlowLead: (tourTitle) => `This is the sequence in the current ${tourTitle} product data. Recheck the latest itinerary on the product page before booking.`,
    actionLink: (action, region) => action === 'planner'
      ? { title: `Build a ${region} plan`, description: 'Enter your dates and conditions in the trip planner to build a timed route.' }
      : { title: `Ask about a ${region} charter`, description: 'Ask for a vehicle-and-driver route when your stops differ from the set product.' },
    waysTitle: 'Ways to visit with CocoTrip',
    ways: ({ region, tourCount, plannerCovered, plannerPrice }) => [
      tourCount > 0
        ? `Book a set tour — the ${region} route is already planned. A private vehicle and driver are included, and you meet at the pickup point.`
        : `Private charter — ${region} has no set tour product yet, so you hire the vehicle and driver by the hour and go where you want.`,
      'Private charter — you decide the route and hire only the vehicle and driver. Airport pickups, full-day charters and multi-day trips are all available.',
      plannerCovered
        ? `Trip planner — give it your city, dates and trip conditions and an itinerary that includes ${region} is written automatically from Korean local data. It carries real subway and bus routes between stops, walking maps, and a PDF. The full itinerary is ${plannerPrice}; the outline preview is free.`
        : `Trip planner — ${region} is not one of the cities the automatic planner covers right now. Visit ${region} by charter or tour, and use the planner for the cities it does cover.`,
    ],
    toursTitle: ({ region }) => `${region} tours`,
    toursIntro: ({ region, tourCount }) => `${tourCount} tour${tourCount === 1 ? '' : 's'} you can book in ${region}. The figures below come straight from the product data; the amount you actually pay is confirmed at booking based on party size and date.`,
    toursNone: ({ region }) => `There is no set tour product for ${region} yet. You can still visit by private charter — tell us where you want to go and we will quote the route.`,
    includedTitle: 'What the price covers',
    includedLabel: 'Included',
    excludedLabel: 'Not included',
    faqTitle: 'Frequently asked questions',
    faq: ({ region, tourCount, tourTitles, plannerCovered, plannerPrice, cutoffHours }) => {
      const rows: Array<[string, string]> = [];
      rows.push([
        `What tours are available in ${region}?`,
        tourCount > 0
          ? `${tourCount} — ${tourTitles}. Each includes a private vehicle and driver, and the driver guides in English.`
          : `None as a set product yet. You can visit by private charter — tell us where you want to go and we will build the route and quote it.`,
      ]);
      rows.push([
        'How far ahead do I need to book?',
        `Tours can be booked up to ${cutoffHours} hours before departure. If you are inside that window, ask about a private charter instead.`,
      ]);
      rows.push([
        'Can I cancel and get a refund?',
        'Cancel 24 hours or more before your service for a 100% refund. Cancellations inside 24 hours and no-shows are not refunded.',
      ]);
      rows.push([
        'Do I need to speak Korean?',
        'No. The driver guides in English, and some tours also offer Japanese and Chinese. The site and itineraries come in English, Korean, Japanese and Chinese.',
      ]);
      rows.push([
        'What does the price include?',
        `${GLOBAL_INCLUDED.map((h) => h.text.en).join(' · ')} are included. ${GLOBAL_EXCLUDED.map((h) => h.text.en).join(' · ')} are not.`,
      ]);
      rows.push([
        plannerCovered ? `What if I want to plan ${region} myself?` : `Can the trip planner cover ${region}?`,
        plannerCovered
          ? `Use the trip planner. Give it your dates, flights and trip conditions and a timed ${region} plan is built from Korean local data, with real subway and bus routes between stops and walking maps for the last stretch. The full itinerary is ${plannerPrice}; the outline preview is free.`
          : `Not right now — ${region} is not one of the cities the automatic planner covers. Book ${region} as a charter or a tour instead.`,
      ]);
      return rows;
    },
  },
  ja: {
    decisionTitle: '1日の形を決める前の判断',
    bestForTitle: 'この地域が合う方',
    flowTitle: {
      tour: '公開商品の実際の行程',
      editorial: '1日の組み立て案（予約行程ではありません）',
    },
    movementTitle: '到着・移動の判断',
    relatedTitle: '次の計画へ',
    tourFlowLead: (tourTitle) => `現在の「${tourTitle}」商品データに記載された順序です。予約前に商品詳細で最新の行程をご確認ください。`,
    actionLink: (action, region) => action === 'planner'
      ? { title: `${region}の旅程を作る`, description: '旅行プランナーに日程と条件を入力し、時刻付きの移動ルートを作ります。' }
      : { title: `${region}の貸切を相談`, description: '既定商品と異なる名所を巡るなら、車両とドライバー中心の自由ルートを相談します。' },
    waysTitle: 'ココトリップでの行き方',
    ways: ({ region, tourCount, plannerCovered, plannerPrice }) => [
      tourCount > 0
        ? `決まったツアーを予約 — ${region} のコースはすでに組まれています。専用車両とドライバーが含まれ、送迎場所で合流します。`
        : `貸切チャーター — ${region} はまだ既定のツアー商品がないため、車両とドライバーを時間単位で借りてご希望の場所へ向かいます。`,
      '貸切チャーター — 行程はお客様が決め、車両とドライバーだけを借ります。空港送迎、1日貸切、複数日の長距離すべて対応します。',
      plannerCovered
        ? `旅行プランナー — 都市・日程・旅行条件を入力すると、${region} を含む旅程が韓国の現地データで自動作成されます。地点間の地下鉄・バスの実際のルートと徒歩の地図が付き、PDF で受け取れます。全旅程 ${plannerPrice}、骨組みのプレビューは無料です。`
        : `旅行プランナー — 現在 ${region} は自動作成の対象都市ではありません。${region} はチャーターでの訪問となり、自動作成は対象都市でご利用ください。`,
    ],
    toursTitle: ({ region }) => `${region} のツアー商品`,
    toursIntro: ({ region, tourCount }) => `${region} で予約できるツアー ${tourCount} 件です。以下は商品情報のままの数値で、実際のお支払い額は人数と日程に応じて予約画面で確定します。`,
    toursNone: ({ region }) => `${region} はまだ既定のツアー商品がありません。貸切チャーターでの訪問は可能です。ご希望の場所をお知らせいただければお見積りします。`,
    includedTitle: '料金に含まれるもの',
    includedLabel: '含まれる',
    excludedLabel: '含まれない',
    faqTitle: 'よくある質問',
    faq: ({ region, tourCount, tourTitles, plannerCovered, plannerPrice, cutoffHours }) => {
      const rows: Array<[string, string]> = [];
      rows.push([
        `${region} のツアーにはどんなものがありますか？`,
        tourCount > 0
          ? `${tourCount} 件です — ${tourTitles}。専用車両とドライバーが含まれ、ドライバーは英語でご案内します。`
          : `既定のツアー商品はまだありません。貸切チャーターで訪問でき、行きたい場所をお知らせいただければコースとお見積りをご用意します。`,
      ]);
      rows.push([
        'いつまでに予約が必要ですか？',
        `ツアーは出発の ${cutoffHours} 時間前まで予約できます。それより直前の場合は貸切チャーターでお問い合わせください。`,
      ]);
      rows.push([
        'キャンセルは返金されますか？',
        'ご利用の24時間以上前のキャンセルは全額返金です。24時間未満のキャンセルと無連絡不参加は返金されません。',
      ]);
      rows.push([
        '韓国語が話せなくても大丈夫ですか？',
        '大丈夫です。ドライバーが英語でご案内し、ツアーによっては日本語・中国語も対応します。画面と旅程は英語・韓国語・日本語・中国語でご利用いただけます。',
      ]);
      rows.push([
        '料金には何が含まれますか？',
        `${GLOBAL_INCLUDED.map((h) => h.text.ja).join(' · ')} が含まれます。${GLOBAL_EXCLUDED.map((h) => h.text.ja).join(' · ')} は含まれません。`,
      ]);
      rows.push([
        plannerCovered ? `${region} の旅程を自分で組みたい場合は？` : `${region} を自動旅程で作れますか？`,
        plannerCovered
          ? `旅行プランナーをご利用ください。日程・フライトと旅行条件を入力すると、韓国の現地データで ${region} の旅程を時刻付きで作成し、地点間の地下鉄・バスのルートと最後の徒歩区間の地図も付きます。全旅程 ${plannerPrice}、骨組みのプレビューは無料です。`
          : `現在 ${region} は自動旅程の対象都市ではありません。${region} へのご訪問はチャーターまたはツアーでご予約ください。`,
      ]);
      return rows;
    },
  },
  zh: {
    decisionTitle: '安排一天前先做判断',
    bestForTitle: '适合这样的旅行者',
    flowTitle: {
      tour: '公开产品的实际路线',
      editorial: '一日安排建议（非预订行程）',
    },
    movementTitle: '抵达与移动判断',
    relatedTitle: '继续规划',
    tourFlowLead: (tourTitle) => `以下顺序来自当前“${tourTitle}”产品资料。预订前请在产品详情页再次确认最新行程。`,
    actionLink: (action, region) => action === 'planner'
      ? { title: `制作${region}行程`, description: '在行程规划工具中填写日期与条件，生成带时间的移动路线。' }
      : { title: `咨询${region}包车`, description: '若想去固定产品之外的景点，可咨询以车辆和司机为主的自由路线。' },
    waysTitle: '用 CocoTrip 前往的方式',
    ways: ({ region, tourCount, plannerCovered, plannerPrice }) => [
      tourCount > 0
        ? `预订固定行程 — ${region} 的路线已经排好，含专属车辆和司机，在接送点会合。`
        : `包车 — ${region} 目前还没有固定行程产品，可按小时租用车辆和司机，去你想去的地方。`,
      '包车 — 行程由你决定，只租车辆和司机。机场接送、整日包车、多日长途都可以。',
      plannerCovered
        ? `行程规划 — 填写城市、日期和出行条件后，用韩国本地数据自动生成包含 ${region} 的行程，附地点之间的地铁和公交实际路线、步行地图，并可下载 PDF。完整行程 ${plannerPrice}，框架预览免费。`
        : `行程规划 — 目前 ${region} 不在自动规划的城市范围内。前往 ${region} 请用包车或跟团，自动规划可用于已覆盖的城市。`,
    ],
    toursTitle: ({ region }) => `${region} 的行程产品`,
    toursIntro: ({ region, tourCount }) => `${region} 可预订的行程共 ${tourCount} 个。以下数值直接来自产品资料，实际支付金额会在预订页面按人数和日期确定。`,
    toursNone: ({ region }) => `${region} 目前还没有固定行程产品。你仍可以包车前往，告诉我们想去的地方，我们会给出路线和报价。`,
    includedTitle: '费用包含什么',
    includedLabel: '包含',
    excludedLabel: '不包含',
    faqTitle: '常见问题',
    faq: ({ region, tourCount, tourTitles, plannerCovered, plannerPrice, cutoffHours }) => {
      const rows: Array<[string, string]> = [];
      rows.push([
        `${region} 有哪些行程？`,
        tourCount > 0
          ? `${tourCount} 个 — ${tourTitles}。均含专属车辆和司机，司机用英语讲解。`
          : `暂时没有固定行程产品。你可以包车前往，告诉我们想去的地方，我们会安排路线并报价。`,
      ]);
      rows.push([
        '需要提前多久预订？',
        `行程最晚可在出发前 ${cutoffHours} 小时预订。若时间更紧，请改为咨询包车。`,
      ]);
      rows.push([
        '取消可以退款吗？',
        '用车前24小时以上取消可全额退款。24小时内取消及未到场不予退款。',
      ]);
      rows.push([
        '不会韩语也可以吗？',
        '可以。司机用英语讲解，部分行程还提供日语和中文。网站和行程提供英文、韩文、日文、中文。',
      ]);
      rows.push([
        '费用包含哪些？',
        `包含 ${GLOBAL_INCLUDED.map((h) => h.text.zh).join(' · ')}。不包含 ${GLOBAL_EXCLUDED.map((h) => h.text.zh).join(' · ')}。`,
      ]);
      rows.push([
        plannerCovered ? `想自己安排 ${region} 的行程怎么办？` : `行程规划能覆盖 ${region} 吗？`,
        plannerCovered
          ? `可以使用行程规划。填入日期、航班和出行条件后，会用韩国本地数据生成带时间的 ${region} 行程，并附上地点之间的地铁和公交路线以及最后一段的步行地图。完整行程 ${plannerPrice}，框架预览免费。`
          : `目前不覆盖 — ${region} 不在自动规划的城市范围内。前往 ${region} 请改用包车或跟团预订。`,
      ]);
      return rows;
    },
  },
};

export function RegionSeoInfo({
  regionId,
  regionTitle,
  language,
}: {
  regionId: string;
  regionTitle: string;
  language: string;
  /** 현재 사용하지 않지만 형제 컴포넌트(`PlannerSeoInfo`)와 호출 형태를 맞춘다. */
  t?: Translations;
}) {
  const lang = pickLang(language);
  const c = COPY[lang];

  // 투어 목록은 상품 데이터에서 뽑는다. 여기에 상품명을 손으로 적으면 상품이 바뀔 때
  // 이 페이지만 없는 투어를 광고한다.
  const source = REGION_TOUR_SOURCE[regionId] || null;
  const regionTours = source ? getToursByRegion(source) : [];
  const multicityTours = MULTICITY_REGIONS.has(regionId) ? getToursByRegion('Multi-City') : [];
  const tours = [...regionTours, ...multicityTours];
  const decisionGuide = getRegionDecisionGuide(regionId);
  const allTours = decisionGuide ? getToursByRegion('All') : [];
  const decisionFlow = decisionGuide?.flow;
  const flowTour = decisionFlow?.kind === 'tour'
    ? allTours.find((tour) => tour.id === decisionFlow.tourId)
    : undefined;
  const flowStops = flowTour?.stops || [];
  const relatedTours = decisionGuide
    ? decisionGuide.relatedTourIds
      .map((tourId) => allTours.find((tour) => tour.id === tourId))
      .filter((tour): tour is Tour => Boolean(tour))
    : [];

  const plannerCovered = CITY_CHIPS.some((chip) => chip.key === regionId);

  const vars: Vars = {
    region: regionTitle,
    tourCount: tours.length,
    tourTitles: tours.map((tour) => tour.title[lang]).join(' · '),
    plannerCovered,
    plannerPrice: formatAiPlannerUsd(),
    cutoffHours: TOUR_CUTOFF_HOURS,
  };

  // FAQ 마크업은 **아래 렌더가 쓰는 바로 그 배열**에서 만든다. 문구를 따로 적어두면
  // 정책 개정 때 화면과 구글이 다른 말을 하게 된다 (CharterSeoInfo·PlannerSeoInfo 와 같은 규칙).
  const faqEntries = c.faq(vars);
  useJsonLd(`region-faq-${regionId}`, buildFaqJsonLd(faqEntries));

  return (
    <section className="region-seo-info mt-12 border-t border-white/10 pt-8 text-white/75">
      <div className="space-y-8 text-[13px] leading-relaxed sm:text-sm">
        {decisionGuide && (
          <div data-testid="region-decision-guide" className="col-span-full border-b border-ec-line pb-8 text-ec-ink-2">
            <h2 className="mb-5 text-base font-bold text-ec-ink sm:text-lg">{c.decisionTitle}</h2>

            <div className="grid gap-6 sm:grid-cols-2">
              <section aria-labelledby={`${regionId}-best-for`}>
                <h3 id={`${regionId}-best-for`} className="text-sm font-bold text-ec-ink sm:text-base">
                  {c.bestForTitle}
                </h3>
                <p className="mt-2">{decisionGuide.bestFor[lang]}</p>
              </section>

              <section aria-labelledby={`${regionId}-movement`}>
                <h3 id={`${regionId}-movement`} className="text-sm font-bold text-ec-ink sm:text-base">
                  {c.movementTitle}
                </h3>
                <p className="mt-2">{decisionGuide.movement[lang]}</p>
              </section>
            </div>

            <section className="mt-6 border-t border-ec-line pt-6" aria-labelledby={`${regionId}-day-flow`}>
              <h3 id={`${regionId}-day-flow`} className="text-sm font-bold text-ec-ink sm:text-base">
                {c.flowTitle[decisionGuide.flow.kind]}
              </h3>
              {decisionGuide.flow.kind === 'tour' && flowTour && (
                <p className="mt-2">{c.tourFlowLead(flowTour.title[lang])}</p>
              )}
              {decisionGuide.flow.kind === 'editorial' && (
                <p className="mt-2">{decisionGuide.flow.lead[lang]}</p>
              )}
              <ol className="mt-4 grid gap-3 sm:grid-cols-2" role="list">
                {decisionGuide.flow.kind === 'tour' && flowStops.map((stop) => (
                  <li key={`${stop.time}-${stop.name.ko}`} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-3 border-t border-ec-line pt-3">
                    <time className="font-semibold text-ec-ink">{stop.time}</time>
                    <div className="min-w-0">
                      <p className="font-semibold text-ec-ink">{stop.name[lang]}</p>
                      <p className="mt-1">{stop.description[lang]}</p>
                    </div>
                  </li>
                ))}
                {decisionGuide.flow.kind === 'editorial' && decisionGuide.flow.steps.map((step, index) => (
                  <li key={step.en} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-3 border-t border-ec-line pt-3">
                    <span className="font-semibold text-ec-brand" aria-hidden>{String(index + 1).padStart(2, '0')}</span>
                    <p>{step[lang]}</p>
                  </li>
                ))}
              </ol>
            </section>

            <nav className="mt-6 border-t border-ec-line pt-6" aria-labelledby={`${regionId}-related-planning`}>
              <h3 id={`${regionId}-related-planning`} className="text-sm font-bold text-ec-ink sm:text-base">
                {c.relatedTitle}
              </h3>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2" role="list">
                {relatedTours.map((tour) => (
                  <li key={tour.id}>
                    <a
                      href={`/tours/${tour.slug}`}
                      className="flex min-h-[44px] min-w-0 flex-col justify-center border border-ec-line-2 bg-ec-raised px-3 py-2 text-ec-ink transition-colors hover:border-ec-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ec-brand focus-visible:ring-offset-2"
                    >
                      <span className="font-semibold">{tour.title[lang]}</span>
                      <small className="mt-0.5 break-words text-xs text-ec-ink-3">{tour.summary[lang]}</small>
                    </a>
                  </li>
                ))}
                {decisionGuide.relatedRegion && (
                  <li>
                    <a
                      href={`/region/${decisionGuide.relatedRegion.id}`}
                      className="flex min-h-[44px] min-w-0 flex-col justify-center border border-ec-line-2 bg-ec-raised px-3 py-2 text-ec-ink transition-colors hover:border-ec-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ec-brand focus-visible:ring-offset-2"
                    >
                      <span className="font-semibold">{decisionGuide.relatedRegion.title[lang]}</span>
                      <small className="mt-0.5 break-words text-xs text-ec-ink-3">{decisionGuide.relatedRegion.description[lang]}</small>
                    </a>
                  </li>
                )}
                {(decisionGuide.actions || []).map((action) => {
                  const linkCopy = c.actionLink(action, regionTitle);
                  return (
                    <li key={action}>
                      <a
                        href={action === 'planner' ? '/planner' : '/charter'}
                        className="flex min-h-[44px] min-w-0 flex-col justify-center border border-ec-line-2 bg-ec-raised px-3 py-2 text-ec-ink transition-colors hover:border-ec-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ec-brand focus-visible:ring-offset-2"
                      >
                        <span className="font-semibold">{linkCopy.title}</span>
                        <small className="mt-0.5 break-words text-xs text-ec-ink-3">{linkCopy.description}</small>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </div>
        )}

        <div>
          <h2 className="mb-3 text-base font-bold text-white sm:text-lg">{c.waysTitle}</h2>
          <ul className="space-y-1.5 pl-4" style={{ listStyleType: 'disc' }}>
            {c.ways(vars).map((s) => <li key={s}>{s}</li>)}
          </ul>
        </div>

        <div>
          <h2 className="mb-3 text-base font-bold text-white sm:text-lg">{c.toursTitle(vars)}</h2>
          {tours.length > 0 ? (
            <>
              <p className="mb-2">{c.toursIntro(vars)}</p>
              <ul className="space-y-1.5 pl-4" style={{ listStyleType: 'disc' }}>
                {tours.map((tour) => <li key={tour.id}>{tourLine(tour, lang)}</li>)}
              </ul>
            </>
          ) : (
            <p>{c.toursNone(vars)}</p>
          )}
        </div>

        <div>
          <h2 className="mb-3 text-base font-bold text-white sm:text-lg">{c.includedTitle}</h2>
          <p>
            <span className="font-semibold text-white/90">{c.includedLabel}</span>
            {' — '}
            {GLOBAL_INCLUDED.map((h) => h.text[lang]).join(' · ')}
          </p>
          <p className="mt-1.5">
            <span className="font-semibold text-white/90">{c.excludedLabel}</span>
            {' — '}
            {GLOBAL_EXCLUDED.map((h) => h.text[lang]).join(' · ')}
          </p>
        </div>

        <div>
          <h2 className="mb-3 text-base font-bold text-white sm:text-lg">{c.faqTitle}</h2>
          <dl className="space-y-3">
            {faqEntries.map(([q, a]) => (
              <div key={q}>
                <dt className="font-semibold text-white/90">{q}</dt>
                <dd className="mt-0.5">{a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
