// @vitest-environment jsdom
// (jsdom 제공 localStorage 사용. vitest.config.ts 기본 env=node 라 헤더로 override —
//  레포 관례: 주석 첫 줄 `// @vitest-environment jsdom`. 순수 함수지만 헬퍼가
//  localStorage 전역에 접근하므로 polyfill 대신 jsdom 채택.)
//
// P316 (2026-05-30): 결제 단계에서 막혀 새로고침 → 위저드 입력 소실 + resume modal
// 미노출 회귀 방지.
//
// 운영자 신고: 결제(PlanDetailPage PayPal) SDK 멈춤/광고차단으로 막혀 새로고침하면
// 위저드 입력이 다 날아가고 첫 페이지로 돌아감. resume("이어서 작성") modal 도 안 뜸.
//
// root cause 2건:
//  1. handleGenerate 성공 시 clearWizardSnapshot('planner') 호출 → 결제 직전 autosave 삭제.
//  2. 'planner_paused' 가 write-only dead key — resume modal 중 편집은 거기 저장되는데
//     읽는 곳이 없어 새로고침 시 silent 손실.
//
// 이 테스트는 두 신규 헬퍼 (loadFreshestWizardSnapshot / clearPlannerWizardSnapshot)
// 동작 + 결제 단계 retention 시나리오를 단위로 박제. 순수 함수 (node env, 전역
// localStorage mock 은 tests/unit/setup.ts 가 제공).
import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadWizardSnapshot,
  loadFreshestWizardSnapshot,
  clearWizardSnapshot,
  clearPlannerWizardSnapshot,
  PLANNER_WIZARD_NS,
  PLANNER_WIZARD_PAUSED_NS,
  type WizardSnapshot,
} from '../../src/hooks/useWizardPersistence';

const PREFIX = 'cocotrip:wizard:';

function writeSnap(ns: string, values: Record<string, unknown>, step: number, ts: number) {
  const snap: WizardSnapshot<Record<string, unknown>> = { values, step, ts };
  localStorage.setItem(PREFIX + ns, JSON.stringify(snap));
}

beforeEach(() => {
  localStorage.clear();
});

describe('loadFreshestWizardSnapshot (P316)', () => {
  it('returns null when neither namespace has a snapshot', () => {
    expect(loadFreshestWizardSnapshot('planner', 'planner_paused')).toBeNull();
  });

  it('returns primary when only primary exists (staleSource=null)', () => {
    writeSnap('planner', { mainCity: 'Seoul' }, 1, Date.now());
    const r = loadFreshestWizardSnapshot<Record<string, unknown>>('planner', 'planner_paused');
    expect(r?.source).toBe('planner');
    expect(r?.staleSource).toBeNull();
    expect(r?.snapshot.values.mainCity).toBe('Seoul');
  });

  it('returns paused when only paused exists (previously a dead key)', () => {
    // 핵심 회귀: resume modal 떠 있는 동안 편집 → planner_paused 에만 저장.
    // 이전엔 loadWizardSnapshot('planner') 만 읽어 이 편집이 silent 손실됐음.
    writeSnap('planner_paused', { freeText: 'paused edit' }, 2, Date.now());
    const r = loadFreshestWizardSnapshot<Record<string, unknown>>('planner', 'planner_paused');
    expect(r?.source).toBe('planner_paused');
    expect(r?.staleSource).toBeNull();
    expect(r?.snapshot.values.freeText).toBe('paused edit');
  });

  it('prefers the newer ts when both exist (paused newer)', () => {
    const now = Date.now();
    writeSnap('planner', { freeText: 'old' }, 1, now - 5000);
    writeSnap('planner_paused', { freeText: 'new' }, 3, now);
    const r = loadFreshestWizardSnapshot<Record<string, unknown>>('planner', 'planner_paused');
    expect(r?.source).toBe('planner_paused');
    expect(r?.staleSource).toBe('planner');
    expect(r?.snapshot.values.freeText).toBe('new');
    expect(r?.snapshot.step).toBe(3);
  });

  it('prefers the newer ts when both exist (primary newer)', () => {
    const now = Date.now();
    writeSnap('planner', { freeText: 'new' }, 4, now);
    writeSnap('planner_paused', { freeText: 'old' }, 1, now - 5000);
    const r = loadFreshestWizardSnapshot<Record<string, unknown>>('planner', 'planner_paused');
    expect(r?.source).toBe('planner');
    expect(r?.staleSource).toBe('planner_paused');
    expect(r?.snapshot.values.freeText).toBe('new');
  });

  it('prefers primary on a ts tie (정식 키 우선)', () => {
    const now = Date.now();
    writeSnap('planner', { freeText: 'primary' }, 1, now);
    writeSnap('planner_paused', { freeText: 'paused' }, 2, now);
    const r = loadFreshestWizardSnapshot<Record<string, unknown>>('planner', 'planner_paused');
    expect(r?.source).toBe('planner');
    expect(r?.staleSource).toBe('planner_paused');
    expect(r?.snapshot.values.freeText).toBe('primary');
  });

  it('ignores an expired primary and falls back to a fresh paused', () => {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    // primary 는 25h 전 (loadWizardSnapshot STALE_MS 초과 → null 취급).
    writeSnap('planner', { freeText: 'stale' }, 1, now - dayMs - 60_000);
    writeSnap('planner_paused', { freeText: 'fresh' }, 2, now);
    const r = loadFreshestWizardSnapshot<Record<string, unknown>>('planner', 'planner_paused');
    expect(r?.source).toBe('planner_paused');
    // primary 가 만료라 staleSource 로 잡히지 않음 (애초에 로드 안 됨 — 한쪽만 유효).
    expect(r?.staleSource).toBeNull();
    expect(r?.snapshot.values.freeText).toBe('fresh');
  });
});

describe('clearPlannerWizardSnapshot (P316)', () => {
  it('clears both planner and planner_paused namespaces', () => {
    writeSnap('planner', { mainCity: 'Seoul' }, 1, Date.now());
    writeSnap('planner_paused', { mainCity: 'Busan' }, 2, Date.now());
    clearPlannerWizardSnapshot();
    expect(loadWizardSnapshot('planner')).toBeNull();
    expect(loadWizardSnapshot('planner_paused')).toBeNull();
    expect(localStorage.getItem(PREFIX + 'planner')).toBeNull();
    expect(localStorage.getItem(PREFIX + 'planner_paused')).toBeNull();
  });

  it('exposes stable namespace constants', () => {
    expect(PLANNER_WIZARD_NS).toBe('planner');
    expect(PLANNER_WIZARD_PAUSED_NS).toBe('planner_paused');
  });
});

describe('payment-window retention (P316 regression)', () => {
  // 운영자 신고 시나리오의 단위 표현: WizardForm.handleGenerate 성공 분기가 이제
  // 'planner' 를 보존하고 'planner_paused' 만 지운다 → 결제 단계 새로고침 후
  // /planner 재진입 시 복원 가능.
  it('generation-success path keeps planner but drops planner_paused', () => {
    writeSnap('planner', { mainCity: 'Seoul', dateRangeTo: '2026-06-01' }, 4, Date.now());
    writeSnap('planner_paused', { mainCity: 'Seoul' }, 4, Date.now());

    // 성공 분기가 실제로 하는 일 (P316 fix 후): paused 만 정리.
    clearWizardSnapshot('planner_paused');

    // planner 는 보존 (결제 미완료 대비) → 재진입 시 복원 가능.
    const r = loadFreshestWizardSnapshot<Record<string, unknown>>('planner', 'planner_paused');
    expect(r).not.toBeNull();
    expect(r?.source).toBe('planner');
    expect(r?.snapshot.values.mainCity).toBe('Seoul');
    expect(r?.snapshot.values.dateRangeTo).toBe('2026-06-01');
  });

  it('after payment completes, PlanDetailPage cleanup removes the planner snapshot', () => {
    // 결제 완료 + 소유자 → clearPlannerWizardSnapshot() → 다음 /planner 진입 시 stale 없음.
    writeSnap('planner', { mainCity: 'Seoul', dateRangeTo: '2026-06-01' }, 4, Date.now());
    clearPlannerWizardSnapshot();
    expect(loadFreshestWizardSnapshot('planner', 'planner_paused')).toBeNull();
  });
});
