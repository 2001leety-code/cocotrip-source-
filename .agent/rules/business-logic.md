# CocoTrip KR — Business Logic

## 1. Charter Vehicle Pricing

### Vehicle Types
| Vehicle | Capacity | Base Rate (8hr) | Overtime | Guide |
|---------|----------|-----------------|----------|-------|
| **Staria Van** | 1-8명 | ₩330,000 | ₩33,000/hr | 불필요 |
| **Sprinter** | 9-15명 | 별도 견적 | 별도 | **필수** ₩300,000/일 |
| **대형버스** | 16+명 | 별도 견적 | 별도 | **필수** ₩300,000/일 |

### Extra Charges
- 초과 시간: ₩33,000/시간
- 심야 할증 (00:00–06:00): 20% 추가
- 성수기 할증: 10%
- 왕복 할인: 10%
- 영어 가이드: ₩80,000/일
- 공항 피켓 서비스: ₩20,000
- 카시트: ₩20,000/편

### Airport Transfer Prices (편도, Staria 기준)
| 구간 | KRW | USD |
|------|-----|-----|
| 인천공항 → 서울 도심 | ₩124,800 | $90 |
| 인천공항 → 강남/잠실 | ₩145,600 | $105 |
| 인천공항 → 수원/용인 | ₩150,000 | $115 |
| 인천공항 → 가평/남이섬 | ₩208,000 | $150 |
| 인천공항 → 부산 직행 | ₩600,000 | $450 |

## 2. K-pop Concert Shuttle
- **편도**: ₩35,000 / 1인
- **왕복**: ₩65,000 / 1인
- **차량 전체 대절**: ₩260,000 (최대 8인 Staria)
- 주요 공연장: 인스파이어 아레나, 잠실올림픽주경기장, KSPO돔, 고척스카이돔
- 픽업 포인트: 명동, 홍대, 강남역, 동대문

## 3. AI Planner Pricing
- **Quick Preview**: 무료 (15초 요약본)
- **Full Itinerary Report**: **$4.90** (원래 $9.90, 50% 할인 표시)
- KRW 환산: ₩6,600 기준 (PayPal USD 결제)
- 포함: 3페이지 상세 일정표 + 현지 맛집 + 포토스팟 + 교통 동선

## 4. Booking Rules

### 자동 결제 (PayPal)
- Staria 차량만 즉시 PayPal 결제 가능
- 8인 이하만 자동 예약 처리
- 날짜 선택 필수

### 수동 견적 (WhatsApp)
- **9인 이상**: 무조건 WhatsApp/이메일 견적 라우팅
- **Sprinter/Bus 선택**: WhatsApp 라우팅
- **다일 투어, 기타 문의**: WhatsApp 라우팅
- **WhatsApp 번호**: +82-10-8714-0611

### 결제 후 플로우
1. PayPal 결제 성공
2. 예약 확인 모달 표시 (4개국어)
3. Google Sheets 로깅
4. 확인 이메일 발송 (Nodemailer)
5. Telegram 관리자 알림 발송

## 5. Promo & Marketing

### Early Bird (EARLY50)
- **코드**: `EARLY50`
- **할인율**: 20%
- **제한**: 50팀 한정
- UI: 플로팅 배너 (EarlyBirdBanner 컴포넌트)

### 프로모 코드 시스템
- API: `/api/applyPromoCode`
- PayPalBookingButton에서 코드 입력 → 할인 적용

## 6. Customer Communication

### DO
- **WhatsApp**: 주요 고객 연락 채널 (국제 관광객 표준)
- **이메일**: info@cocotripkorea.com (보조 채널)
- **KakaoTalk**: 한국 국내 고객용

### DO NOT
- **Telegram 사용 금지**: 한국에서 Telegram은 부정적 이미지 (범죄 연관)
  → 관리자 알림용으로만 내부 사용, 고객용으로 절대 노출하지 말 것

## 7. Content Rules
- 모든 가격은 KRW + USD 표시
- 환율: ₩1,350 ≈ $1 (실시간 환율 API 사용)
- "No Hidden Fee" 정책 표기
- 100% 환불 보증 문구 표시
- 모든 사용자-facing 텍스트 4개국어 (ko/en/ja/zh)

## 8. Auth Access Control
| 페이지 | 인증 | 비고 |
|--------|------|------|
| 홈, 소개, 약관 | 불필요 | 공개 페이지 |
| /planner (AI 플래너) | **불필요** | AuthRequired 제거됨 (결제 시에만 PayPal 인증) |
| /charter (전세차량) | Firebase Auth | Google 로그인 |
| /admin | Admin 전용 | VITE_ADMIN_EMAIL 매칭 |

