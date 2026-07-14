# UI/UX 디자인 가이드 100% 구현 체크리스트

> 원본: 운영자 제공 `CocoTrip_UIUX_이미지_10장` (2026-07-12, Desktop). 목표 = **놓침 0**.
> 규칙: 항목 완료 시 `[x]` + PR 번호. 세션 인계 시 이 문서가 진실의 원천.
> 위험등급: 🔴 돈·SAFETY(운영자 승인+실결제 e2e) / 🟡 배선 보존(가드 테스트 확인) / 🟢 표면.
> 정직 원칙: 실데이터 없는 표기(가짜 리뷰 수·미존재 포함서비스) 금지 — 대체 방안 명시.

## 공통 디자인 시스템 (전 화면)
- [x] 팔레트 토큰: #7C5CFF·#FF6DB7·#D9D3FF·#0F1230·#FFFFFF·#F2F3F7 (MobileHomeV2 적용, 공용 토큰화는 P10 항목) — #1096
- [x] 아이콘 시스템: 스쿼클 라벤더 타일 + 퍼플 그라데이션 2px 선 아이콘 13종 (`CocoIcons.tsx`) — #1096
- [x] 🟢 CTA 그라데이션 버튼 공용 컴포넌트 — `CocoUI.GradientCTA` **MobileHomeV2 채택**(AI카드 CTA) + 토큰 COCO 파생 dedup — C-sweep. CocoCard 는 스타일 상이로 미채택(신규 카드 대기).
- [x] 🟢 상태칩 공용 — `CocoUI.StatusChip` **MobileHomeV2 채택**(bestMatch·Smart Pick 태그) — C-sweep.
- [ ] 🟢 언어 칩 4종 (EN·한국어·日本語·中文) 공용 셀렉터 (현: MobileHomeV2 헤더 순환 버튼 — 칩 셀렉터 공용화 잔여)
- [x] 🟡 하단 내비 구성 — **운영자 결정 확정(2026-07-12)**: 홈·투어·AI플래너·예약(/my-plans)·프로필. 차터 탭 제거(매출 모니터링, 롤백 가능) #1097

## P1 — 플랫폼 홈
- [x] 인사말 헤더(Hello Traveler ✦ + 서브) — #1096
- [x] 히어로 목적지 카드 + 실시간 날씨 칩 — #1096
- [x] Quick Actions 5 카테고리(신규 아이콘) — #1096
- [x] Recommended for You = Smart Picks(실투어+SSOT 가격) — #1096
- [x] 🟢 알림 벨 — community_notifications 인프라 + 홈 벨 뱃지 #1104 (P8 예약상태 연동은 잔여)
- [x] 🟢 검색바("Search destinations, attractions...") — 홈→/tours?q= 라우팅 + ToursPage 전 언어 매칭 #1106
- [x] 🟡 위시리스트 탭/하트 — 기존 구현 확인(useWishlist·투어카드 하트·마이페이지 wishlist 탭, 2026-07-13)
- [ ] 🟡 프로모 배너 라이트 스킨 — ⚠️ 문구는 서버 promo-config DEFAULT 와 동일성 테스트 강제(promo-truth-p0)

## P2 — 6대 기능 총람 (마케팅 페이지 성격 — 웹 랜딩 반영)
- [x] 🟢 데스크톱 랜딩 6기능 소개 섹션 — `FeatureOverview`(lazy), AI Planner·Tours·Charter·Route Map·Community·My Bookings #1106
- [x] 🟢 My Bookings 카드형 목록 — /my-plans 에 AI플랜/예약 탭 통합(MyBookingsTab 재사용) #1106

## P3 — 위자드 5-step (🟡 5-step audit 의무 + dietary SAFETY)
- [x] 상단 진행바 ✓✓③④⑤ 형 — 이미 구현(index.tsx step 인디케이터: 완료 step=Check 아이콘, 현재=번호, %바+5칩). 스태일 [ ] 정정(2026-07-13 검증)
- [x] Step1 Travel Dates(체크인/아웃 카드) — DayPicker range 아래 호텔식 체크인/체크아웃 요약 카드 추가(WizardStep2Details, additive·기능 불변·순수 inline lang 4언어). 2026-07-13
- [ ] 🟡🧠 Step2 Cities(썸네일 리스트 선택) — **데이터 게이트**: 현재 lucide 벡터 아이콘 칩. 사진 썸네일화는 도시별 큐레이션 사진 필요(KTO 광역도≠시 = 잘못된 사진 라벨 위험). 아이콘 = 정직한 현 선택. 큐레이션 자산 확보 후.
- [x] **Step3 Travel Style — 솔로/커플/가족/친구 4옵션(운영자 확정)** + 플래너 프롬프트 travel_party 소프트 힌트 전파 #1102
- [~] Step4 Interests 칩 — 이미 구현+AI 전파(Step0Destination, categories→selectedActivities). **의도적 편차**: 실제 키=Kpop/Kbeauty/Hanbok/Food/Night/Photo/Shopping/Drama/Temple/DMZ(한국 특화·가이드 generic Culture/Nature/History 보다 정직·풍부). nav 편차와 동일 성격 — 강제 교체 X(AI category 매핑 회귀 위험)
- [x] Step5 Budget + Dietary(Halal·Vegan·**Vegetarian**·No Preference) — Vegetarian 추가 완결 #1106
  (백엔드 안전체인 이미 지원, 위자드 UI 만 갭이었음. dietary-trust lowercase+vegan⊃vegetarian, P324/P325 무회귀)
- [x] 하단 신뢰 4배지(Fast Setup·Safe Preferences·Multilingual·Editable) — WizardForm 하단 정적 배지, 실약속만(4언어·편집·안전취향) C-sweep
- 보존: 호텔=anchor·도시 cycle 동기화·resume modal·dateRange.to·4-lang lint

## P4 — 플랜 결과 4화면 (🟡 stop 신스키마·PDF 금지사항·validator)
- [x] Trip Overview: 히어로+통계칩(일수/정거장/**km** #1106)+T-money+**Top Highlights**(C2)+**최적화칩**(C5: optimizePct=날짜별 suggestTimeOrder km절약 합의 %, 15%/0.8km 게이트 내장·제안0이면 Travelers 폴백·분 표기 안 함=가짜방지). 가이드 4칩(Days/Stops/Distance/Optimize) 정합
- [x] Day Timeline: 시각축+교통 세그먼트(도보/지하철 아이콘)+**하단 총계 3칩(도보/교통/교통비)** #1106 (computeDayTotals, public+walk 실측)
- [x] Interactive Route Map: 번호 핀+정거장 리스트 (기존 Leaflet 재스킨) — DayRouteMap 지도 아래 번호 정거장 ol 리스트(핀 order 1:1 매칭, toMapPoints 재사용) C-sweep
- [x] Edit & Optimize: 정거장 재정렬·삭제(기존 EditModeToggle) + **최적화 제안(Time/Transport/Walking)** — anchor 세그먼트 경계 준수 실좌표 최적화 #1106
- [x] Save·Share with Friends·Export PDF 액션 행 — 이미 구현(OutroSlide: Download PDF + Download text(.md 폴백) + WhatsApp + ShareButton=Web Share/클립보드+공개/비공개 토글+공유링크 shareUrl). Save=Firestore 자동저장(별도 버튼 불필요). 스태일 [ ] 정정(2026-07-13 검증)

## P5 — 교통 + 차터 업셀 (신규 킬러 기능)
- [x] 🟡 일정 세그먼트 난이도 판정 로직 — `routeInsight.ts` 순수함수(환승2+/도보900m+/60분+, RouteAgent 실측만) #1103
- [x] AI Route Insight 카드 + [Book 3-Hour Charter] CTA — `RouteInsightCard`, 하루 최고점 1구간 #1103
- [ ] 🟠 지도 범례(Easy 실선/Challenging 점선/Recommended) — **baseline+복잡 게이트**: Leaflet polyline 난이도 styling 동반 필요(provider-isolated). 또한 DayRouteMap = 비주얼 baseline 클립(timeline-mid) 내 → 편집 시 baseline 재생성(Ubuntu/Docker 전용) 필요, Windows 자율 머지 불가. CI 아티팩트 승격 세션 필요.
- [~] 차량 3종 선택 카드(스타리아 프리미엄/9인/스프린터) — 이미 구현(charter/Step4PaxVehicle: staria_9/staria/sprinter/bus 카드 + 실사진 갤러리 webp staria7·staria9·sprinter). 가격=선택카드 비표시(견적 step에서 노출=의도). 잔여 🔴 bus 사진(운영자)
- [x] 가치 4배지(Less Walking·Save Time·Door to Door·Add Only When Needed) — CharterCTA 에 추가 #1106 (진실 static, i18n 4언어)

## P6 — 차터 예약 6-step (🔴 SSOT byte-identical·P311 멱등성·운영자 승인)
- [~] 진행바 6단계 — 구현됨(CharterWizard 클릭형 스테퍼+애니 progress). **순서 편차(의도)**: 실제=Origin→Service→Destination→Pax·Vehicle→Date·Options→FinalQuote(가이드 Pickup→Dest→Date→Vehicle→Contact→Review 와 다름, nav 편차와 동일 성격). 2026-07-14 검증
- [~] Step1 타입 4탭 등 — 기능 전부 존재하나 **분산 배치**: 4탭(공항/데이투어/멀티데이/K-pop)=Step2Service, 픽업지=Step1Origin, 항공편+터미널(T1/T2)+게이트(/api/flight-status 조회)=Step5DateOptions. 가이드의 단일 Step1 개념을 3스텝에 나눔.
- [~] Step2 목적지+경유지+편도/왕복 — 목적지 select DONE(Step3Destination). **경유지 추가=MISSING**(waypoint 코드 없음). 편도/왕복=Step5, transfer 서비스 한정+feature flag.
- [~] Step4 차량 4종 카드 — 이미 구현(Step4PaxVehicle: staria_9/staria/sprinter/bus + 실사진 갤러리). 🔴 bus 사진(운영자).
- [~] Review(FinalQuote): Trip Summary DONE(Step6Quote+사이드바). What's Included=quote.includes(fuel/tolls/parking) — 전문기사·24/7 은 Step5 BookingInfoForm trust 에 있고 Review 엔 미표기(재배치 여지, 저가치).
- [ ] 가치 4배지(Upfront Quote·Professional Driver·Flexible Stops·Multilingual) — **MISSING**(해당 4종 세트 없음). 🟢 저가치 static 배지 추가 가능(비게이트) — 후속 소형.
- 보존: multidayQuote.ts ≡ charter-multiday-price.js·front/back FEATURE 쌍·국가번호 드롭다운

## P7 — 투어 4-step
- [x] Discover: 검색 + 인기 목적지 칩 + 도시 카드(N Tours 카운트=실데이터) — ToursPage 도시 카드 그리드(getToursByRegion 실카운트, 클릭=필터, count0 skip) C-sweep. **C4: 사진 카드화**(REGION_IMAGE 실존자산 Seoul/Busan/Gyeongju/Danyang, 없는 지역 그라디언트 폴백=잘못된 사진 라벨 금지). 검색바 기존.
  - [x] Trip Style 필터(Relaxed/Balanced/Active) — 2026-07-14 구현. `tourPace.ts` 9투어 pace 실데이터(소요시간+야외/도보량 근거, 계절칩 패턴). ToursPage 칩 행+OR 필터. 검증: Active 클릭→4투어(danyang·nami-chuncheon·gyeongju·multicity). 운영자 검수 후 tourPace.ts 조정. 별점만 잔여(🔴게이트).
- [x] Filter: Interests+Duration+언어+**Trip Style 3칩**+"Show N Tours" 실카운트 전부 구현. 별점 제외 완료.
- [ ] 투어 상세: 칩·하이라이트 체크 기존, 별점만 잔여(🔴 REAL_TOUR_RATINGS 실데이터 채운 후 ON — 가짜 금지)
- [x] Custom Tour Inquiry: 관심사 태그(≤5)+Style 라디오+기간+인원 → TourInquireModal 확장(C3): 테마 ≤5 캡·**Travel Style 페이스 라디오(Relaxed/Balanced/Active)**·duration select. 백엔드 inquiry-submit 도 travelStyle/duration 구조분해+Firestore+텔레그램 relay(가짜필드 방지). value 영문 고정.
  ⚠️정정(C4 레퍼런스 대조): C3 초판은 companions(Solo/Couple/Family) 넣었으나 가이드 P7 Custom=페이스(Relaxed/Balanced/Active)라 정정. companions 는 위자드 P3 전용.
- 보존: 결제 다이얼로그 배선(#1019)·tours SSOT

## P8 — 결제 4-step (🔴 운영자 승인 + 실 PayPal e2e)
- [x] Booking Summary: Included Services = **실제 포함만** — 이미 구현(BookingInfoForm:514-546 우측 결제 요약 PayRow+총액+포함/취소 블록, 톨비팁·EN/KO 기사·24h·항공지연 무료대기). 스태일 [ ] 정정(2026-07-14)
- [x] Contact Details: BookingInfoForm — 이미 구현(:295-344 연락처 섹션 + CountryDialPicker 국가번호 드롭다운). 스태일 [ ] 정정
- [x] **쿠폰 지갑**: Available/Used/Expired 탭 (MyPage) — 기존 useLoyalty 실쿠폰 위 순수 표시, 결제·환불·상한 로직 무변 #1106
- [~] Booking Confirmed: 예약번호 DONE(PayPalBookingButton:606 Order No.)·Amount Paid 그린수치·지원연락처(WhatsApp) DONE. 🔴 **취소정책 미표기=게이트**: confirmed 화면에 취소정책 없음, 추가하려면 #1108(48h) % 확정 필요(현 Draft). Paid=별도 배지 아닌 금액 표기.
- 보존: capture 금액 대조·게스트 PII 마스킹·멱등성

## P9 — 커뮤니티 4화면 (기존 /community 셸에 스킨+기능)
- [x] Community Home: 카테고리 탭+인기+글쓰기 — #1098 실전화
- [x] Ask & Translate: 원탭 번역(EN/한/日/中) — #1098 Gemini 번역 캐시
- [x] Create Post: **사진 첨부(community/{uid}/ Storage + 서버 sanitizeImages 화이트리스트)** #1106 + Safety Check(연락처 감지) #1098
- [x] Shared Itinerary: 플랜 공유 카드 — 이미 구현(/my-plans/:id?shared=1 = PlanDetailPage 읽기전용 렌더, App.tsx:623 라우트 + 마케팅/앱 크롬 스트립, isPublic 인가, 비소유자 PII 마스킹(uid/email/호텔/공항/알러지/가격/토큰), 소유자만 편집). ShareButton 공개/비공개 토글+링크. 스태일 [ ] 정정(2026-07-13 검증)
- [x] 신고(Report)·**어드민 모더레이션 실배선**(/api/community-admin 검토대기·신고 실조회+승인/숨김) #1106

## P10 — 컴포넌트 라이브러리 (공용화)
- [~] AI Planner Summary 카드 — 홈에 인라인 구현(MobileHomeV2). 공용 추출은 🟢저가치+baseline 게이트(홈 히어로=`/` header-fold 클립 내 → 소비처 스왑 시 baseline 재생성 Linux 전용). 강제 리팩터=리스크(#1097 CocoUI 미채택 선례). 보류.
- [~] Smart Pick Card("Why we love it") — 홈에 인라인 구현(MobileHomeV2, whyWeLove 실설명 파생). 추출=위와 동일 baseline 게이트. 보류.
- [x] Interactive Route Map 카드(Optimize 토글) — 이미 공용 컴포넌트(PlanDetailPage/components/DayRouteMap + OptimizePanel, DayTimeline 소비). 스태일 [ ] 정정.
- [x] Charter Segment 카드(intercity 업셀) — 이미 공용 컴포넌트(RouteInsightCard·TransitVsCharterCard·CharterCTA, DayTimeline 소비 #1103). 스태일 [ ] 정정.
- [x] **Booking Status 타임라인**(C2: BookingStatusTimeline, b.status 실값 Confirmed→투어당일→Completed, CANCELED 분기, 조작단계X)
- [x] Tour Card = 이미 공용 컴포넌트(components/tours/TourCard.tsx, ToursPage+OwnTourUpsellSection 재사용). 스태일 정정(2026-07-14)
- [~] 잔여 추출(🟢 저가치·비게이트): Coupon Wallet(MyPage 인라인)·Community Translation(CommunityPage 2곳 중복)·Weather Card(3곳 중복, 단 홈=baseline 게이트). 강제 리팩터 리스크 대비 저가치 → 신규 화면 생길 때 dedup.

## 운영자 결정 — 2026-07-12 확정 ✅
1. **내비 교체 승인** → 실존 라우트 매핑: 홈·투어·AI플래너·예약(/my-plans)·프로필(/mypage).
   Map·Assistant 탭은 해당 화면 생기면 추가. ⚠️차터 탭 제거 — 홈 카테고리/투어에서 접근 유지
   (매출 영향 모니터링, 운영자 "차터 유지" 시 즉시 롤백).
2. **취소 48시간 전 무료** 확정 — P8 화면 + 약관 표기.
3. **리뷰 가짜 금지** (법·PayPal 리스크 — 운영자에게 고지 완료). 대체: 실후기 수집 스프린트
   (과거 고객 + 후기 쿠폰) → 쌓이면 REAL_TOUR_RATINGS ON. 리뷰 0 동안 실수치 신뢰 신호로 대체.
4. **Travel Style = 솔로/커플/가족/친구 4옵션** — UI + 플래너 프롬프트 반영.
5. **차터버스(16+·45석) 실상품 확정** — 사진 없음(public/vehicles = staria7·staria9 만).
   🔲 운영자: 스프린터 + 차터버스 사진 2장 제공(실사 또는 생성) → 받으면 P5/P6 차량 카드 완성.

## 진행 로그
- 2026-07-12: 홈 리디자인+아이콘 13종 (#1096) · 라이트 셸 연결 (#1094) · visual baseline (#1095)
- 2026-07-12: 내비 교체+CocoUI+스프린터 사진 (#1097) · 커뮤니티 실전화 (#1098)
- 2026-07-13: 투어 Interests 필터 (#1099). P4 플랜상세 = #1088 에서 이미 가이드 스타일 확인 —
  Edit&Optimize 실기능만 신규기능 배치로 이관.
- [x] 🔧 후속: visual 홈 히어로 **날씨 칩 flaky** — mask 대신 wttr.in 네트워크 차단으로 해소
  (칩=fetch 성공 시에만 렌더라 abort=결정론적 미노출, baseline 재생성 불필요). `stubWeatherUnavailable` helpers.ts.
- 2026-07-13 (2차): 위자드 Travel Style 4옵션 (#1102) · **AI Route Insight 세그먼트 차터 업셀** (#1103)
  · **커뮤니티 알림 MVP + 홈 벨 뱃지** (#1104) — 전부 prod.
- 확인된 기존 구현(항목 완료 처리): 위시리스트(useWishlist·투어카드 하트·마이페이지 탭),
  플랜 Edit(재정렬·삭제·추가 = EditModeToggle), day 단위 CharterCTA.
- **2026-07-13 (B트랙 스윕 PR#1106, ✅MERGED 237f6dca)**: 홈 검색바(P1)·데스크톱 6기능 총람+My Bookings 통합(P2)·
  플랜 Optimize 제안 Time/Transport/Walking(P4, anchor 세그먼트 경계)·커뮤니티 사진 첨부+어드민 모더레이션 실배선(P9)·
  쿠폰 지갑 Available/Used/Expired 탭(P8, 표시만)·날씨칩 flaky fix. 적대검토 7결함(보안2·정확성5) fix 포함.
  유닛 4881 pass. **P6 차터 6-step = 이미 #1037 구현(재스킨 불필요)**.
- 🔴 **취소 정책 48h 미결(운영자 결정 필요)**: SSOT `_refund-policy.js` general=72h 100%·48h 80% ↔ `BookingInfoForm`(L291·535)
  한국어 하드코딩 "1일 전 무료·전액환불" = SSOT·운영자확정(48h) 모두 불일치. 환불 지급액 변경=돈 로직이라 미착수.
  운영자 결정: (a) 48h 무료를 전 등급 SSOT 에 반영 vs (b) 표기만 SSOT 에 맞춤 → 별도 PR.
- **2026-07-13 (후속 PR#1106)**: 모바일 햄버거 메뉴 라이트셸 흰글자 버그 fix(인라인 색 셸별 분기) +
  위자드 **Vegetarian 식이옵션** 추가(SAFETY 완결 — 백엔드 이미 지원, UI 갭이었음).
- 🔴🧪 **2026-07-13 visual baseline 함정 (머지 blocker 해소)**: #1106 머지 직전 `visual` deployment_status
  체크가 landing 모바일 header-fold 39238px(0.33) 회귀로 차단. 근본원인 = baseline PNG 가 **MobileHomeV2
  롤아웃(#1094) 이전 구 홈**("Let me plan your perfect Korea trip")이라 이미 stale. `pull_request` path
  트리거의 **auto-pass(3s no-op)** 가 최신 visual 체크를 success 로 덮어써와서 여태 실회귀 미검출(#1102·1103·
  1104 전 커밋 deployment_status visual 전부 fail 상태였음). 해소: `visual-baseline-bootstrap.yml` 를
  #1106 프리뷰 URL 대상 실행 → CI Linux actual PNG 를 baseline 승격(weather 칩=stub 로 결정론적 미노출,
  라이트셸이라 light==dark 픽셀동일 md5 검증). ⚠️후속 필요: (a) auto-pass no-op 가 실패를 가리는 구조 수정
  (b) 신규 페이지 추가 시 baseline 동반 갱신 습관.

## 🔍 기능 감사 결과 (2026-07-13) — 실제 갭 (다음 작업 후보)
가이드 미체크 항목 코드 대조. **[구현됨]은 체크 처리, 아래는 진짜 갭만**:
- **[P10] CocoUI 죽은 코드** — `CocoUI.tsx`의 GradientCTA/StatusChip/CocoCard export 전부 소비처 0
  (grep 결과 자기 파일만). #1097 [x] 표기와 실코드 불일치 → 신규 화면서 채택하거나 인라인 유지 결정 필요.
- **[P3 부분]** 위자드 Cities=lucide 아이콘 칩(사진 썸네일 아님), Interests 택소노미 가이드와 상이, 하단 신뢰 4배지 없음(플래너 히어로에 유사).
- **[P4 부분]** Trip Overview 통계칩=Days/Stops/Pax(km·최적화분 없음)·Top Highlights 섹션 없음 / Day Timeline 하단 총계 3칩 없음 / 명시 "Save" 버튼 없음(자동저장).
- **[P5 미구현]** 지도 범례(Easy/Challenging/Recommended)·가치 4배지·플랜상세 차량 3종 카드 전무(차량카드는 차터 위자드에만).
- **[P7 부분]** Trip Style 3필터·"Show N Tours" 적용버튼·도시별 N Tours 카드 없음(라이브 카운트 텍스트만).
- **[P5 주의]** TransitVsCharterCard 기본 OFF(`VITE_FEATURE_TRANSIT_VS_CHARTER`) — 완성 기능이 미노출(운영자 env).
- 정직 폴백(버그 아님): TourDetail 'coming soon'=stops 없을 때만, 커뮤니티 샘플 제거됨.

- 🔴 **취소 정책 48h 미결(운영자 결정 필요)**: SSOT `_refund-policy.js` general=72h 100%·48h 80% ↔ `BookingInfoForm`(L291·535)
  한국어 하드코딩 "1일 전 무료·전액환불" = SSOT·운영자확정(48h) 모두 불일치. (a) 48h 무료를 전 등급 SSOT 반영 vs (b) 표기만 SSOT 맞춤 → 별도 PR.
- **2026-07-13 (C트랙 스윕)**: P10 CocoUI 채택(MobileHomeV2 GradientCTA/StatusChip + 토큰 COCO dedup, 죽은코드·[x]불일치 해소)·Smart Pick "Why we love it"(tour.summary 실4언어)·P7 Discover 도시 카드(실카운트)·P7 별점 SAFETY 게이트(화면 별점 `VITE_FEATURE_REAL_TOUR_RATINGS` 게이팅=우발적 가짜별점 차단, JSON-LD와 동일조건)·P3 위자드 신뢰 4배지·P4 Route Map 번호 정거장 리스트. 유닛 4894 pass·tsc clean·i18n 4언어 2090키 정합.
  ⚠️ 시각 baseline: MobileHomeV2 변경=320px fold 밖+토큰 동일이라 landing 무영향. plan-detail timeline-mid 는 DayRouteMap 리스트로 밀릴 수 있음 → CI diff 시 actual PNG 재생성.
- **C-sweep 보류(정직·게이트)**: P4 Top Highlights·최적화칩·Save/Share/PDF 행 / P3 도시 썸네일(광역도≠시 사진)·Interests 6칩(백엔드 category 매핑 미검증) / P7 Trip Style 3필터(백킹필드 없음)·Custom Inquiry companions / P10 나머지 추출(PlannerSummaryCard·WeatherChip·TourCard 통합·CouponWallet·TranslateToggle·BookingStatusTimeline). recon 맵=이 세션.
- 잔여 대형: 커뮤니티 Shared Itinerary 카드 / 결제(P8) 캡처·환불 스킨(실 PayPal e2e) / 실후기 → docs/REVIEW-SPRINT.md
