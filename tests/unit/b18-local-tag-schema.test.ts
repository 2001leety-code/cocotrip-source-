/**
 * B-18 local_tag 스키마 불변식 (2026-07-03 근본원인 fix 잠금).
 *
 * 근본원인: Gemini 구조화출력(responseSchema)은 스키마에 없는 필드를 물리적으로 못 낸다.
 * P183 phase 2(2026-05-24)에서 PLAN_RESPONSE_SCHEMA 도입 시 stop 에 local_tag 를 빠뜨려
 * 프롬프트 "LOCAL TAG — MANDATORY" 가 무력화 → 모든 Gemini plan local_tag 0% 확정
 * → 소프트경고 B-18 이 매 plan 발화(운영자 디스코드 반복 알림).
 *
 * 잠금: 스키마 stop properties·propertyOrdering 에 local_tag 가 없어지면 터진다.
 * (프롬프트 지시와 스키마는 항상 쌍 — 한쪽만 고치면 재발.)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');

describe('B-18 local_tag — 스키마·프롬프트 쌍 불변식', () => {
  it('PLAN_RESPONSE_SCHEMA stop properties 에 local_tag 존재 (구조화출력이 필드를 낼 수 있어야 함)', () => {
    const src = read('../../api/_ai_core/geminiPipeline.js');
    expect(src).toMatch(/local_tag:\s*\{\s*type:\s*'STRING'\s*\}/);
  });

  it('stop propertyOrdering 에도 local_tag 포함 (누락 시 emission 순서 밖 필드)', () => {
    const src = read('../../api/_ai_core/geminiPipeline.js');
    const ordering = src.match(/propertyOrdering:\s*\[([^\]]*'start_time'[^\]]*'verified'[^\]]*)\]/);
    expect(ordering).not.toBeNull();
    expect(ordering![1]).toContain("'local_tag'");
  });

  it('buildPrompt 의 LOCAL TAG MANDATORY 지시 유지 (스키마만 있고 지시 없으면 태그 안 채움)', () => {
    const src = read('../../api/_ai_core/buildPrompt.js');
    expect(src).toMatch(/LOCAL TAG — MANDATORY/);
    expect(src).toMatch(/Local Pick/);
  });

  it('required 에 local_tag 넣지 않는다 (P196 lesson — 강제 시 표준 stop 에도 태그 강요→과충전)', () => {
    const src = read('../../api/_ai_core/geminiPipeline.js');
    const req = src.match(/required:\s*\[\s*'name',\s*'category',\s*'start_time'\s*\]/);
    expect(req).not.toBeNull();
  });
});
