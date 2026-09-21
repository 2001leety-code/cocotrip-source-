/** 대중교통 모드(지하철·버스) 여부 — fallback 경고 노출 가드용. */
export function isPublicTransitMethod(method: string | undefined): boolean {
  return method === 'subway' || method === 'bus' || method === 'subway+bus';
}

/** 이동 수단 i18n 라벨. */
export function methodLabel(method: string | undefined, trKeys: Record<string, string>): string {
  if (!method) return '';
  const map: Record<string, string | undefined> = {
    car: trKeys.methodCar,
    bus: trKeys.methodBus,
    subway: trKeys.methodSubway,
    'subway+bus': trKeys.methodSubwayBus,
    taxi: trKeys.methodTaxi,
    train: trKeys.methodTrain,
    walk: trKeys.walk,
    ferry: trKeys.methodFerry,
  };
  return map[method] || method;
}

const TRUSTED_TRANSIT_SOURCES = new Set(['odsay', 'tmap', 'cache']);

export function shouldShowFallbackWarning(
  transit: { source?: string; method?: string; _downgraded_from?: unknown } | null | undefined,
): boolean {
  if (!transit) return false;
  if (transit._downgraded_from) return false;
  if (!isPublicTransitMethod(transit.method)) return false;
  if (!transit.source) return false;
  return !TRUSTED_TRANSIT_SOURCES.has(transit.source);
}

interface GeoPoint { lat?: number; lng?: number; name?: string | null }
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export interface SegmentEndpoints {
  fromLat?: number | null;
  fromLng?: number | null;
  fromName?: string;
  toLat?: number | null;
  toLng?: number | null;
  toName?: string;
}

export function buildTransitDirectionsLinks(
  transit: Record<string, unknown>,
  destinationName?: string,
  endpoints?: SegmentEndpoints,
): { google: string; naver: string } | null {
  const steps = (transit.steps_detail as Array<Record<string, unknown>> | undefined) || [];
  const from = steps.map(s => s.fromPoint as GeoPoint | undefined).find(p => p && isNum(p.lat) && isNum(p.lng));
  const to = [...steps].reverse().map(s => s.toPoint as GeoPoint | undefined).find(p => p && isNum(p.lat) && isNum(p.lng));
  const oLat = isNum(from?.lat) ? from?.lat : (isNum(endpoints?.fromLat) ? endpoints?.fromLat : undefined);
  const oLng = isNum(from?.lng) ? from?.lng : (isNum(endpoints?.fromLng) ? endpoints?.fromLng : undefined);
  const dLat = isNum(to?.lat) ? to?.lat
    : isNum(transit.anchor_lat) ? (transit.anchor_lat as number)
    : (isNum(endpoints?.toLat) ? endpoints?.toLat : undefined);
  const dLng = isNum(to?.lng) ? to?.lng
    : isNum(transit.anchor_lng) ? (transit.anchor_lng as number)
    : (isNum(endpoints?.toLng) ? endpoints?.toLng : undefined);
  if (!isNum(oLat) || !isNum(oLng) || !isNum(dLat) || !isNum(dLng)) return null;
  const enc = encodeURIComponent;
  const oName = from?.name || (transit.from_label as string | undefined) || endpoints?.fromName || '';
  const dName = to?.name || destinationName || (transit.anchor_label as string | undefined) || endpoints?.toName || '';
  const isWalkLeg = String(transit.method || '').toLowerCase() === 'walk';
  return {
    google: `https://www.google.com/maps/dir/?api=1&origin=${oLat},${oLng}&destination=${dLat},${dLng}&travelmode=${isWalkLeg ? 'walking' : 'transit'}`,
    naver: `https://map.naver.com/v5/directions/${oLng},${oLat},${enc(oName)}/${dLng},${dLat},${enc(dName)}/-/${isWalkLeg ? 'walk' : 'transit'}?c=15`,
  };
}
