/**
 * build-food-index-busan-phase6-removed.test.ts
 *
 * 5/25 sweep: busan_seafood / busan_cafe / busan_restaurant / busan_attraction
 * 4 파일 미존재 확인 → 참조 코드 완전 제거 (silent 빈 배열 차단).
 *
 * 이 test 는 제거된 파일명이 scripts/build-food-index.js 에 다시
 * 슬그머니 추가되지 않도록 막는 regression guard 역할.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = join(__dirname, '..', '..', 'scripts', 'build-food-index.js');

const scriptContent = readFileSync(SCRIPT_PATH, 'utf-8');

describe('build-food-index — Busan Phase 6 stale 참조 제거 (5/25 sweep)', () => {
  const REMOVED_FILES = [
    'busan_seafood',
    'busan_cafe',
    'busan_restaurant',
    'busan_attraction',
  ] as const;

  for (const file of REMOVED_FILES) {
    it(`${file}.json 참조가 스크립트에 없어야 함`, () => {
      expect(scriptContent).not.toContain(file);
    });
  }
});
