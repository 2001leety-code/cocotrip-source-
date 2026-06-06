/**
 * phone-validation — 전화번호 형식 검증 (오타·가짜번호 차단).
 *
 * 배경(2026-06-06 딥서치 검증): 기사 배차 서비스에서 전화는 "이행상 필수" — 노쇼 판정이
 * "약속시간 미출현 AND 예약 번호로 연락 불가"로 정의되므로(Transfeero·Welcome Pickups 약관),
 * 닿는 번호가 없으면 이행 자체가 깨짐. 기존 isTourStep2Complete 는 length>0 만 봐서
 * 오타·가짜번호(글자·너무 짧음)가 그대로 통과 → 기사 연락 불가. 형식 검증으로 차단.
 *
 * 경량(라이브러리 없이 번들 0). 엄격한 국가별 유효성(libphonenumber)은 추후 필요 시.
 */

/**
 * 전화번호 형식 유효 여부 — 명백한 오타(글자·너무 짧음/긺) 차단.
 * - 공백/하이픈/괄호/점 제거 후 검사
 * - 선택적 선행 '+' + 숫자 8~15자리 (E.164 상한 15, 국가코드 포함 하한 ~8)
 * - 국내형(선행 0 포함, 예: 01012345678) 및 국제형(+82…/+44…) 모두 허용
 *   (한국 기사의 도메스틱 콜 + 외국 번호 둘 다 커버)
 * @returns 형식상 유효하면 true
 */
export function isValidInternationalPhone(raw: string): boolean {
  if (typeof raw !== 'string') return false;
  const cleaned = raw.replace(/[\s\-().]/g, '');
  return /^\+?\d{8,15}$/.test(cleaned);
}
