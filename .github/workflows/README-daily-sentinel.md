# Daily Sentinel — `daily-health.yml` L3 운영 가이드

CocoTrip 자율 검증 시스템 v1 의 **L3 (Daily Sentinel)** 운영 문서.
PR 머지 여부와 무관하게 prod 회귀를 매 cron 마다 자동 검증 + 실패 시 GitHub issue 자동 생성 + 텔레그램 alert.

## 실행 주기

- `cron: '0 0 * * 1,3,5'` — UTC 00:00 (KST 09:00), **월/수/금** (주 3회)
- 비용: Gemini 1회 호출 ~$0.04/run × 13/월 ≈ **$0.52/월** + Playwright E2E + validate-planner.cjs
- 수동 실행: GitHub Actions → Daily Health Check → "Run workflow" (workflow_dispatch)

## Step 구성 (총 13개)

| 카테고리 | Step | 트리거 | 실패 시 동작 |
|---|---|---|---|
| L1 | `Run Daily Health Check` | 항상 | continue |
| L2 | `E2E PROD smoke` | 항상 | continue-on-error |
| **L3 (신규)** | **`Run regression suite (L3)`** | 항상 | continue-on-error, result=fail output |
| **L3 (신규)** | **`Auto-create issue on regression failure (L3)`** | regression=fail | continue-on-error |
| **L3 (신규)** | **`Telegram alert on regression failure (L3)`** | regression=fail | continue-on-error |
| (기존) | `Upload health log` / `Commit health log` | 항상 | continue |

## L3 Step 상세

### 1. `Run regression suite (L3)`

- 스크립트: `scripts/validate-prod-regression.mjs` (받아적기 12항목)
- 입력: 5일 다도시 plan 1회 생성 (ADMIN-BYPASS-prefix paypalOrderId, 실 결제 X)
- 출력: `regression-output.txt` 로 redirect, `result=pass|fail` step output
- Secrets 필요:
  - `FIREBASE_WEB_API_KEY` (pr-regression.yml 과 동일)
  - `HEALTH_CHECK_EMAIL` (admin 계정, TEST- prefix 권한)
  - `HEALTH_CHECK_PASSWORD`

### 2. `Auto-create issue on regression failure (L3)`

- 트리거: `steps.regression.outputs.result == 'fail'`
- 동작:
  1. `gh issue list --state open --label regression --limit 10` 로 최근 open issue 조회
  2. title 에 "Daily regression FAIL" 포함된 open issue 가 있으면 → 새 issue 생성 X, 코멘트만 추가
  3. 없으면 → 새 issue 생성 (label: `regression,auto-detected`)
- Body 에 workflow run URL + 회귀 슈트 출력 마지막 1500자 포함
- 권한: `permissions.issues: write` (workflow level)

### 3. `Telegram alert on regression failure (L3)`

- 트리거: `steps.regression.outputs.result == 'fail'`
- Secrets: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — **미설정 시 graceful skip** (step 내부 shell `[ -z ]` 가드)
- 메시지 포맷: Markdown, run URL + 날짜 + repo Issues 안내 링크 포함

## 운영자 응답 절차 (issue triage)

1. **알림 수신**: 텔레그램 → GitHub run URL 클릭 → Actions 로그 확인
2. **회귀 가설**: 최근 머지 PR 중 영향 가능성 있는 변경 grep — 받아적기 12항목 (B-2~B-15) 중 어느 assertion 이 fail?
3. **fix 작업**:
   - PR 생성 → `ready-for-regression` 라벨 → `pr-regression.yml` 트리거로 재검증 (자율 검증 L1)
   - 통과 확인 후 머지
4. **issue close**: fix PR 머지 + daily-health 다음 run 에서 자동 회복 확인 → issue 수동 close (또는 `@claude fix 완료` 코멘트 후 닫기)

## 알림 트리거 조건 정리

| 트리거 | issue 생성 | Telegram alert |
|---|---|---|
| validate-planner.cjs fail | X | X |
| E2E smoke fail | X | X |
| **regression suite fail** | ✅ | ✅ (secrets 있으면) |
| 모두 pass | X | X |

→ L3 알림은 **prod 회귀에 한정**. validate-planner / E2E 는 본인의 알림 채널 (각자 fail 메시지) 사용.

## 보안 / 비용 노트

- `TELEGRAM_BOT_TOKEN` 미설정 시 alert step 은 stdout 에 메시지만 남기고 통과 — workflow 실패 처리 안 됨
- `issues: write` 권한은 workflow level 명시 → 다른 step 에서 의도치 않은 issue 수정 차단 위해 step level isolation 도 검토 가능 (현재는 단순성 우선)
- 비용 추가분: ~$0.52/월 (Gemini 1회/run × 13/월)

## 변경 이력

- 2026-05-12: L3 도입 (PR feat/daily-sentinel-auto-issue). regression suite + auto-issue + telegram alert 3 step 추가
- 기존 daily-health 는 validate-planner.cjs + E2E PROD smoke 만 실행하던 구조 (L1+L2)

## 관련 파일

- `.github/workflows/daily-health.yml` — 본 workflow (207L)
- `.github/workflows/pr-regression.yml` — L1 PR 머지 전 회귀 (라벨 트리거)
- `scripts/validate-prod-regression.mjs` — 받아적기 12항목 assertion 슈트
- `api/_telegram.js` / `api/_shared/notify.js` — 텔레그램 인프라 (참고용, workflow 는 curl 직접 호출)
