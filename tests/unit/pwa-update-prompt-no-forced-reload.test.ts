import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// PWA 업데이트 동작 회귀 잠금.
//
// 과거 P235 가 /my-plans 경로에서 needRefresh 감지 시 updateServiceWorker 를 useEffect 로
// "무조건" 호출(= 강제 리로드)해, 결제 직후 plan 화면이 새 배포 하나만 있어도 갑자기
// 새로고침되던 버그. → 경로 기반(isOnPlanPage) / 세션 중 무조건 강제 리로드를 금지.
//
// 2026-06-14 (운영자 요청 "앱 들어갈 때마다 새 버전이면 자동 업데이트"):
//   - 진입(콜드 스타트) 창 안에서만 자동 적용 허용 — 아직 작업 전이라 안전.
//   - 진입 창 밖(세션 중)은 여전히 토스트만(사용자가 [새로고침] 누를 때만) = P235 보호 유지.
// 잠금 규약: 자동 updateServiceWorker 호출은 반드시 AUTO_UPDATE_WINDOW_MS 진입-창 가드 뒤에서만.
const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../src/components/PWAUpdatePrompt.tsx'),
  'utf8',
);

describe('PWAUpdatePrompt — 강제 자동 새로고침 금지 (P235 회귀 잠금) + 진입 자동업데이트', () => {
  it('경로 기반 강제 업데이트 분기(isOnPlanPage 변수)가 코드에 없어야 함', () => {
    expect(SRC).not.toContain('isOnPlanPage');
  });

  it('자동 updateServiceWorker 는 진입(콜드 스타트) 창 가드 뒤에서만 — 세션 중 무조건 호출 금지', () => {
    expect(SRC).toContain('AUTO_UPDATE_WINDOW_MS');
    // 진입 창 가드(로드 경과시간 < 창) 직후에만 자동 호출
    expect(SRC).toMatch(
      /Date\.now\(\)\s*-\s*loadedAtRef\.current\s*<\s*AUTO_UPDATE_WINDOW_MS[\s\S]{0,180}updateServiceWorker\(true\)/,
    );
  });

  it('수동 [새로고침] 버튼 onClick 유지 (세션 중 경로는 토스트만)', () => {
    expect(SRC).toContain('onClick={() => updateServiceWorker(true)}');
  });

  it('updateServiceWorker(true) 호출은 정확히 2곳(진입 자동 + 버튼) — 무분별 호출 아님', () => {
    const calls = (SRC.match(/updateServiceWorker\(true\)/g) || []).length;
    expect(calls).toBe(2);
  });

  it('prompt 모드 핵심(useRegisterSW)은 유지 — 기능 자체는 살아있음', () => {
    expect(SRC).toContain('useRegisterSW');
    expect(SRC).toContain('needRefresh');
  });
});
