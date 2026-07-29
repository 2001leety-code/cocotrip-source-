/* eslint-disable @typescript-eslint/no-explicit-any -- Firestore 모킹 스캐폴딩. */
/**
 * `FAIL-14` ~ `FAIL-17` 회귀 잠금 (2026-07-29).
 *
 * FAIL-14: rollback dry-run 이 스냅샷 목록만 찍고 "복구 예정" 이라 했다(허수 검사).
 * FAIL-15: rollback 이 correction·쿠폰을 부분적으로만 확인했다.
 * FAIL-16: 인정되지 않은 correction 이 있는 계정을 자동 보정 대상에 넣을 수 있었다.
 * FAIL-17: 모든 합계가 `changed` 계정만 더해, 보정 후 "오염 이력 0건" 으로 보였다.
 *
 * 가짜 Firestore 만 쓴다 — 운영 데이터를 건드리는 자동 테스트는 없다.
 */
import { describe, it, expect } from 'vitest';
import { createFakeFirestore, FieldValue } from '../helpers/fake-firestore.js';
import {
  guardFirestore, loadAccount, planHashOf, buildReport, toMarkdown,
  assignAccountLabels, evaluateRollbackTarget, POLLUTION_REVOKE_REASON,
  POLLUTION_CORRECTION_SCHEMA, correctionDocId,
} from '../../scripts/lib/loyalty-remediation-core.mjs';
import { executeRemediation, SNAPSHOT_COLLECTION } from '../../scripts/loyalty-remediation-execute.mjs';
import {
  evaluateRollbackAccount, rollbackOneAccount, rollbackLabel,
} from '../../scripts/loyalty-remediation-rollback.mjs';
import { calculateLoyaltyTier } from '../../api/_shared/loyalty-policy.js';

const UID = 'u-1417';

async function analyze(db: any, allowWrites = false) {
  const g = guardFirestore(db, { allowWrites });
  const snap = await g.collection('users').get();
  const accounts: any[] = [];
  for (const d of snap.docs) accounts.push(await loadAccount(g, d, calculateLoyaltyTier));
  return { g, accounts, stats: g.stats };
}

/** 오염 1건 + 회수 대상 쿠폰 1장을 가진 계정. */
function seed(over: Record<string, any> = {}) {
  return createFakeFirestore({
    [`users/${UID}`]: { tripCoins: 5000, totalSpentUSD: 1000, bookingCount: 10, tier: 'Platinum' },
    'bookings/PAY-1': {
      uid: UID, orderID: 'PAY-1', captureID: 'CAP-1', currency: 'USD',
      amountUSD: 9.9, paymentVerified: true, status: 'CONFIRMED',
    },
    [`users/${UID}/pointHistory/earn_PAY-1`]: {
      type: 'earn', amount: 30, ledgerKey: 'PAY-1', captureId: 'CAP-1', createdAt: 1,
    },
    [`users/${UID}/pointHistory/ai-1`]: {
      type: 'earn', amount: 2000, description: 'AI Plan: seoul ($666.66)', createdAt: 2,
    },
    [`users/${UID}/pointHistory/spend-1`]: {
      type: 'spend', amount: -2000, description: 'Redeemed 2000 coins', createdAt: 3,
    },
    [`users/${UID}/coupons/c-unused`]: {
      source: 'coin_redemption', coinsSpent: 2000, isUsed: false, value: 15, createdAt: 3,
    },
    ...over,
  });
}

/** 실제 보정을 실행해 correction·스냅샷·회수 쿠폰이 있는 상태를 만든다. */
async function remediate(db: any) {
  const { accounts } = await analyze(db);
  const planHash = planHashOf(accounts);
  buildReport({ accounts, scanned: accounts.length, stats: { reads: 0, writeAttempts: 0, writesAllowed: 0 }, projectId: 'p', planHash });
  const writable = guardFirestore(db, { allowWrites: true });
  const result = await executeRemediation({ db: writable, accounts, planHash });
  const snapshotData = db.__dump()[`${SNAPSHOT_COLLECTION}/${planHash}/users/${UID}`];
  return { planHash, result, snapshotData };
}

describe('FAIL-14 rollback dry-run 이 실제 검사다', () => {
  it('🔴 정상 상태는 ready 이고 dry-run 쓰기는 0건이다', async () => {
    const db = seed();
    const { planHash, snapshotData } = await remediate(db);
    const ro = guardFirestore(db, { allowWrites: false });
    const before = db.__dump();

    const verdict = await evaluateRollbackAccount({ db: ro, snapshotData, uid: UID, planHash });

    expect(verdict).toEqual({ ready: true });
    expect(ro.stats.writeAttempts).toBe(0);
    expect(ro.stats.writesAllowed).toBe(0);
    expect(ro.stats.reads).toBeGreaterThan(0);
    expect(db.__dump()).toEqual(before);          // 문서가 하나도 바뀌지 않았다
  });

  it('🔴 dry-run 판정과 execute 판정이 정확히 같다', async () => {
    const cases: Array<[string, (db: any, h: string) => void, string]> = [
      ['correction 없음', (db, h) => db.__delete(`users/${UID}/pointHistory/${correctionDocId(h)}`), 'correction_missing'],
      ['이미 rollback', (db, h) => db.__patch(`users/${UID}/pointHistory/${correctionDocId(h)}`, { rolledBack: true }), 'already_rolled_back'],
      ['plan 불일치', (db) => db.__patch(`users/${UID}`, { loyaltyCorrectionPlan: 'other' }), 'plan_mismatch'],
      ['보정 뒤 정상 결제', (db) => db.__patch(`users/${UID}`, { totalSpentUSD: 1500 }), 'stale_rollback'],
      ['쿠폰 사유 변경', (db) => db.__patch(`users/${UID}/coupons/c-unused`, { revokedReason: 'fraud' }), 'coupon_drift'],
    ];
    for (const [name, mutate, expected] of cases) {
      const db = seed();
      const { planHash, snapshotData } = await remediate(db);
      mutate(db, planHash);

      const ro = guardFirestore(db, { allowWrites: false });
      const dry = await evaluateRollbackAccount({ db: ro, snapshotData, uid: UID, planHash });
      const writable = guardFirestore(db, { allowWrites: true });
      const exec = await rollbackOneAccount({ db: writable, FieldValue, snapshotData, uid: UID, planHash });

      expect(dry.ready, name).toBe(false);
      expect(dry.reason, name).toBe(expected);
      expect(exec.skipped, name).toBe(expected);   // 같은 사유로 막힌다
      expect(ro.stats.writesAllowed, name).toBe(0);
    }
  });

  it('익명 순번은 스냅샷의 accountNo 를 그대로 쓴다', () => {
    expect(rollbackLabel({ accountNo: 4 }, 0)).toBe('user-4');
    expect(rollbackLabel({}, 2)).toBe('user-3');          // 옛 스냅샷 폴백
  });
});

describe('FAIL-15 rollback 이 correction·쿠폰 전체를 검증한다', () => {
  it('🔴 정상 execute 는 사용자·원장·쿠폰을 한꺼번에 복원한다', async () => {
    const db = seed();
    const { planHash, snapshotData } = await remediate(db);
    // 보정이 실제로 값을 바꿨는지 먼저 확인
    expect(db.__dump()[`users/${UID}`].tripCoins).not.toBe(5000);
    expect(db.__dump()[`users/${UID}/coupons/c-unused`].isRevoked).toBe(true);

    const writable = guardFirestore(db, { allowWrites: true });
    const out = await rollbackOneAccount({ db: writable, FieldValue, snapshotData, uid: UID, planHash });
    expect(out.restored).toBe(true);

    const after = db.__dump();
    expect(after[`users/${UID}`].tripCoins).toBe(5000);
    expect(after[`users/${UID}`].totalSpentUSD).toBe(1000);
    expect(after[`users/${UID}`].bookingCount).toBe(10);
    expect(after[`users/${UID}`].tier).toBe('Platinum');
    expect(after[`users/${UID}`].loyaltyCorrectionPlan).toBeUndefined();
    expect(after[`users/${UID}/pointHistory/${correctionDocId(planHash)}`].rolledBack).toBe(true);
    // 쿠폰은 원래 없던 필드가 전부 지워진다(삭제가 아니라 이전 상태 복원).
    const c = after[`users/${UID}/coupons/c-unused`];
    expect(c.isRevoked).toBeUndefined();
    expect(c.status).toBeUndefined();
    expect(c.revokedReason).toBeUndefined();
    expect(c.revokedPlan).toBeUndefined();
    expect(c.isUsed).toBe(false);          // 건드리지 않은 필드는 그대로
  });

  it('🔴 이미 rollback 된 사용자는 다시 실행되지 않는다', async () => {
    const db = seed();
    const { planHash, snapshotData } = await remediate(db);
    const writable = guardFirestore(db, { allowWrites: true });
    await rollbackOneAccount({ db: writable, FieldValue, snapshotData, uid: UID, planHash });
    const snapshotAfter = db.__dump();

    const again = await rollbackOneAccount({ db: writable, FieldValue, snapshotData, uid: UID, planHash });
    expect(again.skipped).toBe('already_rolled_back');
    expect(db.__dump()).toEqual(snapshotAfter);     // 두 번째 실행은 아무것도 안 바꾼다
  });

  it('🔴 malformed correction 이면 전체 무변경', async () => {
    const db = seed();
    const { planHash, snapshotData } = await remediate(db);
    const path = `users/${UID}/pointHistory/${correctionDocId(planHash)}`;
    // 🔴 balance·tierAfter 를 포함한 **나머지는 전부 정상**으로 두고,
    //   "이 보정이 만든 것" 이라는 표식(schema·설명)만 없앤다.
    //   → identifyPollutionCorrection 을 부르지 않으면 통과해버리는 형태다.
    const cur: any = db.__get(path);
    const withoutSchema = { ...cur.correction };
    delete withoutSchema.schema;
    db.__patch(path, { description: 'Operator manual adjustment', correction: withoutSchema });
    const before = db.__dump();

    const writable = guardFirestore(db, { allowWrites: true });
    const out = await rollbackOneAccount({ db: writable, FieldValue, snapshotData, uid: UID, planHash });
    expect(out.skipped).toBe('correction_invalid');
    expect(out.detail).toEqual(['schema_or_description_unrecognized']);
    expect(db.__dump()).toEqual(before);
  });

  it('🔴 correction 의 balance·tierAfter 가 없으면 전체 무변경', () => {
    const base = {
      type: 'correction', amount: -2000, balance: 3000,
      description: `Ledger correction: removed AI-plan estimates not backed by a verified PayPal capture (plan H)`,
      correction: {
        schema: POLLUTION_CORRECTION_SCHEMA, planHash: 'H', mode: 'subtract_pollution_only',
        spentUSDBefore: 1000, spentUSDAfter: 333.34, bookingCountBefore: 10, bookingCountAfter: 9,
        tierBefore: 'Platinum', tierAfter: 'Gold', pollutedEntries: 1,
      },
    };
    const user = { loyaltyCorrectionPlan: 'H', totalSpentUSD: 333.34, bookingCount: 9, tripCoins: 3000, tier: 'Gold' };
    const call = (cd: any) => evaluateRollbackTarget({
      planHash: 'H', correctionExists: true, correctionData: cd,
      userExists: true, userData: user, coupons: [],
    });
    expect(call(base)).toEqual({ ready: true });

    const noBalance = { ...base, balance: undefined };
    expect(call(noBalance)).toEqual({ ready: false, reason: 'correction_invalid', detail: ['missing_balance'] });

    const noTier = { ...base, correction: { ...base.correction, tierAfter: '' } };
    expect(call(noTier)).toEqual({ ready: false, reason: 'correction_invalid', detail: ['missing_tierAfter'] });
  });

  it('🔴 status·사유·revokedAt 이 바뀌었으면 전체 무변경', async () => {
    for (const patch of [
      { status: 'active' },
      { revokedReason: 'chargeback_hold' },
      { revokedAt: null },
      { isUsed: true },
    ]) {
      const db = seed();
      const { planHash, snapshotData } = await remediate(db);
      db.__patch(`users/${UID}/coupons/c-unused`, patch);
      const before = db.__dump();

      const writable = guardFirestore(db, { allowWrites: true });
      const out = await rollbackOneAccount({ db: writable, FieldValue, snapshotData, uid: UID, planHash });
      expect(out.skipped, JSON.stringify(patch)).toBe('coupon_drift');
      // 사용자·원장도 함께 그대로여야 한다 — 부분 복원 금지.
      expect(db.__dump(), JSON.stringify(patch)).toEqual(before);
    }
  });

  it('🔴 transaction 이 실패하면 아무것도 남지 않는다', async () => {
    const db = seed();
    const { planHash, snapshotData } = await remediate(db);
    const before = db.__dump();

    const writable = guardFirestore(db, { allowWrites: true });
    db.__beforeCommit = () => { throw new Error('network down'); };
    await expect(
      rollbackOneAccount({ db: writable, FieldValue, snapshotData, uid: UID, planHash }),
    ).rejects.toThrow('network down');
    db.__beforeCommit = null;

    expect(db.__dump()).toEqual(before);
  });

  it('회수 사유 상수가 실행부·rollback 에서 같은 값이다', () => {
    expect(POLLUTION_REVOKE_REASON).toBe('issued_from_unverified_ai_plan_coins');
  });
});

describe('FAIL-16 인정 안 된 correction 계정은 자동 보정하지 않는다', () => {
  function seedWithAlienCorrection() {
    return seed({
      [`users/${UID}/pointHistory/manual-1`]: {
        type: 'correction', amount: -500, balance: 4500,
        description: 'Operator manual adjustment', createdAt: 4,
      },
    });
  }

  it('🔴 manual_review 계정은 docsToWrite=0 이고 planHash 대상에서 빠진다', async () => {
    const { accounts } = await analyze(seedWithAlienCorrection());
    const a = accounts[0];
    expect(a.manualReview).toBe(true);
    expect(a.manualReviewReason).toBe('unrecognized_correction_present');
    expect(a.changed).toBe(false);
    expect(a.docsToWrite).toBe(0);
    expect(a.docsBreakdown).toEqual({ snapshot: 0, user: 0, correction: 0, coupons: 0 });
    // 빈 계획과 같은 해시 = 실행 대상이 하나도 없다는 뜻
    expect(planHashOf(accounts)).toBe(planHashOf([]));
  });

  it('🔴 execute 를 호출해도 쓰기가 0건이다', async () => {
    const db = seedWithAlienCorrection();
    const { accounts } = await analyze(db);
    const before = db.__dump();
    const writable = guardFirestore(db, { allowWrites: true });
    const result = await executeRemediation({ db: writable, accounts, planHash: planHashOf(accounts) });

    expect(result.applied).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
    expect(writable.stats.writesAllowed).toBe(0);
    expect(db.__dump()).toEqual(before);
  });

  it('🔴 rolledBack correction 이 있어도 자동으로 다시 빼지 않는다', async () => {
    const db = seed({
      [`users/${UID}/pointHistory/correction_ZZ`]: {
        type: 'correction', amount: -2000, balance: 3000, rolledBack: true,
        description: 'Ledger correction: removed AI-plan estimates not backed by a verified PayPal capture (plan ZZ)',
        correction: {
          planHash: 'ZZ', mode: 'subtract_pollution_only',
          spentUSDBefore: 1000, spentUSDAfter: 333.34,
          bookingCountBefore: 10, bookingCountAfter: 9, tierAfter: 'Gold', pollutedEntries: 1,
        },
        createdAt: 4,
      },
    });
    const { accounts } = await analyze(db);
    const a = accounts[0];
    // 되돌려졌으니 "이미 제거된 몫" 으로 세지 않는다 — 오염은 다시 보인다.
    expect(a.ledger.acceptedCorrections).toBe(0);
    expect(a.ledger.remainingPollutedUSD).toBeGreaterThan(0);
    // 그러나 자동 보정 대상도 아니다(운영자 판단).
    expect(a.manualReview).toBe(true);
    expect(a.changed).toBe(false);
  });

  it('인정된 correction 만 있는 계정은 0건으로 수렴한다', async () => {
    const db = seed();
    await remediate(db);
    const { accounts } = await analyze(db);
    const a = accounts[0];
    expect(a.manualReview).toBe(false);
    expect(a.changed).toBe(false);
    expect(a.docsToWrite).toBe(0);
    expect(a.ledger.acceptedCorrections).toBe(1);
    expect(a.ledger.remainingPollutedUSD).toBe(0);
  });

  it('보고서가 manual_review 계정을 예상 영향만으로 따로 보여준다', async () => {
    const { accounts, stats } = await analyze(seedWithAlienCorrection());
    const report = buildReport({ accounts, scanned: 1, stats, projectId: 'p', planHash: 'h' });
    expect(report.totals.allScanned.manualReviewAccounts).toBe(1);
    expect(report.totals.plannedTargets.accountsToFix).toBe(0);
    expect(report.totals.plannedTargets.docsToWrite).toBe(0);
    expect(report.manualReviewAccounts).toHaveLength(1);
    expect(report.manualReviewAccounts[0].wouldChange).toBe(true);
    expect(report.manualReviewAccounts[0].expectedImpactIfApproved).not.toBeNull();
    const md = toMarkdown(report);
    expect(md).toContain('자동 보정에서 제외한 계정');
  });
});

describe('FAIL-17 합계 범위 분리와 안정적 익명 순번', () => {
  it('🔴 보정 후 대상 0 이어도 현재 합계와 역사적 오염이 그대로 나온다', async () => {
    const db = seed();
    await remediate(db);
    const { accounts, stats } = await analyze(db);
    const report = buildReport({ accounts, scanned: 1, stats, projectId: 'p', planHash: 'h' });
    const A = report.totals.allScanned;

    expect(report.totals.plannedTargets.accountsToFix).toBe(0);
    // 대상 0 이지만 "오염 이력 0건" 이 아니다.
    expect(A.historicalPollution.entries).toBe(1);
    expect(A.historicalPollution.usd).toBe(666.66);
    expect(A.acceptedCorrections).toBe(1);
    expect(A.remainingPollution.usd).toBe(0);
    // 현재 전체 합계가 0 으로 뭉개지지 않는다.
    expect(A.current.totalSpentUSD).toBeGreaterThan(0);
    expect(A.accountsWithPollutionHistory).toBe(1);
  });

  it('🔴 마크다운이 "역사적 오염" 과 "남은 미보정 오염" 을 따로 쓴다', async () => {
    const db = seed();
    await remediate(db);
    const { accounts, stats } = await analyze(db);
    const md = toMarkdown(buildReport({ accounts, scanned: 1, stats, projectId: 'p', planHash: 'h' }));
    expect(md).toContain('역사적 오염 이력');
    expect(md).toContain('남은 미보정 오염');
    expect(md).toContain('대상 0 건은 **오염이 없었다는 뜻이 아니다.**');
    expect(md).not.toMatch(/오염 이력:\s*0건/);        // 뭉뚱그린 표현 금지
  });

  it('🔴 익명 순번이 보정 전후로 바뀌지 않는다', async () => {
    /** 오염 규모가 다른 4계정. */
    const mk = (uid: string, coins: number, usd: number) => ({
      [`users/${uid}`]: { tripCoins: coins, totalSpentUSD: usd, bookingCount: 1, tier: 'Gold' },
      [`users/${uid}/pointHistory/ai`]: {
        type: 'earn', amount: coins, description: `AI Plan: x ($${usd.toFixed(2)})`, createdAt: 1,
      },
    });
    const db = createFakeFirestore({
      // 문서 ID 순서와 오염 규모 순서를 일부러 어긋나게 둔다.
      ...mk('zz-small', 100, 10),
      ...mk('aa-big', 756986, 253204.54),
      ...mk('mm-mid', 10044, 3586.95),
      'users/bb-none': { tripCoins: 0, totalSpentUSD: 0, bookingCount: 0, tier: 'Bronze' },
    });
    const first = await analyze(db);
    assignAccountLabels(first.accounts);
    const labelOf = (accts: any[], uid: string) => accts.find((a) => a.uid === uid).no;
    expect(labelOf(first.accounts, 'aa-big')).toBe(1);
    expect(labelOf(first.accounts, 'mm-mid')).toBe(2);
    expect(labelOf(first.accounts, 'zz-small')).toBe(3);
    expect(labelOf(first.accounts, 'bb-none')).toBeNull();   // 오염 없음 — 번호 없음

    // 보정 실행 후에도 같은 사람이 같은 번호여야 한다.
    const planHash = planHashOf(first.accounts);
    const writable = guardFirestore(db, { allowWrites: true });
    await executeRemediation({ db: writable, accounts: first.accounts, planHash });

    const second = await analyze(db);
    assignAccountLabels(second.accounts);
    expect(labelOf(second.accounts, 'aa-big')).toBe(1);
    expect(labelOf(second.accounts, 'mm-mid')).toBe(2);
    expect(labelOf(second.accounts, 'zz-small')).toBe(3);
  });

  it('🔴 실행부 로그 순번이 보고서 순번과 같다', async () => {
    const db = createFakeFirestore({
      'users/z-big': { tripCoins: 9000, totalSpentUSD: 900, bookingCount: 1, tier: 'Gold' },
      'users/z-big/pointHistory/ai': { type: 'earn', amount: 9000, description: 'AI Plan: x ($900.00)', createdAt: 1 },
      'users/a-small': { tripCoins: 100, totalSpentUSD: 10, bookingCount: 1, tier: 'Bronze' },
      'users/a-small/pointHistory/ai': { type: 'earn', amount: 100, description: 'AI Plan: y ($10.00)', createdAt: 1 },
    });
    const { accounts, stats } = await analyze(db);
    const planHash = planHashOf(accounts);
    const report = buildReport({ accounts, scanned: 2, stats, projectId: 'p', planHash });
    const writable = guardFirestore(db, { allowWrites: true });
    const result = await executeRemediation({ db: writable, accounts, planHash });

    // 보고서에서 지출이 큰 쪽이 user-1
    expect(report.accounts[0].before.totalSpentUSD).toBe(900);
    expect(report.accounts[0].no).toBe(1);
    // 실행 로그도 같은 번호를 쓴다(문서 ID 순서와 무관하게).
    expect(result.applied.map((r: any) => r.label).sort()).toEqual(['user-1', 'user-2']);
    // 스냅샷에도 같은 번호가 남아 rollback 이 이어 쓸 수 있다.
    expect(db.__dump()[`${SNAPSHOT_COLLECTION}/${planHash}/users/z-big`].accountNo).toBe(1);
    expect(db.__dump()[`${SNAPSHOT_COLLECTION}/${planHash}/users/a-small`].accountNo).toBe(2);
  });
});
