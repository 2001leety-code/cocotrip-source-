# 마케팅 퍼널·유입 귀속 데이터 소스 (P1, 2026-07-11)

## 데이터 소스 역할 분담 (운영자 확정)

| 저장소 | 역할 | 조회 주체 |
|---|---|---|
| **GA4** | 광고·유입 귀속 (Google Ads 전환 import, `purchase` 등 ecommerce) | Google Ads / GA4 대시보드 |
| **PostHog (수동 track)** | 제품 퍼널 — `admin-posthog-funnel.js` 등 **운영자 화면(PR-C)은 PostHog 를 조회한다** | `api/admin-posthog-funnel.js`, PR-C 퍼널 화면 |
| **Firestore** | 유입 스냅샷 원본 (`users/{uid}.attribution`, `bookings/{orderID}.attribution`) — 무료→유료 UID 연결·전환율 집계(PR-C) | PR-C 서버 집계 |

- PostHog 는 `autocapture:false` — **수동 `track()` 호출만 잡힌다.** 새 퍼널 이벤트는 반드시
  `src/lib/analytics.ts` 의 `trackFunnel()` 헬퍼(GA4+PostHog 이중 전송)를 통해 추가하고
  `src/lib/posthog.ts` 의 `PostHogEventName` union 에 등록한다 (tsc 가 누락 차단).
- 이중 전송 이벤트 목록(2026-07-11): `promo_view/click/dismiss`, `welcome_coupon_issued`,
  `welcome_coupon_modal_view`, `planner_complete`, `free_plan_redeemed`,
  `charter_quote_start/complete`.
- 추적은 전 구간 **fail-open**: 어떤 실패도 가입·플랜·예약·결제를 막지 않는다.

## first/last UTM 정책 (명시적 분리)

| 항목 | first (최초 유입) | last (최근 유입) |
|---|---|---|
| 클라 저장 | `localStorage.cocotrip_utm_first` — **최초 1회 기록 후 절대 갱신 안 함** | `localStorage.cocotrip_utm_last` — UTM 있는 유입마다 덮어씀 |
| 서버 저장 (가입) | `users/{uid}.attribution` — **Firestore 트랜잭션으로 최초 1회만** (동시 요청에도 덮어쓰기 없음) | 가입 문서에는 가입 시점의 last 가 함께 1회 저장됨 (이후 갱신 없음) |
| 서버 저장 (예약·결제) | `bookings/{orderID}.attribution` — 결제 시점의 first/last 스냅샷 (문서별 불변) | 동일 |

## 수집 최소화·보존 기간

- 수집 필드: **utm 5종(source/medium/campaign/term/content) + ISO 시각(ts)** 뿐.
  이메일·전화·주소·이름 등 PII 는 수집하지 않는다.
- 값 방어(클라 `analytics.ts` / 서버 `api/_shared/attribution.js` 동일 규칙):
  '@'(이메일류)·URL(`http`/`://`/`www.`)·전화형(국제/한국/구분자)·개행·제어문자 차단, 120자 컷,
  허용 외 키 폐기, ts 는 ISO 형식만. **"완전 차단"이 아니라 최소화 휴리스틱** —
  정확한 차단 범위는 `tests/unit/utm-attribution-p1.test.ts`·`attribution-sanitize.test.ts` 가 명세.
- 보존 기간:
  - 클라 localStorage: 사용자 기기에만 존재, 브라우저 데이터 삭제 시 소멸 (서버 미전송 상태).
  - Firestore 스냅샷: 소속 문서(users/bookings)의 수명을 따른다 — 계정/예약 삭제 시 함께 삭제.
    별도 장기 보관·재판매 없음. GA4/PostHog 보존은 각 플랫폼 기본 설정(GA4 14개월) 사용.

## 플랜 완료 이벤트 시점 (2026-07-11 운영자 보완)

`planner_complete`/`free_plan_redeemed` 는 **Firestore `plan.status` 가 'ready' 로 확정된 시점**에
정확히 1회 발화한다 (`usePlanCompletionTracking`). API 의 streaming 수락 시점에는 발화하지 않으며
(`markPlannerPendingComplete` marker 만 기록), 백그라운드 생성 실패(`status:'error'`) 시 완료
이벤트 없이 marker 폐기. 새로고침·onSnapshot 반복에도 marker 소진 방식이라 중복 없음.
