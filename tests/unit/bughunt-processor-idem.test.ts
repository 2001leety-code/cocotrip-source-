/**
 * 버그 #17 — booking-processor 멱등 마커 비원자 read-then-write → 동시 트리거 중복 (MEDIUM)
 *
 * Pre-fix (회귀 대상):
 *   api/booking-processor.js 는 시작 시 bookings/{orderID} 를 1회 get 하여
 *   stepGuards(skipSheets/skipVoucher/skipLoyalty) 를 계산하고(check), 각 부수효과를
 *   실행한 뒤(do) setBookingMarker(merge set)로 마커를 기록(mark)했다.
 *
 *   이 'check → do → mark' 는 순차 retry 만 막는다. 두 인스턴스가 동시에 도는 경우
 *   (cart fan-out + retry-sweep, 또는 capture 트리거가 25s timeout 후 원본이 계속
 *   도는 중 retry-sweep 재발화) 둘 다 시작 시점에 '마커 없음' 을 읽어:
 *     - Google Sheets append 2회 → 중복 row
 *     - 확인 이메일 2회 → 고객에게 중복 메일
 *     - 로열티 적립 2회 → 중복 포인트
 *
 * Post-fix:
 *   각 부수효과 진입 전에 해당 마커를 db.runTransaction 으로 원자 선점(CAS):
 *     트랜잭션이 bookings 문서를 읽어 마커가 없으면 마커를 set 하고 'claimed=true'
 *     (= 내가 선점) 반환, 있으면 'claimed=false' (= 이미 처리됨) 반환.
 *     선점에 성공한 단 하나의 호출만 실제 append/email/loyalty 를 실행한다.
 *   트랜잭션은 read + set 만 수행(외부 I/O 금지) — append/email/loyalty 는 트랜잭션
 *   밖에서. 선점 후 단계가 실패하면 releaseBookingStep 으로 마커를 풀어 retry 가
 *   재실행하도록 한다(기존 '성공한 단계만 마커' 의미 유지).
 *
 * 이 테스트는 (1) CAS 선점/해제 의미 + 동시성 불변식(승자 정확히 1명)을 순수
 * 시뮬레이션으로 검증하고, (2) booking-processor.js 소스가 그 패턴으로 배선됐는지
 * (claimBookingStep/runTransaction/release-on-failure, 구 check-then-mark 부재)
 * 구조 단언으로 회귀 가드한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const procSrc = readFileSync(
  resolve(process.cwd(), 'api/booking-processor.js'),
  'utf8',
);

// ── (1) CAS 선점/해제 의미를 모사하는 최소 인메모리 Firestore 트랜잭션 ──
// booking-processor 의 claimBookingStep 와 동일한 read→absent?→set→true / present→false
// 의미를 구현. runTransaction 직렬화로 동시 호출 시 승자 정확히 1명을 보장한다.
function makeFakeDb() {
  const doc: Record<string, unknown> = {};
  let txLock: Promise<unknown> = Promise.resolve();
  return {
    doc,
    // 트랜잭션을 직렬화 (Firestore 의 낙관적 동시성 == 충돌 시 재시도 → 최종 직렬 효과).
    runTransaction(fn: (tx: { get: () => typeof doc; set: (patch: Record<string, unknown>) => void }) => boolean) {
      const run = txLock.then(() => {
        const tx = {
          get: () => doc,
          set: (patch: Record<string, unknown>) => {
            Object.assign(doc, patch);
          },
        };
        return fn(tx);
      });
      txLock = run.catch(() => {});
      return run;
    },
  };
}

// claimBookingStep 의 트랜잭션 콜백 의미를 그대로 모사.
async function claimStep(db: ReturnType<typeof makeFakeDb>, field: string): Promise<boolean> {
  return db.runTransaction((tx) => {
    const data = tx.get();
    if (data[field]) return false; // 이미 처리/선점됨
    tx.set({ [field]: 'SERVER_TS' }); // 마커 선점
    return true;
  });
}

// releaseBookingStep 의미: 마커 삭제.
function releaseStep(db: ReturnType<typeof makeFakeDb>, field: string): void {
  delete db.doc[field];
}

describe('버그 #17 — CAS 선점 의미 (단위 시뮬레이션)', () => {
  it('마커 없으면 선점 성공 + 마커 박힘', async () => {
    const db = makeFakeDb();
    const claimed = await claimStep(db, 'sheetsAppendedAt');
    expect(claimed).toBe(true);
    expect(db.doc.sheetsAppendedAt).toBeTruthy();
  });

  it('마커 이미 있으면 선점 실패 (스킵) — 두 번째 호출은 do 를 안 함', async () => {
    const db = makeFakeDb();
    const first = await claimStep(db, 'voucherSentAt');
    const second = await claimStep(db, 'voucherSentAt');
    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it('동시 호출 N개 — 정확히 1명만 선점 (중복 부수효과 방지의 핵심)', async () => {
    const db = makeFakeDb();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => claimStep(db, 'loyaltyEarnedAt')),
    );
    const winners = results.filter(Boolean).length;
    expect(winners).toBe(1); // pre-fix 였다면 N명 전부 true → N회 중복
    expect(db.doc.loyaltyEarnedAt).toBeTruthy();
  });

  it('선점 후 단계 실패 → release 하면 retry 가 재선점 가능 (성공한 단계만 마커)', async () => {
    const db = makeFakeDb();
    const claimed = await claimStep(db, 'loyaltyEarnedAt');
    expect(claimed).toBe(true);
    // earn 실패 시뮬 → 마커 해제
    releaseStep(db, 'loyaltyEarnedAt');
    expect(db.doc.loyaltyEarnedAt).toBeUndefined();
    // retry 는 다시 선점 성공해야 함 (포인트 누락 방지)
    const retry = await claimStep(db, 'loyaltyEarnedAt');
    expect(retry).toBe(true);
  });

  it('서로 다른 단계 마커는 독립 — 한 단계 선점이 다른 단계를 막지 않음', async () => {
    const db = makeFakeDb();
    expect(await claimStep(db, 'sheetsAppendedAt')).toBe(true);
    expect(await claimStep(db, 'voucherSentAt')).toBe(true);
    expect(await claimStep(db, 'loyaltyEarnedAt')).toBe(true);
  });
});

describe('버그 #17 — booking-processor 가 원자 선점 패턴으로 배선됨 (소스 구조)', () => {
  it('claimBookingStep 헬퍼를 db.runTransaction 으로 구현', () => {
    expect(procSrc).toMatch(/async function claimBookingStep\s*\(/);
    expect(procSrc).toMatch(/db\.runTransaction\s*\(/);
  });

  it('트랜잭션 콜백은 read+set 만 — 외부 I/O(fetch/append/sendBookingConfirmation) 금지', () => {
    // 주석이 아닌 실제 호출 `db.runTransaction(` 위치를 잡는다.
    const start = procSrc.indexOf('db.runTransaction(');
    expect(start).toBeGreaterThan(-1);
    // 트랜잭션 콜백 본문(대략 범위)에 외부 I/O 호출이 없어야 한다.
    const txBlock = procSrc.slice(start, start + 600);
    expect(txBlock).toMatch(/tx\.get\(/);
    expect(txBlock).toMatch(/tx\.set\(/);
    expect(txBlock).not.toMatch(/appendBooking\(/);
    expect(txBlock).not.toMatch(/sendBookingConfirmation\(/);
    expect(txBlock).not.toMatch(/fetch\(/);
  });

  it('releaseBookingStep 으로 실패 단계 마커를 FieldValue.delete() 로 해제', () => {
    expect(procSrc).toMatch(/async function releaseBookingStep\s*\(/);
    expect(procSrc).toMatch(/FieldValue\.delete\(\)/);
  });

  it('Sheets append 는 진입 전 선점, 실패 시 release', () => {
    expect(procSrc).toMatch(/claimBookingStep\(\s*orderID\s*,\s*BOOKING_STEP_MARKERS\.sheets\s*\)/);
    // append 실패 catch 에서 sheets 마커 release
    const appendIdx = procSrc.indexOf('appendBooking(booking)');
    expect(appendIdx).toBeGreaterThan(-1);
    const block = procSrc.slice(appendIdx, appendIdx + 800);
    expect(block).toMatch(/releaseBookingStep\(\s*orderID\s*,\s*BOOKING_STEP_MARKERS\.sheets\s*\)/);
  });

  it('확인 이메일은 진입 전 선점, 발송 실패 시 release', () => {
    expect(procSrc).toMatch(/claimBookingStep\(\s*orderID\s*,\s*BOOKING_STEP_MARKERS\.voucher\s*\)/);
    const sendIdx = procSrc.indexOf('sendBookingConfirmation(');
    expect(sendIdx).toBeGreaterThan(-1);
    const block = procSrc.slice(sendIdx, sendIdx + 600);
    expect(block).toMatch(/releaseBookingStep\(\s*orderID\s*,\s*BOOKING_STEP_MARKERS\.voucher\s*\)/);
  });

  it('로열티 적립은 earn 호출 전 선점, 실패(non-2xx/예외) 시 release', () => {
    expect(procSrc).toMatch(/claimBookingStep\(\s*orderID\s*,\s*BOOKING_STEP_MARKERS\.loyalty\s*\)/);
    const loyaltyIdx = procSrc.indexOf('/api/loyalty');
    expect(loyaltyIdx).toBeGreaterThan(-1);
    // release 는 earn fetch 의 finally 블록(아래쪽)에 위치 — 충분히 넓은 윈도우로 캡처.
    const block = procSrc.slice(loyaltyIdx - 400, loyaltyIdx + 1600);
    expect(block).toMatch(/releaseBookingStep\(\s*orderID\s*,\s*BOOKING_STEP_MARKERS\.loyalty\s*\)/);
  });

  it('회귀 가드: 구 비원자 setBookingMarker 헬퍼는 제거됨 (호출/정의 부재)', () => {
    // 선점이 트랜잭션 안에서 마커를 박으므로 별도 setBookingMarker 정의/호출이 없어야 한다.
    expect(procSrc).not.toMatch(/async function setBookingMarker\s*\(/);
    expect(procSrc).not.toMatch(/await\s+setBookingMarker\(/);
  });

  it('회귀 가드: claim 은 || / 명시 분기로 안전 기본 처리 (nullish 사용 금지 규칙 준수)', () => {
    const claimStart = procSrc.indexOf('async function claimBookingStep');
    const claimEnd = procSrc.indexOf('async function releaseBookingStep');
    expect(claimStart).toBeGreaterThan(-1);
    expect(claimEnd).toBeGreaterThan(claimStart);
    const claimBody = procSrc.slice(claimStart, claimEnd);
    // 프로젝트 규칙: nullish-coalescing 금지 → || 사용.
    expect(claimBody).not.toMatch(/\?\?/);
  });
});
