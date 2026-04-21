# 📋 다음 스프린트 3 핸드오프 — 이월 + v2 확장

**작성일**: 2026-04-21
**대상**: AG (다음 세션 실행자)
**선행 세션**: `HANDOFF-session-0420-sprint2.md` (스프린트 2 완료)
**현재 커밋**: `3cb4d3f` (main)

---

## 🎯 이번 스프린트 범위

| # | 작업 | 우선순위 | 차단 조건 | 예상 시간 |
|---|------|----------|-----------|-----------|
| 1 | **리뷰 Rules 보안 테스트 보강** | 🔴 P0 | 없음 | 30분 |
| 2 | **A1 쿠폰 E2E 검증** | 🔴 P0 | 사용자 PayPal 샌드박스 로그인 필요 | 20분 |
| 3 | **earlybird/counter 문서 생성** | 🟡 P1 | 없음 | 5분 |
| 4 | **리뷰 v2 — 사진 업로드** | 🟡 P1 | 없음 | 3~4시간 |
| 5 | **D2 eSIM (Airalo)** | 🟢 P2 | ⚠️ Airalo 파트너 가입 완료 대기 | 3~5시간 |
| 6 | **리뷰 v2 — 어드민 모더레이션** | 🟢 P2 | 없음 | 2~3시간 |

### 🗺️ 권장 실행 순서

```
① 리뷰 Rules 보안 테스트 (스프린트 2 후속 안전성 검증)
  ↓
③ earlybird/counter (5분 작업, 테스트 D4 해결)
  ↓
④ 리뷰 v2 사진 업로드 (사용자 참여도 강화)
  ↓
⑥ 어드민 모더레이션 (스팸 대응)
  ↓
② A1 쿠폰 E2E (사용자 샌드박스 접속 시)
  ↓
⑤ D2 eSIM (Airalo 가입 완료 시)
```

**이유**: ①은 직전 스프린트의 보안 규칙이 테스트 스위트에 편입 안 됐을 가능성 → 즉시 검증. ③은 5분 작업 → 먼저 빠른 승리. ④⑥은 독립 진행. ②⑤는 외부 의존.

---

## 📌 실행 공통 규칙

1. **LOCKED 영역 금지**: `PayPalBookingButton.tsx` L164~225 절대 수정 금지
2. **i18n 4개 언어 필수**: `ko/en/ja/zh` 동시 추가 (하나라도 누락 시 빌드 중지)
3. **필드 스키마**: AI 플래너 `name/display_name/tip` (CLAUDE.md §A 준수)
4. **빌드 검증**: 각 커밋 전 `tsc --noEmit` + `vite build` 성공 확인
5. **배포 검증**: 배포 직후 curl 스모크 필수

---

# 1. 🔒 리뷰 Firestore Rules 보안 테스트 보강 [P0]

## 1.1 배경

스프린트 2에서 `firestore.rules`에 reviews + reviewRewards 규칙이 추가됐으나, **`scripts/test-firestore-rules-hardening.mjs`에 reviews 케이스가 포함됐는지 불명확**. 보안 회귀 방지를 위해 테스트 스위트 보강.

## 1.2 추가 케이스 (최소 6개)

| # | 케이스 | 기대 |
|---|--------|------|
| R1 | 비로그인 → `reviews/{id}` read | ✅ PASS (공개) |
| R2 | 다른 유저 → 남의 리뷰 delete | ❌ DENY |
| R3 | 작성자 → 자기 리뷰 delete | ✅ PASS |
| R4 | 타인 → authorUid 위조하여 create | ❌ DENY |
| R5 | 사용자 → `users/{uid}/reviewRewards/{id}` write | ❌ DENY (서버 전용) |
| R6 | rating=6 으로 create | ❌ DENY (1~5 검증) |
| R7 | text 501자 create | ❌ DENY (500자 제한) |

## 1.3 실행

```bash
# 기존 패턴 확장
cp scripts/test-firestore-rules-hardening.mjs scripts/test-firestore-rules-reviews.mjs
# R1~R7 케이스 추가
node scripts/test-firestore-rules-reviews.mjs
# 기대: 7/7 PASS
```

## 1.4 완료 기준

- [ ] 신규 보안 테스트 스크립트 생성 + 커밋
- [ ] 7/7 PASS 확인
- [ ] `docs/` 하위 테스트 결과 간략 로그

---

# 2. 💳 A1 쿠폰 E2E 검증 [P0 — 사용자 의존]

## 2.1 배경

스프린트 1에서 픽스한 **Bug #2 (쿠폰 `isUsed` 마킹)** 가 프로덕션 코드에 배포됐으나, Test Mode 경로는 capture를 건너뜀 → **PayPal 샌드박스 실결제로만 검증 가능**.

## ⚠️ 사용자 필요 액션

1. PayPal 샌드박스 개인 계정 로그인 (https://www.sandbox.paypal.com/)
2. cocotripkr.com에서 샌드박스 모드 투어/플랜 결제 실행
3. 쿠폰 코드 입력 (예: `SAVE-3F2E51` 또는 `SAVE-936DD5`)
4. 결제 완료 후 AG에게 `orderId` + `userId` 전달

## 2.2 AG 검증 절차 (사용자 액션 후)

```bash
# 1. Firestore 콘솔에서 쿠폰 문서 확인
# users/{userId}/coupons/{couponDocId}
# → isUsed: true, usedAt: <timestamp> 확인

# 2. 동일 쿠폰 재사용 시도 (curl)
curl -X POST https://cocotripkr.com/api/applyPromoCode \
  -H "Content-Type: application/json" \
  -d '{"code":"SAVE-3F2E51","userId":"<uid>"}'
# 기대: error "already used"

# 3. used_paypal_orders 문서 존재 확인
# → orderId 기록 여부
```

## 2.3 완료 기준

- [ ] `isUsed: true` Firestore 확인 스크린샷
- [ ] 재사용 차단 curl 응답 증빙
- [ ] `AUDIT-2026-04-20.md` P1-1 항목 해결 완료 처리

---

# 3. 📍 earlybird/counter 문서 생성 [P1]

## 3.1 배경

감사 결과 `earlybird/counter` 문서가 Firestore에 없어 D4 보안 테스트가 404로 실패. 문서 자체가 누락 → EarlyBirdBanner 표시 로직이 fallback 경로로 동작 중일 가능성.

## 3.2 실행

```bash
# scripts/create-earlybird-counter.mjs 신규 작성
# Firebase Admin으로 초기 문서 생성:
# {
#   count: 0,
#   capacity: 100,
#   startDate: '2026-04-01',
#   endDate: '2026-12-31',
#   updatedAt: FieldValue.serverTimestamp()
# }
node scripts/create-earlybird-counter.mjs
```

## 3.3 검증

```bash
# 무인증 read 가능 확인 (Rules: earlybird public read)
curl 'https://firestore.googleapis.com/v1/projects/planning-with-ai-a0801/databases/(default)/documents/earlybird/counter'
# 기대: 200 + 문서 데이터
```

## 3.4 완료 기준

- [ ] `earlybird/counter` 문서 생성
- [ ] 프로덕션 홈페이지에서 EarlyBirdBanner 정상 렌더 확인
- [ ] 보안 테스트 D4 재실행 → PASS

---

# 4. 📸 리뷰 v2 — 사진 업로드 [P1]

## 4.1 배경

스프린트 2에서 v1 스펙이었던 사진 업로드를 v2로 연기. 사용자 리뷰 품질/신뢰도 향상 위해 이번 스프린트에서 구현.

## 4.2 설계

### Firebase Storage 경로

```
/reviews/{uid}/{reviewId}/{photoIndex}.jpg
```

### Storage Rules 추가

```
match /reviews/{uid}/{reviewId}/{photo} {
  allow read: if true;
  allow write: if request.auth != null
               && request.auth.uid == uid
               && request.resource.size < 5 * 1024 * 1024
               && request.resource.contentType.matches('image/.*');
}
```

### API 변경 (`api/reviews.js`)

- `create` action의 payload에 `photos: string[]` (Storage URL) 수용
- 최대 3장 제한 서버 검증
- Firestore `reviews/{id}.photos` 배열 저장

### 클라이언트 (`ReviewWriteModal.tsx`)

- 파일 input (multiple, accept="image/*", max 3)
- 선택 시 `uploadBytes()` → progress bar → download URL 취득
- 서버 submit 시 URL 배열로 전송
- 업로드 실패 시 리뷰는 텍스트만 제출 (사진은 optional)

### 표시 (`ReviewCard.tsx`)

- 썸네일 grid (1~3장)
- 클릭 시 라이트박스 확대 (기존 컴포넌트 재사용 여부 확인 필요)

## 4.3 i18n 추가 키

```
reviews.photoUpload: "Add photos (max 3)"
reviews.photoUploading: "Uploading..."
reviews.photoFailed: "Upload failed — review will be submitted without photos"
reviews.photoMax: "Maximum 3 photos"
reviews.photoSize: "Photos must be under 5MB"
```

→ 4개 언어 전부 반영

## 4.4 검증

- [ ] 3장 업로드 → 리뷰 카드 썸네일 렌더
- [ ] 4장 선택 시 차단
- [ ] 6MB 파일 차단
- [ ] 다른 유저 경로(`/reviews/OTHER_UID/...`) write 차단 확인 (Storage Rules 테스트)
- [ ] 모바일 사진 촬영 업로드 정상 동작

---

# 5. 📱 D2 eSIM 통합 (Airalo) [P2 — 차단]

## ⚠️ 차단 해제 조건

사용자가 다음을 AG에게 전달 시에만 착수:

1. Airalo 파트너 계정 승인 완료
2. 파트너 ID / API 키 / 제휴 링크 포맷
3. Tier 권한 (단순 제휴 링크 vs REST API 임베드)

→ 전달되면 `HANDOFF-next-sprint.md §2` 스펙 그대로 실행.

## 5.1 차단 중 가능한 사전 작업

- [ ] `EsimPromoCard.tsx` 스켈레톤 작성 (링크 URL은 placeholder)
- [ ] i18n `esim` 블록 4개 언어 추가
- [ ] GA4 `esim_click` 이벤트 핸들러 스텁
- [ ] 플랜 상세 + MyPage 배치 위치 마크업

→ 파트너 ID만 환경변수로 주입하면 즉시 활성화되는 상태로 준비.

---

# 6. 🛡️ 리뷰 v2 — 어드민 모더레이션 [P2]

## 6.1 배경

v1은 작성자/어드민 삭제만 지원. 스팸/부적절 리뷰 대응 위해 어드민 모더레이션 대시보드 필요.

## 6.2 범위

### 어드민 판별

- 이메일 `2001leety@gmail.com` 하드코딩 (기존 규칙 유지)
- `firestore.rules`의 `isAdmin()` 함수 재사용

### 대시보드 UI

- 경로: `/admin/reviews` (신규)
- 보호: 어드민 이메일 아니면 홈 redirect
- 기능:
  - `status='reported'` 필터 + 최근순 목록
  - 각 리뷰: 원본 플랜 링크, 신고 사유, 작성자 정보
  - 액션 버튼: **Keep** (`status=published`) / **Hide** (`status=hidden`) / **Delete** (완전 삭제)

### API 확장 (`api/reviews.js`)

- `moderate` action 신규:
  ```
  { action: 'moderate', reviewId, decision: 'keep'|'hide'|'delete' }
  ```
- 어드민 이메일 검증 필수

### 신고 사유 확장

현재 `report`는 status만 변경. 신고 사유 기록 필요:

```
reviews/{id}
  - reports: [{ reporterUid, reason, createdAt }]  // 배열 추가
  - status: 'reported' (조건: reports.length >= 1)
```

### 자동 필터 (경량)

- 동일 IP에서 5분 내 3개 이상 리뷰 → 자동 `status=reported`
- URL 포함 시 자동 `status=reported` (스팸 의심)

## 6.3 완료 기준

- [ ] 어드민 `/admin/reviews` 접근 가능 (본인 계정만)
- [ ] 신고된 리뷰 목록 필터 + 액션 3종 동작
- [ ] 신고 사유 Firestore 기록
- [ ] 자동 필터 트리거 확인

---

# 7. 🚫 이번 스프린트에서 하지 말 것

| 항목 | 이유 |
|------|------|
| `PayPalBookingButton.tsx` L164~225 수정 | LOCKED |
| 리뷰 Rules 완화 | v1 보안 기준 유지 |
| Airalo 링크 하드코딩 | 파트너 ID 환경변수 주입 구조 유지 |
| earlybird 규칙 write 허용 | 서버 전용 유지 |
| 어드민 이메일 다중화 | 별도 논의 필요 |

---

# 8. 📞 사용자 액션 필요 항목

| # | 항목 | 차단 해제 대상 |
|---|------|--------------|
| 1 | PayPal 샌드박스 로그인 + 결제 실행 | §2 쿠폰 E2E |
| 2 | Airalo 파트너 가입 + 정보 전달 | §5 eSIM |
| 3 | (선택) OG webp 공유 실전 테스트 | AUDIT §P2-2 |

---

# 9. 📚 관련 문서

| 문서 | 용도 |
|------|------|
| `docs/HANDOFF-session-0420-sprint2.md` | 직전 스프린트 완료 상태 |
| `docs/HANDOFF-next-sprint.md` | 스프린트 2 원본 핸드오프 (eSIM 스펙 재활용) |
| `docs/AUDIT-2026-04-20.md` | 감사 보고 (P1/P2 이월 항목) |
| `docs/HANDOFF-loyalty-phase2-3.md` | 쿠폰 E2E 배경 |
| `firestore.rules` | 현재 강화 버전 (reviews 포함) |
| `scripts/test-firestore-rules-hardening.mjs` | 기존 보안 테스트 베이스 |

---

# 10. 🎬 AG 실행 시작 체크리스트

```bash
# 0. 브랜치 확인
git status
git log --oneline -5   # 3cb4d3f가 HEAD 여야 함

# 1. 베이스라인
npm run build
npm audit --audit-level=critical   # 0 기대

# 2. 프로덕션 스모크
curl -I https://cocotripkr.com
curl -X POST https://cocotripkr.com/api/reviews -d '{}'   # 400/405 기대

# 3. Firestore 접근 확인
node -e "require('firebase-admin').initializeApp;"
```

전부 정상이면 → **§1 리뷰 Rules 보안 테스트부터 착수**.

---

**작성**: 2026-04-21
**현재 커밋**: `3cb4d3f`
**예상 커밋 수**: 최소 5개 (Rules test + earlybird + 사진 업로드 2~3분할 + 어드민)
