import { useState, useEffect, useRef } from 'react';
import { Tag, Check, AlertCircle } from 'lucide-react';

interface Props {
  productType: string;
  passengers: number;
  dateStart?: string;
  dateEnd?: string;
  priceKRW: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  p: any;
  lang: string;
  pickupLocation?: string;
  dropoffLocation?: string;
  vehicleType?: string;
  memo?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  itineraryData?: any;
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    paypal?: any;
  }
}

export function PayPalBookingButton({ productType, passengers, dateStart = '', dateEnd = '', priceKRW, p, lang, pickupLocation = '', dropoffLocation = '', vehicleType = '', memo = '', itineraryData }: Props) {
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

  const PROMO_LABELS: Record<string, Record<string, string>> = {
    ko: { label: '\ud504\ub85c\ubaa8\uc158 \ucf54\ub4dc', apply: '\uc801\uc6a9', success: '\ud560\uc778 \uc801\uc6a9\ub428', invalid: '\uc720\ud6a8\ud558\uc9c0 \uc54a\uc740 \ucf54\ub4dc', expired: '\ud504\ub85c\ubaa8\uc158 \uc885\ub8cc' },
    en: { label: 'Promo code', apply: 'Apply', success: 'Discount applied', invalid: 'Invalid promo code', expired: 'Promotion ended' },
    ja: { label: '\u30d7\u30ed\u30e2\u30b3\u30fc\u30c9', apply: '\u9069\u7528', success: '\u5272\u5f15\u9069\u7528', invalid: '\u7121\u52b9\u306a\u30b3\u30fc\u30c9', expired: '\u30d7\u30ed\u30e2\u7d42\u4e86' },
    zh: { label: '\u4fc3\u9500\u7801', apply: '\u5e94\u7528', success: '\u6298\u6263\u5df2\u5e94\u7528', invalid: '\u65e0\u6548\u4fc3\u9500\u7801', expired: '\u4fc3\u9500\u5df2\u7ed3\u675f' },
  };
  const pl = PROMO_LABELS[lang] ?? PROMO_LABELS.en;

  async function handleApplyPromo() {
    if (!promoCode.trim()) return;
    setPromoLoading(true);
    setPromoError(null);
    try {
      const res = await fetch('/.netlify/functions/applyPromoCode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: promoCode, productType, originalPrice: priceKRW }),
      });
      const data = await res.json();
      if (data.valid) {
        setDiscountedKRW(data.discountedPrice);
        setSavedAmount(data.savedAmount);
        setPromoApplied(true);
      } else {
        setPromoError(data.error === 'promo_expired' ? pl.expired : pl.invalid);
      }
    } catch {
      setPromoError(pl.invalid);
    } finally {
      setPromoLoading(false);
    }
  }

  const effectiveKRW = discountedKRW ?? priceKRW;

  // ── PayPal SDK 동적 로드 ─────────────────────────────────────────
  useEffect(() => {
    const clientId = import.meta.env.VITE_PAYPAL_CLIENT_ID;
    console.log('[PayPal SDK] VITE_PAYPAL_CLIENT_ID:', clientId ? clientId.substring(0, 8) + '...' : '❌ 없음');
    console.log('[PayPal SDK] paypalReady:', paypalReady, '| window.paypal:', !!window.paypal);
    if (!clientId) return;

    if (window.paypal) {
      setPaypalReady(true);
      return;
    }
    if (document.getElementById('paypal-sdk')) {
      const existing = document.getElementById('paypal-sdk') as HTMLScriptElement;
      if (existing.dataset.loaded) { setPaypalReady(true); return; }
      existing.addEventListener('load', () => setPaypalReady(true));
      return;
    }
    const script = document.createElement('script');
    script.id  = 'paypal-sdk';
    script.src = `https://www.paypal.com/sdk/js?client-id=${clientId}&currency=USD`;
    script.onload = () => {
      (script as HTMLScriptElement).dataset.loaded = 'true';
      setPaypalReady(true);
    };
    script.onerror = (err) => {
      console.error('PayPal SDK 로딩 실패:', err);
      setError('PayPal SDK 로딩 실패');
    };
    document.body.appendChild(script);
  }, []);

  // ── PayPal Buttons 렌더링 ────────────────────────────────────────
  useEffect(() => {
    if (!showPaypal || !paypalReady || !rateInfo || buttonsRendered.current) return;
    if (!window.paypal) return;

    const containerId = `paypal-btn-${productType}`;
    buttonsRendered.current = true;

    window.paypal.Buttons({
      createOrder: () => rateInfo.orderID,
      onApprove: async (data: { orderID: string }) => {
        try {
          const res = await fetch('/.netlify/functions/capturePaypalOrder', {
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
            }),
          });
          const result = await res.json();
          console.log('[PayPal onApprove] capture result:', JSON.stringify(result));
          if (result.success) {
            setSuccessData(result);
            setShowSuccess(true);
            setShowPaypal(false);
          } else {
            const msg = result.error ?? p.paypalError;
            console.error('[PayPal onApprove] 실패:', msg);
            setError(msg);
            setShowPaypal(false);
          }
        } catch (captureErr) {
          console.error('[PayPal onApprove] catch:', captureErr);
          setError(captureErr instanceof Error ? captureErr.message : JSON.stringify(captureErr));
          setShowPaypal(false);
        }
      },
      onCancel: () => {
        setShowPaypal(false);
        buttonsRendered.current = false;
        setError(p.paypalCancel);
      },
      onError: (err: unknown) => {
        console.error('[PayPal SDK] onError:', err);
        setError(err instanceof Error ? err.message : JSON.stringify(err));
        setShowPaypal(false);
        buttonsRendered.current = false;
      },
      style: {
        layout: 'vertical',
        color:  'blue',
        shape:  'rect',
        label:  'pay',
      },
    }).render(`#${containerId}`);
  }, [showPaypal, paypalReady, rateInfo]);

  // ── 버튼 클릭 핸들러 ────────────────────────────────────────────
  async function handleBookClick() {
    setError(null);
    setLoading(true);
    buttonsRendered.current = false;
    try {
      const res = await fetch('/.netlify/functions/createPaypalOrder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productType, passengers, dateStart, dateEnd, language: lang,
          ...(promoApplied ? { promoCode, discountedPrice: effectiveKRW } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? 'Order creation failed');
      setRateInfo(data);
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

  // ── 성공 모달 ────────────────────────────────────────────────────
  if (showSuccess && successData) {
    return (
      <div className="rounded-2xl border border-green-500/30 bg-green-500/10 p-5 text-center space-y-3">
        <p className="text-2xl">✅</p>
        <p className="font-bold text-green-300 text-base">{p.paypalSuccess}</p>
        <p className="text-sm text-white/60">{p.paypalSuccessMsg}</p>
        <div className="bg-white/5 rounded-xl p-3 text-left space-y-1 text-xs text-white/55">
          <p><span className="text-white/35">{p.paypalOrderNo}:</span> <span className="font-mono text-white/70">{successData.orderID}</span></p>
          {successData.payerName  && <p><span className="text-white/35">{p.paypalPayer}:</span> <span className="text-white/70">{successData.payerName}</span></p>}
          {successData.payerEmail && <p><span className="text-white/35">Email:</span> <span className="text-white/70">{successData.payerEmail}</span></p>}
          <p><span className="text-white/35">Amount:</span> <span className="font-semibold text-green-300">${successData.amount} USD</span></p>
        </div>
        <button
          onClick={() => { setShowSuccess(false); setSuccessData(null); setRateInfo(null); }}
          className="px-6 py-2 rounded-xl bg-green-500/20 border border-green-500/40 text-green-300 text-sm font-medium hover:bg-green-500/30 transition-colors">
          OK
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Promo Code Input */}
      {!showPaypal && !promoApplied && (
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Tag className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
            <input
              type="text"
              value={promoCode}
              onChange={e => setPromoCode(e.target.value.toUpperCase())}
              placeholder="EARLY50"
              className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-white/[0.06] border border-white/10 text-sm text-white placeholder:text-white/25 outline-none focus:border-[#7C5CFC]/50 transition-colors"
            />
          </div>
          <button
            type="button"
            onClick={handleApplyPromo}
            disabled={promoLoading || !promoCode.trim()}
            className="px-4 py-2.5 rounded-xl text-xs font-bold text-white border border-[#7C5CFC]/40 bg-[#7C5CFC]/15 hover:bg-[#7C5CFC]/25 disabled:opacity-40 transition-all"
          >
            {promoLoading ? '...' : pl.apply}
          </button>
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
                    <span className="text-[13px] text-white/40 line-through">\u20A9{priceKRW.toLocaleString('ko-KR')}</span>
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

      {/* 에러 */}
      {error && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-red-500/10 border border-red-500/30 px-4 py-3">
          <p className="text-sm text-red-300">{error}</p>
          <button
            type="button"
            onClick={() => { setError(null); setShowPaypal(false); buttonsRendered.current = false; }}
            className="shrink-0 text-xs text-red-400 border border-red-500/40 px-3 py-1.5 rounded-lg hover:bg-red-500/20 transition-colors">
            {p.paypalRetry}
          </button>
        </div>
      )}
    </div>
  );
}
