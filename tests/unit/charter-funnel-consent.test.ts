// @vitest-environment jsdom
/**
 * 차터 퍼널 계측 × 쿠키 동의 (2026-08-01).
 *
 * 막으려는 것: 동의가 아직 미결정(`unset`)일 때 발화한 이벤트는 분석 계층이 조용히 버리는데,
 * 호출부가 "보냈다" 로 표시해 버리면 사용자가 곧바로 수락해도 다시 보내지 않는다.
 * 첫 진입에 배너를 보는 **신규 방문자 전원**이 통계에서 사라지는 구조였다.
 *
 * 문자열 검사가 아니라 실제 호출 수를 센다 — `window.gtag` 를 스파이로 두고,
 * 동의 상태를 진짜로 바꿔가며(`setConsent`) 몇 번 나갔는지 본다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

type GtagCall = [string, string, Record<string, unknown>?];

function gtagCalls(): GtagCall[] {
  const g = (window as unknown as { gtag: { mock: { calls: GtagCall[] } } }).gtag;
  return g.mock.calls;
}
const eventsNamed = (name: string) => gtagCalls().filter((c) => c[0] === 'event' && c[1] === name);

async function load() {
  // consent 와 analytics 를 같은 epoch 에서 가져와야 같은 인스턴스를 공유한다.
  const consent = await import('../../src/lib/consent');
  const hook = await import('../../src/components/charter/useCharterFunnelTracking');
  return { ...consent, useCharterFunnelTracking: hook.useCharterFunnelTracking };
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  // GA 전송 조건: 측정 ID + window.gtag + 동의. ID 는 env 라 stub 으로 채운다.
  vi.stubEnv('VITE_GA_MEASUREMENT_ID', 'G-TEST');
  (window as unknown as { gtag: unknown }).gtag = vi.fn();
});

afterEach(() => {
  vi.unstubAllEnvs();
  delete (window as unknown as { gtag?: unknown }).gtag;
});

describe('동의 미결정 상태', () => {
  it('이벤트를 보내지 않고, 수락하면 그때 정확히 1회씩 보낸다', async () => {
    const { setConsent, useCharterFunnelTracking } = await load();

    renderHook(() => useCharterFunnelTracking({ currentStep: 1, quoteReady: false, vehicleType: '' }));

    // unset — 아무것도 나가지 않는다.
    expect(eventsNamed('charter_quote_start')).toHaveLength(0);
    expect(eventsNamed('charter_step')).toHaveLength(0);

    // 수락 — 버려졌던 시작·현재 단계가 각각 한 번씩 나간다.
    await act(async () => { setConsent('accepted'); });
    expect(eventsNamed('charter_quote_start')).toHaveLength(1);
    expect(eventsNamed('charter_step')).toHaveLength(1);
    expect(eventsNamed('charter_step')[0][2]).toMatchObject({ step: 1 });
  });

  it('수락 이벤트가 여러 번 와도 중복 전송하지 않는다', async () => {
    const { setConsent, useCharterFunnelTracking } = await load();
    renderHook(() => useCharterFunnelTracking({ currentStep: 1, quoteReady: false, vehicleType: '' }));

    await act(async () => { setConsent('accepted'); });
    await act(async () => { setConsent('accepted'); });

    expect(eventsNamed('charter_quote_start')).toHaveLength(1);
    expect(eventsNamed('charter_step')).toHaveLength(1);
  });

  it('수락 전에 단계를 옮겼다면 수락 시점의 현재 단계만 보낸다', async () => {
    const { setConsent, useCharterFunnelTracking } = await load();
    const { rerender } = renderHook(
      ({ step }) => useCharterFunnelTracking({ currentStep: step, quoteReady: false, vehicleType: '' }),
      { initialProps: { step: 1 } },
    );
    rerender({ step: 3 });
    expect(eventsNamed('charter_step')).toHaveLength(0);

    await act(async () => { setConsent('accepted'); });
    const steps = eventsNamed('charter_step');
    expect(steps).toHaveLength(1);
    expect(steps[0][2]).toMatchObject({ step: 3 });
  });
});

describe('동의 거부·철회', () => {
  it('dismissed 에서는 보내지 않는다', async () => {
    const { setConsent, useCharterFunnelTracking } = await load();
    renderHook(() => useCharterFunnelTracking({ currentStep: 1, quoteReady: false, vehicleType: '' }));

    await act(async () => { setConsent('dismissed'); });
    expect(eventsNamed('charter_quote_start')).toHaveLength(0);
    expect(eventsNamed('charter_step')).toHaveLength(0);
  });

  it('철회 후 다시 수락하면 그때 보낸다 (표시가 잠기지 않는다)', async () => {
    const { setConsent, useCharterFunnelTracking } = await load();
    renderHook(() => useCharterFunnelTracking({ currentStep: 2, quoteReady: false, vehicleType: '' }));

    await act(async () => { setConsent('revoked'); });
    expect(eventsNamed('charter_step')).toHaveLength(0);

    await act(async () => { setConsent('accepted'); });
    expect(eventsNamed('charter_step')).toHaveLength(1);
    expect(eventsNamed('charter_step')[0][2]).toMatchObject({ step: 2 });
  });
});

describe('이미 수락된 상태', () => {
  it('마운트 즉시 시작·1단계를 보내고, 단계 이동마다 1회씩 추가한다', async () => {
    const { setConsent, useCharterFunnelTracking } = await load();
    setConsent('accepted');

    const { rerender } = renderHook(
      ({ step }) => useCharterFunnelTracking({ currentStep: step, quoteReady: false, vehicleType: '' }),
      { initialProps: { step: 1 } },
    );
    expect(eventsNamed('charter_quote_start')).toHaveLength(1);
    expect(eventsNamed('charter_step')).toHaveLength(1);

    rerender({ step: 2 });
    rerender({ step: 3 });
    expect(eventsNamed('charter_step').map((c) => c[2]?.step)).toEqual([1, 2, 3]);
    // 시작 이벤트는 단계가 바뀌어도 늘지 않는다.
    expect(eventsNamed('charter_quote_start')).toHaveLength(1);
  });

  it('뒤로 갔다 와도 같은 단계를 다시 보내지 않는다', async () => {
    const { setConsent, useCharterFunnelTracking } = await load();
    setConsent('accepted');
    const { rerender } = renderHook(
      ({ step }) => useCharterFunnelTracking({ currentStep: step, quoteReady: false, vehicleType: '' }),
      { initialProps: { step: 1 } },
    );
    rerender({ step: 2 });
    rerender({ step: 1 });
    rerender({ step: 2 });
    expect(eventsNamed('charter_step').map((c) => c[2]?.step)).toEqual([1, 2]);
  });
});

describe('견적 완료', () => {
  it('quoteReady 전에는 안 보내고, 준비되면 1회만 보낸다', async () => {
    const { setConsent, useCharterFunnelTracking } = await load();
    setConsent('accepted');
    const { rerender } = renderHook(
      ({ ready }) => useCharterFunnelTracking({ currentStep: 6, quoteReady: ready, vehicleType: 'staria' }),
      { initialProps: { ready: false } },
    );
    expect(eventsNamed('charter_quote_complete')).toHaveLength(0);

    rerender({ ready: true });
    rerender({ ready: true });
    expect(eventsNamed('charter_quote_complete')).toHaveLength(1);
    expect(eventsNamed('charter_quote_complete')[0][2]).toMatchObject({ vehicle_type: 'staria' });
  });

  it('미결정 상태에서 견적이 준비됐다면 수락 시점에 보낸다', async () => {
    const { setConsent, useCharterFunnelTracking } = await load();
    renderHook(() => useCharterFunnelTracking({ currentStep: 6, quoteReady: true, vehicleType: 'sprinter' }));
    expect(eventsNamed('charter_quote_complete')).toHaveLength(0);

    await act(async () => { setConsent('accepted'); });
    expect(eventsNamed('charter_quote_complete')).toHaveLength(1);
  });
});
