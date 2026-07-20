// ─────────────────────────────────────────────────────────────────────────────
// PAYMENT_BYPASS_ENV — TEST- prefix 결제 우회 게이트 회귀 테스트 (2026-07-20)
//
// 배경: 이 게이트는 "결제 검증을 통째로 건너뛸 것인가" 의 유일한 방어선인데,
//   2026-07-20 감사 시점까지 이 분기를 밟는 테스트·CI·헬스체크가 **0건**이었다.
//   P174 가 scripts/validate-planner.cjs 를 TEST- 에서 ADMIN-BYPASS- 로 옮기면서
//   자동화가 이 경로를 아예 안 지나가게 됐다. 즉 게이트가 깨져도 daily-health 는
//   초록이고 lint 도 통과한다 — 사람이 Test Mode 버튼을 눌러봐야만 드러난다.
//
//   docs/AUTOMATION.md 의 12일 silent fail 사고는 그나마 validate-planner 5/5 실패로
//   스스로 드러났다. 지금 이 경로는 그 시계조차 없다. 그래서 박제한다.
//
// 정책 (audit P1-A, 2026-05-05 fail-closed 전환):
//   PAYMENT_BYPASS_ENV ∈ {sandbox, development, dev} → 허용
//   그 외 전부(미설정·빈문자열·production·오타·대문자 아닌 변형) → reject
//
// 구 이름 BRAINTREE_ENV 는 **폴백하지 않는다** — 결제 우회를 열 수 있는 키가 2개가
// 되면 config 실수 표면이 2배가 된다. 대신 반쪽 마이그레이션을 감지해 시끄럽게 만든다.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi, afterEach } from 'vitest';
// @ts-expect-error — paymentGate.js 는 JS 모듈 (타입 선언 없음)
import { resolveTestBypassEnv } from '../../api/_ai_core/paymentGate.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('PAYMENT_BYPASS_ENV — 허용 케이스', () => {
  for (const value of ['sandbox', 'development', 'dev']) {
    it(`PAYMENT_BYPASS_ENV=${value} → allowed`, () => {
      vi.stubEnv('PAYMENT_BYPASS_ENV', value);
      vi.stubEnv('BRAINTREE_ENV', '');
      expect(resolveTestBypassEnv().allowed).toBe(true);
    });
  }

  it('대소문자·공백은 정규화된다 (  SandBox  → allowed)', () => {
    vi.stubEnv('PAYMENT_BYPASS_ENV', '  SandBox  ');
    vi.stubEnv('BRAINTREE_ENV', '');
    expect(resolveTestBypassEnv().allowed).toBe(true);
  });
});

describe('PAYMENT_BYPASS_ENV — fail-closed (audit P1-A 회귀 방지)', () => {
  it('⭐ 미설정 → reject (가장 중요: 기본값이 우회가 되면 안 된다)', () => {
    vi.stubEnv('PAYMENT_BYPASS_ENV', '');
    vi.stubEnv('BRAINTREE_ENV', '');
    expect(resolveTestBypassEnv().allowed).toBe(false);
  });

  it('⭐ production → reject', () => {
    vi.stubEnv('PAYMENT_BYPASS_ENV', 'production');
    vi.stubEnv('BRAINTREE_ENV', '');
    expect(resolveTestBypassEnv().allowed).toBe(false);
  });

  it('오타 (sandbx) → reject — allowlist 는 positive match 여야 한다', () => {
    vi.stubEnv('PAYMENT_BYPASS_ENV', 'sandbx');
    vi.stubEnv('BRAINTREE_ENV', '');
    expect(resolveTestBypassEnv().allowed).toBe(false);
  });

  it('truthy 유사값 (true / 1 / yes) → 전부 reject', () => {
    for (const bad of ['true', '1', 'yes', 'on']) {
      vi.stubEnv('PAYMENT_BYPASS_ENV', bad);
      vi.stubEnv('BRAINTREE_ENV', '');
      expect(resolveTestBypassEnv().allowed, `value=${bad}`).toBe(false);
    }
  });
});

describe('구 BRAINTREE_ENV 폴백 부재 — 결제 우회 키는 하나뿐이어야 한다', () => {
  it('⭐ BRAINTREE_ENV=sandbox 만 있고 새 이름 미설정 → reject (구 변수로는 게이트가 안 열린다)', () => {
    vi.stubEnv('PAYMENT_BYPASS_ENV', '');
    vi.stubEnv('BRAINTREE_ENV', 'sandbox');
    const gate = resolveTestBypassEnv();
    expect(gate.allowed).toBe(false);
  });

  it('위 상황은 staleLegacy=true 로 감지된다 (게이트는 닫히되 침묵하지 않는다)', () => {
    vi.stubEnv('PAYMENT_BYPASS_ENV', '');
    vi.stubEnv('BRAINTREE_ENV', 'sandbox');
    expect(resolveTestBypassEnv().staleLegacy).toBe(true);
  });

  it('둘 다 미설정 → staleLegacy=false (경고할 게 없다)', () => {
    vi.stubEnv('PAYMENT_BYPASS_ENV', '');
    vi.stubEnv('BRAINTREE_ENV', '');
    expect(resolveTestBypassEnv().staleLegacy).toBe(false);
  });

  it('새 이름이 설정돼 있으면 구 변수가 뭐든 staleLegacy=false (마이그레이션 완료)', () => {
    vi.stubEnv('PAYMENT_BYPASS_ENV', 'sandbox');
    vi.stubEnv('BRAINTREE_ENV', 'sandbox');
    expect(resolveTestBypassEnv().staleLegacy).toBe(false);
  });

  it('구 변수가 허용값이 아니면 staleLegacy=false (마이그레이션 대상이 아니다)', () => {
    vi.stubEnv('PAYMENT_BYPASS_ENV', '');
    vi.stubEnv('BRAINTREE_ENV', 'production');
    expect(resolveTestBypassEnv().staleLegacy).toBe(false);
  });

  it('⭐ 새 이름 빈 문자열 + 구 변수 sandbox → reject. 빈 값이 폴백으로 덮이지 않는다', () => {
    // 운영자가 "테스트 모드 끄자"고 새 변수를 빈 값으로 두는 시나리오.
    // 폴백이 있었다면 구 변수가 게이트를 계속 열어뒀을 것 = fail-open.
    vi.stubEnv('PAYMENT_BYPASS_ENV', '');
    vi.stubEnv('BRAINTREE_ENV', 'sandbox');
    expect(resolveTestBypassEnv().allowed).toBe(false);
  });
});

describe('진단 정보 — 운영자가 403 본문에서 원인을 읽을 수 있어야 한다', () => {
  it('읽은 값을 그대로 돌려준다 (어느 변수의 어떤 값인지 식별 가능)', () => {
    vi.stubEnv('PAYMENT_BYPASS_ENV', 'production');
    vi.stubEnv('BRAINTREE_ENV', '');
    const gate = resolveTestBypassEnv();
    expect(gate.value).toBe('production');
    expect(gate.legacyValue).toBe('');
  });
});
