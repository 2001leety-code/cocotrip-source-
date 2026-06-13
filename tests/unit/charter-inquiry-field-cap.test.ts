/**
 * firestore.rules charter_inquiries — field cap 회귀 (2026-06-13 DoS 헌트).
 * 결함: 익명 create 가 notes/name/phone(사용자-제어 free-text) 무제한 → 오버사이즈
 *   spam-write 로 Firestore quota/storage 소진 가능.
 * fix: notes<=5000 / name<=200 / phone<=50 (null 허용=additive, 정상 write 무영향).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const rules = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');

function charterBlock(): string {
  const idx = rules.indexOf('match /charter_inquiries/');
  return rules.slice(idx, idx + 2400);
}

describe('firestore.rules charter_inquiries — field cap (DoS 가드)', () => {
  it('notes/name/phone size cap', () => {
    const block = charterBlock();
    expect(block).toMatch(/notes\.size\(\)\s*<=\s*5000/);
    expect(block).toMatch(/name\.size\(\)\s*<=\s*200/);
    expect(block).toMatch(/phone\.size\(\)\s*<=\s*50/);
  });
  it('null 허용 폴백(additive — 정상 string|null write 무영향)', () => {
    const block = charterBlock();
    expect(block).toMatch(/notes\s*==\s*null/);
    expect(block).toMatch(/name\s*==\s*null/);
    expect(block).toMatch(/phone\s*==\s*null/);
  });
});
