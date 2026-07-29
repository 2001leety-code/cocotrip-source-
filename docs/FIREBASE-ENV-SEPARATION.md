# Preview / Production Firebase 분리 — 운영 절차서

작성 2026-07-29. 대상: 운영자(Vercel·Firebase 콘솔 접근 권한 필요).

---

## 왜 하는가

지금은 **Vercel Preview 배포가 운영 Firebase 프로젝트를 그대로 쓴다.**
그래서 프리뷰에서 돌린 테스트 결제가 **운영 예약·포인트·플랜을 실제로 기록한다.**

이번 감사에서 그 결과가 숫자로 확인됐다:

| 항목 | 실측 |
|---|---|
| 오염된 계정 | 4 |
| 잘못 적립된 이력 | 209건 |
| 잘못 발급된 코인 | 629,237 |
| 잘못 더해진 지출 | $210,219.21 |
| 15% 쿠폰 환산 상한 | 314장 |

분리 전에는 **샌드박스 결제 시험(#11)을 하면 안 된다.** 운영 데이터가 또 오염된다.

---

## 코드 쪽은 이미 준비돼 있다

`api/_shared/firebase-env-guard.js` 가 부팅 시 1회 검사한다.

| 배포 환경 | 붙은 Firebase | 판정 |
|---|---|---|
| production | 운영 프로젝트 | 통과 |
| production | 그 외 | 차단 대상 |
| preview / development | 운영 프로젝트 | **차단 대상** |
| preview / development | 그 외 | 통과 |

- 운영 프로젝트 식별은 `FIREBASE_PRODUCTION_PROJECT_ID` 로 한다.
- 이 값이 없으면 **판정을 보류하고 통과**시킨다(설정 전에 배포가 죽지 않게).
- 기본 동작은 `warn`(로그만). 분리를 끝낸 뒤 `FIREBASE_ENV_GUARD=enforce` 로 올리면
  잘못된 조합에서 함수가 **실행 전에 멈춘다**.

---

## 절차

### 1. Preview 전용 Firebase 프로젝트 생성

Firebase 콘솔 → 프로젝트 추가 → 예: `cocotrip-preview`.

- Firestore 생성 (운영과 같은 리전 권장: `nam5`)
- Authentication → 사용할 로그인 제공업체를 운영과 동일하게 활성화
- 프로젝트 설정 → 서비스 계정 → **새 비공개 키 생성** (JSON 다운로드)

### 2. 보안 규칙·색인을 프리뷰에도 배포

```bash
firebase deploy --only firestore:rules,firestore:indexes --project cocotrip-preview
```

> 색인 배포 워크플로(`.github/workflows/deploy-firestore-indexes.yml`)는 현재 운영만 대상이다.
> 프리뷰에도 자동 배포하려면 그 워크플로에 프로젝트를 하나 더 추가한다.

### 3. Vercel 환경변수 — **Preview 스코프에만** 넣는다

Vercel → 프로젝트 → Settings → Environment Variables → Environment = **Preview** 체크.

| 키 | 값 |
|---|---|
| `FIREBASE_PROJECT_ID` | `cocotrip-preview` |
| `FIREBASE_CLIENT_EMAIL` | 프리뷰 서비스 계정 이메일 |
| `FIREBASE_PRIVATE_KEY` | 프리뷰 서비스 계정 비공개 키 |
| `VITE_FIREBASE_API_KEY` 외 `VITE_FIREBASE_*` | 프리뷰 웹앱 설정값 |

⚠️ Production 스코프의 기존 값은 **건드리지 않는다.**

### 4. 양쪽 스코프에 공통으로 넣는 값

| 키 | Production | Preview |
|---|---|---|
| `FIREBASE_PRODUCTION_PROJECT_ID` | 운영 프로젝트 ID | **같은 운영 프로젝트 ID** |

두 환경 모두 "운영이 어느 것인지"를 알아야 가드가 판정할 수 있다.
Preview 에 운영 ID 를 넣는 것은 **비교 대상**으로 쓰기 위함이지 접속용이 아니다.

### 5. 배포 후 확인

프리뷰 함수 로그에서 아래가 **안 보여야** 정상이다.

```
[firebase-env-guard] preview-deploy-on-production-firebase
```

보이면 3번이 안 먹은 것이다(Preview 스코프 미체크 / 재배포 누락).

> ⚠️ Vercel 의 "Redeploy" 는 **옛 env 스냅샷을 재사용한다.** 반드시 새 커밋을 푸시해
> 프레시 빌드를 만들어야 새 환경변수가 반영된다.

### 6. 강제 모드로 올린다

프리뷰 로그가 깨끗한 것을 확인한 뒤, **양쪽 스코프**에 추가:

| 키 | 값 |
|---|---|
| `FIREBASE_ENV_GUARD` | `enforce` |

이후 잘못된 조합은 함수가 실행 전에 멈춘다.

---

## 되돌리기

문제가 생기면 `FIREBASE_ENV_GUARD` 를 `warn` 으로 내리거나 삭제한다.
그 즉시 가드는 로그만 남기고 통과시킨다. 코드 롤백 불필요.

---

## 배포 환경 선행조건 (2026-07-29 확인 — 셋 다 아직 없음)

| 키 | 스코프 | 없으면 무슨 일이 생기나 |
|---|---|---|
| `FIREBASE_PRODUCTION_PROJECT_ID` | Production + Preview | 가드가 **판정 자체를 못 한다** → 무조건 통과 |
| `FIREBASE_ENV_GUARD=enforce` | Preview (분리 완료 후) | 경고만 찍고 그대로 운영 데이터를 쓴다 |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Preview | 프리뷰 자기호출이 SSO 벽에 막혀 401 |

> 두 번째 값은 **Preview 에 먼저** 넣는다. Production 에 먼저 걸면 설정 실수 하나로
> 운영 결제 API 가 통째로 멈춘다. Preview 가 조용한 것을 확인한 뒤 Production 에도 올린다.

`VERCEL_AUTOMATION_BYPASS_SECRET` 은 Vercel → Settings → Deployment Protection →
"Protection Bypass for Automation" 에서 생성하면 자동 주입된다. 직접 값을 적지 않는다.

### 왜 이게 Firebase 분리와 세트인가

`booking-processor` 의 적립 호출은 이제 `internalMoneyApiBase()` 를 쓴다.
이 함수는 **운영이 아니면 운영 도메인을 절대 돌려주지 않는다**(주소 특정 불가 시 `null` → 적립 보류).
그래서 Preview 에서 적립을 돌리려면 프리뷰 자기호출이 SSO 벽을 넘어야 하고,
그건 위 bypass secret 이 있어야 가능하다. 셋이 갖춰져야 샌드박스 e2e 가 성립한다.

## PayPal 자격증명 스코프 정리

| 키 | Production | Preview |
|---|---|---|
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | ✅ Live 값 | (프리뷰도 서명 검증용으로 필요) |
| `PAYPAL_WEBHOOK_ID` | ✅ Live 웹훅 ID | 프리뷰용 값 |
| `PAYPAL_SANDBOX_CLIENT_ID` | ❌ **두지 않는다** | ✅ |
| `PAYPAL_SANDBOX_SECRET` | ❌ **두지 않는다** | ✅ |
| `PAYPAL_SANDBOX_WEBHOOK_ID` | ❌ **두지 않는다** | ✅ |
| `VITE_PAYPAL_SANDBOX_CLIENT_ID` | ❌ **두지 않는다** | ✅ |
| `PAYPAL_ENV` | 설정하지 않음 | `sandbox` |

코드 쪽 방어는 이미 들어가 있다 — `resolveIsSandbox()` 가 `VERCEL_ENV==='production'` 이면
무조건 `false` 라, 운영에 `PAYPAL_ENV=sandbox` 를 실수로 넣어도 샌드박스 경로가 열리지 않는다.
위 표는 **그 방어에 기대지 않기 위한** 2차선이다.

> 비밀값은 어디에도 적지 않는다. 이 문서는 "어느 스코프에 무엇을 두는가" 만 다룬다.

## 이 다음에 할 일

위 선행조건 + 분리가 끝나야 **샌드박스 결제 전 과정 시험**을 안전하게 할 수 있다:

승인 → 적립 → 중복 호출 → 부분 환불 → 전액 환불 → 중복 웹훅

확인 순서:

1. 프리뷰 함수 로그에 `[firebase-env-guard]` 경고가 **없다**
2. 프리뷰에서 `bookings` 문서가 **프리뷰 Firestore 에만** 생긴다
3. 적립 호출 주소가 프리뷰 배포 URL 이다(운영 도메인이 아니다)
4. 프리뷰가 운영 Firebase 를 가리키도록 되돌려 놓으면 API 가 **실제로 실패**한다 (enforce 확인)
5. 운영 `paypal_webhook_log` 에 `paypalEnvironment: 'sandbox'` 인 문서가 하나도 없다
