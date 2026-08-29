/* eslint-disable @typescript-eslint/no-explicit-any -- Firestore·HTTP 응답을 작게 모사한다. */
/**
 * MOOD 경로 스냅샷 — Firestore 중첩 배열 회귀 잠금 (2026-08-13 prod 장애).
 *
 * 장애: POST /api/mood-book 이 11:13~11:15 KST 에 500 ×4.
 *   `3 INVALID_ARGUMENT: Property routeSnapshot contains an invalid nested entity.`
 *   routeSnapshot.path 가 `[[lng,lat], ...]` — Firestore 는 배열 안 배열을 못 넣는다.
 *   트랜잭션이 통째로 깨져 예약도 잔액 차감도 없었다. mood-change / mood-settle 도 동일 결함.
 *
 * 이 파일이 잠그는 것:
 *   1) 코덱 자체 (저장형 [{lng,lat}] ↔ 공개형 [[lng,lat]]), 600점 압축, 손상값 거부
 *   2) **실제 @google-cloud/firestore 직렬화** 결과에 arrayValue 안 arrayValue 가 없음
 *      (구 모양은 있음 = 그때 서버가 거부한 바로 그 프로토)
 *   3) book / change / settle 세 쓰기 경로가 서버와 같은 규칙을 강제하는 대역에 통과
 *   4) mood-data 가 저장형을 공개형 [lng,lat][] 로 되돌림
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ROUTE_PATH_LIMIT,
  buildRouteSnapshot,
  decodeRoutePath,
  decodeRouteSnapshot,
  encodeRoutePath,
  encodeRoutePoints,
} from '../../api/_shared/mood-route-snapshot.js';
import { assertFirestoreSafe, createFakeFirestore, makeBarrier } from '../helpers/fake-firestore.js';
import { openMoodBookingAvailabilityFixture } from '../helpers/mood-booking-availability';

// ── 실제 Naver traoptimal 이 주는 모양의 폴리라인 (서울역 → 인천공항 방면 일부) ──
const REAL_PATH: Array<[number, number]> = [
  [126.97230, 37.55519],
  [126.96874, 37.55401],
  [126.96122, 37.55188],
  [126.95003, 37.54812],
  [126.93417, 37.54290],
  [126.90188, 37.55011],
  [126.86644, 37.55932],
  [126.79310, 37.56120],
  [126.63801, 37.44930],
  [126.45067, 37.44880],
];

const REAL_POINTS = [
  { lat: 37.55519, lng: 126.97230, role: 'origin' },
  { lat: 37.44880, lng: 126.45067, role: 'destination' },
];

const realRoute = (overrides: Record<string, any> = {}) => ({
  ok: true,
  km: 80,
  tollKRW: 5000,
  durationMin: 95,
  path: REAL_PATH.map((pair) => [...pair]),
  points: REAL_POINTS.map((point) => ({ ...point })),
  ...overrides,
});

/** 구(장애) 구현 — 원본 pair 배열을 그대로 저장하던 코드. */
function legacyCompactPath(path: any[], limit = 600) {
  if (!Array.isArray(path) || path.length <= limit) return Array.isArray(path) ? path : [];
  const step = (path.length - 1) / (limit - 1);
  return Array.from({ length: limit }, (_, index) => path[Math.round(index * step)]);
}

// ─────────────────────────────────────────────────────────────
// 1) 코덱
// ─────────────────────────────────────────────────────────────
describe('mood-route-snapshot 코덱', () => {
  it('저장형은 중첩 배열이 아니라 평범한 {lng,lat} map 배열이다', () => {
    const encoded = encodeRoutePath(REAL_PATH);
    expect(encoded).toHaveLength(REAL_PATH.length);
    expect(encoded[0]).toEqual({ lng: 126.97230, lat: 37.55519 });
    expect(encoded.every((point: any) => !Array.isArray(point))).toBe(true);
  });

  it('공개형으로 왕복해도 좌표가 그대로다 ([lng,lat][] 계약)', () => {
    expect(decodeRoutePath(encodeRoutePath(REAL_PATH))).toEqual(REAL_PATH);
  });

  it('600점 압축 의도 유지 — 그 이상은 균등 샘플링, 양 끝은 보존', () => {
    const long: Array<[number, number]> = Array.from({ length: 4321 }, (_, i) => [
      126.5 + i * 0.0001,
      37.4 + i * 0.0001,
    ]);
    const encoded = encodeRoutePath(long);
    expect(encoded).toHaveLength(ROUTE_PATH_LIMIT);
    expect(encoded[0]).toEqual({ lng: long[0][0], lat: long[0][1] });
    expect(encoded[ROUTE_PATH_LIMIT - 1]).toEqual({ lng: long[4320][0], lat: long[4320][1] });
    // 600 이하는 손실 없이 전부 저장.
    expect(encodeRoutePath(long.slice(0, ROUTE_PATH_LIMIT))).toHaveLength(ROUTE_PATH_LIMIT);
  });

  it('좌표가 유한하지 않거나 위경도 범위 밖이면 경로 전체를 버린다 (거짓 동선 금지)', () => {
    expect(encodeRoutePath([[126.9, 37.5], [Number.NaN, 37.6]])).toEqual([]);
    expect(encodeRoutePath([[126.9, 37.5], [126.9, Number.POSITIVE_INFINITY]])).toEqual([]);
    expect(encodeRoutePath([[126.9, 37.5], [126.9, 137.5]])).toEqual([]); // lat 90 초과
    expect(encodeRoutePath([[126.9, 37.5], ['a', 'b']])).toEqual([]);
    expect(encodeRoutePath(null as any)).toEqual([]);
    expect(encodeRoutePath([])).toEqual([]);
    expect(encodeRoutePath([[null, null], [126.9, 37.5]] as any)).toEqual([]);
    expect(encodeRoutePath([['126.9', '37.5'], [126.8, 37.4]] as any)).toEqual([]);
  });

  it('600점 밖에 숨은 손상 좌표와 손상 마커도 저장하지 않는다', () => {
    const long = Array.from({ length: 1000 }, (_, i) => [126.5 + i * 0.0001, 37.4] as [number, number]);
    long[501] = [Number.NaN, 37.4];
    expect(encodeRoutePath(long)).toEqual([]);
    expect(encodeRoutePoints([[126.9, 37.5]] as any)).toEqual([]);
    expect(encodeRoutePoints([{ lat: null, lng: null, role: 'origin' }] as any)).toEqual([]);
  });

  it('읽기: 손상된 저장값을 다른 좌표로 둔갑시키지 않고 통째로 버린다', () => {
    expect(decodeRoutePath([{ lng: 126.9, lat: 37.5 }, { lng: 'x', lat: null }])).toEqual([]);
    expect(decodeRoutePath([{ lng: 126.9, lat: 37.5 }, { lng: 126.9 }])).toEqual([]);
    expect(decodeRoutePath([{ lng: 126.9, lat: 37.5 }, [126.8]])).toEqual([]);
    expect(decodeRoutePath('nope' as any)).toEqual([]);
  });

  it('읽기: 이미 공개형(쌍 배열)으로 저장된 구 데이터도 그대로 통과', () => {
    expect(decodeRoutePath(REAL_PATH)).toEqual(REAL_PATH);
  });

  it('buildRouteSnapshot 은 km·톨비·소요시간을 보존하고 path 만 저장형으로 바꾼다', () => {
    const snapshot = buildRouteSnapshot(realRoute(), 1_760_000_000_000);
    expect(snapshot).toMatchObject({
      km: 80,
      tollKRW: 5000,
      durationMin: 95,
      points: REAL_POINTS,
      calculatedAt: 1_760_000_000_000,
    });
    expect(snapshot.path[0]).toEqual({ lng: 126.97230, lat: 37.55519 });
    expect(() => assertFirestoreSafe({ routeSnapshot: snapshot })).not.toThrow();
  });

  it('buildRouteSnapshot 은 손상된 필수 숫자를 0으로 둔갑시키지 않는다', () => {
    expect(() => buildRouteSnapshot(realRoute({ km: '80' }))).toThrow('INVALID_ROUTE_SNAPSHOT');
    expect(() => buildRouteSnapshot(realRoute({ tollKRW: 1.5 }))).toThrow('INVALID_ROUTE_SNAPSHOT');
    expect(() => buildRouteSnapshot(realRoute({ durationMin: null }))).toThrow('INVALID_ROUTE_SNAPSHOT');
  });

  it('decodeRouteSnapshot 은 없는 스냅샷을 null 로 둔다', () => {
    expect(decodeRouteSnapshot(null)).toBeNull();
    expect(decodeRouteSnapshot(undefined)).toBeNull();
    expect(decodeRouteSnapshot([] as any)).toBeNull();
    expect(decodeRouteSnapshot({ ...buildRouteSnapshot(realRoute(), 1), path: 'bad' } as any)).toBeNull();
    expect(decodeRouteSnapshot({ ...buildRouteSnapshot(realRoute(), 1), points: 'bad' } as any)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// 2) 실제 Firestore 클라이언트 직렬화 (네트워크·자격증명 없이)
// ─────────────────────────────────────────────────────────────
describe('실제 @google-cloud/firestore 직렬화 — 서버가 거부하는 프로토를 만들지 않는다', () => {
  /** arrayValue 의 원소가 또 arrayValue 면 서버가 INVALID_ARGUMENT 로 문서를 거부한다. */
  function hasArrayInArray(proto: any): boolean {
    if (!proto || typeof proto !== 'object') return false;
    if (proto.arrayValue) {
      const values = proto.arrayValue.values || [];
      if (values.some((value: any) => Boolean(value && value.arrayValue))) return true;
      return values.some(hasArrayInArray);
    }
    if (proto.mapValue) return Object.values(proto.mapValue.fields || {}).some(hasArrayInArray);
    return false;
  }

  async function encodeWithRealClient(value: unknown) {
    const { Firestore } = await import('@google-cloud/firestore');
    // 생성만 하고 어떤 RPC 도 호출하지 않는다 — 네트워크·자격증명 불필요.
    const client = new Firestore({ projectId: 'mood-route-snapshot-offline' }) as any;
    return client._serializer.encodeValue(value);
  }

  it('신규 저장형은 arrayValue 안에 arrayValue 가 없다', async () => {
    const proto = await encodeWithRealClient({ routeSnapshot: buildRouteSnapshot(realRoute(), 1) });
    expect(hasArrayInArray(proto)).toBe(false);
  });

  it('구 저장형은 바로 그 거부 프로토를 만든다 (회귀 증명)', async () => {
    const proto = await encodeWithRealClient({
      routeSnapshot: { km: 80, path: legacyCompactPath(REAL_PATH) },
    });
    expect(hasArrayInArray(proto)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// 3) 세 쓰기 경로 + 4) mood-data 읽기 — 서버 규칙을 강제하는 대역으로 실제 핸들러 주행
// ─────────────────────────────────────────────────────────────
const verifyUserTokenMock = vi.fn();
const computeRouteMock = vi.fn();

let db: any;

vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => db }));
vi.mock('../../api/_shared/user-auth.js', () => ({
  verifyUserToken: (...args: any[]) => verifyUserTokenMock(...args),
  default: (...args: any[]) => verifyUserTokenMock(...args),
}));
vi.mock('../../api/_shared/mood-allowlist.js', () => ({
  getMoodAllowlist: async () => ({ emails: ['admin@x.com', 'approver@x.com'], admins: ['admin@x.com'], settlementApproverEmails: ['approver@x.com'], clientId: 'COMPANY_A' }),
  isAllowedEmail: (allowlist: any, email: string) => allowlist.emails.includes(email),
  isAdminEmail: (allowlist: any, email: string) => allowlist.admins.includes(email),
  isSettlementApproverEmail: (allowlist: any, email: string) =>
    (allowlist.settlementApproverEmails || []).includes(email) && !allowlist.admins.includes(email),
  normEmail: (email: string) => String(email || '').toLowerCase().trim(),
}));
vi.mock('../../api/_shared/mood-route.js', () => ({ computeRoute: (...args: any[]) => computeRouteMock(...args) }));
vi.mock('../../api/_shared/cors.js', () => ({ buildAdminJsonCors: () => ({ 'Content-Type': 'application/json' }) }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: vi.fn() }));
vi.mock('../../api/_shared/notify.js', () => ({ notify: vi.fn(async () => undefined) }));
vi.mock('../../api/_shared/mood-receipt.js', () => ({
  buildMoodSettlementReceiptEmail: () => ({ subject: 's', html: '<p>h</p>', text: 't' }),
}));
vi.mock('../../api/_send-email.js', () => ({ sendEmail: vi.fn(async () => undefined) }));

function makeResponse() {
  const res = {
    statusCode: 0,
    body: '',
    writeHead(status: number) { res.statusCode = status; },
    end(body?: string) { res.body = body || ''; },
  };
  return res;
}

async function call(modulePath: string, body: Record<string, any>, method = 'POST') {
  const { default: handler } = await import(modulePath);
  const res = makeResponse();
  await handler({ method, body, headers: { authorization: 'Bearer t' }, url: '/api/x' } as any, res as any);
  return { res, json: JSON.parse(res.body || '{}') };
}

const STORED_BOOKING = {
  clientId: 'COMPANY_A',
  clientName: '무드',
  status: 'confirmed',
  revision: 0,
  amountKRW: 173000,
  ratePerHour: 30000,
  date: '2026-08-20',
  startTime: '09:30',
  durationHours: 4,
  serviceType: 'vehicle',
  breakdown: {
    baseKRW: 120000,
    distanceSurchargeKRW: 48000,
    tollKRW: 5000,
    km: 80,
    origin: '서울역',
    destination: '인천공항 제1터미널',
    waypoints: ['성수동'],
  },
  courseMoodPercentages: [100, 0, 0],
  courseShareSchemaVersion: 2,
  createdByEmail: 'admin@x.com',
  createdAt: 10,
};

/** 저장된 문서 전체에서 "배열 안 배열" 을 찾는다 — 서버 거부 조건과 동일. */
function nestedArrayFields(dump: Record<string, any>) {
  const bad: string[] = [];
  for (const [path, data] of Object.entries(dump)) {
    try {
      assertFirestoreSafe(data);
    } catch (error) {
      bad.push(`${path}: ${(error as Error).message}`);
    }
  }
  return bad;
}

beforeEach(() => {
  vi.clearAllMocks();
  db = createFakeFirestore({
    'mood_config/booking_availability': openMoodBookingAvailabilityFixture(),
    'mood_clients/COMPANY_A': { name: '무드', balanceKRW: 5_000_000 },
    'mood_bookings/booking-1': { ...STORED_BOOKING },
  });
  verifyUserTokenMock.mockResolvedValue({ ok: true, email: 'admin@x.com', uid: 'uid-1', emailVerified: true });
  computeRouteMock.mockResolvedValue(realRoute());
});

describe('세 쓰기 경로 — 실제 경로가 있어도 Firestore 가 받아들이는 모양만 저장한다', () => {
  it('mood-book: 예약 doc 이 커밋되고 path 는 [{lng,lat}] 이다', async () => {
    const { res, json } = await call('../../api/mood-book.js', {
      clientId: 'COMPANY_A',
      date: '2026-08-20',
      startTime: '09:30',
      durationHours: 4,
      serviceType: 'vehicle',
      origin: '서울역',
      destination: '인천공항 제1터미널',
      waypoints: ['성수동'],
      courseMoodPercentages: [100, 0, 0],
      idempotencyKey: 'book-nested-array-1',
    });

    expect(res.statusCode).toBe(200);
    expect(json.ok).toBe(true);
    const dump = db.__dump();
    const stored = Object.entries(dump).find(([path]) => path.startsWith('mood_bookings/auto-'));
    expect(stored).toBeTruthy();
    const snapshot = (stored as any)[1].routeSnapshot;
    expect(snapshot.path).toHaveLength(REAL_PATH.length);
    expect(snapshot.path[0]).toEqual({ lng: REAL_PATH[0][0], lat: REAL_PATH[0][1] });
    expect(nestedArrayFields(dump)).toEqual([]);
  });

  it('mood-change: 예약 patch·감사 이벤트·멱등 응답 어디에도 중첩 배열이 없다', async () => {
    const changeRequest = {
      bookingId: 'booking-1',
      expectedRevision: 0,
      idempotencyKey: 'change-nested-array-1',
      reason: '촬영 장소 변경',
      booking: {
        date: '2026-08-21',
        startTime: '10:00',
        durationHours: 4,
        serviceType: 'vehicle',
        origin: '서울역',
        destination: '김포공항 국내선',
        waypoints: ['성수동'],
        note: '',
        airportDirection: null,
        airportCode: null,
        courseMoodPercentages: [100, 0, 0],
      },
    };
    const preview = await call('../../api/mood-change.js', {
      ...changeRequest,
      action: 'preview',
    });
    expect(preview.res.statusCode).toBe(200);
    const proposal = await call('../../api/mood-change.js', {
      ...changeRequest,
      action: 'propose',
      quoteId: preview.json.data.quoteId,
      idempotencyKey: 'change-nested-array-propose',
    });
    expect(proposal.res.statusCode).toBe(200);
    verifyUserTokenMock.mockResolvedValue({ ok: true, email: 'approver@x.com', uid: 'uid-approver', emailVerified: true });
    const approvalBody = {
      action: 'approve',
      bookingId: 'booking-1',
      quoteId: preview.json.data.quoteId,
      idempotencyKey: 'change-nested-array-approve',
    };
    const { res, json } = await call('../../api/mood-change.js', approvalBody);

    expect(res.statusCode).toBe(200);
    expect(json.ok).toBe(true);
    const stored = db.__get('mood_bookings/booking-1');
    expect(stored.routeSnapshot.path[0]).toEqual({ lng: REAL_PATH[0][0], lat: REAL_PATH[0][1] });
    // HTTP 응답은 기존 공개 계약, Firestore 멱등 문서는 저장 안전형을 유지한다.
    expect(json.data.booking.routeSnapshot.path[0]).toEqual(REAL_PATH[0]);
    const dump = db.__dump();
    const idempotency = Object.entries(dump).find(([path, value]) => (
      path.startsWith('mood_booking_change_idempotency/')
      && (value as any).response?.data?.booking?.routeSnapshot
    ));
    expect((idempotency as any)[1].response.data.booking.routeSnapshot.path[0]).toEqual({
      lng: REAL_PATH[0][0],
      lat: REAL_PATH[0][1],
    });
    expect(nestedArrayFields(dump)).toEqual([]);

    const replay = await call('../../api/mood-change.js', approvalBody);
    expect(replay.res.statusCode).toBe(200);
    expect(replay.json.data.booking.routeSnapshot.path[0]).toEqual(REAL_PATH[0]);
  });

  it('mood-change: 같은 견적을 동시에 두 번 확정해도 한 요청만 반영한다', async () => {
    computeRouteMock.mockResolvedValue(realRoute({ km: 100, tollKRW: 6000 }));
    const changeRequest = {
      bookingId: 'booking-1',
      expectedRevision: 0,
      reason: '촬영 장소 변경',
      booking: {
        date: '2026-08-20',
        startTime: '09:30',
        durationHours: 5,
        serviceType: 'vehicle',
        origin: '서울역',
        destination: '김포공항 국내선',
        waypoints: ['성수동'],
        note: '',
        airportDirection: null,
        airportCode: null,
        courseMoodPercentages: [100, 0, 0],
      },
    };
    const preview = await call('../../api/mood-change.js', {
      ...changeRequest,
      action: 'preview',
      idempotencyKey: 'change-race-preview',
    });
    expect(preview.res.statusCode).toBe(200);
    const quoteId = preview.json.data.quoteId;
    const adjustmentKRW = preview.json.data.adjustmentKRW;
    const proposal = await call('../../api/mood-change.js', {
      ...changeRequest,
      action: 'propose',
      quoteId,
      idempotencyKey: 'change-race-propose',
    });
    expect(proposal.res.statusCode).toBe(200);
    verifyUserTokenMock.mockResolvedValue({ ok: true, email: 'approver@x.com', uid: 'uid-approver', emailVerified: true });
    const barrier = makeBarrier(2);
    db.__beforeCommit = ({ attempt }: { attempt: number }) => attempt === 1 ? barrier.wait() : Promise.resolve();

    const [first, second] = await Promise.all([
      call('../../api/mood-change.js', {
        action: 'approve',
        bookingId: 'booking-1',
        quoteId,
        idempotencyKey: 'change-race-approve-a',
      }),
      call('../../api/mood-change.js', {
        action: 'approve',
        bookingId: 'booking-1',
        quoteId,
        idempotencyKey: 'change-race-approve-b',
      }),
    ]);

    expect([first.res.statusCode, second.res.statusCode].sort()).toEqual([200, 409]);
    expect([first.json.error, second.json.error]).toContain('CHANGE_QUOTE_ALREADY_USED');
    expect(db.__stats.retries).toBeGreaterThanOrEqual(1);
    expect(db.__get('mood_bookings/booking-1').revision).toBe(1);
    expect(db.__get('mood_clients/COMPANY_A').balanceKRW).toBe(5_000_000 - adjustmentKRW);
    expect(db.__get(`mood_booking_change_quotes/${quoteId}`).status).toBe('approved');
    const dump = db.__dump();
    expect(Object.keys(dump).filter((path) => path.startsWith('mood_booking_change_events/'))).toHaveLength(2);
    expect(Object.keys(dump).filter((path) => path.startsWith('mood_notification_outbox/'))).toHaveLength(2);
    expect(Object.keys(dump).filter((path) => path.startsWith('mood_booking_change_idempotency/'))).toHaveLength(2);
  });

  it('mood-settle: finalRouteSnapshot 은 제안에 담기고 MOOD 승인 시 저장형으로 커밋된다', async () => {
    const input = {
      bookingId: 'booking-1',
      actualHours: 5,
      tollMode: 'estimated',
      manualAdjustmentKRW: 0,
      origin: '서울역',
      destination: '인천공항 제1터미널',
      waypoints: ['성수동'],
      courseMoodPercentages: [100, 0, 0],
      expectedRevision: Number(db.__get('mood_bookings/booking-1')?.revision || 0),
    };
    const preview = await call('../../api/mood-settle-preview.js', input);
    expect(preview.res.statusCode).toBe(200);

    const propose = await call('../../api/mood-settle.js', {
      ...input,
      previewHash: preview.json.data.previewHash,
      idempotencyKey: 'route-snapshot-propose',
    });
    expect(propose.res.statusCode).toBe(200);
    // 제안 단계 — 예약은 아직 확정되지 않았고 최종 스냅샷도 커밋되지 않았다.
    expect(db.__get('mood_bookings/booking-1').status).toBe('confirmed');
    expect(db.__get('mood_bookings/booking-1').finalRouteSnapshot).toBeUndefined();
    // 제안 문서에는 이미 저장형(lng/lat 객체)으로 담겨 중첩 배열이 없다.
    expect(nestedArrayFields(db.__dump())).toEqual([]);

    verifyUserTokenMock.mockResolvedValue({ ok: true, email: 'approver@x.com', uid: 'uid-2', emailVerified: true });
    const { res, json } = await call('../../api/mood-settle-respond.js', {
      proposalId: propose.json.data.proposalId,
      action: 'approve',
      idempotencyKey: 'route-snapshot-approve',
    });
    verifyUserTokenMock.mockResolvedValue({ ok: true, email: 'admin@x.com', uid: 'uid-1', emailVerified: true });

    expect(res.statusCode).toBe(200);
    expect(json.ok).toBe(true);
    const stored = db.__get('mood_bookings/booking-1');
    expect(stored.status).toBe('completed');
    expect(stored.finalRouteSnapshot.path[0]).toEqual({ lng: REAL_PATH[0][0], lat: REAL_PATH[0][1] });
    expect(nestedArrayFields(db.__dump())).toEqual([]);
  });

  it('구 구현(pair 배열 그대로 저장)이었다면 같은 대역이 장애 메시지로 거부한다', () => {
    expect(() => assertFirestoreSafe({
      routeSnapshot: { km: 80, path: legacyCompactPath(REAL_PATH) },
    })).toThrow('3 INVALID_ARGUMENT: Property routeSnapshot contains an invalid nested entity.');
  });

  it('뒤 write가 중첩 배열이면 앞 write도 남지 않는다 (트랜잭션 원자성)', async () => {
    const atomicDb = createFakeFirestore({
      'atomic/a': { value: 1 },
      'atomic/b': { value: 1 },
    });
    await expect(atomicDb.runTransaction(async (tx: any) => {
      tx.update(atomicDb.collection('atomic').doc('a'), { value: 2 });
      tx.update(atomicDb.collection('atomic').doc('b'), { path: [[126.9, 37.5]] });
    })).rejects.toThrow('invalid nested entity');
    expect(atomicDb.__get('atomic/a')).toEqual({ value: 1 });
    expect(atomicDb.__get('atomic/b')).toEqual({ value: 1 });
  });
});

describe('mood-data 읽기 경계 — 공개 계약 [lng,lat][] 로 되돌린다', () => {
  it('routeSnapshot·finalRouteSnapshot 둘 다 왕복한다', async () => {
    db.__patch('mood_bookings/booking-1', {
      routeSnapshot: buildRouteSnapshot(realRoute(), 20),
      finalRouteSnapshot: buildRouteSnapshot(realRoute({ km: 92 }), 30),
      finalBreakdown: { ...STORED_BOOKING.breakdown, km: 92 },
      status: 'completed',
      finalAmountKRW: 200000,
    });

    const res = makeResponse();
    const { default: handler } = await import('../../api/mood-data.js');
    await handler({ method: 'GET', headers: { authorization: 'Bearer t' }, url: '/api/mood-data?clientId=COMPANY_A' } as any, res as any);

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    const booking = json.data.bookings.find((b: any) => b.id === 'booking-1');
    expect(booking.routeSnapshot.path).toEqual(REAL_PATH);
    expect(booking.finalRouteSnapshot.path).toEqual(REAL_PATH);
    expect(booking.routeSnapshot.points).toEqual(REAL_POINTS);
  });

  it('손상된 저장 경로는 스냅샷을 버리고 가짜 좌표를 만들지 않는다', async () => {
    db.__patch('mood_bookings/booking-1', {
      routeSnapshot: { km: 80, durationMin: 95, points: REAL_POINTS, path: [{ lng: 126.9, lat: 37.5 }, { lng: 'x', lat: 37.6 }] },
    });

    const res = makeResponse();
    const { default: handler } = await import('../../api/mood-data.js');
    await handler({ method: 'GET', headers: { authorization: 'Bearer t' }, url: '/api/mood-data?clientId=COMPANY_A' } as any, res as any);

    const json = JSON.parse(res.body);
    const booking = json.data.bookings.find((b: any) => b.id === 'booking-1');
    expect(booking.routeSnapshot).toBeNull();
  });
});

describe('nullish 연산자 미사용 (mojibake 가드)', () => {
  it('신규 코덱 모듈', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(process.cwd(), 'api/_shared/mood-route-snapshot.js'), 'utf8');
    expect(src.includes(String.fromCharCode(63, 63))).toBe(false);
  });
});
