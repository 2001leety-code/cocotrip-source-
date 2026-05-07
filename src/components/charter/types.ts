// CharterWizard — 공용 타입 정의
// Phase B 위저드가 참조하는 6단계 상태 + 견적 결과

export type OriginCode =
  | 'ICN' | 'GMP' | 'PUS' | 'CJU' | 'TAE'
  | 'CJJ' | 'MWX' | 'KWJ' | 'RSU' | 'USN'
  | 'SEL_METRO' | 'BUS_METRO' | 'CUSTOM';

export type ServiceMode = 'airport_transfer' | 'day_tour' | 'multi_day' | 'kpop_shuttle';

// 'vip' = 의전 차량 (행사 픽업 전용, 항상 협의 — Bus와 동일하게 결제 비활성).
export type VehicleType = 'staria' | 'sprinter' | 'bus' | 'vip';

export type DestinationKind = 'package' | 'matrix' | 'custom';

// multi_day 숙소 위치 — 운영 안내용 (가격 분기는 추후)
export type LodgingLocation = 'seoul' | 'local' | 'daily_return' | 'custom';

export interface WizardState {
  origin?: OriginCode;
  originCustom?: string;        // origin = 'CUSTOM' 일 때 자유 입력
  service?: ServiceMode;
  destinationKey?: string;      // 매트릭스 키(예: 'SEL_METRO'), 패키지 id(예: 'dmz'), 또는 'CUSTOM'
  destinationCustom?: string;
  destinationCustomMatched?: string;  // KR→EN 정규화 결과 (있으면 매트릭스 lookup 가능)
  paxCount?: number;             // = adultCount + childCount (자동 계산, 백엔드 호환용 유지)
  adultCount?: number;
  childCount?: number;
  vehicle?: VehicleType;
  startDate?: string;            // YYYY-MM-DD
  endDate?: string;              // 1박 이상일 때만
  startTime?: string;            // HH:mm
  // 고객 정보 (Step 5에서 수집)
  customerName?: string;
  customerPhone?: string;
  // multi_day 전용 — 숙소 위치 (운영 정보)
  lodgingLocation?: LodgingLocation;
  lodgingCustom?: string;        // lodgingLocation = 'custom' 일 때
  options: {
    licensedGuide?: boolean;     // 면허 가이드 (300k/일) — staria 옵션. sprinter/bus는 자동 가산이라 무의미
    airportPicket?: boolean;
    childSeat?: boolean;
    night?: boolean;             // 18:00 이후 야간 할증
  };
  // 공항 픽업(airport_transfer) 전용 필수 필드
  airport?: {
    terminal?: 'T1' | 'T2';          // ICN 선택 시 필수
    flightNumber?: string;            // 편명 (예: KE085, OZ213)
    luggage?: {
      small?: number;                 // 기내 반입 (캐리어 S 또는 배낭)
      medium?: number;                // 24인치
      large?: number;                 // 28인치+
    };
  };
  notes?: string;
}

export interface QuoteAddon {
  key: string;
  label: string;
  amountKRW: number;
}

export interface QuoteBreakdown {
  mode: ServiceMode;
  source: 'package' | 'matrix' | 'metro' | 'formula';
  vehicle: VehicleType;
  vehicleChargeKRW: number;
  addons: QuoteAddon[];
  subtotalKRW: number;            // 선결제 대상 (vehicle + addons + 할증 - 할인)
  surchargeKRW: number;           // 야간/성수기 합
  surchargePercent: number;
  multiDayDiscountKRW: number;    // 1박 이상 multi-day 시 -10%
  multiDayDiscountPercent: number;
  // VAT (현재는 표기만, 가산 X)
  vatExcluded: boolean;
  vatPercent: number;
  // 별도 고지 (선결제 아님)
  estimatedMealsKRW: number;
  estimatedAttractionsKRW: number;
  showMeals: boolean;
  showAttractions: boolean;
  includes: string[];
  excludes: string[];
  // 디버그/투명성
  distanceKm?: number;
  durationHours?: number;
  warnings: string[];
  // destinationCustom 미매칭 시 별도견적 안내
  needsCustomQuote: boolean;
  // PR-F 영수증 표기 (선택). source = 'formula' 일 때 채워지고, 'package'/'matrix' 일 때는
  // 단일 패키지 행으로 표시 (이 필드 비어 있음 또는 0).
  receipt?: {
    baseFeeKRW?: number;     // 차량 기본료 (Staria 50k / Sprinter 100k)
    distanceFeeKRW?: number; // km × perKmRate (단가 표기 X — km 만 노출)
    tollFeeKRW?: number;     // 톨비 추정 (≈)
    isPackage?: boolean;     // package/matrix priceKRW 단일 행 — 영수증에 단일 패키지로 노출
  };
}

export const INITIAL_WIZARD_STATE: WizardState = {
  paxCount: 2,
  adultCount: 2,
  childCount: 0,
  vehicle: 'staria',
  options: {},
};
