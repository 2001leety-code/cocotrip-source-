/**
 * Preview ↔ Production Firebase 혼용 차단 (2026-07-29).
 *
 * 🔴 왜 필요한가: Vercel Preview 배포가 **운영 Firebase 프로젝트를 그대로** 쓰면,
 *   프리뷰에서 돌린 샌드박스 결제 테스트가 운영 예약·포인트·플랜을 실제로 쓴다.
 *   실제로 이번 감사에서 운영 계정 원장이 테스트로 오염된 것이 확인됐다
 *   (오염 209건 / 코인 629,237 / 지출 $210,219).
 *
 * 이 가드는 **환경 분리 자체를 대신하지 않는다.** 분리는 운영자가 Vercel 대시보드에서
 * Preview 전용 Firebase 프로젝트 env 를 넣어야 완료된다(docs/FIREBASE-ENV-SEPARATION.md).
 * 여기서는 "분리가 안 된 채로 도는 것"을 **탐지하고 막는다**.
 *
 * 판정:
 *   VERCEL_ENV === 'production'  → 운영 프로젝트여야 한다
 *   그 외(preview/development)   → 운영 프로젝트면 안 된다
 *
 * 운영 프로젝트 식별: FIREBASE_PRODUCTION_PROJECT_ID (없으면 판정 보류 = 통과).
 * 강제 차단 스위치: FIREBASE_ENV_GUARD='enforce' 면 불일치 시 throw.
 *   기본은 'warn' — 잘못 걸어 배포를 통째로 죽이는 사고를 피한다.
 *   운영자가 분리를 끝낸 뒤 'enforce' 로 올리면 회귀가 구조적으로 막힌다.
 */

/** 현재 배포 환경. Vercel 이 주입한다. 로컬은 'development'. */
export function deployEnv() {
  return String(process.env.VERCEL_ENV || process.env.NODE_ENV || 'development').toLowerCase();
}

/**
 * 지금 붙은 Firebase 프로젝트가 이 배포 환경에 맞는지 검사한다.
 * @returns {{ok: true} | {ok: false, reason: string, detail: object}}
 */
export function checkFirebaseEnvMatch() {
  const prodProject = (process.env.FIREBASE_PRODUCTION_PROJECT_ID || '').trim();
  const current = (process.env.FIREBASE_PROJECT_ID || '').trim();
  if (!prodProject || !current) {
    return { ok: true }; // 판정 불가 — 운영자가 아직 설정 전. 막지 않는다.
  }
  const env = deployEnv();
  const isProdDeploy = env === 'production';
  const isProdProject = current === prodProject;

  if (isProdDeploy && !isProdProject) {
    return {
      ok: false,
      reason: 'production-deploy-on-non-production-firebase',
      detail: { env, current, expected: prodProject },
    };
  }
  if (!isProdDeploy && isProdProject) {
    return {
      ok: false,
      reason: 'preview-deploy-on-production-firebase',
      detail: { env, current },
    };
  }
  return { ok: true };
}

/**
 * 부팅 시 1회 호출. 불일치면 경고하고, enforce 모드에서는 throw 해서
 * 프리뷰가 운영 데이터를 건드리기 전에 죽는다.
 *
 * @param {string} caller  진단 로그용 호출자 이름
 */
export function assertFirebaseEnvMatch(caller = 'unknown') {
  const verdict = checkFirebaseEnvMatch();
  if (verdict.ok) return;

  const enforce = String(process.env.FIREBASE_ENV_GUARD || 'warn').toLowerCase() === 'enforce';
  const msg = `[firebase-env-guard] ${verdict.reason} (caller=${caller}) `
    + `env=${verdict.detail.env} project=${verdict.detail.current}`;

  if (enforce) {
    // 프리뷰가 운영 데이터를 쓰기 전에 확실히 멈춘다.
    throw new Error(`${msg} — FIREBASE_ENV_GUARD=enforce 이므로 실행을 중단합니다. `
      + 'docs/FIREBASE-ENV-SEPARATION.md 참조');
  }
  console.warn(`${msg} — 현재 warn 모드. 분리 완료 후 FIREBASE_ENV_GUARD=enforce 로 올리세요.`);
}
