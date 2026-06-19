/**
 * 버그헌트 — 돈 코어 회귀 슬롯 (2026-06-14).
 *
 * 두 개의 돈/회계 버그를 잠그는 정적 소스-shape 검증. 두 핸들러(createPaypalOrder /
 * capturePaypalOrder) 는 Firestore admin · PayPal · 텔레그램 등 부작용 import 가 많아
 * 단위 테스트에서 핸들러 자체를 부르면 환경이 필요하다. 따라서 기존 PR #427/#431 슬롯과
 * 동일하게 소스 텍스트 shape 으로 버그 패턴 + 향후 리팩터 회귀를 잡는다.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 버그 #2 — WELCOME 쿠폰 표시≠청구 + 소진 (HIGH 돈)
 *   가입 시 모든 사용자에게 WELCOME-CHARTER(5%) 쿠폰 발급. 차터 결제창 쿠폰 피커가
 *   FEATURE_DISCOUNT_V2 와 무관하게 항상 노출 → 적용 시 화면은 할인가 표시.
 *   그러나 createPaypalOrder.js 의 쿠폰 청구 반영은 `if (discountV2 && …)` v2 게이트라
 *   v2 OFF(현 prod 기본)면 청구가 미반영 = 정가 청구. 반면 capturePaypalOrder 의 쿠폰
 *   소진(isUsed=true)은 v2 게이트 없이 무조건 실행 → 쿠폰 burn.
 *   결과: 화면 5%할인가 / 실제 정가 청구(+5.56% 초과) / 1회용 쿠폰 소진.
 *   Fix: (a) capture 소진을 createPaypalOrder 와 동일 v2 조건으로 게이트(v2 OFF면 스킵),
 *        (b) 프론트 쿠폰 피커를 discountV2 OFF면 숨김. createPaypalOrder 청구 게이트는 그대로.
 *        → v2 OFF: 정가·쿠폰 미노출·미소진 / v2 ON: 정상.
 *
 * 버그 #15 — capture 환율 고정 1430 (MEDIUM 회계)
 *   capturePaypalOrder 가 usdToKrw = env || 1430 정적 → bookings 에 capturedExchangeRate/
 *   amountKRW 저장. 시스템 FX SSOT 는 _exchange-rate.js getUsdToKrwRaw()(라이브 4소스+floor),
 *   booking-processor.js 도 라이브 사용 → 같은 거래에 두 KRW 공존 + 회계 부정확.
 *   Fix: capture 의 usdToKrw 를 getUsdToKrwRaw() 라이브로 통일, 실패 시 정책 floor(1450)
 *        폴백(1430 정적 의존 제거). best-effort — 실패해도 결제 진행.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const captureSrc = readFileSync(
  resolve(process.cwd(), 'api/capturePaypalOrder.js'),
  'utf8',
);
const createSrc = readFileSync(
  resolve(process.cwd(), 'api/createPaypalOrder.js'),
  'utf8',
);
const buttonSrc = readFileSync(
  resolve(process.cwd(), 'src/components/PayPalBookingButton.tsx'),
  'utf8',
);

describe('버그 #2 — 쿠폰 소진은 FEATURE_DISCOUNT_V2 로 게이트 (createPaypalOrder 청구 게이트와 일관)', () => {
  it('capture 가 featureEnabled helper 를 import 한다', () => {
    expect(captureSrc).toMatch(
      /import\s*\{\s*featureEnabled\s*\}\s*from\s*['"]\.\/_shared\/feature-flag\.js['"]/,
    );
  });

  it('capture 가 FEATURE_DISCOUNT_V2 플래그를 읽는다', () => {
    expect(captureSrc).toMatch(/featureEnabled\(\s*process\.env\.FEATURE_DISCOUNT_V2\s*\)/);
  });

  it('couponLockRef 생성이 discountV2 게이트 + 소유자 검증(IDOR)으로 보호된다', () => {
    // 핵심 회귀 가드: couponLockRef 삼항이 (1) discountV2(v2 OFF면 null → 소진 스킵) +
    //   (2) _couponOwnerVerified(버그헌트 #1 IDOR — 토큰 uid===couponUserId)를 포함해야 함.
    //   discountV2 빠지면 v2 OFF인데 쿠폰 소진(표시≠청구). 소유자검증 빠지면 타인 쿠폰 강제소진.
    expect(captureSrc).toMatch(
      /const\s+couponLockRef\s*=\s*\(\s*discountV2\s*&&\s*couponDocId\s*&&\s*couponUserId/,
    );
    expect(captureSrc).toContain('_couponOwnerVerified');
    expect(captureSrc).toMatch(/verifyTokenUid\s*\(\s*req\.headers/);
  });

  it('discountV2 게이트는 쿠폰 pre-lock(runTransaction) 보다 먼저 선언된다', () => {
    const flagIdx = captureSrc.indexOf('featureEnabled(process.env.FEATURE_DISCOUNT_V2)');
    const lockRefIdx = captureSrc.indexOf('const couponLockRef');
    const txIdx = captureSrc.indexOf('snap = await tx.get(couponLockRef)');
    expect(flagIdx).toBeGreaterThan(-1);
    expect(lockRefIdx).toBeGreaterThan(-1);
    expect(txIdx).toBeGreaterThan(-1);
    expect(flagIdx).toBeLessThan(lockRefIdx);
    expect(lockRefIdx).toBeLessThan(txIdx);
  });

  it('createPaypalOrder 청구 게이트는 동일한 v2 조건을 유지한다 (변경 금지 — 정가 청구가 올바름)', () => {
    // 두 경로(청구/소진)가 같은 플래그를 쓰는지 — 한쪽만 게이트되면 불일치.
    expect(createSrc).toMatch(
      /if\s*\(\s*discountV2\s*&&\s*couponDocId\s*&&\s*couponUserId\s*&&\s*!isAiPlanner\s*\)/,
    );
    expect(createSrc).toMatch(/featureEnabled\(\s*process\.env\.FEATURE_DISCOUNT_V2\s*\)/);
  });
});

describe('버그 #2 — 프론트 쿠폰 피커는 discountV2 활성 시에만 노출', () => {
  it('PayPalBookingButton 이 discountV2Enabled 를 import 한다', () => {
    expect(buttonSrc).toMatch(
      /import\s*\{\s*discountV2Enabled\s*\}\s*from\s*['"]@\/lib\/discountFlags['"]/,
    );
  });

  it('showCouponPicker 가 discountV2Enabled() 로 계산된다', () => {
    expect(buttonSrc).toMatch(/const\s+showCouponPicker\s*=\s*discountV2Enabled\(\)/);
  });

  it('쿠폰 피커 렌더 조건이 showCouponPicker 로 게이트된다', () => {
    // 피커 블록은 `{showCouponPicker && !showPaypal && !promoApplied && (` 로 시작.
    expect(buttonSrc).toMatch(/\{\s*showCouponPicker\s*&&\s*!showPaypal\s*&&\s*!promoApplied\s*&&\s*\(/);
  });
});

describe('버그 #15 — capture 환율은 라이브 FX SSOT 로 통일 (정적 1430 제거)', () => {
  it('정적 1430 폴백이 더 이상 존재하지 않는다', () => {
    // 이전 코드: Number(env.KRW_USD_RATE) || Number(env.VITE_USD_KRW_RATE) || 1430.
    // 회귀 가드: 어떤 형태로든 1430 정적 환율 폴백이 capture 에 다시 들어오면 실패.
    expect(captureSrc).not.toMatch(/\|\|\s*1430/);
    expect(captureSrc).not.toMatch(/process\.env\.KRW_USD_RATE/);
    expect(captureSrc).not.toMatch(/process\.env\.VITE_USD_KRW_RATE/);
  });

  it('booking-processor 와 동일한 getUsdToKrwRaw 라이브 환율을 사용한다', () => {
    expect(captureSrc).toMatch(/import\(\s*['"]\.\/_exchange-rate\.js['"]\s*\)/);
    expect(captureSrc).toMatch(/getUsdToKrwRaw\s*\(\s*\)/);
  });

  it('환율 실패 시 정책 floor(1450)로 폴백한다 (1430 의존 제거)', () => {
    expect(captureSrc).toMatch(/let\s+usdToKrw\s*=\s*1450/);
  });

  it('환율 조회는 best-effort — try/catch 로 감싸 결제(capture)를 막지 않는다', () => {
    // try { ... await import('./_exchange-rate.js') ... getUsdToKrwRaw() ... } catch (rateErr)
    // (indexOf 는 주석의 getUsdToKrwRaw 언급을 먼저 잡으므로, try{...}catch 블록 패턴으로 검증.)
    expect(captureSrc).toMatch(/try\s*\{[\s\S]{0,300}getUsdToKrwRaw[\s\S]{0,200}catch\s*\(/);
  });

  it('저장되는 capturedExchangeRate / amountKRW 가 동일한 usdToKrw 값을 쓴다', () => {
    expect(captureSrc).toMatch(/amountKRW\s*=\s*Math\.round\(\s*parseFloat\([^)]*\)\s*\*\s*usdToKrw\s*\)/);
    expect(captureSrc).toMatch(/capturedExchangeRate:\s*usdToKrw/);
  });
});
