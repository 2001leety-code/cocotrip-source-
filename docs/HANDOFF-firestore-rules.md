# 🔐 Firestore Rules 배포 핸드오프 문서

**작성일**: 2026-04-20 13:59 KST  
**프로젝트**: `planning-with-ai-a0801` (CocoTrip)  
**작업 목적**: 바이럴 소셜 공유 기능을 위한 Firestore 보안 규칙 업데이트  

---

## 1. 무엇을 했는가

### 변경 내용

`firestore.rules` 파일에 **`isPublic == true` 조건 1줄 추가** 후 프로덕션 배포 완료.

```diff
  match /plans/{planId} {
    allow read: if resource.data.uid == null
+              || resource.data.isPublic == true
               || (request.auth != null && resource.data.uid == request.auth.uid);
    allow write: if false;
  }
```

**목적**: `isPublic: true`인 플랜을 **비로그인 사용자**도 읽을 수 있게 허용 → 공유 링크(`/my-plans/{planId}?shared=1`) 동작 지원.

### 배포 명령

```bash
firebase deploy --only firestore:rules --project planning-with-ai-a0801
```

- Firebase CLI 15.11.0
- 배포 시각: 2026-04-20 13:47 KST
- 결과: `Deploy complete!`

### 백업

- 파일: `firestore.rules.backup` (프로젝트 루트)
- 방법: MCP `firebase_get_security_rules`로 배포 전 운영 규칙 캡처
- CLI의 `firestore:rules:get` 명령은 존재하지 않음 (Firebase CLI 15.x)

---

## 2. 검증 결과

Node.js 스크립트(`scripts/test-firestore-rules.mjs`)로 Firestore REST API 직접 호출하여 3개 케이스 검증:

| 케이스 | 설명 | HTTP 응답 | 결과 |
|--------|------|-----------|------|
| **A** | Admin JWT 토큰으로 플랜 읽기 | `200 OK` | ✅ PASS |
| **B** | `isPublic: true` 설정 → 비인증 접근 | `200 OK` | ✅ PASS |
| **C** | `isPublic: false` 설정 → 비인증 접근 | `403 Forbidden` | ✅ PASS |

테스트 대상 플랜: `030b094b-a4e4-477a-9d28-651b572684ed`

---

## 3. 현재 Firestore 규칙 전문

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
      allow read, write: if request.auth != null;
    }
  }
}
```

### plans 컬렉션 읽기 조건 해석

| 조건 | 의미 |
|------|------|
| `resource.data.uid == null` | Guest 플랜 (로그인 없이 생성된 플랜) → 누구나 읽기 가능 |
| `resource.data.isPublic == true` | 공유용 공개 플랜 → 비로그인도 읽기 가능 |
| `request.auth != null && uid == auth.uid` | 본인 플랜 → 소유자만 읽기 가능 |

**write**: 모든 plans 문서에 대해 `false` (서버 API만 쓰기 가능)

---

## 4. 클라이언트 PII 마스킹

`src/pages/PlanDetailPage/index.tsx` (L78-88)에서 **공개 플랜 비소유자 접근 시** 다음 필드를 삭제:

```javascript
// PII masking for non-owner viewing public plan
if (isPublicShared && !ownerCheck && !hasToken && !isGuestPlan) {
  delete data.uid;
  delete data.guestEmail;
  delete data.accessToken;
  if (data.input) {
    delete data.input.specialRequest;
    delete data.input.hotel_address;
    delete data.input.arrival_airport;
    delete data.input.departure_airport;
  }
  delete data.pricing;
}
```

> ⚠️ **주의**: 이 마스킹은 **클라이언트 전용**. Firestore 규칙 자체는 문서 전체를 반환함. REST API를 직접 호출하면 PII가 포함됨. 장기적으로 Cloud Functions 프록시나 규칙 수준 필드 제어 검토 필요.

---

## 5. 알려진 이슈 2건

### 이슈 1: catch-all 규칙과의 상호작용

```
match /{document=**} {
  allow read, write: if request.auth != null;
}
```

- **현상**: 로그인한 사용자 A가 사용자 B의 `isPublic: false` 플랜도 읽기 가능
- **이유**: Firestore 규칙은 OR 기반 — catch-all이 `auth != null`이면 통과
- **영향**: 비인증 접근만 차단됨 (공유 링크의 주요 위협 모델은 커버)
- **심각도**: ⚠️ 중간
- **해결 방향**: catch-all에서 plans 제외하거나, plans 전용 세분화 규칙 적용

### 이슈 2: PII가 Firestore 응답에 포함

- **현상**: REST API 직접 호출 시 uid, pricing 등 포함
- **완화**: 비인증 사용자는 Firestore SDK로만 접근 (REST API 직접 호출 비현실적)
- **심각도**: ⚡ 낮음

---

## 6. 롤백 절차

문제 발생 시 즉시 실행:

```powershell
copy firestore.rules.backup firestore.rules
firebase deploy --only firestore:rules --project planning-with-ai-a0801
```

---

## 7. 관련 파일 목록

| 파일 | 용도 |
|------|------|
| `firestore.rules` | 현재 운영 중인 규칙 |
| `firestore.rules.backup` | 배포 전 백업 (isPublic 조건 없는 버전) |
| `scripts/test-firestore-rules.mjs` | 3개 케이스 자동 검증 스크립트 |
| `src/pages/PlanDetailPage/index.tsx` | 클라이언트 접근 제어 + PII 마스킹 |
| `src/pages/PlanDetailPage/components/ShareButton.tsx` | 공유 링크 생성 |
| `.env.admin.local` | Admin SDK 인증 정보 (절대 커밋 금지) |

---

## 8. 다음 단계 (미완료)

1. **ShareButton 통합 테스트** — 실제 사용자가 공유 버튼 클릭 → isPublic 토글 → 공유 링크 복사 → 시크릿 창에서 열기 E2E 검증
2. **OG Image 서버리스 함수** — `api/og-image` Vercel Edge Function 배포
3. **GA4 share_click / share_visit 이벤트** — 공유 퍼널 트래킹 확인
4. **catch-all 규칙 세분화** — 보안 강화 (별도 태스크)
