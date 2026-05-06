/**
 * PayPalBookingButton — backward-compat wrapper.
 *
 * 2026-05-06 (배경 갱신): cocotripkr 비즈니스 = 한국 등록. Braintree LIVE 는 한국 기업
 * 가입 자체가 안 돼서 LIVE 계정이 없음. PayPal SDK 직접 통합도 5/3 시점 한국 계정
 * CDN reject 로 실패. 결국 실 결제 가능한 유일한 경로 = **PayPal Business 본계정 +
 * paypal.me 외부 redirect**.
 *
 * 본 wrapper 는 호출처 10+ 군데를 한꺼번에 안 건드리려고 thin wrapper 유지. 기존
 * import 경로 / Props 인터페이스 그대로 → 모든 호출처는 자동으로 paypal.me QR 흐름
 * 사용. 사용자 결제 → admin 매칭 (수동) 또는 PayPal Webhook 자동 매칭 (PR #276).
 *
 * 이전 (5/3 ~ 5/6): BraintreePaymentButton 으로 위임. Braintree LIVE 미등록 확인 후
 * PayPalQrPanel 로 위임 변경 — 모든 결제 흐름이 동일한 외부 redirect 경로 사용.
 */
import { PayPalQrPanel } from './PayPalQrPanel';

export interface AirportBookingInfo {
  terminal?: 'T1' | 'T2';
  flightNumber?: string;
  luggage?: { small?: number; medium?: number; large?: number };
}

// 레거시 호환 — 기존 호출처가 lang dict 를 넘겼던 prop. PayPalQrPanel 은 useLanguage
// hook 사용해서 자체 4-lang 처리 → wrapper 에서는 무시해도 안전.
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
  /** 레거시 — i18n dict. PayPalQrPanel 자체 4-lang 처리하므로 무시됨. */
  p?: BookingDict;
  /** 레거시 — 언어 코드. PayPalQrPanel 의 useLanguage 가 우선. */
  lang?: string;
  pickupLocation?: string;
  dropoffLocation?: string;
  vehicleType?: string;
  memo?: string;
  itineraryData?: unknown;
  /** 레거시 — Braintree SDK 결제 성공 시 호출. paypal.me QR 흐름에서는 사용자가
   *  [결제 완료 신고] 클릭 시 'MANUAL-{bookingRef}' orderID 로 호출. */
  onPaymentSuccess?: (orderID: string) => void | Promise<void>;
  userEmail?: string;
  airport?: AirportBookingInfo;
  /** charter_custom_estimate 결제용 — priceKRW 를 override. */
  customAmountKRW?: number;
}

export function PayPalBookingButton({
  productType, passengers, dateStart, dateEnd, priceKRW,
  pickupLocation, dropoffLocation, vehicleType, memo, itineraryData,
  airport, userEmail, onPaymentSuccess, customAmountKRW,
  // p, lang 은 레거시 — 무시
}: Props) {
  const finalPriceKRW = customAmountKRW != null && customAmountKRW > 0
    ? customAmountKRW
    : priceKRW;

  return (
    <PayPalQrPanel
      productType={productType}
      passengers={passengers}
      dateStart={dateStart}
      dateEnd={dateEnd}
      priceKRW={finalPriceKRW}
      pickupLocation={pickupLocation}
      dropoffLocation={dropoffLocation}
      vehicleType={vehicleType}
      memo={memo}
      itineraryData={itineraryData}
      airport={airport}
      customerEmail={userEmail}
      onPaymentReported={async (bookingRef) => {
        // 레거시 onPaymentSuccess 콜백을 매뉴얼 신고 흐름으로 매핑.
        // bookingRef 가 'CT-YYYYMMDD-XXX' 형식이라 prefix 'MANUAL-' 추가해서 백엔드가
        // 자동/매뉴얼 거래 구분 가능. (paymentGate.js 가 MANUAL- 인식)
        if (onPaymentSuccess) {
          await onPaymentSuccess(`MANUAL-${bookingRef}`);
        }
      }}
    />
  );
}
