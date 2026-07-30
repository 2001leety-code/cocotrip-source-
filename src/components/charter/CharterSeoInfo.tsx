/**
 * /charter 공개 정보 섹션 (2026-07-30).
 *
 * 왜 만드는가: `/charter` 는 공개 라우트인데도 sitemap·프리렌더에서 빠져 있었고(낡은
 * "로그인벽" 전제), 무JS 크롤러가 받는 HTML 이 홈과 바이트 단위로 같았다. 즉 자체 마진이
 * 가장 큰 상품이 검색엔진에 **고유 콘텐츠 0** 이었다. 위저드는 상호작용이라 크롤러가 볼 수
 * 없으므로, 사람이 실제로 궁금해하는 정보를 정적 본문으로 둔다.
 *
 * 원칙
 *   - 숨은 문구·키워드 나열 금지. 여기 있는 문장은 전부 화면에 보이고 사람이 읽는 내용이다.
 *   - 숫자는 가격 SSOT(`data/charterPricing` → `pricing_spec.json`)와 정책 상수에서 **파생**한다.
 *     문서에 손으로 적어 두면 가격 개정 때 이 페이지만 거짓말이 된다.
 *   - 사업자·관광사업 등록번호는 i18n footer 값을 그대로 재사용(2벌 관리 금지).
 */
import type { Translations } from '@/i18n';
import {
  AIRPORT_TRANSFER_PRICES,
  VEHICLE_TYPES,
  EXTRA_CHARGES,
  CHARTER_USD_FIX_RATE,
} from '@/data/charterPricing';
import { CHARTER_VEHICLE_CUTOFF_HOURS, TOUR_CUTOFF_HOURS } from '@/lib/bookingCutoff';
import { formatPrice } from '@/lib/exchange-rate';

type Lang = 'ko' | 'en' | 'ja' | 'zh';

const COPY: Record<Lang, {
  servicesTitle: string; services: string[];
  pricingTitle: string; pricing: (v: { icnSeoulPrice: string | null; nightPct: number; usdRate: number }) => string[];
  vehiclesTitle: string; vehiclesNote: string; paxLabel: (n: number) => string; paxCustom: string;
  processTitle: string; process: string[];
  faqTitle: string; faq: (v: { charterCutoff: number; tourCutoff: number; nightPct: number }) => Array<[string, string]>;
  trustTitle: string; trust: string[];
}> = {
  ko: {
    servicesTitle: '차량 대절 서비스 종류',
    services: [
      '공항 픽업·샌딩 — 인천·김포·부산·제주 공항과 숙소 사이 편도 이동. 도착 로비에서 기사가 대기합니다.',
      '당일 전세 투어 — 8~10시간 동안 차량과 기사를 하루 단위로 씁니다. 일정은 손님이 정합니다.',
      '1박 이상 장거리 — 여러 도시를 이동하는 일정. 숙박은 손님이 직접 예약합니다.',
      'K-pop 콘서트 셔틀 — 공연장 왕복. 공연이 끝날 때까지 기사가 대기합니다.',
    ],
    pricingTitle: '가격은 어떻게 정해지나',
    pricing: ({ icnSeoulPrice, nightPct, usdRate }) => [
      icnSeoulPrice
        ? `공항 이동은 구간별 정액입니다. 인천공항 ↔ 서울 도심(명동·홍대·종로·용산)은 편도 ${icnSeoulPrice} 입니다.`
        : '공항 이동은 공항·도착 지역 구간별 정액입니다.',
      '투어·도시간 이동은 실제 이동 거리(km)와 소요 시간으로 계산합니다. 지도에 경유지를 넣으면 그 경로로 다시 계산됩니다.',
      '차량 등급에 따라 금액이 달라집니다. 인원이 늘면 더 큰 차량이 필요합니다.',
      `18:00~05:59 사이 픽업은 야간 ${nightPct}% 할증이 붙습니다.`,
      '유류비·통행료·주차비는 요금에 포함입니다. 식사·입장료·음료·쇼핑은 포함되지 않습니다.',
      `표시 금액은 원화 기준이며, 달러 표시는 1 USD = ${usdRate}원 고정 환율로 환산합니다. 표시 금액과 결제 금액이 같습니다.`,
    ],
    vehiclesTitle: '차량',
    vehiclesNote: '전 차량 기사 포함입니다. 손님이 직접 운전하는 렌터카가 아닙니다.',
    paxLabel: (n) => `최대 ${n}명`,
    paxCustom: '대형 단체, 인원에 맞춰 개별 견적',
    processTitle: '예약 과정',
    process: [
      '6단계 견적 화면에서 서비스 종류·날짜·인원·차량·경로를 고릅니다. 로그인 없이 견적까지 볼 수 있습니다.',
      '견적을 확인하고 옵션(카시트·공항 픽켓·가이드)을 고릅니다. 옵션 금액도 견적에 바로 반영됩니다.',
      'PayPal 로 결제합니다(카드 결제 포함).',
      '결제 후 확인 메일이 발송되고, 배차가 확정되면 기사 정보를 안내합니다.',
    ],
    faqTitle: '자주 묻는 질문',
    faq: ({ charterCutoff, tourCutoff, nightPct }) => [
      ['취소하면 환불되나요?', '이용 24시간 이상 전에 취소하면 100% 환불입니다. 24시간 미만 취소와 노쇼는 환불이 없습니다.'],
      ['언제까지 예약할 수 있나요?', `전세 차량은 이용 ${charterCutoff}시간 전, 투어는 ${tourCutoff}시간 전까지 예약할 수 있습니다. 그 이후에는 화면에서 예약이 닫힙니다.`],
      ['요금에 무엇이 포함되나요?', '유류비·통행료·주차비가 포함됩니다. 식사·입장료·음료·쇼핑 비용은 손님 부담입니다.'],
      ['야간에도 이용할 수 있나요?', `가능합니다. 18:00~05:59 픽업은 ${nightPct}% 할증이 적용됩니다.`],
      ['인원이 9명보다 많으면요?', '스프린터(최대 15명) 또는 버스를 선택하면 됩니다. 스프린터·버스는 법에 따라 자격을 갖춘 가이드가 함께 탑승합니다.'],
      ['카시트를 요청할 수 있나요?', '예약 옵션에서 카시트를 추가할 수 있습니다. 금액은 견적에 함께 표시됩니다.'],
    ],
    trustTitle: '사업자 정보',
    trust: [
      '결제는 PayPal 이 처리하며 카드 정보는 코코트립 서버에 저장되지 않습니다.',
      '가격은 결제 전 화면에 전액 표시됩니다. 결제 후 추가 청구는 하지 않습니다.',
    ],
  },
  en: {
    servicesTitle: 'Private charter services',
    services: [
      'Airport transfer — one-way between Incheon, Gimpo, Busan or Jeju airport and your accommodation. Your driver waits in the arrivals hall.',
      'Full-day charter tour — car and driver for 8-10 hours. You decide the itinerary.',
      'Multi-day intercity — routes across several cities. You book your own lodging.',
      'K-pop concert shuttle — round trip to the venue. The driver waits until the show ends.',
    ],
    pricingTitle: 'How pricing works',
    pricing: ({ icnSeoulPrice, nightPct, usdRate }) => [
      icnSeoulPrice
        ? `Airport transfers are flat rates per zone. Incheon Airport to central Seoul (Myeongdong, Hongdae, Jongno) is ${icnSeoulPrice} one way.`
        : 'Airport transfers are flat rates set per airport and destination zone.',
      'Tours and intercity trips are priced from the real driving distance (km) and duration. Add waypoints on the map and the quote is recalculated along that route.',
      'The vehicle class changes the price. Larger groups need a larger vehicle.',
      `Pickups between 18:00 and 05:59 carry a ${nightPct}% night surcharge.`,
      'Fuel, tolls and parking are included. Meals, admission tickets, drinks and shopping are not.',
      `Prices are set in Korean won; USD figures use a fixed rate of 1 USD = ${usdRate} KRW, so the price you see is the price you pay.`,
    ],
    vehiclesTitle: 'Vehicles',
    vehiclesNote: 'Every vehicle comes with a driver. This is not a self-drive rental.',
    paxLabel: (n) => `up to ${n} passengers`,
    paxCustom: 'large groups, quoted individually by party size',
    processTitle: 'How booking works',
    process: [
      'Pick service type, date, party size, vehicle and route in the 6-step quote. No account is needed to see the price.',
      'Review the quote and choose options (child seat, airport meet-and-greet, licensed guide). Option prices are added to the same quote.',
      'Pay with PayPal (cards accepted).',
      'You receive a confirmation email, and driver details once the vehicle is assigned.',
    ],
    faqTitle: 'Frequently asked questions',
    faq: ({ charterCutoff, tourCutoff, nightPct }) => [
      ['Can I cancel and get a refund?', 'Cancel 24 hours or more before your service for a 100% refund. Cancellations inside 24 hours and no-shows are not refunded.'],
      ['How late can I book?', `Charter vehicles can be booked up to ${charterCutoff} hour(s) before pickup, tours up to ${tourCutoff} hours before. After that the booking closes on screen.`],
      ['What is included in the price?', 'Fuel, tolls and parking. Meals, admission tickets, drinks and shopping are paid by you.'],
      ['Do you drive at night?', `Yes. Pickups between 18:00 and 05:59 add a ${nightPct}% surcharge.`],
      ['What if we are more than 9 people?', 'Choose the Sprinter (up to 15) or a bus. Korean law requires a licensed guide on board for those vehicles, and that is included in the quote.'],
      ['Can I request a child seat?', 'Yes, add it in the booking options. The fee is shown in the quote.'],
    ],
    trustTitle: 'Company details',
    trust: [
      'Payments are processed by PayPal. Card details are never stored on CocoTrip servers.',
      'The full price is shown before payment. We do not add charges afterwards.',
    ],
  },
  ja: {
    servicesTitle: '専用車チャーターの種類',
    services: [
      '空港送迎 — 仁川・金浦・釜山・済州の空港と宿泊先の片道送迎。到着ロビーでドライバーがお待ちします。',
      '一日チャーターツアー — 8〜10時間、車とドライバーを貸し切ります。行程はお客様が決めます。',
      '1泊以上の長距離 — 複数都市を移動する行程。宿泊はお客様ご自身の予約です。',
      'K-POPコンサートシャトル — 会場往復。公演終了までドライバーが待機します。',
    ],
    pricingTitle: '料金の決まり方',
    pricing: ({ icnSeoulPrice, nightPct, usdRate }) => [
      icnSeoulPrice
        ? `空港送迎はゾーンごとの定額です。仁川空港↔ソウル都心（明洞・弘大・鍾路・龍山）は片道 ${icnSeoulPrice} です。`
        : '空港送迎は空港と到着ゾーンごとの定額です。',
      'ツアー・都市間移動は実際の走行距離(km)と所要時間で計算します。地図に経由地を追加すると、その経路で再計算されます。',
      '車両クラスによって料金が変わります。人数が増えるほど大きな車両が必要です。',
      `18:00〜05:59のピックアップには夜間 ${nightPct}% の割増が付きます。`,
      '燃料費・高速料金・駐車料金は含まれます。食事・入場料・飲み物・買い物は含まれません。',
      `表示はウォン基準で、ドル表示は 1 USD = ${usdRate} ウォンの固定レートで換算します。表示額と決済額は同じです。`,
    ],
    vehiclesTitle: '車両',
    vehiclesNote: 'すべてドライバー付きです。お客様が運転するレンタカーではありません。',
    paxLabel: (n) => `最大 ${n} 名`,
    paxCustom: '大型団体、人数に応じて個別見積',
    processTitle: '予約の流れ',
    process: [
      '6ステップの見積画面でサービス・日付・人数・車両・経路を選びます。ログインなしで料金が見られます。',
      '見積を確認し、オプション（チャイルドシート・空港ピケット・ガイド）を選びます。オプション料金も同じ見積に反映されます。',
      'PayPal で決済します（カード決済可）。',
      '決済後に確認メールが届き、配車が確定するとドライバー情報をご案内します。',
    ],
    faqTitle: 'よくある質問',
    faq: ({ charterCutoff, tourCutoff, nightPct }) => [
      ['キャンセルは返金されますか？', 'ご利用の24時間以上前のキャンセルは全額返金です。24時間未満のキャンセルと無連絡不参加は返金されません。'],
      ['いつまで予約できますか？', `チャーター車両は利用の${charterCutoff}時間前、ツアーは${tourCutoff}時間前まで予約できます。それ以降は画面上で受付を終了します。`],
      ['料金に含まれるものは？', '燃料費・高速料金・駐車料金です。食事・入場料・飲み物・買い物はお客様負担です。'],
      ['夜間も利用できますか？', `可能です。18:00〜05:59のピックアップは ${nightPct}% の割増です。`],
      ['9名を超える場合は？', 'スプリンター（最大15名）またはバスをお選びください。法令によりこれらの車両には資格を持つガイドが同乗し、見積に含まれます。'],
      ['チャイルドシートは頼めますか？', '予約オプションで追加できます。料金は見積に表示されます。'],
    ],
    trustTitle: '事業者情報',
    trust: [
      '決済は PayPal が処理し、カード情報は CocoTrip のサーバーに保存されません。',
      '決済前に総額を表示します。決済後の追加請求はありません。',
    ],
  },
  zh: {
    servicesTitle: '包车服务类型',
    services: [
      '机场接送 — 仁川、金浦、釜山、济州机场与住处之间的单程接送。司机在到达大厅等候。',
      '当日包车游 — 8至10小时包用车辆与司机，行程由您决定。',
      '多日长途 — 跨城市行程。住宿由您自行预订。',
      'K-pop 演唱会接送 — 场馆往返，司机等到演出结束。',
    ],
    pricingTitle: '价格如何计算',
    pricing: ({ icnSeoulPrice, nightPct, usdRate }) => [
      icnSeoulPrice
        ? `机场接送按区域定额收费。仁川机场↔首尔市中心（明洞・弘大・钟路・龙山）单程为 ${icnSeoulPrice}。`
        : '机场接送按机场与目的地区域分别定额收费。',
      '包车游与城际用车按实际行驶距离(km)和用时计算。在地图上加入途经点后，会按该路线重新计算。',
      '车型不同价格不同。人数越多需要越大的车。',
      `18:00至05:59的接送加收 ${nightPct}% 夜间附加费。`,
      '油费、过路费、停车费已含。餐费、门票、饮料与购物不含。',
      `价格以韩元计，美元金额按 1 USD = ${usdRate} 韩元的固定汇率换算，所见价格即所付价格。`,
    ],
    vehiclesTitle: '车辆',
    vehiclesNote: '所有车辆均含司机，不是自驾租车。',
    paxLabel: (n) => `最多 ${n} 人`,
    paxCustom: '大型团体，按人数单独报价',
    processTitle: '预订流程',
    process: [
      '在6步报价页选择服务类型、日期、人数、车型与路线。无需登录即可看到价格。',
      '确认报价并选择附加项（儿童座椅、机场举牌、持证导游），附加费用同样计入该报价。',
      '使用 PayPal 付款（支持信用卡）。',
      '付款后会收到确认邮件；派车确定后我们会告知司机信息。',
    ],
    faqTitle: '常见问题',
    faq: ({ charterCutoff, tourCutoff, nightPct }) => [
      ['取消可以退款吗？', '用车前24小时以上取消可全额退款。24小时内取消及未到场不予退款。'],
      ['最晚什么时候可以预订？', `包车最晚可在用车前${charterCutoff}小时预订，旅游行程最晚前${tourCutoff}小时。之后页面会关闭预订。`],
      ['价格包含什么？', '包含油费、过路费与停车费。餐费、门票、饮料和购物由您自付。'],
      ['夜间可以用车吗？', `可以。18:00至05:59的接送加收 ${nightPct}% 附加费。`],
      ['超过9人怎么办？', '可选择斯宾特（最多15人）或大巴。依韩国法规，这些车辆需持证导游随车，费用已含在报价中。'],
      ['可以要求儿童座椅吗？', '可以，在预订附加项中添加，费用会显示在报价中。'],
    ],
    trustTitle: '企业信息',
    trust: [
      '付款由 PayPal 处理，卡片信息不会存放在 CocoTrip 的服务器。',
      '付款前显示全额价格，付款后不会追加收费。',
    ],
  },
};

function pickLang(language: string | null | undefined): Lang {
  return language === 'ko' || language === 'ja' || language === 'zh' ? language : 'en';
}

export function CharterSeoInfo({ language, t }: { language: string; t: Translations }) {
  const lang = pickLang(language);
  const c = COPY[lang];

  // 예시 가격은 가격 SSOT 에서 파생 — 하드코딩하면 가격 개정 때 이 페이지만 거짓이 된다.
  // ⚠️ "전 구간 최저가" 를 쓰면 안 된다. 최저가는 김포 출발 구간(seoul-central 보다 저렴)이라
  //   "인천 ↔ 서울" 문장에 붙이면 실제로 청구되는 값과 다른 금액을 광고하게 된다(실물 렌더에서 발견).
  //   그래서 문장이 말하는 그 구간(ICN → 서울 도심)의 값만 쓰고, 키가 없으면 문장을 뺀다.
  const icnSeoulKRW = AIRPORT_TRANSFER_PRICES['seoul-central']?.priceKRW;
  const icnSeoulPrice = icnSeoulKRW && icnSeoulKRW > 0 ? formatPrice(icnSeoulKRW, lang) : null;
  const nightPct = EXTRA_CHARGES.nightSurchargePercent || 20;

  const vehicles = Object.values(VEHICLE_TYPES).map((v) => ({
    name: (v.name as Record<string, string>)[lang] || (v.name as Record<string, string>).en,
    // max_pax 999 = "정원 상한 없음(개별 견적)" 센티널. 그대로 찍으면 "최대 999명" 이 된다.
    paxText: v.maxPassengers >= 100 ? c.paxCustom : c.paxLabel(v.maxPassengers),
    description: (v.description as Record<string, string>)[lang] || (v.description as Record<string, string>).en,
  }));

  const footer = (t as unknown as { footer?: Record<string, string> }).footer;

  return (
    <section className="charter-seo-info mt-12 border-t border-white/10 pt-8 text-white/75">
      <div className="space-y-8 text-[13px] leading-relaxed sm:text-sm">
        <div>
          <h2 className="mb-3 text-base font-bold text-white sm:text-lg">{c.servicesTitle}</h2>
          <ul className="space-y-1.5 pl-4" style={{ listStyleType: 'disc' }}>
            {c.services.map((s) => <li key={s}>{s}</li>)}
          </ul>
        </div>

        <div>
          <h2 className="mb-3 text-base font-bold text-white sm:text-lg">{c.pricingTitle}</h2>
          <ul className="space-y-1.5 pl-4" style={{ listStyleType: 'disc' }}>
            {c.pricing({ icnSeoulPrice, nightPct, usdRate: CHARTER_USD_FIX_RATE }).map((s) => <li key={s}>{s}</li>)}
          </ul>
        </div>

        <div>
          <h2 className="mb-3 text-base font-bold text-white sm:text-lg">{c.vehiclesTitle}</h2>
          <p className="mb-2">{c.vehiclesNote}</p>
          <ul className="space-y-1.5 pl-4" style={{ listStyleType: 'disc' }}>
            {vehicles.map((v) => (
              <li key={v.name}>
                <strong className="text-white/90">{v.name}</strong> — {v.paxText}
                {v.description ? ` · ${v.description}` : ''}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="mb-3 text-base font-bold text-white sm:text-lg">{c.processTitle}</h2>
          <ol className="space-y-1.5 pl-5" style={{ listStyleType: 'decimal' }}>
            {c.process.map((s) => <li key={s}>{s}</li>)}
          </ol>
        </div>

        <div>
          <h2 className="mb-3 text-base font-bold text-white sm:text-lg">{c.faqTitle}</h2>
          <dl className="space-y-3">
            {c.faq({
              charterCutoff: CHARTER_VEHICLE_CUTOFF_HOURS,
              tourCutoff: TOUR_CUTOFF_HOURS,
              nightPct,
            }).map(([q, a]) => (
              <div key={q}>
                <dt className="font-semibold text-white/90">{q}</dt>
                <dd className="mt-0.5">{a}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div>
          <h2 className="mb-3 text-base font-bold text-white sm:text-lg">{c.trustTitle}</h2>
          <ul className="space-y-1.5 pl-4" style={{ listStyleType: 'disc' }}>
            {c.trust.map((s) => <li key={s}>{s}</li>)}
            {/* 등록번호는 footer i18n 값 재사용 — 두 벌로 관리하면 갱신 때 한쪽만 바뀐다. */}
            {footer?.businessNo ? <li>{footer.businessNo}</li> : null}
            {footer?.tourNo ? <li>{footer.tourNo}</li> : null}
          </ul>
        </div>
      </div>
    </section>
  );
}
