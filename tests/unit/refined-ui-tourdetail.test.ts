// 투어 상세는 Korea Editorial Concierge 전환 완료 — 레거시 refined 보정이 돌아오지 않게 잠근다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const read = (rel: string) => readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), rel), 'utf8');
const TD = read('../../src/pages/TourDetailPage.tsx');
const CSS = read('../../src/styles/editorial-tour-detail.css');

describe('투어 상세 편집형 전환', () => {
  it('TourDetailPage: 레거시 refined/mobile 이중 스코프를 사용하지 않는다', () => {
    expect(TD).toContain("import '@/styles/editorial-tour-detail.css'");
    expect(TD).toContain('tour-detail-editorial');
    expect(TD).not.toMatch(/const REFINED\s*=/);
    expect(TD).not.toContain('refined-page');
    expect(TD).not.toContain('cocotrip-mobile-tour-detail');
  });

  it('전용 CSS 는 토큰만 쓰고 그라디언트·글로우·유리 보정을 만들지 않는다', () => {
    expect(CSS).toContain('var(--ec-surface-page)');
    expect(CSS).toContain('var(--ec-line)');
    expect(CSS).not.toMatch(/(?:linear|radial)-gradient/i);
    expect(CSS).not.toMatch(/backdrop-filter|!important/i);
  });
});
