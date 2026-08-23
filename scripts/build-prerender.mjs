/**
 * PRERENDER=1 빌드 + 산출물 감사 (2026-08-23).
 *
 * npm script 에 `PRERENDER=1 npm run build` 를 그대로 적으면 Windows 에서 돌지 않는다
 * (npm 은 Windows 에서 cmd.exe 로 실행하고, cmd 에는 인라인 env prefix 문법이 없다).
 * 개발 기계가 Windows 이고 빌드 기계가 Linux 이므로 양쪽에서 같은 명령이 돌아야 한다.
 *
 * 빌드가 초록이어도 감사가 빨간불이면 이 스크립트는 실패로 끝난다 — 프리렌더는
 * "돌았다" 가 아니라 "모든 색인 경로가 쓸 만한 HTML 로 나왔다" 여야 통과다.
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
run(['run', 'seo:audit-prerender']);
