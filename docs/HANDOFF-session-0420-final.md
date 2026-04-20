# 📋 세션 완료 보고 — 2026-04-20 (최종)

**프로젝트**: CocoTrip (`planning-with-ai-a0801`)  
**작업 시간**: 2026-04-20 14:09 ~ 15:59 KST  
**커밋**:
- `2ffeb91` — D3 Phase 1 (공유 리워드)
- `1f3a83a` — D3 Phase 2+3 (코인→쿠폰 + 결제 연동 + 버그 픽스)
- `7411a10` — TS 에러 핫픽스

---

## 완료된 작업 3건

---

### 1. 🔒 Firestore Rules 강화 — catch-all 제거

**문제**: `match /{document=**}` 때문에 로그인만 하면 남의 비공개 플랜, 결제 토큰, 서버 통계까지 전부 접근 가능.

**해결**: catch-all 삭제 → 14개 컬렉션 명시적 규칙으로 교체.

| 보호 대상 | 접근 제한 |
|-----------|-----------|
| `plans/{planId}` | 소유자 or isPublic (읽기), 소유자만 update (uid 변경 불가) |
| `users/{uid}` + 서브컬렉션 7개 | 본인만 |
| `used_paypal_orders`, `api_stats`, `availability` | 완전 차단 (서버 전용) |
| `tours/{tourId}` | 전체 공개 읽기 |

**검증**: 기본 3케이스 + 강화 10케이스 = **13/13 PASS**

**롤백**: `copy firestore.rules.preHardening firestore.rules && firebase deploy --only firestore:rules`

---

### 2. 🪙 D3 Phase 1 — 공유 리워드 (earn-share)

**목적**: 플랜 공유 시 +20 Trip Coins → 바이럴 성장 유도

| 변경 파일 | 내용 |
|-----------|------|
| `api/loyalty.js` | `earn-share` action (트랜잭션, 중복 방지, 소유자 검증) |
| `firestore.rules` | `shareRewards` 서브컬렉션 규칙 |
| `ShareButton.tsx` | 두 컴포넌트 모두 fire-and-forget 리워드 호출 |
| `MyPage.tsx` | Points History 탭 UI 폴리싱 |
| `i18n/index.ts` | 4개 언어 shareReward 문자열 |

**검증**: curl 4케이스 (신규 지급 / 중복 방지 / 타인 차단 / 미존재 플랜) = **4/4 PASS**

---

### 3. 💳 D3 Phase 2+3 — 코인→쿠폰 교환 + 결제 버그 픽스

#### 3.1 Phase 2: 코인→쿠폰 교환

MyPage Coupons 탭에 **Redeem Trip Coins** 섹션 추가.

| 코인 | 쿠폰 가치 | 보너스 |
|------|-----------|--------|
| 500 | $5 OFF | — |
| 1,000 | $10 OFF | — |
| 2,000 | $25 OFF | +25% |

**작동 방식**: 교환 버튼 → confirm → `redeem-coupon` API → 트랜잭션(코인 차감 + 쿠폰 발급 + 이력 기록) → 코드 자동 클립보드 복사

**서버 신뢰 원칙**: 레이트 테이블은 서버에서만 정의. 클라이언트가 `usdValue: 99999` 보내도 무시됨 (검증 완료).

#### 3.2 Phase 3: 결제 연동 + 버그 2건 픽스

**Bug #1 (치명)** — `api/applyPromoCode.js` L62:
```diff
- const discount = coupon.value / (originalPrice || 1)   // ❌ originalPrice 미정의!
+ // raw 값 반환 → handler에서 실시간 환율로 계산
+ return { type, value, currency, couponDocId, ... }
```

**Bug #2 (치명)** — 결제 성공 후 쿠폰 `isUsed` 미처리:
```diff
# api/capturePaypalOrder.js — capture 성공 후 추가
+ if (couponDocId && couponUserId) {
+   await db.collection('users').doc(couponUserId)
+     .collection('coupons').doc(couponDocId)
+     .update({ isUsed: true, usedAt: FieldValue.serverTimestamp() });
+ }
```

→ 이전에는 쿠폰을 **무한 재사용** 가능했음. 이제 결제 완료 시 소진됨.

#### 3.3 환율 Cap 로직 (사업자 보호)

```javascript
// applyPromoCode.js — 쿠폰 USD→KRW 변환 시
const realRate = (await rateRes.json()).rates.KRW;
usdToKrw = Math.min(realRate, 1350);
```

| 실시간 환율 | 적용 환율 | 이유 |
|-------------|-----------|------|
| 1400 (> 1350) | **1350** | 환율 높으면 쿠폰 할인 커짐 → 손해 → cap |
| 1300 (< 1350) | **1300** | 환율 낮으면 쿠폰 할인 작아짐 → 유리 → 실시간 |
| API 실패 | **1350** | fallback |

---

## 프로덕션 검증 결과

### Phase 2 — redeem-coupon curl 테스트

| # | 테스트 | 기대 | 결과 |
|---|--------|------|------|
| ① | 500코인 → $5 쿠폰 | 성공, 잔액 차감 | ✅ `SAVE-3F2E51`, 1455→955 |
| ② | 잔액 부족 (10000) | 400 에러 | ✅ `Invalid redemption tier` |
| ③ | 미존재 tier (777) | 400 에러 | ✅ `Invalid redemption tier` |
| ④ | usdValue 조작 | value:5 (서버 값) | ✅ `SAVE-936DD5`, value:5 |

### 프로덕션 UI 확인

- ✅ 헤더 배지: `Gold | 🪙 455`
- ✅ Coupons 탭: Redeem 섹션 + 발급된 쿠폰 2장 표시
- ✅ Points 탭: "Redeemed 500 coins → $5 OFF" 이력 2건

---

## 변경된 파일 전체 목록

| 파일 | 변경 내용 |
|------|-----------|
| `api/loyalty.js` | `earn-share` + `redeem-coupon` action |
| `api/applyPromoCode.js` | Bug #1 픽스 + 실시간 환율(1350 cap) + `couponDocId` 반환 |
| `api/capturePaypalOrder.js` | Bug #2 픽스 — capture 후 isUsed 마킹 |
| `src/components/PayPalBookingButton.tsx` | `couponDocId` 상태 + capture body 전달 + 하드코딩 1350 제거 |
| `src/pages/MyPage.tsx` | Redeem UI + `handleRedeem` 함수 + Points 이력 |
| `src/pages/PlanDetailPage/components/ShareButton.tsx` | earn-share 리워드 호출 |
| `src/i18n/index.ts` | 4개 언어 shareReward 문자열 |
| `firestore.rules` | 강화 규칙 (catch-all 제거 + shareRewards 추가) |

---

## 현재 상태

| 항목 | 값 |
|------|-----|
| 테스트 계정 | TAEO (`rLpDpgI8HffwFe7x3LVD9VfARCd2`) |
| 잔액 | 455 coins (최초 1435 → +20 공유 → -500×2 교환) |
| 발급 쿠폰 | `SAVE-3F2E51` ($5), `SAVE-936DD5` ($5) |
| Firestore Rules | 강화 버전 운영 중 |
| 쿠폰 무한 재사용 버그 | 🔧 수정됨 |

---

## 다음 단계 (미착수)

### E2E 결제 검증 (수동 필요)
- 발급된 쿠폰 코드로 실제 결제 시 할인 적용 확인
- 결제 완료 후 Firebase 콘솔에서 `isUsed: true` 확인
- 동일 코드 재사용 시 차단 확인
- **Test Mode는 capture 경로 안 탐** → PayPal 샌드박스 실결제 필요

### 향후 개선
- 3,000 coins → $40 OFF 한정 이벤트 (테이블 추가만으로 가능)
- 공유 리워드 일일 상한 (현재 planId별 1회라 실질 제한 있음)
- 환율 API 공통 유틸 분리 (`createPaypalOrder` + `applyPromoCode` 중복)
- 리뷰 리워드 시스템 (리뷰 UI 자체 미구현)

---

## 관련 문서

| 문서 | 용도 |
|------|------|
| `docs/HANDOFF-firestore-rules-hardening.md` | 강화 작업 계획 |
| `docs/HANDOFF-loyalty-phase1.md` | Phase 1 설계 |
| `docs/HANDOFF-loyalty-phase2-3.md` | Phase 2+3 설계 |
| `scripts/test-firestore-rules.mjs` | 기본 보안 테스트 (3케이스) |
| `scripts/test-firestore-rules-hardening.mjs` | 강화 보안 테스트 (10케이스) |
| `firestore.rules.preHardening` | 강화 전 백업 |
