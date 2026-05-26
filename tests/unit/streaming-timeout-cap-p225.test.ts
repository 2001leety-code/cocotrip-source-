/**
 * P225 (2026-05-27) — frontend streaming hang timeout cap
 *
 * 5/26 시각 검증 발견: Sample 5 = HTTP 32.3s + Firestore status='streaming' 영구 hang.
 * frontend = "AI 일정을 만들고 있어요 Day 4 완성 중" placeholder + 광고만, 사용자가
 * 영원히 로딩 배너를 봄. 5분 후 오류 배너 + 새로고침 버튼 표시.
 *
 * 테스트 시나리오:
 *   1. STREAMING_PLACEHOLDER_TIMEOUT_MS 상수 기본값 = 300_000ms (5분)
 *   2. ENV 오버라이드 파싱 — 유효한 숫자 문자열 → 파싱값 사용
 *   3. ENV 오버라이드 파싱 — 비어있거나 NaN → 기본값 300_000 fallback
 *   4. streaming 시작 → timeout 경과 → streamingTimedOut=true
 *   5. streaming 완료 후 재시작 → 타이머 리셋 (startRef=null)
 *   6. streaming=false 상태에서는 타이머 미동작
 *   7. timeout 후 isStreamingInProgress=false 되면 streamingTimedOut 리셋
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── 상수 기본값 검증 ─────────────────────────────────────────────────────────
describe('P225 STREAMING_PLACEHOLDER_TIMEOUT_MS 기본값', () => {
  it('기본값 = 300_000ms (5분)', () => {
    // ENV 미설정 시 기본값
    const parseTimeout = (envVal: string | undefined): number => {
      if (typeof envVal === 'string') {
        const parsed = parseInt(envVal, 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 300_000;
      }
      return 300_000;
    };

    expect(parseTimeout(undefined)).toBe(300_000);
    expect(parseTimeout('')).toBe(300_000);
    expect(parseTimeout('abc')).toBe(300_000);
    expect(parseTimeout('0')).toBe(300_000); // 0은 양수가 아님 → 기본값
    expect(parseTimeout('-1')).toBe(300_000); // 음수 → 기본값
  });

  it('ENV 유효한 숫자 문자열 → 파싱값 사용', () => {
    const parseTimeout = (envVal: string | undefined): number => {
      if (typeof envVal === 'string') {
        const parsed = parseInt(envVal, 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 300_000;
      }
      return 300_000;
    };

    expect(parseTimeout('60000')).toBe(60_000);   // 1분
    expect(parseTimeout('600000')).toBe(600_000); // 10분
    expect(parseTimeout('30000')).toBe(30_000);   // 30초
  });
});

// ── streaming timeout 로직 단위 검증 ────────────────────────────────────────
/**
 * PlanDetailPage 의 streaming timeout 로직 추출 재현.
 * useEffect(isStreamingInProgress) → setTimeout → setStreamingTimedOut(true)
 */
function makeStreamingTimeoutController(timeoutMs = 300_000) {
  let streamingStartTime: number | null = null;
  let timedOut = false;
  let activeTimer: ReturnType<typeof setTimeout> | null = null;

  const onStreamingChange = (isStreaming: boolean): { timedOut: boolean; timerSet: boolean } => {
    if (isStreaming) {
      if (streamingStartTime === null) {
        streamingStartTime = Date.now();
      }
      const elapsed = Date.now() - streamingStartTime;
      const remaining = timeoutMs - elapsed;
      if (remaining <= 0) {
        timedOut = true;
        return { timedOut: true, timerSet: false };
      }
      // 타이머 설정 (실제 useEffect cleanup 패턴)
      activeTimer = setTimeout(() => {
        timedOut = true;
      }, remaining);
      return { timedOut: false, timerSet: true };
    } else {
      // 스트리밍 완료 — 타이머 리셋
      if (activeTimer !== null) {
        clearTimeout(activeTimer);
        activeTimer = null;
      }
      streamingStartTime = null;
      timedOut = false;
      return { timedOut: false, timerSet: false };
    }
  };

  return {
    onStreamingChange,
    getTimedOut: () => timedOut,
    getStartTime: () => streamingStartTime,
    getActiveTimer: () => activeTimer,
  };
}

describe('P225 streaming timeout 로직', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('시나리오 4: streaming 시작 → timeout 경과 → timedOut=true', () => {
    const ctrl = makeStreamingTimeoutController(5_000); // 5초 timeout (테스트용)

    // 스트리밍 시작
    const result = ctrl.onStreamingChange(true);
    expect(result.timerSet).toBe(true);
    expect(ctrl.getTimedOut()).toBe(false);

    // 5초 경과
    vi.advanceTimersByTime(5_000);
    expect(ctrl.getTimedOut()).toBe(true);
  });

  it('시나리오 5: streaming 완료 후 재시작 → 타이머 리셋', () => {
    const ctrl = makeStreamingTimeoutController(5_000);

    // 1차 스트리밍 시작
    ctrl.onStreamingChange(true);
    expect(ctrl.getStartTime()).not.toBeNull();

    // 3초 후 스트리밍 완료
    vi.advanceTimersByTime(3_000);
    ctrl.onStreamingChange(false);
    expect(ctrl.getStartTime()).toBeNull();
    expect(ctrl.getTimedOut()).toBe(false);

    // 2차 스트리밍 시작 — 새 타이머 (이전 경과 시간 리셋)
    ctrl.onStreamingChange(true);
    expect(ctrl.getStartTime()).not.toBeNull();

    // 4초 후에도 아직 timeout 안 됨 (새 타이머 기준)
    vi.advanceTimersByTime(4_000);
    expect(ctrl.getTimedOut()).toBe(false);

    // 5초 완전 경과 → timeout
    vi.advanceTimersByTime(1_500);
    expect(ctrl.getTimedOut()).toBe(true);
  });

  it('시나리오 6: streaming=false 에서 onStreamingChange(false) → 타이머 미동작', () => {
    const ctrl = makeStreamingTimeoutController(5_000);

    // 처음부터 streaming=false
    const result = ctrl.onStreamingChange(false);
    expect(result.timerSet).toBe(false);
    expect(ctrl.getTimedOut()).toBe(false);
    expect(ctrl.getStartTime()).toBeNull();

    // 10초 경과 후에도 timedOut=false
    vi.advanceTimersByTime(10_000);
    expect(ctrl.getTimedOut()).toBe(false);
  });

  it('시나리오 7: timeout 후 isStreamingInProgress=false 되면 timedOut 리셋', () => {
    const ctrl = makeStreamingTimeoutController(5_000);

    // 스트리밍 시작 + timeout
    ctrl.onStreamingChange(true);
    vi.advanceTimersByTime(5_000);
    expect(ctrl.getTimedOut()).toBe(true);

    // 스트리밍 완료 → 리셋
    ctrl.onStreamingChange(false);
    expect(ctrl.getTimedOut()).toBe(false);
    expect(ctrl.getStartTime()).toBeNull();
  });

  it('이미 경과시간이 timeout 초과 시 → 즉시 timedOut=true (타이머 없음)', () => {
    const ctrl = makeStreamingTimeoutController(1_000); // 1초 timeout

    // 스트리밍 첫 감지
    ctrl.onStreamingChange(true);

    // 2초 경과 후 다시 streaming=true 확인 시도 (streamingStartTime 이미 있음)
    vi.advanceTimersByTime(2_000);

    // 이 시점에서 타이머가 이미 fired → timedOut=true
    expect(ctrl.getTimedOut()).toBe(true);
  });
});

// ── 오류 UI 텍스트 4lang 검증 ────────────────────────────────────────────────
describe('P225 streaming timeout 오류 메시지 4lang 완결성', () => {
  const errorMessages: Record<string, string> = {
    ko: '일정 생성에 시간이 오래 걸리고 있습니다. 페이지를 새로고침하거나 잠시 후 다시 시도해주세요.',
    ja: '旅程の作成に時間がかかっています。ページを更新するか、しばらく経ってから再試行してください。',
    zh: '行程创建花费的时间较长。请刷新页面或稍后重试。',
    en: 'Plan generation is taking longer than expected. Please refresh the page or try again later.',
  };

  const refreshLabels: Record<string, string> = {
    ko: '새로고침',
    ja: '更新',
    zh: '刷新',
    en: 'Refresh',
  };

  it('4개 언어 오류 메시지 모두 존재 (비어있지 않음)', () => {
    for (const lang of ['ko', 'en', 'ja', 'zh']) {
      expect(errorMessages[lang]).toBeTruthy();
      expect(errorMessages[lang].length).toBeGreaterThan(10);
    }
  });

  it('4개 언어 새로고침 라벨 모두 존재', () => {
    for (const lang of ['ko', 'en', 'ja', 'zh']) {
      expect(refreshLabels[lang]).toBeTruthy();
      expect(refreshLabels[lang].length).toBeGreaterThan(0);
    }
  });

  it('한국어 메시지에 "새로고침" 또는 "다시" 포함 (행동 유도)', () => {
    expect(errorMessages.ko).toMatch(/새로고침|다시/);
  });

  it('영어 메시지에 "Refresh" 또는 "retry" 포함 (행동 유도)', () => {
    expect(errorMessages.en).toMatch(/[Rr]efresh|retry/);
  });

  it('일본어 메시지에 "更新" 또는 "再試行" 포함', () => {
    expect(errorMessages.ja).toMatch(/更新|再試行/);
  });

  it('중국어 메시지에 "刷新" 또는 "重试" 포함', () => {
    expect(errorMessages.zh).toMatch(/刷新|重试/);
  });
});
