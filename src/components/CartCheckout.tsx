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
import { SLOT_REJECT_LABELS } from '@/lib/tourSlotBooking';
import { authFetch } from '@/lib/authFetch';
import { useGuestSignup } from '@/hooks/useGuestSignup';
import { GuestSignupNudge } from '@/components/GuestSignupNudge';
import type { Language } from '@/i18n';
import { usePaymentRecovery, reconcilePayment, classifyCaptureResponse, recoveryCopy, recoveryHeadline, placeForeignPending, isForeignOrder, isCurrentPointer, beginCapture, endCapture, isCaptureInFlight, isRecoveryDone, hasPaymentEvidence, type CaptureOutcome, type PaymentRecovery } from '@/lib/paymentRecovery';

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
  const orderRequestInFlight = useRef(false);
  // 🔴 2026-10-10 payment recovery (cart): pointer before capture, duplicate guard, same-order reconcile via
  //   /api/captureCartOrder {orderID}. The cart stays intact while pending; it is cleared only on durable success.
  // r19: captureBusy = 이 주문 capture 가 이 탭에서 진행 중(모듈 집합 — 패널을 닫았다 열어도 유지) → '같은 주문 확인' 비활성.
  const { recovery, pendingRef, remember, clearRecovery, refresh: refreshRecovery, captureBusy } = usePaymentRecovery({ flow: 'cart' });
  const [reconciling, setReconciling] = useState(false);
  const rc = recoveryCopy(language);
  // r19: 결제 결과 문구는 그 주문에 묶는다(PayPalBookingButton 과 같은 규칙) — 다른 주문의 복구 패널엔 안 보이고,
  //   최종이 아닌 문구는 그 주문이 CAPTURED·완료가 되면 지운다. message 가 지금 error 와 같을 때만 유효.
  //   r20: 화면이 다른 주문을 고르면(최종 문구 포함) 지운다 — A 의 "결제 안 됨" 이 B 가 끝난 뒤 기본 화면에 처음 나타나지 않게.
  //   r22 (B-I6): 문구의 orderID 가 CAPTURED·검토 포인터 또는 'final' 완료 표식으로 보이면 최종 문구도 즉시 지운다('void' 는 근거 아님).
  //   notPaid = "결제 안 됨" 안내 — 결제 증거 규칙은 이 문구에만(환불 안내는 'final' 표식과 함께 남는다).
  const [errorOrder, setErrorOrder] = useState<{ orderID: string; final: boolean; notPaid: boolean; message: string } | null>(null);
  function orderError(message: string, orderID: string, final: boolean, notPaid = false) { setError(message); setErrorOrder({ orderID, final, notPaid, message }); }
  const tagged = errorOrder && errorOrder.message === error ? errorOrder : null;
  if (tagged && ((recovery && recovery.orderID !== tagged.orderID) || (tagged.notPaid && hasPaymentEvidence(tagged.orderID))
    || (!tagged.final && isRecoveryDone(tagged.orderID)))) {
    setError(null); setErrorOrder(null);
  }
  const panelError = recovery && error && !(tagged && (tagged.orderID !== recovery.orderID || tagged.final)) ? error : null;
  // r19 (B13): 빈 장바구니로 들어온 확인 화면에서 확인할 주문이 사라지면(다른 탭이 끝냄) 빈 장바구니 안내로 — 이 탭의 결과 화면
  //   (성공·검토·이 탭의 최종 미결제·환불)은 닫을 때까지 유지.
  //   r20: idle 뿐 아니라 최종이 아닌(태그 없음·일반 오류) error 에서도 — 일반 오류 뒤 다른 탭이 끝내도 빈 검수 화면에 남지 않게.
  const nonFinalError = status === 'error' && !(tagged && tagged.final);
  useEffect(() => {
    if (!recovery && items.length === 0 && (status === 'idle' || nonFinalError) && onBack) onBack();
  }, [recovery, items.length, status, nonFinalError, onBack]);
  // 2026-10-24: 결제 성공 화면 게스트 → 회원 전환 넛지 (PayPalBookingButton 과 같은 훅). 결제 상태와 별개.
  const { signupLoading, signupError, handleGuestSignup } = useGuestSignup();
  const [payerEmail, setPayerEmail] = useState<string | null>(null);
  // r16: 장바구니 화면은 장바구니(cart) 주문만 맡는다(주문별 저장 — 다른 상품 주문은 이 화면에 선택되지 않는다).
  async function applyOutcome(outcome: CaptureOutcome, orderId: string, fresh: boolean, checked: PaymentRecovery | null = null) {
    // 늦은 응답 대조 — 확인을 시작한 주문이 아직 현재일 때만(다른 탭이 끝냈으면 버림). PayPalBookingButton 과 같은 공용 판정.
    if (!fresh && checked && !isCurrentPointer(checked, pendingRef.current)) { refreshRecovery(); return; } // r17-8: 버릴 때 재조회
    const keep = (state: Pick<PaymentRecovery, 'paymentStatus' | 'review'> & { authRequired?: boolean }) => remember({ orderID: orderId, flow: 'cart', ...state });
    if (outcome.kind === 'final') {
      // 표시 전용 — 서버 확정 응답(captureCartOrder data.payerEmail)의 결제자 이메일.
      setPayerEmail(typeof outcome.data.payerEmail === 'string' && outcome.data.payerEmail ? outcome.data.payerEmail : null);
      clearRecovery(orderId, 'final', 'confirmed'); setStatus('success'); await clear(); return; // r25: 확정 세부 종류(표식 의미 일관)
    }
    if (outcome.kind === 'review') { keep({ paymentStatus: outcome.captured ? 'CAPTURED' : 'NOT_CAPTURED', review: true }); setStatus('review'); await clear(); return; }
    if (outcome.kind === 'pending') { keep({ paymentStatus: outcome.status, review: false }); setStatus('idle'); return; }
    if (outcome.kind === 'auth_required') {
      // 403 precedes the provider call (no charge). A fresh order never locks the flow (2026-10-10 R2).
      if (fresh) { clearRecovery(orderId, 'void'); orderError(rc.authRequired, orderId, true); setStatus('error'); return; }
      keep({ paymentStatus: 'CAPTURE_UNKNOWN', review: false, authRequired: true }); setStatus('idle'); return;
    }
    // r19: 미결제 응답은 최종(서버 묘비 — 구 서버 no_attempt_record 는 분류 단계에서 UNKNOWN) → 완료 처리 + 4개 언어 안내.
    //   r20: 'void' 완료 표식 — 서버가 나중에 CAPTURED·검토(webhook 충돌)를 보이면 그 증거가 이긴다.
    if (outcome.kind === 'not_captured') { clearRecovery(orderId, 'void'); orderError(rc.notCaptured, orderId, true, true); setStatus('error'); return; }
    // Server-proven full refund: terminal, not a booking — the cart is kept, no success state.
    if (outcome.kind === 'refunded') { clearRecovery(orderId, 'final', 'refunded'); orderError(outcome.message, orderId, true); setStatus('error'); return; }
    // Generic error: keep the pointer unless the server gives durable evidence of no capture.
    orderError(outcome.message, orderId, false); setStatus('error');
    if (fresh) {
      const evidence = await reconcilePayment('cart', orderId);
      if (evidence.kind === 'not_captured' || evidence.kind === 'final' || evidence.kind === 'review' || evidence.kind === 'refunded') { await applyOutcome(evidence, orderId, false); return; }
    }
    keep({ paymentStatus: 'CAPTURE_UNKNOWN', review: false });
  }
  async function checkSameOrder() {
    if (!recovery || reconciling || isCaptureInFlight(recovery.orderID)) return; // r19: 모듈 집합
    const checked = { ...recovery };
    setReconciling(true);
    try { await applyOutcome(await reconcilePayment(checked.flow, checked.orderID), checked.orderID, false, checked); } finally { setReconciling(false); }
  }

  // 1) 주문 생성 — 결제 직전 backend SSOT 재계산 (client priceKRW 무시).
  async function createOrder() {
    if (orderRequestInFlight.current || recovery) return;
    orderRequestInFlight.current = true;
    setStatus('creating'); setError(null);
    try {
      const res = await authFetch('/api/createCartOrder', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, userEmail: user?.email || '' }),
      });
      const json = await res.json();
      if (json.code === 'PAYMENT_RECOVERY_PENDING' && typeof json.orderID === 'string') {
        // r13/r16: 서버가 준 원래 flow·상품 보존. 장바구니 주문이면 이 화면이 맡고, 아니면(단건·플래너) 그 주문 키에 두고 중립 안내.
        const pointer = { orderID: json.orderID, flow: (json.flow === 'single' ? 'single' : 'cart') as 'single' | 'cart', paymentStatus: (json.paymentStatus === 'CAPTURED' ? 'CAPTURED' : 'CAPTURE_UNKNOWN') as 'CAPTURED' | 'CAPTURE_UNKNOWN', review: false, ...(typeof json.productType === 'string' ? { productType: json.productType } : {}) };
        if (!isForeignOrder(pointer, { flow: 'cart' })) remember(pointer);
        else { placeForeignPending(pointer); setError(rc.otherOrderPending.replace('{{order}}', json.orderID)); }
        setStatus('idle');
      } else if (json.ok && json.data && json.data.orderID) {
        rendered.current = false; // r20: 새 주문마다 PayPal 버튼을 다시 그린다(묘비로 끝난 앞 주문 뒤 재결제 버튼이 비던 문제)
        setOrderID(json.data.orderID);
        setTotal({ usd: json.data.usdAmount, krw: json.data.totalKRW });
        setStatus('ready');
        loadSdk();
      } else if (json.code === 'SLOT_FULL' || json.code === 'DATE_UNAVAILABLE') {
        // 🔴 슬롯 정원 거절 — 서버 문구는 진단용 영어("Slot full: requested=3, …")라 그대로 보이면 안 된다.
        //   돈은 아직 안 움직였다(주문 미생성). 장바구니는 여러 항목이라 **어느 항목이** 막혔는지가 핵심 —
        //   서버가 준 itemIndex 로 그 항목 이름을 앞에 붙인다(PayPalBookingButton 과 같은 라벨 재사용).
        const sl = SLOT_REJECT_LABELS[lng] || SLOT_REJECT_LABELS.en;
        const msg = json.code === 'SLOT_FULL' ? sl.SLOT_FULL : sl.DATE_UNAVAILABLE;
        const blocked = typeof json.itemIndex === 'number' ? items[json.itemIndex] : undefined;
        setError(blocked ? `${blocked.displayName} — ${msg}` : msg);
        setStatus('error');
      } else {
        setError(json.error || 'Cart order failed');
        setStatus('error');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'error');
      setStatus('error');
    } finally {
      orderRequestInFlight.current = false;
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
    const host = document.getElementById('cart-paypal-btn');
    if (host) host.innerHTML = ''; // r20: 앞 주문의 버튼을 비우고 이 주문 버튼만
    pp.Buttons({
      createOrder: () => orderID,
      onApprove: async (data: { orderID: string }) => {
        if (!beginCapture(data.orderID)) return; // r19: 모듈 수준 — 패널을 닫았다 열어도 이 주문 capture 진행 중을 안다
        remember({ orderID: data.orderID, flow: 'cart', paymentStatus: 'CAPTURE_UNKNOWN', review: false });
        setStatus('processing');
        try {
          const res = await authFetch('/api/captureCartOrder', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderID: data.orderID, userEmail: user?.email || '' }),
          });
          // 🔴 review / recovery-pending are neither success nor failure (double-charge guard); only a durable
          //   finalized answer for this orderID clears the pointer and the cart. Exceptions stay pending.
          const outcome = classifyCaptureResponse(await res.json(), data.orderID);
          await applyOutcome(outcome, data.orderID, true);
        } catch {
          remember({ orderID: data.orderID, flow: 'cart', paymentStatus: 'CAPTURE_UNKNOWN', review: false });
          setStatus('idle');
        } finally {
          endCapture(data.orderID);
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
        <div className="text-4xl mb-3 customer-checkout-review-icon" aria-hidden="true">🕒</div>
        <p className="text-white font-semibold mb-1 customer-checkout-state-title">{c.checkoutReview || 'Payment received'}</p>
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

  // 'review' already returned above, so only 'success' needs excluding here.
  if (recovery && status !== 'success') {
    return (
      <div className="cocotrip-mobile-cart-checkout p-6 text-center customer-checkout-recovery">
        <div className="text-4xl mb-3" aria-hidden="true">🕒</div>
        <p className="text-white font-semibold mb-1 customer-checkout-state-title">{recoveryHeadline(recovery, language)}</p>
        <p className="text-white/55 text-sm mb-2">{rc.detail}</p>
        <p className="text-amber-300 text-xs mb-3 bg-amber-500/10 border border-amber-400/30 rounded-xl px-3 py-2">{rc.warn}</p>
        <p className="text-xs text-white/60 mb-4">{rc.order}: <span className="font-mono text-white/90">{recovery.orderID}</span></p>
        {panelError && <p className="text-red-400/80 text-xs mb-3">{panelError}</p>}
        <button onClick={checkSameOrder} disabled={reconciling || captureBusy || recovery.authRequired === true}
          className="px-5 py-2.5 min-h-[44px] rounded-xl text-sm font-semibold bg-[#7C5CFC] text-white disabled:opacity-50">
          {reconciling ? rc.checking : rc.check}
        </button>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="cocotrip-mobile-cart-checkout p-6 text-center">
        <div className="text-4xl mb-3 customer-checkout-success-icon">✅</div>
        <p className="text-white font-semibold mb-1 customer-checkout-state-title">{c.checkoutDone || 'Booking confirmed!'}</p>
        <p className="text-white/55 text-sm mb-5">{c.checkoutDoneSub || 'Confirmation emails are on the way.'}</p>
        {/* 게스트 전용(!user) — 로그인 사용자에겐 렌더 안 함. PayPalBookingButton 성공 오버레이와 같은 넛지. */}
        {!user && (
          <div className="mb-5 text-left">
            <GuestSignupNudge
              language={language as Language}
              email={payerEmail}
              onGoogleLogin={handleGuestSignup}
              authLoading={signupLoading}
              authError={signupError}
            />
          </div>
        )}
        <button onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-[#7C5CFC] text-white">
          {c.close || 'Done'}
        </button>
      </div>
    );
  }

  const displaySumUSD = items.reduce((s, it) => s + (Number(it.priceUSD) || 0), 0);
  const displaySumKRW = items.reduce((s, it) => s + (Number(it.priceKRW) || 0), 0);

  return (
    <div className="cocotrip-mobile-cart-checkout p-5 customer-checkout-default">
      {/* 검수 헤더 */}
      <div className="mb-3">
        <p className="text-white font-semibold text-sm customer-checkout-title">{REVIEW_TEXT.title[lng]}</p>
        <p className="text-white/50 text-xs mt-0.5">{REVIEW_TEXT.sub[lng]}</p>
      </div>

      {/* 항목별 전체 내역 (검수) */}
      <div className="space-y-2.5 mb-4">
        {items.map((item) => (
          <div key={item.id} className="bg-white/[0.04] rounded-xl p-3 border border-white/5 customer-checkout-item">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-white text-sm font-medium break-words">{item.displayName}</p>
              {item.priceUSD ? <span className="text-[#C4956A] text-sm font-semibold shrink-0">${item.priceUSD}</span> : null}
            </div>
            <div className="mt-2 space-y-1.5">
              {formatBookingDetails(item.booking, language).map((row, i) => (
                row.full ? (
                  // 긴 메모/요청사항 — 우측 좁은 칸 X, 전체폭 stacked + " | " 줄바꿈으로 가독성.
                  <div key={i} className="text-xs pt-1 border-t border-white/5 customer-checkout-row">
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
                  <div key={i} className="flex justify-between gap-3 text-xs customer-checkout-row">
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

      {(status === 'idle' || status === 'error') && (
        <>
          <button onClick={createOrder} disabled={items.length === 0}
            className="w-full py-3 rounded-xl text-sm font-bold text-white bg-[#7C5CFC] hover:bg-[#6a4ce0] transition-colors disabled:opacity-50">
            {REVIEW_TEXT.confirm[lng]}
          </button>
          {onBack && (
            <button onClick={onBack} className="w-full mt-2 text-xs text-white/50 hover:text-white/80 py-1.5 customer-checkout-back">
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
