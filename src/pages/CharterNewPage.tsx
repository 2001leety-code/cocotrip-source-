// CharterNewPage — 위저드 기반 신규 차터 견적/예약 플로우.
// wizard.onComplete → 결제 패널 전환 (PayPalBookingButton 또는 WhatsApp 견적 요청)
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Sparkles, MessageCircle, Pencil } from 'lucide-react';
import { Header } from '@/sections/Header';
import { Footer } from '@/sections/Footer';
import { useLanguage } from '@/hooks/useLanguage';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAuth } from '@/hooks/useAuth';
import { usePageMeta } from '@/hooks/usePageMeta';
import { CharterWizard } from '@/components/charter/CharterWizard';
import { CharterIntroModal } from '@/components/CharterIntroModal';
import { PayPalBookingButton } from '@/components/PayPalBookingButton';
import { RefundPolicyModal } from '@/components/tours/RefundPolicyModal';
import { resolveProductType } from '@/components/charter/resolveProductType';
import { buildCharterCartItem } from '@/components/charter/charterCartItem';
import { CartAddButton } from '@/components/CartButton';
import { isFeatureFlagOn } from '@/lib/featureFlag';
import { EditFieldModal, type EditFieldSpec } from '@/components/charter/ReviewEditModals';
import { getWizardI18n } from '@/components/charter/wizard-i18n';
import { useQuoteCalculator } from '@/hooks/useQuoteCalculator';
import { formatPrice } from '@/lib/exchange-rate';
import type { WizardState } from '@/components/charter/types';
import { buildCharterPrefill } from '@/components/charter/charterQueryPrefill';
import { AIRPORTS_CATALOG, CITIES_CATALOG, VEHICLE_TYPES } from '@/data/charterPricing';

export default function CharterNewPage() {
  const { language, t, changeLanguage } = useLanguage();
  const isMobile = useIsMobile();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const [completedState, setCompletedState] = useState<WizardState | null>(null);
  // 2026-06-30 트립닷컴식 예약정보 (SMS 인증 제거 운영자) — 위저드 Step 5 의 약관 동의 결과.
  //   WizardState(스냅샷)에 안 넣고 별도 보관(매 결제마다 재동의). 결제 패널 → PayPalBookingButton 전달.
  const [consent, setConsent] = useState<{ termsAgreed: boolean; marketingConsent: boolean }>({ termsAgreed: false, marketingConsent: false });

  usePageMeta({
    title: t.pageMeta?.charterNew?.title ?? 'Charter Quote — Private Car in Korea',
    description: t.pageMeta?.charterNew?.description ?? 'Private chauffeur for airport transfer, day tours, and multi-day intercity. 6-step instant quote.',
    ogImage: '/hero-seoul-real.webp',
  });

  const i18n = getWizardI18n(language);

  // ── Query prefill ──
  // 지원 포맷:
  //   /charter?origin=ICN&service=airport_transfer&destinationKey=seoul-central
  //   /charter?service=day_tour&destinationKey=dmz                 (최신, CharterCTA가 사용)
  //   /charter?tour=dmz                                             (레거시: tour 값이 패키지 key면 day_tour로 자동 해석)
  // ⚠️ buildCharterPrefill 은 값이 있는 키만 반환한다 — 빈 진입에서 항상 4키를 넣으면
  //    CharterWizard 의 resume(이어서하기) modal 억제 로직이 영구 발동하는 버그. 상세 주석은 helper 참고.
  const initial = useMemo<Partial<WizardState>>(() => buildCharterPrefill(params), [params]);

  return (
    <div className={isMobile ? 'm-page cocotrip-mobile-charter' : 'min-h-screen'} style={isMobile ? undefined : { background: '#080b14' }}>
      <Header language={language} t={t} onLanguageChange={changeLanguage} />

      <section className="px-4 pb-3 pt-3 text-white sm:px-0 sm:pb-8 sm:pt-24" style={{ background: isMobile ? '#080b14' : 'linear-gradient(160deg, #0c1220 0%, #0f2244 60%, #0a1628 100%)' }}>
        <div className="mx-auto max-w-6xl rounded-[16px] px-4 py-4 sm:rounded-none sm:py-0" style={isMobile ? { background: 'linear-gradient(160deg, #0c1220 0%, #0f2244 60%, #0a1628 100%)' } : undefined}>
          <Link to="/" className="mb-3 inline-flex items-center gap-1.5 text-xs text-white/55 transition-colors hover:text-white/60 sm:mb-5">
            <ArrowLeft className="w-3.5 h-3.5" />Home
          </Link>
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-[#B668FC]/35 bg-[#B668FC]/08 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#B668FC] sm:mb-4 sm:px-3 sm:text-[11px]">
            <Sparkles className="w-3.5 h-3.5" /> {completedState ? i18n.heroBadgePayment : i18n.heroBadgeNew}
          </div>
          <h1 className="mb-1 text-[22px] font-bold leading-tight sm:mb-2 sm:text-3xl">
            {completedState ? i18n.heroTitlePayment : i18n.heroTitleWizard}
          </h1>
          <p className="text-xs text-white/50 sm:text-sm">
            {completedState ? i18n.heroSubtitlePayment : i18n.heroSubtitleWizard}
          </p>
        </div>
      </section>

      <main className={`mx-auto max-w-6xl px-4 ${isMobile ? 'pb-8' : 'pb-20'}`}>
        {!completedState ? (
          <CharterWizard
            initialState={initial}
            onComplete={(state, c) => {
              setCompletedState(state);
              setConsent(c ?? { termsAgreed: false, marketingConsent: false });
            }}
            language={(['ko','en','ja','zh'].includes(language) ? language : 'en') as 'ko' | 'en' | 'ja' | 'zh'}
          />
        ) : (
          <PaymentPanel
            state={completedState}
            consent={consent}
            userEmail={user?.email ?? ''}
            language={language as 'ko' | 'en' | 'ja' | 'zh'}
            onBack={() => { setCompletedState(null); setConsent({ termsAgreed: false, marketingConsent: false }); }}
            onPatchState={(patch) => setCompletedState((prev) => (prev ? { ...prev, ...patch } : prev))}
          />
        )}

        {/* legacy 링크는 admin/dev에서만 노출. 일반 사용자에게 혼란 주는 운영용 링크. */}
        {!completedState && import.meta.env.DEV && (
          <div className="mt-8 text-center">
            <Link to="/charter-legacy" className="text-xs text-white/55 hover:text-white/60 underline">
              {i18n.payGoToLegacy}
            </Link>
          </div>
        )}
      </main>

      <Footer t={t} />
      {/* 첫 진입 시 1회 노출되는 차터 사용 흐름 + 12h 마감 안내 모달 */}
      <CharterIntroModal />
    </div>
  );
}

// ─────────────────────────────────────────────────────────
function PaymentPanel({
  state, consent, userEmail, language, onBack, onPatchState,
}: {
  state: WizardState;
  /** 2026-06-30 트립닷컴식 예약정보 (SMS 인증 제거 운영자) — 위저드 Step 5 의 약관 동의 결과 (PayPalBookingButton 으로 전달). */
  consent: { termsAgreed: boolean; marketingConsent: boolean };
  userEmail: string;
  language: 'ko' | 'en' | 'ja' | 'zh';
  onBack: () => void;
  onPatchState: (patch: Partial<WizardState>) => void;
}) {
  const i18n = getWizardI18n(language);
  const resolved = resolveProductType(state);

  // ── #1 번역: raw 코드값 → 사람이 읽는 레이블 ──
  // 서비스 타입 레이블 (4언어)
  const SERVICE_LABEL: Record<string, Record<'ko'|'en'|'ja'|'zh', string>> = {
    airport_transfer: { ko: i18n.svcAirport, en: i18n.svcAirport, ja: i18n.svcAirport, zh: i18n.svcAirport },
    day_tour:         { ko: i18n.svcDayTour, en: i18n.svcDayTour, ja: i18n.svcDayTour, zh: i18n.svcDayTour },
    multi_day:        { ko: i18n.svcMultiDay, en: i18n.svcMultiDay, ja: i18n.svcMultiDay, zh: i18n.svcMultiDay },
    kpop_shuttle:     { ko: i18n.svcKpop, en: i18n.svcKpop, ja: i18n.svcKpop, zh: i18n.svcKpop },
    intercity:        { ko: i18n.svcTransfer, en: i18n.svcTransfer, ja: i18n.svcTransfer, zh: i18n.svcTransfer },
  };
  const airports = AIRPORTS_CATALOG as Record<string, { name_ko: string; name_en: string; name_ja?: string; name_zh?: string }>;
  const cities   = CITIES_CATALOG   as Record<string, { name_ko: string; name_en: string; name_ja?: string; name_zh?: string }>;
  // 코드(ICN/SEL_METRO 등) → 현재 언어 레이블 반환. 없으면 코드 그대로.
  function resolveLocationLabel(code: string | null | undefined, fallback?: string | null): string {
    if (!code) return fallback ?? '-';
    if (code in airports) {
      const a = airports[code];
      if (language === 'ko') return a.name_ko;
      if (language === 'ja') return a.name_ja ?? a.name_en;
      if (language === 'zh') return a.name_zh ?? a.name_en;
      return a.name_en;
    }
    if (code in cities) {
      const c = cities[code];
      if (language === 'ko') return c.name_ko;
      if (language === 'ja') return c.name_ja ?? c.name_en;
      if (language === 'zh') return c.name_zh ?? c.name_en;
      return c.name_en;
    }
    // 카탈로그에 없으면 fallback(originCustom/destinationCustom) → 코드 순
    return fallback ?? code;
  }
  const serviceLabel = (state.service && SERVICE_LABEL[state.service]?.[language]) ?? state.service ?? '-';
  const originLabel      = state.originName ?? resolveLocationLabel(state.origin, state.originCustom);
  const destinationLabel = state.destinationCustom
    ? state.destinationCustom
    : resolveLocationLabel(state.destinationKey);
  const vehicleKey = state.vehicle as keyof typeof VEHICLE_TYPES | undefined;
  const vehicleLabel = vehicleKey && VEHICLE_TYPES[vehicleKey]
    ? vehicleKey === 'staria'
      ? language === 'ko' ? '프리미엄 비즈니스' : language === 'ja' ? 'プレミアムビジネス' : language === 'zh' ? '高端商务' : 'Premium Business'
      : VEHICLE_TYPES[vehicleKey].name[language] ?? state.vehicle
    : state.vehicle ?? '-';
  // 2026-05-07: useQuoteCalculator 반환 shape 변경 — { quote, loading, geocodingFailed, distanceSource }.
  // CharterWizard 내부에서 manual km 보정한 결과는 이 페이지에서 다시 계산되지 않음 (Wizard onComplete
  // 시점에 state 만 넘기므로). PaymentPanel 진입 시점에 권역/매트릭스 hit 인 경우만 doable — 그 외엔
  // resolved.priceKRW 또는 quote.subtotalKRW 0 → estimateOnlyNote 분기로 빠져 WhatsApp 요청.
  const { quote } = useQuoteCalculator(state);
  // 결제 패널 가격 — 사용자 언어 기반 자동 환산. ko 만 ₩, 그 외는 USD/JPY/CNY 표시.
  // 결제 직전 명시 (withCurrencyCode) 로 잘못된 통화 인지 방지 — 실 결제는 PayPal USD 그대로.
  const KRW = (n: number | null | undefined) => formatPrice(n, language, { withCurrencyCode: true });

  // PayPal-payable 가격이 우선, 없으면 wizard에서 산출한 권역/매트릭스 추정가 fallback
  const estimateKRW = quote && !quote.needsCustomQuote && quote.subtotalKRW > 0 ? quote.subtotalKRW : null;
  const displayKRW = resolved.priceKRW ?? estimateKRW;
  const isEstimateOnly = !resolved.payable && estimateKRW != null;
  // 2026-06-11 장바구니 담기 — 결제 가능 항목만(estimate/AI플래너/비결제=null). CartAddButton 은 플래그 OFF 시 자체 null.
  const cartItem = buildCharterCartItem(state, resolved);

  // 2026-06-11 검수 인라인 편집 — 가격무영향(이름/연락처/메모/항공편) + 가벼운 재계산(날짜/시각) 필드만.
  // 저장 → onPatchState → CharterNewPage state patch → useQuoteCalculator/resolveProductType 자동 재계산.
  // 가격구조(서비스/차종/출발/목적지)는 위저드 재진입(onBack) — payable 판정 깨짐 방지.
  // 🔒 플래그 OFF(기본) = 기존 요약 그대로(byte-identical). ON 시에만 인라인 편집/추가 필드 노출.
  const reviewEditOn = isFeatureFlagOn(import.meta.env.VITE_FEATURE_REVIEW_EDIT); // trim 방어 — env 앞 공백/탭 (2026-06-11 사고)
  const [editing, setEditing] = useState<EditFieldSpec | null>(null);
  const applyEdit = (v: string) => {
    if (!editing) return;
    if (editing.key === 'terminal') onPatchState({ airport: { ...(state.airport ?? {}), terminal: (v || undefined) as 'T1' | 'T2' | undefined } });
    else if (editing.key === 'flightNumber') onPatchState({ airport: { ...(state.airport ?? {}), flightNumber: v } });
    else onPatchState({ [editing.key]: v } as Partial<WizardState>);
    setEditing(null);
  };

  // WhatsApp 견적 요청 본문 (이름/연락처/airport/숙소 정보 포함)
  const adultPart = state.adultCount != null ? `어른${state.adultCount}` : '';
  const childPart = state.childCount != null && state.childCount > 0 ? `+아이${state.childCount}` : '';
  const paxStr = adultPart || childPart ? `${adultPart}${childPart}` : `${state.paxCount ?? '-'}인`;
  const lodgingMap: Record<string, string> = {
    seoul: '서울 숙박', local: '현지 숙박', daily_return: '매일 서울 귀가', custom: '맞춤',
  };
  const waText = encodeURIComponent(
    `[CocoTrip Charter — Wizard]\n` +
    `이름: ${state.customerName ?? '-'} / 연락처: ${state.customerPhone ?? '-'}\n` +
    `출발: ${state.origin ?? state.originCustom ?? '-'}\n` +
    `서비스: ${state.service ?? '-'}\n` +
    `목적지: ${state.destinationKey ?? state.destinationCustom ?? '-'}\n` +
    `차종/인원: ${state.vehicle}/${paxStr}\n` +
    `날짜: ${state.startDate ?? '-'}${state.endDate ? ` ~ ${state.endDate}` : ''} ${state.pickupTime ?? state.startTime ?? ''}\n` +
    (state.service === 'multi_day' && state.lodgingLocation ? `숙소: ${lodgingMap[state.lodgingLocation] ?? state.lodgingLocation}\n` : '') +
    (state.airport ? (
      `터미널: ${state.airport.terminal ?? '-'} / 편명: ${state.airport.flightNumber ?? '-'}\n` +
      `수하물: S${state.airport.luggage?.small ?? 0} M${state.airport.luggage?.medium ?? 0} L${state.airport.luggage?.large ?? 0}\n`
    ) : '') +
    (state.notes ? `메모: ${state.notes}` : '')
  );
  const waUrl = `https://wa.me/821087140611?text=${waText}`;

  return (
    <div className="max-w-xl mx-auto py-4">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-xs text-white/50 hover:text-white mb-4">
        <Pencil className="w-3 h-3" /> {i18n.edit}
      </button>

      {/* 요약 박스 */}
      <div className="rounded-xl border border-[#B668FC]/30 bg-[#B668FC]/5 p-4 mb-4 text-sm space-y-1.5">
        <Row label={i18n.payField_service} value={serviceLabel} />
        <Row label={i18n.payField_origin} value={originLabel} />
        <Row label={i18n.payField_destination} value={destinationLabel} />
        <Row label={i18n.payField_vehiclePax} value={`${vehicleLabel} · ${state.paxCount}${i18n.maxUnit}`} />
        {/* 2026-06-11 검수 인라인 편집 (🔒 VITE_FEATURE_REVIEW_EDIT OFF=기존 요약 byte-identical). */}
        {reviewEditOn ? (
        <>
        <Row label={i18n.payField_date} value={state.startDate ?? '-'} onEdit={() => setEditing({ key: 'startDate', label: i18n.payField_date, type: 'date', value: state.startDate ?? '' })} />
        <Row label={i18n.payFieldTime} value={state.pickupTime ?? state.startTime ?? '-'} onEdit={() => setEditing({ key: 'pickupTime', label: i18n.payFieldTime, type: 'time', value: state.pickupTime ?? state.startTime ?? '' })} />
        <Row label={i18n.payFieldName} value={state.customerName || '-'} onEdit={() => setEditing({ key: 'customerName', label: i18n.payFieldName, type: 'text', value: state.customerName ?? '' })} />
        <Row label={i18n.payFieldPhone} value={state.customerPhone || '-'} onEdit={() => setEditing({ key: 'customerPhone', label: i18n.payFieldPhone, type: 'tel', value: state.customerPhone ?? '' })} />
        {state.airport && (
          <>
            <Row label={i18n.payField_terminal} value={state.airport.terminal ?? '-'} onEdit={() => setEditing({ key: 'terminal', label: i18n.payField_terminal, type: 'text', value: state.airport?.terminal ?? '' })} />
            <Row label={i18n.payField_flight} value={state.airport.flightNumber ?? '-'} onEdit={() => setEditing({ key: 'flightNumber', label: i18n.payField_flight, type: 'text', value: state.airport?.flightNumber ?? '' })} />
          </>
        )}
        <Row label={i18n.payFieldNotes} value={state.notes || '-'} onEdit={() => setEditing({ key: 'notes', label: i18n.payFieldNotes, type: 'textarea', value: state.notes ?? '' })} />
        <p className="text-[11px] text-white/45 pt-1 leading-relaxed">{i18n.reviewEditHint}</p>
        </>
        ) : (
        <>
        <Row label={i18n.payField_date} value={`${state.startDate ?? '-'} ${state.pickupTime ?? state.startTime ?? ''}`} />
        {state.airport?.terminal && <Row label={i18n.payField_terminal} value={state.airport.terminal} />}
        {state.airport?.flightNumber && <Row label={i18n.payField_flight} value={state.airport.flightNumber} />}
        </>
        )}
        <div className="border-t border-white/10 pt-2 mt-2 flex items-center justify-between">
          <span className="text-white/60">{i18n.payPrepayAmount}</span>
          <span className="text-lg font-bold text-white">{KRW(displayKRW)}</span>
        </div>
        {isEstimateOnly && (
          <p className="text-xs text-amber-300 mt-2 text-right">
            ⚠ {i18n.estimateOnlyNote}
          </p>
        )}
      </div>

      {/* 결제 가능한 경우 — PayPal/Braintree 버튼 (확정 가격) */}
      {resolved.payable && resolved.productType && resolved.priceKRW ? (
        <>
        <PayPalBookingButton
          productType={resolved.productType}
          passengers={resolved.passengers}
          dateStart={state.startDate ?? ''}
          dateEnd={state.endDate ?? ''}
          priceKRW={resolved.priceKRW}
          p={{}}
          lang={language}
          pickupLocation={state.origin ?? state.originCustom ?? ''}
          dropoffLocation={state.destinationKey ?? state.destinationCustom ?? ''}
          vehicleType={state.vehicle ?? 'staria'}
          originKey={resolved.originKey ?? undefined}
          destKey={resolved.destKey ?? undefined}
          tripType={resolved.tripType}
          vehicle={state.vehicle ?? 'staria'}
          memo={state.notes ?? ''}
          itineraryData={{ wizard: state, airport: state.airport ?? null }}
          userEmail={userEmail}
          // 2026-06-30 트립닷컴식 예약정보 — 위저드 Step 5 약관 동의 → capture body 보존 (SMS 인증 제거).
          termsAgreed={consent.termsAgreed}
          marketingConsent={consent.marketingConsent}
          // PR-R (2026-05-08): 마감 검증용 픽업 시각 + 멀티데이 일수
          pickupTime={state.pickupTime ?? '09:00'}
          durationDays={state.service === 'multi_day' && state.endDate && state.startDate
            ? Math.max(1, Math.round((new Date(state.endDate).getTime() - new Date(state.startDate).getTime()) / 86400000) + 1)
            : 1}
        />
        {/* 2026-06-11 장바구니 담기 (PayPal 옆) — flag OFF=null, estimate/AI플래너 제외. 표시가 무시·booking키로 backend 재계산(P311). */}
        {cartItem && (
          <CartAddButton
            id={cartItem.id}
            booking={cartItem.booking}
            displayName={cartItem.displayName}
            priceKRW={cartItem.priceKRW}
            className="w-full inline-flex items-center justify-center gap-1.5 py-3 mt-2 rounded-xl text-[13px] font-semibold bg-white/[0.05] text-white/75 border border-white/12 hover:bg-white/[0.09] transition-colors"
          />
        )}
        </>
      ) : isEstimateOnly && estimateKRW != null ? (
        // 2026-05-04 URGENT-1: quote 가 산출됐으면 바로 결제 가능. 약관 체크박스 단계 제거 —
        // 사용자 요청: "요금 자동 책정해서 바로 결제하면 되잖아". 부산/대구/광주 등 zone
        // fallback, sprinter/bus, ICN 외 공항 모두 동일. 추정가 안내는 짧게 한 줄만.
        // backend(braintreeCheckout)는 customAmountKRW sanity range + Firestore wizard state 저장.
        <div className="space-y-3">
          <p className="text-xs text-amber-300/80 px-1">⚠ {i18n.estimateOnlyNote}</p>
          <PayPalBookingButton
            productType="charter_custom_estimate"
            passengers={resolved.passengers}
            dateStart={state.startDate ?? ''}
            dateEnd={state.endDate ?? ''}
            priceKRW={estimateKRW}
            customAmountKRW={estimateKRW}
            p={{}}
            lang={language}
            pickupLocation={state.origin ?? state.originCustom ?? ''}
            dropoffLocation={state.destinationKey ?? state.destinationCustom ?? ''}
            vehicleType={state.vehicle ?? 'staria'}
            memo={state.notes ?? ''}
            itineraryData={{ wizard: state, airport: state.airport ?? null, estimateBreakdown: quote }}
            userEmail={userEmail}
            // 2026-06-30 트립닷컴식 예약정보 — 위저드 Step 5 약관 동의 → capture body 보존 (SMS 인증 제거).
            termsAgreed={consent.termsAgreed}
            marketingConsent={consent.marketingConsent}
            // PR-R (2026-05-08): 마감 검증용 픽업 시각 + 멀티데이 일수
            pickupTime={state.pickupTime ?? '09:00'}
            durationDays={state.service === 'multi_day' && state.endDate && state.startDate
              ? Math.max(1, Math.round((new Date(state.endDate).getTime() - new Date(state.startDate).getTime()) / 86400000) + 1)
              : 1}
          />
          <p className="text-center text-xs text-white/55">
            <a href={waUrl} target="_blank" rel="noopener noreferrer" className="text-white/50 underline">{i18n.payWhatsappAlt}</a>
          </p>
        </div>
      ) : (
        // payable 도 아니고 estimate 도 없는 케이스 (custom destination 매트릭스/zone 모두 미매칭)
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <p className="text-sm text-amber-200 mb-2">
            {resolved.reason ?? i18n.payCustomQuoteMsg}
          </p>
          <a href={waUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#25D366] text-white text-sm font-bold hover:opacity-90">
            <MessageCircle className="w-4 h-4" /> {i18n.payWhatsappBtn}
          </a>
        </div>
      )}

      {resolved.payable && (
        <p className="mt-3 text-center text-xs text-white/55">
          <a href={waUrl} target="_blank" rel="noopener noreferrer" className="text-white/50 underline">{i18n.payWhatsappAlt}</a>
        </p>
      )}

      {/* 고단가 차터 결제 직전 환불정책 노출 — 투어상세와 동일 RefundPolicyModal 재사용(신뢰).
          "취소하면 어떻게 되지?" 확인 욕구 해소 = 결제 중단 방지. */}
      {(resolved.payable || isEstimateOnly) && (
        <div className="mt-2 text-center">
          <RefundPolicyModal
            language={language}
            trigger={
              <button className="text-[10px] text-white/55 hover:text-white/70 underline-offset-2 hover:underline">
                {language === 'ko' ? '취소·환불 정책' : language === 'ja' ? 'キャンセル・返金' : language === 'zh' ? '取消政策' : 'Cancellation policy'}
              </button>
            }
          />
        </div>
      )}

      {/* 2026-06-11 검수 인라인 편집 모달 (가격무영향/가벼운재계산 필드) */}
      {editing && (
        <EditFieldModal
          spec={editing}
          onSave={applyEdit}
          onClose={() => setEditing(null)}
          saveLabel={i18n.reviewSave}
          cancelLabel={i18n.reviewCancel}
        />
      )}
    </div>
  );
}

function Row({ label, value, onEdit }: { label: string; value: string; onEdit?: () => void }) {
  return (
    <div className="flex items-center justify-between text-sm gap-2">
      <span className="text-white/55 text-xs uppercase tracking-wider shrink-0">{label}</span>
      {onEdit ? (
        <button onClick={onEdit} className="inline-flex items-center gap-1.5 text-white/85 hover:text-white min-w-0 group" type="button">
          <span className="truncate">{value}</span>
          <Pencil className="w-3 h-3 text-white/40 group-hover:text-[#B668FC] shrink-0" />
        </button>
      ) : (
        <span className="text-white/85 truncate">{value}</span>
      )}
    </div>
  );
}
