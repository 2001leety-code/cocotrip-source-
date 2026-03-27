import { useState, useEffect, useRef } from 'react';

interface Props {
  productType: string;
  passengers: number;
  dateStart?: string;
  dateEnd?: string;
  priceKRW: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  p: any;
  lang: string;
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

export function PayPalBookingButton({ productType, passengers, dateStart = '', dateEnd = '', priceKRW, p, lang }: Props) {
  const [paypalReady, setPaypalReady] = useState(false);
  const [loading,     setLoading]     = useState(false);
  const [showPaypal,  setShowPaypal]  = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [successData, setSuccessData] = useState<SuccessData | null>(null);
  const [error,       setError]       = useState<string | null>(null);
  const [rateInfo,    setRateInfo]    = useState<RateInfo | null>(null);
  const buttonsRendered = useRef(false);

  // ── PayPal SDK 동적 로드 ─────────────────────────────────────────
  useEffect(() => {
    const clientId = import.meta.env.VITE_PAYPAL_CLIENT_ID;
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
            body: JSON.stringify({ orderID: data.orderID }),
          });
          const result = await res.json();
          if (result.success) {
            setSuccessData(result);
            setShowSuccess(true);
            setShowPaypal(false);
          } else {
            setError(result.error ?? p.paypalError);
            setShowPaypal(false);
          }
        } catch {
          setError(p.paypalError);
          setShowPaypal(false);
        }
      },
      onCancel: () => {
        setShowPaypal(false);
        buttonsRendered.current = false;
        setError(p.paypalCancel);
      },
      onError: () => {
        setError(p.paypalError);
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
        body: JSON.stringify({ productType, passengers, dateStart, dateEnd, language: lang }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? 'Order creation failed');
      setRateInfo(data);
      setShowPaypal(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : p.paypalError);
    } finally {
      setLoading(false);
    }
  }

  // 예상 USD (rate 없을 때 간이 계산)
  const estimatedUSD = rateInfo
    ? rateInfo.displayUSD
    : `≈ $${(priceKRW / 1350).toFixed(2)} USD`;

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
      {/* PayPal 버튼 패널 */}
      {showPaypal ? (
        <div className="rounded-xl overflow-hidden border border-white/10 p-3 bg-white/[0.03]">
          <div id={`paypal-btn-${productType}`} />
        </div>
      ) : (
        /* 초기 예약 버튼 */
        <button
          type="button"
          disabled={loading || !paypalReady}
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
                <span className="text-[15px] font-bold">{rateInfo?.displayKRW ?? `₩${priceKRW.toLocaleString('ko-KR')}`}</span>
                <span className="text-xs text-white/70">{estimatedUSD}</span>
              </div>
              {rateInfo && (
                <span className="text-[11px] text-white/50 mt-0.5">
                  {p.paypalRateLabel} 1 USD = ₩{rateInfo.currentRate.toLocaleString('ko-KR')}
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
