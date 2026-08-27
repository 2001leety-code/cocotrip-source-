/**
 * MOOD 예약 차단 정책의 서버 정본.
 *
 * Firestore `mood_config/booking_availability` 문서가 없을 때만 기존 임시
 * 저녁 제한을 기본값으로 사용한다. 문서가 존재하고 `rules: []` 이면 운영자가
 * 명시적으로 모든 시간을 연 상태다.
 */
export const MOOD_BOOKING_AVAILABILITY_SCHEMA_VERSION = 1;
export const MOOD_BOOKING_AVAILABILITY_MAX_RULES = 50;
export const MOOD_BOOKING_AVAILABILITY_CONFIG_COLLECTION = 'mood_config';
export const MOOD_BOOKING_AVAILABILITY_CONFIG_DOCUMENT = 'booking_availability';

// 기존 프론트와 오류 처리 계약을 유지한다.
export const MOOD_EVENING_BLACKOUT_ERROR = 'MOOD_EVENING_BOOKING_UNAVAILABLE';
export const MOOD_EVENING_BLACKOUT_REASON = '2026년 8월 15일~9월 15일 목·금·토 18:00 이후 예약 불가';

export const MOOD_EVENING_BLACKOUT_POLICY = Object.freeze({
  startDate: '2026-08-15',
  endDate: '2026-09-15',
  startTime: '18:00',
  weekdays: Object.freeze([4, 5, 6]), // 0=일요일, 4=목요일, 5=금요일, 6=토요일
});

const DEFAULT_RULE = Object.freeze({
  id: 'legacy-evening-blackout-2026',
  enabled: true,
  startDate: MOOD_EVENING_BLACKOUT_POLICY.startDate,
  endDate: MOOD_EVENING_BLACKOUT_POLICY.endDate,
  weekdays: MOOD_EVENING_BLACKOUT_POLICY.weekdays,
  mode: 'starts_from',
  startTime: MOOD_EVENING_BLACKOUT_POLICY.startTime,
  reason: MOOD_EVENING_BLACKOUT_REASON,
});

export const DEFAULT_MOOD_BOOKING_AVAILABILITY = Object.freeze({
  schemaVersion: MOOD_BOOKING_AVAILABILITY_SCHEMA_VERSION,
  revision: 0,
  rules: Object.freeze([DEFAULT_RULE]),
});

const AVAILABLE = Object.freeze({ ok: true });
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const RULE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/;

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

function cloneDefaultAvailability() {
  return {
    schemaVersion: MOOD_BOOKING_AVAILABILITY_SCHEMA_VERSION,
    revision: 0,
    rules: [{ ...DEFAULT_RULE, weekdays: [...DEFAULT_RULE.weekdays] }],
  };
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
  if (!snapshot || !snapshot.exists) return cloneDefaultAvailability();
  const data = snapshot.data() || {};
  // 문서 미생성만 기본 정책이다. 존재하는 문서는 일부 필드가 빠졌더라도
  // 임의 보정하지 않는다. 특히 `{ rules: [] }`를 전 시간 개방으로 오인하면 안 된다.
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

  const rules = data.rules.map((rule) => {
    const normalized = normalizeMoodBookingAvailabilityRule(rule);
    if (!normalized.ok) invalidStoredConfig(normalized.error);
    return normalized.value;
  });
  if (new Set(rules.map((rule) => rule.id)).size !== rules.length) {
    invalidStoredConfig('DUPLICATE_BOOKING_BLOCK_RULE_ID');
  }
  return { schemaVersion, revision, rules };
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
  bookingAvailability = DEFAULT_MOOD_BOOKING_AVAILABILITY,
) {
  const weekday = calendarWeekday(date);
  if (weekday === null || !TIME_RE.test(String(startTime || ''))) return AVAILABLE;

  const rules = Array.isArray(bookingAvailability && bookingAvailability.rules)
    ? bookingAvailability.rules
    : DEFAULT_MOOD_BOOKING_AVAILABILITY.rules;
  // startDate와 endDate는 모두 포함(inclusive)하는 한국 달력 날짜 경계다.
  const matched = rules.find((rule) => (
    rule
    && rule.enabled === true
    && date >= rule.startDate
    && date <= rule.endDate
    && Array.isArray(rule.weekdays)
    && rule.weekdays.includes(weekday)
    && (rule.mode === 'full_day' || (rule.mode === 'starts_from' && startTime >= rule.startTime))
  ));
  if (!matched) return AVAILABLE;
  return {
    ok: false,
    error: MOOD_EVENING_BLACKOUT_ERROR,
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
  bookingAvailability = DEFAULT_MOOD_BOOKING_AVAILABILITY,
) {
  const requested = checkMoodBookingAvailability(requestedDate, requestedStartTime, bookingAvailability);
  if (requested.ok) return requested;
  return existingDate === requestedDate && existingStartTime === requestedStartTime
    ? AVAILABLE
    : requested;
}
