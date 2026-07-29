/**
 * booking-processor 의 **의미상 성공 계약** (2026-07-29).
 *
 * 🔴 이전 구조: 내부 단계가 실패하거나 재시도 대기여도 **항상 HTTP 200 + ok:true** 였다.
 *   그래서 trigger·retry cron·관리자 재처리가 전부 실패를 성공으로 기록했다.
 *     · retry 문서가 done 으로 닫히고 → 시트 행도 메일도 적립도 없는 예약이 조용히 남는다
 *     · admin-scan 이 replayedAt 을 찍어 → 다시는 재처리 대상이 되지 않는다
 *   "호출이 200 이었다" 와 "일이 실제로 끝났다" 는 다른 이야기다.
 *
 * 그래서 단계마다 **다음 행동이 정해지는** 상태를 붙인다:
 *
 *   completed               끝났다. 또는 외부 멱등 키로 이미 끝난 것을 확인했다.
 *   retryable               자동 재시도가 필요하고, 재시도가 안전하다.
 *   outcome_unknown         됐는지 알 수 없다. **자동 재실행 금지**, 사람이 확인한다.
 *   skipped_not_applicable  애초에 할 일이 아니었다(무료·관리자·게스트·env 미설정).
 *   failed_permanent        자동 재시도로는 안 된다. 설정·데이터를 고쳐야 한다.
 */

export const STEP = {
  COMPLETED: 'completed',
  RETRYABLE: 'retryable',
  OUTCOME_UNKNOWN: 'outcome_unknown',
  SKIPPED: 'skipped_not_applicable',
  FAILED_PERMANENT: 'failed_permanent',
};

/** 이 셋이 끝나야 예약 처리가 끝난 것이다. 텔레그램·PDF·지갑은 부가 기능이라 제외. */
export const REQUIRED_STEPS = ['sheets', 'email', 'loyalty'];

export const OUTCOME = {
  COMPLETED: 'completed',
  RETRYABLE: 'retryable',
  MANUAL: 'manual_intervention',
  FAILED_PERMANENT: 'failed_permanent',
};

/**
 * 필수 단계 상태들 → 전체 판정.
 *
 * 우선순위에 이유가 있다:
 *   retryable 이 하나라도 있으면 재시도를 계속해야 하므로 **retryable 이 이긴다**.
 *   (재시도해도 outcome_unknown 단계는 다시 건드리지 않는다 — 선점 정책이 막는다.
 *    그래서 재시도를 반복하면 retryable 이 사라지고 manual 로 수렴한다.)
 */
export function overallOutcome(stepStatus) {
  const vals = REQUIRED_STEPS.map((k) => (stepStatus || {})[k]).filter(Boolean);
  if (vals.length === 0) return OUTCOME.RETRYABLE;   // 아무것도 기록 안 됨 = 판단 불가
  if (vals.includes(STEP.RETRYABLE)) return OUTCOME.RETRYABLE;
  if (vals.includes(STEP.OUTCOME_UNKNOWN)) return OUTCOME.MANUAL;
  if (vals.includes(STEP.FAILED_PERMANENT)) return OUTCOME.FAILED_PERMANENT;
  return OUTCOME.COMPLETED;
}

/** retry 문서를 done 으로 닫아도 되는가? — 실제로 끝났을 때만. */
export function isSemanticallyDone(outcome) {
  return outcome === OUTCOME.COMPLETED;
}

/** 자동 재시도를 계속해야 하는가? */
export function shouldRetry(outcome) {
  return outcome === OUTCOME.RETRYABLE;
}

/** 사람이 봐야 하는가? (자동 재실행 금지) — 영구 실패도 자동 재시도 대상이 아니다. */
export function needsManualIntervention(outcome) {
  return outcome === OUTCOME.MANUAL || outcome === OUTCOME.FAILED_PERMANENT;
}

/** retry 문서에 저장할 status. */
export const RETRY_DOC_STATUS = {
  PENDING: 'pending',
  MANUAL: 'manual-intervention',
  PERMANENT: 'permanent-failure',
  DONE: 'done',
};

/**
 * outcome → retry 문서 status.
 *
 * 🔴 이전에는 completed 가 아닌 **모든** 결과를 'pending' 으로 저장했다. 그래서
 *   manual_intervention 도 다음 cron 이 한 번 더 실행했고(중복 발송 위험),
 *   failed_permanent 도 최대 재시도 횟수까지 불필요하게 반복됐다.
 *   보고서의 "outcome_unknown 은 즉시 manual" 과 실제 저장 상태가 달랐다.
 */
export function retryDocStatusFor(outcome) {
  if (outcome === OUTCOME.COMPLETED) return RETRY_DOC_STATUS.DONE;
  if (outcome === OUTCOME.MANUAL) return RETRY_DOC_STATUS.MANUAL;
  if (outcome === OUTCOME.FAILED_PERMANENT) return RETRY_DOC_STATUS.PERMANENT;
  return RETRY_DOC_STATUS.PENDING;
}

/** 이 status 의 문서를 cron 이 다시 실행해도 되는가? */
export function isAutoRetryableStatus(status) {
  return status === RETRY_DOC_STATUS.PENDING;
}

/** 선점 실패 사유 → 단계 상태. */
export function stepFromClaimReason(reason) {
  switch (reason) {
    case 'already_completed': return STEP.COMPLETED;
    case 'in_flight':         return STEP.RETRYABLE;      // 다른 실행이 끝낼 때까지 큐 유지
    case 'outcome_unknown':   return STEP.OUTCOME_UNKNOWN;
    case 'store_unavailable': return STEP.RETRYABLE;
    default:                  return STEP.RETRYABLE;
  }
}

/** finalizeStep 결과 → 단계 상태. */
export function stepFromFinalize(state) {
  if (state === 'completed') return STEP.COMPLETED;
  if (state === 'outcome_unknown') return STEP.OUTCOME_UNKNOWN;
  return STEP.RETRYABLE;   // 'retry' — 외부 멱등 키가 있어 재실행이 안전한 단계
}

/** 적립 자격 판정(readVerifiedLedgerBasis) 사유 → 단계 상태. */
export function stepFromLedgerReason(reason) {
  const r = String(reason || '');

  // ── 정상 제외 — 애초에 적립 대상이 아니다. **서버 근거가 있는 것만.** ──
  if (r.startsWith('admin-or-test-order')) return STEP.SKIPPED;   // 명시적 관리자·테스트 주문
  if (r.startsWith('free-verified')) return STEP.SKIPPED;         // 서버가 확인한 무료(쿠폰·무료상품)
  if (r.startsWith('no-verified-uid')) return STEP.SKIPPED;       // 게스트 결제 = 적립 대상 아님
  if (r.startsWith('fully-refunded-or-canceled')) return STEP.SKIPPED;

  // ── 일시적 — 다시 보면 달라질 수 있다. ──
  if (r.startsWith('firestore-unavailable')) return STEP.RETRYABLE;
  if (r.startsWith('lookup-failed')) return STEP.RETRYABLE;
  if (r.startsWith('booking-not-found')) return STEP.RETRYABLE;   // 문서가 늦게 생길 수 있다

  // ── 그 외는 전부 데이터·설정을 고쳐야 하는 오류다. ──
  // 🔴 invalid-amount(NaN·0·음수·누락)와 no-orderID 를 예전엔 skipped 로 분류했다.
  //   유료 예약의 금액이 깨져도 "무료라 적립 제외" 로 보여 전체가 completed 로 닫혔다.
  //   무료라는 서버 근거가 없으면 0원도 오류다.
  return STEP.FAILED_PERMANENT;   // invalid-amount / no-orderID / payment-not-verified / no-captureID
}

/** 내부 loyalty API 응답 코드 → 단계 상태. */
export function stepFromLoyaltyHttp(status) {
  const n = Number(status);
  if (n >= 200 && n < 300) return STEP.COMPLETED;
  if (n === 401 || n === 403) return STEP.RETRYABLE;   // 토큰 미설정/전파 지연 — 설정 후 재시도로 복구
  if (n >= 500) return STEP.RETRYABLE;
  if (n === 429) return STEP.RETRYABLE;
  return STEP.FAILED_PERMANENT;                        // 그 외 4xx = 요청 자체가 틀렸다
}

/**
 * booking-processor 응답 본문에서 최종 상태를 읽는다.
 * 🔴 HTTP 상태만 보면 안 된다 — 200 + 내부 실패가 이 계약의 존재 이유다.
 */
export function outcomeFromResponseBody(body) {
  const o = body && (body.outcome || (body.data && body.data.outcome));
  if (o === OUTCOME.COMPLETED || o === OUTCOME.RETRYABLE
      || o === OUTCOME.MANUAL || o === OUTCOME.FAILED_PERMANENT) {
    return o;
  }
  // 계약 이전 버전이 응답했거나 본문을 못 읽었다 → 성공으로 단정하지 않는다.
  return OUTCOME.RETRYABLE;
}

/**
 * SMTP 오류가 "확실히 안 나갔다" 인지 "나갔는지 모른다" 인지 가른다.
 *
 * 확실히 안 나감 — 연결 자체를 못 맺음(EAUTH/ECONNECTION/EENVELOPE/EDNS) → 재발송 안전.
 * 알 수 없음   — 타임아웃·소켓 끊김은 **DATA 를 이미 보낸 뒤**일 수 있다. 재발송하면 중복.
 *   SMTP 에는 멱등 키가 없어서 서버가 이미 받았는지 확인할 방법이 없다.
 */
export function isAmbiguousSendError(err) {
  // _send-email.js 가 "SMTP 에 넘기기 전 실패" 에 preSend 를 붙인다 (env 미설정·일일 한도).
  if (err && err.preSend === true) return false;
  const code = String((err && err.code) || '').toUpperCase();
  // 연결·인증·수신자 거절 — SMTP 서버가 본문을 받기 전에 끝난 실패다.
  const CERTAIN_FAILURES = new Set(['EAUTH', 'ECONNECTION', 'EENVELOPE', 'EDNS', 'EMESSAGE']);
  if (CERTAIN_FAILURES.has(code)) return false;
  // 그 외(타임아웃·소켓 끊김·정체불명)는 DATA 를 이미 보낸 뒤일 수 있다 → 재발송 금지.
  return true;
}
