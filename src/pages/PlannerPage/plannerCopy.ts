/**
 * Planner journey copy — Korea Editorial Concierge, phase 2 (2026-08-10).
 *
 * A local four-language dictionary, for the same reason `sections/home/homeCopy.ts`
 * is one: `src/i18n/locales/en.json` is eager and guarded by a 143 KB first-paint
 * budget (`.size-limit.json`), while `PlannerPage` is a lazy chunk
 * (`App.tsx: lazy(() => import('@/pages/PlannerPage'))`). Copy only the planner
 * needs should not be paid for on the homepage.
 *
 * Strings that already had a key keep it — `planner.aiIntro*`,
 * `planner.notifyPlanReady*`, `planner.errorTitle`, `planner.retry` and the rest
 * are still edited in the four locale files. What lives here is the copy this
 * pass introduced, plus three inline dictionaries it absorbed
 * (`MODE_TEXT` in PlannerPage/index.tsx, `COPY` in AiPlannerPricingNote.tsx,
 * and the hardcoded Korean fallbacks in QuickPreviewCard/PlannerPage — those
 * printed Korean at English, Japanese and Chinese readers).
 *
 * ── Positioning ──────────────────────────────────────────────────────────
 * The product in front of the traveller is: **you give us dates, cities, pace
 * and dietary rules, and we write a Korea itinerary you can actually execute.**
 * The model that writes it is mechanism, not headline — it belongs in technical
 * and legal context (loading phases, terms), never on a mode card or a CTA.
 * `tests/unit/editorial-planner-journey.test.ts` fails if it creeps back.
 *
 * Every claim here is backed by code that exists — see the claim table in §5 of
 * docs/DESIGN-EDITORIAL-CONCIERGE.md. Do not add a number nothing computes, and
 * do not add urgency ("N seats left") without a live count behind it.
 */
import { FOOD_DB } from '@/sections/home/homeCopy';

export type PlannerLang = 'ko' | 'en' | 'ja' | 'zh';

export interface PlannerCopy {
  masthead: {
    eyebrow: string;
    headline: string;
    lede: string;
    inputsHeading: string;
    /** The four things the traveller actually answers. Order is the wizard's. */
    inputs: { label: string; note: string }[];
  };
  modes: {
    heading: string;
    guided: { kicker: string; title: string; body: string };
    builder: { kicker: string; title: string; body: string };
  };
  evidence: {
    eyebrow: string;
    heading: string;
    items: { figure: string; label: string; note: string }[];
    limits: string;
  };
  wizard: {
    /** `{n}` / `{total}` */
    stepOf: string;
    progressLabel: string;
    hintReopen: string;
    hintClose: string;
  };
  loading: {
    eyebrow: string;
    heading: string;
    tipLabel: string;
    /** Shown once generation passes the slow threshold. Honest, not apologetic. */
    slowNote: string;
  };
  ready: {
    notifyTitle: string;
    notifyBody: string;
  };
  error: {
    retryHint: string;
  };
  preview: {
    eyebrow: string;
    narrativeFallback: string;
    stopsLabel: string;
  };
}

const FIGURE_RESTAURANTS = FOOD_DB.restaurants.toLocaleString('en-US');
const FIGURE_CITIES = String(FOOD_DB.cities);

export const PLANNER_COPY: Record<PlannerLang, PlannerCopy> = {
  en: {
    masthead: {
      eyebrow: 'Trip planner — Korea',
      headline: 'Answer four things. Get a Korea itinerary you can actually run.',
      lede: 'Dates, cities, how fast you like to move, and what you cannot eat. What comes back is a timed day-by-day plan built on our own Korea data — real places, the transit leg between them, and a map pin on every stop.',
      inputsHeading: 'What you answer',
      inputs: [
        { label: 'Dates', note: 'Arrival and departure, and the hour your flight lands. Day one starts from the airport rather than from a guess.' },
        { label: 'Cities', note: 'One base or several. Intercity legs come back with the train or bus you would actually take.' },
        { label: 'Pace', note: 'Half day through packed. It changes how many stops a day holds, not only the wording.' },
        { label: 'Diet', note: 'Halal, vegetarian and vegan, plus nut, shellfish, gluten and dairy flags — applied before the plan is written, not after.' },
      ],
    },
    modes: {
      heading: 'Choose how to start',
      guided: {
        kicker: 'Answer four things',
        title: 'Write my itinerary',
        body: 'A short brief — dates, cities, pace, diet. You get timed stops, the transit leg between each one, restaurants filtered to your rules, and a map you can open on the street.',
      },
      builder: {
        kicker: 'Bring your own list',
        title: 'Build from my places',
        body: 'Already have restaurants, addresses or a booking that cannot move? Drop them on the days you want them and we route the rest around them.',
      },
    },
    evidence: {
      eyebrow: 'What the itinerary is built from',
      heading: 'Korea-only data, not a general travel search',
      items: [
        { figure: FIGURE_RESTAURANTS, label: 'restaurants in our Korea database', note: 'Coordinates and allergen flags for nuts, shellfish, gluten and dairy on every entry.' },
        { figure: FIGURE_CITIES, label: 'Korean cities covered', note: 'Seoul and Busan through Gyeongju, Jeonju, Sokcho, Yeosu and Tongyeong.' },
        { figure: 'Leg by leg', label: 'transit between stops, with its source', note: 'Where a route lookup returns a result we use its line and duration. Where it does not, the leg is an estimate and the plan says so.' },
      ],
      limits: 'What we do not claim: live opening hours, live seat availability, or that a restaurant is certified safe for your allergy. Confirm anything medical with the venue.',
    },
    wizard: {
      stepOf: 'Step {n} of {total}',
      progressLabel: 'Brief progress',
      hintReopen: 'What this step is for',
      hintClose: 'Hide this note',
    },
    loading: {
      eyebrow: 'Writing your itinerary',
      heading: 'Building the day-by-day plan',
      tipLabel: 'While you wait',
      slowNote: 'Still working. Longer trips take longer to route — you can close this tab and read it in the email instead.',
    },
    ready: {
      notifyTitle: 'Your Korea itinerary is ready',
      notifyBody: 'Open it to see day one, stop by stop.',
    },
    error: {
      retryHint: 'Nothing was charged. You can send the same brief again.',
    },
    preview: {
      eyebrow: 'Preview — day 1',
      narrativeFallback: 'Your itinerary has been written. Day one is below.',
      stopsLabel: 'stops',
    },
  },

  ko: {
    masthead: {
      eyebrow: '여행 플래너 — 한국',
      headline: '네 가지만 답하면, 그대로 다닐 수 있는 한국 일정이 나옵니다.',
      lede: '날짜, 도시, 이동 속도, 못 먹는 음식. 이 네 가지를 넣으면 자체 한국 데이터로 시간대별 일정을 씁니다. 실재하는 장소, 장소 사이의 이동 구간, 모든 정거장의 지도 좌표까지 포함합니다.',
      inputsHeading: '답하시는 네 가지',
      inputs: [
        { label: '날짜', note: '입국·출국 날짜와 비행기 도착 시각. 1일차를 짐작이 아니라 공항에서부터 계산합니다.' },
        { label: '도시', note: '한 도시든 여러 도시든. 도시 사이 구간은 실제로 타게 될 기차·버스로 나옵니다.' },
        { label: '이동 속도', note: '반나절부터 빡빡하게까지. 문구만 바뀌는 게 아니라 하루에 담기는 정거장 수가 달라집니다.' },
        { label: '식이 조건', note: '할랄·베지테리언·비건과 견과·갑각류·글루텐·유제품 표시. 일정을 쓴 뒤가 아니라 쓰기 전에 걸러냅니다.' },
      ],
    },
    modes: {
      heading: '시작 방법 고르기',
      guided: {
        kicker: '네 가지에 답하기',
        title: '일정 대신 써 드립니다',
        body: '날짜·도시·속도·식이만 답하면 됩니다. 시각이 찍힌 정거장, 구간마다의 이동 수단, 조건으로 걸러낸 식당, 그리고 현장에서 바로 여는 지도를 받습니다.',
      },
      builder: {
        kicker: '내 목록 가져오기',
        title: '내 장소로 짜기',
        body: '가고 싶은 맛집·주소나 못 옮기는 예약이 이미 있나요. 원하는 날짜에 올려두면 나머지 동선을 그 사이에 채웁니다.',
      },
    },
    evidence: {
      eyebrow: '일정을 만드는 재료',
      heading: '일반 여행 검색이 아니라 한국 전용 데이터',
      items: [
        { figure: FIGURE_RESTAURANTS, label: '자체 한국 식당 데이터', note: '좌표와 견과·갑각류·글루텐·유제품 알레르기 표시를 전 항목이 갖고 있습니다.' },
        { figure: FIGURE_CITIES, label: '수록 도시', note: '서울·부산부터 경주, 전주, 속초, 여수, 통영까지.' },
        { figure: '구간별', label: '정거장 사이 이동, 출처를 함께', note: '경로 조회가 되는 구간은 노선과 소요 시간을 그대로 씁니다. 안 되는 구간은 추정으로 계산하고 일정에 추정이라고 적습니다.' },
      ],
      limits: '주장하지 않는 것: 실시간 영업시간, 실시간 좌석 현황, 알레르기 안전 보증. 건강과 관련된 사항은 반드시 현장에 직접 확인하세요.',
    },
    wizard: {
      stepOf: '{total}단계 중 {n}단계',
      progressLabel: '입력 진행도',
      hintReopen: '이 단계 설명 보기',
      hintClose: '설명 접기',
    },
    loading: {
      eyebrow: '일정을 쓰는 중',
      heading: '하루하루 동선을 만들고 있습니다',
      tipLabel: '기다리는 동안',
      slowNote: '아직 작업 중입니다. 일정이 길수록 경로 계산이 오래 걸립니다. 창을 닫고 메일로 받아보셔도 됩니다.',
    },
    ready: {
      notifyTitle: '한국 일정이 완성됐어요',
      notifyBody: '1일차부터 순서대로 확인해 보세요.',
    },
    error: {
      retryHint: '결제된 금액은 없습니다. 같은 조건으로 다시 보낼 수 있어요.',
    },
    preview: {
      eyebrow: '미리보기 — 1일차',
      narrativeFallback: '여행 일정을 작성했습니다. 1일차는 아래에 있습니다.',
      stopsLabel: '곳',
    },
  },

  ja: {
    masthead: {
      eyebrow: '旅行プランナー — 韓国',
      headline: '4つ答えるだけ。そのまま動ける韓国の旅程になります。',
      lede: '日付、都市、移動のペース、食べられないもの。この4つを入れると、独自の韓国データで時間ごとの旅程を書きます。実在する場所、場所と場所をつなぐ移動区間、全スポットの地図座標つきです。',
      inputsHeading: 'お答えいただく4つ',
      inputs: [
        { label: '日付', note: '入国・出国の日付と、飛行機が着く時刻。1日目を推測ではなく空港から組み立てます。' },
        { label: '都市', note: '1都市でも複数でも。都市間の区間は実際に乗る列車・バスで返します。' },
        { label: 'ペース', note: '半日からぎっしりまで。文言だけでなく、1日に入るスポットの数が変わります。' },
        { label: '食事条件', note: 'ハラル・ベジタリアン・ヴィーガンと、ナッツ・甲殻類・グルテン・乳製品の表示。旅程を書いた後ではなく、書く前に絞り込みます。' },
      ],
    },
    modes: {
      heading: 'はじめ方を選ぶ',
      guided: {
        kicker: '4つに答える',
        title: '旅程を書いてもらう',
        body: '日付・都市・ペース・食事条件に答えるだけ。時刻つきのスポット、区間ごとの移動手段、条件で絞ったレストラン、そして現地ですぐ開ける地図をお渡しします。',
      },
      builder: {
        kicker: '自分のリストから',
        title: '自分の場所で組む',
        body: '行きたい店や住所、動かせない予約がすでにありますか。希望の日に置いていただければ、残りの動線をその間に組みます。',
      },
    },
    evidence: {
      eyebrow: '旅程をつくる材料',
      heading: '一般的な旅行検索ではなく、韓国専用のデータ',
      items: [
        { figure: FIGURE_RESTAURANTS, label: '自社の韓国レストランデータ', note: '座標と、ナッツ・甲殻類・グルテン・乳製品のアレルギー表示を全件が保持しています。' },
        { figure: FIGURE_CITIES, label: '収録都市', note: 'ソウル・釜山から慶州、全州、束草、麗水、統営まで。' },
        { figure: '区間ごと', label: 'スポット間の移動を、出典つきで', note: '経路が取得できた区間は路線と所要時間をそのまま使います。取得できない区間は推定で算出し、旅程にも推定と明記します。' },
      ],
      limits: '主張しないこと：リアルタイムの営業時間、リアルタイムの空席状況、アレルギー安全の保証。健康に関わることは必ず現地でご確認ください。',
    },
    wizard: {
      stepOf: '{total}ステップ中 {n}',
      progressLabel: '入力の進捗',
      hintReopen: 'このステップの説明',
      hintClose: '説明を閉じる',
    },
    loading: {
      eyebrow: '旅程を作成中',
      heading: '日ごとの動線を組み立てています',
      tipLabel: 'お待ちの間に',
      slowNote: 'まだ作業中です。日程が長いほど経路の計算に時間がかかります。このタブを閉じて、メールで受け取っていただいても大丈夫です。',
    },
    ready: {
      notifyTitle: '韓国の旅程ができました',
      notifyBody: '1日目から順に確認できます。',
    },
    error: {
      retryHint: '請求は発生していません。同じ条件でもう一度送れます。',
    },
    preview: {
      eyebrow: 'プレビュー — 1日目',
      narrativeFallback: '旅程を作成しました。1日目は下にあります。',
      stopsLabel: 'ヶ所',
    },
  },

  zh: {
    masthead: {
      eyebrow: '行程规划 — 韩国',
      headline: '只需回答四项，就能拿到可以直接执行的韩国行程。',
      lede: '日期、城市、行程节奏、不能吃的东西。填好这四项，我们用自有的韩国数据写出分时段行程：真实存在的地点、地点之间的交通区间，以及每个站点的地图坐标。',
      inputsHeading: '你要回答的四项',
      inputs: [
        { label: '日期', note: '入境与离境日期，以及航班落地的时间。第一天从机场开始算，而不是靠猜。' },
        { label: '城市', note: '一座城市或多座都行。城际区间会给出你实际要坐的火车或大巴。' },
        { label: '节奏', note: '从半天到排满。变的不只是措辞，而是一天能装下几个站点。' },
        { label: '饮食条件', note: '清真、素食、纯素，以及坚果、甲壳类、麸质、乳制品标记。在写行程之前就筛掉，而不是写完再补。' },
      ],
    },
    modes: {
      heading: '选择开始方式',
      guided: {
        kicker: '回答四项',
        title: '帮我写行程',
        body: '只要回答日期、城市、节奏和饮食条件。你会拿到带时刻的站点、每段之间的交通方式、按条件筛过的餐厅，以及在路上就能打开的地图。',
      },
      builder: {
        kicker: '用我的清单',
        title: '用我的地点来排',
        body: '已经有想去的餐厅、地址，或者改不了的预订？把它们放到想去的那天，剩下的动线我们来接。',
      },
    },
    evidence: {
      eyebrow: '行程的原料',
      heading: '不是通用旅行搜索，而是韩国专用数据',
      items: [
        { figure: FIGURE_RESTAURANTS, label: '自有韩国餐厅数据', note: '每一条都带坐标，以及坚果、甲壳类、麸质、乳制品的过敏标记。' },
        { figure: FIGURE_CITIES, label: '收录城市', note: '从首尔、釜山到庆州、全州、束草、丽水、统营。' },
        { figure: '逐段', label: '站点之间的交通，并标注来源', note: '能查到路径的路段，直接采用其线路与耗时。查不到的路段按估算处理，并在行程里标明是估算。' },
      ],
      limits: '我们不主张的：实时营业时间、实时余位、过敏安全保证。涉及健康的事项请务必向商家当面确认。',
    },
    wizard: {
      stepOf: '第 {n} 步，共 {total} 步',
      progressLabel: '填写进度',
      hintReopen: '这一步是做什么的',
      hintClose: '收起说明',
    },
    loading: {
      eyebrow: '正在撰写行程',
      heading: '正在排出逐日的动线',
      tipLabel: '等待时可以看看',
      slowNote: '仍在处理中。行程越长，路线计算越久。你也可以关掉这个页面，改从邮件里查看。',
    },
    ready: {
      notifyTitle: '你的韩国行程已完成',
      notifyBody: '打开就能按顺序看第一天。',
    },
    error: {
      retryHint: '没有产生任何扣款。你可以用同样的条件再发一次。',
    },
    preview: {
      eyebrow: '预览 — 第 1 天',
      narrativeFallback: '行程已经写好，第一天在下面。',
      stopsLabel: '处',
    },
  },
};

export function pickPlannerCopy(language: string): PlannerCopy {
  return PLANNER_COPY[language as PlannerLang] || PLANNER_COPY.en;
}

/** `Step {n} of {total}` without pulling a formatting library in. */
export function formatStepOf(template: string, n: number, total: number): string {
  return template.replace('{n}', String(n)).replace('{total}', String(total));
}
