/**
 * MOOD 이중 확인 정산 — 실제 핸들러(api/mood-settle*.js)를 fakeFirestore 위에서 돌리는 공용 하네스.
 *
 * 왜 별도 하네스인가: 제안(proposal) 흐름은 `mood_bookings`/`mood_clients` 외에
 * `mood_settlement_proposals`·`mood_settlement_idempotency`·`mood_settlement_audit`·
 * `mood_config/allowlist` 를 함께 쓴다. 컬렉션 2개만 아는 임시 mock 으로는 "잔액이 안 변했다"
 * 를 증명할 수 없다(문서가 애초에 없으니 무엇이든 통과). 여기서는 진짜 문서 저장소를 쓰고
 * allowlist 도 mock 하지 않아 권한 fail-closed 가 실제 코드로 검증된다.
 *
 * ⚠️ vi.mock 은 테스트 파일 스코프라 여기서 호출할 수 없다. 각 테스트 파일이 아래
 * `settlementMocks` / `getSettlementDb` 를 가리키는 짧은 vi.mock 블록을 직접 둔다
 * (mock factory 는 lazy 하게 실행되므로 import 순서 문제는 없다).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- Vercel req/res 를 작게 모사한다. */
import { vi } from 'vitest';
import { makeFakeDb, type FakeDb } from './fakeFirestore';
import { PRIMARY_MOOD_ADMIN_EMAIL } from '../../../api/_shared/mood-allowlist.js';

export const ADMIN_EMAIL = PRIMARY_MOOD_ADMIN_EMAIL;
export const MOOD_APPROVER_EMAIL = 'finance@moodclient.com';
export const MOOD_STAFF_EMAIL = 'staff@moodclient.com';
export const OTHER_COMPANY_EMAIL = 'other@rival.com';
export const CLIENT_ID = 'COMPANY_A';
export const BOOKING_ID = 'booking-1';

export const settlementMocks = {
  verifyUserToken: vi.fn(),
  computeRoute: vi.fn(),
  notify: vi.fn(),
  sendEmail: vi.fn(),
  captureError: vi.fn(),
  buildReceipt: vi.fn(() => ({ subject: 'receipt', html: '<p>receipt</p>', text: 'receipt' })),
};

let db: FakeDb = makeFakeDb();
export function getSettlementDb(): FakeDb {
  return db;
}

/** 인증 주체 교체 — 같은 테스트 안에서 운영자 → MOOD 승인자로 바꿔 이중 확인을 재현한다. */
export function actAs(email: string) {
  settlementMocks.verifyUserToken.mockResolvedValue({
    ok: true, email, uid: `uid-${email}`, emailVerified: true,
  });
}

export function moodAllowlistDoc(overrides: Record<string, unknown> = {}) {
  return {
    emails: [ADMIN_EMAIL, MOOD_APPROVER_EMAIL, MOOD_STAFF_EMAIL],
    admins: [ADMIN_EMAIL],
    settlementApproverEmails: [MOOD_APPROVER_EMAIL],
    clientId: CLIENT_ID,
    ...overrides,
  };
}

/** 2026-08-20 확정 사례 — 예약가 537,740원(10h × 30,000 + 거리 228,540 + 예상 톨비 9,200). */
export function confirmedBooking(overrides: Record<string, unknown> = {}) {
  return {
    clientId: CLIENT_ID,
    clientName: 'MOOD',
    status: 'confirmed',
    revision: 1,
    amountKRW: 537740,
    ratePerHour: 30000,
    date: '2026-08-20',
    startTime: '09:00',
    durationHours: 10,
    serviceType: 'vehicle',
    breakdown: {
      baseKRW: 300000, distanceSurchargeKRW: 228540, tollKRW: 9200,
      km: 380.9, origin: '서울역', destination: '당진',
    },
    createdByEmail: 'ops@x.com',
    ...overrides,
  };
}

/** 확정 사례의 톨비 근거 — 미확정 5건 16,100원 포함, 카드충전 10,000원은 정산 제외. */
export function fixtureTollEntries() {
  return [
    { label: '서울 → 평택', date: '2026-08-20 11:23:47', amountKRW: 5100, status: 'pending', includedInSettlement: true },
    { label: '평택 → 송악', date: '2026-08-20 11:46:50', amountKRW: 2300, status: 'pending', includedInSettlement: true },
    { label: '당진 → 서산', date: '2026-08-20 12:27:13', amountKRW: 1700, status: 'pending', includedInSettlement: true },
    { label: '서산 → 당진', date: '2026-08-20 16:25:56', amountKRW: 1700, status: 'pending', includedInSettlement: true },
    { label: '송악 → 서울', date: '2026-08-20 18:32:09', amountKRW: 5300, status: 'pending', includedInSettlement: true },
    { label: '충전(제외내역)', date: '2026-08-20 15:27:25', amountKRW: 10000, status: 'confirmed', includedInSettlement: false },
  ];
}

/** 확정 사례의 정산 입력 — 총 438km 중 픽업 전 46km 제외 = 정산거리 392km. */
export function actualUsagePayload(overrides: Record<string, unknown> = {}) {
  return {
    bookingId: BOOKING_ID,
    actualHours: 10,
    actualTotalKm: 438,
    excludedKm: 46,
    tollMode: 'itemized',
    tollEntries: fixtureTollEntries(),
    acknowledgePendingTolls: true,
    settlementReason: '2026-08-20 실사용 — 픽업 전 46km 제외, 미확정 톨비 5건 잠정 반영',
    ...overrides,
  };
}

export type SettlementSeed = {
  booking?: Record<string, unknown> | null;
  client?: Record<string, unknown> | null;
  allowlist?: Record<string, unknown>;
  extra?: Record<string, Record<string, unknown>>;
};

export function resetSettlementWorld(seed: SettlementSeed = {}) {
  const initial: Record<string, Record<string, unknown>> = {
    'mood_config/allowlist': seed.allowlist || moodAllowlistDoc(),
  };
  const booking = seed.booking === undefined ? confirmedBooking() : seed.booking;
  if (booking) initial[`mood_bookings/${BOOKING_ID}`] = booking;
  const client = seed.client === undefined ? { name: 'MOOD', balanceKRW: 1000000 } : seed.client;
  if (client) initial[`mood_clients/${CLIENT_ID}`] = client;
  for (const [path, data] of Object.entries(seed.extra || {})) initial[path] = data;

  db = makeFakeDb(initial);
  settlementMocks.verifyUserToken.mockReset();
  settlementMocks.computeRoute.mockReset();
  settlementMocks.notify.mockReset().mockResolvedValue(undefined);
  settlementMocks.sendEmail.mockReset().mockResolvedValue(undefined);
  settlementMocks.captureError.mockReset().mockResolvedValue(undefined);
  settlementMocks.buildReceipt.mockClear();
  actAs(ADMIN_EMAIL);
  settlementMocks.computeRoute.mockResolvedValue({
    ok: true, km: 392, tollKRW: 9200, durationMin: 540,
    path: [[126.9, 37.5], [127.0, 36.9]], points: [],
  });
  return db;
}

function makeResponse() {
  const response = {
    statusCode: 0,
    body: '',
    writeHead(status: number) { response.statusCode = status; },
    end(body?: string) { response.body = body || ''; },
  };
  return response;
}

export type ApiCall = { status: number; json: any };

async function invoke(loader: () => Promise<any>, body: unknown, method = 'POST'): Promise<ApiCall> {
  const { default: handler } = await loader();
  const response = makeResponse();
  await handler(
    { method, headers: { authorization: 'Bearer token' }, body } as any,
    response as any,
  );
  return { status: response.statusCode, json: JSON.parse(response.body || '{}') };
}

export const callPreview = (body: unknown) => invoke(() => import('../../../api/mood-settle-preview.js'), body);
export const callSettle = (body: unknown) => invoke(() => import('../../../api/mood-settle.js'), body);
export const callCorrect = (body: unknown) => invoke(() => import('../../../api/mood-settle-correct.js'), body);
export const callRespond = (body: unknown, method = 'POST') => invoke(() => import('../../../api/mood-settle-respond.js'), body, method);

export function bookingDoc() {
  return getSettlementDb()._peek(`mood_bookings/${BOOKING_ID}`) as any;
}
export function clientDoc() {
  return getSettlementDb()._peek(`mood_clients/${CLIENT_ID}`) as any;
}
export function proposalDoc(proposalId: string) {
  return getSettlementDb()._peek(`mood_settlement_proposals/${proposalId}`) as any;
}
export function writesTo(collection: string) {
  return getSettlementDb()._writes.filter((w) => w.path.startsWith(`${collection}/`));
}

/**
 * 운영자 미리보기 → 제안 생성. 미리보기 지문이 확정 요청과 같은지도 함께 강제한다.
 * 잔액/최종금액은 이 단계에서 절대 바뀌지 않는다(테스트가 그것을 검증한다).
 */
export async function proposeInitial(overrides: Record<string, unknown> = {}) {
  const booking = bookingDoc();
  const payload = actualUsagePayload({
    expectedRevision: booking.revision,
    ...overrides,
  });
  actAs(ADMIN_EMAIL);
  const preview = await callPreview(payload);
  if (preview.status !== 200) return { preview, propose: null as ApiCall | null };
  const propose = await callSettle({
    ...payload,
    previewHash: preview.json.data.previewHash,
    idempotencyKey: (overrides.idempotencyKey as string) || 'idem-propose-1',
  });
  return { preview, propose };
}

export async function approveAs(
  email: string,
  proposalId: string,
  overrides: Record<string, unknown> = {},
) {
  actAs(email);
  return callRespond({
    proposalId,
    action: 'approve',
    idempotencyKey: 'idem-approve-1',
    acknowledgePendingTolls: true,
    ...overrides,
  });
}
