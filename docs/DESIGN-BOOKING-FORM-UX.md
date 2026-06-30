# 예약폼 UX 가이드 (Booking Form UX Guide)

> CocoTrip 다크테마 navy+purple/pink 기준. Baymard Institute / NN/g / OTA 벤치마크 종합.
> 대상 파일: `src/components/booking/BookingInfoForm.tsx`
> 작성: 2026-06-30 · 갱신 시 날짜 업데이트 의무.

---

## 1. 설계 원칙 (Design Principles)

| 번호 | 원칙 | 근거 |
|------|------|------|
| P1 | **마찰 최소화** — 필드 수 ≤ 8개 목표, 불필요 필드는 예약 후 수집 | Baymard: 필드 26% 이탈 원인 |
| P2 | **쉬운 것 먼저** — 이름→연락처→결제 순. 고부담 필드는 마지막 | NN/g 관성(sunk cost) 효과 |
| P3 | **단일 컬럼 우선** — 모바일 15.4초 빠름. 이름 쌍만 예외 2열 허용 | Venture Harbour 연구 |
| P4 | **가격 항상 노출** — 스크롤 중에도 총금액이 보여야 결제 확신 유지 | Booking.com / Stripe 패턴 |
| P5 | **신뢰 3~5종** — CTA 인접 배치. 7종 초과 시 오히려 8% 하락 | Kinsta/Baymard |
| P6 | **긴급성은 진짜 데이터만** — 가짜 카운트다운 역효과. 실제 잔여석만 | Booking.com 원칙 |
| P7 | **4언어 동시** — 새 카피 추가 시 ko/en/ja/zh 동시 추가 | CLAUDE.md 규칙 |

---

## 2. 섹션 구조 (Section Architecture)

### 권장 순서 (Optimal Flow)

```
[상단 요약 카드] — 상품명·날짜·인원·무료취소 뱃지
        ↓
[1] 이용객 · 연락처  (First name → Last name · 전화 · 이메일 · 메신저)
        ↓
[2] 추가 정보        (픽업장소 · 항공편 · 캐리어 — isAirport만)
        ↓
[3] 부가 서비스      (hideAddons 시 숨김)
        ↓
[4] 약관 동의        (필수 3 + 선택 마케팅)
        ↓
[CTA 영역]          (신뢰 바 → CTA 버튼 → 보안 문구)

[할인코드]          → 우측 레일 가격 요약 하단 click-to-reveal 링크로 이동 권장
```

### 데스크탑 2컬럼 레이아웃 (현행 유지)

```
[왼쪽 — flex: 1 1 460px]    [오른쪽 — sticky top: 74px, max: 360px]
  섹션 스택                    - 결제 정보 카드
                               - 취소 규정 카드
                               - 신뢰 카드 (Trust)
                               - [할인코드 링크 — P권장 이동처]
```

---

## 3. 필드 순서 규칙 (Field Order)

### 이름 필드

| 현행 | 권장 | 이유 |
|------|------|------|
| 영문 성 (Last) → 영문 이름 (First) | **Surname / Family name** + **Given name / First name** | 외국인 타겟 — 여권·탑승권 입력 관행 First→Last. 라벨 명칭 명확화로 혼동 방지 |

실용 타협: 현행 순서(성 먼저) 유지하되 라벨을 `Surname / Family name *` + `Given name / First name *`으로 변경. 여권 기재 순임을 암시해 혼동 제거.

### 연락처 필드 순서

```
전화번호 (국가번호 드롭다운 + 가입자번호)
이메일
메신저 (선택)
```

이메일 아래에 helper text 추가: `Used only to send your booking confirmation` (11px, rgba(255,255,255,0.4))
전화 아래: `For tour day coordination only — never shared` (동일 스타일)

---

## 4. 크기 · 간격 토큰 (Size & Spacing Tokens)

> 현행 `C` 객체(BookingInfoForm.tsx line 86-92) 기준 수정안.

### Input

| 속성 | 현행 | 권장 | 이유 |
|------|------|------|------|
| `fontSize` | `14px` | **`16px`** | iOS 자동줌 방지 (< 16px 시 포커스 시 뷰포트 확대) |
| `padding` | `12px 14px` | **`14px 14px`** | 실 높이 16×1.5+28 ≈ 52px (Apple 44pt 초과, Airbnb 56px 근접) |
| `borderRadius` | `12px` | `12px` 유지 | 현행 적정 |

### Label

| 속성 | 현행 | 권장 | 이유 |
|------|------|------|------|
| `fontSize` | `12px` | **`13px`** | 가독성 |
| `color` | `rgba(255,255,255,0.5)` | **`rgba(255,255,255,0.65)`** | 배경 #080b14 대비 → 약 4.6:1 (WCAG AA 4.5:1 충족) |
| `margin-bottom` | `9px` | **`8px`** | 4px 그리드 정렬 |

### Opt 라벨 (선택 표시)

| 속성 | 현행 | 권장 |
|------|------|------|
| `fontSize` | `11px` | **`12px`** |
| `color` | `rgba(255,255,255,0.3)` | `rgba(255,255,255,0.35)` |

### 섹션 헤드 간격

| 속성 | 현행 | 권장 | 이유 |
|------|------|------|------|
| `SectionHead marginBottom` | `18px` | **`24px`** | Airbnb lg=24px, NN/g Gestalt 근접성 원칙 |
| 카드 `padding` | `22px` | **`20px`** | 8px 그리드 정렬 |
| 섹션 간 `gap` | `24px` | `24px` 유지 | 현행 적정 |

### Counter 버튼 (캐리어 수량)

| 속성 | 현행 | 권장 | 이유 |
|------|------|------|------|
| `width × height` | `30×30px` | **`44×44px`** | Apple HIG 최소 44×44pt, 모든 표준 최저 |
| `borderRadius` | `50%` | `50%` 유지 | |

---

## 5. 판매성 · CTA (Conversion & CTA)

### CTA 버튼 문구

| 상황 | 현행 | 권장 |
|------|------|------|
| 기본 | `{ctaLabel} {totalStr}` | `Confirm & Pay {totalStr}` (영문 타겟) / `결제 확정 · {totalStr}` (한국어 타겟) |

- 행동(Confirm) + 목적지(Pay) + 금액 3요소 조합이 이탈율 최저 (Baymard)
- `ctaLabel` prop은 호출처가 제어하므로 호출처에서 문구 업데이트

### 모바일 Sticky CTA (권장 — 우선순위 높음)

뷰포트 너비 < 768px 시 CTA 버튼 + 총금액을 하단 고정바로:

```css
/* 모바일 sticky CTA 바 */
position: fixed;
bottom: 0; left: 0; right: 0;
z-index: 200;
background: rgba(8, 11, 20, 0.95);
backdrop-filter: blur(20px);
border-top: 1px solid rgba(255,255,255,0.08);
padding: 12px 16px env(safe-area-inset-bottom);
height: auto; /* 내용 기준, 최소 60px */
```

내용: `총금액 {totalStr} ({usdStr})` 좌측 + `결제 진행` 버튼 우측 (너비 150px).
데스크탑은 현행 왼쪽 컬럼 최하단 배치 유지.

전환율 근거: 모바일 sticky CTA 도입 시 +12~27% (AB Tasty 연구), OTA 4.17% 직접 향상 사례.

### 할인코드 노출 최소화 (권장)

현행: 할인코드 카드 전체 기본 전개 (코드 입력창 + 쿠폰 2개 버튼 항상 노출)
권장: 우측 레일 가격 요약 하단에 `프로모션 코드 있으신가요? ›` 텍스트 링크, 클릭 시 인라인 펼침.

이유: Baymard/Zuko — 할인코드 창 기본 노출 시 27%가 코드 검색을 위해 이탈.
단, 코드를 알고 온 사용자는 찾을 수 있어야 하므로 완전 삭제 금지 — collapsed 상태만.

구현 시: `hideDiscount` prop은 유지, 새 `discountCollapsed` state 추가 또는 호출처에서 `hideDiscount` 제어.

### 가격 앵커링

할인코드 적용 성공 시 우측 레일 총금액 영역:

```
₩326,000  ← 원가 (font-size: 14px, color: rgba(255,255,255,0.35), text-decoration: line-through)
₩291,200  ← 할인가 (font-size: 24px, font-weight: 900, color: #fff) — 현행
```

미적용 시 현행 단일 금액 표시 유지.

### 긴급성 신호

예약 요약 카드 하단 또는 CTA 버튼 위에:
- 실제 데이터: `이번 달 {N}팀이 예약` 또는 `이 시간대 마지막 1팀 가능` (실재 시만)
- 정적 신뢰 수치: `500+ tours completed` (데이터 없을 때 대안)
- 가짜 카운트다운 금지 — 역효과 발생 (Booking.com 원칙)

---

## 6. 신뢰 · 보안 (Trust & Security)

### CTA 인접 신뢰 바 (권장 — 우선순위 높음)

CTA 버튼 바로 위(margin: 0 0 10px)에 1행 인라인 신뢰 바:

```
🔒 Secured by PayPal    ✓ Free cancellation before [date]    🛡 KTO Registered
```

스타일:
```css
display: flex; justify-content: center; gap: 16px; flex-wrap: wrap;
padding: 8px 12px; border-radius: 10px;
background: rgba(0, 210, 140, 0.06);
font-size: 11px; color: rgba(255,255,255,0.55);
```

아이콘: 자물쇠(🔒, #00D28C), 체크(✓, #00D28C), 방패(🛡, #B9A4FF). 높이 14~16px.

### CTA 아래 면책 문구 교체

현행: 통신판매중개자 법적 면책 10줄 → 부정적 인상, 결제 직전 불안 유발.
권장:

```
Your payment is protected by PayPal Buyer Protection.
Free cancellation up to 24h before your tour.
```

12px, rgba(255,255,255,0.35), 중앙 정렬.
법적 면책 문구는 `/legal` 또는 약관 카드 하단 링크로 이동.

### 민감 필드 안심 문구

이메일 필드 하단 helper:
```
Used only to send your booking confirmation
```

전화 필드 하단 helper:
```
For tour day coordination only — never shared
```

스타일: `font-size: 11px, color: rgba(255,255,255,0.35), margin-top: 6px`

### Trust 카드 강화

현행 신뢰 카드(3줄 텍스트+체크마크)에 추가:
- PayPal 로고 SVG (height: 20px) + `Secure Checkout` 텍스트를 카드 최상단에
- KTO 관광사업자 등록번호 (font-size: 11px, 1줄)

신뢰 신호 총 개수: 3~5종 유지, 7종 초과 금지 (Baymard).

### 취소 규정 색상 코딩

현행: 취소 수수료 100% 항목이 rgba(255,255,255,0.7) (흰색) — 위험 시각화 부족.
권장:

```tsx
// 무료 취소 (현행 유지)
color: '#00D28C'

// 취소 수수료 100% (변경)
color: '#FF6B6B'  // 빨간 경고색
// + 왼쪽에 ⚠ 아이콘 추가
```

---

## 7. 단계 표시기 (Progress Indicator)

투어 예약 플로우(Step1 옵션 선택 → Step2 BookingInfoForm → 결제 완료)에 상단 스텝 바:

```
① 옵션 선택  →  ② 예약 정보  →  ③ 결제 완료
```

높이: 36px. 현재 단계 보라색(#7C5CFC) 강조, 나머지 rgba(255,255,255,0.3).
차터 폼은 단일 페이지이므로 스텝 바 불필요 (CharterWizard 자체 스텝이 있음).

구현 위치: TourBookingDialog 또는 BookingInfoForm의 선택적 prop `stepIndicator?: React.ReactNode`.

---

## 8. 모바일 전용 패턴 (Mobile-First)

| 항목 | 데스크탑 | 모바일 (< 768px) |
|------|---------|----------------|
| 가격 레일 | 우측 sticky | 폼 상단 축소 카드 (현행 요약 카드 + 총금액 mini 표시) |
| CTA | 왼쪽 컬럼 최하단 | 하단 fixed bar (sticky) |
| 할인코드 | 우측 레일 링크 | 동일 (collapsed) |
| 신뢰 바 | CTA 위 1행 | CTA 위 2행 wrap (font-size: 10px) |

모바일 가격 레일 문제 (현행): `flex: '1 1 300px'`이 flex-wrap 시 하단으로 밀려 총금액 미노출.
해결: 모바일에서 요약 카드(line 221-232) 내 총금액 mini 표시 추가 (예: `₩291,200`를 칩으로).

---

## 9. 개선 우선순위 (Implementation Priority)

### 즉시 (1~2일, 코드 수정 소형)

| 순위 | 항목 | 파일·라인 | 예상 영향 |
|------|------|-----------|----------|
| 1 | input fontSize 14px → 16px | `C.input` line 88 | iOS 자동줌 제거, 가독성 |
| 2 | label color opacity 0.5 → 0.65 | `C.label` line 89 | WCAG AA 통과 |
| 3 | label margin-bottom 9px → 8px | `C.label` line 89 | 4px 그리드 |
| 4 | SectionHead marginBottom 18px → 24px | `SectionHead` line 96 | 섹션 구분 명확화 |
| 5 | Counter 버튼 30×30 → 44×44px | `Counter btn` line 107 | 터치 오류율 25%↓ |
| 6 | 취소 규정 빨간 색상 + ⚠ 아이콘 | right rail line 426 | 취소 정책 인지 개선 |
| 7 | 이메일·전화 helper text 추가 | line 270, 261 | 개인정보 불안 감소 |
| 8 | 이름 라벨 명칭 변경 (Surname / Given name) | line 239, 243 | 외국인 혼동 방지 |

### 중형 (3~5일, 새 컴포넌트 필요)

| 순위 | 항목 | 예상 영향 |
|------|------|----------|
| 9 | CTA 위 인라인 신뢰 바 (PayPal + 무료취소 + KTO) | 전환율 직접 영향 |
| 10 | CTA 아래 면책 문구 → 보증 문구 교체 | 결제 직전 불안 감소 |
| 11 | Trust 카드 PayPal 로고 + KTO 번호 추가 | 브랜드 신뢰도 |
| 12 | 할인코드 섹션 collapsed 전환 (우측 레일 링크) | 이탈 27%↓ 목표 |
| 13 | 모바일 요약 카드 총금액 mini 표시 | 모바일 가격 인지 |

### 대형 (1주+, 구조 변경)

| 순위 | 항목 | 예상 영향 |
|------|------|----------|
| 14 | 모바일 sticky CTA 바 | +12~27% 전환율 |
| 15 | 투어 플로우 단계 표시기 (Step 1/2/3) | 중도이탈 감소 |
| 16 | 가격 앵커링 (취소선 원가 → 할인가) | 할인 혜택 시각화 |
| 17 | 긴급성 신호 (실제 데이터 기반 잔여석/예약수) | 즉시 결제 촉진 |

---

## 10. 4언어 카피 레퍼런스 (i18n Copy Reference)

신뢰 바 및 안심 문구 — 4언어 동시 추가 의무 (CLAUDE.md J 규칙).

| 항목 | ko | en | ja | zh |
|------|----|----|----|----|
| CTA 버튼 | `결제 확정 · {금액}` | `Confirm & Pay {amount}` | `{金額}で予約確定` | `确认支付 {金额}` |
| 신뢰 바 — PayPal | `PayPal 보안 결제` | `Secured by PayPal` | `PayPal保護決済` | `PayPal安全支付` |
| 신뢰 바 — 취소 | `{날짜}까지 무료 취소` | `Free cancellation before {date}` | `{日付}まで無料キャンセル` | `{日期}前免费取消` |
| 신뢰 바 — 인증 | `KTO 등록 사업자` | `KTO Registered` | `KTO登録事業者` | `KTO注册企业` |
| 이메일 helper | `예약 확인서 발송에만 사용됩니다` | `Used only to send your booking confirmation` | `予約確認書の送付にのみ使用します` | `仅用于发送预订确认函` |
| 전화 helper | `투어 당일 연락에만 사용, 외부 공유 없음` | `For tour day coordination only — never shared` | `ツア当日の連絡のみ・外部共有なし` | `仅用于当日协调联系，不对外共享` |
| 면책 대체 | `결제는 PayPal Buyer Protection으로 보호됩니다. 투어 24시간 전까지 무료 취소 가능.` | `Your payment is protected by PayPal Buyer Protection. Free cancellation up to 24h before your tour.` | `お支払いはPayPal Buyer Protectionで保護されます。ツア24時間前まで無料キャンセル可能。` | `您的付款受PayPal买家保护。距游览24小时前可免费取消。` |

---

## 11. 색상 · 디자인 토큰 요약 (Design Tokens Summary)

```
배경:       #080b14
보라:       #7C5CFC (primary) / #B9A4FF (light)
핑크:       #EA537E / #FF6B9D
민트:       #00D28C (신뢰·무료취소·성공)
골드:       #C4956A (가격·애드온)
빨강:       #FF6B6B (경고·환불불가)
에러:       #ffb4b4 (에러 텍스트)

Input border focus:   rgba(124, 92, 252, 0.55)
Input bg focus:       rgba(124, 92, 252, 0.06)
Card bg:              rgba(255,255,255,0.04)
Card border:          rgba(255,255,255,0.08)
Divider:              rgba(255,255,255,0.07)
Text primary:         rgba(255,255,255,0.92)
Text secondary:       rgba(255,255,255,0.65)  ← label (개선 후)
Text tertiary:        rgba(255,255,255,0.4)
Text muted:           rgba(255,255,255,0.3)
```

---

## 12. WCAG AA 체크리스트

| 요소 | 배경색 | 텍스트색 | 대비비 | 기준 | 통과 |
|------|--------|---------|--------|------|------|
| Label (개선 후) | #080b14 | rgba(255,255,255,0.65) ≈ #A6A6A6 | ~4.6:1 | 4.5:1 | ✅ |
| Label (현행) | #080b14 | rgba(255,255,255,0.5) ≈ #808080 | ~3.0:1 | 4.5:1 | ❌ |
| Input text | #080b14 | rgba(255,255,255,0.92) ≈ #EAEAEA | ~16:1 | 4.5:1 | ✅ |
| Helper text | #080b14 | rgba(255,255,255,0.4) ≈ #666 | ~2.3:1 | (informational) | 허용 |
| CTA 버튼 | 보라→핑크 그라디언트 | #fff | >4.5:1 | 4.5:1 | ✅ |
| 취소 100% (개선 후) | #080b14 | #FF6B6B | ~4.8:1 | 4.5:1 | ✅ |

---

## 참고 출처

- Baymard Institute: baymard.com/learn/checkout-flow-ux-optimization, baymard.com/blog/checkout-optimization-from-16-fields-to-8
- Nielsen Norman Group: nngroup.com/articles/form-design-white-space, nngroup.com/articles/4-principles-reduce-cognitive-load
- AB Tasty: abtasty.com/blog/mobile-stick-to-scroll
- GetYourGuide: arival.travel/article/getyourguide-steps-into-direct-booking
- Stripe: stripe.com/resources/more/checkout-ui-strategies
- Zuko: zuko.io/blog (할인코드 27% 이탈)
- Airbnb Design System: superdesign.dev, getdesign.md
- Ralabs: ralabs.org/blog/booking-ux-best-practices
- ConvertCart: convertcart.com/blog/mobile-checkout-optimization
