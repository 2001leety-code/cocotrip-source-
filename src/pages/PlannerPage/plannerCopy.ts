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
 * The product in front of the traveller is: **you give us your booking status,
 * dates, cities, pace and dietary rules, and we write a Korea itinerary you
 * can actually execute.**
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
    /** The five things the traveller actually answers. Order is the wizard's. */
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
    /**
     * The last step's action. It calls `/api/ai-planner-quick`, which is free
     * and returns day one only — so the card says exactly that. It used to show
     * the full-plan price with `planner.wizardGenerateBtn` and
     * `planner.wizardPaymentNote`, which dressed a no-charge request as a
     * purchase. The real price stays where money is actually being asked for:
     * the pricing note above the brief, and `PurchaseSection` after the preview.
     */
    previewEyebrow: string;
    previewLede: string;
    previewCta: string;
    /** Button label while the preview is being written. No ETA, no payment. */
    previewBusy: string;
    /** Says the full itinerary is the paid step, without naming an amount. */
    previewNote: string;
    /** The last step's name on the rail. It used to be `planner_generate_cta`,
     *  which named the paid deliverable for a step that produces the free one. */
    previewStep: string;
  };
  loading: {
    eyebrow: string;
    heading: string;
    tipLabel: string;
    /** Shown once generation passes the slow threshold. Honest, not apologetic. */
    slowNote: string;
    /** Same screen, free-preview run: it is not writing the paid full plan. */
    previewEyebrow: string;
    previewHeading: string;
    /** `slowNote` offers the emailed plan, which the free preview is not. */
    previewSlowNote: string;
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
    /** Heads the `reflectedConditions` list. 2026-08-24 (planner-trust-course,
     *  honest coverage): names what was *sent*, not a claim that the model
     *  *used* every one of them — "used"/"reflected"/"based on" all read as a
     *  proven outcome the preview doesn't verify. */
    basedOnLabel: string;
    /** Heads the `deferredCategories` list (2026-08-24, planner-trust-course
     *  C) — categories this endpoint has no verified data to shape day one
     *  with. Must say they apply to the FULL itinerary, never imply this
     *  preview already reflected them. */
    deferredHeading: string;
  };
}

const FIGURE_RESTAURANTS = FOOD_DB.restaurants.toLocaleString('en-US');
const FIGURE_CITIES = String(FOOD_DB.cities);

export const PLANNER_COPY: Record<PlannerLang, PlannerCopy> = {
  en: {
    masthead: {
      eyebrow: 'Trip planner — Korea',
      headline: 'Answer five things. Get a Korea itinerary you can actually run.',
      lede: 'What you have already booked, dates, cities, how fast you like to move, and Halal/Vegan/Vegetarian needs. What comes back is a timed day-by-day plan built on our own Korea data — real places, the transit leg between them, and a map pin on every stop.',
      inputsHeading: 'What you answer',
      inputs: [
        { label: 'Booking status', note: "What you've already booked — flight, hotel, both, or nothing yet — so day one starts from your real arrival, not a guess." },
        { label: 'Dates', note: 'Arrival and departure, and the hour your flight lands. Day one starts from the airport rather than from a guess.' },
        { label: 'Cities', note: 'One base or several. Intercity legs come back with the train or bus you would actually take.' },
        { label: 'Pace', note: 'Half day through packed. It changes how many stops a day holds, not only the wording.' },
        { label: 'Diet', note: 'Halal, vegetarian and vegan — filtered before the plan is written, with a verification tier (operator-certified, Google-sourced, or unverified) on every dietary pick.' },
      ],
    },
    modes: {
      heading: 'Choose how to start',
      guided: {
        kicker: 'Answer five things',
        title: 'Write my itinerary',
        body: 'A short brief — booking status, dates, cities, pace, diet. You get timed stops, the transit leg between each one, restaurants filtered to your rules, and a map you can open on the street.',
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
        { figure: FIGURE_RESTAURANTS, label: 'restaurants in our Korea database', note: 'Coordinates on every entry, plus a verification tier (operator-certified, Google-sourced, or unverified) for halal and vegan picks.' },
        { figure: FIGURE_CITIES, label: 'Korean cities covered', note: 'Seoul and Busan through Gyeongju, Jeonju, Sokcho, Yeosu and Tongyeong.' },
        { figure: 'Leg by leg', label: 'transit between stops, with its source', note: 'Where a route lookup returns a result we use its line and duration. Where it does not, the leg is an estimate and the plan says so.' },
      ],
      limits: 'What we do not claim: live opening hours, live seat availability, or that every halal/vegan match is operator-certified — most are Google-sourced "friendly" listings, not certifications. Confirm anything medical or religious with the venue.',
    },
    wizard: {
      stepOf: 'Step {n} of {total}',
      progressLabel: 'Brief progress',
      hintReopen: 'What this step is for',
      hintClose: 'Hide this note',
      previewEyebrow: 'Free preview',
      previewLede: 'Day one, written from the brief you just filled in. No payment, no card.',
      previewCta: 'See day one free',
      previewBusy: 'Writing your free day-one preview',
      previewNote: 'The full day-by-day itinerary is a separate paid step. You decide once you have read day one.',
      previewStep: 'Review + free preview',
    },
    loading: {
      eyebrow: 'Writing your itinerary',
      heading: 'Building the day-by-day plan',
      tipLabel: 'While you wait',
      slowNote: 'Still working. Longer trips take longer to route — you can close this tab and read it in the email instead.',
      previewEyebrow: 'Free preview',
      previewHeading: 'Writing day one from your brief',
      previewSlowNote: 'Still working on day one. Nothing has been charged.',
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
      basedOnLabel: 'Conditions sent to this preview',
      deferredHeading: 'Applied to the full itinerary, not this preview',
    },
  },

  ko: {
    masthead: {
      eyebrow: '여행 플래너 — 한국',
      headline: '다섯 가지만 답하면, 그대로 다닐 수 있는 한국 일정이 나옵니다.',
      lede: '이미 예약한 것, 날짜, 도시, 이동 속도, 할랄/비건/채식 여부. 이 다섯 가지를 넣으면 자체 한국 데이터로 시간대별 일정을 씁니다. 실재하는 장소, 장소 사이의 이동 구간, 모든 정거장의 지도 좌표까지 포함합니다.',
      inputsHeading: '답하시는 다섯 가지',
      inputs: [
        { label: '예약 현황', note: '항공권·호텔 중 이미 예약한 게 있는지. 짐작이 아니라 실제 도착 상황에서부터 1일차를 계산합니다.' },
        { label: '날짜', note: '입국·출국 날짜와 비행기 도착 시각. 1일차를 짐작이 아니라 공항에서부터 계산합니다.' },
        { label: '도시', note: '한 도시든 여러 도시든. 도시 사이 구간은 실제로 타게 될 기차·버스로 나옵니다.' },
        { label: '이동 속도', note: '반나절부터 빡빡하게까지. 문구만 바뀌는 게 아니라 하루에 담기는 정거장 수가 달라집니다.' },
        { label: '식이 조건', note: '할랄, 베지테리언, 비건을 검증 등급(운영자 인증, 구글 기반, 미검증)과 함께 걸러냅니다. 일정을 쓴 뒤가 아니라 쓰기 전에 반영됩니다.' },
      ],
    },
    modes: {
      heading: '시작 방법 고르기',
      guided: {
        kicker: '다섯 가지에 답하기',
        title: '일정 대신 써 드립니다',
        body: '예약 현황·날짜·도시·속도·식이만 답하면 됩니다. 시각이 찍힌 정거장, 구간마다의 이동 수단, 조건으로 걸러낸 식당, 그리고 현장에서 바로 여는 지도를 받습니다.',
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
        { figure: FIGURE_RESTAURANTS, label: '자체 한국 식당 데이터', note: '전 항목에 좌표를 보유하며, 할랄·비건 항목에는 검증 등급(운영자 인증/구글 기반/미검증)을 표시합니다.' },
        { figure: FIGURE_CITIES, label: '수록 도시', note: '서울·부산부터 경주, 전주, 속초, 여수, 통영까지.' },
        { figure: '구간별', label: '정거장 사이 이동, 출처를 함께', note: '경로 조회가 되는 구간은 노선과 소요 시간을 그대로 씁니다. 안 되는 구간은 추정으로 계산하고 일정에 추정이라고 적습니다.' },
      ],
      limits: '주장하지 않는 것: 실시간 영업시간, 실시간 좌석 현황, 모든 할랄·비건 매칭이 인증되었다는 보증(대부분은 구글 기반 "친화" 등급이며 인증이 아닙니다). 건강·종교 관련 사항은 반드시 현장에 직접 확인하세요.',
    },
    wizard: {
      stepOf: '{total}단계 중 {n}단계',
      progressLabel: '입력 진행도',
      hintReopen: '이 단계 설명 보기',
      hintClose: '설명 접기',
      previewEyebrow: '무료 미리보기',
      previewLede: '방금 적으신 조건 그대로 1일차를 먼저 써 드립니다. 결제도, 카드 등록도 없습니다.',
      previewCta: '1일차 무료로 보기',
      previewBusy: '1일차 무료 미리보기를 쓰는 중',
      previewNote: '전체 일정은 결제가 필요한 별도 단계입니다. 1일차를 읽어 보고 결정하시면 됩니다.',
      previewStep: '검토 + 무료 미리보기',
    },
    loading: {
      eyebrow: '일정을 쓰는 중',
      heading: '하루하루 동선을 만들고 있습니다',
      tipLabel: '기다리는 동안',
      slowNote: '아직 작업 중입니다. 일정이 길수록 경로 계산이 오래 걸립니다. 창을 닫고 메일로 받아보셔도 됩니다.',
      previewEyebrow: '무료 미리보기',
      previewHeading: '적어 주신 조건으로 1일차를 쓰고 있습니다',
      previewSlowNote: '아직 1일차를 쓰는 중입니다. 결제된 금액은 없습니다.',
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
      basedOnLabel: '이 미리보기에 전달된 조건',
      deferredHeading: '이 미리보기가 아닌 전체 일정에 반영됩니다',
    },
  },

  ja: {
    masthead: {
      eyebrow: '旅行プランナー — 韓国',
      headline: '5つ答えるだけ。そのまま動ける韓国の旅程になります。',
      lede: 'すでに予約したもの、日付、都市、移動のペース、ハラール・ヴィーガン・ベジタリアンの希望。この5つを入れると、独自の韓国データで時間ごとの旅程を書きます。実在する場所、場所と場所をつなぐ移動区間、全スポットの地図座標つきです。',
      inputsHeading: 'お答えいただく5つ',
      inputs: [
        { label: '予約状況', note: '航空券・ホテルのうちすでに予約済みのもの。推測ではなく実際の到着状況から1日目を組み立てます。' },
        { label: '日付', note: '入国・出国の日付と、飛行機が着く時刻。1日目を推測ではなく空港から組み立てます。' },
        { label: '都市', note: '1都市でも複数でも。都市間の区間は実際に乗る列車・バスで返します。' },
        { label: 'ペース', note: '半日からぎっしりまで。文言だけでなく、1日に入るスポットの数が変わります。' },
        { label: '食事条件', note: 'ハラル・ベジタリアン・ヴィーガンを検証段階（運営者認証・Google由来・未検証）とともに絞り込みます。旅程を書いた後ではなく、書く前に反映します。' },
      ],
    },
    modes: {
      heading: 'はじめ方を選ぶ',
      guided: {
        kicker: '5つに答える',
        title: '旅程を書いてもらう',
        body: '予約状況・日付・都市・ペース・食事条件に答えるだけ。時刻つきのスポット、区間ごとの移動手段、条件で絞ったレストラン、そして現地ですぐ開ける地図をお渡しします。',
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
        { figure: FIGURE_RESTAURANTS, label: '自社の韓国レストランデータ', note: '全件に座標を保持し、ハラル・ビーガン項目には検証段階（運営者認証・Google由来・未検証）を表示します。' },
        { figure: FIGURE_CITIES, label: '収録都市', note: 'ソウル・釜山から慶州、全州、束草、麗水、統営まで。' },
        { figure: '区間ごと', label: 'スポット間の移動を、出典つきで', note: '経路が取得できた区間は路線と所要時間をそのまま使います。取得できない区間は推定で算出し、旅程にも推定と明記します。' },
      ],
      limits: '主張しないこと：リアルタイムの営業時間、リアルタイムの空席状況、すべてのハラル・ビーガン一致が認証済みであるという保証（大半はGoogle由来の「フレンドリー」判定で認証ではありません）。健康・宗教に関わることは必ず現地でご確認ください。',
    },
    wizard: {
      stepOf: '{total}ステップ中 {n}',
      progressLabel: '入力の進捗',
      hintReopen: 'このステップの説明',
      hintClose: '説明を閉じる',
      previewEyebrow: '無料プレビュー',
      previewLede: '今ご入力いただいた条件のまま、1日目を先に書きます。お支払いもカード登録も不要です。',
      previewCta: '1日目を無料で見る',
      previewBusy: '1日目の無料プレビューを作成中',
      previewNote: '全日程は有料の別ステップです。1日目を読んでから決めていただけます。',
      previewStep: '確認 + 無料プレビュー',
    },
    loading: {
      eyebrow: '旅程を作成中',
      heading: '日ごとの動線を組み立てています',
      tipLabel: 'お待ちの間に',
      slowNote: 'まだ作業中です。日程が長いほど経路の計算に時間がかかります。このタブを閉じて、メールで受け取っていただいても大丈夫です。',
      previewEyebrow: '無料プレビュー',
      previewHeading: 'ご入力の条件で1日目を書いています',
      previewSlowNote: 'まだ1日目を作成中です。請求は発生していません。',
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
      basedOnLabel: 'このプレビューに送信された条件',
      deferredHeading: 'このプレビューではなく、全旅程に反映されます',
    },
  },

  zh: {
    masthead: {
      eyebrow: '行程规划 — 韩国',
      headline: '只需回答五项，就能拿到可以直接执行的韩国行程。',
      lede: '已经预订的内容、日期、城市、行程节奏、清真/纯素/素食需求。填好这五项，我们用自有的韩国数据写出分时段行程：真实存在的地点、地点之间的交通区间，以及每个站点的地图坐标。',
      inputsHeading: '你要回答的五项',
      inputs: [
        { label: '预订情况', note: '机票、酒店中已经订好的部分——第一天从你真实的抵达情况开始算，而不是靠猜。' },
        { label: '日期', note: '入境与离境日期，以及航班落地的时间。第一天从机场开始算，而不是靠猜。' },
        { label: '城市', note: '一座城市或多座都行。城际区间会给出你实际要坐的火车或大巴。' },
        { label: '节奏', note: '从半天到排满。变的不只是措辞，而是一天能装下几个站点。' },
        { label: '饮食条件', note: '清真、素食、纯素用验证等级(运营方认证、谷歌来源、未验证)筛选。在编写行程之前而不是之后进行过滤。' },
      ],
    },
    modes: {
      heading: '选择开始方式',
      guided: {
        kicker: '回答五项',
        title: '帮我写行程',
        body: '只要回答预订情况、日期、城市、节奏和饮食条件。你会拿到带时刻的站点、每段之间的交通方式、按条件筛过的餐厅，以及在路上就能打开的地图。',
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
        { figure: FIGURE_RESTAURANTS, label: '自有韩国餐厅数据', note: '每一条都带坐标；清真、纯素条目附验证等级(运营方认证/谷歌来源/未验证)。' },
        { figure: FIGURE_CITIES, label: '收录城市', note: '从首尔、釜山到庆州、全州、束草、丽水、统营。' },
        { figure: '逐段', label: '站点之间的交通，并标注来源', note: '能查到路径的路段，直接采用其线路与耗时。查不到的路段按估算处理，并在行程里标明是估算。' },
      ],
      limits: '我们不主张的：实时营业时间、实时余位、所有清真/纯素匹配均经认证(多数为谷歌来源的"友好"标注，非认证)。涉及健康或宗教的事项请务必向商家当面确认。',
    },
    wizard: {
      stepOf: '第 {n} 步，共 {total} 步',
      progressLabel: '填写进度',
      hintReopen: '这一步是做什么的',
      hintClose: '收起说明',
      previewEyebrow: '免费预览',
      previewLede: '我们先按你刚填写的条件写出第一天。无需付款，也不用绑卡。',
      previewCta: '免费查看第一天',
      previewBusy: '正在撰写第一天的免费预览',
      previewNote: '完整逐日行程是需要付费的另一步。看完第一天再决定即可。',
      previewStep: '确认 + 免费预览',
    },
    loading: {
      eyebrow: '正在撰写行程',
      heading: '正在排出逐日的动线',
      tipLabel: '等待时可以看看',
      slowNote: '仍在处理中。行程越长，路线计算越久。你也可以关掉这个页面，改从邮件里查看。',
      previewEyebrow: '免费预览',
      previewHeading: '正在按你填写的条件撰写第一天',
      previewSlowNote: '仍在撰写第一天。没有产生任何扣款。',
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
      basedOnLabel: '已发送给本预览的条件',
      deferredHeading: '不在此预览中体现，将应用于完整行程',
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
