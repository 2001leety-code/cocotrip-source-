/**
 * 회귀 잠금 (2026-07-29) — 원장 멱등 키 · 누적 환불 · 2단계 완료 처리.
 *
 * 1) 원장 문서 ID
 *    이전엔 bookingRef(CT-YYYYMMDD-XXX)를 멱등 키로 썼다. 이 번호는 booking-processor 가
 *    호출마다 새로 만들 수 있어(externalBookingRef 미전달 시 generateBookingRef()),
 *    같은 결제를 재처리하면 다른 문서 ID → **이중 적립**이 뚫린다.
 *    PayPal orderID 는 결제 1건에 영구 고정이므로 그것으로 고정한다.
 *
 * 2) 환불 판정
 *    한 번에 다 안 돌려주고 $5 + $4.90 처럼 쪼개면, 이번 이벤트 금액만 보고는
 *    영원히 PARTIALLY_REFUNDED 로 남는다 → 누적액으로 판정한다.
 *
 * 3) 2단계 완료 처리
 *    이전엔 작업 **전에** 마커를 박고(선점) 실패 시 지웠다. 선점과 해제 사이에 함수가
 *    죽으면(타임아웃·콜드스타트 종료) 마커가 남아 retry 가 **영원히 스킵**했다.
 *    시트 row 도 메일도 안 나갔는데 "완료"로 보였다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  bookingStepGuards, isStepCompleted, stepStateField, STEP_CLAIM_STALE_MS,
} from '../../api/_shared/booking-idempotency.js';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const codeOf = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

describe('원장 멱등 키 = PayPal orderID', () => {
  it('booking-processor 가 orderID 를 ledgerKey 로 넘긴다', () => {
    expect(codeOf('api/booking-processor.js')).toContain('ledgerKey: orderID');
  });

  it('loyalty 가 ledgerKey 로 문서 ID 를 만든다 (CT 번호 아님)', () => {
    const code = codeOf('api/loyalty.js');
    expect(code).toContain('const idemSource = ledgerKey || bookingRef');
    expect(code).toContain('`earn_${String(idemSource)');
  });

  it('원장 항목에 키와 capture 가 남는다 (대사 가능)', () => {
    const code = codeOf('api/loyalty.js');
    expect(code).toContain('ledgerKey: idemSource || null');
    expect(code).toContain('captureId: captureId || null');
  });
});

describe('환불 판정 — 누적액 기준', () => {
  // 2026-07-29: 판정+누적+쓰기가 api/_shared/refund-ledger.js 의 단일 transaction 으로 이동.
  //   행위(동시 부분환불·중복 이벤트·실패 주입) 검증은 refund-ledger-race.test.ts 담당.
  const code = codeOf('api/_shared/refund-ledger.js');

  it('이번 환불액에 기존 누계를 더해 판정한다', () => {
    expect(code).toContain('cumulativeRefundedUSD');
    expect(code).toMatch(/round2\(cumulativeRefundedUSD\)\s*<\s*Number\(originalUSD\)\s*\*\s*FULL_REFUND_RATIO/);
  });

  it('누계를 예약 문서에 남겨 다음 이벤트가 이어받는다', () => {
    expect(code).toContain('refundedUSDTotal: cumulativeRefundedUSD');
    expect(code).toContain('refundedUSDTotal) || 0');
  });

  it('누계 읽기와 쓰기가 같은 transaction 안에 있다 (갱신 유실 차단)', () => {
    const txStart = code.indexOf('db.runTransaction(');
    expect(txStart).toBeGreaterThan(-1);
    const tx = code.slice(txStart);
    expect(tx).toContain('refundedUSDTotal');           // 읽기
    expect(tx).toContain('tx.set(logRef');              // 이벤트 완료 기록
    expect(tx).toContain('tx.set(bookingDocRef');       // 예약 갱신
    expect(tx).toContain('tx.set(pendingDocRef');       // 대기예약 갱신
  });

  it('같은 환불(refundId)은 다른 eventId 로 와도 두 번 세지 않는다', () => {
    expect(code).toContain('refundEvents');
    expect(code).toMatch(/function alreadyCounted/);
  });

  it('환율은 판정에 개입하지 않는다', () => {
    expect(code).not.toMatch(/isPartialRefund\s*=\s*priceKRW\s*>\s*0\s*&&\s*refundedKRW/);
  });
});

describe('2단계 완료 처리 — 선점 != 완료', () => {
  it('완료로 표시된 것만 스킵한다', () => {
    expect(bookingStepGuards({ sheetsAppendedAtState: 'completed' }).skipSheets).toBe(true);
    // 선점만 된 상태(죽은 실행)는 다시 처리해야 한다.
    expect(bookingStepGuards({ sheetsAppendedAtState: 'in_progress' }).skipSheets).toBe(false);
    expect(bookingStepGuards({}).skipSheets).toBe(false);
  });

  it('State 필드가 없는 레거시 문서는 완료로 본다 (하위호환)', () => {
    expect(isStepCompleted({ voucherSentAt: 12345 }, 'voucherSentAt')).toBe(true);
  });

  it('선점 중이면 완료가 아니다 — 타임스탬프가 있어도', () => {
    expect(isStepCompleted(
      { sheetsAppendedAt: 999, sheetsAppendedAtState: 'in_progress' },
      'sheetsAppendedAt',
    )).toBe(false);
  });

  it('상태 필드명 규약과 좀비 판정 시간이 정의돼 있다', () => {
    expect(stepStateField('voucherSentAt')).toBe('voucherSentAtState');
    expect(STEP_CLAIM_STALE_MS).toBeGreaterThanOrEqual(60_000);
  });

  it('booking-processor 가 성공 시에만 완료를 기록한다', () => {
    const code = codeOf('api/booking-processor.js');
    expect(code).toContain('async function completeBookingStep');
    expect(code).toContain('completeBookingStep(orderID, BOOKING_STEP_MARKERS.sheets');
    expect(code).toContain('completeBookingStep(orderID, BOOKING_STEP_MARKERS.voucher');
    expect(code).toContain('if (loyaltyOk) await completeBookingStep');
  });

  it('선점은 in_progress 로만 기록한다 (완료 타임스탬프를 미리 쓰지 않는다)', () => {
    // 2026-07-29: 선점 transaction 이 공용 모듈로 이동.
    const code = codeOf('api/_shared/booking-idempotency.js');
    expect(code).toContain("[stateField]: 'in_progress'");
  });

  it('완료 기록이 끝내 실패하면 단계 정책에 따라 격리/재시도로 갈린다', () => {
    // 2026-07-29: 정책 분기가 공용 finalizeStep 으로 이동(한 곳에서만 결정).
    const idem = codeOf('api/_shared/booking-idempotency.js');
    expect(idem).toContain('external_ok_but_completion_write_failed');
    expect(idem).toMatch(/if \(policy === 'reclaim'\)/);
    expect(codeOf('api/booking-processor.js')).toContain('finalizeStep(');
  });
});

describe('Preview / Production Firebase 혼용 차단', () => {
  it('가드 모듈과 운영 절차서가 있다', () => {
    expect(read('api/_shared/firebase-env-guard.js')).toContain('preview-deploy-on-production-firebase');
    expect(read('docs/FIREBASE-ENV-SEPARATION.md')).toContain('FIREBASE_ENV_GUARD');
  });

  it('admin SDK 부팅에서 검사한다', () => {
    expect(codeOf('api/_shared/firebase-admin.js')).toContain("assertFirebaseEnvMatch('firebase-admin')");
  });

  it('설정 전에는 배포를 막지 않는다 (판정 보류)', async () => {
    const { checkFirebaseEnvMatch } = await import('../../api/_shared/firebase-env-guard.js');
    const prev = { p: process.env.FIREBASE_PRODUCTION_PROJECT_ID, c: process.env.FIREBASE_PROJECT_ID };
    delete process.env.FIREBASE_PRODUCTION_PROJECT_ID;
    expect(checkFirebaseEnvMatch().ok).toBe(true);
    if (prev.p) process.env.FIREBASE_PRODUCTION_PROJECT_ID = prev.p;
    if (prev.c) process.env.FIREBASE_PROJECT_ID = prev.c;
  });

  it('프리뷰가 운영 프로젝트에 붙으면 불일치로 잡는다', async () => {
    const { checkFirebaseEnvMatch } = await import('../../api/_shared/firebase-env-guard.js');
    const saved = { ...process.env };
    process.env.FIREBASE_PRODUCTION_PROJECT_ID = 'coco-prod';
    process.env.FIREBASE_PROJECT_ID = 'coco-prod';
    process.env.VERCEL_ENV = 'preview';
    const v = checkFirebaseEnvMatch();
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe('preview-deploy-on-production-firebase');
    process.env.VERCEL_ENV = saved.VERCEL_ENV || '';
    process.env.FIREBASE_PRODUCTION_PROJECT_ID = saved.FIREBASE_PRODUCTION_PROJECT_ID || '';
    process.env.FIREBASE_PROJECT_ID = saved.FIREBASE_PROJECT_ID || '';
  });
});

describe('감사 요약 — 개인정보 제거', () => {
  const summary = JSON.parse(read('docs/loyalty-pollution-summary.json'));

  it('uid·이메일·예약번호가 들어 있지 않다', () => {
    const raw = read('docs/loyalty-pollution-summary.json');
    expect(raw).not.toMatch(/@/);              // 이메일
    expect(raw).not.toMatch(/CT-\d{8}/);       // 예약번호
    expect(raw).not.toMatch(/"uid"/);
    for (const a of summary.accounts) expect(a.uid).toBeUndefined();
  });

  it('집계 수치는 그대로 담고 있다', () => {
    expect(summary.totals.accounts).toBeGreaterThan(0);
    expect(summary.totals.coins).toBeGreaterThan(0);
    expect(summary.exposure.percent).toBe(15);
  });
});

describe('내 플랜 — 커서 페이지 나누기', () => {
  const code = codeOf('src/pages/MyPlansPage.tsx');

  it('startAfter 커서로 다음 페이지만 읽는다', () => {
    expect(code).toContain('startAfter(lastDoc)');
    expect(code).toContain('getDocs');
  });

  it('limit 을 키워 처음부터 다시 읽지 않는다', () => {
    expect(code).not.toContain('setPageSize');
    expect(code).toContain('limit(PAGE_SIZE)');
  });

  it('계정이 바뀌면 이전 계정 페이지를 쓰지 않는다', () => {
    expect(code).toContain('morePages.uid === (user?.uid');
  });
});

describe('등급 혜택 번역', () => {
  it('4개 국어에 tierBenefits 가 있다', () => {
    for (const lang of ['ko', 'en', 'ja', 'zh']) {
      const d = JSON.parse(read(`src/i18n/locales/${lang}.json`));
      expect(d.mypage.tierBenefitList.Platinum.length, `${lang}`).toBeGreaterThan(0);
    }
  });

  it('화면이 번역을 읽고 영어는 폴백으로만 남는다', () => {
    const code = codeOf('src/pages/MyPage.tsx');
    expect(code).toContain('tierBenefits(mp as unknown as Record<string, unknown>, tier)');
    expect(code).toContain('TIER_BENEFITS_FALLBACK');
  });
});
