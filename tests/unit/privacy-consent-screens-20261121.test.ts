/**
 * 2026-11-21 처리방침 동의 화면 — 순수 로직·서버 쪽 잠금.
 *
 *   1) 위자드 게이트: 식이 조건이 있는데 동의가 없으면 Food(2) 단계에서 멈춘다(식이 조건은 그대로).
 *   2) 동의 시각은 식이 조건이 있을 때만 요청에 실리고, 결제 지문(prepayFingerprint)은 바뀌지 않는다.
 *   3) planPersister 의 동의 시각 정리: ISO 문자열만 남기고 나머지는 null(기록만, 막지 않음).
 *   4) /api/age-confirm: 토큰 uid 로만 쓰고, 가입 문서가 없으면 409(가입 기본값보다 먼저 쓰지 않음), 멱등.
 *   5) 쿠키 안내: "계속 쓰면 동의로 간주" 문구가 4개 언어 모두에서 사라졌다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeWizardGate } from '../../src/components/WizardForm/wizardGate';
import { buildFullPlannerIntentPayload, buildPlannerOrderInput } from '../../src/pages/PlannerPage/lib/plannerIntent';
import type { PlannerFormValues } from '../../src/components/PlannerForm';
import { normalizePrepayInput, prepayFingerprint } from '../../api/_shared/prepay-coverage.js';
import { dietaryConsentAtOrNull } from '../../api/_ai_core/planPersister.js';
import ko from '../../src/i18n/locales/ko.json';
import en from '../../src/i18n/locales/en.json';
import ja from '../../src/i18n/locales/ja.json';
import zh from '../../src/i18n/locales/zh.json';

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  doc: { exists: true, data: {} as Record<string, unknown> },
  updates: [] as Array<{ id: string; data: Record<string, unknown> }>,
}));
vi.mock('../../api/_shared/user-auth.js', () => ({ verifyFirebaseIdentityToken: (...a: unknown[]) => h.auth(...a) }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: vi.fn() }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({
  initAdminDb: () => ({
    collection: () => ({ doc: (id: string) => ({ id }) }),
    runTransaction: async (fn: (tx: unknown) => unknown) => fn({
      get: async () => ({ exists: h.doc.exists, data: () => h.doc.data }),
      update: (ref: { id: string }, data: Record<string, unknown>) => { h.updates.push({ id: ref.id, data }); },
    }),
  }),
}));
import ageConfirm from '../../api/age-confirm.js';

const GATE = {
  reservationStatus: 'nothing' as const, arrivalAirport: 'ICN_T1', arrivalTime: '', mainCity: 'Seoul',
  selectedActivities: ['Food'], startDate: '2026-12-10', endDate: '2026-12-12', pax: 2, nowKstDate: '2026-11-21',
};

describe('wizard gate — dietary consent', () => {
  it('식이 동의가 빠지면 Food(2)에서 멈추고 canStep2=false', () => {
    const r = computeWizardGate({ ...GATE, dietaryConsentMissing: true });
    expect(r.canStep2).toBe(false);
    expect(r.unlockedStep).toBe(2);
  });
  it('동의했거나 식이 조건이 없으면 예전처럼 4까지 열린다', () => {
    expect(computeWizardGate({ ...GATE, dietaryConsentMissing: false }).unlockedStep).toBe(4);
    expect(computeWizardGate({ ...GATE }).unlockedStep).toBe(4);
  });
});

function values(overrides: Partial<PlannerFormValues> = {}): PlannerFormValues {
  return {
    categories: ['K-food'], regions: ['Seoul'], cityKey: 'seoul', cityKeys: ['seoul'],
    startDate: '2026-12-10', endDate: '2026-12-12', durationDays: 3, pax: 2,
    reservation_status: 'nothing', arrival_airport: 'ICN', departure_airport: 'ICN',
    dietaryRestrictions: ['Halal'], arrival_city: 'seoul', departure_city: 'seoul',
    ...overrides,
  } as PlannerFormValues;
}

describe('planner payload — dietaryConsentAt', () => {
  const at = '2026-11-21T03:04:05.000Z';
  it('식이 조건 + 동의 → 요청에 동의 시각, 식이 조건은 그대로', () => {
    const { flat } = buildFullPlannerIntentPayload(values({ dietaryConsentAt: at }), 'en');
    expect(flat.dietaryConsentAt).toBe(at);
    expect(flat.dietaryRestrictions).toEqual(['Halal']);
  });
  it('식이 조건이 없으면 동의 시각을 싣지 않는다', () => {
    const { flat } = buildFullPlannerIntentPayload(values({ dietaryRestrictions: [], dietaryConsentAt: at }), 'en');
    expect(flat.dietaryConsentAt).toBeUndefined();
  });
  it('결제 지문은 동의 시각과 무관', () => {
    const a = normalizePrepayInput(buildPlannerOrderInput(values({ dietaryConsentAt: at }), 'en'));
    const b = normalizePrepayInput(buildPlannerOrderInput(values(), 'en'));
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(prepayFingerprint(a.input)).toBe(prepayFingerprint(b.input));
  });
});

describe('planPersister — dietaryConsentAtOrNull', () => {
  it.each([
    ['2026-11-21T03:04:05.000Z', '2026-11-21T03:04:05.000Z'],
    [undefined, null], [null, null], ['', null], ['yesterday', null], [1732158245000, null],
    ['2026-13-45T99:99:99Z', null], ['2026-11-21T03:04:05.000Z'.padEnd(60, 'x'), null], [{ at: 'x' }, null],
  ])('%s → %s', (raw, want) => {
    expect(dietaryConsentAtOrNull(raw)).toBe(want);
  });
});

type Res = { status?: number; body?: Record<string, unknown>; writeHead: (s: number) => void; end: (b?: string) => void };
async function call(method = 'POST') {
  const res: Res = {
    writeHead(s) { this.status = s; },
    end(b) { this.body = b ? JSON.parse(b) : undefined; },
  };
  await ageConfirm({ method, headers: { authorization: 'Bearer t' }, body: { uid: 'someone-else' } } as never, res as never);
  return res;
}

describe('/api/age-confirm', () => {
  beforeEach(() => {
    h.auth.mockReset();
    h.auth.mockResolvedValue({ ok: true, uid: 'u1', email: null, emailVerified: false });
    h.doc.exists = true;
    h.doc.data = {};
    h.updates.length = 0;
  });

  it('POST 만 받는다', async () => {
    expect((await call('GET')).status).toBe(405);
  });
  it('토큰이 없으면 401, 쓰지 않는다', async () => {
    h.auth.mockResolvedValue({ ok: false, status: 401, error: 'Authorization Bearer token required' });
    expect((await call()).status).toBe(401);
    expect(h.updates).toHaveLength(0);
  });
  it('가입 문서가 아직 없으면 409 — 가입 기본값보다 먼저 만들지 않는다', async () => {
    h.doc.exists = false;
    const r = await call();
    expect(r.status).toBe(409);
    expect(h.updates).toHaveLength(0);
  });
  it('토큰 uid 의 문서에만 ageOver14Confirmed + ISO 시각을 쓴다(body uid 무시)', async () => {
    const r = await call();
    expect(r.status).toBe(200);
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0].id).toBe('u1');
    expect(h.updates[0].data.ageOver14Confirmed).toBe(true);
    expect(dietaryConsentAtOrNull(h.updates[0].data.ageOver14ConfirmedAt)).not.toBeNull();
  });
  it('이미 확인했으면 첫 시각을 그대로 둔다', async () => {
    h.doc.data = { ageOver14Confirmed: true, ageOver14ConfirmedAt: '2026-11-01T00:00:00.000Z' };
    const r = await call();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ alreadyConfirmed: true, confirmedAt: '2026-11-01T00:00:00.000Z' });
    expect(h.updates).toHaveLength(0);
  });
});

describe('cookie banner wording', () => {
  const banners = { ko: ko.cookieBanner, en: en.cookieBanner, ja: ja.cookieBanner, zh: zh.cookieBanner };
  it.each(Object.entries(banners))('%s — "계속 쓰면 동의로 간주" 문구 없음, 제6조 연결 문구 있음', (_lang, cb) => {
    const all = Object.values(cb).join(' ');
    expect(all).not.toMatch(/계속 사용하시면|동의한 것으로 간주|By continuing|引き続きご利用|みなされます|继续使用本站/);
    expect(cb.providersLink).toMatch(/6/);
    expect(cb.bodyShort).toMatch(/동의|Accept|同意/);
  });
});
