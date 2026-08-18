/* eslint-disable @typescript-eslint/no-explicit-any -- 핸들러/Firestore 모킹 스캐폴딩 (review-request/course-share 패턴). */
/**
 * api/_crons/preview-lead-recovery.js — free-preview 이탈 회복 이메일 cron 회귀 (2026-08-19).
 *
 * 잠금:
 *   1. isEligibleForRecovery — 24h~7d 윈도 경계.
 *   2. buildRecoveryEmail — 4언어 전부에 수신거부 링크 + planner utm 링크 포함(§50).
 *   3. PREVIEW_RECOVERY_ENABLED 미설정/false → 강제 dryRun(발송 0, Firestore 쓰기 0).
 *   4. 수신거부 리드 → 스킵(발송 0), 이미 CONFIRMED 전환 리드 → convertedAtMs 마킹 + 스킵(발송 0).
 *   5. 손님당 평생 1회 — 발송 후 recoveryEmailSentAtMs 마킹되면 다음 실행 쿼리에서 제외.
 *   6. 배치 상한 20건/실행.
 *   7. 수신거부 URL 발급 불가(시크릿 미설정) → 발송 자체를 건너뛴다(fail closed).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendEmailMock = vi.fn();
vi.mock('../../api/_send-email.js', () => ({ sendEmail: (...a: any[]) => sendEmailMock(...a) }));

const sendDiscordMock = vi.fn();
vi.mock('../../api/_shared/notify.js', () => ({ sendDiscord: (...a: any[]) => sendDiscordMock(...a) }));

const isOptedOutMock = vi.fn();
const buildUnsubUrlMock = vi.fn();
vi.mock('../../api/_shared/marketing-optout.js', () => ({
  isMarketingOptedOut: (...a: any[]) => isOptedOutMock(...a),
  buildUnsubscribeUrl: (...a: any[]) => buildUnsubUrlMock(...a),
}));

let currentDb: any = null;
vi.mock('../../api/_shared/firebase-admin.js', () => ({
  initAdminDb: () => currentDb,
}));

/** In-memory Firestore double — real equality filtering so idempotency emerges naturally. */
function makeFakeDb() {
  const state = {
    previewLeadsDocs: [] as { id: string; data: Record<string, any> }[],
    bookingsUserEmpty: true,
    bookingsPayerEmpty: true,
    updates: [] as { id: string; patch: any }[],
  };
  const db = {
    collection(name: string) {
      if (name === 'preview_leads') {
        return {
          where: (field: string, _op: string, val: any) => ({
            get: async () => ({
              docs: state.previewLeadsDocs
                .filter((d) => d.data[field] === val)
                .map((d) => ({
                  id: d.id,
                  data: () => d.data,
                  ref: { update: async (patch: any) => { state.updates.push({ id: d.id, patch }); Object.assign(d.data, patch); } },
                })),
            }),
          }),
        };
      }
      if (name === 'bookings') {
        return {
          where: (field: string) => ({
            where: () => ({
              limit: () => ({
                get: async () => ({ empty: field === 'userEmail' ? state.bookingsUserEmpty : state.bookingsPayerEmpty }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected collection: ${name}`);
    },
  };
  return { db, state };
}

function mockRes() {
  const r: any = { statusCode: 0, body: null as any };
  r.status = (s: number) => { r.statusCode = s; return r; };
  r.json = (b: any) => { r.body = b; return r; };
  r.end = () => r;
  return r;
}

const DAY_MS = 24 * 60 * 60 * 1000;
function leadFixture(id: string, ageMs: number, overrides: Record<string, any> = {}) {
  return { id, data: { emailLower: `${id}@example.com`, language: 'en', createdAtMs: Date.now() - ageMs, recoveryEmailSentAtMs: null, convertedAtMs: null, ...overrides } };
}

import handler, { isEligibleForRecovery, buildRecoveryEmail } from '../../api/_crons/preview-lead-recovery.js';

beforeEach(() => {
  sendEmailMock.mockReset().mockResolvedValue({ messageId: 'x' });
  sendDiscordMock.mockReset();
  isOptedOutMock.mockReset().mockResolvedValue(false);
  buildUnsubUrlMock.mockReset().mockReturnValue('https://cocotripkr.com/api/marketing-unsubscribe?email=x&token=y');
  delete process.env.PREVIEW_RECOVERY_ENABLED;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  currentDb = null;
});

describe('isEligibleForRecovery — 24h~7d 윈도', () => {
  const now = Date.now();
  it('12시간 전(너무 최근) → 제외', () => {
    expect(isEligibleForRecovery({ createdAtMs: now - 12 * 60 * 60 * 1000 }, now)).toBe(false);
  });
  it('정확히 24시간 전(경계, 포함) → 대상', () => {
    expect(isEligibleForRecovery({ createdAtMs: now - DAY_MS }, now)).toBe(true);
  });
  it('3일 전 → 대상', () => {
    expect(isEligibleForRecovery({ createdAtMs: now - 3 * DAY_MS }, now)).toBe(true);
  });
  it('정확히 7일 전(경계, 포함) → 대상', () => {
    expect(isEligibleForRecovery({ createdAtMs: now - 7 * DAY_MS }, now)).toBe(true);
  });
  it('8일 전(너무 오래) → 제외', () => {
    expect(isEligibleForRecovery({ createdAtMs: now - 8 * DAY_MS }, now)).toBe(false);
  });
  it('createdAtMs 없음/null → 제외 (throw 없음)', () => {
    expect(isEligibleForRecovery(null, now)).toBe(false);
    expect(isEligibleForRecovery({}, now)).toBe(false);
  });
});

describe('buildRecoveryEmail — 4언어 전부 unsubscribe + utm 링크 포함', () => {
  const UNSUB = 'https://cocotripkr.com/api/marketing-unsubscribe?email=a%40b.com&token=abc123';
  for (const lang of ['ko', 'en', 'ja', 'zh'] as const) {
    it(`${lang}: html/text 모두 unsubscribe URL + planner utm 링크 포함, $9.90 언급`, () => {
      const email = buildRecoveryEmail({ language: lang }, UNSUB);
      expect(email.subject.length).toBeGreaterThan(0);
      for (const part of [email.html, email.text]) {
        expect(part).toContain(UNSUB);
        expect(part).toContain('https://cocotripkr.com/planner?utm_source=email&utm_medium=recovery&utm_campaign=preview_lead');
        expect(part).toContain('9.90');
      }
    });
  }
  it('알 수 없는 언어 → en 폴백', () => {
    const email = buildRecoveryEmail({ language: 'xx' }, UNSUB);
    expect(email.subject).toBe(buildRecoveryEmail({ language: 'en' }, UNSUB).subject);
  });
});

describe('preview-lead-recovery cron — 안전장치', () => {
  it('PREVIEW_RECOVERY_ENABLED 미설정 → 강제 dryRun, 발송 0, Firestore 쓰기 0', async () => {
    const { db, state } = makeFakeDb();
    state.previewLeadsDocs.push(leadFixture('a', 3 * DAY_MS));
    currentDb = db;
    const res = mockRes();
    await handler({ method: 'GET', query: {} } as any, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.enabled).toBe(false);
    expect(res.body.dryRun).toBe(true);
    expect(res.body.sentCount).toBe(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(state.updates).toHaveLength(0);
  });

  it('PREVIEW_RECOVERY_ENABLED=false → 여전히 강제 dryRun', async () => {
    process.env.PREVIEW_RECOVERY_ENABLED = 'false';
    const { db } = makeFakeDb();
    currentDb = db;
    const res = mockRes();
    await handler({ method: 'GET', query: {} } as any, res);
    expect(res.body.dryRun).toBe(true);
  });

  it('opted-out 리드 → 스킵, 발송 0, Firestore 쓰기 0', async () => {
    process.env.PREVIEW_RECOVERY_ENABLED = 'true';
    const { db, state } = makeFakeDb();
    state.previewLeadsDocs.push(leadFixture('a', 3 * DAY_MS));
    currentDb = db;
    isOptedOutMock.mockResolvedValueOnce(true);
    const res = mockRes();
    await handler({ method: 'GET', query: {} } as any, res);
    expect(res.body.optOutSkipCount).toBe(1);
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(state.updates).toHaveLength(0);
  });

  it('이미 CONFIRMED 전환된 리드 → convertedAtMs 마킹 + 스킵, 발송 0', async () => {
    process.env.PREVIEW_RECOVERY_ENABLED = 'true';
    const { db, state } = makeFakeDb();
    state.previewLeadsDocs.push(leadFixture('a', 3 * DAY_MS));
    state.bookingsUserEmpty = false; // userEmail 매칭 CONFIRMED 예약 존재
    currentDb = db;
    const res = mockRes();
    await handler({ method: 'GET', query: {} } as any, res);
    expect(res.body.convertedCount).toBe(1);
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(state.previewLeadsDocs[0].data.convertedAtMs).toBe(state.updates[0].patch.convertedAtMs);
    expect(typeof state.previewLeadsDocs[0].data.convertedAtMs).toBe('number');
  });

  it('수신거부 URL 발급 불가(시크릿 미설정 등) → 발송 건너뜀 (fail closed)', async () => {
    process.env.PREVIEW_RECOVERY_ENABLED = 'true';
    const { db, state } = makeFakeDb();
    state.previewLeadsDocs.push(leadFixture('a', 3 * DAY_MS));
    currentDb = db;
    buildUnsubUrlMock.mockReturnValueOnce('');
    const res = mockRes();
    await handler({ method: 'GET', query: {} } as any, res);
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(res.body.errorCount).toBe(1);
    expect(state.updates).toHaveLength(0);
  });

  it('손님당 평생 1회 — 발송 후 재실행하면 재발송 안 함 (recoveryEmailSentAtMs 마킹이 다음 쿼리에서 제외)', async () => {
    process.env.PREVIEW_RECOVERY_ENABLED = 'true';
    const { db, state } = makeFakeDb();
    state.previewLeadsDocs.push(leadFixture('a', 3 * DAY_MS));
    currentDb = db;

    const res1 = mockRes();
    await handler({ method: 'GET', query: {} } as any, res1);
    expect(res1.body.sentCount).toBe(1);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);

    const res2 = mockRes();
    await handler({ method: 'GET', query: {} } as any, res2);
    expect(res2.body.sentCount).toBe(0); // 이미 recoveryEmailSentAtMs 세팅됨 → 쿼리에서 제외
    expect(sendEmailMock).toHaveBeenCalledTimes(1); // 총 1회 그대로
  });

  it('배치 상한 20건/실행 — 후보 25건 중 20건만 발송', async () => {
    process.env.PREVIEW_RECOVERY_ENABLED = 'true';
    const { db, state } = makeFakeDb();
    for (let i = 0; i < 25; i++) state.previewLeadsDocs.push(leadFixture(`lead${i}`, 3 * DAY_MS));
    currentDb = db;
    const res = mockRes();
    await handler({ method: 'GET', query: {} } as any, res);
    expect(res.body.sentCount).toBe(20);
    expect(sendEmailMock).toHaveBeenCalledTimes(20);
  });

  it('no-db(Firestore 미설정) → 200 no-db, throw 없음', async () => {
    currentDb = null;
    const res = mockRes();
    await handler({ method: 'GET', query: {} } as any, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.error).toBe('no-db');
  });
});
