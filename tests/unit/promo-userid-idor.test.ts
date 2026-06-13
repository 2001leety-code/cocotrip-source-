/**
 * applyPromoCode — userId IDOR fix 회귀 (2026-06-13 버그헌트).
 * 결함: body.userId 로 users/{uid}/coupons 조회 → 타인 uid 전달 시 그 사람의 개인 쿠폰
 *   할인(%·라벨) read-only 노출(정보 유출).
 * fix: 신원을 verifyUserToken 의 auth.uid 로 바인딩. 토큰 없으면 개인 쿠폰 skip(글로벌만).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(process.cwd(), 'api/applyPromoCode.js'), 'utf8');
const frontSrc = readFileSync(resolve(process.cwd(), 'src/components/PayPalBookingButton.tsx'), 'utf8');

describe('applyPromoCode — userId IDOR fix (소스 가드)', () => {
  it('body 에서 userId 를 destructure 하지 않음(신뢰 종료)', () => {
    expect(src).not.toMatch(/const\s*\{[^}]*\buserId\b[^}]*\}\s*=\s*body/);
  });
  it('verifyUserToken 으로 auth.uid 해소', () => {
    expect(src).toMatch(/import \{[^}]*verifyUserToken[^}]*\} from '\.\/_shared\/user-auth\.js'/);
    expect(src).toMatch(/verifyUserToken\(req\)/);
    expect(src).toMatch(/userId\s*=\s*_promoAuth\.uid/);
  });
  it('프론트 PayPalBookingButton 가 authFetch 로 호출 + body.userId 제거', () => {
    expect(frontSrc).toMatch(/authFetch\(\s*['"]\/api\/applyPromoCode['"]/);
    const idx = frontSrc.indexOf("authFetch('/api/applyPromoCode'");
    expect(idx).toBeGreaterThan(-1);
    const block = frontSrc.slice(idx, idx + 400);
    expect(block).not.toMatch(/userId:/);
  });
});
