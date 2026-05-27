/**
 * P240 — block_mode allergen 미전달 SAFETY fix 검증 (SAFETY-CRITICAL)
 *
 * P238 시각 검증 발견 (2026-05-27):
 *   - handlerCore.js 203-213: shaped 구조분해 시 allergies 미포함
 *   - handlerCore.js 294: tryRunBlockMode userInput 에 allergies 누락
 *   - blockMode.js: selectBlocksWithGemini / selectBlocksMultiCity Gemini prompt 에 food_allergies 미주입
 *   결과: block 선택 AI 가 외국인 땅콩/견과 알레르기 모름 = 건강 위험
 *
 * assertion 3종:
 *   1. handlerCore.js 소스: shaped 구조분해에 allergies 있어야 함
 *   2. handlerCore.js 소스: tryRunBlockMode userInput 에 allergies 있어야 함
 *   3. blockMode.js 소스: selectBlocksWithGemini/MultiCity userMessage 에 food_allergies 있어야 함
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../');

function readHandlerCore(): string {
  return readFileSync(resolve(ROOT, 'api/_ai_core/handlerCore.js'), 'utf-8');
}

function readBlockMode(): string {
  return readFileSync(resolve(ROOT, 'api/_ai_core/blockMode.js'), 'utf-8');
}

// ────────────────────────────────────────────────────────────────────────────
// assertion 1: handlerCore.js shaped 구조분해에 allergies 있어야 함
// ────────────────────────────────────────────────────────────────────────────
describe('P240 SAFETY: handlerCore shaped 구조분해', () => {
  it('shaped 구조분해 { ... } 블록에 allergies 가 포함되어야 함', () => {
    const src = readHandlerCore();

    // shaped 구조분해 블록 추출 (const { ... } = shaped; 패턴)
    const destructureMatch = src.match(/const\s*\{([^}]+)\}\s*=\s*shaped\s*;/);
    expect(
      destructureMatch,
      'handlerCore.js 에서 `const { ... } = shaped;` 패턴을 찾을 수 없음'
    ).toBeTruthy();

    const destructuredFields = destructureMatch![1];
    expect(
      destructuredFields,
      'P240 SAFETY-CRITICAL: shaped 구조분해에 allergies 없음 — ' +
      'tryRunBlockMode 에 allergies 전달 불가. ' +
      '비유: "알레르기 서류를 접수는 했지만 주방에 전달 안 함"'
    ).toMatch(/\ballergies\b/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// assertion 2: handlerCore.js tryRunBlockMode 호출 userInput 에 allergies 있어야 함
// ────────────────────────────────────────────────────────────────────────────
describe('P240 SAFETY: handlerCore tryRunBlockMode userInput', () => {
  it('tryRunBlockMode 호출의 userInput 객체에 allergies 가 포함되어야 함', () => {
    const src = readHandlerCore();

    // tryRunBlockMode 호출 라인 추출
    const blockModeCallMatch = src.match(/tryRunBlockMode\s*\(\s*\{[^}]*userInput\s*:\s*\{[^}]*\}/);
    expect(
      blockModeCallMatch,
      'handlerCore.js 에서 tryRunBlockMode 호출을 찾을 수 없음'
    ).toBeTruthy();

    const callStr = blockModeCallMatch![0];
    expect(
      callStr,
      'P240 SAFETY-CRITICAL: tryRunBlockMode userInput 에 allergies 없음 — ' +
      '외국인 알레르기 정보 block 선택 AI 에 미전달. ' +
      '비유: "땅콩 알레르기 있는 손님 정보를 메뉴 선택 직전에 빠뜨림"'
    ).toMatch(/\ballergies\b/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// assertion 3: blockMode.js selectBlocksWithGemini/MultiCity userMessage 에 food_allergies 있어야 함
// ────────────────────────────────────────────────────────────────────────────
describe('P240 SAFETY: blockMode Gemini prompt food_allergies 주입', () => {
  it('selectBlocksWithGemini userMessage 에 food_allergies 가 포함되어야 함', () => {
    const src = readBlockMode();

    // selectBlocksWithGemini 함수 본문 추출
    const funcStart = src.indexOf('export async function selectBlocksWithGemini');
    expect(funcStart, 'blockMode.js 에서 selectBlocksWithGemini 함수를 찾을 수 없음').toBeGreaterThan(-1);

    // 함수 본문 (다음 export 까지)
    const nextExport = src.indexOf('\nexport ', funcStart + 1);
    const funcBody = nextExport > -1 ? src.slice(funcStart, nextExport) : src.slice(funcStart);

    expect(
      funcBody,
      'P240 SAFETY-CRITICAL: blockMode.selectBlocksWithGemini userMessage 에 food_allergies 없음 — ' +
      '알레르기 정보 Gemini prompt 미전달 = block 선택 시 알레르기 식재료 포함 블록 추천 가능. ' +
      '비유: "알레르기 메모를 요리사 주문서에서 빠뜨림"'
    ).toMatch(/food_allergies/);
  });

  it('selectBlocksMultiCity userMessage 에 food_allergies 가 포함되어야 함 (다도시 plan)', () => {
    const src = readBlockMode();

    // selectBlocksMultiCity 함수 본문 추출
    const funcStart = src.indexOf('export async function selectBlocksMultiCity');
    expect(funcStart, 'blockMode.js 에서 selectBlocksMultiCity 함수를 찾을 수 없음').toBeGreaterThan(-1);

    const nextExport = src.indexOf('\nexport ', funcStart + 1);
    const funcBody = nextExport > -1 ? src.slice(funcStart, nextExport) : src.slice(funcStart);

    expect(
      funcBody,
      'P240 SAFETY-CRITICAL: blockMode.selectBlocksMultiCity userMessage 에 food_allergies 없음 — ' +
      '다도시 plan 시 알레르기 정보 Gemini 미전달. ' +
      '비유: "서울-부산 2도시 여행에서 알레르기 메모를 두 번째 도시 주방에 전달 안 함"'
    ).toMatch(/food_allergies/);
  });

  it('allergies 없는 사용자 (빈 배열) 는 food_allergies field 생략되어야 함 (undefined 처리)', () => {
    const src = readBlockMode();
    // food_allergies: allergies.length > 0 ? allergies : undefined 패턴 확인
    expect(
      src,
      'blockMode.js 에서 allergies 빈 배열 시 food_allergies undefined 처리 패턴 없음 — ' +
      '알레르기 없는 사용자 prompt 불필요한 필드 추가 방지'
    ).toMatch(/food_allergies\s*:\s*allergies\.length\s*>\s*0\s*\?\s*allergies\s*:\s*undefined/);
  });
});
