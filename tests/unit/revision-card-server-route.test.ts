/**
 * RevisionCard — revision reason 서버 라우팅 회귀 (2026-06-13 버그헌트).
 * 결함: handleSubmit 이 클라 SDK 로 plans.revisionReasons(updateDoc) + plan_complaints(addDoc)
 *   를 직접 write 했으나, plans update allowlist + plan_complaints 룰 부재(catch-all deny)로
 *   둘 다 silent 거부 → 분석 데이터 전손실.
 * fix: api/log-revision-reason(Admin SDK, rules 우회) 로 fire-and-forget 라우팅.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(
  resolve(process.cwd(), 'src/pages/PlanDetailPage/components/RevisionCard.tsx'),
  'utf8',
);

describe('RevisionCard — revision reason 서버 라우팅 (소스 가드)', () => {
  it('log-revision-reason 엔드포인트로 라우팅', () => {
    expect(src).toMatch(/authFetch\(\s*['"]\/api\/log-revision-reason['"]/);
  });

  it('firebase/firestore 미import — 클라 SDK 직접 write 호출 자체가 불가(tsc 통과가 증명)', () => {
    expect(src).not.toMatch(/from ['"]firebase\/firestore['"]/);
  });

  it('실호출 구문 부재 — collection(db,…) / updateDoc(doc(…)) / addDoc(…) (주석 무관)', () => {
    expect(src).not.toMatch(/collection\(\s*db\s*,/);
    expect(src).not.toMatch(/updateDoc\(\s*doc\(/);
    expect(src).not.toMatch(/addDoc\(\s*collection\(/);
  });
});
