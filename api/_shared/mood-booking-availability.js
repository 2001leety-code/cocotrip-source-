/**
 * MOOD 예약 차단 정책의 서버 정본.
 *
 * Firestore `mood_config/booking_availability` 문서만 정본으로 사용한다.
 * 문서 누락·손상 시에는 과거 날짜 규칙을 되살리거나 조용히 예약을 열지 않고
 * 명시적인 설정 오류로 중단한다.
 */
export const MOOD_BOOKING_AVAILABILITY_SCHEMA_VERSION = 1;
export const MOOD_BOOKING_AVAILABILITY_MAX_RULES = 50;
export const MOOD_BOOKING_AVAILABILITY_MAX_EXCEPTIONS = 100;
export const MOOD_BOOKING_AVAILABILITY_MAX_EXCEPTION_DAYS = 366;
export const MOOD_BOOKING_AVAILABILITY_CONFIG_COLLECTION = 'mood_config';
export const MOOD_BOOKING_AVAILABILITY_CONFIG_DOCUMENT = 'booking_availability';

export const MOOD_BOOKING_UNAVAILABLE_ERROR = 'MOOD_BOOKING_UNAVAILABLE';
export const MOOD_BOOKING_AVAILABILITY_CONFIG_UNAVAILABLE_ERROR = 'MOOD_BOOKING_AVAILABILITY_CONFIG_UNAVAILABLE';
export const MOOD_BOOKING_AVAILABILITY_CONFIG_UNAVAILABLE_REASON = '예약 차단 설정을 확인할 수 없습니다. 관리자 설정을 확인해 주세요.';

const AVAILABLE = Object.freeze({ ok: true });
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const RULE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function calendarWeekday(date) {
  if (!DATE_RE.test(String(date || ''))) return null;
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  if (
    value.getUTCFullYear() !== year
    || value.getUTCMonth() !== month - 1
    || value.getUTCDate() !== day
  ) {
    return null;
  }
  return value.getUTCDay();
}

export function isValidMoodBookingDate(date) {
  return calendarWeekday(date) !== null;
}

export function isValidMoodBookingRuleId(id) {
  return RULE_ID_RE.test(String(id || ''));
}

export function isValidMoodBookingExceptionId(id) {
  return RULE_ID_RE.test(String(id || ''));
}

function dateToEpochDay(date) {
  if (!isValidMoodBookingDate(date)) return null;
  const [year, month, day] = date.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

function inclusiveDateSpan(startDate, endDate) {
  const startDay = dateToEpochDay(startDate);
  const endDay = dateToEpochDay(endDate);
  if (startDay === null || endDay === null || startDay > endDay) return null;
  return endDay - startDay + 1;
}

/**
 * 외부 입력/Firestore rule 하나를 엄격히 검증하고 정규화한다.
 * @returns {{ok: true, value: object} | {ok: false, error: string}}
 */
export function normalizeMoodBookingAvailabilityRule(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'INVALID_BOOKING_BLOCK_RULE' };
  }

  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const startDate = typeof raw.startDate === 'string' ? raw.startDate.trim() : '';
  const endDate = typeof raw.endDate === 'string' ? raw.endDate.trim() : '';
  const mode = raw.mode;
  const reason = typeof raw.reason === 'string' ? raw.reason.trim() : '';

  if (!isValidMoodBookingRuleId(id)) return { ok: false, error: 'INVALID_BOOKING_BLOCK_RULE_ID' };
  if (typeof raw.enabled !== 'boolean') return { ok: false, error: 'INVALID_BOOKING_BLOCK_ENABLED' };
  if (!isValidMoodBookingDate(startDate) || !isValidMoodBookingDate(endDate) || startDate > endDate) {
    return { ok: false, error: 'INVALID_BOOKING_BLOCK_DATE_RANGE' };
  }
  if (
    !Array.isArray(raw.weekdays)
    || raw.weekdays.length < 1
    || raw.weekdays.length > 7
    || raw.weekdays.some((weekday) => !Number.isInteger(weekday) || weekday < 0 || weekday > 6)
  ) {
    return { ok: false, error: 'INVALID_BOOKING_BLOCK_WEEKDAYS' };
  }
  const weekdays = [...new Set(raw.weekdays)].sort((a, b) => a - b);
  if (weekdays.length !== raw.weekdays.length) {
    return { ok: false, error: 'INVALID_BOOKING_BLOCK_WEEKDAYS' };
  }
  if (mode !== 'full_day' && mode !== 'starts_from') {
    return { ok: false, error: 'INVALID_BOOKING_BLOCK_MODE' };
  }

  let startTime = null;
  if (mode === 'starts_from') {
    if (typeof raw.startTime !== 'string' || !TIME_RE.test(raw.startTime)) {
      return { ok: false, error: 'INVALID_BOOKING_BLOCK_START_TIME' };
    }
    startTime = raw.startTime;
  } else if (raw.startTime !== null) {
    return { ok: false, error: 'INVALID_BOOKING_BLOCK_START_TIME' };
  }

  if (!reason || reason.length > 500) {
    return { ok: false, error: 'INVALID_BOOKING_BLOCK_REASON' };
  }

  return {
    ok: true,
    value: {
      id,
      enabled: raw.enabled,
      startDate,
      endDate,
      weekdays,
      mode,
      startTime,
      reason,
    },
  };
}

/**
 * 클라이언트가 보내는 예외 기간 필드만 검증한다. ruleIds는 서버가 현재 규칙을
 * 기준으로 트랜잭션 안에서 바인딩하므로 이 입력에서는 받지 않는다.
 */
export function normalizeMoodBookingAvailabilityExceptionDraft(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'INVALID_BOOKING_BLOCK_EXCEPTION' };
  }

  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const startDate = typeof raw.startDate === 'string' ? raw.startDate.trim() : '';
  const endDate = typeof raw.endDate === 'string' ? raw.endDate.trim() : '';
  const reason = typeof raw.reason === 'string' ? raw.reason.trim() : '';
  const dateSpan = inclusiveDateSpan(startDate, endDate);

  if (!isValidMoodBookingExceptionId(id)) {
    return { ok: false, error: 'INVALID_BOOKING_BLOCK_EXCEPTION_ID' };
  }
  if (typeof raw.enabled !== 'boolean') {
    return { ok: false, error: 'INVALID_BOOKING_BLOCK_EXCEPTION_ENABLED' };
  }
  if (dateSpan === null || dateSpan > MOOD_BOOKING_AVAILABILITY_MAX_EXCEPTION_DAYS) {
    return { ok: false, error: 'INVALID_BOOKING_BLOCK_EXCEPTION_DATE_RANGE' };
  }
  if (!reason || reason.length > 500) {
    return { ok: false, error: 'INVALID_BOOKING_BLOCK_EXCEPTION_REASON' };
  }

  return {
    ok: true,
    value: {
      id,
      enabled: raw.enabled,
      startDate,
      endDate,
      reason,
    },
  };
}

/**
 * Firestore에 저장된 예외 하나를 엄격히 검증하고 정규화한다.
 */
export function normalizeMoodBookingAvailabilityException(raw) {
  const draft = normalizeMoodBookingAvailabilityExceptionDraft(raw);
  if (!draft.ok) return draft;
  if (
    !Array.isArray(raw.ruleIds)
    || raw.ruleIds.length < 1
    || raw.ruleIds.length > MOOD_BOOKING_AVAILABILITY_MAX_RULES
    || raw.ruleIds.some((ruleId) => (
      typeof ruleId !== 'string' || !isValidMoodBookingRuleId(ruleId)
    ))
    || new Set(raw.ruleIds).size !== raw.ruleIds.length
  ) {
    return { ok: false, error: 'INVALID_BOOKING_BLOCK_EXCEPTION_RULE_IDS' };
  }

  return {
    ok: true,
    value: {
      ...draft.value,
      ruleIds: [...raw.ruleIds],
    },
  };
}

/**
 * 규칙의 날짜·요일 조건이 요청 범위 안의 하루 이상에 걸리는지 확인한다.
 * enabled는 보지 않는다. 현재 꺼 둔 규칙도 다시 켰을 때 기존 예외가 유지되어야 한다.
 */
export function moodBookingRuleAffectsDateRange(rule, startDate, endDate) {
  if (!rule || !Array.isArray(rule.weekdays)) return false;
  const overlapStart = rule.startDate > startDate ? rule.startDate : startDate;
  const overlapEnd = rule.endDate < endDate ? rule.endDate : endDate;
  const overlapDays = inclusiveDateSpan(overlapStart, overlapEnd);
  if (overlapDays === null) return false;

  const firstWeekday = calendarWeekday(overlapStart);
  const daysToCheck = Math.min(overlapDays, 7);
  for (let offset = 0; offset < daysToCheck; offset += 1) {
    if (rule.weekdays.includes((firstWeekday + offset) % 7)) return true;
  }
  return false;
}

function invalidStoredConfig(error) {
  const err = new Error(error);
  err.code = 'INVALID_BOOKING_AVAILABILITY_CONFIG';
  err.detail = error;
  throw err;
}

/**
 * Firestore snapshot을 공개 계약으로 바꾼다. 존재하는 빈 rules 배열은 유지한다.
 */
export function moodBookingAvailabilityFromSnapshot(snapshot) {
  if (!snapshot || !snapshot.exists) {
    invalidStoredConfig('MISSING_BOOKING_AVAILABILITY_CONFIG');
  }
  const data = snapshot.data() || {};
  // 문서가 존재해도 일부 필드가 빠졌다면 임의로 보정하지 않는다.
  // 특히 `{ rules: [] }`를 전 시간 개방으로 오인하면 안 된다.
  const schemaVersion = data.schemaVersion;
  const revision = data.revision;
  if (schemaVersion !== MOOD_BOOKING_AVAILABILITY_SCHEMA_VERSION) {
    invalidStoredConfig('INVALID_BOOKING_AVAILABILITY_SCHEMA_VERSION');
  }
  if (!Number.isInteger(revision) || revision < 0) {
    invalidStoredConfig('INVALID_BOOKING_AVAILABILITY_REVISION');
  }
  if (!Array.isArray(data.rules) || data.rules.length > MOOD_BOOKING_AVAILABILITY_MAX_RULES) {
    invalidStoredConfig('INVALID_BOOKING_AVAILABILITY_RULES');
  }
  const rawExceptions = data.exceptions === undefined ? [] : data.exceptions;
  if (
    !Array.isArray(rawExceptions)
    || rawExceptions.length > MOOD_BOOKING_AVAILABILITY_MAX_EXCEPTIONS
  ) {
    invalidStoredConfig('INVALID_BOOKING_AVAILABILITY_EXCEPTIONS');
  }

  const rules = data.rules.map((rule) => {
    const normalized = normalizeMoodBookingAvailabilityRule(rule);
    if (!normalized.ok) invalidStoredConfig(normalized.error);
    return normalized.value;
  });
  if (new Set(rules.map((rule) => rule.id)).size !== rules.length) {
    invalidStoredConfig('DUPLICATE_BOOKING_BLOCK_RULE_ID');
  }
  const ruleIds = new Set(rules.map((rule) => rule.id));
  const exceptions = rawExceptions.map((exception) => {
    const normalized = normalizeMoodBookingAvailabilityException(exception);
    if (!normalized.ok) invalidStoredConfig(normalized.error);
    if (normalized.value.ruleIds.some((ruleId) => !ruleIds.has(ruleId))) {
      invalidStoredConfig('UNKNOWN_BOOKING_BLOCK_EXCEPTION_RULE_ID');
    }
    return normalized.value;
  });
  if (new Set(exceptions.map((exception) => exception.id)).size !== exceptions.length) {
    invalidStoredConfig('DUPLICATE_BOOKING_BLOCK_EXCEPTION_ID');
  }
  return { schemaVersion, revision, rules, exceptions };
}

export function moodBookingAvailabilityRef(db) {
  return db
    .collection(MOOD_BOOKING_AVAILABILITY_CONFIG_COLLECTION)
    .doc(MOOD_BOOKING_AVAILABILITY_CONFIG_DOCUMENT);
}

export async function getMoodBookingAvailability(db) {
  return moodBookingAvailabilityFromSnapshot(await moodBookingAvailabilityRef(db).get());
}

/**
 * @param {string} date 한국 달력 기준 YYYY-MM-DD
 * @param {string} startTime HH:mm
 * @param {object} bookingAvailability Firestore에서 읽은 정책
 * @returns {{ok: true} | {ok: false, error: string, reason: string, ruleId: string}}
 */
export function checkMoodBookingAvailability(
  date,
  startTime,
  bookingAvailability,
) {
  if (!bookingAvailability || !Array.isArray(bookingAvailability.rules)) {
    return {
      ok: false,
      error: MOOD_BOOKING_AVAILABILITY_CONFIG_UNAVAILABLE_ERROR,
      reason: MOOD_BOOKING_AVAILABILITY_CONFIG_UNAVAILABLE_REASON,
    };
  }
  const weekday = calendarWeekday(date);
  if (weekday === null || !TIME_RE.test(String(startTime || ''))) return AVAILABLE;

  const rules = bookingAvailability.rules;
  const knownRuleIds = new Set(rules.map((rule) => rule && rule.id).filter(Boolean));
  const exemptedRuleIds = new Set();
  const rawExceptions = Array.isArray(bookingAvailability && bookingAvailability.exceptions)
    ? bookingAvailability.exceptions
    : [];
  const normalizedExceptions = [];
  let exceptionsValid = rawExceptions.length <= MOOD_BOOKING_AVAILABILITY_MAX_EXCEPTIONS;
  rawExceptions.forEach((rawException) => {
    if (!exceptionsValid) return;
    const normalized = normalizeMoodBookingAvailabilityException(rawException);
    if (
      !normalized.ok
      || normalized.value.ruleIds.some((ruleId) => !knownRuleIds.has(ruleId))
    ) {
      exceptionsValid = false;
      return;
    }
    normalizedExceptions.push(normalized.value);
  });
  if (
    new Set(normalizedExceptions.map((exception) => exception.id)).size
    !== normalizedExceptions.length
  ) {
    exceptionsValid = false;
  }
  if (exceptionsValid) normalizedExceptions.forEach((exception) => {
    if (
      exception.enabled !== true
      || date < exception.startDate
      || date > exception.endDate
    ) return;
    // 관리자가 연 날짜/기간은 현재 및 이후 겹치는 모든 차단 규칙보다 우선한다.
    // ruleIds는 참조 무결성/감사 자료이며, 열림 판정 범위는 날짜가 정본이다.
    rules.forEach((rule) => {
      if (rule && rule.id) exemptedRuleIds.add(rule.id);
    });
  });
  // startDate와 endDate는 모두 포함(inclusive)하는 한국 달력 날짜 경계다.
  const matched = rules.find((rule) => (
    rule
    && rule.enabled === true
    && date >= rule.startDate
    && date <= rule.endDate
    && Array.isArray(rule.weekdays)
    && rule.weekdays.includes(weekday)
    && (rule.mode === 'full_day' || (rule.mode === 'starts_from' && startTime >= rule.startTime))
    && !exemptedRuleIds.has(rule.id)
  ));
  if (!matched) return AVAILABLE;
  return {
    ok: false,
    error: MOOD_BOOKING_UNAVAILABLE_ERROR,
    reason: matched.reason,
    ruleId: matched.id,
  };
}

/**
 * 기존 차단 시간대 예약은 날짜와 시작 시각을 그대로 둔 채 다른 내용만 고칠 수 있다.
 * 새 차단 시간대로 옮기거나 기존 차단 예약의 날짜/시각을 바꾸는 요청은 막는다.
 */
export function checkMoodBookingChangeAvailability(
  existingDate,
  existingStartTime,
  requestedDate,
  requestedStartTime,
  bookingAvailability,
) {
  if (!bookingAvailability || !Array.isArray(bookingAvailability.rules)) {
    return {
      ok: false,
      error: MOOD_BOOKING_AVAILABILITY_CONFIG_UNAVAILABLE_ERROR,
      reason: MOOD_BOOKING_AVAILABILITY_CONFIG_UNAVAILABLE_REASON,
    };
  }
  const requested = checkMoodBookingAvailability(requestedDate, requestedStartTime, bookingAvailability);
  if (requested.ok) return requested;
  return existingDate === requestedDate && existingStartTime === requestedStartTime
    ? AVAILABLE
    : requested;
}
