/**
 * paymentRecovery — client pointer for an in-flight / unresolved PayPal capture.
 *
 * The server record (used_paypal_orders + HttpOnly checkout cookie) is the authority; this pointer only
 * keeps the UI on the same order across remounts, reloads and tabs. It is written BEFORE capture and
 * cleared only on confirmed durable success, provider-proven nonpayment or a server-proven full refund of the
 * same order. It never stores contact data.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { authFetch } from '@/lib/authFetch';

export type PaymentFlow = 'single' | 'cart';
export type PaymentStatus = 'CAPTURE_UNKNOWN' | 'CAPTURED' | 'NOT_CAPTURED';
export type PaymentRecovery = {
  orderID: string;
  flow: PaymentFlow;
  paymentStatus: PaymentStatus;
  review: boolean;
  authRequired?: boolean;
  productType?: string;
  updatedAt: number;
};
export type CaptureOutcome =
  | { kind: 'final'; data: Record<string, unknown> }
  | { kind: 'pending'; status: PaymentStatus }
  | { kind: 'review'; captured: boolean; captureID: string }
  | { kind: 'not_captured'; message: string }
  | { kind: 'refunded'; message: string; refundID: string }
  | { kind: 'auth_required' }
  | { kind: 'error'; message: string };

export const recoveryKey = (flow: PaymentFlow) => `cocotrip:payment-recovery:${flow}`;
const FLOWS: PaymentFlow[] = ['single', 'cart'];

function parsePointer(raw: string | null): PaymentRecovery | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || typeof value.orderID !== 'string' || !value.orderID) return null;
    const flow: PaymentFlow = value.flow === 'cart' ? 'cart' : 'single';
    return {
      orderID: value.orderID, flow, review: value.review === true, authRequired: value.authRequired === true,
      paymentStatus: value.paymentStatus === 'CAPTURED' ? 'CAPTURED' : value.paymentStatus === 'NOT_CAPTURED' ? 'NOT_CAPTURED' : 'CAPTURE_UNKNOWN',
      productType: typeof value.productType === 'string' ? value.productType : undefined,
      updatedAt: Number(value.updatedAt) || 0,
    };
  } catch {
    return null; // unreadable pointer: the server cookie record still blocks new orders
  }
}

export function readPaymentRecovery(flow: PaymentFlow): PaymentRecovery | null {
  try { return parsePointer(localStorage.getItem(recoveryKey(flow))); } catch { return null; }
}

export function writePaymentRecovery(value: PaymentRecovery): boolean {
  try { localStorage.setItem(recoveryKey(value.flow), JSON.stringify(value)); return true; } catch { return false; }
}

export function removePaymentRecovery(flow: PaymentFlow, orderID: string): void {
  try {
    const current = readPaymentRecovery(flow);
    if (current && current.orderID === orderID) localStorage.removeItem(recoveryKey(flow));
  } catch { /* stale pointer is safe to reconcile again */ }
}

export function isFinalPayment(json: Record<string, unknown>, orderID: string): boolean {
  const data = json.data as { orderID?: unknown } | undefined;
  return json.ok === true && json.finalized !== false && json.bookingStatus !== 'PAYMENT_REVIEW' && !!data && data.orderID === orderID;
}

/**
 * Classifies a capture / same-order reconcile response. Order matters: explicit server nonpayment
 * (`PAYMENT_NOT_CAPTURED`, which also carries finalized:false) is checked BEFORE the generic pending
 * shape. A generic error never clears an unresolved order — only this explicit evidence or durable success.
 */
export function classifyCaptureResponse(json: Record<string, unknown> | null, orderID: string): CaptureOutcome {
  if (!json || typeof json !== 'object') return { kind: 'pending', status: 'CAPTURE_UNKNOWN' };
  if (isFinalPayment(json, orderID)) return { kind: 'final', data: (json.data as Record<string, unknown>) || {} };
  if (json.code === 'PAYMENT_NOT_CAPTURED' && json.paymentStatus === 'NOT_CAPTURED' && json.orderID === orderID) {
    return { kind: 'not_captured', message: typeof json.error === 'string' ? json.error : 'Payment was not completed.' };
  }
  // Server-proven full refund of THIS order (terminal, never a booking success). Any missing field — e.g. a
  // legacy promo 409 or a refund still pending — falls through and keeps the pointer.
  if (json.code === 'PROMO_LIMIT_EXCEEDED' && json.ok === false && json.finalized === true && json.paymentStatus === 'REFUNDED'
    && json.orderID === orderID && typeof json.refundID === 'string' && json.refundID.trim() !== '') {
    return { kind: 'refunded', message: typeof json.error === 'string' ? json.error : 'Your payment has been refunded.', refundID: json.refundID };
  }
  if (json.bookingStatus === 'PAYMENT_REVIEW') {
    return { kind: 'review', captured: json.paymentCaptured !== false, captureID: typeof json.captureID === 'string' ? json.captureID : '' };
  }
  if (json.code === 'PAYMENT_RECOVERY_PENDING' || json.finalized === false) {
    return { kind: 'pending', status: json.paymentStatus === 'CAPTURED' ? 'CAPTURED' : 'CAPTURE_UNKNOWN' };
  }
  if (json.code === 'RECOVERY_AUTH_REQUIRED') return { kind: 'auth_required' };
  return { kind: 'error', message: typeof json.error === 'string' ? json.error : 'Payment failed' };
}

/** Same-order check through the existing capture endpoint: body is {orderID, reconcile:true} only. Network errors stay pending. */
export async function reconcilePayment(flow: PaymentFlow, orderID: string): Promise<CaptureOutcome> {
  try {
    const res = await authFetch(flow === 'cart' ? '/api/captureCartOrder' : '/api/capturePaypalOrder', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderID, reconcile: true }),
    });
    return classifyCaptureResponse(await res.json(), orderID);
  } catch {
    return { kind: 'pending', status: 'CAPTURE_UNKNOWN' };
  }
}

export function usePaymentRecovery(flow: PaymentFlow) {
  const [recovery, setRecovery] = useState<PaymentRecovery | null>(() => readPaymentRecovery(flow));
  const pendingRef = useRef<PaymentRecovery | null>(recovery);
  const remember = useCallback((value: Omit<PaymentRecovery, 'updatedAt'> & { updatedAt?: number }) => {
    const next: PaymentRecovery = { ...value, updatedAt: Date.now() };
    pendingRef.current = next;
    setRecovery(next);
    return writePaymentRecovery(next);
  }, []);
  const clearRecovery = useCallback((orderID: string) => {
    const current = pendingRef.current;
    if (current && current.orderID !== orderID) return;
    if (current) removePaymentRecovery(current.flow, orderID);
    pendingRef.current = null;
    setRecovery(null);
  }, []);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key && !FLOWS.some((f) => recoveryKey(f) === event.key)) return;
      const next = parsePointer(event.newValue);
      if (next) { pendingRef.current = next; setRecovery(next); return; }
      // Removal by another tab counts only for the same order (that tab saw a definitive server answer).
      const previous = parsePointer(event.oldValue);
      if (previous && pendingRef.current && pendingRef.current.orderID === previous.orderID) { pendingRef.current = null; setRecovery(null); }
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [flow]);
  return { recovery, pendingRef, remember, clearRecovery };
}

export const PAYMENT_RECOVERY_COPY = {
  ko: { unknown: '결제 결과를 확인 중입니다', captured: '결제는 접수됐으며 예약을 저장하는 중입니다', review: '결제가 접수되어 담당자가 확인 중입니다', authRequired: '이 주문은 결제를 시작한 기기에서만 확인할 수 있습니다. 문의해 주세요.', detail: '같은 주문의 결제·예약 상태를 다시 확인해 주세요. 확인 전에는 새 결제를 만들 수 없습니다.', warn: '다시 결제하지 마세요. 중복 청구될 수 있습니다.', check: '같은 주문 확인', checking: '확인 중…', order: '주문 번호', contact: '문의하기', notCaptured: '결제가 완료되지 않았습니다. 다시 결제할 수 있습니다.' },
  en: { unknown: 'Checking your payment result', captured: 'Payment received; your booking is being recorded', review: 'Payment received; our team is verifying it', authRequired: 'This order can only be checked from the device that started the payment. Please contact us.', detail: 'Check the payment and booking status of this same order. A new payment cannot start until it is resolved.', warn: 'Do not pay again. It may result in a duplicate charge.', check: 'Check this order', checking: 'Checking…', order: 'Order No.', contact: 'Contact us', notCaptured: 'Payment was not completed. You can pay again.' },
  ja: { unknown: 'お支払い結果を確認中です', captured: 'お支払いを受け付け、ご予約を記録しています', review: 'お支払いを受け付け、担当者が確認中です', authRequired: 'この注文はお支払いを開始した端末でのみ確認できます。お問い合わせください。', detail: '同じ注文のお支払いと予約状況を再確認してください。解決するまで新しいお支払いは開始できません。', warn: '二重請求を防ぐため、再度お支払いしないでください。', check: '同じ注文を確認', checking: '確認中…', order: '注文番号', contact: 'お問い合わせ', notCaptured: 'お支払いは完了していません。再度お支払いいただけます。' },
  zh: { unknown: '正在核实付款结果', captured: '已收到付款，正在记录预订', review: '已收到付款，工作人员正在核实', authRequired: '此订单只能在发起付款的设备上核实。请联系我们。', detail: '请再次核实此订单的付款与预订状态。解决前无法开始新的付款。', warn: '请勿重复付款，以免重复扣款。', check: '核实此订单', checking: '正在核实…', order: '订单号', contact: '联系我们', notCaptured: '付款未完成，您可以重新付款。' },
};

export function recoveryCopy(language: string) {
  return PAYMENT_RECOVERY_COPY[language === 'ko' || language === 'ja' || language === 'zh' ? language : 'en'];
}

export function recoveryHeadline(recovery: PaymentRecovery, language: string): string {
  const copy = recoveryCopy(language);
  if (recovery.authRequired) return copy.authRequired;
  if (recovery.review) return copy.review;
  return recovery.paymentStatus === 'CAPTURED' ? copy.captured : copy.unknown;
}
