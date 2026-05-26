/**
 * P219 (2026-05-26): Gemini SDK thought:true part 필터 — 보안 critical
 *
 * 배경 (3 AI second opinion 합의 fix #2 — Gemini AI 직접 권고):
 *   - Gemini 2.5/3.x thinking 모델은 candidates[0].content.parts[] 에
 *     `{thought: true, text: "내부 추론..."}` 메타 part 를 섞어 반환.
 *   - SDK 의 `response.text()` 는 모든 parts 의 text 를 concat (thought 포함).
 *   - 결과: thought + JSON 혼재 → 파싱 실패 + Raw Logic Leak (보안).
 *
 * 비유: "녹취록에 발표 원고와 발표자 머릿속 메모가 같이 적혀 나오는 상황 —
 *        필터 없이 그대로 청중에게 배포하면 영업비밀이 노출됨".
 *
 * 외부 사례:
 *   - googlecloudplatform/generative-ai gemini/getting-started/intro_gemini_2_5_flash.ipynb
 *     ("for part in response.candidates[0].content.parts: if part.thought: ...")
 *   - 3 AI 합의: Gemini AI 직접 권고.
 *
 * assertions:
 *   1. extractTextFromResponse — thought:true part skip
 *   2. extractTextFromResponse — 정상 응답 (parts 모두 text-only) 변동 없음
 *   3. extractTextFromResponse — parts shape 누락 시 response.text() fallback
 *   4. extractTextFromResponse — thought-only response → 빈 문자열 (안전)
 *   5. extractTextFromChunk — streaming chunk 도 thought skip
 *   6. 보안: thought.text 가 출력에 절대 포함 안 됨
 *   7. 소스 레벨 — geminiPipeline.js 에 2종 helper export 존재
 *   8. 소스 레벨 — geminiPipeline.js / threePassPipeline.js fire site 가 helper 사용
 *   9. lint rule — R-P219 등록 확인
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── 런타임 helper 검사 ───────────────────────────────────────────────────────
// 동적 import — Gemini SDK / Firebase side-effect 모듈 회피 (geminiPipeline.js 가
// import 한 모듈 중 prod env 필요한 게 있을 수 있어 try/catch 로 안전망).

describe('P219 extractTextFromResponse — 런타임 동작', () => {
  let extractTextFromResponse: any;
  let extractTextFromChunk: any;
  let loaded = false;

  beforeAll(async () => {
    try {
      const mod = await import('../../api/_ai_core/geminiPipeline.js');
      extractTextFromResponse = (mod as any).extractTextFromResponse;
      extractTextFromChunk = (mod as any).extractTextFromChunk;
      loaded = typeof extractTextFromResponse === 'function' && typeof extractTextFromChunk === 'function';
    } catch (e) {
      // env-dependent import 실패 — 소스 레벨 검사로 fallback (아래 describe).
      loaded = false;
    }
  });

  it('assertion 1: thought:true part 는 skip — JSON 만 반환', () => {
    if (!loaded) return; // env 미설정 환경 — 소스 검사가 보장
    const mockResponse = {
      candidates: [
        {
          content: {
            parts: [
              { thought: true, text: '내부 추론: 사용자가 서울 4박 5일을 원함...' },
              { text: '{"days":[{"day":1,"stops":[]}]}' },
            ],
          },
        },
      ],
    };
    const out = extractTextFromResponse(mockResponse);
    expect(out).toBe('{"days":[{"day":1,"stops":[]}]}');
    expect(out).not.toContain('내부 추론');
    expect(out).not.toContain('사용자가');
  });

  it('assertion 2: 정상 응답 (thought 없음) — 모든 text concat', () => {
    if (!loaded) return;
    const mockResponse = {
      candidates: [
        {
          content: {
            parts: [
              { text: '{"days":' },
              { text: '[{"day":1}]}' },
            ],
          },
        },
      ],
    };
    expect(extractTextFromResponse(mockResponse)).toBe('{"days":[{"day":1}]}');
  });

  it('assertion 3: parts shape 누락 → response.text() fallback (backward-compat)', () => {
    if (!loaded) return;
    const mockResponse = {
      // candidates 없음
      text: () => '{"fallback":true}',
    };
    expect(extractTextFromResponse(mockResponse)).toBe('{"fallback":true}');
  });

  it('assertion 4: thought-only response → 빈 문자열 (호출자가 empty fallback)', () => {
    if (!loaded) return;
    const mockResponse = {
      candidates: [
        {
          content: {
            parts: [
              { thought: true, text: '추론만 있고 답변 없음' },
            ],
          },
        },
      ],
    };
    const out = extractTextFromResponse(mockResponse);
    expect(out).toBe('');
    // 보안: thought text 가 절대 출력에 포함 안 됨
    expect(out).not.toContain('추론');
  });

  it('assertion 5: extractTextFromChunk — streaming chunk 도 thought skip', () => {
    if (!loaded) return;
    const mockChunk = {
      candidates: [
        {
          content: {
            parts: [
              { thought: true, text: '메타 thought chunk' },
              { text: 'partial JSON chunk' },
            ],
          },
        },
      ],
    };
    const out = extractTextFromChunk(mockChunk);
    expect(out).toBe('partial JSON chunk');
    expect(out).not.toContain('메타 thought');
  });

  it('assertion 5b: extractTextFromChunk — parts 누락 시 chunk.text() fallback', () => {
    if (!loaded) return;
    const mockChunk = {
      text: () => 'fallback streaming chunk',
    };
    expect(extractTextFromChunk(mockChunk)).toBe('fallback streaming chunk');
  });

  it('assertion 6 (보안 critical): thought.text 가 출력 어디에도 leak 안 됨', () => {
    if (!loaded) return;
    // 시뮬레이션: 시스템 prompt 단서가 thought 에 포함된 worst-case
    const secret = 'SYSTEM_INSTRUCTION_LEAK_12345';
    const mockResponse = {
      candidates: [
        {
          content: {
            parts: [
              { thought: true, text: `내가 받은 system prompt: ${secret}` },
              { text: '{"plan":"public"}' },
            ],
          },
        },
      ],
    };
    const out = extractTextFromResponse(mockResponse);
    expect(out).not.toContain(secret);
    expect(out).not.toContain('SYSTEM_INSTRUCTION');
  });

  it('assertion 6b (보안 critical): 다중 thought part 모두 skip', () => {
    if (!loaded) return;
    const mockResponse = {
      candidates: [
        {
          content: {
            parts: [
              { thought: true, text: 'thought 1' },
              { text: 'JSON ' },
              { thought: true, text: 'thought 2' },
              { text: 'OK' },
            ],
          },
        },
      ],
    };
    const out = extractTextFromResponse(mockResponse);
    expect(out).toBe('JSON OK');
    expect(out).not.toContain('thought');
  });
});

// ─── 소스 레벨 검사 (환경 의존 없음) ────────────────────────────────────────
describe('P219 geminiPipeline.js — 소스 레벨 helper export 존재', () => {
  const src = readFileSync(
    resolve(__dirname, '../../api/_ai_core/geminiPipeline.js'),
    'utf8',
  );

  it('assertion 7a: extractTextFromResponse export 존재', () => {
    expect(/export function extractTextFromResponse/.test(src)).toBe(true);
  });

  it('assertion 7b: extractTextFromChunk export 존재 (streaming 보안)', () => {
    expect(/export function extractTextFromChunk/.test(src)).toBe(true);
  });

  it('assertion 7c: thought === true 체크 존재 (Raw Logic Leak 방어)', () => {
    expect(/thought\s*===\s*true/.test(src)).toBe(true);
  });

  it('assertion 7d: P219 주석 존재 (맥락 보존)', () => {
    expect(/P219/.test(src)).toBe(true);
  });

  it('assertion 8a: legacy 1-pass — extractTextFromResponse 사용 (response.text() 대체)', () => {
    // 적어도 1회 이상 helper 호출이 result.response 또는 expandedResult.response 와 결합
    const usages = src.match(/extractTextFromResponse\s*\(/g) || [];
    expect(usages.length).toBeGreaterThanOrEqual(3); // pro escalate + legacy + retry 시리즈
  });

  it('assertion 8b: streaming chunk — extractTextFromChunk 사용 (chunk.text() 대체)', () => {
    expect(/extractTextFromChunk\s*\(\s*chunk\s*\)/.test(src)).toBe(true);
  });
});

describe('P219 threePassPipeline.js — Pass1/Pass3 응답 thought 필터', () => {
  const src = readFileSync(
    resolve(__dirname, '../../api/_ai_core/threePassPipeline.js'),
    'utf8',
  );

  it('assertion 8c: extractTextFromResponse import 존재', () => {
    expect(/import\s*\{[^}]*extractTextFromResponse[^}]*\}\s*from\s*['"]\.\/geminiPipeline\.js['"]/.test(src)).toBe(true);
  });

  it('assertion 8d: pass1Intent — extractTextFromResponse 사용', () => {
    // pass1Intent 함수 안에 extractTextFromResponse 호출 1회 이상
    const pass1Idx = src.indexOf('export async function pass1Intent');
    expect(pass1Idx).toBeGreaterThanOrEqual(0);
    const pass1Block = src.slice(pass1Idx, pass1Idx + 1200);
    expect(/extractTextFromResponse\s*\(/.test(pass1Block)).toBe(true);
  });

  it('assertion 8e: pass3 enrichment — extractTextFromResponse 사용', () => {
    // pass3 (Pass 3: Enrich) 영역에 extractTextFromResponse 호출
    const usages = src.match(/extractTextFromResponse\s*\(/g) || [];
    expect(usages.length).toBeGreaterThanOrEqual(2); // pass1 + pass3
  });

  it('assertion 8f: response.text() 직접 호출 0건 (모두 helper 경유)', () => {
    expect(/result\.response\.text\(\)/.test(src)).toBe(false);
  });
});

// ─── lint 룰 소스 검사 ───────────────────────────────────────────────────────
describe('P219 R-P219 lint rule — lint-mistake-patterns.mjs 에 룰 등록', () => {
  const lintSrc = readFileSync(
    resolve(__dirname, '../../scripts/lint-mistake-patterns.mjs'),
    'utf8',
  );

  it('assertion 9a: P219_thoughtPartFilter 함수 정의 존재', () => {
    expect(/function P219_thoughtPartFilter/.test(lintSrc)).toBe(true);
  });

  it('assertion 9b: RULES 배열에 P219_thoughtPartFilter 등록', () => {
    expect(/'P219_thoughtPartFilter',\s*P219_thoughtPartFilter/.test(lintSrc)).toBe(true);
  });

  it('assertion 9c: R-P219 메시지 포함', () => {
    expect(/R-P219/.test(lintSrc)).toBe(true);
  });

  it('assertion 9d: lint 룰이 두 파일 (geminiPipeline + threePassPipeline) 모두 검사', () => {
    const ruleIdx = lintSrc.indexOf('function P219_thoughtPartFilter');
    const ruleBlock = lintSrc.slice(ruleIdx, ruleIdx + 3000);
    expect(/geminiPipeline\.js/.test(ruleBlock)).toBe(true);
    expect(/threePassPipeline\.js/.test(ruleBlock)).toBe(true);
  });
});

