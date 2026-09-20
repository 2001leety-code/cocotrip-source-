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

## 2026-09-20 /charter 로컬 문의 검증

- 기본 `npm run dev`는 `/api` 운영 프록시가 섞일 수 있으므로 사용하지 않고 전용 Playwright 명령을 쓴다.
- `npx --no-install playwright test --config=tests/playwright-charter-local.config.ts`는 합성 환경·loopback Vite·외부 통신 차단 하네스를 사용한다.
- 비회원 일반 차량은 금액 견적, 버스는 협의 문의 화면으로 분기하는 계약을 확인한다.
- InquiryForm 성공 문구에는 모바일 밝은 배경용 `[.cocotrip-mobile-charter_&]:text-emerald-800` 보정 1줄을 반영했다.
- 이 수정은 모바일에서 `text-emerald-100` 성공 문구가 읽히지 않던 재현 결함만 다룬다.
- Step5에서 입력했던 이름·편명을 지워도 Next가 켜지는 결함을 재현했다.
- 원인은 `Step5DateOptions.handleFieldsChange`가 빈 값 patch를 생략해 이전 상태로 게이트가 판정되는 것이다.
- 자동채움 보호와 사용자 삭제를 구분해 빈 값을 전달하고 필수입력을 다시 검사하는 수정은 승인 대기 중이다.
- `inquiry-submit-contract.test.ts`의 게스트·bus 계약 4개 선택 검사는 통과했고 범위 밖 14개는 실행하지 않았다.
- 색상 수정 뒤 `npm run build`는 통과했으며 `npm run lint` 607오류·21경고는 기준선과 동일하다.
- 전용 Playwright 전체 9개는 8통과·1실패(Step5 삭제 재현)이며 실패를 숨기지 않았다. 모바일 성공문구 대비는 5.49:1로 확인했다.
- 실제 Firestore 저장·메일·Telegram 전달 성공을 뜻하지 않으며 외부 저장·발송·운영·push·merge·deploy는 하지 않는다.

## 2026-09-21 /charter 입력 삭제 후속

- 승인 범위는 Step5 이름·항공편명 삭제와 초기 자동채움 보존, 관련 격리검사로 한정했다.
- 원인은 폼이 처음 열릴 때 전달되는 빈 값과 사용자 삭제를 동일하게 무시한 상태 반영이었다.
- `Step5DateOptions.tsx`만 `useRef`로 직전 이름·편명 변경을 구분하고, 사용자 삭제 빈 값은 상태에 반영했다.
- 성·이름이 비면 진행을 막고, 편명 삭제 때 이전 조회 결과를 비우며 터미널·수하물은 유지한다.
- 변경 전 `20260921-before-repro.log`는 1건 실패, `20260921-after-repro.log`는 동일 재현 1건 통과했다.
- 성 삭제·이름 삭제·동시 삭제 조건을 보완한 `20260921-after-fix-repro.log`도 1건 통과했다.
- `BookingInfoForm`·`CharterWizard`·API·가격·인증은 수정하지 않았다.
- 전용 Playwright 최종은 2026-09-21 04:00 KST 약 88초, 10통과·실패 0·skip 0, 외부 통신 0·pageerror 0이다. 일반 견적·버스 문의 성공/500/abort/누락·중복·조회 실패·모바일·데스크톱/390px 삭제 복구를 포함한다.
- 삭제 검증은 성·이름 각 항목, 둘 다, 편명에서 비활성화 검사를 통과했다. 즉시 snapshot 1건은 effect 반영 전 값이므로 차단 시간으로 해석하지 않는다.
- 새 `charter-step5-booking-sync.component.test.tsx`는 실제 Step5·BookingInfoForm·MemoryRouter 렌더와 외부 fetch 0호출을 1통과했다. targeted lint 0, `git diff --check` 통과.
- Step5 SHA256는 `781785f611594260686c0707f7751a2bcd557a90c65feacec20432b29c6d1eb3`, `npm run build`는 EXIT 0이다. 전체 lint는 EXIT 1, 607오류·21경고이며 시작 전후 로그가 동일하다.
- 오늘 제품 변경은 `Step5DateOptions.tsx` 한 파일이고, 전날 `InquiryForm.tsx`·`charter-local-server.mjs`·`playwright-charter-local.config.ts`는 바이트 동일하게 보존했다. 기존 e2e 검사는 오늘 수정했다. 운영 검증은 별도 범위다.
- 실제 저장·발송·운영 DB·결제·배포·커밋·push·merge는 확인하거나 실행하지 않았다.
