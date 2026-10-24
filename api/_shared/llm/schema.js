// LLM 공급자 전환 (2026-10-13): Gemini responseSchema(OpenAPI subset) → JSON Schema.
// Claude structured output(output_config.format json_schema) 규칙:
//   - type 소문자 · 모든 object 에 additionalProperties:false 필수 · propertyOrdering 없음.
// P185/P196/P200 계열 Gemini 함정(items 누락·required 미출력·순서 불일치)은
// Claude 가 스키마를 보장하므로 변환 뒤에는 발생하지 않는다.

const TYPE_MAP = {
  OBJECT: 'object', ARRAY: 'array', STRING: 'string', NUMBER: 'number', INTEGER: 'integer', BOOLEAN: 'boolean',
};

// 2026-10-24: Claude 구조화 출력은 선택 속성(required 밖) 24개 한도 — 플래너 메인 스키마는 61개라 400
//   ("too many optional parameters"). nullableOptionals:true 면 모든 object 의 properties 를 전부 required 로 올리고
//   원래 선택이던 속성은 null 허용으로 바꾼다(primitive = type 배열, enum·object·array = anyOf+null).
//   응답의 null 키는 claude.js 가 지워 Gemini 출력 모양으로 되돌린다(stripNullKeys).

function nullable(schema) {
  const isPrimitive = typeof schema.type === 'string' && !['object', 'array'].includes(schema.type);
  if (isPrimitive && !Array.isArray(schema.enum)) return { ...schema, type: [schema.type, 'null'] };
  return { anyOf: [schema, { type: 'null' }] };
}

/**
 * @param {object} node Gemini schema 노드
 * @param {{nullableOptionals?: boolean}} [opts]
 * @returns {object} JSON Schema 노드 (새 객체 — 원본 불변)
 */
export function geminiSchemaToJsonSchema(node, opts = {}) {
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === 'propertyOrdering') continue;
    if (k === 'type') { out.type = TYPE_MAP[String(v).toUpperCase()] || String(v).toLowerCase(); continue; }
    if (k === 'properties') {
      out.properties = {};
      for (const [pk, pv] of Object.entries(v || {})) out.properties[pk] = geminiSchemaToJsonSchema(pv, opts);
      continue;
    }
    if (k === 'items') { out.items = geminiSchemaToJsonSchema(v, opts); continue; }
    out[k] = Array.isArray(v) ? [...v] : v;
  }
  if (out.type === 'object') out.additionalProperties = false;
  if (opts.nullableOptionals && out.properties) {
    const required = new Set(Array.isArray(out.required) ? out.required : []);
    for (const pk of Object.keys(out.properties)) {
      if (!required.has(pk)) out.properties[pk] = nullable(out.properties[pk]);
    }
    out.required = Object.keys(out.properties);
  }
  return out;
}

/**
 * JSON 값에서 값이 null 인 **객체 키**를 재귀 제거(새 값 — 원본 불변). 배열 요소의 null·0·''·false 는 보존.
 * @param {unknown} value
 * @returns {unknown}
 */
export function stripNullKeys(value) {
  if (Array.isArray(value)) return value.map(stripNullKeys);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) if (v !== null) out[k] = stripNullKeys(v);
  return out;
}

/** 구조화 출력 텍스트 → null 키 제거 후 다시 JSON. 파싱 실패면 원문 그대로(repairAndParseJSON 경로가 처리). */
export function stripNullKeysFromJsonText(text) {
  try { return JSON.stringify(stripNullKeys(JSON.parse(text))); } catch { return text; }
}
