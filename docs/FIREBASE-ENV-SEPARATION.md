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

## 이 다음에 할 일

분리가 끝나야 **샌드박스 결제 전 과정 시험**을 안전하게 할 수 있다:

승인 → 적립 → 중복 호출 → 부분 환불 → 전액 환불 → 중복 웹훅

각 단계에서 확인할 항목은 `docs/SANDBOX-PAYMENT-TEST-PLAN.md` 참조.
