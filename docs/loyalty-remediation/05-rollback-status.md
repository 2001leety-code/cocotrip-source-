# 05 — rollback 상태

## 실행 여부

**rollback 은 실행하지 않았다.** dry-run 만 수행했다.

```
════════ 보정 되돌리기 (DRY-RUN) ════════
planHash        : cf34e71db538b585
복구 대상 계정  : 4
  user-1 … user-4 : 보정 전 값으로 복구 예정
  (이번 plan 이 바꾼 쿠폰만 원래 상태로 복원 — user-4 는 4장, 나머지는 0장)

⚠️ 되돌리지 않았다. 실제 복구는 --execute + env 승인 + Production 대상 확인이 있어야 한다.
```

## 실행하려면 (지금은 하지 않는다)

```bash
LOYALTY_ROLLBACK_APPROVAL=I-APPROVE-LOYALTY-ROLLBACK \
FIREBASE_PRODUCTION_PROJECT_ID=<운영자가 선언> \
node scripts/loyalty-remediation-rollback.mjs --confirm=cf34e71db538b585 --execute
```

셋(`--execute` + `--confirm` + env 승인)이 모두 있어야 하고, Production 대상 확인
(명시 ID = Admin 앱 연결 ID = 자격증명 ID)까지 통과해야 한다.

## rollback 안전장치 (FAIL-9 수정)

transaction 안에서 사용자·correction·대상 쿠폰을 모두 읽고, 아래를 전부 통과할 때만 되돌린다.

| 검사 | 실패 시 |
|---|---|
| correction 문서 존재 | `correction_missing` — 건너뜀 |
| `rolledBack !== true` | `already_rolled_back` — 건너뜀 |
| `user.loyaltyCorrectionPlan === planHash` | `plan_mismatch` — 건너뜀 |
| 현재 지출·예약·코인·등급 == 그 correction 의 보정 후 값 | `stale_rollback` — **해당 사용자 전체 무변경** |
| 대상 쿠폰이 여전히 이 plan 이 만든 상태 | `coupon_drift` — **해당 사용자 전체 무변경** |

기대값은 스냅샷이 아니라 **correction 원장**(`spentUSDAfter` · `bookingCountAfter` · `tierAfter` ·
`balance`)에서 읽는다. 운영에 이미 생성된 스냅샷에는 `after` 가 없기 때문이다.

건너뛴 계정이 하나라도 있으면 종료 코드 8, 실패가 있으면 6 — 부분 성공을 전체 성공으로 보고하지 않는다.

## 복원 정확도

쿠폰은 "삭제" 가 아니라 **이전 상태 그대로 복원**한다.
실행 당시 존재하지 않던 필드만 지우고, 존재했던 필드는 원래 값으로 되돌린다
(`isRevoked` · `status` · `revokedReason` · `revokedPlan` · `revokedAt`).
