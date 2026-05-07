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
import { resolveProductType } from '@/components/charter/resolveProductType';
import { getWizardI18n } from '@/components/charter/wizard-i18n';
import { useQuoteCalculator } from '@/hooks/useQuoteCalculator';
import type { WizardState, OriginCode, ServiceMode } from '@/components/charter/types';

const VALID_ORIGINS: OriginCode[] = ['ICN','GMP','PUS','CJU','TAE','CJJ','MWX','KWJ','RSU','USN','SEL_METRO','BUS_METRO','CUSTOM'];
const VALID_SERVICES: ServiceMode[] = ['airport_transfer','day_tour','multi_day','kpop_shuttle'];

export default function CharterNewPage() {
  const { language, t, changeLanguage } = useLanguage();
  const isMobile = useIsMobile();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const [completedState, setCompletedState] = useState<WizardState | null>(null);

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
  const initial = useMemo<Partial<WizardState>>(() => {
    const origin = params.get('origin');
    const serviceParam = params.get('service');
    const tourLegacy = params.get('tour');
    const destParam = params.get('destination') || params.get('destinationKey');
    const pax = params.get('pax');

    // service 결정: 명시적 service → 그대로 / tour 값이 서비스가 아니고 패키지면 day_tour / 그 외 undefined
    let service: ServiceMode | undefined;
    if (serviceParam && VALID_SERVICES.includes(serviceParam as ServiceMode)) {
      service = serviceParam as ServiceMode;
    } else if (tourLegacy) {
      // tourLegacy가 'day_tour' 같은 서비스 키가 아니라면 패키지 key로 간주
      service = VALID_SERVICES.includes(tourLegacy as ServiceMode)
        ? (tourLegacy as ServiceMode)
        : 'day_tour';
    }

    // destinationKey: 명시적 파라미터 → 그 값. 없고 tour가 패키지 key면 그걸로 대체
    const destinationKey = destParam
      ?? (tourLegacy && !VALID_SERVICES.includes(tourLegacy as ServiceMode) ? tourLegacy : undefined);

    return {
      origin: origin && VALID_ORIGINS.includes(origin as OriginCode) ? (origin as OriginCode) : undefined,
      service,
      destinationKey,
      paxCount: pax ? parseInt(pax, 10) : undefined,
    };
  }, [params]);

  return (
    <div className={isMobile ? 'm-page' : 'min-h-screen'} style={isMobile ? undefined : { background: '#080b14' }}>
      <Header language={language} t={t} onLanguageChange={changeLanguage} />

      <section className="text-white pt-24 pb-8 px-4" style={{ background: 'linear-gradient(160deg, #0c1220 0%, #0f2244 60%, #0a1628 100%)' }}>
        <div className="max-w-2xl mx-auto">
          <Link to="/" className="inline-flex items-center gap-1.5 text-white/55 text-xs hover:text-white/60 transition-colors mb-5">
            <ArrowLeft className="w-3.5 h-3.5" />Home
          </Link>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-[#B668FC]/35 bg-[#B668FC]/08 text-[#B668FC] text-[11px] font-semibold tracking-wider uppercase mb-4">
            <Sparkles className="w-3.5 h-3.5" /> {completedState ? i18n.heroBadgePayment : i18n.heroBadgeNew}
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold leading-tight mb-2">
            {completedState ? i18n.heroTitlePayment : i18n.heroTitleWizard}
          </h1>
          <p className="text-white/50 text-sm">
            {completedState ? i18n.heroSubtitlePayment : i18n.heroSubtitleWizard}
          </p>
        </div>
      </section>

      <main className={`max-w-2xl mx-auto px-4 ${isMobile ? 'pb-8' : 'pb-20'}`}>
        {!completedState ? (
          <CharterWizard
            initialState={initial}
            onComplete={setCompletedState}
            language={(['ko','en','ja','zh'].includes(language) ? language : 'en') as 'ko' | 'en' | 'ja' | 'zh'}
          />
        ) : (
          <PaymentPanel
            state={completedState}
            userEmail={user?.email ?? ''}
            language={language as 'ko' | 'en' | 'ja' | 'zh'}
            onBack={() => setCompletedState(null)}
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
  state, userEmail, language, onBack,
}: {
  state: WizardState;
  userEmail: string;
  language: 'ko' | 'en' | 'ja' | 'zh';
  onBack: () => void;
}) {
  const i18n = getWizardI18n(language);
  const resolved = resolveProductType(state);
  // 2026-05-07: useQuoteCalculator 반환 shape 변경 — { quote, loading, geocodingFailed, distanceSource }.
  // CharterWizard 내부에서 manual km 보정한 결과는 이 페이지에서 다시 계산되지 않음 (Wizard onComplete
  // 시점에 state 만 넘기므로). PaymentPanel 진입 시점에 권역/매트릭스 hit 인 경우만 doable — 그 외엔
  // resolved.priceKRW 또는 quote.subtotalKRW 0 → estimateOnlyNote 분기로 빠져 WhatsApp 요청.
  const { quote } = useQuoteCalculator(state);
  const KRW = (n: number | null | undefined) => n == null ? '—' : `₩${n.toLocaleString('ko-KR')}`;

  // PayPal-payable 가격이 우선, 없으면 wizard에서 산출한 권역/매트릭스 추정가 fallback
  const estimateKRW = quote && !quote.needsCustomQuote && quote.subtotalKRW > 0 ? quote.subtotalKRW : null;
  const displayKRW = resolved.priceKRW ?? estimateKRW;
  const isEstimateOnly = !resolved.payable && estimateKRW != null;

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
    `날짜: ${state.startDate ?? '-'}${state.endDate ? ` ~ ${state.endDate}` : ''} ${state.startTime ?? ''}\n` +
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
        <Row label={i18n.payField_service} value={state.service ?? '-'} />
        <Row label={i18n.payField_origin} value={state.origin ?? state.originCustom ?? '-'} />
        <Row label={i18n.payField_destination} value={state.destinationKey ?? state.destinationCustom ?? '-'} />
        <Row label={i18n.payField_vehiclePax} value={`${state.vehicle} · ${state.paxCount}${i18n.maxUnit}`} />
        <Row label={i18n.payField_date} value={`${state.startDate ?? '-'} ${state.startTime ?? ''}`} />
        {state.airport?.terminal && <Row label={i18n.payField_terminal} value={state.airport.terminal} />}
        {state.airport?.flightNumber && <Row label={i18n.payField_flight} value={state.airport.flightNumber} />}
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
          memo={state.notes ?? ''}
          itineraryData={{ wizard: state, airport: state.airport ?? null }}
          userEmail={userEmail}
          // PR-R (2026-05-08): 마감 검증용 픽업 시각 + 멀티데이 일수
          pickupTime={state.pickupTime ?? '09:00'}
          durationDays={state.service === 'multi_day' && state.endDate && state.startDate
            ? Math.max(1, Math.round((new Date(state.endDate).getTime() - new Date(state.startDate).getTime()) / 86400000) + 1)
            : 1}
        />
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
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-white/55 text-xs uppercase tracking-wider">{label}</span>
      <span className="text-white/85">{value}</span>
    </div>
  );
}
