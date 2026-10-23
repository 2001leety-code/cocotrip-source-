/**
 * 예약 후처리 상태 판정 (2026-10-23, PR-4 — 정산 대조 "재전송 후보" 오탐 제거, Astra 명세 검토 r1 반영).
 *
 * 이전: admin-scan-suspect-bookings 가 기간 안 CONFIRMED 중 replayedAt 없는 건을 **전부** 후보로 잡았다
 *   → 정상 원발송 예약도 "재전송 후보" 로 나열되고 일괄 재전송 대상이 됐다.
 *
 * 판정 입력 = 실제로 저장되는 것만:
 *   - 예약 문서 마커(booking-idempotency.js BOOKING_STEP_MARKERS) + `${field}State`('in_progress'|'completed'|'outcome_unknown')
 *   - 확실한 메일 실패 흔적 voucherFailedAt/voucherError (처리기는 마커를 지우고 이 둘을 남긴다 — 'failed' 상태값은 없다)
 *   - 재시도 문서 pending_processor_retries/{id} 의 status·stepStatus(processor-outcome.js STEP) — 정상 생략(skipped) 근거
 *
 * 필수 단계 = processor-outcome.js REQUIRED_STEPS(sheets·email·loyalty). email 은 voucher 발송과 같은 단계·같은 마커다.
 *   텔레그램은 부가 기능 — `telegram` 으로 따로 보여 줄 뿐 판정에 넣지 않는다(마커가 생기기 전 예약은 기록이 없다).
 *
 * 단계별 근거 — **현재 완료 증거가 먼저**다(뒤에 성공해도 과거 voucherFailedAt 은 남는다):
 *   complete  마커 완료 · 재시도 문서가 completed/skipped(정상 생략) · 재시도 문서 done · 적립 대상 아님(게스트·서버 근거 무료)
 *   unknown   outcome_unknown · 만료된 메일 선점(quarantine — 보냈을 수 있다) · 재시도 문서 outcome_unknown/failed_permanent
 *   inflight  STEP_CLAIM_STALE_MS 안의 선점 = 지금 다른 실행이 처리 중
 *   failed    만료된 시트·적립 선점(reclaim — 외부 멱등 키가 있어 재실행 안전) · voucherFailedAt(확실 미발송) · 재시도 문서 retryable
 *   absent    아무 근거 없음
 *
 * 예약 판정(우선순위 순):
 *   test     명시적 테스트 신호 → 후보 아님
 *   complete replayedAt(관리자 재처리가 의미상 완료) 또는 필수 단계 전부 complete → 후보 아님
 *   unknown  어느 단계든 unknown, 또는 24h 지나도 근거가 없는 단계(absent) → 나열만, 자동 재전송 금지(수신 확인 필요)
 *            예약번호(bookingRef)는 처리기 호출 **전에** 저장되므로 "처리됨" 근거가 아니다.
 *   pending  처리 중 선점(inflight) 또는 생성 24h 안인데 근거 없음 → 후보 아님(아직 처리 중일 수 있다)
 *   failed   확실히 안 끝났고 다시 실행해도 안전 → 후보, 일괄 재전송 대상
 *
 * 순수 함수 — 읽기만 한다.
 */
import { BOOKING_STEP_MARKERS, STEP_CLAIM_STALE_MS, STEP_ZOMBIE_POLICY, isStepCompleted, stepStateField } from './booking-idempotency.js';
import { STEP, REQUIRED_STEPS, RETRY_DOC_STATUS } from './processor-outcome.js';
import { hasExplicitTestSignal } from './booking-test-flags.js';

/** 이 시간 안의 예약은 근거가 없어도 "처리 중일 수 있다" 로 본다. */
export const NOTIFICATION_PENDING_GRACE_MS = 24 * 60 * 60 * 1000;

/** 필수 단계 이름(processor-outcome) → 예약 문서 마커 필드. */
const REQUIRED_STEP_FIELDS = {
  sheets: BOOKING_STEP_MARKERS.sheets,
  email: BOOKING_STEP_MARKERS.voucher,
  loyalty: BOOKING_STEP_MARKERS.loyalty,
};

/** Firestore Timestamp | epoch ms | Date | ISO | {_seconds} → epoch ms (없으면 0). */
function toMillis(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.toDate === 'function') return v.toDate().getTime();
  if (v instanceof Date) return v.getTime();
  if (typeof v._seconds === 'number') return v._seconds * 1000;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : 0;
}

/** 마커 근거: { status: 'complete'|'unknown'|'inflight'|'failed'|'absent', reason? } */
function markerStatus(b, field, nowMs) {
  if (isStepCompleted(b, field)) return { status: 'complete' };
  const sf = stepStateField(field);
  const state = b[sf];
  if (state === 'outcome_unknown') return { status: 'unknown', reason: String(b[`${sf}UnknownReason`] || 'outcome_unknown') };
  if (state === 'in_progress') {
    const startedMs = Number(b[`${sf}At`]) || 0;
    if (startedMs && nowMs - startedMs < STEP_CLAIM_STALE_MS) return { status: 'inflight', reason: 'in_progress' };
    return (STEP_ZOMBIE_POLICY[field] || 'quarantine') === 'reclaim'
      ? { status: 'failed', reason: 'claim_expired' }
      : { status: 'unknown', reason: 'claim_expired_without_completion' };
  }
  return { status: 'absent' };
}

/**
 * 적립이 애초에 대상이 아닌가 — booking-processor readVerifiedLedgerBasis 의 **정상 제외** 분기와 같은 근거만.
 * (결제 미검증·금액 이상 등은 제외가 아니라 실패다 → 여기서 true 로 만들지 않는다.)
 */
function loyaltyNotApplicable(b) {
  if (b.isFreeCoupon === true || b.paymentSource === 'ai-coupon' || b.isFreeOrder === true || b.freeReason) return true;
  const amountUSD = Number(b.amountUSD);
  return b.paymentVerified === true && Boolean(b.captureID) && Number.isFinite(amountUSD) && amountUSD > 0 && !b.uid;
}

function requiredStepStatus(name, b, retry, nowMs) {
  const m = markerStatus(b, REQUIRED_STEP_FIELDS[name], nowMs);
  if (m.status !== 'absent') return m; // 현재 마커가 먼저
  if (retry && retry.status === RETRY_DOC_STATUS.DONE) return { status: 'complete' };
  const rs = retry && retry.stepStatus ? retry.stepStatus[name] : undefined;
  if (rs === STEP.COMPLETED || rs === STEP.SKIPPED) return { status: 'complete' };
  if (rs === STEP.OUTCOME_UNKNOWN) return { status: 'unknown', reason: 'retry_outcome_unknown' };
  if (rs === STEP.FAILED_PERMANENT) return { status: 'unknown', reason: 'failed_permanent' };
  if (rs === STEP.RETRYABLE) return { status: 'failed', reason: String((retry && retry.lastFailureReason) || 'retryable').slice(0, 200) };
  if (name === 'email' && (b.voucherFailedAt || b.voucherError)) {
    return { status: 'failed', reason: String(b.voucherError || 'voucher_failed').slice(0, 200) };
  }
  if (name === 'loyalty' && loyaltyNotApplicable(b)) return { status: 'complete' };
  return { status: 'absent' };
}

/** 텔레그램 2채널 요약 — 표시용(판정에 넣지 않는다). */
function telegramSummary(b, nowMs) {
  const st = [BOOKING_STEP_MARKERS.telegramDispatch, BOOKING_STEP_MARKERS.telegramPayment].map((f) => markerStatus(b, f, nowMs).status);
  if (st.every((s) => s === 'complete')) return 'complete';
  if (st.includes('unknown')) return 'unknown';
  if (st.includes('inflight')) return 'inflight';
  return 'missing'; // 기록 없음(마커 이전 예약 포함) 또는 거부·미설정으로 해제됨
}

/**
 * @param {object} booking    bookings/{id} 문서 데이터
 * @param {number} [nowMs]
 * @param {string} [bookingId] 문서 id — 테스트 신호(ADMIN-BYPASS-/TEST- 접두) 판정용
 * @param {object|null} [retryDoc] pending_processor_retries/{id} 문서 데이터(없으면 null)
 * @returns {{ state: 'complete'|'failed'|'unknown'|'pending'|'test', missingSteps: string[], lastFailureReason: string|null,
 *   telegram: 'complete'|'unknown'|'inflight'|'missing' }}
 */
export function classifyBookingNotificationState(booking, nowMs = Date.now(), bookingId = '', retryDoc = null) {
  const b = booking || {};
  const telegram = telegramSummary(b, nowMs);
  const verdict = (state, missingSteps = [], lastFailureReason = null) => ({ state, missingSteps, lastFailureReason, telegram });
  if (hasExplicitTestSignal(bookingId, b)) return verdict('test');
  if (b.replayedAt) return verdict('complete');

  const createdMs = toMillis(b.createdAt);
  const young = createdMs > 0 && nowMs - createdMs < NOTIFICATION_PENDING_GRACE_MS;
  const steps = REQUIRED_STEPS.map((name) => ({ name, ...requiredStepStatus(name, b, retryDoc, nowMs) }));
  const missing = steps.filter((s) => s.status !== 'complete').map((s) => s.name);
  const first = (status) => steps.find((s) => s.status === status);

  const unknown = first('unknown');
  if (unknown) return verdict('unknown', missing, unknown.reason);
  if (!young && first('absent')) return verdict('unknown', missing, 'no_completion_record_after_24h');
  const inflight = first('inflight');
  if (inflight) return verdict('pending', missing, inflight.reason);
  const failed = first('failed');
  if (failed) return verdict('failed', missing, failed.reason);
  if (first('absent')) return verdict('pending', missing);
  return verdict('complete');
}
