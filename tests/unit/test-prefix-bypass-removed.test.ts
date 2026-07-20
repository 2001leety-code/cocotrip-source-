// ─────────────────────────────────────────────────────────────────────────────
// TEST- prefix 결제 우회 경로 폐지 회귀 테스트 (2026-07-20)
//
// 배경: TEST- 는 "결제 검증을 통째로 건너뛰는" 경로였다. ADMIN-BYPASS- 와 달리
//   admin 이메일 검사가 없어서, 게이트를 여는 env 만 잘못 설정되면 유효한 Firebase
//   토큰을 가진 아무 계정이나 유료 플랜을 무료로 받을 수 있었다.
//
//   그리고 그 게이트를 열던 BRAINTREE_ENV 는 Vercel 에 등록된 적이 없었다(2026-07-20
//   대시보드 확인). 즉 배포 환경에서는 이미 상시 403 이었고 아무도 몰랐다 —
//   이 경로를 밟는 테스트·CI·헬스체크가 0건이었기 때문이다.
//
//   프론트도 2026-05-07 (이슈 17) 부터 TEST- 를 보내지 않는다. 살아있는 사용자가 없고,
//   구멍만 남아 있었으므로 경로 자체를 제거했다.
//
// 이 테스트가 잠그는 것: **어떤 env 조합으로도 TEST- 가 다시 열리지 않는다.**
//   과거처럼 env var 하나로 되살아나는 회귀를 막는다.
//
// 대체 경로 = ADMIN-BYPASS- (admin 이메일 + Firebase ID token 이중 검증 + 감사 기록).
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi, afterEach } from 'vitest';
// @ts-expect-error — paymentGate.js 는 JS 모듈 (타입 선언 없음)
import { enforcePaymentAndRevision } from '../../api/_ai_core/paymentGate.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

/** TEST- orderId 로 게이트를 통과 시도. adminDb 는 이 분기에 도달하기 전 안 쓰인다. */
function attemptTestOrder(orderId = `TEST-${'x'.repeat(8)}`) {
  return enforcePaymentAndRevision(
    { paypalOrderId: orderId },
    null,                       // adminDb — test 분기는 Firestore 를 안 탄다
    'attacker@example.com',     // 인증된 email (무료 구글 계정이면 누구나 얻는다)
    'uid-attacker'
  );
}

describe('TEST- prefix — 폐지 확인', () => {
  it('⭐ TEST- orderId 는 403 으로 거부된다', async () => {
    const result = await attemptTestOrder();
    expect(result.rejection).toBeTruthy();
    expect(result.rejection.statusCode).toBe(403);
  });

  it('거부 사유가 ADMIN-BYPASS- 대체 경로를 안내한다 (운영자·개발자 디버깅용)', async () => {
    const result = await attemptTestOrder();
    expect(result.rejection.details).toContain('ADMIN-BYPASS-');
  });

  it('통과 신호(isRevision/isAdminBypass)를 절대 반환하지 않는다', async () => {
    const result = await attemptTestOrder();
    expect(result.isAdminBypass).toBeUndefined();
    expect(result.isRevision).toBeUndefined();
  });
});

describe('⭐ 어떤 env 조합으로도 되살아나지 않는다 (회귀 방지 핵심)', () => {
  // 과거 이 경로를 열던 env 이름들 + 리네임 후보로 검토됐던 이름들.
  // 이 중 하나라도 게이트를 다시 열면 테스트가 빨간불이 된다.
  const RESURRECTION_VECTORS = [
    'BRAINTREE_ENV',
    'PAYMENT_BYPASS_ENV',
    'PAYMENT_TEST_ENV',
    'NODE_ENV',
    'VERCEL_ENV',
  ];

  for (const varName of RESURRECTION_VECTORS) {
    for (const value of ['sandbox', 'development', 'dev', 'test']) {
      it(`${varName}=${value} 여도 TEST- 는 여전히 403`, async () => {
        vi.stubEnv(varName, value);
        const result = await attemptTestOrder();
        expect(result.rejection?.statusCode).toBe(403);
      });
    }
  }

  it('과거 게이트를 열던 조합(BRAINTREE_ENV=sandbox)이 정확히 재현돼도 닫혀 있다', async () => {
    vi.stubEnv('BRAINTREE_ENV', 'sandbox');
    vi.stubEnv('PAYMENT_BYPASS_ENV', 'sandbox');
    vi.stubEnv('VERCEL_ENV', 'preview');
    const result = await attemptTestOrder();
    expect(result.rejection?.statusCode).toBe(403);
  });
});

describe('prefix 변형으로 우회할 수 없다', () => {
  it('소문자 test- 는 TEST- 로 인식되지 않는다 → PayPal 경로로 가서 거부된다', async () => {
    // detectProvider 는 대소문자 구분. 'test-...' 는 'paypal' 로 분류되어
    // 실제 PayPal 검증을 타고, 유효하지 않은 order id 이므로 통과하지 못한다.
    const result = await attemptTestOrder('test-lowercase-1234');
    expect(result.isAdminBypass).toBeUndefined();
    expect(result.rejection || result.paymentReview).toBeTruthy();
  });

  it('TEST- 를 포함하지만 접두사가 아니면 우회로 취급되지 않는다', async () => {
    const result = await attemptTestOrder('PREFIXTEST-1234');
    expect(result.isAdminBypass).toBeUndefined();
  });
});
