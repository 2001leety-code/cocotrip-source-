# Admin Auth Audit — 2026-05-12

자율 검증 v2 P1 도입 시 B-ADM3 (코드 grep) 자체검증 결과 기반 1회 audit.
admin 인증/권한 패턴 일관성 + hardcode 위치 + 우회 가능성을 정리한다.

## TL;DR

- ✅ 13 개 admin endpoint 모두 `verifyAdminToken` 사용 (admin-auth.js 단일 source).
- ✅ 모든 endpoint 에서 401/403 만 auth 실패로 분기 — 우회 불가능.
- ⚠️ 1 건 pure hardcode (env 미사용) — `api/reviews.js:22`. 운영자 admin email 변경
  시 누락 위험. **fix 권장** (별도 PR).
- ✅ hybrid fallback (env || hardcode) 3건은 frontend admin 페이지 — env 정상 등록 시
  fallback 미작동. 운영 위험 LOW.
- ✅ HARDCODED_ADMIN_EMAILS 배열 fallback 5건은 paymentGate 패턴 (env-driven + 명시적
  배열 polish) — 의도된 디자인.

## 모든 admin endpoint auth 패턴

13 개 endpoint 모두 `verifyAdminToken(req)` (`api/_shared/admin-auth.js`) 단일 source.

| Endpoint | 메서드 | 핸들러 줄 | auth 패턴 |
| --- | --- | --- | --- |
| `/api/admin-bookings` | GET | L111 | `verifyAdminToken` |
| `/api/admin-coupon-fix` | POST | L66 | `verifyAdminToken` |
| `/api/admin-booking-action` | POST | L85 | `verifyAdminToken` |
| `/api/admin-issue-coupon` | POST | L48 | `verifyAdminToken` |
| `/api/admin-issue-onboarding-coupons` | POST | L50 | `verifyAdminToken` |
| `/api/admin-plan-lookup` | POST | L56 | `verifyAdminToken` |
| `/api/admin-posthog-funnel` | GET | L54 | `verifyAdminToken` |
| `/api/admin-quality-summary` | GET | L118 | `verifyAdminToken` |
| `/api/admin-replay-booking-notifications` | POST | L49 | `verifyAdminToken` |
| `/api/admin-sales` | GET | L106 | `verifyAdminToken` |
| `/api/admin-scan-suspect-bookings` | POST | L61 | `verifyAdminToken` |
| `/api/admin-test-push` | POST | L34 | `verifyAdminToken` |
| `/api/admin-translations` | (multi) | L58 | `verifyAdminToken` |
| `/api/admin-update-booking` | POST | L66 | `verifyAdminToken` |

`verifyAdminToken` 의 분기:
- Authorization Bearer 없음 → `{ok: false, status: 401, error: 'Authorization Bearer token required'}`
- `ADMIN_EMAIL` env 미설정 → `{status: 500, error: 'ADMIN_EMAIL env var not configured'}`
- `verifyIdToken` 실패 (위조/만료) → `{status: 401, error: 'Token verification failed: <code>'}`
- `email_verified=false` → `{status: 403, error: 'Email not verified'}`
- `email !== ADMIN_EMAIL` → `{status: 403, error: 'Not admin'}`
- 통과 → `{ok: true, email, uid}`

모든 endpoint 가 위 결과를 `auth.status` 그대로 HTTP 응답 → 우회 경로 없음.

## hardcode 분류

`scripts/validate-prod-admin-auth.mjs` B-ADM3 grep 결과 (2026-05-12 실행):

### PURE HARDCODE (HIGH risk, env 참조 0건)

| 파일:줄 | 코드 | 영향 |
| --- | --- | --- |
| `api/reviews.js:22` | `const ADMIN_EMAILS = ['2001leety@gmail.com'];` | 리뷰 삭제/수정 admin 권한. 운영자 email 변경 시 admin 권한 상실 위험. **fix 권장** — env-driven 패턴 migration |

### HYBRID FALLBACK (LOW risk, env || hardcode)

env 정상 등록 시 fallback 미작동. env 누락 시에만 hardcode 사용.

| 파일:줄 | 코드 |
| --- | --- |
| `src/pages/AdminClaims.tsx:65` | `const isAdmin = user?.email === (import.meta.env.VITE_ADMIN_EMAIL || '2001leety@gmail.com');` |
| `src/pages/AdminPayments.tsx:90` | 동일 패턴 |
| `src/pages/AdminReviews.tsx:31` | `const ADMIN_EMAILS = [import.meta.env.VITE_ADMIN_EMAIL || '2001leety@gmail.com'];` |

권장: 별도 PR 로 `src/lib/admin.ts` 공통 헬퍼로 통합. 현재 prod 영향 0 (env 등록됨).

### HARDCODED_ADMIN_EMAILS 배열 fallback (LOW risk, 의도된 디자인)

paymentGate / loyalty / capture / manual-payment / admin.ts 5건. env 가 primary,
배열은 명시적 fallback (env split 결과와 concat).

| 파일:줄 |
| --- |
| `api/capturePaypalOrder.js:14` |
| `api/loyalty.js:48` |
| `api/manual-payment-request.js:39` |
| `api/_ai_core/paymentGate.js:34` |
| `src/lib/admin.ts:12` |

## 권한 우회 가능성 분석

### 1) 일반 사용자 token 으로 admin endpoint 호출

- `verifyAdminToken` 의 email !== ADMIN_EMAIL 분기 → 403.
- B-ADM1 가 3 endpoint 에서 자동 검증.
- **결과: 우회 불가**.

### 2) 위조 token

- Firebase `verifyIdToken(m[1], true)` 가 signature 검증 + checkRevoked 옵션.
- 위조 token → exception → 401.
- B-ADM2 가 4 시나리오에서 자동 검증.
- **결과: 우회 불가**.

### 3) email_verified=false

- Firebase 가입 시 unverified 가능 (Google OAuth 는 자동 verified, 이메일/패스워드는 X).
- `decoded.email_verified` 체크 → 403.
- **결과: 우회 불가**.

### 4) ADMIN_EMAIL env 가 빈 값

- `verifyAdminToken` 의 env 미설정 분기 → 500 명시적 에러 (silent allow 아님).
- Vercel preview/prod 모두 env 등록 필수 — 등록 안 되면 admin endpoint 전체 500.
- **결과: 우회 불가** (단, env 등록 누락 시 admin 기능 자체 사망).

### 5) HARDCODED_ADMIN_EMAILS fallback 악용

- paymentGate/loyalty 등 5 파일의 `HARDCODED_ADMIN_EMAILS = ['2001leety@gmail.com']`
  는 ADMIN_BYPASS_EMAILS env 와 concat. env 가 빈 값이어도 hardcoded 만 fallback.
- 사용자가 `2001leety@gmail.com` 으로 가입하면? → Google OAuth `email_verified=true`
  이지만 **uid 가 다름**. paymentGate 의 email 비교는 string 매칭이므로 동일 email 의
  다른 uid 가입자가 admin bypass 권한 획득 가능.
- **위험 등급: MEDIUM** — 운영자가 이미 해당 email 점유 중이라 신규 가입 불가능.
  단, 운영자 계정 탈취/유실 → email recovery 시 동일 email 재가입 가능 (Google 계정
  복구 우회 시).

### 6) reviews.js 의 pure hardcode

- `ADMIN_EMAILS = ['2001leety@gmail.com']` (env 없음).
- 운영자 email 변경 / B-team 이양 시 코드 수정 필요 → 운영 누락 위험.
- 보안 우회 자체는 X (서버측 토큰 검증은 별도).
- **위험 등급: LOW (보안) / MEDIUM (운영)** — env 패턴 migration 권장.

## 권장 후속 액션

### P0 (이번 PR 에 포함)
- ✅ B-ADM 5 assertion 자동 검증 (이 PR)
- ✅ audit 문서화 (이 파일)

### P1 (다음 PR, 별도)
- `api/reviews.js` 의 pure hardcode → `verifyAdminToken` 또는 ADMIN_EMAIL env 기반으로 migration
- frontend 3 파일 (AdminClaims/AdminPayments/AdminReviews) → `src/lib/admin.ts` 공통 헬퍼 사용으로 통합

### P2 (운영 정책)
- 운영자 secrets 등록:
  - `HEALTH_CHECK_NONADMIN_EMAIL` + `HEALTH_CHECK_NONADMIN_PASSWORD` (B-ADM1 활성화)
- 일반 사용자 계정 1개 prod 생성 (TEST- prefix 안 됨 — 진짜 일반 권한 검증용)
- (선택) 운영자 email 점유 검증 — Google 계정 보안 강화 (2FA + recovery key)

## 검증 빈도

- PR 단위: `ready-for-admin-regression` 라벨 trigger (admin auth 가 영향받는 PR 만)
- 정기: workflow_dispatch 수동 실행 (월 1회 권장)
- 자동 daily: 현재 미설정 — `daily-health.yml` 확장 후보
