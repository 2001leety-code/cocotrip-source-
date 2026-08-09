/**
 * 예산표(Daily Budget Summary) 날짜 라벨 포맷터.
 *
 * 언어별 어순은 사전 템플릿(`planDetail.ui.budgetDayN`, "{n}" 포함)이 결정한다.
 *   en "Day {n}" / ko "{n}일차" / ja "{n}日目" / zh "第{n}天"
 *
 * 라벨과 숫자를 코드에서 이어붙이면(`${label} ${day}`) ja 는 어순이 뒤집히고
 * zh 는 자리표시자가 그대로 노출된다 — 그래서 조립은 여기 한 곳에서만 한다.
 * 순수 함수(firebase/DOM/i18n 런타임 의존 없음) — 웹 표와 PDF 가 같이 쓴다.
 */

/** 사전이 없거나 "{n}" 이 빠진 경우의 폴백 — 절대 라벨+숫자 이어붙이기로 되돌리지 말 것. */
export const BUDGET_DAY_FALLBACK = 'Day {n}';

export function formatBudgetDay(day: number, template?: string): string {
  const tpl = template && template.includes('{n}') ? template : BUDGET_DAY_FALLBACK;
  return tpl.replace(/\{n\}/g, String(day));
}
