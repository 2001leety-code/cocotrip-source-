// 투어 예약 Step 2 검증 — 순수 모듈 (firebase/PayPal/React 의존 0).
// PR-F: TourBookingDialog.tsx 에서 분리. 테스트가 TourBookingDialog 전체를 import 하면
//   PayPalBookingButton → src/lib/firebase getAuth() 가 CI(키 없음)에서 throw → "0 test" 실패.
//   순수 헬퍼+플래그를 이 모듈로 격리해 테스트가 firebase 미접촉.
//
// 플래그 VITE_FEATURE_TOUR_BOOKING_MINIMAL=true 시 Step 2 에서 전화번호 1개만 필수.
// OFF(기본) 시 전화·픽업주소·WhatsApp·LINE·메모 5개 전부 필수 (기존 동작 byte-identical).
export const FEATURE_TOUR_BOOKING_MINIMAL =
  import.meta.env.VITE_FEATURE_TOUR_BOOKING_MINIMAL === 'true';

/**
 * Step 2(연락처·픽업) 완료 여부.
 * - minimal=true: 전화 1개만 필수.
 * - minimal=false (기본/OFF): 5개 전부 필수 (기존 동작 byte-identical).
 */
export function isTourStep2Complete(fields: {
  phone: string;
  pickupAddress: string;
  whatsappId: string;
  lineId: string;
  memoText: string;
}, minimal: boolean): boolean {
  if (minimal) {
    return fields.phone.trim().length > 0;
  }
  return (
    fields.phone.trim().length > 0 &&
    fields.pickupAddress.trim().length > 0 &&
    fields.whatsappId.trim().length > 0 &&
    fields.lineId.trim().length > 0 &&
    fields.memoText.trim().length > 0
  );
}
