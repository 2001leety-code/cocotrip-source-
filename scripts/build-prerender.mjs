/**
 * PRERENDER=1 빌드 + 산출물 감사 (2026-08-23).
 *
 * npm script 에 `PRERENDER=1 npm run build` 를 그대로 적으면 Windows 에서 돌지 않는다
 * (npm 은 Windows 에서 cmd.exe 로 실행하고, cmd 에는 인라인 env prefix 문법이 없다).
 * 개발 기계가 Windows 이고 빌드 기계가 Linux 이므로 양쪽에서 같은 명령이 돌아야 한다.
 *
 * 🔴 여기서 감사를 따로 부르지 않는다. 산출물 감사는 `vite.config.ts` 의
 *    `prerenderAuditPlugin` 이 빌드 안에서 돌린다 — 배포가 쓰는 경로가 바로 그것이기
 *    때문이다. 이 스크립트가 감사를 한 번 더 부르면 47라우트를 두 번 읽을 뿐이고,
 *    "게이트가 이 래퍼에 달려 있다" 는 잘못된 인상을 다시 만든다.
 *    이 파일은 편의용 진입점일 뿐, 게이트가 아니다.
 */
import { spawnSync } from 'node:child_process';

function run(args) {
  const result = spawnSync('npm', args, {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, PRERENDER: '1' },
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

run(['run', 'build']);
