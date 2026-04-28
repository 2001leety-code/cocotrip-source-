# CocoTrip 로드맵 — 상용화 후 미해결 작업 큐

> **최종 업데이트**: 2026-04-28
> **컨텍스트**: 단일 세션 19개 PR 머지 후 (#118~#134). 베타 런칭 가능 상태.
> **다음 작업 단위**: Sprint 1 (1주), Sprint 2 (2주), 풀 재설계 (1개월).

---

## 📊 현재 상태 (2026-04-28)

### ✅ 완료된 본질 개선
- AI 모델: Gemini 2.5 Flash → **Pro** (instruction following 압도적)
- Hub-and-spoke 동선 강제 (매일 첫/마지막 stop = 숙소 근처)
- Google Places geocoding fallback (관광지명 인식)
- 다국어 식당 이름 concat sanitizer (3-layer + DB cleanup 542건)
- E2E 7-step 자동 검증 (월/수/금)
- PWA Day 1+2+3 (CSS + plugin + Update Toast)

### ✅ 운영 안전망
- Telegram 알림 (PDF/Gemini quota 실패)
- Sentry 에러 트래킹
- daily-health 매주 3회 자동
- BETA 배지 (사용자 기대치 조절)

### ✅ 비용 최적화
- Vercel 빌드: $158/cycle → ~$25 (-$130/월)
- GitHub Actions: 3,200min → 1,200min (-63%)
- Plan AI: $0.02 → $0.10 (매출 1%, 무시 가능)

---

## 🚨 Sprint 0 — 즉시 진행 (오늘~내일)

### 1. **Plan transit 다양성** (PR 진행 중) ✅ 추가됨
- 사용자 신고: "왜 다 걷는거니?" — 모든 segment가 walk
- 처방: prompt에 `매일 최소 1 segment >2km transit` 강제 + walk 안내 라벨
- 영향: 신규 plan + 기존 plan display

---

## 🔴 Sprint 1 — 1주일 내 (베타 → 공개 런칭 전)

### 2. **모바일 UI 대대적 개선** ⚡ 사용자 명시 요청 ("UI 개선 심각")

#### 발견된 문제 (사용자 PDF 분석)
| 영역 | 문제 |
|---|---|
| **Stop 카드 시각** | 텍스트만 나열, 시각 hierarchy 약함 |
| **Transit 블록** | "walk · 4분 [live]" 라벨만, 빈약 |
| **PDF 페이지 공백** | 하단 큰 공백 (pagebreak avoid 부작용) |
| **이미지 부재** | 식당/관광지 사진 없음 (텍스트 only) |
| **모바일 밀도** | 한 화면에 stop 1개만, 스크롤 과도 |
| **컬러 유니폼** | purple gradient 일변도, 카테고리 구분 약함 |
| **Action 부재** | 즐겨찾기/공유/Edit 버튼 발견 어려움 |

#### Sprint 1 변경 항목 (우선순위)

**P0 — 시각 정보 밀도** (2-3일)
- [ ] Stop 카드에 카테고리 아이콘 + 색상 톤 차별화 (food=orange, culture=blue, shopping=pink)
- [ ] Transit 블록 풍부화: 거리/시간 동시 표시, walk 시 "지하철보다 빠름" 라벨
- [ ] Day 헤더 시각 강화: 그라데이션 + 일자별 테마 아이콘

**P0 — 이미지 미리보기** (3-4일)
- [ ] Google Places API에서 식당/관광지 photo_reference 가져와 첫 1장 표시
- [ ] Lazy-load (intersection observer)
- [ ] Fallback: 카테고리 일러스트
- [ ] 비용: Photo API ~$7/1000 호출, plan당 ~5-7장 = ~$0.05/plan
- [ ] **결제 $9.90의 1% — 가치 있음**

**P1 — Action UX** (1일)
- [ ] Stop 카드 좌상단에 ⭐ 즐겨찾기 (mypage 연동)
- [ ] 우상단 ⋯ 메뉴: 공유 / 다른 식당으로 변경 / 길찾기
- [ ] 공유 버튼: WhatsApp / KakaoTalk deep link

**P1 — PDF 레이아웃 개선** (1일)
- [ ] PDF 헤더에 QR 코드 (cocotripkr.com/plan/<id> 링크)
- [ ] 카테고리별 색 토큰 일관성
- [ ] 빈 공간 채우기: 일별 요약 박스 (총 거리, 비용, 추천 photo)

#### 권장 순서
1. P0 시각 정보 밀도 (즉시 효과)
2. P0 이미지 미리보기 (가장 큰 임팩트, 시간 가장 큼)
3. P1 Action / PDF (마무리)

#### 참고 자료
- 경쟁: Klook, Trip.com, GetYourGuide의 모바일 plan UI
- 디자인 토큰: `src/lib/design-tokens.ts` 확장 필요
- 기존 작업: PR #122 (3 keyframes), PR #124 (글로벌 CSS), PR #126 (페이지 전환)

---

### 3. **`api/ai-planner-full.js` 분해** (P1 채무, 1-2일)

#### 현재 상태
- 511줄 (lock 500 → 11줄 초과)
- `--no-verify` 5회 누적 적용 (workflow_report.md Emergency Exception 로그)
- 분해 시급도 ↑

#### 분해 계획
| 추출 모듈 | 라인 | 새 위치 |
|---|---|---|
| `selectVehicle`, `calcPrice` | L40-52 | `api/_ai_core/vehicleAndPrice.js` |
| 입력 파싱 + pace mapping | L66-110 | `api/_ai_core/parseRequest.js` |
| Gemini 호출 + quota 처리 | L114-220 | `api/_ai_core/geminiCall.js` |
| Sheets/Telegram 알림 | L475-490 | `api/_ai_core/notifications.js` |
| 핸들러 본체 | L55-499 | 나머지 (300줄 목표) |

#### 검증
- 배포 직후 E2E 테스트 (`tests/e2e/full-plan-translation-pdf.spec.ts`) 무회귀 확인
- 성능: 분해 후 cold start 변화 없어야 함

---

### 4. **i18n smoke test 진단 + fix** (P2, 4시간)

#### 현재 상태
- 81/81 케이스 매번 실패 (preview SSO 문제로 추정)
- weekly-i18n-audit + pr-i18n-smoke 둘 다 동일

#### 진단
- 가설 1: Vercel preview deployment SSO 보호 → test가 실제 앱 도달 못 함
- 가설 2: 사이트의 i18n 키 vs test expected text mismatch (PR #125에서 charterTitle은 fix됨)

#### 처방 후보
- A. Vercel Bypass Token 사용 (Settings → Deployment Protection → Bypass)
- B. preview test → prod test 전환 (성격 변경)
- C. 새 axe-based test로 교체

---

## 🟡 Sprint 2 — 2주일 내 (공개 런칭 후)

### 5. **출발지 명시 분기 wizard 재설계**

#### 현재 한계
- Wizard Step 0에서 "도시" 선택만, "구체적 출발 위치" 입력 없음
- 호텔 예약 안 한 사용자: "어디서 시작해야 하지" 헷갈림

#### 새 플로우
```
Step 0a: 출발지 선택
  ├─ 공항 (ICN T1/T2, GMP, PUS, CJU)
  ├─ 호텔/숙소 (주소 입력)
  └─ 미정 — 추천 받기 → Step 0b로

Step 0b: 추천 숙소 지역 (Step 0a=미정 시만)
  ├─ 명동 / 홍대 / 강남 / 이태원 / 종로
  ├─ 각 지역별 설명 (장점, 분위기, 가격대)
  └─ 협찬 호텔 광고 슬롯 ✨

Step 1+: 기존 플로우
```

#### 기술
- WizardStep0Origin.tsx 신규
- WizardStep0Lodging.tsx 신규
- ai-planner-full.js: hotel_address 또는 추천 zone 받아서 hub-and-spoke 적용

#### 시간 추정: 3-4일

---

### 6. **광고 슬롯 통합 — 호텔 affiliate**

#### 사업 결정 우선
- [ ] Booking.com / Agoda affiliate 가입 (3-7일 승인)
- [ ] 약관 / 결제 정산 / 환불 검토
- [ ] 한국 통신판매업 신고 영향 확인

#### 코드 (사업 승인 후)
- 추천 숙소 지역 페이지에 sponsored 카드
- 호텔 카드 클릭 → Booking.com deep link (CocoTrip affiliate ID)
- conversion 추적 (PostHog 이벤트)

#### 시간 추정: 코드 2일 + 사업 1주

---

### 7. **운영 데이터 분석 인프라**

#### PostHog 통합 (메모리 reference)
- [ ] PostHog SDK 설치 (`posthog-js`)
- [ ] 핵심 이벤트:
  - `plan_generated` (planId, area, pace, duration)
  - `plan_downloaded` (planId, format=pdf)
  - `transit_clicked` (method, est_min) — walk/subway 선호 분석
  - `language_switched` (from, to)
  - `payment_started` / `payment_completed` / `payment_failed`
- [ ] 대시보드: plan 품질 (transit diversity, downgrade rate)

#### A/B 테스트 (1주 후)
- Flash vs Pro plan 만족도 비교 (이미 Pro 적용했으므로 회고 데이터)
- intensity 옵션 사용률
- 광고 슬롯 CTR

---

## 🟢 1개월+ — 풀 재설계

### 8. **3-pass 파이프라인 활성화 (Phase 4)**

CLAUDE.md G에 정의된 미진행 항목:
- Pass 1: 의도 파악 (Flash, 빠르게)
- Pass 2: Plan 생성 (Pro/Sonnet, 정확하게)
- Pass 3: Polish (Flash, 싸게)

현재 코드에 `threePassPipeline.js` 존재. PLANNER_MODE='3pass' 활성화 필요.

### 9. **데이터 보강** (Phase 6)
- 제주 식당 DB (현재: 0 비건, 부족한 일반)
- 경주/전주 식당 DB
- collect-restaurants.mjs 재실행 + 신규 지역 추가

### 10. **다양성 개선** (Phase 5 — 현재 18% OK)
- 모니터링: PostHog로 동일 stop 반복률 측정
- 임계 초과 시 prompt 조정

---

## 📋 사업적 결정 큐 (코드 외)

| 항목 | 우선순위 | 시간 |
|---|---|---|
| 약관/개인정보 4개 언어 (GDPR + KISA) | 🔴 베타 전 | 1-2주 |
| 환불 정책 페이지 명문화 | 🟡 베타 직후 | 1일 |
| 사업자등록 / 통신판매업 신고 | 🔴 결제 받기 전 필수 | 1-2주 |
| 보험 (여행업 책임) | 🟡 일정 지연 | 2-4주 |
| 마케팅 채널 결정 (광고 / SNS / 협업) | 🟢 첫 100명 후 | — |
| 첫 사용자 채널 (지인 / Reddit / 블로그) | 🔴 베타 시작 시 | 즉시 |
| 고객 응대 SOP (현재 텔레그램 봇만) | 🟡 첫 환불 요청 전 | 1일 |

---

## ⚠️ 알려진 약점 (CLAUDE.md F 발췌)

- **제주 비건 DB 0건** → 비건+제주 조합은 무조건 unverified
- **제주/경주/전주 식당 부족** → unverified_restaurant 잦음
- **Gemini 비결정성** → 같은 조건 다른 결과 (temperature 0.7 + thinking 32K로 완화)
- **Vercel preview SSO** → i18n smoke 81건 100% 실패 (prod 영향 없음)
- **iPhone 14 Pro lighthouse smoke 3ms 즉시실패** → 원인 미파악

---

## 🎯 권장 다음 액션

### 사용자가 선택해야 하는 결정

1. **Sprint 1을 언제 시작할지**:
   - 옵션 A: 오늘 모바일 UI 우선 진행 (이미 사용자 신고)
   - 옵션 B: 며칠 운영 데이터 보고 결정
   - 옵션 C: 풀 재설계 큰 sprint로 묶어서 진행 (1개월)

2. **광고 슬롯 사업 결정**:
   - 호텔 affiliate 시작? (3-7일 승인)
   - 또는 자체 차터 cross-sell만? (이미 코드 있음)

3. **마케팅 시작 시점**:
   - 현재 (베타) — 친구 10명
   - 1주 후 (안정화) — 트래블 커뮤니티
   - 1개월 후 (Sprint 1+2 끝) — 인플루언서 / 광고

### 제 권장
- **이번 주**: Sprint 1 P0 (모바일 UI 시각 정보 밀도) + Plan transit 다양성 검증
- **다음 주**: Sprint 1 P0 (이미지 미리보기) + ai-planner-full 분해
- **2주 후**: Sprint 2 (출발지 wizard + 광고 슬롯 사업 진행)
- **1개월 후**: 데이터 기반 풀 재설계 결정
