/* eslint-disable @typescript-eslint/no-explicit-any -- 핸들러/Firestore 모킹 스캐폴딩. */
/**
 * POST /api/modifyBooking — 날짜 변경(②b, 2026-10-23) + 메모·공항 트랜잭션 재검증.
 * 잠그는 것:
 *   접근(회원·게스트·동일 401) · 사전 가드별 쓰기 0 · 트랜잭션 안 BOOKING_CHANGED(취소 경쟁·버전·재시도 시 24h) ·
 *   ignored · 메모/공항도 트랜잭션 재검증 · 차터 slotBooking:null 단독 변경 · 투어 none/partial → SLOT_BINDING_MISSING ·
 *   게스트 토큰 생성 실패 → 503 변경 0 · 성공 기록(modifications·버전 절대값·pending·lastChangeRequest·새 토큰) ·
 *   메일 성공 시 버전 조건부 pending 삭제 / 실패 시 유지+알림 · 복구 경로(i)(ii) · 잘못된 Bearer 는 복구 시도 0 ·
 *   tourTime '' / 누락 통과. 실제 PayPal·메일·텔레그램 없음.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFakeFirestore, FieldValue as FakeFieldValue, makeBarrier } from '../helpers/fake-firestore.js';
import { kstDatePlusDays } from '../../api/_shared/calendar-date.js';

let db: ReturnType<typeof createFakeFirestore>;
const verifyUserTokenSpy = vi.fn<(req: any) => Promise<any>>(async () => ({ ok: false, status: 401, error: 'x' }));
const mailSpy = vi.fn<(args: any) => Promise<any>>(async () => ({ sent: true, voucherAttached: true }));
const alertSpy = vi.fn<(args: any) => Promise<any>>(async () => ({ ok: true }));
const tokenHook: { fail: boolean } = { fail: false };

vi.mock('../../api/_shared/user-auth.js', () => ({ verifyUserToken: (req: any) => verifyUserTokenSpy(req) }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => db }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: FakeFieldValue }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: vi.fn(async () => undefined) }));
vi.mock('../../api/_shared/notify.js', () => ({ sendDiscord: vi.fn(async () => undefined) }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: (args: any) => alertSpy(args) }));
vi.mock('../../api/_shared/pricing.js', () => ({ productDisplayLabel: (x: string) => `Label:${x}` }));
vi.mock('../../api/_shared/booking-change-emails.js', () => ({ sendBookingChangeEmail: (args: any) => mailSpy(args) }));
vi.mock('../../api/_shared/booking-manage-token.js', async () => {
  const actual: any = await vi.importActual('../../api/_shared/booking-manage-token.js');
  return {
    ...actual,
    createBookingManageToken: (args: any) => {
      if (tokenHook.fail) throw new Error('booking manage signing secret unavailable');
      return actual.createBookingManageToken(args);
    },
  };
});

const { default: handler } = await import('../../api/modifyBooking.js');
const { createBookingManageToken, verifyBookingManageToken } = await import('../../api/_shared/booking-manage-token.js');

const ID = 'ORD-G';
const PATH = `bookings/${ID}`;
const SNAP = `paypal_order_snapshots/${ID}`;
const TOUR = 'tour_a';
const SLOT = 's09';
const FROM = kstDatePlusDays(Date.now(), 30);
const TO = kstDatePlusDays(Date.now(), 40);
const AV = (d: string) => `tour_availability/${TOUR}/dates/${d}`;
const RID = 'b7e3f8a2-1c4d-4e5f-9a6b-1234567890ab';
const RID2 = 'c8f4a9b3-2d5e-4f60-8b7c-234567890abc';

const guest = (over: Record<string, any> = {}) => ({
  bookingRef: ID, orderID: ID, captureID: 'CAP-1', userEmail: '', uid: null, payerEmail: 'guest@example.com',
  payerName: 'Guest', status: 'CONFIRMED', productType: 'tour_gyeongbok', tourDate: FROM, tourTime: '',
  pickupLocation: 'Lobby', paxCount: 2, paypalEnvironment: 'live', language: 'en', memo: '', ...over,
});
const member = (over: Record<string, any> = {}) => guest({ userEmail: 'm@example.com', uid: 'u1', ...over });
const tourDocs = (bookingDoc: Record<string, any>) => ({
  [PATH]: bookingDoc,
  [SNAP]: { slotBooking: { tourId: TOUR, tourSlotId: SLOT, bookingDate: FROM, slotCapacity: 8, passengers: 2 } },
  [`tours/${TOUR}`]: { maxPax: 8, slots: [{ id: SLOT, capacity: 8 }] },
  [AV(FROM)]: { tourId: TOUR, date: FROM, status: 'available', slot_bookings: { [SLOT]: 2 }, slot_confirmed: { [SLOT]: { [ID]: { count: 2, at: 'T0', releasedAt: null } } } },
});

const tokenV = (version = 0, tourDate = FROM) => createBookingManageToken({
  orderID: ID, version, paypalEnvironment: 'live', deployment: 'production', tourDate,
}).token;

async function call(body: Record<string, any>, headers: Record<string, string> = {}) {
  const out = { statusCode: 0, headers: {} as Record<string, string>, body: '' };
  const res = { writeHead(c: number, h: Record<string, string>) { out.statusCode = c; out.headers = h || {}; }, end(b?: string) { out.body = b || ''; } };
  await handler({ method: 'POST', url: '/api/modifyBooking', headers: { host: 'unit.test', ...headers }, body } as any, res as any);
  return { ...out, json: out.body ? JSON.parse(out.body) : null };
}
// manageToken 을 넘기지 않을 때만 새로 만든다(토큰 생성 실패 테스트가 미리 만든 토큰을 쓸 수 있게).
const guestChange = (over: Record<string, any> = {}) => ({
  bookingID: ID, changes: { tourDate: TO }, requestId: RID, ...over,
  manageToken: over.manageToken === undefined ? tokenV() : over.manageToken,
});
const memberChange = (over: Record<string, any> = {}) => ({ bookingID: ID, changes: { tourDate: TO }, requestId: RID, ...over });
const BEARER = { authorization: 'Bearer t' };

const ENV_KEYS = ['VERCEL_ENV', 'PAYPAL_ENV', 'BOOKING_MANAGE_SIGNING_SECRET', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'];
const savedEnv: Record<string, string | undefined> = {};
let spies: { mockRestore: () => void }[] = [];
beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.VERCEL_ENV = 'production';
  delete process.env.PAYPAL_ENV;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  process.env.BOOKING_MANAGE_SIGNING_SECRET = 'd'.repeat(48);
  tokenHook.fail = false;
  verifyUserTokenSpy.mockReset();
  verifyUserTokenSpy.mockResolvedValue({ ok: true, email: 'm@example.com', uid: 'u1' });
  mailSpy.mockReset(); mailSpy.mockResolvedValue({ sent: true, voucherAttached: true });
  alertSpy.mockClear();
  db = createFakeFirestore(tourDocs(guest()));
  spies = [vi.spyOn(console, 'warn').mockImplementation(() => {}), vi.spyOn(console, 'error').mockImplementation(() => {})];
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  spies.forEach((s) => s.mockRestore());
  vi.useRealTimers();
});

describe('access', () => {
  it('no credentials → 401 AUTH_REQUIRED, nothing written', async () => {
    const before = JSON.stringify(db.__dump());
    const r = await call({ bookingID: ID, changes: { tourDate: TO }, requestId: RID });
    expect(r.statusCode).toBe(401);
    expect(r.json).toMatchObject({ ok: false, code: 'AUTH_REQUIRED' });
    expect(JSON.stringify(db.__dump())).toBe(before);
  });

  it('🔴 invalid Bearer + valid old token + same requestId → identical 401, zero booking reads, zero writes (no recovery attempt)', async () => {
    verifyUserTokenSpy.mockResolvedValue({ ok: false, status: 401, error: 'bad' });
    const before = JSON.stringify(db.__dump());
    const reads = db.__stats.reads;
    const r = await call(guestChange(), { authorization: 'Bearer bad' });
    expect(r.statusCode).toBe(401);
    expect(r.json).toMatchObject({ ok: false, code: 'AUTH_REQUIRED', error: 'Authentication required' });
    expect(db.__stats.reads).toBe(reads);
    expect(JSON.stringify(db.__dump())).toBe(before);
  });

  it("another member's booking → 403, nothing written", async () => {
    db = createFakeFirestore(tourDocs(member({ userEmail: 'owner@example.com' })));
    const before = JSON.stringify(db.__dump());
    const r = await call(memberChange(), BEARER);
    expect(r.statusCode).toBe(403);
    expect(JSON.stringify(db.__dump())).toBe(before);
  });
});

describe('pre-guards (read stage) — zero writes', () => {
  const cases: Array<[string, () => void, () => Record<string, any>, number, string]> = [
    ['not CONFIRMED', () => db.__patch(PATH, { status: 'CANCELING' }), () => guestChange(), 409, 'INVALID_STATE'],
    ['cart child', () => db.__patch(PATH, { parentOrderID: 'P1' }), () => memberChange(), 409, 'CART_CHILD_UNSUPPORTED'],
    ['ai planner', () => db.__patch(PATH, { productType: 'ai-planner-full' }), () => memberChange(), 403, 'NO_MODIFY_DIGITAL'],
    ['current date inside 24h', () => db.__patch(PATH, { tourDate: kstDatePlusDays(Date.now(), 0) }), () => memberChange(), 409, 'MODIFY_WINDOW_CLOSED'],
    ['memo inside 24h', () => db.__patch(PATH, { tourDate: kstDatePlusDays(Date.now(), 0) }), () => ({ bookingID: ID, changes: { memo: 'hi' } }), 409, 'MODIFY_WINDOW_CLOSED'],
    ['missing requestId', () => {}, () => memberChange({ requestId: undefined }), 400, 'MISSING_REQUEST_ID'],
    ['non-UUID requestId', () => {}, () => memberChange({ requestId: 'abc' }), 400, 'MISSING_REQUEST_ID'],
    ['invalid date', () => {}, () => memberChange({ changes: { tourDate: '2099-02-30' } }), 400, 'INVALID_DATE'],
    ['same date', () => {}, () => memberChange({ changes: { tourDate: FROM } }), 400, 'SAME_DATE'],
    ['new date too soon', () => {}, () => memberChange({ changes: { tourDate: kstDatePlusDays(Date.now(), 0) } }), 409, 'NEW_DATE_TOO_SOON'],
    ['new date in the past', () => {}, () => memberChange({ changes: { tourDate: '2020-01-01' } }), 409, 'NEW_DATE_TOO_SOON'],
    ['new date too far', () => {}, () => memberChange({ changes: { tourDate: kstDatePlusDays(Date.now(), 366) } }), 400, 'NEW_DATE_TOO_FAR'],
    ['nothing allowed', () => {}, () => ({ bookingID: ID, changes: { paxCount: 7 } }), 400, 'NO_CHANGES'],
  ];
  for (const [label, setup, body, status, code] of cases) {
    it(`${label} → ${status} ${code}`, async () => {
      db = createFakeFirestore(tourDocs(member()));
      setup();
      const before = JSON.stringify(db.__dump());
      const r = await call(body(), BEARER);
      expect(r.statusCode).toBe(status);
      expect(r.json.code).toBe(code);
      expect(JSON.stringify(db.__dump())).toBe(before);
      expect(mailSpy).not.toHaveBeenCalled();
    });
  }

  // Astra r1 P1 — 값이 비었거나 문자열이 아닌 tourDate 가 메모 분기로 새어 tourDate:'' 를 저장하던 회귀.
  // Astra r2 — null 도 같다(필터가 null 을 버리기 전 원본 changes 의 키 존재로 판정).
  it('tourDate:null alone → 400 INVALID_DATE (not NO_CHANGES), booking untouched, no transaction', async () => {
    db = createFakeFirestore(tourDocs(member()));
    const before = JSON.stringify(db.__dump());
    const r = await call({ bookingID: ID, changes: { tourDate: null } }, BEARER);
    expect(r.statusCode).toBe(400);
    expect(r.json.code).toBe('INVALID_DATE');
    expect(JSON.stringify(db.__dump())).toBe(before);
    expect(db.__stats.transactions).toBe(0);
  });

  it('INVALID_DATE wins over pre-guards but not over auth (unauthenticated → 401 first)', async () => {
    db = createFakeFirestore(tourDocs(member({ status: 'CANCELING' })));
    expect((await call({ bookingID: ID, changes: { tourDate: null, memo: 'x' } }, BEARER)).json.code).toBe('INVALID_DATE');
    expect((await call({ bookingID: ID, changes: { tourDate: null, memo: 'x' } })).statusCode).toBe(401);
  });

  for (const bad of ['', [], 123, '2026-02-30', {}, '2099-1-5', null] as unknown[]) {
    it(`tourDate ${JSON.stringify(bad)} → 400 INVALID_DATE, booking untouched, memo branch not entered`, async () => {
      db = createFakeFirestore(tourDocs(member()));
      const before = JSON.stringify(db.__dump());
      const r = await call({ bookingID: ID, changes: { tourDate: bad, memo: 'also' }, requestId: RID }, BEARER);
      expect(r.statusCode).toBe(400);
      expect(r.json.code).toBe('INVALID_DATE');
      expect(JSON.stringify(db.__dump())).toBe(before);
      expect(db.__stats.transactions).toBe(0);
      expect(mailSpy).not.toHaveBeenCalled();
    });
  }

  it('guest pre-guard (status) also writes nothing', async () => {
    db.__patch(PATH, { status: 'REFUND_UNKNOWN' });
    const before = JSON.stringify(db.__dump());
    const r = await call(guestChange());
    expect(r.json.code).toBe('INVALID_STATE');
    expect(JSON.stringify(db.__dump())).toBe(before);
  });
});

// PR-3 (2026-10-23): 수동 생성 cart 예약 — 부모 필드(parentOrderID)가 없어 CART_CHILD 가드를 지나쳤다.
//   cart_orders/{id} 가 있으면 메모·날짜 모두 쓰기·메일·좌석 이동 0.
describe('cart orders (cart_orders/{bookingID}) — never modified here', () => {
  const CART = `cart_orders/${ID}`;
  const cartDoc = { status: 'captured', lines: [{ lineId: 'L1', productType: 'tour_gyeongbok' }] };

  it.each([
    ['member memo', () => member(), () => ({ bookingID: ID, changes: { memo: 'late' } }), BEARER],
    ['member date', () => member(), () => memberChange(), BEARER],
    ['guest memo', () => guest(), () => ({ bookingID: ID, changes: { memo: 'late' }, manageToken: tokenV() }), {}],
    ['guest date', () => guest(), () => guestChange(), {}],
  ] as Array<[string, () => Record<string, any>, () => Record<string, any>, Record<string, string>]>)(
    '%s → 409 CART_ORDER_UNSUPPORTED, no write/mail/seat move/transaction',
    async (_label, bookingDoc, body, headers) => {
      db = createFakeFirestore({ ...tourDocs(bookingDoc()), [CART]: cartDoc });
      const before = JSON.stringify(db.__dump());
      const r = await call(body(), headers);
      expect(r.statusCode).toBe(409);
      expect(r.json).toMatchObject({ ok: false, code: 'CART_ORDER_UNSUPPORTED' });
      expect(JSON.stringify(db.__dump())).toBe(before);
      expect(db.__stats.transactions).toBe(0);
      expect(mailSpy).not.toHaveBeenCalled();
    },
  );

  it('cart lookup throws → 500, nothing written (never silently passes)', async () => {
    db = createFakeFirestore(tourDocs(member()));
    const realCollection = db.collection;
    db.collection = ((name: string) => (name === 'cart_orders'
      ? { doc: () => ({ get: async () => { throw new Error('14 UNAVAILABLE: cart lookup'); } }) }
      : realCollection(name))) as typeof db.collection;
    const before = JSON.stringify(db.__dump());
    const r = await call(memberChange(), BEARER);
    expect(r.statusCode).toBe(500);
    expect(r.json.ok).toBe(false);
    expect(JSON.stringify(db.__dump())).toBe(before);
    expect(db.__stats.transactions).toBe(0);
    expect(mailSpy).not.toHaveBeenCalled();
  });

  // 쓰기 트랜잭션 3종 — 메모·공항 / 차터 날짜 / 투어 좌석 이전. 각각 verifyBooking 이 같은 tx 로 cart 를 다시 읽는다.
  const charterDocs = () => ({ [PATH]: member({ productType: 'charter_hourly' }), [SNAP]: { slotBooking: null, amountUSD: '200.00' } });
  const WRITE_PATHS: Array<[string, () => Record<string, any>, () => Record<string, any>]> = [
    ['memo', () => tourDocs(member()), () => ({ bookingID: ID, changes: { memo: 'late' } })],
    ['charter date', charterDocs, () => memberChange()],
    ['tour date (seat transfer)', () => tourDocs(member()), () => memberChange()],
  ];

  it.each(WRITE_PATHS)(
    'cart doc appears between pre-check and commit (%s) → re-read in the write transaction → 409, nothing written',
    async (_label, docs, body) => {
      db = createFakeFirestore(docs());
      const before = db.__dump();
      let inserted = false;
      db.__beforeCommit = async () => { if (!inserted) { inserted = true; db.__set(CART, cartDoc); } };
      const r = await call(body(), BEARER);
      expect(r.statusCode).toBe(409);
      expect(r.json.code).toBe('CART_ORDER_UNSUPPORTED');
      expect(db.__stats.retries).toBeGreaterThan(0); // 첫 시도의 cart 읽기가 충돌로 잡혀 재시도에서 거부됐다
      const after = db.__dump();
      delete after[CART];
      expect(after).toEqual(before);
      expect(mailSpy).not.toHaveBeenCalled();
    },
  );

  it.each(WRITE_PATHS)(
    'cart re-read inside the write transaction throws (%s) → 500, nothing written',
    async (_label, docs, body) => {
      db = createFakeFirestore(docs());
      const realTx = db.runTransaction;
      db.runTransaction = ((fn: any, opts: any) => realTx((tx: any) => fn({
        ...tx,
        get: (ref: any) => (String(ref.path).startsWith('cart_orders/') ? Promise.reject(new Error('14 UNAVAILABLE: cart')) : tx.get(ref)),
      }), opts)) as typeof db.runTransaction;
      const before = JSON.stringify(db.__dump());
      const r = await call(body(), BEARER);
      expect(r.statusCode).toBe(500);
      expect(JSON.stringify(db.__dump())).toBe(before);
      expect(mailSpy).not.toHaveBeenCalled();
    },
  );

  it('recovery entry (i) — old token after a committed change, cart doc now exists → 409, no new token, nothing written', async () => {
    const oldToken = tokenV(0);
    expect((await call(guestChange({ manageToken: oldToken }))).statusCode).toBe(200);
    mailSpy.mockClear();
    db.__set(CART, cartDoc);
    const before = JSON.stringify(db.__dump());
    const r = await call(guestChange({ manageToken: oldToken })); // 정상이면 recovered 200 + 새 토큰
    expect(r.statusCode).toBe(409);
    expect(r.json).toMatchObject({ ok: false, code: 'CART_ORDER_UNSUPPORTED' });
    expect(r.body).not.toContain('manageToken');
    expect(JSON.stringify(db.__dump())).toBe(before);
    expect(mailSpy).not.toHaveBeenCalled();
  });

  it('recovery entry (i) — cart lookup throws → 500, no token', async () => {
    const oldToken = tokenV(0);
    expect((await call(guestChange({ manageToken: oldToken }))).statusCode).toBe(200);
    const realCollection = db.collection;
    db.collection = ((name: string) => (name === 'cart_orders'
      ? { doc: () => ({ get: async () => { throw new Error('14 UNAVAILABLE: cart lookup'); } }) }
      : realCollection(name))) as typeof db.collection;
    const r = await call(guestChange({ manageToken: oldToken }));
    expect(r.statusCode).toBe(500);
    expect(r.body).not.toContain('manageToken');
  });

  // (ii) = 인증은 통과했는데 트랜잭션 재검증이 BOOKING_CHANGED → 같은 요청이 먼저 커밋됐는지 복구 시도.
  //   "그 사이 같은 요청이 커밋됨" 을 커밋 직전에 끼워 넣는다. cart 가 없으면 recovered 200(대조군), 있으면 409.
  const committedMeanwhile = (withCart: boolean) => {
    let done = false;
    db.__beforeCommit = async () => {
      if (done) return;
      done = true;
      db.__patch(PATH, {
        tourDate: TO, manageTokenVersion: 1,
        lastChangeRequest: { id: RID, fromVersion: 0, toVersion: 1, tourDate: TO, at: 'T1' },
      });
      if (withCart) db.__set(CART, cartDoc);
    };
  };

  it('recovery entry (ii) control — no cart → recovered 200 with a new token', async () => {
    committedMeanwhile(false);
    const r = await call(guestChange({ manageToken: tokenV(0) }));
    expect(r.statusCode).toBe(200);
    expect(r.json.data.recovered).toBe(true);
  });

  it('recovery entry (ii) — cart doc exists → 409 CART_ORDER_UNSUPPORTED, no new token, seats not moved, no mail', async () => {
    committedMeanwhile(true);
    const r = await call(guestChange({ manageToken: tokenV(0) }));
    expect(r.statusCode).toBe(409);
    expect(r.json.code).toBe('CART_ORDER_UNSUPPORTED');
    expect(r.body).not.toContain('manageToken');
    expect(db.__get(AV(FROM))!.slot_bookings[SLOT]).toBe(2);
    expect(db.__get(AV(TO))).toBeUndefined();
    expect(mailSpy).not.toHaveBeenCalled();
  });

  it('ordinary manual booking (no cart_orders doc) still changes normally', async () => {
    db = createFakeFirestore(tourDocs(member()));
    expect((await call({ bookingID: ID, changes: { memo: 'ok' } }, BEARER)).statusCode).toBe(200);
    const r = await call(memberChange(), BEARER);
    expect(r.statusCode).toBe(200);
    expect(db.__get(PATH)).toMatchObject({ memo: 'ok', tourDate: TO });
  });
});

describe('memo / airport — transactional re-verification', () => {
  it('memo change applies inside a transaction, keeps CONFIRMED, records modifications, no version bump', async () => {
    db = createFakeFirestore(tourDocs(member()));
    const r = await call({ bookingID: ID, changes: { memo: 'late', paxCount: 9 } }, BEARER);
    expect(r.statusCode).toBe(200);
    expect(r.json.data).toMatchObject({ applied: { memo: 'late' }, ignored: ['paxCount'], status: 'CONFIRMED' });
    const doc = db.__get(PATH)!;
    expect(doc).toMatchObject({ memo: 'late', status: 'CONFIRMED', paxCount: 2 });
    expect(doc.modifications).toHaveLength(1);
    expect(doc.modifications[0]).toMatchObject({ changes: { memo: { from: '', to: 'late' } }, requestedBy: 'm@example.com' });
    expect(doc).not.toHaveProperty('manageTokenVersion');
    expect(db.__stats.transactions).toBeGreaterThan(0);
  });

  it('guest memo change keeps the manage link valid (no version bump)', async () => {
    const r = await call({ bookingID: ID, changes: { memo: 'x' }, manageToken: tokenV() });
    expect(r.statusCode).toBe(200);
    expect(db.__get(PATH)!.manageTokenVersion).toBeUndefined();
    expect(r.json.data.manageToken).toBeUndefined();
  });

  it('booking canceled between read and commit → 409 BOOKING_CHANGED, memo not written', async () => {
    db = createFakeFirestore(tourDocs(member()));
    let patched = false;
    db.__beforeCommit = async () => { if (!patched) { patched = true; db.__patch(PATH, { status: 'CANCELING' }); } };
    const r = await call({ bookingID: ID, changes: { memo: 'late' } }, BEARER);
    expect(r.statusCode).toBe(409);
    expect(r.json.code).toBe('BOOKING_CHANGED');
    expect(db.__get(PATH)!.memo).toBe('');
    expect(db.__get(PATH)!.modifications).toBeUndefined();
  });
});

describe('date change — tour seat transfer', () => {
  it('guest success: seats moved, absolute version, pending cleared after mail, lastChangeRequest, new token in no-store response', async () => {
    const r = await call(guestChange({ changes: { tourDate: TO, paxCount: 5 } }));
    expect(r.statusCode).toBe(200);
    expect(r.headers['Cache-Control']).toBe('no-store');
    expect(r.json.data).toMatchObject({ bookingID: ID, status: 'CONFIRMED', tourDate: TO, slotTransferred: true, emailSent: true, ignored: ['paxCount'] });
    const doc = db.__get(PATH)!;
    expect(doc).toMatchObject({ tourDate: TO, paxCount: 2, manageTokenVersion: 1 });
    expect(doc.lastChangeRequest).toMatchObject({ id: RID, fromVersion: 0, toVersion: 1, tourDate: TO });
    expect(doc.modifications[0]).toMatchObject({ changes: { tourDate: { from: FROM, to: TO } }, requestedBy: 'guest@example.com', requestId: RID });
    expect(doc).not.toHaveProperty('manageLinkPending');
    expect(doc.manageLinkSentAt).toBeDefined();
    expect(verifyBookingManageToken(r.json.data.manageToken, { orderID: ID, version: 1, paypalEnvironment: 'live', deployment: 'production' })).toMatchObject({ ok: true });
    // 좌석 원장 이전
    expect(db.__get(AV(FROM))!.slot_bookings[SLOT]).toBe(0);
    expect(db.__get(AV(TO))!.slot_bookings[SLOT]).toBe(2);
    expect(db.__get(SNAP)!.slotBooking.bookingDate).toBe(TO);
    // 메일: 새 링크(#t=새 토큰) + 새 날짜
    const mail = mailSpy.mock.calls[0][0];
    expect(mail.manageUrl).toBe(`https://cocotripkr.com/booking/manage#t=${r.json.data.manageToken}`);
    expect(mail).toMatchObject({ newDate: TO, oldDate: FROM, myPageUrl: null, label: 'Label:tour_gyeongbok' });
    expect(mail.booking.tourDate).toBe(TO);
    // 옛 토큰은 이제 일반 접근이 안 된다(복구는 requestId 가 맞을 때만)
    const old = await call({ bookingID: ID, changes: { memo: 'x' }, manageToken: tokenV(0) });
    expect(old.statusCode).toBe(401);
  });

  it('member success: no version / pending, My Page link in mail, no token in response', async () => {
    db = createFakeFirestore(tourDocs(member()));
    const r = await call(memberChange(), BEARER);
    expect(r.statusCode).toBe(200);
    expect(r.json.data.manageToken).toBeUndefined();
    const doc = db.__get(PATH)!;
    expect(doc.tourDate).toBe(TO);
    expect(doc).not.toHaveProperty('manageTokenVersion');
    expect(doc).not.toHaveProperty('manageLinkPending');
    expect(mailSpy.mock.calls[0][0]).toMatchObject({ manageUrl: null, myPageUrl: 'https://cocotripkr.com/mypage' });
  });

  it('mail language: body.language (ko/en/ja/zh) → booking.language → en', async () => {
    db = createFakeFirestore(tourDocs(member({ language: 'ja' })));
    await call(memberChange({ language: 'zh' }), BEARER);
    expect(mailSpy.mock.calls[0][0].language).toBe('zh');

    db = createFakeFirestore(tourDocs(member({ language: 'ja' })));
    mailSpy.mockClear();
    await call(memberChange({ language: 'xx' }), BEARER);
    expect(mailSpy.mock.calls[0][0].language).toBe('ja');

    const noLang: Record<string, any> = member();
    delete noLang.language;
    db = createFakeFirestore(tourDocs(noLang));
    mailSpy.mockClear();
    await call(memberChange({ language: 42 }), BEARER);
    expect(mailSpy.mock.calls[0][0].language).toBe('en');
  });

  it('mail failure → pending kept (this version) + admin alert keyed by booking & version; response says emailSent:false', async () => {
    mailSpy.mockResolvedValue({ sent: false, voucherAttached: false, error: 'smtp down' });
    const r = await call(guestChange());
    expect(r.statusCode).toBe(200);
    expect(r.json.data.emailSent).toBe(false);
    expect(db.__get(PATH)!.manageLinkPending).toMatchObject({ version: 1 });
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0][0]).toMatchObject({ key: `manage-link-mail-failed-${ID}-1`, channel: 'admin', severity: 'high' });
  });

  it('pending clear is version-conditional — a newer change’s pending is not removed', async () => {
    mailSpy.mockImplementation(async () => {
      db.__patch(PATH, { manageTokenVersion: 2, manageLinkPending: { version: 2, createdAt: 'later' } });
      return { sent: true, voucherAttached: true };
    });
    const r = await call(guestChange());
    expect(r.statusCode).toBe(200);
    expect(db.__get(PATH)!.manageLinkPending).toEqual({ version: 2, createdAt: 'later' });
  });

  it('guest token cannot be minted → 503 MANAGE_LINK_UNAVAILABLE, nothing changed', async () => {
    const t = tokenV();
    tokenHook.fail = true;
    const before = JSON.stringify(db.__dump());
    const r = await call(guestChange({ manageToken: t }));
    expect(r.statusCode).toBe(503);
    expect(r.json.code).toBe('MANAGE_LINK_UNAVAILABLE');
    expect(JSON.stringify(db.__dump())).toBe(before);
    expect(mailSpy).not.toHaveBeenCalled();
  });

  it('tour without a snapshot (none) or with a partial binding → 409 SLOT_BINDING_MISSING', async () => {
    db.__delete(SNAP);
    expect((await call(guestChange())).json.code).toBe('SLOT_BINDING_MISSING');
    db.__set(SNAP, { slotBooking: { tourId: TOUR } });
    expect((await call(guestChange())).json.code).toBe('SLOT_BINDING_MISSING');
    expect(db.__get(PATH)!.tourDate).toBe(FROM);
  });

  it('target date full → 409 SLOT_FULL, booking untouched', async () => {
    db.__set(AV(TO), { status: 'available', slot_bookings: { [SLOT]: 7 } });
    const r = await call(guestChange());
    expect(r.statusCode).toBe(409);
    expect(r.json.code).toBe('SLOT_FULL');
    expect(db.__get(PATH)!.tourDate).toBe(FROM);
    expect(db.__get(PATH)!.manageTokenVersion).toBeUndefined();
  });

  it("tourTime '' and tourTime missing both pass the policy", async () => {
    expect((await call(guestChange())).statusCode).toBe(200);
    const noTime: Record<string, any> = member();
    delete noTime.tourTime;
    db = createFakeFirestore(tourDocs(noTime));
    expect((await call(memberChange(), BEARER)).statusCode).toBe(200);
  });

  it('cancel race inside the transfer transaction → 409 BOOKING_CHANGED, 5 docs untouched', async () => {
    db = createFakeFirestore(tourDocs(member()));
    let patched = false;
    db.__beforeCommit = async () => { if (!patched) { patched = true; db.__patch(PATH, { status: 'CANCELING' }); } };
    const snapshotBefore = JSON.stringify([db.__get(SNAP), db.__get(AV(FROM)), db.__get(AV(TO))]);
    const r = await call(memberChange(), BEARER);
    expect(r.statusCode).toBe(409);
    expect(r.json.code).toBe('BOOKING_CHANGED');
    expect(JSON.stringify([db.__get(SNAP), db.__get(AV(FROM)), db.__get(AV(TO))])).toBe(snapshotBefore);
    expect(db.__get(PATH)!.tourDate).toBe(FROM);
  });

  it('retry re-checks 24h with the current clock (time passed into the window → BOOKING_CHANGED)', async () => {
    db = createFakeFirestore(tourDocs(member()));
    const startOfFrom = Date.parse(`${FROM}T00:00:00+09:00`);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now());
    let bumped = false;
    db.__beforeCommit = async () => {
      if (bumped) return;
      bumped = true;
      db.__patch(PATH, { note: 'touched' }); // 충돌 → 재시도 유발(필드는 유효)
      vi.setSystemTime(startOfFrom - 12 * 60 * 60 * 1000); // 재시도 시점 = 현재 날짜 12h 전
    };
    const r = await call(memberChange(), BEARER);
    expect(r.statusCode).toBe(409);
    expect(r.json.code).toBe('BOOKING_CHANGED');
    expect(db.__get(PATH)!.tourDate).toBe(FROM);
    expect(db.__get(AV(FROM))!.slot_bookings[SLOT]).toBe(2);
  });
});

describe('date change — charter (slotBooking: null)', () => {
  it('booking-only change, snapshot and availability untouched', async () => {
    db = createFakeFirestore({
      [PATH]: member({ productType: 'charter_hourly' }),
      [SNAP]: { slotBooking: null, amountUSD: '200.00' },
    });
    const r = await call(memberChange(), BEARER);
    expect(r.statusCode).toBe(200);
    expect(r.json.data.slotTransferred).toBe(false);
    expect(db.__get(PATH)!.tourDate).toBe(TO);
    expect(db.__get(SNAP)).toEqual({ slotBooking: null, amountUSD: '200.00' });
    expect(Object.keys(db.__dump()).filter((p) => p.startsWith('tour_availability/'))).toEqual([]);
  });

  it('charter without any snapshot is also booking-only', async () => {
    db = createFakeFirestore({ [PATH]: member({ productType: 'charter_multiday' }) });
    expect((await call(memberChange(), BEARER)).statusCode).toBe(200);
  });
});

describe('guest token recovery', () => {
  async function firstChange() {
    const oldToken = tokenV(0);
    const r = await call(guestChange({ manageToken: oldToken }));
    expect(r.statusCode).toBe(200);
    mailSpy.mockClear(); alertSpy.mockClear();
    return oldToken;
  }

  it('(i) old token + same requestId + same date → 200 recovered, new token, zero writes, no mail/alert', async () => {
    const oldToken = await firstChange();
    const before = JSON.stringify(db.__dump());
    const r = await call(guestChange({ manageToken: oldToken }));
    expect(r.statusCode).toBe(200);
    expect(r.headers['Cache-Control']).toBe('no-store');
    expect(r.json.data).toMatchObject({ recovered: true, emailSent: false, tourDate: TO, applied: { tourDate: TO } });
    expect(verifyBookingManageToken(r.json.data.manageToken, { orderID: ID, version: 1 })).toMatchObject({ ok: true });
    expect(JSON.stringify(db.__dump())).toBe(before);
    expect(mailSpy).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('(i) mismatches → identical 401: other requestId / other date / later change or cancel / manual booking', async () => {
    const oldToken = await firstChange();
    expect((await call(guestChange({ manageToken: oldToken, requestId: RID2 }))).statusCode).toBe(401);
    expect((await call(guestChange({ manageToken: oldToken, changes: { tourDate: kstDatePlusDays(Date.now(), 41) } }))).statusCode).toBe(401);
    db.__patch(PATH, { manageTokenVersion: 2 }); // 그 뒤 취소·재변경으로 버전이 더 올랐다
    const later = await call(guestChange({ manageToken: oldToken }));
    expect(later.statusCode).toBe(401);
    expect(later.json).toMatchObject({ code: 'AUTH_REQUIRED', error: 'Authentication required' });
    db.__patch(PATH, { manageTokenVersion: 1, userEmail: 'manual@example.com' });
    expect((await call(guestChange({ manageToken: oldToken }))).statusCode).toBe(401);
  });

  it('(ii) concurrent retry: both authenticate, first commits, second hits BOOKING_CHANGED → recovered 200, one transfer, one mail', async () => {
    const oldToken = tokenV(0);
    const barrier = makeBarrier(2);
    db.__beforeCommit = async () => { await barrier.wait(); };
    const [a, b] = await Promise.all([call(guestChange({ manageToken: oldToken })), call(guestChange({ manageToken: oldToken }))]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    const recovered = [a, b].filter((r) => r.json.data.recovered === true);
    expect(recovered).toHaveLength(1);
    expect(mailSpy).toHaveBeenCalledTimes(1);
    expect(db.__get(AV(TO))!.slot_bookings[SLOT]).toBe(2);
    expect(db.__get(PATH)!.manageTokenVersion).toBe(1);
    expect(db.__get(PATH)!.modifications).toHaveLength(1);
  });

  it('(ii) concurrent with a different requestId → the loser keeps 409 BOOKING_CHANGED', async () => {
    const oldToken = tokenV(0);
    const barrier = makeBarrier(2);
    db.__beforeCommit = async () => { await barrier.wait(); };
    const [a, b] = await Promise.all([
      call(guestChange({ manageToken: oldToken })),
      call(guestChange({ manageToken: oldToken, requestId: RID2 })),
    ]);
    const codes = [a, b].map((r) => (r.statusCode === 200 ? 'OK' : r.json.code)).sort();
    expect(codes).toEqual(['BOOKING_CHANGED', 'OK']);
    expect(db.__get(AV(TO))!.slot_bookings[SLOT]).toBe(2);
  });
});
