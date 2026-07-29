/* eslint-disable @typescript-eslint/no-explicit-any -- Firestore 모킹 스캐폴딩. */
/**
 * Codex 반대 검토 `FAIL-1` ~ `FAIL-7` 회귀 잠금 (2026-07-29).
 *
 * PR #1190 은 CI 가 통과했어도 아래 7가지 때문에 운영 실행 승인을 줄 수 없었다.
 * 각 항목의 "고치기 전 상태로 되돌아가면 실패" 하는 테스트를 남긴다.
 *
 * 가짜 Firestore 만 쓴다 — 운영 데이터를 건드리는 자동 테스트는 없다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createFakeFirestore } from '../helpers/fake-firestore.js';
import {
  guardFirestore, loadAccount, planHashOf, buildReport, toMarkdown, checkProductionTarget,
} from '../../scripts/lib/loyalty-remediation-core.mjs';
import {
  executeRemediation, detectStaleUser, selectCouponsToRevoke,
  captureCouponPriorState, COUPON_REVOKE_FIELDS,
} from '../../scripts/loyalty-remediation-execute.mjs';
import { buildCouponRestorePatch } from '../../scripts/loyalty-remediation-rollback.mjs';
import { calculateLoyaltyTier } from '../../api/_shared/loyalty-policy.js';

const UID = 'u-fail-fixes';
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

/** 애매한 이력이 없는 계정 — 원장 재계산 모드가 되도록. */
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

async function analyze(db: any) {
  const guarded = guardFirestore(db, { allowWrites: false });
  const usersSnap = await guarded.collection('users').get();
  const accounts: any[] = [];
  for (const d of usersSnap.docs) accounts.push(await loadAccount(guarded, d, calculateLoyaltyTier));
  return { accounts, stats: guarded.stats };
}

async function runExecute(db: any) {
  const { accounts } = await analyze(db);
  const planHash = planHashOf(accounts);
  const writable = guardFirestore(db, { allowWrites: true });
  const result = await executeRemediation({ db: writable, accounts, planHash });
  return { result, planHash, accounts };
}

describe('FAIL-1 쿠폰이 실제로 사용 중지된다', () => {
  it('🔴 회수 쿠폰에 isRevoked=true 를 쓴다 (결제 5경로 공통 기준)', async () => {
    const db = seed();
    await runExecute(db);
    const c = db.__get(`users/${UID}/coupons/c-unused`)!;
    expect(c.isRevoked).toBe(true);      // 실제 차단 스위치
    expect(c.status).toBe('revoked');    // 감사 보조 표시
  });

  it('결제 경로 5곳이 isRevoked 를 본다 (기준이 흩어지지 않았는지)', () => {
    const paths = [
      'api/applyPromoCode.js', 'api/capturePaypalOrder.js',
      'api/_ai_core/paymentGate.js', 'api/_shared/coupon-charge.js',
      'api/_shared/refund-ledger.js',
    ];
    for (const p of paths) expect(read(p), p).toMatch(/isRevoked\s*[!=]==\s*true/);
  });

  it('🔴 마이페이지 사용 가능 목록도 isRevoked 를 제외한다', () => {
    const src = read('src/hooks/useLoyalty.ts');
    expect(src).toContain('c.isRevoked !== true');
    expect(src).toMatch(/isRevoked\?: boolean/);
  });

  it('이미 회수·사용된 쿠폰은 다시 회수 대상이 아니다 (재실행 수렴)', () => {
    const entries = [
      { ref: { id: 'a' }, snap: { exists: true, data: () => ({ isRevoked: true }) } },
      { ref: { id: 'b' }, snap: { exists: true, data: () => ({ isUsed: true }) } },
      { ref: { id: 'c' }, snap: { exists: true, data: () => ({}) } },
      { ref: { id: 'd' }, snap: { exists: false, data: () => undefined } },
    ] as any[];
    const { willChange, skipped } = selectCouponsToRevoke(entries);
    expect(willChange.map((w: any) => w.ref.id)).toEqual(['c']);
    expect(skipped.map((s: any) => s.reason).sort())
      .toEqual(['already_revoked', 'missing', 'used_meanwhile']);
  });
});

describe('FAIL-2 실행 문서 수가 정확하다', () => {
  it('계정당 = 스냅샷1 + 사용자1 + correction1 + 쿠폰N', async () => {
    const { accounts } = await analyze(seed());
    const a = accounts[0];
    expect(a.docsBreakdown).toEqual({ snapshot: 1, user: 1, correction: 1, coupons: 1 });
    expect(a.docsToWrite).toBe(4);   // 이전 계산(2+N=3)은 복구 스냅샷을 빠뜨렸다
  });

  it('🔴 보고서 문서 수가 실제 쓰기 수와 일치한다', async () => {
    const db = seed();
    const { accounts, stats } = await analyze(db);
    const report = buildReport({ accounts, scanned: 1, stats, projectId: 'x', planHash: 'h' });
    const { result } = await runExecute(db);
    const actual = result.applied.reduce((s: number, r: any) => s + r.docsWritten, 0);
    expect(actual).toBe(report.totals.docsToWrite);
  });
});

describe('FAIL-3 dry-run 이후 정상 변경을 덮어쓰지 않는다', () => {
  it('detectStaleUser 가 바뀐 필드를 잡아낸다', () => {
    const before = { totalSpentUSD: 100, bookingCount: 2, tripCoins: 50, tier: 'Silver' };
    expect(detectStaleUser(before, { ...before })).toEqual([]);
    expect(detectStaleUser(before, { ...before, tripCoins: 60 })).toEqual(['tripCoins']);
    expect(detectStaleUser(before, { totalSpentUSD: 110, bookingCount: 3, tripCoins: 50, tier: 'Gold' }))
      .toEqual(['totalSpentUSD', 'bookingCount', 'tier']);
  });

  it('🔴 부동소수 잔차를 stale 로 오판하지 않는다 (전 계정 차단 사고 방지)', () => {
    // 운영 값은 부동소수 합이라 253204.5400000001 처럼 남는다.
    // dry-run 의 before 는 2자리 반올림 값이므로 같은 반올림으로 비교해야 한다.
    const before = { totalSpentUSD: 253204.54, bookingCount: 260, tripCoins: 756986, tier: 'Platinum' };
    expect(detectStaleUser(before, { ...before, totalSpentUSD: 253204.54000000015 })).toEqual([]);
    // 실제로 1센트가 달라지면 잡아낸다.
    expect(detectStaleUser(before, { ...before, totalSpentUSD: 253204.55 })).toEqual(['totalSpentUSD']);
  });

  it('🔴 실행 직전 정상 적립이 들어오면 그 계정을 건너뛴다 (stale_plan)', async () => {
    const db = seed();
    const { accounts } = await analyze(db);
    const planHash = planHashOf(accounts);

    const u = db.__get(`users/${UID}`)!;
    db.__set(`users/${UID}`, { ...u, tripCoins: (u.tripCoins as number) + 30 });
    const before = JSON.stringify(db.__dump());

    const writable = guardFirestore(db, { allowWrites: true });
    const result = await executeRemediation({ db: writable, accounts, planHash });

    expect(result.applied).toHaveLength(0);
    expect(result.skipped[0].reason).toBe('stale_plan');
    expect(result.skipped[0].diffs).toContain('tripCoins');
    expect(JSON.stringify(db.__dump())).toBe(before);   // 아무것도 안 바뀜
  });

  it('🔴 실행 직전 쿠폰이 사용되면 그 쿠폰은 회수하지 않는다', async () => {
    const db = seed();
    const { accounts } = await analyze(db);
    const planHash = planHashOf(accounts);
    const c = db.__get(`users/${UID}/coupons/c-unused`)!;
    db.__set(`users/${UID}/coupons/c-unused`, { ...c, isUsed: true });

    const writable = guardFirestore(db, { allowWrites: true });
    const result = await executeRemediation({ db: writable, accounts, planHash });
    expect(result.applied[0].couponsRevoked).toBe(0);
    expect(db.__get(`users/${UID}/coupons/c-unused`)!.isRevoked).toBeUndefined();
  });
});

describe('FAIL-4 rollback 이 이전 상태를 정확히 복원한다', () => {
  it('스냅샷은 실제로 바꾼 쿠폰만, 건드리는 모든 필드의 이전 상태를 담는다', async () => {
    const db = seed();
    const { planHash } = await runExecute(db);
    const snap = db.__get(`admin_loyalty_remediation_snapshots/${planHash}/users/${UID}`)!;
    expect(snap.couponsChanged).toHaveLength(1);
    const prior = (snap.couponsChanged as any[])[0].prior;
    for (const f of COUPON_REVOKE_FIELDS) expect(prior[f].existed).toBe(false);
  });

  it('🔴 없던 필드는 지우고, 있던 값은 원래대로 되돌린다', () => {
    const FV = { delete: () => '__DELETE__' } as any;
    const fresh = captureCouponPriorState('x', {});
    const p1 = buildCouponRestorePatch(fresh.prior, FV);
    for (const f of COUPON_REVOKE_FIELDS) expect(p1[f]).toBe('__DELETE__');

    const pre = captureCouponPriorState('y', { isRevoked: true, status: 'revoked', revokedReason: 'other' });
    const p2 = buildCouponRestorePatch(pre.prior, FV);
    expect(p2.isRevoked).toBe(true);          // 다른 이유로 이미 회수돼 있었다면 그대로 둔다
    expect(p2.revokedReason).toBe('other');
    expect(p2.revokedPlan).toBe('__DELETE__');
  });

  it('rollback 은 이 plan 이 바꾼 쿠폰만 건드린다', () => {
    // 2026-07-29 FAIL-9: 쿠폰 확인이 detectCouponDrift 로 올라갔다.
    //   불변식은 더 강해졌다 — 하나라도 어긋나면 그 사용자 rollback 전체를 중단한다.
    const src = read('scripts/loyalty-remediation-rollback.mjs');
    expect(src).toContain("c.revokedPlan !== planHash");
    expect(src).toContain('detectCouponDrift(couponEntries, planHash)');
    expect(src).toContain("'coupon_drift'");
    expect(src).toContain('buildCouponRestorePatch');
    expect(src).not.toMatch(/status:\s*FieldValue\.delete\(\)/);   // 무조건 삭제 금지
  });
});

describe('FAIL-5 Production 대상 확인이 쓰기에서 fail-closed', () => {
  const base = { declaredProdId: 'P', credentialProjectId: 'P', appProjectId: 'P', previewMarkers: '' };

  it('🔴 세 값이 모두 같아야 쓰기를 허용한다', () => {
    expect(checkProductionTarget({ ...base, forWrite: true }).ok).toBe(true);
    expect(checkProductionTarget({ ...base, credentialProjectId: 'Q', forWrite: true }))
      .toEqual({ ok: false, reason: 'credential_project_mismatch' });
    expect(checkProductionTarget({ ...base, appProjectId: 'Q', forWrite: true }))
      .toEqual({ ok: false, reason: 'app_project_mismatch' });
    expect(checkProductionTarget({ ...base, declaredProdId: '', forWrite: true }))
      .toEqual({ ok: false, reason: 'production_project_id_not_declared' });
  });

  it('Preview·Sandbox 표식이 있으면 쓰기 금지', () => {
    for (const marker of ['preview', 'sandbox', 'development']) {
      expect(checkProductionTarget({ ...base, previewMarkers: marker, forWrite: true }).ok, marker).toBe(false);
    }
  });

  it('dry-run 은 불명확해도 읽기를 허용한다', () => {
    expect(checkProductionTarget({ declaredProdId: '', forWrite: false }).ok).toBe(true);
  });

  it('CLI 와 rollback 이 모두 이 확인을 쓴다', () => {
    for (const f of ['scripts/loyalty-remediation.mjs', 'scripts/loyalty-remediation-rollback.mjs']) {
      const src = read(f);
      expect(src, f).toContain('checkProductionTarget(');
      expect(src, f).toContain('forWrite: true');
      expect(src, f).toMatch(/process\.exit\(5\)/);
    }
  });

  it('판정 결과에 프로젝트 ID 를 담지 않는다', () => {
    const v = checkProductionTarget({ ...base, credentialProjectId: 'SECRET-PROJECT', forWrite: true });
    expect(JSON.stringify(v)).not.toContain('SECRET-PROJECT');
  });
});

describe('FAIL-6 부분 실패가 명령 성공으로 보이지 않는다', () => {
  it('🔴 CLI 와 rollback 이 실패 시 비정상 종료한다', () => {
    const cli = read('scripts/loyalty-remediation.mjs');
    expect(cli).toMatch(/result\.failed\.length > 0[\s\S]{0,240}process\.exit\(6\)/);
    expect(cli).toMatch(/stale_plan[\s\S]{0,240}process\.exit\(7\)/);
    const rb = read('scripts/loyalty-remediation-rollback.mjs');
    expect(rb).toMatch(/results\.failed\.length > 0[\s\S]{0,240}process\.exit\(6\)/);
  });

  it('성공·건너뜀·실패를 익명 순번으로 구분한다 (uid 미노출)', async () => {
    const db = seed();
    const { accounts } = await analyze(db);
    const planHash = planHashOf(accounts);
    const writable = guardFirestore(db, { allowWrites: true });
    const withMissing = [...accounts.filter((x: any) => x.changed),
      { ...accounts[0], uid: 'nope', changed: true, _pollutedUnusedCouponIds: [] }];
    const r = await executeRemediation({ db: writable, accounts: withMissing, planHash });
    expect(r.applied.every((x: any) => /^user-\d+$/.test(x.label))).toBe(true);
    expect(r.skipped.some((x: any) => x.reason === 'user_missing')).toBe(true);
    expect(JSON.stringify(r)).not.toContain(UID);
  });

  it('실패한 계정만 다시 실행해도 안전하다 (멱등)', async () => {
    const db = seed();
    const { accounts, planHash } = await runExecute(db);
    const writable = guardFirestore(db, { allowWrites: true });
    const again = await executeRemediation({ db: writable, accounts, planHash });
    expect(again.applied).toHaveLength(0);
    expect(again.skipped[0].reason).toBe('already_corrected');
  });
});

describe('FAIL-7 애매 주문과 귀속 불가 주문을 구분 보고한다', () => {
  it('🔴 보고서 총계에 두 항목이 따로 있다', async () => {
    const { accounts, stats } = await analyze(seed());
    const report = buildReport({ accounts, scanned: 1, stats, projectId: 'x', planHash: 'h' });
    expect(report.totals).toHaveProperty('ambiguousOrdersInAccounts');
    expect(report.totals).not.toHaveProperty('ambiguousOrders');   // 뭉뚱그린 이름 금지
  });

  it('마크다운이 귀속 불가 레거시 주문을 별도 줄로 보여준다', async () => {
    const { accounts, stats } = await analyze(seed());
    const report = buildReport({ accounts, scanned: 1, stats, projectId: 'x', planHash: 'h' });
    (report as any).bookingLedger = { total: 29, withUid: 0, paymentVerified: 0, unattributable: 29, note: 'n' };
    const md = toMarkdown(report);
    expect(md).toContain('계정 내부');
    expect(md).toContain('전역 귀속 불가 레거시 주문: 29건');
  });
});

describe('실행 후 재계산이 같은 오염분을 두 번 빼지 않는다 (실행 대사에서 발견)', () => {
  it('🔴 보정 후 새 dry-run 은 더 뺄 것이 없다고 판정한다', async () => {
    // 오염 이력(pointHistory)은 감사 목적상 삭제하지 않는다. 그래서 다음 실행에서 다시 계산된다.
    // 그걸 그대로 또 빼면 정상 잔액까지 0 으로 밀린다 — 운영 실행 직후 대사에서 잡았다.
    // correction 원장이 "이미 제거한 오염분" 을 들고 있으므로 그만큼 제외한다.
    const db = seed({
      // 애매 이력을 하나 넣어 subtract 모드로 만든다(재계산 모드는 이 경로를 안 탄다).
      [`users/${UID}/pointHistory/legacy-x`]: { type: 'earn', amount: 7, description: 'Manual', createdAt: 9 },
    });
    const first = await analyze(db);
    expect(first.accounts[0].mode).toBe('subtract_pollution_only');
    const planHash = planHashOf(first.accounts);
    const writable = guardFirestore(db, { allowWrites: true });
    await executeRemediation({ db: writable, accounts: first.accounts, planHash });

    const afterValues = db.__get(`users/${UID}`)!;
    const second = await analyze(db);
    expect(second.accounts[0].ledger.remainingPollutedUSD).toBe(0);
    expect(second.accounts[0].ledger.remainingPollutedCoins).toBe(0);
    expect(second.accounts[0].changed).toBe(false);
    expect(second.accounts[0].after.totalSpentUSD).toBe(afterValues.totalSpentUSD);
    expect(second.accounts[0].after.tripCoins).toBe(afterValues.tripCoins);
  });
});
