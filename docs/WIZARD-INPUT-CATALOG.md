# CocoTrip Wizard Input Catalog — SSOT v1.1

작성일: 2026-05-21 (v1.1 — P128 충돌 해소, PR #511~#518 머지 반영)
용도: 위자드 모든 input + 분기 + DB 매핑 SSOT
대상 채널: 이 채팅창 + DB 수집 채팅창 (식당/러닝/트레킹)
관련: HANDOFF-PLANNER-ROADMAP-2026-05-21.md v1.4

---

## 0. 핵심 원칙 (운영자 의도 7종 — 2026-05-21 받아적기)

1. **"디테일하게 나왔으면 해서"** — 위자드형 one-shot 선택 이유. 대화형 Q&A 반복 X. Step 1-2-3-4 사전 수집 후 Gemini 한 번에 생성.
2. **"호텔 → 이동 → 장소 → 복귀"** — 호텔 = 매일 동선의 출발/복귀 anchor. 모든 day 이 구조 유지 의무.
3. **"강제가 되면 안 되지"** — 호텔 input 은 옵셔널. 미입력 시 zone 중심 fallback 보장. 강제 입력 validation 금지.
4. **"위자드 1-4 스텝의 아이콘들 파악하고 만들어야 된다"** — DB ↔ 위자드 input 1:1 매칭. DB key 는 이 카탈로그 SSOT 기준.
5. **"러닝 클릭하면 5K 10K 한강 도심 — 플립 스타일처럼"** — Progressive Disclosure. 메인 → sub 계층. 처음부터 모든 옵션 노출 X.
6. **"호텔 예약 했/안 했 따라 다른 옵션 — 다른 선택지들도 다 체크"** — Conditional 분기 매트릭스 전수 audit 의무. 부분 audit 금지.
7. **"오늘 정말 큰 작업 완료. 상용화 성공 기원."** — 8 PR #511~#518 main 머지 (2026-05-21). 5 장기 후보 (Phase E) 정의.

---

## 1. 입력 옵션 카탈로그 (전수)

### 1.1 Step 0 — Reservation (예약 현황)

파일: `src/components/WizardForm/WizardStep0Reservation.tsx`

| 옵션 키 | 도메인 | Default | Required | i18n key | 비고 |
|---|---|---|---|---|---|
| `reservationStatus` | `'nothing' \| 'flight' \| 'flight_hotel' \| 'all_done'` | null | Yes (canContinue 필요) | resNothingTitle / resFlightTitle / resFlightHotelTitle / resAllDoneTitle | 4 quadrant 카드 |
| `arrivalAirport` | string (공항 코드) | '' | Conditional: status=flight 또는 flight_hotel 일 때 필수 | resAirport / resPickAirport | AIRPORT_OPTIONS 에서 도시별 필터 |
| `arrivalTime` | string (HH:MM) | '' | Conditional: status=flight 또는 flight_hotel 일 때 필수 | resArrivalTime | time input, RouteAgent transit 추천에 사용 |
| `hotelAddress` (Step0) | string | '' | Optional | resHotelAddress / wizardOptional | status=flight_hotel 시만 노출. status 변경 시 즉시 clear |

**canContinue 조건**: `status !== null && (!showAirportForm || (!!arrivalAirport && !!arrivalTime))`

**분기 트리거**: status 값에 따라 Step2 Details 의 airport 입력칸 + chip dedup 동작 변경 (P0 dedup, flightInfoFromStep0 조건).

---

### 1.1.1 AIRPORT_OPTIONS — 도시별 공항 dropdown

파일: `src/components/WizardForm/data.tsx:28-81`

| 도시 | 옵션 값 | 레이블 | 비고 |
|---|---|---|---|
| seoul | ICN_T1 | ICN Terminal 1 | |
| seoul | ICN_T2 | ICN Terminal 2 | |
| seoul | GMP | Gimpo Airport | |
| seoul | ALREADY | Already in Seoul | dead branch — 주의 (#4 분기) |
| incheon | ICN_T1 | ICN Terminal 1 | |
| incheon | ICN_T2 | ICN Terminal 2 | |
| incheon | ALREADY | Already in Incheon | |
| busan | PUS | Gimhae Airport (PUS) | |
| busan | ICN_T1 | ICN Terminal 1 | |
| busan | ALREADY | Already in Busan | |
| gyeongju | PUS | Gimhae Airport (PUS) | |
| gyeongju | ICN_T1 | ICN Terminal 1 | |
| gyeongju | ALREADY | Already in Korea | |
| daegu | TAE | Daegu Airport (TAE) | |
| daegu | PUS | Gimhae Airport (PUS) | |
| daegu | ALREADY | Already in Daegu | |
| jeju | CJU | Jeju Airport (CJU) | |
| jeju | ICN_T1 | ICN Terminal 1 | |
| jeju | ALREADY | Already in Jeju | |
| jeonju | MWX | Muan Airport (MWX) | |
| jeonju | ICN_T1 | ICN Terminal 1 | |
| jeonju | ALREADY | Already in Korea | |
| gangneung | YNY | Yangyang Airport (YNY) | |
| gangneung | ICN_T1 | ICN Terminal 1 | |
| gangneung | ALREADY | Already in Korea | |
| yeosu | RSU | Yeosu Airport (RSU) | |
| yeosu | ICN_T1 | ICN Terminal 1 | |
| yeosu | ALREADY | Already in Korea | |
| suwon | ICN_T1 | ICN Terminal 1 | |
| suwon | ICN_T2 | ICN Terminal 2 | |
| suwon | GMP | Gimpo Airport | |
| suwon | ALREADY | Already in Korea | |

**AIRPORT_DISPLAY 표시 맵** (UI 약식 표기): ICN_T1=ICN T1, ICN_T2=ICN T2, GMP=Gimpo, PUS=Gimhae (PUS), CJU=Jeju (CJU), TAE=Daegu (TAE), KWJ=Gwangju (KWJ), MWX=Muan (MWX), YNY=Yangyang (YNY), RSU=Yeosu (RSU), ALREADY=Already in KR

---

### 1.2 Step 1 — Destinations (목적지 + 액티비티)

파일: `src/components/WizardForm/WizardStep0Destination.tsx`

#### 1.2.1 도시 선택

| 옵션 키 | 도메인 | Default | Required | i18n key |
|---|---|---|---|---|
| `mainCity` (string) | getCityName(key) 결과 | '' | Yes (canGoStep1 필요) | wizardTitle / wizardTitleSub |
| `mainCityKey` (string) | CITY_CHIPS.key 중 하나 | '' | Yes | — |
| `extraCities` (string[]) | 도시명 배열 | [] | No | wizardCitySelected |
| `selectedCityKeys` (string[]) | CITY_CHIPS.key 배열 | [] | No | — |
| `arrivalCityKey` (string) | CITY_CHIPS.key | '' | No (P125) | wizardArrivalBadge |
| `departureCityKey` (string) | CITY_CHIPS.key | '' | No (P125) | wizardDepartureBadge |

**CITY_CHIPS 전체** (10 도시, data.tsx:15-26):
`seoul` / `busan` / `jeju` / `gyeongju` / `jeonju` / `gangneung` / `incheon` / `suwon` / `yeosu` / `daegu`

**P125 cycle 동작** (handleCityClick):
- 미선택 → 선택 + role 자동 할당 (arrivalCityKey 없으면 arrival, departureCityKey 없으면 departure)
- 선택 + role 없음 → arrival 또는 departure 채움
- arrival → departure (다른 selected city 자동 arrival 승계)
- departure → deselect (cycle 닫기)

#### 1.2.2 Quick Start Presets (5종)

| 프리셋 라벨 | mainCity | extraCities | activities | days |
|---|---|---|---|---|
| '3 Days Seoul Highlights' | seoul | — | Food, Photo, Shopping | 3 |
| 'Seoul + Busan 5 Days' | seoul | [busan] | Food, Photo, Temple | 5 |
| 'K-pop Fan Trip' | seoul | — | Kpop, Shopping, Photo | — |
| 'Foodie Tour Seoul' | seoul | — | Food, Night, Shopping | — |
| 'Jeju Nature Healing' | jeju | — | Photo, Food, Temple | — |

B-1 fix (2026-05-11): days 명시 preset 은 setDateRange 동시 호출 — dateRange.to 빠짐 방지.

#### 1.2.3 Activities — Universal (4종, 항상 노출)

| key | i18n key | 아이콘 |
|---|---|---|
| Food | actFood | UtensilsCrossed |
| Photo | actPhoto | Camera |
| Shopping | actShopping | ShoppingBag |
| Night | actNight | Moon |

#### 1.2.4 Activities — City-specific (도시 선택 시만 노출)

| 도시 | City-specific activity keys |
|---|---|
| seoul | Kpop, Kbeauty, Hanbok, Drama, Temple, Dmz, Palace |
| busan | Jagalchi, Gamcheon, Haeundae, BusanFood |
| jeju | OlleTrail, Hallasan, Haenyeo, JejuFood |
| gyeongju | Bulguksa, Anapji, GyeongjuHanok |
| jeonju | HanokVillage, Makgeolli, JeonjuFood |
| gangneung | CoffeeStreet, GangneungBeach |
| yeosu | YeosuLights, CableCar |
| suwon | Hwaseong |
| incheon | ChinaTown |
| daegu | DaeguTower |

다도시 plan: 모든 선택 도시의 activity UNION (Universal 4 dedup). `getActivitiesForCities()` 함수 사용.

#### 1.2.5 Activities — Expanded (숨김, "+ Show more" 클릭 시 노출)

파일: `data.tsx:189-221` — `ACTIVITY_CHIPS_EXPANDED`

| key | group | free |
|---|---|---|
| Trekking | outdoor | true |
| HangangBike | outdoor | true |
| HangangRun | outdoor | true |
| CheonggyecheonWalk | outdoor | true |
| SeoulDoolegil | outdoor | true |
| NamsanHike | outdoor | true |
| FreeMuseum | culture_free | true |
| GwangjangView | culture_free | true |
| KpopStreetWatch | culture_free | true |
| BookstoreCafe | culture_free | false |
| Jjimjilbang | wellness | false |
| HangangPicnic | wellness | true |

PR #518 반영: busan 5 city_day + jeju 4 city_day + 한라산/설악산 트레킹 + 제주 올레 러닝 11 zone block 추가. OlleTrail/Hallasan 등은 city-specific 으로 이미 매핑.

#### 1.2.6 freeText (선택 장소 직접 입력)

| 옵션 키 | 도메인 | Default | Required | i18n key |
|---|---|---|---|---|
| `freeText` | string | '' | No | wizardFreeInput / wizardFreeInputPh |

---

### 1.3 Step 2 — Food Preferences (음식 선호도)

파일: `src/components/WizardForm/WizardStep1Food.tsx`

#### 1.3.1 dietPrefs (Food Style, 3종)

`FOOD_STYLE_KEYS` = `['Seafood', 'Meat', 'Street']`

| key | i18n key | 비고 |
|---|---|---|
| Seafood | foodSeafood / foodSeafoodSub | 해산물 |
| Meat | foodMeat / foodMeatSub | 육류 |
| Street | foodStreet / foodStreetSub | 길거리 음식 |

Multi-select. 빈 배열 = 제한 없음 (any style).

#### 1.3.2 allergies (Dietary Restrictions, 7종)

`ALLERGY_KEYS` = `['Halal', 'Vegan', 'Nuts', 'Shellfish', 'Gluten', 'Dairy', 'None']`

SAFETY-CRITICAL: Halal/Vegan/알레르기 데이터는 health 위험 등급 — silent drop 절대 금지. CLAUDE.md J 항목 참조.

| key | i18n key | 비고 |
|---|---|---|
| Halal | allergyHalal | 종교적 의무 — Dietary Restrictions 그룹 (P10) |
| Vegan | allergyVegan | 윤리적 제한 — Dietary Restrictions 그룹 (P10) |
| Nuts | allergyNuts | 견과류 알레르기 |
| Shellfish | allergyShellfish | 조개류 알레르기 |
| Gluten | allergyGluten | 글루텐 불내증 |
| Dairy | allergyDairy | 유제품 불내증 |
| None | allergyNone | "None" 은 allergies[] 빈 배열일 때 선택 표시 (clear all) |

**UI 규칙**: 'None' 은 마지막 위치 고정 (배열 정렬 중요). toggleAllergy('None') 시 allergies 배열 전체 clear.

#### 1.3.3 spiceLevel (매운맛 4단계)

`SPICE_LEVEL_KEYS` = `['none', 'mild', 'medium', 'hot']`

| key | i18n key (label) | i18n key (sub) | 기준 |
|---|---|---|---|
| none | spiceNone | spiceNoneSub | 안 매운 음식만 |
| mild | spiceMild | spiceMildSub | 가벼운 매콤 |
| medium | spiceMedium | spiceMediumSub | 김치 정도 |
| hot | spiceHot | spiceHotSub | 불닭/엽기떡볶이 |

Single-select. 4-step 슬라이더 UI (grid-cols-4).

#### 1.3.4 bucketDishes (한식 버킷리스트, 8종)

`KOREAN_BUCKET_LIST` = `['kbbq', 'kfc', 'tteokbokki', 'bibimbap', 'samgyetang', 'naengmyeon', 'jokbal', 'sundubu']`

| key | i18n key | 영문 fallback |
|---|---|---|
| kbbq | bucketKbbq | Korean BBQ |
| kfc | bucketKfc | Korean fried chicken |
| tteokbokki | bucketTteokbokki | Tteokbokki |
| bibimbap | bucketBibimbap | Bibimbap |
| samgyetang | bucketSamgyetang | Samgyetang |
| naengmyeon | bucketNaengmyeon | Naengmyeon |
| jokbal | bucketJokbal | Jokbal/Bossam |
| sundubu | bucketSundubu | Sundubu jjigae |

Multi-select. Gemini 프롬프트에 inject → 일정에 자연 배치.

#### 1.3.5 priceRange (식사 예산)

`PRICE_KEYS` = `['Budget', 'Moderate', 'Premium', 'Any']`

| key | i18n key | i18n (range) |
|---|---|---|
| Budget | priceBudget | priceBudgetRange |
| Moderate | priceModerate | priceModerateRange |
| Premium | pricePremium | pricePremiumRange |
| Any | priceAny | priceAnyRange |

Single-select. grid-cols-2 UI.

---

### 1.4 Step 3 — Details (여행 세부 정보)

파일: `src/components/WizardForm/WizardStep2Details.tsx`

#### 1.4.1 dateRange (여행 일정)

| 옵션 키 | 도메인 | Default | Required | i18n key |
|---|---|---|---|---|
| `dateRange.from` | Date | undefined (auto-init tomorrow P126) | Yes (canGoStep3) | wizardWhenVisit |
| `dateRange.to` | Date | undefined | Yes (canGoStep3) | — |

P126 주의: `dateRange.from` 은 tomorrow 자동 init — `hasMeaningfulWizardContent()` 에서 `from` 제외 의무. `to` 만 포함.

#### 1.4.2 paxInput (여행자 수)

| 옵션 키 | 도메인 | Default | Required |
|---|---|---|---|
| `paxInput` | string (number) | '2' | No (backend default 2) |

P126: paxInput !== '2' 일 때만 hasContent 에 포함.

#### 1.4.3 arrivalTerminal (도착 공항 — Step3 입력)

| 조건 | UI 동작 |
|---|---|
| `flightInfoFromStep0=true` | chip 표시 + Edit 버튼 (Step0 jump) |
| `flightInfoFromStep0=false` | MobileSelectDrawer 드롭다운 노출 |

`flightInfoFromStep0` = `!!onEditStep0 && reservationStatus === 'flight' && !!arrivalTerminal && !airportTouchedInStep3`

Required (canGoStep3): `!!arrivalTerminal || flightInfoFromStep0`

#### 1.4.4 hotelAddress / hotelByCity (숙소 주소)

| 모드 | 조건 | 상태 키 | 비고 |
|---|---|---|---|
| 단도시 | `!isMultiCity && !wantAccom` | `hotelAddress: string` | 단일 input |
| 다도시 | `isMultiCity && !wantAccom` | `hotelByCity: Record<string, string>` | 도시별 input (P123) |
| AI 추천 | `wantAccom=true` | hotelAddress cleared | mutual exclusion (P1) |

`hotelByCity` 는 cityKeys 배열 기준 — 모든 도시 호텔 비어있으면 ZoneRecommender 노출.

SAFETY: 빈 객체 `{}` 도 유효. backend 에서 호텔 없음 분기 처리 의무 (3 layer: frontend 전달 / backend 프롬프트 분기 / planPersister.backfillDayLodging).

#### 1.4.5 arrivalTime / departureTime

| 옵션 키 | 노출 조건 | Required | i18n key |
|---|---|---|---|
| `arrivalTime` | `!flightInfoFromStep0` | No | arrivalTime / wizardOptional |
| `departureTime` | 항상 노출 | No | departureTime / wizardOptional |

P124: arrival time → 도착 당일 sleep buffer (arrival+9h 이전 활동 차단). departure time → 마지막 날 -3h 차단.

#### 1.4.6 luggage (수화물)

| 옵션 키 | 도메인 | Default | i18n key |
|---|---|---|---|
| `luggageSmall` | number (0+) | 0 | luggageSmall / luggageSmallSub |
| `luggageMedium` | number (0+) | 0 | luggageMedium / luggageMediumSub |
| `luggageLarge` | number (0+) | 0 | luggageLarge / luggageLargeSub |

vehicleCount 계산: 1-7개=1대, 8+=2대, 14+=3대, +6/대 (calcVehicleCount). 8+ 시 amber 안내 (비차단). luggageHardCap = 합계 >= 99.

#### 1.4.7 tourPace (하루 투어 강도)

`TOUR_PACE_KEYS` = `['half', 'short', 'full', 'action']`

| key | 시간 | stops | 구역 | i18n key |
|---|---|---|---|---|
| half | 4h | 1-2 | 한 동네 집중 | tourPaceHalf / tourPaceHalfSub |
| short | 6h | 3-4 | 한 구역 위주 | tourPaceShort / tourPaceShortSub |
| full | 8h | 5-6 | 인접 2구역 (표준) | tourPaceFull / tourPaceFullSub |
| action | 10h+ | 7+ | 자유 이동 | tourPaceAction / tourPaceActionSub |

Backend 매핑: half/short→relaxed (단일 zone), full→standard (2 zones), action→packed (free).

#### 1.4.8 wantAccom + accomBudget (숙소 AI 추천)

| 옵션 키 | 도메인 | Default | 연동 |
|---|---|---|---|
| `wantAccom` | boolean | false | true 시 hotelAddress clear (P1 mutual exclusion) |
| `accomBudget` | 'budget' \| 'moderate' \| 'luxury' | '' | wantAccom=true 시만 노출 |

i18n: accomOptIn / accomOptInSub / accomBudgetLabel / accomBudget1 / accomBudget2 / accomBudget3

#### 1.4.9 isMultiCity + mainCityKey (다도시 분기 컨트롤)

| 옵션 키 | 도메인 | 비고 |
|---|---|---|
| `isMultiCity` | boolean | extraCities.length > 0 시 true |
| `mainCityKey` | string | onEntryCityChange 로 다도시에서 변경 가능 (entryCity 라디오) |
| `cityKeys` | string[] | 모든 선택 도시 key 배열 |

---

### 1.5 Step 4 — Review (요약 확인)

파일: `src/components/WizardForm/WizardStep3Review.tsx`

input 없음. 요약 표시 + summary card edit 점프 + Generate 버튼.

표시 필드: allCities / startDate / endDate / arrivalTerminal / pax / selectedActivities / hotelAddress (단도시만)

주의: `hotelByCity` 는 Review step 에서 표시 안 됨 — 다도시 anchor 표시 누락 (P127 연관, HIGH 위험).

---

## 2. Conditional 분기 매트릭스 (전수, 38 분기)

### 2.1 Step 0 Reservation 분기 (#1-#6)

| # | 분기 조건 | 영향 | Backend payload | Cleanup | 위험도 | 연관 P# |
|---|---|---|---|---|---|---|
| #1 | `status='nothing'` | arrivalAirport/Time 미수집 | reservation_status: 'nothing' 전달 | — | 🟠 MEDIUM | P102 |
| #2 | `status='flight'` → 다른 status | arrivalAirport/Time 기입 후 전환 | — | arrivalAirport/Time clear 필요 | 🟠 MEDIUM | — |
| #3 | `status='flight_hotel'` | arrivalAirport + arrivalTime + hotelAddress(Step0) 3개 동시 노출 | hotelAddress 전달 의무 | status 변경 시 hotelAddress clear (구현됨) | 🟡 LOW | — |
| #4 | `status='flight_hotel'` → Step2 | flightInfoFromStep0=true → airport chip 모드 전환 | arrivalTerminal 재사용 | Step3 에서 공항 직접 입력 시 chip 해제 (airportTouchedInStep3) | 🟡 LOW | — |
| #5 | `status='all_done'` | all_done 안내 노출 → free claim 유도 (별도 flow) | reservation_status: 'all_done' | — | 🟡 LOW | — |
| #6 | `ALREADY` 공항 값 | 공항 이동 불필요 (이미 현지 체류) | ALREADY 전달 → backend 처리 필요 | dead branch 위험 — backend 처리 확인 필요 | 🟠 MEDIUM | — |

### 2.2 Step 1 Destinations 분기 (#7-#14)

| # | 분기 조건 | 영향 | Backend payload | Cleanup | 위험도 | 연관 P# |
|---|---|---|---|---|---|---|
| #7 | `selectedCityKeys.length === 0` | activityKeys = 레거시 ACTIVITY_KEYS fallback (10종) | mainCityKey 미전달 → 오류 | — | 🟡 LOW | — |
| #8 | Quick Start preset 클릭 | mainCity / activities / dateRange 동시 set | 모든 preset 필드 payload | dateRange.to 동시 set 의무 (B-1 fix) | 🟠 MEDIUM | P131 |
| #9 | `mainCity` 변경 (cycle) | airportOptions 재계산 (mainCityKey 기준) | mainCityKey 동기화 | — | 🟡 LOW | — |
| #10 | `selectedCityKeys.length >= 2` → 도시 제거 | arrivalCityKey/departureCityKey 잔존 stale | arrival/departureCityKey cleanup | P125 cycle handler 에서 cleanup. useReducer 통합 미완 | 🔴 HIGH | P125 / P129 |
| #11 | `arrivalCityKey` 설정 | Step3 entryCity 라디오 연동 | arrivalCityKey backend 전달 | — | 🟡 LOW | P125 |
| #12 | `departureCityKey` 설정 | Step3 departure day 인식 | departureCityKey backend 전달 | — | 🟡 LOW | P125 |
| #13 | activities 선택 없음 | canGoStep1=false → Next 블로킹 | selectedActivities 배열 필수 | — | 🟡 LOW | — |
| #14 | 다도시 + freeText 입력 | 어느 도시 context 인지 불명 | freeText 전달 — backend 에서 mainCity 기준 해석 | — | 🟡 LOW | — |

### 2.3 Step 2 Food 분기 (#15-#18)

| # | 분기 조건 | 영향 | Backend payload | Cleanup | 위험도 | 연관 P# |
|---|---|---|---|---|---|---|
| #15 | `allergies.includes('Halal')` | Halal 전용 식당 필터 필수 | allergies 배열 전달 | — | 🟠 MEDIUM (SAFETY) | P43 / CLAUDE.md J |
| #16 | `allergies.includes('Vegan')` | Vegan 전용 필터 | allergies 배열 전달 | — | 🟠 MEDIUM (SAFETY) | CLAUDE.md J |
| #17 | `allergies.length === 0` (None 선택) | 제한 없음 — 일반 식당 추천 | allergies: [] | — | 🟠 MEDIUM | CLAUDE.md J |
| #18 | `bucketDishes.length > 0` | Gemini 프롬프트에 버킷 메뉴 inject | bucketDishes 배열 전달 | — | 🟡 LOW | — |

### 2.4 Step 3 Details 분기 (#19-#32)

| # | 분기 조건 | 영향 | Backend payload | Cleanup | 위험도 | 연관 P# |
|---|---|---|---|---|---|---|
| #19 | `dateRange` 미설정 | canGoStep3=false | — | — | 🟡 LOW | — |
| #20 | `flightInfoFromStep0=true` | airport chip 모드 (Step0 데이터 재사용) | arrivalTerminal from Step0 | airportTouchedInStep3=false 상태 유지 | 🟡 LOW | — |
| #21 | `flightInfoFromStep0=false` | airport dropdown 직접 입력 | arrivalTerminal from Step3 | — | 🟡 LOW | — |
| #22 | `status='flight_hotel'` + Step2 도달 | Step0 에서 입력한 hotelAddress 를 Step3 에 표시해야 함 | hotelAddress 전달 의무 | Step0→Step3 hotelAddress 연결 확인 필요 | 🔴 HIGH | P123 |
| #23 | `wantAccom=true` | hotelAddress input 숨김 + accomBudget 노출 | wantAccom+accomBudget 전달 | hotelAddress clear (P1 mutual exclusion) | 🟠 MEDIUM | — |
| #24 | `isMultiCity=true` | entryCity 라디오 + hotelByCity 다도시 입력 노출 | hotelByCity Record 전달 (P123) | — | 🟡 LOW | P122 / P123 |
| #25 | `isMultiCity=false` | 단도시 hotelAddress 단일 input | hotelAddress 전달 | — | 🟡 LOW | — |
| #26 | `hotelAddress.trim().length === 0 && !isMultiCity` | ZoneRecommender 노출 (단도시) | recommendedZones 전달 | — | 🟡 LOW | — |
| #27 | 다도시 + 모든 도시 hotel 비어있음 | ZoneRecommender 노출 (다도시) | recommendedZones 전달 | — | 🟡 LOW | — |
| #28 | `luggageTotal >= 8` | amber 경고 노출 (비차단) + vehicleCount 계산 | luggageSmall/Medium/Large 전달 | — | 🟡 LOW | — |
| #29 | `arrivalTime` 입력 | P124 sleep buffer 활성화 | arrivalTime 전달 | — | 🟡 LOW | P124 |
| #30 | `departureTime` 입력 | P124 마지막 날 -3h 차단 | departureTime 전달 | — | 🟡 LOW | P124 |
| #31 | `tourPace='half'` 또는 `'short'` | backend relaxed mode (단일 zone) | tourPace 전달 | — | 🟡 LOW | — |
| #32 | `selectedActivities` 에 Trekking/HangangRun 등 포함 | backend 에 outdoor 활동 신호 | activities 배열 전달 | DB 인덱스 연결 확인 (_running_index / _trekking_index PR #518) | 🟠 MEDIUM | P114 / P88 |

### 2.5 Step 4 Review 분기 (#33-#36)

| # | 분기 조건 | 영향 | Backend payload | Cleanup | 위험도 | 연관 P# |
|---|---|---|---|---|---|---|
| #33 | `hotelAddress` 표시 (단도시만) | Review 에서 호텔 anchor 보임 | — | hotelByCity 다도시 anchor 미노출 (P127) | 🔴 HIGH | P127 |
| #34 | 다도시 + hotelByCity — Review 미노출 | 사용자가 다도시 호텔 확인 불가 | — | Review 에 hotelByCity summary 추가 권장 | 🔴 HIGH | P127 |
| #35 | `language='ja'` 또는 `'zh'` | 가격 보조 환산 포맷 (¥JPY / ¥CNY) | — | — | 🟡 LOW | — |
| #36 | Generate 버튼 → PayPal 결제 | isLoading=true → 버튼 비활성 + 로딩 텍스트 | — | errorMsg 표시 (빨간 박스) | 🟡 LOW | — |

### 2.6 Resume Snapshot 분기 (#37-#38)

| # | 분기 조건 | 영향 | 위험도 | 연관 P# |
|---|---|---|---|---|
| #37 | `hasMeaningfulWizardContent(snapshot)=true` | resume modal 노출 | 🟠 MEDIUM | P126 |
| #38 | `hasMeaningfulWizardContent=false` (clicker-only) | modal 미노출 — dateRange.from auto-init 제외 필수 | 🟠 MEDIUM | P126 |

---

## 3. 회귀 위험도 요약

### 🔴 HIGH — 즉시 수정 필요 (3건)

| # | 위치 | 내용 |
|---|---|---|
| #10 | Step1 Destination | toggleCity 후 arrivalCityKey/departureCityKey stale — P125 cycle + cleanup useReducer 통합 미완 (P129 후보) |
| #33/#34 | Step4 Review | 다도시 hotelByCity Review 미노출 — 사용자가 도시별 호텔 anchor 확인 불가 (P127) |
| #22 | Step0→Step3 | status='flight_hotel' 시 Step0 hotelAddress 가 Step3 표시 + payload 연결 확인 필요 |

### 🟠 MEDIUM — 다음 PR 우선 처리 (9건)

| # | 내용 |
|---|---|
| #1 | reservation_status payload backend 처리 분기 확인 |
| #2 | status 변경 시 arrivalAirport/Time clear 자동화 |
| #6 | ALREADY 공항 값 backend dead branch 확인 |
| #8 | Quick Start preset dateRange.to 동시 set (P131) |
| #15-17 | Halal/Vegan 식이제한 — chain 5개 지점 전수 grep (CLAUDE.md J) |
| #23 | wantAccom mutual exclusion hotelAddress clear 타이밍 |
| #32 | Trekking/러닝 activities → _running_index.json / _trekking_index.json DB 인덱스 연결 |
| #37-38 | resume modal hasMeaningfulWizardContent P126 보강 (P130) |

### 🟢 LOW — 장기 처리 (24건)

#3 / #4 / #5 / #7 / #9 / #11 / #12 / #13 / #14 / #18 / #19 / #20 / #21 / #24~31 / #35 / #36

---

## 4. DB ↔ 위자드 매핑 매트릭스

| 위자드 input | DB 인덱스 파일 | 매핑 키 | 비고 |
|---|---|---|---|
| dietPrefs + allergies | api/_food_index.json | categoryKey / halal / vegan / allergen flags | getFoodContext() 함수, P114 per-city guard |
| priceRange | api/_food_index.json | priceRange 필드 | Budget/Moderate/Premium/Any 매핑 |
| spiceLevel | api/_food_index.json | spiceTolerance 필드 | none/mild/medium/hot |
| bucketDishes | Gemini 프롬프트 직접 inject | — | DB 매칭 없음, prompt 기반 |
| tourPace | api/_ai_core/buildPrompt.js | _PACE_HOURS (half/short/full/action) | 시간 예산 매핑 |
| cityKey (mainCityKey) | api/_food_index.json | cityKey 필드 | P114 dbMatcher per-day city guard |
| activities | api/_food_index.json + 향후 _running/_trekking | subCategoryKey 매핑 | PR #518 trekking/running PoC |
| zones (recommendedZones) | zoneData.ts anchorAddress | RouteAgent geocoding input | zone anchor → Naver geocoding |
| arrivalCityKey | buildPrompt.js ARRIVAL CITY block | — | P125 입국 도시 |
| departureCityKey | buildPrompt.js DEPARTURE CITY block | — | P125 출국 도시 |

### CITY_MAP 약점 (알려진 한계)

| 도시 | backend CITY_MAP 처리 | 주의 |
|---|---|---|
| suwon | seoul 로 fallback | 수원 전용 foodIndex 없음 → 서울 식당 추천 |
| yeosu | busan 으로 fallback | 여수 전용 foodIndex 없음 → 부산 식당 추천 |
| incheon | seoul 공유 | 인천 식당 DB 제한 |

### 신규 인덱스 예정 (PR #518 일부 구현)

- `api/_running_index.json` — 러닝 코스 (한강변 / 도심 / 공원), 거리별 5K/10K/하프
- `api/_trekking_index.json` — 등산/트레킹 코스 (한라산/설악산/북한산/올레 등)
- Phase E #2: 강원/충청/경상 zone block 추가 (zoneData.ts 확장)

---

## 5. i18n 4-lang 누락 영역

| 위치 | fallback 패턴 | 추가 권장 key | 연관 |
|---|---|---|---|
| WizardStep0Destination.tsx:188 | `p.wizardArrivalDepartureHint \|\| '도시를 한 번 더 누르면...'` | wizardArrivalDepartureHint (ko/en/ja/zh) | P125 |
| WizardStep0Destination.tsx:218 | `p.wizardArrivalBadge \|\| '입국'` | wizardArrivalBadge 4-lang | P125 |
| WizardStep0Destination.tsx:219 | `p.wizardDepartureBadge \|\| '출국'` | wizardDepartureBadge 4-lang | P125 |
| ACTIVITY_CHIPS_EXPANDED | `key.replace(/([a-z])([A-Z])/g, '$1 $2')` fallback | actTrekking / actHangangBike / actHangangRun / ... 4-lang | — |
| CITY_ACTIVITIES 신규 chip | labelFallback 패턴 | actOlleTrail / actHallasan / actHaenyeo / ... 4-lang | — |
| WizardStep2Details.tsx:375 | `p.multicityHotelLabel \|\| '{city} hotel'` | multicityHotelLabel 4-lang | P122 |
| WizardStep2Details.tsx:271 | `p.entryCityTitle \|\| 'Which city are you arriving in?'` | entryCityTitle 4-lang | P125 |

R-P132 lint rule 후보: `scripts/lint-i18n-coverage.mjs` — WizardForm/data.tsx 키 추출 후 4 locales 파일 교차 확인.

---

## 6. 통합 권장 (메타 lesson)

### 6.1 useReducer 통합 후보 (P129 패턴 확장)

현재 독립 useState 로 분산된 상태 중 연쇄 cleanup 필요 그룹:

| 그룹명 | 포함 상태 | 통합 이유 |
|---|---|---|
| CityGroup | mainCity / mainCityKey / extraCities / selectedCityKeys / arrivalCityKey / departureCityKey | P125 cycle ↔ cleanup race condition (#10) |
| ReservationGroup | reservationStatus / arrivalAirport / arrivalTime / hotelAddress(Step0) | status 변경 시 3개 cleanup 동시 처리 |
| AccomMutexGroup | wantAccom / hotelAddress / accomBudget | mutual exclusion P1 |

### 6.2 자동 cleanup useEffect 강화 위치 (4곳)

1. `Step0 Reservation`: status !== 'flight_hotel' → hotelAddress '' (구현됨, 단 arrivalAirport/Time cleanup 미완)
2. `Step0/1 Destination`: city 제거 시 → arrivalCityKey/departureCityKey cleanup (P125 #10)
3. `Step3 Details`: wantAccom=true → hotelAddress '' (구현됨, mutual exclusion)
4. `Step3 Details`: isMultiCity 전환 시 → hotelAddress ↔ hotelByCity 전환 cleanup

### 6.3 Lint Rules 후보

| 규칙명 | 목적 | 파일 |
|---|---|---|
| R-P133 | DB categoryKey 자유 라벨 금지 — 이 카탈로그 SSOT key 사용 의무 | scripts/lint-catalog-keys.mjs |
| R-P132 | 4-lang i18n 누락 자동 검출 | scripts/lint-i18n-coverage.mjs |
| R-CleanupSym | state A 변경 시 state B cleanup useEffect 존재 확인 | scripts/mistake-lint.mjs |
| R-DiscriminatedUnion | reservationStatus 분기 누락 케이스 정적 검사 | TypeScript strict |
| R-PresetCompleteness | Quick Start preset 클릭 후 canGoStep3 통과 단위 테스트 | vitest |

---

## 7. P-번호 충돌 해소 (2026-05-21)

다른 채팅창 (feat/intent-classifier-monitoring) 에서 PR #516 이 P134 점유:
- **다른 채팅창 P134** = block-mode 분기 + ai-planner-modify endpoint + intent classifier 통합
- **이 채팅창 P134 (재명명 대기)** = 호텔 = 동선 anchor (옵셔널, zone 중심 fallback) — Phase B

두 영역이 다르므로 이 채팅창의 호텔 의도 fix 는 별도 P 번호 부여 필요 (다음 세션 first action).

현재 이 채팅창 예약 번호: P129(useReducer) / P130(resume) / P131(preset) / P132(i18n lint) / P133(catalog lint) / P134(호텔 의도 — 번호 충돌 재확인 필요) / P127(lodging_bookend multi-city anchor — 기존 완료)

---

## 8. DB 수집 채팅창 전달 (요약)

DB 수집 작업을 별도 채팅창에서 진행 중인 경우 아래 규약 준수:

1. **카테고리 키 자유 라벨 금지** — 이 카탈로그 §1 의 SSOT key 사용 (foodSeafood, actOlleTrail 등)
2. **DB row 의무 필드**:
   - `categoryKey` (이 카탈로그 §1 에서 추출)
   - `cityKey` (CITY_CHIPS.key 10종 중 하나)
   - `subCategoryKey` (activity key 또는 zone key)
   - `name` (한국어, Naver 검색용)
   - `display_name` (4-lang 사용자 표시용)
   - `tip` (4-lang 팁 텍스트)
3. **신규 인덱스 (러닝/트레킹)** — PR #518 일부 구현. 강원/충청/경상 추가 Phase E #2
4. **회귀 패턴 인용**: P114 (dbMatcher city mismatch) / P88 (B-MEAL snack slot) / P86 (repair dropped guides) / P90 (dbMatcher city guard)
5. **자세한 가이드**: `docs/DB-COLLECTION-GUIDE.md` (별도 재생성 대기)

---

## 9. 변경 이력

| 날짜 | 버전 | 내용 |
|---|---|---|
| 2026-05-21 | v1.0 | 최초 작성 (Phase A SSOT) |
| 2026-05-21 | v1.1 | P128 충돌 해소 / PR #511~#518 반영 / P127 lodging_bookend multi-city anchor 추가 / 분기 #33-#34 HIGH 위험도 조정 |
