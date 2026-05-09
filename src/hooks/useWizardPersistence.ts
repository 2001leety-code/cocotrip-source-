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
        localStorage.setItem(STORAGE_PREFIX + type, JSON.stringify(snap));
      } catch { /* quota / private mode — silent fail */ }
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
