# 충성도 원장 오염 보정 — 감사 기록 (2026-07-29)

과거 AI 플랜 생성이 `users/{uid}` 의 누적 지출·예약 수·코인을 올린 것을 보정한 기록이다.
개인정보(uid·이메일·예약번호·PayPal ID·프로젝트 ID)는 어느 문서에도 넣지 않는다. 계정은 순번만.

| 문서 | 내용 |
|---|---|
| [01-pre-execution-dryrun.md](01-pre-execution-dryrun.md) | 승인 당시 읽기 전용 dry-run (계획 해시 `cf34e71db538b585`) |
| [02-execution-result.md](02-execution-result.md) | **실제 운영 쓰기 실행 결과** |
| [03-double-subtraction-defect.md](03-double-subtraction-defect.md) | 실행 직후 발견한 이중 차감 결함 |
| [04-post-execution-dryrun.md](04-post-execution-dryrun.md) | 결함 수정 후 현재 상태 (**현재 사실**) |
| [05-rollback-status.md](05-rollback-status.md) | rollback 은 dry-run 만, 실행하지 않음 |
| [06-procedure-violation.md](06-procedure-violation.md) | 승인 문구 임의 해석 — 절차 위반 기록 |
| [07-fail-13-17.md](07-fail-13-17.md) | 머지 전 보완 — 계정 잔상·허수 dry-run·자동 보정 범위·합계 용어 |
| `transient-bug-reproduction-dryrun.{md,json}` | 🔴 **현재 상태 아님.** 결함이 남아 있던 시점의 dry-run, 재현 자료로만 보존 |
| `latest-dryrun.{md,json}` | `--report` 실행 시 갱신되는 최신 실행 결과 (감사 문서를 덮어쓰지 않는다) |

## 익명 순번 규칙

계정 번호는 **보정으로 바뀌지 않는 값**(오염 코인 → 오염 금액 → 오염 건수)으로 매긴다.
오염 이력은 삭제하지 않으므로 이 기준은 보정 전후로 흔들리지 않는다.
그래서 01·02·04 에서 같은 사람이 **같은 user-N** 이다. uid 는 동점 처리에만 쓰고 출력하지 않는다.

## 용어

"오염 이력 0건" 이라고 쓰지 않는다. 셋을 나눠 쓴다.

- **역사적 오염 이력** — 과거 잘못된 적립 기록. 감사 목적상 삭제하지 않으므로 보정 뒤에도 남는다
- **이미 제거된 몫** — 인정된 correction 이 이미 차감한 금액·코인
- **남은 미보정 오염** — 아직 안 뺀 몫. 이 값이 0 이어야 수렴한 것

## 한 줄 요약

승인된 계획대로 4계정을 보정했고(문서 16건, 실패 0), 실행 직후 발견한 재차감 결함을 같은 PR 에서
고쳤으며, **두 번째 실행은 하지 않았다.** 현재 남은 미보정 오염은 0, 보정 대상 0계정이다
(역사적 오염 이력 209건은 그대로 남아 있다). rollback 은 dry-run 만 했다.
