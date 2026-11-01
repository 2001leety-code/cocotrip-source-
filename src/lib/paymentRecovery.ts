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
  /** r16: 주문별 저장 버전·고정 생성 시각(목록 정렬 — createdAt → orderID). 옛 범위 키 포인터엔 없다(updatedAt 으로 대체). */
  v?: number;
  createdAt?: number;
  /** r7: 메모리 전용 — 이 탭의 remember 가 저장소에 실제로 썼는가(false = 쓰기 실패: 시크릿 모드 Quota·차단). 저장소에서 읽은 포인터엔 없다. */
  persisted?: boolean;
};
export type CaptureOutcome =
  | { kind: 'final'; data: Record<string, unknown> }
  | { kind: 'pending'; status: PaymentStatus }
  | { kind: 'review'; captured: boolean; captureID: string }
  | { kind: 'not_captured'; message: string; preCaptureCode?: string; noAttempt?: boolean }
  | { kind: 'refunded'; message: string; refundID: string }
  | { kind: 'auth_required' }
  | { kind: 'error'; message: string };

/**
 * scope: 같은 flow 안에서 따로 보관할 포인터 범위. 2026-10-26 B6-1 r3 — AI 플래너는 결제 뒤 발급까지 CAPTURED 포인터를
 * 유지하므로 'single' 공용 키에 두면 차터·투어·InlineBookingCard 결제 버튼까지 막는다 → 플래너 전용 범위('ai-planner').
 */
export const recoveryKey = (flow: PaymentFlow, scope?: string) => `cocotrip:payment-recovery:${flow}${scope ? `:${scope}` : ''}`;
export const PLANNER_RECOVERY_SCOPE = 'ai-planner';

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
      ...(Number(value.createdAt) > 0 ? { createdAt: Number(value.createdAt) } : {}),
      ...(Number(value.v) > 0 ? { v: Number(value.v) } : {}),
    };
  } catch {
    return null; // unreadable pointer: the server cookie record still blocks new orders
  }
}

/*
 * ── r16 저장 구조(Astra 설계 A): 주문별 키 + 별도 완료 표식 ───────────────────────────────────────────────
 *   주문 `cocotrip:payment-recovery:order:<orderID>` = 기존 필드 + v + 고정 createdAt (개인정보·공용 목록 키 없음, 목록 = 키 열거).
 *   완료 `cocotrip:payment-recovery:done:<orderID>` = 서버가 입증한 종료. **완료 표식을 먼저 쓰고** 주문 키를 지운다 —
 *     모든 읽기·저장이 완료 표식을 우선하므로 늦은 쓰기·지연 이벤트로 끝난 주문이 되살아나지 않는다. 표식 저장 실패면 원본 보존(이 탭만 숨김).
 *   쓰기는 자기 주문 키에만 → 다른 주문을 덮거나 지우는 경로가 구조적으로 없다(r10~r15 의 범위 키 경합 덧댐을 대체).
 *   옛 범위 키(`…:single`·`…:single:ai-planner`·`…:cart`)는 전환 기간 **읽기만**(구버전 탭이 살아 있을 수 있음 — 삭제·전역 이전 표시 금지).
 *   저장 실패(Quota·SecurityError) = 탭 공용 주문별 메모리(persisted:false). 미해결 주문은 개수·나이로 버리지 않는다.
 */
const PREFIX = 'cocotrip:payment-recovery:';
export const orderRecoveryKey = (orderID: string) => `${PREFIX}order:${orderID}`;
export const doneRecoveryKey = (orderID: string) => `${PREFIX}done:${orderID}`;
const LEGACY_KEYS = [recoveryKey('single'), recoveryKey('single', PLANNER_RECOVERY_SCOPE), recoveryKey('cart')];
const memoryOrders = new Map<string, PaymentRecovery>(); // 저장 실패한 이 탭의 주문(persisted:false)
const memoryDone = new Set<string>();                     // 완료 표식 저장에 실패한 주문(이 탭에서만 숨김)
const listeners = new Set<() => void>();

/** 테스트 전용 — 모듈 메모리(저장 실패 주문·완료) 초기화. */
export function resetPaymentRecoveryMemory(): void { memoryOrders.clear(); memoryDone.clear(); }

const getRaw = (key: string): string | null => { try { return localStorage.getItem(key); } catch { return null; } };
function notifyRecoveryChange() { for (const fn of [...listeners]) { try { fn(); } catch { /* 구독자 오류는 다른 화면에 영향 없음 */ } } }
let storageHooked = false;
/** 같은 탭 구독(중앙 함수 쓰기 뒤) + 다른 탭 storage 이벤트 = 재조회 신호만(이벤트 값은 적용하지 않는다). */
function subscribeRecovery(fn: () => void): () => void {
  listeners.add(fn);
  if (!storageHooked && typeof window !== 'undefined') {
    storageHooked = true;
    window.addEventListener('storage', (event) => { if (!event.key || event.key.startsWith(PREFIX)) notifyRecoveryChange(); });
  }
  return () => { listeners.delete(fn); };
}

export function isRecoveryDone(orderID: string): boolean {
  return memoryDone.has(orderID) || getRaw(doneRecoveryKey(orderID)) !== null;
}

/** 미해결 주문 전부(완료 제외) — createdAt → orderID 순. 옛 키 < 주문 키 < 이 탭 메모리 순으로 우선. */
export function listRecoveryOrders(): PaymentRecovery[] {
  const byId = new Map<string, PaymentRecovery>();
  for (const key of LEGACY_KEYS) {
    const p = parsePointer(getRaw(key));
    if (!p || byId.has(p.orderID)) continue;
    const legacy: PaymentRecovery = { ...p, createdAt: p.createdAt || p.updatedAt || 0 };
    byId.set(p.orderID, legacy);
    // r17: 옛 키에서 읽은 미해결 주문은 주문별 키로 **복사**(설계 A 의 이전 단계) — 구버전 탭이 옛 키를 다른 주문으로 덮어도 잃지 않는다.
    //   완료 표식이 있거나 이미 주문 키가 있으면 그대로. 옛 키는 지우지 않는다(읽기 전용 유지). 알림 없음(렌더 중 호출 가능).
    if (!isRecoveryDone(p.orderID) && getRaw(orderRecoveryKey(p.orderID)) === null) {
      try { localStorage.setItem(orderRecoveryKey(p.orderID), JSON.stringify({ ...legacy, v: 2 })); } catch { /* 옛 키 읽기로 계속 보인다 */ }
    }
  }
  let keys: string[] = [];
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(`${PREFIX}order:`)) keys.push(k); } } catch { keys = []; }
  for (const key of keys) {
    const p = parsePointer(getRaw(key));
    if (p && key === orderRecoveryKey(p.orderID)) byId.set(p.orderID, p);
  }
  for (const [id, p] of memoryOrders) byId.set(id, p);
  return [...byId.values()]
    .filter((p) => !isRecoveryDone(p.orderID))
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0) || (a.orderID < b.orderID ? -1 : a.orderID > b.orderID ? 1 : 0));
}

export function readRecoveryOrder(orderID: string): PaymentRecovery | null {
  return listRecoveryOrders().find((p) => p.orderID === orderID) || null;
}

/** 자기 주문 키에만 저장(createdAt 유지). 완료된 주문은 되살리지 않는다(null). 저장 실패 = 메모리(persisted:false). */
export function saveRecoveryOrder(value: Omit<PaymentRecovery, 'updatedAt' | 'createdAt' | 'persisted'>): PaymentRecovery | null {
  if (isRecoveryDone(value.orderID)) return null;
  const existing = readRecoveryOrder(value.orderID);
  const record: PaymentRecovery = { ...value, v: 2, createdAt: existing && existing.createdAt ? existing.createdAt : Date.now(), updatedAt: Date.now() };
  let persisted = true;
  try { localStorage.setItem(orderRecoveryKey(value.orderID), JSON.stringify(record)); memoryOrders.delete(value.orderID); } catch { persisted = false; }
  const result: PaymentRecovery = persisted ? record : { ...record, persisted: false };
  if (!persisted) memoryOrders.set(value.orderID, result);
  notifyRecoveryChange();
  return result;
}

/** 서버가 입증한 종료 — 완료 표식 먼저, 그 다음 주문 키 삭제. 표식 저장 실패면 원본 보존(이 탭에서만 숨김). @returns 표식 저장 여부 */
/**
 * r17-6: 영구 완료가 아닌 미결제 증거(no_attempt_record) — 완료 표식 없이 주문 키만 지운다. 같은 주문의 실제 결과(진행 중이던 capture 의
 *   PENDING·final)가 뒤에 오면 다시 저장된다. 단 옛 키에도 있는 주문은 다시 복사돼 패널이 되살아나므로 그때만 완료로 처리한다
 *   (옛 키 주문은 이 탭이 지금 capture 중인 주문일 수 없다 — 새 주문은 주문 키에만 쓴다).
 */
export function dropRecoveryOrder(orderID: string): void {
  if (LEGACY_KEYS.some((k) => { const p = parsePointer(getRaw(k)); return !!p && p.orderID === orderID; })) { finishRecoveryOrder(orderID); return; }
  memoryOrders.delete(orderID);
  try { localStorage.removeItem(orderRecoveryKey(orderID)); } catch { /* 메모리에서는 빠졌다 */ }
  notifyRecoveryChange();
}

export function finishRecoveryOrder(orderID: string): boolean {
  let marked = false;
  try { localStorage.setItem(doneRecoveryKey(orderID), String(Date.now())); marked = true; } catch { /* 원본 보존 */ }
  if (!marked) memoryDone.add(orderID);
  memoryOrders.delete(orderID);
  if (marked) { try { localStorage.removeItem(orderRecoveryKey(orderID)); } catch { /* 완료 표식이 우선한다 */ } }
  notifyRecoveryChange();
  return marked;
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
    return {
      kind: 'not_captured', message: typeof json.error === 'string' ? json.error : 'Payment was not completed.',
      // r17-6: 서버에 capture 시도 기록이 아직 없다는 증거(no_attempt_record) — 다른 탭의 capture 가 진행 중일 수 있어 영구 완료가 아니다.
      ...(json.evidence === 'no_attempt_record' ? { noAttempt: true } : {}),
      // 2026-10-26 B6-1: capture 전 서버 사전 거부(AI 플래너 식이 커버리지 등) 사유 — 화면 안내용.
      ...(typeof json.preCaptureCode === 'string' ? { preCaptureCode: json.preCaptureCode } : {}),
    };
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

/**
 * r16: 화면이 맡는 주문 — 플래너 = 플래너 상품 단건, 일반 단건 = 현재 상품과 같은(또는 상품 미상) 단건, 장바구니 = cart.
 *   그 밖(다른 상품·다른 flow)은 외부 주문 = 중립 안내. PayPalBookingButton·CartCheckout 이 같은 함수를 쓴다.
 */
export type RecoveryScreen = { flow: PaymentFlow; planner?: boolean; productType?: string };
export function matchesScreen(p: Pick<PaymentRecovery, 'flow' | 'productType'>, screen: RecoveryScreen): boolean {
  if (screen.flow === 'cart') return p.flow === 'cart';
  if (p.flow !== 'single') return false;
  if (screen.planner) return isPlannerProduct(p.productType);
  if (isPlannerProduct(p.productType)) return false;
  return !p.productType || !screen.productType || isSameProduct(p.productType, screen.productType);
}
export function isForeignOrder(p: Pick<PaymentRecovery, 'flow' | 'productType'>, screen: RecoveryScreen): boolean {
  return !matchesScreen(p, screen);
}

/** 이 화면 상품이 아닌 주문(서버 409 미결 주문 등) — 그 주문 키에 상품·flow 그대로(다른 주문을 덮을 수 없다). */
export function placeForeignPending(value: Omit<PaymentRecovery, 'updatedAt' | 'createdAt' | 'persisted'>): PaymentRecovery | null {
  return saveRecoveryOrder(value);
}

/**
 * 이 화면 상품이 아닌 주문이 확정(final)으로 확인됐을 때(성공 처리·장바구니 비우기는 호출자가 하지 않는다).
 *   플래너 주문 = 발급까지 CAPTURED 로 그 주문 키에 유지(플래너 화면이 맡는다 — CAPTURED 만으로 완료 처리 금지). 그 밖 = 완료.
 */
export function settleForeignFinal(p: PaymentRecovery): void {
  if (isPlannerProduct(p.productType)) saveRecoveryOrder({ orderID: p.orderID, flow: p.flow, productType: p.productType, paymentStatus: 'CAPTURED', review: false });
  else finishRecoveryOrder(p.orderID);
}

/**
 * 같은 주문 확인을 시작한 포인터가 응답 도착 시점에도 현재인가 — 이 화면이 지금 선택한 주문(주문·flow·상품)과 같고,
 *   완료 표식이 없고, 주문별 저장값(또는 이 탭 메모리)이 아직 있다. updatedAt 은 동일성 기준이 아니다.
 */
export function isCurrentPointer(checked: PaymentRecovery | null, mine: PaymentRecovery | null): boolean {
  const same = (p: PaymentRecovery | null) => !!p && !!checked && p.orderID === checked.orderID && p.flow === checked.flow && p.productType === checked.productType;
  if (!checked || !same(mine)) return false;
  // 저장값도 같은 주문·흐름·상품이어야 한다(다른 탭이 같은 주문을 다른 flow·상품으로 고쳤는데 이벤트 전이면 = 현재 아님).
  return !isRecoveryDone(checked.orderID) && same(readRecoveryOrder(checked.orderID));
}

/**
 * r15: 유료 플래너 주문의 "발급 진행 중" 표식 — 서버가 streaming(firestoreSaved:false)으로 200 을 주면 플랜은 아직 미완성이라
 *   복구 포인터를 지우지 않고 planId → orderID 를 남긴다. 플랜 상세가 최종 상태를 보면 settlePlannerIssue 로 정리:
 *   ready = 발급 완료 → 포인터 삭제 / error = 생성 실패 → 포인터 유지(플래너의 '같은 주문 확인' → 같은 주문 재발급). 저장소 실패는 무시(포인터 유지 = 안전 쪽).
 */
const issueKey = (planId: string) => `cocotrip:payment-recovery:issue:${planId}`;
export function markPlannerIssuePending(planId: string, orderID: string): void {
  if (isRecoveryDone(orderID)) return; // r17: 이미 끝난 주문(늦은 streaming 응답)은 issue 를 다시 만들지 않는다
  try { localStorage.setItem(issueKey(planId), orderID); } catch { /* 포인터는 유지된다 */ }
}
export function settlePlannerIssue(planId: string, status: 'ready' | 'streaming' | 'error'): void {
  if (status === 'streaming') return; // 둘 다 유지
  const orderID = getRaw(issueKey(planId));
  if (!orderID) return;
  if (status === 'ready') { finishPaidPlannerOrder(orderID); return; }
  try { localStorage.removeItem(issueKey(planId)); } catch { /* 다음 방문에 다시 정리 */ } // error = issue 만 삭제(주문 유지 → 같은 주문 재발급)
}

/**
 * r16: 유료 플래너 주문 발급 완료(ready · 저장 완료 200 · DUPLICATE_ORDER) — 완료 표식 기록 후 그 주문과 연결된 issue 전부 정리.
 *   완료 표식 저장에 실패하면 issue 도 남긴다(다음 방문에 다시 정리).
 */
export function finishPaidPlannerOrder(orderID: string): void {
  if (!finishRecoveryOrder(orderID)) return;
  try {
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(`${PREFIX}issue:`) && localStorage.getItem(k) === orderID) stale.push(k);
    }
    for (const k of stale) localStorage.removeItem(k);
  } catch { /* 완료 표식이 우선한다 */ }
}

/** AI 플래너(풀) 상품인가 — 하이픈/밑줄 변형 같게. */
export function isPlannerProduct(productType: string | undefined | null): boolean {
  return typeof productType === 'string' && productType.toLowerCase().replace(/-/g, '_') === 'ai_planner_full';
}

/** 같은 상품인가 — 둘 중 하나라도 모르면 false(모르는 주문을 현재 상품으로 확정하지 않는다). */
export function isSameProduct(a: string | undefined | null, b: string | undefined | null): boolean {
  const norm = (v: string | undefined | null) => (typeof v === 'string' ? v.toLowerCase().replace(/-/g, '_') : '');
  return !!norm(a) && norm(a) === norm(b);
}

/**
 * r16 훅 — 화면당 패널 1건. 확인 중인(선택해 고정한) 주문을 유지하고, 그 주문이 끝나면 createdAt → orderID 순으로 이 화면이 맡는
 *   다음 미해결 주문을 바로 고른다(옛 범위 키의 주문 포함 — 읽기만). 다른 탭·같은 탭 변경 = 재조회(이벤트 값은 쓰지 않는다).
 *   remember = 그 주문 키에 저장 + 고정 / clearRecovery = 서버가 입증한 종료(완료 표식 → 삭제) / forgetRecovery = 이 화면에서만 놓음.
 */
const sameRecovery = (a: PaymentRecovery | null, b: PaymentRecovery | null) => (a === b) || (!!a && !!b && JSON.stringify(a) === JSON.stringify(b));
/** 고정 주문이 아직 미해결이면 그 주문, 아니면 이 화면이 맡는 첫 미해결 주문(createdAt → orderID). 순수. */
export function selectRecovery(all: PaymentRecovery[], screen: RecoveryScreen, pinnedID: string | null, hidden: Set<string>): PaymentRecovery | null {
  const pinned = pinnedID ? all.find((o) => o.orderID === pinnedID) : undefined;
  if (pinned) return pinned;
  return all.find((o) => !hidden.has(o.orderID) && matchesScreen(o, screen)) || null;
}
export function usePaymentRecovery(screen: RecoveryScreen) {
  const { flow, planner, productType } = screen;
  const [initial] = useState<PaymentRecovery | null>(() => selectRecovery(listRecoveryOrders(), { flow, planner, productType }, null, new Set()));
  const pinnedRef = useRef<string | null>(initial ? initial.orderID : null);
  const hiddenRef = useRef<Set<string>>(new Set());
  const pick = useCallback((): PaymentRecovery | null => {
    const next = selectRecovery(listRecoveryOrders(), { flow, planner, productType }, pinnedRef.current, hiddenRef.current);
    pinnedRef.current = next ? next.orderID : null;
    return next;
  }, [flow, planner, productType]);
  const [recovery, setRecovery] = useState<PaymentRecovery | null>(initial);
  const pendingRef = useRef<PaymentRecovery | null>(initial);
  const refresh = useCallback(() => {
    const next = pick();
    if (sameRecovery(pendingRef.current, next)) return;
    pendingRef.current = next;
    setRecovery(next);
  }, [pick]);
  // r17: 화면 조건(flow·플래너·상품)이 바뀌면 즉시 재선택(구독 교체만 하면 상품 전환 뒤 그 상품 주문 대신 Book now 가 남았다).
  //   고정된(확인 중) 주문은 그대로 유지된다(selectRecovery).
  //   r17-8: bfcache 복원(pageshow persisted)도 재조회 — 첫 렌더와 구독 사이·숨은 동안 놓친 변경으로 끝난 주문 패널이 고착되지 않게.
  useEffect(() => {
    refresh();
    const unsubscribe = subscribeRecovery(refresh);
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) refresh(); };
    window.addEventListener('pageshow', onShow);
    return () => { unsubscribe(); window.removeEventListener('pageshow', onShow); };
  }, [refresh]);
  const remember = useCallback((value: Omit<PaymentRecovery, 'updatedAt'> & { updatedAt?: number }) => {
    hiddenRef.current.delete(value.orderID);
    pinnedRef.current = value.orderID;
    const saved = saveRecoveryOrder({
      orderID: value.orderID, flow: value.flow, paymentStatus: value.paymentStatus, review: value.review,
      ...(value.authRequired ? { authRequired: true } : {}), ...(value.productType ? { productType: value.productType } : {}),
    });
    refresh();
    return !!saved && saved.persisted !== false;
  }, [refresh]);
  /** opts.provisional: 영구 완료가 아닌 증거(no_attempt_record) — 완료 표식 없이 놓는다(r17-6). */
  const clearRecovery = useCallback((orderID: string, opts?: { provisional?: boolean }) => {
    const current = pendingRef.current;
    if (current && current.orderID !== orderID) return;
    if (pinnedRef.current === orderID) pinnedRef.current = null;
    if (opts && opts.provisional) dropRecoveryOrder(orderID);
    else finishRecoveryOrder(orderID);
    refresh();
  }, [refresh]);
  const forgetRecovery = useCallback((orderID: string) => {
    if (pendingRef.current && pendingRef.current.orderID !== orderID) return;
    hiddenRef.current.add(orderID);
    if (pinnedRef.current === orderID) pinnedRef.current = null;
    refresh();
  }, [refresh]);
  return { recovery, pendingRef, remember, clearRecovery, forgetRecovery, refresh };
}

export const PAYMENT_RECOVERY_COPY = {
  ko: { unknown: '결제 결과를 확인 중입니다', captured: '결제는 접수됐으며 예약을 저장하는 중입니다', review: '결제가 접수되어 담당자가 확인 중입니다', authRequired: '이 주문은 결제를 시작한 기기에서만 확인할 수 있습니다. 문의해 주세요.', detail: '같은 주문의 결제·예약 상태를 다시 확인해 주세요. 확인 전에는 새 결제를 만들 수 없습니다.', warn: '다시 결제하지 마세요. 중복 청구될 수 있습니다.', check: '같은 주문 확인', checking: '확인 중…', order: '주문 번호', contact: '문의하기', notCaptured: '결제가 완료되지 않았습니다. 다시 결제할 수 있습니다.', otherOrder: '이 결제는 다른 주문({{order}})으로 확인됐어요. 다시 결제하지 마세요 — 그 주문의 화면에서 이어서 진행하시거나 문의해 주세요.', otherOrderPending: '이 브라우저에 아직 확인 중인 다른 주문({{order}})이 있어요. 다시 결제하지 마세요 — 그 주문의 화면에서 확인하시거나 문의해 주세요.', close: '닫기' },
  en: { unknown: 'Checking your payment result', captured: 'Payment received; your booking is being recorded', review: 'Payment received; our team is verifying it', authRequired: 'This order can only be checked from the device that started the payment. Please contact us.', detail: 'Check the payment and booking status of this same order. A new payment cannot start until it is resolved.', warn: 'Do not pay again. It may result in a duplicate charge.', check: 'Check this order', checking: 'Checking…', order: 'Order No.', contact: 'Contact us', notCaptured: 'Payment was not completed. You can pay again.', otherOrder: 'This payment was confirmed for a different order ({{order}}). Do not pay again — continue on that order\'s page or contact us.', otherOrderPending: 'Another order ({{order}}) in this browser is still being confirmed. Do not pay again — check it on that order\'s page or contact us.', close: 'Close' },
  ja: { unknown: 'お支払い結果を確認中です', captured: 'お支払いを受け付け、ご予約を記録しています', review: 'お支払いを受け付け、担当者が確認中です', authRequired: 'この注文はお支払いを開始した端末でのみ確認できます。お問い合わせください。', detail: '同じ注文のお支払いと予約状況を再確認してください。解決するまで新しいお支払いは開始できません。', warn: '二重請求を防ぐため、再度お支払いしないでください。', check: '同じ注文を確認', checking: '確認中…', order: '注文番号', contact: 'お問い合わせ', notCaptured: 'お支払いは完了していません。再度お支払いいただけます。', otherOrder: 'このお支払いは別のご注文（{{order}}）として確認されました。再度お支払いしないでください — そのご注文の画面で続けるか、お問い合わせください。', otherOrderPending: 'このブラウザでは別のご注文（{{order}}）をまだ確認中です。再度お支払いしないでください — そのご注文の画面で確認するか、お問い合わせください。', close: '閉じる' },
  zh: { unknown: '正在核实付款结果', captured: '已收到付款，正在记录预订', review: '已收到付款，工作人员正在核实', authRequired: '此订单只能在发起付款的设备上核实。请联系我们。', detail: '请再次核实此订单的付款与预订状态。解决前无法开始新的付款。', warn: '请勿重复付款，以免重复扣款。', check: '核实此订单', checking: '正在核实…', order: '订单号', contact: '联系我们', notCaptured: '付款未完成，您可以重新付款。', otherOrder: '此付款已确认为另一笔订单（{{order}}）。请勿重复付款 — 请在该订单页面继续或联系我们。', otherOrderPending: '此浏览器中另一笔订单（{{order}}）仍在核实中。请勿重复付款 — 请在该订单页面核实或联系我们。', close: '关闭' },
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
