/* eslint-disable @typescript-eslint/no-explicit-any -- Firestore 모킹 스캐폴딩. */
/**
 * `FAIL-8` correction 판별 범위 · `FAIL-9` rollback 사전 검증 회귀 잠금 (2026-07-29).
 *
 * FAIL-8: `type === 'correction'` 이라는 이유만으로 "이미 제거된 오염분" 으로 합산했다.
 *   다른 목적의 correction 이 있으면 **아직 안 뺀 오염분이 숨겨져** 보정이 덜 된다.
 *
 * FAIL-9: rollback 이 현재값을 확인하지 않고 snapshot.before 로 덮어썼다.
 *   보정 뒤 정상 결제·코인 사용이 있었다면 그것까지 지운다.
 *
 * 가짜 Firestore 만 쓴다 — 운영 데이터를 건드리는 자동 테스트는 없다.
 */
import { describe, it, expect } from 'vitest';
import { createFakeFirestore } from '../helpers/fake-firestore.js';
import {
  guardFirestore, loadAccount, planHashOf, POLLUTION_REVOKE_REASON,
  identifyPollutionCorrection, POLLUTION_CORRECTION_SCHEMA, LEGACY_CORRECTION_DESC_PREFIX,
} from '../../scripts/lib/loyalty-remediation-core.mjs';
import { executeRemediation } from '../../scripts/loyalty-remediation-execute.mjs';
import { detectStaleRollback, detectCouponDrift, buildCouponRestorePatch } from '../../scripts/loyalty-remediation-rollback.mjs';
import { calculateLoyaltyTier } from '../../api/_shared/loyalty-policy.js';

const UID = 'u-f89';
const PLAN = 'cf34e71db538b585';

/** 운영에 실제로 생성된 4건과 같은 형태 (schema 필드 없음). */
function legacyCorrection(planHash = PLAN, over: Record<string, any> = {}) {
  return {
    type: 'correction',
    amount: -617779,
    balance: 139207,
    description: `Ledger correction: removed AI-plan estimates not backed by a verified PayPal capture (plan ${planHash})`,
    correction: {
      planHash,
      mode: 'subtract_pollution_only',
      spentUSDBefore: 253204.54,
      spentUSDAfter: 47279.42,
      bookingCountBefore: 260,
      bookingCountAfter: 58,
      tierBefore: 'Platinum',
      tierAfter: 'Platinum',
      pollutedEntries: 202,
      ambiguousEntriesHeld: 3,
      grandfatheredCoinDebt: 0,
    },
    createdAt: 1,
    ...over,
  };
}

describe('FAIL-8 correction 판별 — 이 보정이 만든 것만 인정', () => {
  it('🔴 운영에 이미 생성된 레거시 4건 형식을 정상 인식한다', () => {
    const v = identifyPollutionCorrection(`correction_${PLAN}`, legacyCorrection());
    expect(v.accepted).toBe(true);
    expect(v.legacy).toBe(true);
    expect(v.removedUSD).toBe(205925.12);
    expect(v.removedBookings).toBe(202);
    expect(v.removedCoins).toBe(617779);
    expect(v.removedEntries).toBe(202);
  });

  it('신규 schema 필드가 있으면 설명과 무관하게 인식한다', () => {
    const doc = legacyCorrection();
    doc.description = 'anything';
    (doc.correction as any).schema = POLLUTION_CORRECTION_SCHEMA;
    const v = identifyPollutionCorrection(`correction_${PLAN}`, doc);
    expect(v.accepted).toBe(true);
    expect(v.legacy).toBe(false);
  });

  it('🔴 관련 없는 correction 은 인정하지 않는다', () => {
    // 운영자 수동 조정처럼 메타데이터가 없는 것
    expect(identifyPollutionCorrection('correction_x', { type: 'correction', amount: -100 }).reason)
      .toBe('no_correction_metadata');
    // 설명·schema 모두 우리 것이 아님
    const alien = legacyCorrection();
    alien.description = 'Manual adjustment by operator';
    delete (alien.correction as any).schema;
    expect(identifyPollutionCorrection(`correction_${PLAN}`, alien).reason)
      .toBe('schema_or_description_unrecognized');
  });

  it('🔴 planHash 와 문서 ID 가 불일치하면 무시한다', () => {
    expect(identifyPollutionCorrection('correction_OTHER', legacyCorrection()).reason)
      .toBe('doc_id_plan_hash_mismatch');
    expect(identifyPollutionCorrection('some-random-id', legacyCorrection()).reason)
      .toBe('doc_id_plan_hash_mismatch');
  });

  it('🔴 rolledBack correction 은 제거된 금액으로 세지 않는다', () => {
    expect(identifyPollutionCorrection(`correction_${PLAN}`, legacyCorrection(PLAN, { rolledBack: true })).reason)
      .toBe('rolled_back');
  });

  it('🔴 metadata 가 불완전하면 무시·보류한다', () => {
    const broken = legacyCorrection();
    delete (broken.correction as any).spentUSDAfter;
    expect(identifyPollutionCorrection(`correction_${PLAN}`, broken).reason)
      .toBe('incomplete_numeric_metadata');

    const badMode = legacyCorrection();
    (badMode.correction as any).mode = 'wipe_everything';
    expect(identifyPollutionCorrection(`correction_${PLAN}`, badMode).reason).toBe('mode_not_allowed');

    const negative = legacyCorrection();
    (negative.correction as any).spentUSDAfter = 999999;
    expect(identifyPollutionCorrection(`correction_${PLAN}`, negative).reason).toBe('negative_removal');
  });

  it('레거시 설명이라도 다른 planHash 를 가리키면 인정하지 않는다', () => {
    const mixed = legacyCorrection('AAAA');
    mixed.description = `Ledger correction: removed AI-plan estimates not backed by a verified PayPal capture (plan ${PLAN})`;
    expect(identifyPollutionCorrection('correction_AAAA', mixed).reason)
      .toBe('schema_or_description_unrecognized');
    expect(LEGACY_CORRECTION_DESC_PREFIX.length).toBeGreaterThan(20);
  });
});

describe('FAIL-8 집계 — 인정된 것만 이미 제거분으로 센다', () => {
  function seedWithCorrection(correctionDoc: any, docId: string) {
    return createFakeFirestore({
      [`users/${UID}`]: { tripCoins: 1000, totalSpentUSD: 500, bookingCount: 5, tier: 'Gold' },
      [`users/${UID}/pointHistory/ai-1`]: {
        type: 'earn', amount: 1000, description: 'AI Plan: seoul ($300.00)', createdAt: 1,
      },
      [`users/${UID}/pointHistory/legacy-x`]: {
        type: 'earn', amount: 5, description: 'Manual', createdAt: 2,
      },
      [`users/${UID}/pointHistory/${docId}`]: correctionDoc,
    });
  }
  async function analyze(db: any) {
    const g = guardFirestore(db, { allowWrites: false });
    const snap = await g.collection('users').get();
    const out: any[] = [];
    for (const d of snap.docs) out.push(await loadAccount(g, d, calculateLoyaltyTier));
    return out;
  }

  it('🔴 관련 없는 correction 은 오염분을 숨기지 못한다', async () => {
    const alien = {
      type: 'correction', amount: -1000, balance: 0,
      description: 'Manual adjustment', createdAt: 3,
    };
    const accounts = await analyze(seedWithCorrection(alien, 'manual-1'));
    const a = accounts[0];
    expect(a.ledger.ambiguousCorrections).toBe(1);
    expect(a.ledger.acceptedCorrections).toBe(0);
    expect(a.ledger.alreadyRemovedUSD).toBe(0);
    // 오염분이 그대로 남는다 — 관련 없는 correction 이 오염분을 가리지 못한다.
    expect(a.ledger.remainingPollutedUSD).toBe(300);
    // 🔴 2026-07-29 FAIL-16: 그렇다고 **자동으로 빼지도 않는다.**
    //   그 correction 이 이미 무엇을 뺐는지 모르므로 두 번 차감할 수 있다.
    //   보정을 막지 않았다면 바뀌었을 것(wouldChange)임만 남기고 운영자에게 넘긴다.
    expect(a.wouldChange).toBe(true);
    expect(a.manualReview).toBe(true);
    expect(a.changed).toBe(false);
    expect(a.docsToWrite).toBe(0);
  });

  it('이 보정의 활성 correction 은 이미 제거분으로 인정된다', async () => {
    const mine = {
      type: 'correction', amount: -1000, balance: 0,
      description: `Ledger correction: removed AI-plan estimates not backed by a verified PayPal capture (plan ${PLAN})`,
      correction: {
        schema: POLLUTION_CORRECTION_SCHEMA, planHash: PLAN, mode: 'subtract_pollution_only',
        spentUSDBefore: 800, spentUSDAfter: 500, bookingCountBefore: 6, bookingCountAfter: 5,
        tierBefore: 'Gold', tierAfter: 'Gold', pollutedEntries: 1,
      },
      createdAt: 3,
    };
    const accounts = await analyze(seedWithCorrection(mine, `correction_${PLAN}`));
    const a = accounts[0];
    expect(a.ledger.acceptedCorrections).toBe(1);
    expect(a.ledger.ambiguousCorrections).toBe(0);
    expect(a.ledger.alreadyRemovedUSD).toBe(300);
    expect(a.ledger.remainingPollutedUSD).toBe(0);
  });

  it('🔴 rolledBack correction 은 제거분으로 세지 않아 오염이 다시 보인다', async () => {
    const rolled = {
      type: 'correction', amount: -1000, balance: 0, rolledBack: true,
      description: `Ledger correction: removed AI-plan estimates not backed by a verified PayPal capture (plan ${PLAN})`,
      correction: {
        schema: POLLUTION_CORRECTION_SCHEMA, planHash: PLAN, mode: 'subtract_pollution_only',
        spentUSDBefore: 800, spentUSDAfter: 500, bookingCountBefore: 6, bookingCountAfter: 5,
        tierBefore: 'Gold', tierAfter: 'Gold', pollutedEntries: 1,
      },
      createdAt: 3,
    };
    const accounts = await analyze(seedWithCorrection(rolled, `correction_${PLAN}`));
    expect(accounts[0].ledger.alreadyRemovedUSD).toBe(0);
    expect(accounts[0].ledger.remainingPollutedUSD).toBe(300);
  });

  it('실행 → 재분석이 0 건으로 수렴한다 (신규 schema 경로)', async () => {
    const db = createFakeFirestore({
      [`users/${UID}`]: { tripCoins: 1000, totalSpentUSD: 500, bookingCount: 5, tier: 'Gold' },
      [`users/${UID}/pointHistory/ai-1`]: {
        type: 'earn', amount: 1000, description: 'AI Plan: seoul ($300.00)', createdAt: 1,
      },
      [`users/${UID}/pointHistory/legacy-x`]: { type: 'earn', amount: 5, description: 'Manual', createdAt: 2 },
    });
    const first = await analyze(db);
    const planHash = planHashOf(first);
    const w = guardFirestore(db, { allowWrites: true });
    const r = await executeRemediation({ db: w, accounts: first, planHash });
    expect(r.applied).toHaveLength(1);

    const second = await analyze(db);
    expect(second[0].ledger.acceptedCorrections).toBe(1);
    expect(second[0].ledger.remainingPollutedUSD).toBe(0);
    expect(second[0].changed).toBe(false);
  });
});

describe('FAIL-9 rollback 사전 검증', () => {
  const correction = {
    balance: 139207,
    correction: {
      spentUSDAfter: 47279.42, bookingCountAfter: 58, tierAfter: 'Platinum',
    },
  };
  const afterUser = { totalSpentUSD: 47279.42, bookingCount: 58, tripCoins: 139207, tier: 'Platinum' };

  it('보정 직후 값이면 되돌릴 수 있다', () => {
    expect(detectStaleRollback(correction, afterUser)).toEqual([]);
    // 부동소수 잔차는 오판하지 않는다
    expect(detectStaleRollback(correction, { ...afterUser, totalSpentUSD: 47279.420000001 })).toEqual([]);
  });

  it('🔴 지출·예약·코인·등급 중 하나만 바뀌어도 중단한다', () => {
    expect(detectStaleRollback(correction, { ...afterUser, totalSpentUSD: 47289.32 })).toEqual(['totalSpentUSD']);
    expect(detectStaleRollback(correction, { ...afterUser, bookingCount: 59 })).toEqual(['bookingCount']);
    expect(detectStaleRollback(correction, { ...afterUser, tripCoins: 139237 })).toEqual(['tripCoins']);
    expect(detectStaleRollback(correction, { ...afterUser, tier: 'Gold' })).toEqual(['tier']);
  });

  it('🔴 쿠폰이 다른 작업으로 바뀌었으면 잡아낸다', () => {
    // 2026-07-29 FAIL-15: 회수 필드 **전부**가 이 보정이 남긴 그대로여야 한다.
    //   예전에는 revokedPlan·isRevoked·isUsed 만 봐서, 그 사이 status·사유가 바뀌어도 통과했다.
    const OK = {
      isRevoked: true, status: 'revoked',
      revokedReason: POLLUTION_REVOKE_REASON, revokedPlan: PLAN, revokedAt: 1,
    };
    const mk = (id: string, data: any) => ({ ref: { id }, snap: { exists: true, data: () => data } });
    const entries = [
      mk('ok', { ...OK }),
      mk('unrevoked', { ...OK, isRevoked: false }),
      mk('otherplan', { ...OK, revokedPlan: 'OTHER' }),
      mk('used', { ...OK, isUsed: true }),
      mk('statuschanged', { ...OK, status: 'active' }),
      mk('reasonchanged', { ...OK, revokedReason: 'fraud_review' }),
      mk('noat', { ...OK, revokedAt: null }),
      { ref: { id: 'gone' }, snap: { exists: false, data: () => undefined } },
    ] as any[];
    const drift = detectCouponDrift(entries, PLAN);
    expect(drift.map((d: any) => d.id).sort()).toEqual(
      ['gone', 'noat', 'otherplan', 'reasonchanged', 'statuschanged', 'unrevoked', 'used'],
    );
    expect(drift.map((d: any) => d.reason).sort()).toEqual([
      'already_unrevoked', 'missing', 'reason_changed', 'revoked_at_missing',
      'revoked_plan_changed', 'status_changed', 'used_after_revoke',
    ]);
    expect(detectCouponDrift([mk('ok', { ...OK })] as any[], PLAN)).toEqual([]);
  });

  it('rollback 소스가 사전 검증·중단 코드를 실제로 쓴다', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(process.cwd(), 'scripts/loyalty-remediation-rollback.mjs'), 'utf8');
    // 2026-07-29 FAIL-14: 판정이 core 의 evaluateRollbackTarget 으로 올라갔고,
    //   dry-run 과 execute 가 **같은 readAndEvaluate** 를 쓴다(판정 두 벌 금지).
    for (const token of [
      'readAndEvaluate', 'evaluateRollbackTarget', 'guardFirestore',
    ]) expect(src, token).toContain(token);
    // dry-run 도 execute 도 같은 함수를 부른다 — 최소 2회 등장해야 한다.
    expect(src.match(/await readAndEvaluate\(/g) || []).toHaveLength(2);
    expect(src).toMatch(/results\.skipped\.length > 0[\s\S]{0,240}process\.exit\(8\)/);
  });

  it('🔴 판정 사유가 코드 한 곳(core)에만 있다', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const core = readFileSync(resolve(process.cwd(), 'scripts/lib/loyalty-remediation-core.mjs'), 'utf8');
    for (const token of [
      "'correction_missing'", "'already_rolled_back'", "'plan_mismatch'",
      "'stale_rollback'", "'coupon_drift'", "'correction_invalid'",
    ]) expect(core, token).toContain(token);
  });

  it('복원 패치는 여전히 이전 상태 그대로다', () => {
    const FV = { delete: () => '__DELETE__' } as any;
    const patch = buildCouponRestorePatch({
      isRevoked: { existed: false, value: null },
      status: { existed: true, value: 'kept' },
    } as any, FV);
    expect(patch.isRevoked).toBe('__DELETE__');
    expect(patch.status).toBe('kept');
  });
});
