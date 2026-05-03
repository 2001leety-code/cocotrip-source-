/**
 * PayPalBookingButton — backward-compat wrapper.
 *
 * 2026-05-03: 한국 PayPal Business 계정의 직접 PayPal SDK (paypal.com/sdk/js) 사용
 * 불가 확정 (CDN reject). PayPal 자회사 Braintree로 통합 전환. 호출처 10+ 군데를
 * 한 번에 안 건드리려고 본 파일은 BraintreePaymentButton 으로 위임하는 thin wrapper로
 * 유지. 기존 import 경로/Props 인터페이스 그대로 유지 → 호출처 코드 변경 X.
 *
 * 이전 구현 (PayPal Smart Buttons + sandbox 분기 + ad-blocker 가드 등 약 700L)는
 * 한국 계정에서 작동 안 해서 제거. PR #210/#214/#215 에서 점진적으로 시도된 fix들도
 * 모두 무효화 — root cause가 PayPal CDN 측 reject였기 때문.
 */
import { BraintreePaymentButton, type AirportBookingInfo } from './BraintreePaymentButton';

export type { AirportBookingInfo };

interface BookingDict {
  paypalSdkError?: string;
  paypalError?: string;
  paypalCancel?: string;
  paypalLoading?: string;
  paypalBookBtn?: string;
  paypalRateLabel?: string;
  paypalRetry?: string;
  [key: string]: unknown;
}

interface Props {
  productType: string;
  passengers: number;
  dateStart?: string;
  dateEnd?: string;
  priceKRW: number;
  p: BookingDict;
  lang: string;
  pickupLocation?: string;
  dropoffLocation?: string;
  vehicleType?: string;
  memo?: string;
  itineraryData?: unknown;
  onPaymentSuccess?: (orderID: string) => void | Promise<void>;
  userEmail?: string;
  airport?: AirportBookingInfo;
}

export function PayPalBookingButton(props: Props) {
  return <BraintreePaymentButton {...props} />;
}
