import { useState, useEffect, useRef } from 'react';
import { Tag, Check, AlertCircle, Ticket, Sparkles, ChevronDown, ChevronUp, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { track as posthogTrack } from '@/lib/posthog';
import { useLoyalty } from '@/hooks/useLoyalty';
import { haptic } from '@/lib/haptic';

/** PayPal 결제 컴포넌트에서 사용하는 i18n 키 */
interface BookingDict {
  paypalSdkError?: string;
  paypalError?: string;
  paypalCancel?: string;
  paypalLoading?: string;
  paypalBookBtn?: string;
  paypalRateLabel?: string;
  paypalRetry?: string;
  [key: string]: unknown;  // 추가 키 허용 (하위 호환)
}

/** 공항 픽업 부가 정보 — 터미널/편명/수하물. */
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
  /** Called after PayPal capture succeeds — parent handles next step (e.g. AI plan generation) */
  onPaymentSuccess?: (orderID: string) => void | Promise<void>;
  /** 현재 사용자 이메일 — 테스트 계정 감지용 */
  userEmail?: string;
  /** 공항 픽업 전용 부가 정보 (터미널/편명/수하물) */
  airport?: AirportBookingInfo;
}

interface RateInfo {
  usdAmount: string;
  currentRate: number;
  displayKRW: string;
  displayUSD: string;
  orderID: string;
}

interface SuccessData {
  orderID: string;
  payerName: string;
  payerEmail: string;
  amount: string;
}

declare global {
  interface Window {
    paypal?: {
      Buttons: (config: Record<string, unknown>) => { render: (selector: string) => void; isEligible: () => boolean };
      FUNDING: Record<string, string>;
    } & Record<string, unknown>;
  }
}

// Launch (2026-04-30) 부터 live 결제만 사용. sandbox 분기 필요 시 이메일 추가.
// 2026-05-03: 운영자(태연) 본인 결제+환불 end-to-end 테스트용. sandbox PayPal +
// 🧪 bypass 버튼 노출. 운영 안정 후 제거 가능.
const TEST_ACCOUNTS: string[] = ['2001leety@gmail.com'];

export function PayPalBookingButton({ productType, passengers, dateStart = '', dateEnd = '', priceKRW, p, lang, pickupLocation = '', dropoffLocation = '', vehicleType = '', memo = '', itineraryData, onPaymentSuccess, userEmail = '', airport }: Props) {
  const isSandboxAccount = TEST_ACCOUNTS.includes(userEmail.toLowerCase().trim());
  console.log('[PayPal Props]', { productType, passengers, dateStart, dateEnd, priceKRW });
  const [paypalReady, setPaypalReady] = useState(false);
  const [loading,     setLoading]     = useState(false);
  const [showPaypal,  setShowPaypal]  = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [successData, setSuccessData] = useState<SuccessData | null>(null);
  const [error,       setError]       = useState<string | null>(null);
  const [rateInfo,    setRateInfo]    = useState<RateInfo | null>(null);
  const buttonsRendered = useRef(false);

  // ── Promo code state ──────────────────────────────────────────────
  const [promoCode,     setPromoCode]     = useState('');
  const [promoLoading,  setPromoLoading]  = useState(false);
  const [promoApplied,  setPromoApplied]  = useState(false);
  const [promoError,    setPromoError]    = useState<string | null>(null);
  const [discountedKRW, setDiscountedKRW] = useState<number | null>(null);
  const [savedAmount,   setSavedAmount]   = useState(0);
  const [couponDocId,   setCouponDocId]   = useState<string | null>(null);
  const [couponUserId,  setCouponUserId]  = useState<string | null>(null);
  const [pickerOpen,    setPickerOpen]    = useState(false);

  // \ubcf4\uc720 \ucfe0\ud3f0 \u2014 \ubbf8\ub85c\uadf8\uc778 \uc2dc hook\uc740 \uc548\uc804 (loyalty=null, coupons=[]).
  const { activeCoupons } = useLoyalty();

  const PROMO_LABELS: Record<string, Record<string, string>> = {
    ko: {
      label: '\ucfe0\ud3f0 \ucf54\ub4dc', apply: '\uc801\uc6a9', success: '\ud560\uc778 \uc801\uc6a9\ub428',
      invalid: '\uc720\ud6a8\ud558\uc9c0 \uc54a\uc740 \ucf54\ub4dc', expired: '\ud504\ub85c\ubaa8\uc158 \uc885\ub8cc',
      pickerOpen: '\ucfe0\ud3f0 \uc0ac\uc6a9\ud558\uae30',
      pickerEmpty: '\uc0ac\uc6a9 \uac00\ub2a5\ud55c \ucfe0\ud3f0\uc774 \uc5c6\uc5b4\uc694',
      adTitle: 'AI \ud50c\ub798\ub108 1\ud68c = 5% \ucfe0\ud3f0 1\uc7a5',
      adBody: '124,000\uc6d0 \ucc28\ub7c9 \uc608\uc57d = \uc57d 6,200\uc6d0 \uc808\uc57d. \ud50c\ub798\ub108($9.90) \uac70\uc758 \ubb34\ub8cc!',
      adCta: 'AI \ud50c\ub798\ub108 \ub9cc\ub4e4\uae30',
      saved: '\uc808\uc57d', expires: '\ub9cc\ub8cc',
    },
    en: {
      label: 'Promo code', apply: 'Apply', success: 'Discount applied',
      invalid: 'Invalid code', expired: 'Promotion ended',
      pickerOpen: 'Use a coupon',
      pickerEmpty: 'No coupons yet',
      adTitle: '1 AI plan = 1\u00d7 5% coupon',
      adBody: 'Book a \u20a9124,000 charter \u2248 \u20a96,200 saved. The planner ($9.90) pays for itself.',
      adCta: 'Make AI plan',
      saved: 'Saved', expires: 'Expires',
    },
    ja: {
      label: '\u30af\u30fc\u30dd\u30f3\u30b3\u30fc\u30c9', apply: '\u9069\u7528', success: '\u5272\u5f15\u9069\u7528',
      invalid: '\u7121\u52b9\u306a\u30b3\u30fc\u30c9', expired: '\u30d7\u30ed\u30e2\u7d42\u4e86',
      pickerOpen: '\u30af\u30fc\u30dd\u30f3\u3092\u4f7f\u3046',
      pickerEmpty: '\u4f7f\u3048\u308b\u30af\u30fc\u30dd\u30f3\u304c\u3042\u308a\u307e\u305b\u3093',
      adTitle: 'AI\u30d7\u30e9\u30f31\u56de = 5%\u30af\u30fc\u30dd\u30f3',
      adBody: '\u20a9124,000\u306e\u30c1\u30e3\u30fc\u30bf\u30fc\u4e88\u7d04 \u2245 \u20a96,200\u306e\u7bc0\u7d04\u3002\u30d7\u30e9\u30f3($9.90)\u306f\u307b\u307c\u7121\u6599\uff01',
      adCta: 'AI\u30d7\u30e9\u30f3\u4f5c\u6210',
      saved: '\u7bc0\u7d04', expires: '\u6709\u52b9\u671f\u9650',
    },
    zh: {
      label: '\u4f18\u60e0\u5238\u7801', apply: '\u5e94\u7528', success: '\u6298\u6263\u5df2\u5e94\u7528',
      invalid: '\u65e0\u6548\u4ee3\u7801', expired: '\u4fc3\u9500\u5df2\u7ed3\u675f',
      pickerOpen: '\u4f7f\u7528\u4f18\u60e0\u5238',
      pickerEmpty: '\u6682\u65e0\u53ef\u7528\u4f18\u60e0\u5238',
      adTitle: 'AI \u884c\u7a0b 1 \u6b21 = 5% \u4f18\u60e0\u5238',
      adBody: '\u9884\u8ba2 \u20a9124,000 \u5305\u8f66 \u2248 \u8282\u7701 \u20a96,200\uff0c\u884c\u7a0b($9.90)\u51e0\u4e4e\u514d\u8d39\uff01',
      adCta: '\u5236\u4f5c AI \u884c\u7a0b',
      saved: '\u8282\u7701', expires: '\u5230\u671f',
    },
  };
  const pl = PROMO_LABELS[lang] ?? PROMO_LABELS.en;

  async function applyCouponCode(code: string) {
    if (!code.trim()) return;
    setPromoLoading(true);
    setPromoError(null);
    try {
      const res = await fetch('/api/applyPromoCode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, productType, originalPrice: priceKRW }),
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


  const effectiveKRW = discountedKRW ?? priceKRW;

  // ── PayPal SDK 동적 로드 ─────────────────────────────────────────
  // 2026-05-03 사용자 신고: prod에서 SDK timeout 발생 + "다시 시도" 버튼이 실제로
  // 재로드를 안 함 → 같은 timeout 재발. loadPaypalSdk를 함수로 추출해 force=true
  // 모드 추가 (script element 강제 제거 후 재생성).
  function loadPaypalSdk(force = false) {
    const clientId = import.meta.env.VITE_PAYPAL_CLIENT_ID;
    console.log('[PayPal SDK] VITE_PAYPAL_CLIENT_ID:', clientId ? clientId.substring(0, 8) + '...' : '❌ 없음', '| force:', force);
    if (!clientId) {
      setError(p.paypalSdkError ?? 'PayPal client ID not configured.');
      return;
    }

    const expectedMode = isSandboxAccount ? 'sandbox' : 'live';
    let existing = document.getElementById('paypal-sdk') as HTMLScriptElement | null;

    if (existing) {
      const loadedMode = existing.dataset.mode ?? 'live';
      const mismatched = loadedMode !== expectedMode;
      if (force || mismatched) {
        console.log('[PayPal SDK] removing existing script (force:', force, '| mismatch:', mismatched, ')');
        existing.remove();
        try { delete window.paypal; } catch { /* ignore */ }
        setPaypalReady(false);
        existing = null;
      } else if (window.paypal) {
        setPaypalReady(true);
        return;
      } else {
        existing.addEventListener('load', () => setPaypalReady(true));
        return;
      }
    } else if (!force && window.paypal) {
      setPaypalReady(true);
      return;
    }

    const script = document.createElement('script');
    script.id   = 'paypal-sdk';
    script.dataset.mode = expectedMode;
    script.async = true;
    const sandboxClientId = import.meta.env.VITE_PAYPAL_SANDBOX_CLIENT_ID;
    const resolvedClientId = isSandboxAccount && sandboxClientId ? sandboxClientId : clientId;
    const sdkBase = isSandboxAccount && sandboxClientId
      ? 'https://www.sandbox.paypal.com/sdk/js'
      : 'https://www.paypal.com/sdk/js';
    // force=true 시 cache-buster 추가 (브라우저가 실패한 응답을 캐시한 경우 회피).
    const cacheBust = force ? `&_t=${Date.now()}` : '';
    const sdkUrl = `${sdkBase}?client-id=${resolvedClientId}&currency=USD&intent=capture&components=buttons&enable-funding=googlepay,applepay${cacheBust}`;
    script.src = sdkUrl;
    console.log('[PayPal SDK] loading mode:', expectedMode, '| clientId prefix:', resolvedClientId.substring(0, 8));
    script.onload = () => {
      script.dataset.loaded = 'true';
      setPaypalReady(true);
    };
    script.onerror = (err) => {
      console.error('PayPal SDK load error:', err);
      setError(p.paypalSdkError ?? 'Failed to load PayPal SDK. Disable ad blocker for this site and retry.');
    };
    document.body.appendChild(script);
  }

  // isSandboxAccount가 바뀔 때마다 재실행 — 이메일 입력 후 올바른 SDK 로드 보장
  useEffect(() => {
    loadPaypalSdk(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSandboxAccount]);

  // ── PayPal Buttons 렌더링 ────────────────────────────────────────
  useEffect(() => {
    if (!showPaypal || !paypalReady || !rateInfo || buttonsRendered.current) return;
    if (!window.paypal) return;

    buttonsRendered.current = true;

    const sharedConfig = {
      // 모바일 호환: 주문은 미리 생성됨 → ID만 동기 반환 (async 금지 — 모바일 팝업 차단 방지)
      createOrder: () => rateInfo.orderID,
      onApprove: async (data: { orderID: string }) => {
        try {
          const res = await fetch('/api/capturePaypalOrder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orderID:         data.orderID,
              product:         productType,
              tourDate:        dateStart,
              pickupLocation,
              dropoffLocation,
              paxCount:        passengers,
              vehicleType,
              memo,
              itineraryData:   itineraryData || null,
              userEmail,
              ...(airport ? { airport } : {}),
              ...(couponDocId ? { couponDocId, couponUserId } : {}),
            }),
          });
          const json = await res.json();
          console.log('[PayPal onApprove] capture result:', JSON.stringify(json));
          const isSuccess = json.ok === true;
          const result = json.data;
          if (isSuccess) {
            void posthogTrack('payment_completed', {
              planType: productType,
              amount: priceKRW,
              currency: 'KRW',
              planId: (result && typeof result === 'object' && 'planId' in result) ? (result as { planId?: string }).planId : undefined,
            });
            if (onPaymentSuccess) {
              setShowPaypal(false);
              await onPaymentSuccess(data.orderID);
              return;
            }
            setSuccessData(result);
            setShowSuccess(true);
            setShowPaypal(false);
          } else {
            const msg = json.error ?? result?.error ?? p.paypalError;
            console.error('[PayPal onApprove] 실패:', msg);
            void posthogTrack('payment_failed', { planType: productType, reason: 'capture_rejected' });
            setError(msg);
            setShowPaypal(false);
          }
        } catch (captureErr) {
          console.error('[PayPal onApprove] catch:', captureErr);
          void posthogTrack('payment_failed', { planType: productType, reason: 'capture_exception' });
          setError(captureErr instanceof Error ? captureErr.message : JSON.stringify(captureErr));
          setShowPaypal(false);
        }
      },
      onCancel: () => {
        setShowPaypal(false);
        buttonsRendered.current = false;
        setError(p.paypalCancel ?? null);
      },
      onError: (err: unknown) => {
        console.error('[PayPal SDK] onError:', err);
        void posthogTrack('payment_failed', { planType: productType, reason: 'sdk_error' });
        setError(err instanceof Error ? err.message : JSON.stringify(err));
        setShowPaypal(false);
        buttonsRendered.current = false;
      },
    };

    // layout:'vertical' → enable-funding=googlepay,applepay 로 활성화된
    // Google Pay / Apple Pay 를 자동으로 PayPal 버튼 아래 스택으로 표시.
    // 별도 fundingSource 렌더를 추가하면 중복 표시되므로 하나의 Buttons() 호출로 통합.
    window.paypal.Buttons({
      ...sharedConfig,
      style: { layout: 'vertical', color: 'blue', shape: 'rect', label: 'pay' },
    }).render(`#paypal-btn-${productType}`);
  }, [showPaypal, paypalReady, rateInfo]);

  // ── SDK 준비 대기 헬퍼 ─────────────────────────────────────────
  // 2026-05-03: 사용자 prod에서 SDK timeout 발생 — 10s가 모바일/저속망에서 부족.
  // 20초로 확대 (preconnect 추가로 평균 로드 시간 단축, 단 abuse 방어용 한계는 유지).
  function waitForPaypalReady(timeoutMs = 20000): Promise<boolean> {
    return new Promise((resolve) => {
      if (window.paypal) return resolve(true);
      const start = Date.now();
      const interval = setInterval(() => {
        if (window.paypal) { clearInterval(interval); resolve(true); }
        else if (Date.now() - start > timeoutMs) { clearInterval(interval); resolve(false); }
      }, 200);
    });
  }

  // ── 버튼 클릭 핸들러 — SDK 대기 + 주문 생성 + PayPal 버튼 표시 ──
  async function handleBookClick() {
    setError(null);
    setLoading(true);
    buttonsRendered.current = false;
    // Sprint 2 #7: payment_started — fired when user commits to checkout
    // (CTA click), before PayPal SDK opens. amount=USD price (priceKRW÷~1300).
    void posthogTrack('payment_started', {
      planType: productType,
      amount: priceKRW,
      currency: 'KRW',
    });
    try {
      // 1. SDK가 로딩 중이면 대기 (최대 10초)
      const sdkReady = await waitForPaypalReady();
      if (!sdkReady) {
        const sdkTimeoutMsg = (p as unknown as Record<string, string | undefined>).paypalSdkTimeout
          || 'PayPal SDK loading timeout. If you use an ad blocker (uBlock, Brave shields), please allow this site and refresh.';
        throw new Error(sdkTimeoutMsg);
      }

      // 2. 주문 생성
      const res = await fetch('/api/createPaypalOrder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productType, passengers, dateStart, dateEnd, language: lang,
          userEmail,
          ...(promoApplied ? { promoCode, discountedPrice: effectiveKRW } : {}),
        }),
      });
      const json = await res.json();
      const d = json.data;
      if (!res.ok || !json.ok) throw new Error(json.error ?? d?.error ?? 'Order creation failed');
      setRateInfo(d);
      setPaypalReady(true);
      setShowPaypal(true);
    } catch (err) {
      console.error('[PayPal handleBookClick] catch:', err);
      const msg = err instanceof Error ? err.message : JSON.stringify(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  // 예상 USD (rate 없을 때 간이 계산)
  const estimatedUSD = rateInfo
    ? rateInfo.displayUSD
    : `\u2248 $${(effectiveKRW / 1350).toFixed(2)} USD`;

  // ── 예약 확인 모달 (Premium Overlay) ──────────────────────────────
  if (showSuccess && successData) {
    const CONFIRM_LABELS: Record<string, Record<string, string>> = {
      ko: { title: '예약이 확정되었습니다!', subtitle: '예약 확인 이메일이 발송됩니다.', orderNo: '주문 번호', payer: '예약자', amount: '결제 금액', date: '이용 날짜', next: '다음 단계', step1: '확인 이메일을 확인하세요', step2: '카카오톡/WhatsApp으로 기사 정보를 보내드립니다', step3: '이용 당일 기사가 픽업 장소에서 대기합니다', close: '확인', contact: '문의하기' },
      en: { title: 'Booking Confirmed!', subtitle: 'A confirmation email will be sent shortly.', orderNo: 'Order No.', payer: 'Booked by', amount: 'Amount Paid', date: 'Service Date', next: 'Next Steps', step1: 'Check your confirmation email', step2: 'Driver details will be sent via WhatsApp/LINE', step3: 'Your driver will be waiting at the pickup location', close: 'Done', contact: 'Contact Us' },
      ja: { title: '予約が確定しました！', subtitle: '確認メールが送信されます。', orderNo: '注文番号', payer: '予約者', amount: '支払金額', date: '利用日', next: '次のステップ', step1: '確認メールをご確認ください', step2: 'ドライバー情報をWhatsApp/LINEでお送りします', step3: '当日ドライバーがピックアップ場所でお待ちします', close: '確認', contact: 'お問い合わせ' },
      zh: { title: '预订已确认！', subtitle: '确认邮件将很快发送。', orderNo: '订单号', payer: '预订人', amount: '支付金额', date: '服务日期', next: '下一步', step1: '请查收确认邮件', step2: '司机信息将通过WhatsApp/LINE发送', step3: '当天司机将在接机地点等候', close: '确认', contact: '联系我们' },
    };
    const cl = CONFIRM_LABELS[lang] ?? CONFIRM_LABELS.en;
    
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)' }}>
        <div className="w-full max-w-md bg-gradient-to-b from-[#0f1628] to-[#0a0f1a] rounded-3xl border border-[#7C5CFC]/30 shadow-[0_0_60px_rgba(124,92,252,0.15)] overflow-hidden animate-[fade-slide-up_0.4s_ease-out]">
          {/* Header with gradient */}
          <div className="relative px-6 pt-8 pb-6 text-center" style={{ background: 'linear-gradient(180deg, rgba(124,92,252,0.15) 0%, transparent 100%)' }}>
            <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-gradient-to-tr from-emerald-500 to-emerald-400 flex items-center justify-center shadow-[0_0_30px_rgba(16,185,129,0.3)]">
              <Check className="w-10 h-10 text-white" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-1">{cl.title}</h2>
            <p className="text-sm text-white/50">{cl.subtitle}</p>
          </div>
          
          {/* Booking Details */}
          <div className="px-6 pb-4">
            <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-4 space-y-3">
              <div className="flex justify-between items-center text-sm">
                <span className="text-white/55">{cl.orderNo}</span>
                <span className="font-mono text-white/80 text-xs bg-white/5 px-2 py-1 rounded-lg">{successData.orderID}</span>
              </div>
              {successData.payerName && (
                <div className="flex justify-between items-center text-sm">
                  <span className="text-white/55">{cl.payer}</span>
                  <span className="text-white/80">{successData.payerName}</span>
                </div>
              )}
              {successData.payerEmail && (
                <div className="flex justify-between items-center text-sm">
                  <span className="text-white/55">Email</span>
                  <span className="text-white/80 text-xs">{successData.payerEmail}</span>
                </div>
              )}
              {dateStart && (
                <div className="flex justify-between items-center text-sm">
                  <span className="text-white/55">{cl.date}</span>
                  <span className="text-white/80">{dateStart}{dateEnd && dateEnd !== dateStart ? ` ~ ${dateEnd}` : ''}</span>
                </div>
              )}
              <div className="flex justify-between items-center text-sm border-t border-white/[0.06] pt-3">
                <span className="text-white/55">{cl.amount}</span>
                <span className="text-xl font-bold text-emerald-400">${successData.amount} USD</span>
              </div>
            </div>
          </div>
          
          {/* Next Steps */}
          <div className="px-6 pb-4">
            <p className="text-[10px] uppercase tracking-widest text-white/55 font-semibold mb-3">{cl.next}</p>
            <div className="space-y-2">
              {[cl.step1, cl.step2, cl.step3].map((step, i) => (
                <div key={i} className="flex items-start gap-3 text-sm">
                  <span className="w-5 h-5 rounded-full bg-[#7C5CFC]/20 text-[#7C5CFC] flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">{i + 1}</span>
                  <span className="text-white/60 leading-relaxed">{step}</span>
                </div>
              ))}
            </div>
          </div>
          
          {/* Actions */}
          <div className="px-6 pb-6 flex gap-3">
            <a href="https://wa.me/821087140611" target="_blank" rel="noopener noreferrer"
              className="flex-1 py-3 rounded-xl border border-white/10 text-white/50 text-sm font-medium text-center hover:border-white/25 hover:text-white/70 transition-all">
              {cl.contact}
            </a>
            <button
              onClick={() => { setShowSuccess(false); setSuccessData(null); setRateInfo(null); }}
              className="flex-1 py-3 rounded-xl text-white font-bold text-sm transition-all hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #7C5CFC, #EA537E)' }}>
              {cl.close}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Coupon picker — replaces the legacy text-input. Closed: a single
          row "Use a coupon ▼". Open: list of the user's owned coupons; an
          empty state shows the AI-planner ad copy. Picking a card calls
          the existing /api/applyPromoCode with the coupon's code, so the
          backend stays unchanged. The legacy promoCode state is still
          populated downstream for purchase metadata back-compat. */}
      {!showPaypal && !promoApplied && (
        <div>
          <button
            type="button"
            onClick={() => { haptic('tap'); setPickerOpen(o => !o); }}
            aria-expanded={pickerOpen}
            className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-white/[0.06] border border-white/10 hover:border-[#7C5CFC]/40 hover:bg-white/[0.08] transition-all"
          >
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
            <div
              className="mt-2 space-y-2 overflow-hidden"
              style={{ animation: 'coupon-picker-in 0.25s ease-out' }}
            >
              <style>{`
                @keyframes coupon-picker-in {
                  from { opacity: 0; transform: translateY(-4px); }
                  to { opacity: 1; transform: translateY(0); }
                }
              `}</style>
              {activeCoupons.length === 0 ? (
                /* Ad: AI planner → 5% coupon. Math is per user spec. */
                <div className="rounded-xl border border-[#7C5CFC]/25 p-3.5"
                  style={{ background: 'linear-gradient(135deg, rgba(124,92,252,0.10), rgba(255,107,157,0.06))' }}>
                  <div className="flex items-start gap-2.5">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: 'linear-gradient(135deg, #B668FC, #FF6B9D)' }}>
                      <Sparkles className="w-4 h-4 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12.5px] font-bold text-white leading-tight">{pl.adTitle}</p>
                      <p className="text-[11px] text-white/65 leading-snug mt-1">{pl.adBody}</p>
                      <Link
                        to="/planner"
                        onClick={() => haptic('tap')}
                        className="mt-2.5 inline-flex items-center gap-1 text-[11px] font-bold text-[#B668FC] hover:text-[#FF6B9D] transition-colors"
                      >
                        {pl.adCta}
                        <ArrowRight className="w-3 h-3" />
                      </Link>
                    </div>
                  </div>
                  <p className="text-[10px] text-white/35 mt-2.5 pt-2.5 border-t border-white/[0.05]">
                    {pl.pickerEmpty}
                  </p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {activeCoupons.map(c => {
                    const valueLabel = c.type === 'percent' ? `${c.value}%` : (c.currency === 'KRW' ? `₩${c.value.toLocaleString()}` : `$${c.value}`);
                    const expDate = new Date(c.expiresAt).toLocaleDateString();
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => applyCouponCode(c.code)}
                          disabled={promoLoading}
                          className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] hover:border-[#7C5CFC]/40 hover:bg-white/[0.07] transition-all text-left disabled:opacity-50"
                        >
                          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-[#7C5CFC]/15 border border-[#7C5CFC]/25">
                            <Tag className="w-3.5 h-3.5 text-[#B668FC]" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-bold text-white truncate">{c.label}</p>
                            <p className="text-[10.5px] text-white/45 mt-0.5">{pl.expires}: {expDate}</p>
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
          <AlertCircle className="w-3.5 h-3.5" />
          {promoError}
        </div>
      )}
      {promoApplied && (
        <div className="flex items-center justify-between bg-emerald-500/10 border border-emerald-500/25 rounded-xl px-3 py-2">
          <div className="flex items-center gap-1.5 text-xs text-emerald-300">
            <Check className="w-3.5 h-3.5" />
            {pl.success} (-20%)
          </div>
          <span className="text-xs font-bold text-emerald-300">-\u20A9{savedAmount.toLocaleString('ko-KR')}</span>
        </div>
      )}

      {/* PayPal 버튼 패널 */}
      {showPaypal ? (
        <div className="rounded-xl overflow-hidden border border-white/10 p-3 bg-white/[0.03]">
          <div id={`paypal-btn-${productType}`} />
          {!paypalReady && (
            <div className="flex items-center justify-center gap-2 py-4 text-sm text-white/50">
              <div className="w-4 h-4 border-2 border-white/30 border-t-[#7C5CFC] rounded-full animate-spin" />
              Loading PayPal...
            </div>
          )}
        </div>
      ) : (
        /* 초기 예약 버튼 */
        <button
          type="button"
          disabled={loading}
          onClick={handleBookClick}
          className="w-full rounded-xl text-white font-medium transition-all duration-200 hover:opacity-90 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ background: '#0070BA', padding: '13px 20px' }}>
          {loading ? (
            <span className="flex items-center justify-center gap-2 text-sm">
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              {p.paypalLoading}
            </span>
          ) : (
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-sm font-semibold">{p.paypalBookBtn}</span>
              <div className="flex items-center gap-2">
                {promoApplied ? (
                  <>
                    <span className="text-[13px] text-white/55 line-through">\u20A9{priceKRW.toLocaleString('ko-KR')}</span>
                    <span className="text-[15px] font-bold text-emerald-300">\u20A9{effectiveKRW.toLocaleString('ko-KR')}</span>
                  </>
                ) : (
                  <span className="text-[15px] font-bold">{rateInfo?.displayKRW ?? `\u20A9${priceKRW.toLocaleString('ko-KR')}`}</span>
                )}
                <span className="text-xs text-white/70">{estimatedUSD}</span>
              </div>
              {rateInfo && (
                <span className="text-[11px] text-white/50 mt-0.5">
                  {p.paypalRateLabel} 1 USD = \u20A9{rateInfo.currentRate.toLocaleString('ko-KR')}
                </span>
              )}
            </div>
          )}
        </button>
      )}

      {/* 🧪 Sandbox 테스트 바이패스 — TEST_ACCOUNTS만 보임 */}
      {isSandboxAccount && onPaymentSuccess && (
        <button
          type="button"
          onClick={async () => {
            setLoading(true);
            setError(null);
            try {
              await onPaymentSuccess(`TEST-${Date.now()}`);
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Test payment failed');
            } finally {
              setLoading(false);
            }
          }}
          disabled={loading}
          className="w-full rounded-xl text-white font-medium transition-all duration-200 hover:opacity-90 active:scale-[0.99] disabled:opacity-50 mt-2"
          style={{ background: 'linear-gradient(135deg, #f59e0b, #ef4444)', padding: '13px 20px' }}
        >
          <div className="flex items-center justify-center gap-2 text-sm">
            <span>🧪</span>
            <span className="font-bold">Test Mode: Skip Payment → Generate AI Plan</span>
          </div>
        </button>
      )}

      {/* 에러 — 2026-05-03 fix: SDK timeout인 경우 단순 state reset이 아니라
           실제로 script element 강제 재로드. 이전 동작은 같은 timeout 무한 재발 */}
      {error && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-red-500/10 border border-red-500/30 px-4 py-3">
          <p className="text-sm text-red-300">{error}</p>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setShowPaypal(false);
              buttonsRendered.current = false;
              // SDK 재로드 (캐시 무효화 + script 재생성). 로드되면 paypalReady=true.
              loadPaypalSdk(true);
            }}
            className="shrink-0 text-xs text-red-400 border border-red-500/40 px-3 py-1.5 rounded-lg hover:bg-red-500/20 transition-colors">
            {p.paypalRetry}
          </button>
        </div>
      )}
    </div>
  );
}
