/**
 * 2026-11-21 개인정보 보관 기간 정기 작업(api/_crons/privacy-retention-sweep.js).
 * 메모리 속 가짜 Firestore 로 돌린다: 개수만 세기(기본) · 지우기(스위치 켬) · 결제 칸 남김 · 하루 상한 · 시트.
 */
import { describe, it, expect, vi } from 'vitest';

const { FakeFieldPath, DELETE, DOC_ID } = vi.hoisted(() => {
  const DOC_ID = { __documentId: true };
  class FakeFieldPath { segments: string[]; constructor(...segments: string[]) { this.segments = segments; } static documentId() { return DOC_ID; } }
  return { FakeFieldPath, DELETE: { __delete: true }, DOC_ID };
});

vi.mock('firebase-admin/firestore', () => ({
  FieldPath: FakeFieldPath,
  FieldValue: { delete: () => DELETE },
}));
vi.mock('../../api/_shared/cron-auth.js', () => ({ verifyCronRequest: vi.fn(async () => ({ ok: false, status: 401 })) }));

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import handler, { privacyRetentionSweepTask, DAILY_WRITE_CAP, IP_RATE_LIMIT_COLLECTIONS } from '../../api/_crons/privacy-retention-sweep.js';

// ── 가짜 Firestore ─────────────────────────────────────────────────────────
class Ts { constructor(public ms: number) {} toMillis() { return this.ms; } }
const kst = (iso: string) => Date.parse(`${iso}+09:00`);
const ts = (iso: string) => new Ts(kst(iso));
type Data = Record<string, unknown>;

// 진짜 Firestore 처럼 타입이 다르면 비교가 안 된다(Timestamp/Date 끼리, 숫자끼리, 문자열끼리만).
const kind = (v: unknown) => (v instanceof Ts || v instanceof Date ? 'time' : typeof v);
const num = (v: unknown) => (v instanceof Ts ? v.ms : v instanceof Date ? v.getTime() : v) as number | string;

function makeDb(seed: Record<string, Record<string, Data>> = {}, { failOn = '' } = {}) {
  const store = new Map<string, Map<string, Data>>();
  const col = (path: string) => { if (!store.has(path)) store.set(path, new Map()); return store.get(path)!; };
  for (const [name, docs] of Object.entries(seed)) for (const [id, data] of Object.entries(docs)) col(name).set(id, data);
  const writes: string[] = [];

  const ref = (path: string, id: string): any => ({
    id, path: `${path}/${id}`,
    async get() { const d = col(path).get(id); return { exists: !!d, id, data: () => d }; },
    async set(data: Data) { writes.push(`set ${path}/${id}`); col(path).set(id, data); },
    async delete() { writes.push(`delete ${path}/${id}`); col(path).delete(id); },
    async update(...args: unknown[]) {
      writes.push(`update ${path}/${id}`);
      const d = col(path).get(id); if (!d) throw new Error('NOT_FOUND');
      for (let i = 0; i < args.length; i += 2) {
        const field = args[i]; const value = args[i + 1];
        const segs = field instanceof FakeFieldPath ? field.segments : String(field).split('.');
        let node: any = d;
        for (const s of segs.slice(0, -1)) { if (typeof node[s] !== 'object' || node[s] === null) node[s] = {}; node = node[s]; }
        if (value === DELETE) delete node[segs.at(-1)!]; else node[segs.at(-1)!] = value;
      }
    },
    collection: (sub: string) => query(`${path}/${id}/${sub}`),
  });
  const snapOf = (path: string, entries: [string, Data][]) => {
    const docs = entries.map(([id, data]) => ({ id, ref: ref(path, id), data: () => data }));
    return { docs, size: docs.length, empty: docs.length === 0 };
  };
  const query = (path: string, filters: [string, string, unknown][] = [], order: any = '', lim = 0, after = ''): any => ({
    where: (f: string, op: string, v: unknown) => query(path, [...filters, [f, op, v]], order, lim, after),
    orderBy: (f: any) => query(path, filters, f, lim, after),
    limit: (n: number) => query(path, filters, order, n, after),
    startAfter: (doc: { id: string }) => query(path, filters, order, lim, doc.id),
    select: () => query(path, filters, order, lim, after),
    doc: (id: string) => ref(path, id),
    async get() {
      if (failOn && path === failOn) throw new Error('boom secret@example.test');
      let rows = [...col(path).entries()].filter(([, d]) => filters.every(([f, op, v]) => {
        const have = String(f).split('.').reduce((o: any, k) => (o == null ? undefined : o[k]), d);
        if (op === '==') return have === v;
        if (op === 'in') return (v as unknown[]).includes(have);
        return kind(have) === kind(v) && num(have) <= num(v);
      }));
      if (order) rows.sort((a, b) => { const x = order === DOC_ID ? a[0] : num(a[1][order]); const y = order === DOC_ID ? b[0] : num(b[1][order]); return x < y ? -1 : x > y ? 1 : a[0] < b[0] ? -1 : 1; });
      if (after) rows = rows.slice(rows.findIndex(([id]) => id === after) + 1);
      if (lim) rows = rows.slice(0, lim);
      return snapOf(path, rows);
    },
  });
  // 가짜 Storage — 지운 파일도 writes 에 남겨 "세기만이면 아무것도 안 바꿈"을 같이 본다.
  const storage = {
    fail: false,
    async deleteFile(bucket: string, path: string) {
      if (storage.fail) throw new Error('storage boom secret@example.test');
      writes.push(`storage delete ${bucket}/${path}`);
    },
  };
  return { db: { collection: (name: string) => query(name) }, store, writes, col, storage };
}

const BUCKET = 'proj.firebasestorage.app';
const receiptUrl = (path: string, bucket = BUCKET) =>
  `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=t`;

// ── 시드: 지금 = 2026-11-21 04:41 KST(정기 작업 시각) ─────────────────────────
const NOW = kst('2026-11-21T04:41:00');
const PAYMENT = { bookingRef: 'CT-1', amount: 100, currency: 'USD', payerEmail: 'buyer@example.test', payerName: 'Test Buyer', paypalOrderId: 'P1', captureId: 'CAP1' };

function seed() {
  return {
    bookings: {
      'b-old': { ...PAYMENT, status: 'CONFIRMED', tourDate: '2026-10-01', tourEndDate: '2026-10-03', createdAt: ts('2026-09-20T10:00:00'),
        customerPhone: '+82-10-0000-0000', pickupLocation: 'Test Hotel', flightNumber: 'KE001', memo: 'Messenger: wa-test', itineraryData: { day1: 'x' }, driverChatId: 42 },
      'b-recent': { ...PAYMENT, status: 'CONFIRMED', tourDate: '2026-10-20', tourEndDate: '2026-10-22', memo: 'm' }, // 11/23 부터
      'b-refund': { ...PAYMENT, status: 'REFUND_PENDING', tourDate: '2026-09-01', memo: 'm' },
      'b-noend': { ...PAYMENT, status: 'CONFIRMED', tourDate: '2026-10-10', memo: 'm' }, // 끝날 모름 → 10/24 → 11/25 부터
      'b-snap': { ...PAYMENT, status: 'COMPLETED', tourDate: '2026-10-10', orderID: 'P-snap', memo: 'm' }, // 스냅샷 끝날 10/12 → 11/13 부터
      'b-clean': { ...PAYMENT, status: 'CONFIRMED', tourDate: '2026-09-01', privacyRetention: { version: 1, scrubbedAtMs: 1 } },
      'b-moved': { status: 'CONFIRMED', orderID: 'P5', tourDate: '2026-11-10' }, // 손님이 10/01 → 11/10 으로 옮김(사본은 옛 날짜)
      P6: { status: 'REFUND_PENDING', tourDate: '2026-11-10' }, // 문서 번호 = 주문 번호, 환불 진행 중
    },
    dispatch_messages: { dm1: { orderID: 'b-old', text: 'pickup Test Hotel' } },
    paypal_order_snapshots: { 'P-snap': { dateEnd: '2026-10-12' }, P1: { dateEnd: '2026-10-03' } },
    pending_bookings: {
      pb1: { ...PAYMENT, status: 'CONFIRMED', dateStart: '2026-10-01', dateEnd: '2026-10-02', customerPhone: '+82', memo: 'm' },
      pb2: { ...PAYMENT, status: 'AWAITING_VERIFICATION', dateStart: '2026-10-01', memo: 'm', createdAt: ts('2026-10-01T00:00:00') }, // 신청 + 1개월 지남
      pb3: { ...PAYMENT, status: 'AWAITING_VERIFICATION', dateStart: '2026-12-01', memo: 'm', createdAt: ts('2026-11-01T00:00:00') }, // 아직
      pb4: { ...PAYMENT, status: 'AWAITING_VERIFICATION', dateStart: '2026-12-01', memo: 'm' }, // 신청 시각 모름 → 남김
      // 기간은 지났지만 PayPal 이 이 번호로 돈을 보낸 기록(금액 불일치로 자동 확정 안 됨)이 있음 → 남김
      pb5: { ...PAYMENT, status: 'AWAITING_VERIFICATION', dateStart: '2026-12-01', memo: 'm', createdAt: ts('2026-10-01T00:00:00') },
      // 신청 때 가격 확인 실패 표시가 있어도 예외 없음(운영자 11/22) → 신청 + 1개월에 지움
      pb6: { ...PAYMENT, status: 'AWAITING_VERIFICATION', operatorReviewRequired: true, dateStart: '2026-12-01', memo: 'm', createdAt: ts('2026-10-01T00:00:00') },
    },
    paypal_webhook_log: {
      ev1: { status: 'unmatched', detail: { reason: 'amount_mismatch', bookingRef: 'pb5' } },
    },
    used_paypal_orders: {
      P1: { createdAtMs: kst('2026-09-25T00:00:00'), finalized: true, intent: { body: { tourDate: '2026-10-01', amount: 100, payerEmail: 'buyer@example.test', customerPhone: '+82', memo: 'm' } } },
      // 격리 + 결제 검토 미해결 → 복구가 intent 로 다시 돌릴 수 있어 남김
      P3: { createdAtMs: kst('2026-09-25T00:00:00'), reviewQuarantined: true, captureState: 'captured', intent: { body: { tourDate: '2026-10-01', memo: 'm' } } },
      P4: { createdAtMs: kst('2026-09-25T00:00:00'), captureState: 'posted', intent: { body: { tourDate: '2026-10-01', memo: 'm' } } }, // 미완료
      P5: { createdAtMs: kst('2026-09-25T00:00:00'), finalized: true, intent: { body: { tourDate: '2026-10-01', memo: 'm' } } }, // 예약은 11/10 으로 옮김
      P6: { createdAtMs: kst('2026-09-25T00:00:00'), finalized: true, intent: { body: { tourDate: '2026-10-01', memo: 'm' } } }, // 예약 환불 중
      // 결제 전 장바구니의 결제 시도 기록(같은 번호). createdAtMs 가 없어 위 사본 훑기엔 안 잡힘.
      c3: { captureState: 'captured', captureID: 'CAPX' }, // 돈 가져감 → 장바구니 남김
      c4: { captureState: 'not_captured' }, // 돈 안 가져감 → 장바구니 지움
    },
    payment_reviews: {
      P2: { createdAt: ts('2026-09-25T00:00:00'), resolvedAt: null, bookingPayload: { tourDate: '2026-10-01', memo: 'm' } },
      P3: { createdAt: ts('2026-09-25T00:00:00'), resolvedAt: null, bookingPayload: { lineCount: 1 } },
    },
    cart_orders: {
      c1: { status: 'captured', createdAt: ts('2026-09-25T00:00:00'), total: 300,
        lines: [{ productId: 'tour-1', amount: 300, booking: { dateStart: '2026-10-01', dateEnd: '2026-10-02', customerPhone: '+82', pickupLocation: 'Test Hotel', at: ts('2026-09-25T00:00:00') } }] },
      // 결제 전(created) = 만든 날 + 1개월, 결제 시도 기록이 없거나 돈을 안 가져갔을 때만 문서 삭제(운영자 11/22)
      c2: { status: 'created', createdAt: ts('2026-09-25T00:00:00'), lines: [{ booking: { dateStart: '2026-10-01', memo: 'm' } }] }, // 시도 기록 없음
      c3: { status: 'created', createdAt: ts('2026-09-25T00:00:00'), lines: [{ booking: { memo: 'm' } }] }, // 돈 가져감 → 남김
      c4: { status: 'created', createdAt: ts('2026-09-25T00:00:00'), lines: [{ booking: { memo: 'm' } }] }, // not_captured
      c5: { status: 'created', createdAt: ts('2026-10-22T00:00:00'), lines: [] }, // 11/23 부터
    },
    intent_classifier_logs: {
      ic1: { ts: '2026-10-01T03:00:00.000Z', email: 'guest@example.test', raw_text: 'pick me up at Test Hotel' },
      ic2: { ts: '2026-11-20T03:00:00.000Z', email: 'guest@example.test' }, // 범위 밖
    },
    error_log: { el1: { createdAt: kst('2026-10-01T00:00:00'), message: 'CT-1 buyer@example.test' }, el2: { createdAt: kst('2026-11-20T00:00:00'), message: 'x' } },
    pending_free_claims: {
      fc1: { status: 'approved', email: 'claim@example.test', flightRef: 'PNR1', createdAt: ts('2026-09-28T00:00:00'), reviewedAt: ts('2026-10-01T00:00:00'),
        receipts: [{ name: 'a.pdf', url: receiptUrl('free_claims/claim_example_test/a.pdf'), size: 1 }] },
      fc2: { status: 'pending', email: 'claim@example.test', createdAt: ts('2026-09-01T00:00:00') }, // 처리 전 = 세기만
      fc3: { status: 'rejected', email: 'claim@example.test', createdAt: ts('2026-11-01T00:00:00'), reviewedAt: ts('2026-11-15T00:00:00') }, // 아직
      fc4: { status: 'approved', email: 'claim@example.test', reviewedAt: ts('2026-10-01T00:00:00'), receipts: [{ url: receiptUrl('community/u1/a.jpg') }] }, // free_claims/ 밖
      fc5: { status: 'rejected', email: 'claim@example.test', reviewedAt: ts('2026-10-01T00:00:00'),
        receipts: [{ url: receiptUrl('free_claims/x/a.pdf', 'other-project.appspot.com') }] }, // 남의 버킷
      fc6: { status: 'rejected', email: 'claim@example.test', reviewedAt: ts('2026-10-01T00:00:00') }, // 영수증 없음 → 문서만
    },
    mood_booking_change_idempotency: {
      mi1: { action: 'approve', bookingId: 'm1', actorEmail: 'partner@example.test', payloadHash: 'h', quoteId: 'q', status: 'completed',
        response: { ok: true, data: { newAmountKRW: 1 } }, createdAt: kst('2026-10-01T00:00:00'), completedAt: kst('2026-10-01T00:00:00') },
      mi2: { actorEmail: 'partner@example.test', status: 'completed', response: { ok: true }, completedAt: kst('2026-10-22T12:00:00') }, // 11/23 부터
    },
    chat_rate_limits: {
      'u:user-1': { t: [1], updatedAt: kst('2026-11-17T00:00:00') },
      'usr:user-1:2026-11-17': { c: 3, lastUpdated: kst('2026-11-17T00:00:00') },
      'u:user-2': { t: [], updatedAt: kst('2026-11-19T00:30:00') }, // 11/22 부터
    },
    preview_lead_rate_limits: { h1: { count: 1, lastSeenAtMs: kst('2026-11-18T00:00:00') }, h2: { count: 1, lastSeenAtMs: kst('2026-11-20T01:00:00') } },
    inquiry_rate_limits: { h1: { count: 1, lastSeenAtMs: kst('2026-11-18T00:00:00') } },
    inquiry_auto_ack_recipients: { '2026-11-17-abc': { day: '2026-11-17', reservedAtMs: kst('2026-11-17T09:00:00') } },
    mood_bookings: {
      m1: { status: 'completed', date: '2026-10-01', price: 500, origin: 'A', destination: 'B', note: 'n', breakdown: { origin: 'A', destination: 'B', fare: 300 },
        courseMoodPercentages: [100, 0], courseShareSchemaVersion: 2 }, // 부담률 = 돈 기록, 남김
      m2: { status: 'confirmed', date: '2026-10-02', origin: 'A', bookingChangeApproval: { status: 'pending' } },
      m3: { status: 'completed', date: '2026-10-03', origin: 'A', settlementApproval: { status: 'changes_requested' } }, // 정산 다툼
      m4: { status: 'confirmed', date: '2026-10-04', serviceType: 'vehicle', origin: 'A', breakdown: { origin: 'A' } }, // 정산 전
      m5: { status: 'confirmed', date: '2026-10-05', serviceType: 'airport', origin: 'ICN' }, // 정액 = 정산 없음
    },
    mood_booking_change_events: {
      e1: { bookingId: 'm1', reason: 'time', before: { origin: 'A', price: 500 }, after: { destination: 'C' } },
      // 감사 기록 = 변경을 마친 날 + 1개월에 직원 이메일 칸만 비움(운영자 11/22). 협력사 번호·금액은 남김
      'ev-old': { type: 'booking_change_approved', bookingId: 'm9', clientId: 'client-1', actorEmail: 'staff@example.test', proposedByEmail: 'staff2@example.test',
        oldAmountKRW: 100, newAmountKRW: 200, before: { price: 100, updatedByEmail: 'staff@example.test', bookingChangeApproval: { status: 'approved', approvedByEmail: 'staff@example.test' } },
        after: { price: 200 }, createdAt: kst('2026-10-01T00:00:00') },
      'ev-new': { type: 'booking_changed', clientId: 'client-1', actorEmail: 'staff@example.test', createdAt: kst('2026-10-22T12:00:00') }, // 11/23 부터
    },
    mood_notification_outbox: { ob1: { type: 'mood_booking_changed', clientId: 'client-1', actorEmail: 'staff@example.test', status: 'pending', createdAt: kst('2026-10-01T00:00:00') } },
    preview_leads: { l1: { lastSeenAtMs: kst('2026-10-01T12:00:00'), email: 'lead@example.test' }, l2: { lastSeenAtMs: kst('2026-11-20T12:00:00'), email: 'x' } },
    charter_inquiries: {
      q1: { status: 'responded', createdAt: ts('2026-10-01T00:00:00'), updatedAt: ts('2026-10-01T00:00:00'), updatedAtMs: kst('2026-10-28T10:00:00') }, // 답한 날 + 30일 = 11/28 부터
      q2: { status: 'NEW', createdAt: ts('2026-10-01T00:00:00'), updatedAt: ts('2026-10-01T00:00:00') },
      q3: { status: 'closed', createdAt: ts('2026-09-01T00:00:00'), updatedAt: ts('2026-09-01T00:00:00'), updatedAtMs: kst('2026-10-01T10:00:00') },
    },
    chat_sessions: { s1: { lastMessageAt: ts('2026-10-01T00:00:00') } },
    'chat_sessions/s1/messages': { x1: { text: 'hi' }, x2: { text: 'there' } },
    inquiry_messages: { r1: { sessionId: 's1', text: 'relay' } },
    pending_email_retries: { 'r-done': { status: 'done', sweptAt: ts('2026-10-01T00:00:00') }, 'r-manual': { status: 'manual-intervention', sweptAt: ts('2026-10-01T00:00:00') } },
    pending_processor_retries: {
      'p-ok': { status: 'done', completedAt: ts('2026-10-01T00:00:00'), updatedAt: ts('2026-10-01T00:00:00'), payload: { customerPhone: '+82' } },
      'p-new': { status: 'done', completedAt: ts('2026-11-15T00:00:00'), payload: { customerPhone: '+82' } },
    },
    // 10/03 = 정산 다툼이 열린 협력사 예약이 있는 날 → 남김
    mood_schedule_notes: { '2026-10-01': { month: '2026-10', text: 'n' }, '2026-10-03': { month: '2026-10', text: 'n' }, '2026-11-15': { month: '2026-11', text: 'n' } },
    // 3년: 처리 마친 것(resolved)만 지움, 처리 중(in_progress)은 남김(운영자 11/22)
    cs_tickets: { t1: { status: 'resolved', createdAt: ts('2023-11-01T00:00:00') }, t2: { status: 'open', createdAt: ts('2024-06-01T00:00:00') },
      t3: { status: 'in_progress', createdAt: ts('2023-10-01T00:00:00') } },
    external_inbox_cases: { k1: { status: 'protected', updatedAtMs: kst('2023-01-01T00:00:00') } },
    plans: {
      g1: { uid: null, createdAtMs: kst('2026-08-20T00:00:00'), guestEmail: 'guest@example.test', paymentSource: 'ai-coupon', isFreeCoupon: true, input: { startDate: '2026-09-01', durationDays: 3 } }, // 무료 쿠폰, 끝 9/03
      g2: { uid: null, createdAtMs: kst('2026-08-20T00:00:00'), input: { startDate: '2026-09-01', durationDays: 3 } }, // 신고 열림
      g3: { uid: null, createdAtMs: kst('2026-10-01T00:00:00'), paymentSource: 'test', input: { startDate: '2026-10-15', durationDays: 7 } }, // 끝 10/21 → 11/22 부터
      g4: { uid: null, createdAtMs: kst('2026-10-01T00:00:00'), paymentSource: 'admin-bypass', isAdminBypass: true, input: { startDate: '2026-10-10' } }, // 일수 모름 → 10/24 → 11/25 부터
      g5: { uid: null, createdAtMs: kst('2026-08-20T00:00:00'), paymentSource: 'paypal', input: { startDate: '2026-09-01', durationDays: 3, paypalOrderId: '5AB12345CD678901E' } }, // 돈 냄, 180일 안 됨
      // 돈 낸 뒤 만들기가 멈춘 일정(주문 번호 없음) = 낸 것으로 봄. 180일·여행 끝 + 1개월 둘 다 지남 → 지움
      g6: { uid: null, createdAtMs: kst('2026-03-01T00:00:00'), status: 'error', paymentSource: 'paypal', input: { startDate: '2026-03-10' } },
      // 여행 끝 + 1개월은 지났지만 180일(6/01 → 11/29 부터)이 안 됨 → 남김
      g7: { uid: null, createdAtMs: kst('2026-06-01T00:00:00'), status: 'streaming', paymentSource: 'paypal', input: { startDate: '2026-06-10' } },
      // 180일은 지났지만 여행 끝(11/03) + 1개월이 안 됨 → 남김
      g8: { uid: null, createdAtMs: kst('2026-03-01T00:00:00'), paymentSource: 'manual', input: { startDate: '2026-11-01', durationDays: 3, paypalOrderId: 'MANUAL-1' } },
      // 결제 출처 칸이 하나도 없는 옛 일정 = 모름 → 낸 것으로 보고 180일 남김
      g9: { uid: null, createdAtMs: kst('2026-08-20T00:00:00'), input: { startDate: '2026-09-01', durationDays: 3 } },
      u1: { uid: 'user-1', createdAtMs: kst('2026-08-20T00:00:00'), input: { startDate: '2026-09-01', durationDays: 3 } },
    },
    plan_complaints: {
      pc1: { planId: 'g2', status: 'open', createdAt: ts('2026-10-01T00:00:00') },
      pc2: { planId: 'gone', status: 'reviewed', createdAt: ts('2023-10-01T00:00:00') }, // 3년 지났지만 처리 중 → 남김
      pc3: { planId: 'gone2', status: 'resolved', createdAt: ts('2023-10-01T00:00:00') }, // 3년 + 처리 끝 → 지움
    },
  } as Record<string, Record<string, Data>>;
}

const run = (fake: ReturnType<typeof makeDb>, env: Record<string, string> = {}, extra: Record<string, unknown> = {}) =>
  privacyRetentionSweepTask({ env: { FIREBASE_PROJECT_ID: 'proj', ...env }, now: () => NOW, clock: () => 0, db: fake.db, storage: fake.storage, ...extra } as never) as Promise<any>;

const dump = (store: Map<string, Map<string, Data>>) => [...store.entries()].filter(([, v]) => v.size).map(([k, v]) => [k, [...v.entries()]]);

describe('기본 = 개수만 셈 (스위치 꺼짐)', () => {
  it('아무것도 바꾸지 않고 상태 문서 하나만 쓴다', async () => {
    const fake = makeDb(seed());
    const result = await run(fake);
    expect(result).toMatchObject({ ok: true, code: 'RETENTION_COMPLETED', mode: 'count', writes: 0 });
    expect(fake.writes).toEqual(['set privacy_retention_state/last']);
    fake.store.delete('privacy_retention_state');
    expect(dump(fake.store)).toEqual(dump(makeDb(seed()).store));
  });

  it('칸별 개수', async () => {
    const { counts } = await run(makeDb(seed()));
    expect(counts.bookings).toEqual({ due: 2, notYet: 2, heldStatus: 1, alreadyClean: 1 }); // b-old·b-snap / b-recent·b-noend
    expect(counts.pending_bookings).toEqual({ due: 1, heldStatus: 1 });
    expect(counts.used_paypal_orders).toEqual({ due: 1, heldQuarantined: 1, heldUnfinished: 1, notYet: 1, heldBookingStatus: 1 }); // P1 / P3 / P4 / P5 / P6
    expect(counts.payment_reviews).toEqual({ heldUnresolved: 1, alreadyClean: 1 });
    expect(counts.cart_orders).toEqual({ due: 1 });
    expect(counts.cart_orders_unpaid).toEqual({ due: 2, heldPaymentAttempt: 1, notYet: 1 }); // c2·c4 / c3 / c5
    expect(counts.intent_classifier_logs).toEqual({ due: 1 });
    expect(counts.error_log).toEqual({ due: 1 });
    // fc1·fc6 / fc1 영수증 1개 / fc2 / fc3 / fc4·fc5
    expect(counts.pending_free_claims).toEqual({ due: 2, receiptFilesDue: 1, heldPending: 1, notYet: 1, heldReceiptUnknown: 2 });
    expect(counts.mood_booking_change_idempotency).toEqual({ due: 1, notYet: 1 });
    expect(counts.mood_booking_change_events_emails).toEqual({ due: 1, notYet: 1 });
    expect(counts.mood_notification_outbox_emails).toEqual({ due: 1 });
    expect(counts.chat_rate_limits).toEqual({ due: 1, notYet: 1 });
    expect(counts.chat_rate_limits_daily).toEqual({ due: 1 });
    expect(counts.preview_lead_rate_limits).toEqual({ due: 1, notYet: 1 });
    expect(counts.inquiry_rate_limits).toEqual({ due: 1 });
    expect(counts.inquiry_auto_ack_recipients).toEqual({ due: 1 });
    expect(counts.mood_bookings).toEqual({ due: 2, heldStatus: 3 });
    expect(counts.preview_leads).toEqual({ due: 1 }); // l2 는 범위 밖
    expect(counts.charter_inquiries).toEqual({ due: 1, notYet: 1, heldOpen: 1 });
    expect(counts.chat_sessions).toEqual({ due: 1 });
    expect(counts.pending_email_retries).toEqual({ due: 1 }); // 사람이 봐야 하는 것은 아예 안 잡힘
    expect(counts.pending_processor_retries).toEqual({ due: 1, notYet: 1 });
    expect(counts.mood_schedule_notes).toEqual({ due: 1, heldDispute: 1 });
    expect(counts.cs_tickets).toEqual({ due: 1, heldOpen: 1 });
    expect(counts.plan_complaints).toEqual({ due: 1, heldOpen: 1 });
    expect(counts.external_inbox_cases).toEqual({ dueCountOnly: 1 });
    expect(counts.plans_guest).toEqual({ due: 2, heldComplaint: 1, heldPaid: 3, notYet: 3, member: 1 }); // g1·g6 / g5·g7·g9 / g3·g4·g8
    expect(counts.pending_bookings_unverified).toEqual({ due: 2, notYet: 1, noDate: 1, heldPaymentSeen: 1 }); // pb2·pb6 / pb3 / pb4 / pb5
    expect(counts.sheet_bookings).toBeUndefined(); // 운영이 아니면 시트는 안 읽음
    expect(counts.sheet_leads).toBeUndefined();
  });

  it('결과·상태 문서에 손님 값이 없다', async () => {
    const fake = makeDb(seed());
    const result = await run(fake);
    const text = JSON.stringify([result, fake.col('privacy_retention_state').get('last')]);
    for (const secret of ['example.test', 'Test Buyer', '+82', 'Test Hotel', 'KE001', 'wa-test']) expect(text).not.toContain(secret);
  });
});

describe('스위치 켬 = 지움', () => {
  const ENV = { PRIVACY_RETENTION_DELETE_ENABLED: 'true' };

  it('예약: 여행 준비 칸만 비우고 결제·계약 칸은 그대로', async () => {
    const fake = makeDb(seed());
    const result = await run(fake, ENV);
    expect(result).toMatchObject({ ok: true, mode: 'delete' });
    const b = fake.col('bookings').get('b-old')!;
    for (const key of ['customerPhone', 'pickupLocation', 'flightNumber', 'memo', 'itineraryData']) expect(b).not.toHaveProperty(key);
    expect(b).toHaveProperty('driverChatId', 42); // 기사 배정 = 기사별 매출(/sales)용, 손님 정보 아님
    expect(b).toMatchObject({ ...PAYMENT, status: 'CONFIRMED', tourDate: '2026-10-01', tourEndDate: '2026-10-03', privacyRetention: { version: 1, scrubbedAtMs: NOW } });
    expect(b.createdAt).toBeInstanceOf(Ts); // Timestamp 뭉개지지 않음
    expect(fake.col('dispatch_messages').has('dm1')).toBe(false);
    expect(fake.col('bookings').get('b-snap')).not.toHaveProperty('memo');
    // 아직 아님·보류는 그대로
    for (const id of ['b-recent', 'b-noend', 'b-refund']) expect(fake.col('bookings').get(id)).toHaveProperty('memo', 'm');
  });

  it('결제 기록 사본: 칸만 비우고 문서·금액은 남김 (이중 결제 잠금 유지)', async () => {
    const fake = makeDb(seed());
    await run(fake, ENV);
    expect(fake.col('used_paypal_orders').get('P1')).toEqual({
      createdAtMs: kst('2026-09-25T00:00:00'),
      finalized: true,
      intent: { body: { tourDate: '2026-10-01', amount: 100, payerEmail: 'buyer@example.test' } },
      privacyRetention: { version: 1, scrubbedAtMs: NOW },
    });
    for (const id of ['P3', 'P4', 'P5', 'P6']) expect(fake.col('used_paypal_orders').get(id)).toHaveProperty('intent.body.memo', 'm');
    // 결제 전 장바구니: 시도 기록 없음(c2)·돈 안 가져감(c4) = 지움, 돈 가져감(c3)·아직(c5) = 남김. 결제 시도 기록은 그대로.
    expect([...fake.col('cart_orders').keys()]).toEqual(['c1', 'c3', 'c5']);
    expect((fake.col('cart_orders').get('c3') as any).lines[0].booking).toHaveProperty('memo', 'm');
    expect(fake.col('used_paypal_orders').get('c4')).toEqual({ captureState: 'not_captured' });
    expect(fake.col('payment_reviews').get('P2')).toHaveProperty('bookingPayload.memo', 'm'); // 미해결 = 보류
    const c1 = fake.col('cart_orders').get('c1') as any;
    expect(c1).toMatchObject({ status: 'captured', total: 300, lines: [{ productId: 'tour-1', amount: 300, booking: { dateStart: '2026-10-01', dateEnd: '2026-10-02' } }] });
    expect(c1.lines[0].booking).not.toHaveProperty('customerPhone');
    expect(c1.lines[0].booking.at).toBeInstanceOf(Ts);
    expect(fake.col('pending_bookings').get('pb1')).toMatchObject({ ...PAYMENT, dateStart: '2026-10-01' });
    expect(fake.col('pending_bookings').get('pb1')).not.toHaveProperty('customerPhone');
    expect(fake.col('pending_bookings').has('pb2')).toBe(false); // 입금 확인 대기 신청 + 1개월 = 문서 삭제
    expect(fake.col('pending_bookings').get('pb3')).toHaveProperty('memo', 'm');
    expect(fake.col('pending_bookings').has('pb4')).toBe(true);
    expect(fake.col('pending_bookings').has('pb5')).toBe(true);
    expect(fake.col('pending_bookings').has('pb6')).toBe(false); // 가격 확인 실패 표시도 예외 없이 지움
  });

  it('협력사 예약: 출발·도착·메모와 변경 이력 사본까지 비우고 요금은 남김', async () => {
    const fake = makeDb(seed());
    await run(fake, ENV);
    expect(fake.col('mood_bookings').get('m1')).toEqual({
      status: 'completed', date: '2026-10-01', price: 500, breakdown: { fare: 300 },
      courseMoodPercentages: [100, 0], courseShareSchemaVersion: 2, privacyRetention: { version: 1, scrubbedAtMs: NOW } });
    expect(fake.col('mood_booking_change_events').get('e1')).toEqual({
      bookingId: 'm1', reason: 'time', before: { price: 500 }, after: {}, privacyRetention: { version: 1, scrubbedAtMs: NOW } });
    expect(fake.col('mood_bookings').get('m2')).toHaveProperty('origin', 'A');
    expect(fake.col('mood_bookings').get('m3')).toHaveProperty('origin', 'A'); // 정산 다툼
    expect(fake.col('mood_bookings').get('m4')).toHaveProperty('breakdown.origin', 'A'); // 정산 전 — 비우면 정산이 막힘
    expect(fake.col('mood_bookings').get('m5')).not.toHaveProperty('origin'); // 정액은 정산 없음
  });

  it('통째로 지우는 곳: 기간 지난 것만, 대화는 메시지·전달 기록까지', async () => {
    const fake = makeDb(seed());
    const { counts } = await run(fake, ENV);
    expect([...fake.col('preview_leads').keys()]).toEqual(['l2']);
    expect([...fake.col('charter_inquiries').keys()]).toEqual(['q1', 'q2']);
    expect(fake.col('chat_sessions').size).toBe(0);
    expect(fake.col('chat_sessions/s1/messages').size).toBe(0);
    expect(fake.col('inquiry_messages').size).toBe(0);
    expect(counts.chat_sessions).toMatchObject({ applied: 1, childrenDeleted: 3 });
    expect([...fake.col('pending_email_retries').keys()]).toEqual(['r-manual']);
    expect([...fake.col('pending_processor_retries').keys()]).toEqual(['p-new']);
    expect([...fake.col('mood_schedule_notes').keys()]).toEqual(['2026-10-03', '2026-11-15']);
    expect([...fake.col('cs_tickets').keys()]).toEqual(['t2', 't3']);
    expect([...fake.col('plan_complaints').keys()]).toEqual(['pc1', 'pc2']);
    // 비회원 일정: 여행 끝 + 1개월 지난 것만. 회원·신고 걸린 것·아직인 것은 남김
    expect([...fake.col('plans').keys()]).toEqual(['g2', 'g3', 'g4', 'g5', 'g7', 'g8', 'g9', 'u1']);
    // 분쟁 보존 문의 3년 = 켜도 세기만
    expect(fake.col('external_inbox_cases').has('k1')).toBe(true);
  });

  it('운영자 11/22 대상: 기록·무료 신청(영수증 파일 포함)·중복 막기 칸·속도 제한', async () => {
    const fake = makeDb(seed());
    const { counts } = await run(fake, ENV);
    expect([...fake.col('intent_classifier_logs').keys()]).toEqual(['ic2']);
    expect([...fake.col('error_log').keys()]).toEqual(['el2']);
    // 무료 신청: 처리 + 1개월 지난 것만 문서·영수증 삭제. 처리 전·아직·영수증 위치가 이상한 것은 남김
    expect([...fake.col('pending_free_claims').keys()]).toEqual(['fc2', 'fc3', 'fc4', 'fc5']);
    expect(fake.writes.filter(w => w.startsWith('storage'))).toEqual([`storage delete ${BUCKET}/free_claims/claim_example_test/a.pdf`]);
    // 파일 먼저, 문서는 그 뒤
    expect(fake.writes.indexOf('delete pending_free_claims/fc1')).toBeGreaterThan(fake.writes.indexOf(`storage delete ${BUCKET}/free_claims/claim_example_test/a.pdf`));
    expect(counts.pending_free_claims).toMatchObject({ applied: 2, receiptFilesDeleted: 1 });
    // 중복 막기 기록: 문서·요청 지문은 남기고(늦은 재전송 = 409) 이메일·응답만 비움
    expect(fake.col('mood_booking_change_idempotency').get('mi1')).toEqual({
      action: 'approve', bookingId: 'm1', payloadHash: 'h', quoteId: 'q', status: 'completed',
      createdAt: kst('2026-10-01T00:00:00'), completedAt: kst('2026-10-01T00:00:00'), privacyRetention: { version: 1, scrubbedAtMs: NOW } });
    expect(fake.col('mood_booking_change_idempotency').get('mi2')).toHaveProperty('actorEmail');
    // 감사 기록·알림 대기열: 직원 이메일 칸만(사본 안 포함) 비우고 협력사 번호·금액·문서는 남김
    expect(fake.col('mood_booking_change_events').get('ev-old')).toEqual({
      type: 'booking_change_approved', bookingId: 'm9', clientId: 'client-1', oldAmountKRW: 100, newAmountKRW: 200,
      before: { price: 100, bookingChangeApproval: { status: 'approved' } }, after: { price: 200 }, createdAt: kst('2026-10-01T00:00:00'),
      privacyRetention: { version: 1, scrubbedAtMs: NOW } });
    expect(fake.col('mood_booking_change_events').get('ev-new')).toHaveProperty('actorEmail');
    expect(fake.col('mood_notification_outbox').get('ob1')).toEqual({ type: 'mood_booking_changed', clientId: 'client-1', status: 'pending',
      createdAt: kst('2026-10-01T00:00:00'), privacyRetention: { version: 1, scrubbedAtMs: NOW } });
    expect([...fake.col('chat_rate_limits').keys()]).toEqual(['u:user-2']);
    expect([...fake.col('preview_lead_rate_limits').keys()]).toEqual(['h2']);
    expect(fake.col('inquiry_rate_limits').size).toBe(0);
    expect(fake.col('inquiry_auto_ack_recipients').size).toBe(0);
  });

  it('속도 제한 표는 전부 1일 뒤 지운다(처리방침 "속도 제한 기록 1~2일")', async () => {
    const fake = makeDb(Object.fromEntries(IP_RATE_LIMIT_COLLECTIONS.map((name: string) =>
      [name, { h: { count: 1, windowStartedAtMs: kst('2026-11-18T00:00:00'), lastSeenAtMs: kst('2026-11-18T00:00:00') } }])));
    const { counts } = await run(fake, ENV);
    for (const name of IP_RATE_LIMIT_COLLECTIONS) {
      expect(counts[name]).toEqual({ due: 1, applied: 1 });
      expect(fake.col(name).size).toBe(0);
    }
  });

  it('영수증 파일 지우기가 실패하면 신청 문서를 남긴다(다음 날 다시 찾게)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fake = makeDb(seed());
    fake.storage.fail = true;
    const result = await run(fake, ENV);
    expect(result).toMatchObject({ ok: false, code: 'RETENTION_REVIEW_REQUIRED' });
    expect(fake.col('pending_free_claims').has('fc1')).toBe(true);
    expect(fake.col('pending_free_claims').has('fc6')).toBe(false); // 영수증 없는 신청은 그대로 진행
    expect(result.counts.pending_free_claims).toMatchObject({ docError: 1, applied: 1 });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('example.test');
    warn.mockRestore();
  });

  it('우리 버킷을 모르면(프로젝트 설정 없음) 영수증 있는 신청은 하나도 안 지움', async () => {
    const fake = makeDb(seed());
    const result = await run(fake, { ...ENV, FIREBASE_PROJECT_ID: '' });
    expect(fake.col('pending_free_claims').has('fc1')).toBe(true);
    expect(result.counts.pending_free_claims).toMatchObject({ heldReceiptUnknown: 3 });
  });

  it('신고 목록을 못 읽으면 비회원 일정은 하나도 안 지움', async () => {
    const fake = makeDb(seed(), { failOn: 'plan_complaints' });
    const result = await run(fake, ENV);
    expect(result.counts.plans_guest).toEqual({ heldComplaintUnknown: 1 });
    expect(fake.col('plans').size).toBe(10);
  });

  it('협력사 예약 훑기가 실패하면 일정 메모도 안 지움', async () => {
    const fake = makeDb(seed(), { failOn: 'mood_bookings' });
    const result = await run(fake, ENV);
    expect(result.counts.mood_schedule_notes).toEqual({ heldMoodUnknown: 2 });
    expect(fake.col('mood_schedule_notes').size).toBe(3);
  });

  it('다시 돌려도 이미 비운 것은 다시 쓰지 않는다', async () => {
    const fake = makeDb(seed());
    await run(fake, ENV);
    fake.writes.length = 0;
    const second = await run(fake, ENV);
    expect(second.writes).toBe(0);
    expect(fake.writes).toEqual(['set privacy_retention_state/last']);
  });

  it(`하루 상한 ${DAILY_WRITE_CAP}건, 남은 것은 deferred`, async () => {
    const leads = Object.fromEntries(Array.from({ length: DAILY_WRITE_CAP + 5 }, (_, i) =>
      [`l${String(i).padStart(3, '0')}`, { lastSeenAtMs: kst('2026-09-01T00:00:00') + i }]));
    const fake = makeDb({ preview_leads: leads });
    const result = await run(fake, ENV);
    expect(result.writes).toBe(DAILY_WRITE_CAP);
    expect(result.counts.preview_leads).toEqual({ due: DAILY_WRITE_CAP + 5, applied: DAILY_WRITE_CAP, deferred: 5 });
    expect(fake.col('preview_leads').size).toBe(5);
  });

  it('PRIVACY_RETENTION_DELETE_ENABLED 가 정확히 "true" 가 아니면 세기만', async () => {
    for (const value of ['1', 'TRUE', 'yes', ' true']) {
      const result = await run(makeDb(seed()), { PRIVACY_RETENTION_DELETE_ENABLED: value });
      expect(result).toMatchObject({ mode: 'count', writes: 0 });
    }
  });
});

describe('날짜 경계 (한국 자정)', () => {
  const one = () => makeDb({ bookings: { b: { status: 'CONFIRMED', tourDate: '2026-10-20', tourEndDate: '2026-10-20', memo: 'm' } } });
  it('끝날 10/20 → 11/20 23:59:59 KST 에는 아직, 11/21 00:00 KST 부터', async () => {
    const early = await privacyRetentionSweepTask({ env: {}, now: () => kst('2026-11-20T23:59:59'), clock: () => 0, db: one().db } as never) as any;
    expect(early.counts.bookings).toEqual({ notYet: 1 });
    const onTime = await privacyRetentionSweepTask({ env: {}, now: () => kst('2026-11-21T00:00:00'), clock: () => 0, db: one().db } as never) as any;
    expect(onTime.counts.bookings).toEqual({ due: 1 });
  });

  // 기준 시각 10/21 00:30 KST = UTC 로는 10/20 — UTC 날짜로 세면 하루 일찍 지운다.
  const BASE = kst('2026-10-21T00:30:00');
  const RULES: [string, string, Data, string][] = [
    // 1개월: 정확히 한 달 되는 날(11/21)까지 남기고 11/22 0시(KST)부터
    ['intent_classifier_logs', 'intent_classifier_logs', { ts: new Date(BASE).toISOString(), email: 'e' }, '2026-11-22'],
    ['error_log', 'error_log', { createdAt: BASE }, '2026-11-22'],
    ['mood_booking_change_idempotency', 'mood_booking_change_idempotency', { status: 'completed', actorEmail: 'e', completedAt: BASE }, '2026-11-22'],
    ['pending_free_claims', 'pending_free_claims', { status: 'approved', reviewedAt: new Ts(BASE) }, '2026-11-22'],
    ['cart_orders_unpaid', 'cart_orders', { status: 'created', createdAt: new Ts(BASE) }, '2026-11-22'],
    ['mood_booking_change_events_emails', 'mood_booking_change_events', { clientId: 'c', actorEmail: 'e', createdAt: BASE }, '2026-11-22'],
    ['mood_notification_outbox_emails', 'mood_notification_outbox', { clientId: 'c', actorEmail: 'e', createdAt: BASE }, '2026-11-22'],
    // 2일: 10/23 까지 남기고 10/24 부터 · 1일: 10/22 까지 남기고 10/23 부터
    ['chat_rate_limits', 'chat_rate_limits', { updatedAt: BASE }, '2026-10-24'],
    ['chat_rate_limits_daily', 'chat_rate_limits', { lastUpdated: BASE }, '2026-10-24'],
    ['inquiry_auto_ack_recipients', 'inquiry_auto_ack_recipients', { reservedAtMs: BASE }, '2026-10-24'],
    ...IP_RATE_LIMIT_COLLECTIONS.map((name: string): [string, string, Data, string] => [name, name, { count: 1, lastSeenAtMs: BASE }, '2026-10-23']),
  ];
  it.each(RULES)('%s: 전날 23:59:59 KST 에는 아직, %s 00:00 KST 부터', async (target, collection, data, from) => {
    const at = async (iso: string) => ((await privacyRetentionSweepTask({ env: {}, now: () => kst(iso), clock: () => 0,
      db: makeDb({ [collection]: { x: data } }).db } as never)) as { counts: Record<string, unknown> }).counts[target];
    const dayBefore = new Date(Date.parse(`${from}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    expect(await at(`${dayBefore}T23:59:59`)).toEqual({ notYet: 1 });
    expect(await at(`${from}T00:00:00`)).toEqual({ due: 1 });
  });

  it('300건 넘게도 끝까지 넘겨 센다', async () => {
    const leads = Object.fromEntries(Array.from({ length: 305 }, (_, i) => [`l${String(i).padStart(3, '0')}`, { lastSeenAtMs: kst('2026-09-01T00:00:00') + i }]));
    const result = await run(makeDb({ preview_leads: leads }));
    expect(result.counts.preview_leads).toEqual({ due: 305 });
  });

  it('칸 타입이 다르면(숫자 vs Timestamp) 범위에 안 잡힌다 — 쿼리 값 타입 확인용', async () => {
    const fake = makeDb({ preview_leads: { bad: { lastSeenAtMs: ts('2026-09-01T00:00:00') } } });
    expect((await run(fake)).counts.preview_leads).toBeUndefined();
  });
});

describe('구글 시트 (운영에서만)', () => {
  // 시트는 날짜 칸을 숫자(1899-12-30 부터 센 날)로 돌려준다(UNFORMATTED_VALUE). 글자로 남은 날짜도 읽는다.
  const serial = (ymd: string) => (Date.parse(`${ymd}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000;
  const bookingRows = [
    ['예약일시', '고객명', '이메일', '전화번호', '상품', '투어날짜', '출발지', '도착지'],
    ['2026. 8. 30.', 'Name', 'b@example.test', '+82', 'tour', serial('2026-09-01'), 'Test Hotel', 'Airport', 2, '', 100, '', '', 'P1', '확정', '', '', 'memo'],
    ['2026. 11. 1.', 'Name', 'b@example.test', '+82', 'tour', '2026. 11. 10', 'Hotel'],
    ['2026. 8. 30.', 'Name', 'b@example.test', '', 'tour', '2026-09-01'],
  ];
  const leadRows = [
    ['시각', '이메일', '이름', '지역', '취향', '인원', '일정'],
    ['2026-09-10T03:00:00.000Z', 'lead@example.test', 'Lead Name', 'Seoul', 'food', 2, 'Plan: p1'], // 9/10 KST → 10/11 부터
    ['2026-11-15T00:00:00.000Z', 'lead@example.test', 'Lead Name', 'Busan', 'cafe', 1, 'Plan: p2'], // 아직
    ['2026-11', '', '', 'Jeju', 'nature', 3, ''], // 새 꼴 = 이미 동향만
    ['2026-09', 'old@example.test', '', 'Seoul', 'food', 2, ''], // 달만 있고 이메일 남음 → 9/30 기준
  ];
  const sheets = () => ({
    BOOKING_SHEET_TRIP_COLUMNS: { D: 3, G: 6, H: 7, R: 17 },
    LEADS_IDENTIFYING_COLUMNS: { B: 1, C: 2, G: 6 },
    readRetentionSheetRows: vi.fn(async (tab: string) => (tab === 'bookings' ? bookingRows : leadRows)),
    writeRetentionSheetCells: vi.fn(async () => undefined),
  });
  const PROD_ON = { VERCEL_ENV: 'production', PRIVACY_RETENTION_DELETE_ENABLED: 'true' };

  it('예약 장부: 기간 지난 줄의 여행 준비 칸만 비움(이름·이메일·금액·거래번호 열은 그대로)', async () => {
    const api = sheets();
    const result = await run(makeDb(), PROD_ON, { sheets: api });
    expect(api.writeRetentionSheetCells).toHaveBeenCalledWith('bookings', [
      { row: 2, column: 'D', value: '' }, { row: 2, column: 'G', value: '' }, { row: 2, column: 'H', value: '' }, { row: 2, column: 'R', value: '' }]);
    expect(result.counts.sheet_bookings).toEqual({ due: 1, applied: 1, notYet: 1, alreadyClean: 1 });
  });

  it('예약 장부: 손님이 날짜를 뒤로 옮긴 예약은 장부 날짜가 지나도 예약 문서 날짜까지 남김', async () => {
    const api = { ...sheets(), readRetentionSheetRows: vi.fn(async (tab: string) => (tab === 'bookings' ? [
      bookingRows[0],
      ['2026. 8. 30.', 'Name', 'b@example.test', '+82', 'tour', '2026-09-01', 'Hotel', '', '', '', '', '', '', 'P-moved'],
      ['2026. 8. 30.', 'Name', 'b@example.test', '+82', 'tour', '2026-09-01', 'Hotel', '', '', '', '', '', '', 'P-old'],
    ] : [])) };
    const fake = makeDb({ bookings: {
      'P-moved': { status: 'CONFIRMED', tourDate: '2026-12-20', tourEndDate: '2026-12-20' }, // 문서 번호 = 주문 번호
      'doc-x': { status: 'CONFIRMED', orderID: 'P-old', tourDate: '2026-09-01', tourEndDate: '2026-09-01' }, // orderID 칸으로 찾음
    } });
    const result = await run(fake, PROD_ON, { sheets: api });
    expect(api.writeRetentionSheetCells).toHaveBeenCalledWith('bookings', [{ row: 3, column: 'D', value: '' }, { row: 3, column: 'G', value: '' }]);
    expect(result.counts.sheet_bookings).toEqual({ heldBookingNotDue: 1, due: 1, applied: 1 });
  });

  it('예약 장부: 환불이 끝나지 않은 예약의 줄은 날짜가 지나도 남김', async () => {
    const api = { ...sheets(), readRetentionSheetRows: vi.fn(async (tab: string) => (tab === 'bookings' ? [
      bookingRows[0],
      ['2026. 8. 30.', 'Name', 'b@example.test', '+82', 'tour', '2026-09-01', 'Hotel', '', '', '', '', '', '', 'P-refund'],
    ] : [])) };
    const fake = makeDb({ bookings: {
      'P-refund': { status: 'REFUND_UNKNOWN', tourDate: '2026-09-01', tourEndDate: '2026-09-01' },
    } });
    const result = await run(fake, PROD_ON, { sheets: api });
    expect(api.writeRetentionSheetCells).not.toHaveBeenCalled();
    expect(result.counts.sheet_bookings).toEqual({ heldStatus: 1 });
  });

  it('Leads: 줄은 남기고 이메일·이름·일정 번호를 비우고 시각을 달로', async () => {
    const api = sheets();
    const result = await run(makeDb(), PROD_ON, { sheets: api });
    expect(api.writeRetentionSheetCells).toHaveBeenCalledWith('leads', [
      { row: 2, column: 'A', value: '2026-09' }, { row: 2, column: 'B', value: '' }, { row: 2, column: 'C', value: '' }, { row: 2, column: 'G', value: '' },
      { row: 5, column: 'B', value: '' }]);
    expect(result.counts.sheet_leads).toEqual({ due: 2, applied: 2, notYet: 1, alreadyClean: 1 });
  });

  it('읽은 뒤 누가 줄을 옮기면(정렬·삭제) 그 줄은 오늘 건너뜀', async () => {
    const moved = [bookingRows[0], bookingRows[3], bookingRows[1], bookingRows[2]]; // 2번 줄 자리에 다른 예약
    const reads = [bookingRows, moved];
    const api = { ...sheets(), readRetentionSheetRows: vi.fn(async (tab: string) => (tab === 'bookings' ? reads.shift() : [])) };
    const result = await run(makeDb(), PROD_ON, { sheets: api });
    expect(api.writeRetentionSheetCells).not.toHaveBeenCalled();
    expect(result.counts.sheet_bookings).toMatchObject({ due: 1, heldRowChanged: 1 });
    expect(result.counts.sheet_bookings).not.toHaveProperty('applied');
  });

  it('운영 + 꺼짐: 읽기만', async () => {
    const api = sheets();
    const result = await run(makeDb(), { VERCEL_ENV: 'production' }, { sheets: api });
    expect(api.writeRetentionSheetCells).not.toHaveBeenCalled();
    expect(result.counts.sheet_bookings).toEqual({ due: 1, notYet: 1, alreadyClean: 1 });
    expect(result.counts.sheet_leads).toEqual({ due: 2, notYet: 1, alreadyClean: 1 });
    expect(JSON.stringify(result)).not.toContain('example.test');
  });

  it('미리보기: 읽지도 않음 / 시트 설정 없음: skipped 로 넘어감', async () => {
    const api = sheets();
    await run(makeDb(), { VERCEL_ENV: 'preview', PRIVACY_RETENTION_DELETE_ENABLED: 'true' }, { sheets: api });
    expect(api.readRetentionSheetRows).not.toHaveBeenCalled();
    const skipped = { ...sheets(), readRetentionSheetRows: vi.fn(async () => { throw Object.assign(new Error('missing'), { skipped: true }); }) };
    const result = await run(makeDb(), { VERCEL_ENV: 'production' }, { sheets: skipped });
    expect(result).toMatchObject({ ok: true, counts: { sheet_bookings: { skipped: 1 }, sheet_leads: { skipped: 1 } } });
  });
});

describe('실패·시간·인증', () => {
  it('한 곳이 실패해도 나머지는 돌고, 로그에 오류 글(손님 값)을 남기지 않는다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fake = makeDb(seed(), { failOn: 'cart_orders' });
    const result = await run(fake, { PRIVACY_RETENTION_DELETE_ENABLED: 'true' });
    expect(result).toMatchObject({ ok: false, code: 'RETENTION_REVIEW_REQUIRED', counts: { cart_orders: { error: 1 } } });
    expect(fake.col('preview_leads').has('l1')).toBe(false); // 뒤 대상은 계속 돎
    expect(JSON.stringify(warn.mock.calls)).not.toContain('example.test');
    warn.mockRestore();
  });

  it('문서 하나가 오류를 내도 그 대상의 나머지는 계속 보고, 오류 글은 남기지 않는다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const data = seed();
    data.bookings['b-bad'] = { tourDate: '2026-09-02', get status(): string { throw new Error('bad doc secret@example.test'); } } as never;
    const fake = makeDb(data);
    const result = await run(fake, { PRIVACY_RETENTION_DELETE_ENABLED: 'true' });
    expect(result).toMatchObject({ ok: false, code: 'RETENTION_REVIEW_REQUIRED' });
    expect(result.counts.bookings).toMatchObject({ docError: 1, applied: 2 }); // b-old·b-snap 은 그대로 비움
    expect(fake.col('bookings').get('b-old')).not.toHaveProperty('memo');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('example.test');
    warn.mockRestore();
  });

  it('앞 대상이 시간을 다 써도 뒤 대상은 자기 몫으로 센다', async () => {
    let t = 0;
    const fake = makeDb(seed());
    // 결제 스냅샷 읽기 한 번 = 10초(느린 읽기). 예약 훑기가 첫 읽기 뒤 자기 몫을 넘김.
    const db = { collection: (name: string) => {
      const c = fake.db.collection(name);
      if (name !== 'paypal_order_snapshots') return c;
      return { ...c, doc: (id: string) => { const r = c.doc(id); return { ...r, get: async () => { t += 10_000; return r.get(); } }; } };
    } };
    const result = await privacyRetentionSweepTask({ env: {}, now: () => NOW, clock: () => t, db } as never) as any;
    expect(result).toMatchObject({ ok: true, code: 'RETENTION_PARTIAL', timedOut: true });
    expect(result.counts.bookings).toHaveProperty('timedOut', 1);
    expect(result.counts.plans_guest).toEqual({ due: 2, heldComplaint: 1, heldPaid: 3, notYet: 3, member: 1 });
    expect(result.counts.pending_bookings_unverified).toEqual({ due: 2, notYet: 1, noDate: 1, heldPaymentSeen: 1 });
  });

  it('시간 예산을 넘기면 멈추고 PARTIAL', async () => {
    const clock = vi.fn().mockReturnValueOnce(0).mockReturnValue(100_000);
    const fake = makeDb(seed());
    const result = await privacyRetentionSweepTask({ env: { PRIVACY_RETENTION_DELETE_ENABLED: 'true' }, now: () => NOW, clock, db: fake.db } as never) as any;
    expect(result).toMatchObject({ ok: true, code: 'RETENTION_PARTIAL', timedOut: true, writes: 0 });
  });

  it('시계가 이상하면 아무것도 안 함', async () => {
    const fake = makeDb(seed());
    expect(await privacyRetentionSweepTask({ env: {}, now: () => NaN, db: fake.db } as never)).toEqual({ ok: false, code: 'RETENTION_CLOCK_INVALID' });
    expect(fake.writes).toEqual([]);
  });

  it('인증 없으면 401, DB 안 건드림', async () => {
    const res: any = { headers: {}, setHeader(k: string, v: string) { this.headers[k] = v; }, status(code: number) { this.code = code; return this; }, json(body: unknown) { this.body = body; return this; } };
    await handler({ headers: {} } as never, res);
    expect(res.code).toBe(401);
    expect(res.body).toEqual({ ok: false, code: 'AUTH_REQUIRED' });
    expect(res.headers['Cache-Control']).toBe('no-store');
  });
});

describe('속도 제한 표 목록 = api/ 의 실제 호출과 같음', () => {
  // 처리방침에 "속도 제한 기록 1~2일"이라 적으므로, 빠진 표가 하나라도 있으면 약속이 틀어진다.
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? files(join(dir, entry.name)) : entry.name.endsWith('.js') ? [join(dir, entry.name)] : []);
  const used = new Set<string>();
  for (const file of files(join(__dirname, '../../api'))) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/collection:\s*'([a-z0-9_]*rate_limits)'/g)) used.add(m[1]);
    for (const m of text.matchAll(/collection\('([a-z0-9_]*rate_limits)'\)/g)) used.add(m[1]);
  }
  it('쓰는 표는 모두 목록에 있고(대화 표는 따로), 목록에 쓰지 않는 표는 없다', () => {
    used.delete('chat_rate_limits'); // 문서 꼴이 달라 lowPriorityTargets 에서 따로(updatedAt·lastUpdated) 지운다
    // 무료 신청을 닫아(11/22) 더 안 쓰지만 남은 문서를 지우려고 목록에 둔 것
    const retired = ['claim_notify_rate_limits'];
    for (const name of retired) expect(used.has(name)).toBe(false);
    expect([...used].sort()).toEqual(IP_RATE_LIMIT_COLLECTIONS.filter((name: string) => !retired.includes(name)).sort());
  });
});
