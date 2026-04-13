# CocoTrip 모바일 UX 테스트 결과
## 테스트 환경
- 디바이스: iPhone 14 Pro 에뮬레이션 (Chromium, 393×852px, 3x DPR, isMobile: true)
- 브라우저: Chromium Headless (Playwright v1.x)
- URL: https://cocotripkr.com
- 날짜: 2026-04-10
- 실행 시간: 35.4초

---

## 테스트 결과 요약

| # | 테스트 | 결과 | 스크린샷 |
|---|--------|------|----------|
| 1 | 홈페이지 로드 및 타이틀/Planner 링크 확인 | ✅ 통과 | 01-home.png |
| 2 | Planner 비인증 접근 → 로그인 화면 확인 | ✅ 통과 | 02-planner-entry.png |
| 3 | AuthRequired — 위자드 비인증 차단 확인 | ✅ 통과 | 03-step0-initial.png |
| 4 | 캘린더 gridcell 터치 영역 | ⚠️ 경고 | 04-calendar-step.png |
| 5 | 4개 언어 전환 (en/ko/ja/zh) | ⚠️ 경고 | 05-lang-*.png |
| 6 | Busan → PUS 공항 옵션 (AuthRequired) | ⚠️ 경고 | 06-busan-auth-gate.png |
| 7 | PayPal 버튼 렌더링 확인 | ⚠️ 경고 | 07-after-steps.png |
| 8 | [보안] paypalOrderId 없이 API → 403 | ✅ **PASS** | - |
| 9 | [보안] 가짜 paypalOrderId → 500 반환 | ⚠️ 주의 | - |

**통과: 4개 | 경고: 5개 | 실패: 0개**

---

## 발견된 버그 & 이슈

### 🟡 Warning — W1: 언어 파라미터 반영 미확인

**증상:** `/planner?lang=en` 등 URL 파라미터로 언어를 지정해도, 
테스트에서 "K-pop Tour", "K-pop 투어" 등 언어별 활동 텍스트가 미발견됨.

**원인:** 모든 `?lang=` URL이 `AuthRequired` 게이트에 막혀 로그인 화면만 표시됨.
로그인 화면에는 언어별 활동 버튼 텍스트가 없어서 검증 불가.

**실제 이슈 여부:** 로그인 후 `?lang=` 파라미터가 올바르게 동작하는지 
**수동 확인 필요** — 자동화 테스트로는 인증 없이 검증 불가.

**권장 조치:**
- 로그인 후 `/planner?lang=ko`, `?lang=ja`, `?lang=zh` 수동 테스트
- 또는 E2E 테스트용 테스트 계정 생성 후 Firebase Auth 목업 처리

---

### 🟡 Warning — W2: 캘린더 gridcell 미발견

**증상:** `[role="gridcell"]` 셀렉터로 캘린더 날짜 셀을 찾지 못함.

**원인:** 인증 게이트(AuthRequired)로 인해 날짜 선택 스텝까지 도달하지 못함.
(completeStep0 헬퍼 함수가 로그인 화면에서 Seoul 버튼을 못 찾아 그대로 통과)

**실제 이슈 여부:** 캘린더 터치 영역(≥36px) 자체 이슈는 미확인 상태.
로그인 후 수동 확인 필요.

---

### 🟡 Warning — W3: Busan → PUS 공항 검증 불가

**증상:** AuthRequired 게이트로 인해 Busan 선택 스텝까지 미도달.
Gimhae Airport (PUS) 옵션 표시 여부 미확인.

**권장 조치:** 로그인 후 Busan 선택 → 공항 선택 화면에서 `PUS` 항목 수동 확인.

---

### 🔶 주의 — S1: 가짜 paypalOrderId → 500 반환 (보안 검토 필요)

**증상:**
```
POST /api/ai-planner-full
Body: { paypalOrderId: "FAKE_ORDER_SECURITY_TEST_12345", ... }
Response: 500 Internal Server Error
Body: {"error":"Payment verification failed"}
```

**분석:**
- ✅ 결제 없이 플랜 생성되지 않음 (200이 아님) — 핵심 보안은 유지
- ⚠️ 500 반환은 내부 에러 노출 가능성 있음
  - PayPal API 검증 중 예외가 터짐 → 서버 내부 스택트레이스 노출 위험
  - 이상적으로는 가짜 OrderId에 **403** 반환이 적절

**권장 수정:**
```javascript
// api/ai-planner-full.js
try {
  const verified = await verifyPayPalOrder(paypalOrderId);
  if (!verified) {
    return res.status(403).json({ error: 'Invalid payment order' });
  }
} catch (err) {
  // 검증 실패 시 500 대신 403으로 처리
  return res.status(403).json({ error: 'Payment verification failed' });
}
```

---

### ✅ 통과 — 보안 핵심 검증 (Test 8)

```
POST /api/ai-planner-full  (paypalOrderId 없음)
→ 403 Forbidden
→ {"error":"Payment required","details":"PayPal order ID is missing. Please complete payment first."}
```

**결론:** paypalOrderId 없이 API 직접 호출 시 403으로 정상 차단. 핵심 보안 OK.

---

### 🟡 Warning — W4: 외부 서비스 요청 실패 (정상 범위)

테스트 실행 중 반복 발생한 네트워크 실패:
- `https://emrldtp.cc/collect` — 파트너 URL 수집 서비스 (Travelpayouts 제휴)
- `https://www.travelpayouts.com/check_auth` — 제휴 인증
- `https://firestore.googleapis.com/...` — Firebase Firestore 실시간 리스너
- `https://fonts.googleapis.com/...` — Google Fonts (일부 환경)
- `https://sentry.avs.io/...` — Sentry 에러 리포팅

**원인:** Playwright Chromium 헤드리스 모드에서 일부 외부 요청이 차단됨.
실제 사용자 브라우저 환경에서는 정상 동작할 가능성 높음.

**권장 조치:** 
- emrldtp.cc 실패는 파트너 링크 기능에 영향 — 실제 환경에서 확인 필요
- Firestore 연결 실패는 오프라인 모드 폴백이 동작하는지 확인

---

## 콘솔 에러 로그

```
Error: Error fetching partner URLs: TypeError: Failed to fetch (emrldtp.cc)
  → Travelpayouts 파트너 URL 가져오기 실패

Error: @firebase/firestore: Could not reach Cloud Firestore backend.
  → Firestore 백엔드 연결 실패, 오프라인 모드로 전환
```

---

## 네트워크 실패 목록

| URL | 원인 |
|-----|------|
| `emrldtp.cc/collect` (반복) | 파트너 트래킹 — 헤드리스에서 차단 |
| `travelpayouts.com/check_auth` | 제휴 인증 서버 |
| `firestore.googleapis.com/...` | Firebase 실시간 DB |
| `fonts.googleapis.com/...` | Google Fonts CDN |
| `sentry.avs.io/...` | Sentry 에러 수집 |
| `googleapis.com/identitytoolkit/...` | Firebase Auth |

---

## 권장 수정 사항

### 우선순위 High
1. **[보안] 가짜 paypalOrderId 500 → 403으로 수정**
   - `api/ai-planner-full.js`의 PayPal 검증 try-catch에서 에러를 500 대신 403으로 반환
   - 내부 에러 메시지가 외부에 노출되지 않도록 처리

### 우선순위 Medium
2. **E2E 테스트용 인증 처리**
   - Firebase Auth `signInWithEmailAndPassword` 또는 Custom Token으로 테스트 계정 로그인
   - 또는 `REACT_APP_SKIP_AUTH=true` 환경변수로 테스트 환경에서 AuthRequired 우회

3. **언어 전환 수동 검증**
   - 로그인 후 `/planner?lang=ja`, `?lang=zh` 접근하여 일본어/중국어 활동 텍스트 확인

### 우선순위 Low
4. **emrldtp.cc 실패 핸들링**
   - 파트너 URL 가져오기 실패 시 사용자에게 에러가 노출되지 않도록 silent catch 확인

---

## 스크린샷 목록

| 파일 | 내용 |
|------|------|
| `01-home.png` | 홈페이지 전체 (iPhone 14 Pro) |
| `02-planner-entry.png` | /planner 비인증 접근 — 로그인 화면 |
| `02b-planner-auth-state.png` | 로그인 상태 상세 |
| `03-step0-initial.png` | 위자드 차단 화면 |
| `03d-after-step0.png` | AuthRequired 차단 확인 |
| `04-calendar-step.png` | 캘린더 스텝 (인증 게이트) |
| `05-lang-en.png` | 영어 로그인 화면 |
| `05-lang-ko.png` | 한국어 로그인 화면 |
| `05-lang-ja.png` | 일본어 로그인 화면 |
| `05-lang-zh.png` | 중국어 로그인 화면 |
| `06-busan-auth-gate.png` | Busan — 인증 게이트 |
| `07-after-steps.png` | PayPal 페이로드 도달 불가 |

---

## 결론

**핵심 보안 검증 완료:**
- ✅ `paypalOrderId` 없이 AI 플랜 API 호출 → **403 차단** (정상)
- ⚠️ 가짜 `paypalOrderId` → **500 반환** (403으로 수정 권장)

**프론트엔드 UX 검증:**
- AuthRequired가 /planner, /charter, /booking, /my-plans 를 보호 중 (정상)
- E2E 자동화를 위해서는 테스트 계정 Firebase Auth 처리 필요
- 언어 전환, 캘린더 터치 영역, Busan→PUS 공항 매핑은 로그인 후 수동 검증 필요
