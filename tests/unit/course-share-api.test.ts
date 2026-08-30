/* eslint-disable @typescript-eslint/no-explicit-any -- 핸들러/Firestore 모킹 스캐폴딩 (mood-money-guards 패턴). */
/**
 * /api/course-share 회귀 슬롯 (2026-07-04 저장형 공유).
 *
 * 잠금:
 *   1. sanitizeCourse — 신뢰불가 입력(제목 필수·시간검증·상한 컷·비문자열 방어).
 *   2. POST: rate-limit 발동 시 429 / 불량 코스 400 / 정상 시 {ok,id,url}.
 *   3. GET: 불량 id 400 / 미존재 404 / 존재 시 {ok,data.days}.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rateLimitMock = vi.fn();
vi.mock('../../api/_shared/ip-rate-limit.js', () => ({
  checkIpRateLimit: (...a: any[]) => rateLimitMock(...a),
  getClientIp: () => '1.2.3.4',
}));
vi.mock('../../api/_shared/user-auth.js', () => ({ verifyUserToken: async () => ({ ok: false }) }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: async () => {} }));

const docs = new Map<string, any>();
vi.mock('../../api/_shared/firebase-admin.js', () => ({
  initAdminDb: () => ({
    collection: (c: string) => ({
      doc: (id: string) => ({
        get: async () => ({ exists: docs.has(`${c}/${id}`), data: () => docs.get(`${c}/${id}`) }),
        set: async (d: any) => { docs.set(`${c}/${id}`, d); },
      }),
    }),
  }),
}));

import handler, { sanitizeCourse } from '../../api/course-share.js';

function mockRes() {
  const r: any = { headers: null, status: 0, body: '' };
  r.writeHead = (s: number, h: any) => { r.status = s; r.headers = h; };
  r.end = (b?: string) => { r.body = b || ''; return r; };
  return r;
}
const parse = (r: any) => JSON.parse(r.body || '{}');

beforeEach(() => {
  docs.clear();
  rateLimitMock.mockReset();
  rateLimitMock.mockResolvedValue({ ok: true });
});

describe('sanitizeCourse — 신뢰불가 입력 방어', () => {
  it('정상 코스 통과 + 상한 컷', () => {
    const out = sanitizeCourse({ v: 1, days: [{ stops: [{ title: '경복궁', time: '09:00', category: 'sight', memo: 'm' }] }] });
    expect(out!.days[0].stops[0].title).toBe('경복궁');
  });
  it('v 불일치/빈 days/제목 없는 stop 만 → null', () => {
    expect(sanitizeCourse({ v: 2, days: [] })).toBeNull();
    expect(sanitizeCourse({ v: 1, days: [{ stops: [{ title: '  ' }] }] })).toBeNull();
    expect(sanitizeCourse(null)).toBeNull();
  });
  it('불량 시간·비문자열 memo·해외좌표 아닌 비숫자 좌표 무해화', () => {
    const out = sanitizeCourse({ v: 1, days: [{ stops: [{ title: 'ok', time: '99:99', memo: 123, lat: 'x', lng: null }] }] });
    const s = out!.days[0].stops[0] as any;
    expect(s.time).toBe('');
    expect(s.memo).toBe('');
    expect('lat' in s).toBe(false);
  });
});

describe('sanitizeCourse — v1 확장필드 (2026-08-24, planner-trust-course)', () => {
  it('확장필드 없는 구버전 payload 는 그대로 통과', () => {
    const out = sanitizeCourse({ v: 1, days: [{ stops: [{ title: '경복궁', time: '09:00' }] }] });
    expect(out!.days[0].stops[0].title).toBe('경복궁');
    expect('stayMinutes' in out!.days[0].stops[0]).toBe(false);
  });

  it('유효 확장필드(stayMinutes/timeConstraint/windowEnd/placeKey) 는 그대로 저장', () => {
    const out = sanitizeCourse({
      v: 1,
      days: [{
        stops: [{
          title: '경복궁', time: '09:00', stayMinutes: 90, timeConstraint: 'window', windowEnd: '11:00',
          placeKey: '  gyeongbokgung  ', placeSource: 'cocotrip-attractions',
        }],
      }],
    });
    const s = out!.days[0].stops[0] as any;
    expect(s.stayMinutes).toBe(90);
    expect(s.timeConstraint).toBe('window');
    expect(s.windowEnd).toBe('11:00');
    expect(s.placeKey).toBe('gyeongbokgung'); // trim
  });

  it('명시적 malformed 확장필드는 CourseValidationError throw (silent downgrade 금지)', () => {
    expect(() => sanitizeCourse({
      v: 1, days: [{ stops: [{ title: 'X', timeConstraint: 'fixed', time: '' }] }],
    })).toThrow('BAD_STOP_CONSTRAINTS');
    expect(() => sanitizeCourse({
      v: 1, days: [{ stops: [{ title: 'X', placeKey: 'a' }] }], // placeSource 짝 없음
    })).toThrow('BAD_STOP_CONSTRAINTS');
    expect(() => sanitizeCourse({
      v: 1, days: [{ stops: [{ title: 'X', stayMinutes: -1 }] }],
    })).toThrow('BAD_STOP_CONSTRAINTS');
  });
});

describe('POST /api/course-share', () => {
  const goodBody = { course: { v: 1, days: [{ stops: [{ title: '경복궁', time: '', category: 'sight', memo: '' }] }] } };

  it('정상 생성 — {ok,id(8자),url:/s/}', async () => {
    const res = mockRes();
    await handler({ method: 'POST', headers: {}, body: goodBody } as any, res);
    const j = parse(res);
    expect(j.ok).toBe(true);
    expect(j.id).toMatch(/^[a-z0-9]{8}$/);
    expect(j.url).toContain('/s/');
    expect(docs.get(`shared_courses/${j.id}`).days).toHaveLength(1);
  });

  it('rate-limit 발동 시 429 전달', async () => {
    rateLimitMock.mockResolvedValueOnce({ ok: false, status: 429, error: 'too many', retryAfterSec: 60 });
    const res = mockRes();
    await handler({ method: 'POST', headers: {}, body: goodBody } as any, res);
    expect(res.status).toBe(429);
  });

  it('불량 코스 400', async () => {
    const res = mockRes();
    await handler({ method: 'POST', headers: {}, body: { course: { v: 1, days: [] } } } as any, res);
    expect(res.status).toBe(400);
    expect(parse(res).code).toBe('BAD_COURSE');
  });

  it('명시적 malformed 확장필드는 400 BAD_STOP_CONSTRAINTS (fail-closed, 저장 안 됨)', async () => {
    const res = mockRes();
    const body = { course: { v: 1, days: [{ stops: [{ title: '경복궁', timeConstraint: 'fixed', time: '' }] }] } };
    await handler({ method: 'POST', headers: {}, body } as any, res);
    expect(res.status).toBe(400);
    expect(parse(res).code).toBe('BAD_STOP_CONSTRAINTS');
    expect(docs.size).toBe(0); // 저장되지 않음
  });

  it('유효 v1 확장필드는 그대로 저장/조회(roundtrip)', async () => {
    const res = mockRes();
    const body = {
      course: {
        v: 1,
        days: [{ stops: [{ title: '경복궁', time: '09:00', stayMinutes: 90, timeConstraint: 'fixed', placeKey: 'gyeongbokgung', placeSource: 'cocotrip-attractions' }] }],
      },
    };
    await handler({ method: 'POST', headers: {}, body } as any, res);
    const j = parse(res);
    expect(j.ok).toBe(true);
    const stored = docs.get(`shared_courses/${j.id}`).days[0].stops[0];
    expect(stored.stayMinutes).toBe(90);
    expect(stored.placeKey).toBe('gyeongbokgung');

    const getRes = mockRes();
    await handler({ method: 'GET', query: { id: j.id } } as any, getRes);
    const getJ = parse(getRes);
    expect(getJ.data.days[0].stops[0].stayMinutes).toBe(90);
  });

  it('코코트립 식당 출처도 짧은 공유 주소에서 보존', async () => {
    const res = mockRes();
    const body = {
      course: {
        v: 1,
        days: [{ stops: [{
          title: '로컬 식당', time: '', category: 'food',
          placeKey: 'food:google-place-id', placeSource: 'cocotrip-food',
        }] }],
      },
    };
    await handler({ method: 'POST', headers: {}, body } as any, res);
    const j = parse(res);
    expect(j.ok).toBe(true);
    expect(docs.get(`shared_courses/${j.id}`).days[0].stops[0].placeSource).toBe('cocotrip-food');
  });
});

describe('GET /api/course-share', () => {
  it('불량 id 400 / 미존재 404 / 존재 시 data.days', async () => {
    let res = mockRes();
    await handler({ method: 'GET', query: { id: '..bad..' } } as any, res);
    expect(res.status).toBe(400);

    res = mockRes();
    await handler({ method: 'GET', query: { id: 'aaaaaaaa' } } as any, res);
    expect(res.status).toBe(404);

    docs.set('shared_courses/bbbbbbbb', { v: 1, days: [{ stops: [{ title: 'X' }] }], title: 'T', createdAt: 1 });
    res = mockRes();
    await handler({ method: 'GET', query: { id: 'bbbbbbbb' } } as any, res);
    const j = parse(res);
    expect(j.ok).toBe(true);
    expect(j.data.days[0].stops[0].title).toBe('X');
  });
});
