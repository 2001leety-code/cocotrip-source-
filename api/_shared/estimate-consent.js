/**
 * 추정가(charter_custom_estimate) 결제 전 동의 — **정책 정본** (2026-07-30).
 *
 * 왜 서버가 판정하는가: 동의는 "화면에 체크박스가 있었다" 가 아니라 "이 주문에 대해 어떤
 * 문구에 동의했다" 는 기록이어야 한다. 그래서
 *   - 동의 여부·정책 버전은 서버가 검증하고(fail-closed),
 *   - 시각은 **서버 시계**로 찍는다(클라이언트 시간은 신뢰하지 않는다).
 *
 * 프론트 미러 = `src/lib/estimateConsent.ts`.
 * `tests/unit/estimate-consent-parity.test.ts` 가 두 파일의 상수 동기를 강제한다.
 */

/** 정산 허용 오차(%). */
export const ESTIMATE_RECONCILE_TOLERANCE_PCT = 10;

/** 현재 유효한 동의 문구 버전. 프론트가 이 값과 다른 버전을 보내면 거부한다. */
export const ESTIMATE_POLICY_VERSION = '2026-07-30.reconcile-10pct';

/**
 * 주문 근거로 저장할 동의 레코드를 만든다.
 *
 * @param {unknown} raw 클라이언트가 보낸 `estimateConsent` (형태 불신)
 * @param {Date} [now] 서버 시각 (테스트 주입용)
 * @returns {{ ok: true, record: { agreed: true, policyVersion: string, tolerancePct: number, agreedAtServer: string } }
 *          | { ok: false, code: string, error: string }}
 */
export function buildEstimateConsentRecord(raw, now = new Date()) {
  const c = raw && typeof raw === 'object' ? raw : null;
  if (!c || c.agreed !== true) {
    return {
      ok: false,
      code: 'ESTIMATE_CONSENT_REQUIRED',
      error: '추정가 정산 조건 동의가 필요합니다 (Estimate reconciliation consent required).',
    };
  }
  if (c.policyVersion !== ESTIMATE_POLICY_VERSION) {
    return {
      ok: false,
      code: 'ESTIMATE_CONSENT_STALE',
      error: '안내 문구가 갱신되었습니다. 새로고침 후 다시 확인해주세요 (Consent text updated — please reload).',
    };
  }
  return {
    ok: true,
    record: {
      agreed: true,
      policyVersion: ESTIMATE_POLICY_VERSION,
      tolerancePct: ESTIMATE_RECONCILE_TOLERANCE_PCT,
      // 클라이언트가 보낸 시각은 쓰지 않는다 — 위조·시계 오차 모두 무의미해진다.
      agreedAtServer: now.toISOString(),
    },
  };
}
