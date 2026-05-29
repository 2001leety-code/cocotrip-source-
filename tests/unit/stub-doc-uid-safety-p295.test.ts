/**
 * P295 (2026-05-29): P231 stub doc uid 누락 SAFETY-CRITICAL fix 회귀 차단.
 *
 * 배경: 운영자 신고 (5/29 P291 cycle 직후) — 어드민 이메일 + 테스트 버튼 누르면
 *   "세션이 만료되었습니다 / 앱이 업데이트되었습니다" 메시지. console 에
 *   `[PlanDetail] Firestore read error: permission-denied FirebaseError:
 *   Missing or insufficient permissions.`
 *
 * Root cause: backgroundPipelines.js:138-144 (sync path) + 253-259 (block-mode) 의
 *   P231 stub doc 가 uid 없이 저장 → Firestore Security Rules 의
 *   `request.auth.uid == resource.data.uid` 통과 X → permission-denied.
 *
 * Race window: stub doc 저장 (sync) → Inngest worker Step 0 skeleton-write
 *   (full skeleton + uid merge) 사이 ~1-3초. 사용자가 그 사이 PlanDetailPage
 *   진입 시 stub 만 있는 상태로 Firestore read → deny → autherror 화면.
 *
 * P295 fix: stub doc 에 uid + guestEmail 즉시 저장 (sync path 에서).
 *
 * 회귀 시: 사용자 결제 후 "세션 만료" 메시지 빈도 ↑ → 결제 후 plan 안 보임 SAFETY 영역.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('P295 P231 stub doc uid 누락 SAFETY-CRITICAL fix', () => {
  const srcPath = resolve(__dirname, '../../api/_ai_core/backgroundPipelines.js');
  const src = readFileSync(srcPath, 'utf8');

  it('source — sync path stub doc 에 uid 포함', () => {
    // P231 sync stub set() 블록 안 uid 포함 검증
    const stubBlock1 = src.match(/Stub doc saved \(skeleton-in-worker mode\)[\s\S]{0,50}/);
    // 위 검증은 console log 확인 — 본 검증은 set 호출 내용
    // P295 fix 후 uid: uid || null 패턴
    expect(src).toMatch(/_p231_stub:\s*true[\s\S]{0,200}uid:\s*uid\s*\|\|\s*null/);
  });

  it('source — block-mode stub doc 에도 uid 포함', () => {
    // P231 block-mode 도 동일 fix (2곳 모두)
    const matches = src.match(/uid:\s*uid\s*\|\|\s*null/g);
    expect(matches).toBeDefined();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });

  it('source — guestEmail 도 동시 저장 (guest plan SAFETY)', () => {
    const matches = src.match(/guestEmail:\s*email\s*\|\|\s*null/g);
    expect(matches).toBeDefined();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });

  it('source — P295 주석 + SAFETY-CRITICAL 명시', () => {
    expect(src).toContain('P295');
    expect(src).toContain('SAFETY-CRITICAL');
    expect(src).toContain('Firestore Security Rules');
    // race window 명시
    expect(src).toMatch(/race window|race condition/i);
  });

  it('source — Firestore Rules 통과 의도 명시', () => {
    expect(src).toMatch(/request\.auth\.uid|resource\.data\.uid|permission-denied|autherror/);
  });
});
