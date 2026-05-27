# ADR — DB 블록 갈아끼우기 시스템 (2026-05-27)

작성일: 2026-05-27
작성자 채팅창: CocoTripKR 위자드 시스템 본격 구현 시작 (Phase 1 architecture design)
관련 채팅창 (메모리): `project_cocotrip_wizard_system_design`, `project_db_collection_handoff_2026_05_23`, `project_cocotrip_dead_data_240_analysis_2026_05_25`
관련 코드: `api/_ai_core/blockMode.js` (P128/P167), `api/_ai_core/buildPrompt.js`, `api/_ai_core/dbMatcher.js`, `api/_ai_core/agents/RouteAgent.js`
관련 문서: `docs/HANDOFF-PLANNER-ROADMAP-2026-05-21.md` v1.4 (Phase A-E)

상태: **PROPOSED** — Phase 1 design, 운영자 결정 5건 대기. 코드 변경 0.

---

## 1. 운영자 의도 (한 줄)

> **"장소가 파란 블록이라면 호텔은 빨간 블록. 갈아끼우기만 하면 plan 결과 유지."**

= 사전 큐레이트된 검증 DB 블록을 사용자 input (도시 / 인원 / 날짜 / 테마 / 호텔 / 식이) 에 맞춰 갈아끼움 → Gemini 비결정성 영향 0 + Gemini/ODsay 호출 최소화.

비유: 레고 블록. 사용자가 "서울 3일 + 비건 + 호텔 명동 + 테마 K-pop" 입력 → 시스템이 사전 검증된 블록 3개를 끼움 → Gemini 는 *블록 선택 + 1줄 tweak 만* 책임. 매번 새로 동선/장소/식당/이동을 추론하지 않음.

---

## 2. 현재 상태 vs 목표 상태

| 영역 | 현재 | 목표 (블록 갈아끼우기) |
|---|---|---|
| **호텔 (lodging)** | 사용자 free-text input, src/data/hotels.ts 36개 카드 (Trip.com 어필리에이트). 매번 RouteAgent 가 lat/lng geocode 호출 | 호텔 DB (도시 × 가격대 × 동선 zone 매칭) — 갈아끼우기 anchor |
| **식당 (food)** | `_food_index.json` 1.2MB (rating≥4.5, reviews≥50). dbMatcher 가 Gemini 출력 → DB 매칭 (3-tier exact/partial/brand). city-mismatch HARD REJECT (P183) | **이미 95% 완성** — Gemini 출력 → 매칭 대신 placeholder slot 직접 sampling (block-mode 기존 패턴) |
| **관광지 (culture / attraction)** | Gemini 가 매번 freeform 생성. **P190 (5/25)** 가 `_attractions_index.json` (museums 50 + temples 50 + night_spots 30 = 130 row) prompt 주입 시작. **갈아끼우기 X — prompt hint 만**. P191 mountain DB 동일 | 카테고리별 갈아끼우기 (museums / temples / night_spots / mountains / shopping / nature / activities) |
| **이동방법 (intercity)** | `STATION_COORDS` (KTX/airport/bus 터미널 좌표 28개) 캐시 ✅. RouteAgent → ODsay searchTransitRoute() **매 stop 마다 호출**. 다도시 day 의 intercity transit (KTX/항공/고속버스) 도 매번 ODsay+Naver | intercity transit DB (서울↔부산 KTX / 서울↔제주 항공 / 호텔↔공항 등 자주 사용 경로 캐시) + transit_matrix 사전 빌드 |
| **이동방법 (intracity)** | ODsay searchPubTransPathT 매 segment 호출 | zone_courses block 의 `transit_matrix` 사전 빌드 (현재 mock placeholder — Phase 3 의무) |
| **블록 시스템 자체** | **P128 block-mode 이미 구현** (`blockMode.js` 1115L). Firestore `zone_courses` 컬렉션에서 city × intensity × dietary 필터 fetch → Gemini 가 block_id 만 선택 → expandBlocksToItinerary. **단도시 + P167 다도시 모두 지원** | `PLANNER_BLOCK_MODE=auto` env 활성화 + Firestore 시드 + transit/lat/lng 실측 빌드 |
| **zone_courses 데이터** | **disk 에 101 JSON 파일** (busan 7 / seoul 9 / jeju 7 / gyeongju 3 / pyeongchang 2 / sokcho 3 / 그 외 도시 24+ / 러닝 코스 14 + 트레킹 4). 단 `lat/lng:0` + `transit_matrix.source: 'mock'` (build-zone-course.mjs ENV 없이 빌드). Firestore 미시드 (`status:published` 0건 → block-mode 자동 비활성) | NCP+ODsay env 로 재빌드 → lat/lng 실측 + transit 실측 → Firestore admin 페이지에서 publish |
| **wizard input 카탈로그** | `docs/WIZARD-INPUT-CATALOG.md` Phase A BLOCKER (HANDOFF v1.4) 미작성. 5/21 외부 revert 로 stash@{2} 보존 | wizard option ↔ DB 카테고리 SSOT 매핑 docs |

---

## 3. DB 영역 4가지 분해

### 3.1 호텔 (lodging) — Phase 1 부분 완료, 갈아끼우기 X

**현재 자산**:
- `src/data/hotels.ts` 36 카드 (Seoul/Busan/Jeju/Gyeongju/Chuncheon/Danyang) — Trip.com 어필리에이트 전용. lat/lng 없음, location i18n 만.
- 사용자 wizard `hotelByCity` (P122/P123 다도시 patterns) free-text input.
- RouteAgent 가 매번 Naver Geocoding 으로 lat/lng 추출.

**갈아끼우기 변환**:
- 도시 × 가격대 × zone × 어필리에이트 ID 매트릭스
- lat/lng 사전 빌드 (NCP Naver Geocoding 1회)
- wizard 가 "호텔 명동 4성 비건 친화" 선택 시 즉시 DB row 매칭 → anchor 좌표 즉시 확보 → Gemini 추론 0초

**SAFETY/규모**:
- 36 카드 → 약 200-300 카드 확장 필요 (도시 × 가격대 × zone 매트릭스 충분 채움)
- 운영자 검수 의무 (각 호텔 = 어필리에이트 수익 직결, 사용자 실제 예약 가능 여부)

### 3.2 식당 (food) — Phase 1 거의 완료, 갈아끼우기 95%

**현재 자산**:
- `_food_index.json` 1.2MB, ~1500 row (P54/P88/P114/P180/P189 거친 verified DB)
- dbMatcher (3-tier): exact / partial / brand matching + city HARD REJECT (P183)
- 알레르기/할랄/비건/베지테리언 dietary_tags + allergens (P189 SAFETY)
- block-mode 의 `matchFoodPlaceholder` 함수 (P128) — placeholder slot ↔ DB sampling 패턴 **이미 구현**

**갈아끼우기 변환 (이미 패턴 존재)**:
- 현재: Gemini 출력 → dbMatcher 매칭 ("post-hoc rewrite" 패턴)
- 목표: zone_courses block 의 `placeholder: "verified_lunch"` slot → matchFoodPlaceholder 직접 sampling ("block-replacement" 패턴) — block-mode 활성 시 자동 적용

**SAFETY-CRITICAL** (CLAUDE.md J):
- dietary 사용자 (halal/vegan/vegetarian) 매칭 실패 시 throw → legacy fallback (현재 패턴 유지)
- 알레르기 violation Telegram alert (P189)

**남은 빈틈** (CLAUDE.md F 알려진 약점):
- 제주/경주/전주 row 부족 → `unverified_restaurant` 발생. DB 수집 5/23 큐 (`project_db_collection_handoff_2026_05_23`) 의 1-3순위.

### 3.3 관광지 (culture / attraction) — Phase 2 구축 영역

**현재 자산** (5/25 sweep 후):
- `_attractions_index.json` 130 row (museums 50 + temples 50 + night_spots 30) — **P190 attractions_helper 가 prompt 주입만**. 갈아끼우기 X
- `_mountain_index.json` 60 row (P191 mountain_helper, SAFETY trekking)
- `_korea_spots.json` 535KB (legacy spots, _spots_helper.js 가 사용)
- `src/data/zone_courses/*.json` 101 파일의 stops[] 가 `name` + `name_i18n` + `address` + `category` 실데이터 보유 (lat/lng 0)
- dead data: `src/data/themes.json` 50 row = 보관, `tour-external-ids` = 삭제 (메모리 분석)

**갈아끼우기 변환 (Phase 2 의무)**:
- attractions_index 의 entry_fee + hours + tags 가 block stops 의 entry_fee / hours / dietary 와 호환 매핑
- block stop name="N서울타워" → attractions_index lookup → lat/lng + verified=true
- 카테고리 확장 필요 (museums/temples/night_spots 외 shopping / nature / activities — wizard option 1:1 매핑)

### 3.4 이동방법 (intercity / intracity transit) — Phase 3 구축 영역

**현재 자산**:
- `STATION_COORDS` 28개 (KTX 9 + 공항 5 + 버스터미널 4 등) — `api/_ai_core/agents/RouteAgent.js` L11-40
- `airportBusHubs.ts` (frontend, 143L) — display 전용
- RouteAgent.js 2046L — Naver Geocoding + ODsay searchTransitRoute() + airport↔hotel routing + station fuzzy lookup (P155)
- zone_courses block 의 `transit_matrix` 필드 (mock placeholder — ENV 부재 빌드)

**갈아끼우기 변환 (Phase 3 의무)**:
- intercity DB (서울↔부산 KTX 시간/요금 + 김포-제주 항공 + 강남고속버스터미널 등) — 시간대별 × 요일별 캐시
- intracity transit_matrix — zone_courses block 의 stops[] 사이 ODsay 결과를 빌드 시점에 실측 (현재 mock)
- T-money 추천 금액 = day_total transit_cost 합산 → Gemini 추론 0 (현재는 vehicleAndPrice 계산)

---

## 4. 데이터 source 결정 (각 영역별)

### Option A — Google Places API

- **가격**: Place Details Pro $17/1000 (free tier 5000/month). Nearby Search Pro $32/1000.
- **한국 정확도**: ⭐⭐⭐ (한국어 검색 약함, 영문 명소명 fallback. 식당 카테고리 mismatch 빈번).
- **장점**: 글로벌 표준, photo URL + rating + reviews 직접 사용.
- **단점**: 한국 식당/관광지 ratio 가 Naver 보다 낮음, 비용 누적 가능 ($100/month at 6000+ enrichment).
- **2026년 free tier**: $200 credit, Place Details Essentials 10K, Pro 5K, Enterprise 1K — Pro 기준 ~5K row 가능.

### Option B — Naver Places (한국 강함)

- **가격**: 무료 (티어 제한 검색당). 검색 1일 25,000건 (NCP 일반 키), 추가 partnership 신청 가능. **추가 비용 0**.
- **한국 정확도**: ⭐⭐⭐⭐⭐ (한국어 검색 1순위, 한국 식당/관광지 ratio 1위, 도로명 주소 / 신축 lat/lng 정확).
- **장점**: 운영자 이미 NCP_CLIENT_ID 보유 (Vercel env), `build-zone-course.mjs` 가 NCP Geocoding 사용.
- **단점**: review/rating 공식 API 없음 (P190 attractions 의 rating 은 dead data 분석 시 수동/scrape source).
- **법적**: 공식 API 무료 (rate-limit 준수 시). Naver Search API 별도 (place review scrape 미지원).

### Option C — 수동 수집 + 운영자 검수

- **가격**: 운영자 시간 (1 row 검수 ~3분 추정 → 200 row = 10시간).
- **한국 정확도**: ⭐⭐⭐⭐⭐ (검수자 한국 거주, 실측 가능).
- **장점**: 어필리에이트 / SAFETY 필드 (allergen / halal-certified) 직접 control.
- **단점**: 확장 한계 (전국 모든 도시 cover X).
- **현재 상태**: `_food_index.json` 의 `verified_at + verified_by` 패턴 = 수동 검수 trace. 운영자 본인 (`2001leety@gmail.com`) verified 다수.

### Option D — 이미 수집된 dead data 활용

- **가격**: 0 (이미 디스크에 존재).
- **한국 정확도**: ⭐⭐⭐⭐ (운영자/이전 채팅창 검수 — P191 mountains_helper 가 활용 중).
- **현재 상태**:
  - 활용 권장: museums 50, temples 50, night_spots 30, mountains 60 = **190 row 사용 가능** (5/25 dead data 분석)
  - 보관: themes 50 (메모리 진단)
  - 삭제: tour-external-ids (메모리 진단)
- **빈틈**: shopping / nature / activities / kpop / running 카테고리 빈약 → Option B (Naver) 보충 필요

### 권장 (트레이드오프)

| 영역 | 권장 source | 이유 |
|---|---|---|
| 호텔 (lodging) | **C (수동) + B (Naver geocode)** | 어필리에이트 수익 직결 + 36→200 카드 확장은 운영자 의도 필요. lat/lng 는 NCP 자동 |
| 식당 (food) | **이미 완성** + B (Naver) for 제주/경주/전주 빈틈 | DB 수집 5/23 큐 1-3순위 (이미 운영자 계획) |
| 관광지 (Phase 2) | **D (dead data) 1차 + B (Naver) 보충** | 190 row 즉시 활용 + shopping/nature/activities 6-7 카테고리 Naver 검색으로 확장. 비용 0 |
| 이동방법 (Phase 3) | **현재 ODsay + 캐시 빌드** (build-zone-course.mjs 의 ODsay 호출 결과 캐시 Firestore 저장) | ODsay 1회 빌드 비용 (block 101개 × 5 stops = ~500 호출) ≈ 무료 (ODsay 일 5000 free). 매 사용자 plan 시 ODsay 0회. |

---

## 5. DB 구조 (각 row 공통 + 특화)

### 5.1 공통 필드 (block stop 동일 패턴)

```json
{
  "key": "string (unique ID — e.g. 'national_museum_korea')",
  "name": { "ko": "...", "en": "...", "ja": "...", "zh": "..." },
  "category": "lodging | food | culture | nature | shopping | transit | activity",
  "city": "seoul | busan | jeju | ...",
  "lat": 37.524, "lng": 126.9806,
  "address": "서울특별시 ... (대한민국 prefix 제거)",
  "verified": true,
  "verified_at": "2026-05-27",
  "verified_by": "2001leety@gmail.com",
  "source": "cocotrip_curated | operator_verified | user_validated",
  "google_maps_url": "https://...",
  "naver_maps_url": "https://..."
}
```

### 5.2 호텔 특화

```json
{
  "category": "lodging",
  "stars": 5,
  "priceFrom_usd": 185,
  "reviewCount": 3240,
  "rating": 8.8,
  "zone": "Myeongdong",
  "affiliate_url": "https://trip.com/...&Allianceid=...",
  "thumbnail": "/...jpg",
  "amenities": ["wifi", "pool", "halal_kitchen"],
  "dietary_friendly": ["vegan", "halal"]
}
```

### 5.3 관광지 특화

```json
{
  "category": "culture",
  "theme": "museum | temple | nightlife | shopping | nature",
  "entry_fee_krw": 0,
  "entry_fee": { "adult": 0, "child": 0, "senior": 0, "toddler": 0, "notes": "..." },
  "hours": "10:00-18:00",
  "season": ["spring", "autumn"],
  "duration_minutes": 90,
  "age_range": "all | family | adult_only",
  "tags": ["foreigner_popular", "wheelchair_accessible", ...],
  "subway_last": "00:30",
  "safety": "high | medium | low",
  "reservation_required": false
}
```

### 5.4 이동방법 특화 (intercity DB)

```json
{
  "category": "transit",
  "from_station": "서울역",
  "to_station": "부산역",
  "from_lat": 37.5547, "from_lng": 126.9706,
  "to_lat": 35.1149, "to_lng": 129.0411,
  "modes": [
    { "mode": "ktx", "duration_min": 165, "cost_krw": 59800, "frequency": "20-30min", "t_money_recommended": false },
    { "mode": "bus", "duration_min": 270, "cost_krw": 23000, "frequency": "30-60min" },
    { "mode": "airplane", "duration_min": 60, "cost_krw": 100000, "frequency": "60-120min", "airport_buffer_min": 90 }
  ],
  "t_money_card_cost_krw": 4000,
  "recommended_mode_by_pax": { "1-2": "ktx", "3-6": "ktx", "7+": "ktx_group_or_bus" }
}
```

---

## 6. buildPrompt 가 블록 갈아끼우기 패턴 변경 방식

### 6.1 현재 (Gemini freeform → DB rewrite)

```
사용자 input
  → buildPrompt (Gemini system prompt + spotContext + foodContext + attractionsContext + mountainContext)
  → Gemini 2.5 Flash freeform 생성 (전체 itinerary, stops[] freeform names)
  → dbMatcher (food 매칭, address overwrite)
  → sanitizeStopNames + sanitizeAddress
  → RouteAgent (ODsay transit 매 stop)
  → planPersister.backfillDayLodging
```

비용: Gemini 호출 1회 (~30-60초) + ODsay 호출 N stops × M segments + Naver geocode N stops

### 6.2 목표 (block 갈아끼우기)

```
사용자 input
  → blockMode.fetchAvailableBlocks(city, dietPrefs) [Firestore zone_courses where city + status=published + dietary_options 매칭]
  → blockMode.selectBlocksWithGemini(blocks, userInput) [Gemini 빠른 모델, JSON output: { day_selections: [{day, block_id, tweak_notes}] }]
  → blockMode.expandBlocksToItinerary(selections, blocks, userInput) [block.stops → itinerary.days[].stops[], food placeholder matchFoodPlaceholder, lat/lng 즉시, transit_matrix 사전 빌드 결과 사용]
  → planPersister.backfillDayLodging (hotelByCity hint)
  → 응답
```

비용:
- Gemini 빠른 모델 (Flash) 1회, block_id 선택만 ≈ ~3-5초 (1/10 부하)
- Firestore 1 read (city × diet 필터)
- ODsay 0회 (transit_matrix 사전 빌드됨)
- Naver geocode 0회 (lat/lng 사전 빌드됨)

**현재 코드의 갭** (이미 P128 구현된 부분 / 빈 부분):

- ✅ `blockMode.runBlockModePipeline` 단도시
- ✅ `blockMode.runBlockModeMultiCity` (P167) 다도시
- ✅ `blockMode.matchFoodPlaceholder` SAFETY-critical dietary 필터
- ✅ `blockMode.shouldUseBlockMode` env=auto + ≥3 blocks 조건
- ✅ `expandBlocksToItinerary` start_time + departure_time tail trim
- ❌ **Firestore zone_courses 시드 (disk 101 file → Firestore upload)**
- ❌ **lat/lng 실측** (현재 0,0 placeholder)
- ❌ **transit_matrix 실측** (현재 mock placeholder)
- ❌ **PLANNER_BLOCK_MODE env Vercel 활성화** (현재 미설정 → 'auto' 인데 ≥3 block 조건 못 채워 항상 legacy)
- ❌ **wizard option ↔ block.best_for 1:1 매핑 SSOT** (Phase A BLOCKER, HANDOFF v1.4)
- ❌ **호텔 DB → block.hotel_anchor 매핑** (호텔 갈아끼우기 — Phase B P134)
- ❌ **관광지 DB → block.stops 의 verified culture stop 보강** (Phase 2)
- ❌ **intercity DB → 다도시 day-transition 갈아끼우기** (Phase 3)

---

## 7. Phase 분해 (시간 추정)

### Phase 2 — 관광지 DB 수집 (시작 후보, 운영자 결정)

목표: museums / temples / night_spots / mountains 외 shopping / nature / activities / kpop 추가 → zone_courses 의 culture/nature/shopping placeholder slot 갈아끼우기

| 작업 | source | 시간 | 비용 |
|---|---|---|---|
| 2.1 — `_attractions_index.json` 확장: shopping 30 + nature 30 + kpop 30 = +90 row | Naver Places + dead data 보충 | 3-4시간 (운영자 검수 포함) | Naver API 무료 |
| 2.2 — attractions_helper 호출 site 확장 (현재 P190 prompt 주입만 → block-mode matchAttractionPlaceholder 추가) | 코드 | 2-3시간 (Sonnet) | $1-2 |
| 2.3 — zone_courses 의 culture/shopping/nature stop name 을 attractions_index lookup 매칭 (이름→key) | script | 1시간 | $0.5 |
| 2.4 — 검증 lint rule `R-P136` (zone block stop name → attractions_index 또는 verified=false) | lint | 1시간 | $0.5 |

총 ~8-10시간, 비용 ~$3-5.

권장 시작 도시: **seoul + busan + jeju** (이미 zone block 多. Phase 2 효과 가장 큼).

### Phase 3 — 이동방법 DB cache (Phase 2 후)

목표: intercity transit DB + intracity transit_matrix 실측 빌드 → ODsay 호출 0

| 작업 | source | 시간 | 비용 |
|---|---|---|---|
| 3.1 — `api/_intercity_index.json` 생성: 서울↔부산 / 서울↔제주 / 서울↔경주 등 30 경로 × 3 mode (KTX/bus/airplane) | ODsay + Korail public schedule | 4-5시간 | ODsay 무료 (build 1회) |
| 3.2 — zone_courses 의 transit_matrix 실측 (NCP+ODsay env 로 build-zone-course.mjs 전체 101 파일 재빌드) | scripts | 1-2시간 (run) | ODsay ~500 호출 무료 |
| 3.3 — RouteAgent 의 intercity 분기 → intercity_index lookup 우선 | 코드 | 2-3시간 (Sonnet) | $1-2 |
| 3.4 — 검증 lint rule `R-P137` (block transit_matrix.source≠'mock') | lint | 30분 | $0.5 |

총 ~8-10시간, 비용 ~$2-4 (ODsay 무료).

### Phase 4 — buildPrompt 블록 통합 (Phase 2+3 후)

목표: legacy 분기 → block-mode 분기로 트래픽 이전, PLANNER_BLOCK_MODE=auto prod 활성화

| 작업 | 시간 | 비용 |
|---|---|---|
| 4.1 — Firestore zone_courses seed script (disk 101 파일 → adminDb publish) | 2-3시간 | $1-2 |
| 4.2 — admin dashboard "block-mode 활성/모니터링" 페이지 (이미 PR #512 partial) | 4-5시간 | $2-3 |
| 4.3 — A/B test prod 5% → 20% → 100% (P181 P204 회귀 패턴 적용) | 1-2주 모니터링 | $5-10 (Gemini Flash + Firestore reads) |
| 4.4 — legacy path 폐기 / archive (HANDOFF Phase E #1) | 2-3시간 | $1-2 |

총 ~12-15시간 + 1-2주 모니터링, 비용 ~$10-20.

### Phase B / P134 — 호텔 갈아끼우기 (HANDOFF v1.4 다음 주 후보, 독립 진행 가능)

목표: 호텔 DB (200 카드) + wizard hotelByCity → block.hotel_anchor 매핑

이 ADR 의 Phase 2-4 와 독립적으로 진행 가능 (HANDOFF Phase B 의무 작업).

---

## 8. 위험 + 부작용 매트릭스

| 위험 | 확률 | 영향 | 완화 |
|---|---|---|---|
| **DB 부족 도시에서 block-mode fallback** | 높음 (제주/경주/전주/기타 도시) | 중 (사용자 plan 디테일 약간 낮음, but legacy fallback 작동) | shouldUseBlockMode `insufficient_blocks` reason → legacy 폴백 자동. 운영자 admin dashboard 모니터링 |
| **SAFETY-CRITICAL dietary 매칭 실패** | 낮음 (P189 alert 체인) | 높음 (건강 위험) | `expandBlocksToItinerary` 의 BLOCK_MODE_DIETARY_UNSATISFIED throw → legacy fallback. 알레르기 violation Telegram alert |
| **transit_matrix mock → 실제 시간 mismatch** | 현재 100% | 중 (사용자 일정 mistime) | Phase 3 의 build-zone-course.mjs ODsay 실측 빌드. R-P137 lint |
| **lat/lng 0,0 → 지도 링크 잘못** | 현재 100% | 높음 (사용자 길 잃음) | Phase 3 의 build-zone-course.mjs NCP 실측 빌드. validateLodgingBookend (P127) |
| **블록 다양성 부족 (사용자 재방문 시 중복)** | 중 (서울 9 block + 5박6일 = 반복) | 중 (사용자 만족도 ↓) | Phase 2/Phase E #2 의 zone block 확장 (서울 9→15+, 부산 7→12+) |
| **운영자 검수 부담 누적** | 중 | 중 | 단계적 source: D (dead data) 1차 무비용 활용 → B (Naver) 자동 보충 → C (수동) 검수 마지막 |
| **Gemini 빠른 모델 block_id 환각** | 낮음 (P200 propertyOrdering + required 적용 가능) | 중 (잘못된 block 선택 → 위로 round-robin fallback) | `selectBlocksWithGemini` 의 validIds Set 검증 + round-robin fallback (이미 구현) |
| **P181 fallback 폭증** | 낮음 (block-mode 분기 = Gemini Flash 1회 부하 1/10) | 중 | A/B test 5% → 모니터링 (P201 escalate 패턴) |

---

## 9. 비용 추정 (전체)

### 9.1 개발 비용 (Sonnet/Opus agent)

| Phase | Sonnet 시간 | Opus 시간 (architecture) | 추정 비용 |
|---|---|---|---|
| Phase 1 (이 ADR) | 0 | 1-2h | $3-5 (완료) |
| Phase 2 (관광지 DB) | 6-8h | 2h | $8-12 |
| Phase 3 (이동방법 DB) | 6-8h | 2h | $8-12 |
| Phase 4 (통합) | 10-12h | 3-4h | $15-25 |
| Phase B (호텔 갈아끼우기, 독립) | 6-8h | 2h | $8-12 |

총 개발 비용 ≈ **$45-70** (Anthropic API).

### 9.2 외부 API 비용

| API | Phase 2-4 빌드 1회 | 사용자 plan 1회 (현재) | 사용자 plan 1회 (block-mode 후) |
|---|---|---|---|
| Google Places | 0 | 0 | 0 (사용 X) |
| Naver Geocoding (NCP) | ~500 호출 무료 (25K/day 한도 내) | ~10 호출 ($0.001) | 0 (사전 빌드) |
| ODsay Transit | ~500 호출 무료 (5K/day 한도 내) | ~10 호출 ($0.01) | 0 (사전 빌드) |
| Gemini 2.5 Flash | 0 | 1 호출 (~$0.005) | 1 호출 Flash 빠른 모드 (~$0.001) |
| Firestore reads | 101 doc write 1회 | 5-10 read ($0.001) | 5-10 read + 1 zone_courses 쿼리 ($0.002) |

**현재 사용자 plan 당 ~$0.02** → **block-mode 후 ~$0.005** (4배 절감, prod 1000 plan/month 시 $15/month 절감).

### 9.3 운영자 검수 시간

| 영역 | 운영자 시간 |
|---|---|
| 관광지 90 row 검수 (Phase 2) | ~5-7시간 |
| 호텔 200 카드 검수 (Phase B) | ~10시간 |
| zone_courses 101 block 의 lat/lng 검증 (Phase 3) | ~3-5시간 |
| A/B test 모니터링 (Phase 4) | ~30분/day × 7-14일 |

총 운영자 검수 시간 ≈ **20-25시간** (1주일 분산 가능).

---

## 10. 운영자 결정 사항 (5건, 권장 포함)

### 결정 1 — Phase 시작 영역

**선택지**:
- A) Phase 2 (관광지 DB 확장) 먼저 — 효과 측정 빠름, dead data 즉시 활용 가능
- B) Phase 3 (이동방법 DB) 먼저 — transit_matrix 실측 빌드만 = build-zone-course.mjs 재실행. 즉시 이동시간 정확도 ↑
- C) Phase B (호텔 갈아끼우기, HANDOFF P134) 먼저 — 운영자 의도 1순위 박제 "호텔 = 빨간 블록"
- D) 모든 Phase 병렬 (Sonnet 3 worktree)

**권장**: **C → B → 3 → 4 순서**
- 운영자 의도 박제 ("호텔 갈아끼우기") 1순위
- Phase 3 의 transit 실측은 build-zone-course.mjs 단일 스크립트 재실행 = ~1-2시간 (단일 작업)
- Phase 2 의 관광지 확장은 dead data 즉시 활용 + Naver 검색 보충 = ~3-4시간
- Phase 4 통합은 모든 데이터 검증 후

### 결정 2 — 데이터 source 선택 (Phase 2 관광지)

**선택지**:
- A) Google Places API ($5-15 month, 한국 정확도 ⭐⭐⭐)
- B) Naver Places (무료, 한국 정확도 ⭐⭐⭐⭐⭐)
- C) 수동 + 운영자 검수 (시간 高, 확장 限)
- D) Dead data (museums/temples/night_spots/mountains 190 row) + 빈 카테고리만 Naver 보충

**권장**: **D + B** (dead data 1차 활용 + Naver 보충)
- 비용 0 + 한국 정확도 최고
- 운영자 NCP_CLIENT_ID 이미 보유 (Vercel env P102 환각 회피 의무)
- museums/temples/night_spots/mountains 4 카테고리 즉시 활용 (5/25 분석 권장사항)

### 결정 3 — 시작 도시 (Phase 2)

**선택지**:
- A) 서울만 (현재 zone block 9개, 가장 풍부, 효과 측정 빠름)
- B) 서울+부산+제주 (현재 zone block 23개, 외국인 popular 3대 도시)
- C) 전국 (101 block 모두, but 도시별 row 부족 위험)

**권장**: **B (서울+부산+제주)**
- DB 수집 5/23 큐의 1-3순위 (호텔 4 region + 식당 빈틈) 와 일치
- A/B test 시 control variable 명확 (외국인 main destination 3 도시)

### 결정 4 — fallback 동작 (DB 부족 시)

**선택지**:
- A) Hard fallback to legacy Gemini (현재 패턴) — 사용자 plan 디테일 보존, 추론 시간 그대로
- B) Soft fallback — block-mode 진행 + 미매칭 stop 만 Gemini freeform 보충 (hybrid)
- C) Fail fast 422 — 사용자에게 "도시 DB 부족, 다른 도시 선택" 안내

**권장**: **A (Hard fallback, 현재 패턴 유지)**
- block-mode 의 `shouldUseBlockMode` 가 이미 `insufficient_blocks` reason → legacy fallback 패턴 정착
- 사용자 plan 보장 + 운영자 모니터링 (admin dashboard 의 block-mode skip rate) 으로 DB 부족 도시 추가 우선순위 자동 발견

### 결정 5 — Gemini 역할 (block-mode 활성 후)

**선택지**:
- A) **block_id 선택만** (현재 P128 패턴) — Gemini 부하 1/10, 가장 빠름
- B) block_id + 1줄 tweak_notes — narrative 약간 보강 (현재 P128 = 선택)
- C) block_id + day theme rewrite + tour_title 생성 — Gemini 부하 1/3, 디테일 강화
- D) block 선택 후 Gemini 가 전체 days theme + intro + outro + tip + reason 다 채움 — 풀 narrative

**권장**: **B (현재 P128 패턴 유지)**
- 운영자 의도 "빠르고 안정" 1순위
- C/D 는 Phase E #3 (intent classifier prompt 튜닝, PR #517 가 분포 데이터 누적 중) 후 점진 확장 가능

---

## 11. Phase 1 종료 후 진행 안내

**Phase 2 시작 예상 시간** (운영자 결정 1+2+3 받은 후):
- 첫 시작 (Phase B 호텔 갈아끼우기) — ~6-8시간 Sonnet 작업, 1-2 worktree
- Phase 2/3 병렬 — ~10-15시간 Sonnet, 2-3 worktree
- Phase 4 통합 + A/B — 1-2주 모니터링

**Blocker (즉시 해결 가능)**:
- Vercel env `PLANNER_BLOCK_MODE` 미설정 — 운영자 본인 액션 (~5분, Vercel Dashboard)
- `docs/WIZARD-INPUT-CATALOG.md` Phase A — 외부 revert 의 stash@{2} 복원 또는 재작성 (이 ADR 의 5번 절 보강 가능)

**SAFETY 의무 (모든 Phase 공통)**:
- CLAUDE.md J — dietary 흐름 5 지점 grep 의무
- `_food_index.json` 절대 삭제 X
- 신규 PR 시 `node scripts/validate-planner.cjs` 통과 의무

---

## 12. 변경 이력

- 2026-05-27 — Phase 1 design 완료. 운영자 결정 5건 대기.

## 13. 관련 메모리 / 문서 링크

- 메모리: `project_cocotrip_wizard_system_design`, `project_db_collection_handoff_2026_05_23`, `project_cocotrip_dead_data_240_analysis_2026_05_25`
- 문서: `docs/HANDOFF-PLANNER-ROADMAP-2026-05-21.md` v1.4 (Phase A-E)
- 코드: `api/_ai_core/blockMode.js`, `api/_ai_core/buildPrompt.js`, `api/_ai_core/dbMatcher.js`, `api/_ai_core/agents/RouteAgent.js`, `api/_attractions_helper.js`, `api/_mountain_helper.js`, `api/_food_helper.js`, `scripts/build-zone-course.mjs`, `scripts/build-attractions-index.js`, `scripts/build-food-index.js`, `scripts/build-mountain-index.js`
- 데이터: `src/data/zone_courses/*.json` (101 파일), `src/data/attractions/{museums,temples,night_spots,themes}.json`, `src/data/mountains/{gangwon,gyeongsang,jeolla_jeju_chungcheong}.json`, `src/data/hotels.ts`
