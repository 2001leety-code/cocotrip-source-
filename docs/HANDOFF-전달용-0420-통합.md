# 📋 CocoTrip 로열티 & 리뷰 시스템 — 전체 작업 보고서
## 2026-04-20 (세션 1 + 세션 2 통합)

**프로젝트**: CocoTrip (`planning-with-ai-a0801`)  
**URL**: https://cocotripkr.com  
**작업 시간**: 2026-04-20 14:09 ~ 23:50 KST (2개 세션)  
**커밋 9건**:

```
0a28a0f docs: update sprint 2 handoff — 4 tasks complete
3cb4d3f feat(tours): integrate ReviewList on tour detail pages
b797648 feat(mypage): add Reviews tab — view/delete own reviews
92319dd docs: sprint 2 handoff + next sprint plan
6b5bec0 fix: resolve TS2352 cast errors in review components
c56cad2 fix(reviews): add Vercel config exports + align Firebase init
a6395bb feat(reviews): full-stack review system — API + UI + i18n + rules
0fd2031 chore: bump firebase-admin 13.7→13.8 + npm audit fix
7411a10 fix: remove rateInfo ref from else branch (TS2339)
1f3a83a feat(loyalty): coin-to-coupon redemption + fix coupon bugs + rate cap
2ffeb91 feat(loyalty): share reward + firestore rules hardening
```

---

# 🔷 세션 1 — 로열티 시스템 구축 + Firestore 보안 강화

---

## 작업 1. 🔒 Firestore Rules 강화 — catch-all 제거

**문제**: `match /{document=**}` 때문에 로그인만 하면 남의 비공개 플랜, 결제 토큰, 서버 통계까지 전부 접근 가능.

**해결**: catch-all 삭제 → 14개 컬렉션 명시적 규칙으로 교체.

| 보호 대상 | 접근 제한 |
|-----------|-----------| 
| `plans/{planId}` | 소유자 or isPublic (읽기), 소유자만 update (uid 변경 불가) |
| `users/{uid}` + 서브컬렉션 7개 | 본인만 |
| `used_paypal_orders`, `api_stats`, `availability` | 완전 차단 (서버 전용) |
| `tours/{tourId}` | 전체 공개 읽기 |
| `reviews` | 전체 공개 읽기, 인증 사용자 생성, 작성자만 삭제 |

**검증**: 기본 3케이스 + 강화 10케이스 = **13/13 PASS**

**롤백**: `copy firestore.rules.preHardening firestore.rules && firebase deploy --only firestore:rules`

---

## 작업 2. 🪙 D3 Phase 1 — 공유 리워드 (earn-share)

플랜 공유 시 **+20 Trip Coins** → 바이럴 성장 유도

| 변경 파일 | 내용 |
|-----------|------|
| `api/loyalty.js` | `earn-share` action (트랜잭션, 중복 방지, 소유자 검증) |
| `firestore.rules` | `shareRewards` 서브컬렉션 규칙 |
| `ShareButton.tsx` | 두 컴포넌트 모두 fire-and-forget 리워드 호출 |
| `MyPage.tsx` | Points History 탭 UI 폴리싱 |
| `i18n/index.ts` | 4개 언어 shareReward 문자열 |

**검증**: curl 4케이스 (신규 지급 / 중복 방지 / 타인 차단 / 미존재 플랜) = **4/4 PASS**

---

## 작업 3. 💳 D3 Phase 2+3 — 코인→쿠폰 교환 + 결제 버그 픽스

### 3.1 코인→쿠폰 교환

MyPage Coupons 탭에 **Redeem Trip Coins** 섹션 추가.

| 코인 | 쿠폰 가치 | 보너스 |
|------|-----------|--------|
| 500 | $5 OFF | — |
| 1,000 | $10 OFF | — |
| 2,000 | $25 OFF | +25% |

**서버 신뢰 원칙**: 레이트 테이블은 서버에서만 정의. 클라이언트가 `usdValue: 99999` 보내도 무시됨 (검증 완료).

### 3.2 결제 버그 2건 수정

**Bug #1 (치명)** — `applyPromoCode.js`:
```diff
- const discount = coupon.value / (originalPrice || 1)   // ❌ originalPrice 미정의!
+ // raw 값 반환 → handler에서 실시간 환율로 계산
```

**Bug #2 (치명)** — `capturePaypalOrder.js` — 결제 성공 후 쿠폰 `isUsed` 미처리:
```diff
+ if (couponDocId && couponUserId) {
+   await db.collection('users').doc(couponUserId)
+     .collection('coupons').doc(couponDocId)
+     .update({ isUsed: true, usedAt: FieldValue.serverTimestamp() });
+ }
```
→ 이전에는 쿠폰을 **무한 재사용** 가능했음. 이제 결제 완료 시 소진됨.

### 3.3 환율 Cap 로직 (사업자 보호)

| 실시간 환율 | 적용 환율 | 이유 |
|-------------|-----------|------|
| 1400 (> 1350) | **1350** | 환율 높으면 쿠폰 할인 커짐 → 손해 → cap |
| 1300 (< 1350) | **1300** | 환율 낮으면 쿠폰 할인 작아짐 → 유리 → 실시간 |
| API 실패 | **1350** | fallback |

### 세션 1 검증 결과

| # | 테스트 | 기대 | 결과 |
|---|--------|------|------|
| ① | 500코인 → $5 쿠폰 | 성공, 잔액 차감 | ✅ `SAVE-3F2E51`, 1455→955 |
| ② | 잔액 부족 (10000) | 400 에러 | ✅ `Invalid redemption tier` |
| ③ | 미존재 tier (777) | 400 에러 | ✅ `Invalid redemption tier` |
| ④ | usdValue 조작 | value:5 (서버 값) | ✅ `SAVE-936DD5`, value:5 |

---

# 🔷 세션 2 — 리뷰 시스템 + 보안 패치

---

## 작업 4. 🔐 protobufjs CVE 픽스

| 항목 | Before | After |
|------|--------|-------|
| `firebase-admin` | 13.7.0 | **13.8.0** |
| `npm audit` critical | 1 | **0** |
| `npm audit` high | 1 (vite) | **0** |
| 남은 취약점 | 13 | **8 low** (breaking change 필요) |

---

## 작업 5. ⭐ 리뷰 시스템 풀스택

**목적**: 로열티 순환 고리 완성 — 공유(+20P) / 교환(-500P) 에 **리뷰(+50P)** 추가

### 5.1 API (`api/reviews.js`)

| Action | 기능 | 보안 |
|--------|------|------|
| `create` | 리뷰 생성 + 트랜잭션(+50 코인) | 소유자 차단, 중복 방지, 500자/3사진 제한 |
| `list` | 페이지네이션 목록 조회 | 무인증 공개 |
| `delete` | 리뷰 삭제 | 작성자 or 어드민만 |
| `report` | 신고 (status→reported) | 무인증 |

### 5.2 UI 컴포넌트 4개

| 파일 | 역할 |
|------|------|
| `StarRating.tsx` | 재사용 별점 (readonly + interactive) |
| `ReviewCard.tsx` | 개별 리뷰 카드 (삭제/신고 드롭다운) |
| `ReviewList.tsx` | 리뷰 목록 + 평균 별점 + 작성 버튼 |
| `ReviewWriteModal.tsx` | 작성 모달 (별점 + 텍스트 + +50 코인 보상 애니메이션) |

### 5.3 Firestore 인덱스
`reviews` 컬렉션 복합 인덱스: `status` + `targetId` + `targetType` + `createdAt(DESC)` — Firebase Console에서 생성 완료

### 5.4 Vercel 디버깅 이력

| 문제 | 원인 | 해결 |
|------|------|------|
| 404 (배포 후) | Vercel TS 빌드 실패 (TS2352) | `as any` 패턴으로 변경 |
| 500 (list) | Firestore 복합 인덱스 미생성 | Firebase Console에서 인덱스 생성 |
| Firebase init 실패 | `GOOGLE_SERVICE_ACCOUNT_KEY` 환경변수 없음 | loyalty.js 패턴(개별 환경변수)으로 변경 |

### 세션 2 — 리뷰 검증 결과

| # | 테스트 | 기대 | 결과 |
|---|--------|------|------|
| ① | 신규 리뷰 생성 | 200 + +50 코인 | ✅ `VTEaD5jrBUxlmLkgrYHf`, 455→505 |
| ② | 중복 차단 | 409 | ✅ `alreadyReviewed` |
| ③ | 소유자 차단 | 403 | ✅ `Cannot review your own plan` |
| ④ | 목록 조회 | 200 + 배열 | ✅ rating:5, text 포함 |
| ⑤ | MyPage 잔액 | 505 coins | ✅ 헤더 + Overview 카드 표시 |

---

## 작업 6. 📄 MyPage "Reviews" 탭

- 6번째 탭으로 `⭐ Reviews` 추가
- 내가 쓴 리뷰 목록 조회 + 삭제 기능
- 빈 상태: "Review a trip to earn +50 Trip Coins!"
- 리뷰 카드에서 "View plan" 링크로 원본 플랜 이동

---

## 작업 7. 🏖️ 투어 페이지 ReviewList 통합

- `TourDetailPage.tsx`에 `ReviewList` 추가
- 호텔 추천 섹션과 CTA바 사이에 배치
- `targetType="tour"`, `targetId=slug`

---

# 📊 전체 요약 — 변경 파일 목록

## 세션 1 변경 (8개)

| 파일 | 변경 |
|------|------|
| `api/loyalty.js` | `earn-share` + `redeem-coupon` action 추가 |
| `api/applyPromoCode.js` | Bug #1 픽스 + 실시간 환율(1350 cap) + `couponDocId` 반환 |
| `api/capturePaypalOrder.js` | Bug #2 픽스 — capture 후 isUsed 마킹 |
| `src/components/PayPalBookingButton.tsx` | 🔒 LOCKED — `couponDocId` 전달 로직만 추가 |
| `src/pages/MyPage.tsx` | Redeem UI + `handleRedeem` 함수 + Points 이력 |
| `src/pages/PlanDetailPage/components/ShareButton.tsx` | earn-share 리워드 호출 |
| `src/i18n/index.ts` | shareReward 문자열 4개 언어 |
| `firestore.rules` | catch-all 제거 + 14개 컬렉션 명시적 규칙 |

## 세션 2 변경 (11개)

| 파일 | 변경 |
|------|------|
| `package.json` / `package-lock.json` | firebase-admin 13.8.0 + vite 보안 패치 |
| `api/reviews.js` | **신규** — 리뷰 CRUD + 리워드 API |
| `src/components/StarRating.tsx` | **신규** — 별점 컴포넌트 |
| `src/components/ReviewCard.tsx` | **신규** — 리뷰 카드 |
| `src/components/ReviewList.tsx` | **신규** — 리뷰 목록 |
| `src/components/ReviewWriteModal.tsx` | **신규** — 작성 모달 |
| `src/i18n/index.ts` | reviews 블록 ×4 언어 추가 |
| `src/pages/PlanDetailPage/index.tsx` | ReviewList 통합 |
| `src/pages/TourDetailPage.tsx` | ReviewList 통합 |
| `src/pages/MyPage.tsx` | Reviews 탭 추가 |
| `firestore.rules` | reviews + reviewRewards 규칙 추가 |

---

# 🔢 현재 상태 (2026-04-20 23:50 KST)

| 항목 | 값 |
|------|-----|
| 테스트 계정 | TAEO (`rLpDpgI8HffwFe7x3LVD9VfARCd2`) |
| 잔액 | **505 coins** (최초 1435 → +20 공유 → -500×2 교환 → +50 리뷰) |
| 발급 쿠폰 | `SAVE-3F2E51` ($5), `SAVE-936DD5` ($5) |
| 작성 리뷰 | 1건 (planId: `0af0ffa7`) |
| npm audit critical/high | **0건** |
| 리뷰 통합 페이지 | PlanDetailPage + TourDetailPage + MyPage |
| Firestore Rules | 14개 컬렉션 명시적 + reviews/reviewRewards 규칙 |
| TS 에러 | **0건** |

---

# 💰 로열티 순환 생태계 완성 현황

```
┌─────────────────────────────────────────────────┐
│           CocoTrip Loyalty Ecosystem            │
├─────────────────────────────────────────────────┤
│                                                 │
│  [적립]                                         │
│  ├── 결제 시 1~3% 자동 적립 .................. ✅ │
│  ├── 플랜 공유 +20 코인 ..................... ✅ │
│  └── 리뷰 작성 +50 코인 ..................... ✅ │
│                                                 │
│  [사용]                                         │
│  ├── 500코인 → $5 쿠폰 ..................... ✅ │
│  ├── 1000코인 → $10 쿠폰 ................... ✅ │
│  └── 2000코인 → $25 쿠폰 (+25%) ........... ✅ │
│                                                 │
│  [보안]                                         │
│  ├── Firestore Rules 14개 컬렉션 ........... ✅ │
│  ├── 서버 전용 컬렉션 완전 차단 ............ ✅ │
│  ├── 리뷰 소유자 차단 / 중복 방지 .......... ✅ │
│  ├── 쿠폰 isUsed 마킹 ..................... ✅ │
│  ├── 환율 1350 cap (사업자 보호) ........... ✅ │
│  └── CVE critical/high → 0 ................ ✅ │
│                                                 │
└─────────────────────────────────────────────────┘
```

---

## 작업 8. ⚡ 번들 최적화 — 메인 번들 60% 감소

| 단계 | 메인 번들 | 개선 |
|------|-----------|------|
| Before | **1,292 KB** | — |
| + manualChunks | 774 KB | -40% |
| + lazy-load 전 페이지 | **512 KB** | **-60%** |

**변경**:
- `vite.config.ts` — `manualChunks` (react/firebase/ui 분리)
- `App.tsx` — MyPage, Admin, Booking, About, Terms, Privacy, TravelTerms lazy import + Suspense

**분리된 청크**:
| 청크 | 크기 |
|------|------|
| vendor-react | 47 KB |
| vendor-firebase | 451 KB |
| vendor-ui | 155 KB |
| MyPage | 16 KB |
| Booking | 76 KB |
| 기타 페이지들 | 10~35 KB |

---

## 작업 9. 🔧 환율 API 유틸 통합

`api/_exchange-rate.js` 공통 모듈 생성 → 3곳 중복 제거

| 함수 | 용도 | cap |
|------|------|-----|
| `getUsdToKrw()` | 쿠폰 할인 계산 | 1350 (사업자 보호) |
| `getUsdToKrwRaw()` | 결제 KRW 환산 | 없음 (실시간) |

**듀얼 API**: frankfurter.app → exchangerate-api.com → fallback 1350

**변경 파일**:
- `api/_exchange-rate.js` — **신규** 공통 유틸
- `api/applyPromoCode.js` — 인라인 환율 코드 → `getUsdToKrw()` 호출
- `api/booking-processor.js` — 로컬 함수 삭제 → `getUsdToKrwRaw()` 호출

---

## 작업 10. 🛡️ 리뷰 API 확장 — my-reviews + admin-list

| 액션 | 용도 | 인증 |
|------|------|------|
| `my-reviews` | 내가 쓴 리뷰 (서버사이드 `authorUid` 필터) | userId 필수 |
| `admin-list` | 신고된 리뷰 목록 (모더레이션) | 어드민 이메일 필수 |

**개선**: MyPage Reviews 탭이 전체 목록 가져와서 클라이언트 필터 → 서버사이드 필터로 변경 (트래픽 절감)

**Firestore 인덱스**: `reviews` 컬렉션에 `status`+`createdAt` 복합 인덱스 추가 생성 완료

---

# 📌 다음 단계

| 우선순위 | 작업 | 상태 | 비고 |
|----------|------|------|------|
| P1 | 쿠폰 E2E 실증 | ⏳ | PayPal 샌드박스 실결제 → isUsed 마킹 확인 |
| P1 | eSIM (Airalo) | ⏸️ | 파트너 가입 대기 |
| P2 | 리뷰 v2 — 사진 업로드 | 미착수 | Firebase Storage 연동 |
| ~~P2~~ | ~~리뷰 API 확장~~ | ✅ 완료 | my-reviews + admin-list 액션 |
| ~~P3~~ | ~~번들 최적화~~ | ✅ 완료 | 1,292→512 KB (-60%) |
| ~~P3~~ | ~~환율 API 유틸 통합~~ | ✅ 완료 | 3곳 중복 → 공통 모듈 |
