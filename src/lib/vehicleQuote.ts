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

export function apiErrorMessage(value: unknown, fallback: string): string {
  if (!value || typeof value !== 'object') return fallback;
  const candidate = value as { error?: unknown; message?: unknown };
  const message = text(candidate.message) || text(candidate.error);
  return message || fallback;
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
