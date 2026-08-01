// CharterWizard — 6단계 스테퍼.
// 2026-05-07 정책 B: matrix miss → Geocoding 우선. Bus/VIP 차량은 가격 카드 대신 InquiryForm.
// 2026-05-10 (B9-35 잔여): wizard 진행 자동 저장 + 24h 이내 재진입 시 ResumeWizardModal.
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { ChevronLeft, ChevronRight, Clock3, CreditCard, Loader2, MapPin, ShieldCheck, Sparkles } from 'lucide-react';
import { CocoStepper } from '@/components/coco/CocoUI';
import { useQuoteCalculator } from '@/hooks/useQuoteCalculator';
import { useCharterRouteKm } from '@/lib/charterRouteKm';
import { useIsMobile } from '@/hooks/use-mobile';
import { formatPrice } from '@/lib/exchange-rate';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useProfileContactSync } from '@/hooks/useProfileContactSync';
import { useAuth } from '@/hooks/useAuth';
import { signInWithGoogle } from '@/lib/firebase';
import { mergeProfileDefaults, normalizeProfilePhone } from '@/lib/profilePrefill';
import { useCharterFunnelTracking } from './useCharterFunnelTracking';
import { INITIAL_WIZARD_STATE } from './types';
import type { WizardState } from './types';
import { Step1Origin } from './Step1Origin';
import { Step2Service } from './Step2Service';
import { Step3Destination } from './Step3Destination';
import { Step4PaxVehicle } from './Step4PaxVehicle';
import { Step5DateOptions } from './Step5DateOptions';
import { Step6Quote } from './Step6Quote';
import { InquiryForm } from './InquiryForm';
import { getWizardI18n } from './wizard-i18n';
import { isValidInternationalPhone } from '@/lib/phone-validation';
import { resolveProductType } from './resolveProductType';
import { isPastCutoff } from '@/lib/bookingCutoff';
import {
  loadWizardSnapshot,
  useWizardPersistence,
  clearWizardSnapshot,
} from '@/hooks/useWizardPersistence';
import { ResumeWizardModal } from '@/components/ResumeWizardModal';
import { VEHICLE_TYPES } from '@/data/charterPricing';
import { charterUsdFromKrw } from '@/lib/charterUsd';
// 🔴 2026-07-30: 헤더 칩이 "12시간 전 마감" 이라고 적혀 있었다. 실제 정책은 전세차량 1시간·
//   투어 8시간(api/_shared/booking-cutoff.js = lib/bookingCutoff)이라 화면만 거짓이었다.
//   숫자는 정책 상수에서 파생한다 — 하드코딩 재발은 booking-cutoff-parity 테스트가 막는다.
import { CHARTER_VEHICLE_CUTOFF_HOURS, getCutoffHours } from '@/lib/bookingCutoff';

// localStorage 에 저장하는 charter wizard snapshot — state + manualKm + step.
// state object 만 저장하면 manualKm (Geocoding fail 후 사용자 직접 km 입력) 가
// 복원 안 됨 → 6단계 도중 새로고침 시 거리 다시 입력해야. 둘 다 묶어 저장.
type CharterSnapshotValues = { state: WizardState; manualKm: number | null };

type CharterWizardProps = {
  initialState?: Partial<WizardState>;
  // 2026-06-30 트립닷컴식 예약정보 (SMS 인증 제거 운영자): consent 는 WizardState(스냅샷 저장)에
  //   안 넣고 — 매 결제마다 재동의 — onComplete 두 번째 인자로 결제 패널에 전달. 미전달=하위호환.
  onComplete?: (state: WizardState, consent?: { termsAgreed: boolean; marketingConsent: boolean }) => void;
  language?: 'ko' | 'en' | 'ja' | 'zh';
};

// distanceSource 라벨 — 사용자에게 거리 출처 투명하게 노출.
function distanceSourceLabel(source: 'matrix' | 'geocoding' | 'manual' | null, lang: string): string {
  if (source === 'matrix') {
    return lang === 'ko' ? '매트릭스 직접' : lang === 'ja' ? 'マトリクス' : lang === 'zh' ? '矩阵查询' : 'Matrix lookup';
  }
  if (source === 'geocoding') {
    return lang === 'ko' ? '지도 추정' : lang === 'ja' ? '地図推定' : lang === 'zh' ? '地图估算' : 'Map estimate';
  }
  if (source === 'manual') {
    return lang === 'ko' ? '직접 입력' : lang === 'ja' ? '直接入力' : lang === 'zh' ? '手动输入' : 'Manual';
  }
  return '';
}

function geocodingFailedLabel(lang: string): string {
  if (lang === 'ko') return '자동 거리 계산 실패. km 직접 입력해주세요.';
  if (lang === 'ja') return '自動距離計算失敗。kmを直接入力してください。';
  if (lang === 'zh') return '自动距离计算失败。请手动输入公里数。';
  return 'Auto distance failed. Please enter km manually.';
}

function manualKmLabel(lang: string): string {
  if (lang === 'ko') return '거리 직접 입력 (km)';
  if (lang === 'ja') return '距離直接入力 (km)';
  if (lang === 'zh') return '手动输入距离 (km)';
  return 'Enter distance (km)';
}

// 2026-06-19 (운영자 B 결정): 비로그인도 견적 보게 — 하드 로그인 게이트 제거하고 6단계에
// "가입하면 최대 10% 할인" 소프트 유도 카드로 전환. 가입 5% 웰컴쿠폰 + 왕복 공항 5% = 최대 10%
// (곱연산 실제 ~9.75% → #968 따라 '최대 10%' 정직 표기, 표시=청구 일치, 광고법 안전).
const CARROT_TITLE: Record<string, string> = {
  en: 'Sign up & save up to 10%',
  ko: '가입하고 최대 10% 할인 받기',
  ja: '登録して最大10%割引',
  zh: '注册立享最高10%折扣',
};
const CARROT_BODY: Record<string, string> = {
  en: '5% welcome coupon + 5% on round-trip airport pickup & drop-off = up to 10% off',
  ko: '5% 웰컴 쿠폰 + 공항 픽업·샌딩 왕복 예약 5% = 최대 10% 할인',
  ja: '5%ウェルカムクーポン + 空港送迎往復予約5% = 最大10%割引',
  zh: '5%欢迎优惠券 + 机场接送往返预订5% = 最高10%折扣',
};
const CARROT_CTA: Record<string, string> = {
  en: 'Sign up to save',
  ko: '가입하고 할인 받기',
  ja: '登録して割引を受ける',
  zh: '注册领取折扣',
};

const STEP_HELP: Record<string, string[]> = {
  en: [
    'Start with the pickup point. Airports, hotel zones, and custom addresses all work.',
    'Pick the job type so the quote only asks for details that matter.',
    'Choose a fixed zone or search a precise address for custom routes.',
    'Set passengers and vehicle. The recommendation updates with your group size.',
    'Add timing, contact details, luggage, and required booking consent.',
    'Review the final fare before moving to secure checkout.',
  ],
  ko: [
    '픽업 지점부터 정합니다. 공항, 호텔 권역, 직접 주소 모두 가능합니다.',
    '필요한 서비스 종류를 고르면 이후 질문이 딱 맞게 줄어듭니다.',
    '고정 권역을 고르거나 정확한 주소를 검색해 맞춤 동선을 만들 수 있습니다.',
    '인원과 차종을 정합니다. 인원에 따라 추천 차량이 함께 바뀝니다.',
    '날짜, 연락처, 수하물, 필수 약관 동의를 한 번에 정리합니다.',
    '결제 전 최종 금액과 포함 내용을 확인합니다.',
  ],
  ja: [
    'まずは出発地点を選びます。空港、ホテルエリア、住所検索に対応しています。',
    'サービス種類を選ぶと、必要な質問だけに絞られます。',
    '固定エリアまたは住所検索で目的地を指定できます。',
    '人数と車両を選びます。人数に合わせておすすめ車両が変わります。',
    '日時、連絡先、荷物、必須同意をまとめて入力します。',
    '決済前に最終料金と含まれる内容を確認します。',
  ],
  zh: [
    '先选择上车地点。机场、酒店区域和自定义地址都可以。',
    '选择服务类型后，只显示相关问题。',
    '选择固定区域，或搜索精确地址生成路线。',
    '设置人数和车型。推荐车型会随人数更新。',
    '填写日期、联系方式、行李和必要同意。',
    '支付前确认最终费用和包含项目。',
  ],
};

function compactValue(value: string | undefined | null, fallback: string): string {
  const v = value?.trim();
  return v && v.length > 0 ? v : fallback;
}

function vehicleSummaryLabel(vehicle: WizardState['vehicle'], lang: 'ko' | 'en' | 'ja' | 'zh'): string {
  if (!vehicle) return '-';
  if (vehicle === 'staria') {
    if (lang === 'ko') return '프리미엄 비즈니스';
    if (lang === 'ja') return 'プレミアムビジネス';
    if (lang === 'zh') return '高端商务';
    return 'Premium Business';
  }
  return VEHICLE_TYPES[vehicle]?.name[lang] ?? vehicle;
}

export function CharterWizard({ initialState, onComplete, language = 'en' }: CharterWizardProps) {
  // 2026-05-10 (B9-35 잔여): 마운트 시 24h 이내 미완 snapshot 있으면 modal 노출.
  // initialState (caller 가 명시 prefill) 이 있으면 snapshot 무시 — caller intent 우선.
  const initialSnap = useMemo<CharterSnapshotValues | null>(() => {
    if (initialState && Object.keys(initialState).length > 0) return null;
    const snap = loadWizardSnapshot<CharterSnapshotValues>('charter');
    return snap?.values ?? null;
  }, [initialState]);
  const initialSnapStep = useMemo<number>(() => {
    if (initialState && Object.keys(initialState).length > 0) return 1;
    const snap = loadWizardSnapshot<CharterSnapshotValues>('charter');
    return snap?.step ?? 1;
  }, [initialState]);

  const [state, setState] = useState<WizardState>(() => {
    const filtered = Object.fromEntries(
      Object.entries(initialState ?? {}).filter(([, v]) => v !== undefined),
    );
    return { ...INITIAL_WIZARD_STATE, ...filtered };
  });
  const [currentStep, setCurrentStep] = useState(1);
  // user — 6단계 가입 유도 카드 노출 판단(!user) + 프로필 prefill. (구 로그인 게이트는 2026-06-19 제거)
  const { user } = useAuth();
  // 사용자 manual km override — Geocoding 실패 또는 직접 보정.
  const [manualKm, setManualKm] = useState<number | null>(null);
  // 2026-06-30 트립닷컴식 예약정보 (SMS 인증 제거 운영자): Step 5 결제 직전 약관 동의.
  //   세션 상태 — snapshot(WizardState)에 저장 안 함(매 결제마다 재동의).
  const [termsAgreed, setTermsAgreed] = useState<boolean>(false);
  // 2026-06-29 마케팅(선택) 동의 — 약관과 독립. canAdvance(case5/case6) 게이트에 절대 미포함
  //   (미동의해도 결제 진행). onComplete 로 결제 패널 → capture body 보존.
  const [marketingConsent, setMarketingConsent] = useState<boolean>(false);
  // Resume modal — 사용자가 '이어서/새로 시작' 결정할 때까지 main snapshot 보존.
  const [resumeOpen, setResumeOpen] = useState<boolean>(!!initialSnap);

  // FEATURE_CHARTER_WAYPOINTS: 경유지 좌표 → /api/charter-route-km 경로 km. 견적/영수증에 주입해
  //   표시가==청구가(백 createPaypalOrder 도 동일 좌표 재조회). 무경유/플래그OFF = routeKm null(무영향).
  const { routeKm } = useCharterRouteKm(state);
  const { quote, loading, geocodingFailed, distanceSource } = useQuoteCalculator(state, manualKm, routeKm);

  // 차터 견적 퍼널 계측 — 동의 상태까지 다루므로 훅으로 분리했다(주석·규칙은 그 파일에).
  useCharterFunnelTracking({
    currentStep,
    quoteReady:
      currentStep >= 6 && !!quote && (quote.needsCustomQuote || quote.subtotalKRW > 0),
    vehicleType: state.vehicle || '',
  });

  // 2026-06-11 가입 프로필 prefill — customerName/customerPhone 빈 필드만 (메신저는 프로필 미수집 → 무변경).
  // resume 결정 전(resumeOpen)엔 주입 안 함(snapshot 복원 충돌 방지) + 마운트당 1회 + fill-only-empty(사용자/snapshot 안 덮음).
  const { profile: prefillProfile } = useUserProfile();
  const profilePrefilled = useRef(false);
  useEffect(() => {
    if (profilePrefilled.current || !prefillProfile || resumeOpen) return;
    profilePrefilled.current = true; // 프로필 도착 + resume 결정 후 1회만 (critique #4)
    setState((prev) => mergeProfileDefaults(prev, {
      customerName: prefillProfile.name || prefillProfile.nickname,
      customerPhone: normalizeProfilePhone(prefillProfile.phone, prefillProfile.countryCode),
    }, ['customerName', 'customerPhone']));
  }, [prefillProfile, resumeOpen]);

  // 2026-07-26: 위 prefill 이 읽는 값을 쓰는 코드가 없어 매 예약마다 재입력이었다 → 저장 배선.
  useProfileContactSync(state.customerPhone);

  // Resume modal 활성 시 'charter_paused' namespace 로 저장 → 사용자가 '새로 시작'
  // 누르기 전까지 원본 snapshot 유지. WizardForm/index.tsx 와 동일 패턴.
  useWizardPersistence<CharterSnapshotValues>(
    resumeOpen ? 'charter_paused' : 'charter',
    { state, manualKm },
    currentStep,
  );

  // Resume modal summary — origin → service → destination · pax 압축. snapshot 의 핵심만.
  const resumeSummary = useMemo<string>(() => {
    if (!initialSnap) return '';
    const s = initialSnap.state;
    const parts: string[] = [];
    if (s.origin) parts.push(s.origin === 'CUSTOM' ? (s.originAddress || 'Custom') : s.origin);
    if (s.service) parts.push(s.service.replace(/_/g, ' '));
    if (s.destinationKey) parts.push(s.destinationKey);
    if (s.paxCount && s.paxCount > 0) {
      const paxUnit = language === 'ko' ? '명' : language === 'ja' ? '名' : language === 'zh' ? '人' : 'pax';
      parts.push(`${s.paxCount} ${paxUnit}`);
    }
    return parts.join(' · ');
  }, [initialSnap, language]);

  function handleResumeContinue() {
    if (!initialSnap) { setResumeOpen(false); return; }
    setState(initialSnap.state);
    setManualKm(initialSnap.manualKm);
    // CRITICAL-2 fix (2026-06-29, SMS 인증 제거 2026-06-30): Step6(결제) 복원 금지 — 약관 동의는
    //   비저장이라 resume 시 false. Step6 직행하면 case6 게이트(약관)에 막히지만, 사용자가 Step5 로
    //   되돌아가 재동의해야 하는 혼란 방지 위해 복원을 Step5(약관 수집)로 클램프 — resume 시 항상
    //   약관 재동의 후 결제. (Math.min(5) 클램프 무수정 유지 — CRITICAL-2 보존.)
    setCurrentStep(Math.max(1, Math.min(5, initialSnapStep)));
    setResumeOpen(false);
  }
  function handleResumeRestart() {
    clearWizardSnapshot('charter');
    setResumeOpen(false);
  }

  const patch = useCallback((p: Partial<WizardState>) => {
    setState(prev => ({ ...prev, ...p }));
  }, []);

  // Bus 는 InquiryForm 진행 — wizard 내 결제 X. (staria/staria_9/sprinter 는 결제/견적 경로.)
  const isInquiryVehicle = state.vehicle === 'bus';

  const canAdvance = useCallback(() => {
    switch (currentStep) {
      case 1: {
        // 'CUSTOM' 출발지 — AddressAutocomplete 가 좌표 확정해야 advance 가능 (자유 입력 폐기).
        if (state.origin === 'CUSTOM') {
          return typeof state.originLat === 'number' && typeof state.originLng === 'number';
        }
        return !!state.origin;
      }
      case 2: return !!state.service;
      case 3: {
        // destinationKey (권역 카드) 또는 confirmed 좌표 — 자유 텍스트만 있는 경우는 차단 (자유 입력 폐기).
        if (state.destinationKey) return true;
        return typeof state.destLat === 'number' && typeof state.destLng === 'number';
      }
      case 4: return !!state.paxCount && state.paxCount >= 1 && !!state.vehicle;
      case 5: {
        if (!state.startDate) return false;
        // PR-W4 (이슈 35): 픽업 시각은 Step 3 select 입력. INITIAL_WIZARD_STATE 가 09:00 기본값.
        if (!state.pickupTime && !state.startTime) return false;
        // 2026-07-28: 마감(전세차량 1h / 투어 8h) 초과면 진행 차단.
        //   이전에는 amber 배너만 띄우고 결제까지 통과시켜, 서버가 400 으로 되받는 흐름이었다.
        if (isPastCutoff(
          resolveProductType(state).productType,
          state.startDate,
          state.pickupTime ?? state.startTime ?? '',
        )) return false;
        if (!state.customerName || state.customerName.trim().length < 2) return false;
        // 2026-06-07: 약한 ≥7자리 → 투어와 동일 형식검증(isValidInternationalPhone, 8~15자리).
        // 기사 배차 연락이 닿는 번호 보장 (오타·가짜번호 차단). 통합 예약정보 정책.
        if (!isValidInternationalPhone(state.customerPhone ?? '')) return false;
        // 2026-06-30 트립닷컴식 예약정보 (SMS 인증 제거 운영자): 결제 직전 약관 동의 필수.
        if (!termsAgreed) return false;
        if (state.service === 'airport_transfer') {
          if (!state.airport?.flightNumber || state.airport.flightNumber.length < 3) return false;
          if (state.origin === 'ICN' && !state.airport?.terminal) return false;
        }
        if (state.service === 'multi_day') {
          if (!state.endDate) return false;
          if (!state.lodgingLocation) return false;
        }
        return true;
      }
      case 6: {
        if (isInquiryVehicle) return false; // InquiryForm 자체에 submit CTA — wizard nav 결제 비활성.
        // CRITICAL-2 fix (2026-06-29, SMS 인증 제거 2026-06-30): 약관 게이트가 case5 에만 있으면
        //   resume 로 Step6 직행 시 약관 미검증 결제 가능(termsAgreed 비저장→false 인데 case6 통과).
        //   case5 와 동일 약관 게이트를 결제 진입 case6 에도 적용 (이 줄 보존 — CRITICAL-2).
        if (!termsAgreed) return false;
        if (!quote) return false;
        if (quote.needsCustomQuote) return true;
        return quote.subtotalKRW > 0;
      }
      default: return false;
    }
  }, [currentStep, state, quote, isInquiryVehicle, termsAgreed]);

  const goNext = () => {
    // 2026-06-19 (운영자 B 결정): 하드 로그인 게이트 제거 — 비로그인도 견적(6단계) 본다.
    // 강제 리드캡처 대신 6단계 "가입하면 최대 10% 할인" 카드로 소프트 유도("가입유도 하되 게스트 가능").
    setCurrentStep(s => Math.min(6, s + 1));
  };
  const goPrev = () => setCurrentStep(s => Math.max(1, s - 1));

  // 모바일(<768px) 전용 sticky 바 — 기존 useIsMobile 훅(=max-width:767px) 재사용(데스크탑 미렌더).
  const isMobile = useIsMobile();
  // 결제 진입 핸들러 — 인플로우 결제 버튼과 sticky 바가 동일 로직 공유(중복/게이트 복제 방지).
  //   clearWizardSnapshot + onComplete(state, consent) — canAdvance(case6)가 약관 동의 이미 보장.
  const handleProceedPayment = useCallback(() => {
    clearWizardSnapshot('charter');
    onComplete?.(state, { termsAgreed, marketingConsent });
  }, [state, termsAgreed, marketingConsent, onComplete]);
  // sticky 바 가격 — quote.subtotalKRW 파생값 재사용(재계산 X). 결제가능 견적일 때만 노출,
  //   custom/미산출이면 null → 가격 숨김(formatPrice SSOT 포맷터, P311 표시가=청구가).
  const stickyAmountKRW = quote && !quote.needsCustomQuote && quote.subtotalKRW > 0 ? quote.subtotalKRW : null;

  const i18n = getWizardI18n(language);
  const STEP_LABELS = [i18n.step1, i18n.step2, i18n.step3, i18n.step4, i18n.step5, i18n.step6];
  const stepHelp = STEP_HELP[language] || STEP_HELP.en;
  const summaryRows = [
    {
      label: language === 'ko' ? '출발' : language === 'ja' ? '出発' : language === 'zh' ? '出发' : 'Pickup',
      value: compactValue(state.originName || state.originAddress || state.originCustom || state.origin, '-'),
    },
    {
      label: language === 'ko' ? '서비스' : language === 'ja' ? 'サービス' : language === 'zh' ? '服务' : 'Service',
      value: compactValue(state.service?.replace(/_/g, ' '), '-'),
    },
    {
      label: language === 'ko' ? '도착' : language === 'ja' ? '目的地' : language === 'zh' ? '目的地' : 'Destination',
      value: compactValue(state.destName || state.destAddress || state.destinationCustom || state.destinationKey, '-'),
    },
      {
        label: language === 'ko' ? '인원/차량' : language === 'ja' ? '人数/車両' : language === 'zh' ? '人数/车型' : 'Party / car',
      value: `${state.paxCount || '-'} ${language === 'ko' ? '명' : language === 'ja' ? '名' : language === 'zh' ? '人' : 'pax'} · ${vehicleSummaryLabel(state.vehicle, language)}`,
      },
    {
      label: language === 'ko' ? '일정' : language === 'ja' ? '日程' : language === 'zh' ? '日期' : 'Date',
      value: compactValue(`${state.startDate ?? ''}${state.pickupTime ? ` ${state.pickupTime}` : ''}`, '-'),
    },
  ];
  // 🔧 2026-07-18 재점검: USD 표시는 실제 청구 공식(고정환율 1400 + 정수 반올림 = createPaypalOrder
  //   usesFixedUsdRate)과 동일하게. 이전 formatPrice 는 표시환율(1430)이라 같은 화면의 Step6
  //   영수증·실청구 $ 와 ~2.1% 어긋났다. ja/zh 참고 환산은 유지(실 결제는 USD).
  const stickyUsdFixed = stickyAmountKRW != null ? `$${charterUsdFromKrw(stickyAmountKRW).toLocaleString('en-US')}` : null;
  // 마감 칩 — 고른 상품의 실제 마감시간. 아직 상품이 안 정해졌으면 이 위저드의 기본군(전세차량)
  //   값을 쓴다. 당일투어 **패키지**를 고르면 투어(8h)로 바뀐다.
  const cutoffProductType = resolveProductType(state).productType;
  const cutoffHours = cutoffProductType ? getCutoffHours(cutoffProductType) : CHARTER_VEHICLE_CUTOFF_HOURS;
  const cutoffChipLabel = language === 'ko' ? `${cutoffHours}시간 전 마감`
    : language === 'ja' ? `${cutoffHours}時間前締切`
    : language === 'zh' ? `提前${cutoffHours}小时截止`
    : `${cutoffHours}h cutoff`;
  const desktopAmount = stickyAmountKRW != null
    ? (language === 'en' ? stickyUsdFixed : formatPrice(stickyAmountKRW, language))
    : null;

  // 모바일은 하단 패딩 96px 확보(고정 sticky 바가 인플로우 nav/마지막 입력 가리지 않게). 데스크탑 무패딩.
  return (
    <div className="mx-auto w-full max-w-6xl px-0 py-2.5 sm:px-4 sm:py-6 lg:py-8" style={isMobile ? { paddingBottom: 88 } : undefined}>
      <div className="grid gap-2.5 sm:gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <section className="min-w-0">
          <div className="mb-2 overflow-hidden rounded-[14px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(124,92,252,0.20),transparent_34%),linear-gradient(145deg,rgba(255,255,255,0.075),rgba(255,255,255,0.025))] p-2 shadow-[0_12px_32px_rgba(0,0,0,0.22)] sm:mb-5 sm:rounded-[28px] sm:p-5 sm:shadow-[0_24px_80px_rgba(0,0,0,0.30)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="coco-step-badge inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] sm:gap-2 sm:px-3 sm:py-1.5 sm:text-[11px]">
                <Sparkles className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                {i18n.stepOf} {currentStep} / {STEP_LABELS.length}
              </div>
              <div className="hidden items-center gap-3 text-[11px] font-semibold text-white/45 sm:flex">
                <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-[#00D28C]" /> PayPal</span>
                <span className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5 text-[#C4956A]" /> {cutoffChipLabel}</span>
              </div>
            </div>

            {/* 가이드 p.6 점+체크 스테퍼 — 위자드와 동일 공용 CocoStepper (완료 스텝만 클릭 이동, 기존 게이트 동일) */}
            <div className="mt-2 sm:mt-4">
              <CocoStepper
                current={currentStep - 1}
                total={STEP_LABELS.length}
                labels={STEP_LABELS}
                onStepClick={(i) => setCurrentStep(i + 1)}
              />
            </div>
          </div>

          <div className="rounded-[16px] border border-white/10 bg-[#0B1020]/85 p-2.5 shadow-[0_12px_34px_rgba(0,0,0,0.26)] backdrop-blur-xl sm:rounded-[30px] sm:p-7 sm:shadow-[0_24px_90px_rgba(0,0,0,0.34)] lg:p-8">
            <div className="mb-2.5 flex flex-col gap-1 sm:mb-7 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
              <div>
                <h2 className="text-[18px] font-black leading-tight text-white sm:text-[28px]">
                  {STEP_LABELS[currentStep - 1]}
                </h2>
                <p className="mt-0.5 max-w-2xl text-[11px] leading-relaxed text-white/55 sm:mt-2 sm:text-sm">
                  {stepHelp[currentStep - 1]}
                </p>
              </div>
              {desktopAmount && (
                <div className="hidden rounded-2xl border border-[#B668FC]/25 bg-[#B668FC]/10 px-4 py-3 text-right sm:block">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/45">
                    {language === 'ko' ? '현재 견적' : language === 'ja' ? '現在の見積' : language === 'zh' ? '当前报价' : 'Live quote'}
                  </p>
                  <p className="mt-1 text-lg font-black text-white">{desktopAmount}</p>
                </div>
              )}
            </div>

            {currentStep === 1 && <Step1Origin      state={state} patch={patch} language={language} />}
            {currentStep === 2 && <Step2Service     state={state} patch={patch} language={language} />}
            {currentStep === 3 && <Step3Destination state={state} patch={patch} language={language} />}
            {currentStep === 4 && <Step4PaxVehicle  state={state} patch={patch} language={language} />}
            {currentStep === 5 && (
              /* 2026-06-29 (방법 A): Step 5 고객정보 UI 를 BookingInfoForm 으로 통합 (Step5DateOptions 내부).
                 약관은 termsAgreed SSOT 단일 — BookingInfoForm 의 "모두 동의" 와 동기 (externalAgreeAll).
                 #1012 항공편 자동조회(/api/flight-status)는 Step5DateOptions 가 보존(flightLookupSlot).
                 결제·가격 엔진·canAdvance 게이트(termsAgreed)는 무수정 그대로.
                 SMS 본인인증(BookingConsent)은 제거 (2026-06-30 운영자 결정) — footerSlot 미전달. */
              <Step5DateOptions
                state={state}
                patch={patch}
                language={language}
                quote={quote}
                termsAgreed={termsAgreed}
                onTermsChange={setTermsAgreed}
                onMarketingChange={setMarketingConsent}
              />
            )}
            {currentStep === 6 && (
              isInquiryVehicle ? (
                // Bus — 가격 카드 대신 상담 폼.
                <InquiryForm
                  vehicle="bus"
                  state={state}
                  language={language}
                />
              ) : (
                <div className="space-y-4">
                  {loading && (
                    <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/55">
                      <Loader2 className="w-4 h-4 animate-spin" /> Geocoding...
                    </div>
                  )}
                  {distanceSource && !loading && (
                    <p className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/55">
                      {language === 'ko' ? '거리 출처' : language === 'ja' ? '距離ソース' : language === 'zh' ? '距离来源' : 'Distance source'}:{' '}
                      <span className="text-white/85">{distanceSourceLabel(distanceSource, language)}</span>
                    </p>
                  )}
                  <Step6Quote quote={quote} state={state} routeKm={routeKm} language={language} />
                  {/* 2026-06-19 (운영자 B): 비로그인 게스트에게 견적은 보여주되 가입 시 최대 10% 할인 소프트 유도. */}
                  {!user && (
                    <div className="rounded-2xl border border-[#B668FC]/40 bg-gradient-to-br from-[#B668FC]/15 to-[#FF6B9D]/10 p-4">
                      <p className="text-sm font-bold text-white mb-1">🎁 {CARROT_TITLE[language] || CARROT_TITLE.en}</p>
                      <p className="text-xs text-white/70 mb-3 leading-relaxed">{CARROT_BODY[language] || CARROT_BODY.en}</p>
                      <button
                        type="button"
                        onClick={() => void signInWithGoogle()}
                        className="w-full rounded-xl py-3 text-sm font-bold text-white transition-all active:scale-[0.99]"
                        style={{ background: 'linear-gradient(135deg, #B668FC, #FF6B9D)' }}
                      >
                        {CARROT_CTA[language] || CARROT_CTA.en}
                      </button>
                    </div>
                  )}
                  {geocodingFailed && (
                    <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4">
                      <p className="text-sm text-amber-200/85 mb-2">⚠ {geocodingFailedLabel(language)}</p>
                      <label className="block text-xs text-white/60 mb-1">{manualKmLabel(language)}</label>
                      <input
                        type="number"
                        min={1}
                        value={manualKm ?? ''}
                        onChange={e => {
                          const n = Number(e.target.value);
                          setManualKm(Number.isFinite(n) && n > 0 ? n : null);
                        }}
                        className="w-32 px-3 py-2 rounded-lg border border-white/15 bg-white/[0.04] text-white/85 text-sm outline-none focus:border-[#B668FC]/40"
                      />
                    </div>
                  )}
                </div>
              )
            )}
          </div>

          <div className="mt-5 hidden gap-3 sm:flex">
            {currentStep > 1 && (
              <button
                type="button"
                onClick={goPrev}
                className="flex-1 rounded-2xl border border-white/15 py-4 text-sm font-bold text-white/70 transition-colors hover:bg-white/5 flex items-center justify-center gap-2"
              >
                <ChevronLeft className="w-4 h-4" /> {i18n.prev}
              </button>
            )}
            {currentStep < 6 && (
              <button
                type="button"
                onClick={goNext}
                disabled={!canAdvance()}
                className="flex-[1.35] rounded-2xl py-4 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40 flex items-center justify-center gap-2 transition-all"
                style={{ background: 'linear-gradient(135deg, #7C5CFC, #EA537E)' }}
              >
                {i18n.next} <ChevronRight className="w-4 h-4" />
              </button>
            )}
            {currentStep === 6 && onComplete && !isInquiryVehicle && (
              <button
                type="button"
                onClick={handleProceedPayment}
                disabled={!canAdvance()}
                className="flex-[1.35] rounded-2xl py-4 text-sm font-black text-white disabled:opacity-40 flex items-center justify-center gap-2"
                style={{ background: '#0070BA' }}
              >
                {i18n.payProceed}
              </button>
            )}
          </div>
        </section>

        <aside className="hidden lg:block">
          <div className="sticky top-24 space-y-4">
            <div className="overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.045] shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur-xl">
              <div className="border-b border-white/10 bg-gradient-to-br from-[#7C5CFC]/18 to-[#EA537E]/10 p-5">
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[#D8C0FF]">
                  <MapPin className="h-3.5 w-3.5" />
                  {language === 'ko' ? '예약 요약' : language === 'ja' ? '予約サマリー' : language === 'zh' ? '预订摘要' : 'Trip summary'}
                </div>
                <p className="mt-2 text-xl font-black leading-tight text-white">
                  {desktopAmount || (language === 'ko' ? '정보를 선택하면 견적이 나옵니다' : language === 'ja' ? '選択すると見積もりが表示されます' : language === 'zh' ? '选择后即显示报价' : 'Quote appears as you choose')}
                </p>
                {desktopAmount && stickyAmountKRW != null && (
                  <p className="mt-1 text-xs text-white/45">{`${stickyUsdFixed} USD`}</p>
                )}
              </div>
              <div className="space-y-3 p-5">
                {summaryRows.map((row) => (
                  <div key={row.label} className="rounded-2xl border border-white/[0.08] bg-black/10 px-4 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/35">{row.label}</p>
                    <p className="mt-1 truncate text-sm font-semibold text-white/80">{row.value}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[24px] border border-emerald-400/15 bg-emerald-400/[0.055] p-5">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 flex-none text-[#00D28C]" />
                <div>
                  <p className="text-sm font-bold text-white">
                    {language === 'ko' ? '현지 운영자가 확인합니다' : language === 'ja' ? '現地運営チームが確認' : language === 'zh' ? '本地团队确认' : 'Checked by our local team'}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-white/55">
                    {language === 'ko'
                      ? '차량, 기사, 항공편, 수하물 정보를 결제 전 한 번에 맞춥니다.'
                      : language === 'ja'
                      ? '車両、ドライバー、フライト、荷物の情報を決済前にまとめて確認します。'
                      : language === 'zh'
                      ? '车辆、司机、航班、行李信息在支付前一并核对。'
                      : 'Vehicle, driver, flight, and luggage details stay together before checkout.'}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                <Clock3 className="h-4 w-4 text-[#C4956A]" />
                <p className="mt-2 text-xs font-bold text-white">12h</p>
                <p className="text-[11px] text-white/45">{language === 'ko' ? '예약 마감' : language === 'ja' ? '予約締切' : language === 'zh' ? '预订截止' : 'booking cutoff'}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                <CreditCard className="h-4 w-4 text-[#B9A4FF]" />
                <p className="mt-2 text-xs font-bold text-white">PayPal</p>
                <p className="text-[11px] text-white/45">{language === 'ko' ? '보안 결제' : language === 'ja' ? '安全な決済' : language === 'zh' ? '安全支付' : 'secure checkout'}</p>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* 모바일(<768px) 전용 sticky 가격+CTA 바 — 기존 핸들러/게이트/라벨 재사용(PayPal 직접 호출 없음).
          Step1~5: goNext(i18n.next). Step6 결제진입: handleProceedPayment(i18n.payProceed) = 인플로우 버튼과 동일.
          Bus/VIP(InquiryForm) Step6 은 자체 CTA → 바 미노출. disabled=!canAdvance()(기존 진행조건 그대로). */}
      {isMobile && onComplete && !(currentStep === 6 && isInquiryVehicle) && (() => {
        const isPayStep = currentStep === 6;
        const barDisabled = !canAdvance();
        const barLabel = isPayStep ? i18n.payProceed : i18n.next;
        const barOnClick = isPayStep ? handleProceedPayment : goNext;
        // 2026-07-19 라이트 스킨: 모바일 차터는 라이트 셸(cocotrip-mobile-charter)이므로 바도 라이트로.
        // 가격 표기·핸들러·게이트는 무변경. 결제 진입 버튼은 PayPal 인지색(#0070BA) 유지.
        return (
          <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 1100, padding: '12px 16px calc(12px + env(safe-area-inset-bottom))', background: 'rgba(255,255,255,0.94)', backdropFilter: 'blur(20px)', borderTop: '1px solid rgba(124,92,255,0.14)', boxShadow: '0 -18px 60px rgba(48,39,118,0.16)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              {stickyAmountKRW != null ? (
                <>
                  <div style={{ fontSize: 18, fontWeight: 900, lineHeight: 1.1, color: '#15143d' }}>{language === 'en' ? stickyUsdFixed : formatPrice(stickyAmountKRW, language)}</div>
                  <div style={{ fontSize: 11, color: '#756d96' }}>{`${stickyUsdFixed} USD`}</div>
                </>
              ) : (
                <div style={{ fontSize: 13, fontWeight: 600, color: '#756d96' }}>{`${currentStep} / 6`}</div>
              )}
            </div>
            <button
              type="button"
              disabled={barDisabled}
              onClick={barOnClick}
              className={barDisabled ? undefined : 'm-cta'}
              style={{ flex: '0 0 auto', minWidth: 150, padding: '14px 20px', border: 'none', borderRadius: 999, background: barDisabled ? 'rgba(124,92,255,0.10)' : (isPayStep ? '#0070BA' : 'var(--coco-cta-gradient)'), color: barDisabled ? 'rgba(21,20,61,0.35)' : '#fff', fontSize: 15, fontWeight: 900, cursor: barDisabled ? 'not-allowed' : 'pointer', boxShadow: barDisabled ? undefined : 'var(--coco-cta-shadow)' }}
            >
              {barLabel}
            </button>
          </div>
        );
      })()}

      <ResumeWizardModal
        open={resumeOpen}
        summary={resumeSummary}
        onContinue={handleResumeContinue}
        onRestart={handleResumeRestart}
      />
    </div>
  );
}

export default CharterWizard;
