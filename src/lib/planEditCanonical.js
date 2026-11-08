// canonical.js — deterministic JSON serialization for fingerprinting (pure, no IO)
export class CanonicalError extends Error {
  constructor(message, path) {
    super(`${message} at ${path || '$'}`);
    this.name = 'CanonicalError';
    this.code = 'CANONICAL_UNSUPPORTED';
    this.status = 400;
  }
}
function isPlainObject(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
}
function encode(value, path) {
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new CanonicalError('non-finite number', path);
      return JSON.stringify(value); // normalizes -0 to 0
    case 'object':
      break;
    default:
      throw new CanonicalError(`unsupported type ${typeof value}`, path);
  }
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    const parts = new Array(value.length);
    for (let i = 0; i < value.length; i++) {
      if (value[i] === undefined) throw new CanonicalError('undefined array element', `${path}[${i}]`);
      parts[i] = encode(value[i], `${path}[${i}]`);
    }
    return `[${parts.join(',')}]`;
  }
  if (!isPlainObject(value)) throw new CanonicalError('non-plain object', path);
  const keys = Object.keys(value).sort();
  const parts = [];
  for (const k of keys) {
    const v = value[k];
    if (v === undefined) continue; // omitted, matching JSON semantics
    parts.push(`${JSON.stringify(k)}:${encode(v, `${path}.${k}`)}`);
  }
  return `{${parts.join(',')}}`;
}
/** Deterministic JSON string; caller hashes UTF-8 bytes with SHA-256. */
export function canonicalJson(value) {
  if (value === undefined) throw new CanonicalError('undefined root', '$');
  return encode(value, '$');
}
/** Fingerprint source: server days + raw input, never translated display data. */
export function canonicalSource(doc) {
  if (!isPlainObject(doc) || !isPlainObject(doc.itinerary) || !Array.isArray(doc.itinerary.days)) {
    throw new CanonicalError('doc.itinerary.days missing', '$.itinerary.days');
  }
  return canonicalJson({ days: doc.itinerary.days, input: doc.input === undefined ? null : doc.input, editRevision: doc.editRevision === undefined ? 0 : doc.editRevision, lastEditedAt: doc.lastEditedAt === undefined ? null : doc.lastEditedAt });
}