# 문의 자동 접수확인 오답노트 (2026-08-31)

## 발견한 함정

자동 접수확인에 기존 `INQUIRY_RESPONSE_WORKER_ENABLED`를 공통 조건으로 사용하면, 접수 확인만 켜려는 운영 조작이 과거 `NEW/pending` 문의 초안 생성과 승인된 최종답변 재시도까지 함께 시작시킨다. `AUTO_ACK_NOT_BEFORE`는 이 기존 흐름을 막지 못하므로 역사 데이터 오발송 위험이 있다.

## 바꾸지 않을 규칙

- 자동 접수확인은 자체 환경변수·정확한 UTC 시작시각·시간창·일일상한·런타임 토글만으로 작동한다.
- `INQUIRY_RESPONSE_WORKER_ENABLED=false`인 접수확인 전용 운영에서 초안 생성과 최종답변 재시도 쿼리는 0건이어야 한다.
- 반대로 자동 접수확인이 OFF일 때 기존 초안·최종답변 워커의 행동은 바뀌지 않아야 한다.
- 운영 토글은 결제 화면이 아닌 `/admin/claims` 문의 탭에 두어 조작 대상과 영향을 같은 맥락에서 보여 준다.

## 회귀 방지

`tests/unit/inquiry-response-cron-contract.test.ts`에서 두 워커의 독립을 쿼리 단위로 고정하고, `tests/unit/runtime-flags-panel.component.test.tsx`에서 문의 화면에 결제 플래그가 노출되지 않는지 검사한다. DEV 하네스는 메일·인증·운영 API 없이 데스크톱과 390px 모바일에서 실제 조작을 확인한다.
