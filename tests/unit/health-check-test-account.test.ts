// ─────────────────────────────────────────────────────────────────────────────
// 자동 검사 전용 계정 (2026-11-21) — 맞춤 권한 roles:['health-check'] 가 열어 주는 범위를 잠근다.
//
// 배경: GitHub 자동 검사가 운영자 관리자 계정의 이메일·비밀번호로 로그인했다. 그 비밀번호가 GitHub
//   secrets 에 있는 한 관리자 계정을 2단계 인증만으로 지킬 수 없다. 그래서 검사는 admin:true 가 아닌
//   테스트 계정으로 옮기고, 그 역할은 아래 좁은 곳에서만 인정한다:
//   - 읽기 관리자 API 2곳(admin-ai-ops-center·admin-quality-summary) — 응답에서 내용은 빼고
//   - paymentGate ADMIN-BYPASS — 자동 검사 접두사 주문번호만
//   - MOOD 조회 3곳 — 예약·주소록 내용은 비우고, 주소록 매칭은 건너뛰고
//   쓰기 관리자 API·결제 캡처·수동 결제 자동 확정·포인트·MOOD 예약은 이 역할을 모른다(예전처럼 막힘).
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const verifyIdTokenMock = vi.fn();
vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(),
  cert: vi.fn(),
  getApps: vi.fn(() => [{ name: '[DEFAULT]' }]),
}));
vi.mock('firebase-admin/auth', () => ({
  getAuth: vi.fn(() => ({ verifyIdToken: verifyIdTokenMock })),
}));

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const req = { headers: { authorization: 'Bearer t' } };
const HC = { uid: 'uid-hc', email: 'ci-check@example.test', email_verified: true, roles: ['health-check'] };

describe('verifyAdminToken — allowRoles 선택 참여', () => {
  beforeEach(() => {
    verifyIdTokenMock.mockReset();
    vi.stubEnv('ADMIN_EMAIL', 'admin@example.com');
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it('역할만 있고 allowRoles 를 안 준 끝점 → 403 (예전과 같음)', async () => {
    verifyIdTokenMock.mockResolvedValueOnce(HC);
    const { verifyAdminToken } = await import('../../api/_shared/admin-auth.js');
    const r = await verifyAdminToken(req);
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  it('allowRoles 에 그 역할이 있으면 통과 + scoped:true', async () => {
    verifyIdTokenMock.mockResolvedValueOnce(HC);
    const { verifyAdminToken } = await import('../../api/_shared/admin-auth.js');
    const r = await verifyAdminToken(req, { allowRoles: ['health-check'] });
    expect(r).toMatchObject({ ok: true, scoped: true, uid: 'uid-hc' });
  });

  it('이메일 미확인이면 역할이 있어도 403', async () => {
    verifyIdTokenMock.mockResolvedValueOnce({ ...HC, email_verified: false });
    const { verifyAdminToken } = await import('../../api/_shared/admin-auth.js');
    const r = await verifyAdminToken(req, { allowRoles: ['health-check'] });
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  it('진짜 관리자(ADMIN_EMAIL)는 allowRoles 를 줘도 scoped 아님 — 응답을 줄이지 않는다', async () => {
    verifyIdTokenMock.mockResolvedValueOnce({ uid: 'u-admin', email: 'admin@example.com', email_verified: true });
    const { verifyAdminToken } = await import('../../api/_shared/admin-auth.js');
    const r = await verifyAdminToken(req, { allowRoles: ['health-check'] });
    expect(r).toMatchObject({ ok: true });
    expect((r as { scoped?: boolean }).scoped).toBeUndefined();
  });
});

describe('verifyUserToken — healthCheck 표시', () => {
  beforeEach(() => { verifyIdTokenMock.mockReset(); vi.stubEnv('VERCEL_ENV', ''); });
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it('역할 + 이메일 확인 → true, 이메일 미확인 → false, 역할 없음 → false', async () => {
    const { verifyUserToken } = await import('../../api/_shared/user-auth.js');
    verifyIdTokenMock.mockResolvedValueOnce(HC);
    expect(await verifyUserToken(req)).toMatchObject({ ok: true, healthCheck: true });
    verifyIdTokenMock.mockResolvedValueOnce({ ...HC, email_verified: false });
    expect(await verifyUserToken(req)).toMatchObject({ ok: true, healthCheck: false });
    verifyIdTokenMock.mockResolvedValueOnce({ ...HC, roles: ['cs'] });
    expect(await verifyUserToken(req)).toMatchObject({ ok: true, healthCheck: false });
  });
});

describe('paymentGate — 자동 검사 역할은 자동 검사 접두사 주문만', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  async function attempt(orderId: string, healthCheck: boolean) {
    vi.stubEnv('ADMIN_BYPASS_EMAILS', 'admin@example.com');
    // @ts-expect-error — JS 모듈
    const { enforcePaymentAndRevision } = await import('../../api/_ai_core/paymentGate.js');
    return enforcePaymentAndRevision({ paypalOrderId: orderId }, null, HC.email, HC.uid, null, { healthCheck });
  }

  it.each(['ADMIN-BYPASS-REGRESSION-1', 'ADMIN-BYPASS-E2E-1', 'ADMIN-BYPASS-VALIDATE-seoul-1'])('%s + 역할 → 통과', async (id) => {
    const r = await attempt(id, true);
    expect(r.rejection).toBeUndefined();
    expect(r.isAdminBypass).toBe(true);
  });

  it('다른 ADMIN-BYPASS- 주문 + 역할 → 403', async () => {
    const r = await attempt('ADMIN-BYPASS-FREE-PLAN-1', true);
    expect(r.rejection).toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
  });

  it('자동 검사 접두사라도 역할이 없으면 403 (허용 목록 밖 일반 계정)', async () => {
    const r = await attempt('ADMIN-BYPASS-REGRESSION-1', false);
    expect(r.rejection).toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
  });
});

describe('소스 잠금 — 역할이 열리는 곳은 이름 붙인 곳뿐', () => {
  it('allowRoles 는 읽기 관리자 API 2곳에만', () => {
    for (const f of ['api/admin-ai-ops-center.js', 'api/admin-quality-summary.js']) {
      expect(read(f)).toMatch(/verifyAdminToken\(req, \{ allowRoles: \[HEALTH_CHECK_ROLE\] \}\)/);
    }
    for (const f of ['api/admin-booking-action.js', 'api/admin-issue-onboarding-coupons.js', 'api/admin-set-claims.js',
      'api/admin-bookings.js', 'api/admin-all-bookings.js', 'api/admin-update-booking.js', 'api/admin-sales.js']) {
      expect(read(f), f).not.toMatch(/allowRoles|HEALTH_CHECK_ROLE|health-check/);
    }
  });

  it('scoped 응답은 내용을 뺀다 (ops-center = 원본 상태만, quality = worstPlans 비움)', () => {
    const ops = read('api/admin-ai-ops-center.js');
    expect(ops).toMatch(/if \(auth\.scoped\) \{[\s\S]{0,200}data: \{ generatedAt: [^}]*sources, partialErrors: [^}]*\}/);
    expect(ops).toMatch(/const limit = auth\.scoped\s*\? 1/);
    expect(read('api/admin-quality-summary.js')).toMatch(/worstPlans: auth\.scoped \? \[\] : worstPlans/);
  });

  it('결제 캡처·수동 결제·포인트·MOOD 예약은 역할을 모른다', () => {
    for (const f of ['api/capturePaypalOrder.js', 'api/manual-payment-request.js', 'api/loyalty.js', 'api/mood-book.js']) {
      expect(read(f), f).not.toMatch(/healthCheck|HealthCheck|health-check/);
    }
  });

  it('admin-set-claims 로는 이 역할을 줄 수 없다 (VALID_ROLES 밖)', () => {
    const m = /const VALID_ROLES = new Set\(\[([^\]]*)\]\)/.exec(read('api/admin-set-claims.js'));
    expect(m).not.toBeNull();
    expect(m![1]).not.toMatch(/health-check/);
  });

  it('MOOD 조회 3곳만 역할을 보고, 내용은 비우고, 주소록 매칭은 건너뜀', () => {
    for (const f of ['api/mood-data.js', 'api/mood-places.js', 'api/mood-parse-schedule.js']) {
      expect(read(f), f).toMatch(/const healthCheckOnly = auth\.healthCheck === true && !isAllowedEmail\(allowlist, email\);/);
    }
    expect(read('api/mood-data.js')).toMatch(/bookings: healthCheckOnly \? bookings\.map\(\(\) => \(\{\}\)\) : bookings/);
    expect(read('api/mood-places.js')).toMatch(/places: redact \? places\.map\(\(\) => \(\{\}\)\) : places/);
    expect(read('api/mood-parse-schedule.js')).toMatch(/placebook = healthCheckOnly \? \[\] : await loadPlacebook\(db\)/);
  });
});

describe('자동 검사 스크립트·워크플로 — 운영자 계정으로 떨어지지 않는다', () => {
  it('CI 스크립트에 운영자 이메일 기본값이 없다', () => {
    for (const f of ['scripts/validate-planner.cjs', 'scripts/mood-smoke.mjs', 'tests/e2e/full-plan-translation-pdf.spec.ts',
      'scripts/validate-prod-regression.mjs', 'scripts/validate-prod-payment.mjs', 'scripts/validate-prod-voucher.mjs',
      'scripts/validate-prod-admin-auth.mjs', 'scripts/check-quality-score.mjs', 'scripts/api-health-check.mjs']) {
      expect(read(f), f).not.toMatch(/HEALTH_CHECK_EMAIL\s*\|\|\s*['"][^'"]+@/);
    }
  });

  it('daily-health.yml — 비밀번호를 넘기는 단계마다 이메일도 넘긴다', () => {
    const src = read('.github/workflows/daily-health.yml');
    const pw = src.match(/secrets\.HEALTH_CHECK_PASSWORD/g) || [];
    const em = src.match(/secrets\.HEALTH_CHECK_EMAIL/g) || [];
    expect(pw.length).toBeGreaterThan(0);
    expect(em.length).toBe(pw.length);
  });

  it('결제 슈트는 운영 Firestore 를 직접 지우지 않는다', () => {
    expect(read('scripts/validate-prod-payment.mjs')).not.toMatch(/firestore\.googleapis\.com/);
  });
});

describe('provision-health-check-account — 거부 규칙', () => {
  const pw = [{ providerId: 'password' }];
  it('운영자 계정·관리자·다른 역할·비밀번호 없음은 거부, 깨끗한 계정은 허용', async () => {
    const { checkProvisionTarget, operatorEmails } = await import('../../scripts/provision-health-check-account.mjs');
    const ops = operatorEmails({ ADMIN_EMAIL: 'Admin@Example.com' });
    expect(ops).toContain('admin@example.com');
    expect(checkProvisionTarget({ email: 'admin@example.com', providerData: pw }, ops).ok).toBe(false);
    expect(checkProvisionTarget({ email: 'ci@example.test', providerData: pw, customClaims: { admin: true } }, ops).ok).toBe(false);
    expect(checkProvisionTarget({ email: 'ci@example.test', providerData: pw, customClaims: { roles: ['cs'] } }, ops).ok).toBe(false);
    expect(checkProvisionTarget({ email: 'ci@example.test', providerData: [{ providerId: 'google.com' }] }, ops).ok).toBe(false);
    expect(checkProvisionTarget({ email: 'ci@example.test', providerData: pw }, ops)).toEqual({ ok: true });
    expect(checkProvisionTarget({ email: 'ci@example.test', providerData: pw, customClaims: { roles: ['health-check'] } }, ops)).toEqual({ ok: true });
  });

  it('비밀번호 떼기 — 구글 로그인이 없으면 거부(잠김 방지)', async () => {
    const { checkUnlinkTarget } = await import('../../scripts/provision-health-check-account.mjs');
    expect(checkUnlinkTarget({ providerData: [{ providerId: 'password' }] }).ok).toBe(false);
    expect(checkUnlinkTarget({ providerData: [{ providerId: 'google.com' }] })).toMatchObject({ ok: false, done: true });
    expect(checkUnlinkTarget({ providerData: [{ providerId: 'google.com' }, { providerId: 'password' }] })).toEqual({ ok: true });
  });
});
