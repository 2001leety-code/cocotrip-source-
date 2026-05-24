# CocoTrip 자율점검 (Daily Health Check) 운영 가이드

`.github/workflows/daily-health.yml` 가 월/수/금 KST 09:00 (UTC 00:00) 에 실행하는 자율점검.

## 1. 무엇을 검증하는가

| Step | 내용 | 비용 |
|---|---|---|
| `daily-health-check.mjs` | 엔드포인트 ping (homepage, plan-status, planner) + `validate-planner.cjs` 5 시나리오 실행 | Gemini 5회 호출 (~$0.05) |
| `full-plan-translation-pdf.spec.ts` | E2E smoke — plan 생성 → 구조 검증 → blind `car·25분` 0건 → 번역 → PDF auth gate | Gemini 1회 (~$0.10) |
| `health-log.jsonl` commit | repo 에 자율점검 이력 누적 | (push 권한 필요) |

## 2. 필수 GitHub Secrets (운영자 1회 등록)

`Settings → Secrets and variables → Actions → New repository secret` 에서:

| Secret 이름 | 값 | 출처 |
|---|---|---|
| `FIREBASE_WEB_API_KEY` | Firebase Web API Key | Firebase Console → ⚙️ Project settings → General → Your apps → SDK setup → `apiKey` 값 |
| `HEALTH_CHECK_PASSWORD` | `2001leety@gmail.com` 비밀번호 | TEST_ACCOUNTS 의 plaintext 비밀번호 (운영자만 알고 있음) |

(선택) `HEALTH_CHECK_EMAIL` — 기본값 `2001leety@gmail.com` 외 다른 TEST 계정 사용 시.

## 3. 배경 — 왜 이 secret 이 필요한가

2026-05-04 PR #247 (audit P0-#2) 머지 후 `api/ai-planner-full.js:73` 에 `verifyUserToken(req)` 추가됨:

- 이전: `body.email` 신뢰 → admin email 위장으로 TEST mode bypass 가능했음
- 현재: `Authorization: Bearer <Firebase idToken>` 헤더 검증 → 인증된 email 만 사용

그 결과 자율점검도 동일하게 Bearer 헤더 필수.
`scripts/validate-planner.cjs` 와 `tests/e2e/full-plan-translation-pdf.spec.ts` 모두
Firebase Auth REST API (`identitytoolkit.googleapis.com/v1/accounts:signInWithPassword`)
로 idToken 발급 후 Bearer 주입한다.

## 4. permissions: contents: write

`daily-health.yml` 상단의 `permissions: contents: write` 는 `health-log.jsonl` push 용.
누락 시 `git push` 403 Forbidden → 누적 실패. 2026-05-11 fix.

## 5. 로컬 실행

```bash
# Windows PowerShell
$env:FIREBASE_WEB_API_KEY = "AIzaSy..."  # Firebase Console
$env:HEALTH_CHECK_PASSWORD = "..."        # TEST 계정
node scripts/validate-planner.cjs

# bash / WSL
export FIREBASE_WEB_API_KEY="AIzaSy..."
export HEALTH_CHECK_PASSWORD="..."
node scripts/validate-planner.cjs
```

secret 미설정 시 명확한 에러 출력 + 종료 (silent fail 금지).

## 6. 점검 결과 확인

- GitHub → Actions → "Daily Health Check" → 최신 run
- Artifact `health-log-<run_id>` 90일 보존
- repo 의 `scripts/health-log.jsonl` (commit 누적)

## 7. 알려진 회귀 (2026-05-11 fix)

| 증상 | 원인 | Fix |
|---|---|---|
| validate-planner 5 시나리오 모두 401 | PR #247 머지 후 Bearer 헤더 누락 | `getIdToken()` + Authorization 헤더 주입 |
| `health-log.jsonl` push 403 | `permissions: contents: write` 미설정 | 워크플로우 상단에 추가 |
| E2E plan 생성 step 401 | 동일 — Bearer 헤더 누락 | `getIdToken()` 헬퍼 + Authorization 주입 |
| **validate-planner 5/5 fail 12일 silent (2026-05-12 ~ 2026-05-24)** | `BRAINTREE_ENV='production'` 후 TEST- prefix 403 reject (audit P1-A) + `daily-health-check.mjs` 의 `issues_within_threshold` 단독 검사 결함 (`total_issues=0 <= 9 = true`) | P174 (R-P174a/b): paypalOrderId → `ADMIN-BYPASS-` prefix (admin email 인증 LIVE bypass) + `validation_actually_ok` (success_count > 0) 추가 검사 |
| **health-log.jsonl 5/14~5/24 11일 미commit silent** | main branch protection (GH006) 강화로 github-actions[bot] push reject. 기존 `git push \|\| echo "Push failed"` 패턴 silent | **P175 (R-P175)**: 명시적 step output + telegram alert. **P176 (옵션 B 채택)**: commit + alert step 자체 제거. artifact 90일 보존 사용 (`gh run download <run-id>`) |

## 8. ADMIN-BYPASS- prefix 사용 caveat (P174, 2026-05-24)

validate-planner.cjs 는 `ADMIN-BYPASS-VALIDATE-...` prefix 로 결제 우회. paymentGate.js:106 의 분기 통과 — admin email 인증 (HEALTH_CHECK_EMAIL 또는 ADMIN_BYPASS_EMAILS env + hardcoded `2001leety@gmail.com` fallback) 필수.

**caveat (P102, plannerMode.js:113)**: ADMIN-BYPASS- → `decidePlannerMode` 가 항상 `mode='legacy'` 강제. 따라서 자율 검증 측정 범위:

| Effect | 측정 가능 | 비고 |
|---|---|---|
| P164 maxOutputTokens cap | ✅ | prompt/output 정량 |
| P165 maxDuration 600 + Fluid Compute | ✅ | duration 측정 |
| P166 systemPrompt 정적 prefix | ✅ | implicit cache 효과 |
| P167 block-mode 다도시 | ❌ | legacy 강제 — 별도 (실제 결제 또는 staging) |
| P168 Pass3 background async | ❌ | 3pass mode 한정 — legacy 면 영향 0 |
| P169 Gemini streaming | ✅ | mode-independent |
| P171 admin Test Mode Flash | ✅ | admin-bypass 분기 |
| P172 PCT bucketing | ❌ | admin > PCT 우선 — admin path 면 bypass |

P167/P168/P172 완전 측정은 별도 수단 필요.

## 8. 검증

```bash
# secret 미설정 → 명확한 에러
node scripts/validate-planner.cjs
# → "FIREBASE_WEB_API_KEY + HEALTH_CHECK_PASSWORD env 필수. ..."

# secret 설정 후 → 5 시나리오 정상 실행 (~5분, Gemini 5회 호출)
$env:FIREBASE_WEB_API_KEY = "..."
$env:HEALTH_CHECK_PASSWORD = "..."
node scripts/validate-planner.cjs
# → "성공: 5/5, 총 이슈: <N>건" 식 출력
```
