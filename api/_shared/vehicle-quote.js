/**
 * 관리자 전용 다중 업체 차량 견적 SSOT.
 *
 * 이 모듈은 기존 MOOD 예약/잔액/결제 가격과 의도적으로 분리되어 있다.
 * 견적 미리보기만 계산하며 실제 예약 금액이나 잔액을 변경하지 않는다.
 * 모든 금액은 KRW 정수, 거리와 시간은 각각 meter/minute 정수로 계산한다.
 */

export const BUILT_IN_MOOD_QUOTE_PROFILE = Object.freeze({
  id: 'mood-default',
  version: 1,
  builtIn: true,
  archived: false,
  companyName: 'MOOD',
  logoUrl: '',
  contact: '',
  currency: 'KRW',
  timezone: 'Asia/Seoul',
  hourlyRateKRW: 30000,
  minMinutes: 180,
  maxMinutes: 900,
  // 기존 MOOD 시간요금처럼 소수 시간도 비례 계산한다. 업체 프로필에서 30/60분 올림으로 변경 가능.
  billingIncrementMinutes: 1,
  distanceThresholdMeters: 50000,
  distanceRateKRWPerKm: 600,
  distanceBillingMode: 'all_distance_when_threshold_reached',
  vatBasisPoints: 1000,
  tollPolicy: 'route_estimate',
  parkingPolicy: 'manual',
  overtimeRateKRW: 33000,
  overtimeIncludesVat: true,
  documentTitle: '전용 차량 일정 및 예상 견적',
  footer: '',
});

export const DISTANCE_BILLING_MODES = Object.freeze([
  'all_distance_when_threshold_reached',
  'excess_only',
  'always',
  'none',
]);

export const INCIDENTAL_POLICIES = Object.freeze([
  'manual',
  'route_estimate',
  'included',
]);

export const MAX_QUOTE_STOPS = 40;
export const MAX_AUTOMATIC_QUOTE_ROUTE_ADDRESSES = 13;

const DISTANCE_MODE_SET = new Set(DISTANCE_BILLING_MODES);
const TOLL_POLICY_SET = new Set(INCIDENTAL_POLICIES);
const PARKING_POLICY_SET = new Set(['manual', 'included']);
const BILLING_INCREMENTS = new Set([1, 5, 10, 15, 30, 60]);
const PROFILE_ID_RE = /^[a-z0-9][a-z0-9_-]{1,49}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function cleanLine(value, maxLength = 300) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function cleanMultiline(value, maxLength = 1000, maxLines = 20) {
  const lines = String(value || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .slice(0, maxLines)
    .map((line) => line.replace(/[\t\f\v ]+/g, ' ').trim());
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, maxLength).trim();
}

function integerInRange(value, min, max) {
  if (typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value < min
    || value > max) return null;
  return value;
}

function safeHttpsUrl(value, maxLength = 1000) {
  const text = cleanLine(value, maxLength);
  if (!text) return '';
  try {
    const url = new URL(text);
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function safeNaverMapUrl(value) {
  const urlText = safeHttpsUrl(value, 1000);
  if (!urlText) return '';
  const url = new URL(urlText);
  const host = url.hostname.toLowerCase();
  return host === 'naver.me' || host === 'map.naver.com' || host.endsWith('.map.naver.com')
    ? url.toString()
    : '';
}

function validCalendarDate(value) {
  if (!DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** 사용자/Firestore 프로필을 엄격한 견적 프로필로 정규화한다. */
export function normalizeVehicleQuoteProfile(input, options = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const fallback = options.fallback && typeof options.fallback === 'object'
    ? options.fallback
    : BUILT_IN_MOOD_QUOTE_PROFILE;
  const id = cleanLine(source.id || fallback.id, 50).toLowerCase();
  const hasExplicitVersion = Object.prototype.hasOwnProperty.call(source, 'version');
  const rawVersion = hasExplicitVersion ? source.version : fallback.version;
  const version = typeof rawVersion === 'number'
    ? integerInRange(rawVersion, 1, 1000000)
    : null;
  const hourlyRateKRW = integerInRange(source.hourlyRateKRW, 0, 10000000);
  const minMinutes = integerInRange(source.minMinutes, 1, 10080);
  const maxMinutes = integerInRange(source.maxMinutes, 1, 10080);
  const billingIncrementMinutes = integerInRange(source.billingIncrementMinutes, 1, 60);
  const distanceThresholdMeters = integerInRange(source.distanceThresholdMeters, 0, 3000000);
  const distanceRateKRWPerKm = integerInRange(source.distanceRateKRWPerKm, 0, 1000000);
  const vatBasisPoints = integerInRange(source.vatBasisPoints, 0, 10000);
  const overtimeRateKRW = integerInRange(source.overtimeRateKRW, 0, 10000000);
  const companyName = cleanLine(source.companyName, 100);
  const distanceBillingMode = cleanLine(source.distanceBillingMode, 60);
  const tollPolicy = cleanLine(source.tollPolicy, 30);
  const parkingPolicy = cleanLine(source.parkingPolicy, 30);

  if (!PROFILE_ID_RE.test(id)) return { ok: false, error: 'INVALID_PROFILE_ID' };
  if (!version) return { ok: false, error: 'INVALID_PROFILE_VERSION' };
  if (!companyName) return { ok: false, error: 'COMPANY_NAME_REQUIRED' };
  if (hourlyRateKRW === null) return { ok: false, error: 'INVALID_HOURLY_RATE' };
  if (minMinutes === null || maxMinutes === null || minMinutes > maxMinutes) {
    return { ok: false, error: 'INVALID_TIME_RANGE' };
  }
  if (billingIncrementMinutes === null || !BILLING_INCREMENTS.has(billingIncrementMinutes)) {
    return { ok: false, error: 'INVALID_BILLING_INCREMENT' };
  }
  if (distanceThresholdMeters === null || distanceRateKRWPerKm === null) {
    return { ok: false, error: 'INVALID_DISTANCE_RATE' };
  }
  if (!DISTANCE_MODE_SET.has(distanceBillingMode)) return { ok: false, error: 'INVALID_DISTANCE_MODE' };
  if (vatBasisPoints === null) return { ok: false, error: 'INVALID_VAT_RATE' };
  if (!TOLL_POLICY_SET.has(tollPolicy) || !PARKING_POLICY_SET.has(parkingPolicy)) {
    return { ok: false, error: 'INVALID_INCIDENTAL_POLICY' };
  }
  if (overtimeRateKRW === null) return { ok: false, error: 'INVALID_OVERTIME_RATE' };

  return {
    ok: true,
    profile: {
      id,
      version,
      builtIn: source.builtIn === true,
      archived: source.archived === true,
      companyName,
      logoUrl: safeHttpsUrl(source.logoUrl),
      contact: cleanLine(source.contact, 200),
      currency: 'KRW',
      timezone: 'Asia/Seoul',
      hourlyRateKRW,
      minMinutes,
      maxMinutes,
      billingIncrementMinutes,
      distanceThresholdMeters,
      distanceRateKRWPerKm,
      distanceBillingMode,
      vatBasisPoints,
      tollPolicy,
      parkingPolicy,
      overtimeRateKRW,
      overtimeIncludesVat: source.overtimeIncludesVat !== false,
      documentTitle: cleanLine(source.documentTitle, 100) || '전용 차량 일정 및 예상 견적',
      footer: cleanMultiline(source.footer, 1000),
    },
  };
}

function computeDistanceFeeKRW(profile, distanceMeters) {
  let billedMeters = 0;
  if (profile.distanceBillingMode === 'always') billedMeters = distanceMeters;
  if (profile.distanceBillingMode === 'all_distance_when_threshold_reached'
    && distanceMeters >= profile.distanceThresholdMeters) billedMeters = distanceMeters;
  if (profile.distanceBillingMode === 'excess_only'
    && distanceMeters >= profile.distanceThresholdMeters) {
    billedMeters = Math.max(0, distanceMeters - profile.distanceThresholdMeters);
  }
  // meter × (원/km) / 1000. 반원도 과소 견적되지 않도록 원 단위 올림.
  return Math.ceil((billedMeters * profile.distanceRateKRWPerKm) / 1000);
}

/**
 * 서버 견적 계산. VAT는 시간+거리 공급가액에만 적용하고 톨/주차 실비에는 재적용하지 않는다.
 */
export function calculateVehicleQuote(profileInput, input) {
  const normalized = normalizeVehicleQuoteProfile(profileInput, { fallback: BUILT_IN_MOOD_QUOTE_PROFILE });
  if (!normalized.ok) return normalized;
  const profile = normalized.profile;
  const source = input && typeof input === 'object' ? input : {};
  const timeMinutes = integerInRange(source.timeMinutes, 1, 10080);
  const distanceMeters = integerInRange(source.distanceMeters, 0, 3000000);
  const routeTollKRW = Object.prototype.hasOwnProperty.call(source, 'routeTollKRW')
    ? integerInRange(source.routeTollKRW, 0, 10000000)
    : 0;
  const manualTollKRW = Object.prototype.hasOwnProperty.call(source, 'manualTollKRW')
    ? integerInRange(source.manualTollKRW, 0, 10000000)
    : 0;
  const manualParkingKRW = Object.prototype.hasOwnProperty.call(source, 'manualParkingKRW')
    ? integerInRange(source.manualParkingKRW, 0, 10000000)
    : 0;
  if (timeMinutes === null) return { ok: false, error: 'INVALID_TIME_MINUTES' };
  if (timeMinutes > profile.maxMinutes) return { ok: false, error: 'MAX_TIME_EXCEEDED' };
  if (distanceMeters === null) return { ok: false, error: 'INVALID_DISTANCE_METERS' };
  if (routeTollKRW === null || manualTollKRW === null || manualParkingKRW === null) {
    return { ok: false, error: 'INVALID_INCIDENTAL_AMOUNT' };
  }

  const minimumAppliedMinutes = Math.max(profile.minMinutes, timeMinutes);
  const billableMinutes = Math.ceil(minimumAppliedMinutes / profile.billingIncrementMinutes)
    * profile.billingIncrementMinutes;
  const timeFeeKRW = Math.ceil((billableMinutes * profile.hourlyRateKRW) / 60);
  const distanceFeeKRW = computeDistanceFeeKRW(profile, distanceMeters);
  const taxableSupplyKRW = timeFeeKRW + distanceFeeKRW;
  const vatKRW = Math.round((taxableSupplyKRW * profile.vatBasisPoints) / 10000);

  let tollKRW = 0;
  if (profile.tollPolicy === 'route_estimate') tollKRW = routeTollKRW;
  if (profile.tollPolicy === 'manual') tollKRW = manualTollKRW;
  let parkingKRW = 0;
  if (profile.parkingPolicy === 'manual') parkingKRW = manualParkingKRW;
  const incidentalsKRW = tollKRW + parkingKRW;
  const totalKRW = taxableSupplyKRW + vatKRW + incidentalsKRW;

  return {
    ok: true,
    breakdown: {
      currency: 'KRW',
      timeMinutes,
      billableMinutes,
      hourlyRateKRW: profile.hourlyRateKRW,
      timeFeeKRW,
      distanceMeters,
      distanceRateKRWPerKm: profile.distanceRateKRWPerKm,
      distanceFeeKRW,
      taxableSupplyKRW,
      vatBasisPoints: profile.vatBasisPoints,
      vatKRW,
      tollKRW,
      parkingKRW,
      incidentalsKRW,
      totalKRW,
      overtimeRateKRW: profile.overtimeRateKRW,
      overtimeIncludesVat: profile.overtimeIncludesVat,
    },
  };
}

export function sanitizeQuoteStops(rawStops) {
  if (!Array.isArray(rawStops)) return [];
  if (rawStops.length > MAX_QUOTE_STOPS) {
    const error = new Error('TOO_MANY_STOPS');
    error.code = 'TOO_MANY_STOPS';
    throw error;
  }
  return rawStops.map((raw, index) => {
    const stop = raw && typeof raw === 'object' ? raw : {};
    const order = integerInRange(stop.order, 1, 1000) || index + 1;
    const rawArrivalTime = typeof stop.arrivalTime === 'string'
      ? cleanLine(stop.arrivalTime, 100)
      : '';
    const rawDepartureTime = typeof stop.departureTime === 'string'
      ? cleanLine(stop.departureTime, 100)
      : '';
    const arrivalTime = TIME_RE.test(rawArrivalTime) ? rawArrivalTime : '';
    const departureTime = TIME_RE.test(rawDepartureTime) ? rawDepartureTime : '';
    return {
      order,
      arrivalTime,
      departureTime,
      name: cleanLine(stop.name, 150),
      purpose: cleanLine(stop.purpose, 500),
      sourceRegion: typeof stop.sourceRegion === 'string'
        ? cleanLine(stop.sourceRegion, 100)
        : '',
      roadAddress: cleanLine(stop.roadAddress, 300),
      jibunAddress: cleanLine(stop.jibunAddress, 300),
      naverMapUrl: safeNaverMapUrl(stop.naverMapUrl),
      optional: stop.optional === true,
      includeInRoute: stop.includeInRoute !== false,
      addressVerified: stop.addressVerified === true,
    };
  }).sort((a, b) => a.order - b.order);
}

export function timeSpanMinutes(startTime, endTime) {
  if (typeof startTime !== 'string' || typeof endTime !== 'string') return null;
  const start = cleanLine(startTime, 100);
  const end = cleanLine(endTime, 100);
  if (!TIME_RE.test(start) || !TIME_RE.test(end)) return null;
  const [startHour, startMinute] = start.split(':').map(Number);
  const [endHour, endMinute] = end.split(':').map(Number);
  let diff = (endHour * 60 + endMinute) - (startHour * 60 + startMinute);
  if (diff <= 0) diff += 1440;
  return diff;
}

function formatKRW(value) {
  return `${Number(value || 0).toLocaleString('ko-KR')}원`;
}

function formatDuration(minutes) {
  if (minutes === 0) return '0분';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!rest) return `${hours}시간`;
  if (!hours) return `${rest}분`;
  return `${hours}시간 ${rest}분`;
}

function formatDistanceKm(meters, maximumFractionDigits = 3) {
  return (meters / 1000).toLocaleString('ko-KR', { maximumFractionDigits });
}

function distanceFeeExplanation(profile, breakdown) {
  const distanceText = `${formatDistanceKm(breakdown.distanceMeters)}km`;
  const thresholdText = `${formatDistanceKm(profile.distanceThresholdMeters)}km`;
  if (profile.distanceBillingMode === 'none') {
    return `거리 요금 미적용 = ${formatKRW(0)}`;
  }
  if (profile.distanceBillingMode === 'all_distance_when_threshold_reached'
    && breakdown.distanceMeters < profile.distanceThresholdMeters) {
    return `${distanceText}는 적용 기준 ${thresholdText} 미만 = ${formatKRW(0)}`;
  }
  if (profile.distanceBillingMode === 'excess_only') {
    if (breakdown.distanceMeters < profile.distanceThresholdMeters) {
      return `${distanceText}는 적용 기준 ${thresholdText} 미만 = ${formatKRW(0)}`;
    }
    const billedMeters = Math.max(0, breakdown.distanceMeters - profile.distanceThresholdMeters);
    return `초과 ${formatDistanceKm(billedMeters)}km × ${formatKRW(breakdown.distanceRateKRWPerKm)} = ${formatKRW(breakdown.distanceFeeKRW)} (총 ${distanceText} - 기준 ${thresholdText})`;
  }
  const thresholdNote = profile.distanceBillingMode === 'all_distance_when_threshold_reached'
    ? ` (적용 기준 ${thresholdText} 이상)`
    : '';
  return `${distanceText} × ${formatKRW(breakdown.distanceRateKRWPerKm)} = ${formatKRW(breakdown.distanceFeeKRW)}${thresholdNote}`;
}

function incidentalPolicyLine(label, policy, amountKRW) {
  if (policy === 'included') return `${label}: 요금에 포함 · 별도 청구 없음`;
  if (policy === 'route_estimate') return `${label} (경로 기반 예상액): ${formatKRW(amountKRW)}`;
  return `${label} (관리자 입력 예상액): ${formatKRW(amountKRW)}`;
}

function finalQuoteLabel(profile) {
  const includedParts = ['부가세'];
  if (profile.tollPolicy !== 'included') includedParts.push('통행료');
  if (profile.parkingPolicy !== 'included') includedParts.push('주차비');
  return `${includedParts.join('·')} 포함 최종 예상 금액:`;
}

function quoteBasisNotice(profile, breakdown) {
  const parts = [`약 ${(breakdown.distanceMeters / 1000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}km 운행`];
  if (profile.tollPolicy !== 'included') parts.push(`통행료 ${formatKRW(breakdown.tollKRW)}`);
  if (profile.parkingPolicy !== 'included') parts.push(`주차비 ${formatKRW(breakdown.parkingKRW)}`);
  return `※ 위 금액은 ${parts.join(', ')}을 기준으로 계산한 예상 견적입니다.`;
}

function quoteVariationNotice(profile) {
  const items = ['실제 이용시간', '운행거리'];
  if (profile.tollPolicy !== 'included') items.push('통행료');
  if (profile.parkingPolicy !== 'included') items.push('주차비');
  const subject = items.length === 2
    ? items.join(' 또는 ')
    : `${items.slice(0, -1).join(', ')}, 또는 ${items[items.length - 1]}`;
  return `※ ${subject}가 예상 범위를 초과하면 추가 금액이 발생할 수 있습니다.`;
}

function stopWaitMinutes(arrivalTime, departureTime) {
  if (typeof arrivalTime !== 'string' || typeof departureTime !== 'string') return null;
  if (!TIME_RE.test(arrivalTime) || !TIME_RE.test(departureTime)) return null;
  const [arrivalHour, arrivalMinute] = arrivalTime.split(':').map(Number);
  const [departureHour, departureMinute] = departureTime.split(':').map(Number);
  let diff = (departureHour * 60 + departureMinute) - (arrivalHour * 60 + arrivalMinute);
  if (diff < 0) diff += 1440;
  return diff;
}

function routeStopName(stop) {
  return stop ? (stop.name || `${stop.order}번 장소`) : '';
}

function formatKoreanTime(value) {
  if (typeof value !== 'string') return '시간 확인 필요';
  const cleanValue = cleanLine(value, 100);
  if (!TIME_RE.test(cleanValue)) return '시간 확인 필요';
  const [hour, minute] = cleanValue.split(':').map(Number);
  const period = hour < 12 ? '오전' : '오후';
  const displayHour = hour % 12 || 12;
  return minute ? `${period} ${displayHour}시 ${minute}분` : `${period} ${displayHour}시`;
}

function formatKoreanDate(value) {
  if (typeof value !== 'string') return '확인 필요';
  const cleanValue = cleanLine(value, 100);
  if (!validCalendarDate(cleanValue)) return '확인 필요';
  const [year, month, day] = cleanValue.split('-').map(Number);
  const weekdayIndex = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][weekdayIndex];
  return `${year}년 ${month}월 ${day}일 ${weekday}요일`;
}

/** 같은 snapshot에서 미리보기/복사/PDF가 공유할 고객용 한글 문서를 만든다. */
export function formatVehicleQuoteDocument({ profile, schedule, route, breakdown, warnings = [] }) {
  const stops = sanitizeQuoteStops(schedule && schedule.stops);
  const includedStops = stops.filter((stop) => stop.includeInRoute);
  const lines = [];
  lines.push(`[${profile.documentTitle}]`);
  lines.push('');
  lines.push(`업체명: ${profile.companyName}`);
  lines.push(`이용일: ${formatKoreanDate(schedule && schedule.serviceDate)}`);
  lines.push(`예상 차량 이용시간: ${formatDuration(breakdown.timeMinutes)}`);
  lines.push(`예상 이용시간: ${formatKoreanTime(schedule && schedule.startTime)} ~ ${formatKoreanTime(schedule && schedule.endTime)}`);
  lines.push('');

  const departureAddress = cleanLine(schedule && schedule.departureAddress, 300);
  const returnAddress = cleanLine(schedule && schedule.returnAddress, 300);
  if (departureAddress) {
    const firstDestination = includedStops[0]
      ? routeStopName(includedStops[0])
      : (returnAddress ? '복귀 장소' : '다음 장소');
    lines.push(`${formatKoreanTime(schedule && schedule.startTime)} – 출발지에서 ${firstDestination}로 출발`);
    lines.push(departureAddress);
    lines.push('');
  }

  for (const stop of stops) {
    const time = stop.arrivalTime || stop.departureTime;
    lines.push(`${formatKoreanTime(time)} – ${stop.optional ? '선택 일정: ' : ''}${stop.name || '장소 확인 필요'}`);
    if (!stop.includeInRoute) lines.push('차량 운행거리 산정 제외');
    if (stop.purpose) lines.push(stop.purpose);
    lines.push(stop.name || '장소명: 확인 필요');
    const waitMinutes = stopWaitMinutes(stop.arrivalTime, stop.departureTime);
    if (waitMinutes !== null) lines.push(`체류·대기 시간: ${formatDuration(waitMinutes)}`);
    lines.push(stop.roadAddress || '도로명 주소: 확인 필요');
    lines.push(`지번 주소: ${stop.jibunAddress || '확인 필요'}`);
    lines.push('');
    lines.push('네이버 지도:');
    lines.push(stop.naverMapUrl || '확인 필요');
    if (stop.includeInRoute && stop.departureTime) {
      lines.push('');
      const currentName = routeStopName(stop);
      const routeIndex = includedStops.indexOf(stop);
      const nextIncludedStop = includedStops[routeIndex + 1];
      const nextName = nextIncludedStop
        ? routeStopName(nextIncludedStop)
        : (returnAddress ? '복귀 장소' : '다음 장소');
      lines.push(`${formatKoreanTime(stop.departureTime)} – ${currentName}에서 ${nextName}로 출발`);
    }
    lines.push('');
  }

  if (returnAddress) {
    lines.push(`${formatKoreanTime(schedule && schedule.endTime)}경 – 복귀 장소 도착 및 일정 종료`);
    lines.push(returnAddress);
    lines.push('');
  }

  lines.push(`[${profile.companyName} 차량 예상 견적]`);
  lines.push('');
  lines.push('차량 이용시간:');
  lines.push(`${formatDuration(breakdown.billableMinutes)} × 시간당 ${formatKRW(breakdown.hourlyRateKRW)} = ${formatKRW(breakdown.timeFeeKRW)}`);
  lines.push('');
  lines.push('예상 총 운행거리:');
  lines.push(`약 ${(breakdown.distanceMeters / 1000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}km`);
  lines.push('');
  lines.push('거리 요금:');
  lines.push(distanceFeeExplanation(profile, breakdown));
  lines.push('');
  lines.push('차량 이용요금 공급가액:');
  lines.push(formatKRW(breakdown.taxableSupplyKRW));
  lines.push('');
  lines.push(`부가세 ${(breakdown.vatBasisPoints / 100).toLocaleString('ko-KR')}%:`);
  lines.push(formatKRW(breakdown.vatKRW));
  lines.push('');
  lines.push(incidentalPolicyLine('통행료', profile.tollPolicy, breakdown.tollKRW));
  lines.push(incidentalPolicyLine('주차비', profile.parkingPolicy, breakdown.parkingKRW));
  lines.push('');
  lines.push(finalQuoteLabel(profile));
  lines.push(formatKRW(breakdown.totalKRW));
  lines.push('');
  lines.push(quoteBasisNotice(profile, breakdown));
  lines.push(quoteVariationNotice(profile));
  lines.push(`※ 예정된 이용시간을 초과하는 경우 ${profile.overtimeIncludesVat ? '부가세를 포함해 ' : ''}시간당 ${formatKRW(profile.overtimeRateKRW)}의 추가 차량 이용요금이 발생합니다.`);
  if (warnings.length) {
    lines.push('');
    lines.push('[확인사항]');
    for (const warning of warnings) lines.push(`- ${cleanLine(warning, 500)}`);
  }
  if (profile.footer) {
    lines.push('');
    lines.push(profile.footer);
  }
  return lines.join('\n').trim();
}

export function validateScheduleBasics(input) {
  const source = input && typeof input === 'object' ? input : {};
  if (Array.isArray(source.stops) && source.stops.length > MAX_QUOTE_STOPS) {
    return { ok: false, error: 'TOO_MANY_STOPS' };
  }
  const serviceDate = typeof source.serviceDate === 'string'
    ? cleanLine(source.serviceDate, 100)
    : '';
  const startTime = typeof source.startTime === 'string'
    ? cleanLine(source.startTime, 100)
    : '';
  const endTime = typeof source.endTime === 'string'
    ? cleanLine(source.endTime, 100)
    : '';
  if (!validCalendarDate(serviceDate)) return { ok: false, error: 'INVALID_SERVICE_DATE' };
  if (!TIME_RE.test(startTime) || !TIME_RE.test(endTime)) return { ok: false, error: 'INVALID_SERVICE_TIME' };
  const hasExplicitMinutes = Object.prototype.hasOwnProperty.call(source, 'totalMinutes');
  const explicitMinutes = hasExplicitMinutes ? integerInRange(source.totalMinutes, 1, 10080) : null;
  if (hasExplicitMinutes && explicitMinutes === null) return { ok: false, error: 'INVALID_TIME_MINUTES' };
  const computedMinutes = timeSpanMinutes(startTime, endTime);
  const timeMinutes = explicitMinutes || computedMinutes;
  if (!timeMinutes) return { ok: false, error: 'INVALID_TIME_MINUTES' };
  return {
    ok: true,
    schedule: {
      serviceDate,
      startTime,
      endTime,
      timeMinutes,
      stops: sanitizeQuoteStops(source.stops),
      departureAddress: cleanLine(source.departureAddress, 300),
      returnAddress: cleanLine(source.returnAddress, 300),
    },
  };
}
