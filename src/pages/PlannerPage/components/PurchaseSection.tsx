// Purchase section -- single primary CTA (Klook pattern).
// 2026-05-05: free-claim funnel 폐기 — Option B "already booked? get it free"
// bundle toggle 분기 제거. 유료 PayPal flow만 노출.
// LOCKED region -- PayPalBookingButton lifted verbatim from legacy PlannerPage.tsx L1705-1993.
//
// 2026-08-10 (Korea Editorial Concierge phase 2) — **시각만** 바꿨다.
//   금액, 통화, 할인 표기, 결제 게이트(비로그인 차단/게스트 결제 플래그), 쿠폰 0원 경로,
//   PayPal payload(expectedUSD·priceKRW·productType·memo), 환불 불가 고지, 중복클릭 가드는
//   전부 그대로다. 바뀐 것: 다크 그라데이션 카드 → 종이 위 가격 원장, 장식용 글로우 제거,
//   금액을 tabular figure 로 정렬, 특징 목록을 하이라인 목록으로.
//   근거: `tests/unit/editorial-planner-journey.test.ts` 의 "purchase area" 블록과
//   기존 `tests/unit/ai-planner-price-parity.test.ts` 가 값·SSOT 를 계속 잠근다.
import { type MutableRefObject, useState, useEffect, useRef, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Briefcase, UtensilsCrossed, Camera, Train, ShieldCheck, Check, LogIn, Phone, Ticket,
} from 'lucide-react';
import { PayPalBookingButton } from '@/components/PayPalBookingButton';
import type { PlannerFormValues } from '@/components/PlannerForm';
import type { PlannerDict } from '../types';
import { TriviaLoadingAnimation } from './TriviaLoadingAnimation';
import { useAuth } from '@/hooks/useAuth';
import { signInWithGoogle, getAvailableAiCoupon } from '@/lib/firebase';
import { isGuestAnonEnabled } from '@/lib/guestReader';
import { AI_PLANNER_FULL_USD, AI_PLANNER_ORIGINAL_USD, AI_PLANNER_REFERENCE_KRW, formatAiPlannerUsd, formatAiPlannerApproxKrw, fillPrice } from '@/lib/aiPlannerPrice';
// P317 (2026-05-30): lazy-load phone sign-in modal (firebase phone auth) —
// keep it out of the PlannerPage chunk; loads only when the user opens it.
const PhoneSignInModal = lazy(() =>
  import('@/components/PhoneSignInModal').then((m) => ({ default: m.PhoneSignInModal })),
);

interface QuickPreviewData {
  themes?: string[];
  marketingNarrative?: string | Record<string, unknown>;
  day1MarkdownTable?: string | Record<string, unknown>;
}

interface PurchaseSectionProps {
  p: PlannerDict; language: string;
  userEmail: string; setUserEmail: (v: string) => void;
  isGeneratingPlan: boolean; planError: string | null;
  resultQuick: QuickPreviewData;
  lastValues: MutableRefObject<PlannerFormValues | null>;
  revisionMode: boolean; revisionPlanId: string | null; revisionToken: string | null;
  /** W4: revision reason chips (comma-joined), free text, and previous stop names */
  revisionReason?: string | null;
  revisionNote?: string | null;
  avoidList?: string | null;
  onPaymentSuccess: (orderId: string, aiCouponCode?: string) => void;
  onRevisionRegenerate: (values: PlannerFormValues, planId: string, token: string | null, revisionReason?: string | null, revisionNote?: string | null, avoidList?: string | null) => void;
}

export function PurchaseSection({
  p, language, userEmail, setUserEmail,
  isGeneratingPlan, planError, resultQuick, lastValues,
  revisionMode, revisionPlanId, revisionToken,
  revisionReason, revisionNote, avoidList,
  onPaymentSuccess, onRevisionRegenerate,
}: PurchaseSectionProps) {
  // 5/7 변경: PayPalBookingButton 이 PayPal Smart Buttons (live) + SDK 차단 시 paypal.me QR
  // fallback 통합. PurchaseSection 은 단순히 button 렌더만.
  //
  // P315 (출시 blocker): 비로그인 결제 차단. 데스크탑 손님이 로그인 진입점을 못 찾고
  // 비로그인으로 결제 → backend verifyUserToken 401 "Bearer token required" → "돈 내고
  // 일정표 못 받음" 사고. 운영자 정책: 비로그인 결제 금지. 결제창(PayPal) 뜨기 전에
  // 막아서 결제 후 실패를 원천 차단. (backend verifyUserToken 은 의도된 인증 — 무변경.)
  const { user, loading: authLoading } = useAuth();
  // 게스트 결제 (FEATURE_GUEST_ANON_AUTH): ON 이면 비로그인 손님도 가입 없이 바로 결제
  //   (벽 → 당근). 백엔드 handlerCore 가 같은 플래그로 게스트 PayPal 결제를 받는다.
  //   OFF(기본) = P315 로그인 벽 그대로 (현행 byte-identical).
  const guestCheckoutEnabled = isGuestAnonEnabled();
  const [phoneModalOpen, setPhoneModalOpen] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  // P1-②(여름 이벤트): 로그인 사용자의 AI 무료 쿠폰(1~3일) 조회 → "무료 쿠폰 사용" 버튼 노출.
  const [aiCoupon, setAiCoupon] = useState<{ code: string; maxDays: number } | null>(null);
  const [isSending, setIsSending] = useState(false); // 진행 버튼 더블클릭 방지 — 0원 결제 1회 보장(결제 적대검증 1🟡). 3초 후 자동 해제(에러 시 재시도 허용).
  useEffect(() => {
    if (!user) { setAiCoupon(null); return; }
    const days = (lastValues?.current?.durationDays as number) || 3;
    let on = true;
    getAvailableAiCoupon(user.uid, days).then((c) => { if (on) setAiCoupon(c); });
    return () => { on = false; };
  }, [user, lastValues]);
  // 쿠폰함 경유 흐름 (2026-06-28): 결제화면의 큰 "무료 쿠폰으로 받기" 버튼 폐기.
  //   AI 무료쿠폰은 마이페이지 쿠폰함에서 "사용하기" → /planner?coupon=CODE 로 진입.
  //   여기서 URL 코드가 사용자의 유효한 AI 무료쿠폰(getAvailableAiCoupon: ai-plan·미사용·
  //   미만료·maxDays 검증)과 일치하면 "쿠폰 적용됨" 상태로 전환. 결제(0원) 로직은
  //   기존 onPaymentSuccess('', code) 그대로 재사용 — 트리거 위치만 큰 버튼 → 쿠폰함 경유.
  const [searchParams] = useSearchParams();
  const couponParam = searchParams.get('coupon');
  // URL ?coupon=CODE 가 검증된 AI 무료쿠폰과 일치할 때만 적용 (위조 코드 무시).
  const couponApplied = !!(couponParam && aiCoupon && couponParam === aiCoupon.code);
  const handleSignIn = async () => {
    if (signingIn) return;
    setSigningIn(true);
    try {
      await signInWithGoogle();
    } catch (e) {
      console.warn('[PurchaseSection] Google sign-in failed:', e instanceof Error ? e.message : e);
    } finally {
      setSigningIn(false);
    }
  };

  const features = [
    { icon: Briefcase, text: p.featureItinerary },
    { icon: UtensilsCrossed, text: p.featureRestaurant },
    { icon: Camera, text: p.featurePhoto },
    { icon: Train, text: p.featureTransit },
    { icon: ShieldCheck, text: p.featureNoHallucination },
  ];

  // 2026-08-19 (funnel audit — abandonment recovery): 무료 미리보기 단계 이탈 회복용 리드
  // 캡처. 완전히 선택(unchecked 기본) — 결제 게이트/PayPal/가격 표시엔 절대 미포함, 실패해도
  // 결제와 무관(fire-and-forget, 에러는 삼킴). 체크 + 유효 이메일일 때만 마운트당 이메일별
  // 1회 /api/preview-lead 호출. 백엔드는 api/preview-lead.js.
  const [wantsPreviewTips, setWantsPreviewTips] = useState(false);
  const previewLeadSentEmails = useRef<Set<string>>(new Set());
  useEffect(() => {
    const email = userEmail.trim();
    // 결제 이메일과 동일한 단순 형식 검증(src/components/charter/InquiryForm.tsx 패턴) —
    // 결제 자체는 별도 검증을 두지 않고 브라우저 type="email" + required 에 맡기므로,
    // 여기선 그 형식과 동일한 가벼운 정규식만 쓴다(서버가 최종 검증한다).
    if (!wantsPreviewTips || !/\S+@\S+\.\S+/.test(email)) return;
    const key = email.toLowerCase();
    if (previewLeadSentEmails.current.has(key)) return;
    previewLeadSentEmails.current.add(key);
    fetch('/api/preview-lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, language, source: 'planner_paywall' }),
    }).catch((e) => console.warn('[PurchaseSection] preview-lead capture failed (non-fatal):', e instanceof Error ? e.message : e));
  }, [wantsPreviewTips, userEmail, language]);

  return (
    <section className="ec-panel">
      {/* 가격 표시 — 값은 전부 lib/aiPlannerPrice SSOT 에서 온다(하드코딩 금지).
          AI 플래너는 쿠폰 미적용 정책(디지털 상품) — 모든 사용자 동일 가격. */}
      <div className="border-b border-ec-line pb-5">
        <p className="ec-body-sm text-ec-ink-3">
          <span className="line-through">{formatAiPlannerUsd(AI_PLANNER_ORIGINAL_USD)}</span>
          <span className="ml-2">{p.originalPrice}</span>
        </p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="ec-figure text-[clamp(38px,5vw,56px)] leading-none">{formatAiPlannerUsd()}</span>
          {/* 보조 통화 — 참고 표시용. 🔴 2026-07-29: 실제 청구는 고정 USD 이고 KRW 는 참고값이다
              (환율에 따라 이 KRW 와 실제 결제 원화 인출액이 다를 수 있다). */}
          <span className="ec-body-sm text-ec-ink-3">/ {formatAiPlannerApproxKrw(language)}</span>
        </div>
        <p className="mt-2 text-[13px] font-semibold text-ec-brand">
          50% OFF · <span className="font-normal text-ec-ink-3">{p.launchPrice}</span>
        </p>
        {/* "First 100 customers" 가짜 한정 문구 제거 (2026-06-14) — 실제 카운터가 없어 구글 광고
            "허위 긴급성/가짜 재고" 정책 위반 소지. 50% OFF(실 할인)·launchPrice 배지는 유지. */}

        {/* W4: 가치 강조 — "1회 결제 = 총 3개 버전 일정" */}
        <p className="mt-3 text-[14px] font-semibold text-ec-ink">
          {fillPrice((p as { valueBannerMain?: string }).valueBannerMain || '{price} — 3 itineraries total!', language)}
        </p>
        <p className="ec-body-sm text-ec-ink-3">
          {(p as { valueBannerSub?: string }).valueBannerSub || '1 purchase + 2 Free Revisions = 3 completely different versions'}
        </p>
      </div>

      <h3 className="ec-h3 mt-5">{p.fullPlanTitle}</h3>
      <p className="ec-body-sm ec-measure mt-2 text-ec-ink-3">{p.fullPlanDesc}</p>

      {/* Feature checklist */}
      <ul className="mt-4 grid gap-x-6 sm:grid-cols-2">
        {features.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-start gap-2 border-b border-ec-line py-2 text-[14px] text-ec-ink-2">
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ec-brand" aria-hidden />
            <span>{text}</span>
          </li>
        ))}
      </ul>

      {/* PRIMARY CTA — paid plan (Klook pattern: single primary action) */}
      <div className="mt-6 flex flex-col gap-4">
        {/* Email input — required for the paid flow */}
        <label className="block">
          <span className="ec-eyebrow">{p.emailPlaceholder}</span>
          <input
            type="email"
            value={userEmail}
            onChange={e => setUserEmail(e.target.value)}
            placeholder={p.emailPlaceholder}
            className="ec-field mt-1.5"
            required
          />
        </label>

        {/* Preview-lead opt-in (2026-08-19) — optional, unchecked by default. Fires
            /api/preview-lead fire-and-forget on check + valid email; never gates payment. */}
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={wantsPreviewTips}
            onChange={e => setWantsPreviewTips(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded-ec-sm border-ec-line-2 bg-ec-raised accent-ec-brand"
          />
          <span className="ec-body-sm text-ec-ink-3">
            {language === 'ja' ? '旅の準備のコツとこの日程のリマインダーをメールで受け取る（任意）'
              : language === 'zh' ? '通过邮件接收旅行准备提示和此行程的提醒（可选）'
              : language === 'en' ? 'Get travel tips and a reminder for this itinerary by email (optional)'
              : '여행 준비 팁과 이 일정 리마인더를 이메일로 받아볼게요 (선택)'}
          </span>
        </label>

        {/* Feature recap (compact, was the OptionAButton list) */}
        <ul className="ec-panel-quiet space-y-1">
          {[p.optionAfeature1, p.optionAfeature2, p.optionAfeature3, p.optionAfeature4, p.optionAfeature5].map((f) => (
            <li key={f} className="flex gap-2 text-[13px] text-ec-ink-2">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ec-brand" aria-hidden /><span>{f}</span>
            </li>
          ))}
          <li className="flex gap-2 text-[13px] font-semibold text-ec-ink">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ec-brand" aria-hidden />
            <span>{p.optionAfeatureRevision || '2 Free Revisions included'}</span>
          </li>
        </ul>

        {/* Primary action — paid PayPal flow.
            2026-05-05: bundle toggle "Already booked? Get free" CTA 분기 제거. */}
        {isGeneratingPlan ? (
          <div className="space-y-3">
            {/* 4-step 진행 + 꿀팁 슬라이드 (en/ja/zh: 한국 여행 꿀팁 10개, ko: 기존 한국어 팁) */}
            {/* P163: 일수별 동적 ETA — lastValues.current.durationDays 전달 */}
            <TriviaLoadingAnimation p={p} lang={language} durationDays={lastValues?.current?.durationDays as number | undefined} />
            {/* 안심 메시지 — 이메일로도 발송됨을 명시 (booking confirmation 이미 발송) */}
            <div className="border-l-2 border-ec-brand pl-3">
              <p className="text-[14px] font-semibold text-ec-ink">{p.planReadyEmailTitle}</p>
              <p className="ec-body-sm text-ec-ink-3">{p.planReadyEmailSub}</p>
            </div>
          </div>
        ) : revisionMode && revisionPlanId ? (
          <button
            onClick={() => { const v = lastValues.current; if (v) onRevisionRegenerate(v, revisionPlanId, revisionToken, revisionReason, revisionNote, avoidList); }}
            disabled={!lastValues.current}
            type="button"
            className="ec-btn ec-btn-primary w-full">
            {p.freeRegeneration || 'Free Regeneration'} {'—'} {p.createNewPlan || 'Create New Plan'}
          </button>
        ) : authLoading ? (
          /* P315: auth 확정 전 깜빡임 방지 — guest 에게 PayPal 버튼이 잠깐 보였다가
             사라지는 것 차단. 보통 수십 ms. */
          <div className="flex items-center justify-center gap-2 py-4 text-[14px] text-ec-ink-3" role="status" aria-live="polite">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-ec-line border-t-ec-brand" aria-hidden />
            {p.loading}
          </div>
        ) : (!user && !guestCheckoutEnabled) ? (
          /* P315: flag OFF 시 비로그인 결제 차단(현행 — backend verifyUserToken 401 → "돈 내고
             실패" 방지). flag ON 이면 아래 else 로 빠져 게스트 결제 + 가입 당근(backend handlerCore
             가 같은 플래그로 게스트 PayPal 결제를 받아줌 → "돈 내고 실패" 없음). */
          <div className="space-y-3 border-t border-ec-line pt-4">
            <p className="ec-body-sm text-ec-ink-2">{p.loginToPayDesc}</p>
            <button
              onClick={handleSignIn}
              disabled={signingIn}
              type="button"
              className="ec-btn ec-btn-primary w-full"
            >
              {signingIn ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-ec-line border-t-ec-on-brand" aria-hidden />
              ) : (
                <LogIn className="h-4 w-4" aria-hidden />
              )}
              <span>{p.loginToPay}</span>
            </button>
            <button
              onClick={() => setPhoneModalOpen(true)}
              type="button"
              className="ec-btn ec-btn-secondary w-full"
            >
              <Phone className="h-4 w-4" aria-hidden />
              <span>
                {language === 'ja' ? '電話番号でログイン'
                  : language === 'zh' ? '使用电话号码登录'
                  : language === 'en' ? 'Sign in with phone'
                  : '전화번호로 로그인'}
              </span>
            </button>
          </div>
        ) : (
          <>
            {!user && (
              /* 게스트 결제 (flag ON): 가입은 당근(선택) — 벽 아님, 결제는 누구나. */
              <div className="border-l-2 border-ec-line pl-3">
                <p className="ec-body-sm text-ec-ink-2">
                  {(p as { guestSignupNudge?: string }).guestSignupNudge
                    || 'Sign up free — save your plan + 2 revisions + 5% off charters'}
                </p>
                <button onClick={handleSignIn} disabled={signingIn} type="button"
                  className="ec-btn ec-btn-quiet ec-btn-sm mt-1 px-0">
                  {(p as { guestSignupCta?: string }).guestSignupCta || 'Sign up free'}
                </button>
              </div>
            )}
            {/* 쿠폰함 경유 흐름 (2026-06-28): 큰 "무료 쿠폰으로 받기" 버튼 제거.
                ?coupon=CODE 가 검증된 AI 무료쿠폰과 일치 → "적용됨 · 0원" 안내 + 진행 버튼.
                결제(0원) 로직은 기존 onPaymentSuccess('', code) 그대로 (트리거만 이동). */}
            {user && couponApplied && aiCoupon ? (
              <div className="space-y-2">
                <p className="flex items-center gap-2 text-[14px] font-semibold text-ec-success">
                  <Ticket className="h-4 w-4 shrink-0" aria-hidden />
                  {(p as { aiCouponApplied?: string }).aiCouponApplied || '무료 쿠폰 적용됨 · 0원'}
                </p>
                <button
                  onClick={() => { if (isSending) return; setIsSending(true); onPaymentSuccess('', aiCoupon.code); setTimeout(() => setIsSending(false), 3000); }}
                  disabled={isGeneratingPlan || isSending}
                  type="button"
                  className="ec-btn ec-btn-primary w-full"
                >
                  {(p as { aiCouponProceed?: string }).aiCouponProceed || '무료 쿠폰으로 일정표 받기'}
                </button>
              </div>
            ) : (
              <PayPalBookingButton
                productType="ai-planner-full" passengers={1} dateStart="" dateEnd=""
                priceKRW={AI_PLANNER_REFERENCE_KRW} p={p} lang={language}
                // 🔴 2026-07-29: 화면이 보여준 금액을 서버에 함께 보낸다.
                //   서버 산정치와 1센트 이상 다르면 createPaypalOrder 가 409 로 결제를 만들지 않는다
                //   (표시가 ≠ 청구가 방지).
                expectedUSD={AI_PLANNER_FULL_USD}
                memo={`Full itinerary for: ${userEmail}`}
                itineraryData={resultQuick}
                onPaymentSuccess={onPaymentSuccess}
                userEmail={userEmail}
              />
            )}

            {/* AI 플랜은 디지털 상품(즉시 다운로드)이라 환불 불가 — 소비자 사전 고지. */}
            <p className="ec-body-sm text-ec-notice">
              {(p as { aiPlanNoRefundNotice?: string }).aiPlanNoRefundNotice
                || 'AI Plans are digital products delivered immediately and are non-refundable. Charter and tour bookings follow our standard refund policy.'}
            </p>
          </>
        )}

        {planError && (
          <div className="ec-error-note" role="alert">
            <span>
              {planError}{' '}
              <a href="https://wa.me/821087140611" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                {p.contactWhatsApp || 'Contact us on WhatsApp'}
              </a>
            </span>
          </div>
        )}

        {/* Satisfaction guarantee */}
        <p className="flex items-center gap-2 border-t border-ec-line pt-3 text-[13px] text-ec-ink-3">
          <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{p.upgradeNotice}</span>
        </p>
      </div>

      {/* P315: 전화번호 로그인 모달 (비로그인 결제 게이트 fallback). signInWithGoogle
          이 Google 처리, 이건 Google 계정 없는 손님용. position:fixed 라 DOM 위치 무관. */}
      {phoneModalOpen && (
        <Suspense fallback={null}>
          <PhoneSignInModal
            language={language === 'ko' || language === 'en' || language === 'ja' || language === 'zh' ? language : 'en'}
            onClose={() => setPhoneModalOpen(false)}
            onSuccess={() => setPhoneModalOpen(false)}
          />
        </Suspense>
      )}
    </section>
  );
}
