/**
 * #1272 P2 후속 (2026-08-10) — T3(outro-fold)가 화면 위치를 "가정" 하지 못하게 잠근다.
 *
 * Pre-fix 의 두 가정 (하나의 근본원인: 재지 않고 상수로 믿었다)
 *   1. 뷰포트 높이가 812 라는 가정 → `clip: { y: 812 - 320 }` 하드코드.
 *      주석은 "현재 viewport 기준 하단 320px" 이라고 말하는데 코드는 상수였다.
 *   2. `scrollTo(document.body.scrollHeight)` 한 번이면 문서 맨 아래라는 가정 →
 *      늦게 도착하는 콘텐츠로 문서가 자라면 그 좌표는 더 이상 맨 아래가 아니다.
 *
 * 증상(CI 실측): 하단 고정 네비가 약 39px 잘린 프레임을 찍었고, 그 diff 가 서로 다른
 *   두 run 에서 12283px(ratio 0.11)로 **동일**했다 — 플래키가 아니라 "맨 아래가 아닌 곳"을
 *   결정적으로 찍고 있었다는 뜻이다.
 *
 * Post-fix: 뷰포트 높이는 런타임 측정값, 맨 아래는 "높이가 두 번 연속 같아질 때까지
 *   다시 내려가기" 로 확정하고, 캡처 전에 그 두 사실을 spec 이 직접 단정한다.
 *
 * 이 파일이 깨지면: 누군가 다시 뷰포트 높이를 상수로 박거나, settle 루프/단정을 지웠다.
 *   그 상태의 초록은 "잘린 화면을 정상으로 굳힌" 초록이다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const specPath = 'tests/visual/plan-detail-mobile.spec.ts';
const src = readFileSync(resolve(process.cwd(), specPath), 'utf8');
/** 설명 주석은 계약이 아니다 — 매칭 전에 제거(오탐 방지). */
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('#1272 P2 — outro clip 은 뷰포트를 재서 만든다', () => {
  it('spec 코드 어디에도 뷰포트 높이 상수(812)가 없다', () => {
    expect(code).not.toMatch(/812\s*-\s*320/);
    // clip 뿐 아니라 폴드 판정(T2)에서도 같은 가정을 하면 안 된다.
    expect(code).not.toMatch(/\b812\b/);
    const clipBlocks = code.match(/clip:\s*\{[^}]*\}/g) || [];
    expect(clipBlocks.length).toBeGreaterThan(0);
  });

  it('clip y 는 찍은 이미지에서 읽은 캡처 표면 높이로 만든다', () => {
    expect(code).toMatch(/window\.innerHeight/);
    // PNG IHDR 에서 높이를 읽는다 = 가정 없이 "이미지가 실제로 몇 px 인가".
    expect(code).toMatch(/readUInt32BE\(20\)/);
    expect(code).toMatch(/clip:\s*\{[^}]*y:\s*surfaceHeight\s*-\s*320/);
  });

  it('레이아웃 뷰포트와 캡처 표면이 같은지 단정한다 (851 vs 812 재발 차단)', () => {
    expect(code).toMatch(/expect\(geometry\.viewportHeight\)\.toBe\(surfaceHeight\)/);
  });

  it('문서 높이가 안정될 때까지 다시 맨 아래로 내려간다 (단일 scroll 가정 제거)', () => {
    // 루프 + 이전 높이 비교가 있어야 "안정" 을 판정할 수 있다.
    expect(code).toMatch(/for\s*\([^)]*\)\s*\{[\s\S]*scrollTo\([\s\S]*scrollHeight/);
    expect(code).toMatch(/scrollHeight/);
    expect(code).toMatch(/break/);
  });

  it('캡처 전에 "진짜 맨 아래" 와 뷰포트 높이를 단정한다', () => {
    expect(code).toMatch(/shortBy/);
    expect(code).toMatch(/expect\([^)]*shortBy[^)]*\)/);
    expect(code).toMatch(/expect\([^)]*viewportHeight[^)]*\)/);
  });
});
