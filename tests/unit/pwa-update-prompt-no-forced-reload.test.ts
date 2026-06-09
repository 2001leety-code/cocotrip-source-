import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// 2026-06-09: PWA 업데이트 토스트 "갑자기 새로고침" 회귀 잠금.
//
// 과거 P235 가 /my-plans 경로에서 needRefresh 감지 시 updateServiceWorker 를 useEffect 로
// "자동" 호출(= 강제 리로드)해, 결제 직후 plan 화면이 새 배포 하나만 있어도 갑자기
// 새로고침되던 버그. autoUpdate 시절엔 stale 청크 방지용이었으나, registerType:'prompt'
// 전환 후엔 옛 SW 가 옛 청크를 일관 서빙하므로 불필요 + 유해 → 제거.
// (딥서치: vite-plugin-pwa register.ts + workbox cleanupOutdatedCaches 소스 검증.)
//
// 규약: 모든 경로에서 "토스트만 표시, 사용자가 [새로고침] 버튼을 누를 때만 갱신".
// 강제 자동 업데이트(useEffect 내 updateServiceWorker 호출 / 경로 분기)가 다시 들어오면 차단.
const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../src/components/PWAUpdatePrompt.tsx'),
  'utf8',
);

describe('PWAUpdatePrompt — 강제 자동 새로고침 금지 (P235 회귀 잠금)', () => {
  it('경로 기반 강제 업데이트 분기(isOnPlanPage 변수)가 코드에 없어야 함', () => {
    // (설명 주석엔 /my-plans 가 등장할 수 있으므로, 코드용 변수명 isOnPlanPage 로 잠금.)
    expect(SRC).not.toContain('isOnPlanPage');
  });

  it('updateServiceWorker 호출은 정확히 1곳([새로고침] 버튼 onClick) — useEffect 자동호출 없음', () => {
    // 자동 리로드(=갑자기 새로고침) 방지: updateServiceWorker( 호출은 버튼 1곳뿐이어야 함.
    // (destructure `updateServiceWorker,` 는 괄호가 없어 매칭 안 됨.)
    const calls = (SRC.match(/updateServiceWorker\(/g) || []).length;
    expect(calls).toBe(1);
    expect(SRC).toContain('onClick={() => updateServiceWorker(true)}');
  });

  it('prompt 모드 핵심(useRegisterSW)은 유지 — 기능 자체는 살아있음', () => {
    expect(SRC).toContain('useRegisterSW');
    expect(SRC).toContain('needRefresh');
  });
});
