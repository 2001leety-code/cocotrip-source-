// 음성 대조군 소스 (통합 2026-10-17). 이 파일 자체는 정상 모듈이고(ESLint 파싱 가능), 실제 Node ESM 로더가
// "Duplicate export" 로 거부해야 하는 고정 소스 문자열만 export 한다. esm-load-dup.mjs 만 사용한다.
// 고치지 말 것 (smoke 러너의 음성 대조군 — llm-esm-load-smoke.test.ts 가 정확한 문자열을 고정 검사한다).
export const DUPLICATE_EXPORT_SOURCE = 'export const A = 1;\nexport { A };\n';
