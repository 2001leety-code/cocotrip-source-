# `/tours` 편집형 정리 — 로컬 production preview 실측 (2026-08-11)

`design/tours-catalog-editorial` 의 시각 근거. **프로덕션 번들 그대로** 띄워서 쟀다:

```bash
npm run build && npx vite preview --port 4519
BASE_URL=http://localhost:4519 npx playwright test tests/e2e/tours-catalog-editorial.spec.ts --project='Desktop Chrome'
```

12조합 = 390 / 768 / 1440 × ko / en / ja / zh. 예약·결제는 누르지 않았다(읽기·측정만).

- `cards-<vp>-<lang>.jpg` — 카드 그리드 첫 화면
- `last-<vp>-<lang>.jpg` — 제목이 가장 긴 상품(`tour-multicity-3d`) 카드

## 측정 결과 (12/12 PASS)

| 뷰포트 | 카드 | line-clamp | 제목 높이 | 잘린 제목 | 조작 컨트롤 | 최소 크기 | Popular 칩 | 영어 누출 | 가로 넘침 |
|---|---|---|---|---|---|---|---|---|---|
| 390 × ko/en/ja/zh | 9 | 2 | 39px (전 카드 동일) | 0 | 44 | 44×44 | 0 | 0 | 0 |
| 768 × ko/en/ja/zh | 9 | 2 | 41px (전 카드 동일) | 0 | 44 | 44×44 | 0 | 0 | 0 |
| 1440 × ko/en/ja/zh | 9 | 2 | 41px (전 카드 동일) | 0 | 44 | 44×44 | 0 | 0 | 0 |

- **제목 높이가 전 카드 동일** = 1줄짜리 제목도 2줄 자리를 차지한다 → 그리드 정렬이 제목 길이에
  흔들리지 않는다. 39px = leading-snug(1.375) × 14px × 2줄, 41px = × 15px × 2줄.
- **잘린 제목 0** = 모든 `h3` 에서 `scrollHeight ≤ clientHeight`.
- **최소 크기 44×44** = 지역 레일·필터 패널(검색·지우기·지역·기간·관심사·페이스·언어·정렬)·
  카드 위시리스트·맞춤문의 CTA·숙소 CTA 전부. 공용 헤더/하단 네비는 이 범위 밖
  (`docs/DESIGN-EDITORIAL-CONCIERGE.md` §6 shared-navigation 단계 소관).
- **AI-CURATED / Best Value 0** 유지.

## 이번 변경이 실제로 막은 잘림

`line-clamp-1` 시절 잘려 있던 제목(같은 스크립트로 clamp 를 풀고 잰 자연 줄 수):

| 조합 | 2줄이 필요한 제목 |
|---|---|
| 390 / 768 / 1440 × en | `Korea Multi-City 3D2N (Seoul · Gyeongju · Busan)` |
| 768 / 1440 × ja | `韓国マルチシティ 3日2泊（ソウル・慶州・釜山）` |

나머지 8개 상품은 어느 조합에서도 1줄이라 예약 가능한 상품명이 바뀌지 않는다.
