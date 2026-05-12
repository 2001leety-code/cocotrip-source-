# CocoTrip 가격 anomaly 종합 audit — 2026-05-12

운영자 우려 "부산 공항픽업, 투어 패키지 금액 이상한 거 없나" 확인 보고서.
코드 변경 X. 분석 + 권장만.

## 핵심 요약

| Severity | 갯수 | 주요 항목 |
|---|---|---|
| 🔴 P0 (즉시 fix) | 4 | PUS pickup 결제 불가 / PUS UI 가격(₩100K) ↔ formula 가격(₩110K) 불일치 / busan pickup ₩600K 권역 / Bus 배수 3.0× 시장 비현실 |
| 🟡 P1 (검토 필요) | 6 | 공항 pickup KRW/USD 환율 비일관 / multi_day 단순 식 / DMZ vs Seoul Suburb 가격 동일 / 톨비 50km 미만 0원 / Sprinter 가이드 의무 + 동시 옵션 노출 / 콤보 10% 할인 SSOT 표기 부재 |
| 🟢 P2 (정보) | 3 | seoul-night 야간 surcharge 정책 분리 / Multi-city 3D2N USD priceFrom vs SSOT 미동기화 / KRW→USD 환율 default 1350 (현 시세 ~1430) |

**가장 critical**: ICN 외 공항(PUS/CJU/GMP/TAE 등) 공항 pickup 은 `resolveProductType.ts:41` 에서 `payable: false` 로 즉시 결제 불가. 그러나 `affiliateLinks.ts:237` 의 `PICKUP_PRICES.PUS = ₩100,000` UI 표기 + WizardForm 진입 모두 살아있어 **사용자가 결제 못 하는 가격을 보고 wizard 끝까지 진행 가능**. 부산이 4/26~5/12 prod 운영 중인데도 이 상태인 것이 운영자 우려의 본질.

---

## 1. 발견된 anomaly (severity 순)

### 🔴 P0 — 즉시 fix 필요

| # | 항목 | 현재 코드 위치 | 문제 | 권장 |
|---|---|---|---|---|
| 1 | **ICN 외 공항 픽업 PayPal 결제 차단** | `src/components/charter/resolveProductType.ts:41-46` | `state.origin !== 'ICN'` 이면 `payable: false`. PUS/GMP/CJU/TAE 등 모두 wizard 끝까지 가도 결제 불가. WhatsApp/문의 폼 fallback. UI 표기는 살아있어 사용자가 "왜 결제 안 됨?" 혼란 가능. | (A) GMP/PUS/CJU 도 createPaypalOrder.js productType 매핑 추가 (`airport_busan_metro`, `airport_jeju_metro` 등), `affiliateLinks.ts:227-239` 의 PICKUP_PRICES 와 일치하도록 pricing_spec.json `airport_transfer_prices` 항목 신설. **또는** (B) UI 에서 ICN 외 공항 선택 시 "협의" 라벨 강제 + 가격 숨김. |
| 2 | **부산 공항픽업 가격 UI vs 백엔드 불일치** | UI: `affiliateLinks.ts:237` PUS=₩100,000<br>SSOT 매트릭스: `pricing_spec.json:360` PUS→BUS_METRO km=30 priceKRW 없음 | UI 카드에 PUS=₩100K 표시. 그러나 SSOT 매트릭스 `PUS→BUS_METRO` 는 priceKRW 없이 km=30 만 보유. wizard 진행 시 staria formula 적용: 50K + 30×2K = ₩110,000 (+ km<50 톨비 0) ≠ UI ₩100K. **거기다 P0-#1 이슈로 어차피 PayPal 결제도 불가**. | SSOT `airport_transfer_prices` 에 `busan-metro: { priceKRW: 100000 }` 신규 + `PUS→BUS_METRO` 매트릭스에 `priceKRW: 100000, source: 'airport_transfer'` 추가. |
| 3 | **`pricing_spec.json` busan 항목 ₩600,000 라벨 "직행"** | `pricing_spec.json:174` | `airport_transfer_prices.busan` = ICN→부산 직행 ₩600K (km 450). 위 UI 통합(`100,000` PUS 출발) 과 별개 항목이라 키 충돌은 없지만, **운영자 5/9 결정 메모** ("이전 다른 곳 ₩600K 표기 통일") 가 SSOT 에는 반영 안 됨. 즉 ICN→부산 직행 차터를 ₩600K (5시간 직행) 로 받으면 staria intercity formula: 50K + 450km × 2K + 톨비 (450×150 = 67.5K) = ₩1,017,500 보다 훨씬 저렴 → **실비 미만, 운영 손실**. | 운영자에 확인: (A) ₩600K 유지하되 실비 손실 감수, 또는 (B) ₩1,000,000+ 로 인상, 또는 (C) busan 직행 항목 제거 후 multi_day 로 받음. |
| 4 | **Bus 배수 3.0× 비현실** | `useQuoteCalculator.ts:36`, `resolveProductType.ts:22` `VEHICLE_MULTIPLIER.bus = 3.0` | Staria 1.0×, Sprinter 2.0×, Bus 3.0×. SSOT `pricing_spec.json` vehicles.bus.intercity 는 base 100K + km×2070 + daily 450K (실비 기준). 그러나 wizard 화면은 단순히 staria 가격 × 3 으로 표시. 즉 ICN→서울 staria ₩124,800 × 3 = ₩374,400 으로 bus 표기되지만 실제 SSOT 기준은 100K + 52×2070 + 450K = ₩657,640 → **bus 견적이 SSOT 의 57% 수준**. 그나마 `isInquiryOnly()` 가 bus/vip 차단해서 결제 진행 안 되지만, **UI 견적 화면에 잘못된 숫자가 노출**됨. | bus/vip 차종 선택 시 가격 숫자 노출 자체를 숨기고 "협의" 라벨만 표시 (현재 needsCustomQuote=true 지만 vehicleChargeKRW 는 계산되어 영수증 미리보기에 보일 수 있음). |

### 🟡 P1 — 검토 필요 (운영자 결정)

| # | 항목 | 현재 | 문제 가설 | 상태 |
|---|---|---|---|---|
| 5 | **공항 pickup KRW/USD 환율 비일관** | `pricing_spec.json:167-174` | `seoul-central`: ₩124,800 / $90 → 비율 1386. `gangneung-sokcho`: ₩364,000 / $265 → 1373. `busan`: ₩660,000 / $490 → 1347 (P0 fix 후). **각 항목마다 환율 ±3% 변동**. KRW_PER_USD default 1350 과도 안 맞음. SSOT 가 정합성 잃음. | **🔴 운영자 결정 대기** |
| 6 | **multi_day 단순 식** | `useQuoteCalculator.ts:181-208` | hardcoded `daily = 200,000` + `overnight = 130,000`. staria intercity 만 적용. sprinter underprice. | **✅ PR #382 fix** — SSOT `VEHICLE_INTERCITY.sprinter` (280K/180K) 분기 도입 |
| 7 | **DMZ vs Seoul Suburb 가격 동일** | `pricing_spec.json:185-196` | `seoul-suburb`: ₩343,200 / `dmz`: ₩343,200 동일. DMZ 는 사전 신청 + 신분증 + JSA 가이드 비용 일반적으로 별도 (Korea Travel Easy 시장가 $80-150/인 + 차량). 동일 가격이라면 DMZ 가 marketplace 비교 시 가성비 신호로 받아질 수 있지만, **JSA 입장 자체가 임의 운영(미군 협조) 이므로 정책 변경 시 운영 risk**. | **🔴 운영자 결정 대기** |
| 8 | **톨비 50km 미만 0원 정책** | `calculator.ts:48-52` | km<50 → 톨비 0. 그러나 ICN→서울도심 = 52km (경계). ICN→GMP 환승 + 시내 = 60km. 실제 인천대교 통행료 = ₩9,000~15,800 (편도). **사용자 시각: ICN 출발이면 ICN 대교 톨 무조건 발생**. policy B 단순화 측면 OK 지만 ICN 출발은 항상 톨 부과 정책으로 분리 검토 필요. | **🔴 운영자 결정 대기** |
| 9 | **Sprinter 가이드 의무 + 동시 옵션 노출** | `useQuoteCalculator.ts:223-227, 218` | sprinter 는 `guide_required: true` → 자동으로 ₩300K 가이드비 가산. 그런데 사용자가 `options.licensedGuide` 체크하면 또 ₩300K 추가됨 (`englishGuidePerDay`). **중복 ₩600K 가산 위험**. | **✅ PR #383 fix** — `useQuoteCalculator` server dedup + Step5 UI conditional render + B-CHT18 + P32 lint |
| 10 | **콤보 10% 할인 SSOT 표기 부재** | `createPaypalOrder.js:54-61, 93-97` | `COMBO_MAP` 5개 (`combo_airport_seoul` 등) 은 createPaypalOrder.js 에 하드코딩 `(airport + tour) × 0.9`. SSOT `pricing_spec.json` 에는 콤보 항목 없음. **combo_airport_busan UI ₩627,300 vs backend ₩517,320 ₩110K mismatch** 검출. | **✅ PR #384 fix** — `pricing_spec.json` `combo_packages` 신설 + `computeComboPriceKRW()` SSOT 함수 + UI/backend 동일 호출 + B-CHT19 + P33 lint |

### 🟢 P2 — 정보 (참고)

| # | 항목 | 현재 | 비고 |
|---|---|---|---|
| 11 | seoul-night 야간 surcharge | `tours.ts:387` priceFrom $49 priceUnit=per_person | 5시간 야간투어 1인당 $49 = ~₩66K. SSOT daily_tour_prices 에는 매핑 없음 (TOUR_TO_CHARTER_KEY = 'seoul-city' fallback). **결제 시 charter_seoul_city 인 ₩330K 그룹가가 적용** (`tours.ts:14`). 1인 야간 결제 → ₩330K 그룹가 charged → 매우 비싸 보임. |
| 12 | Multi-city 3D2N USD/KRW 비동기화 | `tours.ts:749` priceFrom $580 | 매핑 키 null → priceFrom × 1350 = ₩783,000 KRW 표시. 그러나 SSOT multi_day daily=200K + overnight=130K + km(서울-부산 400km×2km×2왕복) = 2,860K+ 실비. **$580 가 시장 광고가/유인가, 실비는 별도 협의** 표기 필요. |
| 13 | KRW→USD 환율 default 1350 | `tours.ts:10` `calculator.ts:15` | 2026-05-12 실 시세 ~1430. 차이 약 6%. Vercel env `VITE_KRW_PER_USD` 로 override 가능. 별도 PR 추적 필요. |

---

## 2. 시장 비교 표 (외부 적정가, 휴리스틱)

| 시나리오 | 시장 적정가 (KRW) | CocoTrip 현재 | Δ % | 비고 |
|---|---|---|---|---|
| ICN → 명동 (50km, staria) | ₩75,000 (택시) / ₩17,000 (리무진) / ₩9,500 (AREX) | ₩124,800 | 택시 +66% | 프라이빗 프리미엄 OK |
| ICN → 강남 (65km, staria) | ₩90,000 (택시) | ₩145,600 | +62% | OK |
| ICN → 부산 직행 (450km, staria) | ₩59,800 (KTX 1인) ×4명 + 부산 택시 ₩40,000 = ₩280K | ₩600,000 | +114% | KTX 가 압도적으로 싸므로 직행 차터는 짐 많은 가족 한정. ₩600K 는 OK 지만 실비(₩1M+) 미만이라 운영자 손실. |
| PUS → 해운대 (30km, staria) | ₩30,000 (택시) | UI ₩100K / 실 formula ₩110K | +233~267% | UI/SSOT 불일치 + PayPal 결제 차단 (P0 #1,#2) |
| CJU → 중문 (40km, staria) | ₩30,000 (택시) | UI ₩72,800 | +143% | OK (프리미엄). 다만 PayPal 결제 차단 (P0 #1). |
| 서울 시티투어 1일 (8h staria) | KKday/Klook $200-300 (₩270K-405K) | ₩330,000 | 시장 평균 | OK |
| 부산 시티투어 1일 (10h staria) | KKday/Klook $250-330 (₩337K-446K) | ₩450,000 | 시장 상단 | B9-38 fix 후 시장가 정렬됨 |
| 멀티시티 3D2N (sprinter) | 카카오모빌리티/시티투어 ₩2.5M-3.5M (호텔 미포함) | $580 = ₩783K | -73% | priceFrom = 유인가/실비 별도 결제 정책 필요 (P2 #12) |

**핵심 한 줄**: 부산 PUS 픽업은 시장가 대비 +233%인데 결제도 안 됨 → 운영자 우려 적중.

---

## 3. 내부 일관성 매트릭스 (같은 차종 다른 zone)

### Staria 공항 pickup
| 거리 (km) | SSOT priceKRW | priceUSD | KRW/km | 비고 |
|---|---|---|---|---|
| ICN→명동 52 | ₩124,800 | $90 | ₩2,400 | base |
| ICN→강남 65 | ₩145,600 | $105 | ₩2,240 | +52% 면적 더 멀음 → -7% km단가 (대량할인 OK) |
| ICN→가평 90 | ₩208,000 | $150 | ₩2,311 | OK 균질 |
| ICN→춘천 120 | ₩220,000 | $165 | ₩1,833 | -23% km단가 (장거리 인센티브) |
| ICN→평창 230 | ₩332,800 | $240 | ₩1,447 | -39% km단가 |
| ICN→강릉 280 | ₩364,000 | $265 | ₩1,300 | -45% km단가 |
| ICN→부산 450 | ₩600,000 | $450 | ₩1,333 | -44% km단가 — 운영 실비 미만 |
| PUS→해운대 30 | UI ₩100,000 / SSOT 없음 (formula ₩110K) | — | ₩3,333~3,667 | **+50% km단가 outlier** |

### 당일 투어 (8-10h staria 그룹)
| 투어 | 시간 | 거리 (km 추정) | priceKRW | KRW/h | 비고 |
|---|---|---|---|---|---|
| 서울 시티 | 8h | 0-50 | ₩330,000 | ₩41,250 | base |
| 서울 근교 (남이섬·가평·수원) | 8h | 90+ | ₩343,200 | ₩42,900 | +4% (장거리 ↔ 동일 시간) |
| DMZ | 8h | 90+ | ₩343,200 | ₩42,900 | seoul-suburb 와 동일 (P1 #7) |
| 강원당일 | 10h | 250+ | ₩436,800 | ₩43,680 | km 4배인데 가격 +25%만 (가성비) |
| 스키 리조트 | 10h | 230+ | ₩416,000 | ₩41,600 | 강원당일 -5% |
| 경주·전주 | 10h | 370+ | ₩600,000 | ₩60,000 | +44% (특수 거리 인정) |
| 부산 당일 | 10h | 0-30 (부산 내부) | ₩450,000 | ₩45,000 | 거리 작은데 가격 강원당일 + 부산 직행 픽업 발생 가정. 단 5/9 B9-38 fix 후 출발지 협의 라벨이라 합리. |

---

## 4. SSOT 위반 / hardcode 위치

| File | Line | Value | 사유 |
|---|---|---|---|
| `src/config/affiliateLinks.ts` | 227-239 | PICKUP_PRICES (5 도시) | UI 표기 hardcoded. `pricing_spec.json:airport_transfer_prices` 와 별도 source. PUS=₩100K 등 ICN 외 공항 가격이 SSOT 에는 없음. |
| `src/hooks/useQuoteCalculator.ts` | 40-41 | `STARIA_BASE_FEE = 50_000`, `STARIA_RATE_PER_KM = 1000` | SSOT 와 동일하지만 매트릭스 km 만 있을 때 사용. **rate_per_km×2** 가 calcIntercityFormula(L68)인데 calculator.ts 는 `perKm: 2_000` 직접 = 사실상 왕복 ×2. 두 곳 의미 매번 추적 필요. |
| `src/hooks/useQuoteCalculator.ts` | 183-184 | `daily = 200_000`, `overnight = 130_000` | staria 전용 SSOT 값을 hardcoded. sprinter 일 때 SSOT(280K/180K) 적용 안 됨 → P1 #6. |
| `src/lib/calculator.ts` | 24-25 | staria 50K + 2K/km, sprinter 100K + 4K/km | SSOT vehicles.X.intercity 와 일치 (×2 왕복 의미 반영). 그러나 톨비를 별도로 분리해서 가산 (formula 가 perKm × 2 시 base + perKm + toll → SSOT 의 deadhead_factor 1.8 와 일관성 검토 필요). |
| `src/components/charter/destinationKeyMap.ts` | 18-25 | ZONE_DEFAULTS 권역별 km 평균 | 사용 안 됨 (`useQuoteCalculator.ts` 헤더 주석: "zone fallback 폐기"). 그러나 export 는 살아있고 importer 가 있다면 dead pricing path. 별도 cleanup 후보. |
| `api/createPaypalOrder.js` | 64 | `AI_PLANNER_FULL_KRW = 13_300` | SSOT pricing_spec.json 에 AI 플래너 항목 없음. createPaypalOrder.js + (worktree) api/_shared/pricing.js 두 곳 hardcode. |
| `api/createPaypalOrder.js` | 54-61, 93-97 | COMBO_MAP + `(airport + tour) × 0.9` | SSOT 외 콤보 할인 정책 (P1 #10). |
| `api/applyPromoCode.js` | 35 | `COCO5: { discount: 0.05 }` | hardcoded 5% 쿠폰. SSOT 외. |

---

## 5. 운영자 결정 대기

### 5/12-5/13 fix 완료 (자율 처리, 운영자 액션 불필요)
- ✅ **P0 #1/#2/#3/#4** (PR #381): PUS ₩77K + PayPal 4 공항 + ICN→부산 ₩660K + Bus/VIP 협의
- ✅ **P1 #6** (PR #382): sprinter multi_day SSOT 분기 (280K/180K)
- ✅ **P1 #9** (PR #383): Sprinter 가이드 중복 ₩600K 차단 (server dedup + UI hide + B-CHT18 + P32 lint)
- ✅ **P1 #10** (PR #384): 콤보 패키지 SSOT 단일화 — UI/backend mismatch ₩110K 차단 (B-CHT19 + P33 lint)

### 운영자 결정 대기 (3건, post-launch 후순위)

#### 🔴 P1 #5 — 환율 비일관 정리
**현황** (PR #381 후):
| zone | priceKRW | priceUSD | 산출 환율 |
|---|---|---|---|
| seoul-central | 124,800 | 90 | 1386 |
| seoul-gangnam | 145,600 | 105 | 1387 |
| gapyeong-nami | 208,000 | 150 | 1387 |
| chuncheon | 220,000 | 165 | 1333 |
| gangneung-sokcho | 364,000 | 265 | 1373 |
| busan (ICN→) | 660,000 | 490 | 1347 |
| busan-metro (PUS→) | 77,000 | 57 | 1351 |
| jeju-metro (CJU→) | 72,800 | 54 | 1348 |

**선택지**:
- A) **환율 1380 통일** → priceUSD 재계산 (예: busan-metro $57 → $56). 사용자 외화 표기 안정. 일부 zone $1-2 변동.
- B) **환율 1430 (실시세)** → priceUSD 다 인하 (KRW 그대로). 외국인 사용자 입장에서 "더 저렴해 보임". 운영 손실 X (KRW 기준 변동 X).
- C) **현 상태 유지** + `VITE_KRW_PER_USD` env 1350 → 1430 만 업데이트. 향후 가격 변경 시 통일.

**권장**: B (실시세 1430 적용 + priceUSD 인하). 외국인 perception 향상 + 실제 결제는 KRW 기준이라 영향 0.

#### 🔴 P1 #7 — DMZ vs Seoul Suburb 가격 동일
**현황**: `dmz`=₩343,200 / `seoul-suburb`=₩343,200 (같음).
**시장가**: KKday DMZ tour $100-150 (₩135-200K) /인 — CocoTrip은 그룹가 ₩343K (4명 → ₩86K/인) 가성비.
**risk**: JSA 입장 임의 운영 — 미군 협조 끊기면 환불·재예약 부담.
**선택지**:
- A) **₩400K 로 인상** (DMZ 특수성 반영). +17%.
- B) **현 가격 유지** (가성비 마케팅).
- C) **DMZ를 inquiry-only 로 변경** (사전 예약 까다로움 — 결제 차단, 협의 폼만).

**권장**: B (현 유지) — 부산 launch 후 DMZ 예약 건수 검증 후 재논의. 단 운영 risk 메모 보존.

#### 🔴 P1 #8 — 톨비 50km 미만 0원 정책
**현황**: `calculator.ts:48-52` km<50 → 톨비 0.
**문제**: ICN 출발 = 인천대교 톨 항상 발생 (편도 ₩9-15K). 단거리 (52km 미만) 도 톨 부담.
**선택지**:
- A) **ICN 출발은 km 무관 톨 ₩15K 가산** (정책 분리). +₩15K per booking.
- B) **현 정책 유지** (마케팅 단순함 — 톨 포함이 사용자 perception 좋음).
- C) **모든 톨 SSOT 분리** (`pricing_spec.json` 의 톨 테이블) — 향후 zone 별 정교 가산.

**권장**: B (현 유지) — 5/12 PR #381 이후 ICN→busan 등 장거리 톨은 이미 formula 에 반영. 단거리는 운영자 흡수 (사용자 perception 우선).

#### 🟢 P2 잔여 (별도 PR 추적)
- **P2 #11** seoul-night 1인 ₩330K 그룹가 charged 모순 — `tours.ts:387` per_person → group 결제 mismatch
- **P2 #12** Multi-city 3D2N USD $580 priceFrom 실비 ₩2.86M+ vs 광고가 ₩783K — "별도 협의" 라벨 필요
- **P2 #13** `VITE_KRW_PER_USD` 1350→1430 — Vercel env 업데이트 또는 ExchangeRate-API live fetch

---

## 부록 — 데이터 출처

- SSOT: `src/data/pricing_spec.json` v2.0.0 (2026-04-24 generatedAt)
- 차터 견적 핵심: `src/hooks/useQuoteCalculator.ts` (428L)
- PayPal: `api/createPaypalOrder.js` (199L), `src/components/charter/resolveProductType.ts` (85L)
- Tour 가격: `src/data/tours.ts:188-749` (priceFrom 9개 투어)
- UI 가격 표기: `src/config/affiliateLinks.ts:227-239` (PICKUP_PRICES)
- 단순 견적 공식: `src/lib/calculator.ts:24-25`
- 운영자 정책 메모: CLAUDE.md, MEMORY 인덱스 `project_cocotrip_session_2026-05-09_batch9.md` (B9-30 PUS 100K, B9-38 부산 12h→10h)
