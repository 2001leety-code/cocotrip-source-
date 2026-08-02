/**
 * 어드민 zone_courses 목록 회귀 잠금 (2026-08-02).
 *
 * 잠근 버그: `fetchZoneCoursesList` 가 `orderBy('updatedAt','desc')` 를 걸었는데, 운영
 *   `zone_courses` 의 시드 문서에는 `updatedAt` 필드가 **아예 없다**(`seeded_at` 만 있다).
 *   Firestore 는 정렬 기준 필드가 없는 문서를 결과에서 제외한다 → 쿼리는 성공하고 배열만
 *   비어서, 어드민 화면이 "전체 0 · 발행됨 0 · 등록된 존 코스가 없습니다" 로 보였다.
 *   실제로는 published 40건 이상이 들어 있었다(운영 실측 2026-08-02).
 *
 * 그래서 이 테스트는 firebase/firestore 를 mock 해서 **어떤 쿼리 제약을 거는지**와
 * **정렬 결과**를 본다. orderBy 를 되살리면 첫 번째 테스트가 실제로 깨진다.
 *
 * 운영 Firestore 에는 쓰지 않는다 — 전부 mock.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/** 쿼리에 실린 제약을 기록하기 위한 가짜 constraint 표현. */
const constraints: Array<Record<string, unknown>> = [];
let docsToReturn: Array<{ id: string; data: Record<string, unknown> }> = [];

vi.mock('firebase/firestore', () => {
  class FakeTimestamp {
    constructor(private ms: number) {}
    toMillis() { return this.ms; }
  }
  return {
    Timestamp: FakeTimestamp,
    collection: (_db: unknown, name: string) => ({ name }),
    doc: () => ({}),
    getDoc: vi.fn(),
    getDocs: vi.fn(async () => ({
      docs: docsToReturn.map((d) => ({ id: d.id, data: () => d.data })),
    })),
    query: (_col: unknown, ...cons: Array<Record<string, unknown>>) => {
      constraints.length = 0;
      constraints.push(...cons);
      return { cons };
    },
    where: (field: string, op: string, value: unknown) => ({ kind: 'where', field, op, value }),
    orderBy: (field: string, dir: string) => ({ kind: 'orderBy', field, dir }),
    setDoc: vi.fn(),
    deleteDoc: vi.fn(),
    serverTimestamp: vi.fn(),
  };
});
vi.mock('../../src/lib/firebase', () => ({ db: {} }));

const { fetchZoneCoursesList, fetchPublishedZoneCourses, recencyMs } =
  await import('../../src/lib/zone-courses-firestore');

/** 운영 시드 문서 모양 — updatedAt 이 없고 seeded_at(ISO 문자열)만 있다. */
function seeded(id: string, seededAt: string, over: Record<string, unknown> = {}) {
  return { id, data: { id, city: 'andong', status: 'published', seeded_at: seededAt, ...over } };
}

beforeEach(() => { constraints.length = 0; docsToReturn = []; });

describe('fetchZoneCoursesList — 어드민 목록', () => {
  it('🔴 updatedAt 정렬을 걸지 않는다 (시드 문서가 통째로 사라지던 원인)', async () => {
    docsToReturn = [seeded('A', '2026-06-15T02:00:00.000Z')];
    await fetchZoneCoursesList({ city: 'andong' });

    expect(constraints.some((c) => c.kind === 'orderBy')).toBe(false);
    // 필터는 그대로 동등 조건만 — 복합 색인이 필요 없다.
    expect(constraints).toEqual([{ kind: 'where', field: 'city', op: '==', value: 'andong' }]);
  });

  it('updatedAt 이 없는 시드 문서도 목록에 나온다', async () => {
    docsToReturn = [
      seeded('OLD', '2026-06-14T00:00:00.000Z'),
      seeded('NEW', '2026-06-16T00:00:00.000Z'),
      seeded('MID', '2026-06-15T00:00:00.000Z'),
    ];
    const list = await fetchZoneCoursesList();
    expect(list.map((d) => d.id)).toEqual(['NEW', 'MID', 'OLD']);
  });

  it('어드민이 고친 문서(updatedAt)와 시드 문서(seeded_at)를 한 줄로 섞어 최근 순 정렬', async () => {
    const { Timestamp } = await import('firebase/firestore');
    docsToReturn = [
      seeded('SEED_OLD', '2026-06-01T00:00:00.000Z'),
      { id: 'EDITED', data: { id: 'EDITED', status: 'draft', updatedAt: new Timestamp(Date.parse('2026-07-01T00:00:00.000Z')) } },
      seeded('SEED_NEW', '2026-06-20T00:00:00.000Z'),
    ];
    const list = await fetchZoneCoursesList();
    expect(list.map((d) => d.id)).toEqual(['EDITED', 'SEED_NEW', 'SEED_OLD']);
  });

  it('시각을 못 찾는 문서는 맨 뒤로 가되 사라지지는 않는다', async () => {
    docsToReturn = [
      { id: 'NO_DATE', data: { id: 'NO_DATE', status: 'draft' } },
      seeded('HAS_DATE', '2026-06-20T00:00:00.000Z'),
    ];
    const list = await fetchZoneCoursesList();
    expect(list.map((d) => d.id)).toEqual(['HAS_DATE', 'NO_DATE']);
  });

  it('시각이 같으면 id 순으로 안정 정렬 (새로고침마다 순서가 흔들리지 않게)', async () => {
    docsToReturn = [seeded('B', '2026-06-20T00:00:00.000Z'), seeded('A', '2026-06-20T00:00:00.000Z')];
    const list = await fetchZoneCoursesList();
    expect(list.map((d) => d.id)).toEqual(['A', 'B']);
  });

  it('city·source 필터는 그대로 동작한다', async () => {
    docsToReturn = [seeded('A', '2026-06-20T00:00:00.000Z')];
    await fetchZoneCoursesList({ city: 'seoul', source: 'cocotrip_curated' });
    expect(constraints).toEqual([
      { kind: 'where', field: 'city', op: '==', value: 'seoul' },
      { kind: 'where', field: 'source', op: '==', value: 'cocotrip_curated' },
    ]);
  });

  it("'all' 은 필터를 걸지 않는다", async () => {
    docsToReturn = [];
    await fetchZoneCoursesList({ city: 'all', source: 'all' });
    expect(constraints).toEqual([]);
  });

  it('🔴 조회 실패를 빈 목록으로 위장하지 않는다 (운영자가 0건으로 오해)', async () => {
    const { getDocs } = await import('firebase/firestore');
    vi.mocked(getDocs).mockRejectedValueOnce(new Error('permission-denied'));
    await expect(fetchZoneCoursesList()).rejects.toThrow('permission-denied');
  });

  it('status 는 걸지 않는다 — 어드민은 draft·archived 도 봐야 한다', async () => {
    docsToReturn = [seeded('A', '2026-06-20T00:00:00.000Z', { status: 'draft' })];
    const list = await fetchZoneCoursesList();
    expect(constraints.some((c) => c.field === 'status')).toBe(false);
    expect(list[0].status).toBe('draft');
  });
});

describe('fetchPublishedZoneCourses — 손님 화면 (별개 경로 유지)', () => {
  it('city + published 두 동등 조건만 걸고 정렬은 걸지 않는다', async () => {
    docsToReturn = [seeded('A', '2026-06-20T00:00:00.000Z')];
    await fetchPublishedZoneCourses('seoul');
    expect(constraints).toEqual([
      { kind: 'where', field: 'city', op: '==', value: 'seoul' },
      { kind: 'where', field: 'status', op: '==', value: 'published' },
    ]);
  });
});

describe('recencyMs — 정렬 기준 시각', () => {
  it('updatedAt → publishedAt → createdAt → seeded_at 순으로 찾는다', async () => {
    const { Timestamp } = await import('firebase/firestore');
    const t = (iso: string) => new Timestamp(Date.parse(iso));
    expect(recencyMs({ updatedAt: t('2026-07-01T00:00:00Z'), seeded_at: '2026-01-01T00:00:00Z' }))
      .toBe(Date.parse('2026-07-01T00:00:00Z'));
    expect(recencyMs({ publishedAt: t('2026-06-01T00:00:00Z') })).toBe(Date.parse('2026-06-01T00:00:00Z'));
    expect(recencyMs({ seeded_at: '2026-06-15T02:00:22.204Z' })).toBe(Date.parse('2026-06-15T02:00:22.204Z'));
    expect(recencyMs({ verified_at: '2026-06-15' })).toBe(Date.parse('2026-06-15'));
  });

  it('아무 시각도 없거나 이상하면 0', () => {
    expect(recencyMs({})).toBe(0);
    expect(recencyMs({ seeded_at: '날짜아님' })).toBe(0);
    expect(recencyMs({ seeded_at: 12345 })).toBe(0);
  });
});
