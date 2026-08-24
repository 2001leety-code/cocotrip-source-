/**
 * /planner 공개 정보 섹션 (2026-08-06).
 *
 * 왜 만드는가: GSC 실측에서 `/planner` 만 **`Crawled – currently not indexed`** 였다.
 * 구글이 와서 보고 나서 색인을 안 한 것이다(안 온 게 아니다). 크롤러가 받는 `<main>`
 * 본문이 **939자** 뿐이었기 때문이다 — 위저드는 상호작용이라 1단계 껍데기만 프리렌더된다.
 * 같은 조건에서 `/charter`(4,980자)와 가이드 글(6,007자)은 색인됐다.
 *
 * 이건 `/charter` 가 2026-07-30 에 이미 겪고 고친 문제다(`components/charter/CharterSeoInfo`).
 * 그때 "위저드는 크롤러가 볼 수 없으니 사람이 궁금해하는 정보를 정적 본문으로 둔다"는
 * 결론을 내렸는데, **형제인 `/planner` 에는 적용하지 않았다.** 이 파일이 그 미적용분이다.
 *
 * 원칙 (CharterSeoInfo 와 동일)
 *   - 숨은 문구·키워드 나열 금지. 여기 있는 문장은 전부 화면에 보이고 사람이 읽는 내용이다.
 *   - 숫자·목록은 SSOT 에서 **파생**한다. 손으로 적어두면 개정 때 이 페이지만 거짓말이 된다.
 *       가격  = lib/aiPlannerPrice (AI_PLANNER_FULL_USD)
 *       도시  = WizardForm/data CITY_CHIPS + 도시명 i18n(`planner.city_<key>`)
 *       식이  = WizardForm/data DIETARY_RESTRICTION_KEYS
 *   - 환불 문구는 실제 결제 화면(`PurchaseSection` 의 `aiPlanNoRefundNotice`)과 같은 말만 쓴다.
 *     ⚠️ i18n 에 `paypalSafeCheckout`("100% refund if unsatisfied")가 남아 있으나 **사용처 0**
 *     인 죽은 문구다. 그 문장을 여기로 가져오면 화면과 반대되는 약속이 된다.
 *
 * ❌ 가격 섹션은 일부러 없다. 바로 위 `AiPlannerPricingNote` 가 무료/쿠폰/$9.90 을 이미
 *    말하고, 초안에는 "표시 금액이 결제 금액입니다" 가 **글자까지 똑같이** 두 번 나왔다.
 *    같은 페이지에 같은 문단이 두 벌이면 손님은 두 번 읽고 검색엔진엔 중복 텍스트다.
 *    가격은 FAQ 안에만 둔다 — 질문 형태라 문장이 다르고, FAQPage 스키마에도 필요하다.
 */
import type { Translations } from '@/i18n';
import { CITY_CHIPS, DIETARY_RESTRICTION_KEYS } from '@/components/WizardForm/data';
import { formatAiPlannerUsd, formatAiPlannerApproxKrw } from '@/lib/aiPlannerPrice';
import { useJsonLd } from '@/hooks/useJsonLd';
import { buildFaqJsonLd } from '@/lib/jsonLd';

type Lang = 'ko' | 'en' | 'ja' | 'zh';

// approxKrw 는 `formatAiPlannerApproxKrw` 가 이미 "약 "/"≈ " 접두어를 붙여 돌려준다.
// 문장에서 "약" 을 또 쓰면 "약 약 ₩13,300" 이 된다 — 괄호만 씌울 것.
type Vars = { price: string; approxKrw: string; cities: string; cityCount: number; diets: string };

const COPY: Record<Lang, {
  getTitle: string; get: string[];
  keepTitle: string; keepIntro: string; keep: string[];
  coverageTitle: string; coverage: (v: Vars) => string[];
  processTitle: string; process: string[];
  faqTitle: string; faq: (v: Vars) => Array<[string, string]>;
}> = {
  ko: {
    getTitle: '무엇이 나오나',
    get: [
      '하루 단위 일정 — 날짜별로 어디를 몇 시에 가는지, 식사는 어디서 하는지까지 시각이 붙습니다.',
      '실제 대중교통 경로 — 두 장소 사이를 지하철 몇 호선·어느 버스로, 어디서 갈아타고 몇 분 걸리는지 나옵니다. 직선거리 추정이 아닙니다.',
      '도보 지도 — 지하철 출구·버스 정류장에서 입구까지 걷는 구간을 지도로 그려 줍니다. 한글을 못 읽어도 찾아갈 수 있습니다.',
      'PDF 저장 — 일정 전체를 PDF 로 내려받습니다. 지하에서 데이터가 안 터져도 열립니다.',
    ],
    keepTitle: '왜 이 일정은 실제로 지킬 수 있나',
    keepIntro: '날짜·도시·여행 속도·식사 제약을 한국 교통·식당 데이터에 맞춰 하루씩 짭니다. 그다음 아래를 검사하고, 안 맞으면 그 날을 다시 만듭니다.',
    keep: [
      '항공편 시각 — 도착일은 공항에서 나온 뒤부터 시작하고, 출국일은 탑승 시각 전에 끝납니다. 출발 공항까지 가는 실제 소요 시간으로 계산합니다.',
      '숙소 체크아웃 — 짐을 들고 움직이는 시간이 일정 안에 실제 일정으로 들어갑니다.',
      '이동 시간 — 두 장소 사이 이동을 실제 대중교통 소요 시간으로 잡습니다. 하루에 안 들어가면 그 날을 다시 짭니다.',
      '식당 확인 — 추천 식당은 저희가 관리하는 목록과 대조합니다. 문 닫은 가게나 없는 이름이 일정에 들어가지 않습니다.',
    ],
    coverageTitle: '어디까지 되나',
    coverage: ({ cities, cityCount, diets }) => [
      `도시 ${cityCount}곳 — ${cities}. 여러 도시를 옮겨 다니는 일정도 됩니다.`,
      `식사 제약 — ${diets} 를 선택하면 그 조건에 맞는 식당만 일정에 들어갑니다.`,
      '언어 4개 — 영어·한국어·일본어·중국어. 화면만이 아니라 일정 내용과 PDF 도 고른 언어로 나옵니다.',
    ],
    processTitle: '만드는 순서',
    process: [
      '설문 5단계에서 날짜·도시·항공편·식사 제약·여행 속도를 고릅니다. 가입 없이 여기까지 됩니다.',
      '일정 뼈대(미리보기)를 무료로 봅니다. 원하는 모양인지 여기서 판단하면 됩니다.',
      '전체 일정을 결제합니다. 가입하면 1~3일 일정은 쿠폰으로 무료입니다.',
      '경로·지도·PDF 가 포함된 전체 일정을 받습니다.',
    ],
    faqTitle: '자주 묻는 질문',
    faq: ({ price, approxKrw, cityCount, diets }) => [
      ['결제 전에 결과를 볼 수 있나요?', '볼 수 있습니다. 가입 없이 일정 뼈대를 무료로 보여드립니다. 가입하면 1~3일 일정은 전체가 무료입니다.'],
      ['가격이 얼마인가요?', `전체 일정이 ${price} (${approxKrw}) 이고 한 번 결제입니다. 구독이 아니라 매달 나가는 돈은 없습니다. 표시 금액이 결제 금액이며, 원화는 참고용이라 카드사 환율에 따라 다를 수 있습니다.`],
      ['환불되나요?', 'AI 일정은 결제 즉시 전달되는 디지털 상품이라 환불되지 않습니다. 그래서 결제 전에 무료 미리보기로 확인하시는 것을 권합니다. 전세 차량과 투어 예약은 별도의 환불 규정을 따릅니다.'],
      ['일정에 실제 교통편이 들어가나요?', '들어갑니다. 두 장소 사이를 지하철 몇 호선·어느 버스로 가는지, 어디서 갈아타는지, 몇 분 걸리는지가 일정에 붙습니다. 마지막 도보 구간은 지도로 그려 드립니다.'],
      ['할랄이나 비건 식당도 찾아주나요?', `찾아 드립니다. ${diets} 중에서 고르면 그 조건에 맞는 식당만 일정에 들어갑니다.`],
      ['어느 도시를 다루나요?', `${cityCount}곳입니다. 여러 도시를 옮겨 다니는 일정도 만들 수 있고, 도시 사이 이동 시간도 일정에 넣어 계산합니다.`],
      ['한국어를 못해도 쓸 수 있나요?', '쓸 수 있습니다. 영어·한국어·일본어·중국어로 제공하며, 화면만이 아니라 일정 내용과 PDF 까지 고른 언어로 나옵니다.'],
    ],
  },
  en: {
    getTitle: 'What you get',
    get: [
      'A day-by-day itinerary — each day laid out with times, including where you eat.',
      'Real transit routes — which subway line or bus connects each pair of stops, where you transfer, and how many minutes it takes. Not a straight-line estimate.',
      'Walking maps — the stretch from the subway exit or bus stop to the door, drawn on a map. You do not need to read Korean to find it.',
      'A PDF — download the whole plan. It opens underground where your data does not work.',
    ],
    keepTitle: 'Why this schedule actually holds',
    keepIntro: 'Each day is written from your dates, cities, pace and dietary needs against Korean transit and restaurant data, then checked against the constraints below. A day that does not fit is rebuilt.',
    keep: [
      'Flight times — the arrival day starts after you clear the airport, and the departure day ends before boarding, sized to the real travel time to your departure airport.',
      'Hotel checkout — the time you spend moving with luggage is a scheduled event, not an afterthought.',
      'Travel time — the gap between two stops is the real transit duration. A day that does not fit gets rebuilt.',
      'Restaurant verification — suggested restaurants are checked against a curated list, so closed venues and invented names do not reach your plan.',
    ],
    coverageTitle: 'What it covers',
    coverage: ({ cities, cityCount, diets }) => [
      `${cityCount} cities — ${cities}. Multi-city trips are supported.`,
      `Dietary needs — pick ${diets} and only restaurants meeting that requirement enter the plan.`,
      'Four languages — English, Korean, Japanese and Chinese. Not just the interface: the itinerary itself and the PDF come back in the language you chose.',
    ],
    processTitle: 'How it works',
    process: [
      'Answer a 5-step form: dates, cities, flights, dietary needs and travel pace. No account needed to get this far.',
      'See the outline for free. Decide here whether the days are shaped the way you want.',
      'Pay for the full itinerary. Signing up makes a 1-3 day itinerary free.',
      'Receive the complete plan with routes, maps and PDF.',
    ],
    faqTitle: 'Frequently asked questions',
    faq: ({ price, approxKrw, cityCount, diets }) => [
      ['Can I see the result before paying?', 'Yes. The outline is free with no account. Signing up makes a full 1-3 day itinerary free.'],
      ['How much does it cost?', `The full itinerary is ${price} (${approxKrw}), paid once. It is not a subscription, so there is no recurring charge. The price shown is what you are charged; the KRW figure is for reference and may differ by card issuer.`],
      ['Can I get a refund?', 'AI itineraries are digital products delivered immediately on payment, so they are not refundable. That is why the free preview exists — check the plan before you pay. Charter and tour bookings follow a separate refund policy.'],
      ['Does the plan include real transport directions?', 'Yes. Each pair of stops is connected by an actual subway or bus route, with the transfer point and the duration, plus a walking map for the final stretch.'],
      ['Can it find halal or vegan restaurants?', `Yes. Choose from ${diets} and only restaurants meeting that requirement enter the itinerary.`],
      ['Which cities are covered?', `${cityCount} cities. Multi-city trips are supported, and the travel time between cities is scheduled rather than assumed.`],
      ['Can I use it without speaking Korean?', 'Yes. It is available in English, Korean, Japanese and Chinese, and the itinerary and PDF come back in the language you chose, not just the interface.'],
    ],
  },
  ja: {
    getTitle: '受け取れるもの',
    get: [
      '日ごとの旅程 — 日付ごとに、何時にどこへ行くか、食事はどこかまで時刻が入ります。',
      '実際の交通ルート — 2地点の間を地下鉄何号線・どのバスで行き、どこで乗り換え、何分かかるかが出ます。直線距離の概算ではありません。',
      '徒歩の地図 — 地下鉄の出口やバス停から入口までの区間を地図で示します。ハングルが読めなくてもたどり着けます。',
      'PDF 保存 — 旅程全体をダウンロードできます。地下で通信が切れても開けます。',
    ],
    keepTitle: 'この旅程が実際に守れる理由',
    keepIntro: '日程・都市・旅のペース・食事制限をもとに、韓国の交通・レストランのデータで一日ずつ組み立てます。その後で以下を検査し、合わない日は作り直します。',
    keep: [
      'フライト時刻 — 到着日は空港を出てから始まり、出発日は搭乗時刻の前に終わります。出発空港までの実際の所要時間で計算します。',
      'ホテルのチェックアウト — 荷物を持って移動する時間が、実際の予定として旅程に入ります。',
      '移動時間 — 2地点の間は実際の公共交通の所要時間で確保します。1日に収まらなければその日を作り直します。',
      'レストランの確認 — 提案する店は当社が管理するリストと照合します。閉店した店や存在しない名前は旅程に入りません。',
    ],
    coverageTitle: '対応範囲',
    coverage: ({ cities, cityCount, diets }) => [
      `都市 ${cityCount} か所 — ${cities}。複数都市を移動する旅程にも対応します。`,
      `食事の制限 — ${diets} を選ぶと、その条件に合う店だけが旅程に入ります。`,
      '4言語 — 英語・韓国語・日本語・中国語。画面だけでなく、旅程の内容と PDF も選んだ言語で出ます。',
    ],
    processTitle: '作成の流れ',
    process: [
      '5ステップの入力で日程・都市・フライト・食事制限・旅のペースを選びます。ここまでは登録不要です。',
      '旅程の骨組み（プレビュー）を無料で確認します。希望どおりの形かをここで判断できます。',
      '全旅程を購入します。登録すると1〜3日分はクーポンで無料になります。',
      'ルート・地図・PDF を含む全旅程を受け取ります。',
    ],
    faqTitle: 'よくある質問',
    faq: ({ price, approxKrw, cityCount, diets }) => [
      ['支払う前に結果を見られますか？', '見られます。登録なしで旅程の骨組みを無料でお見せします。登録すると1〜3日分は全体が無料です。'],
      ['料金はいくらですか？', `全旅程が ${price}（${approxKrw}）で、一度きりの支払いです。定期購読ではないので毎月の費用はかかりません。表示金額が支払金額で、ウォン表記は参考のためカード会社のレートにより異なる場合があります。`],
      ['返金できますか？', 'AI 旅程は決済後すぐにお渡しするデジタル商品のため、返金はできません。ですので購入前に無料プレビューでのご確認をおすすめします。チャーターとツアーの予約は別の返金規定に従います。'],
      ['旅程に実際の交通案内は入りますか？', '入ります。2地点の間を地下鉄何号線・どのバスで行くか、どこで乗り換えるか、何分かかるかが旅程に付きます。最後の徒歩区間は地図で示します。'],
      ['ハラールやヴィーガンの店も探せますか？', `探せます。${diets} から選ぶと、その条件に合う店だけが旅程に入ります。`],
      ['どの都市に対応していますか？', `${cityCount} か所です。複数都市を移動する旅程も作成でき、都市間の移動時間も旅程に入れて計算します。`],
      ['韓国語が話せなくても使えますか？', '使えます。英語・韓国語・日本語・中国語で提供し、画面だけでなく旅程の内容と PDF まで選んだ言語で出ます。'],
    ],
  },
  zh: {
    getTitle: '你会得到什么',
    get: [
      '逐日行程 — 按日期排好，几点去哪里、在哪里用餐都带时间。',
      '真实交通路线 — 两个地点之间坐几号线地铁或哪路公交、在哪里换乘、需要多少分钟，都会列出。不是直线距离估算。',
      '步行地图 — 从地铁出口或公交站到门口的这段路会画在地图上。看不懂韩文也能找到。',
      'PDF 保存 — 整份行程可下载。在地下没有信号时也能打开。',
    ],
    keepTitle: '这份行程为什么真的能执行',
    keepIntro: '按你的日期、城市、行程节奏和饮食限制，用韩国的交通与餐厅数据逐日编排，再按下列条件检查，不符合就把那一天重做。',
    keep: [
      '航班时间 — 抵达日从出机场之后开始，离境日在登机前结束，按前往出发机场的实际用时计算。',
      '酒店退房 — 拖着行李移动的时间会作为真实日程排进行程。',
      '路上时间 — 两个地点之间按公共交通的实际用时预留。一天装不下就把那天重做。',
      '餐厅核对 — 推荐的餐厅会与我们维护的名单核对，已关门的店和不存在的名字不会进入行程。',
    ],
    coverageTitle: '覆盖范围',
    coverage: ({ cities, cityCount, diets }) => [
      `${cityCount} 个城市 — ${cities}。也支持多城市往返的行程。`,
      `饮食限制 — 选择 ${diets}，只有符合该条件的餐厅才会进入行程。`,
      '四种语言 — 英文、韩文、日文、中文。不只是界面，行程内容和 PDF 也用你选的语言输出。',
    ],
    processTitle: '制作流程',
    process: [
      '在 5 步表单中选择日期、城市、航班、饮食限制和行程节奏。到这一步无需注册。',
      '免费查看行程框架（预览）。是否是你想要的样子，在这里就能判断。',
      '购买完整行程。注册后 1～3 天的行程可用优惠券免费获得。',
      '拿到包含路线、地图和 PDF 的完整行程。',
    ],
    faqTitle: '常见问题',
    faq: ({ price, approxKrw, cityCount, diets }) => [
      ['付款前可以看到结果吗？', '可以。无需注册即可免费查看行程框架。注册后 1～3 天的完整行程免费。'],
      ['价格是多少？', `完整行程为 ${price}（${approxKrw}），一次性付款。不是订阅，没有每月扣费。显示金额即为付款金额，韩元仅供参考，可能因发卡行汇率而不同。`],
      ['可以退款吗？', 'AI 行程是付款后立即交付的数字商品，因此不支持退款。所以建议先用免费预览确认后再付款。包车和跟团预订适用另一套退款规定。'],
      ['行程里包含真实的交通指引吗？', '包含。两个地点之间坐几号线地铁或哪路公交、在哪里换乘、需要多少分钟，都会写进行程，最后的步行段还会画地图。'],
      ['能找清真或纯素餐厅吗？', `可以。从 ${diets} 中选择，只有符合该条件的餐厅才会进入行程。`],
      ['覆盖哪些城市？', `${cityCount} 个。支持多城市行程，城市之间的移动时间也会排进行程计算。`],
      ['不会韩语也能用吗？', '可以。提供英文、韩文、日文、中文，并且不只是界面，行程内容和 PDF 也用你选的语言输出。'],
    ],
  },
};

function pickLang(language: string | null | undefined): Lang {
  return language === 'ko' || language === 'ja' || language === 'zh' ? language : 'en';
}

export function PlannerSeoInfo({ language, t }: { language: string; t: Translations }) {
  const lang = pickLang(language);
  const c = COPY[lang];

  // 도시명은 위저드가 쓰는 바로 그 i18n 키에서 가져온다 (`WizardForm/index.tsx` getCityName 과 동일 규칙).
  // 여기에 도시 이름을 손으로 적으면 도시가 추가·삭제될 때 이 페이지만 옛 목록을 광고한다.
  const p = (t as unknown as { planner?: Record<string, string> }).planner || {};
  const cityNames = CITY_CHIPS.map(({ key }) =>
    p[`city_${key}`] || p[`city${key.charAt(0).toUpperCase()}${key.slice(1)}`] || key.charAt(0).toUpperCase() + key.slice(1),
  );

  // 'None'(제약 없음)은 선택지이지 대응 가능한 제약이 아니다 — 문장에 넣으면 항목 수가 부풀려진다.
  const dietKeys = DIETARY_RESTRICTION_KEYS.filter((k) => k !== 'None');
  const dietNames = dietKeys.map((k) => p[`dietaryRestriction${k}`] || k);

  const vars: Vars = {
    price: formatAiPlannerUsd(),
    approxKrw: formatAiPlannerApproxKrw(lang),
    cities: cityNames.join(' · '),
    cityCount: cityNames.length,
    diets: dietNames.join(' · '),
  };

  // FAQ 마크업은 **아래 렌더가 쓰는 바로 그 배열**에서 만든다. 문구를 따로 적어두면
  // 가격·환불 정책 개정 때 화면과 구글이 다른 말을 하게 된다 (CharterSeoInfo 와 같은 규칙).
  const faqEntries = c.faq(vars);
  useJsonLd('planner-faq', buildFaqJsonLd(faqEntries));

  return (
    <section className="planner-seo-info mt-12 border-t border-ec-line pt-8">
      <div className="ec-measure">
        <div>
          <h2 className="ec-h3 mb-3">{c.getTitle}</h2>
          <ul className="space-y-1.5 pl-4" style={{ listStyleType: 'disc' }}>
            {c.get.map((s) => <li key={s} className="ec-body">{s}</li>)}
          </ul>
        </div>

        <hr className="ec-rule my-8" />

        <div>
          <h2 className="ec-h3 mb-3">{c.keepTitle}</h2>
          <p className="ec-body mb-2">{c.keepIntro}</p>
          <ul className="space-y-1.5 pl-4" style={{ listStyleType: 'disc' }}>
            {c.keep.map((s) => <li key={s} className="ec-body">{s}</li>)}
          </ul>
        </div>

        <hr className="ec-rule my-8" />

        <div>
          <h2 className="ec-h3 mb-3">{c.coverageTitle}</h2>
          <ul className="space-y-1.5 pl-4" style={{ listStyleType: 'disc' }}>
            {c.coverage(vars).map((s) => <li key={s} className="ec-body">{s}</li>)}
          </ul>
        </div>

        <hr className="ec-rule my-8" />

        <div>
          <h2 className="ec-h3 mb-3">{c.processTitle}</h2>
          <ol className="space-y-1.5 pl-5" style={{ listStyleType: 'decimal' }}>
            {c.process.map((s) => <li key={s} className="ec-body">{s}</li>)}
          </ol>
        </div>

        <hr className="ec-rule my-8" />

        <div>
          <h2 className="ec-h3 mb-3">{c.faqTitle}</h2>
          <dl className="space-y-3">
            {faqEntries.map(([q, a]) => (
              <div key={q}>
                <dt className="font-semibold text-ec-ink">{q}</dt>
                <dd className="ec-body mt-0.5">{a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
