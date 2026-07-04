/**
 * AI 플래너 출발일 검증 — day1 = 오늘 불가 (내일 이후만).
 * 정책(2026-05-07 운영자): 디지털 상품이지만 오늘 시작은 부적절 — Gemini 가 한국 로컬 정보를
 *   기반으로 최소 익일 출발을 전제로 설계됨. revision(이미 결제된 plan, 날짜 변경 없음)은 skip.
 * P129(2026-06-27): handlerCore orchestrator 500줄 cap 준수 위해 검증 로직 분리.
 * @param {object} body 요청 body
 * @param {boolean} isRevision gate.isRevision
 * @returns {null | {reqStartDate:string, todayKST:string}} reject 사유(있으면 caller 가 400 응답)
 */
export function checkStartDateTooSoon(body, isRevision) {
  if (isRevision) return null;
  const reqStartDate = body?.date || body?.startDate || '';
  if (!reqStartDate || !/^\d{4}-\d{2}-\d{2}$/.test(reqStartDate)) return null;
  // KST(+09:00) 오늘 날짜 계산
  const todayKST = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  if (reqStartDate <= todayKST) return { reqStartDate, todayKST };
  return null;
}
