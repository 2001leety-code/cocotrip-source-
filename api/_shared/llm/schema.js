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
