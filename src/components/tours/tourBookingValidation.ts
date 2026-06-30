// 투어 예약 Step 2 검증 — 순수 모듈 (firebase/PayPal/React 의존 0).
// PR-F: TourBookingDialog.tsx 에서 분리. 테스트가 TourBookingDialog 전체를 import 하면
//   PayPalBookingButton → src/lib/firebase getAuth() 가 CI(키 없음)에서 throw → "0 test" 실패.
//   순수 헬퍼+플래그를 이 모듈로 격리해 테스트가 firebase 미접촉.
//
// 플래그 VITE_FEATURE_TOUR_BOOKING_MINIMAL=true 시 Step 2 에서 전화번호 1개만 필수.
// OFF(기본) 시 전화·픽업주소·WhatsApp·LINE·메모 5개 전부 필수 (기존 동작 byte-identical).
import { isValidInternationalPhone } from '@/lib/phone-validation';

export const FEATURE_TOUR_BOOKING_MINIMAL =
  import.meta.env.VITE_FEATURE_TOUR_BOOKING_MINIMAL === 'true';

/**
 * Step 2(연락처·픽업) 완료 여부.
 * - 공통: 전화 **형식 검증**(isValidInternationalPhone — 오타·가짜번호 차단). 딥서치(2026-06-06):
 *   기사 배차는 닿는 번호가 이행 전제 → 기존 length>0 만으론 오타가 그대로 통과했음.
 * - 공통(2026-06-30, 트립닷컴식 예약정보 — SMS 인증 제거 운영자 결정): **약관 동의** 필수.
 *   SMS 본인인증(phoneSmsVerified) 게이트는 제거. 약관 + 전화형식검증 게이트는 유지.
 * - minimal=true: 전화(형식검증) + 약관 동의만 필수.
 * - minimal=false: + 픽업주소 + 메신저(단일 messenger 입력) + 메모.
 *   CRITICAL-1 fix (2026-06-29): 트립닷컴식 BookingInfoForm 통합 후 WhatsApp/LINE 전용
 *   입력칸이 사라져 whatsappId/lineId 가 영구 빈값 → 이 게이트 영구 false → 투어 결제
 *   전면 차단됐음. BookingInfoForm 의 단일 messenger("WhatsApp: id" 등)로 교체.
 */
export function isTourStep2Complete(fields: {
  phone: string;
  pickupAddress: string;
  messenger: string;
  memoText: string;
  /** 개인정보/이용약관 동의 여부 (BookingInfoForm 약관 카드). 항상 필수. */
  termsAgreed: boolean;
}, minimal: boolean): boolean {
  // 전화 형식 검증 (두 모드 공통)
  if (!isValidInternationalPhone(fields.phone)) return false;
  // 약관 동의 (두 모드 공통 — 결제 직전 동의 게이트. SMS 인증 제거 2026-06-30 운영자, 약관+전화형식검증 유지)
  if (!fields.termsAgreed) return false;
  if (minimal) return true;
  return (
    fields.pickupAddress.trim().length > 0 &&
    fields.messenger.trim().length > 0 &&
    fields.memoText.trim().length > 0
  );
}

/**
 * 투어 예약 표시 총액 (P311 — 표시가 = 청구가).
 *
 * 운영자 확정(2026-06-30): 투어 애드온(한복/카시트/가이드 등)은 **무료/현장결제** 라
 *   PayPal 청구에 포함되지 않는다. 백엔드 createPaypalOrder 의 resolveKrwAmount 는 차터
 *   productType 에 대해 `dailyPrice × days` (= baseKRW) 만 청구하고 애드온은 합산하지 않음.
 *   따라서 화면 표시 총액에서도 애드온(addonKRW)을 빼야 표시가 == 청구가 가 성립한다.
 *
 * ⚠️ addonKRW 는 의도적으로 인자에서 제외했다 (재추가 = P311 위반). slotModifierKRW 는
 *   애드온이 아니므로 그대로 포함 (공항 시간대 등). slot 의 백엔드 청구 누락 여부는 별도
 *   운영자 결정사항(이번 스코프 X) — 여기선 기존 표시 동작을 보존한다.
 *
 * 순수 함수 — firebase/React 미접촉이라 CI vitest 가 컴포넌트 렌더 없이 검증 가능.
 */
export function computeTourBookingTotalKRW(baseKRW: number, slotModifierKRW: number): number {
  return baseKRW + slotModifierKRW;
}

/**
 * 한복 인원 카운터 clamp — 0 ~ pax 범위로 제한.
 *
 * 운영자 준비용 수량(몇 벌 준비할지)일 뿐 가격에는 미반영(애드온=무료). pax 가 줄면
 *   기존 hanbokCount 가 새 pax 를 초과할 수 있어 clamp 필요(예: 4명→2명 변경 시 4→2).
 *   음수/NaN 방어 포함.
 */
export function clampHanbokCount(count: number, pax: number): number {
  const safeMax = Math.max(0, Math.floor(pax));
  if (!Number.isFinite(count) || count < 0) return 0;
  return Math.min(Math.floor(count), safeMax);
}
