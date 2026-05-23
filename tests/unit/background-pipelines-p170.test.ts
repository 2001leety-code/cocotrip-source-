/**
 * P170 (2026-05-23) — backgroundPipelines.js 추출 회귀 차단 + 동작 검증.
 *
 * handlerCore.js 의 P168 Pass3 background IIFE + P169 streaming early-response 를
 * backgroundPipelines.js 로 추출. 기능 동일, 위치만 변경.
 *
 * 시나리오:
 *   1. triggerPass3BackgroundIfPending — pending=true + backgroundEnabled=true → pass3Enrich 호출
 *   2. triggerPass3BackgroundIfPending — pending=false → no-op (pass3Enrich 미호출)
 *   3. triggerPass3BackgroundIfPending — pending=true + backgroundEnabled=false → no-op
 *   4. shouldUseStreaming — streaming disabled → false
 *   5. shouldUseStreaming — streaming enabled + itinerary=null + mode≠3pass → true
 *   6. shouldUseStreaming — streaming enabled + itinerary 존재 (block-mode) → false
 *   7. shouldUseStreaming — streaming enabled + mode=3pass → false
 *   8. handlerCore.js size ≤ 500 lines (P129 cap 복귀)
 *   9. backgroundPipelines.js export contract (4 함수 모두 export)
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── 파일 크기 검증 (정적) ─────────────────────────────────────────────────────
const handlerCoreSrc = readFileSync(
  resolve(process.cwd(), 'api/_ai_core/handlerCore.js'),
  'utf8',
);
const bgPipelinesSrc = readFileSync(
  resolve(process.cwd(), 'api/_ai_core/backgroundPipelines.js'),
  'utf8',
);

// ── shouldUseStreaming 모킹 테스트 ─────────────────────────────────────────────
// geminiPipeline.js 의 isStreamingEnabled 를 vi.mock 으로 제어.
vi.mock('../../api/_ai_core/geminiPipeline.js', () => ({
  isStreamingEnabled: vi.fn(),
  isPass3BackgroundEnabled: vi.fn(),
  buildModel: vi.fn(),
  loadFoodIndex: vi.fn(),
  runGeminiPipeline: vi.fn(),
  tryParsePartialJSON: vi.fn(),
  runGeminiStreaming: vi.fn(),
}));

vi.mock('../../api/_ai_core/threePassPipeline.js', () => ({
  pass3Enrich: vi.fn(),
  pass1Intent: vi.fn(),
  pass2Resolve: vi.fn(),
}));

vi.mock('../../api/_ai_core/planPersister.js', () => ({
  updatePlanEnrichment: vi.fn(),
  savePlanSkeleton: vi.fn(),
}));

vi.mock('../../api/_shared/telegram-throttle.js', () => ({
  throttledTelegramAlert: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../api/_ai_core/vehicleAndPrice.js', () => ({
  calcPrice: vi.fn().mockReturnValue({ priceKRW: 100000, priceUSD: 75 }),
  VEHICLE_LABELS: {},
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('P170 — backgroundPipelines.js export contract', () => {
  it('exports triggerPass3BackgroundIfPending', () => {
    expect(bgPipelinesSrc).toMatch(/export\s+function\s+triggerPass3BackgroundIfPending/);
  });

  it('exports shouldUseStreaming', () => {
    expect(bgPipelinesSrc).toMatch(/export\s+function\s+shouldUseStreaming/);
  });

  it('exports tryInitStreamingSkeleton', () => {
    expect(bgPipelinesSrc).toMatch(/export\s+async\s+function\s+tryInitStreamingSkeleton/);
  });

  it('exports sendStreamingEarlyResponse', () => {
    expect(bgPipelinesSrc).toMatch(/export\s+function\s+sendStreamingEarlyResponse/);
  });
});

describe('P170 — handlerCore.js size cap ≤500 lines (P129 cap 복귀)', () => {
  it('handlerCore.js is ≤500 lines after P170 extraction', () => {
    const lines = handlerCoreSrc.split(/\r?\n/).length;
    expect(lines).toBeLessThanOrEqual(500);
  });

  it('handlerCore.js does NOT inline _pass3_pending (extracted to backgroundPipelines)', () => {
    // _pass3_pending 은 backgroundPipelines.js 내부에서만 사용 — handlerCore inline 금지
    expect(handlerCoreSrc).not.toMatch(/_pass3_pending/);
  });
});

describe('P170 — shouldUseStreaming (시나리오 4~7)', () => {
  it('[4] streaming env disabled → false', async () => {
    const { isStreamingEnabled } = await import('../../api/_ai_core/geminiPipeline.js');
    vi.mocked(isStreamingEnabled).mockReturnValue(false);

    const { shouldUseStreaming } = await import('../../api/_ai_core/backgroundPipelines.js');
    expect(shouldUseStreaming({ itinerary: null, plannerMode: 'legacy' })).toBe(false);
  });

  it('[5] streaming enabled + itinerary null + mode legacy → true', async () => {
    const { isStreamingEnabled } = await import('../../api/_ai_core/geminiPipeline.js');
    vi.mocked(isStreamingEnabled).mockReturnValue(true);

    const { shouldUseStreaming } = await import('../../api/_ai_core/backgroundPipelines.js');
    expect(shouldUseStreaming({ itinerary: null, plannerMode: 'legacy' })).toBe(true);
  });

  it('[6] streaming enabled + itinerary 존재 (block-mode) → false', async () => {
    const { isStreamingEnabled } = await import('../../api/_ai_core/geminiPipeline.js');
    vi.mocked(isStreamingEnabled).mockReturnValue(true);

    const { shouldUseStreaming } = await import('../../api/_ai_core/backgroundPipelines.js');
    expect(shouldUseStreaming({ itinerary: { days: [] }, plannerMode: 'legacy' })).toBe(false);
  });

  it('[7] streaming enabled + mode=3pass → false', async () => {
    const { isStreamingEnabled } = await import('../../api/_ai_core/geminiPipeline.js');
    vi.mocked(isStreamingEnabled).mockReturnValue(true);

    const { shouldUseStreaming } = await import('../../api/_ai_core/backgroundPipelines.js');
    expect(shouldUseStreaming({ itinerary: null, plannerMode: '3pass' })).toBe(false);
  });
});

describe('P170 — triggerPass3BackgroundIfPending (시나리오 1~3)', () => {
  it('[1] pending=true + backgroundEnabled=true → pass3Enrich + updatePlanEnrichment 호출', async () => {
    const { isPass3BackgroundEnabled, buildModel } = await import('../../api/_ai_core/geminiPipeline.js');
    const { pass3Enrich } = await import('../../api/_ai_core/threePassPipeline.js');
    const { updatePlanEnrichment } = await import('../../api/_ai_core/planPersister.js');

    vi.mocked(isPass3BackgroundEnabled).mockReturnValue(true);
    vi.mocked(buildModel).mockReturnValue({ fakeModel: true });
    vi.mocked(pass3Enrich).mockResolvedValue({ enriched: true });
    vi.mocked(updatePlanEnrichment).mockResolvedValue(undefined);

    const { triggerPass3BackgroundIfPending } = await import('../../api/_ai_core/backgroundPipelines.js');
    const itinerary = { _pass3_pending: true, days: [] };
    triggerPass3BackgroundIfPending({
      adminDb: {},
      planId: 'test-plan-001',
      language: 'en',
      apiKey: 'fake-key',
      itinerary,
    });

    // fire-and-forget — microtask flush 로 비동기 완료 대기
    await new Promise((r) => setTimeout(r, 10));

    expect(pass3Enrich).toHaveBeenCalledTimes(1);
    expect(updatePlanEnrichment).toHaveBeenCalledTimes(1);
    expect(updatePlanEnrichment).toHaveBeenCalledWith({}, 'test-plan-001', { enriched: true });
  });

  it('[2] pending=false → no-op (pass3Enrich 미호출)', async () => {
    const { isPass3BackgroundEnabled } = await import('../../api/_ai_core/geminiPipeline.js');
    const { pass3Enrich } = await import('../../api/_ai_core/threePassPipeline.js');

    vi.mocked(isPass3BackgroundEnabled).mockReturnValue(true);

    const { triggerPass3BackgroundIfPending } = await import('../../api/_ai_core/backgroundPipelines.js');
    const itinerary = { _pass3_pending: false, days: [] };
    triggerPass3BackgroundIfPending({
      adminDb: {},
      planId: 'test-plan-002',
      language: 'en',
      apiKey: 'fake-key',
      itinerary,
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(pass3Enrich).not.toHaveBeenCalled();
  });

  it('[3] pending=true + backgroundEnabled=false → no-op', async () => {
    const { isPass3BackgroundEnabled } = await import('../../api/_ai_core/geminiPipeline.js');
    const { pass3Enrich } = await import('../../api/_ai_core/threePassPipeline.js');

    vi.mocked(isPass3BackgroundEnabled).mockReturnValue(false);

    const { triggerPass3BackgroundIfPending } = await import('../../api/_ai_core/backgroundPipelines.js');
    const itinerary = { _pass3_pending: true, days: [] };
    triggerPass3BackgroundIfPending({
      adminDb: {},
      planId: 'test-plan-003',
      language: 'en',
      apiKey: 'fake-key',
      itinerary,
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(pass3Enrich).not.toHaveBeenCalled();
  });
});
