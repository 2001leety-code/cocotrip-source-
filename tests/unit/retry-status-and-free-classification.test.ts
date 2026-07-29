/**
 * 자동 재시도 상태 계약 + 무료/금액오류 분리 (2026-07-29 P0).
 *
 * 🔴 결함 1 — trigger 가 completed 가 아닌 **모든** 결과를 status:'pending' 으로 저장했다.
 *   · manual_intervention 도 다음 cron 이 한 번 더 실행 → 확인메일 중복 발송 위험
 *   · failed_permanent 도 최대 재시도 횟수까지 불필요하게 반복
 *   · 보고서의 "outcome_unknown 은 즉시 manual" 과 실제 저장 상태가 달랐다
 *
 * 🔴 결함 2 — invalid-amount / no-orderID 를 skipped_not_applicable 로 분류했다.
 *   유료 결제 문서의 금액이 NaN·0·음수·누락이어도 "무료라 적립 제외" 로 처리되고
 *   전체 outcome 이 completed 가 됐다. 적립·지출·예약수가 조용히 누락된다.
 *   "0원이니까 무료겠지" 는 추정이다 — 무료는 **서버가 남긴 근거**로만 판단한다.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createFakeFirestore } from '../helpers/fake-firestore.js';
import {
  STEP, OUTCOME, RETRY_DOC_STATUS,
  retryDocStatusFor, isAutoRetryableStatus, shouldRetry, needsManualIntervention,
  stepFromLedgerReason, overallOutcome,
} from '../../api/_shared/processor-outcome.js';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const ORDER = 'ORD-RETRY-1';

function bodyFor(outcome: string, stepStatus: Record<string, string> = {}) {
  return JSON.stringify({ ok: outcome === 'completed', outcome, data: { outcome, stepStatus } });
}

describe('1. outcome → retry 문서 status', () => {
  it('completed 는 done, retryable 만 pending', () => {
    expect(retryDocStatusFor(OUTCOME.COMPLETED)).toBe(RETRY_DOC_STATUS.DONE);
    expect(retryDocStatusFor(OUTCOME.RETRYABLE)).toBe(RETRY_DOC_STATUS.PENDING);
  });

  it('🔴 manual_intervention 은 pending 이 아니다', () => {
    expect(retryDocStatusFor(OUTCOME.MANUAL)).toBe(RETRY_DOC_STATUS.MANUAL);
    expect(retryDocStatusFor(OUTCOME.MANUAL)).not.toBe(RETRY_DOC_STATUS.PENDING);
  });

  it('🔴 failed_permanent 도 pending 이 아니다', () => {
    expect(retryDocStatusFor(OUTCOME.FAILED_PERMANENT)).toBe(RETRY_DOC_STATUS.PERMANENT);
    expect(retryDocStatusFor(OUTCOME.FAILED_PERMANENT)).not.toBe(RETRY_DOC_STATUS.PENDING);
  });

  it('cron 이 다시 실행하는 status 는 pending 뿐이다', () => {
    expect(isAutoRetryableStatus(RETRY_DOC_STATUS.PENDING)).toBe(true);
    for (const s of [RETRY_DOC_STATUS.MANUAL, RETRY_DOC_STATUS.PERMANENT, RETRY_DOC_STATUS.DONE]) {
      expect(isAutoRetryableStatus(s), s).toBe(false);
    }
  });

  it('판정 함수 의미가 일관된다', () => {
    expect(shouldRetry(OUTCOME.RETRYABLE)).toBe(true);
    expect(shouldRetry(OUTCOME.MANUAL)).toBe(false);
    expect(needsManualIntervention(OUTCOME.MANUAL)).toBe(true);
    expect(needsManualIntervention(OUTCOME.FAILED_PERMANENT)).toBe(true);
    expect(needsManualIntervention(OUTCOME.RETRYABLE)).toBe(false);
  });

  it('sweep 은 pending 문서만 조회한다 (manual/permanent 는 호출조차 안 한다)', () => {
    const src = read('api/_crons/processor-retry-sweep.js');
    expect(src).toMatch(/\.where\('status', '==', 'pending'\)/);
    expect(src).not.toMatch(/\.where\('status', 'in',/);
  });
});

describe('2. trigger 가 outcome 에 맞는 status 로 저장한다', () => {
  const savedEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...savedEnv };
    vi.restoreAllMocks();
  });

  async function callTrigger(outcome: string, stepStatus: Record<string, string> = {}) {
    const { triggerBookingProcessor } = await import('../../api/_shared/booking-processor-trigger.js');
    const db = createFakeFirestore({});
    global.fetch = vi.fn(async () => ({
      ok: true, status: 200, text: async () => bodyFor(outcome, stepStatus),
    })) as never;
    const result = await triggerBookingProcessor({
      db: db as never, siteUrl: 'https://x', payload: { orderID: ORDER }, source: 'unit-test',
    });
    return { result, doc: db.__get(`pending_processor_retries/${ORDER}`) };
  }

  it('retryable → status=pending', async () => {
    const { result, doc } = await callTrigger('retryable', { loyalty: 'retryable' });
    expect(result.ok).toBe(false);
    expect(doc!.status).toBe(RETRY_DOC_STATUS.PENDING);
    expect(doc!.outcome).toBe(OUTCOME.RETRYABLE);
    expect(doc!.stepStatus).toEqual({ loyalty: 'retryable' });
  });

  it('🔴 manual_intervention → 최초 호출부터 manual-intervention', async () => {
    const { result, doc } = await callTrigger('manual_intervention', { email: 'outcome_unknown' });
    expect(result.manual).toBe(true);
    expect(result.retryable).toBe(false);
    expect(doc!.status).toBe(RETRY_DOC_STATUS.MANUAL);
    expect(isAutoRetryableStatus(doc!.status as string)).toBe(false);
  });

  it('🔴 failed_permanent → 최초 호출부터 자동 재시도 제외 + 원인·stepStatus 저장', async () => {
    const { result, doc } = await callTrigger('failed_permanent', { loyalty: 'failed_permanent' });
    expect(result.retryable).toBe(false);
    expect(doc!.status).toBe(RETRY_DOC_STATUS.PERMANENT);
    expect(doc!.outcome).toBe(OUTCOME.FAILED_PERMANENT);
    expect(doc!.stepStatus).toEqual({ loyalty: 'failed_permanent' });
    expect(doc!.lastFailureReason).toBe('outcome-failed_permanent');
  });

  it('completed → retry 문서를 만들지 않는다', async () => {
    const { result, doc } = await callTrigger('completed');
    expect(result.ok).toBe(true);
    expect(doc).toBeUndefined();
  });

  it('HTTP/네트워크 실패는 일시적으로 보고 pending', async () => {
    const { triggerBookingProcessor } = await import('../../api/_shared/booking-processor-trigger.js');
    const db = createFakeFirestore({});
    global.fetch = vi.fn(async () => { throw new Error('ECONNRESET'); }) as never;
    const r = await triggerBookingProcessor({
      db: db as never, siteUrl: 'https://x', payload: { orderID: ORDER }, source: 'unit-test',
    });
    expect(r.retryable).toBe(true);
    expect(db.__get(`pending_processor_retries/${ORDER}`)!.status).toBe(RETRY_DOC_STATUS.PENDING);
  });

  it('🔴 custom persistRetry 에도 outcome/status 를 전달한다', async () => {
    const { triggerBookingProcessor } = await import('../../api/_shared/booking-processor-trigger.js');
    const calls: unknown[][] = [];
    global.fetch = vi.fn(async () => ({
      ok: true, status: 200, text: async () => bodyFor('manual_intervention', { email: 'outcome_unknown' }),
    })) as never;
    await triggerBookingProcessor({
      db: createFakeFirestore({}) as never, siteUrl: 'https://x',
      payload: { orderID: ORDER }, source: 'unit-test',
      persistRetry: (...args: unknown[]) => { calls.push(args); return Promise.resolve(); },
    });
    expect(calls).toHaveLength(1);
    const meta = calls[0][3] as Record<string, unknown>;
    expect(meta).toBeTruthy();
    expect(meta.outcome).toBe(OUTCOME.MANUAL);
    expect(meta.status).toBe(RETRY_DOC_STATUS.MANUAL);
    expect(meta.stepStatus).toEqual({ email: 'outcome_unknown' });
  });

  it('알림 문구가 상태별로 갈린다', () => {
    // 2026-07-29: 문구 조립이 operatorGuidance() 로 분리됐다.
    //   문구별 실제 내용 검증은 direct-capture-log-and-alert-guidance.test.ts 담당.
    const src = read('api/_shared/booking-processor-trigger.js');
    expect(src).toContain('export function operatorGuidance');
    expect(src).toContain('...operatorGuidance({ orderID, result })');
    expect(src).toContain('자동 재시도 없음');
  });

  it('구형 pending 문서가 failed_permanent 를 받으면 sweep 이 즉시 격리한다', () => {
    const src = read('api/_crons/processor-retry-sweep.js');
    expect(src).toMatch(/else if \(result\.manual\)/);
    expect(src).toContain('status: result.docStatus');
    // needsManualIntervention 이 failed_permanent 도 포함하므로 result.manual 이 true 가 된다.
    expect(needsManualIntervention(OUTCOME.FAILED_PERMANENT)).toBe(true);
  });
});

describe('3. 금액 오류를 무료로 취급하지 않는다', () => {
  it('명시적 무료(서버 근거) → skipped', () => {
    expect(stepFromLedgerReason('free-verified: isFreeCoupon')).toBe(STEP.SKIPPED);
    expect(stepFromLedgerReason('free-verified: ai-coupon')).toBe(STEP.SKIPPED);
    expect(stepFromLedgerReason('free-verified: isFreeOrder')).toBe(STEP.SKIPPED);
  });

  it('관리자·테스트 주문 → skipped', () => {
    expect(stepFromLedgerReason('admin-or-test-order')).toBe(STEP.SKIPPED);
  });

  it('게스트 결제 → skipped (적립 대상 아님)', () => {
    expect(stepFromLedgerReason('no-verified-uid (guest checkout)')).toBe(STEP.SKIPPED);
  });

  it('🔴 유료 예약 금액 오류 → failed_permanent (무료 아님)', () => {
    expect(stepFromLedgerReason('invalid-amount')).toBe(STEP.FAILED_PERMANENT);
    expect(stepFromLedgerReason('invalid-amount')).not.toBe(STEP.SKIPPED);
  });

  it('🔴 orderID 없음 → failed_permanent', () => {
    expect(stepFromLedgerReason('no-orderID')).toBe(STEP.FAILED_PERMANENT);
    expect(stepFromLedgerReason('no-orderID')).not.toBe(STEP.SKIPPED);
  });

  it('결제 검증·captureID 누락 → failed_permanent', () => {
    expect(stepFromLedgerReason('payment-not-verified')).toBe(STEP.FAILED_PERMANENT);
    expect(stepFromLedgerReason('no-captureID')).toBe(STEP.FAILED_PERMANENT);
  });

  it('일시적 조회 실패는 retryable 로 남는다', () => {
    expect(stepFromLedgerReason('firestore-unavailable')).toBe(STEP.RETRYABLE);
    expect(stepFromLedgerReason('lookup-failed: timeout')).toBe(STEP.RETRYABLE);
    expect(stepFromLedgerReason('booking-not-found')).toBe(STEP.RETRYABLE);
  });

  it('🔴 시트·메일이 성공해도 금액 오류면 전체 completed 가 아니다', () => {
    expect(overallOutcome({
      sheets: STEP.COMPLETED, email: STEP.COMPLETED,
      loyalty: stepFromLedgerReason('invalid-amount'),
    })).toBe(OUTCOME.FAILED_PERMANENT);
  });

  it('명시적 무료면 전체가 정상 완료된다', () => {
    expect(overallOutcome({
      sheets: STEP.COMPLETED, email: STEP.COMPLETED,
      loyalty: stepFromLedgerReason('free-verified: isFreeCoupon'),
    })).toBe(OUTCOME.COMPLETED);
  });

  it('readVerifiedLedgerBasis 가 서버 근거로만 무료를 판정한다', () => {
    const src = read('api/booking-processor.js');
    expect(src).toContain("d.isFreeCoupon === true");
    expect(src).toContain("d.paymentSource === 'ai-coupon'");
    expect(src).toContain("free-verified");
    // 금액 검사가 uid 검사보다 먼저여야 게스트 결제에서 금액 오류가 가려지지 않는다.
    const amountIdx = src.indexOf("reason: 'invalid-amount'");
    const uidIdx = src.indexOf("no-verified-uid (guest checkout)");
    expect(amountIdx).toBeGreaterThan(-1);
    expect(uidIdx).toBeGreaterThan(amountIdx);
  });
});
