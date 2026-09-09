# 보조 업무 Gmail 수신 전용 연결

운영자 승인: 2001leety@gmail.com을 AI 센터 업무 수신 계정으로 추가. 개인 메일을 자동으로 읽어 분류하지 않고, 전용 업무 라벨이 붙은 새 메일만 수신한다. 보조 계정의 발송은 구현/활성화하지 않는다.

## 서버 계약

- 기존 회사 계정은 cocotripkr@gmail.com / company_gmail / COMPANY_GMAIL_INBOX_를 유지한다.
- 보조 계정은 2001leety@gmail.com / secondary_gmail / SECONDARY_GMAIL_INBOX_로 고정한다.
- 보조 라벨은 `CocoTrip/업무문의`. 설정에는 실제 사용자 라벨 ID가 필요하며 INBOX 같은 시스템 라벨은 거부한다. 매 동기화에서 Google 계정과 라벨 ID/정확한 이름/유형을 확인한 뒤 목록을 읽는다.
- 각 메시지는 id/labelIds/internalDate만 먼저 확인한다. 업무 라벨 없음·수신 시작 전·기간 밖이면 헤더와 미리보기를 요청하지 않는다. HTML 본문·첨부·읽음 변경·자동 라벨링·발송·AI 호출은 없다.
- 두 받은함은 같은 5분 예약 작업에서 병렬 처리하며 각각 기존 실행 시간/페이지/건수/잠금 한도를 유지한다. 계정/수신 시작/보관/보조 라벨 변경은 재동기화를 요구한다.
- 관리자 상태·목록·상세·보관 정리·알림에서 계정별 설정을 선택한다. 기존 회사 답장 원본 검증과 발송기는 회사 계정만 허용한다.

## 설정 위치: Vercel Production

보조 계정 전용 새 OAuth readonly 자격정보를 사용한다. 기존 개인/회사 토큰을 가져오거나 공유하지 않는다.

| 이름 | 용도 |
|---|---|
| SECONDARY_GMAIL_INBOX_EMAIL | 고정 보조 계정 |
| SECONDARY_GMAIL_INBOX_CLIENT_ID / CLIENT_SECRET / REFRESH_TOKEN | 보조 계정 전용 새 인증정보, 비밀 저장 |
| SECONDARY_GMAIL_INBOX_LABEL_ID | 해당 계정의 전용 업무 사용자 라벨 ID |
| SECONDARY_GMAIL_INBOX_CAPTURE_START_AT | 실제 수신을 시작할 UTC 시각, ISO 형식 |
| SECONDARY_GMAIL_INBOX_RETENTION_DAYS | 30. 기존 종료 후 30일 상담 보관 정책 유지 |
| SECONDARY_GMAIL_INBOX_ENABLED | 실제 권한/계정/범위 검증 전 false 유지 |

코드 등록, Gmail 연결 도구의 로그인, 서버 OAuth 완료, 실제 수신 성공은 서로 다른 상태다. 2026-09-09 작성 시 업무 라벨 생성만 실제 완료됐고 보조 서버 인증/실수신은 미완료다. 연결 과정의 최신 비밀 없는 기록은 Brain shared-memory/CONTROL-TOWER-GMAIL-CONNECTION-2026-09-09.md를 참조한다.

## 검증 범위

계정 불일치/권한/라벨 누락·이름 불일치/개인 메일 최소조회/시작일·만료/중복·잠금·페이지/계정별 목록·상세·알림을 합성 자료로 검사한다. 4개 언어의 390px/1280px 화면에서 계정 구분, 수신 전용, 답장 작성기 부재, 외부 API 0회, 넘침 없음과 44px 조작 영역을 확인한다. 실제 Gmail 메시지를 읽거나 발송하는 시험은 이 합성 검사에 포함되지 않는다.
