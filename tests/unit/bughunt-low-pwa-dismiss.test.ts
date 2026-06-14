/**
 * Regression guard — bughunt LOW: X 버튼 dismiss 시 5분 재표시 데드 기능 수정
 *
 * 버그: PWAUpdatePrompt.tsx X 버튼 onClick 이
 *   setNeedRefresh(false); setDismissed(true);
 * 를 동시 호출. L72-77 effect 는 5분 뒤 setDismissed(false) 로 되돌려
 * 토스트를 재표시하려 하지만, 렌더 가드 L81
 *   if (!needRefresh || dismissed) return null
 * 에서 needRefresh 가 이미 false 라 토스트가 절대 재노출되지 않음.
 * → "5분 뒤 자동 재표시" 의도가 작동 안 하는 데드 기능.
 *
 * 수정: dismiss(X) 시 setNeedRefresh(false) 호출 제거 → setDismissed(true) 만.
 * needRefresh 가 true 로 유지되므로 5분 후 dismissed=false 가 되면 토스트 재노출.
 * P235 보호(세션중 강제리로드 방지) 와 무관 — dismiss 는 토스트 숨김만, SW 상태 불변.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(
  resolve(process.cwd(), 'src/components/PWAUpdatePrompt.tsx'),
  'utf8',
);

describe('bughunt-low: PWAUpdatePrompt X 버튼 dismiss 수정', () => {
  it('X 버튼 onClick 에 setNeedRefresh(false) 가 없다', () => {
    // dismiss(X) onClick 안에서 setNeedRefresh(false) 를 호출하면
    // 5분 뒤 재표시 로직이 데드 코드가 됨 — 이 패턴이 없어야 fix 상태.
    // onClick 이 aria-label="Dismiss" 앞에 있으므로 onClick 기준으로 검색.
    const dismissBlock = src.match(/onClick[\s\S]{0,200}aria-label="Dismiss"/);
    const blockText = dismissBlock ? dismissBlock[0] : '';
    expect(blockText).not.toMatch(/setNeedRefresh\s*\(\s*false\s*\)/);
  });

  it('X 버튼 onClick 이 setDismissed(true) 를 호출한다', () => {
    // dismiss 는 토스트만 숨기고 needRefresh 는 유지해야 5분 후 재표시 가능.
    const dismissBlock = src.match(/onClick[\s\S]{0,200}aria-label="Dismiss"/);
    const blockText = dismissBlock ? dismissBlock[0] : '';
    expect(blockText).toMatch(/setDismissed\s*\(\s*true\s*\)/);
  });

  it('5분 재표시 effect 가 여전히 존재한다 (로직 제거 방지)', () => {
    // setDismissed(false) 를 5분 후 호출하는 effect 가 살아 있는지 확인.
    expect(src).toMatch(/setDismissed\s*\(\s*false\s*\)/);
    expect(src).toMatch(/5\s*\*\s*60\s*\*\s*1000/);
  });

  it('렌더 가드가 needRefresh && !dismissed 조건을 유지한다', () => {
    // L81: if (!needRefresh || dismissed) return null
    // needRefresh 가 true 여야 5분 뒤 재표시가 가능.
    expect(src).toMatch(/!\s*needRefresh\s*\|\|\s*dismissed/);
  });

  it('전체 소스에서 nullish 연산자를 사용하지 않는다', () => {
    // 코딩 규칙: nullish 금지 → || 사용.
    expect(src).not.toMatch(/\?\?/);
  });
});
