# 운영 알림 신뢰성 오답노트 — 2026-08-31

## 실제로 잘못됐던 점

- Daily Health의 첫 핵심 검사가 실패해도 알림 조건은 L3 회귀 단계만 보고 있었다.
  그래서 workflow는 빨강인데 Telegram과 GitHub Issue가 모두 생기지 않았다.
- Issue 생성 명령이 저장소에 없는 라벨에 의존해, 장애를 발견하고도 기록 단계에서 다시
  실패할 수 있었다.
- Uptime smoke는 실패 출력을 남기고도 `exit 1`을 하지 않아 workflow가 초록이 됐다.
- Telegram과 Discord에 같은 운영 장애를 중복 발송했고, webhook HTTP 오류도 성공처럼
  넘겼다.
- 품질 감시 Issue는 실행 중 계산한 심각도 라벨이 저장소에 없으면 생성이 끊길 수 있었다.

## 다시 틀리지 않는 기준

1. 개별 검사 결과와 알림 조건은 서로 다른 판정식을 만들지 않는다. 모든 핵심 단계의
   `outcome`을 한 verdict로 합산하고 Issue·Telegram·최종 exit가 그 verdict만 본다.
2. 모니터링 실패는 반드시 nonzero로 끝낸다. 후속 정리 단계는 `if: always()`로 실행한다.
3. 운영 긴급 알림은 Telegram 한 곳, 지속 기록은 GitHub Issue로 역할을 나눈다.
   콘텐츠 검토용 Discord 흐름은 별도로 유지한다.
4. `curl`은 네트워크 오류뿐 아니라 HTTP 오류도 판정한다. 알림 API는
   `--fail-with-body --show-error`를 사용한다.
5. Issue 생성은 존재가 확인되지 않은 라벨에 의존하지 않는다.
6. 매시간 감시는 장애가 이어진다고 매시간 같은 Telegram을 보내지 않는다. 첫 실패는
   즉시 알리고, 미복구 상태의 재알림은 6시간 간격으로 제한하며 정상 회복 시 Issue를 닫는다.

## 회귀 잠금

- `tests/unit/workflow-alert-reliability.test.ts`
- `tests/unit/daily-health-no-fake-green.test.ts`
- `tests/unit/daily-health-playwright-browsers.test.ts`
- 변경한 workflow 6개를 PyYAML과 actionlint로 정적 검증한다.

실제 Telegram 메시지, Issue 생성, GitHub Secret 값 조회는 로컬 검증에서 실행하지 않는다.
