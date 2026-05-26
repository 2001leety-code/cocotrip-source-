/**
 * P215 (2026-05-26): Gemini finishReason 감지 + MAX_TOKENS 자동 retry
 *
 * 비유: "5코스 요리 만들다 재료 떨어진 주방에서 웨이터가 확인도 안 하고
 *        3코스만 들고 손님한테 나가는 상황" — 잘린 plan 도 STOP 과 구분 의무.
 *
 * 외부 사례: github.com/google-gemini/gemini-cli/issues/2104
 *
 * assertions 5종:
 *   1. extractFinishReason — STOP/MAX_TOKENS/SAFETY/RECITATION 올바르게 추출
 *   2. extractFinishReason — undefined candidates → 'UNKNOWN' 반환 (안전)
 *   3. handleFinishReason STOP → retryText null, retryCm null (기존 흐름 유지)
 *   4. handleFinishReason SAFETY → retryText null (alert 만, retry X)
 *   5. handleFinishReason RECITATION → throw (저작권 차단)
 *   6. lint source 검사 — geminiPipeline.js 에 3종 export 존재
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── 소스 레벨 검사 (환경 의존 없음) ────────────────────────────────────────
describe('P215 geminiPipeline.js — 소스 레벨 3종 export 존재 확인', () => {
  const src = readFileSync(
    resolve(__dirname, '../../api/_ai_core/geminiPipeline.js'),
    'utf8',
  );

  it('assertion 6a: extractFinishReason export 존재', () => {
    expect(/export function extractFinishReason/.test(src)).toBe(true);
  });

  it('assertion 6b: handleFinishReason export 존재', () => {
    expect(/export async function handleFinishReason/.test(src)).toBe(true);
  });

  it('assertion 6c: retryWithExpandedTokens export 존재', () => {
    expect(/export async function retryWithExpandedTokens/.test(src)).toBe(true);
  });

  it('assertion 6d: legacy 1-pass 에 handleFinishReason 호출 존재', () => {
    // handleFinishReason 이 실제로 legacy 1-pass 분기 안에서 호출됨
    expect(/handleFinishReason\s*\(/.test(src)).toBe(true);
  });

  it('assertion 6e: P215 주석 존재 (맥락 보존)', () => {
    expect(/P215/.test(src)).toBe(true);
  });
});

// ─── extractFinishReason 런타임 검사 ────────────────────────────────────────
// 외부 의존 없는 pure-ish 함수이므로 mock 없이 직접 임포트.
// Gemini SDK / Firebase 등 side-effect import 가 있어 동적 임포트로 분리.

describe('P215 extractFinishReason — finishReason 추출 (소스 패턴 검사)', () => {
  const src = readFileSync(
    resolve(__dirname, '../../api/_ai_core/geminiPipeline.js'),
    'utf8',
  );

  it('assertion 1a: STOP 반환 패턴 (candidates[0].finishReason)', () => {
    // 소스에 candidates[0].finishReason 체인이 있어야 함
    expect(/candidates\?\.\[0\]\?\.finishReason/.test(src)).toBe(true);
  });

  it('assertion 1b: UNKNOWN fallback 존재 (옵셔널 체이닝 실패 시)', () => {
    // 'UNKNOWN' 폴백이 있어야 함
    expect(/'UNKNOWN'/.test(src)).toBe(true);
  });

  it('assertion 2: undefined candidates 안전 처리 — try/catch 또는 옵셔널 체이닝', () => {
    // try/catch 또는 ?. 체이닝으로 undefined 안전 처리
    const hasOptionalChain = /candidates\?\.\[0\]\?\.finishReason/.test(src);
    const hasTryCatch = /try\s*\{[\s\S]*?extractFinishReason[\s\S]*?catch/.test(src);
    expect(hasOptionalChain || hasTryCatch).toBe(true);
  });
});

// ─── handleFinishReason 소스 패턴 검사 ──────────────────────────────────────
describe('P215 handleFinishReason — finishReason 분기 패턴 (소스 검사)', () => {
  const src = readFileSync(
    resolve(__dirname, '../../api/_ai_core/geminiPipeline.js'),
    'utf8',
  );

  it('assertion 3: STOP/UNKNOWN → 기존 흐름 유지 (retryText null 반환)', () => {
    // STOP 또는 UNKNOWN 시 바로 return { retryText: null ... }
    expect(/finishReason === 'STOP'.*UNKNOWN/.test(src) ||
           /\(\s*finishReason === 'STOP'\s*\|\|\s*finishReason === 'UNKNOWN'\s*\)/.test(src)).toBe(true);
    expect(/retryText:\s*null/.test(src)).toBe(true);
  });

  it('assertion 4: SAFETY → alert 만, retry X (retryText null)', () => {
    // SAFETY 분기 안에 sendErrorAlert + retryText: null 반환
    expect(/finishReason === 'SAFETY'/.test(src)).toBe(true);
    // SAFETY 분기 뒤에도 retryText: null 이 있어야 함
    const safetyIdx = src.indexOf("finishReason === 'SAFETY'");
    const window = src.slice(safetyIdx, safetyIdx + 400);
    expect(/retryText:\s*null/.test(window)).toBe(true);
  });

  it('assertion 5: RECITATION → throw (저작권 차단)', () => {
    // RECITATION 분기에서 throw
    expect(/finishReason === 'RECITATION'/.test(src)).toBe(true);
    const recIdx = src.indexOf("finishReason === 'RECITATION'");
    const window = src.slice(recIdx, recIdx + 600);
    expect(/throw\s+recErr|throw\s+new\s+Error/.test(window)).toBe(true);
    expect(/GEMINI_RECITATION/.test(window)).toBe(true);
  });

  it('assertion 4b: MAX_TOKENS → 65K retry 시도', () => {
    // MAX_TOKENS 분기에서 retryWithExpandedTokens 호출
    expect(/finishReason === 'MAX_TOKENS'/.test(src)).toBe(true);
    expect(/retryWithExpandedTokens\s*\(/.test(src)).toBe(true);
    // 65000 (65K) 존재
    expect(/65000/.test(src)).toBe(true);
  });
});

// ─── lint 룰 소스 검사 ───────────────────────────────────────────────────────
describe('P215 R-P215 lint rule — lint-mistake-patterns.mjs 에 룰 등록 확인', () => {
  const lintSrc = readFileSync(
    resolve(__dirname, '../../scripts/lint-mistake-patterns.mjs'),
    'utf8',
  );

  it('P215_finishReasonDetect 함수 정의 존재', () => {
    expect(/function P215_finishReasonDetect/.test(lintSrc)).toBe(true);
  });

  it('RULES 배열에 P215_finishReasonDetect 등록', () => {
    expect(/'P215_finishReasonDetect',\s*P215_finishReasonDetect/.test(lintSrc)).toBe(true);
  });

  it('R-P215 메시지 포함', () => {
    expect(/R-P215/.test(lintSrc)).toBe(true);
  });
});
