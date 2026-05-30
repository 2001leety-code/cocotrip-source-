// Purchase section -- single primary CTA (Klook pattern).
// 2026-05-05: free-claim funnel 폐기 — Option B "already booked? get it free"
// bundle toggle 분기 제거. 유료 PayPal flow만 노출.
// LOCKED region -- PayPalBookingButton lifted verbatim from legacy PlannerPage.tsx L1705-1993.
import { type MutableRefObject, useState } from 'react';
import {
  Briefcase, UtensilsCrossed, Camera, Train, Check, Mail, LogIn, Phone,
} from 'lucide-react';
import { PayPalBookingButton } from '@/components/PayPalBookingButton';
import type { PlannerFormValues } from '@/components/PlannerForm';
import type { PlannerDict } from '../types';
import { TriviaLoadingAnimation } from './TriviaLoadingAnimation';
import { formatPrice } from '@/lib/exchange-rate';
import { useAuth } from '@/hooks/useAuth';
import { signInWithGoogle } from '@/lib/firebase';
import { PhoneSignInModal } from '@/components/PhoneSignInModal';

interface QuickPreviewData {
  themes?: string[];
  marketingNarrative?: string | Record<string, unknown>;
  day1MarkdownTable?: string | Record<string, unknown>;
}

interface PurchaseSectionProps {
  p: PlannerDict; isMobile: boolean; language: string;
  userEmail: string; setUserEmail: (v: string) => void;
  isGeneratingPlan: boolean; planError: string | null;
  resultQuick: QuickPreviewData;
  lastValues: MutableRefObject<PlannerFormValues | null>;
  revisionMode: boolean; revisionPlanId: string | null; revisionToken: string | null;
  /** W4: revision reason chips (comma-joined), free text, and previous stop names */
  revisionReason?: string | null;
  revisionNote?: string | null;
  avoidList?: string | null;
  onPaymentSuccess: (orderId: string) => void;
  onRevisionRegenerate: (values: PlannerFormValues, planId: string, token: string | null, revisionReason?: string | null, revisionNote?: string | null, avoidList?: string | null) => void;
}

export function PurchaseSection({
  p, isMobile, language, userEmail, setUserEmail,
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
  const [phoneModalOpen, setPhoneModalOpen] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
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
  return (
    <div className={isMobile
      ? 'm-card m-appear p-6 text-center relative overflow-hidden'
      : 'bg-gradient-to-br from-[#0f111a] to-[#1a0f18] rounded-2xl p-8 border border-[#7C5CFC]/20 text-center shadow-xl relative overflow-hidden'
    }
      style={isMobile ? { background: 'linear-gradient(135deg, rgba(182,104,252,0.06), rgba(255,107,157,0.03), rgba(10,4,18,0.95))' } : undefined}
    >
      {/* Decorative glow */}
      <div className={`absolute top-0 left-1/2 -translate-x-1/2 w-64 h-32 rounded-full blur-3xl ${isMobile ? 'bg-[#B668FC]/10' : 'bg-[#7C5CFC]/10'}`} />

      {/* Price display — 마케팅 정가 비교: $19.90 → $9.90 (50% OFF). AI 플래너는
          쿠폰 미적용 정책 (디지털 상품) — 모든 사용자 동일 가격. */}
      <div className="relative text-center py-4 mb-4">
        <div className="text-white/55 text-sm mb-1">
          <span className="line-through">$19.90</span>
          <span className="ml-2 text-[10px] uppercase tracking-wider">{p.originalPrice}</span>
        </div>
        <div className="flex items-baseline justify-center gap-2 mb-2">
          <span className="text-5xl font-black text-white" style={{ textShadow: isMobile ? '0 0 20px rgba(182,104,252,0.3)' : '0 0 20px rgba(124,92,252,0.3)' }}>$9.90</span>
          {/* 보조 통화 — 사용자 언어 기반 자동 환산.
              ko → ₩13,300, en → KRW 병기 유지, ja → ¥JPY, zh → ¥CNY. 결제 자체는 PayPal USD $9.90. */}
          <span className="text-white/55 text-sm">
            / {language === 'en' ? '₩13,300' : formatPrice(13300, language)}
          </span>
        </div>
        <div className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border ${isMobile ? 'bg-gradient-to-r from-[#FF6B9D]/15 to-[#B668FC]/15 border-[#FF6B9D]/40' : 'bg-gradient-to-r from-[#EA537E]/15 to-[#7C5CFC]/15 border-[#EA537E]/40'}`}>
          <span className={`text-xs font-bold ${isMobile ? 'text-[#FF6B9D]' : 'text-[#EA537E]'}`}>50% OFF</span>
          <span className="text-white/55">{'·'}</span>
          <span className="text-white/60 text-xs">{p.launchPrice}</span>
        </div>
        <p className="text-amber-400/80 text-[11px] mt-3 font-medium">{p.limitedTimeOffer}</p>

        {/* W4: 가치 강조 배너 — "1회 결제 = 총 3개 버전 일정" */}
        <div className="mt-3 mx-auto max-w-xs px-3.5 py-2.5 rounded-xl border border-amber-400/30"
          style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.10), rgba(182,104,252,0.08))' }}>
          <p className="text-amber-300 text-xs font-bold leading-snug">
            {(p as { valueBannerMain?: string }).valueBannerMain || '$9.90 — 3 itineraries total!'}
          </p>
          <p className="text-white/55 text-[11px] mt-0.5 leading-snug">
            {(p as { valueBannerSub?: string }).valueBannerSub || '1 purchase + 2 Free Revisions = 3 completely different versions'}
          </p>
        </div>
      </div>

      <h3 className="text-xl font-bold text-white mb-2 relative">{p.fullPlanTitle}</h3>
      <p className="text-white/50 text-sm mb-5 max-w-lg mx-auto leading-relaxed">{p.fullPlanDesc}</p>

      {/* Feature checklist */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-md mx-auto mb-6 text-left">
        {([
          { icon: <Briefcase className={`w-4 h-4 ${isMobile ? 'text-[#B668FC]' : 'text-[#7C5CFC]'}`} />, text: p.featureItinerary },
          { icon: <UtensilsCrossed className={`w-4 h-4 ${isMobile ? 'text-[#B668FC]' : 'text-[#7C5CFC]'}`} />, text: p.featureRestaurant },
          { icon: <Camera className={`w-4 h-4 ${isMobile ? 'text-[#B668FC]' : 'text-[#7C5CFC]'}`} />, text: p.featurePhoto },
          { icon: <Train className={`w-4 h-4 ${isMobile ? 'text-[#B668FC]' : 'text-[#7C5CFC]'}`} />, text: p.featureTransit },
        ] as { icon: React.ReactNode; text: string }[]).map((item, i) => (
          <div key={i} className="flex items-center gap-2 text-sm text-white/70 py-1.5">
            {item.icon}
            <span>{item.text}</span>
          </div>
        ))}
      </div>

      {/* PRIMARY CTA — paid plan (Klook pattern: single primary action) */}
      <div className="max-w-md mx-auto flex flex-col gap-3">
        {/* Email input — required for the paid flow */}
        <input type="email" value={userEmail} onChange={e => setUserEmail(e.target.value)}
          placeholder={p.emailPlaceholder}
          className={`w-full px-4 py-3 rounded-xl bg-white/5 border border-white/20 text-white placeholder-white/40 transition-all outline-none ${isMobile ? 'focus:border-[#B668FC] focus:ring-1 focus:ring-[#B668FC]' : 'focus:border-[#7C5CFC] focus:ring-1 focus:ring-[#7C5CFC]'}`}
          required />

        {/* Feature recap (compact, was the OptionAButton list) */}
        <ul className="text-white/55 text-[11px] space-y-0.5 text-left bg-white/[0.03] border border-white/[0.06] rounded-xl px-3.5 py-2.5">
          <li className="flex gap-1.5"><Check className="w-3 h-3 text-[#7C5CFC] mt-0.5 shrink-0" /><span>{p.optionAfeature1}</span></li>
          <li className="flex gap-1.5"><Check className="w-3 h-3 text-[#7C5CFC] mt-0.5 shrink-0" /><span>{p.optionAfeature2}</span></li>
          <li className="flex gap-1.5"><Check className="w-3 h-3 text-[#7C5CFC] mt-0.5 shrink-0" /><span>{p.optionAfeature3}</span></li>
          <li className={`flex gap-1.5 font-semibold ${isMobile ? 'text-[#FF6B9D]' : 'text-[#EA537E]'}`}><Check className="w-3 h-3 mt-0.5 shrink-0" /><span>{p.optionAfeatureRevision || '1 Free Revision included'}</span></li>
        </ul>

        {/* Primary action — paid PayPal flow.
            2026-05-05: bundle toggle "Already booked? Get free" CTA 분기 제거. */}
        {isGeneratingPlan ? (
          <div className="space-y-3 py-2">
            {/* 4-step 진행 + 꿀팁 슬라이드 (en/ja/zh: 한국 여행 꿀팁 10개, ko: 기존 한국어 팁) */}
            {/* P163: 일수별 동적 ETA — lastValues.current.durationDays 전달 */}
            <TriviaLoadingAnimation p={p} lang={language} durationDays={lastValues?.current?.durationDays as number | undefined} />
            {/* 안심 메시지 — 이메일로도 발송됨을 명시 (booking confirmation 이미 발송) */}
            <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl border"
              style={{ background: 'rgba(124,92,252,0.06)', borderColor: 'rgba(124,92,252,0.20)' }}>
              <Mail className="w-4 h-4 text-[#B8A0FF] shrink-0 mt-0.5" />
              <div className="text-[12px] text-white/75 leading-relaxed">
                <p className="font-semibold text-white">{p.planReadyEmailTitle || "준비되면 이메일로도 보내드려요"}</p>
                <p className="text-white/55 mt-0.5">{p.planReadyEmailSub || "잠시 페이지를 닫지 말아주세요. 보통 1~2분 정도 걸려요."}</p>
              </div>
            </div>
          </div>
        ) : revisionMode && revisionPlanId ? (
          <button
            onClick={() => { const v = lastValues.current; if (v) onRevisionRegenerate(v, revisionPlanId, revisionToken, revisionReason, revisionNote, avoidList); }}
            disabled={!lastValues.current}
            className="w-full py-4 rounded-2xl text-base font-bold text-white flex items-center justify-center gap-2 transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #f59e0b, #B668FC)', boxShadow: '0 4px 20px rgba(245,158,11,0.3)' }}>
            {p.freeRegeneration || 'Free Regeneration'} {'—'} {p.createNewPlan || 'Create New Plan'}
          </button>
        ) : authLoading ? (
          /* P315: auth 확정 전 깜빡임 방지 — guest 에게 PayPal 버튼이 잠깐 보였다가
             사라지는 것 차단. 보통 수십 ms. */
          <div className="flex items-center justify-center py-4 text-sm text-white/55">
            <span className="w-4 h-4 border-2 border-white/30 border-t-[#7C5CFC] rounded-full animate-spin mr-2" />
            {p.loading || '로딩 중...'}
          </div>
        ) : !user ? (
          /* P315: 비로그인 결제 차단 — 결제창 뜨기 전에 로그인 유도. backend
             verifyUserToken 이 무조건 401 이라 비로그인 결제는 "돈 내고 실패" 가 됨. */
          <div className="space-y-3 rounded-2xl border border-[#7C5CFC]/30 p-4 text-center"
            style={{ background: 'linear-gradient(135deg, rgba(124,92,252,0.10), rgba(234,83,126,0.06))' }}>
            <p className="text-sm text-white/75 leading-relaxed">
              {p.loginToPayDesc || '일정표를 안전하게 받아보려면 먼저 로그인해 주세요.'}
            </p>
            <button
              onClick={handleSignIn}
              disabled={signingIn}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-base font-bold text-white transition-all hover:opacity-90 active:scale-[0.99] disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg, #7C5CFC, #EA537E)', boxShadow: '0 4px 20px rgba(124,92,252,0.3)' }}
            >
              {signingIn ? (
                <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              ) : (
                <LogIn className="w-4 h-4" />
              )}
              <span>{p.loginToPay || '로그인 후 결제하기'}</span>
            </button>
            <button
              onClick={() => setPhoneModalOpen(true)}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium text-white/80 border border-white/20 hover:border-[#7C5CFC]/50 hover:text-white transition-all"
            >
              <Phone className="w-4 h-4" />
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
            <PayPalBookingButton
              productType="ai-planner-full" passengers={1} dateStart="" dateEnd=""
              priceKRW={13300} p={p} lang={language}
              memo={`Full itinerary for: ${userEmail}`}
              itineraryData={resultQuick}
              onPaymentSuccess={onPaymentSuccess}
              userEmail={userEmail}
            />

            {/* AI 플랜은 디지털 상품(즉시 다운로드)이라 환불 불가 — 소비자 사전 고지. */}
            <p className="text-[11px] text-amber-300/80 italic text-center px-2 leading-relaxed">
              {(p as { aiPlanNoRefundNotice?: string }).aiPlanNoRefundNotice
                || '⚠️ AI Plans are digital products delivered immediately and are non-refundable. Charter and tour bookings follow our standard refund policy.'}
            </p>
          </>
        )}

        {planError && (
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl">
            <p className="text-red-400 text-sm mb-1">{planError}</p>
            <a href="https://wa.me/821087140611" target="_blank" rel="noopener noreferrer" className="text-purple-400 text-xs underline">
              {p.contactWhatsApp || 'Contact us on WhatsApp'}
            </a>
          </div>
        )}

        {/* Satisfaction guarantee */}
        <div className="flex items-center justify-center gap-2 text-[11px] text-white/55 mt-1">
          <Check className="w-3 h-3" />
          <span>{p.upgradeNotice}</span>
        </div>
      </div>

      {/* P315: 전화번호 로그인 모달 (비로그인 결제 게이트 fallback). signInWithGoogle
          이 Google 처리, 이건 Google 계정 없는 손님용. position:fixed 라 DOM 위치 무관. */}
      {phoneModalOpen && (
        <PhoneSignInModal
          language={language === 'ko' || language === 'en' || language === 'ja' || language === 'zh' ? language : 'en'}
          onClose={() => setPhoneModalOpen(false)}
          onSuccess={() => setPhoneModalOpen(false)}
        />
      )}
    </div>
  );
}
