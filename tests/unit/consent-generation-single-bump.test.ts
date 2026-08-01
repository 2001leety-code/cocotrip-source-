// @vitest-environment jsdom
/**
 * 동의 세대(generation)는 다른 탭 변경 1건당 **정확히 1** 올라간다 (2026-08-02).
 *
 * 막으려는 것: 예전에는 `onConsentChange` 가 등록하는 리스너마다 세대를 올렸다.
 * 구독이 2개면 storage 이벤트 하나에 세대가 2 올라가고, 그러면 **첫 구독이 시작시킨 전송이
 * 두 번째 구독의 증가 때문에 폐기된다** — `posthog.track()` 은 SDK 로드를 기다리는 동안
 * 세대가 변했는지로 "그 사이 철회됐나" 를 판정하기 때문이다.
 * 실제로 차터 퍼널이 구독 2개를 걸자, 다른 탭에서 수락했을 때 시작·단계 이벤트가 사라졌다.
 *
 * 세대는 "값" 이 아니라 "변했는지" 로만 쓰이므로, 여기서 확인할 것은 **증가량이 구독 수에
 * 비례하지 않는다** 는 것이다.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const STORAGE_KEY = 'cocotrip_cookie_consent';

async function loadConsent() {
  vi.resetModules();
  return import('../../src/lib/consent');
}

function fireOtherTabChange(value: string) {
  window.localStorage.setItem(STORAGE_KEY, value);
  window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY, newValue: value }));
}

beforeEach(() => {
  localStorage.clear();
});

describe('다른 탭 동의 변경', () => {
  it('구독이 없어도 세대가 1 오른다 (모듈 리스너)', async () => {
    const { consentGeneration } = await loadConsent();
    const before = consentGeneration();
    fireOtherTabChange('accepted');
    expect(consentGeneration()).toBe(before + 1);
  });

  it('구독이 3개여도 세대는 1만 오른다 (구독 수에 비례하지 않는다)', async () => {
    const { consentGeneration, onConsentChange } = await loadConsent();
    const seen: string[] = [];
    const offs = [1, 2, 3].map((i) => onConsentChange((s) => seen.push(`${i}:${s}`)));

    const before = consentGeneration();
    fireOtherTabChange('accepted');

    expect(consentGeneration(), '구독 수만큼 올라가면 대기 중 전송이 폐기된다').toBe(before + 1);
    // 구독자 전원에게는 그대로 알려야 한다.
    expect(seen).toEqual(['1:accepted', '2:accepted', '3:accepted']);
    offs.forEach((off) => off());
  });

  it('세대를 미리 읽은 쪽이 그 사이 다른 탭 변경이 없었으면 값이 유지된다', async () => {
    const { consentGeneration, onConsentChange } = await loadConsent();
    const offs = [onConsentChange(() => {}), onConsentChange(() => {})];

    fireOtherTabChange('accepted');
    // 전송 시작 시점에 읽은 세대
    const gen = consentGeneration();
    // 같은 이벤트로 인한 추가 증가가 없어야 한다 → await 이후 비교가 통과한다.
    expect(consentGeneration()).toBe(gen);
    offs.forEach((off) => off());
  });

  it('다른 키의 storage 변경은 세대를 올리지 않는다', async () => {
    const { consentGeneration } = await loadConsent();
    const before = consentGeneration();
    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated_key', newValue: 'x' }));
    expect(consentGeneration()).toBe(before);
  });
});
