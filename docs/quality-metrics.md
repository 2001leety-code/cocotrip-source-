# Quality Metrics — 데이터 수집 + 측정 단위 + LLM 가드

PR-D (2026-05-07) 도입.
운영 학습 루프 (Tier 1 ~ 3) 의 약점 카운트 의미와 주간 AI 요약 임계값 가이드.

---

## 1. 약점 카운트 단위표

`plans/{id}.qualityScore.metrics.<metric_key>.count` 가 측정하는 단위.

| metric_key | 단위 | 의미 |
|---|---|---|
| `dietary_violation` | per stop | 식이제한(halal/vegan/allergy) 위반 stop 수 |
| `unverified_restaurant` | per stop | DB 매칭 실패 식당 stop 수 |
| `field_completeness` | per stop | 필수 필드(name/address/lat/lng) 누락 stop 수 |
| `route_failure` | per stop | RouteAgent 가 경로/시간 산출 실패한 stop 수 |
| `bad_address_prefix` | per stop | "대한민국 "/"KR " prefix 가 남아있는 stop 수 |
| `language_mismatch` | per stop | 사용자 언어와 다른 텍스트가 노출된 stop 수 |
| `duplicate_stops` | per duplicate | 같은 plan 안에 중복된 stop 그룹 수 (3건 중복 = 2 카운트) |
| `tight_schedule` | per segment | 두 stop 사이 이동 시간이 임계 미만인 segment 수 |
| `loose_schedule` | per segment | 두 stop 사이 이동 시간이 임계 초과인 segment 수 |

**중요 — per-segment 와 per-plan 혼동 주의**: 1 plan 안에 10 segment 가 있으면
`tight_schedule` 한 plan 에서 최대 10 카운트 가능. admin 대시보드의 "빡빡한 일정 10건"
은 plan 1건의 10 segment 모두 빡빡한 케이스도 정상 데이터.

---

## 2. 데이터 수집 컬렉션 (Firestore)

| 컬렉션 | 의미 | 생성 위치 | createdAt 타입 |
|---|---|---|---|
| `plans` | AI 플래너 결과 + qualityScore | `api/_ai_core/planPersister.js` | `createdAt` Timestamp + `createdAtMs` number |
| `plan_complaints` | 사용자 plan 신고 (5 reason enum) | `api/submit-plan-complaint.js` | `createdAt` serverTimestamp |
| `cs_tickets` | CS 티켓 (status / priority) | `api/telegram-webhook-admin.js` | `createdAt` serverTimestamp |
| `error_log` | 에러 로그 (Tier 2-E) | `api/_shared/sentry.js` 외 | `createdAt` serverTimestamp (예정) |

**주간 cron (`api/_crons/weekly-quality-report.js`) 가 위 4 컬렉션을 fetch.**
- `_shared/quality-summary-helper.js` 가 단일 진실 원천 (admin endpoint + cron 공유).
- 컬렉션 미존재 또는 빈 컬렉션 시 → 응답에 `_collectionMissing: ['error_log', ...]`
  배열로 명시. 운영자가 admin 대시보드 빨간 배너 + 텔레그램 메시지 prefix 로 즉시 인지.

---

## 3. 주간 AI 요약 LLM 임계값 가드

`api/_shared/quality-summary-helper.js#hasSufficientDataForLLM(summary)` 가 결정.

**조건:** `plansGenerated >= 5` **AND** `(csTickets + errorLogs + userReports) >= 3`

| 상황 | 동작 |
|---|---|
| 임계값 충족 | Gemini 2.5 Flash 호출 → "가장 시급한 3가지 문제" |
| 임계값 미달 | 정적 fallback 텍스트, LLM 호출 스킵 |
| `GEMINI_API_KEY` 미설정 | 정적 fallback (기존 graceful) |
| Gemini API 에러 | 정적 fallback "(Gemini 요약 실패 — Vercel 로그 확인)" |

**Fallback 텍스트:**
- 한국어: `이번 주 데이터가 부족해 트렌드 분석이 어렵습니다 (plans: N건). 데이터 수집 경로 점검을 권장합니다.`
- 영어: `Insufficient data for trend analysis this week (plans: N). Recommend reviewing data collection paths.`

**왜 가드가 필요한가:**
1. **비용** — 데이터 1-2건으로는 의미 있는 분석 불가 → 호출 자체가 낭비.
2. **Hallucination 방지** — 데이터 부족 시 LLM 이 일반론적 텍스트("고질적 문제가 있습니다")
   를 출력 → 운영자가 잘못 해석하면 무리한 의사 결정으로 이어질 수 있음.
3. **수집 미작동 신호** — fallback 텍스트가 노출되면 운영자가 수집 경로 자체를 점검.

---

## 4. 운영자 점검 체크리스트

**주간 리포트가 의미 없는 결과를 내놓을 때:**

1. admin 대시보드 (`/admin/quality`) 상단 빨간 배너 확인
   → `_collectionMissing` 에 등장한 컬렉션 이름이 Firestore 에 실제 존재하는지 확인
2. 컬렉션 존재 시 → 권한/인덱스 점검
   - `firestore.rules` 에 read 허용 규칙 확인
   - createdAt 인덱스 자동 생성 확인 (단일 필드는 자동)
3. 컬렉션 미존재 시 → 데이터 수집 경로 미구현 가능성
   - `error_log` 미수집 → Sentry / Tier 2-E 활성화 필요
   - `cs_tickets` 0건 → 텔레그램 admin 봇 사용 빈도 확인
   - `plan_complaints` 0건 → "이상해요" 버튼 노출 확인 (PlanDetailPage)

---

## 5. 관련 파일

- `api/_shared/quality-summary-helper.js` — 단일 진실 원천 (fetch + aggregate + guard)
- `api/admin-quality-summary.js` — admin 대시보드용 endpoint
- `api/_crons/weekly-quality-report.js` — 주간 cron
- `src/pages/AdminQualityDashboard.tsx` — 시각화
