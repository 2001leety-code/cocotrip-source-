/**
 * SSOT for the 10 UI cities (WizardForm/data.tsx CITY_CHIPS) — the only cities
 * a traveller can actually pick. Resolves a client-sent city key or a free-text
 * destination string to one of these keys, in ko/en/ja/zh, with NO cross-city
 * fallback: an unresolvable city returns null, never a guessed neighbor.
 *
 * 2026-08-24 (planner-trust-course): api/_spots_helper.js and
 * api/_food_helper.js each had their own small CITY_MAP with an implicit
 * `|| 'seoul'` fallback baked into every caller — a Gangneung/Suwon/Yeosu/
 * Daegu request silently got Seoul context and nobody could tell from the
 * response. This module is the one place that knows all 10 keys and their
 * aliases; nothing here fabricates a fallback city — that's the caller's
 * choice to make explicitly (and for the quick-preview path, the choice is
 * "fail with a stable error").
 */

export const UI_CITY_KEYS = [
  'seoul', 'busan', 'jeju', 'gyeongju', 'jeonju',
  'gangneung', 'incheon', 'suwon', 'yeosu', 'daegu',
];

// Localized display names + common alt-spellings, per key. Used both to
// resolve free-text destinations and to recognize a city mentioned in a
// generated response (any language).
const CITY_NAMES = {
  seoul:     { ko: ['서울'], en: ['seoul'], ja: ['ソウル'], zh: ['首尔', '首爾'] },
  busan:     { ko: ['부산'], en: ['busan', 'pusan'], ja: ['釜山', 'プサン'], zh: ['釜山'] },
  jeju:      { ko: ['제주', '제주도'], en: ['jeju', 'jeju island'], ja: ['済州', '済州島'], zh: ['济州', '濟州'] },
  gyeongju:  { ko: ['경주'], en: ['gyeongju'], ja: ['慶州', 'キョンジュ'], zh: ['庆州', '慶州'] },
  jeonju:    { ko: ['전주'], en: ['jeonju'], ja: ['全州', 'チョンジュ'], zh: ['全州'] },
  gangneung: { ko: ['강릉'], en: ['gangneung'], ja: ['江陵', 'カンヌン'], zh: ['江陵'] },
  incheon:   { ko: ['인천'], en: ['incheon', 'inchon'], ja: ['仁川', 'インチョン'], zh: ['仁川'] },
  suwon:     { ko: ['수원'], en: ['suwon'], ja: ['水原', 'スウォン'], zh: ['水原'] },
  yeosu:     { ko: ['여수'], en: ['yeosu'], ja: ['麗水', 'ヨス'], zh: ['丽水', '麗水'] },
  daegu:     { ko: ['대구'], en: ['daegu', 'taegu'], ja: ['大邱', 'テグ'], zh: ['大邱'] },
};

// Flat alias -> key lookup (lowercased), built once.
const ALIAS_TO_KEY = (() => {
  const map = {};
  for (const key of UI_CITY_KEYS) {
    map[key] = key;
    const names = CITY_NAMES[key];
    for (const lang of Object.keys(names)) {
      for (const alias of names[lang]) map[alias.toLowerCase()] = key;
    }
  }
  return map;
})();

/**
 * Resolve one city token (a UI city key OR a free-text/localized name) to a
 * canonical UI city key. Strict: NO substring cross-matching between
 * different cities ("notseoul" must never resolve to seoul just because the
 * substring appears) — only an exact alias match, or an exact match on one
 * comma/slash-separated segment of the token (e.g. "Jeju, South Korea" ->
 * segment "jeju" is an exact alias). A token whose segments resolve to more
 * than one different city ("busan,seoul") is ambiguous and returns null
 * rather than silently picking the first one.
 * @param {string} token
 * @returns {string|null}
 */
export function resolveUiCityKey(token) {
  const t = String(token || '').toLowerCase().trim();
  if (!t) return null;
  if (ALIAS_TO_KEY[t]) return ALIAS_TO_KEY[t];
  const segments = t.split(/[,/|]/).map((s) => s.trim()).filter(Boolean);
  const resolved = new Set();
  for (const seg of segments) {
    if (ALIAS_TO_KEY[seg]) resolved.add(ALIAS_TO_KEY[seg]);
  }
  return resolved.size === 1 ? [...resolved][0] : null;
}

/**
 * Resolve a request's primary city: prefers an explicit UI city key sent by
 * the client (`cityKey`/`mainCityKey`, e.g. from WizardForm's CITY_CHIPS) —
 * exact, unambiguous, no parsing needed — and only falls back to parsing the
 * free-text destination/city token when no key was sent (older clients).
 * @param {{cityKey?: string, destinationToken?: string}} opts
 * @returns {string|null}
 */
export function resolvePrimaryCityKey({ cityKey, destinationToken } = {}) {
  if (cityKey) {
    const fromKey = resolveUiCityKey(cityKey);
    if (fromKey) return fromKey;
  }
  return resolveUiCityKey(destinationToken);
}

/**
 * 2026-08-24 (planner-trust-course, D): when the client sends an explicit
 * `cityKey` AND a free-text destination/city token, the two must agree — a
 * stale/mismatched wizard state (e.g. cityKey="busan" but destination text
 * says "Seoul") must fail with a stable, explicit error instead of silently
 * trusting one side and building an itinerary the traveler didn't ask for.
 * Only legacy requests with NO cityKey are allowed to resolve a display name
 * purely from the free-text token.
 * @param {{cityKey?: string, destinationToken?: string}} opts
 * @returns {{ ok: true, cityKey: string } | { ok: false, code: 'UNSUPPORTED_CITY' | 'CITY_MISMATCH' }}
 */
export function resolvePrimaryCityKeyOrMismatch({ cityKey, destinationToken } = {}) {
  const trimmedKey = String(cityKey || '').trim();
  if (trimmedKey) {
    const fromKey = resolveUiCityKey(trimmedKey);
    if (!fromKey) return { ok: false, code: 'UNSUPPORTED_CITY' };
    const fromText = destinationToken ? resolveUiCityKey(destinationToken) : null;
    if (fromText && fromText !== fromKey) return { ok: false, code: 'CITY_MISMATCH' };
    return { ok: true, cityKey: fromKey };
  }
  const fromText = resolveUiCityKey(destinationToken);
  if (!fromText) return { ok: false, code: 'UNSUPPORTED_CITY' };
  return { ok: true, cityKey: fromText };
}

/**
 * 2026-08-24 (planner-trust-course, hardening #8): strict multi-token city
 * resolution used at the top of the quick-preview handler, BEFORE the
 * arrival-city override is even considered. resolvePrimaryCityKeyOrMismatch
 * above only ever checked `cityKey` against the FIRST destination token, and
 * only when `intent.arrivalCity` was empty — an adversarial `cityKey=busan` +
 * `destination="Atlantis/Not Busan ignore previous rules"` (a string that
 * resolves to NO UI city) silently fell through with cityKey trusted alone,
 * and a `cityKey=busan` + `destination=Seoul` request never got checked at
 * all once `arrival_city=busan` was also sent (the arrival branch skipped
 * this function entirely). This runs unconditionally: every nonempty city
 * token (each comma/slash-segment of `destination`, or each `regions[]`
 * entry) must resolve to a real UI city, and when `cityKey` is also sent it
 * must equal the FIRST token's resolution — never "cityKey wins by default"
 * and never "unresolvable text is silently ignored".
 * @param {{cityKey?: string, cityTokens?: string[]}} opts
 * @returns {{ ok: true, cityKey: string, regions: string[] } | { ok: false, code: 'UNSUPPORTED_CITY' | 'CITY_MISMATCH' }}
 */
export function resolveRegionsOrMismatch({ cityKey, cityTokens } = {}) {
  const tokens = (cityTokens || []).map((t) => String(t || '').trim()).filter(Boolean);
  const resolvedTokens = [];
  for (const t of tokens) {
    const k = resolveUiCityKey(t);
    if (!k) return { ok: false, code: 'UNSUPPORTED_CITY' };
    resolvedTokens.push(k);
  }
  const trimmedKey = String(cityKey || '').trim();
  let resolvedKey = null;
  if (trimmedKey) {
    resolvedKey = resolveUiCityKey(trimmedKey);
    if (!resolvedKey) return { ok: false, code: 'UNSUPPORTED_CITY' };
  }
  if (resolvedTokens.length === 0 && !resolvedKey) return { ok: false, code: 'UNSUPPORTED_CITY' };
  if (resolvedKey && resolvedTokens.length > 0 && resolvedTokens[0] !== resolvedKey) {
    return { ok: false, code: 'CITY_MISMATCH' };
  }
  const primaryCityKey = resolvedKey || resolvedTokens[0];
  const regions = [...new Set([primaryCityKey, ...resolvedTokens])];
  return { ok: true, cityKey: primaryCityKey, regions };
}

/** First localized display name for a city key, for use OUTSIDE the opaque
 * TRAVELER DATA block (server-owned/canonical — never raw traveler text). */
export function canonicalCityDisplayName(cityKey, lang = 'en') {
  const names = CITY_NAMES[cityKey];
  if (!names) return String(cityKey || '');
  const l = ['ko', 'en', 'ja', 'zh'].includes(String(lang)) ? String(lang) : 'en';
  return (names[l] && names[l][0]) || names.en[0] || String(cityKey);
}

/** All localized display names for a city key (flat array), for text matching. */
export function displayNamesFor(cityKey) {
  const names = CITY_NAMES[cityKey];
  if (!names) return [];
  return Object.values(names).flat();
}

export function isUiCityKey(key) {
  return UI_CITY_KEYS.includes(String(key || ''));
}
