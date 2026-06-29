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
 * - 공통(2026-06-28, 트립닷컴식 예약정보): **전화 SMS 인증** + **약관 동의** 둘 다 필수.
 *   결제 직전 본인 확인 + 개인정보/이용약관 동의 게이트. minimal 여부와 무관하게 항상 요구.
 * - minimal=true: 전화(형식검증) + SMS 인증 + 약관 동의만 필수.
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
  /** BookingConsent — SMS 인증 완료 여부 (트립닷컴식). 항상 필수. */
  phoneSmsVerified: boolean;
  /** BookingConsent — 개인정보/이용약관 동의 여부. 항상 필수. */
  termsAgreed: boolean;
}, minimal: boolean): boolean {
  // 전화 형식 검증 (두 모드 공통)
  if (!isValidInternationalPhone(fields.phone)) return false;
  // SMS 인증 + 약관 동의 (두 모드 공통 — 결제 직전 본인확인·동의 게이트)
  if (!fields.phoneSmsVerified || !fields.termsAgreed) return false;
  if (minimal) return true;
  return (
    fields.pickupAddress.trim().length > 0 &&
    fields.messenger.trim().length > 0 &&
    fields.memoText.trim().length > 0
  );
}
