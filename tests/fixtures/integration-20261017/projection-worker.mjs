// 고정 projection 동시성 워커 (통합 2026-10-17) — tests/unit/apply-brain-guide-projection.test.ts 가
// `node <이 파일> <base64url payload>` 로만 실행한다. 예전엔 테스트가 TMP 에 워커 소스를 매번 써서 실행했다.
// 실행 코드는 이 파일 + 상대 고정 경로의 운영 모듈뿐이고, 인자는 데이터(payload) 하나뿐이다 — 모듈 경로를 받지 않는다.
// payload = base64url(JSON {root, manifest, holdMs}). root 는 os.tmpdir() 바로 아래 `cocotrip-guide-projection-*`
// 테스트 디렉터리여야 한다. 형식이 다르면 stderr `PROJECTION_WORKER_BAD_PAYLOAD <reason>` + exit 64.
// 동작: lock 획득 직후 stdout 에 `__LOCK_ACQUIRED__` 를 쓰고 holdMs 동안 lock 을 쥔 뒤, 결과 JSON 을 stdout 에 쓴다.
// projection 오류는 stderr 에 stack + exit 1.
import os from 'node:os';
import path from 'node:path';
import { applyBrainGuideProjection } from '../../../scripts/apply-brain-guide-projection.lib.mjs';

const LOCK_ACQUIRED_MARKER = '__LOCK_ACQUIRED__';
const ROOT_PREFIX = 'cocotrip-guide-projection-';
const MAX_HOLD_MS = 10_000;

function badPayload(reason) {
  process.stderr.write(`PROJECTION_WORKER_BAD_PAYLOAD ${reason}`);
  process.exit(64);
}

function readPayload(argv) {
  if (argv.length !== 1) badPayload('expected exactly one payload argument');
  let payload;
  try {
    payload = JSON.parse(Buffer.from(argv[0], 'base64url').toString('utf8'));
  } catch {
    badPayload('payload is not base64url JSON');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) badPayload('payload is not an object');
  const keys = Object.keys(payload).sort().join(',');
  if (keys !== 'holdMs,manifest,root') badPayload(`unexpected payload keys: ${keys}`);
  const { root, manifest, holdMs } = payload;
  if (typeof root !== 'string' || !path.isAbsolute(root)) badPayload('root must be an absolute path');
  const resolved = path.resolve(root);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith(ROOT_PREFIX)) {
    badPayload('root is not a test temp directory');
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) badPayload('manifest must be an object');
  if (!Number.isInteger(holdMs) || holdMs < 0 || holdMs > MAX_HOLD_MS) badPayload('holdMs out of range');
  return { root: resolved, manifest, holdMs };
}

const payload = readPayload(process.argv.slice(2));
try {
  const result = applyBrainGuideProjection({
    root: payload.root,
    manifest: payload.manifest,
    lockWaitMs: 5000,
    afterLockAcquired: () => {
      process.stdout.write(LOCK_ACQUIRED_MARKER);
      if (payload.holdMs > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, payload.holdMs);
    },
  });
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  process.stderr.write(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
}
