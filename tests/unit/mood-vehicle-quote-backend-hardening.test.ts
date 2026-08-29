/* eslint-disable @typescript-eslint/no-explicit-any -- serverless handler와 Firestore transaction을 메모리로 검증한다. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error — Vercel ESM JavaScript 공유 모듈
import { BUILT_IN_MOOD_QUOTE_PROFILE } from '../../api/_shared/vehicle-quote.js';

const verifyUserTokenMock = vi.fn();
const captureErrorMock = vi.fn();
const computeRouteMock = vi.fn();

type StoredDoc = Record<string, any>;
type Ref = {
  path: string;
  get: () => Promise<{ exists: boolean; data: () => StoredDoc | undefined }>;
  collection: (name: string) => { doc: (id: string) => Ref };
};
type StagedWrite = {
  kind: 'set' | 'create';
  ref: Ref;
  value: StoredDoc;
  merge: boolean;
};

const store = new Map<string, StoredDoc>();
const createdPaths: string[] = [];
let generatedId = 0;

function snapshot(ref: Ref) {
  const value = store.get(ref.path);
  return {
    exists: value !== undefined,
    data: () => value === undefined ? undefined : structuredClone(value),
  };
}

function makeRef(path: string): Ref {
  const ref: Ref = {
    path,
    get: async () => snapshot(ref),
    collection: (name: string) => ({
      doc: (id: string) => makeRef(`${path}/${name}/${id}`),
    }),
  };
  return ref;
}

const dbMock = {
  collection: vi.fn((name: string) => ({
    doc: vi.fn((id?: string) => makeRef(`${name}/${id || `generated-${++generatedId}`}`)),
  })),
  runTransaction: vi.fn(async (callback: (tx: any) => Promise<any>) => {
    const staged: StagedWrite[] = [];
    const result = await callback({
      get: async (ref: Ref) => snapshot(ref),
      set: (ref: Ref, value: StoredDoc, options?: { merge?: boolean }) => staged.push({
        kind: 'set',
        ref,
        value: structuredClone(value),
        merge: options?.merge === true,
      }),
      create: (ref: Ref, value: StoredDoc) => staged.push({
        kind: 'create',
        ref,
        value: structuredClone(value),
        merge: false,
      }),
    });

    for (const write of staged) {
      if (write.kind === 'create') {
        if (store.has(write.ref.path)) throw new Error(`ALREADY_EXISTS: ${write.ref.path}`);
        createdPaths.push(write.ref.path);
      }
      const previous = write.merge ? store.get(write.ref.path) || {} : {};
      store.set(write.ref.path, { ...previous, ...write.value });
    }
    return result;
  }),
};

vi.mock('../../api/_shared/user-auth.js', () => ({
  verifyUserToken: (...args: any[]) => verifyUserTokenMock(...args),
}));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => dbMock }));
vi.mock('../../api/_shared/mood-allowlist.js', () => ({
  getMoodAllowlist: async () => ({
    emails: ['admin@cocotrip.test'],
    admins: ['admin@cocotrip.test'],
    clientId: 'MOOD',
  }),
  isAdminEmail: (allowlist: any, email: string) => allowlist.admins.includes(email),
}));
vi.mock('../../api/_shared/mood-route.js', () => ({
  computeRoute: (...args: any[]) => computeRouteMock(...args),
}));
vi.mock('../../api/_shared/cors.js', () => ({ buildAdminJsonCors: () => ({}) }));
vi.mock('../../api/_shared/sentry.js', () => ({
  captureError: (...args: any[]) => captureErrorMock(...args),
}));

function response() {
  const res = {
    statusCode: 0,
    body: '',
    headers: {} as Record<string, string>,
    writeHead(status: number, headers?: Record<string, string>) {
      res.statusCode = status;
      res.headers = headers || {};
      return res;
    },
    end(body?: string | Buffer) {
      res.body = body instanceof Buffer ? body.toString('utf8') : (body || '');
      return res;
    },
  };
  return res;
}

async function callProfiles(body: Record<string, any>) {
  const { default: handler } = await import('../../api/mood-quote-profiles.js');
  const res = response();
  await handler({
    method: 'POST',
    body,
    headers: { authorization: 'Bearer test' },
  } as any, res as any);
  return { res, json: JSON.parse(res.body || '{}') };
}

async function callPreview(body: Record<string, any>) {
  const { default: handler } = await import('../../api/mood-quote-preview.js');
  const res = response();
  await handler({
    method: 'POST',
    body,
    headers: { authorization: 'Bearer test' },
  } as any, res as any);
  return { res, json: JSON.parse(res.body || '{}') };
}

const PROFILE_ID = 'company-alpha';
const storedProfile = () => ({
  ...BUILT_IN_MOOD_QUOTE_PROFILE,
  id: PROFILE_ID,
  version: 1,
  currentVersion: 1,
  builtIn: false,
  companyName: '알파 차량',
  archived: false,
  createdAt: 100,
  createdByEmail: 'creator@cocotrip.test',
  updatedAt: 200,
  updatedByEmail: 'editor@cocotrip.test',
});

const previewBody = (overrides: Record<string, any> = {}) => ({
  profileId: BUILT_IN_MOOD_QUOTE_PROFILE.id,
  profileVersion: BUILT_IN_MOOD_QUOTE_PROFILE.version,
  serviceDate: '2026-09-01',
  startTime: '09:00',
  endTime: '12:00',
  totalMinutes: 180,
  routeMode: 'manual',
  manualDistanceKm: 10,
  manualTollKRW: 0,
  parkingKRW: 0,
  departureAddress: '서울특별시 강남구 출발로 1',
  returnAddress: '서울특별시 마포구 복귀로 2',
  stops: [],
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
  createdPaths.length = 0;
  generatedId = 0;
  store.set(`mood_quote_profiles/${PROFILE_ID}`, storedProfile());
  verifyUserTokenMock.mockResolvedValue({
    ok: true,
    email: 'admin@cocotrip.test',
    uid: 'admin-1',
    emailVerified: true,
  });
});

describe('/api/mood-quote-preview 입력 fail-closed', () => {
  it.each([0, -1, 1.5, '', null, '1'])(
    '명시한 profileVersion이 양의 정수 number가 아니면 400으로 거부한다: %s',
    async (profileVersion) => {
      const { res, json } = await callPreview(previewBody({ profileVersion }));
      expect(res.statusCode).toBe(400);
      expect(json.code).toBe('INVALID_PROFILE_VERSION');
    },
  );

  it.each(['automatic', 'teleport', '', null, 0])(
    '예상하지 않은 routeMode를 manual로 바꾸지 않고 400으로 거부한다: %s',
    async (routeMode) => {
      const { res, json } = await callPreview(previewBody({ routeMode }));
      expect(res.statusCode).toBe(400);
      expect(json.code).toBe('INVALID_ROUTE_MODE');
    },
  );

  it('routeMode를 생략해도 manual로 추정하지 않고 400으로 거부한다', async () => {
    const body = previewBody();
    delete body.routeMode;
    const { res, json } = await callPreview(body);
    expect(res.statusCode).toBe(400);
    expect(json.code).toBe('INVALID_ROUTE_MODE');
  });

  it.each(['', '   ', '0', '0x10', '1e2', null, [], [1], {}])(
    '수동 거리는 실제 JSON number가 아니면 숫자로 강제 변환하지 않는다: %j',
    async (manualDistanceKm) => {
    const { res, json } = await callPreview(previewBody({ manualDistanceKm }));
    expect(res.statusCode).toBe(400);
    expect(json.code).toBe('INVALID_MANUAL_DISTANCE');
    },
  );

  it.each([
    { manualDistanceKm: 0, expectedMeters: 0 },
    { manualDistanceKm: 1.2345, expectedMeters: 1235 },
    { manualDistanceKm: 3000, expectedMeters: 3000000 },
  ])('0~3000km의 finite decimal number는 허용한다', async ({ manualDistanceKm, expectedMeters }) => {
    const { res, json } = await callPreview(previewBody({ manualDistanceKm }));
    expect(res.statusCode).toBe(200);
    expect(json.data.breakdown.distanceMeters).toBe(expectedMeters);
  });

  it('수동 견적도 서로 다른 경로 주소점이 2개 미만이면 거부한다', async () => {
    const { res, json } = await callPreview(previewBody({
      departureAddress: '서울특별시 강남구 같은곳 1',
      returnAddress: '서울특별시 강남구 같은곳 1',
    }));
    expect(res.statusCode).toBe(400);
    expect(json.code).toBe('ROUTE_NEEDS_TWO_ADDRESSES');
  });

  it('41개 방문지를 자르지 않고 TOO_MANY_STOPS로 거부한다', async () => {
    const stops = Array.from({ length: 41 }, (_, index) => ({ order: index + 1, name: `장소 ${index + 1}` }));
    const { res, json } = await callPreview(previewBody({ stops }));
    expect(res.statusCode).toBe(400);
    expect(json.code).toBe('TOO_MANY_STOPS');
  });

  it('자동 경로는 30초 예산을 넘길 수 있는 14개 주소를 계산 전에 거부한다', async () => {
    const stops = Array.from({ length: 14 }, (_, index) => ({
      order: index + 1,
      name: `자동 장소 ${index + 1}`,
      roadAddress: `서울특별시 자동로 ${index + 1}`,
      includeInRoute: true,
      addressVerified: true,
    }));
    const { res, json } = await callPreview(previewBody({
      routeMode: 'route',
      departureAddress: '',
      returnAddress: '',
      stops,
    }));

    expect(res.statusCode).toBe(400);
    expect(json).toMatchObject({
      code: 'ROUTE_ADDRESS_LIMIT_EXCEEDED',
      addressCount: 14,
      maxAddressCount: 13,
    });
    expect(computeRouteMock).not.toHaveBeenCalled();
  });

  it('자동 경로 13개 주소는 7개씩 겹친 두 번의 Directions 호출로 계산한다', async () => {
    const stops = Array.from({ length: 13 }, (_, index) => ({
      order: index + 1,
      name: `자동 장소 ${index + 1}`,
      roadAddress: `서울특별시 허용로 ${index + 1}`,
      includeInRoute: true,
      addressVerified: true,
    }));
    computeRouteMock.mockResolvedValue({
      ok: true,
      distanceMeters: 1000,
      tollKRW: 0,
      durationMin: 10,
      path: [],
      points: [],
    });

    const { res, json } = await callPreview(previewBody({
      routeMode: 'route',
      departureAddress: '',
      returnAddress: '',
      stops,
    }));

    expect(res.statusCode).toBe(200);
    expect(computeRouteMock).toHaveBeenCalledTimes(2);
    expect(computeRouteMock.mock.calls.map(([request]) => request.waypoints)).toEqual([
      stops.slice(1, 6).map((stop) => stop.roadAddress),
      stops.slice(7, 12).map((stop) => stop.roadAddress),
    ]);
    expect(json.data.route).toMatchObject({ distanceMeters: 2000, durationMinutes: 20 });
  });

  it('거리 직접 입력은 기존 한도인 방문지 40개를 그대로 허용한다', async () => {
    const stops = Array.from({ length: 40 }, (_, index) => ({
      order: index + 1,
      name: `수동 장소 ${index + 1}`,
      includeInRoute: false,
    }));
    const { res, json } = await callPreview(previewBody({ stops }));

    expect(res.statusCode).toBe(200);
    expect(json.data.quoteSnapshot.schedule.stops).toHaveLength(40);
    expect(computeRouteMock).not.toHaveBeenCalled();
  });

  it.each(['', null, '0', [], [0]])(
    '명시한 수동 실비는 number 정수 외 값을 0으로 바꾸지 않는다: %j',
    async (manualTollKRW) => {
      const { res, json } = await callPreview(previewBody({ manualTollKRW }));
      expect(res.statusCode).toBe(400);
      expect(json.code).toBe('INVALID_TOLL_AMOUNT');
    },
  );

  it('경로 응답의 정확한 meter를 우선하고, 없을 때만 km를 meter로 변환한다', async () => {
    computeRouteMock.mockResolvedValueOnce({
      ok: true,
      distanceMeters: 49999,
      km: 50,
      tollKRW: 0,
      durationMin: 60,
      path: [],
      points: [],
    });
    const exact = await callPreview(previewBody({ routeMode: 'route' }));
    expect(exact.res.statusCode).toBe(200);
    expect(exact.json.data.breakdown.distanceMeters).toBe(49999);
    expect(exact.json.data.documentText).toContain('49.999km는 적용 기준 50km 미만 = 0원');

    computeRouteMock.mockResolvedValueOnce({
      ok: true,
      km: 12.345,
      tollKRW: 0,
      durationMin: 30,
      path: [],
      points: [],
    });
    const fallback = await callPreview(previewBody({ routeMode: 'route' }));
    expect(fallback.res.statusCode).toBe(200);
    expect(fallback.json.data.breakdown.distanceMeters).toBe(12345);
  });

  it('클라이언트가 conflicts를 누락하거나 위조해도 현재 stop에서 같은 충돌을 재탐지한다', async () => {
    const expectedConflict = {
      type: 'REGION_ADDRESS_MISMATCH',
      stopOrder: 1,
      sourceRegion: 'Guri',
      addressRegion: 'Seoul',
      addressField: 'roadAddress',
    };
    const stop = {
      order: 1,
      name: '첫 장소',
      sourceRegion: 'Guri',
      roadAddress: '123 Wangsimni-ro, Seongdong-gu, Seoul',
      includeInRoute: true,
    };
    const requests = [
      previewBody({ stops: [stop] }),
      previewBody({ stops: [stop], conflicts: '위조된 값' }),
      previewBody({
        stops: [stop],
        conflicts: Array.from({ length: 41 }, () => ({
          type: 'REGION_ADDRESS_MISMATCH',
          stopOrder: 999,
          sourceRegion: 'Busan',
          addressRegion: 'Jeju',
          addressField: 'roadAddress',
          unexpected: true,
        })),
      }),
    ];
    for (const request of requests) {
      const { res, json } = await callPreview(request);
      expect(res.statusCode).toBe(200);
      expect(json.data.conflicts).toEqual([expectedConflict]);
      expect(json.data.quoteSnapshot.conflicts).toEqual([expectedConflict]);
      expect(json.data.documentText).toContain('지역 설명(Guri)과 명시 주소의 지역(Seoul)이 다릅니다');
    }
  });

  it('주소를 sourceRegion과 같은 지역으로 수정하면 stale 클라이언트 경고를 해제한다', async () => {
    const { res, json } = await callPreview(previewBody({
      stops: [{
        order: 1,
        name: '첫 장소',
        sourceRegion: 'Guri',
        roadAddress: 'Gyeonggi-do, Guri-si, Galmae-dong',
        includeInRoute: true,
      }],
      conflicts: [{
        type: 'REGION_ADDRESS_MISMATCH',
        stopOrder: 1,
        sourceRegion: 'Guri',
        addressRegion: 'Seoul',
        addressField: 'roadAddress',
      }],
    }));
    expect(res.statusCode).toBe(200);
    expect(json.data.conflicts).toEqual([]);
    expect(json.data.quoteSnapshot.conflicts).toEqual([]);
    expect(json.data.documentText).not.toContain('지역 설명(Guri)과 명시 주소의 지역');
  });

  it('주소를 제3 지역으로 수정하면 stale 값 대신 최신 주소 지역으로 경고한다', async () => {
    const { res, json } = await callPreview(previewBody({
      stops: [{
        order: 1,
        sourceRegion: 'Guri',
        roadAddress: 'Busan Metropolitan City, Haeundae-gu',
        includeInRoute: true,
      }],
      conflicts: [{
        type: 'REGION_ADDRESS_MISMATCH',
        stopOrder: 1,
        sourceRegion: 'Guri',
        addressRegion: 'Seoul',
        addressField: 'roadAddress',
      }],
    }));
    expect(res.statusCode).toBe(200);
    expect(json.data.conflicts).toEqual([{
      type: 'REGION_ADDRESS_MISMATCH',
      stopOrder: 1,
      sourceRegion: 'Guri',
      addressRegion: 'Busan Metropolitan City',
      addressField: 'roadAddress',
    }]);
    expect(json.data.documentText).toContain('명시 주소의 지역(Busan Metropolitan City)');
    expect(json.data.documentText).not.toContain('명시 주소의 지역(Seoul)');
  });

  it('장소 순서를 바꾸면 클라이언트의 예전 order가 아니라 현재 stop order를 쓴다', async () => {
    const { res, json } = await callPreview(previewBody({
      stops: [{
        order: 7,
        sourceRegion: 'Guri',
        roadAddress: '123 Wangsimni-ro, Seongdong-gu, Seoul',
        includeInRoute: true,
      }],
      conflicts: [{
        type: 'REGION_ADDRESS_MISMATCH',
        stopOrder: 1,
        sourceRegion: 'Guri',
        addressRegion: 'Seoul',
        addressField: 'roadAddress',
      }],
    }));
    expect(res.statusCode).toBe(200);
    expect(json.data.conflicts[0]).toMatchObject({ stopOrder: 7, addressRegion: 'Seoul' });
    expect(json.data.documentText).toContain('7번 장소의 지역 설명(Guri)');
  });
});

describe('/api/mood-quote-profiles version·archive 보호', () => {
  it('자동 주차비 산정이 없으므로 parkingPolicy=route_estimate 프로필 저장을 거부한다', async () => {
    const { res, json } = await callProfiles({
      action: 'save',
      profile: {
        ...BUILT_IN_MOOD_QUOTE_PROFILE,
        id: 'parking-route-company',
        builtIn: false,
        parkingPolicy: 'route_estimate',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(json.code).toBe('INVALID_INCIDENTAL_POLICY');
  });

  it('기존 프로필 저장은 expectedVersion이 필수이고 stale version은 409로 막는다', async () => {
    const profile = { ...storedProfile(), companyName: '알파 차량 수정' };
    const missing = await callProfiles({ action: 'save', profile });
    expect(missing.res.statusCode).toBe(400);
    expect(missing.json.code).toBe('EXPECTED_VERSION_REQUIRED');

    const stale = await callProfiles({ action: 'save', profile, expectedVersion: 0 });
    expect(stale.res.statusCode).toBe(409);
    expect(stale.json).toMatchObject({ code: 'PROFILE_VERSION_CONFLICT', currentVersion: 1 });
    expect(store.get(`mood_quote_profiles/${PROFILE_ID}`)?.companyName).toBe('알파 차량');
    expect(createdPaths).toEqual([]);
  });

  it('잘못된 프로필 ID는 Firestore doc ref를 만들기 전 400으로 거부한다', async () => {
    const save = await callProfiles({
      action: 'save',
      expectedVersion: 1,
      profile: { ...storedProfile(), id: 'bad/path' },
    });
    expect(save.res.statusCode).toBe(400);
    expect(save.json.code).toBe('INVALID_PROFILE_ID');
    expect(dbMock.collection).not.toHaveBeenCalled();

    const archive = await callProfiles({ action: 'archive', profileId: '../bad', expectedVersion: 1 });
    expect(archive.res.statusCode).toBe(400);
    expect(archive.json.code).toBe('INVALID_PROFILE_ID');
    expect(dbMock.collection).not.toHaveBeenCalled();
  });

  it('archive도 expectedVersion을 필수로 받고 stale version은 409로 막는다', async () => {
    const missing = await callProfiles({ action: 'archive', profileId: PROFILE_ID });
    expect(missing.res.statusCode).toBe(400);
    expect(missing.json.code).toBe('EXPECTED_VERSION_REQUIRED');

    const stale = await callProfiles({ action: 'archive', profileId: PROFILE_ID, expectedVersion: 0 });
    expect(stale.res.statusCode).toBe(409);
    expect(stale.json).toMatchObject({ code: 'PROFILE_VERSION_CONFLICT', currentVersion: 1 });
    expect(store.get(`mood_quote_profiles/${PROFILE_ID}`)).toMatchObject({ version: 1, archived: false });
  });

  it('archive는 version을 증가시키고 create로 불변 version snapshot과 전·후 감사를 같은 transaction에 남긴다', async () => {
    const { res, json } = await callProfiles({
      action: 'archive',
      profileId: PROFILE_ID,
      expectedVersion: 1,
    });

    expect(res.statusCode).toBe(200);
    expect(json.data.profile).toMatchObject({ id: PROFILE_ID, version: 2, currentVersion: 2, archived: true });
    expect(store.get(`mood_quote_profiles/${PROFILE_ID}`)).toMatchObject({
      version: 2,
      currentVersion: 2,
      archived: true,
    });
    const versionPath = `mood_quote_profiles/${PROFILE_ID}/versions/v000002`;
    expect(createdPaths).toContain(versionPath);
    expect(store.get(versionPath)).toMatchObject({
      id: PROFILE_ID,
      version: 2,
      archived: true,
      changeType: 'archive',
      savedByEmail: 'admin@cocotrip.test',
    });

    const audit = [...store.entries()]
      .find(([path]) => path.startsWith('mood_quote_profile_audit/'))?.[1];
    expect(audit).toMatchObject({
      action: 'profile_archived',
      profileId: PROFILE_ID,
      previousVersion: 1,
      newVersion: 2,
      byEmail: 'admin@cocotrip.test',
      before: { version: 1, currentVersion: 1, archived: false, companyName: '알파 차량' },
      after: { version: 2, currentVersion: 2, archived: true, companyName: '알파 차량' },
    });
    const completeAuditFields = [
      'id', 'version', 'currentVersion', 'builtIn', 'archived', 'companyName', 'logoUrl', 'contact',
      'currency', 'timezone', 'hourlyRateKRW', 'minMinutes', 'maxMinutes',
      'billingIncrementMinutes', 'distanceThresholdMeters', 'distanceRateKRWPerKm',
      'distanceBillingMode', 'vatBasisPoints', 'tollPolicy', 'parkingPolicy', 'overtimeRateKRW',
      'overtimeIncludesVat', 'documentTitle', 'footer', 'createdAt', 'createdByEmail', 'updatedAt',
      'updatedByEmail',
    ];
    for (const field of completeAuditFields) {
      expect(audit?.before).toHaveProperty(field);
      expect(audit?.after).toHaveProperty(field);
    }
    expect([...store.keys()].some((path) => /^mood_(?:bookings|clients|topups)\//.test(path))).toBe(false);
  });
});
