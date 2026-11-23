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
import { readFileSync, readdirSync } from 'node:fs';
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

/** admin_bypass_audit 흉내 — where(...).count().get() 와 add() 만. */
function fakeAuditDb(count: number, { failCount = false } = {}) {
  const added: Record<string, unknown>[] = [];
  const wheres: unknown[][] = [];
  const col = {
    where: (...args: unknown[]) => {
      wheres.push(args);
      return { count: () => ({ get: async () => { if (failCount) throw new Error('boom'); return { data: () => ({ count }) }; } }) };
    },
    add: async (doc: Record<string, unknown>) => { added.push(doc); return {}; },
  };
  return { db: { collection: () => col }, added, wheres };
}

describe('paymentGate — 자동 검사 역할은 자동 검사 접두사 주문만 + 하루 상한', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  async function attempt(orderId: string, healthCheck: boolean, db: unknown = fakeAuditDb(0).db, email = HC.email) {
    vi.stubEnv('ADMIN_BYPASS_EMAILS', 'admin@example.com');
    // @ts-expect-error — JS 모듈
    const { enforcePaymentAndRevision } = await import('../../api/_ai_core/paymentGate.js');
    return enforcePaymentAndRevision({ paypalOrderId: orderId }, db, email, HC.uid, null, { healthCheck });
  }

  it.each(['ADMIN-BYPASS-REGRESSION-1', 'ADMIN-BYPASS-E2E-1', 'ADMIN-BYPASS-VALIDATE-seoul-1'])('%s + 역할 → 통과 + 감사 문서(오늘 KST 칸)', async (id) => {
    const f = fakeAuditDb(0);
    const r = await attempt(id, true, f.db);
    expect(r.rejection).toBeUndefined();
    expect(r.isAdminBypass).toBe(true);
    expect(f.added).toHaveLength(1);
    expect(f.added[0]).toMatchObject({ via: 'health-check-role', route: 'ai-planner-full', orderId: id });
    expect(f.added[0].healthCheckDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(f.wheres[0]).toEqual(['healthCheckDay', '==', f.added[0].healthCheckDay]);
  });

  it('하루 상한에 닿으면 429 + 감사 문서 안 씀', async () => {
    const { HEALTH_CHECK_DAILY_LIMIT } = await import('../../api/_shared/health-check-quota.js');
    const f = fakeAuditDb(HEALTH_CHECK_DAILY_LIMIT);
    const r = await attempt('ADMIN-BYPASS-E2E-1', true, f.db);
    expect(r.rejection).toMatchObject({ statusCode: 429, code: 'HEALTH_CHECK_DAILY_LIMIT' });
    expect(f.added).toHaveLength(0);
  });

  it('셀 수 없으면(DB 없음·읽기 실패) 503 — 비용 막이는 닫힌 쪽', async () => {
    expect((await attempt('ADMIN-BYPASS-E2E-1', true, null)).rejection).toMatchObject({ statusCode: 503, code: 'HEALTH_CHECK_QUOTA_UNAVAILABLE' });
    expect((await attempt('ADMIN-BYPASS-E2E-1', true, fakeAuditDb(0, { failCount: true }).db)).rejection)
      .toMatchObject({ statusCode: 503, code: 'HEALTH_CHECK_QUOTA_UNAVAILABLE' });
  });

  it('운영자 이메일 경로는 상한을 안 센다 (예전 그대로)', async () => {
    const f = fakeAuditDb(9999);
    const r = await attempt('ADMIN-BYPASS-FREE-PLAN-1', false, f.db, 'admin@example.com');
    expect(r.rejection).toBeUndefined();
    expect(f.wheres).toHaveLength(0);
  });

  it('다른 ADMIN-BYPASS- 주문 + 역할 → 403', async () => {
    const r = await attempt('ADMIN-BYPASS-FREE-PLAN-1', true);
    expect(r.rejection).toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
  });

  it('자동 검사 접두사라도 역할이 없으면 403 (허용 목록 밖 일반 계정)', async () => {
    const r = await attempt('ADMIN-BYPASS-REGRESSION-1', false);
    expect(r.rejection).toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
  });

  it('역할 계정의 재생성(revisionOf) → 403, 플랜 문서·횟수를 건드리지 않는다 (상한·mock 을 안 지나는 길)', async () => {
    const collection = vi.fn(() => { throw new Error('db must not be touched'); });
    // @ts-expect-error — JS 모듈
    const { enforcePaymentAndRevision } = await import('../../api/_ai_core/paymentGate.js');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const r = await enforcePaymentAndRevision({ revisionOf: 'plan-1', paypalOrderId: 'ADMIN-BYPASS-E2E-1' }, { collection }, HC.email, HC.uid, null, { healthCheck: true });
      expect(r.rejection).toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
      expect(collection).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('역할 없는 계정의 재생성은 예전 그대로 플랜 문서를 본다', async () => {
    const get = vi.fn(async () => ({ exists: false }));
    // @ts-expect-error — JS 모듈
    const { enforcePaymentAndRevision } = await import('../../api/_ai_core/paymentGate.js');
    const r = await enforcePaymentAndRevision({ revisionOf: 'plan-1' }, { collection: () => ({ doc: () => ({ get }) }) }, 'u@example.test', 'uid-u', null, { healthCheck: false });
    expect(r.rejection).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    expect(get).toHaveBeenCalledTimes(1);
  });

  // 독립 검토 3회차 꼭 고칠 것: 역할 계정이 만든 주인 없는 플랜은 접근 토큰이 응답으로 돌아온다.
  // 역할 없는 다른 계정이 그 토큰으로 재생성하면 하루 상한·mock 을 안 지난다 → 관리자 우회 플랜은 관리자만.
  function revisionDb(orig: Record<string, unknown>) {
    const update = vi.fn();
    const runTransaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn({ get: async () => ({ data: () => orig }), update }));
    const get = vi.fn(async () => ({ exists: true, data: () => orig }));
    return { db: { collection: () => ({ doc: () => ({ get }) }), runTransaction }, runTransaction };
  }
  const guestPlan = { uid: null, accessToken: 'tok-1', revisionCredits: 2 };

  it.each([
    ['isAdminBypass:true', { ...guestPlan, isAdminBypass: true }],
    ['paymentSource admin-bypass (표시 칸 없음)', { ...guestPlan, paymentSource: 'admin-bypass' }],
    ['paymentSource test', { ...guestPlan, paymentSource: 'test' }],
  ])('관리자 우회 플랜(%s) + 맞는 토큰 + 역할 없는 다른 계정 → 403, 횟수 안 줄임', async (_label, orig) => {
    vi.stubEnv('ADMIN_BYPASS_EMAILS', 'admin@example.com');
    const f = revisionDb(orig);
    // @ts-expect-error — JS 모듈
    const { enforcePaymentAndRevision } = await import('../../api/_ai_core/paymentGate.js');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const r = await enforcePaymentAndRevision({ revisionOf: 'plan-1', revisionToken: 'tok-1' }, f.db, 'someone@example.test', 'uid-other', null, { healthCheck: false });
      expect(r.rejection).toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
      expect(f.runTransaction).not.toHaveBeenCalled();
      expect(JSON.stringify(warn.mock.calls)).not.toContain('someone@example.test');
    } finally {
      warn.mockRestore();
    }
  });

  it('관리자 우회 플랜이라도 관리자 허용 이메일은 예전처럼 재생성한다', async () => {
    vi.stubEnv('ADMIN_BYPASS_EMAILS', 'admin@example.com');
    const f = revisionDb({ ...guestPlan, isAdminBypass: true });
    // @ts-expect-error — JS 모듈
    const { enforcePaymentAndRevision } = await import('../../api/_ai_core/paymentGate.js');
    const r = await enforcePaymentAndRevision({ revisionOf: 'plan-1', revisionToken: 'tok-1' }, f.db, 'Admin@Example.com', 'uid-admin', null, { healthCheck: false });
    expect(r.rejection).toBeUndefined();
    expect(r.isRevision).toBe(true);
    expect(f.runTransaction).toHaveBeenCalledTimes(1);
  });

  it('손님 플랜(PayPal) + 맞는 토큰은 예전처럼 재생성한다', async () => {
    vi.stubEnv('ADMIN_BYPASS_EMAILS', 'admin@example.com');
    const f = revisionDb({ ...guestPlan, isAdminBypass: false, paymentSource: 'paypal' });
    // @ts-expect-error — JS 모듈
    const { enforcePaymentAndRevision } = await import('../../api/_ai_core/paymentGate.js');
    const r = await enforcePaymentAndRevision({ revisionOf: 'plan-1', revisionToken: 'tok-1' }, f.db, 'guest@example.test', 'uid-g', null, { healthCheck: false });
    expect(r.rejection).toBeUndefined();
    expect(r.isRevision).toBe(true);
    expect(f.runTransaction).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['표시 칸 없는 옛 완성 문서(input.paypalOrderId)', { ...guestPlan, input: { paypalOrderId: 'ADMIN-BYPASS-OLD-1' } }, 'someone@example.test'],
    ['이메일 없는 호출자', { ...guestPlan, isAdminBypass: true }, null],
  ])('관리자 우회 플랜 — %s → 403, 횟수 안 줄임', async (_label, orig, email) => {
    vi.stubEnv('ADMIN_BYPASS_EMAILS', 'admin@example.com');
    const f = revisionDb(orig);
    // @ts-expect-error — JS 모듈
    const { enforcePaymentAndRevision } = await import('../../api/_ai_core/paymentGate.js');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const r = await enforcePaymentAndRevision({ revisionOf: 'plan-1', revisionToken: 'tok-1' }, f.db, email, 'uid-other', null, { healthCheck: false });
      expect(r.rejection).toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
      expect(f.runTransaction).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  // 독립 검토 4회차 꼭 고칠 것: revisionOf 에 '/' 가 들어가면 .doc() 가 주인이 쓸 수 있는 하위 문서
  // (plans/{id}/translations/{x})를 원본으로 읽는다 → DB 를 건드리기 전에 400.
  it.each([
    ['하위 문서 경로', 'p1/translations/x'],
    ['문자열 아님', { id: 'p1' }],
  ])('revisionOf 가 문서 ID 하나가 아니면(%s) 400, DB 안 건드림', async (_label, revisionOf) => {
    const collection = vi.fn();
    // @ts-expect-error — JS 모듈
    const { enforcePaymentAndRevision } = await import('../../api/_ai_core/paymentGate.js');
    const r = await enforcePaymentAndRevision({ revisionOf, revisionToken: 'tok-1' }, { collection }, 'u@example.test', 'uid-u', null, { healthCheck: false });
    expect(r.rejection).toMatchObject({ statusCode: 400, code: 'INVALID_REVISION_TARGET' });
    expect(collection).not.toHaveBeenCalled();
  });

  it('재생성 횟수(revisionCredits:2)를 먼저 쓰는 Inngest 만드는 중 문서도 완성 문서와 같은 식으로 관리자 우회 표시를 쓴다', () => {
    const src = read('api/_inngest/functions/processPlanAfterAI.js');
    const skeleton = src.slice(src.indexOf("step.run('skeleton-write'"), src.indexOf('revisionCredits: 2'));
    expect(skeleton).toContain('isAdminBypass: isAdminBypassOrderId(ctx.body?.paypalOrderId)');
    // 완성 문서(planPersister)도 같은 식 — 다르면 plan-persistence-guard 가 'skeleton provenance mismatch' 로 저장을 막는다.
    expect(read('api/_ai_core/planPersister.js')).toContain('isAdminBypass: isAdminBypassOrderId(body.paypalOrderId)');
  });

  it('거절 응답·서버 기록에 허용 이메일 목록과 요청 이메일이 없다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const r = await attempt('ADMIN-BYPASS-FREE-PLAN-1', false);
      const text = JSON.stringify(r.rejection) + JSON.stringify(warn.mock.calls);
      expect(text).not.toContain('admin@example.com');
      expect(text).not.toContain(HC.email);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('health-check-quota — 하루 = KST 날짜', () => {
  it('KST 자정 경계', async () => {
    const { healthCheckDayKST } = await import('../../api/_shared/health-check-quota.js');
    expect(healthCheckDayKST(new Date('2026-11-21T14:59:59.999Z'))).toBe('2026-11-21');
    expect(healthCheckDayKST(new Date('2026-11-21T15:00:00.000Z'))).toBe('2026-11-22');
  });

  it('상한 = 실측 하루 최대 80회의 2배', async () => {
    const { HEALTH_CHECK_DAILY_LIMIT } = await import('../../api/_shared/health-check-quota.js');
    expect(HEALTH_CHECK_DAILY_LIMIT).toBe(160);
  });
});

describe('소스 잠금 — 역할이 열리는 곳은 이름 붙인 곳뿐', () => {
  it('api/ 전체에서 역할을 보는 파일 = 정해진 10개 (새 파일이 역할을 보기 시작하면 실패)', () => {
    const walk = (dir: string): string[] => readdirSync(resolve(process.cwd(), dir), { withFileTypes: true })
      .flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.(c|m)?js$/.test(e.name) ? [`${dir}/${e.name}`] : []));
    const hits = walk('api').filter((f) => /allowRoles|healthCheck|HEALTH_CHECK_ROLE|health-check/.test(read(f))).sort();
    expect(hits).toEqual([
      'api/_ai_core/handlerCore.js', 'api/_ai_core/paymentGate.js', 'api/_shared/admin-auth.js', 'api/_shared/health-check-quota.js', 'api/_shared/user-auth.js',
      'api/admin-ai-ops-center.js', 'api/admin-quality-summary.js', 'api/mood-data.js', 'api/mood-parse-schedule.js', 'api/mood-places.js',
    ]);
  });

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
    // 결정 3: MOOD 파싱도 플래너와 같은 하루 상한 (AI 호출 전에)
    const parse = read('api/mood-parse-schedule.js');
    const quotaAt = parse.indexOf("claimHealthCheckQuota(db, { route: 'mood-parse-schedule', email })");
    expect(quotaAt).toBeGreaterThan(0);
    expect(quotaAt).toBeLessThan(parse.indexOf('extractStops(rawText, apiKey)'));
    // 결정 4: 거래처 이름·잔액 빈 값
    expect(read('api/mood-data.js')).toMatch(/client: healthCheckOnly\s*\? \{ name: '', balanceKRW: null \}/);
  });
});

describe('자동 검사 스크립트·워크플로 — 운영자 계정으로 떨어지지 않는다', () => {
  it('scripts/·tests/e2e 어디에도 HEALTH_CHECK_EMAIL 이메일 기본값이 없다 (손으로 쓰는 도구 포함)', () => {
    const walk = (dir: string): string[] => readdirSync(resolve(process.cwd(), dir), { withFileTypes: true })
      .flatMap((e) => (e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(`${dir}/${e.name}`))
        : /\.(c|m)?[jt]s$/.test(e.name) ? [`${dir}/${e.name}`] : []));
    const files = [...walk('scripts'), ...walk('tests/e2e')];
    expect(files.length).toBeGreaterThan(50);
    const hits = files.filter((f) => /HEALTH_CHECK_EMAIL\s*\|\|\s*['"][^'"]+@/.test(read(f)));
    expect(hits).toEqual([]);
  });

  it('손 도구 7개는 이메일이 없으면 멈춘다', () => {
    expect(read('scripts/_lib/planner-smoke.mjs')).toMatch(/export function requireHealthCheckEmail\(\)[\s\S]{0,200}if \(!email\) throw new Error/);
    for (const f of ['scripts/create-temp-plan.js', 'scripts/test-production-plan.mjs']) {
      expect(read(f), f).toMatch(/email: requireHealthCheckEmail\(\),/);
    }
    for (const [f, v] of [['scripts/fetch-recent-alerts.cjs', 'TEST_EMAIL'], ['scripts/inspect-operator-recent-plans.mjs', 'email'],
      ['scripts/inspect-plans.mjs', 'email'], ['scripts/measure-flash-stability-5sample.mjs', 'HEALTH_EMAIL']]) {
      expect(read(f), f).toContain(`if (!${v}) { console.error(`);
    }
  });

  it('MOOD 스모크는 잔액·건수 숫자와 응답 본문을 CI 기록에 안 남긴다', () => {
    const src = read('scripts/mood-smoke.mjs');
    expect(src).not.toMatch(/balance=\$\{|bookings=\$\{|places=\$\{|JSON\.stringify\(body\)/);
    expect(src).toContain("잔액=${balanceRead ? '읽힘' : '안 읽힘(빈 값)'}");
    // 빈 값/숫자를 계정 종류와 묶는다 (역할 계정에 숫자가 와도, 허용 목록 계정에 null 이 와도 실패)
    expect(src).toContain("const moneyOk = isHealthCheckRole ? d?.client?.balanceKRW === null : balanceRead;");
    expect(src).toMatch(/const ok = status === 200 && d\?\.client && moneyOk && /);
  });

  it('바우처 슈트는 기본으로 로그인 토큰을 보내고, 주소에 이메일을 싣지 않는다', () => {
    const src = read('scripts/validate-prod-voucher.mjs');
    expect(src).toMatch(/async function fetchVoucher\(\{ extraQuery = '', withAuth = true,/);
    expect(src).toMatch(/pass: noAuthStatus === 401 && notFoundStatus === 404/);
    expect(src).toContain('const params = new URLSearchParams({ bookingID });');
    expect(src).not.toMatch(/userEmail:\s*VOUCHER_BOOKING_EMAIL/);
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

  it('비밀번호 떼기 — 운영자 계정만, 구글 로그인이 없으면 거부(잠김 방지)', async () => {
    const { checkUnlinkTarget } = await import('../../scripts/provision-health-check-account.mjs');
    const ops = ['admin@example.com'];
    const both = [{ providerId: 'google.com' }, { providerId: 'password' }];
    expect(checkUnlinkTarget({ email: 'guest@example.test', providerData: both }, ops).ok).toBe(false);
    expect(checkUnlinkTarget({ email: 'admin@example.com', providerData: [{ providerId: 'password' }] }, ops).ok).toBe(false);
    expect(checkUnlinkTarget({ email: 'admin@example.com', providerData: [{ providerId: 'google.com' }] }, ops)).toMatchObject({ ok: false, done: true });
    expect(checkUnlinkTarget({ email: 'Admin@Example.com', providerData: both }, ops)).toEqual({ ok: true });
  });

  it('비밀번호를 뗀 뒤 기존 로그인도 끊는다 (revokeRefreshTokens)', () => {
    expect(read('scripts/provision-health-check-account.mjs'))
      .toMatch(/providersToUnlink: \['password'\][\s\S]{0,400}revokeRefreshTokens\(user\.uid\)/);
  });

  it('비밀번호가 이미 없어도(--apply) 끊기는 다시 돈다 — "할 일 없음"으로 끝나지 않는다', () => {
    const src = read('scripts/provision-health-check-account.mjs');
    expect(src).not.toContain('process.exit(check.done ? 0 : 1)');
    expect(src).toContain('if (!check.ok && !check.done) {');
    // 떼기만 done 이 아닐 때로 감싸고, 끊기는 그 밖(항상)에서
    expect(src).toMatch(/if \(!check\.done\) \{\s*await auth\.updateUser[\s\S]*?\n {4}\}\n[\s\S]{0,200}await auth\.revokeRefreshTokens\(user\.uid\);/);
  });
});

describe('mood-smoke — 옛 운영자 계정이면 예전처럼 clientId=mood, 역할 계정이면 서버 고정값', () => {
  it('역할이 있을 때만 기본 clientId 를 안 보낸다', () => {
    expect(read('scripts/mood-smoke.mjs'))
      .toMatch(/const isHealthCheckRole = tokenRoles\(idToken\)\.includes\('health-check'\);\s*const clientId = CLIENT_ID \|\| \(isHealthCheckRole \? '' : 'mood'\);/);
  });
});
