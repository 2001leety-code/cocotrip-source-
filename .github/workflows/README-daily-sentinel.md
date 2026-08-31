# Daily Health Check 운영 가이드

`daily-health.yml`은 운영 플래너를 월·수·금에 깊게 검사한다. 개별 검사 뒤에 있는
`Aggregate core health verdict`가 모든 핵심 단계의 실제 `outcome`을 합산하므로,
앞 단계 실패 뒤에도 후속 검사를 실행하면서 최종 workflow 결과는 빨강으로 유지한다.

## 실행 주기와 비용

- `cron: '0 0 * * 1,3,5'` — UTC 00:00, KST 09:00 월·수·금
- 수동 실행: GitHub Actions → Daily Health Check → Run workflow
- 플랜 생성이 필요한 검사는 월요일과 수동 실행에서만 돈다.
- L3 회귀 검사는 매 실행마다 Gemini 1회를 사용한다.

## 핵심 검사

| 검사 | 일정 | 실패 판정 |
|---|---|---|
| Daily Health Check | 월·수·금 | 필수 성공 |
| Playwright 설치·브라우저 준비 | 월·수·금 | 필수 성공 |
| 플랜·번역·PDF | 월요일 또는 수동 실행 | 실행 대상일 때 필수 성공 |
| 플랜 스모크 신선도 | 예약 실행 | 필수 성공 |
| 실제 내비게이션 클릭 | 월·수·금 | 필수 성공 |
| MOOD 인증 경로 | 월·수·금 | 필수 성공 |
| L3 회귀 슈트 | 월·수·금 | 필수 성공 |

## 실패 시 동작

1. 합산 단계가 실패한 단계 이름을 `health-summary.txt`와 Actions 요약에 남긴다.
2. 제목이 `[health] Daily health check failed`인 열린 GitHub Issue가 있으면 코멘트를
   추가하고, 없으면 새 Issue를 만든다. 저장소 라벨 존재 여부에는 의존하지 않는다.
3. 운영 긴급 채널인 Telegram 한 곳에 run 링크와 실패 단계 이름을 보낸다.
4. Issue나 Telegram API 호출이 실패해도 그 오류를 숨기지 않는다.
5. `Enforce final core health verdict`가 최종 workflow 결과를 실패로 고정한다.

Discord는 콘텐츠 검토·기술 묶음용으로 남기고 이 운영 장애 알림에는 사용하지 않는다.

## 필요한 GitHub Secrets

- `FIREBASE_WEB_API_KEY`
- `HEALTH_CHECK_EMAIL`
- `HEALTH_CHECK_PASSWORD`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

Telegram 키가 없으면 긴급 알림 단계도 실패로 남는다. 키 값은 로그에 출력하지 않는다.

## 운영자 대응

1. Telegram의 GitHub run 링크에서 실패 단계와 로그를 확인한다.
2. 원인을 수정한 뒤 `workflow_dispatch`로 재실행한다.
3. 모든 핵심 단계가 통과한 것을 확인한 뒤 추적 Issue를 닫는다.

## 관련 파일

- `.github/workflows/daily-health.yml`
- `scripts/daily-health-check.mjs`
- `scripts/check-plan-smoke-freshness.mjs`
- `scripts/validate-prod-regression.mjs`
- `tests/unit/workflow-alert-reliability.test.ts`
- `tests/unit/daily-health-no-fake-green.test.ts`
