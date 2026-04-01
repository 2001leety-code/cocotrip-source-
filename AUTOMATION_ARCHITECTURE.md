# CocoTripKR 전체 자동화 아키텍처

## 개요

PayPal 결제 → Netlify Functions → Google Sheets + Telegram + Gmail + Gemini AI

---

## 1. 자동화 흐름도

```
고객 결제 (PayPal)
        ↓
capturePaypalOrder.js  ← 기존 함수 (수정)
        ↓
booking-processor.js   ← 새 메인 오케스트레이터
    ├── ai-employees.js    (1호: 운영 매니저 AI)
    ├── google-sheets.js   → Google Sheets API
    ├── telegram.js        → Telegram Bot API
    └── send-email.js      → Gmail API (Nodemailer)
                                   ↓
                            고객: 예약 확인 이메일 + 바우처
                            태연님: 텔레그램 알림

스케줄 (매일 07:00 KST)
        ↓
daily-report.js
    ├── google-sheets.js   (어제 데이터 읽기)
    ├── ai-employees.js    (1호: 리포트 생성)
    └── telegram.js        (태연님께 리포트 전송)

투어 전날 18:00 KST
        ↓
weather-check.js
    ├── Open-Meteo API     (날씨 데이터)
    ├── ai-employees.js    (4호: 대체 코스 생성)
    └── telegram.js        (태연님께 날씨 알림)
```

---

## 2. Netlify Functions 목록

| 파일 | 엔드포인트 | 트리거 | 역할 |
|------|-----------|--------|------|
| `capturePaypalOrder.js` | POST `/api/capturePaypalOrder` | 고객 결제 버튼 | PayPal 결제 캡처 + 자동화 트리거 |
| `booking-processor.js` | POST `/api/booking-processor` | capturePaypalOrder 내부 호출 | 예약 처리 오케스트레이터 |
| `daily-report.js` | scheduled `0 22 * * *` (UTC = KST 07:00) | Netlify Scheduled Function | 일일 리포트 |
| `weather-check.js` | scheduled `0 9 * * *` (UTC = KST 18:00) | Netlify Scheduled Function | 투어 전날 날씨 확인 |

### 공유 유틸리티 모듈
| 파일 | 역할 |
|------|------|
| `ai-employees.js` | Gemini AI 4명 직원 호출 |
| `google-sheets.js` | Google Sheets CRUD |
| `telegram.js` | Telegram Bot 메시지 전송 |
| `send-email.js` | Gmail 이메일 발송 |

---

## 3. 필요한 환경변수 (Netlify 대시보드 설정)

### 기존 (이미 설정됨)
```
GEMINI_API_KEY=...
VITE_PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
```

### 신규 추가 필요
```
# Telegram
TELEGRAM_BOT_TOKEN=        # BotFather에서 발급 (/newbot)
TELEGRAM_CHAT_ID=          # 태연님 Chat ID (@userinfobot으로 확인)

# Google Sheets
GOOGLE_SHEETS_SPREADSHEET_ID=   # 시트 URL에서 복사
GOOGLE_SERVICE_ACCOUNT_EMAIL=   # 서비스 계정 이메일
GOOGLE_SERVICE_ACCOUNT_KEY=     # 서비스 계정 Private Key (JSON → base64)

# Gmail (Nodemailer)
GMAIL_USER=                # 발송 Gmail 주소
GMAIL_APP_PASSWORD=        # Gmail 앱 비밀번호 (2단계 인증 후 발급)

# 사업 정보
OWNER_KAKAO_ID=            # 카카오톡 채널 ID
OWNER_PHONE=               # WhatsApp 전화번호
OWNER_EMAIL=               # 태연님 이메일
```

---

## 4. Google Sheets 초기 설정

1. sheets.google.com → 새 스프레드시트 생성
2. 시트 이름: `코코트립 예약 관리`
3. 1행 헤더 (A~R):
   ```
   A: 예약일시  B: 고객명  C: 이메일  D: 전화번호
   E: 상품      F: 투어날짜  G: 출발지  H: 도착지
   I: 인원      J: 차량      K: 결제금액(USD)  L: 원화환산
   M: 쿠폰      N: PayPal거래ID  O: 상태  P: 드라이버
   Q: 바우처발송  R: 메모
   ```
4. Google Cloud Console → APIs & Services
5. Google Sheets API 활성화
6. 서비스 계정 생성 → JSON 키 다운로드
7. 스프레드시트에 서비스 계정 이메일 편집자 권한 공유

---

## 5. Telegram Bot 설정

1. Telegram에서 @BotFather 검색
2. `/newbot` → 이름: `CocoTripKR Bot` → 사용자명: `cocotripkr_bot`
3. 발급된 토큰 저장
4. @userinfobot 에게 메시지 보내기 → Chat ID 확인
5. 본인 채팅에서 봇 `/start`

---

## 6. Gmail 앱 비밀번호 설정

1. Google 계정 → 보안 → 2단계 인증 활성화
2. 앱 비밀번호 → `메일` + `기타(CocoTripKR)` → 생성
3. 16자리 비밀번호 저장

---

## 7. 결제 후 자동화 시퀀스 (상세)

```
[결제 성공]
1. Google Sheets에 예약 기록 추가 (상태: 대기)
2. 현재 USD/KRW 환율 조회 (exchangerate-api.com)
3. Gemini AI (1호 운영 매니저) 호출 → 텔레그램 알림 메시지 생성
4. 텔레그램 → 태연님께 새 예약 알림 전송
5. Gemini AI (2호 고객 경험) 호출 → 바우처 텍스트 + 이메일 본문 생성
6. Gmail → 고객에게 예약 확인 이메일 전송
7. Google Sheets 상태 → '확정' 업데이트
```

---

## 8. 구현 우선순위

- [x] 아키텍처 설계
- [ ] **Phase 1**: google-sheets.js + telegram.js + send-email.js (유틸리티)
- [ ] **Phase 2**: ai-employees.js (Gemini 4명 직원)
- [ ] **Phase 3**: booking-processor.js (오케스트레이터)
- [ ] **Phase 4**: capturePaypalOrder.js 수정
- [ ] **Phase 5**: daily-report.js (스케줄)
- [ ] **Phase 6**: weather-check.js (스케줄)
- [ ] **Phase 7**: netlify.toml 업데이트 + 환경변수 가이드
