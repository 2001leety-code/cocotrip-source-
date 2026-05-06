# LINE Login (OIDC) 설정 가이드 — 운영자 콘솔 작업

대상: cocotripkr.com 의 외국인 VIP 사용자 (일본·대만·태국·인도네시아).

코드 통합은 PR 에 이미 포함됨 (`src/lib/firebase.js` + `src/components/AuthRequired.tsx`). 활성화하려면 아래 두 콘솔에서 **운영자 직접 작업** 필요. 코드는 공급자 미등록 상태에서도 graceful 메시지 ("LINE 로그인 설정이 진행 중입니다") 노출하도록 설계됨.

---

## 1단계 — LINE Developers Console (5분)

### 1-1. 가입 + Provider 생성

1. https://developers.line.biz/console/ 접속 → LINE 계정으로 로그인
2. 좌측 상단 "Create" → "Provider" 선택 → 이름: `CocoTrip` (또는 비즈니스명)

### 1-2. LINE Login Channel 생성

1. 방금 만든 Provider 선택 → "Create a new channel" → "LINE Login" 선택
2. 입력 항목:
   - **Region**: Japan
   - **Channel name**: `CocoTrip Korea Travel`
   - **Channel description**: `CocoTrip private tour & AI travel planner sign-in`
   - **App types**: Web app 체크
   - **Email**: 운영자 이메일 (Apple Privacy 동일하게 받을 주소)
   - 이용약관·개인정보 처리방침 동의
3. 생성 완료 후 **Channel ID** + **Channel secret** 메모 (다음 단계에서 사용)

### 1-3. Callback URL 등록

1. "LINE Login" 탭 진입
2. **Callback URL** 추가 — Firebase 가 이 URL 로 OAuth 응답을 받음:
   ```
   https://planning-with-ai-a0801.firebaseapp.com/__/auth/handler
   ```
   (위 도메인은 Firebase Console → Project settings → Auth domain 에서 정확한 값 복사)
3. **Save**

### 1-4. Email 권한 신청 (선택, 추천)

LINE 정책상 email scope 는 별도 심사 필요.

1. "OpenID Connect" 탭 → "Email address permission" → "Apply" 클릭
2. 사용 목적 입력 (예: "User registration and welcome coupon delivery")
3. 심사 1-3일 소요 — 승인 전엔 LINE 사용자 email 미수신 (sign-in 자체는 작동)

### 1-5. Channel publish

기본은 "Developing" 상태 (본인 계정만 로그인 가능). 정식 오픈:
1. Channel 상세 → "Status" → "Developing" → "Published" 변경
2. 외부 사용자 모두 사용 가능

---

## 2단계 — Firebase Console (3분)

### 2-1. OIDC Provider 등록

1. https://console.firebase.google.com → 프로젝트 `planning-with-ai-a0801` 선택
2. Build → Authentication → Sign-in method 탭
3. "Add new provider" → 아래로 스크롤 → **OpenID Connect**
4. 입력:
   - **Provider ID**: `oidc.line` (정확히 이 값 — 코드와 일치 필수, 소문자 `oidc.` prefix 필수)
   - **Provider name**: `LINE` (UI 표시용, 자유)
   - **Client ID**: 1-2 단계에서 받은 LINE **Channel ID**
   - **Client secret**: 1-2 단계에서 받은 LINE **Channel secret**
   - **Issuer (URL)**: `https://access.line.me`
   - "Code flow" 선택 (Implicit flow 아님)
5. **Save**

### 2-2. 인증된 도메인 확인

1. 같은 Authentication 페이지 → Settings → Authorized domains
2. `cocotripkr.com` 이 등록되어 있는지 확인 (이미 있을 것)
3. 없으면 추가

---

## 3단계 — 검증 (운영자 본인 1회)

1. Firebase Console 의 Channel 이 "Developing" 상태면 Provider 의 LINE 계정 (Channel 등록한 LINE) 으로만 로그인 가능
2. https://cocotripkr.com/mypage 접속 → "LINE으로 시작하기" 버튼 클릭
3. LINE 앱 로그인 → 권한 동의 → 자동으로 cocotripkr.com 으로 복귀
4. 성공 시:
   - Firebase Console → Authentication → Users 에 새 사용자 표시 (Provider: `oidc.line`)
   - Firestore `users/{uid}` 에 doc 생성 + `tier: 'Bronze'`, `tripCoins: 0` 등 초기화
   - PR #253 의 `/api/onboarding-coupons` 자동 호출 → 5% × 2 쿠폰 발급
   - MyPage 에 환영 토스트 ("쿠폰 2장이 발급되었습니다")

5. **Channel publish** 후 외국인 VIP 사용자 대상 정식 오픈

---

## 트러블슈팅

### 에러: `auth/operation-not-allowed`
→ Firebase Console 의 Provider ID 가 `oidc.line` 정확히 일치하는지 확인. 다른 ID 로 등록되어 있으면 코드와 mismatch.

### 에러: `auth/invalid-credential`
→ LINE Channel ID / Secret 잘못 입력. LINE Console 에서 다시 복사.

### 에러: `auth/unauthorized-domain`
→ Firebase Authorized domains 에 `cocotripkr.com` 추가 필요.

### 에러: callback URL mismatch
→ LINE Console 의 Callback URL 이 Firebase auth handler URL 과 정확히 일치하는지 확인 (대소문자, 끝 슬래시 모두).

### 사용자가 email 안 받음
→ 1-4 단계 (Email permission) 미승인 상태. LINE 심사 통과 전까지 sub-only sign-in (email null). PR #253 의 onboarding-coupons 는 email 없어도 발급 — `users/{uid}` doc 만 있으면 동작.

---

## 완료 후 메모리 업데이트 필요

운영자가 위 콘솔 작업 완료 후 알려주면:
- `MEMORY.md` 의 "외국인 sign-in 옵션" 항목 업데이트 (LINE 활성)
- `OPERATIONS.md` 에 prod 등록 일자·이슈 기록
- `project_cocotrip_session_2026-05-05_late.md` 후속 노트
