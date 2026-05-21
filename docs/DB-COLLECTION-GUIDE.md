# DB 수집 가이드 — 작업자 actionable SSOT

작성일: 2026-05-21  
대상: DB 수집 작업자 (식당 / 러닝 / 트레킹 / 강원·충청·경상 zone 신규 카테고리)  
원칙: **카테고리 키 자유 라벨 금지** — WIZARD-INPUT-CATALOG.md SSOT 그대로 사용  
연관: `WIZARD-INPUT-CATALOG.md` v1.1 / `HANDOFF-PLANNER-ROADMAP-2026-05-21.md` v1.4

---

## 0. 왜 이 가이드가 필요한가

DB 와 위자드 input 이 1:1 매칭돼야 AI 가 DB 에서 정확히 골라 플랜에 넣는다. 매칭이 어긋나면 에러 메시지 없이 조용히 실패한다. 실제 발생했던 prod 사고:

| 회귀 패턴 | 현상 | 원인 |
|---|---|---|
| **P114** (2026-05-20) | 부산 day 의 Jagalchi / Isaac Toast 가 서울 주소로 override | `dbMatcher` 가 도시 구분 없이 매칭 → 식당 이름 동일한 서울 지점이 선택됨 |
| **P88** (2026-05-16) | B-MEAL 검증 — 오후 3시 방문 카페가 식사 슬롯으로 인정 안 됨 | DB 시간 슬롯 카테고리 mismatch |
| **P86** (2026-05-16) | AI 응답에서 일부 가이드 블록이 조용히 누락 | DB 키 누락 → `repair dropped guides` 얼러트 발생 |
| **P90** (2026-05-16) | 다도시 플랜에서 도시 보존 실패 | `dbMatcher` 도시 필드 누락 |

**재라벨링 비용**: 식당 1,000개 수집 후 `categoryKey` 하나 변경 시 전량 재작업. **처음에 맞게 수집하는 것이 유일한 해결책.**

운영자 의도 — "디테일하게" : DB 디테일이 높을수록 플랜 디테일이 올라간다. 이 가이드를 지키는 것이 곧 플랜 품질에 기여하는 것이다.

---

## 1. DB row 의무 필드 — 모든 카테고리 공통

```json
{
  "name": "홍대 깃뜰",
  "nameEn": "Hongdae Git Teul",
  "city": "seoul",
  "lat": 37.5503,
  "lng": 126.9198,
  "address": "서울특별시 마포구 서교동 395-20",
  "tag": "general",
  "priceLevel": 2,
  "rating": 4.7,
  "reviewCount": 1200,
  "googleMapsUrl": "https://www.google.com/maps/place/?q=place_id:ChIJ...",
  "dong": "홍대",
  "dongEn": "Hongdae"
}
```

| 필드 | 타입 | 규칙 |
|---|---|---|
| `name` | string | **한국어 정식명** — 네이버맵 검색에 쓰임 (오탈자 불가) |
| `nameEn` | string | 영문명 — 영어권 사용자 표시용 |
| `city` | string | **CITY_CHIPS 키 그대로** (아래 표 참조) — 대소문자 주의 |
| `lat` / `lng` | number | 소수점 4자리 이상. Google Maps 좌표 복사 권장 |
| `address` | string | 한국 표준 주소 ("서울특별시..." 또는 "서울시...") |
| `tag` | string | `general` / `halal` / `vegan` — 3개 중 하나만 |
| `priceLevel` | number | 1=Budget, 2=Moderate, 3=Premium |
| `rating` | number | Google Maps 평점 (0.0–5.0) |
| `reviewCount` | number | 리뷰 수 — build-food-index.js 기준: ≥50건만 포함 |
| `googleMapsUrl` | string | place_id 기반 URL 권장 (영구 링크) |
| `dong` | string | 동네명 (홍대 / 명동 / 해운대 등) — 다양성 필터에 사용 |

### CITY_CHIPS 허용값 (대소문자 정확히)

```
seoul   busan   jeju   gyeongju   jeonju
gangneung   incheon   suwon   yeosu   daegu
```

주의: `suwon` / `incheon` / `gangneung` 은 현재 `_food_helper.js` 의 CITY_MAP 에서 `seoul` 로 폴백됨. 이는 기존 식당 DB 의 한계이며, 러닝/트레킹 DB 는 **정확한 도시 코드**를 사용해야 per-day matching 이 올바르게 동작함. 폴백 의존 수집 금지.

---

## 2. 카테고리별 가이드

### 2.1 식당 — `api/_food_index.json` (기존, 확장 중)

**실제 스키마 (build-food-index.js 생성 기준):**

```json
{
  "name": "홍대 태초갈비",
  "nameEn": "Hongdae Taecho Galbi",
  "address": "서울특별시 마포구 어울마당로 122 2층",
  "lat": 37.5553468,
  "lng": 126.9238496,
  "rating": 5.0,
  "reviewCount": 3129,
  "cuisine": "Korean",
  "cuisineKo": "한식",
  "tag": "general",
  "placeId": "ChIJbyskvqqZfDURiFtkOtoL4eE",
  "googleMapsUrl": "https://www.google.com/maps/place/?q=place_id:ChIJbyskvqqZfDURiFtkOtoL4eE",
  "city": "seoul",
  "dong": "홍대",
  "dongEn": "Hongdae",
  "district": "Mapo-gu"
}
```

**tag 값 (3개만 허용):**

| tag | 적용 대상 |
|---|---|
| `general` | 일반 식당 (한식 / 양식 / 중식 / 일식 / 씨푸드 / 고기 / 분식 등) |
| `halal` | 할랄 인증 또는 무슬림 친화 식당 |
| `vegan` | 완전 채식 (비건) 전문 식당 |

**cuisine 필드 (위자드 Seafood/Meat/Spicy/Street 매칭에 쓰임):**

```
Korean / Japanese / Chinese / Western / Seafood / Italian / Cafe / Dessert
```

**도시별 현황 및 수집 우선순위:**

| 도시 | 현재 수량 | 우선 수집 지역 |
|---|---|---|
| Seoul | 다수 (홍대/명동/강남/이태원 중심) | 강북 / 잠실 / 성수 보강 필요 |
| Busan | 중간 (해운대/남포) | 광안리 / 서면 보강 필요 |
| Jeju | 적음 | 제주시 / 서귀포 전체 |
| Gyeongju | 매우 적음 | 황리단길 / 보문 |
| Jeonju | 매우 적음 | 한옥마을 / 객리단길 |

**수집 최소 기준:** Google Maps 평점 ≥ 4.5, 리뷰 ≥ 50건 (build-food-index.js 필터 기준).

---

### 2.2 러닝 — `api/_running_index.json` (신규, PR #518 제주 올레 일부 구현)

**스키마:**

```json
{
  "id": "seoul-hangang-yeouido-5k",
  "name": "여의도 한강 러닝 코스",
  "nameEn": "Yeouido Hangang Running Course",
  "city": "seoul",
  "categoryKey": "running",
  "subCategoryKey": "hangang",
  "distanceKm": 5.2,
  "difficulty": "easy",
  "surface": "paved",
  "loopCourse": true,
  "startLat": 37.5260,
  "startLng": 126.9340,
  "lat": 37.5260,
  "lng": 126.9340,
  "address": "서울특별시 영등포구 여의도동 한강공원",
  "highlights": ["한강뷰", "야경 명소", "화장실 완비"],
  "bestSeason": ["spring", "autumn"],
  "transitRequired": false,
  "tag": "general"
}
```

**subCategoryKey 허용값 (플립 UX sub-tree 기준):**

| subCategoryKey | 의미 |
|---|---|
| `5k` | 5km 코스 |
| `10k` | 10km 코스 |
| `half` | 하프마라톤 수준 (21km) |
| `hangang` | 한강변 코스 |
| `downtown` | 도심 코스 |
| `park` | 공원 코스 |
| `beach` | 해변 코스 (부산/제주) |
| `trail` | 산악 트레일 러닝 |
| `jeju_olle` | 제주 올레길 러닝 (PR #518 구현) |

**difficulty 허용값:** `easy` / `medium` / `hard`  
**surface 허용값:** `paved` / `trail` / `grass` / `sand`

**도시별 수집 우선순위:**

| 도시 | 추천 코스 |
|---|---|
| Seoul | 한강변 (여의도/반포/잠원/뚝섬), 남산 둘레길, 북악스카이웨이 |
| Busan | 해운대 해변, 광안리, 이기대 |
| Jeju | 올레 1-21코스 (PR #518 일부 완료), 한라산 둘레길 |

---

### 2.3 트레킹 — `api/_trekking_index.json` (신규, PR #518 한라산/설악산 일부 구현)

**스키마:**

```json
{
  "id": "jeju-hallasan-eorimok",
  "name": "한라산 어리목 코스",
  "nameEn": "Hallasan Eorimok Trail",
  "city": "jeju",
  "categoryKey": "trekking",
  "subCategoryKey": "mountain",
  "elevationM": 1700,
  "distanceKm": 10.4,
  "durationH": 5.5,
  "difficulty": "hard",
  "transitRequired": true,
  "transitNote": "어리목 탐방안내소까지 버스 또는 택시 필요",
  "startLat": 33.3710,
  "startLng": 126.4567,
  "lat": 33.3710,
  "lng": 126.4567,
  "address": "제주특별자치도 제주시 해안동 산 220-1",
  "permits": false,
  "bestSeason": ["spring", "autumn"],
  "highlights": ["백록담 조망", "원시림", "유네스코 세계자연유산"],
  "tag": "general"
}
```

**subCategoryKey 허용값:**

| subCategoryKey | 의미 |
|---|---|
| `mountain` | 산악 (한라산/북한산/설악산/금정산 등) |
| `urban_hike` | 도시 등산 (남산/관악산/북악산) |
| `walking_course` | 도보 코스 (올레/둘레길) |
| `coastal` | 해안 트레킹 (이기대/거문오름) |

**도시별 수집 우선순위:**

| 도시 | 추천 코스 |
|---|---|
| Jeju | 한라산 (성판악/어리목/영실) — PR #518 일부 완료 |
| Seoul | 북한산 (백운대/도봉산), 관악산, 남산 |
| Busan | 금정산, 이기대 |
| Gyeongju | 토함산, 남산 탐방로 |

`transitRequired: true` 인 코스는 **반드시** `transitNote` 작성. RouteAgent 가 이동 수단을 자동 계산하는 데 사용한다.

---

### 2.4 zone_courses — 강원/충청/경상 신규 zone block (Phase E #2)

PR #514 (서울 4 zone) + PR #518 (부산 5 + 제주 4 city_day) 패턴 기반. Firestore `zone_courses` 컬렉션.

**스키마 (PR #514 서울 강남 zone block 기준):**

```json
{
  "blockId": "gangwon-sokcho-downtown",
  "city": "gangwon",
  "theme": "coastal_city",
  "stops": [
    {
      "order": 1,
      "name": "속초관광수산시장",
      "nameEn": "Sokcho Tourist Fish Market",
      "address": "강원특별자치도 속초시 중앙로147번길 16",
      "lat": 38.2078,
      "lng": 128.5913,
      "stay_min": 60,
      "category": "food"
    },
    {
      "order": 2,
      "name": "속초해수욕장",
      "nameEn": "Sokcho Beach",
      "address": "강원특별자치도 속초시 해수욕장길 137",
      "lat": 38.2129,
      "lng": 128.5984,
      "stay_min": 90,
      "category": "nature"
    }
  ],
  "transit_matrix": {},
  "intent_keywords": ["속초", "sokcho", "강원", "gangwon", "동해", "해수욕장"]
}
```

**신규 도시 코드 (CITY_CHIPS 확장 필요 — 위자드 카탈로그 update 동시 진행):**

| 코드 | 지역 | 대표 도시 |
|---|---|---|
| `gangwon` | 강원특별자치도 | 속초 / 강릉 / 춘천 / 양양 |
| `chungcheong` | 충청남북도 | 공주 / 부여 / 청주 / 아산 |
| `gyeongsang` | 경상남북도 | 경주 / 안동 / 통영 / 거제 |

`transit_matrix` 는 `api/admin-rebuild-zone-course-transit.js` endpoint 로 운영자가 채울 수 있음. 초기 수집 시 빈 객체(`{}`)로 두고 나중에 채워도 됨.

---

## 3. 수집 워크플로우 — 6 Step

**Step 1. WIZARD-INPUT-CATALOG.md 의 해당 카테고리 sub-tree 확인**  
수집 전 반드시 `docs/WIZARD-INPUT-CATALOG.md` 를 열고, 내가 수집하려는 카테고리의 `categoryKey` 와 `subCategoryKey` 를 확인한다. 이 파일이 없으면 작업 시작 전 운영자에게 요청.

**Step 2. categoryKey / subCategoryKey 그대로 사용**  
대소문자, 단복수, 언더스코어 — 카탈로그에 있는 그대로 복사한다. "Hangang Run" 같은 자유 라벨 절대 금지.

**Step 3. name 은 한국어, nameEn 은 영어 — 둘 다 필수**  
한국어 이름 누락 시 `dbMatcher` 의 1차/2차/3차 매칭 모두 실패. 영어 이름 누락 시 다국어 사용자 표시에서 fallback 발생.

**Step 4. lat/lng + city 정확 입력**  
Google Maps 에서 핀 찍어 좌표 복사. `city` 필드는 CITY_CHIPS 키 그대로. 잘못된 도시 코드는 P114 회귀(부산 식당이 서울 주소로 override)를 재발시킨다.

**Step 5. tag 는 wizard 매칭 키 3개 중 하나**  
`general` / `halal` / `vegan` 이외 값 입력 시 `_food_helper.js` 의 tag 필터에서 누락됨. "Korean BBQ" 같은 값 금지.

**Step 6. DB 추가 후 카탈로그 SSOT 업데이트 확인**  
신규 subCategoryKey 를 발견해서 추가했다면, `docs/WIZARD-INPUT-CATALOG.md` 에도 반영하는 PR 을 동시에 올린다. 카탈로그 누락 = 위자드 UI 에서 해당 옵션 선택 불가.

---

## 4. 자주 틀리는 키 대조표

| 잘못된 값 | 올바른 값 | 이유 |
|---|---|---|
| `"Seoul"` | `"seoul"` | CITY_CHIPS 는 모두 소문자 |
| `"Busan"` | `"busan"` | 동일 |
| `"running"` 만 (sub 없음) | `"running"` + `subCategoryKey: "hangang"` | sub 누락 시 위자드 매칭 실패 |
| `"Hangang Run"` | `{ categoryKey: "running", subCategoryKey: "hangang" }` | 자유 라벨 금지 — 위자드 플립 UX 와 1:1 매칭 필수 |
| `"Halal"` (대문자) | `"halal"` (소문자) | tag 는 소문자만 |
| `"Vegan"` | `"vegan"` | 동일 |
| `priceLevel: "2"` (문자열) | `priceLevel: 2` (숫자) | 타입 mismatch → 가격 필터 무시됨 |
| `rating: "4.5"` (문자열) | `rating: 4.5` (숫자) | 동일 |
| address 에 `"대한민국 서울..."` | `"서울특별시..."` | `dbMatcher` 가 "대한민국 " 접두사 자동 제거하지만 혼동 방지 |
| name 에 `"홍대 맛집 \| Hongdae \| 홍대인스타"` | 한국어 이름만 | SEO 합친 multi-lang name 은 `pickLangToken` 이 파싱하지만 수집 단계에서부터 정제 권장 |

---

## 5. 업로드 전 10항목 체크리스트

```
[ ] categoryKey 가 WIZARD-INPUT-CATALOG.md 와 정확히 일치 (대소문자 포함)
[ ] subCategoryKey 가 카탈로그 sub-tree 와 일치 (없으면 카탈로그 update PR 동봉)
[ ] city 가 CITY_CHIPS 허용값 중 하나 (소문자)
[ ] name (한국어) + nameEn (영어) 모두 채움
[ ] lat/lng 소수점 4자리 이상, 실제 Google Maps 좌표 검증 완료
[ ] tag 는 general / halal / vegan 중 하나
[ ] priceLevel 은 숫자 1 / 2 / 3
[ ] rating ≥ 4.5, reviewCount ≥ 50 (식당 기준 — 러닝/트레킹은 해당 없음)
[ ] 도시 매칭 확인 — 부산 식당이 city: "seoul" 아닌지, 제주 코스가 city: "busan" 아닌지
[ ] 신규 카테고리면 WIZARD-INPUT-CATALOG.md 업데이트 PR 동봉
```

---

## 6. 신규 카테고리 추가 절차

신규 카테고리 (예: 자전거, 서핑, 스키)를 추가할 때는 반드시 아래 순서를 지킨다. 순서를 바꾸면 DB 가 먼저 올라가고 위자드 UI 에서 선택 불가 상태가 유지되는 사고가 발생한다.

1. **WIZARD-INPUT-CATALOG.md update PR 먼저** — 위자드 UI 에서 선택 가능해야 DB 와 매칭됨
2. **DB 인덱스 schema 정의** — 신규 `_xxx_index.json` 파일 또는 `zone_courses` 확장 어느 쪽인지 결정
3. **DB row 수집** — 이 가이드의 2-5절 준수
4. **backend matcher 추가** — `api/_ai_core/dbMatcher.js` 또는 신규 matcher 모듈 (기존 `_food_helper.js` 패턴 참고)
5. **buildPrompt.js 주입 지점 추가** — Gemini system prompt 에 신규 DB 컨텍스트 inject 위치 확인

---

## 7. 관련 문서

| 문서 | 역할 |
|---|---|
| `docs/WIZARD-INPUT-CATALOG.md` | 위자드 input 옵션 전체 SSOT — 카테고리 키 출처 |
| `docs/HANDOFF-PLANNER-ROADMAP-2026-05-21.md` | Phase A-E 로드맵 — DB 수집이 Phase A BLOCKER |
| `api/_food_helper.js` | 식당 DB 로드 + 위자드 input 매핑 로직 |
| `api/_ai_core/dbMatcher.js` | Gemini 응답 → DB 매칭 (P114 city guard 포함) |
| `scripts/build-food-index.js` | `food_data/*.json` → `api/_food_index.json` 빌드 스크립트 |
| `CLAUDE.md` §B | 절대 금지 규칙 — `_food_index.json` 삭제 금지 포함 |

**회귀 패턴 메모리 참조:**
- P114 — dbMatcher per-day city (부산 식당이 서울 foodIndex 와 silent override)
- P88 — B-MEAL snack slot (시간 슬롯 카테고리 mismatch)
- P86 — repair dropped guides (키 누락 silent drop)
- P90 — dbMatcher city guard (도시 보존 실패)
