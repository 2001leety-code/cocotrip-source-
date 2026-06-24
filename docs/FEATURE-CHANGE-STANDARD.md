# 기능 변경 표준 (Definition of Done)

새 기능 추가/변경 시 아래 8개를 모두 갱신한다. 안 하면 새 기능이 조용히 터져도 아무도 모른다.
(2026-06-23 intercity bookend 사고 = 같은 로직 한 줄 바꿨는데 테스트·커스텀 린트가드가 옛 패턴을 하드코딩해서 새(맞는) 코드가 막힌 산 증거.)

1. 코드 — 브랜치에 구현, 검증 후 머지(모아서 1회 push)
2. 자동 검증(harness) — 새 기능의 "정상" 불변식을 `scripts/plan-local/_pipeline.mjs`(npm run plan:test)에 체크 추가
3. 모니터링 — 새 고장점 silent-fail 감지 → `throttledTelegramAlert` + Firestore `error_log`(브레인 인시던트판으로 자동 전파)
4. 전 표면 — 화면 바꿨으면 PDF(`pdfGenerator.ts`)·이메일(`api/_send-email.js`)·공유/OG도 같이 (verify-surfaces / cross-surface-audit)
5. 어드민/브레인 — 토글·뷰·테스터·플래그 필요 시 추가
6. 체크리스트 — 아래 "체크 항목" 표에 새 줄 추가 (살아있는 기준)
7. 플래그/env 레지스트리 — 새 플래그면 기록 (매번 재질문 방지)
8. 테스트·린트가드 갱신 — 로직 패턴을 바꾸면 그걸 검사하는 소스-패턴 테스트(`tests/unit`)·커스텀 린트(`scripts/lint-mistake-patterns.mjs`)도 같이 갱신

## 체크 항목 (기능별 — 기능 늘 때마다 한 줄씩 추가)

| 기능 | 체크할 것 |
|---|---|
| 교통 타임라인 | 모든 구간에 레그 有 · throw 0 · 중복 0 · 다도시 bookend 有 |
| 양쪽 지도 링크 | 모든 장소에 유효 링크(좌표/이름) |
| 미리보기 펼침카드 | 파싱 성공 · "undefined"/"[object Object]" 0 |
| 예시 샘플 | 3개 로드·렌더 · PII 0 |
| PDF·이메일 | 화면 = PDF = 이메일 동일 |
