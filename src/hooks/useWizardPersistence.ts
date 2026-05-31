/**
 * useWizardPersistence — wizard 진행 상태 자동 저장 + 복원 (B9-35).
 *
 * 사용자 신고: AI 플래너 / 차터 / 투어 wizard 진행 중 페이지 떠났다 돌아오면
 * 처음부터 다시 입력 — 좌절. 해결: localStorage 에 debounced (500ms) 자동 저장
 * 후 24h 이내 재진입 시 ResumeWizardModal 로 사용자에게 복원 여부 묻기.
 *
 * 설계:
 * - debounce 500ms — input 매 키 입력마다 저장하면 quota / perf 부담
 * - 24h stale TTL — 그 이상 지난 snapshot 은 사용자 의도 끊긴 것으로 간주
 * - try/catch — private mode / quota exceeded / SSR 에서 silent fail
 * - type 별 namespace — 'planner' | 'charter' | 'tour' 동시 진행 가능
 *
 * PR #455 (Audit W-H15 — 2026-05-16): silent quota overflow 완화. 이전엔
 * setItem 의 catch 가 아무것도 안 함 → quota 가득 차면 wizard 진행상태
 * 더는 저장 안 되고 사용자 다음 세션에서 모두 잃음. 이제 quota 에러를
 * 감지하면 (1) 다른 stale `cocotrip:wizard:*` 키 정리 후 한 번 재시도,
 * (2) 두 번째 실패 시 console.warn (structured) 으로 telemetry-style log.
 * 단순 swallow 대신 명시 신호 — Sentry 에 잡혀 운영자가 패턴 파악 가능.
 *
 * 외부 사용 패턴 (3 wizard 동일):
 * 1. 첫 마운트: const snap = loadWizardSnapshot('<type>'); 있으면 모달 표시
 * 2. 진행 중: useWizardPersistence('<type>', values, step) — 자동 저장
 * 3. 완료/명시 reset: clearWizardSnapshot('<type>')
 */
import { useEffect } from 'react';

const DEBOUNCE_MS = 500;
const STORAGE_PREFIX = 'cocotrip:wizard:';
const STALE_MS = 24 * 60 * 60 * 1000; // 24h

export interface WizardSnapshot<T> {
  values: T;       // wizard state (각 wizard 마다 다름 — Record<string, unknown> 권장)
  step: number;    // 현재 step
  ts: number;      // Date.now() 저장 시점
}

/**
 * Detect QuotaExceededError across browser flavors:
 *   - Modern: error.name === 'QuotaExceededError'
 *   - Safari (older): error.code === 22
 *   - Firefox: error.name === 'NS_ERROR_DOM_QUOTA_REACHED' / code === 1014
 */
function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; code?: number };
  return (
    e.name === 'QuotaExceededError' ||
    e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    e.code === 22 ||
    e.code === 1014
  );
}

/**
 * Sweep stale wizard snapshots OTHER than `keepType` so a retry has space.
 * Returns the number of keys removed (for the warn-log breadcrumb).
 */
function sweepStaleWizardSnapshots(keepType: string): number {
  let removed = 0;
  try {
    const now = Date.now();
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(STORAGE_PREFIX)) continue;
      if (k === STORAGE_PREFIX + keepType) continue;
      const raw = localStorage.getItem(k);
      if (!raw) { toRemove.push(k); continue; }
      try {
        const snap = JSON.parse(raw) as { ts?: number };
        const age = now - (typeof snap.ts === 'number' ? snap.ts : 0);
        if (age > STALE_MS) toRemove.push(k);
      } catch {
        // Corrupted entry → cheap win to remove.
        toRemove.push(k);
      }
    }
    for (const k of toRemove) {
      try { localStorage.removeItem(k); removed++; } catch { /* ignore */ }
    }
  } catch {
    // Iterating localStorage shouldn't throw, but defend anyway.
  }
  return removed;
}

/**
 * setItem with quota-recovery: on QuotaExceeded, sweep stale wizard
 * snapshots once and retry. On second failure (real quota pressure
 * unrelated to our keys), structured-warn-log so it surfaces in Sentry.
 */
function safeWizardSetItem(type: string, payload: string): { ok: boolean; reason?: string } {
  const key = STORAGE_PREFIX + type;
  try {
    localStorage.setItem(key, payload);
    return { ok: true };
  } catch (err) {
    if (!isQuotaError(err)) {
      // Private mode / iframe sandbox / SSR — original silent path.
      return { ok: false, reason: 'unavailable' };
    }
    const swept = sweepStaleWizardSnapshots(type);
    try {
      localStorage.setItem(key, payload);
      return { ok: true };
    } catch (err2) {
      // Still failing after sweep — real quota pressure outside our keys.
      // Structured warn so Sentry / DevTools surfaces a pattern, not a silent loss.
      console.warn('[wizard-persistence] localStorage quota exceeded, snapshot dropped', {
        type,
        payloadSize: payload.length,
        sweptStaleSnapshots: swept,
        secondAttemptError: isQuotaError(err2) ? 'quota' : 'other',
      });
      return { ok: false, reason: 'quota' };
    }
  }
}

/**
 * Wizard state 변경마다 debounced localStorage 저장.
 * - 500ms 동안 추가 변경이 없으면 그제서야 write.
 * - 컴포넌트 unmount 시 pending timer cleanup (write 안 됨 — 직전 저장이 가장 최신).
 */
export function useWizardPersistence<T>(
  type: string,
  values: T,
  step: number,
): void {
  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        const snap: WizardSnapshot<T> = { values, step, ts: Date.now() };
        safeWizardSetItem(type, JSON.stringify(snap));
      } catch { /* JSON.stringify failure (cycle / BigInt) — silent */ }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [type, values, step]);
}

/**
 * 저장된 snapshot 로드. 없거나 24h 초과시 null.
 * - JSON 파싱 실패하면 null + 자동 정리 (다음 호출에선 깨끗).
 */
export function loadWizardSnapshot<T>(type: string): WizardSnapshot<T> | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + type);
    if (!raw) return null;
    const snap = JSON.parse(raw) as WizardSnapshot<T>;
    // ts 누락 / NaN 도 stale 로 처리
    const age = Date.now() - (typeof snap.ts === 'number' ? snap.ts : 0);
    if (age > STALE_MS) {
      try { localStorage.removeItem(STORAGE_PREFIX + type); } catch { /* silent */ }
      return null;
    }
    return snap;
  } catch {
    // 파싱 실패 시 손상된 키 제거
    try { localStorage.removeItem(STORAGE_PREFIX + type); } catch { /* silent */ }
    return null;
  }
}

/** Wizard 완료 또는 사용자 "새로 시작" 선택 시 호출. */
export function clearWizardSnapshot(type: string): void {
  try { localStorage.removeItem(STORAGE_PREFIX + type); } catch { /* silent */ }
}

/**
 * PR-D (2026-06-01): 이미 저장돼 있는 snapshot 의 values.dirtyExit 플래그를 동기 기록.
 *
 * 용도: WizardForm 의 pagehide 리스너가 "입력 도중 페이지가 teardown 됨(새로고침/탭닫힘)"
 * 신호를 남기기 위함. pagehide 핸들러는 동기적으로 끝나야 하므로(비동기/디바운스 불가)
 * 여기서 즉시 read-modify-write 한다. resume modal 의 좁힌 트리거가 이 마커로
 * "정상 이탈 vs 사고 이탈" 을 구분한다.
 *
 * 설계 원칙:
 *  - snapshot 이 없으면 아무것도 하지 않음 (새로 만들지 않음 — 빈 noise 방지).
 *  - dirty=false 로도 호출 가능 (정상 전이 시 마커 해제용). 단 snapshot 자체는 보존
 *    (P316: 결제 단계 retention 깨지 않음).
 *  - ts(저장 시각) 는 건드리지 않음 — stale 판정/최신 선택 로직 영향 0.
 *  - try/catch — private mode / quota / SSR silent.
 */
export function markWizardDirtyExit(type: string, dirty: boolean = true): void {
  try {
    const key = STORAGE_PREFIX + type;
    const raw = localStorage.getItem(key);
    if (!raw) return; // snapshot 없음 → 만들지 않음.
    const snap = JSON.parse(raw) as WizardSnapshot<Record<string, unknown>>;
    if (!snap || typeof snap !== 'object' || !snap.values || typeof snap.values !== 'object') return;
    (snap.values as Record<string, unknown>).dirtyExit = dirty;
    localStorage.setItem(key, JSON.stringify(snap));
  } catch {
    // 파싱/quota/SSR 실패 — silent (마커 누락 시 trigger 가 보수적으로 modal 미노출).
  }
}

// P316 (2026-05-30): planner 위저드 namespace 상수. 결제 단계에서 막혀 새로고침 →
// 입력 소실 + resume 미노출 회귀 fix 의 일부.
export const PLANNER_WIZARD_NS = 'planner';
export const PLANNER_WIZARD_PAUSED_NS = 'planner_paused';

export interface FreshestSnapshotResult<T> {
  snapshot: WizardSnapshot<T>;
  /** 채택된 namespace (호출처가 반대편 stale 키 정리에 사용). */
  source: string;
  /** 채택되지 않은 다른 namespace (둘 다 존재했을 때만). 정리 대상. */
  staleSource: string | null;
}

/**
 * P316 (2026-05-30): 두 namespace 중 ts(저장 시각) 가 더 최신인 snapshot 반환.
 *
 * 배경: resume modal 이 떠 있는 동안의 편집은 'planner_paused' 로 격리 저장되는데
 * (WizardForm 의 useWizardPersistence 호출처가 resumeOpen 일 때 namespace 전환),
 * 그 키를 읽는 곳이 없어 새로고침 시 그 편집이 silent 손실 + orphan 키로 남던
 * write-only dead key 였음. 이제 modal 이 열린 채 새로고침해도 가장 최근 편집 복원.
 *
 * 동작: 한쪽만 존재하면 그쪽 (staleSource=null). 둘 다 존재하면 ts 최신 우선,
 * 동률이면 primary (정식 키) 우선 + 반대편을 staleSource 로 반환 (호출처 정리용).
 * 둘 다 없거나 만료면 null. (loadWizardSnapshot 이 24h 만료를 자체 처리.)
 */
export function loadFreshestWizardSnapshot<T>(
  primary: string,
  paused: string,
): FreshestSnapshotResult<T> | null {
  const a = loadWizardSnapshot<T>(primary);
  const b = loadWizardSnapshot<T>(paused);
  if (!a && !b) return null;
  if (a && !b) return { snapshot: a, source: primary, staleSource: null };
  if (b && !a) return { snapshot: b, source: paused, staleSource: null };
  // 둘 다 존재 — ts 최신 우선. 동률이면 primary (정식 키) 우선.
  if ((b as WizardSnapshot<T>).ts > (a as WizardSnapshot<T>).ts) {
    return { snapshot: b as WizardSnapshot<T>, source: paused, staleSource: primary };
  }
  return { snapshot: a as WizardSnapshot<T>, source: primary, staleSource: paused };
}

/**
 * P316 (2026-05-30): planner 위저드 autosave 두 namespace 를 한 번에 정리.
 * 생성 성공 시점에는 결제 미완료 가능성(SDK 멈춤/광고차단/새로고침) 때문에 'planner'
 * 를 보존하지만, 결제가 끝나 plan 이 확정되면 (PlanDetailPage paid+owner) 더 이상
 * resume 가 필요 없으므로 여기서 둘 다 제거 → 결제 완료 후 /planner 재진입 시
 * stale "이어서 작성" modal 미노출.
 */
export function clearPlannerWizardSnapshot(): void {
  clearWizardSnapshot(PLANNER_WIZARD_NS);
  clearWizardSnapshot(PLANNER_WIZARD_PAUSED_NS);
}

// Test-only exports — kept off the default surface so they don't appear
// in IDE autocomplete for product code.
export const __testing = { isQuotaError, sweepStaleWizardSnapshots, safeWizardSetItem, STORAGE_PREFIX, STALE_MS };
