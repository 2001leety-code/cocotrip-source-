# 05 — rollback 상태

## 실행 여부

**rollback 은 실행하지 않았다.** dry-run 만 수행했다.

## 🔴 FAIL-14 — 예전 dry-run 은 허수 검사였다

2026-07-29 이전 판의 dry-run 출력은 이랬다.

```
복구 대상 계정  : 4
  user-1 … user-4 : 보정 전 값으로 복구 예정
```

이 줄은 **스냅샷 문서를 읽어 그대로 찍은 것**이다. 현재 사용자 값도, correction 원장도,
쿠폰 상태도 확인하지 않았다. 그래서 실제로는 되돌릴 수 없는 계정도 "복구 예정" 으로 보였다.

지금은 dry-run 과 execute 가 **같은 판정 함수**(`readAndEvaluate` → `evaluateRollbackTarget`)를 쓴다.
dry-run 이 `ready` 라고 한 계정만 execute 에서도 통과한다.

```
════════ 보정 되돌리기 (DRY-RUN) ════════
planHash        : cf34e71db538b585
스냅샷 계정     : 4
  user-N: ✅ 복구 가능 — 지출 … · 예약 … · 코인 … · 등급 … 로 복구, 쿠폰 N장 원상복원
  user-N: ⛔ 복구 불가 — <사유> (<상세>)

복구 가능 x / 복구 불가 y / 검증 실패 z
복구 불가 사유  : {"stale_rollback":1, …}
Firestore       : 읽기 N / 쓰기 시도 0 / 실제 쓰기 0
```

dry-run 의 쓰기 0건은 문구가 아니라 **코드로 강제**한다.
`guardFirestore(db, { allowWrites: false })` 가 `set/update/delete/add/batch/runTransaction`
호출 자체를 예외로 만든다.

> ⚠️ 위 dry-run 출력은 **아직 다시 돌리지 않았다.** 실행하려면 운영 자격증명이 필요하고,
> 이번 라운드는 운영 접속 없이 코드·테스트·문서만 고쳤다. 판정 로직 자체는
> `tests/unit/loyalty-remediation-fail-14-17.test.ts` 에서 가짜 Firestore 로 검증했다.

## 실행하려면 (지금은 하지 않는다)

```bash
LOYALTY_ROLLBACK_APPROVAL=I-APPROVE-LOYALTY-ROLLBACK \
FIREBASE_PRODUCTION_PROJECT_ID=<운영자가 선언> \
node scripts/loyalty-remediation-rollback.mjs --confirm=cf34e71db538b585 --execute
```

셋(`--execute` + `--confirm` + env 승인)이 모두 있어야 하고, Production 대상 확인
(명시 ID = Admin 앱 연결 ID = 자격증명 ID)까지 통과해야 한다.

## rollback 안전장치 (FAIL-9 · FAIL-15)

읽기와 판정을 먼저 전부 끝내고, 아래를 **전부** 통과할 때만 되돌린다.

| 검사 | 실패 시 |
|---|---|
| correction 문서 존재 | `correction_missing` |
| `rolledBack !== true` | `already_rolled_back` |
| 사용자 문서 존재 | `user_missing` |
| `user.loyaltyCorrectionPlan === planHash` | `plan_mismatch` |
| **이 보정이 만든 correction 인가** (`identifyPollutionCorrection`) | `correction_invalid` |
| correction 의 `balance` · `tierAfter` 가 유효한 값인가 | `correction_invalid` |
| 현재 지출·예약·코인·등급 == 그 correction 의 보정 후 값 | `stale_rollback` |
| 대상 쿠폰이 여전히 이 plan 이 만든 상태 | `coupon_drift` |

어느 것이든 걸리면 **해당 사용자는 아무것도 쓰지 않는다** — 부분 복원 상태가 남지 않는다.

쿠폰 확인은 회수 필드 **전부**를 본다(FAIL-15). 예전에는 셋만 봐서, 그 사이 다른 작업이
`status` 나 회수 사유를 바꿔놓아도 통과했다.

| 필드 | 기대값 | 어긋나면 |
|---|---|---|
| `isRevoked` | `true` | `already_unrevoked` |
| `status` | `revoked` | `status_changed` |
| `revokedReason` | `issued_from_unverified_ai_plan_coins` | `reason_changed` |
| `revokedPlan` | 이 planHash | `revoked_plan_changed` |
| `revokedAt` | 존재 | `revoked_at_missing` |
| `isUsed` | `true` 아님 | `used_after_revoke` |
| 문서 존재 | 존재 | `missing` |

기대값은 스냅샷이 아니라 **correction 원장**(`spentUSDAfter` · `bookingCountAfter` · `tierAfter` ·
`balance`)에서 읽는다. 운영에 이미 생성된 스냅샷에는 `after` 가 없기 때문이다.

건너뛴 계정이 하나라도 있으면 종료 코드 8, 실패가 있으면 6 — 부분 성공을 전체 성공으로 보고하지 않는다.

## 복원 정확도

쿠폰은 "삭제" 가 아니라 **이전 상태 그대로 복원**한다.
실행 당시 존재하지 않던 필드만 지우고, 존재했던 필드는 원래 값으로 되돌린다
(`isRevoked` · `status` · `revokedReason` · `revokedPlan` · `revokedAt`).
