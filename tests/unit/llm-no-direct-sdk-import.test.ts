/**
 * LLM 공급자 전환 (2026-10-13) 잠금: 운영 코드(api/, src/)는 LLM SDK 를 직접 쓰지 않는다.
 * 모든 호출은 api/_shared/llm/ 을 지나야 공급자 전환·킬스위치·일일상한·사용량 로그가 빠짐없이 걸린다.
 * (dead code 인 api/_ai_core/orchestrator.js, src/ai_planner/intent-classifier-llm.ts 는 전환 대상 아님 — 허용 목록.)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const ALLOW = new Set([
  'api/_ai_core/orchestrator.js',            // 호출처 0 (dead) — 전환 범위 밖
  'src/ai_planner/intent-classifier-llm.ts', // 테스트 전용 import (dead) — 전환 범위 밖
  'api/_crons/content-draft.js',             // SNS 캡션 생성 — 운영자 결정 보류(블로그/콘텐츠 계열)
]);
const ALLOW_PREFIX = ['api/_shared/llm/'];
const PATTERNS = [/@google\/generative-ai/, /@anthropic-ai\/sdk/, /generativelanguage\.googleapis\.com/, /api\.anthropic\.com/];

function walk(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|mjs|cjs|ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe('no direct LLM SDK usage outside api/_shared/llm', () => {
  it('api/ and src/ only reach Gemini/Claude through the adapter', () => {
    const offenders: string[] = [];
    for (const dir of ['api', 'src']) {
      for (const file of walk(join(ROOT, dir))) {
        const rel = relative(ROOT, file).replace(/\\/g, '/');
        if (ALLOW.has(rel) || ALLOW_PREFIX.some((p) => rel.startsWith(p))) continue;
        const src = readFileSync(file, 'utf8');
        if (PATTERNS.some((re) => re.test(src))) offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});
