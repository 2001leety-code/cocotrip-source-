# 🔎 프로젝트 전체 점검 + 잔여 E2E 검증

**작성일**: 2026-04-20 KST (세션 종료 후 잔여작업)
**프로젝트**: CocoTrip (planning-with-ai-a0801) — https://cocotripkr.com
**목적**:
1. **Part A** — 오늘(2026-04-20)까지 배포한 기능의 **미검증 경로** 실제로 돌려서 확인
2. **Part B** — 프로젝트 전체 **건강 상태 점검** (audit) + 숨은 이슈 발굴
3. **Part C** — 발견된 이슈를 **우선순위별로 리포트**

**난이도**: 🟡 중간 — 검증은 기계적이지만, audit은 광범위. 끝까지 완주하지 못해도 **Part A는 반드시** 완료.

**실행 주체**:
- AG가 할 수 있는 것: curl 검증, Firestore Console 조회, 빌드, Vercel 로그, Playwright/Preview MCP로 브라우저 자동화 가능하면 E2E, 코드 스캔
- 사용자만 할 수 있는 것: 실기기 테스트 (모바일), PayPal 개인 샌드박스 계정 로그인, 외부 SNS 도구 (Facebook Debugger)

각 단계마다 **누가 실행?** 라벨을 붙여 구분. 사용자 의존 항목은 AG가 절차만 문서화.

---

## Part A — 잔여 E2E 검증 (최우선)

### A1. Bug #2 픽스 검증 — 쿠폰 소진 (샌드박스 PayPal 결제)

**왜 중요**: 오늘 배포한 `capturePaypalOrder.js`의 `isUsed: true` 마킹 로직이 실제 PayPal 결제 플로우에서 작동하는지 미검증 상태. 작동 안 하면 **코인→쿠폰 교환이 무한 재사용 가능** → 즉시 차단 필요.

**사전 준비** (누가: 사용자):
- PayPal Sandbox Personal 계정 크리덴셜 확보 (https://developer.paypal.com → Sandbox Accounts)
- 테스트 이메일 `2001leety@gmail.com`으로 로그인 → `isSandboxAccount` 분기 확인 (TEST_ACCOUNTS 리스트)

**테스트 절차**:

| # | 단계 | 누가 | 기대 | 확인 방법 |
|---|---|---|---|---|
| 1 | 로그인 후 MyPage 접속 → 현재 잔액 / 활성 쿠폰 확인 | AG 또는 사용자 | `455 coins`, 쿠폰 `SAVE-3F2E51`, `SAVE-936DD5` 존재 | 화면 확인 |
| 2 | 활성 쿠폰 중 하나 (예: `SAVE-3F2E51`) 코드 복사 | 사용자 | Copy 버튼 작동 | 클립보드 |
| 3 | 플래너 페이지 → 간단 질문지 작성 → Quick 플랜 생성 | 사용자 | Quick 플랜 표시 | UI |
| 4 | PurchaseSection → Option A → 이메일 입력 → 프로모 코드 입력창에 `SAVE-3F2E51` 붙여넣기 | 사용자 | "Discount applied" + 할인된 KRW 표시 | UI |
| 5 | DevTools Network 탭: `applyPromoCode` 응답에 `couponDocId`, `userId`, `savedAmount` 포함 확인 | AG 가능 | 3개 필드 모두 존재 | 네트워크 페이로드 |
| 6 | "Book Now" 클릭 → PayPal 샌드박스 버튼 표시 | 사용자 | sandbox SDK 로드 (L137-141 로직) | `[PayPal SDK] loading mode: sandbox` 콘솔 |
| 7 | PayPal Sandbox 계정으로 결제 진행 → Capture 완료 | 사용자 | 결제 완료 모달 표시 | UI |
| 8 | **Firebase 콘솔 직접 확인** — `users/<uid>/coupons/<couponDocId>` 문서 | AG 가능 | `isUsed: true`, `usedAt: <timestamp>` | Firestore Console 또는 MCP |
| 9 | 같은 코드 재입력해서 할인 적용 시도 | 사용자 | `invalid_code` 에러 | UI 에러 메시지 |
| 10 | MyPage → Coupons 탭 → 해당 쿠폰이 "활성"에서 사라짐 | 사용자 | `activeCoupons` 필터 (`!isUsed`) 작동 | UI |
| 11 | Points 탭 → 이력 정합성 확인 | 사용자 | 결제 전후 이력 일치 | UI |

**AG가 Firebase 콘솔 없이 확인하는 법** (step 8):

```bash
# Admin SDK로 직접 조회 (.env.admin.local 사용)
node -e "
const admin = require('firebase-admin');
require('dotenv').config({ path: '.env.admin.local' });
admin.initializeApp({ credential: admin.credential.cert({
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\\\n/g, '\n'),
})});
admin.firestore().collection('users').doc('rLpDpgI8HffwFe7x3LVD9VfARCd2')
  .collection('coupons').get().then(snap => {
    snap.forEach(d => console.log(d.id, d.data().code, 'isUsed:', d.data().isUsed));
    process.exit(0);
  });
"
```

**Pass 조건**: step 7 직후 step 8에서 `isUsed: true` 관측.
**Fail 시**: `capturePaypalOrder.js`의 couponDocId 수신/Firestore update 로직 디버깅. Vercel Function 로그에서 `[capture] coupon marked used:` 또는 `[capture] coupon update failed:` 메시지 검색.

---

### A2. D1 공유 기능 잔여 검증

#### A2-1. OG 이미지 프리뷰 (Facebook Debugger)

**누가**: AG 가능 (WebFetch로 URL 조회)

```bash
# 1. 테스트할 공유 URL (사용자 계정의 공개 플랜)
SHARE_URL="https://cocotripkr.com/my-plans/<PUBLIC_PLAN_ID>?shared=1"

# 2. Facebook Debugger API (인증 없이 조회 가능)
curl -s "https://graph.facebook.com/v18.0/?id=${SHARE_URL}&scrape=true" \
  | jq '{title, description, image, og_type: ."og:type"}'

# 3. Open Graph 메타 태그 직접 확인
curl -s -H "User-Agent: facebookexternalhit/1.1" "${SHARE_URL}" \
  | grep -oE '<meta (property|name)="(og:|twitter:)[^"]+"[^>]+>'
```

**Pass 조건**:
- `og:title` — 플랜 제목 포함
- `og:image` — `/api/og-image?planId=...`로 시작 또는 절대 URL
- `og:description` — 플랜 설명 존재
- Twitter Card 태그 존재 (`twitter:card`, `twitter:image`)

**Fail 시**: `src/pages/PlanDetailPage/index.tsx` 또는 `index.html`의 메타 태그 삽입 로직 확인. React Helmet 사용 여부 확인.

#### A2-2. OG 이미지 실제 렌더링 확인

**누가**: AG 가능

```bash
# /api/og-image 엔드포인트 직접 호출
curl -sI "https://cocotripkr.com/api/og-image?planId=<PUBLIC_PLAN_ID>"

# 기대:
# HTTP/2 200
# content-type: image/png
# (또는 302 redirect to a CDN)
```

```bash
# 실제 이미지 바이너리 저장 + 크기 확인
curl -s "https://cocotripkr.com/api/og-image?planId=<PUBLIC_PLAN_ID>" -o /tmp/og-test.png
file /tmp/og-test.png
# 기대: PNG image data, 1200 x 630 (OG 표준)
```

**Fail 시**: `api/og-image.js`의 `@vercel/og` 런타임 설정 + 플랜 데이터 로딩 로직 점검.

#### A2-3. 모바일 Web Share API (실기기 필요)

**누가**: 사용자만 (실기기)

절차 (iOS/Android 모두):
1. cocotripkr.com에 로그인 → 플랜 상세 → Share 토글 ON
2. Share 버튼 클릭
3. OS 네이티브 공유 시트 표시되는지 확인
4. KakaoTalk / Messages / Telegram 등 앱 선택 → 실제 메시지에 링크 첨부되는지
5. 수신자 측에서 링크 클릭 → 미리보기 썸네일(OG) 표시되는지
6. 공유 후 **자동으로 +20 Trip Coins 토스트** 뜨는지 (`shareReward` i18n 작동 확인)

**AG는 Chrome DevTools Mobile Emulation으로 간접 검증만 가능** — 실제 Web Share API는 HTTPS + 사용자 제스처 요구하므로 에뮬레이터에선 완벽 재현 불가.

---

### A3. 보안 재검증 (회귀 체크)

**누가**: AG

Phase 1/2/3 배포로 Firestore Rules + API 다수 변경됐으니 기존 13 케이스 재실행:

```bash
# 기본 3 케이스
node scripts/test-firestore-rules.mjs

# 강화 10 케이스
node scripts/test-firestore-rules-hardening.mjs
```

**Pass 조건**: 13/13 PASS
**Fail 시**: 어느 케이스가 깨졌는지 파악 → D3 변경 중 어느 커밋이 원인인지 git bisect. 특히 `users/{uid}/shareRewards/{planId}` 규칙 추가가 기존 규칙에 영향 줬는지 의심.

---

### A4. 빌드 & 배포 파이프라인

**누가**: AG

```bash
# TypeScript 엄격 체크
npx tsc --noEmit

# 전체 빌드
npx tsc -b && npx vite build

# 빌드 산출물 크기 (bloat 감지)
ls -lh dist/assets/*.js dist/assets/*.css | head -20
```

**Pass 조건**: 
- `tsc --noEmit` 오류 0건
- `vite build` 성공
- 메인 JS 번들 < 1.5MB (gzipped < 500KB) — 참고치

**주의**: TS 에러 핫픽스(`7411a10`)가 이미 있었음. 재발 방지 차원에서 체크.

---

### A5. 플래너 품질 회귀 (선택)

**누가**: AG (시간 있으면)

```bash
# 5 시나리오 × Gemini 호출 (~5분)
node scripts/validate-planner.js
```

**기준치** (CLAUDE.md §E 기준):
- 총 이슈 ≤ 9건
- `bad_address_prefix` = 0
- `language_mismatch` ≤ 1
- 다양성 중복률 < 30%

**목적**: D3 배포가 AI 플래너 로직에는 영향 없어야 하지만 혹시 환경변수 변경이나 패키지 업데이트로 깨졌을 가능성 차단.

---

## Part B — 전체 프로젝트 Audit

### B1. 기능 맵 (End-to-End 사용자 여정)

**누가**: AG — 코드 리딩 + 실제 접속으로 작성

각 여정별로 (1) 진입점 (2) 거치는 컴포넌트/API (3) Firestore 경로 (4) 결제 여부 (5) **현재 작동 여부** 기록.

**필수 여정 6개**:

| # | 여정 | 진입 | 핵심 파일 | 상태 체크 |
|---|---|---|---|---|
| J1 | 홈 → 투어 둘러보기 | `/` | `sections/*`, `pages/Booking.tsx`, `tours` 컬렉션 | 페이지 로딩 + 투어 리스트 |
| J2 | 투어 예약 + PayPal | `/tours/:id` | `PayPalBookingButton`, `createPaypalOrder`, `reserve-slot` | 실결제 안 돌려도 됨 — SDK 로드만 |
| J3 | AI 플래너 생성 ($9.90) | `/planner` | `PlannerPage`, `ai-planner-full`, Gemini, Naver/ODsay | 질문지 작성 가능 여부 |
| J4 | 플랜 상세 + PDF | `/my-plans/:planId` | `PlanDetailPage`, html2canvas | PDF 다운로드 작동 |
| J5 | 플랜 공유 (D1) | Share 버튼 | `ShareButton`, `og-image`, `earn-share` | 링크 복사 + OG 작동 |
| J6 | MyPage + 로열티 (D3) | `/mypage` | `MyPage`, `useLoyalty`, `redeem-coupon` | 교환 UI + 쿠폰 발급 |

**결과물**: 6개 여정 각각에 `✅ 정상 / ⚠️ 문제 있음 / ❌ 장애` 라벨 + 발견된 이슈 짧게 기록.

### B2. API 엔드포인트 카탈로그

**누가**: AG

```bash
# /api 디렉토리 전체 엔드포인트 목록
ls api/*.js | sort
```

각 엔드포인트마다:
- **경로**: `/api/xxx`
- **메서드**: GET/POST
- **목적**: 한 줄
- **인증**: 필요/불필요
- **Firestore**: 읽음/씀/없음
- **외부 API**: Gemini / Naver / ODsay / PayPal / 없음
- **Live 확인**: `curl -sI` 상태 코드

**템플릿**:

| Path | 메서드 | 목적 | 인증 | DB | 외부 | 상태 |
|---|---|---|---|---|---|---|
| /api/ai-planner-full | POST | AI 플랜 생성 (유료) | 이메일 | W | Gemini/Naver/ODsay | ? |
| /api/ai-planner-quick | POST | 무료 Quick 플랜 | - | - | Gemini | ? |
| /api/og-image | GET | 공유용 OG 이미지 | - | R | - | ? |
| /api/loyalty | POST | 로열티 (earn/spend/earn-share/redeem-coupon) | - | RW | - | ? |
| /api/applyPromoCode | POST | 프로모/쿠폰 검증 | - | R | (환율 API) | ? |
| /api/createPaypalOrder | POST | 주문 생성 | - | W | PayPal | ? |
| /api/capturePaypalOrder | POST | 주문 capture + 쿠폰 소진 | - | W | PayPal | ? |
| /api/reserve-slot | POST | 좌석 예약 | - | W | - | ? |
| /api/check-availability | POST | 예약 가능 조회 | - | R | - | ? |
| /api/plan-delete | DELETE | 플랜 삭제 | 토큰 | W | - | ? |
| /api/plan-status | GET | 플랜 상태 조회 | - | R | - | ? |
| /api/recalc-transit | POST | 교통 시간 재계산 | - | W | Naver/ODsay | ? |
| /api/chat | POST | 챗봇 | - | W | Gemini | ? |

**실행**:
```bash
for ep in ai-planner-full ai-planner-quick og-image loyalty applyPromoCode createPaypalOrder capturePaypalOrder reserve-slot check-availability plan-delete plan-status recalc-transit chat; do
  code=$(curl -sI -o /dev/null -w "%{http_code}" "https://cocotripkr.com/api/$ep")
  echo "$ep: $code"
done
```

기대: 각 엔드포인트가 `405 Method Not Allowed` (GET으로 POST 찔렀으므로) 또는 `400`/`401` 정당한 오류 반환. `404`면 배포 누락.

### B3. Firestore 컬렉션 건강 상태

**누가**: AG (Admin SDK로 카운트 조회)

```bash
node -e "
const admin = require('firebase-admin');
// ... init with .env.admin.local
const db = admin.firestore();
const cols = ['plans', 'users', 'tours', 'availability', 'reservations', 'api_stats', 'used_paypal_orders', 'earlybird'];
(async () => {
  for (const c of cols) {
    try {
      const snap = await db.collection(c).count().get();
      console.log(c.padEnd(25), snap.data().count);
    } catch (e) { console.log(c, 'ERR', e.message); }
  }
  process.exit(0);
})();
"
```

**확인 포인트**:
- `plans` 수 (≈ 발급된 유료 플랜 수)
- `plans` 중 `isPublic: true` 비율 (공유 활성화율)
- `users` 수
- `users/<uid>/coupons` 전체 합 (쿠폰 사용자 분포)
- `used_paypal_orders` 수 (실결제 건수)
- `tours` 수 + `bookings` 서브컬렉션 합

### B4. 환경변수 감사

**누가**: AG (키 존재만 확인, 값은 안 꺼냄)

```bash
# Vercel 프로덕션 환경변수 목록 (CLI)
vercel env ls production

# 로컬 .env.admin.local 키 확인 (값 X)
grep -oE '^[A-Z_]+=' .env.admin.local | sort
```

**필수 키 체크리스트**:
- [ ] `GEMINI_API_KEY`
- [ ] `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`
- [ ] `VITE_PAYPAL_CLIENT_ID`, `VITE_PAYPAL_SANDBOX_CLIENT_ID`
- [ ] `PAYPAL_CLIENT_SECRET`, `PAYPAL_SANDBOX_CLIENT_SECRET`
- [ ] `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`
- [ ] `ODSAY_API_KEY`
- [ ] `VITE_FIREBASE_API_KEY` + 클라이언트 Firebase 설정 6종
- [ ] `VITE_GA_MEASUREMENT_ID` (= `G-PM2014XDHB`)

**발견 시 리포트**: 누락 / 오타 / 환경 분리 안 됨.

### B5. 의존성 감사

**누가**: AG

```bash
# 취약점 스캔
npm audit --production --audit-level=high

# 오래된 패키지
npm outdated

# 번들 크기 기여도 (선택)
npx vite-bundle-visualizer  # 또는 npx source-map-explorer
```

**리포트**: CVE high/critical 건수 + 1년 이상 업데이트 없는 패키지 리스트.

### B6. 숨은 버그 스캔 (정적 분석)

**누가**: AG

```bash
# TODO/FIXME/HACK 집계
grep -rn "TODO\|FIXME\|HACK\|XXX" src/ api/ \
  --include="*.ts" --include="*.tsx" --include="*.js" \
  | grep -v node_modules | wc -l

# console.log 남은 것 (프로덕션 로그 노이즈)
grep -rn "console.log" src/ \
  --include="*.ts" --include="*.tsx" \
  | grep -v "test\|spec" | wc -l

# any 타입 남용
grep -rn ": any\|<any>" src/ --include="*.ts" --include="*.tsx" | wc -l

# 하드코딩된 URL/이메일
grep -rEn "cocotripkr\.com|2001leety@gmail" src/ api/ \
  --include="*.ts" --include="*.tsx" --include="*.js" \
  | grep -v node_modules
```

**결과**: 각 지표의 숫자만 리포트. 많으면 어느 파일에 집중됐는지.

### B7. Git 상태 & 배포 일관성

**누가**: AG

```bash
git status
git log --oneline -20
git diff main origin/main

# Vercel 최근 배포 목록
vercel ls cocotripkr --limit 10

# 프로덕션이 main의 어느 커밋인지
curl -sI https://cocotripkr.com | grep -i x-vercel-id
```

**확인**: 로컬 main과 원격 main이 동기화됐는지, 오늘 커밋 3개(`2ffeb91`, `1f3a83a`, `7411a10`)가 모두 프로덕션에 배포됐는지.

---

## Part C — 발견 이슈 처리 규칙

### C1. 분류 기준

Part A/B 실행 중 발견하는 이슈를 다음 3구간으로 분류:

| 심각도 | 기준 | 처리 |
|---|---|---|
| 🔴 **P0 — 즉시** | 프로덕션 장애, 보안 구멍, 결제 오작동, 데이터 손실 가능 | **이 세션 내 픽스**. 별도 커밋, 별도 보고. |
| 🟡 **P1 — 단기** | UX 깨짐, 소수 사용자 영향, 성능 저하 | **리스트만** 만들고 별도 핸드오프. 이 세션은 audit 완주 우선. |
| 🟢 **P2 — 장기** | 코드 품질, 리팩토링, 문서, 사소한 TODO | 리스트만. 다음 다음 세션 후보. |

### C2. 출력 형식 (보고서)

**파일명**: `docs/AUDIT-2026-04-20.md` (AG가 새로 작성)

**구조**:

```markdown
# CocoTrip 전체 점검 보고서 — 2026-04-20

## 1. Part A 검증 결과 (요약)
- A1 Bug #2 샌드박스 결제: ✅/❌ + 근거
- A2 OG 프리뷰: ✅/❌ + 근거
- A3 보안 13 케이스: 13/13 또는 X/13
- A4 빌드: ✅/❌
- A5 플래너 품질: <이슈 수>

## 2. Part B Audit 요약
- 기능 맵: 6 여정 상태
- API 카탈로그: N개 엔드포인트 Live
- Firestore 문서 수 스냅샷
- 환경변수: 누락 N건
- 의존성 high/critical: N건
- TODO/console.log/any: 각 숫자

## 3. 발견 이슈 리스트
### P0 (즉시 처리 요)
- (없음 이상적)

### P1 (단기)
1. 이슈명 — 위치 — 한 줄 설명 — 예상 작업 시간

### P2 (장기)
1. ...

## 4. 다음 세션 후보 우선순위
1. P0 픽스 (있다면)
2. D2 eSIM (Airalo)
3. 리뷰 시스템 풀스택
4. P1 이슈 묶음

## 5. 현재 프로덕션 상태 (원샷 요약)
- 배포 커밋: 2ffeb91 / 1f3a83a / 7411a10
- 주요 기능 상태: <여정별 한 줄>
- 알려진 제약: <목록>
```

### C3. P0 발견 시 프로토콜

1. **즉시 중단** 다른 Part B 작업
2. 사용자에게 한 줄 보고 (툴 호출 사이 요약)
3. 원인 파악 (1-3 파일 수정 예상)
4. 픽스 → 로컬 빌드 → 배포 → 검증
5. 별도 커밋 메시지에 `fix: <issue>` prefix
6. AUDIT 보고서에 "P0 해결됨" 섹션 추가

### C4. 시간 배분 가이드

예상 총 시간: 2-3시간

| Part | 우선도 | 예상 | 끝 못 내도 OK? |
|---|---|---|---|
| A1 샌드박스 결제 | 🔴 필수 | 30분 (사용자 대기 포함) | ❌ 반드시 |
| A2 OG 프리뷰 | 🟡 중요 | 15분 | ⚠️ 기본만 |
| A3 보안 재검증 | 🔴 필수 | 5분 | ❌ |
| A4 빌드 | 🔴 필수 | 5분 | ❌ |
| A5 플래너 품질 | 🟢 선택 | 5분 (러너) | ⭕ |
| B1 기능 맵 | 🟡 중요 | 30분 | ⚠️ J1-J4만이라도 |
| B2 API 카탈로그 | 🟡 중요 | 20분 | ⚠️ curl 자동화 |
| B3 Firestore | 🟡 중요 | 10분 | ⚠️ |
| B4 환경변수 | 🟡 중요 | 10분 | ⚠️ |
| B5 의존성 | 🟢 선택 | 15분 | ⭕ |
| B6 숨은 버그 | 🟢 선택 | 15분 | ⭕ |
| B7 Git | 🔴 필수 | 5분 | ❌ |
| 보고서 작성 | 🔴 필수 | 20분 | ❌ |

**시간 부족 시 생략 순서**: A5 → B5 → B6. 나머지는 반드시.

---

## Part D — AG 실행 규칙 (재확인)

### D1. 작업 흐름

1. **선제 확인**: `docs/HANDOFF-session-0420-final.md`, `docs/HANDOFF-loyalty-phase2-3.md` 먼저 읽기 (컨텍스트)
2. **Part A 순서대로** 실행 — A1 전에 A3/A4 먼저 해도 OK (독립적)
3. A1 결과 먼저 사용자에게 단독 보고 (결제 검증은 사용자 액션 필요)
4. A2-A5 자동 가능분 AG 완료
5. **Part B 실행** — 중간 보고 없이 일괄 수행
6. **발견 이슈 전부 수집** → C2 보고서 작성
7. P0 발견 시 C3 프로토콜

### D2. 사용자 개입 포인트

- **A1 step 2-7**: 쿠폰 복사 + 결제 수동 — AG가 "대기" 상태로 들어가고 사용자 "완료 했어" 신호 대기
- **A2-3 (모바일)**: 사용자만 가능. AG는 건너뛰고 리포트에 "사용자 수동 검증 필요" 플래그
- **B4 환경변수**: Vercel CLI 로그인이 AG 환경에 없을 수 있음. 없으면 사용자에게 `vercel env ls production` 결과 붙여달라고 요청

### D3. 커밋 & PR 규칙

- P0 픽스 → 즉시 커밋 + 배포
- Part B 결과물 (AUDIT 보고서 md) → 단일 커밋: `docs: add project audit report 2026-04-20`
- 절대 금지: `git push --force` / 커밋 amend / hooks skip

### D4. 결과 전달

AG는 끝나면 다음을 **순서대로** 사용자에게 전달:

1. A1 결과 (Bug #2 실증 PASS/FAIL)
2. A2-A5 요약 (한 줄씩)
3. Part B 발견 이슈 중 P0 개수만 먼저
4. 전체 AUDIT 보고서 파일 경로 (`docs/AUDIT-2026-04-20.md`)
5. "다음 세션 1순위 제안" 한 줄

---

## Part E — 안전 규칙 재확인 (CLAUDE.md 요약)

이 세션은 주로 **읽기/검증** 작업이지만 P0 픽스 가능성이 있으므로 재확인:

1. ❌ `api/_food_index.json` 건드리지 말 것 (DB matcher 사망)
2. ❌ stop 필드 `name`/`display_name`/`tip` 외 스키마로 되돌리지 말 것
3. ❌ PDF 컨테이너 `left:-9999px` / `display:none` 절대 안 됨
4. ❌ Gemini 프롬프트에서 `"verified": true` 규칙 제거 금지
5. ❌ `PayPalBookingButton` 내부 `window.paypal.Buttons({...})` 블록 수정 금지 (LOCKED 핵심부)
6. ✅ 4개 언어 (ko/en/ja/zh) 동시 텍스트 추가
7. ✅ 필드 참조 폴백 패턴 (`stop.display_name || stop.name_en || stop.name || stop.name_ko`)

---

## Part F — 관련 문서

| 문서 | 용도 |
|---|---|
| `docs/HANDOFF-session-0420-final.md` | 이 audit의 직전 배포 최종 상태 |
| `docs/HANDOFF-loyalty-phase1.md` | Phase 1 설계 |
| `docs/HANDOFF-loyalty-phase2-3.md` | Phase 2+3 설계 |
| `docs/HANDOFF-firestore-rules-hardening.md` | 보안 강화 계획 |
| `CLAUDE.md` | 프로젝트 규칙/필드 스키마/LOCKED region |
| `scripts/test-firestore-rules.mjs` | 보안 기본 테스트 |
| `scripts/test-firestore-rules-hardening.mjs` | 보안 강화 테스트 |
| `scripts/validate-planner.js` | 플래너 품질 검증 |

---

## 결과물 체크리스트 (세션 완료 기준)

AG가 이 세션을 끝냈다고 선언하려면:

- [ ] Part A1 실증 결과 (PASS/FAIL + 증거 스크린샷 또는 콘솔 출력)
- [ ] Part A2-A5 모두 실행됨 (A5는 선택)
- [ ] Part B 7개 섹션 전부 또는 C4 시간 배분 기준의 "필수" 항목 완료
- [ ] `docs/AUDIT-2026-04-20.md` 작성 완료
- [ ] 발견 P0 이슈: 0건 또는 **모두 픽스 + 배포 + 재검증**
- [ ] 발견 P1/P2: 리스트화 (픽스 X, 리포트만)
- [ ] Git 상태 clean (의도치 않은 변경 없음)
- [ ] 사용자에게 D4 순서대로 보고 완료
