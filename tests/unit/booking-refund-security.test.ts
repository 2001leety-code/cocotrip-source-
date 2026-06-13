/* eslint-disable @typescript-eslint/no-explicit-any -- 핸들러/Firestore 모킹 스캐폴딩(auth-idor-pr418 패턴). */
/**
 * 예약/환불 보안 회귀 (2026-06-12 예약/배차 버그헌트).
 *   1. cancelBooking: body.tier 신뢰 종료 — 서버 users/{uid}.tier 만 사용(Platinum 위조 환불 IDOR 차단)
 *   2. modifyBooking: 가격영향 필드(paxCount/pickup/dropoff/tourDate) 제외 — 무료 업그레이드 차단
 *   3. modifyBooking: status='MODIFIED' 로 안 덮음 — 수정 후에도 취소·재수정 가능
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const cancelSrc = readFileSync(resolve(process.cwd(), 'api/cancelBooking.js'), 'utf8');
const modifySrc = readFileSync(resolve(process.cwd(), 'api/modifyBooking.js'), 'utf8');
const adminBookingSrc = readFileSync(resolve(process.cwd(), 'api/admin-booking-action.js'), 'utf8');

// ── 소스 가드 (보안 속성 박제) ──────────────────────────────────────────────
describe('cancelBooking — tier IDOR 차단 (소스 가드)', () => {
  it('body 에서 tier 를 destructure 하지 않음', () => {
    expect(cancelSrc).not.toMatch(/const\s*\{[^}]*\btier\b[^}]*\}\s*=\s*body/);
  });
  it('서버측 tier 를 users/{auth.uid} 에서 조회', () => {
    expect(cancelSrc).toMatch(/collection\('users'\)\.doc\(auth\.uid\)/);
    expect(cancelSrc).toMatch(/let tier = 'Bronze'/);
  });
});
describe('modifyBooking — 무료 업그레이드 + 상태락 차단 (소스 가드)', () => {
  it('ALLOWED_FIELDS 에 가격영향 필드 없음 (memo·airport 만)', () => {
    expect(modifySrc).toMatch(/ALLOWED_FIELDS\s*=\s*\['memo',\s*'airport'\]/);
    expect(modifySrc).not.toMatch(/ALLOWED_FIELDS\s*=\s*\[[^\]]*paxCount/);
  });
  it("status: 'MODIFIED' 로 덮지 않음", () => {
    expect(modifySrc).not.toMatch(/status:\s*'MODIFIED'/);
  });
  it('body 에서 tier 를 destructure 하지 않음', () => {
    expect(modifySrc).not.toMatch(/const\s*\{[^}]*\btier\b[^}]*\}\s*=\s*body/);
  });
});

describe('admin-booking-action mark-refunded — 과환불 가드 (소스 가드, 2026-06-13)', () => {
  it('환불액 > 원금 → REFUND_EXCEEDS_ORIGINAL 차단 (silent 전액환불 폴백 방지)', () => {
    // 버그: refundedKRW>originalKRW 면 refundKrw<originalKRW 가 false → refundUSD=null →
    //   refundPaypalCapture 가 부분 의도임에도 전액 환불. 가드로 차단.
    expect(adminBookingSrc).toMatch(/refundKrw\s*>\s*originalKRW/);
    expect(adminBookingSrc).toContain('REFUND_EXCEEDS_ORIGINAL');
  });
  it('원금 정보 부재 + 부분환불 명시 → REFUND_ORIGINAL_UNKNOWN 차단', () => {
    expect(adminBookingSrc).toMatch(/originalKRW\s*<=\s*0\s*&&\s*refundedKRW\s*!=\s*null/);
    expect(adminBookingSrc).toContain('REFUND_ORIGINAL_UNKNOWN');
  });
  it('originalKRW 가 refundPaypalCapture 호출 전(captureID 분기 전)에 1회 계산 (hoist)', () => {
    const idxOrig = adminBookingSrc.indexOf('const originalKRW =');
    const idxRefund = adminBookingSrc.indexOf('refundPaypalCapture({');
    expect(idxOrig).toBeGreaterThan(-1);
    expect(idxRefund).toBeGreaterThan(-1);
    expect(idxOrig).toBeLessThan(idxRefund);
    // 중복 선언 없음 (hoist 후 captureID 블록 내 재선언 제거)
    expect(adminBookingSrc.split('const originalKRW =').length - 1).toBe(1);
  });
});

// ── modifyBooking 행동 테스트 ────────────────────────────────────────────────
const verifyUserTokenMock = vi.fn();
vi.mock('../../api/_shared/user-auth.js', () => ({ verifyUserToken: verifyUserTokenMock, default: verifyUserTokenMock }));
const updateMock = vi.fn(async () => undefined);
let bookingData: any;
vi.mock('../../api/_shared/firebase-admin.js', () => ({
  initAdminDb: () => ({
    collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => bookingData }), update: (...a: any[]) => updateMock(...a) }) }),
  }),
}));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: vi.fn() }));

function makeRes(): any {
  const res: any = { statusCode: undefined, body: '', writeHead(s: number) { res.statusCode = s; return res; }, end(s?: string) { if (s != null) res.body = s; return res; } };
  return res;
}
function req(body: object) { return { method: 'POST', url: '/api/modifyBooking', headers: { host: 'unit.test' }, body }; }

describe('modifyBooking — 행동 (가격필드 거부 / 상태 유지)', () => {
  beforeEach(() => {
    verifyUserTokenMock.mockReset();
    updateMock.mockReset(); updateMock.mockResolvedValue(undefined);
    bookingData = { userEmail: 'a@b.com', status: 'CONFIRMED', tourDate: '2099-12-31', tourTime: '10:00', paxCount: 1, memo: 'old' };
  });

  it('paxCount 변경 시도 → 400 NO_CHANGES (가격필드 필터됨)', async () => {
    verifyUserTokenMock.mockResolvedValueOnce({ ok: true, email: 'a@b.com', uid: 'u1' });
    const handler = (await import('../../api/modifyBooking.js')).default;
    const res = makeRes();
    await handler(req({ bookingID: 'b1', changes: { paxCount: 7 } }) as any, res as any);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe('NO_CHANGES');
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('memo 변경 → 적용 + status CONFIRMED 유지 (MODIFIED 로 안 덮음)', async () => {
    verifyUserTokenMock.mockResolvedValueOnce({ ok: true, email: 'a@b.com', uid: 'u1' });
    const handler = (await import('../../api/modifyBooking.js')).default;
    const res = makeRes();
    await handler(req({ bookingID: 'b1', changes: { memo: 'new note' } }) as any, res as any);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.status).toBe('CONFIRMED');
    const payload = updateMock.mock.calls[0][0];
    expect(payload.memo).toBe('new note');
    expect(payload.status).toBeUndefined(); // status 안 건드림
  });
});
