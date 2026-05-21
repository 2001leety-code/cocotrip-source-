# CocoTrip AI Planner — 디테일 강화 로드맵 v1.4

작성일: 2026-05-21 (v1.4 — P128 충돌 해소 + Phase E 추가 + 8 PR 머지 통합 + 외부 revert 후 재생성)
작성자 채널: 위자드 코드 / 로드맵 정리 채팅창
전달 대상 채널: DB 수집 채팅창 (러닝/트레킹 등 신규 DB 작업 중)
문서 종류: HANDOFF — 양 채널 동기화용 SSOT

---

## 0. 한 줄 정체

위자드 Step 1-2-3-4 입력 → one-shot AI 플랜. 디테일 = 위자드 input + 사전 수집 DB 1:1 매칭. 추론 시간 = DB pre-warm + PR #516 block-mode.

---

## 1. 시스템 철학 — 운영자 의도 받아적기 7 종 (영구 박제)

### 1.1 위자드형 vs 대화형 ("디테일하게 나왔으면 해서")

> "AI 플랜 스텝 1 2 3 4 의 정보로 우리 플랜을 짜주는 시스템이자나. 다른 AI 들 처럼 대화 형식이 아니라. 그래서 나는 디테일하게 나왔으면 해서 저 방법을 선택한 거였거든."

- AI 플랜 = Wizard Step 1-2-3-4 input → **one-shot plan 생성**
- 대화형 (ChatGPT 식 반복 Q&A) **X**
- 위자드형 (사전 정보 수집 → 한 번에 생성) **O**
- 왜 위자드: 모든 input 미리 수집 → AI 가 풀 컨텍스트로 한 번에 → 디테일 + 일관성

### 1.2 각 input = 디테일 강화 옵션 (강제 X)

| Input | 없으면 | 있으면 (디테일 강화) |
|---|---|---|
| 도시 | plan 자체 불가 (필수) | — |
| 날짜 | plan 자체 불가 (필수) | — |
| 인원 | default 2명 | 가족/단체 맞춤 동선 |
| 공항/항공편 | arrival/departure day 일반 | 시간 buffer 반영 (P124) |
| **호텔** | zone 중심 bookend (덜 디테일) | 호텔 좌표 anchor → 매일 동선 정확 |
| 음식 선호 | 일반 추천 | 알러지/할랄/스파이스 반영 |
| 테마/액티비티 | 균형 잡힌 plan | 특정 테마 집중 |
| 도시별 호텔 (다도시) | 도시 zone 중심 bookend | 도시별 anchor → 다도시 정확 |

### 1.3 호텔 = 매일 동선 anchor ("호텔→이동→장소→...→복귀, 강제가 되면 안 되지")

> "AI 플랜 짤 때 호텔 > 이동경로 > 장소 > 이동경로 > 장소 호텔복귀 이걸 원해서 호텔을 넣었던거야."
> "강제가 되면 안되지 어디다 호텔을 잡을지 모르는데."

- 호텔 = **디테일 강화용 옵션 input** (필수/강제 X)
- 매일 동선의 출발/복귀 anchor
- 비어있으면 plan 디테일 살짝 낮아지지만 **동선 구조 (호텔→이동→장소→...→호텔복귀) 는 유지**

두 모드:
- 모드 A (호텔 있음): 호텔 좌표 anchor → 매일 디테일 풀
- 모드 B (호텔 없음): zone 중심 / 첫 추천 장소 → 매일 디테일 약간 낮음, but 구조 동일

### 1.4 통증점 — 추론 시간 ("시스템상 추론하고 플랜 짜는 데 시간이 너무 오래 걸려")

> "시스템상 추론하고 플랜 짜는 데 시간이 너무 오래 걸려. 그래서 지금 다른 채팅창에서 DB 수집하고 있고."

- AI 가 풀 컨텍스트로 한 번에 추론 → 시간 오래 걸림
- 위자드 input + 사전 수집된 DB 조합으로 추론 시간 단축 목표
- PR #516 block-mode 가 부분 해결 (Phase C 와 보완 관계)

### 1.5 DB ↔ 위자드 카탈로그 1:1 매칭 ("위자드 1-4 스텝의 아이콘들 파악하고 만들어야 된다")

> "DB 수집 하는 사람 (다른 채팅창) 이 위자드 1-4 스텝의 아이콘들 파악하고 만들어야 된다."

- DB 수집 방향 = 위자드 input 옵션 1:1 대응
- foodIndex (P54/P88/P114) 와 동일 패턴으로 runningIndex / trekkingIndex 예정
- 신규 DB 추가 시 4-item self-check: 옵션 여부 / 추론 vs DB / lodging bookend 호환 / 다도시 분기 호환

### 1.6 플립 스타일 UX ("러닝 클릭하면 5K 10K 한강 도심")

> "선택지가 딱 봐도 너무 많자나. 러닝 클릭하면 밑에 5키로 10키로 한강 도심 이런 게 나올 수 있게 플립 스타일처럼. 다른 예로 할랄 눌렀는데 씨푸드 치킨 한식 이렇게 말이야."

원칙 — Progressive Disclosure (계층적 / 점진 노출):
- 1단계: 메인 카테고리만 노출 (5-7개)
- 2단계: 클릭 시 sub-category 펼침 (플립 / 아코디언)

| 메인 | Sub (클릭 시 노출) |
|---|---|
| 러닝 | 5K / 10K / 하프 / 한강변 / 도심 / 공원 |
| 트레킹 | 산악 (한라/북한/설악) / 도시 등산 / 도보 코스 (올레) |
| 할랄 | 씨푸드 / 치킨 / 한식 / 양식 |
| 쇼핑 | 백화점 / 면세점 / 시장 / 명품 / 뷰티 |

### 1.7 Conditional 분기 매트릭스 ("내가 말한 것만 확인하지 말고 다른 선택지들도 체크")

> "1스텝에 호텔 예약 안 했을 때 나오는 것과 했을 때 나오는 게 달라야 하자나. 내가 말한 것만 확인하지 말고 다른 선택지들도 체크하라고."

핵심 분기 위치:
- Step0 Reservation: reservationStatus 4 종에 따라 호텔/항공 input 노출
- Step0 Destination: 단도시 vs 다도시 → hotelByCity / arrivalCityKey 후속 영향
- Step1 Food: 알러지 None / 할랄 / 비건 → 다른 옵션 자동 처리
- Step2 Details: isMultiCity / 공항 입력 여부 / theme → activities
- Step3 Review: 호텔 입력 O/X → anchor 표시 분기

Audit 의무: 부분 audit 금지 — 전수 매트릭스. 분기 변경 시 다른 step 연쇄 cleanup + default fallback 명시.

### 받아적기 7번째 ("오늘 정말 큰 작업 완료. 상용화 성공 기원.")

2026-05-21 다른 채팅창 종료 시 운영자 발언. 8 PR (#511~#518) main 머지 완료. Phase E 장기 후보 5 정의. "추가 진행 의향" = 운영자 결정 후 진행.

---

## 2. 현재 상태 (2026-05-21 다른 채팅창 8 PR 머지 후)

### 2.1 머지된 PR 표 (#511~#518)

| PR | 제목 | 영역 |
|---|---|---|
| #511 | trend-cron foundation (Naver rising + Reddit painpoints + VisitKorea meta) | 자료 수집 cron |
| #512 | admin zone_courses dashboard + trend hints 통합 | 어드민 UI |
| #513 | zone-courses schema 확장 + trekking/running PoC + intent classifier stub | 백엔드 |
| #514 | 서울 4 zone block (강남/홍대/명동/이태원) | zoneData |
| #515 | admin zone_courses trekking/running 분기 UI | 어드민 UI |
| #516 | block-mode 분기 + intent classifier 통합 + 수정 endpoint (P128) | AI 플래너 |
| #517 | intent classifier prod 모니터링 + 주간 cron + admin dashboard (P130) | 모니터링 |
| #518 | busan 5 + jeju 4 city_day + 한라산/설악산 트레킹 + 제주 올레 러닝 (11 block) | zoneData |

### 2.2 현재 브랜치

main (8 PR 모두 머지 후 기준)

### 2.3 진행 중 통증

- **추론 시간**: PR #516 block-mode 가 부분 해결. Phase C 로 보완 예정.
- **호텔 의도 3-layer**: 이 채팅창 Phase B → P134 (P128 충돌 해소 후 재명명). 다음 주 작업.
- **다도시 cycle 잔여**: P125 보강 (P129 — useReducer 통합).

### 2.4 알려진 운영자 액션 대기

- Vercel Dashboard: `PLANNER_MODE` 깨끗한 값 재설정 (현재 BOM+CRLF 손상값, P102)
- pre-push hook 활성화: 웹 프로젝트에서 `npm install` 한 번 → `prepare` script 자동 등록 (P118)

---

## 3. 5-Phase 로드맵

### Phase A — 카탈로그 SSOT (이번 주, BLOCKER)

**왜 BLOCKER**: DB 수집 채팅창 (다른 세션) 이 위자드 옵션과 미매칭 DB 를 수집하면 DB ↔ wizard mismatch 회귀 (P114/P88/P86/P90 반복). 먼저 정의해야 DB 수집이 올바른 방향으로 진행됨.

산출물 4 종:
1. `docs/WIZARD-INPUT-CATALOG.md` — 위자드 모든 input 옵션 SSOT (categoryKey + subCategoryKey + i18n label)
2. `docs/DB-COLLECTION-GUIDE.md` — DB 수집 채팅창 전달용 (각 DB 카테고리 ↔ wizard option 매핑)
3. 동기화 lint rule `R-P133` — wizard option 추가 시 catalog 업데이트 강제
4. DB 수집 채팅창 전달 — 운영자

**2026-05-21 외부 revert 이슈**: stash@{2} 에 산출물 보존. 이 문서 재생성 후 다음 세션에서 복구 또는 재작성.

### Phase B — 호텔 의도 3-layer (다음 주, P134)

**P128 충돌 주의**: PR #516 이 "block-mode + ai-planner-modify (P128)" 머지됨. 이 채팅창의 P134 (호텔 의도) 와는 영역이 다르므로 통합 불필요. P-번호 이 채팅창 기준 P134 유지.

3 layer 동시 처리 의무:

**Layer 1 — Frontend** (`src/components/WizardForm/`):
- `hotelByCity` 빈 객체 / 일부 도시 누락 OK, 항상 전달
- 다음 버튼 disable 안 함 (강제 X)
- placeholder: "호텔을 모르면 비워두세요 — AI 가 zone 중심으로 동선을 짭니다"

**Layer 2 — Backend prompt** (`api/lib/buildPrompt.js`):
- 호텔 있는 도시: 호텔 anchor → 매일 동선 계산
- 호텔 없는 도시: zone center / 첫 추천 장소 → lodging bookend 구조 유지
- MULTI-CITY HOTELS BY CITY block inject (P123 패턴)

**Layer 3 — planPersister.backfillDayLodging** (`api/lib/planPersister.js`):
- hotelByCity 비어도 stops[] 의 첫 lodging stop 자동 채움 (P119 안전망)
- hotelByCity city mismatch 가드 (P122 wrong city 차단)

### Phase C — 추론 시간 단축 (2-3주차)

통증점 1순위 (운영자 직접 명시). PR #516 block-mode 와 보완 관계.

신규 작업 NEW-A:
- DB pre-warm (서버 시작 시 foodIndex / zoneData 미리 로드)
- step instrumentation (P96 패턴 — withStep + hangWarn)
- 추론 게이지 (사용자 진행 중 단계 표시 — 최소 5분 cap 도달 공황 감소)

### Phase D — 위자드 안정+확장 (1개월차)

| P 번호 | 제목 | 영역 |
|---|---|---|
| P129 | P125 cycle + cleanup useReducer 통합 | WizardForm state |
| NEW-B | 러닝 카테고리 위자드 input + runningIndex 연결 | 신규 DB |
| NEW-C | 트레킹 카테고리 위자드 input + trekkingIndex 연결 | 신규 DB |
| P130 | resume modal clicker-only 미노출 강화 (P126 보강) | WizardForm UX |
| P131 | Quick Start preset → dateRange.to 동시 설정 | WizardForm UX |
| P132 | lint-i18n-coverage 도입 (R-P132) | 자율검증 |

### Phase E — 장기 후보 (2026-05-21 추가, 운영자 결정 대기)

다른 채팅창 작업 (#511~#518) 종료 후 운영자가 정의한 5 후보:

1. **Block-mode prod A/B test** — `PLANNER_BLOCK_MODE=auto` 활성화 → 응답 시간 + 만족도 측정. 운영자 Vercel env 액션 필요.
2. **강원/충청/경상 zone block 작성** — 현재 서울+부산+제주+한라산/설악산/올레 완료. 미커버 도시 확장. `zoneData.ts` 확장. **즉시 가능 (이 채팅창 영역)**.
3. **Intent classifier LLM 폴백 prompt 튜닝** — P130 (PR #517) 분포 데이터 누적 후. 시간 대기.
4. **자료 수집 cron 데이터 노출** — TrendHintsTab / PainpointsTab 실 데이터 wire-up. PR #511/#512 foundation 완료.
5. **Tripadvisor Content API 신청 + 신규 cron 추가** — 운영자 외부 API 신청 필요.

우선순위:
- 운영자 액션 필요: #1 (env), #5 (외부 신청)
- 즉시 가능: #2 (이 채팅창 영역)
- 어드민 영역: #4
- 데이터 누적 대기: #3

---

## 4. P128 → P134 재명명 결정 (2026-05-21)

**배경**: 다른 채팅창 PR #516 이 "block-mode + ai-planner-modify" 를 P128 으로 명명하여 머지. 동시에 이 채팅창의 audit 에서 "호텔 의도 3-layer fix" 를 P128 로 계획 중이었음.

**결정**:
- PR #516 의 P128 = block-mode 분기 + ai-planner-modify endpoint + intent classifier 통합. 이미 main 머지. **변경 불가**.
- 이 채팅창의 호텔 의도 fix = **P134** (재명명). 영역 다름 (위자드 input 처리 vs AI 플래너 분기). 통합 불필요.

**P134 범위**:
- `src/components/WizardForm/` hotelByCity 전달 Layer 1
- `api/lib/buildPrompt.js` 호텔 없음 분기 Layer 2
- `api/lib/planPersister.js` backfillDayLodging city mismatch 가드 Layer 3

---

## 5. 작업 배정 (Sonnet vs Opus)

**모델 적성**:
- Sonnet 4.6: 단순/정형/패턴 (UI 수정, 데이터 변환, unit test, 산출물 작성)
- Opus 4.7: 복잡/추론/통합 (prompt engineering, 매트릭스, state 통합, 최종 점검)

**Phase 별 핵심 배정**:

| Phase | Sonnet | Opus |
|---|---|---|
| A | WIZARD-INPUT-CATALOG 작성, DB-COLLECTION-GUIDE 작성, lint script | 카탈로그 설계 초안, Conditional 매트릭스, 최종 점검 |
| B | Layer 1 frontend (hotelByCity 전달), Layer 3 persister unit test | Layer 2 buildPrompt 호텔 분기 prompt, 최종 점검 |
| C | DB pre-warm 구현 4종 병렬, 추론 게이지 UI | NEW-A 설계, 최종 점검 |
| D | NEW-B/C 신규 DB 연결, P130/P131 UX fix | P129 useReducer 통합, P132 lint, 최종 점검 |

**병렬 룰**:
1. Worktree 분리 (`.claude/worktrees/agent-*`) — 독립 작업 충돌 0
2. 같은 파일 = 순차
3. 매 PR = 자율검증 3종 세트 (회귀 assertion + lint rule + 오답노트)
4. Phase 끝 = Opus 최종 점검 (5 체크리스트: assertion / 연쇄 영향 / i18n / 메모리 / 메타 lesson)

---

## 6. 다음 세션 first action

1. **Phase A 산출물 commit** — HANDOFF 재생성 이 세션 완료. WIZARD-INPUT-CATALOG.md + DB-COLLECTION-GUIDE.md 작성 후 commit.
2. **Phase E #2 검토** — 강원/충청/경상 zone block. `zoneData.ts` 현황 확인 → 즉시 가능 여부 판단.
3. **Phase B (P134) 착수** — PR #516 block-mode 와 영역 정합 재확인 후 3-layer 순차 작업.

---

## 7. 변경 이력

| 날짜 | 버전 | 변경 | 담당 |
|---|---|---|---|
| 2026-05-21 | v1.0 | 초안 — 운영자 의도 받아적기 1-4 + 4-Phase 로드맵 | Claude (위자드 audit) |
| 2026-05-21 | v1.1 | 1.6 플립 스타일 UX 추가 | 운영자 통찰 |
| 2026-05-21 | v1.2 | 1.7 Conditional 분기 매트릭스 + 메타 lesson "부분 audit 금지" | 운영자 통찰 |
| 2026-05-21 | v1.3 | Phase E 5 후보 + 받아적기 7번째 + 8 PR 머지 현황 통합 | 다른 채팅창 종료 |
| 2026-05-21 | v1.4 | P128 → P134 재명명 결정 + 외부 revert 후 재생성 | 이 세션 |

---

## 8. 관련 메모리 / 문서 링크

**메모리 파일**:
- `project_cocotrip_planner_roadmap_2026_05_21` — 이 문서의 메모리 인덱스 (SSOT 본체)
- `project_cocotrip_wizard_system_design` — 위자드 시스템 철학 전체 (1.1~1.7 원문 보존)
- `feedback_wizard_5step_audit_checklist` — 위자드 5-step audit 체크리스트 (PR 의무 포함)

**회귀 패턴 (DB-wizard mismatch)**:
- P114 dbMatcher per-day city — 다도시 plan 의 city 별 DB 매칭
- P88 B-MEAL snack slot — DB 카테고리 시간 슬롯 매칭
- P86 repair dropped guides — stops[] 키 누락 감지
- P90 dbMatcher city guard — city 매칭 보존

**회귀 패턴 (호텔 의도)**:
- P119 day.lodging backfill — stops[] 첫 lodging 자동 채움
- P122 multi-city lodging placeholder — 도시별 호텔 분기
- P123 hotelByCity forwarding — 호텔 input 의 backend 3 layer 전달

**repo docs**:
- `docs/WIZARD-INPUT-CATALOG.md` — Phase A 산출물 (이번 세션 / 다음 세션 작성)
- `docs/DB-COLLECTION-GUIDE.md` — Phase A 산출물 (이번 세션 / 다음 세션 작성)
