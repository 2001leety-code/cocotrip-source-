# 최종 안정화 오답노트 — 2026-07-29

대상: 🌐웹(cocotripkr.com, Vercel=prod), PR #1187.

## 1. 결제 성공 뒤 후속 작업을 `void`로 부른 실수

- 잘못된 생각: 함수가 응답을 끝낸 뒤에도 서버리스가 비동기 작업을 계속 실행할 것이다.
- 실제 결과: PayPal Capture와 예약 문서는 성공했지만 시트·메일·바우처·적립 호출이 시작되지
  않았고, 실패 재처리 문서도 없었다.
- 재발 방지: Capture 성공 시 `bookings/{orderID}`와
  `pending_processor_retries/{orderID}`를 같은 batch로 먼저 저장한다. 그 다음 processor를
  기다리고, 성공해야 `done`으로 닫는다. 성공 표시 저장이 실패해도 pending intent가 남는다.

## 2. 환불을 예약 상태 변경으로만 본 실수

- 잘못된 생각: PayPal 환불과 예약의 `REFUNDED` 표시가 맞으면 돈 정합성이 끝난다.
- 실제 결과: 누적 지출·예약 수·코인·등급·AI 해금·구매 쿠폰은 그대로 남았다.
- 재발 방지: 환불 원장 transaction이 예약 2벌, 웹훅 로그, 사용자 지갑, 포인트 환불 원장,
  AI 구매 원장, 구매 쿠폰을 함께 갱신한다.
- 이미 쓴 코인이나 쿠폰은 음수 회수하지 않는다. `refund_benefit_reviews/{orderID}`에
  수동 확인 사유를 남긴다.
- 적립과 환불의 경쟁은 둘 다 `bookings/{orderID}`를 transaction 안에서 읽게 해 한쪽을
  자동 재실행시킨다.

## 3. Preview CI에 운영 Firebase 자격증명을 쓴 실수

- 잘못된 생각: Preview URL만 바꾸면 기존 운영 테스트 계정을 그대로 써도 된다.
- 실제 결과: Preview Firebase 분리 뒤 PDF 검사는 인증 401, 시각 검사는 운영 fixture
  plan을 찾지 못해 실패했다.
- 재발 방지: GitHub Actions에 아래 Preview 전용 Secrets만 연결한다.
  - `PREVIEW_FIREBASE_WEB_API_KEY`
  - `PREVIEW_HEALTH_CHECK_EMAIL`
  - `PREVIEW_HEALTH_CHECK_PASSWORD`
  - `PREVIEW_PDF_GOLDEN_PLAN_ID`
- Preview Firebase의 전용 사용자와 개인정보를 제거한 고정 fixture plan을 사용한다.
  운영 감시 작업의 기존 Secrets와 섞지 않는다.

## 잠금 검증

- 결제 1건당 processor intent 1건
- 적립·환불 동시 실행 최종값 일치
- 부분환불 뒤 전액환불 누계 및 혜택 회수
- 중복 refund ID/event ID 무반복
- 환불된 예약의 뒤늦은 적립·AI 해금·구매 쿠폰 발급 차단
- Preview 워크플로의 운영 Firebase Secret 참조 0건
