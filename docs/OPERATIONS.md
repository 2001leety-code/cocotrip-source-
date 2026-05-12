# OPERATIONS — 운영 메모리 뱅크 (Tier 4-H)

CocoTrip 웹 운영 노하우 누적용 문서. **신규 직원 온보딩** + **AI 자동 응대 학습 데이터** 활용 목적.

> 본 문서는 **scaffold (구조 + 초기 항목)** 입니다. 운영자가 사례를 만나면서 시간 흐름에 따라 채워나가는 살아있는 문서입니다.

## 사용 가이드

- 새 사례 발생 시: 해당 § 섹션의 Pattern 들 중 매칭되는 것이 있으면 **Note** 갱신, 없으면 **새 Pattern** 추가
- Pattern 형식: `증상` → `대응` → `Edge case` → `Note`
- AI 학습용으로 재사용되므로, **고객 개인정보 (이름, 이메일, 전화번호) 는 절대 적지 마세요**. plan ID / booking ID 는 OK
- 미정/템플릿 항목은 `<!-- TODO: ... -->` 로 마킹

## 관련 문서

- `docs/ARCHITECTURE-frontend.md` / `docs/ARCHITECTURE-backend.md` / `docs/ARCHITECTURE-admin.md` — 시스템 구조
- `docs/CLEANUP-candidates.md` — 정리 대상 코드/문서
- `docs/RUNBOOK-google-wallet-activation.md` — 외부 활성화 절차
- `docs/PAYMENT-AUDIT-LOG.md` — 결제 변경 이력

---

## §1. 결제 / 환불

### Pattern 1.1 — AI 플래너 환불 요청

- **증상**: 사용자가 "AI 플래너 결제했는데 환불 요청합니다" 문의
- **대응**:
  1. 정책 안내: AI 플래너는 **디지털 상품** — 결제 완료 시점 즉시 PDF 다운로드 / 재생성 권리 부여 → `NO_REFUND_DIGITAL` 정책 적용
  2. 단, **버그로 결과물 미수령** (PDF 생성 실패 / 재생성 0회) 인 경우 예외 — Firestore `plans/{planId}` 에서 `pdfUrl` / `regenerateCount` 필드 확인
  3. 예외 환불 시: admin 패널 → 환불 처리 → `refundReason: 'system_error'` 로 기록
- **Edge case**: 사용자가 "결제는 되었는데 PDF 가 안 나옴" 신고 시 → Sentry / 서버 로그에서 `planId` 검색 → Gemini 응답 실패 / Firestore write 실패 여부 판별
- **Note**: <!-- TODO: 자동 환불 거절 템플릿 메시지 (한/영/일/중) 추가 예정 -->

### Pattern 1.2 — 차터 / 투어 환불

- **증상**: 차터/투어 booking 환불 요청
- **대응**:
  1. `evaluateRefundPolicy(booking.tourDate, now)` 호출 결과 확인 (api/refunds/evaluate)
  2. 시간 기반 정책:
     - **D-7 이상**: 100% 환불
     - **D-3 ~ D-7**: 50% 환불
     - **D-1 ~ D-3**: 30% 환불
     - **D-day / no-show**: 환불 불가
  3. 사용자에게 정책 + 환불 예정 금액 안내 후 admin 승인
- **Edge case**:
  - **기사 측 사유** (차량 고장 / no-show) 인 경우 → 100% 환불 + 보상 쿠폰 1회 발행
  - **천재지변 / 운영 정책상 취소** → 100% 환불 (정책 무관)
- **Note**: <!-- TODO: 부분 환불 (n명 중 m명만 취소) 정책 확정 필요 — 현재 임시 비례 환불 -->

### Pattern 1.3 — 쿠폰 적용 안 됨 신고

- **증상**: "쿠폰 코드 입력했는데 할인이 적용 안 됩니다"
- **대응** (진단 순서):
  1. 코드 자체 유효성: Firestore `coupons/{code}` 존재 여부 / `expiresAt` / `usageLimit` 확인
  2. 사용자 자격: `userId` 가 `claimedBy` 배열에 있는지 / 1인 1회 정책 위반 여부
  3. 적용 대상 검증: `applicableProductTypes` (예: `['ai_planner']` 인데 차터에 적용 시도) 확인
  4. 최소 결제 금액 미달: `minAmount` 조건
  5. 화면 캐시 문제: 사용자에게 hard refresh (`Ctrl+Shift+R`) 요청
- **Edge case**: 회원가입 환영 쿠폰 미발행 → §5 Pattern 5.1 참조
- **Note**: <!-- TODO: 쿠폰 적용 실패 사유 frontend 노출 메시지 4-lang 표준화 -->

---

## §2. AI 플래너 품질 신고

### Pattern 2.1 — 추천 식당 폐업 / 문닫음

- **증상**: 사용자가 "추천 식당 가보니 폐업했어요" 신고
- **대응**:
  1. plan 의 `restaurantIds` 에서 해당 매장 확인
  2. Firestore `restaurants/{id}.status` → `closed` 로 변경
  3. master_data 재생성 시 자동 제외되도록 `_food_index.json` 갱신 (PR 검토 필요 — 보호 파일)
  4. 사용자 보상: 재생성 무료권 1회 (`regenerateGrant: 1`)
- **Edge case**: 임시 휴업 vs 영구 폐업 구분 — 임시면 `status: 'temp_closed'` + `reopenAt` 설정
- **Note**: <!-- TODO: Tripadvisor / Google Places API 로 월 1회 자동 status 검증 잡 신설 검토 -->

### Pattern 2.2 — 일정 너무 빡빡 / 헐겁

- **증상**: "하루에 동선이 너무 멀어요" / "관광지가 2개밖에 없어요"
- **대응**:
  1. plan 의 `qualityScore` 확인 — 0.7 미만이면 자동 재생성 권유
  2. PlannerAgent 입력 파라미터 (`pace`: relaxed/normal/intense, `daysCount`) 사용자 의도와 일치하는지 검토
  3. 재생성 무료권 부여 (`regenerateGrant: 1`)
- **Edge case**: 5/3 batch 2 에서 무료 재생성 1→2회로 상향됨 — 2회 이미 소진한 사용자도 운영자 재량으로 추가 부여 가능
- **Note**: <!-- TODO: pace 별 권장 관광지 수 가이드라인 (kor 3개/일, etc.) 명문화 -->

### Pattern 2.3 — 식이제한 위반 (SAFETY-CRITICAL)

- **증상**: "할랄 요청했는데 돼지고기 식당 추천됨" / "비건 요청했는데 고기집 추천됨"
- **대응 (P0 처리)**:
  1. **즉시** plan 격리: `plans/{planId}.status: 'quarantined'`
  2. `cocotrip_backfill_v3_halal.py` 류 backfill 스크립트 검토 — master_data 의 식이 태그 (halal, vegan, vegetarian) 정합성 검증
  3. 사용자 사과 + 재생성 무료 + 차터/투어 쿠폰 1회 (보상)
  4. PlannerAgent 프롬프트의 식이제한 STRICT 강조 문구 검증
  5. Sentry 에러 태그 `dietary-violation` 로 기록 → 재발 방지 모니터링
- **Edge case**: 사용자가 사후 식이제한 추가 (재생성 시 새로 명시) → 위반 아님, 정상 재생성 처리
- **Note**: <!-- SAFETY-CRITICAL — 본 패턴은 절대 무시 / 지연 응답 금지. 발생 즉시 운영자 호출 -->

### Pattern 2.4 — L3 자동 모니터 (Quality Score 회귀 alert)

- **증상**: GitHub Issue `🔴 Quality score hard` 또는 `🟡 Quality score regression` 자동 생성 + (옵션) Telegram alert
- **트리거**: `.github/workflows/quality-alert.yml` — 매일 KST 10:00 (UTC 01:00) `node scripts/check-quality-score.mjs` 실행
  - `hard` (severity:hard) — 24h 평균 score < **80** (hard floor)
  - `regression` (severity:regression) — 24h 평균이 7d 베이스라인 대비 **10점** 이상 하락
  - `warn` — sample count < 5 또는 `_collectionMissing` 발견. issue 생성 X, GITHUB_STEP_SUMMARY 만 갱신.
- **대응 (P1, 24h 내)**:
  1. `/admin/quality` 대시보드 (AdminQualityDashboard) 열어 `worstPlans` + `byArea` 확인 — 어느 area / metric 이 가장 떨어졌는지
  2. issue body 의 "Top 3 violation (24h)" 표에서 가장 빈번한 위반 metric 확인 (예: `dietary_violation`, `unverified_restaurant`)
  3. **최근 24h 머지 PR diff** 검토 — Gemini 프롬프트 (`api/_ai_core/buildPrompt.js`) / DB matcher (`api/_ai_core/dbMatcher.js`) / `_food_index.json` 변경 의심
  4. 회귀 가설 검증: `node scripts/validate-planner.cjs` — Gemini 5회 호출, 약 5분 소요. 기준치 (총 이슈 ≤ 9건) 초과 시 직전 PR revert 또는 fix PR 진행
  5. fix 후 다음 day workflow 결과로 issue close (auto-detected 라벨이 살아있으면 새 alert 와 별개로 인지됨)
- **Edge case**:
  - **첫 운영 D+1~D+3**: 24h sample < 5 인 날 빈번 — `warn` 만 발생, fail 안 함. 정상.
  - **endpoint 404**: PR #225 미배포 / Vercel rollback 의심. `scripts/check-quality-score.mjs` 가 graceful skip (exit 0) 처리. 한 번이라도 200 나오면 정상화.
  - **credentials 미설정 첫 trigger**: `FIREBASE_WEB_API_KEY` / `HEALTH_CHECK_EMAIL` / `HEALTH_CHECK_PASSWORD` 셋 중 하나라도 secrets 누락 시 graceful skip — issue 미생성. secrets 등록 후 manual `workflow_dispatch` 1회 검증 권장.
  - **Telegram secrets 미설정**: `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` 없으면 GH issue 만 발송 (정책상 옵션).
  - 같은 day 중복 fail: 첫 fail 은 새 issue, 이후 동일 day 는 코멘트만 추가 (title 매칭).
- **Note**: hard floor 80 / drop delta 10 / min_samples 5 는 Phase 3 (총 이슈 32→9, 평균 score ~90 대 가정) 기준. 실 운영 1주 후 통계 보고 임계 재조정.

---

## §3. 차터 / 투어 예약

### Pattern 3.1 — booking 누락 신고

- **증상**: "결제는 됐는데 '내 예약' 페이지에서 안 보여요"
- **대응 (템플릿)**:
  1. Firestore `bookings/{userId}/items` 에서 `paymentId` / `transactionId` 로 검색
  2. **결제는 캡처됐으나 booking 미생성** 인 경우 — booking-processor 의 webhook 누락 가능성 (PR #213-#222 batch 3 fix 적용 후 사례 모니터링)
  3. admin 패널 → "수동 booking 생성" → 결제 정보 + 사용자 ID 입력
  4. 텔레그램 알림 1-click 복구 (5/3 batch 2 PR #212 클레임 옵션B 활용)
- **Edge case**: `route` 오타 (PR #234 fix) 로 빈 페이지 → 디테일 모달 정상 표시 확인
- **Note**: <!-- TODO: booking 누락 자동 감지 cron — Stripe/PayPal/Braintree 트랜잭션 vs Firestore booking diff 알림 -->

### Pattern 3.2 — 차터 zone 매핑 오류

- **증상**: "공항 → 호텔 차터 가격이 이상합니다 / zone 인식 안 됨"
- **대응 (템플릿)**:
  1. wizard 입력 주소 → `zones/{zoneId}` 매핑 결과 확인 (Round 2-15 권역 fallback 적용 확인)
  2. 31 zone anchorAddress 사전 (5/3 batch 2 PR #212 fix) 에 해당 도시 포함 여부
  3. 매핑 실패 시 fallback zone 가격 적용 + 운영자에게 알림
- **Edge case**: 제주 정책 — 제주는 **단일 권역** 으로 고정, 지역별 가격 차등 없음
- **Note**: <!-- TODO: zone 매핑 미스 사례 누적 시 master zone 사전 보강 -->

---

## §4. 텔레그램 봇 운영

### Pattern 4.1 — `/dispatch` 후 기사 응답 없음

- **증상**: admin 이 `/dispatch` 명령으로 배차 알림 보냈는데 기사 봇에서 응답 X
- **대응**:
  1. driver bot (5/3 분리됨) 토큰 / 채팅 ID 활성 여부 확인
  2. 기사 텔레그램 봇 차단 / 삭제 여부 — 기사에게 확인 요청
  3. 5/4 batch 2 driver bot inline keyboard 적용 후 응답 UX 개선 — 미응답 사례 비교
  4. timeout 시 admin 채널로 자동 escalation (5분 무응답 임계값 — 검증 필요)
- **Edge case**: 기사 봇 토큰 회전 후 일시 미연결 — admin 봇에서 재 invite 링크 발송
- **Note**: <!-- TODO: 기사 응답 SLA 통계 누적 후 임계값 튜닝 -->

### Pattern 4.2 — `이슈추가 plan:<planId>` 명령 미인식

- **증상**: 한글 명령어 (`이슈추가`, `배차`, `완료`, `설명`) 봇이 응답 안 함
- **대응**:
  1. inquiry bot (5/3 분리) 의 한글 명령 라우터 활성 여부 확인 (`/설명` 3봇 모두 적용됨)
  2. 명령 형식 정확성 — `plan:<planId>` 의 `<planId>` 가 실제 Firestore 문서 ID 인지
  3. AI 채팅 3-way 라우팅 (FAQ/Charter/Special) 의 fallback 발동 여부 — `[ESCALATE]` 자동 admin 전달 확인
- **Edge case**: 봇 권한 issue — admin 그룹 외부에서 명령 시도 → 권한 거절 메시지 반환 정상 동작
- **Note**: <!-- TODO: 한글 명령 alias (예: "배차요청" → "배차") 동의어 사전 누적 -->

---

## §5. 사용자 sign-in / 쿠폰 문의

### Pattern 5.1 — 회원가입 후 환영 쿠폰 미발행

- **증상**: "가입했는데 약속한 환영 쿠폰이 안 들어왔어요"
- **대응**:
  1. PR #253 멱등성 + 이전 가입자 보정 fix 적용 후 사례 — 신규 가입자 정상 발행 확인
  2. 이전 가입자 (PR #253 이전) 인 경우 — admin 패널의 "쿠폰 보정 발행" 사용
  3. Firestore `users/{userId}.welcomeCouponClaimed` 플래그 확인 — true 면 이미 발행됨 (중복 방지)
  4. 사용자 본인 인증 후 쿠폰 코드 직접 안내 (멱등성 보장으로 중복 발행 위험 X)
- **Edge case**: SSO (Google/Apple) 가입자 vs 이메일 가입자 — 발행 로직 동일 확인
- **Note**: <!-- TODO: 쿠폰 보정 발행 admin UI 의 자동 검색 / 일괄 처리 추가 검토 -->

---

## §6. Firestore 데이터 보정

### Pattern 6.1 — booking 필드 누락 / 오타

- **증상**: admin 검색 / 정산에서 booking 일부 필드 (예: `customerEmail`, `tourDate`) 가 비어 있음
- **대응 (템플릿)**:
  1. `bookings/{userId}/items/{bookingId}` 직접 확인
  2. 결제 시점의 webhook payload (Sentry / 서버 로그) 와 비교 — 어느 단계에서 누락됐는지
  3. admin 패널 → "필드 보정" 으로 수동 입력 (감사 로그 자동 남음)
  4. 시스템적 누락이면 booking-processor 코드 수정 PR 발의
- **Edge case**: tourDate ReferenceError fix (5/4 PR) 후 사례 — 구버전 booking 보정 필요한 경우 별도 backfill
- **Note**: <!-- TODO: 누락 빈도 높은 필드 통계 → 자동 검증 cron 신설 검토 -->

### Pattern 6.2 — `pending_free_claims` legacy 정리

- **증상**: 구버전 클레임 시스템의 `pending_free_claims` 컬렉션에 stale 데이터 잔존
- **대응**:
  1. PR #255 deprecate — 신규 클레임은 옵션 B (텔레그램 1-click) 로 이행됨
  2. 기존 pending 항목은 manual review 후 처리 / 만료
  3. 컬렉션 자체는 30일 유예 후 archive (audit 보관)
- **Edge case**: 운영 중 미처리 pending 발견 시 → 사용자 식별 후 옵션 B 로 재발행
- **Note**: <!-- TODO: archive 시점 + 백업 저장소 (GCS bucket) 확정 -->

---

## §7. 외부 API 장애 대응

### Pattern 7.1 — Naver Maps NCP 401

- **증상**: 지도 호출 시 401 Unauthorized — 키 정상인데 인증 실패
- **대응**:
  1. **보이지 않는 개행문자 / 공백** 의심 — env var 끝에 `\n` 또는 trailing whitespace
  2. 코드에서 `.trim()` 적용되어 있는지 확인 (이전 다수 발생 사례)
  3. **Vercel UI 에서 직접 입력** (CLI / API 로 set 시 줄바꿈 섞일 수 있음)
  4. 도메인 등록 (referrer 제한) — Vercel preview 도메인 와일드카드 추가 여부
- **Edge case**: NCP 콘솔의 일일 호출 한도 초과 — 401 이 아닌 429 로 와야 정상이지만 일부 401 반환 사례 있음
- **Note**: 본 패턴은 **여러 번 반복 발생** — env var 입력 시 항상 Vercel UI 사용 권장

### Pattern 7.2 — Gemini quota 초과

- **증상**: AI 플래너 생성 실패 — Gemini API quota / rate limit
- **대응**:
  1. Google AI Studio 콘솔에서 quota 사용량 확인
  2. 모델 fallback (gemini-1.5-pro → gemini-1.5-flash) 자동 동작 여부 확인
  3. 사용자에게 일시 안내 + 5분 후 재시도 권유 (생성 큐 자동 retry 적용 시)
  4. quota 초과 빈번 시 — 결제 계정 업그레이드 또는 모델 분산 (Claude/OpenAI fallback 검토)
- **Edge case**: 특정 시간대 (피크) 집중 — 큐 분산 / 백오프 알고리즘 검토
- **Note**: <!-- TODO: quota 임계값 도달 알림 (Sentry / 텔레그램) 자동화 -->

### Pattern 7.3 — ODsay timeout

- **증상**: 대중교통 경로 조회 timeout — 응답 지연 / 끊김
- **대응**:
  1. PR #256 적용됨 — timeout **12초** + retry **1회**
  2. 12초 + retry 후도 실패 시 fallback (단순 거리 기반 추정) 동작 확인
  3. ODsay 서버 상태 페이지 확인
- **Edge case**: 새로운 도시 / 외곽 지역 — ODsay 미지원 → 자동차 경로로 대체
- **Note**: <!-- TODO: timeout 빈도 모니터링 — 12초도 부족하면 15초로 상향 검토 -->

---

## §8. 배포 / 빌드 비용 모니터링

### Pattern 8.1 — Vercel 빌드 비용 갑자기 ↑

- **증상**: Vercel 청구액 평소 대비 급증 (예: $150+ 누적)
- **대응** (CLAUDE.md H 절 참조):
  1. **preview 절제** — 작업 중 unnecessary preview deploy 방지
  2. **PR 묶음 머지** — 개별 PR 마다 prod build 트리거되므로 batch 머지 권장
  3. Vercel 대시보드 액션 (5/4 batch 2 권장):
     - Turbo → Elastic
     - Native Lint OFF / Typecheck ON
     - `repository_dispatch` OFF
  4. 빌드 시간 상위 10% PR 검토 — 종속성 캐싱 / unused dep 제거
- **Edge case**: Sentry 활성화 (5/4 batch 2) 후 빌드 시간 +10초 이내 정상 — 그 이상이면 source map upload 실패 의심
- **Note**: 현재 **Vercel Pro** 사용 중 — Hobby 제약 무관. **Netlify 절대 금지** (CocoTrip 웹은 Vercel 전용, 2026-04-27 Netlify 사이트 삭제 완료)

---

## 미정 / 채워나갈 항목

문서 전반의 `<!-- TODO: ... -->` 마커 일람 — 운영자가 시간 흐름에 따라 채울 부분:

- §1.1 자동 환불 거절 템플릿 메시지 (한/영/일/중)
- §1.2 부분 환불 정책 확정
- §1.3 쿠폰 적용 실패 사유 frontend 노출 4-lang 표준화
- §2.1 식당 status 자동 검증 cron
- §2.2 pace 별 권장 관광지 수 가이드라인
- §3.1 booking 누락 자동 감지 cron
- §3.2 zone 매핑 미스 사례 누적 후 master zone 사전 보강
- §4.1 기사 응답 SLA 통계 + 임계값 튜닝
- §4.2 한글 명령 alias 동의어 사전
- §5.1 쿠폰 보정 발행 admin UI 개선
- §6.1 누락 필드 통계 + 자동 검증 cron
- §6.2 archive 시점 + 백업 저장소 확정
- §7.2 Gemini quota 알림 자동화
- §7.3 ODsay timeout 임계값 모니터링

---

## 작성 / 관리

- **작성 시점**: 2026-05-05 (Tier 4-H scaffold 초기 생성)
- **관리자**: 운영팀 (PR 리뷰 통한 갱신)
- **갱신 주기**: 사례 발생 시 즉시. 분기 1회 정기 review (중복 Pattern 통합, deprecated 항목 archive)
- **언어**: 한국어 (1차 작성 언어). 향후 신규 직원 다국어 온보딩 시 영어 번역본 별도 생성 가능

> 본 문서를 학습 데이터로 활용하는 AI 응대 시스템 개발자: Pattern 의 **증상** → **대응** 형식이 의도된 학습 input/output 구조입니다. **Note** 와 `<!-- TODO -->` 는 학습 제외 권장.
