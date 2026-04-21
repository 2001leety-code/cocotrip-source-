import { useState, useEffect, useRef } from 'react';
import { Tag, Check, AlertCircle } from 'lucide-react';

interface Props {
  productType: string;
  passengers: number;
  dateStart?: string;
  dateEnd?: string;
  priceKRW: number;
  p: Record<string, string | undefined>;
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
    paypal?: Record<string, unknown> & {
      Buttons: (config: Record<string, unknown>) => { render: (selector: string) => void };
    };
  }
}

const TEST_ACCOUNTS = ['2001leety@gmail.com'];

export function PayPalBookingButton({ productType, passengers, dateStart = '', dateEnd = '', priceKRW, p, lang, pickupLocation = '', dropoffLocation = '', vehicleType = '', memo = '', itineraryData, onPaymentSuccess, userEmail = '' }: Props) {
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
      const res = await fetch('/api/applyPromoCode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: promoCode, productType, originalPrice: priceKRW }),
      });
      const data = await res.json();
      if (data.valid) {
        setDiscountedKRW(data.discountedPrice);
        setSavedAmount(data.savedAmount);
        setPromoApplied(true);
        setCouponDocId(data.couponDocId || null);
        setCouponUserId(data.userId || null);
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
  // isSandboxAccount가 바뀔 때마다 재실행 — 이메일 입력 후 올바른 SDK 로드 보장
  useEffect(() => {
    const clientId = import.meta.env.VITE_PAYPAL_CLIENT_ID;
    console.log('[PayPal SDK] VITE_PAYPAL_CLIENT_ID:', clientId ? clientId.substring(0, 8) + '...' : '❌ 없음');
    if (!clientId) return;

    const expectedMode = isSandboxAccount ? 'sandbox' : 'live';
    const existing = document.getElementById('paypal-sdk') as HTMLScriptElement | null;

    // 기존 스크립트가 다른 모드로 로드됐으면 제거 후 재로드
    if (existing) {
      const loadedMode = existing.dataset.mode ?? 'live';
      if (loadedMode !== expectedMode) {
        console.log('[PayPal SDK] mode mismatch (was', loadedMode, '→ need', expectedMode, '), reloading SDK');
        existing.remove();
        delete window.paypal;
        setPaypalReady(false);
      } else if (window.paypal) {
        setPaypalReady(true);
        return;
      } else {
        existing.addEventListener('load', () => setPaypalReady(true));
        return;
      }
    } else if (window.paypal) {
      setPaypalReady(true);
      return;
    }

    const script = document.createElement('script');
    script.id   = 'paypal-sdk';
    script.dataset.mode = expectedMode;
    const sandboxClientId = import.meta.env.VITE_PAYPAL_SANDBOX_CLIENT_ID;
    const resolvedClientId = isSandboxAccount && sandboxClientId ? sandboxClientId : clientId;
    const sdkBase = isSandboxAccount && sandboxClientId
      ? 'https://www.sandbox.paypal.com/sdk/js'
      : 'https://www.paypal.com/sdk/js';
    const sdkUrl = `${sdkBase}?client-id=${resolvedClientId}&currency=USD&intent=capture&components=buttons`;
    script.src = sdkUrl;
    console.log('[PayPal SDK] loading mode:', expectedMode, '| clientId prefix:', resolvedClientId.substring(0, 8));
    script.onload = () => {
      script.dataset.loaded = 'true';
      setPaypalReady(true);
    };
    script.onerror = (err) => {
      console.error('PayPal SDK load error:', err);
      setError(p.paypalSdkError ?? 'Failed to load PayPal SDK.');
    };
    document.body.appendChild(script);
  }, [isSandboxAccount]);

  // ── PayPal Buttons 렌더링 ────────────────────────────────────────
  useEffect(() => {
    if (!showPaypal || !paypalReady || !rateInfo || buttonsRendered.current) return;
    if (!window.paypal) return;

    const containerId = `paypal-btn-${productType}`;
    buttonsRendered.current = true;

    window.paypal.Buttons({
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
              ...(couponDocId ? { couponDocId, couponUserId } : {}),
            }),
          });
          const result = await res.json();
          console.log('[PayPal onApprove] capture result:', JSON.stringify(result));
          if (result.success) {
            if (onPaymentSuccess) {
              setShowPaypal(false);
              await onPaymentSuccess(data.orderID);
              return;
            }
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

  // ── SDK 준비 대기 헬퍼 ─────────────────────────────────────────
  function waitForPaypalReady(timeoutMs = 10000): Promise<boolean> {
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
    try {
      // 1. SDK가 로딩 중이면 대기 (최대 10초)
      const sdkReady = await waitForPaypalReady();
      if (!sdkReady) throw new Error('PayPal SDK loading timeout. Please refresh and try again.');

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
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? 'Order creation failed');
      setRateInfo(data);
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
      en: { title: 'Booking Confirmed!', subtitle: 'A confirmation email will be sent shortly.', orderNo: 'Order No.', payer: 'Booked by', amount: 'Amount Paid', date: 'Service Date', next: 'Next Steps', step1: 'Check your confirmation email', step2: 'Driver details will be sent via KakaoTalk/WhatsApp', step3: 'Your driver will be waiting at the pickup location', close: 'Done', contact: 'Contact Us' },
      ja: { title: '予約が確定しました！', subtitle: '確認メールが送信されます。', orderNo: '注文番号', payer: '予約者', amount: '支払金額', date: '利用日', next: '次のステップ', step1: '確認メールをご確認ください', step2: 'ドライバー情報をKakaoTalk/WhatsAppでお送りします', step3: '当日ドライバーがピックアップ場所でお待ちします', close: '確認', contact: 'お問い合わせ' },
      zh: { title: '预订已确认！', subtitle: '确认邮件将很快发送。', orderNo: '订单号', payer: '预订人', amount: '支付金额', date: '服务日期', next: '下一步', step1: '请查收确认邮件', step2: '司机信息将通过KakaoTalk/WhatsApp发送', step3: '当天司机将在接机地点等候', close: '确认', contact: '联系我们' },
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
                <span className="text-white/40">{cl.orderNo}</span>
                <span className="font-mono text-white/80 text-xs bg-white/5 px-2 py-1 rounded-lg">{successData.orderID}</span>
              </div>
              {successData.payerName && (
                <div className="flex justify-between items-center text-sm">
                  <span className="text-white/40">{cl.payer}</span>
                  <span className="text-white/80">{successData.payerName}</span>
                </div>
              )}
              {successData.payerEmail && (
                <div className="flex justify-between items-center text-sm">
                  <span className="text-white/40">Email</span>
                  <span className="text-white/80 text-xs">{successData.payerEmail}</span>
                </div>
              )}
              {dateStart && (
                <div className="flex justify-between items-center text-sm">
                  <span className="text-white/40">{cl.date}</span>
                  <span className="text-white/80">{dateStart}{dateEnd && dateEnd !== dateStart ? ` ~ ${dateEnd}` : ''}</span>
                </div>
              )}
              <div className="flex justify-between items-center text-sm border-t border-white/[0.06] pt-3">
                <span className="text-white/40">{cl.amount}</span>
                <span className="text-xl font-bold text-emerald-400">${successData.amount} USD</span>
              </div>
            </div>
          </div>
          
          {/* Next Steps */}
          <div className="px-6 pb-4">
            <p className="text-[10px] uppercase tracking-widest text-white/30 font-semibold mb-3">{cl.next}</p>
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
