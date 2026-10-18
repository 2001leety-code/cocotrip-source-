// 고정 ESM 로드 러너 — 음성 대조군 (통합 2026-10-17). esm-load-core.mjs 와 같은 import·보고 방식으로
// 중복 export 모듈(esm-dup-export.mjs)을 로드해, 하네스가 실제 로더 오류를 잡는다는 것을 증명한다.
// 인자 없음(오면 64). 기대: stderr `ESM_LOAD_FAILED esm-dup-export.mjs SyntaxError: Duplicate export of 'A'`, exit 1.
const TARGET = 'esm-dup-export.mjs';

if (process.argv.length > 2) {
  console.error('esm-load-dup.mjs takes no arguments');
  process.exit(64);
}

try {
  await import(new URL(`./${TARGET}`, import.meta.url).href);
  console.log('LOADED 1');
} catch (e) {
  console.error(`ESM_LOAD_FAILED ${TARGET} ${(e && e.name) || 'Error'}: ${(e && e.message) || e}`);
  process.exitCode = 1;
}
