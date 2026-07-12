# UI/UX 디자인 가이드 100% 구현 체크리스트

> 원본: 운영자 제공 `CocoTrip_UIUX_이미지_10장` (2026-07-12, Desktop). 목표 = **놓침 0**.
> 규칙: 항목 완료 시 `[x]` + PR 번호. 세션 인계 시 이 문서가 진실의 원천.
> 위험등급: 🔴 돈·SAFETY(운영자 승인+실결제 e2e) / 🟡 배선 보존(가드 테스트 확인) / 🟢 표면.
> 정직 원칙: 실데이터 없는 표기(가짜 리뷰 수·미존재 포함서비스) 금지 — 대체 방안 명시.

## 공통 디자인 시스템 (전 화면)
- [x] 팔레트 토큰: #7C5CFF·#FF6DB7·#D9D3FF·#0F1230·#FFFFFF·#F2F3F7 (MobileHomeV2 적용, 공용 토큰화는 P10 항목) — #1096
- [x] 아이콘 시스템: 스쿼클 라벤더 타일 + 퍼플 그라데이션 2px 선 아이콘 13종 (`CocoIcons.tsx`) — #1096
- [ ] 🟢 CTA 그라데이션 버튼 공용 컴포넌트 (View Full Plan 형)
- [ ] 🟢 상태칩 공용: Best Match·Recommended·Saved·Confirmed·42 min faster·Popular·New
- [ ] 🟢 언어 칩 4종 (EN·한국어·日本語·中文) 공용 셀렉터
- [ ] 🟡 하단 내비 구성(Plan·Map·Assistant·Bookings·Profile) — **운영자 결정 대기** (현: 홈·투어·전세차량·AI플래너·로그인. 전 라우트 영향)

## P1 — 플랫폼 홈
- [x] 인사말 헤더(Hello Traveler ✦ + 서브) — #1096
- [x] 히어로 목적지 카드 + 실시간 날씨 칩 — #1096
- [x] Quick Actions 5 카테고리(신규 아이콘) — #1096
- [x] Recommended for You = Smart Picks(실투어+SSOT 가격) — #1096
- [ ] 🟢 알림 벨 (알림 인프라 = 신규, P8 예약상태 연동)
- [ ] 🟢 검색바("Search destinations, attractions...") — 투어/지역 검색 라우팅
- [ ] 🟡 위시리스트 탭/하트 (Firestore 스키마 신규)
- [ ] 🟡 프로모 배너 라이트 스킨 — ⚠️ 문구는 서버 promo-config DEFAULT 와 동일성 테스트 강제(promo-truth-p0)

## P2 — 6대 기능 총람 (마케팅 페이지 성격 — 웹 랜딩 반영)
- [ ] 🟢 데스크톱/랜딩에 6기능 소개 섹션 정합 (AI Planner·Charter·Tours·Route Map·Community·My Bookings)
- [ ] 🟢 My Bookings 카드형 목록 화면 (기존 /my-plans + bookings 통합 뷰)

## P3 — 위자드 5-step (🟡 5-step audit 의무 + dietary SAFETY)
- [ ] 상단 진행바 ✓✓③④⑤ 형
- [ ] Step1 Travel Dates(체크인/아웃 카드)
- [ ] Step2 Cities(썸네일 리스트 선택)
- [ ] **Step3 Travel Style(Solo/Couple/Family) — 신규 스키마 필드** (플래너 프롬프트 전파 여부 운영자 결정)
- [ ] Step4 Interests 칩(Culture·Food·Shopping·Nature·History·Nightlife)
- [ ] Step5 Budget(Mid-range 등) + Dietary(Halal·Vegan·Vegetarian·No Preference) — 🔴 dietary 전파 5지점 grep + P325 회귀 유지
- [ ] 하단 신뢰 4배지(Fast Setup·Safe Preferences·Multilingual·Editable)
- 보존: 호텔=anchor·도시 cycle 동기화·resume modal·dateRange.to·4-lang lint

## P4 — 플랜 결과 4화면 (🟡 stop 신스키마·PDF 금지사항·validator)
- [ ] Trip Overview: 히어로+통계 4칩(일수/정거장/km/최적화분)+Top Highlights
- [ ] Day Timeline: 시각축+교통 세그먼트(도보/지하철 아이콘)+하단 총계 3칩
- [ ] Interactive Route Map: 번호 핀+정거장 리스트 (기존 Leaflet 재스킨)
- [ ] Edit & Optimize: 정거장 재정렬·삭제 + 최적화 제안(Time/Transport/Walking) — 신규 로직
- [ ] Save·Share with Friends·Export PDF 액션 행 (PDF 기존, Share=신규 공유 링크)

## P5 — 교통 + 차터 업셀 (신규 킬러 기능)
- [ ] 🟡 일정 세그먼트 난이도 판정 로직(도보시간·환승수 기반 Easy/Challenging) — transit 실데이터 파생
- [ ] AI Route Insight 카드("이 구간 대중교통 힘듦") + [Book 3-Hour Charter] CTA
- [ ] 지도 범례(Easy 실선/Challenging 점선/Recommended)
- [ ] 차량 3종 선택 카드(스타리아 프리미엄/9인/스프린터) — 실차량 사진·SSOT 가격
- [ ] 가치 4배지(Less Walking·Save Time·Door to Door·Add Only When Needed)

## P6 — 차터 예약 6-step (🔴 SSOT byte-identical·P311 멱등성·운영자 승인)
- [ ] 진행바 6단계(Pickup→Destination→Date&Time→Vehicle→Contact→Review)
- [ ] Step1: 타입 4탭(공항/데이투어/멀티데이/K-pop) + 픽업지 + 항공편(선택) + 터미널/게이트
- [ ] Step2: 목적지 + 경유지 추가 + 편도/왕복
- [ ] Step4: 차량 4종 카드(스타리아 프리미엄·9인·스프린터·**차터버스 16+는 실상품 존재 확인 후**) + 좌석/짐 수
- [ ] Step6 Review: Trip Summary + What's Included(**실제 포함 내역만** — 전문기사·톨비주차비·24/7)
- [ ] 가치 4배지(Upfront Quote·Professional Driver·Flexible Stops·Multilingual)
- 보존: multidayQuote.ts ≡ charter-multiday-price.js·front/back FEATURE 쌍·국가번호 드롭다운

## P7 — 투어 4-step
- [ ] Discover: 검색 + 인기 목적지 칩 + 도시 카드(N Tours 카운트=실데이터)
- [ ] Filter: Interests 8칩 + Trip Style 3 + Duration 4 + "Show N Tours"(실카운트)
- [ ] 투어 상세: 뱃지·별점(🔴 REAL_TOUR_RATINGS 실데이터 채운 후 ON — 가짜 금지)·칩 3종·하이라이트 체크
- [ ] Custom Tour Inquiry: 관심사 태그(≤5)+Style 라디오+기간+인원 → 기존 맞춤투어 폼(#1037)/어드민 연동 재사용
- 보존: 결제 다이얼로그 배선(#1019)·tours SSOT

## P8 — 결제 4-step (🔴 운영자 승인 + 실 PayPal e2e)
- [ ] Booking Summary: Included Services = **실제 포함만** (호텔4박·보험 = 실상품 생기기 전 표기 금지)
- [ ] Contact Details: 기존 BookingInfoForm 재스킨(국가번호 드롭다운 유지)
- [ ] **쿠폰 지갑**: Available/Used/Expired 탭 + AI PLAN 무료·CHARTER 5%·Multi-Day 보너스 — 기존 쿠폰 백엔드(FEATURE_DISCOUNT_V2) 연동, 총10% 상한 로직 무변
- [ ] Booking Confirmed: 예약번호·Paid 배지·취소정책(**% 임계값 운영자 확정 후**)·지원 연락처
- 보존: capture 금액 대조·게스트 PII 마스킹·멱등성

## P9 — 커뮤니티 4화면 (기존 /community 셸에 스킨+기능)
- [ ] Community Home: 검색+카테고리 4탭(Travel·Living·Study·Food)+인기질문+➕FAB
- [ ] Ask & Translate: 원탭 번역(EN/한/日/中) + 번역 도움됐나요 👍👎 — 번역 백엔드 신규(Gemini 활용)
- [ ] Create Post: 언어탭+사진/위치/일정 첨부+Safety Check(모더레이션 기존 #1088 셸 확인)+Verified Helper
- [ ] Shared Itinerary: 플랜 공유 카드(지도+Day탭+타임라인)+Save Course — 기존 플랜 공유 링크 연동
- [ ] 신고(Report)·차단어 감지 — 기존 moderation 재사용

## P10 — 컴포넌트 라이브러리 (공용화)
- [ ] AI Planner Summary 카드 (홈에 1차 적용됨 — 공용 추출)
- [ ] Smart Pick Card("Why we love it" — 투어별 실 설명 데이터에서 파생)
- [ ] Interactive Route Map 카드(Optimize 토글)
- [ ] Charter Segment 카드(ITX-청춘 42min faster — intercity_transit 실데이터)
- [ ] Tour Card·Weather Card·AI Assistant 패널(음성 오브 = 신규 기능, 후순위)·Coupon Wallet(빈 상태 포함)·Community Translation·Booking Status 타임라인

## 운영자 결정 대기 (블로커)
1. 하단 내비 교체 여부 (Plan·Map·Assistant·Bookings·Profile)
2. 취소/환불 % 임계값 확정 (P8 표기)
3. 리뷰: REAL_TOUR_RATINGS 데이터 소스(구글리뷰 수집?) 확정
4. Travel Style(Solo/Couple/Family)을 플래너 프롬프트에 전파할지 (UI만 vs AI 반영)
5. 차터버스(16+·45석) 실상품 여부

## 진행 로그
- 2026-07-12: 홈 리디자인+아이콘 13종 (#1096) · 라이트 셸 연결 (#1094) · visual baseline (#1095)
