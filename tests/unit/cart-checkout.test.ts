/**
 * cart PR2e — CartCheckout 결제 흐름 (회귀 가드).
 * createCartOrder → PayPal Buttons → captureCartOrder → cart clear. CartPanel 배선.
 * PayPal SDK 컴포넌트라 render 테스트 대신 source 레벨 흐름 가드.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(process.cwd(), 'src/components/CartCheckout.tsx'), 'utf8');
const panelSrc = readFileSync(resolve(process.cwd(), 'src/components/CartButton.tsx'), 'utf8');

describe('cart PR2e — CartCheckout 결제 흐름', () => {
  it('createCartOrder → PayPal → captureCartOrder 연결', () => {
    expect(src).toMatch(/\/api\/createCartOrder/);
    expect(src).toMatch(/\/api\/captureCartOrder/);
    expect(src).toMatch(/createOrder:\s*\(\)\s*=>\s*orderID/);
    expect(src).toMatch(/onApprove/);
  });
  it('성공 시 cart clear', () => {
    expect(src).toMatch(/setStatus\('success'\)/);
    expect(src).toMatch(/await clear\(\)/);
  });
  it('client priceKRW 무시 — items 만 전달 (backend SSOT 재계산)', () => {
    expect(src).toMatch(/body:\s*JSON\.stringify\(\{\s*items/);
  });
  it('CartPanel 이 CartCheckout 사용 (결제하기 버튼)', () => {
    // 2026-06-11: CartCheckout lazy split (결제 진입 시에만 로드, main 번들 환원) — 정적 import → 동적 import().
    expect(panelSrc).toMatch(/import\(['"]\.\/CartCheckout['"]\)/);
    expect(panelSrc).toMatch(/<CartCheckout/);
    expect(panelSrc).toMatch(/setShowCheckout/);
  });
});
