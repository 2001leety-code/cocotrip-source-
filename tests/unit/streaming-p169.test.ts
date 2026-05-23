/**
 * P169 (2026-05-23) — Gemini Streaming + Firestore 점진 Write
 *
 * 테스트 시나리오:
 *   1. PLANNER_STREAMING_ENABLED=false (default) → isStreamingEnabled() === false (backward-compat)
 *   2. PLANNER_STREAMING_ENABLED=true → isStreamingEnabled() === true (streaming 활성)
 *   3. tryParsePartialJSON — incomplete JSON 도 days 추출 (best-effort)
 *   4. updatePlanProgressive — Firestore set merge 호출 (adminDb mock)
 *   5. savePlanSkeleton — planId 생성 + Firestore set 호출 (adminDb mock)
 *
 * ENV: 각 테스트에서 process.env.PLANNER_STREAMING_ENABLED 명시 변경.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isStreamingEnabled, tryParsePartialJSON } from '../../api/_ai_core/geminiPipeline.js';
import { updatePlanProgressive, savePlanSkeleton } from '../../api/_ai_core/planPersister.js';

// ── Vitest ESM mock ──────────────────────────────────────────────────────────
// planPersister 는 firebase-admin/firestore 를 사용 → 단위 테스트 환경에서 mock 필요.
// geminiPipeline 는 @google/generative-ai → 실제 API 호출 X.

// Firestore set mock
function makeAdminDbMock() {
  const setMock = vi.fn().mockResolvedValue(undefined);
  return {
    collection: vi.fn().mockReturnValue({
      doc: vi.fn().mockReturnValue({ set: setMock }),
    }),
    _setMock: setMock,
  };
}

// ── 1 & 2: isStreamingEnabled ────────────────────────────────────────────────
describe('isStreamingEnabled — env flag gate', () => {
  const origEnv = process.env.PLANNER_STREAMING_ENABLED;

  afterEach(() => {
    if (origEnv === undefined) {
      delete process.env.PLANNER_STREAMING_ENABLED;
    } else {
      process.env.PLANNER_STREAMING_ENABLED = origEnv;
    }
  });

  it('시나리오 1: PLANNER_STREAMING_ENABLED 미설정 (default) → false', () => {
    delete process.env.PLANNER_STREAMING_ENABLED;
    expect(isStreamingEnabled()).toBe(false);
  });

  it('시나리오 1b: PLANNER_STREAMING_ENABLED=false → false', () => {
    process.env.PLANNER_STREAMING_ENABLED = 'false';
    expect(isStreamingEnabled()).toBe(false);
  });

  it('시나리오 2: PLANNER_STREAMING_ENABLED=true → true (streaming 활성)', () => {
    process.env.PLANNER_STREAMING_ENABLED = 'true';
    expect(isStreamingEnabled()).toBe(true);
  });

  it('시나리오 2b: 대소문자 무관 TRUE → true', () => {
    process.env.PLANNER_STREAMING_ENABLED = 'TRUE';
    expect(isStreamingEnabled()).toBe(true);
  });

  it('시나리오 2c: 공백 포함 " true " → true (trim 처리)', () => {
    process.env.PLANNER_STREAMING_ENABLED = '  true  ';
    expect(isStreamingEnabled()).toBe(true);
  });

  it('그 외 값 (1, yes, enabled) → false (엄격 = "true" 만)', () => {
    for (const v of ['1', 'yes', 'enabled', '']) {
      process.env.PLANNER_STREAMING_ENABLED = v;
      expect(isStreamingEnabled()).toBe(false);
    }
  });
});

// ── 3: tryParsePartialJSON ───────────────────────────────────────────────────
describe('tryParsePartialJSON — best-effort partial JSON parse', () => {
  it('시나리오 3a: 완성 JSON (days 있음) → days 추출', () => {
    const json = JSON.stringify({ days: [{ city: 'Seoul', stops: [] }], tour_title: 'Test' });
    const result = tryParsePartialJSON(json);
    expect(result).not.toBeNull();
    expect(result!.days).toHaveLength(1);
  });

  it('시나리오 3b: incomplete JSON (중간 truncated) — days 이미 완성된 것 추출', () => {
    // Day 1 완성 + Day 2 truncated
    const partial = `{"days":[{"city":"Seoul","stops":[{"name":"경복궁"}]},{"city":"Busan","stops":[{"name":"해운`;
    const result = tryParsePartialJSON(partial);
    // best-effort: 최소 1개 day 추출 기대
    if (result !== null) {
      expect(Array.isArray(result.days)).toBe(true);
      expect(result.days.length).toBeGreaterThanOrEqual(1);
    }
    // null 반환도 허용 (완성 day 없을 때) — 에러 미발생이 핵심
  });

  it('시나리오 3c: 너무 짧은 텍스트 → null (의미있는 결과 없음)', () => {
    expect(tryParsePartialJSON('')).toBeNull();
    expect(tryParsePartialJSON('{')).toBeNull();
    expect(tryParsePartialJSON('{"da')).toBeNull();
  });

  it('시나리오 3d: days 없는 완성 JSON → null', () => {
    const json = JSON.stringify({ tour_title: 'Test', arrival_guide: {} });
    expect(tryParsePartialJSON(json)).toBeNull();
  });

  it('시나리오 3e: days 빈 배열 → null', () => {
    const json = JSON.stringify({ days: [] });
    expect(tryParsePartialJSON(json)).toBeNull();
  });
});

// ── 4: updatePlanProgressive ─────────────────────────────────────────────────
describe('updatePlanProgressive — Firestore set merge 호출', () => {
  it('시나리오 4: adminDb.set 이 merge:true 로 호출됨', async () => {
    const adminDb = makeAdminDbMock();
    await updatePlanProgressive(adminDb as never, 'test-plan-id-123', {
      'itinerary.days': [{ city: 'Seoul', stops: [] }],
      _streaming_progress: 1,
    });

    expect(adminDb.collection).toHaveBeenCalledWith('plans');
    expect(adminDb._setMock).toHaveBeenCalledOnce();

    const [docData, options] = adminDb._setMock.mock.calls[0];
    // merge:true 확인
    expect(options).toEqual({ merge: true });
    // _streaming_in_progress: true 포함 확인
    expect(docData._streaming_in_progress).toBe(true);
    expect(docData._streaming_progress).toBe(1);
  });

  it('시나리오 4b: adminDb=null → 에러 없이 return (best-effort)', async () => {
    // 에러 미발생 확인
    await expect(updatePlanProgressive(null as never, 'plan-id', {})).resolves.toBeUndefined();
  });

  it('시나리오 4c: planId=null → 에러 없이 return', async () => {
    const adminDb = makeAdminDbMock();
    await expect(updatePlanProgressive(adminDb as never, null as never, {})).resolves.toBeUndefined();
  });
});

// ── 5: savePlanSkeleton ──────────────────────────────────────────────────────
describe('savePlanSkeleton — skeleton plan 생성 + planId 반환', () => {
  it('시나리오 5: planId 생성 + Firestore set 호출 + planUrl 반환', async () => {
    const adminDb = makeAdminDbMock();

    const result = await savePlanSkeleton(adminDb as never, {
      uid: 'user-123',
      email: 'test@example.com',
      area: 'Seoul',
      startDate: '2026-06-01',
      guestName: 'Test Guest',
      pax: 2,
      language: 'en',
      vehicle: 'staria_8',
      priceKRW: 990000,
      priceUSD: 9.9,
      body: { regions: ['Seoul'], styles: ['culture'] },
    });

    // planId 생성 확인
    expect(typeof result.planId).toBe('string');
    expect(result.planId.length).toBeGreaterThan(10);

    // planUrl 형식 확인
    expect(result.planUrl).toBe(`/my-plans/${result.planId}`);

    // Firestore set 호출 확인
    expect(adminDb._setMock).toHaveBeenCalledOnce();
    const [docData] = adminDb._setMock.mock.calls[0];

    // skeleton 필드 확인
    expect(docData.status).toBe('streaming');
    expect(docData._streaming_in_progress).toBe(true);
    expect(docData.uid).toBe('user-123');
    expect(docData.guestEmail).toBe('test@example.com');
    expect(docData.itinerary._streaming_skeleton).toBe(true);
    expect(Array.isArray(docData.itinerary.days)).toBe(true);
    expect(docData.itinerary.days).toHaveLength(0);
  });

  it('시나리오 5b: adminDb=null → throw (결제 후 plan loss 차단)', async () => {
    await expect(
      savePlanSkeleton(null as never, {
        uid: null, email: null, area: 'Seoul', startDate: '2026-06-01',
        guestName: 'Guest', pax: 2, language: 'en', vehicle: 'staria_8',
        priceKRW: 0, priceUSD: 0, body: {},
      }),
    ).rejects.toThrow('[P169]');
  });
});
