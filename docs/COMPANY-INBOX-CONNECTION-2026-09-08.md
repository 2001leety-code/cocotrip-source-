# 회사 Gmail · WhatsApp 통합 수신 — 2026-09-08

2026-09-09 보완: [회사 메일 수동 답장 연결](COMPANY-EMAIL-REPLY-2026-09-09.md)을 우선 확인한다. 아래 수신일 기준 TTL 설명은 첫 구현 기록이다. 현재 v2는 일반 상담 종료 후 30일·진행 중/증빙 보호 유지·초안 최대 7일이며, 답장과 운영 알림이 상담 상태를 확인한다. WhatsApp Business 전환·백업·휴대폰 2단계 인증은 이미 완료했다. 남은 것은 기존 번호 운영 API 연결·서버 설정·실수신이며 설치를 다시 요구하지 않는다.

후속: 사용자가 기존 WhatsApp에 개인 대화가 있다고 확인했고 보호 장치 구현을 승인했다. 번호 일치만으로 수집하던 아래 첫 구현은 [개인 대화 보호 계약](WHATSAPP-PRIVATE-CHAT-GUARD-2026-09-08.md)의 명시적 상담 시작/종료/개인 연락처 제외로 강화된다. 신규 `WHATSAPP_INBOX_PRIVACY_MODE=explicit_sessions_v1`은 **Vercel 서버 환경변수**이며 없으면 수신은 준비 실패다. 실제 Meta 약관 승인은 이미 받았고 휴대폰 2단계 인증 후 테스트 번호 발급까지 확인했다. 아래 약관/테스트 계정 미생성 문구는 당시 기록이며 현재 미완료는 기존 업무 번호 연결·운영 서버 설정·실수신 시험이다.

대상: 웹 cocotripkr.com / 개인 Android 컨트롤러의 AI 센터. 사용자의 “왓츠앱 연결도하고 다 진행해” 승인을 받아 회사 문의 수신과 최소 저장을 구현한다. 개인 메일, 고객 본문을 외부 AI에 보내는 것, 고객에게 실제 자동답변을 보내는 것은 이번 승인 범위에 넣지 않는다.

## 구현 범위

- 회사 Gmail `cocotripkr@gmail.com`만 허용한다. 토큰 발급 응답의 읽기 전용 권한과 실제 `users/me/profile`의 회사 주소를 확인한 뒤, 지정한 시작일 이후 INBOX의 최소 메타데이터·짧은 텍스트만 저장한다. 읽음·라벨·삭제·보내기 호출은 없다.
- 5분 작업은 기본 OFF다. 초기 목록과 후속 변경 내역을 끝까지 저장한 뒤에만 진행 위치를 옮긴다. 한 번에 최대 20개 메시지·3페이지·40초로 제한하고 다음 작업에서 이어받는다. 중복 실행·늦은 응답·결과가 불명확한 저장은 같은 메시지의 안정적인 식별자와 거래 단위 검사로 보호한다. 만료된 변경 이력은 재연결 점검으로 표시하고 임의로 건너뛰지 않는다.
- WhatsApp `/api/whatsapp-inbox-webhook`은 원본 바이트의 서명을 확인한 뒤 지정한 WABA·전화번호 ID의 수신 메시지만 받아 저장한다. 확인 토큰(GET)과 앱 비밀값(POST)은 서로 다르다. 최대 4MiB·선택된 메시지 1,000건, 200건씩 저장한다. 저장 실패에 성공 응답을 주지 않으며 제공자의 재시도 때 이미 저장한 메시지는 중복으로 흡수한다.
- `external_inbox_messages`에 정제한 최소 필드만, `external_inbox_state`에 수신/진행 상태만 기록한다. 원본 payload, HTML, 첨부 파일, 고객 프로필 전체, 토큰을 저장하거나 로그로 내보내지 않는다. 기존 예약·문의·답변 발송 장부는 수정하지 않는다.
- 별도 관리자 GET `/api/admin-external-inbox`를 사용한다. 목록에는 본문을 넣지 않고, 운영자가 내용을 펼칠 때 해당 메시지 한 건만 다시 인증·계정·시작일·만료·식별자를 확인한다. 원래 개인정보 없는 AI 센터 집계 API에는 고객 필드를 섞지 않는다. 일반 Firebase 클라이언트에서 새 컬렉션은 기존 규칙의 기본 거부 대상이다.
- AI 센터는 웹 문의 옆에 회사 메일·WhatsApp을 보여 준다. 네 언어, 5건씩 보기, 긴 본문 접기, 44px 버튼, 키보드 조작을 제공한다. 화면이 켜져 있을 때 1분마다/다시 돌아올 때/수동 갱신 때 새로 조회하며 백그라운드 화면의 주기 조회는 하지 않는다. 계정이 바뀌면 이전 목록·본문·진행 중 요청을 버린다.
- 받은 텍스트는 명령이 아니라 고객 자료다. HTML·이미지·링크로 실행하지 않는다. 첨부나 전체 이메일은 원래 앱에서 확인한다. 최근 저장 100건 범위이며 전체/미답변 문의 수로 표시하지 않는다.

## 기본 OFF와 서버 설정

**모든 아래 값의 넣을 위치는 Vercel 대시보드의 서버 환경변수**다. Git, 프런트엔드 `VITE_` 값, 로컬 `.env`, GitHub Secrets로 옮기지 않는다. 운영자가 직접 관리한다. 기존 환경 안전 규칙에 따라 환경별 등록을 점검하되, Preview/Development는 아래 수집기를 코드에서 강제로 막는다. 테스트 배포에 실제 문의를 수집하지 않는다.

| 회사 Gmail 키 | 의미 |
|---|---|
| `COMPANY_GMAIL_INBOX_ENABLED` | 정확히 `true`일 때만 시작. 미설정은 OFF |
| `COMPANY_GMAIL_INBOX_EMAIL` | 위 회사 주소만 허용 |
| `COMPANY_GMAIL_INBOX_CLIENT_ID`, `COMPANY_GMAIL_INBOX_CLIENT_SECRET`, `COMPANY_GMAIL_INBOX_REFRESH_TOKEN` | 회사 Gmail 읽기 전용 서버 인증. 개인 메일/쓰기 권한 토큰을 사용하지 않음 |
| `COMPANY_GMAIL_INBOX_CAPTURE_START_AT` | 운영자가 정한 UTC ISO 시작시각. 날짜만 있는 값·미래시각은 거부 |
| `COMPANY_GMAIL_INBOX_RETENTION_DAYS` | 운영자가 정한 1~90 정수. 기본값을 추정하지 않음 |

| WhatsApp 키 | 의미 |
|---|---|
| `WHATSAPP_INBOX_ENABLED` | 정확히 `true`일 때만 시작. 미설정은 OFF |
| `WHATSAPP_INBOX_WABA_ID`, `WHATSAPP_INBOX_PHONE_NUMBER_ID` | 확인한 회사 계정·전화번호 식별자 |
| `WHATSAPP_INBOX_APP_SECRET` | Meta가 서명한 원본 수신 검증용 |
| `WHATSAPP_INBOX_VERIFY_TOKEN` | Meta의 서버 주소 확인 전용. 앱 비밀값과 별개 |
| `WHATSAPP_INBOX_CAPTURE_START_AT`, `WHATSAPP_INBOX_RETENTION_DAYS` | 회사 Gmail과 같은 시작일·보관기간 계약 |

두 채널 모두 켜짐·계정·시작일·기간·필수 인증이 갖춰져야 저장을 시작한다. OFF는 수집기의 DB/외부 API 작업이 없다는 뜻이며, Vercel의 예약 HTTP 호출 자체가 없다는 뜻은 아니다. 관리자 GET의 기존 관리자 인증은 계속 적용된다. 실제 설정 여부는 로컬 환경 파일로 추정하지 않고 서버의 안전한 상태 응답으로 확인한다.

## 보관기간과 실제 삭제는 다르다

`expiresAtMs`를 지난 문의는 관리자 목록·직접 ID 조회 모두 거부한다. `expiresAt` Date는 Firestore TTL에 맞춘 필드지만 **이 코드 배포가 물리적인 자동 삭제를 켜지는 않는다.** 활성화 전에 운영자가 시작시각·보관기간을 선택하고 **Firebase 콘솔 → Firestore → TTL**에서 `external_inbox_messages`의 `expiresAt` 정책과 실제 만료 삭제를 확인해야 한다. TTL 삭제도 정확한 만료 순간을 보장하지 않는다. `external_inbox_state`는 진행 위치이므로 자동 삭제 대상이 아니다.

정리용 순수 함수는 만료 자료 중 이 컬렉션과 정확한 해시 식별자를 가진 것만 정리 후보로 반환하며, 실제 삭제나 예약 삭제는 하지 않는다. 원래 Gmail·WhatsApp·예약 원본을 삭제하는 기능도 없다. 이 설정이 미완료이면 “자동 삭제 완료”라고 보고하거나 실수집을 시작하지 않는다.

## 실제 계정 연결 관찰과 남은 운영 단계

- Codex에 연결된 회사 Gmail의 프로필 주소는 확인했다. 이 연결은 PC가 꺼져도 Vercel이 읽을 수 있는 서버 인증과 별개다. 토큰 파일의 값을 읽거나 복사하지 않았다. 이번 개발 검사는 실제 메일을 열지 않고 합성 자료만 사용했다.
- Meta의 기존 `CocoTripKR SNS` 앱(앱 ID `1341580361290765`)에 **WhatsApp 이용 사례 추가를 실제 수행하고 추가된 항목을 확인**했다. 이는 실제 업무 전화번호 연결·서버 수신 완료가 아니다.
- 두 개인 명의 비즈니스 포트폴리오의 WhatsApp 설정에서는 추가된 계정이 없다고 표시됐다. 다른 비즈니스는 수정하지 않았다. 업무 번호 `010-8714-0611`을 사용할지, 현재 일반 WhatsApp/Business 앱 중 무엇인지 사용자 확인을 요청했다. 기존 번호 전환·앱 삭제·이전은 하지 않았다.
- Meta의 다음 “계속” 버튼은 WhatsApp Business 및 Meta 클라우드 호스팅 약관 동의이므로 그 직전에서 멈추고 실제 동의 여부를 요청했다. 별도 계정 등록, 인증값 발급·교체, 권한 추가 승인은 운영자 확인이 필요하다.
- 운영 설정 후 Meta 서버 주소 확인 및 `messages` 구독, 본인이 보낸 업무용 테스트 메시지의 1회 수신·중복 재수신·AI 센터 표시를 확인해야 한다. 회사 Gmail도 운영자가 보낸 테스트 문의로 동기화와 개인메일 제외를 확인한다. 고객에게 테스트 답장을 보내지 않는다.
- PC OFF 상태의 실제 수신, Android 잠금 중 알림, 기존 고객 자동답변은 이번 합성 검사로 증명되지 않는다. 새 수신 메시지는 기존 푸시 전송기에 자동 연결하지 않았으며, 기존 예약·웹문의 푸시의 설정/실기기 검증 조건은 그대로 유지한다.

## 검증과 배포

원본 서명·잘못된 계정·기본 OFF·Preview 차단·중복/동시 저장·부분 실패 재시도·초기/후속 Gmail 진행 위치·관리자 인증·본문 분리·만료 조회 차단·UI 계정 변경/늦은 응답/네 언어/원문 비실행을 합성 단위 검사로 확인한다. 합성 자료는 `example.invalid`와 가짜 번호만 사용한다.

실제 Chrome 개발 하네스에서 390/1280px × 네 언어로 통합/독립 받은함 16건, 별도 7건 모의 목록의 5→2→5 페이지 이동 8건을 확인했다. 본문 펼침·닫기, 키보드 초점, 44px, 가로 넘침, 외부 API/쓰기/SW 차단을 포함한다. 기록은 `tmp/owner-company-inbox-visual-final-20260908/summary.json` 및 `tmp/owner-inbox-pagination-20260908/summary.json`에 남겼다. 첫 전체 단위 검사는 실행 중 추가된 Preview 경계 테스트와 이전에 로드된 모듈이 섞여 2건이 실패했다. 파일을 동결한 뒤 전체 검사를 다시 실행하며 이 중간 결과를 최종 합격으로 사용하지 않는다. 정확한 최종 전체 검사·PR·배포 식별자는 PR과 Brain 공유 작업 기록에 추가한다. UI 합격을 실제 계정·고객 수신 성공으로 바꾸지 않는다.

## 공식 근거

- [Meta 시작 조건](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started), [기존 Business 앱과 공존 조건](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users): 기존 앱을 임의 삭제하지 않는다. 공존 등록에는 제공업체 조건이 있으며 한국 번호의 적용 여부를 추정하지 않는다.
- [Meta 수신 서버](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint): 원본 서명과 구독·재시도 계약.
- [Gmail 동기화](https://developers.google.com/workspace/gmail/api/guides/sync): 변경 위치는 문자열로 유지하고 만료된 기록은 재동기화가 필요하다.
- [Vercel Node 함수](https://vercel.com/docs/functions/runtimes/node-js), [원본 본문](https://vercel.com/kb/guide/how-do-i-get-the-raw-body-of-a-serverless-function): 일반 `api/*.js`에서도 Web Standard `fetch(Request)`를 지원한다. Next.js의 bodyParser 설정을 이 프로젝트에 가져오지 않는다.
