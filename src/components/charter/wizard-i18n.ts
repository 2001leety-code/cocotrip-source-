// CharterWizard i18n 어댑터 — 정적 텍스트는 src/i18n/locales/{ko,en,ja,zh}.json
// 의 charterWizard namespace 에 중앙화되어 있고, 이 파일은 함수형 포맷터(템플릿
// 치환·plural·toFixed 등)를 다시 입혀 기존 WizardI18n 인터페이스를 그대로 노출한다.
//
// 마이그레이션: PR (E2 / 2026-05-04) — 600줄 dict 를 i18n locale 로 이동.
// 기존 consumer( CharterWizard / Step1~6 / CharterNewPage / MyBookingsTab )는
// `getWizardI18n(language)` 호출만 유지하면 동일하게 동작한다.

import { translations, type Language } from '@/i18n';

export type WizardLang = Language;

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
  svcTransfer: string; svcTransferDesc: string;
  // transfer 편도/왕복 (Step5)
  tripTypeLabel: string; tripOneway: string; tripRoundtrip: string;

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
  flightLookup: string;
  flightLookupHint: string;
  flightLookupFail: string;
  flightLookupWindow: string;
  flightLookupError: string;
  flightArrivalLabel: string;
  luggage: string;
  luggageSmall: string; luggageMedium: string; luggageLarge: string;
  date: string; time: string; returnDate: string;
  customerName: string; customerNamePlaceholder: string;
  customerPhone: string; customerPhonePlaceholder: string;
  customerMessenger: string; customerMessengerPlaceholder: string;
  lodgingLabel: string; lodgingSeoul: string; lodgingLocal: string; lodgingDailyReturn: string; lodgingNote: string;
  addons: string;
  englishGuide: string;     // 레거시 — 사용 안 함, 호환을 위해 유지
  licensedGuide: string;
  picket: string; childSeat: string; notes: string;
  notesPlaceholder: string;
  nightWarn: (pct: number) => string;

  // Step 6 — 결제/별도
  payBlock: string; payVehicleLine: string; paySubtotal: string;
  // 영수증 표기 (PR-F 추가) — 4-lang. distance 는 km 치환.
  receiptTitle: string;
  receiptBaseFee: string;
  receiptDistance: (km: number) => string;
  receiptToll: string;
  receiptTotal: string;
  packageRowLabel: string;
  driverDispatchNote: string;
  separateBlock: string; estMeals: string; estAttractions: string;
  nightSurcharge: (pct: number) => string;
  roundTripDiscount: string;
  multiDayDiscount: (pct: number) => string;
  vatExcluded: (pct: number) => string;
  vatIncludedNote: string;
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
  payFieldName: string; payFieldPhone: string; payFieldNotes: string; payFieldTime: string;
  reviewEditHint: string; reviewSave: string; reviewCancel: string;
  payPrepayAmount: string;
  payCustomQuoteMsg: string;
  estimateOnlyNote: string;
  estimateConfirmMsg: string;
  // 2026-05-04 URGENT-1: 추정가도 결제 가능 — 약관 동의 + 결제 버튼
  estimatePayBtn: string;
  estimatePayDisclaimer: string;
  estimatePayAgreeLabel: string;
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
  /** 이미 지난 일정 라벨 — 카운트다운 대신 표시 (2026-07-28). */
  mbPastTour: string;
  mbDaysAway: (d: number) => string;
  mbRefundBadge: (pct: number) => string;
  mbRefundedAmount: string;  // "환불액"
  mbModifyBtn: string; mbCancelBtn: string; mbReviewBtn?: string;
  mbProcessing: string;
  // 2026-05-03: AI 플래너 같은 디지털 상품 라벨 — 환불 불가 명시
  mbDigitalNoRefund?: string;
  // 2026-05-03 P1: AI 플래너 booking → /my-plans 이동 + 환불 시간 지남 안내
  mbViewPlanBtn?: string;
  mbRefundWindowClosed?: string;
  // 2026-05-04 P0 fix: 예약 카드 클릭 → 상세 모달. 사용자 신고 ("들어가볼 수도 없음")
  mbDetailTitle?: string;
  /** 예약 목록 개수 옆 설명 — 원장 누적 예약 수와 다르다는 것을 알린다. */
  mbCountNote?: string;
  mbDetailBookingRef?: string;
  mbDetailService?: string;
  mbDetailDate?: string;
  mbDetailPickup?: string;
  mbDetailDropoff?: string;
  mbDetailVehicle?: string;
  mbDetailPax?: string;
  mbDetailAmount?: string;
  mbDetailEmail?: string;
  mbDetailFlight?: string;
  mbDetailTerminal?: string;
  mbDetailLuggage?: string;
  mbDetailRefundEligible?: string;
  mbDetailRefundClosed?: string;
  mbDetailViewTerms?: string;
  mbDetailClose?: string;
  mbDetailContact?: string;
  mbDetailCanceledNote?: string;
  mbDetailCompletedNote?: string;
  // 2026-05-04: BookingDetailModal voucher PDF 다운로드 버튼 (api/voucher.js)
  mbDetailDownloadVoucher?: string;
  mbCancelReasonPrompt: string;
  mbCancelConfirm: (pct: number, amountKRW: string) => string;
  // 2026-07-17: native confirm() → 인앱 취소 확인 모달 버튼 라벨
  mbCancelModalConfirm: string;
  mbCancelModalKeep: string;

  // ModifyModal
  modifyModalTitle: string;
  modifyFieldDate: string; modifyFieldPax: string; modifyFieldPickup: string;
  modifyFieldReason: string;
  modifyUndefined: string;
  modifyNoChanges: string;
  modifySaveBtn: string; modifyCancelBtn: string; modifySaving: string;
  modifyNetworkError: string;

  // PR-R (2026-05-08): 예약 마감 정책 + 픽업 시각 입력
  // 2026-07-28: 마감이 상품군별로 갈려(전세차량 1h / 투어 8h) 문구가 시간을 인자로 받는다.
  bookingPickupTimeLabel: string;
  bookingCutoffNote: (hours: number) => string;    // Step5 안내문 (always-on)
  bookingCutoffImminent: (hours: number) => string;// 마감 임박 — amber 배너
  bookingClosedTitle: string;
  bookingClosedMessage: (hours: number) => string;
  bookingChatCta: string;
  /** 배차 실패 시 자동취소 고지 (운영자 2026-07-28) — 결제 전 항상 노출. */
  dispatchFailAutoCancelNote: string;
}

/** {key} 형태 placeholder 를 vars 로 치환. 누락된 키는 그대로 둔다. */
function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{([^}]+)\}/g, (_, key) => {
    return key in vars ? String(vars[key]) : '{' + key + '}';
  });
}

function asLang(language: string): WizardLang {
  if (language === 'ko' || language === 'en' || language === 'ja' || language === 'zh') {
    return language;
  }
  return 'en';
}

export function getWizardI18n(language: string): WizardI18n {
  const lang = asLang(language);
  // 중앙 번역 객체에서 charterWizard namespace 를 가져온다. 1306 한국어 fallback.
  const t = (translations[lang] as unknown as { charterWizard: Record<string, string> }).charterWizard;
  const koFallback = (translations.ko as unknown as { charterWizard: Record<string, string> }).charterWizard;
  const get = (k: string): string => (t && t[k]) ?? koFallback[k] ?? '';

  return {
    // 정적 키 — get(key) 로 그대로 노출
    step1: get('step1'), step2: get('step2'), step3: get('step3'),
    step4: get('step4'), step5: get('step5'), step6: get('step6'),
    stepOf: get('stepOf'),
    next: get('next'), prev: get('prev'),
    payProceed: get('payProceed'), edit: get('edit'),

    svcAirport: get('svcAirport'), svcAirportDesc: get('svcAirportDesc'),
    svcDayTour: get('svcDayTour'), svcDayTourDesc: get('svcDayTourDesc'),
    svcMultiDay: get('svcMultiDay'), svcMultiDayDesc: get('svcMultiDayDesc'),
    svcKpop: get('svcKpop'), svcKpopDesc: get('svcKpopDesc'),
    svcTransfer: get('svcTransfer') || (lang === 'ko' ? '도시간 이동' : lang === 'ja' ? '都市間移動' : lang === 'zh' ? '城际接送' : 'Intercity Transfer'),
    svcTransferDesc: get('svcTransferDesc') || (lang === 'ko' ? '편도·왕복 1회 이동 (숙박 없음)' : lang === 'ja' ? '片道・往復の1回移動（宿泊なし）' : lang === 'zh' ? '单程/往返一次接送（无住宿）' : 'One-way or round-trip ride (no overnight)'),
    tripTypeLabel: get('tripTypeLabel') || (lang === 'ko' ? '이동 방식' : lang === 'ja' ? '移動タイプ' : lang === 'zh' ? '行程类型' : 'Trip type'),
    tripOneway: get('tripOneway') || (lang === 'ko' ? '편도' : lang === 'ja' ? '片道' : lang === 'zh' ? '单程' : 'One-way'),
    tripRoundtrip: get('tripRoundtrip') || (lang === 'ko' ? '왕복' : lang === 'ja' ? '往復' : lang === 'zh' ? '往返' : 'Round-trip'),

    destCustomLabel: get('destCustomLabel'),
    destCustomPlaceholder: get('destCustomPlaceholder'),
    destCustomMatched: (m) => fmt(get('destCustomMatched'), { m }),
    destCustomUnmatched: get('destCustomUnmatched'),
    selectOriginFirst: get('selectOriginFirst'),
    minutesUnit: get('minutesUnit'),

    paxLabel: get('paxLabel'),
    adultLabel: get('adultLabel'),
    childLabel: get('childLabel'),
    totalPaxNote: (pax, cap) => fmt(get('totalPaxNote'), { pax, cap }),
    vehicleLabel: get('vehicleLabel'),
    recommendedTag: get('recommendedTag'),
    maxUnit: get('maxUnit'),
    groupLabel: get('groupLabel'),
    maxCapacityNote: (v, n) => fmt(get('maxCapacityNote'), { v, n }),
    legalGuideWarn: get('legalGuideWarn'),

    airportDetails: get('airportDetails'),
    terminal: get('terminal'),
    flightNo: get('flightNo'),
    flightPlaceholder: get('flightPlaceholder'),
    flightLookup: get('flightLookup') || (lang === 'ko' ? '도착정보 조회' : lang === 'ja' ? '到着情報照会' : lang === 'zh' ? '查询到达信息' : 'Look up arrival'),
    flightLookupHint: get('flightLookupHint') || (lang === 'ko' ? '편명을 넣고 누르면 도착시간·터미널이 자동 입력돼요' : lang === 'ja' ? '便名を入力して押すと到着時刻・ターミナルが自動入力されます' : lang === 'zh' ? '输入航班号后点击，自动填入到达时间和航站楼' : 'Enter your flight number to auto-fill arrival time & terminal'),
    flightLookupFail: get('flightLookupFail') || (lang === 'ko' ? '해당 편명을 찾을 수 없어요. 직접 입력해 주세요.' : lang === 'ja' ? '該当する便名が見つかりません。手動で入力してください。' : lang === 'zh' ? '未找到该航班号，请手动输入。' : 'Flight not found — please enter details manually.'),
    // 🔧 2026-07-18: 공공API 조회창(도착 6일 전~) 밖 — 편명 오류가 아님을 정직 안내.
    flightLookupWindow: get('flightLookupWindow') || (lang === 'ko' ? '도착 6일 전부터 자동조회가 가능해요. 예정 도착시간만 직접 입력해 주세요.' : lang === 'ja' ? '到着6日前から自動照会が可能です。到着予定時刻を直接ご入力ください。' : lang === 'zh' ? '抵达前6天起可自动查询。请先手动填写预计到达时间。' : 'Auto-lookup opens 6 days before arrival — please enter the arrival time manually for now.'),
    // 🔧 2026-07-18: 키미설정·공공API 장애·쿼터초과 — 사용자 입력 탓이 아닌 서비스 오류 구분.
    flightLookupError: get('flightLookupError') || (lang === 'ko' ? '조회 서비스가 일시적으로 원활하지 않아요. 잠시 후 다시 시도하거나 직접 입력해 주세요.' : lang === 'ja' ? '照会サービスが一時的に不安定です。しばらくして再試行するか、直接ご入力ください。' : lang === 'zh' ? '查询服务暂时不可用。请稍后重试或手动输入。' : 'Lookup service is temporarily unavailable — try again later or enter details manually.'),
    flightArrivalLabel: get('flightArrivalLabel') || (lang === 'ko' ? '도착' : lang === 'ja' ? '到着' : lang === 'zh' ? '到达' : 'Arrival'),
    luggage: get('luggage'),
    luggageSmall: get('luggageSmall'),
    luggageMedium: get('luggageMedium'),
    luggageLarge: get('luggageLarge'),
    date: get('date'), time: get('time'), returnDate: get('returnDate'),
    customerName: get('customerName'), customerNamePlaceholder: get('customerNamePlaceholder'),
    customerPhone: get('customerPhone'), customerPhonePlaceholder: get('customerPhonePlaceholder'),
    customerMessenger: get('customerMessenger'), customerMessengerPlaceholder: get('customerMessengerPlaceholder'),
    lodgingLabel: get('lodgingLabel'),
    lodgingSeoul: get('lodgingSeoul'),
    lodgingLocal: get('lodgingLocal'),
    lodgingDailyReturn: get('lodgingDailyReturn'),
    lodgingNote: get('lodgingNote'),
    addons: get('addons'),
    englishGuide: get('englishGuide'),
    licensedGuide: get('licensedGuide'),
    picket: get('picket'),
    childSeat: get('childSeat'),
    notes: get('notes'),
    notesPlaceholder: get('notesPlaceholder'),
    nightWarn: (pct) => fmt(get('nightWarn'), { pct }),

    payBlock: get('payBlock'),
    payVehicleLine: get('payVehicleLine'),
    paySubtotal: get('paySubtotal'),
    receiptTitle: get('receiptTitle'),
    receiptBaseFee: get('receiptBaseFee'),
    receiptDistance: (km) => fmt(get('receiptDistance'), { km }),
    receiptToll: get('receiptToll'),
    receiptTotal: get('receiptTotal'),
    packageRowLabel: get('packageRowLabel'),
    driverDispatchNote: get('driverDispatchNote'),
    separateBlock: get('separateBlock'),
    estMeals: get('estMeals'),
    estAttractions: get('estAttractions'),
    nightSurcharge: (pct) => fmt(get('nightSurcharge'), { pct }),
    roundTripDiscount: get('roundTripDiscount'),
    multiDayDiscount: (pct) => fmt(get('multiDayDiscount'), { pct }),
    vatExcluded: (pct) => fmt(get('vatExcluded'), { pct }),
    vatIncludedNote: get('vatIncludedNote') || (lang === 'ko' ? '부가세 포함' : lang === 'ja' ? '税込' : lang === 'zh' ? '含税' : 'VAT included'),
    customQuoteTitle: get('customQuoteTitle'),
    customQuoteBody: get('customQuoteBody'),
    customQuoteSub: get('customQuoteSub'),
    onewayLabel: get('onewayLabel'),
    incompletePrev: get('incompletePrev'),

    otherOrigins: get('otherOrigins'),
    customAddress: get('customAddress'),
    customAddressPlaceholder: get('customAddressPlaceholder'),

    payPanelHeading: get('payPanelHeading'),
    payPanelSubtitle: get('payPanelSubtitle'),
    payBadge: get('payBadge'),
    payField_service: get('payField_service'),
    payField_origin: get('payField_origin'),
    payField_destination: get('payField_destination'),
    payField_vehiclePax: get('payField_vehiclePax'),
    payField_date: get('payField_date'),
    payField_terminal: get('payField_terminal'),
    payField_flight: get('payField_flight'),
    // 2026-06-11 검수 인라인 편집 — locale JSON 무수정, 인라인 4-lang fallback (svcTransfer 패턴).
    payFieldName: get('payFieldName') || (lang === 'ko' ? '이름' : lang === 'ja' ? 'お名前' : lang === 'zh' ? '姓名' : 'Name'),
    payFieldPhone: get('payFieldPhone') || (lang === 'ko' ? '연락처' : lang === 'ja' ? '連絡先' : lang === 'zh' ? '联系电话' : 'Phone'),
    payFieldNotes: get('payFieldNotes') || (lang === 'ko' ? '요청사항' : lang === 'ja' ? 'ご要望' : lang === 'zh' ? '备注' : 'Notes'),
    payFieldTime: get('payFieldTime') || (lang === 'ko' ? '픽업 시각' : lang === 'ja' ? 'ピックアップ時刻' : lang === 'zh' ? '上车时间' : 'Pickup time'),
    reviewEditHint: get('reviewEditHint') || (lang === 'ko' ? '✏️ 정보를 확인하고, 잘못된 항목은 눌러서 수정하세요.' : lang === 'ja' ? '✏️ 内容をご確認のうえ、誤りがあれば項目をタップして修正してください。' : lang === 'zh' ? '✏️ 请确认信息，如有错误请点击项目修改。' : '✏️ Review your details — tap any item to fix a mistake.'),
    reviewSave: get('reviewSave') || (lang === 'ko' ? '저장' : lang === 'ja' ? '保存' : lang === 'zh' ? '保存' : 'Save'),
    reviewCancel: get('reviewCancel') || (lang === 'ko' ? '취소' : lang === 'ja' ? 'キャンセル' : lang === 'zh' ? '取消' : 'Cancel'),
    payPrepayAmount: get('payPrepayAmount'),
    payCustomQuoteMsg: get('payCustomQuoteMsg'),
    estimateOnlyNote: get('estimateOnlyNote'),
    estimateConfirmMsg: get('estimateConfirmMsg'),
    estimatePayBtn: get('estimatePayBtn'),
    estimatePayDisclaimer: get('estimatePayDisclaimer'),
    estimatePayAgreeLabel: get('estimatePayAgreeLabel'),
    payWhatsappBtn: get('payWhatsappBtn'),
    payWhatsappAlt: get('payWhatsappAlt'),
    payGoToLegacy: get('payGoToLegacy'),

    heroBadgeNew: get('heroBadgeNew'),
    heroBadgePayment: get('heroBadgePayment'),
    heroTitleWizard: get('heroTitleWizard'),
    heroTitlePayment: get('heroTitlePayment'),
    heroSubtitleWizard: get('heroSubtitleWizard'),
    heroSubtitlePayment: get('heroSubtitlePayment'),

    mbHeader: get('mbHeader'),
    mbEmpty: get('mbEmpty'),
    mbEmptySub: get('mbEmptySub'),
    statusConfirmed: get('statusConfirmed'),
    statusModified: get('statusModified'),
    statusCanceled: get('statusCanceled'),
    statusCompleted: get('statusCompleted'),
    // mbHoursAway: 모든 lang 동일하게 .toFixed(1)
    mbHoursAway: (h) => fmt(get('mbHoursAway'), { h: h.toFixed(1) }),
    mbPastTour: get('mbPastTour'),
    // mbDaysAway: en 만 plural ({d} day{plural}) — 다른 lang 은 {plural} 키 자체가 없어 무영향.
    mbDaysAway: (d) => fmt(get('mbDaysAway'), { d, plural: lang === 'en' ? (d === 1 ? '' : 's') : '' }),
    mbRefundBadge: (pct) => fmt(get('mbRefundBadge'), { pct }),
    mbRefundedAmount: get('mbRefundedAmount'),
    mbModifyBtn: get('mbModifyBtn'),
    mbCancelBtn: get('mbCancelBtn'),
    mbReviewBtn: get('mbReviewBtn'),
    mbProcessing: get('mbProcessing'),
    mbDigitalNoRefund: get('mbDigitalNoRefund'),
    mbViewPlanBtn: get('mbViewPlanBtn'),
    mbRefundWindowClosed: get('mbRefundWindowClosed'),
    mbDetailTitle: get('mbDetailTitle'),
    mbCountNote: get('mbCountNote'),
    mbDetailBookingRef: get('mbDetailBookingRef'),
    mbDetailService: get('mbDetailService'),
    mbDetailDate: get('mbDetailDate'),
    mbDetailPickup: get('mbDetailPickup'),
    mbDetailDropoff: get('mbDetailDropoff'),
    mbDetailVehicle: get('mbDetailVehicle'),
    mbDetailPax: get('mbDetailPax'),
    mbDetailAmount: get('mbDetailAmount'),
    mbDetailEmail: get('mbDetailEmail'),
    mbDetailFlight: get('mbDetailFlight'),
    mbDetailTerminal: get('mbDetailTerminal'),
    mbDetailLuggage: get('mbDetailLuggage'),
    mbDetailRefundEligible: get('mbDetailRefundEligible'),
    mbDetailRefundClosed: get('mbDetailRefundClosed'),
    mbDetailViewTerms: get('mbDetailViewTerms'),
    mbDetailClose: get('mbDetailClose'),
    mbDetailContact: get('mbDetailContact'),
    mbDetailCanceledNote: get('mbDetailCanceledNote'),
    mbDetailCompletedNote: get('mbDetailCompletedNote'),
    mbDetailDownloadVoucher: get('mbDetailDownloadVoucher'),
    mbCancelReasonPrompt: get('mbCancelReasonPrompt'),
    mbCancelConfirm: (pct, amt) => fmt(get('mbCancelConfirm'), { pct, amt }),
    mbCancelModalConfirm: get('mbCancelModalConfirm'),
    mbCancelModalKeep: get('mbCancelModalKeep'),

    modifyModalTitle: get('modifyModalTitle'),
    modifyFieldDate: get('modifyFieldDate'),
    modifyFieldPax: get('modifyFieldPax'),
    modifyFieldPickup: get('modifyFieldPickup'),
    modifyFieldReason: get('modifyFieldReason'),
    modifyUndefined: get('modifyUndefined'),
    modifyNoChanges: get('modifyNoChanges'),
    modifySaveBtn: get('modifySaveBtn'),
    modifyCancelBtn: get('modifyCancelBtn'),
    modifySaving: get('modifySaving'),
    modifyNetworkError: get('modifyNetworkError'),

    // PR-R (2026-05-08): 예약 마감 정책 (24h/48h)
    bookingPickupTimeLabel: get('bookingPickupTimeLabel'),
    bookingCutoffNote: (hours) => fmt(get('bookingCutoffNote'), { N: hours }),
    bookingCutoffImminent: (hours) => fmt(get('bookingCutoffImminent'), { N: hours }),
    bookingClosedTitle: get('bookingClosedTitle'),
    bookingClosedMessage: (hours) => fmt(get('bookingClosedMessage'), { N: hours }),
    bookingChatCta: get('bookingChatCta'),
    dispatchFailAutoCancelNote: get('dispatchFailAutoCancelNote'),
  };
}
