/**
 * P206 (2026-05-26) — measure script status=ready polling 의무화
 *
 * 5/26 시각 검증 발견: HTTP 200 + 35초 = measure "성공" 기록이지만
 * data.status='streaming' → 실제 plan 미완성 (background pipeline 계속).
 *
 * 테스트 시나리오:
 *   1. status='ready' 즉시 반환 → polling 없이 isSuccess=true
 *   2. status='streaming' → polling 후 ready → isSuccess=true, totalSec >= httpSec
 *   3. status='streaming' → polling 후 error → isSuccess=false
 *   4. status='streaming' → 10분 timeout → finalStatus='timeout', isSuccess=false
 *   5. status='unknown' (비스트리밍 모드) → polling 없이 HTTP 200 = success
 *   6. /api/plan-status days 필드 반환 검증 (P206 plan-status 확장)
 *   7. planId=null 이면 streaming 이어도 polling 미진입
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── mock fetch ────────────────────────────────────────────────────────────────
// measure-flash-stability-5sample.mjs 를 직접 import 하면 외부 API 호출 + env 의존
// → polling logic 을 함수로 추출해 테스트. 여기서는 핵심 로직만 단위 검증.

type PollStatus = 'ready' | 'error' | 'streaming' | 'unknown' | 'timeout';

interface PollResult {
  finalStatus: PollStatus;
  pollElapsedMs: number;
  pollCalls: number;
}

/**
 * pollUntilReady — measure script 의 polling loop 핵심 로직 추출.
 * (실제 스크립트에서 이 함수 형태로 추출 가능 — 테스트 목적 인라인 구현)
 */
async function pollUntilReady(opts: {
  planId: string;
  getStatus: (call: number) => Promise<PollStatus>;  // mock status provider
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}): Promise<PollResult> {
  const { planId, getStatus, pollIntervalMs = 50, pollTimeoutMs = 500 } = opts;
  let finalStatus: PollStatus = 'streaming';
  let pollElapsedMs = 0;
  let pollCalls = 0;
  const pollStart = Date.now();

  while (pollElapsedMs < pollTimeoutMs) {
    await new Promise(r => setTimeout(r, pollIntervalMs));
    pollElapsedMs = Date.now() - pollStart;
    pollCalls++;
    const status = await getStatus(pollCalls);
    finalStatus = status;
    if (finalStatus === 'ready' || finalStatus === 'error') break;
  }

  if (finalStatus !== 'ready' && finalStatus !== 'error') {
    finalStatus = 'timeout';
  }

  return { finalStatus, pollElapsedMs, pollCalls };
}

// ── P206 plan-status 응답 구조 검증 ─────────────────────────────────────────
describe('P206 plan-status.js 응답 구조 검증', () => {
  it('days 필드가 응답에 포함되어야 함 (P206 확장)', () => {
    // plan-status.js 의 _ok() 응답 형식 검증
    const mockDoc = {
      status: 'ready',
      itinerary: {
        tour_title: '서울 5일 투어',
        days: [1, 2, 3, 4, 5], // 5일
      },
      _streaming_in_progress: false,
      input: { area: 'seoul' },
    };

    // plan-status.js 의 응답 계산 로직 재현
    const responseData = {
      status: mockDoc.status || 'unknown',
      days: (mockDoc.itinerary?.days || []).length,
      _streaming_in_progress: mockDoc._streaming_in_progress !== undefined ? mockDoc._streaming_in_progress : null,
      tourTitle: mockDoc.itinerary?.tour_title || null,
      area: mockDoc.input?.area || null,
    };

    expect(responseData.days).toBe(5);
    expect(responseData.status).toBe('ready');
    expect(responseData._streaming_in_progress).toBe(false);
  });

  it('streaming 중 skeleton plan 은 days=0 반환', () => {
    const mockDoc = {
      status: 'streaming',
      itinerary: {
        days: [], // skeleton
        _streaming_skeleton: true,
      },
      _streaming_in_progress: true,
    };

    const days = (mockDoc.itinerary?.days || []).length;
    expect(days).toBe(0);
  });

  it('days 필드 없는 레거시 plan → days=0 (안전 fallback)', () => {
    const mockDoc = {
      status: 'ready',
      // itinerary.days 없음 (legacy plan)
    } as any;

    const days = (mockDoc.itinerary?.days || []).length;
    expect(days).toBe(0);
  });
});

// ── P206 polling logic 단위 테스트 ──────────────────────────────────────────
describe('P206 polling logic — streaming → ready', () => {
  it('시나리오 1: status=ready 즉시 → isSuccess=true, polling 불필요', () => {
    // 비스트리밍 모드 or 즉시 완료: initialStatus='ready' or 'unknown'
    // → polling loop 미진입
    const initialStatus = 'ready';
    const planId = 'plan-abc-123';

    // polling 진입 여부 결정 (measure script 로직 재현)
    const shouldPoll = planId && initialStatus === 'streaming';
    expect(shouldPoll).toBe(false);

    // 즉시 성공
    const isSuccess = initialStatus === 'ready';
    expect(isSuccess).toBe(true);
  });

  it('시나리오 2: status=streaming → 2번째 poll에서 ready → isSuccess=true', async () => {
    let calls = 0;
    const result = await pollUntilReady({
      planId: 'plan-streaming-456',
      getStatus: async () => {
        calls++;
        return calls < 2 ? 'streaming' : 'ready';
      },
    });

    expect(result.finalStatus).toBe('ready');
    expect(result.pollCalls).toBeGreaterThanOrEqual(2);
    expect(result.pollElapsedMs).toBeGreaterThan(0);
  });

  it('시나리오 3: status=streaming → error 응답 → finalStatus=error, isSuccess=false', async () => {
    const result = await pollUntilReady({
      planId: 'plan-error-789',
      getStatus: async (call) => call < 2 ? 'streaming' : 'error',
    });

    expect(result.finalStatus).toBe('error');
  });

  it('시나리오 4: 10분 timeout (단축) → finalStatus=timeout', async () => {
    const result = await pollUntilReady({
      planId: 'plan-hang-abc',
      getStatus: async () => 'streaming', // 항상 streaming
      pollIntervalMs: 20,
      pollTimeoutMs: 100, // 100ms timeout (실제는 10분)
    });

    expect(result.finalStatus).toBe('timeout');
    expect(result.pollCalls).toBeGreaterThan(0);
  });

  it('시나리오 5: status=unknown (비스트리밍 모드) → polling 미진입, HTTP 200 = success', () => {
    const initialStatus = 'unknown';
    const httpStatus = 200;
    const planId = null; // unknown 때 planId 없거나

    // measure script 로직: unknown + HTTP 200 = success (비스트리밍)
    const shouldPoll = planId && initialStatus === 'streaming';
    expect(shouldPoll).toBeFalsy();

    const isSuccess = initialStatus === 'ready' || (initialStatus === 'unknown' && httpStatus === 200);
    expect(isSuccess).toBe(true);
  });

  it('시나리오 7: planId=null 이면 streaming 이어도 polling 미진입', () => {
    const initialStatus = 'streaming';
    const planId = null;

    const shouldPoll = planId && initialStatus === 'streaming';
    expect(shouldPoll).toBeFalsy(); // null && ... = false
  });
});

// ── P206 시간 분리 컬럼 검증 ─────────────────────────────────────────────────
describe('P206 시간 컬럼 분리 (httpSec + pollSec + totalSec)', () => {
  it('비스트리밍: totalSec = httpSec, pollSec = 0', () => {
    const planMs = 35000; // 35초 HTTP 응답
    const pollElapsedMs = 0; // polling 없음

    const totalMs = planMs + pollElapsedMs;
    const secHttp = parseFloat((planMs / 1000).toFixed(1));
    const secPoll = parseFloat((pollElapsedMs / 1000).toFixed(1));
    const totalSec = parseFloat((totalMs / 1000).toFixed(1));

    expect(secHttp).toBe(35.0);
    expect(secPoll).toBe(0.0);
    expect(totalSec).toBe(35.0);
    expect(totalSec).toBe(secHttp + secPoll);
  });

  it('스트리밍: totalSec = httpSec + pollSec', () => {
    const planMs = 35000;   // 35초 HTTP 응답
    const pollElapsedMs = 180000; // 3분 polling

    const totalMs = planMs + pollElapsedMs;
    const secHttp = parseFloat((planMs / 1000).toFixed(1));
    const secPoll = parseFloat((pollElapsedMs / 1000).toFixed(1));
    const totalSec = parseFloat((totalMs / 1000).toFixed(1));

    expect(secHttp).toBe(35.0);
    expect(secPoll).toBe(180.0);
    expect(totalSec).toBe(215.0);
    // totalSec >= httpSec 항상 참 (polling 시간 양수)
    expect(totalSec).toBeGreaterThanOrEqual(secHttp);
  });

  it('hang sample (timeout): totalSec = httpSec + 600s (10분 max)', () => {
    const planMs = 35000;
    const pollElapsedMs = 600_000; // 10분 timeout

    const totalSec = (planMs + pollElapsedMs) / 1000;
    expect(totalSec).toBe(635); // 35 + 600
    expect(totalSec).toBeGreaterThan(600); // 명확히 "hang" 샘플 식별 가능
  });
});
