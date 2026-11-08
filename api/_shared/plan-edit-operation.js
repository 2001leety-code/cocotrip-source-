// editOperation.js — command validation and pure day-array application
export const MAX_PAYLOAD_BYTES = 16384;
export const MAX_DAYS = 31;
export const MAX_STOPS_PER_DAY = 100;
export const CATEGORIES = Object.freeze(['landmark', 'food', 'cafe', 'shopping', 'culture', 'activity']);
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const HEX64_RE = /^[0-9a-f]{64}$/;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export class EditError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'EditError';
    this.code = code;
    this.status = 400;
  }
}
const fail = (code, msg) => { throw new EditError(code, msg); };
function isPlainObject(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
}
function requireKeys(obj, allowed, label) {
  if (!isPlainObject(obj)) fail('INVALID_SHAPE', `${label} must be a plain object`);
  const keys = Object.keys(obj);
  for (const k of keys) if (!allowed.includes(k)) fail('UNKNOWN_KEY', `${label}.${k} not allowed`);
  for (const k of allowed) if (!Object.hasOwn(obj, k)) fail('MISSING_KEY', `${label}.${k} required`);
}
function safeInt(v, min, max, label) {
  if (!Number.isSafeInteger(v) || v < min || v > max) fail('INVALID_INT', `${label} must be integer ${min}..${max}`);
  return v;
}
function trimmedString(v, max, label, nonEmpty) {
  if (typeof v !== 'string') fail('INVALID_STRING', `${label} must be a string`);
  const s = v.trim();
  if (nonEmpty && s.length === 0) fail('INVALID_STRING', `${label} must be non-empty`);
  if (s.length > max) fail('INVALID_STRING', `${label} exceeds ${max} chars`);
  return s;
}
function validateStop(raw) {
  requireKeys(raw, ['name', 'display_name', 'address', 'start_time', 'stay_min', 'category'], 'stop');
  if (typeof raw.start_time !== 'string' || !HHMM_RE.test(raw.start_time)) fail('INVALID_TIME', 'stop.start_time must be HH:mm');
  if (!CATEGORIES.includes(raw.category)) fail('INVALID_CATEGORY', 'stop.category not allowed');
  return Object.freeze({
    name: trimmedString(raw.name, 160, 'stop.name', true),
    display_name: trimmedString(raw.display_name, 160, 'stop.display_name', true),
    address: trimmedString(raw.address, 500, 'stop.address', false),
    start_time: raw.start_time,
    stay_min: safeInt(raw.stay_min, 15, 240, 'stop.stay_min'),
    category: raw.category,
  });
}
function validateOperation(op) {
  if (!isPlainObject(op)) fail('INVALID_SHAPE', 'operation must be a plain object');
  const maxDay = MAX_DAYS - 1, maxStop = MAX_STOPS_PER_DAY - 1;
  switch (op.type) {
    case 'add':
      requireKeys(op, ['type', 'dayIndex', 'stop'], 'operation');
      return Object.freeze({ type: 'add', dayIndex: safeInt(op.dayIndex, 0, maxDay, 'dayIndex'), stop: validateStop(op.stop) });
    case 'delete':
      requireKeys(op, ['type', 'dayIndex', 'stopIndex'], 'operation');
      return Object.freeze({ type: 'delete', dayIndex: safeInt(op.dayIndex, 0, maxDay, 'dayIndex'), stopIndex: safeInt(op.stopIndex, 0, maxStop, 'stopIndex') });
    case 'reorder':
      requireKeys(op, ['type', 'dayIndex', 'fromIndex', 'toIndex'], 'operation');
      return Object.freeze({
        type: 'reorder',
        dayIndex: safeInt(op.dayIndex, 0, maxDay, 'dayIndex'),
        fromIndex: safeInt(op.fromIndex, 0, maxStop, 'fromIndex'),
        toIndex: safeInt(op.toIndex, 0, maxStop, 'toIndex'),
      });
    case 'applyOrder': {
      requireKeys(op, ['type', 'dayIndex', 'order'], 'operation');
      if (!Array.isArray(op.order) || op.order.length > MAX_STOPS_PER_DAY) fail('INVALID_ORDER', 'order must be an array');
      const seen = new Set();
      for (const i of op.order) {
        safeInt(i, 0, op.order.length - 1, 'order[]');
        if (seen.has(i)) fail('INVALID_ORDER', 'order must be a permutation');
        seen.add(i);
      }
      return Object.freeze({ type: 'applyOrder', dayIndex: safeInt(op.dayIndex, 0, maxDay, 'dayIndex'), order: Object.freeze(op.order.slice()) });
    }
    default:
      fail('INVALID_TYPE', 'operation.type unsupported');
  }
}
/** Validates the edit envelope; accepts a JSON string or an already-parsed value. */
export function validateCommand(raw) {
  let value = raw;
  const encoder = new TextEncoder();
  if (typeof raw === 'string') {
    if (encoder.encode(raw).byteLength > MAX_PAYLOAD_BYTES) fail('PAYLOAD_TOO_LARGE', 'payload exceeds limit');
    try { value = JSON.parse(raw); } catch { fail('INVALID_JSON', 'payload is not valid JSON'); }
  } else {
    let s;
    try { s = JSON.stringify(raw); } catch { fail('INVALID_JSON', 'payload not serializable'); }
    if (typeof s !== 'string' || encoder.encode(s).byteLength > MAX_PAYLOAD_BYTES) fail('PAYLOAD_TOO_LARGE', 'payload exceeds limit');
  }
  requireKeys(value, ['planId', 'requestId', 'expectedFingerprint', 'operation'], 'command');
  if (typeof value.planId !== 'string' || !ID_RE.test(value.planId)) fail('INVALID_ID', 'planId invalid');
  if (typeof value.requestId !== 'string' || !ID_RE.test(value.requestId)) fail('INVALID_ID', 'requestId invalid');
  if (typeof value.expectedFingerprint !== 'string' || !HEX64_RE.test(value.expectedFingerprint)) {
    fail('INVALID_FINGERPRINT', 'expectedFingerprint must be lowercase 64-hex');
  }
  return Object.freeze({
    planId: value.planId,
    requestId: value.requestId,
    expectedFingerprint: value.expectedFingerprint,
    operation: validateOperation(value.operation),
  });
}
function markStale(stops, refs, prevOf, index) {
  if (index <= 0 || index >= stops.length) return;
  const stop = stops[index];
  const ref = refs[index];
  if (ref === null) return; // freshly added stop already carries a placeholder transit
  if (stop.same_lodging_as_prev && prevOf.get(ref) === refs[index - 1]) return;
  if (isPlainObject(stop.transit_from_prev)) stop.transit_from_prev._stale = true;
  else stop._stale_transit = true;
  delete stop.same_lodging_as_prev;
}
/** Pure: returns a new days array; never mutates doc. */
export function applyOperation(doc, command) {
  if (!isPlainObject(doc) || !isPlainObject(doc.itinerary) || !Array.isArray(doc.itinerary.days)) {
    fail('INVALID_DOC', 'doc.itinerary.days missing');
  }
  const { operation: op } = command;
  const originalDays = doc.itinerary.days;
  if (originalDays.length > MAX_DAYS) fail('LIMIT_DAYS', 'too many days');
  if (op.dayIndex >= originalDays.length) fail('INVALID_DAY', 'dayIndex out of range');
  const originalDay = originalDays[op.dayIndex];
  if (!isPlainObject(originalDay) || !Array.isArray(originalDay.stops)) fail('INVALID_DOC', 'day.stops missing');
  if (originalDay.stops.length > MAX_STOPS_PER_DAY) fail('LIMIT_STOPS', 'too many stops');
  const days = structuredClone(originalDays);
  const stops = days[op.dayIndex].stops;
  const refs = originalDay.stops.slice(); // original identities, permuted in lockstep
  const prevOf = new Map();
  refs.forEach((r, i) => prevOf.set(r, i === 0 ? null : refs[i - 1]));
  const n = stops.length;
  const affected = [];
  switch (op.type) {
    case 'add': {
      if (n >= MAX_STOPS_PER_DAY) fail('LIMIT_STOPS', 'day is full');
      stops.push({
        ...op.stop,
        entry_fee_krw: 0, // legacy manual-add metadata only
        tip: '',
        order: n + 1,
        _userAdded: true,
        transit_from_prev: { method: 'walk', est_min: 10, est_fare_krw: 0, _stale: true, source: 'placeholder' },
      });
      refs.push(null);
      break;
    }
    case 'delete': {
      if (op.stopIndex >= n) fail('INVALID_STOP', 'stopIndex out of range');
      stops.splice(op.stopIndex, 1);
      refs.splice(op.stopIndex, 1);
      affected.push(op.stopIndex, op.stopIndex + 1); // successor now sits here; empty day permitted by existing policy
      break;
    }
    case 'reorder': {
      if (op.fromIndex >= n || op.toIndex >= n) fail('INVALID_STOP', 'index out of range');
      const [s] = stops.splice(op.fromIndex, 1);
      const [r] = refs.splice(op.fromIndex, 1);
      stops.splice(op.toIndex, 0, s);
      refs.splice(op.toIndex, 0, r);
      const lo = Math.min(op.fromIndex, op.toIndex), hi = Math.max(op.fromIndex, op.toIndex);
      for (let i = lo; i <= hi + 1; i++) affected.push(i);
      break;
    }
    case 'applyOrder': {
      if (op.order.length !== n) fail('INVALID_ORDER', 'order length mismatch');
      const newStops = op.order.map((i) => stops[i]);
      const newRefs = op.order.map((i) => refs[i]);
      stops.splice(0, n, ...newStops);
      refs.splice(0, n, ...newRefs);
      for (let i = 0; i < n; i++) affected.push(i);
      break;
    }
    default:
      fail('INVALID_TYPE', 'operation.type unsupported');
  }
  for (const i of new Set(affected)) markStale(stops, refs, prevOf, i);
  stops.forEach((s, i) => { s.order = i + 1; });
  return days;
}