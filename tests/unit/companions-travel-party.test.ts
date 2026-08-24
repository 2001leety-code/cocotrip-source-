/**
 * UIUX P3 동행 유형(companions) 회귀 (2026-07-13, 운영자 승인 4옵션)
 * - buildBlockModePrompt: companions 설정 시 user JSON 에 travel_party 포함, 미설정 시 미포함
 *   (미선택 = 기존 프롬프트 byte-identical 보장 — Gemini 캐시 안전).
 * - 배선 드리프트 가드: 두 프롬프트 경로(blockMode + legacy userMessageBuilder) 모두 존재해야 함
 *   (block_mode 사각 재발 방지 — 불변식은 두 경로 다).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { buildBlockModePrompt } from '../../api/_ai_core/buildPrompt.js';

const r = (p: string) => resolve(__dirname, '../../', p);
const src = (p: string) => readFileSync(r(p), 'utf8');

const BLOCKS = [{ id: 'b1', zone: 'Myeongdong', theme: 'food', intensity: 'easy', duration_min: 480, best_for: ['food'], dietary_options: [] }];

describe('companions → travel_party (blockMode 프롬프트)', () => {
  it('companions 설정 시 user JSON 에 travel_party 포함', () => {
    const { user } = buildBlockModePrompt(BLOCKS, { durationDays: 2, styles: ['food'], language: 'en', companions: 'family' });
    expect(JSON.parse(user).travel_party).toBe('family');
  });

  it('미설정/무효값 = travel_party 키 자체가 없음 (기존 프롬프트 불변)', () => {
    const without = buildBlockModePrompt(BLOCKS, { durationDays: 2, styles: ['food'], language: 'en' });
    expect('travel_party' in JSON.parse(without.user)).toBe(false);
    const invalid = buildBlockModePrompt(BLOCKS, { durationDays: 2, styles: ['food'], language: 'en', companions: 'aliens' });
    expect('travel_party' in JSON.parse(invalid.user)).toBe(false);
  });

  it('system prompt 는 companions 와 무관하게 동일 (Gemini 캐시 prefix 안전)', () => {
    const a = buildBlockModePrompt(BLOCKS, { durationDays: 2, styles: [], language: 'en' });
    const b = buildBlockModePrompt(BLOCKS, { durationDays: 2, styles: [], language: 'en', companions: 'couple' });
    expect(a.system).toBe(b.system);
  });
});

describe('companions 배선 드리프트 가드 (두 경로 + 전 구간)', () => {
  it('requestShaper 가 4옵션 화이트리스트 검증한다', () => {
    expect(src('api/_ai_core/requestShaper.js')).toMatch(/\['solo', 'couple', 'family', 'friends'\]\.includes\(body\.companions\)/);
  });
  it('handlerCore 가 blockMode userInput 에 companions 를 전달한다', () => {
    // planner-intent-v1 (2026-08-24): userInput 객체가 arrival_city/pace/spice 등으로
    // 확장되며 companions 뒤가 더 이상 `}` 로 바로 안 닫힌다 — trailing comma 로 검증.
    expect(src('api/_ai_core/handlerCore.js')).toMatch(/pax, mobility, companions,/);
  });
  it('legacy 경로(userMessageBuilder)에도 travel_party 가 있다', () => {
    expect(src('api/_ai_core/userMessageBuilder.js')).toMatch(/travel_party: companions \|\| undefined/);
  });
  it('planPersister 가 입력을 보존한다 (retryOf 재생성용)', () => {
    expect(src('api/_ai_core/planPersister.js')).toMatch(/companions: body\.companions \|\| null/);
  });
  it('프론트 payload 가 미선택 시 필드를 아예 안 보낸다', () => {
    // planner-intent-v1: 이 매핑도 lib/plannerIntent.ts::flattenPlannerIntentV1 로
    // 이동했다 — `|| undefined` 값은 JSON.stringify 직렬화 시 키째로 사라져 동일 계약.
    expect(src('src/pages/PlannerPage/lib/plannerIntent.ts')).toMatch(/companions: intent\.companions \|\| undefined/);
  });
});
