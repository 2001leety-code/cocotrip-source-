# 🚨 UX 치명 이슈 체크 & 수정 지시 — 2026-04-21

**작성일**: 2026-04-21
**대상**: AG (다음 세션)
**현재 커밋**: `3cb4d3f`
**긴급도**: 🔴 P0 (상용 블로커)

> 사용자가 웹 브라우저에서 실사용 중 발견한 UX 치명 결함 3건.
> **모바일은 아직 미검증 — 웹 수정 후 모바일도 반드시 동일 점검 필요.**

---

## 📋 발견된 이슈

| # | 이슈 | 플랫폼 | 심각도 |
|---|------|--------|--------|
| **BUG-1** | 플랜 생성 후 언어 변경 시 **플랜 결과 내용이 번역 안 됨** | 웹 확인됨 / 모바일 미확인 | 🔴 블로커 |
| **BUG-2** | 플랜 결과 페이지 UI 자체가 언어 전환 안 됨 | 웹 확인됨 / 모바일 미확인 | 🔴 블로커 |
| **UX-1** | 페이지 수 과다 — **호텔/비행기/차터 예약이 홈에 없음** | 웹 확인됨 / 모바일 미확인 | 🟡 정보 구조 |

---

# 🐞 BUG-1 & BUG-2: 언어 전환 실패 (통합 이슈)

## 증상

1. 한국어로 로그인
2. AI 플래너에서 플랜 생성 (결과물: 한국어)
3. 언어를 영어로 전환
4. **플랜 결과 화면의 모든 텍스트가 그대로 한국어로 남음**
   - 장소명 (`display_name`)
   - 팁 (`tip`)
   - UI 레이블 ("Day 1", "식사", "교통" 등 일부도)
5. 일본어/중국어도 동일하게 영향받을 것으로 추정 (4개 언어 모두)

## 예상 원인 분석

### Layer A — 데이터 자체가 단일 언어로 저장됨

**파일**: `api/ai-planner-full.js` L1057~1082 (Firestore save)

```javascript
// Gemini 호출 시 user language로 프롬프트 주입
// → display_name, tip이 user language로만 생성됨
// → Firestore에 단일 언어로 저장
// → 언어 스위치 시 재번역 로직 없음
```

**핵심 문제**: 플랜은 **생성 시점 언어로 freeze** 됨. `name`(한국어, 고정)을 제외한 `display_name`/`tip`은 생성 시 언어로 저장됨.

### Layer B — 플랜 상세 UI가 i18n 키를 안 씀

**파일**: `src/pages/PlanDetailPage/index.tsx` 및 하위 컴포넌트

**확인 필요 사항** (AG가 grep):
```bash
# PlanDetailPage에서 하드코딩 한국어 텍스트 찾기
grep -rn "'Day\|'식사\|'교통\|'도보\|'지하철" src/pages/PlanDetailPage/
grep -rn "t('reviews\|t('common\|t('planner" src/pages/PlanDetailPage/
```

기대: 모든 사용자 노출 문자열이 `t('key')` 호출이어야 함. 누락된 하드코딩 텍스트 = BUG-2 원흉.

## 🔧 해결 방안 (3단계)

### 🟢 Fix 1 (즉시 — 하드코딩 UI 번역)

**적용 범위**: `PlanDetailPage/` + 모든 하위 컴포넌트

**작업**:
1. 모든 하드코딩 한국어/영어 문자열 추출
2. `src/i18n/index.ts`에 `planDetail` 블록 신규 추가 (4개 언어)
3. 컴포넌트에서 `t('planDetail.day')` 등으로 치환

**예상 키 목록**:
```
planDetail.day            "Day {n}"
planDetail.meal           "Meal"
planDetail.transit        "Transit"
planDetail.walk           "Walk"
planDetail.subway         "Subway"
planDetail.bus            "Bus"
planDetail.taxi           "Taxi"
planDetail.duration       "{min} min"
planDetail.tip            "Tip"
planDetail.tmoney         "T-money fare"
planDetail.totalCost      "Total cost"
planDetail.downloadPdf    "Download PDF"
planDetail.share          "Share plan"
planDetail.editPlan       "Edit plan"
planDetail.backToPlans    "Back to my plans"
```

4개 언어 (`ko`/`en`/`ja`/`zh`) 동시 추가 필수.

### 🟡 Fix 2 (단기 — 데이터 다국어화)

**핵심 결정**: 플랜 `display_name` / `tip` 필드를 어떻게 다국어화할 것인가?

#### 옵션 A: 생성 시점 4개 언어 동시 생성
```javascript
// Gemini 프롬프트 수정
"display_name": {
  "ko": "경복궁",
  "en": "Gyeongbokgung Palace",
  "ja": "景福宮",
  "zh": "景福宫"
},
"tip": {
  "ko": "...",
  "en": "...",
  ...
}
```

**장단점**:
- ✅ 전환 속도 즉각
- ❌ Gemini 호출 비용 증가 (토큰 ~4배), 생성 시간 증가
- ❌ 기존 플랜 마이그레이션 필요

#### 옵션 B: 전환 시점 온디맨드 번역
```javascript
// 언어 전환 시 → 번역 API 호출 (Gemini or Google Translate)
// → 번역 결과 Firestore에 캐시 저장 (plan.translations[lang])
// → 다음 전환부터 캐시 사용
```

**장단점**:
- ✅ 기존 플랜도 자동 커버
- ✅ 호출 필요할 때만 발생
- ❌ 첫 전환 시 지연 (2~5초)
- ❌ 번역 API 비용 별도

#### 옵션 C: 한국어(`name`) + 유저 언어 표시명 분리 유지 + 클라 번역
```javascript
// display_name은 '현재 보는 사용자의 언어' 로 간주
// 전환 시 → name(한국어)을 기준으로 translation API 호출
// → 즉시 결과에 반영, 비영구 (메모리 상에서만)
```

**장단점**:
- ✅ DB 스키마 변경 없음
- ❌ 매 전환마다 API 호출

**권장**: **옵션 B** — 캐시 기반, 비용 효율, 기존 플랜 호환.

### 🔴 Fix 3 (중기 — 기존 플랜 마이그레이션)

옵션 A/B 선택 시 기존 Firestore 플랜 문서들의 마이그레이션 스크립트 필요:

```bash
scripts/migrate-plans-i18n.mjs
# 1. plans 컬렉션 전체 조회
# 2. 각 플랜의 display_name/tip을 Gemini로 4개 언어 일괄 번역
# 3. plan.translations 객체로 저장
```

## 검증 체크리스트

- [ ] 한국어로 플랜 생성 → 영어 전환 → **모든** 텍스트 영어 확인
- [ ] 한국어로 플랜 생성 → 일본어 전환 → 일본어 확인
- [ ] 한국어로 플랜 생성 → 중국어 전환 → 중국어 확인
- [ ] 영어로 플랜 생성 → 한국어 전환 → 한국어 확인
- [ ] 기존 플랜(마이그레이션 전) 조회 시 fallback 정상 동작
- [ ] 네이버 지도 검색 링크는 여전히 한국어(`name`) 사용 확인
- [ ] PDF 다운로드 시 현재 언어로 렌더 확인

## 영향 범위

| 파일 | 수정 |
|------|------|
| `api/ai-planner-full.js` | 프롬프트 다국어화 (옵션 A 선택 시) |
| `api/translate-plan.js` (신규) | 온디맨드 번역 API (옵션 B 선택 시) |
| `src/pages/PlanDetailPage/index.tsx` | i18n 키 치환 |
| `src/pages/PlanDetailPage/components/*.tsx` | 하위 컴포넌트 전부 i18n 적용 |
| `src/i18n/index.ts` | `planDetail` 블록 신규 (4개 언어) |
| `src/types/plan.ts` | `translations?: {ko, en, ja, zh}` 필드 추가 |
| `scripts/migrate-plans-i18n.mjs` | 기존 플랜 마이그레이션 |
| `firestore.rules` | 쓰기 권한 재확인 (translations 쓰기는 서버만) |

---

# 🗺️ UX-1: 정보 구조 재설계

## 사용자 피드백 요약

> "페이지가 너무 많아 보기 힘들다.
> **호텔 / 비행기 / 차터 예약이 첫 페이지에 있어야** 하고,
> 나머지는 결과값으로 알려줘야 한다."

## 현재 페이지 맵 (`src/App.tsx` L140~216)

```
/                    HomePage
/region/:regionId    RegionDetail
/booking             Booking
/charter             CharterPage           ← 별도 페이지
/planner             PlannerPage
/tours               ToursPage
/tours/:slug         TourDetailPage
/about               About
/terms               Terms
/privacy             Privacy
/travel-terms        TravelTerms
/mypage              MyPage
/my-plans            MyPlansPage
/my-plans/:planId    PlanDetailPage
/admin               Admin
/admin/reviews       AdminReviews
```

총 **16개 라우트** — 사용자가 "너무 많다" 라 느낄 만함.

## 핵심 의도 해석

사용자 의도를 추정하면 **홈의 역할**을 다음처럼 재정의하고자 함:

```
┌─────────────── Home (/) ───────────────┐
│  [히어로: K여행 시작하기]                  │
│                                         │
│  ┌─────┐ ┌─────┐ ┌─────┐               │
│  │호텔  │ │비행기│ │차터  │  ← 첫 페이지 CTA 3개
│  └─────┘ └─────┘ └─────┘               │
│                                         │
│  ┌─────┐ ┌─────┐                       │
│  │투어  │ │플래너│  ← 보조 CTA           │
│  └─────┘ └─────┘                       │
│                                         │
│  [About / 리뷰 / 갤러리]  ← 스크롤 아래    │
└────────────────────────────────────────┘
```

그리고 **"나머지는 결과값으로"** = 사용자가 홈에서 선택 → 각 기능이 **결과/추천** 형태로 나타남.

## 🎯 구체적 지시

### ① 호텔 / 비행기 섹션 **신규 추가**

현재 홈에 **차터는 링크가 있을 수 있으나 호텔/비행기 섹션이 부재**.

**신규 컴포넌트**:
- `src/sections/HotelCTA.tsx` — 호텔 예약 진입 카드 (Booking.com/Agoda 링크 or 자체 페이지)
- `src/sections/FlightCTA.tsx` — 항공권 예약 진입 카드 (Skyscanner affiliate link)

**홈 레이아웃 조정**:
- `src/pages/HomePage.tsx` (또는 HomePage 구성 섹션)
- 히어로 바로 아래 3-card grid: `HotelCTA` + `FlightCTA` + `CharterCTA`
- 모바일: vertical stack, 데스크톱: 3-column

### ② 차터 섹션 통합 검토

`CharterPage` 독립 라우트 유지하되, **홈에서의 진입을 강화** (카드 강조).

### ③ 결과/추천 중심으로 전환

현재 `/tours`, `/region/:id`, `/planner` 등이 독립 페이지로 흩어져 있음.

**재구조 제안**:
- 홈에 "지역 선택" 드롭다운 → 결과가 홈 하단에 렌더 (페이지 이동 없이)
- 호텔/비행기 선택 → 결과 섹션에 추천 카드 표시
- 투어 선택 → 마찬가지 인라인 결과

**이건 큰 리팩터**이므로 단계적 실행 권장 (§ 단계별 실행 참조).

## 단계별 실행 플랜

### Phase 1 (P0 — 즉시)
- [ ] 홈 히어로 아래 **3-card CTA** (호텔/비행기/차터) 추가
- [ ] 호텔/비행기 링크는 우선 **affiliate 외부 링크** (Booking.com, Skyscanner)
- [ ] 4개 언어 i18n 적용

### Phase 2 (P1 — 1~2주)
- [ ] 자체 호텔 검색 UI (외부 API 프록시)
- [ ] 자체 항공권 검색 UI
- [ ] 홈 하단에 "추천 투어" / "인기 플랜" 결과 카드 표시

### Phase 3 (P2 — 1개월)
- [ ] 지역 선택 인라인 결과
- [ ] 라우트 통폐합 (about/terms/privacy를 footer 모달로 이동)
- [ ] 모바일 홈 UX 전용 개선

## 레퍼런스 (사용자 공유 시 업데이트)

현재 없음. 사용자에게 목표 스타일의 레퍼런스 사이트(Klook/KKday/Trip.com 등) 확인 요청 권장.

---

# 📱 모바일 미검증 — 전체 재확인 체크리스트

사용자가 "웹만 확인했고 모바일은 미확인" 명시. **웹 수정 후 모바일에서 동일 이슈 재현 여부 확인 필수**.

## 모바일 테스트 시나리오

### 언어 전환 (BUG-1, BUG-2)
- [ ] 모바일 Chrome/Safari에서 한국어 플랜 생성
- [ ] 언어 스위처 열림 (`Header.tsx` 모바일 메뉴)
- [ ] 영어로 전환 → 플랜 결과 번역 확인
- [ ] 일본어/중국어 동일 확인
- [ ] 결과 UI (버튼/레이블) 번역 확인

### 정보 구조 (UX-1)
- [ ] 모바일 홈에서 호텔/비행기/차터 진입 경로 명확한지
- [ ] 3-card CTA 모바일 vertical stack 정상 렌더
- [ ] `MobileBottomNav.tsx` 메뉴에 호텔/비행기 포함 여부 결정
- [ ] 터치 영역 최소 44×44px 확보 확인

### 플랜 상세 페이지 모바일 특화
- [ ] PDF 다운로드 모바일 작동 (iOS Safari 제약 확인)
- [ ] 공유 버튼 모바일 네이티브 share sheet 작동
- [ ] 네이버 지도 링크 모바일 앱 연결 여부

## 테스트 기기 권장

- iPhone Safari (iOS 17+)
- Android Chrome (최신)
- iPad Safari (tablet breakpoint)

---

# 📂 모바일 우선 개발 전환 정책 (사용자 요청)

사용자가 **"모바일 먼저 기능 적용하고 웹에 적용"** 하고자 함. 이를 위한 원칙:

## 개발 순서 규칙 (스프린트 4부터 적용)

```
1. 기능 설계
   ↓
2. 모바일 UI 먼저 구현 (<768px)
   ↓
3. 모바일 브라우저 실사용 검증
   ↓
4. 데스크톱 UI 별도 커밋 (≥768px)
   ↓
5. 데스크톱 검증
   ↓
6. 통합 배포
```

## 커밋 메시지 컨벤션

```
feat(mobile): add hotel booking CTA on home
feat(desktop): apply hotel CTA desktop layout
fix(mobile): plan detail language switch
```

## 모바일 우선 컴포넌트 패턴

```tsx
// MOBILE FIRST — default styles = mobile
<div className="flex flex-col gap-4 p-4
                md:flex-row md:gap-8 md:p-8">
  {/* ... */}
</div>
```

**금지**: 데스크톱 기본 스타일 + `md:` 아래로 내려가는 패턴 (현재 일부 존재).

---

# 🎯 이번 세션 AG 실행 순서

```
① BUG-1, BUG-2 원인 정밀 진단
   - PlanDetailPage 구성 파일 전부 확인
   - i18n 키 누락 지점 추출
   - Firestore 저장 구조 확인 → 옵션 A/B/C 결정

② Fix 1 (하드코딩 i18n 치환) 즉시 실행
   - planDetail 블록 4개 언어 추가
   - 모든 t() 호출 치환
   - 커밋: "fix(i18n): translate PlanDetailPage hardcoded strings"

③ Fix 2 옵션 결정
   - 사용자에게 옵션 A/B/C 중 선택 요청
   - 선택된 옵션으로 데이터 다국어화 구현

④ UX-1 Phase 1 (3-card CTA) 구현
   - 모바일 먼저 → 데스크톱 순서
   - 호텔/비행기는 affiliate 링크 우선
   - 커밋 분리

⑤ 모바일 동일 이슈 재확인
   - BUG-1/BUG-2 모바일 재현 테스트
   - UX-1 모바일 레이아웃 확인

⑥ 4-lang 검증 + 배포
```

---

# 📞 사용자에게 확인 요청할 항목

AG가 자율 판단 불가, **사용자 확답 필요**:

| # | 질문 |
|---|------|
| Q1 | Fix 2 옵션 선택: A(생성시 4개 언어) / B(온디맨드+캐시) / C(매번 번역) |
| Q2 | 호텔/비행기 affiliate 파트너 결정: Booking.com / Agoda / Skyscanner / Expedia |
| Q3 | 라우트 통폐합 범위: about/terms/privacy를 모달화 해도 되는지 |
| Q4 | 모바일 먼저 개발 시 예상 기간 2배 증가 수용 여부 |
| Q5 | 기존 플랜 마이그레이션 시 Gemini 호출 비용 (플랜당 ~$0.01) 승인 |

---

# 📚 관련 문서

| 문서 | 용도 |
|------|------|
| `CLAUDE.md §B-2` | 필드명 스키마 (`name`/`display_name`/`tip`) |
| `CLAUDE.md §C` | 폴백 패턴 (`display_name || name_en || name`) |
| `CLAUDE.md §E` | 4-lang i18n 필수 규칙 |
| `docs/ROADMAP-ALL-PENDING.md` | 전체 잔여 작업 (이 이슈 P0 상단 추가 필요) |
| `docs/HANDOFF-next-sprint-3.md` | 스프린트 3 지시 (본 이슈로 우선순위 재조정) |
| `src/i18n/index.ts` | 4개 언어 번역 소스 |

---

# ✅ 완료 기준

- [ ] BUG-1 해결: 플랜 결과 내용 언어 전환 즉시 반영
- [ ] BUG-2 해결: 플랜 결과 UI 레이블 전부 i18n 적용
- [ ] 4개 언어 전부 작동 확인 (ko↔en↔ja↔zh)
- [ ] UX-1 Phase 1: 홈에 호텔/비행기/차터 3-card CTA 배포
- [ ] 모바일 동일 시나리오 재검증 완료
- [ ] `tsc --noEmit` + `vite build` 에러 0
- [ ] 프로덕션 스모크: 기존 플랜 열람 시 fallback 정상

---

**작성**: 2026-04-21
**현재 커밋**: `3cb4d3f`
**예상 커밋**: 최소 5~7개 (Fix 1 1~2커밋 + Fix 2 3~4커밋 + UX-1 2~3커밋)
**긴급도**: 상용 전 반드시 해결
