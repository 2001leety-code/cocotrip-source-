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
    luggage: get('luggage'),
    luggageSmall: get('luggageSmall'),
    luggageMedium: get('luggageMedium'),
    luggageLarge: get('luggageLarge'),
    date: get('date'), time: get('time'), returnDate: get('returnDate'),
    customerName: get('customerName'), customerNamePlaceholder: get('customerNamePlaceholder'),
    customerPhone: get('customerPhone'), customerPhonePlaceholder: get('customerPhonePlaceholder'),
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
    separateBlock: get('separateBlock'),
    estMeals: get('estMeals'),
    estAttractions: get('estAttractions'),
    nightSurcharge: (pct) => fmt(get('nightSurcharge'), { pct }),
    roundTripDiscount: get('roundTripDiscount'),
    multiDayDiscount: (pct) => fmt(get('multiDayDiscount'), { pct }),
    vatExcluded: (pct) => fmt(get('vatExcluded'), { pct }),
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
    mbCancelReasonPrompt: get('mbCancelReasonPrompt'),
    mbCancelConfirm: (pct, amt) => fmt(get('mbCancelConfirm'), { pct, amt }),

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
  };
}
