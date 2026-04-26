// CharterWizard i18n 사전 — ko/en/ja/zh 4개 언어
// 모든 위저드 Step + 결제 패널 + MyBookings 탭에서 공용.

export type WizardLang = 'ko' | 'en' | 'ja' | 'zh';

export interface WizardI18n {
  // Step 제목
  step1: string; step2: string; step3: string; step4: string; step5: string; step6: string;
  stepOf: string;

  // 내비게이션
  next: string; prev: string; payProceed: string; edit: string;

  // Step 2 — 서비스 유형
  svcAirport: string;  svcAirportDesc: string;
  svcDayTour: string;  svcDayTourDesc: string;
  svcMultiDay: string; svcMultiDayDesc: string;
  svcKpop: string;     svcKpopDesc: string;

  // Step 3 — 목적지
  destCustomLabel: string;
  destCustomPlaceholder: string;
  destCustomMatched: (matched: string) => string;
  destCustomUnmatched: string;
  selectOriginFirst: string;
  minutesUnit: string;     // "분" / "min" / "分" / "分钟"

  // Step 4 — 인원·차종
  paxLabel: string;
  adultLabel: string;
  childLabel: string;
  totalPaxNote: (pax: number, cap: number) => string;
  vehicleLabel: string;
  recommendedTag: string;
  maxUnit: string;         // "인" / "pax" / "名" / "人"
  groupLabel: string;
  maxCapacityNote: (vehicle: string, n: number | string) => string;
  legalGuideWarn: string;

  // Step 5 — 공항·날짜·옵션
  airportDetails: string;
  terminal: string;
  flightNo: string;
  flightPlaceholder: string;
  luggage: string;
  luggageSmall: string; luggageMedium: string; luggageLarge: string;
  date: string; time: string; returnDate: string;
  customerName: string; customerNamePlaceholder: string;
  customerPhone: string; customerPhonePlaceholder: string;
  lodgingLabel: string; lodgingSeoul: string; lodgingLocal: string; lodgingDailyReturn: string; lodgingNote: string;
  addons: string;
  englishGuide: string;     // 레거시 — 사용 안 함, 호환을 위해 유지
  licensedGuide: string;
  picket: string; childSeat: string; notes: string;
  notesPlaceholder: string;
  nightWarn: (pct: number) => string;

  // Step 6 — 결제/별도
  payBlock: string; payVehicleLine: string; paySubtotal: string;
  separateBlock: string; estMeals: string; estAttractions: string;
  nightSurcharge: (pct: number) => string;
  roundTripDiscount: string;
  multiDayDiscount: (pct: number) => string;
  vatExcluded: (pct: number) => string;
  customQuoteTitle: string;
  customQuoteBody: string;
  customQuoteSub: string;
  onewayLabel: string;
  incompletePrev: string;

  // Step 1 — 출발지
  otherOrigins: string; customAddress: string; customAddressPlaceholder: string;

  // PaymentPanel (CharterNewPage)
  payPanelHeading: string; payPanelSubtitle: string;
  payBadge: string;
  payField_service: string; payField_origin: string; payField_destination: string;
  payField_vehiclePax: string; payField_date: string;
  payField_terminal: string; payField_flight: string;
  payPrepayAmount: string;
  payCustomQuoteMsg: string;
  payWhatsappBtn: string; payWhatsappAlt: string;
  payGoToLegacy: string;

  // CharterNewPage hero
  heroBadgeNew: string; heroBadgePayment: string;
  heroTitleWizard: string; heroTitlePayment: string;
  heroSubtitleWizard: string; heroSubtitlePayment: string;

  // MyBookingsTab
  mbHeader: string;
  mbEmpty: string; mbEmptySub: string;
  statusConfirmed: string; statusModified: string; statusCanceled: string; statusCompleted: string;
  mbHoursAway: (h: number) => string;
  mbDaysAway: (d: number) => string;
  mbRefundBadge: (pct: number) => string;
  mbRefundedAmount: string;  // "환불액"
  mbModifyBtn: string; mbCancelBtn: string;
  mbProcessing: string;
  mbCancelReasonPrompt: string;
  mbCancelConfirm: (pct: number, amountKRW: string) => string;

  // ModifyModal
  modifyModalTitle: string;
  modifyFieldDate: string; modifyFieldPax: string; modifyFieldPickup: string;
  modifyFieldReason: string;
  modifyUndefined: string;
  modifyNoChanges: string;
  modifySaveBtn: string; modifyCancelBtn: string; modifySaving: string;
  modifyNetworkError: string;
}

const base: Record<WizardLang, WizardI18n> = {
  ko: {
    step1: '출발지', step2: '서비스 유형', step3: '목적지', step4: '인원·차종', step5: '날짜·옵션', step6: '최종 견적',
    stepOf: '단계', next: '다음', prev: '이전', payProceed: '결제 진행', edit: '견적 수정',
    svcAirport: '공항 픽업/샌딩', svcAirportDesc: '편도 이동 · 식대·입장료 해당 없음',
    svcDayTour: '당일 투어', svcDayTourDesc: '8~10시간 왕복',
    svcMultiDay: '1박 이상 장거리', svcMultiDayDesc: '숙박형 장거리',
    svcKpop: 'K-pop 콘서트 셔틀', svcKpopDesc: '공연장 왕복 + 기사 대기',
    destCustomLabel: '기타 목적지 직접 입력', destCustomPlaceholder: '예: 단양, 안동, 여수',
    destCustomMatched: (m) => `매트릭스 매칭: ${m} — 견적 산출됩니다`,
    destCustomUnmatched: '매트릭스에 없는 지역 — WhatsApp으로 별도 견적 요청',
    selectOriginFirst: '출발지·서비스 유형을 먼저 선택해주세요.',
    minutesUnit: '분',
    paxLabel: '인원수',
    adultLabel: '어른',
    childLabel: '아이',
    totalPaxNote: (pax, cap) => `합계 ${pax}인 / 차량 최대 ${cap}인`,
    vehicleLabel: '차종', recommendedTag: '추천', maxUnit: '인', groupLabel: '단체',
    maxCapacityNote: (v, n) => `${v} 최대 ${n}인`,
    legalGuideWarn: '10인승 이상 차량은 한국 법상 면허 가이드 동행 필수. 가이드비 ₩300,000/일 자동 추가.',
    airportDetails: '✈ 공항 상세 (필수)', terminal: '터미널', flightNo: '편명', flightPlaceholder: 'KE085 / OZ213',
    luggage: '수하물 (개수)', luggageSmall: '소형 (기내)', luggageMedium: '중형 24"', luggageLarge: '대형 28"+',
    date: '날짜', time: '시간', returnDate: '돌아오는 날',
    customerName: '이름', customerNamePlaceholder: '홍길동',
    customerPhone: '연락처', customerPhonePlaceholder: '010-1234-5678',
    lodgingLabel: '숙소 위치 (운영 안내용)',
    lodgingSeoul: '서울 숙박', lodgingLocal: '현지 숙박', lodgingDailyReturn: '매일 서울 귀가',
    lodgingNote: '숙소 위치는 기사 동선 안내용 — 현재 가격은 동일',
    addons: '추가 옵션', englishGuide: '영어 가이드', licensedGuide: '면허 가이드 (영/일/중)',
    picket: '픽켓', childSeat: '카시트', notes: '요청사항 (선택)',
    notesPlaceholder: '예: 항공편 번호, 특이사항',
    nightWarn: (pct) => `야간 시간대 — ${pct}% 할증 자동 적용`,
    payBlock: '선결제 (PayPal)',
    payVehicleLine: '차량비 (톨·주차·팁 포함)',
    paySubtotal: '선결제 소계',
    separateBlock: '별도 (현장 또는 고객 부담)',
    estMeals: '예상 식대', estAttractions: '예상 입장료',
    nightSurcharge: (pct) => `야간 할증 (${pct}%)`,
    roundTripDiscount: '왕복 할인',
    multiDayDiscount: (pct) => `1박 이상 할인 (-${pct}%)`,
    vatExcluded: (pct) => `VAT ${pct}% 별도`,
    customQuoteTitle: '맞춤 견적이 필요해요',
    customQuoteBody: '입력하신 목적지는 매트릭스에 없어 자동 견적 불가. WhatsApp으로 영업일 1일 내 답변 드립니다.',
    customQuoteSub: '결제 패널의 WhatsApp 버튼으로 진행',
    onewayLabel: '편도 거리',
    incompletePrev: '이전 단계 정보가 부족합니다.',
    otherOrigins: '다른 출발지 보기', customAddress: '기타 주소 직접 입력',
    customAddressPlaceholder: '예: 서울 강남구 테헤란로 123',
    payPanelHeading: '결제 진행', payPanelSubtitle: '아래 선결제 또는 WhatsApp 문의로 진행하세요.',
    payBadge: '결제',
    payField_service: '서비스', payField_origin: '출발지', payField_destination: '목적지',
    payField_vehiclePax: '차종/인원', payField_date: '날짜', payField_terminal: '터미널', payField_flight: '편명',
    payPrepayAmount: '선결제 금액',
    payCustomQuoteMsg: '이 조합은 맞춤 견적이 필요합니다.',
    payWhatsappBtn: 'WhatsApp 견적 요청', payWhatsappAlt: '또는 WhatsApp 문의',
    payGoToLegacy: '기존 차터 페이지로 가기',
    heroBadgeNew: '신규 6단계 견적', heroBadgePayment: '결제',
    heroTitleWizard: '코코트립 전세차량 (위저드)', heroTitlePayment: '결제 진행',
    heroSubtitleWizard: '공항 픽업 · 일일 투어 · 장거리 · K-pop 셔틀 — 2분 견적',
    heroSubtitlePayment: '아래 선결제 또는 WhatsApp 문의로 진행하세요.',
    mbHeader: '내 예약', mbEmpty: '아직 예약이 없습니다',
    mbEmptySub: '전세차량 또는 투어를 예약하면 여기에 표시됩니다.',
    statusConfirmed: '확정', statusModified: '변경됨', statusCanceled: '취소', statusCompleted: '완료',
    mbHoursAway: (h) => `${h.toFixed(1)}h 후`,
    mbDaysAway: (d) => `${d}일 후`,
    mbRefundBadge: (pct) => `· 환불 ${pct}%`,
    mbRefundedAmount: '환불액',
    mbModifyBtn: '변경', mbCancelBtn: '취소', mbProcessing: '처리중...',
    mbCancelReasonPrompt: '취소 사유 (선택):',
    mbCancelConfirm: (pct, amt) => `예약을 취소하시겠어요?\n환불 ${pct}% · 약 ₩${amt}\nPayPal로 3~5영업일 내 환불됩니다.`,
    modifyModalTitle: '예약 변경',
    modifyFieldDate: '투어 날짜', modifyFieldPax: '인원', modifyFieldPickup: '픽업 장소',
    modifyFieldReason: '변경 사유 (선택)',
    modifyUndefined: '미정',
    modifyNoChanges: '변경된 필드가 없습니다.',
    modifySaveBtn: '변경 저장', modifyCancelBtn: '취소', modifySaving: '저장 중...',
    modifyNetworkError: '네트워크 오류',
  },
  en: {
    step1: 'Origin', step2: 'Service', step3: 'Destination', step4: 'Pax · Vehicle', step5: 'Date · Options', step6: 'Final Quote',
    stepOf: 'Step', next: 'Next', prev: 'Back', payProceed: 'Proceed to Pay', edit: 'Edit quote',
    svcAirport: 'Airport Transfer', svcAirportDesc: 'One-way · no meals or attractions',
    svcDayTour: 'Day Tour', svcDayTourDesc: '8-10 hours round trip',
    svcMultiDay: 'Multi-Day Tour', svcMultiDayDesc: 'Overnight long-haul',
    svcKpop: 'K-pop Shuttle', svcKpopDesc: 'Venue round-trip + standby',
    destCustomLabel: 'Custom destination', destCustomPlaceholder: 'e.g. Danyang, Andong, Yeosu',
    destCustomMatched: (m) => `Matrix matched: ${m} — quote available`,
    destCustomUnmatched: 'Not in our route matrix — request via WhatsApp',
    selectOriginFirst: 'Please select origin and service first.',
    minutesUnit: 'min',
    paxLabel: 'Pax',
    adultLabel: 'Adult',
    childLabel: 'Child',
    totalPaxNote: (pax, cap) => `Total ${pax} pax / vehicle cap ${cap}`,
    vehicleLabel: 'Vehicle', recommendedTag: 'recommended', maxUnit: 'pax', groupLabel: 'Group',
    maxCapacityNote: (v, n) => `${v} max ${n}`,
    legalGuideWarn: 'Korean law requires a licensed guide for vehicles over 10 passengers. ₩300,000/day auto-added.',
    airportDetails: '✈ Airport details (required)', terminal: 'Terminal', flightNo: 'Flight No.', flightPlaceholder: 'KE085 / OZ213',
    luggage: 'Luggage (count)', luggageSmall: 'S (carry-on)', luggageMedium: 'M 24"', luggageLarge: 'L 28"+',
    date: 'Date', time: 'Time', returnDate: 'Return date',
    customerName: 'Name', customerNamePlaceholder: 'Your full name',
    customerPhone: 'Phone', customerPhonePlaceholder: '+82 10-1234-5678',
    lodgingLabel: 'Lodging location (operational)',
    lodgingSeoul: 'Seoul stay', lodgingLocal: 'Local stay', lodgingDailyReturn: 'Daily return to Seoul',
    lodgingNote: 'Lodging location informs driver routing — price is currently the same',
    addons: 'Add-ons', englishGuide: 'English guide', licensedGuide: 'Licensed guide (EN/JA/ZH)',
    picket: 'Picket', childSeat: 'Child seat', notes: 'Notes (optional)',
    notesPlaceholder: 'e.g. flight number, special requests',
    nightWarn: (pct) => `Night-time — ${pct}% surcharge`,
    payBlock: 'Pre-pay (PayPal)',
    payVehicleLine: 'Vehicle (tolls·parking·tip incl.)',
    paySubtotal: 'Pre-pay subtotal',
    separateBlock: 'Separate (on-site or customer)',
    estMeals: 'Estimated meals', estAttractions: 'Estimated attractions',
    nightSurcharge: (pct) => `Night surcharge (${pct}%)`,
    roundTripDiscount: 'Round-trip discount',
    multiDayDiscount: (pct) => `Overnight discount (-${pct}%)`,
    vatExcluded: (pct) => `VAT ${pct}% excluded`,
    customQuoteTitle: 'Custom quote needed',
    customQuoteBody: 'Your destination is not in our pre-priced matrix. We\'ll respond within 1 business day via WhatsApp.',
    customQuoteSub: 'Use the WhatsApp button on the payment panel',
    onewayLabel: 'one-way',
    incompletePrev: 'Previous steps incomplete.',
    otherOrigins: 'Other origins', customAddress: 'Custom pickup address',
    customAddressPlaceholder: 'e.g. Lotte Hotel Seoul',
    payPanelHeading: 'Proceed to Payment', payPanelSubtitle: 'Pay below or request a custom quote via WhatsApp.',
    payBadge: 'Payment',
    payField_service: 'Service', payField_origin: 'Origin', payField_destination: 'Destination',
    payField_vehiclePax: 'Vehicle / Pax', payField_date: 'Date', payField_terminal: 'Terminal', payField_flight: 'Flight',
    payPrepayAmount: 'Pre-pay amount',
    payCustomQuoteMsg: 'This combination needs a custom quote.',
    payWhatsappBtn: 'Request via WhatsApp', payWhatsappAlt: 'Or inquire via WhatsApp',
    payGoToLegacy: 'Go to legacy charter page',
    heroBadgeNew: 'New 6-Step Quote', heroBadgePayment: 'Payment',
    heroTitleWizard: 'CocoTrip Charter (Wizard)', heroTitlePayment: 'Proceed to Payment',
    heroSubtitleWizard: 'Airport transfer · Day tour · Multi-day · K-pop shuttle — 2-min quote',
    heroSubtitlePayment: 'Pay below or request a custom quote via WhatsApp.',
    mbHeader: 'My Bookings', mbEmpty: 'No bookings yet',
    mbEmptySub: 'Book a charter or tour to see it here.',
    statusConfirmed: 'Confirmed', statusModified: 'Modified', statusCanceled: 'Canceled', statusCompleted: 'Completed',
    mbHoursAway: (h) => `in ${h.toFixed(1)}h`,
    mbDaysAway: (d) => `in ${d} day${d === 1 ? '' : 's'}`,
    mbRefundBadge: (pct) => `· Refund ${pct}%`,
    mbRefundedAmount: 'Refunded',
    mbModifyBtn: 'Modify', mbCancelBtn: 'Cancel', mbProcessing: 'Processing...',
    mbCancelReasonPrompt: 'Cancellation reason (optional):',
    mbCancelConfirm: (pct, amt) => `Cancel this booking?\nRefund ${pct}% · approx ₩${amt}\nRefund via PayPal in 3-5 business days.`,
    modifyModalTitle: 'Modify Booking',
    modifyFieldDate: 'Tour Date', modifyFieldPax: 'Pax', modifyFieldPickup: 'Pickup location',
    modifyFieldReason: 'Reason (optional)',
    modifyUndefined: 'Undecided',
    modifyNoChanges: 'No fields changed.',
    modifySaveBtn: 'Save Changes', modifyCancelBtn: 'Cancel', modifySaving: 'Saving...',
    modifyNetworkError: 'Network error',
  },
  ja: {
    step1: '出発地', step2: 'サービス', step3: '目的地', step4: '人数·車種', step5: '日付·オプション', step6: '最終見積',
    stepOf: 'ステップ', next: '次へ', prev: '戻る', payProceed: '決済へ進む', edit: '見積修正',
    svcAirport: '空港送迎', svcAirportDesc: '片道移動 · 食事·入場料なし',
    svcDayTour: '日帰りツアー', svcDayTourDesc: '8〜10時間の往復',
    svcMultiDay: '1泊以上のツアー', svcMultiDayDesc: '宿泊型長距離',
    svcKpop: 'K-popコンサートシャトル', svcKpopDesc: '会場往復 + ドライバー待機',
    destCustomLabel: '目的地を直接入力', destCustomPlaceholder: '例: 丹陽、安東、麗水',
    destCustomMatched: (m) => `マトリックス一致: ${m} — 見積可能`,
    destCustomUnmatched: 'マトリックス未登録 — WhatsAppで別途お見積もり',
    selectOriginFirst: '出発地とサービスを先に選択してください。',
    minutesUnit: '分',
    paxLabel: '人数',
    adultLabel: '大人',
    childLabel: '子供',
    totalPaxNote: (pax, cap) => `合計${pax}名 / 車両定員${cap}名`,
    vehicleLabel: '車種', recommendedTag: 'おすすめ', maxUnit: '名', groupLabel: '団体',
    maxCapacityNote: (v, n) => `${v} 最大${n}名`,
    legalGuideWarn: '10人乗り以上の車両は韓国の法律でガイド同行必須。ガイド料 ₩300,000/日が自動追加されます。',
    airportDetails: '✈ 空港詳細（必須）', terminal: 'ターミナル', flightNo: '便名', flightPlaceholder: 'KE085 / OZ213',
    luggage: '手荷物（個数）', luggageSmall: 'S（機内持込）', luggageMedium: 'M 24インチ', luggageLarge: 'L 28インチ+',
    date: '日付', time: '時間', returnDate: '戻る日',
    customerName: 'お名前', customerNamePlaceholder: '山田太郎',
    customerPhone: '連絡先', customerPhonePlaceholder: '+81 90-1234-5678',
    lodgingLabel: '宿泊地（運用情報）',
    lodgingSeoul: 'ソウル泊', lodgingLocal: '現地泊', lodgingDailyReturn: '毎日ソウルへ帰る',
    lodgingNote: '宿泊地はドライバー動線案内用 — 現在価格は同一',
    addons: '追加オプション', englishGuide: '英語ガイド', licensedGuide: '公認ガイド (英/日/中)',
    picket: 'ピケット', childSeat: 'チャイルドシート', notes: 'ご要望（任意）',
    notesPlaceholder: '例: フライト番号、特記事項',
    nightWarn: (pct) => `夜間時間帯 — ${pct}%割増`,
    payBlock: '事前決済（PayPal）',
    payVehicleLine: '車両料金（料金所·駐車場·チップ込み）',
    paySubtotal: '事前決済小計',
    separateBlock: '別途（現地またはお客様負担）',
    estMeals: '食事目安', estAttractions: '入場料目安',
    nightSurcharge: (pct) => `夜間割増（${pct}%）`,
    roundTripDiscount: '往復割引',
    multiDayDiscount: (pct) => `1泊以上割引 (-${pct}%)`,
    vatExcluded: (pct) => `VAT ${pct}%別途`,
    customQuoteTitle: 'カスタム見積もりが必要です',
    customQuoteBody: 'ご入力の目的地はマトリックスに無いため自動見積不可。WhatsAppで1営業日以内にご返答します。',
    customQuoteSub: '決済パネルのWhatsAppボタンから依頼',
    onewayLabel: '片道',
    incompletePrev: '前のステップが未完了です。',
    otherOrigins: '他の出発地', customAddress: '住所を直接入力',
    customAddressPlaceholder: '例: ソウル江南区テヘラン路123',
    payPanelHeading: '決済へ進む', payPanelSubtitle: '事前決済またはWhatsAppでのお見積もり依頼にお進みください。',
    payBadge: '決済',
    payField_service: 'サービス', payField_origin: '出発地', payField_destination: '目的地',
    payField_vehiclePax: '車種/人数', payField_date: '日付', payField_terminal: 'ターミナル', payField_flight: '便名',
    payPrepayAmount: '事前決済金額',
    payCustomQuoteMsg: 'この組み合わせはカスタム見積もりが必要です。',
    payWhatsappBtn: 'WhatsAppで見積依頼', payWhatsappAlt: 'またはWhatsAppで問い合わせ',
    payGoToLegacy: '従来のチャーターページへ',
    heroBadgeNew: '新6ステップ見積', heroBadgePayment: '決済',
    heroTitleWizard: 'CocoTrip チャーター（ウィザード）', heroTitlePayment: '決済へ進む',
    heroSubtitleWizard: '空港送迎 · 日帰り · 長距離 · K-popシャトル — 2分で見積',
    heroSubtitlePayment: '事前決済またはWhatsAppでのお見積もり依頼にお進みください。',
    mbHeader: 'マイ予約', mbEmpty: 'まだ予約がありません',
    mbEmptySub: 'チャーターやツアーを予約するとここに表示されます。',
    statusConfirmed: '確定', statusModified: '変更済', statusCanceled: 'キャンセル', statusCompleted: '完了',
    mbHoursAway: (h) => `あと${h.toFixed(1)}h`,
    mbDaysAway: (d) => `あと${d}日`,
    mbRefundBadge: (pct) => `· 返金 ${pct}%`,
    mbRefundedAmount: '返金額',
    mbModifyBtn: '変更', mbCancelBtn: 'キャンセル', mbProcessing: '処理中...',
    mbCancelReasonPrompt: 'キャンセル理由（任意）:',
    mbCancelConfirm: (pct, amt) => `この予約をキャンセルしますか？\n返金 ${pct}% · 約 ₩${amt}\nPayPalで3〜5営業日以内に返金されます。`,
    modifyModalTitle: '予約変更',
    modifyFieldDate: 'ツアー日', modifyFieldPax: '人数', modifyFieldPickup: 'ピックアップ場所',
    modifyFieldReason: '理由（任意）',
    modifyUndefined: '未定',
    modifyNoChanges: '変更されたフィールドがありません。',
    modifySaveBtn: '変更を保存', modifyCancelBtn: 'キャンセル', modifySaving: '保存中...',
    modifyNetworkError: 'ネットワークエラー',
  },
  zh: {
    step1: '出发地', step2: '服务类型', step3: '目的地', step4: '人数·车型', step5: '日期·选项', step6: '最终报价',
    stepOf: '步骤', next: '下一步', prev: '上一步', payProceed: '前往支付', edit: '修改报价',
    svcAirport: '机场接送', svcAirportDesc: '单程 · 不含餐食·门票',
    svcDayTour: '当日游', svcDayTourDesc: '8-10小时往返',
    svcMultiDay: '过夜长途游', svcMultiDayDesc: '过夜长途',
    svcKpop: 'K-pop演唱会班车', svcKpopDesc: '会场往返 + 司机待命',
    destCustomLabel: '直接输入目的地', destCustomPlaceholder: '例: 丹阳、安东、丽水',
    destCustomMatched: (m) => `匹配成功: ${m} — 可生成报价`,
    destCustomUnmatched: '未在路线矩阵中 — 请通过WhatsApp另行询价',
    selectOriginFirst: '请先选择出发地和服务类型。',
    minutesUnit: '分钟',
    paxLabel: '人数',
    adultLabel: '成人',
    childLabel: '儿童',
    totalPaxNote: (pax, cap) => `合计${pax}人 / 车辆最多${cap}人`,
    vehicleLabel: '车型', recommendedTag: '推荐', maxUnit: '人', groupLabel: '团体',
    maxCapacityNote: (v, n) => `${v} 最多${n}人`,
    legalGuideWarn: '韩国法律规定10座以上车辆必须配备持证导游。每日 ₩300,000 自动添加。',
    airportDetails: '✈ 机场详情（必填）', terminal: '航站楼', flightNo: '航班号', flightPlaceholder: 'KE085 / OZ213',
    luggage: '行李（件数）', luggageSmall: 'S（登机箱）', luggageMedium: 'M 24寸', luggageLarge: 'L 28寸+',
    date: '日期', time: '时间', returnDate: '返程日期',
    customerName: '姓名', customerNamePlaceholder: '张三',
    customerPhone: '联系电话', customerPhonePlaceholder: '+86 138-1234-5678',
    lodgingLabel: '住宿地点（运营信息）',
    lodgingSeoul: '首尔住宿', lodgingLocal: '当地住宿', lodgingDailyReturn: '每日返回首尔',
    lodgingNote: '住宿地点用于司机路线规划 — 当前价格相同',
    addons: '附加选项', englishGuide: '英文导游', licensedGuide: '持证导游 (英/日/中)',
    picket: '接机牌', childSeat: '儿童座椅', notes: '要求（选填）',
    notesPlaceholder: '例: 航班号、特殊要求',
    nightWarn: (pct) => `夜间时段 — ${pct}%加收`,
    payBlock: '预付（PayPal）',
    payVehicleLine: '车辆费（含过路费·停车·司机小费）',
    paySubtotal: '预付小计',
    separateBlock: '另付（现场或客户承担）',
    estMeals: '预估餐费', estAttractions: '预估门票',
    nightSurcharge: (pct) => `夜间加收 (${pct}%)`,
    roundTripDiscount: '往返优惠',
    multiDayDiscount: (pct) => `过夜优惠 (-${pct}%)`,
    vatExcluded: (pct) => `VAT ${pct}%另付`,
    customQuoteTitle: '需要定制报价',
    customQuoteBody: '您输入的目的地不在我们的预定价矩阵中。我们将在1个工作日内通过WhatsApp回复。',
    customQuoteSub: '请使用支付面板的WhatsApp按钮',
    onewayLabel: '单程',
    incompletePrev: '上一步信息不完整。',
    otherOrigins: '其他出发地', customAddress: '直接输入地址',
    customAddressPlaceholder: '例: 首尔江南区德黑兰路123',
    payPanelHeading: '前往支付', payPanelSubtitle: '请通过预付或WhatsApp咨询继续。',
    payBadge: '支付',
    payField_service: '服务', payField_origin: '出发地', payField_destination: '目的地',
    payField_vehiclePax: '车型/人数', payField_date: '日期', payField_terminal: '航站楼', payField_flight: '航班号',
    payPrepayAmount: '预付金额',
    payCustomQuoteMsg: '此组合需要定制报价。',
    payWhatsappBtn: '通过WhatsApp询价', payWhatsappAlt: '或通过WhatsApp咨询',
    payGoToLegacy: '前往原包车页面',
    heroBadgeNew: '全新6步报价', heroBadgePayment: '支付',
    heroTitleWizard: 'CocoTrip 包车（向导）', heroTitlePayment: '前往支付',
    heroSubtitleWizard: '机场接送 · 当日游 · 长途 · K-pop班车 — 2分钟报价',
    heroSubtitlePayment: '请通过预付或WhatsApp咨询继续。',
    mbHeader: '我的预订', mbEmpty: '暂无预订',
    mbEmptySub: '预订包车或旅游后会在此显示。',
    statusConfirmed: '已确认', statusModified: '已修改', statusCanceled: '已取消', statusCompleted: '已完成',
    mbHoursAway: (h) => `${h.toFixed(1)}小时后`,
    mbDaysAway: (d) => `${d}天后`,
    mbRefundBadge: (pct) => `· 退款 ${pct}%`,
    mbRefundedAmount: '退款额',
    mbModifyBtn: '修改', mbCancelBtn: '取消', mbProcessing: '处理中...',
    mbCancelReasonPrompt: '取消原因（选填）:',
    mbCancelConfirm: (pct, amt) => `确定取消此预订？\n退款 ${pct}% · 约 ₩${amt}\n将在3-5个工作日内通过PayPal退款。`,
    modifyModalTitle: '修改预订',
    modifyFieldDate: '游玩日期', modifyFieldPax: '人数', modifyFieldPickup: '接送地点',
    modifyFieldReason: '原因（选填）',
    modifyUndefined: '未定',
    modifyNoChanges: '没有更改的字段。',
    modifySaveBtn: '保存更改', modifyCancelBtn: '取消', modifySaving: '保存中...',
    modifyNetworkError: '网络错误',
  },
};

export function getWizardI18n(language: string): WizardI18n {
  if (language === 'ko' || language === 'en' || language === 'ja' || language === 'zh') {
    return base[language];
  }
  return base.en;
}
