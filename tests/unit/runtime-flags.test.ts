/**
 * 어드민 조종석 런타임 토글 (2026-06-06) — fail-safe + 화이트리스트 + 마진가드 런타임 override.
 * 안전: adminDb 없음/읽기 실패 → 기본값 OFF (장애 시 기존 동작 유지). 화이트리스트 외 키/non-boolean 거부.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getRuntimeFlags, setRuntimeFlag, __resetRuntimeFlagsCache } from '../../api/_shared/runtime-flags.js';
import { resolveTransferCheckoutKrw } from '../../api/_shared/charter-transfer-price.js';

const SPEC = JSON.parse(readFileSync(join(process.cwd(), 'api/_pricing_spec.json'), 'utf-8'));

describe('getRuntimeFlags — fail-safe (장애 시 기본값 OFF)', () => {
  it('adminDb 없으면 기본값 OFF', async () => {
    __resetRuntimeFlagsCache();
    const flags = await getRuntimeFlags(null);
    expect(flags.transfer_margin_guard_enabled).toBe(false);
  });
  it('Firestore 읽기 실패 → 기본값 OFF (예외 삼킴)', async () => {
    __resetRuntimeFlagsCache();
    const badDb = { collection: () => ({ doc: () => ({ get: async () => { throw new Error('boom'); } }) }) };
    const flags = await getRuntimeFlags(badDb);
    expect(flags.transfer_margin_guard_enabled).toBe(false);
  });
  it('Firestore 값 읽기 (boolean 만 신뢰, junk 무시)', async () => {
    __resetRuntimeFlagsCache();
    const db = { collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ transfer_margin_guard_enabled: true, junk: 'x' }) }) }) }) };
    const flags = await getRuntimeFlags(db);
    expect(flags.transfer_margin_guard_enabled).toBe(true);
  });
  it('boolean 아닌 값은 무시하고 기본값', async () => {
    __resetRuntimeFlagsCache();
    const db = { collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ transfer_margin_guard_enabled: 'true' }) }) }) }) };
    const flags = await getRuntimeFlags(db);
    expect(flags.transfer_margin_guard_enabled).toBe(false);
  });
});

describe('setRuntimeFlag — 화이트리스트 + boolean 검증 (보안)', () => {
  it('화이트리스트 외 키 거부', async () => {
    expect(await setRuntimeFlag({}, 'hacker_flag', true, 'a')).toBe(false);
  });
  it('non-boolean 값 거부', async () => {
    expect(await setRuntimeFlag({}, 'transfer_margin_guard_enabled', 'yes' as never, 'a')).toBe(false);
  });
  it('adminDb 없으면 거부', async () => {
    expect(await setRuntimeFlag(null, 'transfer_margin_guard_enabled', true, 'a')).toBe(false);
  });
});

describe('resolveTransferCheckoutKrw — 런타임 토글 override', () => {
  const body = { originKey: 'ICN', destKey: 'BUSAN', tripType: 'oneway', vehicle: 'staria' };
  it('opts 미지정 → spec 기본(enabled:false) → 가드 무시 (가격 반환)', () => {
    expect(resolveTransferCheckoutKrw(SPEC, body, true)).toBeGreaterThan(0);
  });
  it('런타임 OFF → 가드 무시 (가격 반환)', () => {
    expect(resolveTransferCheckoutKrw(SPEC, body, true, { marginGuardEnabled: false })).toBeGreaterThan(0);
  });
  it('런타임 ON → 가드 활성 (장거리 편도 마진미달 → null 협의)', () => {
    expect(resolveTransferCheckoutKrw(SPEC, body, true, { marginGuardEnabled: true })).toBeNull();
  });
  it('런타임 ON 이어도 단거리(ICN→강남)는 통과', () => {
    const r = resolveTransferCheckoutKrw(SPEC, { ...body, destKey: 'SEL_GANGNAM' }, true, { marginGuardEnabled: true });
    expect(r).toBe(138_320);
  });
});
