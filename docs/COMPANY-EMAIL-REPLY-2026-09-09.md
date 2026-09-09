# 회사 메일 수동 답장 연결 — 2026-09-09

🌐웹 cocotripkr.com / Android 운영 컨트롤러 AI 센터. 운영자의 "진행해"에 따라 회사 메일 수신 → 사람이 확인한 답장 → 발송 기록 → 기존 운영 알림 경로를 연결한다. 무인 자동 답장, 고객 시험 발송, 개인 메일 열람, 실제 수집/발송 스위치 변경은 하지 않았다.

## 구현과 한계

- 회사 Gmail `cocotripkr@gmail.com`만 허용한다. 기존 수신 인증은 읽기 전용으로 유지한다. 답장 주소·스레드·자동메일 여부를 확인할 최소 헤더를 추가하되 전체 본문·첨부·HTML은 가져오지 않는다.
- `api/admin-company-email-reply.js`는 관리자 인증 후 원본 회사 수신 사본·상담 상태·작성자를 같은 거래에서 확인한다. 받는 사람은 서버가 정하고 브라우저에서 변경할 수 없다. 증빙 보호는 삭제를 막는 것이며 수동 답장을 막지는 않는다.
- 한 수신 메시지당 최종 답장 한 번, 초안 최초 작성부터 최대 7일, 발송 확인 최대 5분이다. 초안 수정은 새 요청 식별자로 구분한다. 기한 만료 뒤 같은 원본의 새 초안 생성과 임의 후속 발송은 이번 범위가 아니다.
- 별도 발송 인증으로 Google의 실제 권한과 회사 프로필을 확인한다. Codex Gmail 연결·기존 예약 SMTP·읽기 전용 인증을 몰래 재사용하지 않는다. MIME은 기존 Nodemailer로 평문만 만들며 임의 파일/URL/CC/BCC/첨부를 허용하지 않는다.
- Gmail 전송 호출 **전** 실패가 증명된 건만 사람 재확인 뒤 1회 재시도한다. 호출 후 시간 초과·HTTP 오류·불명확 결과·기록 실패는 자동 재전송하지 않는다. Gmail 요청 접수와 상대 도착·읽음을 구분한다.
- 기존 운영 알림의 v2 문의 누락을 수정했다. `expiresAtMs: 0`은 진행 중/보호 상담에서 기한 없음이라는 뜻이지 이미 만료됐다는 뜻이 아니다. 원본 식별자와 상담 상태를 검증하며, 상담 조회 실패 시 그 위치를 보류한다. 알림 장부와 잠금 화면에는 이름·제목·본문을 넣지 않는다. WhatsApp 상담 동의 확인은 유지한다.

## 운영 서버 직접 확인

2026-09-09 작업 중 기존 연결된 Vercel Production 설정의 **이름만** 조회했다. `COMPANY_GMAIL_INBOX_`, `COMPANY_GMAIL_REPLY_`, `OWNER_NOTIFICATION_`, `OWNER_EVENT_PUSH_`, `WHATSAPP_INBOX_`로 시작하는 이름은 각각 **0개**다. 기존 SMTP/VAPID 이름은 있지만 새 회사 받은함/답장/선택된 운영자 기기의 연결 증거가 아니다. 값 열람·발급·교체·등록은 하지 않았다.

## 실운영에 필요한 다음 작업

1. 회사 계정의 Google 인증 승인: 수신은 `gmail.readonly`, **별도** 발송은 정확히 `gmail.send`와 `gmail.metadata`. 뒤의 권한은 `users/me/profile`로 회사 주소를 검증하는 데 필요하다. 권한 누락/추가 권한은 자동 통과시키지 않는다.
2. **넣을 위치: Vercel 대시보드의 이 프로젝트 서버 환경변수.** 수신은 [회사 받은함 문서](COMPANY-INBOX-CONNECTION-2026-09-08.md), 알림은 [운영 알림 문서](OWNER-NOTIFICATION-RUNBOOK-2026-09-07.md)의 이름을 따른다. 인증값 발급·등록은 운영자 작업이다. Git/프런트엔드/채팅에 비밀값을 붙이지 않는다. 환경별 등록을 점검하되 Preview/Development의 실수신·발송·운영 알림은 코드가 차단한다.
3. 새 발송 이름: `COMPANY_GMAIL_REPLY_ENABLED`, `COMPANY_GMAIL_REPLY_EMAIL`, `COMPANY_GMAIL_REPLY_SEND_ENABLED`, `COMPANY_GMAIL_REPLY_CLIENT_ID`, `COMPANY_GMAIL_REPLY_CLIENT_SECRET`, `COMPANY_GMAIL_REPLY_REFRESH_TOKEN`. 주소는 위 회사 주소, 두 스위치는 각각 정확히 `true`일 때만 동작한다. 발송을 끈 상태로 수신/초안부터 확인한다.
4. 과거 자료를 일괄 수집하지 않도록 가동 시각을 수집 시작점으로 지정한다. 보관 기준은 이미 승인한 일반 상담 **종료 후 30일**·초안 7일이다. v2는 이전 단순 TTL 안내가 아닌 상담 상태 기반 정리를 사용한다.
5. 소유하거나 시험에 동의한 주소에서 새 문의 한 통을 보내 수신 표시 → 초안 수정 → 확인 후 답장 → 상대 주소 도착을 직접 확인한다. 고객을 임의 시험 대상으로 쓰지 않는다.
6. 본인 컨트롤러 한 대만 지정해 PC OFF·휴대폰 잠금 상태의 실수신을 확인한다. 푸시 업체 접수만으로 휴대폰 수신 완료라고 하지 않는다.

인증/스위치/기기 지정이 비어 있어 실제 메일 왕복과 휴대폰 수신은 아직 미검증이다. WhatsApp 기존 번호 운영 API 연결, Instagram/TikTok DM, 실제 청구액 연결, 기존 Lighthouse 실패도 미완료다. Business 전환·백업·2단계 인증은 이미 완료됐으므로 다시 요구하지 않는다. YCloud는 보류, Google Places는 제외한다.

## 근거·검증

- [Gmail 발송 문서](https://developers.google.com/workspace/gmail/api/guides/sending): MIME/base64url과 답장 스레드 헤더.
- [Gmail 프로필 조회](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/getProfile): `me`와 `gmail.metadata` 지원. `gmail.send` 단독은 이 조회 권한이 아니다.
- [Google 서버 OAuth](https://developers.google.com/identity/protocols/oauth2/web-server): 갱신과 실제 승인 권한 확인.
- [Nodemailer MailComposer](https://nodemailer.com/extras/mailcomposer): 기존 의존성의 MIME 작성 기능.

가짜 DB와 Google HTTP로 실제 원본/상담 resolver·초안/승인/발송 장부·MIME·접수 증거까지 왕복 검증한다. 실제 회사 메일을 사용한 검사가 아니다. 최종 전체검사·브라우저·PR·배포 결과는 출시 기록에 남긴다.
