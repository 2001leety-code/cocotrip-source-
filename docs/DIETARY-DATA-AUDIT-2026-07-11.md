# 식단 안전 데이터 감사 보고서 (2026-07-11, 운영자 지시 3단계-B)

## 결론 요약

`api/_food_index.json` 의 dietary 태그(halal/vegan/vegetarian) **328건 중 218건(66%)이
검증 근거 없는 수집분** — Naver 키워드 검색(202) + AI-curated(16). 이 태그가 현재
프롬프트 주입·DB 매칭·검증(dbDietTag)에서 **인증 증거처럼 사용**되고 있었다.
삭제하지 않고 `verification_status` 등급으로 격리한다 (본 PR).

## 실증된 오염 사례 (운영자 제보 3건 전부 확인)

| 레코드 | tag | 실제 | 소스 신호 |
|---|---|---|---|
| 덕양수산 (거제) | vegan | **생선회 식당** (cuisine `한식>생선회`) | naver_local, placeId 없음, rating 0 |
| 홀리카홀리카 이마트 여수점 | vegan | **화장품 매장** (cuisine `쇼핑,유통>화장품`) | naver_local |
| 가족 (여수) | halal | **치킨·닭강정** (cuisine `음식점>치킨,닭강정`) | naver_local |

명백 모순(육류·생선·비식당에 dietary 태그) 자동 검출: **13건** — 대부분 할랄 "마트"(식당 아님)
가 halal 식당 태그로 등재. 전체 목록은 아래 스크립트로 재현 가능.

## 정량 현황 (총 3,166 레코드)

| 소스 | halal | vegan | vegetarian | 계 | 신호 |
|---|---|---|---|---|---|
| google_places (source 필드 없음·placeId+평점 있음) | 52 | 58 | 0 | **110** | Google Places 실존·평점 — 단, **인증서 검증은 아님** |
| naver_local | 50 | 121 | 31 | **202** | 키워드 검색 결과 — placeId 없음·평점 0·검증 0 |
| ai_curated_2026_05_21 | 7 | 9 | 0 | **16** | AI 생성 — 검증 0 |

## 격리 시 커버리지 영향 (핵심 리스크)

- **서울(halal 44·vegan 43)·부산(halal 8·vegan 15)만 google_places 기반 후보 존재.**
- 그 외 **전 도시 43개 (도시×태그)** 조합이 격리 후 후보 0 — 제주·경주·전주·대구·대전·인천 등
  지방 도시의 halal/vegan/vegetarian 전부.
- → 지방 dietary 플랜은 `DIETARY_COVERAGE_UNAVAILABLE` 로 **정직하게 실패**시킨다
  (결제 사용권·쿠폰 미소비 — 사전 체크 + 기존 롤백 구조). 거짓 vegan 생선회집 추천보다
  정직한 실패가 안전. 운영자 검증으로 도시별 복구.

## 신뢰 등급 체계 (본 PR 구현)

| verification_status | 부여 기준 | dietary 매칭 사용 |
|---|---|---|
| `halal_certified` / `vegan_restaurant` | 운영자가 source_url(인증서·공식 페이지) 확인 후 수동 부여 | ✅ 최우선 |
| `muslim_friendly` / `vegan_options` | google_places 기반(실존+평점) dietary 태그 — 자동 부여 | ✅ (인증 아님을 사용자 문구에도 반영) |
| `unverified` | naver_local·ai_curated dietary 태그 — 자동 격리 | ❌ **매칭·프롬프트·검증 증거에서 제외** |

레코드 필드 추가: `dietary_claim`(기존 tag 보존) / `verification_status` /
`source_url` / `verified_at` / `verified_by` / `certification_type` (수동 검증용 스캐폴드, null 허용).

## 운영자 검증 워크플로 (제안)

1. 이 보고서의 unverified 목록(도시별)에서 실제 인증·확인 가능한 곳을 조사
   (KTO 무슬림친화 식당 목록·한국이슬람교중앙회(KMF) 인증 목록·공식 홈페이지).
2. 확인된 곳: `source_url`+`certification_type` 기입 → `halal_certified`/`vegan_restaurant` 승격.
3. 승격은 `scripts/build-food-index.js` 의 수동 오버라이드 파일(`food_data/verified_overrides.json`)로 —
   재수집 시에도 유지.

## 재현 스크립트

```bash
node -e "const d=require('./api/_food_index.json');
console.log(d.filter(r=>['vegan','halal','vegetarian'].includes(r.tag)&&['naver_local','ai_curated_2026_05_21'].includes(r.source)).length)"
```
