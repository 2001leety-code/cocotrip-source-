/* eslint-disable @typescript-eslint/no-explicit-any -- 핸들러/Firestore 모킹 스캐폴딩. */
/**
 * booking-processor 의 **의미상 성공 계약** — 실패 주입 (2026-07-29 P0).
 *
 * 🔴 이전 구조: 내부 단계가 실패하거나 재시도 대기여도 **항상 200 + ok:true**.
 *   그래서 trigger·retry cron·관리자 재처리가 전부 실패를 성공으로 기록했다.
 *     · retry 문서가 done 으로 닫히고 → 시트도 메일도 적립도 없는 예약이 조용히 남는다
 *     · admin-scan 이 replayedAt 을 찍어 → 다시는 재처리 대상이 되지 않는다
 *
 * 여기서는 각 단계에 실제 실패를 주입하고, 응답 outcome 과 후속 판정을 확인한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFakeFirestore } from '../helpers/fake-firestore.js';
import {
  STEP, OUTCOME, overallOutcome, outcomeFromResponseBody,
  isSemanticallyDone, needsManualIntervention, stepFromLoyaltyHttp, stepFromLedgerReason,
} from '../../api/_shared/processor-outcome.js';

// ── 외부 의존성 전부 목 ────────────────────────────────────────────────
const appendBooking = vi.fn(async () => ({ appendedRow: '시트1!A2' }));
const sendBookingConfirmation = vi.fn(async () => undefined);
let db: ReturnType<typeof createFakeFirestore>;

vi.mock('../../api/_shared/sentry.js', () => ({ captureError: vi.fn() }));
vi.mock('../../api/_shared/notify.js', () => ({ notify: vi.fn(async () => ({ ok: true })) }));
vi.mock('../../api/_telegram.js', () => ({
  sendDispatchAlert: vi.fn(async () => ({ ok: true })),
  sendBookingPaymentAlert: vi.fn(async () => ({ ok: true })),
  sendErrorAlert: vi.fn(async () => ({ ok: true })),
}));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: vi.fn(async () => ({ ok: true })) }));
vi.mock('../../api/_google-sheets.js', () => ({
  appendBooking: (...a: any[]) => appendBooking(...a),
  updateBookingStatus: vi.fn(async () => true),
}));
vi.mock('../../api/_send-email.js', () => ({
  sendBookingConfirmation: (...a: any[]) => sendBookingConfirmation(...a),
  buildDefaultConfirmationEmail: () => ({ subject: 's', html: 'h', text: 't' }),
}));
vi.mock('../../api/_ai-employees.js', () => ({
  generateConfirmationEmail: vi.fn(async () => ({ subject: 's', html: 'h', text: 't' })),
  generateVoucherText: vi.fn(async () => 'voucher'),
}));
vi.mock('../../api/_generate-voucher.js', () => ({ generateVoucherPDF: vi.fn(async () => null) }));
vi.mock('../../api/_create-wallet-pass.js', () => ({ createWalletPass: vi.fn(async () => null) }));
vi.mock('../../api/_exchange-rate.js', () => ({ getUsdToKrwRaw: vi.fn(async () => 1430) }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => db }));

const { default: handler } = await import('../../api/booking-processor.js');

const ORDER = 'ORD-OUTCOME-1';
const savedEnv = { ...process.env };

function mockRes() {
  const out = { statusCode: 0, body: null as any };
  return {
    out,
    setHeader() {},
    status(c: number) { out.statusCode = c; return this; },
    json(b: any) { out.body = b; return this; },
    end() { return this; },
  };
}

async function run(extra: Record<string, unknown> = {}) {
  const res = mockRes();
  await handler({
    method: 'POST',
    headers: { 'x-internal-token': 'secret-tok' },
    body: {
      orderID: ORDER, payerEmail: 'buyer@example.com', payerName: 'Buyer',
      amount: '9.90', product: 'charter', tourDate: '2026-08-01', ...extra,
    },
  } as any, res as any);
  return res.out;
}

/** 적립 API 응답만 흉내낸다 (다른 fetch 는 이 테스트에서 쓰지 않는다). */
function mockLoyalty(status: number) {
  global.fetch = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ ok: status < 400 }),
    text: async () => '',
  })) as never;
}

beforeEach(() => {
  process.env.INTERNAL_API_TOKEN = 'secret-tok';
  process.env.VERCEL_ENV = 'preview';
  process.env.VERCEL_URL = 'preview-host.vercel.app';
  process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'S';
  appendBooking.mockClear();
  appendBooking.mockImplementation(async () => ({ appendedRow: '시트1!A2' }));
  sendBookingConfirmation.mockClear();
  sendBookingConfirmation.mockImplementation(async () => undefined);
  db = createFakeFirestore({
    [`bookings/${ORDER}`]: {
      paymentVerified: true, captureID: 'CAP-1', uid: 'u1', amountUSD: 9.9,
      bookingRef: 'CT-20260729-001',
    },
  });
  mockLoyalty(200);
});
afterEach(() => {
  for (const k of ['VERCEL_ENV', 'VERCEL_URL', 'INTERNAL_API_TOKEN', 'GOOGLE_SHEETS_SPREADSHEET_ID']) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.restoreAllMocks();
});

describe('정상 경로 — 세 단계가 다 끝나야 completed', () => {
  it('전부 성공하면 outcome=completed, ok=true', async () => {
    const r = await run();
    expect(r.body.outcome).toBe(OUTCOME.COMPLETED);
    expect(r.body.ok).toBe(true);
    expect(r.body.data.stepStatus).toEqual({
      sheets: STEP.COMPLETED, email: STEP.COMPLETED, loyalty: STEP.COMPLETED,
    });
    // 외부 결과는 각각 1건
    expect(appendBooking).toHaveBeenCalledTimes(1);
    expect(sendBookingConfirmation).toHaveBeenCalledTimes(1);
  });
});

describe('적립 실패 주입', () => {
  it('🔴 Preview 자기호출 401 → retryable (성공으로 보고하지 않는다)', async () => {
    mockLoyalty(401);
    const r = await run();
    expect(r.body.data.stepStatus.loyalty).toBe(STEP.RETRYABLE);
    expect(r.body.outcome).toBe(OUTCOME.RETRYABLE);
    expect(r.body.ok).toBe(false);
  });

  it('403 → retryable', async () => {
    mockLoyalty(403);
    const r = await run();
    expect(r.body.data.stepStatus.loyalty).toBe(STEP.RETRYABLE);
    expect(r.body.ok).toBe(false);
  });

  it('500 → retryable', async () => {
    mockLoyalty(500);
    const r = await run();
    expect(r.body.data.stepStatus.loyalty).toBe(STEP.RETRYABLE);
    expect(r.body.ok).toBe(false);
  });

  it('🔴 주소를 못 잡으면(프리뷰 VERCEL_URL 없음) 운영으로 안 부르고 retryable', async () => {
    delete process.env.VERCEL_URL;
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as never;
    const r = await run();
    expect(fetchSpy).not.toHaveBeenCalled();          // 운영 API 를 부르지 않았다
    expect(r.body.data.stepStatus.loyalty).toBe(STEP.RETRYABLE);
    expect(r.body.outcome).toBe(OUTCOME.RETRYABLE);
  });

  it('게스트 결제(uid 없음)는 정상 제외 — completed 를 막지 않는다', async () => {
    db.__set(`bookings/${ORDER}`, {
      paymentVerified: true, captureID: 'CAP-1', amountUSD: 9.9, bookingRef: 'CT-1',
    });
    const r = await run();
    expect(r.body.data.stepStatus.loyalty).toBe(STEP.SKIPPED);
    expect(r.body.outcome).toBe(OUTCOME.COMPLETED);
    expect(r.body.ok).toBe(true);
  });

  it('결제 미검증은 자동 재시도로 못 고친다 → failed_permanent', () => {
    expect(stepFromLedgerReason('payment-not-verified')).toBe(STEP.FAILED_PERMANENT);
    expect(stepFromLedgerReason('no-captureID')).toBe(STEP.FAILED_PERMANENT);
    expect(stepFromLedgerReason('firestore-unavailable')).toBe(STEP.RETRYABLE);
    expect(stepFromLedgerReason('admin-or-test-order')).toBe(STEP.SKIPPED);
  });
});

describe('시트 실패 주입', () => {
  it('선점 저장소 불능 → retryable, 외부 작업 미실행', async () => {
    db.__beforeCommit = async () => { throw new Error('firestore down'); };
    const r = await run();
    expect(appendBooking).not.toHaveBeenCalled();     // 중복 방지 장치 없이 내보내지 않는다
    expect(r.body.data.stepStatus.sheets).toBe(STEP.RETRYABLE);
    expect(r.body.outcome).toBe(OUTCOME.RETRYABLE);
    expect(r.body.ok).toBe(false);
  });

  it('append 오류 → retryable (N열 키로 중복이 막히므로 재시도 안전)', async () => {
    appendBooking.mockImplementation(async () => { throw new Error('sheets 500'); });
    const r = await run();
    expect(r.body.data.stepStatus.sheets).toBe(STEP.RETRYABLE);
    expect(r.body.ok).toBe(false);
  });

  it('env 미설정은 정상 제외', async () => {
    appendBooking.mockImplementation(async () => {
      const e: any = new Error('env'); e.name = 'SheetsEnvSkipped'; e.skipped = true; throw e;
    });
    const r = await run();
    expect(r.body.data.stepStatus.sheets).toBe(STEP.SKIPPED);
    expect(r.body.outcome).toBe(OUTCOME.COMPLETED);
  });
});

describe('메일 실패 주입 — 안전한 재시도 vs 결과 미상', () => {
  it('EAUTH(확실히 안 나감) → retryable', async () => {
    sendBookingConfirmation.mockImplementation(async () => {
      const e: any = new Error('auth'); e.code = 'EAUTH'; throw e;
    });
    const r = await run();
    expect(r.body.data.stepStatus.email).toBe(STEP.RETRYABLE);
    expect(r.body.outcome).toBe(OUTCOME.RETRYABLE);
  });

  it('🔴 ETIMEDOUT(나갔는지 모름) → outcome_unknown → manual_intervention', async () => {
    sendBookingConfirmation.mockImplementation(async () => {
      const e: any = new Error('timeout'); e.code = 'ETIMEDOUT'; throw e;
    });
    const r = await run();
    expect(r.body.data.stepStatus.email).toBe(STEP.OUTCOME_UNKNOWN);
    expect(r.body.outcome).toBe(OUTCOME.MANUAL);
    expect(r.body.ok).toBe(false);
    // 격리됐으니 다시 돌려도 보내지 않는다.
    sendBookingConfirmation.mockClear();
    const again = await run();
    expect(sendBookingConfirmation).not.toHaveBeenCalled();
    expect(again.body.data.stepStatus.email).toBe(STEP.OUTCOME_UNKNOWN);
  });
});

describe('한 단계 성공 + 다른 단계 실패', () => {
  it('시트 성공·적립 실패 → 전체는 retryable, 재실행해도 시트는 1행', async () => {
    mockLoyalty(500);
    const first = await run();
    expect(first.body.data.stepStatus.sheets).toBe(STEP.COMPLETED);
    expect(first.body.outcome).toBe(OUTCOME.RETRYABLE);
    expect(appendBooking).toHaveBeenCalledTimes(1);

    // 재시도 — 시트/메일은 완료 상태라 스킵, 적립만 다시 시도
    mockLoyalty(200);
    const second = await run();
    expect(appendBooking).toHaveBeenCalledTimes(1);            // 🔴 행은 여전히 1개
    expect(sendBookingConfirmation).toHaveBeenCalledTimes(1);  // 🔴 메일도 1회
    expect(second.body.outcome).toBe(OUTCOME.COMPLETED);
    expect(second.body.ok).toBe(true);
  });

  it('retryable 이 남아 있으면 outcome_unknown 이 있어도 retryable 이 이긴다', () => {
    expect(overallOutcome({
      sheets: STEP.RETRYABLE, email: STEP.OUTCOME_UNKNOWN, loyalty: STEP.COMPLETED,
    })).toBe(OUTCOME.RETRYABLE);
    expect(overallOutcome({
      sheets: STEP.COMPLETED, email: STEP.OUTCOME_UNKNOWN, loyalty: STEP.COMPLETED,
    })).toBe(OUTCOME.MANUAL);
    expect(overallOutcome({
      sheets: STEP.COMPLETED, email: STEP.COMPLETED, loyalty: STEP.FAILED_PERMANENT,
    })).toBe(OUTCOME.FAILED_PERMANENT);
    expect(overallOutcome({})).toBe(OUTCOME.RETRYABLE);   // 판단 불가 → 성공으로 단정 금지
  });
});

describe('후속 판정 — trigger / retry sweep / 관리자 재처리', () => {
  it('HTTP 200 이어도 outcome 이 completed 가 아니면 성공이 아니다', () => {
    expect(isSemanticallyDone(outcomeFromResponseBody({ ok: false, outcome: 'retryable' }))).toBe(false);
    expect(isSemanticallyDone(outcomeFromResponseBody({ ok: true, outcome: 'completed' }))).toBe(true);
    expect(needsManualIntervention(outcomeFromResponseBody({ outcome: 'manual_intervention' }))).toBe(true);
  });

  it('본문을 못 읽거나 계약 이전 응답이면 성공으로 단정하지 않는다', () => {
    expect(outcomeFromResponseBody(null)).toBe(OUTCOME.RETRYABLE);
    expect(outcomeFromResponseBody({ ok: true })).toBe(OUTCOME.RETRYABLE);
    expect(outcomeFromResponseBody({ ok: true, data: { outcome: 'completed' } })).toBe(OUTCOME.COMPLETED);
  });

  it('trigger 가 200+retryable 응답에 retry 문서를 남긴다', async () => {
    const { triggerBookingProcessor } = await import('../../api/_shared/booking-processor-trigger.js');
    const retryDb = createFakeFirestore({});
    global.fetch = vi.fn(async () => ({
      ok: true, status: 200,
      text: async () => JSON.stringify({ ok: false, outcome: 'retryable', data: { stepStatus: { loyalty: 'retryable' } } }),
    })) as never;

    const r = await triggerBookingProcessor({
      db: retryDb as never, siteUrl: 'https://preview-host.vercel.app',
      payload: { orderID: ORDER }, source: 'unit-test',
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('outcome-retryable');
    expect(retryDb.__get(`pending_processor_retries/${ORDER}`)).toBeTruthy();
  });

  it('trigger 가 200+completed 응답에만 성공으로 기록한다', async () => {
    const { triggerBookingProcessor } = await import('../../api/_shared/booking-processor-trigger.js');
    const retryDb = createFakeFirestore({});
    global.fetch = vi.fn(async () => ({
      ok: true, status: 200,
      text: async () => JSON.stringify({ ok: true, outcome: 'completed', data: {} }),
    })) as never;

    const r = await triggerBookingProcessor({
      db: retryDb as never, siteUrl: 'https://x', payload: { orderID: ORDER }, source: 'unit-test',
    });
    expect(r.ok).toBe(true);
    expect(retryDb.__get(`pending_processor_retries/${ORDER}`)).toBeUndefined();
  });

  it('trigger 가 outcome_unknown 을 manual 로 표시한다 (sweep 이 즉시 에스컬레이션)', async () => {
    const { triggerBookingProcessor } = await import('../../api/_shared/booking-processor-trigger.js');
    global.fetch = vi.fn(async () => ({
      ok: true, status: 200,
      text: async () => JSON.stringify({ outcome: 'manual_intervention', data: { stepStatus: { email: 'outcome_unknown' } } }),
    })) as never;
    const r = await triggerBookingProcessor({
      db: null as never, siteUrl: 'https://x', payload: { orderID: ORDER }, source: 'unit-test',
    });
    expect(r.ok).toBe(false);
    expect(r.manual).toBe(true);
  });

  it('retry sweep 은 의미상 완료일 때만 done, 결과 미상은 manual-intervention', () => {
    const src = readSrc('api/_crons/processor-retry-sweep.js');
    expect(src).toContain("status: 'done'");
    expect(src).toMatch(/else if \(result\.manual\)/);
    expect(src).toContain("status: 'manual-intervention'");
  });

  it('admin-scan 은 의미상 완료일 때만 replayedAt 을 찍는다', () => {
    const src = readSrc('api/admin-scan-suspect-bookings.js');
    expect(src).toContain('const done = isSemanticallyDone(outcome)');
    expect(src).toMatch(/if \(done\) \{[\s\S]{0,200}replayedAt/);
    expect(src).not.toMatch(/if \(procRes\.ok\) \{\s*await docRef\.update\(\{ replayedAt/);
  });

  it('admin-replay 응답이 실제 완료 여부를 표시한다', () => {
    const src = readSrc('api/admin-replay-booking-notifications.js');
    expect(src).toContain('replayed: isSemanticallyDone(outcome)');
    expect(src).not.toContain('replayed: procRes.ok');
  });

  it('적립 HTTP 코드 분류', () => {
    expect(stepFromLoyaltyHttp(200)).toBe(STEP.COMPLETED);
    expect(stepFromLoyaltyHttp(401)).toBe(STEP.RETRYABLE);
    expect(stepFromLoyaltyHttp(403)).toBe(STEP.RETRYABLE);
    expect(stepFromLoyaltyHttp(429)).toBe(STEP.RETRYABLE);
    expect(stepFromLoyaltyHttp(503)).toBe(STEP.RETRYABLE);
    expect(stepFromLoyaltyHttp(400)).toBe(STEP.FAILED_PERMANENT);
  });
});

function readSrc(p: string) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('fs').readFileSync(require('path').join(process.cwd(), p), 'utf8');
}
