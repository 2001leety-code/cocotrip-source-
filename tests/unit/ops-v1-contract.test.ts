import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// @ts-expect-error — ESM .js in api/, no type declarations
import { normalizeOpsV1Input } from '../../api/_shared/opsBriefingBridge.js';

/* eslint-disable @typescript-eslint/no-explicit-any -- 임의 JSON Schema를 검사하는 테스트 전용 재귀 함수 */

const fixtureRoot = resolve(process.cwd(), 'tests/fixtures/contracts');
const schemaPath = process.env.COCOTRIP_OPS_V1_SCHEMA || resolve(fixtureRoot, 'ops-v1.schema.json');
const examplePath = process.env.COCOTRIP_OPS_V1_EXAMPLE || resolve(fixtureRoot, 'ops-v1.snapshot.example.json');
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
const example = JSON.parse(readFileSync(examplePath, 'utf8'));

function resolveRef(root: any, ref: string) {
  if (!ref.startsWith('#/')) throw new Error(`지원하지 않는 원격 $ref: ${ref}`);
  return ref.slice(2).split('/').reduce((node: any, key: string) => node && node[key], root);
}

function matchesType(value: any, type: string) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}

/** 이 계약에서 쓰는 JSON Schema 2020-12 키워드만 검증하는 무의존 테스트 도우미. */
function validate(value: any, rule: any, root: any, path = '$'): string[] {
  if (!rule || Object.keys(rule).length === 0) return [];
  if (rule.$ref) return validate(value, resolveRef(root, rule.$ref), root, path);

  const errors: string[] = [];
  if (Object.prototype.hasOwnProperty.call(rule, 'const') && value !== rule.const) {
    errors.push(`${path}: const ${String(rule.const)} 불일치`);
  }
  if (Array.isArray(rule.enum) && !rule.enum.some((item: any) => Object.is(item, value))) {
    errors.push(`${path}: enum 불일치`);
  }
  if (Array.isArray(rule.oneOf)) {
    const matched = rule.oneOf.filter((candidate: any) => validate(value, candidate, root, path).length === 0).length;
    if (matched !== 1) errors.push(`${path}: oneOf 일치 수 ${matched}`);
    return errors;
  }

  const allowedTypes = Array.isArray(rule.type) ? rule.type : rule.type ? [rule.type] : [];
  if (allowedTypes.length > 0 && !allowedTypes.some((type: string) => matchesType(value, type))) {
    errors.push(`${path}: type ${allowedTypes.join('|')} 불일치`);
    return errors;
  }

  const objectLike = Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  if (objectLike && (rule.type === 'object' || rule.properties || rule.required)) {
    for (const key of rule.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(`${path}.${key}: 필수 필드 누락`);
    }
    if (rule.additionalProperties === false && rule.properties) {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(rule.properties, key)) errors.push(`${path}.${key}: 허용되지 않은 필드`);
      }
    }
    for (const [key, childRule] of Object.entries(rule.properties || {})) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        errors.push(...validate(value[key], childRule, root, `${path}.${key}`));
      }
    }
  }

  if (Array.isArray(value) && rule.items) {
    if (Number.isInteger(rule.minItems) && value.length < rule.minItems) errors.push(`${path}: minItems 미달`);
    value.forEach((item, index) => errors.push(...validate(item, rule.items, root, `${path}[${index}]`)));
  }
  if (typeof value === 'string') {
    if (Number.isInteger(rule.minLength) && value.length < rule.minLength) errors.push(`${path}: minLength 미달`);
    if (Number.isInteger(rule.maxLength) && value.length > rule.maxLength) errors.push(`${path}: maxLength 초과`);
    if (rule.pattern && !(new RegExp(rule.pattern)).test(value)) errors.push(`${path}: pattern 불일치`);
  }
  if (typeof value === 'number' && Number.isFinite(rule.minimum) && value < rule.minimum) {
    errors.push(`${path}: minimum 미달`);
  }

  for (const condition of rule.allOf || []) {
    if (condition.if) {
      const branch = validate(value, condition.if, root, path).length === 0 ? condition.then : condition.else;
      if (branch) errors.push(...validate(value, branch, root, path));
    } else {
      errors.push(...validate(value, condition, root, path));
    }
  }
  return errors;
}

describe('Brain ops.v1 계약 복사본', () => {
  it('예시 snapshot이 체크인된 JSON Schema를 통과한다', () => {
    expect(schema.$id).toBe('urn:cocotrip:contracts:ops:v1');
    expect(validate(example, schema, schema)).toEqual([]);
  });

  it('웹 브리지가 실제 계약 예시를 변경 1건으로 읽는다', () => {
    const normalized = normalizeOpsV1Input(example);
    expect(normalized.ok).toBe(true);
    expect(normalized.schemaVersion).toBe('ops.v1');
    expect(normalized.changes).toHaveLength(1);
    expect(normalized.failures).toHaveLength(0);
    expect(normalized.approvals).toHaveLength(0);
  });
});
