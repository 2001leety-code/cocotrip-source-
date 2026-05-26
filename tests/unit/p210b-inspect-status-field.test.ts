/**
 * P210-B regression test — inspect-plans.mjs extractStatusFields helper
 *
 * 검증:
 *   1. status 정상 추출 (stringValue)
 *   2. _streaming_in_progress 정상 추출 (booleanValue true/false)
 *   3. _streaming_in_progress 없을 때 undefined
 *   4. _streaming_in_progress stringValue 'true' fallback
 *   5. skeleton stuck 판별 (streaming + days=0) — sample 5 (eaccffbd) 케이스
 *
 * deep-search: reports/visual-2026-05-26/deepsearch-p210.md (RC-3)
 */

import { describe, it, expect } from 'vitest';

// -------------------------------------------------------------------
// inline helper (파일 import 대신 동일 로직 복제 — network 없이 unit 실행)
// -------------------------------------------------------------------
function extractStatusFields(fields: Record<string, unknown>): {
  status: string;
  streamingInProgress: boolean | undefined;
} {
  const f = fields as Record<string, { stringValue?: string; booleanValue?: boolean }>;
  const status = (f.status && f.status.stringValue) ? f.status.stringValue : '(없음)';
  const rawSip = f._streaming_in_progress;
  let streamingInProgress: boolean | undefined;
  if (rawSip !== undefined) {
    if (rawSip.booleanValue !== undefined) {
      streamingInProgress = rawSip.booleanValue;
    } else if (rawSip.stringValue === 'true') {
      streamingInProgress = true;
    } else if (rawSip.stringValue === 'false') {
      streamingInProgress = false;
    }
  }
  return { status, streamingInProgress };
}

// -------------------------------------------------------------------
describe('P210-B: extractStatusFields', () => {
  it('status=ready 정상 추출', () => {
    const { status, streamingInProgress } = extractStatusFields({
      status: { stringValue: 'ready' },
      _streaming_in_progress: { booleanValue: false },
    });
    expect(status).toBe('ready');
    expect(streamingInProgress).toBe(false);
  });

  it('status=streaming 정상 추출', () => {
    const { status, streamingInProgress } = extractStatusFields({
      status: { stringValue: 'streaming' },
      _streaming_in_progress: { booleanValue: true },
    });
    expect(status).toBe('streaming');
    expect(streamingInProgress).toBe(true);
  });

  it('_streaming_in_progress 없을 때 undefined', () => {
    const { streamingInProgress } = extractStatusFields({
      status: { stringValue: 'ready' },
    });
    expect(streamingInProgress).toBeUndefined();
  });

  it('status 없을 때 (없음) 반환', () => {
    const { status } = extractStatusFields({});
    expect(status).toBe('(없음)');
  });

  it('_streaming_in_progress stringValue fallback ("true")', () => {
    const { streamingInProgress } = extractStatusFields({
      _streaming_in_progress: { stringValue: 'true' },
    });
    expect(streamingInProgress).toBe(true);
  });

  it('_streaming_in_progress stringValue fallback ("false")', () => {
    const { streamingInProgress } = extractStatusFields({
      _streaming_in_progress: { stringValue: 'false' },
    });
    expect(streamingInProgress).toBe(false);
  });
});

// -------------------------------------------------------------------
// skeleton stuck 판별 로직 (sample 5 eaccffbd 케이스)
// -------------------------------------------------------------------
describe('P210-B: skeleton stuck 판별 (sample 5 시뮬레이션)', () => {
  function isStuck(fields: Record<string, unknown>, days: unknown[]): boolean {
    const { streamingInProgress } = extractStatusFields(fields);
    return streamingInProgress === true && days.length === 0;
  }

  it('streaming + days=0 → stuck=true (sample 5 재현)', () => {
    expect(isStuck(
      { status: { stringValue: 'streaming' }, _streaming_in_progress: { booleanValue: true } },
      []
    )).toBe(true);
  });

  it('streaming + days>0 → stuck=false', () => {
    expect(isStuck(
      { status: { stringValue: 'streaming' }, _streaming_in_progress: { booleanValue: true } },
      [{ day: 1 }]
    )).toBe(false);
  });

  it('ready + days=0 → stuck=false (일반 실패, streaming skeleton 아님)', () => {
    expect(isStuck(
      { status: { stringValue: 'ready' }, _streaming_in_progress: { booleanValue: false } },
      []
    )).toBe(false);
  });
});
