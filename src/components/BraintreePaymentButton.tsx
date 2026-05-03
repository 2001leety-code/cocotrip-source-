/**
 * BraintreePaymentButton — PayPalBookingButton 대체.
 *
 * 한국 PayPal Business 계정이 직접 PayPal SDK (paypal.com/sdk/js) 사용 불가
 * (CDN reject 확인됨, 2026-05-03). PayPal 자회사인 Braintree로 통합 전환.
 * Drop-in UI는 PayPal 버튼 + 카드 + Apple Pay + Google Pay를 하나의 임베디드
 * 컴포넌트로 렌더 — 기존 PayPal Smart Buttons UX 거의 동일.
 *
 * 흐름:
 *   1. mount → /api/braintreeClientToken fetch
 *   2. 사용자가 Pay 버튼 클릭 → Drop-in UI 노출
 *   3. 사용자가 결제 수단 선택 + 진행 → nonce 받음
 *   4. /api/braintreeCheckout 에 nonce + plan 데이터 POST → transactionId 받음
 *   5. onPaymentSuccess(transactionId) 호출 → 기존 ai-planner-full 흐름과 호환
 *
 * 환경변수 (사용자 작업):
 *   BRAINTREE_MERCHANT_ID / BRAINTREE_PUBLIC_KEY / BRAINTREE_PRIVATE_KEY (server)
 *   BRAINTREE_ENV: 'sandbox' or 'production'
 *   client token은 server 발급 — frontend env 변수 X
 */
import { useState, useEffect, useRef } from 'react';
import { Tag, Check, AlertCircle, Ticket, Sparkles, ChevronDown, ChevronUp, ArrowRight, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { track as posthogTrack } from '@/lib/posthog';
import { useLoyalty } from '@/hooks/useLoyalty';
import { useAuth } from '@/hooks/useAuth';
import { haptic } from '@/lib/haptic';

interface BookingDict {
  paypalSdkError?: string;
  paypalError?: string;
  paypalCancel?: string;
  paypalLoading?: string;
  paypalBookBtn?: string;
  paypalRateLabel?: string;
  paypalRetry?: string;
  [key: string]: unknown;
}

export interface AirportBookingInfo {
  terminal?: 'T1' | 'T2';
  flightNumber?: string;
  luggage?: { small?: number; medium?: number; large?: number };
}

interface Props {
  productType: string;
  passengers: number;
  dateStart?: string;
  dateEnd?: string;
  priceKRW: number;
  p: BookingDict;
  lang: string;
  pickupLocation?: string;
  dropoffLocation?: string;
  vehicleType?: string;
  memo?: string;
  itineraryData?: unknown;
  onPaymentSuccess?: (transactionId: string) => void | Promise<void>;
  userEmail?: string;
  airport?: AirportBookingInfo;
}

// Braintree Drop-in 인스턴스 타입 (braintree-web-drop-in 모듈에서 동적 import).
interface DropinInstance {
  requestPaymentMethod(): Promise<{ nonce: string; type: string; details?: unknown }>;
  teardown(): Promise<void>;
}
interface DropinModule {
  create(opts: {
    authorization: string;
    container: string | HTMLElement;
    paypal?: { flow: 'checkout' | 'vault'; amount?: string; currency?: string };
    applePay?: unknown;
    googlePay?: unknown;
  }): Promise<DropinInstance>;
}

// Test mode 우회 — 기존 PayPalBookingButton과 동일 의도, 어드민 본인 결제 우회 가능.
const TEST_ACCOUNTS: string[] = ['2001leety@gmail.com'];

export function BraintreePaymentButton({
  productType, passengers, dateStart = '', dateEnd = '',
  priceKRW, p, lang,
  pickupLocation = '', dropoffLocation = '', vehicleType = '', memo = '',
  itineraryData, onPaymentSuccess, userEmail = '', airport,
}: Props) {
  const isTestAccount = TEST_ACCOUNTS.includes(userEmail.toLowerCase().trim());

  const [clientToken, setClientToken] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [showDropin, setShowDropin] = useState(false);
  const [dropinLoading, setDropinLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [successData, setSuccessData] = useState<{ transactionId: string; amount: string } | null>(null);

  // Promo code (PayPalBookingButton과 동일)
  const [promoCode, setPromoCode] = useState('');
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoApplied, setPromoApplied] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [discountedKRW, setDiscountedKRW] = useState<number | null>(null);
  const [savedAmount, setSavedAmount] = useState(0);
  const [couponDocId, setCouponDocId] = useState<string | null>(null);
  const [couponUserId, setCouponUserId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const { activeCoupons } = useLoyalty();
  // 2026-05-03 P0-2 fix: applyPromoCode 가 user-specific 쿠폰 (Firestore users/{uid}/coupons)
  // 검증하려면 userId 필요. 이전엔 안 보내서 본인 쿠폰 4개 보유해도 모두 "유효하지 않음"
  // 처리됐음. 미로그인 사용자는 user.uid undefined → applyPromoCode가 글로벌 코드만 검증.
  const { user } = useAuth();

  const dropinContainerRef = useRef<HTMLDivElement | null>(null);
  const dropinInstanceRef = useRef<DropinInstance | null>(null);

  const PROMO_LABELS: Record<string, Record<string, string>> = {
    ko: { label: '쿠폰 코드', apply: '적용', success: '할인 적용됨', invalid: '유효하지 않은 코드', expired: '프로모션 종료', pickerOpen: '쿠폰 사용하기', pickerEmpty: '사용 가능한 쿠폰이 없어요', adTitle: 'AI 플래너 1회 = 5% 쿠폰 1장', adBody: '124,000원 차량 예약 = 약 6,200원 절약. 플래너($9.90) 거의 무료!', adCta: 'AI 플래너 만들기', saved: '절약', expires: '만료' },
    en: { label: 'Promo code', apply: 'Apply', success: 'Discount applied', invalid: 'Invalid code', expired: 'Promotion ended', pickerOpen: 'Use a coupon', pickerEmpty: 'No coupons yet', adTitle: '1 AI plan = 1× 5% coupon', adBody: 'Book a ₩124,000 charter ≈ ₩6,200 saved. The planner ($9.90) pays for itself.', adCta: 'Make AI plan', saved: 'Saved', expires: 'Expires' },
    ja: { label: 'クーポンコード', apply: '適用', success: '割引適用', invalid: '無効なコード', expired: 'プロモ終了', pickerOpen: 'クーポンを使う', pickerEmpty: '使えるクーポンがありません', adTitle: 'AIプラン1回 = 5%クーポン', adBody: '￦124,000のチャーター予約 ≈ ￦6,200の節約。プラン($9.90)はほぼ無料！', adCta: 'AIプラン作成', saved: '節約', expires: '有効期限' },
    zh: { label: '优惠券码', apply: '应用', success: '折扣已应用', invalid: '无效代码', expired: '促销已结束', pickerOpen: '使用优惠券', pickerEmpty: '暂无可用优惠券', adTitle: 'AI 行程 1 次 = 5% 优惠券', adBody: '预订 ₩124,000 包车 ≈ 节省 ₩6,200，行程($9.90)几乎免费！', adCta: '制作 AI 行程', saved: '节省', expires: '到期' },
  };
  const pl = PROMO_LABELS[lang] || PROMO_LABELS.en;

  const effectiveKRW = discountedKRW || priceKRW;
  const accentColor = '#7C5CFC';

  // ── Mount: client token fetch ────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/braintreeClientToken');
        const json = await res.json();
        if (cancelled) return;
        if (json.ok && json.clientToken) {
          setClientToken(json.clientToken);
        } else {
          setTokenError(json.error || 'Failed to get payment session');
        }
      } catch (err) {
        if (!cancelled) setTokenError(err instanceof Error ? err.message : 'Network error');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Drop-in 인스턴스 생성 (showDropin === true 직후) ─────────────────
  useEffect(() => {
    if (!showDropin || !clientToken || !dropinContainerRef.current) return;
    let cancelled = false;
    setDropinLoading(true);
    (async () => {
      try {
        const dropinMod = (await import('braintree-web-drop-in')).default as unknown as DropinModule;
        if (cancelled) return;
        const instance = await dropinMod.create({
          authorization: clientToken,
          container: dropinContainerRef.current!,
          paypal: {
            flow: 'checkout',  // one-time payment
            amount: (effectiveKRW / 1350).toFixed(2),  // approx USD for PayPal flow
            currency: 'USD',
          },
          // applePay / googlePay 활성화는 Braintree Dashboard에서 enable 필요.
          // 활성화 시 자동 노출됨 — config object만 비워서 보내면 됨.
        });
        if (cancelled) {
          await instance.teardown().catch(() => {});
          return;
        }
        dropinInstanceRef.current = instance;
        setDropinLoading(false);
      } catch (err) {
        if (!cancelled) {
          setPaymentError(err instanceof Error ? err.message : 'Drop-in init failed');
          setDropinLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      if (dropinInstanceRef.current) {
        dropinInstanceRef.current.teardown().catch(() => {});
        dropinInstanceRef.current = null;
      }
    };
  }, [showDropin, clientToken, effectiveKRW]);

  async function applyCouponCode(code: string) {
    if (!code.trim()) return;
    setPromoLoading(true);
    setPromoError(null);
    try {
      const res = await fetch('/api/applyPromoCode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code, productType, originalPrice: priceKRW,
          userId: user?.uid || undefined,  // user-specific 쿠폰 검증용
        }),
      });
      const json = await res.json();
      const d = json.data;
      if (d?.valid) {
        setDiscountedKRW(d.discountedPrice);
        setSavedAmount(d.savedAmount);
        setPromoApplied(true);
        setCouponDocId(d.couponDocId || null);
        setCouponUserId(d.userId || null);
        setPromoCode(code);
        setPickerOpen(false);
        haptic('success');
      } else {
        setPromoError(json.code === 'INVALID_CODE' || d?.error === 'promo_expired' ? pl.expired : pl.invalid);
      }
    } catch {
      setPromoError(pl.invalid);
    } finally {
      setPromoLoading(false);
    }
  }

  async function handlePayClick() {
    setPaymentError(null);
    if (tokenError) {
      setPaymentError(tokenError);
      return;
    }
    if (!clientToken) {
      setPaymentError('Payment session not ready, please wait a moment.');
      return;
    }
    // 2026-05-03 fix: 이메일 미입력 시 결제 차단. 이전엔 빈 이메일로 결제 진행되어
    // emailNotifier가 silent return → AI 플랜 만들어졌지만 확인 메일 안 옴.
    const emailTrimmed = (userEmail || '').trim();
    if (!emailTrimmed || !emailTrimmed.includes('@')) {
      setPaymentError('Please enter your email above before payment — confirmation will be sent there.');
      return;
    }
    void posthogTrack('payment_started', { planType: productType, amount: priceKRW, currency: 'KRW' });
    setShowDropin(true);
  }

  async function handleSubmitPayment() {
    if (!dropinInstanceRef.current) return;
    setSubmitting(true);
    setPaymentError(null);
    try {
      const { nonce } = await dropinInstanceRef.current.requestPaymentMethod();

      const res = await fetch('/api/braintreeCheckout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nonce,
          productType, passengers, dateStart, dateEnd,
          ...(promoApplied ? { promoCode } : {}),
          userEmail, customerName: userEmail.split('@')[0],
          pickupLocation, dropoffLocation, vehicleType, memo,
          itineraryData: itineraryData || null,
          ...(airport ? { airport } : {}),
          ...(couponDocId ? { couponDocId, couponUserId } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Payment processing failed');
      }
      const data = json.data;
      void posthogTrack('payment_completed', { planType: productType, amount: priceKRW, currency: 'KRW' });

      if (onPaymentSuccess) {
        setShowDropin(false);
        await onPaymentSuccess(data.transactionId);
        return;
      }
      setSuccessData({ transactionId: data.transactionId, amount: data.amount });
      setShowSuccess(true);
      setShowDropin(false);
    } catch (err) {
      console.error('[Braintree] payment failed:', err);
      void posthogTrack('payment_failed', { planType: productType, reason: 'braintree_checkout_error' });
      setPaymentError(err instanceof Error ? err.message : 'Payment failed');
    } finally {
      setSubmitting(false);
    }
  }

  function handleCancelDropin() {
    setShowDropin(false);
    setPaymentError(null);
  }

  // ── Success 모달 (PayPalBookingButton의 confirm overlay 단순화) ───────
  if (showSuccess && successData) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)' }}>
        <div className="w-full max-w-md bg-gradient-to-b from-[#0f1628] to-[#0a0f1a] rounded-3xl border border-[#7C5CFC]/30 shadow-[0_0_60px_rgba(124,92,252,0.15)] p-6 text-center">
          <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-emerald-500 flex items-center justify-center">
            <Check className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Payment Confirmed!</h2>
          <p className="text-sm text-white/60 mb-4">Transaction: {successData.transactionId.slice(0, 16)}...</p>
          <p className="text-2xl font-bold text-emerald-400 mb-4">${successData.amount} USD</p>
          <button onClick={() => { setShowSuccess(false); setSuccessData(null); }}
            className="w-full py-3 rounded-xl text-white font-bold text-sm" style={{ background: 'linear-gradient(135deg, #7C5CFC, #EA537E)' }}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Coupon picker (PayPalBookingButton의 패턴 그대로) */}
      {!showDropin && !promoApplied && (
        <div>
          <button type="button" onClick={() => { haptic('tap'); setPickerOpen(o => !o); }}
            aria-expanded={pickerOpen}
            className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-white/[0.06] border border-white/10 hover:border-[#7C5CFC]/40 hover:bg-white/[0.08] transition-all">
            <span className="flex items-center gap-2">
              <Ticket className="w-4 h-4 text-[#B668FC]" />
              <span className="text-sm font-semibold text-white">{pl.pickerOpen}</span>
              {activeCoupons.length > 0 && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#B668FC]/20 text-[#B668FC] border border-[#B668FC]/25">
                  {activeCoupons.length}
                </span>
              )}
            </span>
            {pickerOpen ? <ChevronUp className="w-4 h-4 text-white/50" /> : <ChevronDown className="w-4 h-4 text-white/50" />}
          </button>
          {pickerOpen && (
            <div className="mt-2 space-y-2">
              {activeCoupons.length === 0 ? (
                <div className="rounded-xl border border-[#7C5CFC]/25 p-3.5" style={{ background: 'linear-gradient(135deg, rgba(124,92,252,0.10), rgba(255,107,157,0.06))' }}>
                  <div className="flex items-start gap-2.5">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg, #B668FC, #FF6B9D)' }}>
                      <Sparkles className="w-4 h-4 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12.5px] font-bold text-white leading-tight">{pl.adTitle}</p>
                      <p className="text-[11px] text-white/65 leading-snug mt-1">{pl.adBody}</p>
                      <Link to="/planner" onClick={() => haptic('tap')}
                        className="mt-2.5 inline-flex items-center gap-1 text-[11px] font-bold text-[#B668FC] hover:text-[#FF6B9D] transition-colors">
                        {pl.adCta} <ArrowRight className="w-3 h-3" />
                      </Link>
                    </div>
                  </div>
                </div>
              ) : (
                <ul className="space-y-2">
                  {activeCoupons.map(c => {
                    const valueLabel = c.type === 'percent' ? `${c.value}%` : (c.currency === 'KRW' ? `₩${c.value.toLocaleString()}` : `$${c.value}`);
                    return (
                      <li key={c.id}>
                        <button type="button" onClick={() => applyCouponCode(c.code)} disabled={promoLoading}
                          className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] hover:border-[#7C5CFC]/40 transition-all text-left disabled:opacity-50">
                          <Tag className="w-3.5 h-3.5 text-[#B668FC] shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-bold text-white truncate">{c.label}</p>
                          </div>
                          <span className="text-[14px] font-black text-[#B668FC] shrink-0">{valueLabel}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {promoError && (
        <div className="flex items-center gap-1.5 text-xs text-red-400">
          <AlertCircle className="w-3.5 h-3.5" /> {promoError}
        </div>
      )}
      {promoApplied && (
        <div className="flex items-center justify-between bg-emerald-500/10 border border-emerald-500/25 rounded-xl px-3 py-2">
          <span className="flex items-center gap-1.5 text-xs text-emerald-300">
            <Check className="w-3.5 h-3.5" /> {pl.success}
          </span>
          <span className="text-xs font-bold text-emerald-300">-₩{savedAmount.toLocaleString('ko-KR')}</span>
        </div>
      )}

      {/* Drop-in UI 컨테이너 (Braintree가 직접 렌더) */}
      {showDropin ? (
        <div className="rounded-xl overflow-hidden border border-white/10 p-3 bg-white/[0.95]">
          <div ref={dropinContainerRef} />
          {dropinLoading && (
            <div className="flex items-center justify-center gap-2 py-4 text-sm text-gray-600">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading payment options...
            </div>
          )}
          <div className="flex gap-2 mt-3">
            <button type="button" onClick={handleCancelDropin} disabled={submitting}
              className="flex-1 py-2.5 rounded-lg border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50">
              Cancel
            </button>
            <button type="button" onClick={handleSubmitPayment} disabled={submitting || dropinLoading}
              className="flex-[2] py-2.5 rounded-lg text-white font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
              style={{ background: '#0070BA' }}>
              {submitting ? (<><Loader2 className="w-4 h-4 animate-spin" /> Processing…</>) : `Pay ₩${effectiveKRW.toLocaleString('ko-KR')}`}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={handlePayClick} disabled={!clientToken || !!tokenError}
          className="w-full rounded-xl text-white font-medium transition-all hover:opacity-90 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ background: '#0070BA', padding: '13px 20px' }}>
          {!clientToken && !tokenError ? (
            <span className="flex items-center justify-center gap-2 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </span>
          ) : (
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-sm font-semibold">{p.paypalBookBtn || 'Pay with PayPal / Card'}</span>
              <div className="flex items-center gap-2">
                {promoApplied ? (
                  <>
                    <span className="text-[13px] text-white/55 line-through">₩{priceKRW.toLocaleString('ko-KR')}</span>
                    <span className="text-[15px] font-bold text-emerald-300">₩{effectiveKRW.toLocaleString('ko-KR')}</span>
                  </>
                ) : (
                  <span className="text-[15px] font-bold">₩{effectiveKRW.toLocaleString('ko-KR')}</span>
                )}
                <span className="text-xs text-white/70">≈ ${(effectiveKRW / 1350).toFixed(2)} USD</span>
              </div>
            </div>
          )}
        </button>
      )}

      {/* 🧪 Test Mode bypass — 어드민 본인 결제 우회 (PayPalBookingButton과 동일 의도) */}
      {isTestAccount && onPaymentSuccess && !showDropin && (
        <button type="button" disabled={submitting}
          onClick={async () => {
            setSubmitting(true);
            setPaymentError(null);
            try { await onPaymentSuccess(`TEST-${Date.now()}`); }
            catch (err) { setPaymentError(err instanceof Error ? err.message : 'Test payment failed'); }
            finally { setSubmitting(false); }
          }}
          className="w-full rounded-xl text-white font-medium hover:opacity-90 active:scale-[0.99] disabled:opacity-50 mt-2"
          style={{ background: 'linear-gradient(135deg, #f59e0b, #ef4444)', padding: '13px 20px' }}>
          <div className="flex items-center justify-center gap-2 text-sm">
            <span>🧪</span>
            <span className="font-bold">Test Mode: Skip Payment → Generate AI Plan</span>
          </div>
        </button>
      )}

      {tokenError && (
        <div className="flex items-start gap-2 text-rose-300 text-xs bg-rose-500/10 border border-rose-500/30 rounded-lg p-3">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{tokenError}. Reload to retry.</span>
        </div>
      )}
      {paymentError && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-red-500/10 border border-red-500/30 px-4 py-3">
          <p className="text-sm text-red-300">{paymentError}</p>
          <button type="button"
            onClick={() => { setPaymentError(null); setShowDropin(false); }}
            className="shrink-0 text-xs text-red-400 border border-red-500/40 px-3 py-1.5 rounded-lg hover:bg-red-500/20 transition-colors">
            {p.paypalRetry || 'Retry'}
          </button>
        </div>
      )}

      <span className="block text-center text-[10px] text-white/40 italic" style={{ color: accentColor }}>
        {/* 표시만 — 실제 차이는 백엔드에서 결정 */}
        Powered by Braintree (a PayPal company)
      </span>
    </div>
  );
}
