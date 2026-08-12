// 구형 정제 플래그를 제거하고 Editorial Concierge 종이 셸로 전환한 회귀 잠금.
// PDF/데이터/편집 동작은 기존 배선을 유지한다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const read = (rel: string) => readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), rel), 'utf8');
const PD = read('../../src/pages/PlanDetailPage/index.tsx');
const CSS = read('../../src/index.css');

describe('플랜 결과 Editorial Concierge 셸 (PlanDetailPage)', () => {
  it('구형 REFINED 플래그 없이 공통 종이 셸을 쓴다', () => {
    expect(PD).not.toMatch(/const REFINED\s*=/);
    expect(PD).not.toContain('VITE_FEATURE_REFINED_UI');
    expect(PD).toContain('className="ec-root min-h-screen"');
  });

  it('공용 전역 cascade는 다른 화면 보호를 위해 유지한다', () => {
    expect(CSS).toContain('.refined-plandetail');
    expect(CSS).toContain('.planner-detail-mobile-ai');
    expect(PD).not.toContain('refined-plandetail');
    expect(PD).not.toContain('planner-detail-mobile-ai');
  });

  it('PDF·편집·리뷰 배선은 그대로 남긴다', () => {
    for (const contract of ['generatePDF', 'usePlanEditor', 'ReviewList']) expect(PD).toContain(contract);
  });
});
