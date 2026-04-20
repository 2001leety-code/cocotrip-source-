# 📋 세션 완료 보고 — 2026-04-20

**프로젝트**: CocoTrip (`planning-with-ai-a0801`)  
**작업 시간**: 2026-04-20 14:09 ~ 15:29 KST  
**커밋**: `2ffeb91` (main)

---

## 완료된 작업 2건

### 1. 🔒 Firestore Rules 강화 (D2) — catch-all 제거

**문제**: `match /{document=**} { allow read, write: if request.auth != null; }` 규칙 때문에 로그인한 아무 사용자가 남의 비공개 플랜, 결제 토큰, 서버 통계까지 전부 접근 가능했음.

**해결**: catch-all 삭제 → 14개 컬렉션 명시적 규칙으로 교체.

| 컬렉션 | read | write |
|--------|------|-------|
| `plans/{planId}` | 소유자 or isPublic | 소유자 update만 (uid 변경 불가) |
| `users/{uid}` + 서브컬렉션 7개 | 본인만 | 본인 (일부 서버 전용) |
| `tours/{tourId}` | 전체 공개 | 로그인 update, 어드민 create/delete |
| `tours/{tourId}/bookings` | 본인+어드민 | 본인 create, 어드민 관리 |
| `earlybird/{docId}` | 전체 공개 | 서버 전용 |
| `used_paypal_orders` | ❌ 차단 | ❌ 차단 |
| `api_stats` | ❌ 차단 | ❌ 차단 |
| `availability` | ❌ 차단 | ❌ 차단 |
| `reservations` | ❌ 차단 | ❌ 차단 |

**검증 결과**:
- 기본 3케이스 (인증 read / 공개 비인증 / 비공개 비인증): ✅ 3/3 PASS
- 강화 10케이스 (서버 전용 차단 / 공개 접근 / write 차단): ✅ 10/10 PASS
- 프로덕션 스모크 (프로필, 로열티, 투어, 배너): ✅ 전체 정상

**백업 파일**:
- `firestore.rules.preHardening` — 강화 직전 (isPublic 포함)
- `firestore.rules.backup` — 최초 원본

**롤백** (필요 시):
```powershell
copy firestore.rules.preHardening firestore.rules
firebase deploy --only firestore:rules --project planning-with-ai-a0801
```

---

### 2. 🪙 공유 리워드 + 포인트 히스토리 (D3 Phase 1)

**목적**: 플랜 공유 동기 부여 → 공유 시 +20 Trip Coins 지급 + MyPage에서 포인트 이력 확인.

#### 2.1 변경 파일 (5개)

| 파일 | 변경 내용 |
|------|-----------|
| `api/loyalty.js` | `earn-share` action 추가 — 트랜잭션, 중복 방지, 소유자 검증 |
| `firestore.rules` | `users/{uid}/shareRewards/{planId}` 규칙 추가 (read: 본인, write: 서버 전용) |
| `ShareButton.tsx` | ShareButton + ShareMiniIcon 양쪽에 fire-and-forget 리워드 호출 |
| `MyPage.tsx` | Points History 탭 UI 폴리싱 (잔액 표시, 카드 업그레이드, 안내 문구) |
| `src/i18n/index.ts` | `shareReward` 4개 언어 동시 추가 (ko/en/ja/zh) |

#### 2.2 earn-share 동작 흐름

```
사용자가 Share 클릭
  → navigator.share() or clipboard.writeText()
  → 성공 시 POST /api/loyalty { action: 'earn-share', userId, planId, shareMethod }
  → 서버: planData.uid === userId 확인 (소유자만)
  → 서버: shareRewards/{planId} 문서 존재 여부 확인 (중복 방지)
  → 트랜잭션: tripCoins += 20, shareRewards 마커 생성, pointHistory 기록
  → 클라이언트: toast "+20 Trip Coins earned!"
  → 같은 플랜 재시도 시 → alreadyRewarded: true → 토스트 안 뜸
```

#### 2.3 프로덕션 검증 결과

| 테스트 | 기대 | 실제 | 결과 |
|--------|------|------|------|
| curl ① 신규 지급 | `earnedCoins: 20` | `1435 → 1455` | ✅ |
| curl ② 동일 플랜 재시도 | `alreadyRewarded: true` | `alreadyRewarded: true` | ✅ |
| curl ③ 타인 플랜 시도 | HTTP 403 | HTTP 403 | ✅ |
| curl ④ 미존재 planId | HTTP 404 | HTTP 404 | ✅ |
| 프로덕션 MyPage 잔액 | 1,455 | 1,455 | ✅ |
| tsc --noEmit | 에러 없음 | 에러 없음 | ✅ |
| vite build | 성공 | 성공 | ✅ |

---

## 현재 상태 요약

| 항목 | 상태 |
|------|------|
| Firestore Rules | ✅ 강화 버전 운영 중 (catch-all 제거) |
| earn-share API | ✅ 프로덕션 동작 확인 |
| ShareButton 리워드 | ✅ 배포됨 (양쪽 컴포넌트) |
| MyPage Points 탭 | ✅ 폴리싱 완료 |
| 테스트 잔액 | Gold · 1,455 coins (TAEO 계정) |

---

## 다음 단계 (미착수)

### Phase 2: 쿠폰 교환 기능
- MyPage에 "1000 Trip Coins → $10 OFF 쿠폰 교환" 버튼
- `api/loyalty.js`에 `redeem-coupon` action 또는 `spend` 확장

### Phase 3: AI 플래너 결제에 쿠폰 적용
- `PurchaseSection.tsx` → `PayPalBookingButton`은 **LOCKED region**
- 결제 흐름 전체 리버스 엔지니어링 필요 → 별도 세션

### 기타
- 리뷰 리워드: 리뷰 시스템 자체 미구현 → 풀 스택 필요
- 어드민 이메일 `2001leety@gmail.com` 하드코딩 → 관리 방법 결정 필요

---

## 관련 파일

| 파일 | 용도 |
|------|------|
| `docs/HANDOFF-firestore-rules-hardening.md` | 강화 작업 상세 계획 |
| `docs/HANDOFF-loyalty-phase1.md` | D3 Phase 1 상세 설계 |
| `scripts/test-firestore-rules.mjs` | 기본 보안 테스트 (3케이스) |
| `scripts/test-firestore-rules-hardening.mjs` | 강화 보안 테스트 (10케이스) |
| `firestore.rules.preHardening` | 강화 전 백업 |
| `firestore.rules.backup` | 최초 백업 |
