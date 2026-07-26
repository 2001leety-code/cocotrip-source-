# 🔒 Firestore Rules 보안 강화 핸드오프 (catch-all 제거)

**작성일**: 2026-04-20 KST
**프로젝트**: `planning-with-ai-a0801` (CocoTrip)
**작업 목적**: HANDOFF-firestore-rules.md 이슈 1 (catch-all 보안 구멍) 해결
**선행 작업**: `docs/HANDOFF-firestore-rules.md` 완료 (isPublic 조건 배포됨)
**난이도**: ⚠️ 중간 (기존 기능 회귀 가능성 있음 — Preview 검증 필수)

---

## 1. 왜 이 작업을 하는가

### 1.1 현재 취약점 (배포된 프로덕션)

```
match /{document=**} {
  allow read, write: if request.auth != null;
}
```

Firestore 규칙은 **OR 평가**이므로 `plans/{planId}` 규칙으로 소유자만 읽기로 제한해도, **catch-all이 "로그인만 하면 아무 문서나 read/write"를 허용**한다.

### 1.2 실제 영향 — 공격 시나리오

1. 공격자가 cocotripkr.com에 구글 로그인
2. 개발자 도구에서 `getDoc(doc(db, 'plans', <알려진_planId>))` 호출
3. **남의 비공개 플랜 전체를 읽을 수 있음** (uid, guestEmail, pricing, hotel_address 등 PII 포함)
4. 또는 `setDoc(doc(db, 'api_stats', '2026-04'), { ... })`로 서버 통계 조작
5. 또는 `updateDoc(doc(db, 'used_paypal_orders', <id>), ...)`로 결제 중복 방지 토큰 덮어쓰기

D1 공개 공유 기능 배포 후에도 **비로그인 차단만 됐을 뿐, 로그인 사용자 간 크로스 접근은 여전히 열려 있음**.

### 1.3 목표

- Catch-all 제거
- 모든 컬렉션에 **명시적 규칙** 부여
- 사용 중인 클라이언트 경로 100% 보존 (회귀 없음)
- Admin SDK 경로는 그대로 작동 (Admin SDK는 rules 우회)

---

## 2. 변경 요약

### 2.1 Before / After

**현재 (`firestore.rules` — 배포됨)**

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /plans/{planId} {
      allow read: if resource.data.uid == null
               || resource.data.isPublic == true
               || (request.auth != null && resource.data.uid == request.auth.uid);
      allow write: if false;
    }
    match /users/{uid}/plans/{planId} {
      allow read: if request.auth != null && request.auth.uid == uid;
      allow write: if false;
    }
    match /{document=**} {
      allow read, write: if request.auth != null;   // ← 이 3줄이 문제
    }
  }
}
```

**변경 후 (`firestore.rules.hardened` — 이미 파일 생성됨)**

- Catch-all 삭제
- 각 컬렉션 **명시적 정의**
- plans: 소유자 `update` 허용 (isPublic 토글, 플랜 편집). `create/delete`는 서버 전용.
- users: 본인만. 서브컬렉션 분리.
- tours: 공개 read + 로그인 예약 update + 어드민 create/delete.
- earlybird: 공개 read.
- 서버 전용 (used_paypal_orders, api_stats, availability, reservations): 클라이언트 차단.

전문은 `firestore.rules.hardened` 파일 참조.

### 2.2 컬렉션 매트릭스 (검증 기준)

| 컬렉션 경로 | 클라이언트 사용처 | 새 규칙 | 이유 |
|---|---|---|---|
| `plans/{planId}` | PlanDetailPage (read), ShareButton (update isPublic), usePlanEditor (update content) | read: 기존 + isPublic, update: 소유자만 (uid 불변), create/delete: false | 기존 기능 보존 + D1 공유 보존 + 서버 생성/삭제 |
| `users/{uid}` | useLoyalty (read) | 본인만 read/write | 내 프로필 |
| `users/{uid}/plans/{planId}` | MyPlansPage (read) | read: 본인, write: false | 서버(planPersister)가 생성 |
| `users/{uid}/pointHistory/{id}` | useLoyalty (read) | read: 본인, write: false | 서버(loyalty API)가 기록 |
| `users/{uid}/coupons/{id}` | useLoyalty (read), applyPromoCode (server) | read: 본인, write: false | 서버가 발급/소진 |
| `users/{uid}/wishlist/{id}` | useWishlist (r/w) | 본인 r/w | 클라이언트 관리 |
| `users/{uid}/itineraries/{id}` | useItinerary (r/w) | 본인 r/w | 클라이언트 관리 |
| `tours/{tourId}` | Booking.tsx (read), Admin.tsx (create), bookingService (update) | read: public, update: 로그인, create/delete: 어드민 | 예약 트랜잭션이 currentBookings 증가 |
| `tours/{tourId}/bookings/{id}` | bookingService (create transaction) | read/create: 본인 (userId=auth.uid), u/d: 어드민 | 예약 레코드 |
| `earlybird/counter` | EarlyBirdBanner (read) | read: public, write: false | 공개 카운터 |
| `used_paypal_orders/{id}` | 없음 (Admin SDK만) | 클라이언트 모두 차단 | 결제 멱등성 토큰 |
| `api_stats/**` | 없음 (Admin SDK만) | 클라이언트 모두 차단 | 서버 통계 |
| `availability/{date}` | 없음 (Admin SDK만) | 클라이언트 모두 차단 | 서버 예약 슬롯 |
| `reservations/{id}` | 없음 (Admin SDK만) | 클라이언트 모두 차단 | 서버 예약 레코드 |

> ⚠️ **어드민 판별**: `request.auth.token.email == '2001leety@gmail.com'` 하드코딩. 어드민 계정이 바뀌면 규칙도 수정.

---

## 3. 배포 절차 (AG 실행용)

### 3.1 사전 점검

```bash
# 현재 운영 규칙 백업 확인 (HANDOFF-firestore-rules.md에서 생성됨)
ls -la firestore.rules.backup

# 새 강화 규칙 파일 존재 확인
ls -la firestore.rules.hardened
```

둘 다 있어야 진행. 없으면 STOP하고 사용자에게 보고.

### 3.2 추가 백업 (이중 안전)

```powershell
# 현재 운영본을 isPublic 버전으로 한번 더 백업
copy firestore.rules firestore.rules.preHardening
```

### 3.3 강화본 적용

```powershell
# 강화본을 운영 파일로 복사
copy firestore.rules.hardened firestore.rules
```

### 3.4 로컬 문법 검증 (emulator 있으면)

```bash
# 선택적: 문법만 확인
npx firebase firestore:rules --project planning-with-ai-a0801
# 또는 MCP firebase_validate_security_rules 사용
```

### 3.5 배포

```bash
firebase deploy --only firestore:rules --project planning-with-ai-a0801
```

**배포 후 즉시** `scripts/test-firestore-rules.mjs`로 기존 3개 케이스 재검증:
- A: Admin JWT → `200 OK`
- B: isPublic=true → `200 OK`
- C: isPublic=false → `403`

하나라도 실패하면 **즉시 롤백** (§6).

---

## 4. 검증 계획 (필수)

배포 전/후 모두 실행 권장.

### 4.1 자동 검증 (기존 스크립트 재사용)

```bash
node scripts/test-firestore-rules.mjs
```

3 케이스 모두 PASS여야 함.

### 4.2 추가 자동 검증 — 크로스유저 접근 차단 테스트 (권장)

`scripts/test-firestore-rules-hardening.mjs` 신규 작성 (템플릿 아래).

검증 케이스:

| 케이스 | 입력 | 기대 | 확인 대상 |
|---|---|---|---|
| D1 | 사용자 X 로그인 → 사용자 Y의 `isPublic=false` 플랜 read | **403** | catch-all 제거 효과 |
| D2 | 사용자 X 로그인 → `used_paypal_orders/{any}` read | **403** | 서버 전용 보호 |
| D3 | 사용자 X 로그인 → `api_stats/2026-04` read | **403** | 통계 조작 방지 |
| D4 | 사용자 X 로그인 → 본인 plan update (isPublic 토글) | **200** | ShareButton 보존 |
| D5 | 사용자 X 로그인 → 남의 plan update | **403** | 타인 편집 차단 |
| D6 | 비로그인 → `tours` read | **200** | 공개 카탈로그 |
| D7 | 비로그인 → `earlybird/counter` read | **200** | 공개 카운터 |

케이스 D1, D4, D5는 **테스트용 2번째 계정**이 필요. `.env.admin.local`에 `TEST_USER_B_EMAIL`, `TEST_USER_B_PASSWORD` 추가 후 Firebase Auth REST `signInWithPassword`로 토큰 획득.

### 4.3 수동 스모크 테스트 (프로덕션 Preview)

1. 시크릿 창에서 `/my-plans/{planId}?shared=1` 접근 (isPublic=true) → 로딩 성공
2. 본인 계정 로그인 → `/my-plans` 목록 정상 렌더링
3. ShareButton 클릭 → isPublic 토글 성공 (Firestore 콘솔에서 필드 변경 확인)
4. `/plan-editor` 수정 저장 → 성공
5. 홈페이지 → EarlyBird 배너 숫자 표시 (earlybird/counter read)
6. `/tours` 페이지 → 투어 목록 표시
7. `/my-plans` 포인트/쿠폰 섹션 표시 (useLoyalty subscription)

하나라도 실패 시 즉시 롤백.

---

## 5. 회귀 위험 핫스팟 (주의!)

| 위험 | 영향 | 대응 |
|---|---|---|
| **usePlanEditor가 `plans/{planId}` update에서 uid 필드를 덮어쓰지 않는지** | uid 변경 시도 시 update 거부됨 → 저장 실패 | 현재 코드는 지정 필드만 update하므로 안전. 하지만 실제 편집 시 확인 |
| **Admin.tsx의 tours 생성** | `isAdminEmail()`이 어드민 이메일을 하드코딩 — 다른 어드민 추가 어려움 | 단일 어드민이면 OK. 확장 필요 시 `admins/{uid}` 컬렉션 + `exists(/databases/$(database)/documents/admins/$(request.auth.uid))` 패턴으로 전환 |
| **bookingService 트랜잭션** | `tours/{tourId}` update + `tours/{tourId}/bookings/{id}` create 원자적 — 규칙이 양쪽 모두 허용해야 함 | 규칙에서 `tours.update: if isSignedIn()` 허용. booking.create도 `userId==auth.uid` 허용 |
| **`users/{uid}` root doc의 loyalty 포인트 필드** | 서버 loyalty API가 `users/{uid}.points` 업데이트함. 현재 규칙은 `users/{uid}` write를 본인에게만 허용 → Admin SDK는 어차피 우회하므로 OK | 클라이언트가 `points` 필드 직접 수정 가능한 점은 작은 위험 — 단, 서버 loyalty API에서 총점 재계산한다면 클라이언트 조작은 서버 재계산 때 덮어써짐. 후속 강화 과제 |

---

## 6. 롤백 절차

문제 발생 즉시:

```powershell
# 1단계: 강화 전 백업본 복구 (isPublic 있는 버전)
copy firestore.rules.preHardening firestore.rules
firebase deploy --only firestore:rules --project planning-with-ai-a0801
```

그래도 안되면 (극단적 경우):

```powershell
# 2단계: D1 이전 원본 복구 (isPublic 없는 버전)
copy firestore.rules.backup firestore.rules
firebase deploy --only firestore:rules --project planning-with-ai-a0801
```

2단계 사용 시 공유 기능이 깨짐 → 사용자에게 즉시 보고.

---

## 7. 커밋/PR 가이드

### 7.1 커밋 메시지

```
chore(security): harden Firestore rules — remove catch-all, add explicit per-collection policies

- Replace `match /{document=**} allow read,write if auth!=null` with explicit rules
- plans: owner-only update preserving uid immutability
- users/* subcollections: split client-managed vs server-managed
- tours: public read, booking-allowed update, admin-only create/delete
- Server-only collections (used_paypal_orders, api_stats, availability, reservations): block client access
- Addresses Issue 1 from HANDOFF-firestore-rules.md (cross-user read vulnerability)
```

### 7.2 파일 변경

- **수정**: `firestore.rules` (강화본 내용으로 교체)
- **추가**: `firestore.rules.preHardening` (배포 직전 스냅샷, gitignore 권장)
- **삭제**: `firestore.rules.hardened` (교체 후 중복 파일 정리)
- **추가 (선택)**: `scripts/test-firestore-rules-hardening.mjs`

### 7.3 `firestore.rules.hardened`, `firestore.rules.backup`, `firestore.rules.preHardening`은 .gitignore 권장

배포 후 운영 규칙은 Firestore 콘솔 + MCP `firebase_get_security_rules`로 언제든 복원 가능하므로 Git에 백업 스냅샷 커밋 불필요.

---

## 8. 체크리스트 (AG가 배포 전 확인)

- [ ] `firestore.rules.hardened` 내용을 읽고 각 컬렉션 규칙 이해
- [ ] §2.2 매트릭스와 `firestore.rules.hardened` 일치 확인
- [ ] `firestore.rules.preHardening` 백업 생성
- [ ] `firestore.rules`를 강화본으로 교체
- [ ] MCP `firebase_validate_security_rules` 문법 검증 통과
- [ ] `firebase deploy --only firestore:rules --project planning-with-ai-a0801` 성공
- [ ] `node scripts/test-firestore-rules.mjs` 3/3 PASS
- [ ] (선택) `scripts/test-firestore-rules-hardening.mjs` 작성 및 7/7 PASS
- [ ] 프로덕션 수동 스모크 테스트 §4.3 완료
- [ ] 이상 발생 시 §6 롤백 실행 후 사용자에게 보고

---

## 9. 관련 문서

- `docs/HANDOFF-firestore-rules.md` — 이 작업의 전제 (isPublic 조건 배포)
- `firestore.rules.hardened` — 이번에 배포할 강화 규칙 전문
- `scripts/test-firestore-rules.mjs` — 기본 검증 스크립트 (3 케이스)
- `api/_ai_core/planPersister.js` — Admin SDK가 plans/users/plans 생성
- `api/plan-delete.js` — Admin SDK가 plans/users/plans 삭제
- `src/pages/PlanDetailPage/components/ShareButton.tsx` — 클라이언트 isPublic update (이번 규칙으로 보존됨)
- `src/pages/PlanDetailPage/hooks/usePlanEditor.ts` — 클라이언트 플랜 편집 update (이번 규칙으로 보존됨)
