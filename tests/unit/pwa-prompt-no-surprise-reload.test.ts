/**
 * #pwa-prompt (2026-06-05): 배포-중-세션 강제 리로드 회귀 가드.
 *
 * 운영자 #4 신고: "플래너 스텝 1-2-3 작성 중에 갑자기 새로고침되면서 [이어서 하기 모달] 뜨더라".
 *
 * Root cause: registerType:'autoUpdate' + sw.ts install 시 무조건 skipWaiting →
 *   새 배포가 세션 중 떨어지면 새 SW 가 즉시 활성화 → cleanupOutdatedCaches 가 옛 청크 삭제 →
 *   작성 중 다음 lazy step 청크 fetch 실패 → 자동 리로드 → 복구모달.
 *
 * Fix: registerType:'prompt' + skipWaiting 을 SKIP_WAITING 메시지(사용자 [새로고침] 클릭)로 게이팅.
 *   → 새 SW 는 대기, 사용자가 토스트로 새로고침 선택. 작성 중 강제 리로드 0.
 *
 * 비유: "손님 식사 중인데 주방이 메뉴판(JS)을 갈아끼우려고 식탁을 통째로 치워버림" →
 *        "새 메뉴판 준비됐어요, 보시겠어요?" 라고 물어보고 손님이 OK 할 때만 교체.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('#pwa-prompt — 배포-중-세션 강제 리로드 방지', () => {
  it("vite.config registerType 는 'prompt' (autoUpdate 즉시활성화 금지)", () => {
    const src = readFileSync(join(process.cwd(), 'vite.config.ts'), 'utf-8');
    expect(src).toMatch(/registerType:\s*'prompt'/);
    expect(src).not.toMatch(/registerType:\s*'autoUpdate'/);
  });

  it('sw.ts 는 install 시 무조건 skipWaiting 하지 않음 (회귀 차단)', () => {
    const src = readFileSync(join(process.cwd(), 'src/sw.ts'), 'utf-8');
    // 무조건 install skipWaiting 패턴 부재 (공백 변형 허용).
    expect(src).not.toMatch(/addEventListener\(\s*['"]install['"]\s*,\s*\(\s*\)\s*=>\s*\{\s*self\.skipWaiting\(\)/);
  });

  it("sw.ts 는 SKIP_WAITING 메시지로 skipWaiting 게이팅 (사용자 [새로고침] 클릭 시)", () => {
    const src = readFileSync(join(process.cwd(), 'src/sw.ts'), 'utf-8');
    expect(src).toMatch(/SKIP_WAITING/);
    expect(src).toMatch(/self\.skipWaiting\(\)/);
    // message 리스너 안에서 skipWaiting (게이팅) — message + skipWaiting 둘 다 존재.
    expect(src).toMatch(/addEventListener\(\s*['"]message['"]/);
  });
});
