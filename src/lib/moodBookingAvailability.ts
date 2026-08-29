/**
 * MOOD 예약 차단 설정의 프론트 미러.
 *
 * 실제 /mood 화면은 서버가 내려 준 설정만 신뢰한다. 누락·손상 시 fail closed이며
 * 과거 날짜 기반 규칙을 클라이언트에서 임의로 되살리지 않는다.
 */
export type MoodBookingBlockMode = 'full_day' | 'starts_from';

export interface MoodBookingBlockRule {
  id: string;
  enabled: boolean;
  startDate: string;
  endDate: string;
  weekdays: number[];
  mode: MoodBookingBlockMode;
  startTime: string | null;
  reason: string;
}

export interface MoodBookingOpenException {
  id: string;
  enabled: boolean;
  startDate: string;
  endDate: string;
  ruleIds: string[];
  reason: string;
}

export interface MoodBookingAvailability {
  schemaVersion: 1;
  revision: number;
  rules: MoodBookingBlockRule[];
  exceptions: MoodBookingOpenException[];
}

export interface MoodBookingBlockStatus {
  blocked: boolean;
  availabilityReady: boolean;
  rule: MoodBookingBlockRule | null;
}

export interface MoodBookingDateRestriction {
  fullDay: boolean;
  startTime: string | null;
  reason: string;
  rules: MoodBookingBlockRule[];
}

export const MOOD_BOOKING_AVAILABILITY_UNAVAILABLE_MESSAGE = '예약 차단 설정을 확인할 수 없습니다. 새로고침 후 다시 시도해 주세요.';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];
const RULE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/;
const MAX_RULES = 50;
const MAX_EXCEPTIONS = 100;
const MAX_EXCEPTION_DAYS = 366;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isoWeekday(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) return null;

  return parsed.getUTCDay();
}

function timeMinutes(startTime: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(startTime);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function parseRule(value: unknown): MoodBookingBlockRule | null {
  if (!isPlainObject(value)) return null;
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const startDate = typeof value.startDate === 'string' ? value.startDate : '';
  const endDate = typeof value.endDate === 'string' ? value.endDate : '';
  const reason = typeof value.reason === 'string' ? value.reason.trim() : '';
  const mode = value.mode;
  const weekdays = value.weekdays;

  if (!RULE_ID_RE.test(id) || typeof value.enabled !== 'boolean') return null;
  if (isoWeekday(startDate) === null || isoWeekday(endDate) === null || startDate > endDate) return null;
  if (!Array.isArray(weekdays) || weekdays.length < 1 || weekdays.length > 7) return null;
  if (!weekdays.every((day) => Number.isInteger(day) && day >= 0 && day <= 6)) return null;
  if (new Set(weekdays).size !== weekdays.length) return null;
  if (mode !== 'full_day' && mode !== 'starts_from') return null;
  if (mode === 'full_day' && value.startTime !== null) return null;
  if (mode === 'starts_from' && (typeof value.startTime !== 'string' || timeMinutes(value.startTime) === null)) return null;
  if (!reason || reason.length > 500) return null;

  return {
    id,
    enabled: value.enabled,
    startDate,
    endDate,
    weekdays: [...weekdays].sort((left, right) => left - right),
    mode,
    startTime: mode === 'starts_from' ? String(value.startTime) : null,
    reason,
  };
}

function inclusiveDateCount(startDate: string, endDate: string): number | null {
  if (isoWeekday(startDate) === null || isoWeekday(endDate) === null || startDate > endDate) return null;
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.floor((end - start) / (24 * 60 * 60 * 1000)) + 1;
}

function parseException(value: unknown): MoodBookingOpenException | null {
  if (!isPlainObject(value)) return null;
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const startDate = typeof value.startDate === 'string' ? value.startDate : '';
  const endDate = typeof value.endDate === 'string' ? value.endDate : '';
  const reason = typeof value.reason === 'string' ? value.reason.trim() : '';
  const ruleIds = value.ruleIds;
  const dayCount = inclusiveDateCount(startDate, endDate);

  if (!RULE_ID_RE.test(id) || typeof value.enabled !== 'boolean') return null;
  if (dayCount === null || dayCount > MAX_EXCEPTION_DAYS) return null;
  if (!Array.isArray(ruleIds) || ruleIds.length < 1 || ruleIds.length > MAX_RULES) return null;
  if (!ruleIds.every((ruleId) => typeof ruleId === 'string' && RULE_ID_RE.test(ruleId))) return null;
  if (new Set(ruleIds).size !== ruleIds.length) return null;
  if (!reason || reason.length > 500) return null;

  return {
    id,
    enabled: value.enabled,
    startDate,
    endDate,
    ruleIds: [...ruleIds],
    reason,
  };
}

/** 서버 payload 를 엄격히 검사한다. 하나라도 손상되면 일부 규칙만 조용히 적용하지 않는다. */
export function parseMoodBookingAvailability(value: unknown): MoodBookingAvailability | null {
  if (!isPlainObject(value)) return null;
  if (value.schemaVersion !== 1 || !Number.isInteger(value.revision) || Number(value.revision) < 0) return null;
  if (!Array.isArray(value.rules) || value.rules.length > MAX_RULES) return null;
  const rules = value.rules.map(parseRule);
  if (rules.some((rule) => !rule)) return null;
  const safeRules = rules as MoodBookingBlockRule[];
  if (new Set(safeRules.map((rule) => rule.id)).size !== safeRules.length) return null;
  const rawExceptions = value.exceptions === undefined ? [] : value.exceptions;
  if (!Array.isArray(rawExceptions) || rawExceptions.length > MAX_EXCEPTIONS) return null;
  const exceptions = rawExceptions.map(parseException);
  if (exceptions.some((exception) => !exception)) return null;
  const safeExceptions = exceptions as MoodBookingOpenException[];
  if (new Set(safeExceptions.map((exception) => exception.id)).size !== safeExceptions.length) return null;
  const ruleIdSet = new Set(safeRules.map((rule) => rule.id));
  if (safeExceptions.some((exception) => exception.ruleIds.some((ruleId) => !ruleIdSet.has(ruleId)))) return null;
  return { schemaVersion: 1, revision: Number(value.revision), rules: safeRules, exceptions: safeExceptions };
}

function resolveAvailability(value: MoodBookingAvailability | null | undefined): MoodBookingAvailability | null {
  return parseMoodBookingAvailability(value);
}

function matchingRules(date: string, availability: MoodBookingAvailability | null | undefined): MoodBookingBlockRule[] {
  const safe = resolveAvailability(availability);
  const weekday = isoWeekday(date);
  if (!safe || weekday === null) return [];
  const dateIsOpen = safe.exceptions.some((exception) => (
    exception.enabled
    && date >= exception.startDate
    && date <= exception.endDate
  ));
  if (dateIsOpen) return [];
  // startDate와 endDate는 모두 포함(inclusive)하는 한국 달력 날짜 경계다.
  return safe.rules.filter((rule) => (
    rule.enabled
    && date >= rule.startDate
    && date <= rule.endDate
    && rule.weekdays.includes(weekday)
  ));
}

/** 해당 날짜 전체에 걸린 차단 요약. 캘린더 배지와 날짜 안내가 함께 쓴다. */
export function getMoodBookingDateRestriction(
  date: string,
  availability?: MoodBookingAvailability | null,
): MoodBookingDateRestriction | null {
  const rules = matchingRules(date, availability);
  if (!rules.length) return null;
  const fullDayRule = rules.find((rule) => rule.mode === 'full_day');
  if (fullDayRule) {
    return { fullDay: true, startTime: null, reason: fullDayRule.reason, rules };
  }
  const timed = rules
    .filter((rule) => rule.startTime)
    .sort((left, right) => String(left.startTime).localeCompare(String(right.startTime)));
  if (!timed.length) return null;
  return { fullDay: false, startTime: timed[0].startTime, reason: timed[0].reason, rules };
}

/** 신규 예약에 적용되는 차단 상태. 설정 누락·손상은 availabilityReady=false + blocked=true. */
export function getMoodBookingBlockStatus(
  date: string,
  startTime: string,
  availability?: MoodBookingAvailability | null,
): MoodBookingBlockStatus {
  const safe = resolveAvailability(availability);
  if (!safe) return { blocked: true, availabilityReady: false, rule: null };
  const minutes = timeMinutes(startTime);
  if (isoWeekday(date) === null || minutes === null) {
    return { blocked: false, availabilityReady: true, rule: null };
  }
  const rules = matchingRules(date, safe);
  const fullDayRule = rules.find((rule) => rule.mode === 'full_day');
  if (fullDayRule) return { blocked: true, availabilityReady: true, rule: fullDayRule };
  const timedRule = rules
    .filter((rule) => rule.startTime && minutes >= Number(timeMinutes(String(rule.startTime))))
    .sort((left, right) => String(left.startTime).localeCompare(String(right.startTime)))[0];
  return { blocked: Boolean(timedRule), availabilityReady: true, rule: timedRule || null };
}

export function isMoodBookingBlocked(
  date: string,
  startTime: string,
  availability?: MoodBookingAvailability | null,
): boolean {
  return getMoodBookingBlockStatus(date, startTime, availability).blocked;
}

/** 정확히 같은 확정 날짜·시각은 새 차단 규칙과 무관하게 유지할 수 있다. */
export function isMoodBookingChangeBlocked(
  originalDate: string,
  originalStartTime: string,
  nextDate: string,
  nextStartTime: string,
  availability?: MoodBookingAvailability | null,
): boolean {
  if (!resolveAvailability(availability)) return true;
  if (originalDate === nextDate && originalStartTime === nextStartTime) return false;
  return isMoodBookingBlocked(nextDate, nextStartTime, availability);
}

export function formatMoodBookingTime(value: string | null): string {
  if (!value || timeMinutes(value) === null) return '';
  const [hourText, minuteText] = value.split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const period = hour < 12 ? '오전' : '오후';
  const displayHour = hour % 12 || 12;
  return `${period} ${displayHour}시${minute ? ` ${minute}분` : ''}`;
}

export function formatMoodBookingRuleSummary(rule: MoodBookingBlockRule): string {
  const start = `${Number(rule.startDate.slice(5, 7))}월 ${Number(rule.startDate.slice(8, 10))}일`;
  const end = `${Number(rule.endDate.slice(5, 7))}월 ${Number(rule.endDate.slice(8, 10))}일`;
  const dateRange = rule.startDate === rule.endDate ? start : `${start}~${end}`;
  const weekdays = rule.weekdays.length === 7
    ? '매일'
    : rule.weekdays.map((day) => WEEKDAY_LABELS[day]).join('·');
  const block = rule.mode === 'full_day'
    ? '하루 종일 예약 불가'
    : `${formatMoodBookingTime(rule.startTime)} 이후 시작 예약 불가`;
  return `${dateRange} ${weekdays} · ${block}`;
}

export function formatMoodBookingRestrictionLabel(restriction: MoodBookingDateRestriction): string {
  return restriction.fullDay
    ? '하루 종일 예약 불가'
    : `${formatMoodBookingTime(restriction.startTime)} 이후 시작 예약 불가`;
}

/** 아직 끝나지 않은 활성 규칙만 공지에 노출한다. */
export function getMoodBookingNoticeRules(
  date: string,
  availability?: MoodBookingAvailability | null,
): MoodBookingBlockRule[] {
  const safe = resolveAvailability(availability);
  if (!safe || isoWeekday(date) === null) return [];
  return safe.rules.filter((rule) => rule.enabled && rule.endDate >= date);
}

/** 실행 환경의 시간대와 무관한 한국 오늘 날짜를 반환한다. */
export function moodKstDateISO(now = new Date()): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

export function moodKstTimeHHMM(now = new Date()): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(11, 16);
}
