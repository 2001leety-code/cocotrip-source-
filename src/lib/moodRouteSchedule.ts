/**
 * MOOD 차량 일정의 순수 자료형과 카카오톡 복사/붙여넣기 규칙.
 *
 * 주소는 기존 경로가 SSOT이고, 이 배열은 같은 인덱스의 도착/재출발 시각만 가진다.
 * 따라서 경로 순서를 바꿀 때 호출부가 주소와 이 항목을 반드시 한 묶음으로 옮겨야 한다.
 */

export interface MoodRouteScheduleStop {
  arrivalTime: string | null;
  pickupTime: string | null;
}

export interface MoodRouteScheduleValidationIssue {
  index: number;
  field: 'schedule' | 'arrivalTime' | 'pickupTime';
  message: string;
}

export interface MoodRouteScheduleValidationResult {
  valid: boolean;
  issues: MoodRouteScheduleValidationIssue[];
}

export interface MoodRouteScheduleTextInput {
  date?: string | null;
  addresses: string[];
  routeSchedule: MoodRouteScheduleStop[] | null | undefined;
  startTime?: string | null;
}

export interface MoodRouteScheduleParseResult {
  ok: boolean;
  date: string | null;
  startTime: string | null;
  addresses: string[];
  routeSchedule: MoodRouteScheduleStop[];
  errors: string[];
}

export const MOOD_ROUTE_SCHEDULE_MAX_STOPS = 7;
export const MOOD_ROUTE_SCHEDULE_MAX_SPAN_MINUTES = 15 * 60;

const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;
const STRICT_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const SCHEDULE_HEADING_PATTERN = /^\[(?:(\d{4})년\s+(\d{1,2})월\s+(\d{1,2})일\s+)?차량\s+(?:전체\s+)?일정\]$/;
const LEG_PATTERN = /^(\d+)\.\s+(.+?)\s+→\s+(.+)$/;
const LEG_TIME_PATTERN = /^출발\s+((?:다음 날\s+)?\d{1,2}:\d{2}|미입력)\s*\/\s*도착\s+((?:다음 날\s+)?\d{1,2}:\d{2}|미입력)$/;
const PICKUP_PATTERN = /^재출발\(픽업\)\s+((?:다음 날\s+)?\d{1,2}:\d{2})$/;

function safeCount(value: number): number {
  const count = Math.floor(Number(value) || 0);
  return Math.max(0, count);
}

function emptyScheduleStop(): MoodRouteScheduleStop {
  return { arrivalTime: null, pickupTime: null };
}

/** 9:05도 09:05로 정규화한다. 유효하지 않거나 빈 값이면 null이다. */
export function normalizeMoodRouteTime(value: unknown): string | null {
  const text = String(value || '').trim();
  const match = text.match(TIME_PATTERN);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function isMoodRouteTime(value: unknown): value is string {
  return typeof value === 'string' && STRICT_TIME_PATTERN.test(value);
}

/** 경로 개수에 맞는 빈 일정을 만들며 첫 출발은 예약 시작 시각으로 채운다. */
export function createMoodRouteSchedule(
  stopCount: number,
  startTime?: string | null,
): MoodRouteScheduleStop[] {
  const count = safeCount(stopCount);
  const schedule = Array.from({ length: count }, () => emptyScheduleStop());
  if (count > 0) schedule[0].pickupTime = normalizeMoodRouteTime(startTime);
  return schedule;
}

/**
 * 구형/부분 자료를 경로 개수에 맞춘다. 첫 행의 출발 시각은 예약 startTime을 SSOT로 삼고,
 * 첫 행의 도착과 마지막 행의 재출발은 역할상 사용하지 않는다.
 */
export function normalizeMoodRouteSchedule(
  raw: unknown,
  stopCount: number,
  startTime?: string | null,
): MoodRouteScheduleStop[] {
  const count = safeCount(stopCount);
  const items = Array.isArray(raw) ? raw : [];
  const normalized = Array.from({ length: count }, (_, index) => {
    const source = items[index];
    if (!source || typeof source !== 'object') return emptyScheduleStop();
    const candidate = source as { arrivalTime?: unknown; pickupTime?: unknown };
    return {
      arrivalTime: normalizeMoodRouteTime(candidate.arrivalTime),
      pickupTime: normalizeMoodRouteTime(candidate.pickupTime),
    };
  });

  if (!count) return normalized;
  const normalizedStart = normalizeMoodRouteTime(startTime);
  normalized[0].arrivalTime = null;
  normalized[0].pickupTime = normalizedStart || normalized[0].pickupTime;
  if (count > 1) normalized[count - 1].pickupTime = null;
  return normalized;
}

/** 저장 직전 자료형·길이·역할을 검사한다. 빈 시각은 허용하지만 잘못된 시각은 거부한다. */
export function validateMoodRouteSchedule(
  raw: unknown,
  stopCount: number,
  startTime?: string | null,
): MoodRouteScheduleValidationResult {
  const count = safeCount(stopCount);
  const issues: MoodRouteScheduleValidationIssue[] = [];
  if (!Array.isArray(raw)) {
    return {
      valid: false,
      issues: [{ index: -1, field: 'schedule', message: '일정 배열이 필요합니다.' }],
    };
  }
  if (count > MOOD_ROUTE_SCHEDULE_MAX_STOPS) {
    issues.push({ index: -1, field: 'schedule', message: `장소는 최대 ${MOOD_ROUTE_SCHEDULE_MAX_STOPS}곳까지 입력할 수 있습니다.` });
  }
  if (raw.length !== count) {
    issues.push({ index: -1, field: 'schedule', message: `일정은 경로 ${count}곳과 같은 개수여야 합니다.` });
  }

  raw.slice(0, count).forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      issues.push({ index, field: 'schedule', message: `${index + 1}번 일정 형식이 올바르지 않습니다.` });
      return;
    }
    const candidate = item as { arrivalTime?: unknown; pickupTime?: unknown };
    (['arrivalTime', 'pickupTime'] as const).forEach((field) => {
      const value = candidate[field];
      if (value === null || value === undefined || String(value).trim() === '') return;
      if (!normalizeMoodRouteTime(value)) {
        issues.push({ index, field, message: `${index + 1}번 시각은 HH:mm 형식이어야 합니다.` });
      }
    });
    if (index === 0 && normalizeMoodRouteTime(candidate.arrivalTime)) {
      issues.push({ index, field: 'arrivalTime', message: '출발지에는 도착 시각을 입력하지 않습니다.' });
    }
    if (count > 1 && index === count - 1 && normalizeMoodRouteTime(candidate.pickupTime)) {
      issues.push({ index, field: 'pickupTime', message: '최종 도착지에는 재출발 시각을 입력하지 않습니다.' });
    }
  });

  const normalizedStart = normalizeMoodRouteTime(startTime);
  if (count > 0 && normalizedStart && raw[0] && typeof raw[0] === 'object') {
    const firstPickup = normalizeMoodRouteTime((raw[0] as { pickupTime?: unknown }).pickupTime);
    if (firstPickup !== normalizedStart) {
      issues.push({ index: 0, field: 'pickupTime', message: '첫 출발 시각은 예약 시작 시각과 같아야 합니다.' });
    }
  }

  let firstKnownMinutes: number | null = null;
  let previousMinutes: number | null = null;
  let dayOffset = 0;
  let crossedMidnight = false;
  raw.slice(0, count).forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const candidate = item as { arrivalTime?: unknown; pickupTime?: unknown };
    (['arrivalTime', 'pickupTime'] as const).forEach((field) => {
      const minutes = timeToMinutes(normalizeMoodRouteTime(candidate[field]));
      if (minutes === null) return;
      let absoluteMinutes = minutes + dayOffset;
      if (previousMinutes !== null && absoluteMinutes < previousMinutes) {
        if (crossedMidnight) {
          issues.push({ index, field, message: '일정 시각은 순서대로 입력하고 자정은 한 번만 넘길 수 있습니다.' });
          return;
        }
        crossedMidnight = true;
        dayOffset += 1440;
        absoluteMinutes = minutes + dayOffset;
      }
      if (previousMinutes !== null && absoluteMinutes < previousMinutes) {
        issues.push({ index, field, message: '일정 시각 순서를 확인해 주세요.' });
        return;
      }
      if (firstKnownMinutes === null) firstKnownMinutes = absoluteMinutes;
      previousMinutes = absoluteMinutes;
    });
  });
  if (
    firstKnownMinutes !== null
    && previousMinutes !== null
    && previousMinutes - firstKnownMinutes > MOOD_ROUTE_SCHEDULE_MAX_SPAN_MINUTES
  ) {
    issues.push({
      index: -1,
      field: 'schedule',
      message: '전체 일정은 첫 출발부터 마지막 시각까지 15시간 이내여야 합니다.',
    });
  }
  return { valid: issues.length === 0, issues };
}

function timeToMinutes(value: string | null | undefined): number | null {
  const normalized = normalizeMoodRouteTime(value);
  if (!normalized) return null;
  const parts = normalized.split(':');
  return Number(parts[0]) * 60 + Number(parts[1]);
}

function minutesToTime(value: number): string {
  const wrapped = ((Math.round(value) % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

interface ParsedMoodRouteClock {
  time: string | null;
  nextDay: boolean;
}

/** 종료 시각이 더 이르면 다음 날로 보고 자정을 한 번만 넘긴 경과 분을 반환한다. */
export function getMoodRouteElapsedMinutes(
  startTime: string | null | undefined,
  endTime: string | null | undefined,
): number | null {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  if (start === null || end === null) return null;
  return end >= start ? end - start : end + 1440 - start;
}

export function getMoodRouteWaitMinutes(stop: MoodRouteScheduleStop | null | undefined): number | null {
  if (!stop) return null;
  return getMoodRouteElapsedMinutes(stop.arrivalTime, stop.pickupTime);
}

/** `2시간`, `1시간 30분`, `45분`처럼 카톡에서 바로 읽히는 길이로 표시한다. */
export function formatMoodRouteWait(minutes: number | null | undefined): string {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes < 0) return '';
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  if (!hours) return `${remainder}분`;
  if (!remainder) return `${hours}시간`;
  return `${hours}시간 ${remainder}분`;
}

/** 도착 시각을 기준으로 빠른 대기시간을 적용한다. 24시간 미만만 허용한다. */
export function setMoodRouteStopWaitMinutes(
  stop: MoodRouteScheduleStop,
  minutes: number,
): MoodRouteScheduleStop {
  const arrival = timeToMinutes(stop && stop.arrivalTime);
  const wait = Math.round(Number(minutes));
  if (arrival === null || !Number.isFinite(wait) || wait < 0 || wait >= 1440) return { ...stop };
  return { ...stop, pickupTime: minutesToTime(arrival + wait) };
}

export function formatMoodRouteScheduleStopSummary(
  stop: MoodRouteScheduleStop | null | undefined,
  index: number,
  total: number,
): string {
  if (!stop) return '시간 미입력';
  const parts: string[] = [];
  if (index === 0) {
    if (stop.pickupTime) parts.push(`출발 ${stop.pickupTime}`);
  } else {
    if (stop.arrivalTime) parts.push(`도착 ${stop.arrivalTime}`);
    if (index < total - 1 && stop.pickupTime) parts.push(`재출발 ${stop.pickupTime}`);
    const wait = index < total - 1 ? getMoodRouteWaitMinutes(stop) : null;
    if (wait !== null) parts.push(`대기 ${formatMoodRouteWait(wait)}`);
  }
  return parts.join(' · ') || '시간 미입력';
}

function scheduleHeading(date?: string | null): string {
  const match = String(date || '').match(DATE_PATTERN);
  if (!match) return '[차량 전체 일정]';
  return `[${Number(match[1])}년 ${Number(match[2])}월 ${Number(match[3])}일 차량 전체 일정]`;
}

interface MoodRouteScheduleDayFlags {
  arrivalNextDay: boolean;
  pickupNextDay: boolean;
}

/** 시각 배열 자체는 날짜를 저장하지 않으므로 첫 시각보다 시계가 작아지는 지점부터 다음 날로 표시한다. */
function moodRouteScheduleDayFlags(routeSchedule: MoodRouteScheduleStop[]): MoodRouteScheduleDayFlags[] {
  let previousMinutes: number | null = null;
  let nextDay = false;
  return routeSchedule.map((stop) => {
    const flags: MoodRouteScheduleDayFlags = { arrivalNextDay: false, pickupNextDay: false };
    (['arrivalTime', 'pickupTime'] as const).forEach((field) => {
      const minutes = timeToMinutes(stop[field]);
      if (minutes === null) return;
      if (previousMinutes !== null && minutes < previousMinutes && !nextDay) nextDay = true;
      if (field === 'arrivalTime') flags.arrivalNextDay = nextDay;
      else flags.pickupNextDay = nextDay;
      previousMinutes = minutes;
    });
    return flags;
  });
}

export function formatMoodRouteScheduleClock(
  time: string | null | undefined,
  nextDay = false,
): string {
  const normalized = normalizeMoodRouteTime(time);
  if (!normalized) return '미입력';
  return nextDay ? `다음 날 ${normalized}` : normalized;
}

/** 전체 주소와 시각을 모바일 일반 텍스트로 출력한다. */
export function formatMoodRouteScheduleText(input: MoodRouteScheduleTextInput): string {
  const addresses = (input.addresses || []).map((address) => String(address || '').trim());
  if (addresses.length < 2 || addresses.some((address) => !address)) return '';
  const routeSchedule = normalizeMoodRouteSchedule(
    input.routeSchedule,
    addresses.length,
    input.startTime,
  );
  const dayFlags = moodRouteScheduleDayFlags(routeSchedule);
  const lines: string[] = [scheduleHeading(input.date), ''];

  for (let index = 0; index < addresses.length - 1; index += 1) {
    const from = routeSchedule[index];
    const to = routeSchedule[index + 1];
    const fromFlags = dayFlags[index];
    const toFlags = dayFlags[index + 1];
    lines.push(`${index + 1}. ${addresses[index]} → ${addresses[index + 1]}`);
    lines.push(`출발 ${formatMoodRouteScheduleClock(from.pickupTime, fromFlags.pickupNextDay)} / 도착 ${formatMoodRouteScheduleClock(to.arrivalTime, toFlags.arrivalNextDay)}`);
    if (index + 1 < addresses.length - 1) {
      const waitMinutes = getMoodRouteWaitMinutes(to);
      if (waitMinutes !== null) lines.push(`대기 ${formatMoodRouteWait(waitMinutes)}`);
      if (to.pickupTime) lines.push(`재출발(픽업) ${formatMoodRouteScheduleClock(to.pickupTime, toFlags.pickupNextDay)}`);
    }
    if (index < addresses.length - 2) lines.push('');
  }
  return lines.join('\n');
}

function parsedClock(value: string): ParsedMoodRouteClock {
  if (value === '미입력') return { time: null, nextDay: false };
  const nextDay = /^다음 날\s+/.test(value);
  return {
    time: normalizeMoodRouteTime(value.replace(/^다음 날\s+/, '')),
    nextDay,
  };
}

function explicitDayMarkerErrors(tokens: ParsedMoodRouteClock[]): string[] {
  if (!tokens.some((token) => token.nextDay)) return [];
  const known = tokens.filter((token): token is ParsedMoodRouteClock & { time: string } => Boolean(token.time));
  if (!known.length) return [];

  const errors: string[] = [];
  const absoluteMinutes = known.map((token) => Number(timeToMinutes(token.time)) + (token.nextDay ? 1440 : 0));
  if (absoluteMinutes.some((minutes, index) => index > 0 && minutes < absoluteMinutes[index - 1])) {
    errors.push('다음 날 표시와 일정 시각 순서를 확인해 주세요.');
  }
  if (absoluteMinutes[absoluteMinutes.length - 1] - absoluteMinutes[0] > MOOD_ROUTE_SCHEDULE_MAX_SPAN_MINUTES) {
    errors.push('전체 일정은 첫 출발부터 마지막 시각까지 15시간 이내여야 합니다.');
  }

  let previousMinutes: number | null = null;
  let dayOffset = 0;
  let crossedMidnight = false;
  for (const token of known) {
    const clockMinutes = Number(timeToMinutes(token.time));
    let inferredMinutes = clockMinutes + dayOffset;
    if (previousMinutes !== null && inferredMinutes < previousMinutes) {
      if (crossedMidnight) {
        if (!errors.includes('다음 날 표시와 일정 시각 순서를 확인해 주세요.')) {
          errors.push('다음 날 표시와 일정 시각 순서를 확인해 주세요.');
        }
        break;
      }
      crossedMidnight = true;
      dayOffset += 1440;
      inferredMinutes = clockMinutes + dayOffset;
    }
    if (token.nextDay !== (dayOffset > 0)) {
      if (!errors.includes('다음 날 표시와 일정 시각 순서를 확인해 주세요.')) {
        errors.push('다음 날 표시와 일정 시각 순서를 확인해 주세요.');
      }
      break;
    }
    previousMinutes = inferredMinutes;
  }
  return errors;
}

/** 이 모듈이 만든 전체 일정 블록을 다시 주소+일정 배열로 결정적으로 복원한다. */
export function parseMoodRouteScheduleText(value: string): MoodRouteScheduleParseResult {
  const lines = String(value || '').replace(/\r\n?/g, '\n').split('\n').map((line) => line.trim());
  const errors: string[] = [];
  let headingIndex = -1;
  let date: string | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index].match(SCHEDULE_HEADING_PATTERN);
    if (!heading) continue;
    headingIndex = index;
    if (heading[1]) {
      const month = String(Number(heading[2])).padStart(2, '0');
      const day = String(Number(heading[3])).padStart(2, '0');
      const candidate = `${heading[1]}-${month}-${day}`;
      const parsedDate = new Date(Number(heading[1]), Number(heading[2]) - 1, Number(heading[3]));
      if (
        parsedDate.getFullYear() === Number(heading[1])
        && parsedDate.getMonth() === Number(heading[2]) - 1
        && parsedDate.getDate() === Number(heading[3])
      ) date = candidate;
      else errors.push('일정 날짜가 올바르지 않습니다.');
    }
    break;
  }

  if (headingIndex < 0) {
    return { ok: false, date: null, startTime: null, addresses: [], routeSchedule: [], errors: ['차량 일정 제목을 찾지 못했습니다.'] };
  }

  const addresses: string[] = [];
  const routeSchedule: MoodRouteScheduleStop[] = [];
  const parsedClocks: ParsedMoodRouteClock[] = [];
  let cursor = headingIndex + 1;
  let expectedLeg = 1;
  while (cursor < lines.length) {
    while (cursor < lines.length && !lines[cursor]) cursor += 1;
    const leg = cursor < lines.length ? lines[cursor].match(LEG_PATTERN) : null;
    if (!leg) break;
    const legNumber = Number(leg[1]);
    const fromAddress = String(leg[2] || '').trim();
    const toAddress = String(leg[3] || '').trim();
    if (legNumber !== expectedLeg) errors.push(`${expectedLeg}번 이동 구간 순서가 올바르지 않습니다.`);
    if (!fromAddress || !toAddress) errors.push(`${legNumber}번 이동 구간 주소가 비어 있습니다.`);
    if (!addresses.length) {
      addresses.push(fromAddress, toAddress);
      routeSchedule.push(emptyScheduleStop(), emptyScheduleStop());
    } else {
      if (addresses[addresses.length - 1] !== fromAddress) errors.push(`${legNumber}번 출발 주소가 앞 구간 도착 주소와 다릅니다.`);
      addresses.push(toAddress);
      routeSchedule.push(emptyScheduleStop());
    }
    cursor += 1;
    const timeLine = cursor < lines.length ? lines[cursor].match(LEG_TIME_PATTERN) : null;
    if (!timeLine) {
      errors.push(`${legNumber}번 이동 구간의 출발/도착 시각을 읽지 못했습니다.`);
      break;
    }
    const departureClock = parsedClock(timeLine[1]);
    const arrivalClock = parsedClock(timeLine[2]);
    const departure = departureClock.time;
    const arrival = arrivalClock.time;
    parsedClocks.push(departureClock, arrivalClock);
    if (timeLine[1] !== '미입력' && !departure) errors.push(`${legNumber}번 출발 시각이 올바르지 않습니다.`);
    if (timeLine[2] !== '미입력' && !arrival) errors.push(`${legNumber}번 도착 시각이 올바르지 않습니다.`);
    const fromIndex = addresses.length - 2;
    const toIndex = addresses.length - 1;
    const existingDeparture = routeSchedule[fromIndex].pickupTime;
    if (existingDeparture && departure && existingDeparture !== departure) {
      errors.push(`${legNumber}번 출발 시각이 앞 구간 재출발 시각과 다릅니다.`);
    }
    routeSchedule[fromIndex].pickupTime = departure;
    routeSchedule[toIndex].arrivalTime = arrival;
    cursor += 1;

    if (cursor < lines.length && lines[cursor].startsWith('대기 ')) cursor += 1;
    const pickup = cursor < lines.length ? lines[cursor].match(PICKUP_PATTERN) : null;
    if (pickup) {
      const pickupClock = parsedClock(pickup[1]);
      parsedClocks.push(pickupClock);
      routeSchedule[toIndex].pickupTime = pickupClock.time;
      cursor += 1;
    }
    expectedLeg += 1;
  }

  if (expectedLeg === 1) errors.push('이동 구간을 찾지 못했습니다.');
  if (routeSchedule.length > 1) routeSchedule[routeSchedule.length - 1].pickupTime = null;
  explicitDayMarkerErrors(parsedClocks).forEach((error) => {
    if (!errors.includes(error)) errors.push(error);
  });
  const startTime = routeSchedule.length ? routeSchedule[0].pickupTime : null;
  if (routeSchedule.length) {
    const validation = validateMoodRouteSchedule(routeSchedule, routeSchedule.length, startTime);
    validation.issues.forEach((issue) => {
      if (!errors.includes(issue.message)) errors.push(issue.message);
    });
  }
  return {
    ok: errors.length === 0,
    date,
    startTime,
    addresses,
    routeSchedule,
    errors,
  };
}
