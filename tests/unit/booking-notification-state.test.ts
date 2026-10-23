/**
 * classifyBookingNotificationState (2026-10-23, PR-4 + Astra 명세 검토 r1) — 정산 대조 "재전송 후보" 판정 표.
 * 잠그는 것(실제 저장 필드만):
 *   필수 단계 = sheets·email(voucher 마커)·loyalty. 텔레그램은 별도 표시(판정 밖).
 *   정상 원발송·게스트/무료 적립 제외·재시도 문서의 정상 생략(skipped)·재시도 문서 done → complete.
 *   현재 완료 증거 우선(과거 voucherFailedAt 이 남아도 지금 완료면 complete).
 *   레거시 bookingRef 규칙 없음 — 오래된 근거 부재는 unknown, 최근 무기록·처리 중 선점은 pending(둘 다 자동 재전송 금지).
 *   확실한 실패(voucherFailedAt·만료 reclaim 선점·재시도 retryable) → failed. outcome_unknown·만료 메일 선점·failed_permanent → unknown.
 *   5분 선점 경계·24h 생성 경계·미상/실패 혼합 우선순위.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyBookingNotificationState, NOTIFICATION_PENDING_GRACE_MS,
} from '../../api/_shared/booking-notification-state.js';
import { STEP_CLAIM_STALE_MS } from '../../api/_shared/booking-idempotency.js';

const NOW = Date.UTC(2026, 9, 23, 12, 0, 0);
const HOUR = 60 * 60 * 1000;
const OLD = new Date(NOW - 30 * HOUR).toISOString(); // 24h 지남
const FRESH = new Date(NOW - 1 * HOUR).toISOString(); // 24h 안

const done = (field: string) => ({ [field]: NOW - 2 * HOUR, [`${field}State`]: 'completed' });
const claim = (field: string, ageMs: number) => ({ [`${field}State`]: 'in_progress', [`${field}StateAt`]: NOW - ageMs });
const SHEETS = done('sheetsAppendedAt');
const EMAIL = done('voucherSentAt');
const LOYALTY = done('loyaltyEarnedAt');
const TELEGRAM = { ...done('telegramDispatchSentAt'), ...done('telegramPaymentSentAt') };
/** 회원 유료 예약(적립 대상). */
const member = (over: Record<string, unknown> = {}) => ({
  status: 'CONFIRMED', bookingRef: 'CT-20261022-001', paypalEnvironment: 'live', createdAt: OLD,
  uid: 'u1', paymentVerified: true, captureID: 'CAP-1', amountUSD: '100.00', ...over,
});
/** 게스트 유료 예약(적립 대상 아님 — 처리기 readVerifiedLedgerBasis 의 정상 제외와 같은 근거). */
const guest = (over: Record<string, unknown> = {}) => member({ uid: null, ...over });
const classify = (b: Record<string, unknown> | null, retry: Record<string, unknown> | null = null, id = 'ORD-1') =>
  classifyBookingNotificationState(b, NOW, id, retry);

type Case = [string, Record<string, unknown>, Record<string, unknown> | null, string, string[]?, string?];

describe('classifyBookingNotificationState — table', () => {
  const cases: Case[] = [
    // ── complete (후보 아님) ──
    ['normal original send (member: sheets·email·loyalty completed)', member({ ...SHEETS, ...EMAIL, ...LOYALTY, ...TELEGRAM }), null, 'complete', []],
    ['guest: no loyalty marker is a normal skip', guest({ ...SHEETS, ...EMAIL }), null, 'complete', []],
    ['free coupon member: loyalty not applicable (server evidence)', member({ ...SHEETS, ...EMAIL, isFreeCoupon: true }), null, 'complete'],
    ['ai-coupon member: loyalty not applicable', member({ ...SHEETS, ...EMAIL, paymentSource: 'ai-coupon' }), null, 'complete'],
    ['sheets env not configured — retry doc stepStatus skipped', guest({ ...EMAIL }), { status: 'pending', stepStatus: { sheets: 'skipped_not_applicable' } }, 'complete'],
    ['retry doc status done (processor finished)', guest({}), { status: 'done', outcome: 'completed' }, 'complete'],
    ['existing sheets/voucher done + no telegram markers (pre-telegram era) is not a failure', guest({ ...SHEETS, ...EMAIL }), null, 'complete'],
    ['old voucherFailedAt but voucher completed now — current completion wins', guest({ ...SHEETS, ...EMAIL, voucherFailedAt: NOW - 20 * HOUR, voucherError: 'Invalid login' }), null, 'complete'],
    ['legacy timestamps without State', guest({ sheetsAppendedAt: NOW - 50 * HOUR, voucherSentAt: NOW - 50 * HOUR }), null, 'complete'],
    ['replayedAt (admin replay finished as done)', guest({ replayedAt: NOW - HOUR }), null, 'complete'],
    // ── pending (후보 아님, 자동 재전송 금지) ──
    ['no markers, created 1h ago', guest({ createdAt: FRESH }), null, 'pending', ['sheets', 'email']],
    ['email claim in progress (< 5 min) — processor running now', guest({ ...SHEETS, ...claim('voucherSentAt', 30_000) }), null, 'pending', ['email'], 'in_progress'],
    ['in-flight beats failed (do not race the running processor)', guest({ ...claim('voucherSentAt', 1_000), ...claim('sheetsAppendedAt', STEP_CLAIM_STALE_MS + 1) }), null, 'pending'],
    // ── unknown (나열만 — 수신 확인 필요) ──
    ['bookingRef only, no markers, 24h+ (bookingRef is saved before the processor runs)', guest({}), null, 'unknown', ['sheets', 'email'], 'no_completion_record_after_24h'],
    ['legacy partial markers: sheets done, email absent after 24h', guest({ ...SHEETS }), null, 'unknown', ['email'], 'no_completion_record_after_24h'],
    ['member paid booking without loyalty record after 24h', member({ ...SHEETS, ...EMAIL }), null, 'unknown', ['loyalty']],
    ['voucher outcome_unknown', guest({ ...SHEETS, voucherSentAtState: 'outcome_unknown', voucherSentAtStateUnknownReason: 'send_result_unknown: ETIMEDOUT' }), null, 'unknown', ['email'], 'send_result_unknown: ETIMEDOUT'],
    ['stale email claim (quarantine) — may have been sent', guest({ ...SHEETS, ...claim('voucherSentAt', STEP_CLAIM_STALE_MS) }), null, 'unknown', ['email'], 'claim_expired_without_completion'],
    ['retry doc: email outcome_unknown', guest({ ...SHEETS }), { status: 'manual-intervention', stepStatus: { email: 'outcome_unknown' } }, 'unknown', ['email'], 'retry_outcome_unknown'],
    ['retry doc: loyalty failed_permanent (retry will not fix it)', member({ ...SHEETS, ...EMAIL }), { status: 'permanent-failure', stepStatus: { loyalty: 'failed_permanent' } }, 'unknown', ['loyalty'], 'failed_permanent'],
    ['unknown + failed mixed → unknown (no automatic replay)', guest({ voucherSentAtState: 'outcome_unknown', ...claim('sheetsAppendedAt', STEP_CLAIM_STALE_MS) }), null, 'unknown', ['sheets', 'email']],
    ['old absent step + failed step → unknown (replay could resend an unproven email)', guest({ ...claim('sheetsAppendedAt', STEP_CLAIM_STALE_MS) }), null, 'unknown', ['sheets', 'email']],
    // ── failed (후보, 일괄 재처리 대상) ──
    ['email failed for sure (marker released + voucherFailedAt)', guest({ ...SHEETS, voucherFailedAt: NOW - 3 * HOUR, voucherError: 'Invalid login: 535' }), null, 'failed', ['email'], 'Invalid login: 535'],
    ['stale sheets claim (reclaim policy — safe to re-run)', guest({ ...EMAIL, ...claim('sheetsAppendedAt', STEP_CLAIM_STALE_MS) }), null, 'failed', ['sheets'], 'claim_expired'],
    ['retry doc: sheets retryable', guest({ ...EMAIL }), { status: 'pending', stepStatus: { sheets: 'retryable' }, lastFailureReason: 'sheets 503' }, 'failed', ['sheets'], 'sheets 503'],
    ['young absent + failed → failed (an unclaimed email was never sent)', guest({ createdAt: FRESH, ...claim('sheetsAppendedAt', STEP_CLAIM_STALE_MS) }), null, 'failed', ['sheets', 'email']],
    // ── test (후보 아님) ──
    ['sandbox payment', guest({ paypalEnvironment: 'sandbox' }), null, 'test'],
    ['admin-bypass payment', guest({ paymentMethod: 'admin-bypass' }), null, 'test'],
  ];
  for (const [label, booking, retry, state, missingSteps, reason] of cases) {
    it(`${label} → ${state}`, () => {
      const v = classify(booking, retry);
      expect(v.state).toBe(state);
      if (missingSteps) expect(v.missingSteps).toEqual(missingSteps);
      if (reason) expect(v.lastFailureReason).toBe(reason);
    });
  }

  // Astra 코드 리뷰 r1 P1 — 유료 AI 상품: 적립 마커 완료 뒤 AI 구매 혜택 실패 → 처리기가 loyalty='retryable' 로 남긴다.
  describe('paid AI planner: benefit failure after the loyalty marker', () => {
    const ai = (over: Record<string, unknown> = {}) => member({ productType: 'ai_planner_full', ...SHEETS, ...EMAIL, ...LOYALTY, ...over });
    const openRetry = { status: 'pending', stepStatus: { sheets: 'completed', email: 'completed', loyalty: 'retryable' } };

    it('three markers completed + open retry doc loyalty retryable → failed (ai_benefit_retryable)', () => {
      expect(classify(ai(), openRetry)).toMatchObject({ state: 'failed', missingSteps: ['loyalty'], lastFailureReason: 'ai_benefit_retryable' });
    });
    it('retry doc closed (done) → complete', () => {
      expect(classify(ai(), { ...openRetry, status: 'done' }).state).toBe('complete');
    });
    it('non-AI product with the same retry doc → the completed loyalty marker still wins', () => {
      expect(classify(ai({ productType: 'tour_gyeongbok' }), openRetry).state).toBe('complete');
    });
    it('free AI coupon (no benefit to grant) → complete', () => {
      expect(classify(ai({ isFreeCoupon: true }), openRetry).state).toBe('complete');
    });
  });

  it('ADMIN-BYPASS- / TEST- document id → test', () => {
    expect(classify(guest({}), null, 'ADMIN-BYPASS-123').state).toBe('test');
    expect(classify(guest({}), null, 'TEST-9').state).toBe('test');
  });

  it('5-minute claim boundary: STALE-1ms = in flight (pending), STALE = expired', () => {
    expect(classify(guest({ ...EMAIL, ...claim('sheetsAppendedAt', STEP_CLAIM_STALE_MS - 1) })).state).toBe('pending');
    expect(classify(guest({ ...EMAIL, ...claim('sheetsAppendedAt', STEP_CLAIM_STALE_MS) })).state).toBe('failed');
    expect(classify(guest({ ...SHEETS, ...claim('voucherSentAt', STEP_CLAIM_STALE_MS - 1) })).state).toBe('pending');
    expect(classify(guest({ ...SHEETS, ...claim('voucherSentAt', STEP_CLAIM_STALE_MS) })).state).toBe('unknown');
  });

  it('24h creation boundary across createdAt formats (Timestamp-like, {_seconds}, ms, ISO)', () => {
    const at = (ms: number) => [{ toMillis: () => ms }, { toDate: () => new Date(ms) }, { _seconds: ms / 1000 }, ms, new Date(ms).toISOString()];
    for (const createdAt of at(NOW - NOTIFICATION_PENDING_GRACE_MS + 1000)) {
      expect(classify(guest({ createdAt })).state).toBe('pending');
    }
    for (const createdAt of at(NOW - NOTIFICATION_PENDING_GRACE_MS)) {
      expect(classify(guest({ createdAt })).state).toBe('unknown');
    }
  });

  it('telegram is reported separately and never changes the verdict', () => {
    expect(classify(guest({ ...SHEETS, ...EMAIL, ...TELEGRAM }))).toMatchObject({ state: 'complete', telegram: 'complete' });
    expect(classify(guest({ ...SHEETS, ...EMAIL }))).toMatchObject({ state: 'complete', telegram: 'missing' });
    expect(classify(guest({ ...SHEETS, ...EMAIL, telegramPaymentSentAtState: 'outcome_unknown' }))).toMatchObject({ state: 'complete', telegram: 'unknown' });
  });

  it('missing booking / missing createdAt never throws and is never "complete"', () => {
    expect(classify(null).state).toBe('unknown');
    expect(classify(guest({ createdAt: undefined })).state).toBe('unknown');
  });
});
