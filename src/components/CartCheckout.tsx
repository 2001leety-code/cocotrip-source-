/**
 * CartCheckout — 장바구니 멀티상품 결제 (PR2e, cart sum-one-order 마지막 단계).
 *   createCartOrder(items) → PayPal Buttons → captureCartOrder → 성공(cart clear).
 *
 * PayPalBookingButton SDK 패턴 차용 — v1 간소 로더(전역 #paypal-sdk 재사용). sandbox/force/
 * ad-blocker edge case 는 PayPalBookingButton 과 동일 처리로 후속. 부모(CartPanel)가
 * isCartEnabled 게이트 → flag OFF 면 미렌더. 실 캡처는 운영자 실 PayPal e2e 로 검증.
 */
import { useState, useEffect, useRef } from 'react';
import { useCart } from '@/hooks/useCart';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';

type PaypalButtonsApi = { Buttons: (cfg: Record<string, unknown>) => { render: (sel: string) => void } };
function getPaypal(): PaypalButtonsApi | undefined {
  return (window as unknown as { paypal?: PaypalButtonsApi }).paypal;
}

type Status = 'idle' | 'creating' | 'ready' | 'processing' | 'success' | 'error';

export function CartCheckout({ onClose }: { onClose: () => void }) {
  const { items, clear } = useCart();
  const { user } = useAuth();
  const { t } = useLanguage();
  const c = (t as { cart?: Record<string, string> }).cart || {};
  const [orderID, setOrderID] = useState<string | null>(null);
  const [total, setTotal] = useState<{ usd: string; krw: number } | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [paypalReady, setPaypalReady] = useState(false);
  const rendered = useRef(false);

  // 1) 주문 생성 — 결제 직전 backend SSOT 재계산 (client priceKRW 무시).
  async function createOrder() {
    setStatus('creating'); setError(null);
    try {
      const res = await fetch('/api/createCartOrder', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, userEmail: user?.email || '' }),
      });
      const json = await res.json();
      if (json.ok && json.data && json.data.orderID) {
        setOrderID(json.data.orderID);
        setTotal({ usd: json.data.usdAmount, krw: json.data.totalKRW });
        setStatus('ready');
        loadSdk();
      } else {
        setError(json.error || 'Cart order failed');
        setStatus('error');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'error');
      setStatus('error');
    }
  }

  // 2) PayPal SDK 로드 (전역 #paypal-sdk 재사용 간소 로더).
  function loadSdk() {
    if (getPaypal()) { setPaypalReady(true); return; }
    const existing = document.getElementById('paypal-sdk') as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => { if (getPaypal()) setPaypalReady(true); });
      return;
    }
    const clientId = import.meta.env.VITE_PAYPAL_CLIENT_ID;
    if (!clientId) { setError('PayPal client ID not configured'); setStatus('error'); return; }
    const s = document.createElement('script');
    s.id = 'paypal-sdk'; s.async = true; s.dataset.mode = 'live';
    s.src = `https://www.paypal.com/sdk/js?client-id=${clientId}&currency=USD&intent=capture&components=buttons`;
    s.onload = () => {
      if (getPaypal()) setPaypalReady(true);
      else { setError('PayPal blocked (ad blocker?). Disable shields and retry.'); setStatus('error'); }
    };
    s.onerror = () => { setError('Failed to load PayPal SDK'); setStatus('error'); };
    document.body.appendChild(s);
  }

  // 3) PayPal Buttons 렌더 (orderID + SDK ready).
  useEffect(() => {
    const pp = getPaypal();
    if (!orderID || !paypalReady || rendered.current || !pp) return;
    rendered.current = true;
    pp.Buttons({
      createOrder: () => orderID,
      onApprove: async (data: { orderID: string }) => {
        setStatus('processing');
        try {
          const res = await fetch('/api/captureCartOrder', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderID: data.orderID, userEmail: user?.email || '' }),
          });
          const json = await res.json();
          if (json.ok) { setStatus('success'); await clear(); }
          else { setError(json.error || 'Capture failed'); setStatus('error'); }
        } catch (e) {
          setError(e instanceof Error ? e.message : 'capture error');
          setStatus('error');
        }
      },
      onCancel: () => { setStatus('ready'); rendered.current = false; },
      onError: (err: unknown) => { setError(err instanceof Error ? err.message : String(err)); setStatus('error'); rendered.current = false; },
      style: { layout: 'vertical', color: 'blue', shape: 'rect', label: 'pay' },
    }).render('#cart-paypal-btn');
  }, [orderID, paypalReady]); // eslint-disable-line react-hooks/exhaustive-deps

  if (status === 'success') {
    return (
      <div className="p-6 text-center">
        <div className="text-4xl mb-3">✅</div>
        <p className="text-white font-semibold mb-1">{c.checkoutDone || 'Booking confirmed!'}</p>
        <p className="text-white/55 text-sm mb-5">{c.checkoutDoneSub || 'Confirmation emails are on the way.'}</p>
        <button onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-[#7C5CFC] text-white">
          {c.close || 'Done'}
        </button>
      </div>
    );
  }

  return (
    <div className="p-5">
      {total && (
        <div className="mb-4 flex items-baseline justify-between">
          <span className="text-white/70 text-sm">{c.total || 'Total'}</span>
          <span className="text-white font-bold text-lg">${total.usd} <span className="text-white/45 text-xs">({total.krw.toLocaleString('ko-KR')}원)</span></span>
        </div>
      )}

      {status === 'idle' && (
        <button onClick={createOrder} disabled={items.length === 0}
          className="w-full py-3 rounded-xl text-sm font-bold text-white bg-[#7C5CFC] hover:bg-[#6a4ce0] transition-colors disabled:opacity-50">
          {c.checkout || 'Proceed to checkout'}
        </button>
      )}
      {status === 'creating' && (
        <div className="flex items-center justify-center py-6 text-white/55 text-sm gap-2">
          <div className="w-4 h-4 border-2 border-[#7C5CFC] border-t-transparent animate-spin rounded-full" />
          {c.preparing || 'Preparing order...'}
        </div>
      )}
      {/* PayPal Buttons 마운트 지점 */}
      <div id="cart-paypal-btn" className={status === 'ready' ? 'mt-2' : 'hidden'} />
      {status === 'ready' && !paypalReady && (
        <p className="text-white/45 text-xs text-center mt-2">{c.loadingPay || 'Loading payment...'}</p>
      )}
      {status === 'processing' && (
        <div className="flex items-center justify-center py-6 text-white/55 text-sm gap-2">
          <div className="w-4 h-4 border-2 border-[#7C5CFC] border-t-transparent animate-spin rounded-full" />
          {c.processing || 'Confirming payment...'}
        </div>
      )}
      {error && (
        <p className="text-red-400/80 text-xs text-center mt-3">{error}</p>
      )}
    </div>
  );
}
