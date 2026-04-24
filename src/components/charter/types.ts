// CharterWizard — 공용 타입 정의
// Phase B 위저드가 참조하는 6단계 상태 + 견적 결과

export type OriginCode =
  | 'ICN' | 'GMP' | 'PUS' | 'CJU' | 'TAE'
  | 'CJJ' | 'MWX' | 'KWJ' | 'RSU' | 'USN'
  | 'SEL_METRO' | 'BUS_METRO' | 'CUSTOM';

export type ServiceMode = 'airport_transfer' | 'day_tour' | 'multi_day' | 'kpop_shuttle';

export type VehicleType = 'staria' | 'sprinter' | 'bus';

export type DestinationKind = 'package' | 'matrix' | 'custom';

export interface WizardState {
  origin?: OriginCode;
  originCustom?: string;        // origin = 'CUSTOM' 일 때 자유 입력
  service?: ServiceMode;
  destinationKey?: string;      // 매트릭스 키(예: 'SEL_METRO'), 패키지 id(예: 'dmz'), 또는 'CUSTOM'
  destinationCustom?: string;
  paxCount?: number;
  vehicle?: VehicleType;
  startDate?: string;            // YYYY-MM-DD
  endDate?: string;              // 1박 이상일 때만
  startTime?: string;            // HH:mm
  options: {
    englishGuide?: boolean;
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
  subtotalKRW: number;            // 선결제 대상 (vehicle + addons + 할증)
  surchargeKRW: number;           // 야간/성수기 합
  surchargePercent: number;
  roundTripDiscountKRW: number;
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
}

export const INITIAL_WIZARD_STATE: WizardState = {
  paxCount: 2,
  vehicle: 'staria',
  options: {},
};
