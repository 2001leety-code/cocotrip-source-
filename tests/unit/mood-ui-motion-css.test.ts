import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

describe('MOOD 조작 크기와 절제된 버튼 움직임', () => {
  it('MOOD 화면의 기본 조작 요소를 44px 이상으로 제한한다', () => {
    expect(css).toMatch(/\.mood-surface\s+:where\(button, \[role='button'\], summary\)[\s\S]*?min-height:\s*44px/);
    expect(css).toMatch(/\.mood-surface\s+:where\(input:not\(\[type='checkbox'\]\):not\(\[type='radio'\]\), select\)[\s\S]*?min-height:\s*44px/);
    expect(css).toMatch(/button\[aria-label\][\s\S]*?min-width:\s*44px/);
  });

  it('3D 버튼은 짧은 속성만 움직이고 모션 감소 환경에서는 눌림·드롭 애니메이션을 끈다', () => {
    expect(css).toMatch(/\.mood-primary-action\s*\{[\s\S]*?transition-property:\s*transform, box-shadow, background-color, opacity;[\s\S]*?transition-duration:\s*120ms/);
    const reduced = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toMatch(/\.mood-primary-action:not\(:disabled\):active\s*\{[\s\S]*?transform:\s*none\s*!important/);
    expect(reduced).toMatch(/\.mood-route-drop-highlight\s*\{[\s\S]*?animation:\s*none\s*!important/);
    expect(reduced).not.toMatch(/\.mood-route-stop[^}]*transform:\s*none/);
  });
});
