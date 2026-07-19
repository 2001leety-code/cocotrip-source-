# CocoTrip 모바일 UI 리디자인 계획서 (2026-07-19)

> 목표: 기준 이미지 10장(`C:\Users\dlxod\Desktop\CocoTrip_UIUX_이미지_10장`)의 디자인 언어로
> 운영 모바일 UI를 통일. 전체 유사도 76% → 90%+, 디자인 통일성 95%+.
> 기능·데이터 연결 보존, 390×844 / 430×932 무결점, 실동작 화면.

**아키텍처 요약:** 기존 라이트 셸(`cocotrip-mobile-*`) + CocoUI(COCO 팔레트)를 단일
디자인 토큰 SSOT로 승격하고, 화면별로 흩어진 인라인 그라디언트·카드 스타일을
공용 컴포넌트로 수렴. 신규 화면은 Map·Assistant 2개만 추가(둘 다 기존 기능 재사용).

**기술 스택:** React 18 + Vite + TS, react-router v6, Tailwind + CSS 변수, Leaflet, Firebase.

---

## 0. 전역 제약 (모든 작업에 적용)

| 제약 | 내용 |
|---|---|
| 브랜치 | 웹 레포(`E:\ai에이젼시만들기\홈페이지 클로드ai\홈페이지 사이트 최근`)에서 신규 브랜치 `feature/mobile-ui-uniform-20260719`. main 직접 작업·푸시 금지. |
| 커밋 | **파일 단위 add만** — 레포 루트에 untracked 인계문서 15개+(`PAYMENT_*.md` 등) 존재. `git add -A` / `git add .` 절대 금지. |
| 결제 불가침 | `PayPalBookingButton.tsx`(주문 생성·capture·쿠폰 게이트 로직), `charterPricing.ts` 가격 계산, `pricing_spec.json` 수정 금지. 표시 스타일(className)만 허용. 실결제 실행 금지. |
| 신규 코드 | `??` 금지 → `\|\|` 사용. |
| 별점 | SAFETY 게이트 유지 — `VITE_FEATURE_REAL_TOUR_RATINGS` 미정의(OFF), 실 리뷰 집계 있을 때만 별 노출. 가짜 별점 신설 금지. |
| 취소정책 | 기준 이미지 8장의 "48 hours" 문구 **복제 금지** — 실정책은 24h 바이너리(PR#1116). 완료 화면 정책 카드는 실정책 문구 사용. |
| i18n | 사용자 노출 문구는 4언어(en/ko/ja/zh) 키 추가. lint 통과 필수. |
| 죽은 탭 금지 | `MobileBottomNav.tsx:19` 명문 원칙. Map·Assistant 탭은 실동작 화면 구현 후에만 추가. |
| 번들 | size 게이트 120KB 준수. 신규 무거운 라이브러리 추가 금지(지도는 기존 Leaflet 재사용). |
| 빌드 검증 | `npm run build`(tsc -b 포함)만 신뢰. `tsc --noEmit`은 no-op 함정. E: 실경로에서 빌드. |
| 타입 | visual baseline CI: 실패 런의 `-actual.png` 아티팩트 승격으로 재생성(자동 통과 no-op 함정 주의). |
| 문구·구조 | 기준 이미지는 16:9 설명 자료 — 외곽 레이아웃 복제 금지, 내부 모바일 화면 요소만 이식. |

---

## 1. 조사 결과 — 현재 상태 (2026-07-19 실측)

### 1-1. 레포 상태
- 웹 레포 현재 `main` 체크아웃, 클린(untracked 인계문서 제외). 최근 머지 #1140~#1144.
- 실 서비스 진입점: `/`(홈) `/planner` `/tours` `/tours/:slug` `/charter` `/my-plans` `/my-plans/:planId` `/mypage` `/community` `/s/:id`.

### 1-2. 디자인 토큰 — 3벌로 분열 (통일성 점수 하락 주범 #1)
| 원천 | 값 | 소비처 |
|---|---|---|
| `src/components/coco/CocoUI.tsx:9-22` COCO 객체 | purple `#7C5CFF`, pink `#FF6DB7`, CTA `linear-gradient(100deg,#7C5CFF→#FF5FC8)`, navy `#0F1230` | MobileHomeV2만 |
| `src/index.css:134-198` CSS 변수(다크 기준) | brand-purple `#7c3aed`, brand-pink `#ec4899` | 데스크톱·구화면 다수 |
| 위자드/차터 인라인 | 모바일 `#B668FC→#FF6B9D`, 데스크톱 `#7C5CFC→#EA537E` | WizardNav, 위자드 진행바 등 |

- 공용 컴포넌트 `GradientCTA`/`StatusChip`/`CocoCard`(CocoUI.tsx) 존재하나 소비처가 사실상 MobileHomeV2뿐.
- 라이트 셸 메커니즘: 페이지 루트에 `cocotrip-mobile-{home,charter,tours,tour-detail,account,plans}` 클래스 → `index.css:3455-3473`이 모바일에서 라이트 그라디언트로 덮어씀. 플래너 계열은 별도(`planner-mobile-ai`, `planner-detail-mobile-ai`).

### 1-3. 하단 네비
- 전역 `MobileBottomNav.tsx`: 홈·투어·AI플래너·예약·마이 5탭. 커뮤니티·공유플랜에서 숨김.
- 커뮤니티는 자체 5탭(`CommunityRail`: Feed/Explore/Post/Alerts/Profile) — **2벌 존재**.
- Map·Assistant 탭: 화면이 없어 의도적 미추가(죽은 탭 금지). Charter 탭: 운영자 결정으로 제거(7/12).

### 1-4. 화면별 현황 vs 기준 이미지
| 기준 이미지 | 현재 구현 | 주요 갭 |
|---|---|---|
| 1·2장 홈 | `MobileHomeV2`(플래그/`?v2`) — 라이트, 퀵액션·Smart Picks 구현 | V2 플래그 상태 확인 필요. 프로모 배너 라이트 스킨 미착수(체크리스트 L24). 히어로 도시카드+날씨칩 없음 |
| 3장 위자드 | `WizardForm` 5단계(예약상태→도시·관심사→식단→세부→검토) | 진행바는 그라디언트 바+pill — 기준의 점·체크 스테퍼와 다름. 그라디언트 색 불일치(#B668FC 계열). 단계 구성 자체는 유지(기능 보존) |
| 4장 일정 결과 | `PlanDetailPage` 슬라이드(intro→day…→preTrip→outro)+섹션탭 | **본문 슬라이드가 다크 공용, 모바일 히어로만 라이트 — 혼재**. 개요 통계칩 일부(km·최적화) 없음. 로딩/에러 상태 다크 하드코딩 |
| 5장 힘든 이동 | `RouteInsightCard`(항상 ON)+`CharterCTA`(조건부)+지도 앰버 점선 — **3중 동선 이미 존재** | 스타일이 기준 경고카드·CTA와 다름. `TransitVsCharterCard`는 플래그 OFF |
| 6장 차터 6단계 | `CharterWizard` 6단계 — 순서는 출발지→서비스→목적지→차량→날짜+연락처→견적 (기준과 순서 다름, 연락처가 5단계 통합) | 순서 재배열은 견적 로직 회귀 위험 큼 → **순서 유지, 시각만 통일** 결정 |
| 7장 투어 | `ToursPage` 검색+지역/시간/관심사/언어/pace 필터, `TourCard`, `TourInquireModal` | 카드 이미지 고정 h-136px(비율 아님), 필터 UI가 기준의 칩 그리드와 다름 |
| 8장 예약 | 투어 2스텝 다이얼로그→`BookingInfoForm`→PayPal 버튼 내부 쿠폰→**인라인 성공 화면**(별도 페이지 없음) | 성공 화면이 기준의 Booking Confirmed 카드(번호·상태·정책·CTA)와 다름. 쿠폰 피커는 `FEATURE_DISCOUNT_V2` 게이트 |
| 9장 커뮤니티 | 실 Firestore 4타입 피드+Gemini 원탭 번역+사진 3장+빈 상태+자체 네비 — 기능 완비 | 카드·언어배지·번역 카드 스타일, 작성 폼 구조가 기준과 다름 |
| 10장 컴포넌트 | GradientCTA/StatusChip 있음, WeatherChip·PlannerSummaryCard 등 명칭 컴포넌트는 없음 | 토큰 3벌 분열이 본질 갭 |

### 1-5. 다크/검은 화면 (우선 항목 9)
| 화면 | 접근성 | 처리 방침 |
|---|---|---|
| `/preview/mobile-*` 4종 + icons (V2 목업) | 라우터 연결, 네비 미노출 | **`import.meta.env.DEV` 게이트로 prod 제외** — 운영 경로 혼동 차단 |
| `SharedCoursePage`(`/s/:id`) | 공개 접근, 다크 | 모바일 라이트 셸 적용 |
| `NotFoundPage`(404) | 공개 접근, 다크 | 모바일 라이트 적용 |
| `PlanDetailPage` 로딩/에러 상태 | 공개 접근, 다크 하드코딩 | 모바일 라이트 적용 |
| 데스크톱 전 페이지 다크 | 의도적 디자인 | **이번 범위 제외**(모바일 우선. 데스크톱 회귀 없게 모바일 분기 내에서만 수정) |
| `/admin/*` 다크 | 운영자 전용 | 범위 제외 |

### 1-6. AI Assistant 후보
- `ChatWidget.tsx`(828줄): AI(`/api/chat`)+운영자 라이브채팅 혼합 플로팅 위젯 — **전용 화면으로 승격 가능한 실기능**.

---

## 2. 핵심 설계 결정

### 결정 1 — 하단 네비 (⚠️ 운영자 확인 1건 포함)
기준 이미지 10장 최종안: Plan · Map · Assistant · Bookings · Profile.
죽은 탭 금지 원칙에 따라 Map·Assistant는 실화면을 먼저 만든다(아래 Task 2·3).

- **A안 (기준 충실)**: Plan(`/planner`) · Map(`/map` 신설) · Assistant(`/assistant` 신설) · Bookings(`/my-plans`) · Profile(`/mypage`). 홈은 로고 탭/헤더로 접근, 투어는 홈 퀵액션·Plan 결과 연계로 접근.
  - 리스크: **홈·투어 탭 제거 = 주 매출 동선(투어) 이탈 위험**. 전환 감사에서 투어가 핵심 CTA였음.
- **B안 (절충, 추천)**: 홈 · 투어 · AI Plan(중앙 강조) · Bookings · Profile 유지 + 스타일만 기준 이미지로 통일. Map·Assistant 화면은 신설하되 홈 퀵액션(기준 1장의 Quick Actions 행)과 플로팅 버튼으로 연결.
  - 근거: 기준 이미지 자체도 페이지마다 네비가 다름(1장 Home/Search/Bookings/Wishlist/Profile, 2장 Home/Map/Bookings/Community/Profile, 7장 Explore/My Trips/Bookings/Profile). "일관된 5탭 + 실기능"이 본질이지 특정 5개가 본질이 아님. 매출 동선 보존.
- 계획: **일단 B안으로 구현**(회귀 없음), A안 전환은 탭 배열 상수 1곳(`MobileBottomNav.tsx:21-28`) 교체로 가능하게 설계. 운영자가 A안 원하면 한 줄 스위치.

### 결정 2 — 토큰 SSOT
COCO 팔레트(#7C5CFF/#FF6DB7)를 라이트 모바일 SSOT로 승격:
- `index.css`에 `--coco-purple`, `--coco-pink`, `--coco-navy`, `--coco-lavender`, `--coco-muted`, `--coco-cta-gradient`, `--coco-card-border`, `--coco-card-shadow`, `--coco-radius-{card,chip}` CSS 변수 신설.
- `CocoUI.tsx`의 COCO 객체는 CSS 변수를 참조하도록 전환(파생, 중복 금지).
- 위자드·차터의 인라인 그라디언트 3벌 → `var(--coco-cta-gradient)` 참조로 교체.
- tailwind.config.js에 `coco-*` 유틸 매핑 추가.

### 결정 3 — 차터 단계 순서 유지
기준 이미지 순서(픽업→목적지→날짜→차량→연락처→확인)로 재배열하지 않음.
현재 순서(출발지→서비스→목적지→차량→날짜+연락처→견적)는 견적 로직·검증 체인과 결합돼 있어 재배열 시 돈버그 위험. 스테퍼·입력·차량카드·견적요약의 **시각 언어만** 통일. (7/18 차터 돈버그 수리 직후라 더더욱 불가침.)

### 결정 4 — 플랜 결과 모바일 라이트 통일
본문 슬라이드(Intro/Day/Outro)는 데스크톱 다크 공용이므로, 모바일 분기(`planner-detail-mobile-ai` 스코프 CSS + 조건부 클래스)로만 라이트화. 데스크톱 렌더 결과는 불변이어야 함.

### 결정 5 — TransitVsCharterCard 플래그
`VITE_FEATURE_TRANSIT_VS_CHARTER`는 env(🌐Vercel) 소관 — 코드에서 기본값 뒤집지 않음. 스타일만 정비하고 ON 여부는 운영자 결정으로 계획서에 기록.

---

## 3. 작업 목록 (커밋 단위 = Task)

> 실행 순서 = 의존 순서. 각 Task 끝에 `npm run build` + 해당 화면 dev 확인.
> 푸시는 마지막 1회(검증 후 푸시·모아 머지 원칙).

### Task 0: 브랜치 생성 + 토큰 SSOT
**파일:** Modify `src/index.css`(토큰 블록 추가), `src/components/coco/CocoUI.tsx`(CSS 변수 참조로 전환), `tailwind.config.js`(coco-* 매핑)
- [ ] `git checkout -b feature/mobile-ui-uniform-20260719` (main에서)
- [ ] `--coco-*` 변수 정의 + COCO 객체 파생화 + tailwind 매핑
- [ ] MobileHomeV2 렌더 결과 불변 확인(스크린샷 대조) — 값 동일, 참조만 변경
- [ ] `npm run build` 통과 → 커밋 `feat(ui): 코코 라이트 토큰 SSOT — CSS 변수 승격`

### Task 1: 공용 컴포넌트 확장 (CocoUI 라이브러리)
**파일:** Modify `src/components/coco/CocoUI.tsx` 또는 신규 `src/components/coco/` 하위
- [ ] `CocoStepper`(점+체크 진행 표시, 기준 3·6장) — 위자드·차터 공용
- [ ] `CocoSectionTitle`(제목/보조 크기 체계), `CocoInput`(라운드 입력), `CocoWarningCard`(핑크 경고, 기준 5장)
- [ ] 기존 `GradientCTA`에 `size`/`fullWidth` props 추가(뒤 화면들 공용)
- [ ] 4언어 문구 없음(구조 컴포넌트) — i18n 영향 0 확인 → 커밋

### Task 2: Map 화면 신설 (`/map`)
**파일:** Create `src/pages/MapPage.tsx`, Modify `src/App.tsx`(라우트)
- [ ] 로그인+플랜 보유: 최신 플랜의 경로 지도 — `DayRouteMap` 재사용, day 선택 칩, 정거장 리스트(기준 4장 Route Map 화면)
- [ ] 플랜 없음/게스트: 도시 카드(서울·부산·제주 등 기존 region 데이터)+투어/플래너 CTA — 빈 상태도 제품처럼
- [ ] Leaflet 재사용(신규 의존성 0), 4언어 키 추가 → 커밋

### Task 3: Assistant 화면 신설 (`/assistant`)
**파일:** Create `src/pages/AssistantPage.tsx`, Modify `src/components/ChatWidget.tsx`(코어 추출), `src/App.tsx`
- [ ] ChatWidget의 메시지 상태·API 호출(`/api/chat`, `/api/chat-poll`)을 훅으로 추출(`useChatSession`) — 위젯·전면 화면 공유
- [ ] 전면 채팅 화면: 기준 10장 AI Assistant 카드 언어칩 + 웰컴/퀵질문 재사용
- [ ] 플로팅 위젯 동작 불변 확인 → 커밋

### Task 4: 하단 네비 통일 (B안)
**파일:** Modify `src/components/MobileBottomNav.tsx`, `src/pages/CommunityPage.tsx`(CommunityRail 스타일)
- [ ] 스타일 통일: 활성 인디케이터·아이콘·라벨 크기·반투명 배경을 기준 이미지 스타일로(라이트 셸 기준)
- [ ] 탭 배열을 상수로 분리해 A안 전환 1곳 수정으로 가능하게
- [ ] CommunityRail을 같은 시각 언어로(구성은 유지 — 커뮤니티 특화 탭 존치)
- [ ] 홈 퀵액션에 Map·Assistant 진입 추가(`MobileHomeV2`) → 커밋

### Task 5: 홈 마감 (기준 1·2장)
**파일:** Modify `src/pages/MobileHomeV2.tsx`, 프로모 배너 컴포넌트
- [ ] V2 플래그 상태 실측(`VITE_FEATURE_MOBILE_V2`, 🌐Vercel env) — OFF면 운영자 보고 항목
- [ ] 히어로 도시 카드+날씨칩(기준 1장) — 날씨는 기존 API 있으면 연결, 없으면 히어로만(가짜 데이터 금지)
- [ ] 프로모 배너 라이트 스킨(체크리스트 L24 잔여) — ⚠️ promo-config 서버 동일성 테스트 통과 필수, 할인율 문구는 서버 값만
- [ ] Recommended/Smart Picks 카드 이미지·라벨 정돈 → 커밋

### Task 6: 위자드 통일 (기준 3장)
**파일:** Modify `src/components/WizardForm/index.tsx`(진행 UI L906-960), `WizardNav.tsx`, 각 Step 칩 스타일
- [ ] 진행바 → `CocoStepper`(점+체크), 그라디언트 토큰 참조
- [ ] 선택 칩/카드: 선택 상태(보라 테두리+체크)·미선택 통일, Continue/Back 기준 스타일
- [ ] **단계 구성·데이터 흐름 불변**(호텔=anchor, 도시 cycle, resume 모달, dateRange.to — 위자드 5-step audit 체크리스트 적용)
- [ ] `plan:test` 하네스로 생성 플로우 회귀 확인 → 커밋

### Task 7: 플랜 결과 모바일 라이트 통일 (기준 4장)
**파일:** Modify `src/pages/PlanDetailPage/index.tsx`(로딩/에러 L546-590), `components/IntroSlide.tsx`, `DayTimeline.tsx`, `OutroSlide.tsx`, `SectionTabs.tsx`, `src/index.css`(`planner-detail-mobile-ai` 스코프)
- [ ] 모바일 분기에서 본문 슬라이드 라이트화(카드·타임라인 레일·환승 세그먼트) — 데스크톱 다크 불변
- [ ] 개요 통계칩에 총거리 km·예상 최적화 추가(기존 `computeDayTotals` 파생 — 새 데이터 소스 불필요)
- [ ] 로딩/에러 상태 모바일 라이트
- [ ] 저장·공유·PDF 버튼 배치 정리(Outro) — pdfGenerator·ShareButton 로직 불변
- [ ] cross-surface 영향 점검: PDF/공유 OG/편집 모드 (cross-surface-audit 스킬 대상) → 커밋

### Task 8: 힘든 이동 안내 스타일 (기준 5장)
**파일:** Modify `src/pages/PlanDetailPage/components/RouteInsightCard.tsx`, `CharterCTA.tsx`, `TransitArrow.tsx`
- [ ] 경고 카드: 이유+예상 시간+도보/환승 부담 표기 확인·강화(`routeInsight.ts` 판정값 그대로 노출, 판정 로직 불변)
- [ ] 차터 CTA → GradientCTA 통일, 프리필 URL(`buildCharterCTAUrl`) 불변
- [ ] `TransitVsCharterCard` 스타일 정비(플래그는 그대로) → 커밋

### Task 9: 차터 위자드 시각 통일 (기준 6장)
**파일:** Modify `src/components/charter/CharterWizard.tsx`(스테퍼 L383-410, 모바일 CTA바 L610-631), `Step1~6*.tsx` 표시 계층만
- [ ] 스테퍼 → CocoStepper, 입력 → CocoInput, 차량 카드(이미지+pax+수하물+선택 라디오) 기준 6장 스타일
- [ ] 견적 요약(Step6Quote) 카드 스타일만 — **금액 계산·표시 값 코드 불변** (charter-extras SSOT·파리티 테스트 보호)
- [ ] 기존 charter 테스트 통과 확인 → 커밋

### Task 10: 투어 동선·카드 통일 (기준 7장)
**파일:** Modify `src/pages/ToursPage.tsx`, `src/components/tours/TourCard.tsx`, `TourInquireModal.tsx`, `TourDetailPage.tsx`(모바일 표시 계층)
- [ ] 검색→필터(관심사 칩 그리드+trip style+duration)→상세→맞춤 문의 동선 시각 통일
- [ ] 카드: 이미지 비율 고정(aspect-ratio, 잘림 방지), 가격·태그·CTA 위치 통일, 별점은 게이트 조건 유지
- [ ] 상세: 하이라이트 체크리스트·칩(소요/언어/그룹) 기준 스타일 → 커밋

### Task 11: 예약 흐름 마감 (기준 8장)
**파일:** Modify `src/components/booking/BookingInfoForm.tsx`(스타일만), `src/components/tours/TourBookingDialog.tsx`, `PayPalBookingButton.tsx`(**성공 화면 L662-699 표시부만**)
- [ ] 확인→연락처→쿠폰→결제→완료 단계 시각 연결(다이얼로그 내 스텝 표시)
- [ ] 성공 화면: Booking Confirmed 카드(체크 아이콘·예약번호·결제 상태·**24h 실정책 문구**·View Booking/Back to Home)
- [ ] 쿠폰 영역: `FEATURE_DISCOUNT_V2` 게이트 로직 불변, 노출 시 스타일만 기준 8장
- [ ] 결제 로직 diff 0 확인(해당 파일은 표시 JSX만 변경) → 커밋

### Task 12: 커뮤니티 보강 (기준 9장)
**파일:** Modify `src/pages/CommunityPage.tsx`(+CSS `src/index.css:1380,1934`)
- [ ] 목록 카드: 언어 배지·카테고리칩·답글/좋아요 카운트 기준 스타일
- [ ] 번역 카드: Translated 배지+원문 토글+"도움됐나요" 배치
- [ ] 작성 폼: 사진/위치/일정(코스 공유 링크) 첨부 행 정리 — 기존 기능 범위 내
- [ ] 빈 상태 일러스트+CTA 정돈 → 커밋

### Task 13: 다크 잔존 정리 (우선 항목 9)
**파일:** Modify `src/App.tsx`(preview 라우트 DEV 게이트), `src/pages/SharedCoursePage.tsx`, `NotFoundPage.tsx`
- [ ] `/preview/mobile-*` 5종 → `import.meta.env.DEV` 조건부 라우트(prod 제외, 로컬 검수 유지)
- [ ] SharedCoursePage·NotFoundPage 모바일 라이트 셸 적용
- [ ] index.css 데드 별칭 `.cocotrip-mobile-home-surface` 정리 → 커밋

### Task 14: 통합 검증 + 유사도 재평가 + PR
- [ ] `npm run build` + 전체 기존 테스트
- [ ] dev 서버(preview_start) — 390×844 / 430×932 / 데스크톱 3뷰포트
- [ ] 클릭 검증: 홈→AI설계(5단계 완주)→일정결과(개요·일별·지도·편집·저장/공유)→힘든이동→차터 견적 직전→투어(검색·필터·상세·문의)→예약(결제 직전까지, **실결제 금지**)→커뮤니티(목록·번역·작성)→Map→Assistant
- [ ] 겹침·잘림·가로 스크롤·빈 이미지·죽은 버튼·콘솔 오류 스윕
- [ ] 수정 전/후 스크린샷 대조 + 페이지별 유사도 표 작성
- [ ] 90% 미달 화면 → 해당 Task로 돌아가 보완 후 재검증
- [ ] 브랜치 푸시 → PR 1건 → 검수 → 머지 → Vercel prod 배포 확인(cocotripkr.com, SPA 폴백 함정: 본문 일치로 확인)
- [ ] 작업 종료 self-check 출력(main…origin/main 0 0, PR MERGED, OPEN PR 0)

---

## 4. 회귀 위험 목록

| 위험 | 완화 |
|---|---|
| 결제·가격 로직 오염 | 불가침 파일 목록 고정, 해당 파일은 JSX/className diff만 허용, 커밋 전 diff 육안 검수 |
| promo-config 동일성 테스트 실패 | 프로모 문구·할인율은 서버 config 값만 렌더 |
| visual baseline 스냅샷 깨짐 | 의도된 UI 변경이므로 실패 런 `-actual.png` 승격 절차로 baseline 갱신 |
| i18n 4언어 lint | 신규 문구마다 4키 동시 추가 |
| plan detail 데스크톱 회귀 | 라이트화는 모바일 분기·스코프 CSS로만, 데스크톱 스냅샷 대조 |
| 위자드 상태 흐름 파손 | 5-step audit 체크리스트(호텔 anchor·도시 cycle·resume·dateRange.to) + `plan:test` |
| untracked 인계문서 오염 | 파일 단위 add 강제 |
| 번들 사이즈 게이트 | 신규 의존성 0 원칙, size 체크 |
| PWA 캐시로 변경 안 보임 | prod 확인은 콜드스타트/시크릿 창 |

## 5. 검증·완료 조건 (요구사항 매핑)
빌드+테스트 통과 / 3뷰포트 실브라우저 확인 / 기능 무후퇴 / 유사도 재평가표 /
미달 시 재수정 / 브랜치 푸시→PR→검수→머지 / Vercel prod 반영 확인 — Task 14에서 전부 수행.

## 6. 규모·비용 추정
- 수정 파일 약 30~35개, 신규 3개(MapPage, AssistantPage, useChatSession). 커밋 ~14개, PR 1건.
- 예상 비용: 토큰 무거운 축(스크린샷 검증 다수) — 대략 $15~25 수준. 유료 사이클 최소화 원칙대로 푸시 1회·PR 1건.

## 7. 운영자 결정 필요 (진행 전 답 주시면 반영, 없으면 괄호 기본값으로 진행)
1. **하단 네비 A안(기준 충실: Plan/Map/Assistant/Bookings/Profile) vs B안(절충: 홈/투어/AI Plan/예약/마이 + Map·Assistant는 화면 신설+퀵액션 연결)** — (기본: B안, A안 전환은 상수 1곳)
2. `VITE_FEATURE_MOBILE_V2` prod ON 여부 — OFF면 신형 라이트 홈이 실사용자에게 안 보임 (기본: 현 상태 실측 후 보고, 코드는 플래그 무관하게 V2 개선)
3. `VITE_FEATURE_TRANSIT_VS_CHARTER` ON 여부 (🌐Vercel env, 기본: 현행 유지)
