/**
 * CartCheckout — 장바구니 멀티상품 결제 (PR2e, cart sum-one-order 마지막 단계).
 *   검수(각 항목 전체 내역 확인) → createCartOrder(items) → PayPal Buttons → captureCartOrder → 성공(cart clear).
 *
 * 2026-06-11: 결제 전 "검수" 단계 추가 (운영자 "전체 내역 보여주고 맞습니까 확인시키고 결제").
 *   항목별 booking 상세(날짜·인원·경로·차종·픽업·요청사항·기간) 표시 + 확인 후 결제. 단건 차터 검수편집의 cart 버전.
 *   ⚠️ 연락처(이름/전화)는 CartItemBooking 에 미저장 → 표시 안 함(후속: cart 아이템에 연락처 추가).
 *
 * PayPalBookingButton SDK 패턴 차용 — v1 간소 로더(전역 #paypal-sdk 재사용). 부모(CartPanel)가
 * isCartEnabled 게이트 → flag OFF 면 미렌더. 실 캡처는 운영자 실 PayPal e2e 로 검증.
 */
import { useState, useEffect, useRef } from 'react';
import { useCart } from '@/hooks/useCart';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import type { CartItemBooking } from '@/lib/cart-types';

type PaypalButtonsApi = { Buttons: (cfg: Record<string, unknown>) => { render: (sel: string) => void } };
function getPaypal(): PaypalButtonsApi | undefined {
  return (window as unknown as { paypal?: PaypalButtonsApi }).paypal;
}

// 🔴 'review' = 결제는 캡처됐지만 서버 무결성 검증 불일치 → 예약 미확정(PAYMENT_REVIEW).
//   success/error 와 반드시 구분: success 표시 = 미확정 예약 오인, error 표시 = 재결제 → 이중청구.
type Status = 'idle' | 'creating' | 'ready' | 'processing' | 'success' | 'review' | 'error';

// ── 검수 라벨 (인라인 4-lang — locale JSON 무수정) ──
type Lang = 'en' | 'ko' | 'ja' | 'zh';
type L4 = { ko: string; en: string; ja: string; zh: string };
const DETAIL_LABELS: Record<string, L4> = {
  date:    { ko: '날짜', en: 'Date', ja: '日付', zh: '日期' },
  pax:     { ko: '인원', en: 'Travelers', ja: '人数', zh: '人数' },
  route:   { ko: '경로', en: 'Route', ja: 'ルート', zh: '路线' },
  days:    { ko: '기간(일)', en: 'Days', ja: '日数', zh: '天数' },
  vehicle: { ko: '차종', en: 'Vehicle', ja: '車種', zh: '车型' },
  pickup:  { ko: '픽업', en: 'Pickup', ja: 'ピックアップ', zh: '接送' },
  notes:   { ko: '요청사항', en: 'Notes', ja: 'ご要望', zh: '备注' },
};
const REVIEW_TEXT: Record<string, L4> = {
  title:   { ko: '예약 내역 확인', en: 'Review your booking', ja: '予約内容の確認', zh: '确认预订内容' },
  sub:     { ko: '아래 내용이 모두 맞는지 확인 후 결제해 주세요.', en: 'Please check every detail below before paying.', ja: '以下の内容をご確認のうえお支払いください。', zh: '请确认以下所有内容后再付款。' },
  confirm: { ko: '내용 확인 — 결제 진행', en: 'Confirm & pay', ja: '確認して支払う', zh: '确认并付款' },
  back:    { ko: '← 장바구니 수정', en: '← Edit cart', ja: '← カートを編集', zh: '← 编辑购物车' },
  totalPending: { ko: '결제 진행 시 확정', en: 'Shown at payment', ja: 'お支払い時に確定', zh: '付款时确认' },
};
function pickLang(language: string): Lang {
  return language === 'ko' || language === 'ja' || language === 'zh' ? language : 'en';
}
/** booking 의 채워진 필드만 라벨/값 쌍으로 (검수 표시용). */
function formatBookingDetails(b: CartItemBooking, language: string): { label: string; value: string; full?: boolean }[] {
  const lng = pickLang(language);
  const rows: { label: string; value: string; full?: boolean }[] = [];
  const lab = (m: L4) => m[lng];
  if (b.dateStart) {
    let d = b.dateStart;
    if (b.dateEnd && b.dateEnd !== b.dateStart) d += ` ~ ${b.dateEnd}`;
    rows.push({ label: lab(DETAIL_LABELS.date), value: d });
  }
  if (b.passengers) rows.push({ label: lab(DETAIL_LABELS.pax), value: String(b.passengers) });
  if (b.originKey && b.destKey) rows.push({ label: lab(DETAIL_LABELS.route), value: `${b.originKey} → ${b.destKey}` });
  if (b.durationDays && b.durationDays > 1) rows.push({ label: lab(DETAIL_LABELS.days), value: String(b.durationDays) });
  const veh = b.vehicle || b.vehicleType;
  if (veh) rows.push({ label: lab(DETAIL_LABELS.vehicle), value: veh });
  if (b.pickupLocation) rows.push({ label: lab(DETAIL_LABELS.pickup), value: b.pickupLocation });
  if (b.memo) rows.push({ label: lab(DETAIL_LABELS.notes), value: b.memo, full: true });
  return rows;
}

export function CartCheckout({ onClose, onBack }: { onClose: () => void; onBack?: () => void }) {
  const { items, clear } = useCart();
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const c = (t as { cart?: Record<string, string> }).cart || {};
  const lng = pickLang(language);
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
    // sandbox/live — PayPalBookingButton 과 동일 토글. preview(sandbox)에서 cart 결제가 live SDK 로
    // 떠서 "Things don't appear to be working" 나던 버그 fix (2026-06-11). 단건 결제가 다른 모드로
    // 먼저 로드했으면 제거 후 올바른 모드로 재로드(전역 #paypal-sdk 공유).
    const sandboxMode = import.meta.env.VITE_PAYPAL_ENV === 'sandbox';
    const clientId = sandboxMode ? import.meta.env.VITE_PAYPAL_SANDBOX_CLIENT_ID : import.meta.env.VITE_PAYPAL_CLIENT_ID;
    const expectedMode = sandboxMode ? 'sandbox' : 'live';
    if (!clientId) { setError('PayPal client ID not configured'); setStatus('error'); return; }
    const existing = document.getElementById('paypal-sdk') as HTMLScriptElement | null;
    if (existing && existing.dataset.mode !== expectedMode) {
      existing.remove();
      (window as unknown as { paypal?: unknown }).paypal = undefined;
    } else if (getPaypal()) {
      setPaypalReady(true); return;
    } else if (existing) {
      existing.addEventListener('load', () => { if (getPaypal()) setPaypalReady(true); });
      return;
    }
    const s = document.createElement('script');
    s.id = 'paypal-sdk'; s.async = true; s.dataset.mode = expectedMode;
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
          // 🔴 결제 캡처됨 + 무결성 불일치 → 예약 미확정(HTTP 202). 성공으로 표시하면 미확정 예약을
          //   확정으로 오인시키고, 실패로 표시하면 사용자가 재결제해 이중청구가 된다 → 전용 상태.
          //   장바구니는 비운다 — 남겨두면 같은 항목으로 재결제할 수 있어 중복 결제 위험.
          if (json.finalized === false || json.bookingStatus === 'PAYMENT_REVIEW') {
            setStatus('review'); await clear();
          }
          else if (json.ok) { setStatus('success'); await clear(); }
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

  // 🔴 결제 접수 · 예약 확인 중 — "확정" 표현 금지 + 재결제 만류(이중청구 방지).
  if (status === 'review') {
    return (
      <div className="cocotrip-mobile-cart-checkout p-6 text-center">
        <div className="text-4xl mb-3" aria-hidden="true">🕒</div>
        <p className="text-white font-semibold mb-1">{c.checkoutReview || 'Payment received'}</p>
        <p className="text-white/55 text-sm mb-3">
          {c.checkoutReviewSub || 'Your booking is pending verification. We will contact you by email once confirmed.'}
        </p>
        <p className="text-amber-300 text-xs mb-5 bg-amber-500/10 border border-amber-400/30 rounded-xl px-3 py-2">
          {c.checkoutReviewWarn || 'Please do not pay again — it may result in a duplicate charge.'}
        </p>
        <button onClick={onClose} className="px-5 py-2.5 min-h-[44px] rounded-xl text-sm font-semibold bg-[#7C5CFC] text-white">
          {c.close || 'Done'}
        </button>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="cocotrip-mobile-cart-checkout p-6 text-center">
        <div className="text-4xl mb-3">✅</div>
        <p className="text-white font-semibold mb-1">{c.checkoutDone || 'Booking confirmed!'}</p>
        <p className="text-white/55 text-sm mb-5">{c.checkoutDoneSub || 'Confirmation emails are on the way.'}</p>
        <button onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-[#7C5CFC] text-white">
          {c.close || 'Done'}
        </button>
      </div>
    );
  }

  const displaySumUSD = items.reduce((s, it) => s + (Number(it.priceUSD) || 0), 0);
  const displaySumKRW = items.reduce((s, it) => s + (Number(it.priceKRW) || 0), 0);

  return (
    <div className="cocotrip-mobile-cart-checkout p-5">
      {/* 검수 헤더 */}
      <div className="mb-3">
        <p className="text-white font-semibold text-sm">{REVIEW_TEXT.title[lng]}</p>
        <p className="text-white/50 text-xs mt-0.5">{REVIEW_TEXT.sub[lng]}</p>
      </div>

      {/* 항목별 전체 내역 (검수) */}
      <div className="space-y-2.5 mb-4">
        {items.map((item) => (
          <div key={item.id} className="bg-white/[0.04] rounded-xl p-3 border border-white/5">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-white text-sm font-medium break-words">{item.displayName}</p>
              {item.priceUSD ? <span className="text-[#C4956A] text-sm font-semibold shrink-0">${item.priceUSD}</span> : null}
            </div>
            <div className="mt-2 space-y-1.5">
              {formatBookingDetails(item.booking, language).map((row, i) => (
                row.full ? (
                  // 긴 메모/요청사항 — 우측 좁은 칸 X, 전체폭 stacked + " | " 줄바꿈으로 가독성.
                  <div key={i} className="text-xs pt-1 border-t border-white/5">
                    <span className="text-white/60 block mb-1">{row.label}</span>
                    <ol className="text-white/90 leading-relaxed space-y-0.5">
                      {row.value.split(' | ').map((part, j) => (
                        <li key={j} className="flex gap-1.5">
                          <span className="text-white/45 shrink-0 tabular-nums">{j + 1}.</span>
                          <span className="break-words">{part}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : (
                  <div key={i} className="flex justify-between gap-3 text-xs">
                    <span className="text-white/60 shrink-0">{row.label}</span>
                    <span className="text-white/90 text-right break-words font-medium">{row.value}</span>
                  </div>
                )
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* 합계 (확정 전엔 표시가 합, 주문 생성 후엔 backend SSOT) */}
      <div className="mb-4 flex items-baseline justify-between border-t border-white/10 pt-3">
        <span className="text-white/70 text-sm">{c.total || 'Total'}</span>
        <span className="text-white font-bold text-lg">
          {total ? (
            <>${total.usd}<span className="text-white/55 text-xs"> ({total.krw.toLocaleString('ko-KR')}원)</span></>
          ) : displaySumUSD > 0 ? (
            <>${displaySumUSD.toFixed(2)}</>
          ) : displaySumKRW > 0 ? (
            <>{displaySumKRW.toLocaleString('ko-KR')}원</>
          ) : (
            <span className="text-white/55 text-sm font-normal">{REVIEW_TEXT.totalPending[lng]}</span>
          )}
        </span>
      </div>

      {status === 'idle' && (
        <>
          <button onClick={createOrder} disabled={items.length === 0}
            className="w-full py-3 rounded-xl text-sm font-bold text-white bg-[#7C5CFC] hover:bg-[#6a4ce0] transition-colors disabled:opacity-50">
            {REVIEW_TEXT.confirm[lng]}
          </button>
          {onBack && (
            <button onClick={onBack} className="w-full mt-2 text-xs text-white/50 hover:text-white/80 py-1.5">
              {REVIEW_TEXT.back[lng]}
            </button>
          )}
        </>
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
