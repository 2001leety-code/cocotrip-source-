// 편집형 종이·잉크 — 투어 목록(ToursPage) 회귀 방지. firebase-free.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const read = (rel: string) => readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), rel), 'utf8');
const TP = read('../../src/pages/ToursPage.tsx');
const CSS = read('../../src/styles/editorial-tours-catalog.css');

describe('투어 목록 편집형 셸 (ToursPage)', () => {
  it('기능 플래그 없이 편집형 셸을 일관되게 사용한다', () => {
    expect(TP).toContain('ec-root tours-catalog-editorial');
    expect(TP).not.toMatch(/const REFINED\s*=/);
    expect(TP).not.toContain('refined-tours');
  });

  it('종이·잉크 토큰을 쓰고 글로우·그라디언트를 되살리지 않는다', () => {
    expect(CSS).toMatch(/\.tours-catalog-editorial\s*\{[^}]*var\(--ec-surface-page\)/);
    expect(CSS).toContain('.tour-catalog-card');
    expect(CSS).not.toMatch(/linear-gradient|radial-gradient|backdrop-filter/);
  });
});
