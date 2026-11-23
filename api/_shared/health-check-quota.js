/**
 * 자동 검사 역할(roles:['health-check'])의 하루 호출 상한 (2026-11-22, 운영자 결정 3).
 *
 * 왜: 이 역할은 ai-planner-full(자동 검사 주문번호)·mood-parse-schedule 을 부를 수 있다. x-llm-mock 을 빼고
 *   부르면 실제 AI 호출이라, GitHub secrets 가 새면 AI 비용이 끝없이 나갈 수 있다.
 *
 * 상한 근거 (GitHub 실행 기록 실측, 2026-05~11): 검사들이 하루에 부른 횟수 최대 = 80회
 *   (2026-10-26 UTC — daily-health 5회 × (플래너 5 + 회귀 1 + e2e 최대 3[재시도 2] + MOOD 파싱 1)
 *    + scenario-matrix 5회 × 6). 그 2배 = 160.
 *
 * 세는 곳: admin_bypass_audit 의 역할 문서(via == 'health-check-role'). 하루 = KST 날짜 칸 healthCheckDay
 *   하나의 같음 비교로 센다 — 칸 하나 비교라 새 복합 색인(firestore.indexes.json 배포)이 필요 없다.
 * 셀 수 없으면(DB 없음·읽기 실패) 거절한다 — 비용 막이라 열어 두는 쪽이 위험하다.
 */
export const HEALTH_CHECK_DAILY_LIMIT = 160;
const AUDIT_COLLECTION = 'admin_bypass_audit';

/** KST 날짜 'YYYY-MM-DD'. */
export function healthCheckDayKST(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * 오늘 상한 안이면 감사 문서를 하나 쓰고 ok. 넘었거나 셀 수 없으면 거절.
 * ponytail: 세기→쓰기가 원자적이지 않다 — 동시에 몰리면 몇 건 넘칠 수 있다. 비용 막이로는 충분.
 * @returns {Promise<{ ok: true } | { ok: false, reason: 'DAILY_LIMIT' | 'NO_DB' | 'COUNT_FAILED' }>}
 */
export async function claimHealthCheckQuota(db, { route, orderId = null, email = '' }, now = new Date()) {
  if (!db) return { ok: false, reason: 'NO_DB' };
  const day = healthCheckDayKST(now);
  const col = db.collection(AUDIT_COLLECTION);
  try {
    const snap = await col.where('healthCheckDay', '==', day).count().get();
    if ((snap.data().count || 0) >= HEALTH_CHECK_DAILY_LIMIT) return { ok: false, reason: 'DAILY_LIMIT' };
    await col.add({
      adminEmail: email,
      orderId: orderId || null,
      route,
      via: 'health-check-role',
      healthCheckDay: day,
      bypassedAt: now.toISOString(),
    });
    return { ok: true };
  } catch (e) {
    console.warn('[health-check-quota] count/write failed:', e && e.message);
    return { ok: false, reason: 'COUNT_FAILED' };
  }
}

/** 거절 이유 → HTTP 상태·코드. */
export function quotaRejection(reason) {
  return reason === 'DAILY_LIMIT'
    ? { status: 429, code: 'HEALTH_CHECK_DAILY_LIMIT', message: `Automated-check account daily limit reached (${HEALTH_CHECK_DAILY_LIMIT}/day KST)` }
    : { status: 503, code: 'HEALTH_CHECK_QUOTA_UNAVAILABLE', message: 'Automated-check quota could not be checked' };
}
