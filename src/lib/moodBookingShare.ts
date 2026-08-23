/**
 * MOOD 예약 공유 카드의 공개 데이터 계약과 복사 문구 생성기.
 *
 * 이 타입에는 직원 이메일과 선불 잔액을 의도적으로 두지 않는다. 예약 화면에서
 * 필요한 값만 이 형태로 옮기면 캡처 카드와 복사 문구가 항상 같은 숫자를 쓴다.
 */

export type MoodBookingSharePhase = 'expected' | 'final';
export type MoodBookingShareTollStatus = 'paid' | 'not-paid' | 'adjusted' | 'none';
export type MoodBookingShareTollMode = 'estimated' | 'none' | 'actual' | 'itemized';
export type MoodBookingSharePayer = 'mood' | 'influencer';
export type MoodCourseSharePreset = 'staff' | 'shared-airport' | 'event' | 'custom';

export interface MoodBookingShareStop {
  address: string;
  /** 이 번호 코스에서 MOOD가 부담하는 비율(0~100). */
  moodPercentage?: number | null;
  /** 구형 예약 호환: mood=100, influencer=0으로 변환한다. */
  payer?: MoodBookingSharePayer | null;
  /** 비워 두면 출발/경유/도착이 순서에 맞게 자동 표시된다. */
  label?: string | null;
  time?: string | null;
  lat?: number | null;
  lng?: number | null;
}

export interface MoodBookingShareRoutePoint {
  lat: number;
  lng: number;
  role?: 'origin' | 'waypoint' | 'destination';
  index?: number;
}

export interface MoodBookingShareRoute {
  km?: number | null;
  durationMin?: number | null;
  /** MOOD 경로 API와 같은 [경도, 위도] 배열. */
  path?: Array<[number, number]> | null;
  points?: MoodBookingShareRoutePoint[] | null;
}

export interface MoodBookingShareCostBreakdown {
  baseKRW?: number | null;
  distanceSurchargeKRW?: number | null;
  tollKRW?: number | null;
  adjustmentKRW?: number | null;
  adjustmentReason?: string | null;
  /** 정산 API의 tollMode를 그대로 넘길 수 있다. */
  tollMode?: MoodBookingShareTollMode | null;
  tollStatus?: MoodBookingShareTollStatus | null;
  tollNote?: string | null;
  totalKRW: number;
}

export interface MoodBookingShareData {
  bookingRef: string;
  phase: MoodBookingSharePhase;
  date: string;
  startTime: string;
  influencerName?: string | null;
  serviceLabel: string;
  durationHours?: number | null;
  stops: MoodBookingShareStop[];
  route?: MoodBookingShareRoute | null;
  costs: {
    expected: MoodBookingShareCostBreakdown;
    final?: MoodBookingShareCostBreakdown | null;
  };
  mapUrl?: string | null;
  note?: string | null;
}

export interface MoodBookingSharePayerTotal {
  totalKRW: number;
}

export interface MoodBookingShareCourseAllocation {
  courseNumber: number;
  amountKRW: number;
  moodPercentage: number;
  influencerPercentage: number;
  moodKRW: number;
  influencerKRW: number;
  stop: MoodBookingShareStop;
}

export interface MoodBookingShareCourseDistribution {
  courseCount: number;
  totalKRW: number;
  basePerCourseKRW: number;
  /** 원 단위로 나누고 남아 마지막 코스에 더한 금액. */
  remainderKRW: number;
  courses: MoodBookingShareCourseAllocation[];
  mood: MoodBookingSharePayerTotal;
  influencer: MoodBookingSharePayerTotal;
}

export interface MoodBookingShareTollPresentation {
  label: string;
  detail: string;
}

function finiteMoney(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0;
}

function hasFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function formatMoodShareKRW(value: number): string {
  const amount = finiteMoney(value);
  if (amount < 0) return `-${Math.abs(amount).toLocaleString('ko-KR')}원`;
  return `${amount.toLocaleString('ko-KR')}원`;
}

export function formatMoodShareSignedKRW(value: number): string {
  const amount = finiteMoney(value);
  if (amount > 0) return `+${formatMoodShareKRW(amount)}`;
  return formatMoodShareKRW(amount);
}

export function normalizeMoodCoursePercentages(
  raw: number[] | null | undefined,
  stopCount: number,
  legacyPayers?: MoodBookingSharePayer[] | null,
  fallbackPercentage = 100,
): number[] {
  const count = Math.max(0, Math.floor(Number(stopCount) || 0));
  const validRaw = Array.isArray(raw)
    && raw.length === count
    && raw.every((percentage) => Number.isInteger(percentage) && percentage >= 0 && percentage <= 100);
  if (validRaw) return raw.slice();
  const validLegacy = Array.isArray(legacyPayers)
    && legacyPayers.length === count
    && legacyPayers.every((payer) => payer === 'mood' || payer === 'influencer');
  if (validLegacy) return legacyPayers.map((payer) => payer === 'mood' ? 100 : 0);
  const fallback = Number.isInteger(fallbackPercentage) && fallbackPercentage >= 0 && fallbackPercentage <= 100
    ? fallbackPercentage
    : 100;
  return Array.from({ length: count }, () => fallback);
}

/** 새 경유지를 도착지 앞에 넣을 때 기존 도착지 부담률(0 포함)을 그대로 복제한다. */
export function appendMoodCoursePercentage(items: number[]): number[] {
  const lastPercentage = items[items.length - 1];
  const inheritedPercentage = lastPercentage === undefined ? 100 : lastPercentage;
  return [...items.slice(0, -1), inheritedPercentage, inheritedPercentage];
}

export function moodCourseSharePreset(percentages: number[]): MoodCourseSharePreset {
  if (percentages.length && percentages.every((value) => value === 100)) return 'staff';
  if (percentages.length && percentages.every((value) => value === 50)) return 'shared-airport';
  if (percentages.length && percentages.every((value) => value === 0)) return 'event';
  return 'custom';
}

export function courseSharePresetPercentage(preset: Exclude<MoodCourseSharePreset, 'custom'>): number {
  if (preset === 'shared-airport') return 50;
  if (preset === 'event') return 0;
  return 100;
}

/**
 * 전체 금액을 번호 코스 수로 동일 분배한다.
 * 원 단위로 나누고 남는 금액은 마지막 코스에 붙여 각 코스 합과 전체 금액을 맞춘다.
 */
export function allocateMoodShareCostByCourse(
  totalKRW: number,
  stops: MoodBookingShareStop[],
): MoodBookingShareCourseDistribution {
  const total = Math.max(0, finiteMoney(totalKRW));
  const validStops = (stops || []).filter((stop) => String(stop.address || '').trim());
  const courseCount = validStops.length;
  const basePerCourseKRW = courseCount > 0 ? Math.floor(total / courseCount) : 0;
  const remainderKRW = courseCount > 0 ? total - basePerCourseKRW * courseCount : 0;
  const courses = validStops.map((stop, index) => {
    const amountKRW = basePerCourseKRW + (index === courseCount - 1 ? remainderKRW : 0);
    const fallbackPercentage = stop.payer === 'influencer' ? 0 : 100;
    const moodPercentage = normalizeMoodCoursePercentages(
      typeof stop.moodPercentage === 'number' ? [stop.moodPercentage] : null,
      1,
      stop.payer ? [stop.payer] : null,
      fallbackPercentage,
    )[0];
    const moodKRW = Math.round(amountKRW * moodPercentage / 100);
    return {
      courseNumber: index + 1,
      amountKRW,
      moodPercentage,
      influencerPercentage: 100 - moodPercentage,
      moodKRW,
      influencerKRW: amountKRW - moodKRW,
      stop,
    };
  });
  return {
    courseCount,
    totalKRW: courseCount > 0 ? total : 0,
    basePerCourseKRW,
    remainderKRW,
    courses,
    mood: {
      totalKRW: courses.reduce((sum, course) => sum + course.moodKRW, 0),
    },
    influencer: {
      totalKRW: courses.reduce((sum, course) => sum + course.influencerKRW, 0),
    },
  };
}

export function moodSharePayerLabel(
  payer: MoodBookingSharePayer,
  influencerName?: string | null,
): string {
  if (payer === 'mood') return 'MOOD';
  const name = String(influencerName || '').trim();
  return name ? `인플루언서(${name})` : '인플루언서';
}

export function moodShareStopLabel(index: number, total: number): string {
  if (index === 0) return '출발';
  if (index === total - 1) return '도착';
  return `경유 ${index}`;
}

export function formatMoodShareDate(value: string): string {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value || '-';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) return value;
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][date.getDay()];
  return `${year}. ${month}. ${day}. (${weekday})`;
}

export function getMoodShareTollPresentation(
  expectedTollKRW: number | null | undefined,
  finalCost?: MoodBookingShareCostBreakdown | null,
): MoodBookingShareTollPresentation {
  const tollNote = String(finalCost && finalCost.tollNote || '').trim();
  const expected = finiteMoney(expectedTollKRW);
  if (!finalCost || !hasFiniteNumber(finalCost.tollKRW)) {
    return { label: '예상 톨비', detail: expected > 0 ? '예상 금액' : '통행료 없는 경로' };
  }

  const actual = finiteMoney(finalCost.tollKRW);
  if (finalCost.tollMode === 'none') return { label: '실제 톨비', detail: tollNote || '미지불' };
  if (finalCost.tollMode === 'estimated') return { label: '실제 톨비', detail: '예상대로 지불' };
  if (finalCost.tollMode === 'actual') return { label: '실제 톨비', detail: tollNote || '실제 금액 반영' };
  if (finalCost.tollMode === 'itemized') return { label: '실제 톨비', detail: tollNote || '항목별 실제 금액 반영' };
  const explicit = finalCost.tollStatus;
  if (explicit === 'not-paid') return { label: '실제 톨비', detail: tollNote || '미지불' };
  if (explicit === 'none') return { label: '실제 톨비', detail: '통행료 없음' };
  if (explicit === 'adjusted') return { label: '실제 톨비', detail: tollNote || '실제 금액 반영' };
  if (explicit === 'paid') return { label: '실제 톨비', detail: tollNote || '지불 완료' };
  if (expected === 0 && actual === 0) return { label: '실제 톨비', detail: '통행료 없음' };
  if (actual === 0) return { label: '실제 톨비', detail: '미지불' };
  if (actual === expected) return { label: '실제 톨비', detail: '예상대로 지불' };
  return { label: '실제 톨비', detail: '실제 금액 반영' };
}

function costValue(
  expected: MoodBookingShareCostBreakdown,
  finalCost: MoodBookingShareCostBreakdown,
  key: 'baseKRW' | 'distanceSurchargeKRW',
): number {
  const finalValue = finalCost[key];
  return hasFiniteNumber(finalValue) ? finiteMoney(finalValue) : finiteMoney(expected[key]);
}

function expectedCostLines(cost: MoodBookingShareCostBreakdown): string[] {
  return [
    `- 기본요금: ${formatMoodShareKRW(finiteMoney(cost.baseKRW))}`,
    `- 거리 추가요금: ${formatMoodShareKRW(finiteMoney(cost.distanceSurchargeKRW))}`,
    `- 예상 톨비: ${formatMoodShareKRW(finiteMoney(cost.tollKRW))}`,
    `- 예상 합계: ${formatMoodShareKRW(cost.totalKRW)}`,
  ];
}

function finalCostLines(
  expected: MoodBookingShareCostBreakdown,
  finalCost: MoodBookingShareCostBreakdown,
): string[] {
  const toll = getMoodShareTollPresentation(expected.tollKRW, finalCost);
  const lines = [
    `- 기본요금: ${formatMoodShareKRW(costValue(expected, finalCost, 'baseKRW'))}`,
    `- 거리 추가요금: ${formatMoodShareKRW(costValue(expected, finalCost, 'distanceSurchargeKRW'))}`,
    `- ${toll.label}: ${formatMoodShareKRW(finiteMoney(finalCost.tollKRW))} (${toll.detail})`,
  ];
  const adjustment = finiteMoney(finalCost.adjustmentKRW);
  if (adjustment !== 0 || finalCost.adjustmentReason) {
    const reason = finalCost.adjustmentReason ? ` (${finalCost.adjustmentReason})` : '';
    lines.push(`- 기타 조정: ${formatMoodShareSignedKRW(adjustment)}${reason}`);
  }
  lines.push(`- 최종 합계: ${formatMoodShareKRW(finalCost.totalKRW)}`);
  return lines;
}

/** 카카오톡 등에 그대로 붙여 넣을 수 있는 상세 안내문을 만든다. */
export function formatMoodBookingShareText(data: MoodBookingShareData): string {
  const isFinal = data.phase === 'final' && !!data.costs.final;
  const expected = data.costs.expected;
  const finalCost = isFinal ? data.costs.final as MoodBookingShareCostBreakdown : null;
  const activeTotal = finalCost ? finalCost.totalKRW : expected.totalKRW;
  const route = data.route || {};
  const routeBits: string[] = [];
  if (hasFiniteNumber(route.km)) routeBits.push(`${route.km.toLocaleString('ko-KR')}km`);
  if (hasFiniteNumber(route.durationMin)) routeBits.push(`약 ${Math.round(route.durationMin)}분`);
  const duration = hasFiniteNumber(data.durationHours) ? ` · ${data.durationHours}시간` : '';
  const stops = (data.stops || []).filter((stop) => String(stop.address || '').trim());
  const distribution = allocateMoodShareCostByCourse(activeTotal, stops);
  const lines = [
    isFinal ? '[MOOD 이동 정산 안내]' : '[MOOD 이동 예상 안내]',
    '',
    `예약번호: ${data.bookingRef || '-'}`,
    `탑승 인플루언서: ${String(data.influencerName || '').trim() || '미입력'}`,
    `일시: ${formatMoodShareDate(data.date)} ${data.startTime || '-'}`,
    `서비스: ${data.serviceLabel || '-'}${duration}`,
    '',
    '동선',
    ...distribution.courses.map((course, index) => {
      const stop = course.stop;
      const label = String(stop.label || '').trim() || moodShareStopLabel(index, stops.length);
      const time = String(stop.time || '').trim();
      const influencer = moodSharePayerLabel('influencer', data.influencerName);
      return `${index + 1}. [${label}] ${String(stop.address || '').trim()}${time ? ` · ${time}` : ''} · MOOD ${course.moodPercentage}% ${formatMoodShareKRW(course.moodKRW)} · ${influencer} ${course.influencerPercentage}% ${formatMoodShareKRW(course.influencerKRW)}`;
    }),
  ];

  if (routeBits.length) lines.push(`이동: ${routeBits.join(' · ')}`);
  lines.push('', '예약 예상 비용', ...expectedCostLines(expected));
  if (finalCost) lines.push('', '최종 정산 비용', ...finalCostLines(expected, finalCost));
  if (distribution.courseCount > 0) {
    const influencerLabel = moodSharePayerLabel('influencer', data.influencerName);
    lines.push(
      '',
      `${finalCost ? '최종' : '예상'} 코스별 비용 분담`,
      `- 계산: ${formatMoodShareKRW(distribution.totalKRW)} ÷ ${distribution.courseCount}코스`,
      `- 코스당 기본 금액: ${formatMoodShareKRW(distribution.basePerCourseKRW)}${distribution.remainderKRW > 0 ? ` (나머지 ${formatMoodShareKRW(distribution.remainderKRW)}은 마지막 코스 반영)` : ''}`,
      `- MOOD 부담 합계: ${formatMoodShareKRW(distribution.mood.totalKRW)}`,
      `- ${influencerLabel} 부담 합계: ${formatMoodShareKRW(distribution.influencer.totalKRW)}`,
    );
  }
  if (data.mapUrl) lines.push('', `동선 지도: ${data.mapUrl}`);
  if (data.note) lines.push('', `전달 메모: ${String(data.note).trim()}`);
  return lines.join('\n');
}

/** 보안 컨텍스트가 아니거나 구형 모바일 브라우저여도 textarea 방식으로 한 번 더 복사한다. */
export async function copyTextWithFallback(text: string): Promise<boolean> {
  const value = String(text || '');
  if (!value) return false;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // 클립보드 권한 거절 또는 비보안 컨텍스트면 아래의 선택 영역 복사로 재시도한다.
  }

  if (typeof document === 'undefined' || !document.body || typeof document.execCommand !== 'function') return false;
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  try {
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

export async function copyMoodBookingShare(data: MoodBookingShareData): Promise<boolean> {
  return copyTextWithFallback(formatMoodBookingShareText(data));
}
