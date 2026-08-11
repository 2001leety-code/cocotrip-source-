// /charter 비결제 견적 단계 — 탭 타깃/iOS 자동확대 CSS 근본원인 회귀 슬롯 (2026-08-11).
//
// 실측(local production build · 390/768/1440 × ko/en/ja/zh)에서 나온 세 원인:
//   A. `.coco-stepper-dot` 이 곧 <button> 이라 26×26px — 12조합 전부 44px 미달.
//   B. 모바일(@media max-width:768px) 규칙
//      `.cocotrip-mobile-booking-form :is(input,textarea,select){font-size:14px!important}`
//      이 index.css §5 의 iOS 자동확대 가드(`font-size: max(16px,1rem)`)를
//      "모바일에서만" 되돌리고 있었다 → Step5 입력 전부 14px = iOS 포커스 시 확대.
//   C. 같은 블록의 `.cocotrip-mobile-booking-form [style*="width: 44px"]{width:38px}`
//      이 이미 44px 이던 수하물 ± 버튼만 골라 38px 로 줄이고 있었다
//      (해당 셀렉터에 걸리는 인라인 44px 요소는 BookingInfoForm 의 Counter 버튼뿐).
//
// 이 파일이 깨지면 위 셋 중 하나가 되돌아온 것이다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CSS = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/index.css'),
  'utf8',
);

/** 셀렉터가 정확히 `selector` 인 규칙의 선언 본문을 뽑는다 (중첩 없는 flat 규칙 전제). */
function block(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|[};{])\\s*${esc}\\s*\\{([^{}]*)\\}`, 'm');
  const m = re.exec(CSS);
  expect(m, `셀렉터를 못 찾음: ${selector}`).not.toBeNull();
  return m![1];
}

describe('A. CocoStepper hit 래퍼 — 44×44', () => {
  it('.coco-stepper-hit 이 최소 44×44 를 강제한다', () => {
    const b = block('.coco-stepper-hit');
    expect(b).toMatch(/min-width:\s*44px/);
    expect(b).toMatch(/min-height:\s*44px/);
  });

  it('시각 점(.coco-stepper-dot)은 26px 그대로 — 점을 키우지 않았다', () => {
    const b = block('.coco-stepper-dot');
    expect(b).toMatch(/width:\s*26px/);
    expect(b).toMatch(/height:\s*26px/);
    // 점은 더 이상 포인터 타깃이 아니다 (래퍼 버튼이 받는다).
    expect(b).toMatch(/pointer-events:\s*none/);
  });

  it('키보드 포커스가 보이는 링을 갖는다', () => {
    expect(CSS).toMatch(/\.coco-stepper-hit:focus-visible/);
  });
});

describe('B. iOS 자동확대 가드 — 모바일 예약폼 입력 16px', () => {
  it('index.css §5 전역 가드가 그대로 있다', () => {
    expect(CSS).toMatch(/font-size:\s*max\(16px,\s*1rem\)/);
  });

  it('.cocotrip-mobile-booking-form 입력이 16px 미만으로 재정의되지 않는다', () => {
    const b = block('.cocotrip-mobile-booking-form :is(input, textarea, select)');
    const m = /font-size:\s*(\d+)px/.exec(b);
    expect(m, '모바일 예약폼 입력 font-size 선언을 못 찾음').not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(16);
    // 44px 최소 높이는 유지되어야 한다.
    expect(b).toMatch(/min-height:\s*44px/);
  });
});

describe('C. 수하물 ± 버튼 축소 규칙 제거', () => {
  it('인라인 44px 요소를 38px 로 줄이는 규칙이 없다', () => {
    expect(CSS).not.toMatch(/\.cocotrip-mobile-booking-form\s*\[style\*="width: 44px"\]/);
  });
});
