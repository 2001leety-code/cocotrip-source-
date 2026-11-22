/**
 * 2026-11-21 개인정보 보관 기간 규칙(api/_shared/privacy-retention.js) — 날짜·칸 찾기.
 * 날짜는 한국(KST) 달력, 기간은 민법처럼(기준일 다음 날부터, 끝 달에 같은 날 없으면 말일) 센다.
 */
import { describe, it, expect } from 'vitest';
import {
  deletableFrom, isDue, kstYmd, validYmd, toMs, tripEndYmd, findKeyPaths, withoutKeysDeep,
  bookingSettled, moodBookingSettled, inquiryClosed, scanCutoffMs, UNKNOWN_END_BUFFER_DAYS,
  planTripEndYmd, sheetDateYmd, kstMonth, monthEndYmd, latestMs, paidPlan, PAID_PLAN_MIN,
  paymentAttemptClosed, cartPaid, disputeClosed, attemptTookNoMoney, freeClaimReceiptObject, findEmailKeyPaths, moodDisputeOpen, moodDisputeEndMs,
} from '../../api/_shared/privacy-retention.js';
import { leadSheetRow } from '../../api/_ai_core/emailNotifier.js';

const MONTH = { months: 1 };
const kst = (iso: string) => Date.parse(`${iso}+09:00`);

class FakeTimestamp { constructor(private ms: number) {} toMillis() { return this.ms; } }

describe('지워도 되는 첫날 (민법식 기간)', () => {
  it.each([
    ['2026-01-10', '2026-02-11'],
    ['2026-01-30', '2026-03-01'], // 시작 1/31 → 2/31 없음 → 2월 말일 끝 → 3/1
    ['2026-01-31', '2026-03-01'],
    ['2027-02-28', '2027-04-01'], // 시작 3/1 → 4/1 전날(3/31) 끝
    ['2026-12-31', '2027-02-01'], // 해 넘김
    ['2028-01-28', '2028-02-29'], // 윤년: 2/29 있음
    ['2027-01-28', '2027-03-01'], // 평년: 2/29 없음
  ])('%s + 1개월 → %s', (base, expected) => {
    expect(deletableFrom(base, MONTH)).toBe(expected);
  });

  it('30일 = 기준일 다음 날부터 30일 지난 다음 날', () => {
    expect(deletableFrom('2026-11-01', { days: 30 })).toBe('2026-12-02');
    expect(deletableFrom('2026-12-15', { days: 30 })).toBe('2027-01-15');
  });

  it('3년 — 윤년 2/29 시작은 평년 3/1', () => {
    expect(deletableFrom('2026-11-21', { years: 3 })).toBe('2029-11-22');
    expect(deletableFrom('2028-02-28', { years: 3 })).toBe('2031-03-01');
  });

  it('날짜가 아니면 null (지우지 않음)', () => {
    for (const bad of ['', '2026-02-30', '2026/01/10', '20260110', null, undefined, 20260110]) {
      expect(deletableFrom(bad as never, MONTH)).toBeNull();
      expect(isDue(bad as never, MONTH, kst('2030-01-01T00:00:00'))).toBe(false);
    }
    expect(deletableFrom('2026-01-10', {})).toBeNull();
  });
});

describe('한국 자정 경계', () => {
  it('2/10 23:59:59 KST 에는 아직, 2/11 00:00:00 KST 부터 지움', () => {
    expect(isDue('2026-01-10', MONTH, kst('2026-02-10T23:59:59'))).toBe(false);
    expect(isDue('2026-01-10', MONTH, kst('2026-02-11T00:00:00'))).toBe(true);
    // 같은 순간을 UTC 로 보면 2/10 15:00 — UTC 날짜로 셌다면 하루 늦거나 빨랐을 것.
    expect(new Date(kst('2026-02-11T00:00:00')).toISOString()).toBe('2026-02-10T15:00:00.000Z');
  });

  it('kstYmd 는 UTC 15:00 에 날짜가 바뀐다', () => {
    expect(kstYmd(Date.parse('2026-03-31T14:59:59Z'))).toBe('2026-03-31');
    expect(kstYmd(Date.parse('2026-03-31T15:00:00Z'))).toBe('2026-04-01');
  });

  it('쿼리 범위(scanCutoffMs)는 지울 것을 하나도 빠뜨리지 않는다', () => {
    const now = kst('2026-03-01T00:00:00');
    // 1개월: 1/31 끝 → 3/1 부터 지움. 그 기준일 시각(1/31 23:59 KST)이 범위 안이어야 한다.
    expect(kst('2026-01-31T23:59:59')).toBeLessThanOrEqual(scanCutoffMs(now, MONTH));
    expect(kst('2026-01-29T23:59:59')).toBeLessThanOrEqual(scanCutoffMs(kst('2026-03-01T00:00:00'), { days: 30 }));
    expect(kst('2023-02-27T23:59:59')).toBeLessThanOrEqual(scanCutoffMs(now, { years: 3 }));
  });
});

describe('여행 끝날', () => {
  it('아는 끝날 중 가장 늦은 날. 끝날이 시작일보다 앞(날짜를 뒤로 옮긴 예약)이면 모르는 것으로 보고 + 14일', () => {
    expect(tripEndYmd('2026-10-01', ['2026-10-03', '', null])).toBe('2026-10-03');
    expect(tripEndYmd('2026-10-01', ['2026-10-01'])).toBe('2026-10-01');
    expect(tripEndYmd('2026-10-05', ['2026-10-03'])).toBe('2026-10-19');
  });
  it('끝날을 모르면 시작일 + 14일 (일찍 지우지 않게)', () => {
    expect(UNKNOWN_END_BUFFER_DAYS).toBe(14);
    expect(tripEndYmd('2026-10-15', [])).toBe('2026-10-29');
    expect(tripEndYmd('', [])).toBeNull();
    expect(tripEndYmd(undefined as never, ['2026-10-03'])).toBe('2026-10-03');
  });
});

describe('toMs', () => {
  it('Timestamp·Date·숫자·ISO 를 읽고 나머지는 null', () => {
    expect(toMs(new FakeTimestamp(5))).toBe(5);
    expect(toMs(new Date(7))).toBe(7);
    expect(toMs(9)).toBe(9);
    expect(toMs('2026-01-01T00:00:00Z')).toBe(Date.parse('2026-01-01T00:00:00Z'));
    for (const bad of [0, -1, NaN, '', 'not a date', null, undefined, {}]) expect(toMs(bad as never)).toBeNull();
  });
});

describe('지울 칸 찾기', () => {
  it('평범한 객체만 내려가고, 배열·Timestamp 안은 건드리지 않는다', () => {
    const data = {
      memo: 'm', keep: 1,
      intent: { body: { memo: 'x', amount: 3, nested: { memo: 'deep' } } },
      lines: [{ memo: 'in array' }],
      createdAt: new FakeTimestamp(1),
    };
    expect(findKeyPaths(data, ['memo'], { maxDepth: 4 })).toEqual([['memo'], ['intent', 'body', 'memo'], ['intent', 'body', 'nested', 'memo']]);
    expect(findKeyPaths(data, ['memo'], { under: ['intent', 'body'], maxDepth: 1 })).toEqual([['intent', 'body', 'memo']]);
    expect(findKeyPaths(data, ['memo'], { under: ['missing'] })).toEqual([]);
    expect(findKeyPaths({ memo: undefined }, ['memo'])).toEqual([]);
  });

  it('withoutKeysDeep 은 Timestamp 같은 특수 값을 그대로(같은 객체) 둔다', () => {
    const ts = new FakeTimestamp(1);
    const out = withoutKeysDeep({ memo: 'x', at: ts, list: [{ memo: 'y', at: ts }], keep: { a: 1, b: undefined } }, ['memo']);
    expect(out).toEqual({ at: ts, list: [{ at: ts }], keep: { a: 1 } });
    expect((out as { at: unknown }).at).toBe(ts);
  });
});

describe('상태 판정', () => {
  it('끝난 예약만 비운다', () => {
    for (const s of ['CONFIRMED', 'confirmed', 'COMPLETED', 'CANCELED', 'cancelled', 'REFUNDED', 'REJECTED']) expect(bookingSettled(s)).toBe(true);
    for (const s of ['REFUND_PENDING', 'REFUND_UNKNOWN', 'REFUND_FAILED', 'CANCELING', 'AWAITING_VERIFICATION', '', undefined]) expect(bookingSettled(s)).toBe(false);
  });
  it('협력사 예약은 정산이 끝나야(completed) 비운다. confirmed = 정산 전, 단 정액(공항)은 정산이 없음', () => {
    expect(moodBookingSettled({ status: 'confirmed' })).toBe(false);
    expect(moodBookingSettled({ status: 'confirmed', serviceType: 'vehicle' })).toBe(false);
    expect(moodBookingSettled({ status: 'confirmed', serviceType: 'airport' })).toBe(true);
    expect(moodBookingSettled({ status: 'completed' })).toBe(true);
    expect(moodBookingSettled({ status: 'cancelled' })).toBe(true);
    expect(moodBookingSettled({ status: 'confirmed', bookingChangeApproval: { status: 'pending' } })).toBe(false);
    expect(moodBookingSettled({ status: 'completed', settlementApproval: { status: 'awaiting_mood' } })).toBe(false);
    expect(moodBookingSettled({ status: 'draft' })).toBe(false);
  });
  it('견적 문의 종료 상태', () => {
    for (const s of ['rejected', 'responded', 'closed', 'converted', 'CLOSED']) expect(inquiryClosed(s)).toBe(true);
    for (const s of ['NEW', 'open', '', undefined]) expect(inquiryClosed(s)).toBe(false);
  });
  it('validYmd', () => {
    expect(validYmd('2028-02-29')).toBe(true);
    expect(validYmd('2027-02-29')).toBe(false);
  });
  it('협력사 정산 다툼(수정 요청)·거둔 정산 제안은 건너뛴다', () => {
    expect(moodBookingSettled({ status: 'completed', settlementApproval: { status: 'changes_requested' } })).toBe(false);
    expect(moodBookingSettled({ status: 'completed', settlementApproval: { status: 'withdrawn' } })).toBe(false);
    expect(moodBookingSettled({ status: 'confirmed', bookingChangeApproval: { status: 'changes_requested' } })).toBe(false);
    expect(moodBookingSettled({ status: 'completed', bookingChangeApproval: { status: 'withdrawn' } })).toBe(true); // 변경 요청 철회 = 끝남
    expect(moodBookingSettled({ status: 'completed', settlementApproval: { status: 'completed' } })).toBe(true);
  });
});

describe('여러 시각 중 가장 늦은 것', () => {
  it('Timestamp·숫자·Date 섞여도, 없으면 null', () => {
    expect(latestMs(new FakeTimestamp(5), 9, undefined, null, new Date(7))).toBe(9);
    expect(latestMs(undefined, null)).toBeNull();
  });
});

describe('돈을 낸 비회원 일정', () => {
  it('안 낸 것 = 테스트·운영자 우회·무료 쿠폰만. 주문 번호가 없거나 출처를 모르면 낸 것으로 봄', () => {
    expect(paidPlan({ paymentSource: 'paypal', input: { paypalOrderId: '5AB' } })).toBe(true);
    expect(paidPlan({ paymentSource: 'manual', input: { paypalOrderId: 'MANUAL-1' } })).toBe(true);
    expect(paidPlan({ input: { paypalOrderId: '5AB' } })).toBe(true); // 예전 일정(결제 출처 칸 없음)
    for (const source of ['test', 'admin-bypass', 'ai-coupon']) expect(paidPlan({ paymentSource: source, input: { paypalOrderId: 'X' } })).toBe(false);
    expect(paidPlan({ paymentSource: 'paypal', isFreeCoupon: true, input: { paypalOrderId: 'X' } })).toBe(false);
    expect(paidPlan({ paymentSource: 'paypal', isAdminBypass: true, input: { paypalOrderId: 'X' } })).toBe(false);
    // 돈 낸 뒤 만들기가 멈춘 문서엔 주문 번호가 없다 → 모르면 낸 것으로 봄(남기는 쪽)
    expect(paidPlan({ status: 'error', paymentSource: 'paypal', input: {} })).toBe(true);
    expect(paidPlan({})).toBe(true);
  });

  it('돈 낸 비회원 일정 180일: 기준일 빼고 세고 한국 자정에 넘어감', () => {
    expect(isDue('2026-06-01', PAID_PLAN_MIN, kst('2026-11-28T23:59:59'))).toBe(false);
    expect(isDue('2026-06-01', PAID_PLAN_MIN, kst('2026-11-29T00:00:00'))).toBe(true);
  });
});

describe('비회원 AI 일정 끝날', () => {
  it('시작일 + 일수 - 1, 일수 모르면 + 14일, 시작일 없으면 null', () => {
    expect(planTripEndYmd({ startDate: '2026-09-29', durationDays: 3 })).toBe('2026-10-01');
    expect(planTripEndYmd({ startDate: '2026-09-29', durationDays: 2 })).toBe('2026-09-30');
    expect(planTripEndYmd({ startDate: '2026-09-29', durationDays: 1 })).toBe('2026-09-29');
    expect(planTripEndYmd({ startDate: '2026-09-29', durationDays: null })).toBe('2026-10-13');
    expect(planTripEndYmd({ startDate: '2026-09-29', durationDays: 'x' })).toBe('2026-10-13');
    expect(planTripEndYmd({ startDate: null, durationDays: 3 })).toBeNull();
    expect(planTripEndYmd(undefined)).toBeNull();
  });
});

describe('구글 시트 날짜 칸', () => {
  it('숫자(1899-12-30 부터 센 날)·글자 날짜·ISO 시각을 한국 날짜로', () => {
    expect(sheetDateYmd(46296)).toBe('2026-10-01');
    expect(sheetDateYmd(46296.75)).toBe('2026-10-01'); // 시각 붙은 날짜
    expect(sheetDateYmd('2026-10-01')).toBe('2026-10-01');
    expect(sheetDateYmd('2026. 10. 1')).toBe('2026-10-01');
    expect(sheetDateYmd('2026. 10. 1. 오후 3:00:00')).toBe('2026-10-01');
    expect(sheetDateYmd('2026/1/5')).toBe('2026-01-05');
    expect(sheetDateYmd('2026-09-30T15:30:00.000Z')).toBe('2026-10-01'); // UTC 15:30 = 한국 다음 날
    for (const bad of ['', '시각', '2026-13-01', 0, -1, null, undefined]) expect(sheetDateYmd(bad as never)).toBeNull();
    // 시각이 붙은 글자는 시간대까지 적힌 ISO 꼴만(서버 시간대로 읽히는 꼴은 모름 = 남김)
    expect(sheetDateYmd('2026-09-30T23:00:00+09:00')).toBe('2026-09-30');
    for (const bad of ['2026-10-01T10:00', '2026-10-01T10:00:00', 'Thu Oct 01 2026', 'Total 3', '2026-10-01T']) expect(sheetDateYmd(bad)).toBeNull();
  });

  it('결제 시도 기록: 끝난 것만 비움(마무리·돈 안 나감·격리는 검토 해결 뒤)', () => {
    expect(paymentAttemptClosed({ finalized: true }, null)).toBe(true);
    expect(paymentAttemptClosed({ captureState: 'not_captured' }, null)).toBe(true);
    for (const lock of [{}, { captureState: 'posted' }, { captureState: 'unknown' }, { bookingDurable: true }, null]) {
      expect(paymentAttemptClosed(lock, null)).toBe(false);
    }
    expect(paymentAttemptClosed({ reviewQuarantined: true, finalized: true }, null)).toBe(false);
    expect(paymentAttemptClosed({ reviewQuarantined: true }, { resolvedAt: null })).toBe(false);
    expect(paymentAttemptClosed({ reviewQuarantined: true }, { resolvedAt: 1 })).toBe(true);
  });

  it('장바구니는 captured 만, 불만·분쟁은 resolved 만 끝난 것', () => {
    expect(cartPaid('captured')).toBe(true);
    for (const s of ['created', 'payment_review', 'paid', '', undefined]) expect(cartPaid(s)).toBe(false);
    expect(disputeClosed('resolved')).toBe(true);
    for (const s of ['open', 'reviewed', 'in_progress', '', undefined]) expect(disputeClosed(s)).toBe(false);
  });
  it('달·말일', () => {
    expect(kstMonth(Date.parse('2026-10-31T15:00:00Z'))).toBe('2026-11');
    expect(monthEndYmd('2026-02')).toBe('2026-02-28');
    expect(monthEndYmd('2028-02')).toBe('2028-02-29');
    expect(monthEndYmd('2026-12')).toBe('2026-12-31');
    expect(monthEndYmd('2026-13')).toBeNull();
  });
});

describe('Leads 새 줄 = 동향만', () => {
  it('이메일·이름·일정 번호 없이, 시각은 한국 달', () => {
    expect(leadSheetRow({ area: 'Seoul', styles: ['food', 'cafe'], pax: 2 }, Date.parse('2026-10-31T15:00:00Z')))
      .toEqual(['2026-11', '', '', 'Seoul', 'food, cafe', 2, '']);
    expect(leadSheetRow({ area: undefined, styles: undefined, pax: undefined } as never, Date.parse('2026-10-01T00:00:00Z')))
      .toEqual(['2026-10', '', '', '', '', '', '']);
  });
});

describe('운영자 11/22 — 결제 전 장바구니·무료 신청 영수증', () => {
  it('결제 시도가 돈을 안 가져간 것이 확실할 때만 true', () => {
    expect(attemptTookNoMoney({ captureState: 'not_captured' })).toBe(true);
    for (const lock of [{}, { captureState: 'none' }, { captureState: 'posted' }, { captureState: 'unknown' }, { captureState: 'captured' },
      { status: 'pending' }, { captureState: 'not_captured', captureID: 'C' }, { captureState: 'not_captured', captureVerified: { ok: true } },
      { captureState: 'not_captured', reviewQuarantined: true }]) expect(attemptTookNoMoney(lock)).toBe(false);
  });

  it('영수증 URL: 우리 버킷 free_claims/{slug}/파일 만', () => {
    const buckets = new Set(['proj.firebasestorage.app']);
    const url = (bucket: string, path: string) => `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=t`;
    expect(freeClaimReceiptObject(url('proj.firebasestorage.app', 'free_claims/a_b/r 1.pdf'), buckets))
      .toEqual({ bucket: 'proj.firebasestorage.app', path: 'free_claims/a_b/r 1.pdf' });
    for (const bad of [
      url('other.appspot.com', 'free_claims/a/r.pdf'), // 남의 버킷
      url('proj.firebasestorage.app', 'community/u/r.jpg'), // 다른 경로
      url('proj.firebasestorage.app', 'free_claims/r.pdf'), // slug 없음
      url('proj.firebasestorage.app', 'free_claims/../reviews/r.jpg'),
      'https://firebasestorage.googleapis.com/v0/b/proj.firebasestorage.app/o/free_claims/a/r.pdf', // 인코딩 안 된 꼴
      'http://firebasestorage.googleapis.com/v0/b/proj.firebasestorage.app/o/free_claims%2Fa%2Fr.pdf',
      'https://evil.test/v0/b/proj.firebasestorage.app/o/free_claims%2Fa%2Fr.pdf',
      'https://firebasestorage.googleapis.com/v0/b/proj.firebasestorage.app/o/free_claims%2Fa%2F%E0%A4%A',
      'free_claims/a/r.pdf', '', null, undefined,
    ]) expect(freeClaimReceiptObject(bad, buckets)).toBeNull();
    expect(freeClaimReceiptObject(url('proj.firebasestorage.app', 'free_claims/a/r.pdf'), new Set())).toBeNull();
  });
});

describe('직원 이메일 칸 찾기 (운영자 11/22)', () => {
  it('email·…Email·…Emails 를 사본 안까지 찾고 다른 칸은 안 건드림', () => {
    expect(findEmailKeyPaths({
      clientId: 'c', actorEmail: 'a', settlementApproverEmails: ['x'], emailVerified: true, mailbox: 'm',
      before: { updatedByEmail: 'u', approval: { approvedByEmail: 'p', status: 'ok' } }, lines: [{ email: 'in-array' }],
    })).toEqual([['actorEmail'], ['settlementApproverEmails'], ['before', 'updatedByEmail'], ['before', 'approval', 'approvedByEmail']]);
    expect(findEmailKeyPaths({ clientId: 'c', email: 'e' })).toEqual([['email']]);
    expect(findEmailKeyPaths({})).toEqual([]);
  });
});

describe('협력사 다툼 처리 중·끝난 시각 (운영자 11/22)', () => {
  it('승인 대기·수정 요청·정산 철회 = 처리 중, 승인·변경 철회 = 끝', () => {
    expect(moodDisputeOpen({ settlementApproval: { status: 'changes_requested' } })).toBe(true);
    expect(moodDisputeOpen({ settlementApproval: { status: 'withdrawn' } })).toBe(true);
    expect(moodDisputeOpen({ bookingChangeApproval: { status: 'Awaiting_Mood' } })).toBe(true);
    expect(moodDisputeOpen({ bookingChangeApproval: { status: 'withdrawn' } })).toBe(false);
    expect(moodDisputeOpen({ settlementApproval: { status: 'approved' } })).toBe(false);
    expect(moodDisputeOpen({})).toBe(false);
  });
  it('끝난 시각 = 승인·철회·예약 수정 중 가장 늦은 것, 승인 기록 없으면 undefined, 시각 모르면 null', () => {
    expect(moodDisputeEndMs({ status: 'completed' })).toBeUndefined();
    expect(moodDisputeEndMs({ bookingChangeApproval: { status: 'approved' } })).toBeNull();
    expect(moodDisputeEndMs({ bookingChangeApproval: { status: 'withdrawn', withdrawnAt: 5 }, settlementApproval: { approvedAt: 9 }, updatedAt: 7 })).toBe(9);
    expect(moodDisputeEndMs({ settlementApproval: { approvedAt: 3 }, updatedAt: new Date(20) })).toBe(20);
  });
});
