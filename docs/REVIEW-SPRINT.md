# 실후기 수집 스프린트 (2026-07-13 — 운영자 승인: 가짜 리뷰 금지, 실후기로)

목표: 구글 리뷰 실데이터 확보 → 쌓이면 `VITE_FEATURE_REAL_TOUR_RATINGS` ON (투어 별점 실표시).
가짜 리뷰 금지 근거: 표시광고법·전자거래법 + PayPal 분쟁 리스크 + 신뢰 산업 특성 (운영자 고지·수용 2026-07-13).

## 1. 대상
- 과거 투어·차터 완료 고객 (Firestore `bookings` status CONFIRMED/완료 + 텔레그램 상담 이력)
- 우선순위: 최근 90일 → 만족 표현 있던 고객 먼저

## 2. 발송 메시지 (운영자가 WhatsApp/이메일로 직접 발송)

### 영어 (기본)
> Hi {name}! This is CocoTrip — thank you again for traveling Korea with us 💜
> If you enjoyed your {tour_name}, would you mind leaving a short Google review?
> It takes 1 minute and helps other travelers find us:
> {google_review_link}
> As a thank-you, we'll send you a **5% coupon** for your next tour or charter.

### 한국어 (교민/한국어 고객)
> 안녕하세요 {name}님, 코코트립입니다. 지난 {tour_name} 함께해 주셔서 감사했습니다.
> 1분만 내어 구글 리뷰를 남겨주시면 다음 예약에 쓰실 수 있는 5% 쿠폰을 보내드려요.
> {google_review_link}

- {google_review_link} = 구글 비즈니스 프로필 "리뷰 작성" 딥링크 (프로필 관리 → 리뷰 요청 링크 복사)
- 쿠폰 = 기존 CHARTER 5% 쿠폰 체계 재사용 (신규 코드 발급 불필요 — 어드민에서 개별 발급)

## 3. 절차
1. 운영자: 구글 비즈니스 프로필에서 리뷰 링크 확보
2. 운영자: 대상 고객 목록 추출 (어드민 예약 내역) → 메시지 개인화 발송
3. 리뷰 확인되면 어드민에서 5% 쿠폰 발급 + 감사 답장
4. 리뷰 수 ≥ 5 && 평점 안정 → 개발: `VITE_FEATURE_REAL_TOUR_RATINGS=true` (🌐 Vercel env + 새 커밋 push)
   + `reviewSource: 'google'` 데이터 채움
5. 이후 신규 투어 완료 시마다 3일 후 자동 요청 (후속: 이메일 자동화 — booking-confirm 흐름에 지연 발송 추가)

## 4. 주의
- 리뷰 대가 언급은 "감사 쿠폰" 수준까지만 — "5점 주면 쿠폰" 식 조건부 = 구글 정책 위반. 조건 없이 리뷰 요청 + 리뷰어 전원에게 쿠폰.
- 리뷰 내용 지시 금지. 불만 고객에게는 리뷰 요청 대신 개선 응대 먼저.
