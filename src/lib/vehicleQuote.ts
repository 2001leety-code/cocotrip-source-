/**
 * Shared client contracts for the admin-only vehicle quote studio.
 *
 * Money is intentionally not calculated here. `/api/mood-quote-preview` is the
 * only quote calculator and returns both the breakdown and the exact copy text.
 */

export type VehicleQuoteLanguage = 'ko' | 'en' | 'ja' | 'zh';

export type DistanceBillingMode =
  | 'all_distance_when_threshold_reached'
  | 'excess_only'
  | 'always'
  | 'none';

export type QuoteExpensePolicy = 'manual' | 'route_estimate' | 'included';

export type BillingIncrementMinutes = 1 | 5 | 10 | 15 | 30 | 60;

export const VEHICLE_QUOTE_BILLING_INCREMENTS: readonly BillingIncrementMinutes[] = [
  1,
  5,
  10,
  15,
  30,
  60,
];

// Naver Directions 한 번에 7개 주소를 처리한다. 서버리스 30초 예산 안에서
// 순차 호출을 두 번으로 제한하기 위해 자동 경로는 최대 13개 주소만 허용한다.
export const VEHICLE_QUOTE_MAX_AUTOMATIC_ROUTE_ADDRESSES = 13;

export interface VehicleQuoteProfile {
  id: string;
  version: number;
  companyName: string;
  hourlyRateKRW: number;
  minMinutes: number;
  maxMinutes: number;
  billingIncrementMinutes: BillingIncrementMinutes;
  distanceThresholdMeters: number;
  distanceRateKRWPerKm: number;
  distanceBillingMode: DistanceBillingMode;
  vatBasisPoints: number;
  tollPolicy: QuoteExpensePolicy;
  parkingPolicy: QuoteExpensePolicy;
  overtimeRateKRW: number;
  overtimeIncludesVat: boolean;
  documentTitle: string;
  footer: string;
  builtIn?: boolean;
}

export interface EditableVehicleQuoteProfile extends Omit<VehicleQuoteProfile, 'id' | 'version'> {
  id?: string;
  version?: number;
}

export interface VehicleQuoteStop {
  clientId: string;
  order: number;
  arrivalTime: string;
  departureTime: string;
  name: string;
  purpose: string;
  sourceName?: string;
  sourcePurpose?: string;
  sourceRegion: string;
  roadAddress: string;
  jibunAddress: string;
  naverMapUrl: string;
  optional: boolean;
  includeInRoute: boolean;
  addressVerified: boolean;
  lat?: number;
  lng?: number;
}

export interface VehicleQuoteConflict {
  type: 'REGION_ADDRESS_MISMATCH';
  stopOrder: number;
  sourceRegion: string;
  addressRegion: string;
  addressField: 'roadAddress' | 'jibunAddress';
}

export interface VehicleQuoteParseData {
  serviceDate: string;
  startTime: string;
  endTime: string;
  departureAddress: string;
  stops: VehicleQuoteStop[];
  returnAddress: string;
  needsConfirm: boolean;
  conflicts?: VehicleQuoteConflict[];
  warnings: string[];
}

export interface VehicleQuoteRouteSummary {
  source: 'manual' | 'route' | string;
  distanceMeters: number;
  distanceKm: number;
  durationMinutes: number | null;
  tollKRW: number;
}

export interface VehicleQuoteBreakdown {
  currency: 'KRW' | string;
  timeMinutes: number;
  billableMinutes: number;
  timeFeeKRW: number;
  distanceFeeKRW: number;
  taxableSupplyKRW: number;
  vatKRW: number;
  tollKRW: number;
  parkingKRW: number;
  incidentalsKRW: number;
  totalKRW: number;
  overtimeRateKRW: number;
}

export interface VehicleQuotePreviewData {
  profile: VehicleQuoteProfile;
  route: VehicleQuoteRouteSummary;
  breakdown: VehicleQuoteBreakdown;
  documentText: string;
  warnings: string[];
  quoteSnapshot: Record<string, unknown>;
}

export interface VehicleQuotePreviewRequest {
  profileId: string;
  profileVersion?: number;
  serviceDate: string;
  startTime: string;
  endTime: string;
  totalMinutes: number;
  routeMode: 'manual' | 'route';
  manualDistanceKm?: number;
  manualTollKRW?: number;
  parkingKRW?: number;
  stops: Array<Omit<VehicleQuoteStop, 'clientId'>>;
  departureAddress?: string;
  returnAddress?: string;
}

export interface VehicleQuoteProfileNumericInput {
  hourlyRateKRW: string;
  minHours: string;
  maxHours: string;
  billingIncrementMinutes: string;
  distanceThresholdKm: string;
  distanceRateKRWPerKm: string;
  vatPercent: string;
  overtimeRateKRW: string;
}

export type VehicleQuoteProfileNumericValues = Pick<
  VehicleQuoteProfile,
  | 'hourlyRateKRW'
  | 'minMinutes'
  | 'maxMinutes'
  | 'billingIncrementMinutes'
  | 'distanceThresholdMeters'
  | 'distanceRateKRWPerKm'
  | 'vatBasisPoints'
  | 'overtimeRateKRW'
>;

let clientStopSequence = 0;

export function createVehicleQuoteStop(
  value: Partial<Omit<VehicleQuoteStop, 'clientId'>> = {},
): VehicleQuoteStop {
  clientStopSequence += 1;
  return {
    clientId: `vehicle-quote-stop-${Date.now()}-${clientStopSequence}`,
    order: positiveInteger(value.order, 1),
    arrivalTime: text(value.arrivalTime),
    departureTime: text(value.departureTime),
    name: text(value.name),
    purpose: text(value.purpose),
    ...(text(value.sourceName) ? { sourceName: text(value.sourceName) } : {}),
    ...(text(value.sourcePurpose) ? { sourcePurpose: text(value.sourcePurpose) } : {}),
    sourceRegion: text(value.sourceRegion),
    roadAddress: text(value.roadAddress),
    jibunAddress: text(value.jibunAddress),
    naverMapUrl: text(value.naverMapUrl),
    optional: value.optional === true,
    includeInRoute: value.includeInRoute !== false,
    addressVerified: value.addressVerified === true,
    ...(finiteNumber(value.lat) === null ? {} : { lat: finiteNumber(value.lat) as number }),
    ...(finiteNumber(value.lng) === null ? {} : { lng: finiteNumber(value.lng) as number }),
  };
}

export function normalizeVehicleQuoteStops(raw: unknown): VehicleQuoteStop[] {
  if (!Array.isArray(raw)) return [];
  return renumberVehicleQuoteStops(raw.map((item, index) => {
    const candidate = item && typeof item === 'object'
      ? item as Partial<Omit<VehicleQuoteStop, 'clientId'>>
      : {};
    return createVehicleQuoteStop({ ...candidate, order: index + 1 });
  }));
}

export function normalizeVehicleQuoteConflicts(raw: unknown): VehicleQuoteConflict[] {
  if (!Array.isArray(raw)) return [];
  const conflicts: VehicleQuoteConflict[] = [];
  for (const item of raw.slice(0, 40)) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as Partial<VehicleQuoteConflict>;
    const stopOrder = Number(candidate.stopOrder);
    const sourceRegion = text(candidate.sourceRegion);
    const addressRegion = text(candidate.addressRegion);
    if (
      candidate.type !== 'REGION_ADDRESS_MISMATCH'
      || !Number.isSafeInteger(stopOrder)
      || stopOrder <= 0
      || !sourceRegion
      || !addressRegion
      || (candidate.addressField !== 'roadAddress' && candidate.addressField !== 'jibunAddress')
    ) continue;
    conflicts.push({
      type: candidate.type,
      stopOrder,
      sourceRegion,
      addressRegion,
      addressField: candidate.addressField,
    });
  }
  return conflicts;
}

export function renumberVehicleQuoteStops(stops: VehicleQuoteStop[]): VehicleQuoteStop[] {
  return stops.map((stop, index) => ({ ...stop, order: index + 1 }));
}

export function moveVehicleQuoteStop(
  stops: VehicleQuoteStop[],
  fromIndex: number,
  toIndex: number,
): VehicleQuoteStop[] {
  if (
    fromIndex < 0
    || fromIndex >= stops.length
    || toIndex < 0
    || toIndex >= stops.length
    || fromIndex === toIndex
  ) return renumberVehicleQuoteStops(stops);
  const next = [...stops];
  const removed = next.splice(fromIndex, 1)[0];
  if (!removed) return renumberVehicleQuoteStops(stops);
  next.splice(toIndex, 0, removed);
  return renumberVehicleQuoteStops(next);
}

export function isVehicleQuoteStopRouteReady(stop: VehicleQuoteStop): boolean {
  if (!stop.includeInRoute) return true;
  return stop.addressVerified && Boolean((stop.roadAddress || stop.jibunAddress).trim());
}

export function vehicleQuoteRoutePoints({
  departureAddress,
  stops,
  returnAddress,
}: {
  departureAddress: string;
  stops: VehicleQuoteStop[];
  returnAddress: string;
}): string[] {
  const points: string[] = [];
  const addPoint = (value: string) => {
    const address = text(value);
    if (address && points[points.length - 1] !== address) points.push(address);
  };

  addPoint(departureAddress);
  for (const stop of stops) {
    if (stop.includeInRoute) addPoint(stop.roadAddress || stop.jibunAddress);
  }
  addPoint(returnAddress);
  return points;
}

export function durationHoursFromTimes(startTime: string, endTime: string): string {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  if (start === null || end === null) return '';
  const minutes = end >= start ? end - start : end + 1440 - start;
  if (minutes <= 0) return '';
  const hours = minutes / 60;
  return Number.isInteger(hours) ? String(hours) : String(Math.round(hours * 100) / 100);
}

export function durationInputToMinutes(value: string): number | null {
  const trimmed = String(value || '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) return null;
  const hours = Number(trimmed);
  if (!Number.isFinite(hours) || hours <= 0) return null;
  return Math.round(hours * 60);
}

export function parseVehicleQuoteManualDistanceInput(value: string): number | null {
  const trimmed = String(value || '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed) || trimmed.length > 32) return null;
  const distanceKm = Number(trimmed);
  return Number.isFinite(distanceKm) && distanceKm >= 0 && distanceKm <= 3000
    ? distanceKm
    : null;
}

export function vehicleQuoteMinutesToHoursInput(value: number): string {
  return scaledIntegerToInput(value, 60);
}

export function vehicleQuoteMetersToKilometersInput(value: number): string {
  return scaledIntegerToInput(value, 1000);
}

export function vehicleQuoteBasisPointsToPercentInput(value: number): string {
  return scaledIntegerToInput(value, 100);
}

export function parseVehicleQuoteProfileNumericInput(
  input: VehicleQuoteProfileNumericInput,
): VehicleQuoteProfileNumericValues | null {
  const hourlyRateKRW = scaledInputToInteger(input.hourlyRateKRW, 1, 0, 10_000_000);
  const minMinutes = scaledInputToInteger(input.minHours, 60, 1, 10_080);
  const maxMinutes = scaledInputToInteger(input.maxHours, 60, 1, 10_080);
  const billingIncrement = scaledInputToInteger(input.billingIncrementMinutes, 1, 1, 60);
  const distanceThresholdMeters = scaledInputToInteger(
    input.distanceThresholdKm,
    1000,
    0,
    3_000_000,
  );
  const distanceRateKRWPerKm = scaledInputToInteger(
    input.distanceRateKRWPerKm,
    1,
    0,
    1_000_000,
  );
  const vatBasisPoints = scaledInputToInteger(input.vatPercent, 100, 0, 10_000);
  const overtimeRateKRW = scaledInputToInteger(input.overtimeRateKRW, 1, 0, 10_000_000);

  if (
    hourlyRateKRW === null
    || minMinutes === null
    || maxMinutes === null
    || minMinutes > maxMinutes
    || billingIncrement === null
    || !isVehicleQuoteBillingIncrement(billingIncrement)
    || distanceThresholdMeters === null
    || distanceRateKRWPerKm === null
    || vatBasisPoints === null
    || overtimeRateKRW === null
  ) return null;

  return {
    hourlyRateKRW,
    minMinutes,
    maxMinutes,
    billingIncrementMinutes: billingIncrement,
    distanceThresholdMeters,
    distanceRateKRWPerKm,
    vatBasisPoints,
    overtimeRateKRW,
  };
}

export function profileMinutesRange(profile: VehicleQuoteProfile | null): { min: number; max: number } {
  return {
    min: profile && Number.isFinite(profile.minMinutes) ? profile.minMinutes : 0,
    max: profile && Number.isFinite(profile.maxMinutes) ? profile.maxMinutes : Number.MAX_SAFE_INTEGER,
  };
}

export function toVehicleQuotePreviewStops(stops: VehicleQuoteStop[]): VehicleQuotePreviewRequest['stops'] {
  return renumberVehicleQuoteStops(stops).map((stop) => ({
    order: stop.order,
    arrivalTime: stop.arrivalTime,
    departureTime: stop.departureTime,
    name: stop.name,
    purpose: stop.purpose,
    sourceRegion: stop.sourceRegion,
    roadAddress: stop.roadAddress,
    jibunAddress: stop.jibunAddress,
    naverMapUrl: stop.naverMapUrl,
    optional: stop.optional,
    includeInRoute: stop.includeInRoute,
    addressVerified: stop.addressVerified,
    ...(finiteNumber(stop.lat) === null ? {} : { lat: stop.lat }),
    ...(finiteNumber(stop.lng) === null ? {} : { lng: stop.lng }),
  }));
}

export function unwrapApiData<T>(value: unknown): T | null {
  if (!value || typeof value !== 'object') return null;
  const envelope = value as { data?: unknown };
  if (!envelope.data || typeof envelope.data !== 'object') return null;
  return envelope.data as T;
}

const VEHICLE_QUOTE_ERROR_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  AUTH_REQUIRED: '로그인이 만료되었습니다. 다시 로그인해 주세요.',
  EMAIL_UNVERIFIED: '이메일 인증을 완료한 뒤 다시 시도해 주세요.',
  ADMIN_ONLY: '관리자 계정에서만 사용할 수 있습니다.',
  METHOD_NOT_ALLOWED: '지원하지 않는 요청입니다.',
  DB_UNAVAILABLE: '견적 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
  INTERNAL_ERROR: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  MISSING_TEXT: '분석할 일정을 먼저 붙여넣어 주세요.',
  TEXT_TOO_LONG: '일정이 너무 깁니다. 12,000자 이하로 나눠 입력해 주세요.',
  AI_NOT_CONFIGURED: '일정 분석 기능을 사용할 수 없습니다. 관리자 설정을 확인해 주세요.',
  NO_STOPS_FOUND: '일정에서 방문 장소를 찾지 못했습니다. 내용을 확인하거나 직접 입력해 주세요.',
  AI_PARSE_FAILED: '일정을 분석하지 못했습니다. 다시 시도하거나 직접 입력해 주세요.',
  TOO_MANY_STOPS: '방문 장소는 최대 40곳까지 입력할 수 있습니다.',
  INVALID_ACTION: '지원하지 않는 견적 작업입니다.',
  INVALID_PROFILE_ID: '업체 정보를 확인한 뒤 다시 시도해 주세요.',
  INVALID_PROFILE_VERSION: '업체 요금표 버전을 확인한 뒤 다시 시도해 주세요.',
  INVALID_STORED_PROFILE: '저장된 업체 요금표에 문제가 있습니다. 관리자에게 확인해 주세요.',
  PROFILE_NOT_FOUND: '선택한 업체 정보를 찾지 못했습니다.',
  PROFILE_ARCHIVED: '사용이 종료된 업체입니다. 다른 업체를 선택해 주세요.',
  PROFILE_ALREADY_ARCHIVED: '이미 사용이 종료된 업체입니다.',
  PROFILE_VERSION_CONFLICT: '업체 정보가 다른 화면에서 변경되었습니다. 새로 불러온 뒤 다시 시도해 주세요.',
  EXPECTED_VERSION_REQUIRED: '업체 정보를 새로 불러온 뒤 다시 저장해 주세요.',
  INVALID_EXPECTED_VERSION: '업체 정보 버전을 확인한 뒤 다시 저장해 주세요.',
  INVALID_CURRENT_VERSION: '저장된 업체 정보 버전에 문제가 있습니다. 관리자에게 확인해 주세요.',
  BUILT_IN_PROFILE_CANNOT_BE_ARCHIVED: '기본 업체 요금표는 사용 종료할 수 없습니다.',
  COMPANY_NAME_REQUIRED: '업체명을 입력해 주세요.',
  INVALID_HOURLY_RATE: '시간당 요금을 확인해 주세요.',
  INVALID_TIME_RANGE: '최소·최대 이용시간을 확인해 주세요.',
  INVALID_BILLING_INCREMENT: '시간요금 올림 단위를 확인해 주세요.',
  INVALID_DISTANCE_METERS: '거리요금 적용 기준을 확인해 주세요.',
  INVALID_DISTANCE_RATE: '거리요금을 확인해 주세요.',
  INVALID_DISTANCE_MODE: '거리 계산 방식을 확인해 주세요.',
  INVALID_VAT_RATE: '부가세율을 확인해 주세요.',
  INVALID_INCIDENTAL_POLICY: '통행료·주차비 계산 방식을 확인해 주세요.',
  INVALID_OVERTIME_RATE: '초과 이용요금을 확인해 주세요.',
  INVALID_SERVICE_DATE: '이용일을 확인해 주세요.',
  INVALID_SERVICE_TIME: '시작·종료 시각을 확인해 주세요.',
  INVALID_TIME_MINUTES: '총 이용시간을 확인해 주세요.',
  MAX_TIME_EXCEEDED: '이 업체의 최대 이용시간을 초과했습니다.',
  INVALID_ROUTE_MODE: '거리 입력 방식을 다시 선택해 주세요.',
  ROUTE_ADDRESS_REQUIRED: '운행경로에 포함된 장소의 주소를 입력해 주세요.',
  ROUTE_ADDRESS_NOT_CONFIRMED: '운행경로에 포함된 모든 주소를 확인해 주세요.',
  ROUTE_NEEDS_TWO_ADDRESSES: '운행경로에는 주소가 두 곳 이상 필요합니다.',
  ROUTE_ADDRESS_LIMIT_EXCEEDED: '자동 경로는 주소 13곳까지 지원합니다. 장소를 줄이거나 거리를 직접 입력해 주세요.',
  ROUTE_LOOKUP_FAILED: '운행경로를 불러오지 못했습니다. 주소를 확인하거나 거리를 직접 입력해 주세요.',
  INVALID_MANUAL_DISTANCE: '예상 거리를 0~3,000km 사이의 숫자로 입력해 주세요.',
  INVALID_TOLL_AMOUNT: '통행료를 원 단위 정수로 입력해 주세요.',
  INVALID_INCIDENTAL_AMOUNT: '통행료와 주차비를 원 단위 정수로 입력해 주세요.',
  KOREAN_DISPLAY_TEXT_REQUIRED: '장소명과 일정 내용에는 한글을 한 글자 이상 입력해 주세요.',
});

const VEHICLE_QUOTE_GENERIC_ERROR = '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';

function mappedVehicleQuoteError(code: string): string {
  return Object.prototype.hasOwnProperty.call(VEHICLE_QUOTE_ERROR_MESSAGES, code)
    ? VEHICLE_QUOTE_ERROR_MESSAGES[code]
    : '';
}

export function apiErrorMessage(value: unknown, fallback: string): string {
  const safeFallback = /[가-힣]/.test(String(fallback || ''))
    ? String(fallback).trim()
    : VEHICLE_QUOTE_GENERIC_ERROR;
  if (!value || typeof value !== 'object') return safeFallback;
  const candidate = value as { code?: unknown; error?: unknown };
  const code = text(candidate.code);
  const errorCode = text(candidate.error);
  return mappedVehicleQuoteError(code)
    || mappedVehicleQuoteError(errorCode)
    || VEHICLE_QUOTE_GENERIC_ERROR;
}

export async function copyVehicleQuoteText(value: string): Promise<boolean> {
  const copyValue = String(value || '');
  if (!copyValue) return false;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(copyValue);
      return true;
    }
  } catch { /* fall through to the selection-based copy */ }

  if (typeof document === 'undefined') return false;
  const textArea = document.createElement('textarea');
  textArea.value = copyValue;
  textArea.readOnly = true;
  textArea.style.position = 'fixed';
  textArea.style.opacity = '0';
  document.body.appendChild(textArea);
  textArea.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textArea.remove();
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isVehicleQuoteBillingIncrement(value: number): value is BillingIncrementMinutes {
  return VEHICLE_QUOTE_BILLING_INCREMENTS.some((increment) => increment === value);
}

function scaledIntegerToInput(value: number, scale: number): string {
  if (!Number.isSafeInteger(value) || value < 0) return '';
  return String(value / scale);
}

function scaledInputToInteger(
  value: string,
  scale: number,
  minimum: number,
  maximum: number,
): number | null {
  const trimmed = String(value || '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed) || trimmed.length > 32) return null;
  const parsed = Number(trimmed);
  const scaled = parsed * scale;
  const nearestInteger = Math.round(scaled);
  const floatingPointTolerance = Number.EPSILON * Math.max(1, Math.abs(scaled)) * 8;
  if (
    !Number.isFinite(scaled)
    || Math.abs(scaled - nearestInteger) > floatingPointTolerance
    || !Number.isSafeInteger(nearestInteger)
    || nearestInteger < minimum
    || nearestInteger > maximum
  ) return null;
  return nearestInteger;
}

function timeToMinutes(value: string): number | null {
  const match = String(value || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}
