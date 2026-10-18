// 2026-10-10: 본체는 src/lib/publicPlanProjection.js (순수·브라우저 안전). 프론트가 /api/_shared 모듈 URL 을
// import 하면 dev proxy·e2e 의 /api 모킹에 잡혀 결과 페이지가 깨졌다. api 쪽 호출처는 이 재수출을 그대로 쓴다.
export * from '../../src/lib/publicPlanProjection.js';
