import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

// 2026-06-10 디자인 정제 — overshoot/bounce easing 제거 회귀 가드 (impeccable A그룹).
// cubic-bezier 의 2번째 제어점(y1)이 1 초과 = 스프링/바운스 → 싸 보임, 정제 디자인(프리미엄)과 충돌.
// 정제 방향: 부드러운 ease-out(예: cubic-bezier(0.2, 0, 0.2, 1)) — overshoot 0.

const OVERSHOOT = /cubic-bezier\(\s*[\d.]+\s*,\s*1\.[0-9]/; // 2번째 인자 1.x(>1) = overshoot

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(css|tsx?|jsx?)$/.test(f)) out.push(p);
  }
  return out;
}

describe('no-overshoot-easing — 바운스 easing 0 (정제 디자인)', () => {
  it('src/ 에 overshoot cubic-bezier(2번째 인자 >1) 없음', () => {
    const offenders: string[] = [];
    for (const file of walk(join(process.cwd(), 'src'))) {
      if (OVERSHOOT.test(readFileSync(file, 'utf-8'))) offenders.push(file.replace(process.cwd(), '').replace(/\\/g, '/'));
    }
    expect(offenders).toEqual([]);
  });
});
