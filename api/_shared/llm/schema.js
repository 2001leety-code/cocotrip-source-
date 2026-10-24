// LLM 공급자 전환 (2026-10-13): Gemini responseSchema(OpenAPI subset) → JSON Schema.
// Claude structured output(output_config.format json_schema) 규칙:
//   - type 소문자 · 모든 object 에 additionalProperties:false 필수 · propertyOrdering 없음.
// P185/P196/P200 계열 Gemini 함정(items 누락·required 미출력·순서 불일치)은
// Claude 가 스키마를 보장하므로 변환 뒤에는 발생하지 않는다.

const TYPE_MAP = {
  OBJECT: 'object', ARRAY: 'array', STRING: 'string', NUMBER: 'number', INTEGER: 'integer', BOOLEAN: 'boolean',
};

/**
 * @param {object} node Gemini schema 노드
 * @returns {object} JSON Schema 노드 (새 객체 — 원본 불변)
 */
export function geminiSchemaToJsonSchema(node) {
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === 'propertyOrdering') continue;
    if (k === 'type') { out.type = TYPE_MAP[String(v).toUpperCase()] || String(v).toLowerCase(); continue; }
    if (k === 'properties') {
      out.properties = {};
      for (const [pk, pv] of Object.entries(v || {})) out.properties[pk] = geminiSchemaToJsonSchema(pv);
      continue;
    }
    if (k === 'items') { out.items = geminiSchemaToJsonSchema(v); continue; }
    out[k] = Array.isArray(v) ? [...v] : v;
  }
  if (out.type === 'object') out.additionalProperties = false;
  return out;
}

const TYPE_OK = {
  object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
  array: (v) => Array.isArray(v),
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  integer: (v) => Number.isInteger(v),
  boolean: (v) => typeof v === 'boolean',
  null: (v) => v === null,
};
const kindOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

/**
 * 값이 변환된 JSON Schema 의 **자료형·required** 만 지키는지 검사(enum/format/범위는 안 봄). 순수 — 던지지 않는다.
 * 2026-10-24: Claude 가 구조화 출력 없이 프롬프트 스키마로 답하는 경로에서 `{"days":{}}`·숫자 address 같은 응답이
 *   정리 함수(cleanAddresses/sanitizeStops)를 예외로 터뜨리기 전에 구조 오류로 바꾸려는 용도.
 * 선택 속성의 null 은 "없음"으로 본다(하류는 없는 필드와 같게 다룬다). required 속성의 null 은 자료형 오류.
 * @param {unknown} value
 * @param {object} schema geminiSchemaToJsonSchema 결과
 * required:false(파이프라인 사전검사) — 자료형 불일치·최상위 비객체만 보고 required 누락은 무시한다(누락은 기존
 *   pattern 검증·self-heal 이 처리: 예 P161 departure_guide 보강). 이때는 모든 속성의 null 을 "없음"으로 본다.
 * @param {{max?: number, required?: boolean}} [opts]
 * @returns {string[]} 예: ['days: expected array, got object', 'days[0].stops[2].address: expected string, got number']
 */
export function schemaTypeIssues(value, schema, { max = 20, required: checkRequired = true } = {}) {
  const issues = [];
  const label = (path) => path || '(root)';
  const visit = (v, s, path) => {
    if (issues.length >= max || !s || typeof s !== 'object') return;
    if (Array.isArray(s.anyOf)) {
      if (!s.anyOf.some((sub) => schemaTypeIssues(v, sub, { max: 1, required: checkRequired }).length === 0)) issues.push(`${label(path)}: does not match any allowed type`);
      return;
    }
    const types = Array.isArray(s.type) ? s.type : (s.type ? [s.type] : []);
    if (types.length && !types.some((t) => TYPE_OK[t] && TYPE_OK[t](v))) {
      issues.push(`${label(path)}: expected ${types.join('|')}, got ${kindOf(v)}`);
      return;
    }
    if (TYPE_OK.object(v) && s.properties) {
      const required = new Set(checkRequired && Array.isArray(s.required) ? s.required : []);
      for (const k of required) {
        if (v[k] === undefined && issues.length < max) issues.push(`${path ? `${path}.${k}` : k}: required property missing`);
      }
      for (const [k, sub] of Object.entries(s.properties)) {
        if (v[k] === undefined || (v[k] === null && !required.has(k))) continue;
        visit(v[k], sub, path ? `${path}.${k}` : k);
      }
    }
    if (Array.isArray(v) && s.items) v.forEach((item, i) => visit(item, s.items, `${path}[${i}]`));
  };
  visit(value, schema, '');
  return issues.slice(0, max);
}

/**
 * 선택 속성(object 의 properties 중 required 에 없는 것) 수 — 중첩 object·array items·anyOf 재귀 합계.
 * Claude 구조화 출력 한도(claude.js CLAUDE_STRUCTURED_OPTIONAL_LIMIT) 판정용.
 * @param {object} schema JSON Schema
 * @returns {number}
 */
export function countOptionalProperties(schema) {
  if (!schema || typeof schema !== 'object') return 0;
  let count = 0;
  if (schema.properties && typeof schema.properties === 'object') {
    const required = new Set(Array.isArray(schema.required) ? schema.required : []);
    for (const [k, v] of Object.entries(schema.properties)) {
      if (!required.has(k)) count += 1;
      count += countOptionalProperties(v);
    }
  }
  if (schema.items) count += countOptionalProperties(schema.items);
  for (const sub of Array.isArray(schema.anyOf) ? schema.anyOf : []) count += countOptionalProperties(sub);
  return count;
}
