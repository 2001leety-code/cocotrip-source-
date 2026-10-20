// 고정 즉시 종료 프로세스 (통합 2026-10-17) — tests/unit/apply-brain-guide-projection.test.ts 의 stale lock 회수
// 케이스가 `node <이 파일>` 로만 실행한다 (예전 `node -e ""` 대체). 실제로 시작했다가 끝난 child 의 PID 를 얻는 용도.
// 인자 없음, 아무것도 import·출력하지 않고 exit 0. 인자가 오면 거부(64).
if (process.argv.length > 2) {
  process.stderr.write('projection-exit.mjs takes no arguments');
  process.exit(64);
}
