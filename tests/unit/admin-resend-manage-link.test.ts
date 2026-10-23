/* eslint-disable @typescript-eslint/no-explicit-any -- 핸들러/Firestore 모킹 스캐폴딩. */
/**
 * action='resend-manage-link' (2026-10-23, PR-3 + Astra 명세 검토 r1) — 관리자 게스트 관리 링크 재발송.
 * 잠그는 것: 인증 · 게스트·CONFIRMED 만 · 결제 환경 불일치·이미 만료 → 발송 전 거절 · 수신자 = 저장된 payerEmail(본문 주소 무시) ·
 *   현재 버전 토큰(버전 불변) · 발송 전 트랜잭션 선점(동시 2건 → 메일 1통) · 60초 경계 · 성공 기록 + 조건부 pending 삭제 ·
 *   발송 전 실패 502 MAIL_FAILED / 결과 미상·기록 실패 502 MAIL_RESULT_UNKNOWN(업무 필드 불변) ·
 *   응답·로그·Sentry 에 토큰/링크 없음(오류 메시지가 토큰을 되울려도) · 메일 빌더 4개 언어 + escape.
 * 실제 메일·PayPal·Firestore 없음.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFakeFirestore, FieldValue as FakeFieldValue, makeBarrier } from '../helpers/fake-firestore.js';
import { kstDatePlusDays } from '../../api/_shared/calendar-date.js';

const authHolder: { result: any } = { result: { ok: true, email: 'admin@cocotrip.kr', uid: 'admin1' } };
const sendEmailSpy = vi.fn<(args: any) => Promise<any>>(async () => ({ messageId: 'm1' }));
const captureSpy = vi.fn();
let db: ReturnType<typeof createFakeFirestore>;

vi.mock('../../api/_shared/admin-auth.js', () => ({ verifyAdminToken: async () => authHolder.result }));
vi.mock('../../api/_shared/paypal-refund.js', () => ({ refundPaypalCapture: vi.fn() }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: vi.fn(async () => ({ ok: true })) }));
vi.mock('../../api/_shared/slot-capacity.js', () => ({ releaseSlotForCanceledOrder: vi.fn() }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: (...a: any[]) => captureSpy(...a) }));
vi.mock('../../api/_shared/notify.js', () => ({ notify: vi.fn(async () => ({ ok: true })) }));
vi.mock('../../api/_send-email.js', async () => {
  const actual: any = await vi.importActual('../../api/_send-email.js');
  return { maskEmailForLog: actual.maskEmailForLog, sendEmail: (args: any) => sendEmailSpy(args) };
});
vi.mock('../../api/_shared/manual-payment-emails.js', () => ({ buildManualPaymentEmail: () => ({ subject: 's', html: '', text: '' }) }));
vi.mock('../../api/_shared/booking-confirm.js', () => ({ confirmBookingAsPaid: vi.fn() }));
vi.mock('../../api/_shared/cors.js', () => ({ buildAdminJsonCors: () => ({}) }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: FakeFieldValue }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => db }));

const { default: handler } = await import('../../api/admin-booking-action.js');
const { verifyBookingManageToken } = await import('../../api/_shared/booking-manage-token.js');
const { buildManageLinkEmail } = await import('../../api/_shared/booking-manage-link-emails.js');

const REF = 'ORD-G';
const PATH = `bookings/${REF}`;
const TOUR_DATE = kstDatePlusDays(Date.now(), 30);
const BODY = { bookingRef: REF, action: 'resend-manage-link' };
const guest = (over: Record<string, any> = {}) => ({
  bookingRef: REF, orderID: REF, status: 'CONFIRMED', userEmail: '', uid: null, payerEmail: 'guest@example.com',
  productType: 'tour_gyeongbok', tourDate: TOUR_DATE, paypalEnvironment: 'live', language: 'ja',
  manageTokenVersion: 3, manageLinkPending: { version: 3, createdAt: '2026-10-23T00:00:00.000Z' }, ...over,
});

async function call(body: object = BODY) {
  const out = { statusCode: 0, headers: {} as Record<string, string>, body: '' };
  const res = { writeHead(c: number, h: Record<string, string>) { out.statusCode = c; out.headers = h || {}; }, end(b?: string) { out.body = b || ''; } };
  await handler({ method: 'POST', url: '/api/admin-booking-action', headers: { host: 'unit.test' }, body } as any, res as any);
  return { ...out, json: out.body ? JSON.parse(out.body) : null };
}
/** 보낸 메일 본문에서 관리 토큰을 꺼낸다(링크 = .../booking/manage#t=<token>). */
const tokenFromMail = (mail: any) => String(mail.text).match(/\/booking\/manage#t=([A-Za-z0-9_.-]+)/)![1];
/** 예약 업무 필드 — 선점 기록(manageLinkResendClaim)만 뺀 문서. "실패 시 불변" 비교용. */
const businessFields = () => { const d: any = { ...db.__get(PATH) }; delete d.manageLinkResendClaim; return JSON.stringify(d); };
const preSendError = () => Object.assign(new Error('Missing GMAIL credentials'), { code: 'EENV', preSend: true });

const ENV_KEYS = ['VERCEL_ENV', 'PAYPAL_ENV', 'BOOKING_MANAGE_SIGNING_SECRET'];
const savedEnv: Record<string, string | undefined> = {};
let logSpies: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.VERCEL_ENV = 'production';
  delete process.env.PAYPAL_ENV;
  process.env.BOOKING_MANAGE_SIGNING_SECRET = 'e'.repeat(48);
  authHolder.result = { ok: true, email: 'admin@cocotrip.kr', uid: 'admin1' };
  sendEmailSpy.mockReset(); sendEmailSpy.mockResolvedValue({ messageId: 'm1' });
  captureSpy.mockReset();
  // 가짜 serverTimestamp 가 지금 시각 근처가 되게(60초 연타 판정이 실제 시계와 같은 축).
  db = createFakeFirestore({ [PATH]: guest() }, { startMs: Date.now() });
  logSpies = (['log', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  logSpies.forEach((s) => s.mockRestore());
  vi.useRealTimers();
});
const loggedText = () => JSON.stringify(logSpies.flatMap((s) => s.mock.calls));

describe('resend-manage-link — auth and refusals (no mail, booking untouched)', () => {
  it('401 / 403 from the admin token gate', async () => {
    authHolder.result = { ok: false, status: 401, error: 'no token' };
    expect((await call()).statusCode).toBe(401);
    authHolder.result = { ok: false, status: 403, error: 'not admin' };
    expect((await call()).statusCode).toBe(403);
    expect(sendEmailSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['member booking', { userEmail: 'm@example.com', uid: 'u1' }, 409, 'NOT_GUEST_BOOKING'],
    ['cart child', { parentOrderID: 'CART-1' }, 409, 'NOT_GUEST_BOOKING'],
    ['CANCELED', { status: 'CANCELED' }, 409, 'INVALID_STATE'],
    ['CANCELING', { status: 'CANCELING' }, 409, 'INVALID_STATE'],
    // 운영(live) 배포에서 sandbox 결제 예약 — 링크가 관리 페이지에서 열리지 않는다.
    ['payment environment ≠ this deployment', { paypalEnvironment: 'sandbox' }, 409, 'ENV_MISMATCH'],
    // 투어가 지나 토큰 만료(투어일 + 7일)까지 지났다 — 만료 정책은 늘리지 않는다.
    ['link already expired', { tourDate: kstDatePlusDays(Date.now(), -30) }, 409, 'LINK_EXPIRED'],
    ['token cannot be signed (invalid tourDate)', { tourDate: 'not-a-date' }, 503, 'MANAGE_LINK_UNAVAILABLE'],
  ] as Array<[string, Record<string, any>, number, string]>)('%s → %s %s', async (_label, over, status, code) => {
    db.__set(PATH, guest(over));
    const before = JSON.stringify(db.__dump());
    const r = await call();
    expect(r.statusCode).toBe(status);
    expect(r.json.code).toBe(code);
    expect(JSON.stringify(db.__dump())).toBe(before);
    expect(sendEmailSpy).not.toHaveBeenCalled();
  });

  it('404 when bookings/{bookingRef} does not exist', async () => {
    db.__delete(PATH);
    expect((await call()).json.code).toBe('NOT_FOUND');
    expect(sendEmailSpy).not.toHaveBeenCalled();
  });
});

describe('resend-manage-link — success', () => {
  it('one mail to the stored payerEmail with a current-version token; version unchanged, pending cleared, no token in response/logs', async () => {
    // 본문에 다른 주소를 넣어도 무시된다 — 수신자는 저장된 payerEmail 뿐.
    const r = await call({ ...BODY, email: 'attacker@evil.test', to: 'attacker@evil.test', payerEmail: 'attacker@evil.test' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['Cache-Control']).toBe('no-store');
    expect(r.json).toEqual({ ok: true, data: { recipientMasked: 'g***@example.com' } });

    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    const mail = sendEmailSpy.mock.calls[0][0];
    expect(mail.to).toBe('guest@example.com');
    expect(mail.subject).toContain('ご予約管理リンク'); // 예약 언어(ja)
    const token = tokenFromMail(mail);
    expect(mail.html).toContain(`https://cocotripkr.com/booking/manage#t=${token}`);
    expect(verifyBookingManageToken(token, { orderID: REF, version: 3, paypalEnvironment: 'live', deployment: 'production' })).toMatchObject({ ok: true });

    const doc = db.__get(PATH)!;
    expect(doc.manageTokenVersion).toBe(3); // 재발송은 버전을 올리지 않는다(기존 링크 유효)
    expect(doc).not.toHaveProperty('manageLinkPending');
    expect(typeof doc.manageLinkResentAt).toBe('number');
    expect(doc.manageLinkResendClaim).toMatchObject({ by: 'admin@cocotrip.kr', version: 3 }); // 발송 전 선점 기록

    expect(r.body).not.toContain(token);
    expect(r.body).not.toContain('#t=');
    expect(loggedText()).not.toContain(token);
    const audit = Object.entries(db.__dump()).filter(([p]) => p.startsWith('admin_actions/')).map(([, v]) => v as any);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'resend-manage-link', bookingRef: REF, adminEmail: 'admin@cocotrip.kr', manageTokenVersion: 3 });
    expect(JSON.stringify(audit)).not.toContain(token);
  });

  it('a second request within 60s → 429 RESEND_TOO_SOON, no second mail', async () => {
    expect((await call()).statusCode).toBe(200);
    const r = await call();
    expect(r.statusCode).toBe(429);
    expect(r.json.code).toBe('RESEND_TOO_SOON');
    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
  });

  it('two concurrent resends → one claim wins: exactly one mail, the other 429', async () => {
    const gate = makeBarrier(2);
    db.__beforeCommit = () => gate.wait(); // 두 선점 트랜잭션이 모두 읽은 뒤 커밋 — 실제 경쟁 재현
    const [a, b] = await Promise.all([call(), call()]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 429]);
    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    expect(db.__stats.retries).toBeGreaterThan(0);
  });

  it.each([
    ['last resend exactly 60s ago', (T: number) => ({ manageLinkResentAt: T - 60_000 }), 200],
    ['last resend 59.999s ago', (T: number) => ({ manageLinkResentAt: T - 59_999 }), 429],
    ['another claim exactly 60s ago', (T: number) => ({ manageLinkResendClaim: { at: T - 60_000, by: 'x', version: 3 } }), 200],
    ['another claim 59.999s ago', (T: number) => ({ manageLinkResendClaim: { at: T - 59_999, by: 'x', version: 3 } }), 429],
  ] as Array<[string, (T: number) => Record<string, any>, number]>)('60s boundary — %s → %s', async (_label, over, status) => {
    const T = Date.now();
    vi.useFakeTimers({ toFake: ['Date'] }); // 시계를 T 에 고정 — 경계를 정확히 잰다
    vi.setSystemTime(T);
    db.__set(PATH, guest(over(T)));
    expect((await call()).statusCode).toBe(status);
    expect(sendEmailSpy).toHaveBeenCalledTimes(status === 200 ? 1 : 0);
  });

  it('booking language missing → English mail', async () => {
    db.__set(PATH, guest({ language: undefined }));
    await call();
    expect(sendEmailSpy.mock.calls[0][0].subject).toContain('Your booking management link');
  });
});

describe('resend-manage-link — failures', () => {
  it('failure before sending (_send-email preSend) → 502 MAIL_FAILED, business fields unchanged, no retry', async () => {
    sendEmailSpy.mockRejectedValue(preSendError());
    const before = businessFields();
    const r = await call();
    expect(r.statusCode).toBe(502);
    expect(r.json).toEqual({ ok: false, error: expect.any(String), code: 'MAIL_FAILED' });
    expect(businessFields()).toBe(before);
    expect(sendEmailSpy).toHaveBeenCalledTimes(1); // 자동 재시도 없음
  });

  it('SMTP result unknown (failure after the send boundary) → 502 MAIL_RESULT_UNKNOWN + manual check, business fields unchanged', async () => {
    sendEmailSpy.mockRejectedValue(Object.assign(new Error('Greeting never received'), { code: 'ETIMEDOUT' }));
    const before = businessFields();
    const r = await call();
    expect(r.statusCode).toBe(502);
    expect(r.json).toMatchObject({ ok: false, code: 'MAIL_RESULT_UNKNOWN' });
    expect(r.json.error).toContain('수동 확인');
    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    expect(businessFields()).toBe(before);
    // 결과 미상이어도 선점은 남아 60초 안 재클릭이 두 번째 메일을 만들지 않는다.
    expect((await call()).statusCode).toBe(429);
    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
  });

  it('mail sent but recording fails → 502 MAIL_RESULT_UNKNOWN (not "not sent")', async () => {
    const realTx = db.runTransaction;
    let n = 0;
    db.runTransaction = (async (fn: any, opts: any) => {
      n += 1;
      if (n === 2) throw new Error('14 UNAVAILABLE'); // 1 = 선점, 2 = 발송 후 기록
      return realTx(fn, opts);
    }) as typeof db.runTransaction;
    const r = await call();
    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    expect(r.statusCode).toBe(502);
    expect(r.json.code).toBe('MAIL_RESULT_UNKNOWN');
    expect(r.json.error).toContain('수동 확인');
  });

  it('version changes while sending (e.g. a date change) → that change\'s pending is kept; resend time still recorded', async () => {
    sendEmailSpy.mockImplementation(async () => {
      db.__patch(PATH, { manageTokenVersion: 4, manageLinkPending: { version: 4, createdAt: 'T1' } });
      return { messageId: 'm1' };
    });
    const r = await call();
    expect(r.statusCode).toBe(200);
    const doc = db.__get(PATH)!;
    expect(doc.manageLinkPending).toEqual({ version: 4, createdAt: 'T1' });
    expect(doc.manageTokenVersion).toBe(4);
    expect(typeof doc.manageLinkResentAt).toBe('number');
  });

  it('pending from an older version is not cleared by a current-version resend', async () => {
    db.__set(PATH, guest({ manageLinkPending: { version: 2, createdAt: 'T0' } }));
    expect((await call()).statusCode).toBe(200);
    expect(db.__get(PATH)!.manageLinkPending).toEqual({ version: 2, createdAt: 'T0' });
  });

  it('booking changes between the read and the claim → 409 BOOKING_CHANGED, no mail', async () => {
    let patched = false;
    db.__beforeCommit = () => { if (!patched) { patched = true; db.__patch(PATH, { status: 'CANCELING' }); } };
    const r = await call();
    expect(r.statusCode).toBe(409);
    expect(r.json.code).toBe('BOOKING_CHANGED');
    expect(sendEmailSpy).not.toHaveBeenCalled();
    expect(db.__get(PATH)!.manageLinkResendClaim).toBeUndefined();
  });

  it('an SMTP error that echoes the link/token never reaches the response, logs or Sentry', async () => {
    let token = '';
    sendEmailSpy.mockImplementation(async (mail: any) => {
      token = tokenFromMail(mail);
      throw Object.assign(new Error(`550 5.7.1 rejected message: ${mail.text}`), { code: 'EMESSAGE', response: mail.html });
    });
    const r = await call();
    expect(token).not.toBe('');
    expect(r.statusCode).toBe(502);
    expect(r.body).not.toContain(token);
    expect(r.body).not.toContain('#t=');
    expect(loggedText()).not.toContain(token);
    expect(captureSpy).not.toHaveBeenCalled();
  });
});

describe('buildManageLinkEmail — 4 languages + escape', () => {
  const args = { bookingRef: 'REF-1', label: 'Seoul <script>x</script> & Co', tourDate: '2026-11-20', manageUrl: 'https://cocotripkr.com/booking/manage#t=a"b<c' };

  it.each([
    ['ko', '예약 관리 링크 안내'],
    ['en', 'Your booking management link'],
    ['ja', 'ご予約管理リンク'],
    ['zh', '您的预订管理链接'],
    ['fr', 'Your booking management link'], // 미지원 → en
  ])('%s subject', (language, expected) => {
    const m = buildManageLinkEmail({ ...args, language });
    expect(m.subject).toContain(expected);
    expect(m.subject).toContain('REF-1');
  });

  it('resend keeps the version — the mail must not say the link replaces earlier ones (date-change wording)', () => {
    for (const language of ['ko', 'en', 'ja', 'zh']) {
      const m = buildManageLinkEmail({ ...args, language });
      expect(m.text).not.toMatch(/replaces|대신합니다|代わります|取代/);
    }
  });

  it('user-controlled values are escaped in html; the plain-text part carries the raw link', () => {
    const m = buildManageLinkEmail({ ...args, language: 'en' });
    expect(m.html).not.toContain('<script>');
    expect(m.html).toContain('&lt;script&gt;');
    expect(m.html).not.toContain('a"b<c');
    expect(m.text).toContain(`: ${args.manageUrl}`);
    expect(m.text).toContain('REF-1');
  });
});
