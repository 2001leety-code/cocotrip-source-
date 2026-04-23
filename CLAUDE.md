# CocoTrip AI Planner — Project Rules

## A. 프로젝트 개요

CocoTripKR — 한국 프라이빗 투어 예약 + 유료 AI 플래너 ($9.90)

**데이터 흐름:**
```
WizardForm → PayPal 결제 → ai-planner-full.js:
  1. Gemini 2.5 Flash 호출 (L800-803)
  2. JSON 파싱 + 수리 (L824-883)
  3. 주소 정리: "대한민국 "/"KR " 제거 (L886-893)
  4. 응답 검증 validateResponse() (L896-898)
  5. 백엔드 DB matcher (L900-956)
  6. RouteAgent: Naver Geocoding + ODsay Transit (L968-1018)
  7. T-money 계산 (L1021-1040)
  8. Firestore 저장 (L1057-1082)
  → PlanDetailPage.tsx 렌더링 + PDF 다운로드
```

**프로덕션:** https://cocotripkr.com (Vercel)
**테스트 계정:** 2001leety@gmail.com (TEST- prefix PayPal 바이패스)

---

## B. 🔴 절대 금지 규칙 (이거 어기면 프로덕션 장애)

1. **`api/_food_index.json` 삭제 또는 .gitignore 추가 금지**
   → DB matcher 전체 사망 (silent fail — 에러 안 나고 그냥 안 됨)

2. **stop 필드를 `name_ko`/`name_en`/`tip_en`으로 되돌리지 말 것**
   → Gemini는 `name`/`display_name`/`tip` 반환
   → 불일치하면 사용자에게 빈칸 표시

3. **PDF 컨테이너를 `left:-9999px` 또는 `display:none`으로 숨기지 말 것**
   → html2canvas는 화면 밖 요소 렌더링 불가 → PDF 백지
   → 현재 정답: `position:absolute; left:0` + overlay(z-index:99998)로 가림
   → `document.fonts.ready` 대기 필수 (한글 폰트 로딩)

4. **Gemini 프롬프트에서 `"verified": true` 규칙 제거 금지**
   → 백엔드 DB matcher가 보정하지만 프롬프트도 함께 작동해야 효과적

---

## C. 필드명 스키마 규칙

| 구 스키마 (사용 금지) | 신 스키마 (현재) | 용도 |
|---|---|---|
| `name_ko` | `name` | 항상 한국어. 네이버맵 검색용 |
| `name_en` | `display_name` | 사용자 언어. UI 표시용 |
| `tip_en` | `tip` | 사용자 언어. 팁 텍스트 |

**코드에서 참조 시 반드시 폴백 패턴 사용** (Firestore 기존 플랜 호환):
```javascript
// 표시용
stop.display_name || stop.name_en || stop.name || stop.name_ko

// 한국어명 (네이버맵 검색용)
stop.name || stop.name_ko

// 팁
stop.tip || stop.tip_en
```

---

## D. 핵심 파일 맵

### AI 플래너 백엔드
| 파일 | 주요 기능 | 핵심 라인 |
|---|---|---|
| `api/ai-planner-full.js` (1243L) | Gemini 호출 + DB matcher + 주소 정리 + Firestore | L112-127: logPromptMetrics, L129-169: validateResponse, L171-488: buildSystemPrompt, L800-803: Gemini call, L900-956: DB matcher, L1057-1082: Firestore save |
| `api/_food_index.json` (1.2MB) | 검증된 식당 DB | ⚠️ 삭제 금지. `build-food-index.js`로 재생성 |
| `api/_food_helper.js` (229L) | 식당 DB → 프롬프트 주입 | L19-31: getFoodIndex (lazy load), L141-228: getFoodContext, L227: 프롬프트 형식 |
| `api/_email-renderer.js` (344L) | 확인 이메일 HTML + 텍스트 | L66-68: name/display_name/tip 폴백, L178-306: renderBookingEmail |
| `api/_ai_core/agents/RouteAgent.js` (261L) | Naver Geocoding + ODsay Transit | L38-67: Phase 1 Geocoding (L40,65: name 폴백), L72-91: Phase 2 ODsay+Naver, L96-184: Phase 3 Time Stitching |

### 프론트엔드
| 파일 | 주요 기능 | 핵심 라인 |
|---|---|---|
| `src/pages/PlanDetailPage.tsx` (876L) | UI 카드 + PDF 렌더 | L103-294: handleDownloadPDF, L113-124: PDF 컨테이너 (position:absolute left:0), L254-260: font.ready 대기, L651: display_name 폴백, L670: tip 폴백, L753: Naver map URL |
| `src/types/plan.ts` (106L) | Stop/Day/Plan 타입 정의 | L10-47: Stop interface (name, display_name, tip) |

### 스크립트
| 파일 | 주요 기능 |
|---|---|
| `scripts/validate-planner.cjs` (261L) | 품질 검증 러너 (5 시나리오, Gemini 5회 호출) |
| `scripts/build-food-index.js` (117L) | `food_data/*.json` → `api/_food_index.json` (rating≥4.5, reviews≥50) |

---

## E. 변경 시 검증 방법

```bash
# 플래너 품질 테스트 (Gemini 5회 호출, ~5분)
node scripts/validate-planner.cjs
# 기준치: 총 이슈 9건 이하, bad_address_prefix 0, language_mismatch ≤1

# TypeScript 빌드
npx tsc --noEmit

# 전체 빌드 (Vercel 배포 전)
npx tsc -b && npx vite build
```

**배포 전 체크리스트:**
- [ ] 프롬프트 필드명: `name`/`display_name`/`tip`만 사용 (`name_ko`/`name_en`/`tip_en` ❌)
- [ ] 코드 필드 참조: 신 || 구 폴백 패턴 유지
- [ ] `api/_food_index.json` 삭제 안 했는지 확인
- [ ] PDF 컨테이너: `position:absolute` + `left:0` 유지 확인
- [ ] 새 텍스트 추가 시 `ko`/`en`/`ja`/`zh` 4개 언어 동시 추가
- [ ] 모바일 전용 수정이 데스크톱에 영향 안 주는지 확인

---

## F. 알려진 약점

- **제주/경주/전주 맛집 DB 부족** → `_food_index.json`에 해당 지역 식당이 적어 `unverified_restaurant` 발생
- **Gemini 비결정성** → 동일 조건에서도 결과 변동 (temperature=0.95)
- **제주 비건 DB 0건** → 비건+제주 조합은 반드시 unverified 발생

---

## G. 프로젝트 상태 (2026-04-16)

**Phase 3 완료** — 총 이슈 32→9건 (-71.9%)

| 지표 | Phase 1 기준 | Phase 3 후 |
|---|---|---|
| 총 이슈 | 32 | 9 |
| unverified_restaurant | 21 | 7 |
| language_mismatch | 10 | 1 |
| 다양성 중복률 | 21% | 18% |

**남은 Phase:**
- Phase 4: 3-pass 아키텍처 — 사용자 명시적 승인 후만 시작
- Phase 5: 다양성 개선 — 현재 18%, 목표 달성 상태
- Phase 6: 제주/경주/전주 DB 수집
