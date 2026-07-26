# 📋 다음 스프린트 핸드오프 — protobufjs / D2 eSIM / 리뷰 시스템

**작성일**: 2026-04-20
**대상**: AG (다음 세션 실행자)
**선행 세션**: `HANDOFF-session-0420-final.md`, `AUDIT-2026-04-20.md`
**현재 커밋**: `7411a10` (main, origin/main 동기화)

---

## 🎯 이번 스프린트 범위 (3건)

| # | 작업 | 우선순위 | 차단 조건 | 예상 시간 |
|---|------|----------|-----------|-----------|
| 1 | **protobufjs CVE 픽스** | 🟡 P1 | 없음 | 30~90분 |
| 2 | **D2 eSIM 통합 (Airalo)** | 🟢 P2 | ⚠️ Airalo 파트너 가입 완료 후 | 3~5시간 |
| 3 | **리뷰 시스템 풀스택** | 🟡 P1 | 없음 | 6~10시간 |

### 🗺️ 권장 실행 순서

```
① protobufjs (빠른 보안 픽스, 블로커 없음)
  ↓
③ 리뷰 시스템 (D3 원래 스펙 중 미구현 잔여분, 신규 참여 지표)
  ↓
② D2 eSIM (Airalo 가입 완료 대기 — 사용자 의존)
```

**이유**: ①은 CVE를 빨리 닫는 게 이득이고 회귀 위험이 낮다. ③은 기존 로열티 시스템(`earn-share` 패턴)을 그대로 재사용 가능 → 구현 마찰 최소. ②는 외부 파트너 계약이 선행되어야 하므로 잠김 해제 전까지 UI 선행 작업만 가능.

---

## 📌 실행 공통 규칙 (모든 작업 적용)

1. **LOCKED 영역 금지**: `PayPalBookingButton.tsx` L164~225 `window.paypal.Buttons({...})` 블록은 절대 수정 금지. 로열티/쿠폰 연동은 이미 완료된 상태로 유지.
2. **i18n 4개 언어 필수**: 사용자 노출 문자열 추가 시 `src/i18n/index.ts`에 `ko/en/ja/zh` 4개 언어 전부 추가. 하나라도 누락 시 빌드 중지.
3. **필드 스키마**: AI 플래너는 `name / display_name / tip` 필드 사용. `name_ko / name_en / tip_en` 사용 금지 (CLAUDE.md §A).
4. **커밋 규칙**: 기능별 분리 커밋 권장. 단, 픽스가 치명 버그의 사용 창구를 여는 경우는 번들 커밋.
5. **빌드 검증**: 각 커밋 전 `tsc --noEmit` + `vite build` 성공 확인.
6. **배포 검증**: 배포 직후 프로덕션 스모크 (`curl https://cocotripkr.com/api/...`) 필수.

---

# 1. 🔐 protobufjs CVE 픽스

## 1.1 배경

`npm audit` 결과 (2026-04-20 기준):

| 심각도 | 건수 |
|--------|------|
| critical | **1** (protobufjs) |
| moderate | 3 |
| low | 8 |

`protobufjs`는 `firebase-admin`의 하위(트랜지티브) 의존성이므로 직접 업그레이드 불가. **firebase-admin 버전을 올려야 해결**.

## 1.2 진단 절차

```bash
# 1. 현재 버전 확인
npm ls protobufjs
npm ls firebase-admin

# 2. CVE 상세
npm audit --json > audit-before.json
npm audit --audit-level=critical

# 3. firebase-admin 최신 버전 조회
npm view firebase-admin versions --json | tail -20
npm view firebase-admin dist-tags
```

## 1.3 수정 전략 (3단계 시도)

### 🟢 Tier 1: `npm audit fix` (무해 시도)

```bash
npm audit fix
npm audit --audit-level=critical  # 0건이면 성공
npm run build                      # 회귀 확인
```

→ 보통 트랜지티브는 안 풀릴 확률 높지만 **반드시 먼저 시도**.

### 🟡 Tier 2: firebase-admin 마이너 업그레이드

```bash
# package.json에서 현재 ^X.Y.Z 확인 후
npm install firebase-admin@latest
npm ls protobufjs           # 버전 재확인
npm audit --audit-level=critical
```

**회귀 체크리스트** (Tier 2 적용 시 필수):
- [ ] `api/loyalty.js` — Firestore 트랜잭션 정상 동작 (earn-share, redeem-coupon, earn)
- [ ] `api/applyPromoCode.js` — 쿠폰 검증 + 환율 계산
- [ ] `api/capturePaypalOrder.js` — 쿠폰 `isUsed` 마킹
- [ ] `plan-status`, `plan-delete` — 플랜 CRUD
- [ ] Firebase Admin 초기화 (`GOOGLE_SERVICE_ACCOUNT_KEY` 파싱)

### 🔴 Tier 3: 메이저 업그레이드 (breaking 가능)

firebase-admin 메이저 변경 시 API 차이 가능. 권장하지 않음 — Tier 2로 해결 불가 시에만 별도 세션에서 진행.

## 1.4 검증 & 롤백

**검증**:
```bash
npm audit --json > audit-after.json
diff audit-before.json audit-after.json  # critical 0 확인
npm run build
node -e "require('firebase-admin').initializeApp;"  # 로드 smoke
```

**롤백** (회귀 발생 시):
```bash
git checkout HEAD~1 -- package.json package-lock.json
npm install
```

## 1.5 커밋 가이드

```
chore: bump firebase-admin to fix protobufjs CVE (critical)

- protobufjs CVE closed via firebase-admin upgrade
- audit: critical 1→0
- Smoke tested: loyalty earn-share/redeem, applyPromoCode, capture isUsed
```

## 1.6 완료 기준

- [ ] `npm audit --audit-level=critical` → 0건
- [ ] 프로덕션 배포 후 `/api/loyalty` `earn-share` curl 정상 응답
- [ ] `/api/applyPromoCode` 정상 응답
- [ ] Firebase 콘솔에서 쓰기 반영 확인

---

# 2. 📱 D2 eSIM 통합 (Airalo)

## ⚠️ 차단 조건 (사용자 의존)

**이 작업은 다음 두 정보가 준비되기 전까지 구현 착수 금지**:

1. **Airalo 파트너 계정** — 사용자가 https://partners.airalo.com/ 가입 완료
2. **파트너 ID / API 키 / 제휴 링크 포맷** — 사용자가 AG에게 전달

→ 전달되기 전까지는 **2.2 사전 UI 설계만** 진행 가능.

## 2.1 목적

AI 플래너 + 투어 구매 동선 끝에 여행자용 eSIM 판매 링크를 노출해 **신규 매출 스트림** 확보. CocoTrip 사용자는 대부분 **한국 여행 외국인** → 현지 도착 즉시 데이터 필요 → 전환율 높음.

## 2.2 사전 UI 설계 (차단 해제 전 가능)

### 배치 후보

| 위치 | 장점 | 단점 |
|------|------|------|
| **A. 플랜 상세 페이지 상단 배너** | 플랜 확정 시점 = 구매 의도 최고조 | 공간 제약 |
| **B. `PurchaseSection.tsx` 아래 별도 카드** | 결제 흐름 내 자연스러운 노출 | LOCKED 영역 근처 — 주의 |
| **C. 홈 히어로 섹션 아래 프로모 카드** | 신규 방문자도 노출 | 전환율 낮음 |
| **D. MyPage "My Trips" 탭 내 eSIM 배너** | 반복 방문 시 노출 | 타이밍 늦음 |

**권장**: **A + D 조합** (플랜 확정 시점 + MyPage 재방문 시점 이중 노출)

### 컴포넌트 구조 (드래프트)

```
src/components/EsimPromoCard.tsx
  - 목적지 국가 자동 감지 (플랜 → country)
  - Airalo 제휴 링크 생성 (파트너 ID 삽입)
  - CTA 클릭 시 GA4 이벤트 전송 (`esim_click`, `country`, `plan_id`)
  - 4개 언어 문자열

src/i18n/index.ts 추가 키
  esim: {
    title: "Get travel data before you land",
    subtitle: "eSIM for your destination — instant activation",
    cta: "Browse eSIM plans",
    partnerDisclosure: "Affiliate partnership"
  }
```

## 2.3 본 구현 (차단 해제 후)

### 환경변수

```
AIRALO_PARTNER_ID=xxx
AIRALO_AFFILIATE_BASE=https://www.airalo.com/?ref=xxx
```

Vercel 대시보드에 등록 (서버 전용 변수면 `VITE_` 접두 금지).

### 제휴 링크 생성 유틸

```
src/utils/esim.ts
export function buildAiraloLink(country: string, planId?: string): string {
  const base = import.meta.env.VITE_AIRALO_AFFILIATE_BASE;
  const countryCode = mapCountryToAiraloSlug(country); // 'korea', 'japan', etc.
  return `${base}&destination=${countryCode}${planId ? `&utm_content=${planId}` : ''}`;
}
```

### GA4 이벤트

```typescript
gtag('event', 'esim_click', {
  destination: country,
  plan_id: planId,
  placement: 'plan_detail_banner' | 'mypage_trips'
});
```

### API 호출 여부 결정

Airalo가 제공하는 통합 방식:
- **Tier A (권장)**: 단순 제휴 링크 (구현 1시간)
- **Tier B**: REST API 임베드 (구현 3~5시간, 파트너 레벨 필요)

파트너 가입 후 어느 Tier 권한인지 확인 → AG에게 전달.

## 2.4 완료 기준

- [ ] 플랜 상세 + MyPage에 eSIM 카드 노출
- [ ] 클릭 시 올바른 파트너 링크로 이동 (파라미터 포함)
- [ ] GA4 `esim_click` 이벤트 수집 확인
- [ ] 4개 언어 문자열 전부 반영

---

# 3. ⭐ 리뷰 시스템 풀스택

## 3.1 배경

원래 D3 스펙에 포함됐으나 미구현 상태. **공유(+20P) / 교환(-500P) 순환 고리는 완성됐지만, 리뷰 작성(+50P) 리워드 고리가 비어있음** → 사용자 참여의 절반만 가동 중.

## 3.2 데이터 모델

### Firestore 스키마

```
reviews/{reviewId}
  - reviewId: auto-generated
  - planId: string (FK → plans)
  - authorUid: string
  - authorName: string (denormalized)
  - authorPhotoURL: string | null
  - targetType: 'plan' | 'tour'
  - targetId: string (planId 또는 tourId)
  - rating: number (1~5)
  - text: string (max 500자)
  - photos: string[] (Firebase Storage URL, 최대 3장)
  - createdAt: Timestamp
  - updatedAt: Timestamp
  - status: 'published' | 'hidden' | 'reported'
  - language: 'ko' | 'en' | 'ja' | 'zh'

users/{uid}/reviewRewards/{reviewId}
  - rewarded: true
  - rewardedAt: Timestamp
  - coins: 50
```

### 기존 컬렉션과의 관계

- `plans/{planId}` — 플랜 소유자가 자기 플랜에 리뷰 작성 불가 (소유자 검증)
- `tours/{tourId}` — 예약 이력 있는 사용자만 리뷰 작성 가능 (bookings 조회)
- `users/{uid}/reviewRewards` — 중복 리워드 방지 (공유 리워드 패턴 재사용)
- `users/{uid}/pointHistory` — `+50 review` 이력 기록

## 3.3 API 설계

### `api/reviews.js` (신규)

```javascript
// POST /api/reviews { action, ...payload }

actions:
  - 'create'   → { planId, targetType, targetId, rating, text, photos }
  - 'list'     → { targetType, targetId, limit, cursor } // 무인증 가능
  - 'delete'   → { reviewId } // 작성자 or 어드민
  - 'report'   → { reviewId, reason } // 스팸/부적절 신고
```

**create 트랜잭션**:
1. 작성자 자격 검증 (자기 플랜 제외, 투어면 예약 이력 필수)
2. 중복 리뷰 체크 (userId + targetId 조합 1회)
3. `reviews/{reviewId}` 생성
4. `users/{uid}/reviewRewards/{reviewId}` 마커 생성
5. `users/{uid}` tripCoins += 50
6. `users/{uid}/pointHistory` 기록

→ **`earn-share` 패턴을 거의 그대로 복사 가능**

### `api/loyalty.js` 확장

기존 파일에 `earn-review` action 추가 (optional — `api/reviews.js`에서 직접 업데이트 가능, 분리는 리팩터링 여지).

## 3.4 Firestore Rules 추가

```
match /reviews/{reviewId} {
  allow read: if true; // 공개
  allow create: if request.auth != null
                && request.resource.data.authorUid == request.auth.uid
                && request.resource.data.rating >= 1
                && request.resource.data.rating <= 5
                && request.resource.data.text.size() <= 500;
  allow update: if request.auth != null
                && resource.data.authorUid == request.auth.uid
                && request.resource.data.authorUid == resource.data.authorUid; // uid 변경 금지
  allow delete: if request.auth != null
                && (resource.data.authorUid == request.auth.uid
                    || isAdmin(request.auth.token.email));
}

match /users/{uid}/reviewRewards/{reviewId} {
  allow read: if request.auth != null && request.auth.uid == uid;
  allow write: if false; // 서버 전용
}
```

## 3.5 클라이언트 UI

### 신규 컴포넌트

| 파일 | 역할 |
|------|------|
| `src/components/ReviewWriteModal.tsx` | 별점 + 텍스트 + 사진 업로드 |
| `src/components/ReviewList.tsx` | 리뷰 목록 카드 (페이지네이션) |
| `src/components/ReviewCard.tsx` | 개별 리뷰 카드 (신고/삭제 메뉴) |
| `src/components/StarRating.tsx` | 재사용 가능한 별점 컴포넌트 |

### 통합 지점

- `src/pages/PlanDetailPage/` → 하단에 `ReviewList` + "리뷰 작성" 버튼
- `src/pages/TourDetailPage.tsx` (또는 투어 페이지) → 동일
- `src/pages/MyPage.tsx` → "My Reviews" 탭 신설 (작성한 리뷰 관리)

### i18n (4개 언어)

```
reviews: {
  writeButton: "Write a review",
  placeholder: "Share your experience...",
  rating: "Your rating",
  submit: "Submit review",
  rewardToast: "Thanks! +50 Trip Coins earned",
  alreadyReviewed: "You've already reviewed this",
  notEligible: "Only travelers who booked can review",
  reportButton: "Report",
  deleteButton: "Delete",
  empty: "Be the first to review",
  count: "{count} reviews",
  photoUpload: "Add photos (max 3)",
  charLimit: "{used}/500"
}
```

## 3.6 모더레이션 (기본선)

**v1 (이번 스프린트)**:
- 텍스트 길이 500자 제한
- 평점 1~5 검증
- 사진 3장 제한
- `status` 필드로 어드민 숨김 가능 (어드민 UI 없음, Firestore 콘솔에서 직접)
- 작성자/어드민만 삭제

**v2 (후속)**:
- 어드민 모더레이션 대시보드
- 자동 스팸 필터 (동일 IP 연속 작성, URL 포함 감지)
- Perspective API 또는 Gemini로 혐오 표현 감지

## 3.7 사진 업로드

**Firebase Storage 사용**:
```
/reviews/{uid}/{reviewId}/{photoIndex}.jpg
```

**Storage Rules**:
```
match /reviews/{uid}/{reviewId}/{photo} {
  allow read: if true;
  allow write: if request.auth != null
               && request.auth.uid == uid
               && request.resource.size < 5 * 1024 * 1024
               && request.resource.contentType.matches('image/.*');
}
```

## 3.8 검증 플랜

### curl 테스트
```bash
# 1. 신규 리뷰 생성 (리워드 +50 기대)
curl -X POST https://cocotripkr.com/api/reviews \
  -d '{"action":"create","planId":"xxx","targetType":"plan","targetId":"xxx","rating":5,"text":"Great!"}'

# 2. 동일 타겟 재작성 (차단 기대)
curl ...  # → 409 alreadyReviewed

# 3. 본인 플랜에 리뷰 (차단 기대)
curl ...  # → 403

# 4. list 무인증 조회
curl https://cocotripkr.com/api/reviews?action=list&targetType=plan&targetId=xxx
# → 200 + 리뷰 배열
```

### UI 스모크
- [ ] 리뷰 작성 모달 4개 언어 정상 렌더
- [ ] 별점 인터랙션 정상
- [ ] 사진 업로드 3장 제한 작동
- [ ] 제출 후 "+50 Trip Coins" 토스트
- [ ] Points 탭에 `+50 review` 이력 확인
- [ ] 동일 타겟 재시도 시 "already reviewed" 안내

### 회귀 체크
- [ ] 기존 `earn-share` 리워드 정상 작동 (같은 loyalty API)
- [ ] `redeem-coupon` 정상 작동
- [ ] 플랜/투어 상세 페이지 기존 기능 영향 없음

## 3.9 커밋 분할 권장

```
1) feat: add reviews API (create/list/delete/report)
2) feat: add Firestore rules for reviews + reviewRewards
3) feat: add review UI components (ReviewWriteModal, ReviewList, ReviewCard, StarRating)
4) feat: integrate review sections in PlanDetail + MyPage
5) feat: wire review reward (+50 Trip Coins)
6) i18n: 4-language strings for reviews
```

→ 롤백 단위를 작게 유지. 실패 지점을 빠르게 특정 가능.

## 3.10 완료 기준

- [ ] `POST /api/reviews` `create` 정상 응답 + Firestore 기록
- [ ] 리뷰 작성 후 `users/{uid}.tripCoins` +50 확인
- [ ] `users/{uid}/reviewRewards/{reviewId}` 마커 생성 확인
- [ ] `pointHistory`에 `+50 review` 이력
- [ ] 플랜 상세 페이지 리뷰 섹션 정상 렌더
- [ ] 4개 언어 문자열 전부 반영
- [ ] 중복 작성 차단 / 소유자 작성 차단
- [ ] `tsc --noEmit` + `vite build` 에러 0
- [ ] Firestore Rules 배포 완료 및 보안 테스트 통과

---

# 4. 🚫 이번 스프린트에서 하지 말 것

| 항목 | 이유 |
|------|------|
| `PayPalBookingButton.tsx` L164~225 수정 | LOCKED 영역 |
| D3 Phase 1/2/3 재수정 | 이미 프로덕션 검증 완료 |
| Firestore Rules catch-all 복원 | 보안 취약점 재개방 |
| 어드민 대시보드 신규 구축 | 스코프 아님 — v2 |
| `api/applyPromoCode.js` 환율 cap 1350 변경 | 사업자 보호 로직 — 별도 논의 |
| AI 플래너 필드 스키마 변경 | CLAUDE.md §A 위반 |

---

# 5. 📞 사용자(소유자) 액션 필요 항목

AG는 **이 항목에 대해서만 사용자에게 확인 요청**. 나머지는 자율 실행.

1. **Airalo 파트너 가입 완료 여부** → D2 진행 가능 시점
2. **Airalo 파트너 ID / API 키 / 제휴 링크 포맷** 전달
3. (선행 세션 잔여) A1 PayPal 샌드박스 결제 E2E 검증 — 쿠폰 `isUsed` 마킹 실증
4. (선행 세션 잔여) OG webp 실제 페이스북/카카오톡 공유 테스트

---

# 6. 📚 관련 문서

| 문서 | 용도 |
|------|------|
| `docs/HANDOFF-session-0420-final.md` | 직전 세션 완료 상태 (Firestore Rules + D3) |
| `docs/AUDIT-2026-04-20.md` | 2026-04-20 감사 보고 (P0/P1/P2 이슈) |
| `docs/HANDOFF-loyalty-phase1.md` | `earn-share` 패턴 (리뷰 시스템에 재사용) |
| `docs/HANDOFF-loyalty-phase2-3.md` | 트랜잭션 + 서버 신뢰 원칙 |
| `CLAUDE.md` | 프로젝트 규칙 (필드 스키마, LOCKED, i18n) |
| `firestore.rules` | 현재 강화 버전 규칙 |
| `firestore.rules.preHardening` | 롤백용 백업 |

---

# 7. 🎬 AG에게 — 실행 시작 체크리스트

```bash
# 0. 작업 브랜치 확인
git status
git log --oneline -5

# 1. 의존성 상태 확인
npm ls firebase-admin
npm audit --audit-level=critical

# 2. 빌드 베이스라인
npm run build

# 3. 현재 프로덕션 스모크
curl -I https://cocotripkr.com/api/og-image
curl https://cocotripkr.com/api/loyalty -X POST -d '{}'  # 405 기대
```

전부 정상이면 → **§1 protobufjs부터 착수**.

---

**작성**: 2026-04-20
**현재 커밋**: `7411a10`
**다음 예상 커밋**: 최소 3개 (protobufjs + reviews 분할)
