# 03 — 실행 직후 발견한 이중 차감 결함

> **두 번째 실행은 하지 않았다.** 이 문서가 설명하는 잘못된 제안은 운영에 적용된 적이 없다.

## 무슨 일이 있었나

[02 실행](02-execution-result.md) 직후 대사를 위해 dry-run 을 다시 돌렸더니,
이미 보정된 값을 **또 빼겠다** 고 제안했다.

```
보정 대상 계정  : 2
지출      $47,996.81 →         $0
예약              59 →          0
코인         140,642 →          0
```

이 제안을 실행했다면 정상 잔액까지 0 으로 밀었을 것이다. 실행하지 않고 원인을 찾았다.

재현 자료: `transient-bug-reproduction-dryrun.{md,json}`

## 근본원인

오염 이력(`pointHistory`)은 **감사 목적상 삭제하지 않는다**. 그래서 다음 dry-run 이 그 이력을
다시 계산한다. `subtract_pollution_only` 모드는 `현재값 − 오염분` 이므로, 두 번째 실행에서
같은 오염분이 한 번 더 빠진다.

같은 planHash 는 `correction_<planHash>` 문서로 막히지만, 보정 뒤에는 합계가 달라져
**계획 해시가 바뀌므로** 새 계획으로 다시 적용될 수 있었다.

> 사용자가 보정을 두 번 돌릴 때 정상 잔액이 0 이 되는 이유는,
> 오염 이력을 남겨 둔 채 매번 처음부터 다시 빼기 때문이다.

## 수정

correction 원장이 **이미 제거한 오염분**(지출 차·예약 차·코인 delta·오염 이력 수)을 들고 있으므로,
그만큼 제외하고 **아직 안 뺀 몫만** 차감한다.

```
remainingPollutedUSD    = max(0, pollutedUSD    − alreadyRemovedUSD)
remainingPollutedCoins  = max(0, pollutedCoins  − alreadyRemovedCoins)
remainingPollutedEntries= max(0, pollutedEntries− alreadyRemovedEntries)
```

## 후속 결함 (FAIL-8) — 판별 범위가 너무 넓었다

위 수정의 첫 판은 `type === 'correction'` 인 모든 기록을 "이미 제거된 오염분" 으로 합산했다.
다른 목적의 correction(운영자 수동 조정 등)이 있으면 **아직 안 뺀 오염분이 숨겨져** 보정이 덜 된다.

→ `identifyPollutionCorrection()` 을 만들어 이 보정이 만든 것만 인정한다. 전부 통과해야 한다.

- 문서 ID 가 `correction_<planHash>` 와 정확히 일치
- `correction.planHash` 존재 + 문서 ID 의 해시와 일치
- `mode` 가 허용 목록(`recompute_from_ledger` / `subtract_pollution_only`)
- 스키마 식별자(`ai-plan-pollution-correction/v1`) **또는** 정확한 설명 접두사 + `(plan <hash>)`
  — 운영에 이미 생성된 4건은 스키마 필드가 없어 후자로 호환 인식
- 금액·예약·코인 차감값이 숫자이고 방향이 맞음(줄어드는 쪽)
- `rolledBack !== true`

하나라도 어긋나면 인정하지 않고 **`ambiguous correction`** 으로 세어 보고한다(자동 반영 금지).

## 확인

수정 후 운영 읽기 전용 dry-run:

```
correction 인정 4 / 보류 0
남은 오염 $0 · 보정 대상 계정 0 · 실행 시 문서 수 0
Firestore 읽기 25 / 쓰기 시도 0 / 실제 쓰기 0
```

운영에 이미 생성된 레거시 correction 4건이 **전부 정상 인식**됐다.
