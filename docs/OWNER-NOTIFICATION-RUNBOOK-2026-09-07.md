# 본인 기기 예약·문의 알림 — 비활성 구현 및 활성화 전 확인

## 본인 폰 한 대 시험 (2026-09-12)

1. 알림을 받을 폰에서 `/admin/ai-center`에 관리자 계정으로 로그인한다. `이 기기 알림 → 이 기기 등록 → 허용` 후 `기기 등록됨`을 확인한다. 채팅에서의 승인으로 브라우저 권한을 대신할 수 없다.
2. 기존 **Vercel Production** 설정의 `OWNER_NOTIFICATION_UID`와 `OWNER_NOTIFICATION_SUBSCRIPTION_ID`가 그 기기의 실제 등록과 일치해야 한다. `OWNER_EVENT_PUSH_ENABLED`, 언어·보관기간·기존 VAPID 설정도 모두 필요하다. 이번 코드는 설정을 생성/변경하지 않으며, 키나 endpoint를 화면/로그로 출력하지 않는다.
3. `내 폰 알림 시험 → 이 기기 연결 확인`은 읽기 전용이다. 서버 지정과 다르거나 비활성/불명확하면 발송 버튼을 제공하지 않는다.
4. 준비된 폰에서만 `이 기기에 시험 알림 보내기`를 누른다. 고정된 시험 문구를 한 구독에만 보낸다. `/api/admin-test-push`의 기존 전체 구독 발송을 대신 사용하지 않는다.
5. `알림 서비스가 요청을 접수했습니다`는 폰 도착 증명이 아니다. 실제 폰 알림 도착·알림 클릭 후 AI 센터 열림을 별도로 확인한다. 기존 작성 중 화면을 덮어쓰지 않는 알림 이동 처리는 유지한다.

시험 장부는 `owner_notification_control/owner-notification-test-<scope hash>` 한 문서이며 고객 내용/주소/endpoint/키를 저장하지 않는다. 같은 요청은 한 번만, 최소 60초 간격, 최대 8회 이력을 유지한다. 8회 도달·손상·불명확한 결과는 검토 필요로 멈추며 자동 삭제/초기화·재전송은 하지 않는다. 자동 문의 sweep의 기준 시각/원본/정책은 변경하지 않는다.

검증: `npm exec vitest run tests/unit/admin-owner-notification-test.test.ts tests/unit/owner-device-test.test.tsx`와 로컬 dev 서버에서 `node scripts/verify-owner-device-test.mjs http://127.0.0.1:5189`. 합성 브라우저 검증은 외부 API를 차단하며 실제 로그인·알림 수신 완료로 계산하지 않는다.

2026-09-09 보완: v2 회사 문의는 원본의 0 기한이 아니라 상담 case의 상태/기한/만료 구간을 확인한다. 이전 양수 만료 조건 때문에 v2 문의가 알림 후보에서 누락되던 문제를 수정했다. 회사 원본 해시와 상담 연결을 확인하고, 상담 조회 실패는 해당 위치를 보류한다. 메일 답장/실운영 연결 현황은 [후속 문서](COMPANY-EMAIL-REPLY-2026-09-09.md)를 따른다. 휴대폰 실수신 완료를 뜻하지 않는다.

🌐웹 전용. 2026-09-07 승인된 서버 연결 구현이며, **실제 활성화·실제 발송·휴대폰 수신 검증 완료 문서가 아니다.**

## 연결 범위

- `pending_bookings`, `bookings`, `mood_bookings`의 새 예약 접수, `charter_inquiries`, `cs_tickets`의 새 문의 접수만 대상으로 한다.
- 문의는 첫 조회 때 `NEW`/`pending`/`open`/`in_progress`인 새 접수만 알린다. 조회 전에 답변/종료되어 `responded`/`resolved`/`closed` 등이 되면 알리지 않는다. 따라서 **모든 새 문의 접수 이력 알림이 아니라, 새로 접수되어 아직 열려 있는 문의 알림**이다. 30초 안정화 구간이나 다음 5분 실행 전에 자동/수동 처리가 끝난 문의도 제외된다.
- 등록된 생성 시각과 허용 상태만 읽는다. 취소/환불/완료 기록, 명시적인 `isTest=true`, `testMode=true`, 온라인 `paypalEnvironment=sandbox`는 제외한다. 테스트 표시가 없는 원본까지 테스트라고 자동 판별하지 않는다.
- 입금대기와 그 확정본은 같은 예약 식별값으로 중복을 막는다. 장바구니 자식 예약은 상위 주문 하나로 묶는다. 알림은 접수 안내일 뿐 결제 완료나 확정 상태 보증이 아니다.
- 기존 예약의 상태 변경, 과거 기록 이관, `chat_sessions`의 일반 채팅, Gmail 수신, WhatsApp, API 비용 알림은 이번 연결에 포함하지 않는다. CS 티켓은 일반 채팅 전체와 같지 않다.
- 원본 예약·문의·결제·구독 문서를 쓰거나 지우지 않는다. 고객 기존 푸시 함수와 발송 정책도 바꾸지 않는다.

실제 작성 코드와 대조한 메타데이터 계약:

| 원본 | 작성 코드 | 생성 시각 / 최초 상태 / 묶음 식별 |
|---|---|---|
| 입금대기 | `api/manual-payment-request.js` | serverTimestamp / `AWAITING_VERIFICATION` / `bookingRef` |
| 온라인 단건 | `api/capturePaypalOrder.js` | serverTimestamp / `CONFIRMED` / `bookingRef=orderID`, `paypalEnvironment` |
| 장바구니 자식 | `api/_shared/cart-capture.js`, `api/captureCartOrder.js` | serverTimestamp / `CONFIRMED` / `parentOrderID`, `paypalEnvironment` |
| 입금 확정본 | `api/_shared/booking-confirm.js` | serverTimestamp / `CONFIRMED` / 문서 ID가 capture ID여도 `bookingRef`는 입금대기 원본 ID, provider는 `paypal-manual` 또는 `paypal-webhook` |
| MOOD | `api/mood-book.js` | `Date.now()` 숫자 / `confirmed` / 원본 문서 ID |
| 웹 문의 | `api/inquiry-submit.js` | serverTimestamp / `NEW` |
| CS 티켓 | `api/telegram-webhook-admin.js` | serverTimestamp / `open` |

입금·MOOD·웹 문의·CS의 위 작성 지점은 별도 테스트 표시를 항상 저장하지 않는다. 테스트 자동 식별 범위를 이 사실보다 넓게 주장하지 않는다. 문의 최종 응답 성공은 `api/_shared/inquiry-response-delivery.js`에서 `responded` 상태로 바뀔 수 있다.

## 필수 설정 — 운영자가 Vercel Dashboard에서만

값은 이 문서·Git·명령 로그에 쓰지 않는다. 이번 작업에서 환경변수 등록·변경은 하지 않았다.

| 위치 | 이름 | 의미 |
|---|---|---|
| Vercel | `OWNER_EVENT_PUSH_ENABLED` | 정확히 `true`일 때만 검토 시작. 기본은 꺼짐. 실제 활성화 별도 승인 |
| Vercel | `VERCEL_ENV` | Vercel이 제공하는 값이 `production`일 때만 가능. preview/development 강제 비활성 |
| Vercel | `OWNER_NOTIFICATION_UID` | 서버에서 다시 확인할 본인 관리자 계정 |
| Vercel | `OWNER_NOTIFICATION_SUBSCRIPTION_ID` | **운영자가 확인한 Android 휴대폰 한 대**의 기존 구독 문서 ID. 다른 기기로 자동 확대하지 않음 |
| Vercel | `OWNER_NOTIFICATION_LANGUAGE` | `ko` / `en` / `ja` / `zh` 중 명시 선택 |
| Vercel | `OWNER_NOTIFICATION_RETENTION_DAYS` | 전송 장부 보관 기준. 운영자가 1~90 정수 중 선택. 기본값 없음 |
| Vercel 기존 | `ADMIN_EMAIL` 또는 대체 `VITE_ADMIN_EMAIL` | 기존 서버 관리자 판정 기준 |
| Vercel 기존 | `CRON_SECRET` | 예약 작업 인증에 재사용. cursor 암호화에는 목적 구분한 파생키만 사용. 이 구현은 최소 32바이트 설정을 요구 |
| Vercel 기존 | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VITE_VAPID_PUBLIC_KEY` | 기존 푸시 키. 서버·브라우저 공개키가 일치해야 함. 새 키 발급·교체 없음 |
| Vercel 기존 | `VAPID_SUBJECT` | 기존 연락처. 미설정 시 기존 발송기와 같은 회사 연락처 사용 |

설정이 없거나 유효하지 않으면 신규 worker의 SDK 초기화·DB 조회·발송은 0회다. 예약 작업의 HTTP 인증은 이 검사와 별도로 유지한다. 새 GitHub Secrets는 필요하지 않다.

현재 단일 기기 전송은 Android/Chrome의 `https://fcm.googleapis.com/fcm/send/...` 또는 `/wp/...`만 허용한다. 외부 주소나 다른 플랫폼으로 자동 전환하지 않는다. 구독 문서 ID의 본인 namespace와 실제 저장 UID, endpoint에서 계산한 기존 문서 ID를 모두 대조하며, 키/endpoint가 바뀌면 기존 대상이라고 간주하지 않는다.

## 최초 활성화와 이후 재개

1. 운영자가 계정·휴대폰 기기·문구 언어·보관기간·활성화 범위를 승인하고 설정한다. 설정 이름 존재는 값의 유효성이나 실기기 수신 증거가 아니다.
2. 첫 정상 실행은 선택된 계정/기기를 검증하고 `owner_notification_control/v1`에 기준 시각과 암호화 cursor를 만든다. 이 첫 실행에서는 원본 조회나 알림 발송을 하지 않는다.
3. 이후 5분마다 각 원본을 `createdAt`와 문서 ID 순서로 이어 읽는다. MOOD의 숫자 시각과 나머지 Firestore Timestamp 타입을 구분하고, Timestamp의 나노초를 보존한다.
4. 처음 기준 시각 이전 자료를 소급 발송하지 않는다. 이어 읽기 위치와 새 전송 장부 기록은 같은 transaction에서 반영한다. 중간 실패 시 다음 실행에서 다시 확인한다.
5. 한 번에 원본별 10개, 발송 최대 3건, 실행 시간 예산 40초다. 많은 접수는 다음 실행으로 이어진다. **5분은 확인 주기이며, 모든 상황에서 5분 내 도착을 보증하는 시간이 아니다.**

원본은 기존 작성 코드의 생성 시각을 신뢰하며 30초 안정화 구간을 둔다. 이미 지나간 시각으로 자료를 새로 삽입하거나 생성 시각을 나중에 과거로 바꾸는 이관까지 발견한다고 보증하지 않는다. 이런 이관은 별도 계획과 검증이 필요하다. 현재 운영센터의 '최근 N개' 목록을 알림 cursor로 사용하지 않는다.

계정/선택 구독/언어/보관기간이 달라지거나 기기의 endpoint/키가 바뀌면 `CONFIGURATION_CHANGED`로 보류한다. 기존 기준 시각과 cursor를 삭제하거나 다시 초기화하지 않는다. 꺼졌다가 같은 설정으로 다시 켜면 기존 cursor부터 이어지므로, 중단 기간 자료를 어떻게 처리할지는 재활성화 전 운영자가 확인한다.

## 저장하는 것과 저장하지 않는 것

- `owner_notification_events`: 사건·기기·설정 범위의 해시, 예약/문의 종류, 시각, 만료 시각, 시도 횟수, 상태, 임시 잠금 토큰만 저장한다. 원본 예약/문의 ID, 이름, 전화, 메일, 금액, 일정, 고객 문장, 구독 endpoint/키는 장부에 복사하지 않는다.
- `owner_notification_control/v1`: 첫 활성 시각, 잠금, 원본별 암호화한 이어 읽기 위치를 유지한다. cursor의 원본 문서 ID는 평문으로 저장하지 않는다.
- 원본별 상태에는 원본 종류, 고정 오류 코드, 확인 시각, 연속 실패 횟수만 기록한다. 오류 원문이나 문제가 된 고객/예약 ID는 기록하지 않는다.
- cursor 암호화는 기존 `CRON_SECRET`에서 HKDF-SHA256으로 목적을 구분해 파생한 AES-256-GCM 키를 쓴다. 매번 임의의 96비트 IV를 만들고 설정 범위와 원본 종류를 인증 추가 데이터에 묶는다. 새 비밀값을 발급하거나 파일에 저장하지 않는다.
- 암호문 변조·범위 불일치·암호 해제 실패·기존 `CRON_SECRET` 교체 시 자동 초기화/소급 발송 없이 보류한다. 복구나 설정 변경 시 기준 시각을 보존하는 별도 운영자 승인 절차가 필요하다. 그 복구를 이번 코드가 임의 실행하지 않는다.
- 새 collection은 서버 내부용이다. Firestore 고객 보안 규칙을 열지 않았으며, 프론트에서 장부를 조회하는 화면도 이번 범위에 없다.
- 활성 실행은 보관기간이 지난 전송 장부를 최대 25건씩 정리한다. 비활성/장애 중에는 정리도 실행되지 않고, 대량 적체 시 다음 실행으로 이어진다. **설정 일수 정각에 삭제를 보장하는 TTL 기능은 아니다.** 이어 읽기용 현재 제어 상태는 운영 기간 동안 유지하며 서비스 종료 시 별도 정리가 필요하다. 이 보관 방식까지 활성화 전 승인한다.

## 전송과 실패

- 잠금화면은 선택 언어의 고정 제목·접수 안내이며 URL은 `/admin/ai-center` 하나다. tag는 해시만 사용한다.
- 매 실제 전송 직전에 Firebase Auth에서 계정 UID, 이메일 확인, 비활성 여부, 기존 서버 관리자 기준을 다시 확인한다. 선택한 구독도 다시 읽고 최초 고정한 기기 지문과 대조한다.
- UID에 등록된 모든 기기로 보내는 기존 `sendPushToUser`를 호출하지 않는다. 새 단일 기기 전송기는 오류 본문/주소/키를 로그로 출력하지 않는다.
- 임시 실패가 확실한 HTTP 응답만 최대 3회까지 제한 재시도한다. 만료·권한 거부는 사람 확인 상태로 보류하고 공용 구독 문서를 지우지 않는다.
- 시간 초과/네트워크 중단/전송 후 저장 실패는 '보냈는지 모름'으로 격리한다. 중복 알림을 막기 위해 자동 재전송하지 않는다. 전송 중 잠금이 만료되어도 동일하게 처리한다.
- `PROVIDER_ACCEPTED`는 전송 서비스 접수이며 휴대폰 수신 증명이 아니다. 실제 폰의 잠금/백그라운드 수신, 클릭 진입, PC OFF 상태는 별도 승인된 실기기 확인이 필요하다.

### 특정 원본을 확인하지 못할 때

- 입금 확정본이 가리키는 `pending_bookings` 원본이 없거나 생성 시각을 검증할 수 없으면 `SOURCE_LINK_INVALID`로 해당 예약 소스만 중단한다. 모호한 예약을 보내거나 해당 기록을 건너뛰도록 cursor를 이동하지 않는다. 앞에서 검증·저장이 끝난 위치만 유지한다.
- 원본 조회 실패는 `SOURCE_QUERY_FAILED`, 연결 원본 조회 실패는 `SOURCE_LINK_UNAVAILABLE`, 생성 시각 오류는 `SOURCE_TIME_INVALID`로 같은 방식으로 격리한다. 코드·원본 종류·횟수만 남기고 개인정보나 SDK 오류 원문은 출력하지 않는다.
- Firestore가 허용하는 문서 ID라도 이 worker의 ID 정책(최대 512자 등)에 맞지 않으면 `SOURCE_ID_INVALID`로 해당 소스만 보류한다. 원본 ID를 지우거나 건너뛰지 않으며, 이미 저장된 암호화 cursor의 손상과 구분한다.
- 해당 실행은 `PARTIAL_SOURCE_FAILURE`와 `sourceFailures`/`sourceFailureCount`를 반환한다. 이것은 전체 정상 완료(`CHECKED`)가 아니다. **다른 독립 원본과 이미 대기 중인 전송은 계속 처리한다.** 다음 실행에도 같은 장애가 반복되면 해당 소스는 계속 보류하고 연속 실패 횟수를 남긴다.
- 운영자가 해당 원본의 연결을 별도 조사해야 한다. 이 worker는 원본/과거 자료를 자동 수정하거나 지우지 않고, 장애 기록을 임의로 건너뛰거나 소급 발송하지 않는다.
- 제어 장부·암호화 cursor·잠금 자체가 손상되거나 transaction 저장에 실패한 경우는 소스별 문제가 아니므로 전체 실행을 중단한다.

## 외부 호출 없는 재현 검사

`npx vitest run tests/unit/owner-notification-backend.test.ts`

이 검사는 Firebase/실제 구독/고객 문서 없이 메모리 DB와 가짜 인증·전송기를 사용한다. OFF와 미설정의 I/O 0회, exact cursor/나노초/암호문 변조, 잘못된 수신자, 개인정보 없는 고정 payload, 원본별 projection, 중복·동시 실행, 저장 실패 재개, 기기 변경/권한 취소, 제한 재시도/결과 불명확 격리와 5분 일정 연결을 검증한다. 실제 원본 query/index 가용성이나 실제 Android 수신을 대신 증명하지 않는다.
