# 기능 플래그 점검표 (2026-07-25, Vercel 실조회 반영)

> 목적: **"코드는 다 만들었는데 손님에겐 안 보이는 기능"** 을 한 장에 모아 켜기/지우기를 결정한다.
> 근거: 2026-07-25 미사용 자산 감사(4차원 48건) + **Vercel API 실조회** + prod 실물 프로브.

## 2026-08-31 추가 — 고객문의 답변 워커

| 키 | 기본값 | 자동으로 하는 일 | 자동으로 하지 않는 일 | 넣을 위치 |
|---|---|---|---|---|
| `INQUIRY_RESPONSE_WORKER_ENABLED` | OFF | 새 견적 문의의 정책 초안 생성, 승인된 최종답변의 확실한 발송 전 실패만 제한 재시도 | 자동 접수 확인, 초안 검토·승인, 전화/WhatsApp 발송, 결과 불명 메일 재발송 | **Vercel → Production 환경변수** |
| `INQUIRY_RESPONSE_BATCH_SIZE` | `3` | 5분마다 각 문의 워커가 처리할 수 있는 수(1~5) 제한 | 제한 해제 | **Vercel → Production 환경변수** |
| `INQUIRY_RESPONSE_AUTO_ACK_ENABLED` | OFF | 공유 답변 워커가 OFF여도 로그인에서 확인된 이메일과 문의 이메일이 같고 아래 안전조건이 모두 맞는 새 문의만 접수 확인 | 비로그인·미확인 이메일, 초안 생성, 최종답변 재시도, 최종 견적·예약 확정·과거 문의 발송 | **Vercel → Production 환경변수** |
| `INQUIRY_RESPONSE_AUTO_ACK_NOT_BEFORE` | 없음(OFF) | 자동 접수 확인에만 적용하며 정확한 `YYYY-MM-DDTHH:mm:ss.sssZ` 이후 문의만 허용 | 초안·최종답변 워커 시작시각 제한, 날짜만 있거나 로컬시각인 값 추정 | **Vercel → Production 환경변수** |
| `INQUIRY_RESPONSE_AUTO_ACK_MAX_AGE_MINUTES` | 없음(OFF) | 접수 뒤 자동발송 허용 시간창(5~1440분, 권장 `30`) | 오래된 문의 뒤늦은 발송 | **Vercel → Production 환경변수** |
| `INQUIRY_RESPONSE_AUTO_ACK_DAILY_CAP` | 없음(OFF) | 하루 전체 상한(1~100, 권장 `20`)과 같은 이메일 하루 1회 | 상한 초과 자동발송 | **Vercel → Production 환경변수** |
| `inquiry_auto_ack_enabled` | OFF | 위 환경변수가 모두 정확할 때 마지막 발송 허가 | 환경변수 오류 우회 | **어드민 → 운영 토글** |

켜기 전 어드민 `/admin/claims`의 문의 탭에서 초안 만들기·수정·발송 확인 흐름을 먼저 점검한다.
메일 서버에 넘긴 뒤 결과가 불명확하면 자동 재발송하지 않고 운영자 확인 상태로 멈춘다.
자동 접수 확인만 켤 때는 `INQUIRY_RESPONSE_WORKER_ENABLED=false`를 유지한다. 순서는 `Vercel Production의 AUTO_ACK 4개 값과 공용 BATCH_SIZE 확인 → 배포 → GitHub Actions의 Deploy Firestore Indexes 성공(--wait로 Ready 확인) → 어드민 /admin/claims 문의 탭의 '문의 자동 접수확인' 운영 토글 ON`이다.
초안 생성·승인된 최종답변 재시도까지 별도로 운영하기로 결정한 경우에만 공유 답변 워커를 ON으로 바꾼다. `NOT_BEFORE`는 자동 접수 확인에만 적용되며 공유 답변 워커를 예약 활성화하지 않는다.
끄기는 같은 어드민 운영 토글을 먼저 OFF로 바꾸면 다음 5분 워커부터 자동 접수확인의 신규 발송과 자동 재시도가 함께 멈춘다.

---

## 🔴 레포 `.env` 로 판정하면 틀린다 — 실측으로 3건 반증됨

Vercel 환경변수는 **대시보드에만** 있고 레포엔 없다. `.env.test.local` 이 production pull
스냅샷이어도 전부가 아니다. 자동 감사가 이 방식으로 판정해 최소 3건을 틀렸다:

| 대상 | 자동 판정 | 실측 | 실측 방법 |
|---|---|---|---|
| `VITE_FEATURE_MOBILE_V2` | OFF (확신 높음) | ✅ **ON** | 모바일 375px prod → V2 홈("Hello, Traveler"·날씨칩·Smart Picks) 렌더 |
| `VITE_FEATURE_REFINED_UI` | OFF (확신 높음) | ✅ **ON** | prod DOM `<html class="dark refined">` (main.tsx:33 산물) |
| `AIRPORT_API_KEY` | **미설정 → 500 에러** | ✅ **등록됨·정상** | `GET /api/flight-status?flightId=KE001` → **200** `{ok:true,found:false}`. 500 안 남 |

---

## 조회 방법 (권장)

레포에 이미 있는 `scripts/check-vercel-envs.mjs` 패턴으로 Vercel API 를 부른다
(필요 env: `VERCEL_TOKEN` / `VERCEL_PROJECT_ID` / `VERCEL_TEAM_ID` — `.env.admin.local`).

```
GET https://api.vercel.com/v9/projects/{PROJECT}/env?teamId={TEAM}
```

⚠️ **값(value)은 암호화돼 돌아온다** — `decrypt=true` 를 붙여도 마찬가지.
즉 API 로 알 수 있는 건 **키 존재 여부 + 타겟(production/preview/development)** 까지고,
`"true"` 인지 `"false"` 인지는 **모른다.**

→ 최종 ON/OFF 판정은 **① Vercel 대시보드 눈으로 보기** 또는 **② prod 실물 프로브** 뿐이다.

---

## Vercel 등록 현황 (2026-07-25 실조회, 총 env 114개)

### ✅ production 타겟에 등록됨 (= "미설정" 아님)

프론트·백엔드 **쌍이 모두 등록**돼 있어 **비대칭(표시가≠청구가) 위험은 없음**:

| 기능 | 프론트 `VITE_FEATURE_*` | 백엔드 `FEATURE_*` | 타겟 |
|---|:--:|:--:|---|
| 쿠폰·v2 할인 `DISCOUNT_V2` | ✅ | ✅ | prod+preview+dev |
| 비회원 결제 `GUEST_ANON_AUTH` | ✅ | ✅ | prod+preview+dev |
| 도시간 이동 `TRANSFER_CHECKOUT` | ✅ | ✅ | prod+preview |
| 멀티데이 `MULTIDAY_CHECKOUT` | ✅ | ✅ | prod+preview |
| 시간제 투어 `TOUR_HOURLY` | ✅ | ✅ | prod+preview |
| 차터 경유지 `CHARTER_WAYPOINTS` | ✅ | ✅ | prod+preview |
| 활동 블록·가이드 | `ACTIVITY_GUIDE`·`PINNED_ACTIVITY_DAY` ✅ | `ACTIVITY_BLOCKS`·`PINNED_ACTIVITY_DAY` ✅ | prod+preview |

프론트 단독 플래그(백엔드 쌍 불필요) — 전부 production 등록됨:
`OWN_TOUR_UPSELL` · `TRANSIT_VS_CHARTER` · `MOBILE_V2`(ON 확인) · `REFINED_UI`(ON 확인) ·
`REAL_TOUR_RATINGS` · `RESUME_DIRTY_EXIT` · `TOUR_BOOKING_MINIMAL` · `CHARTER_CTA_REALROUTE`

### ⛔ production 에 없음 = 확실히 OFF

| 플래그 | 등록 상태 | 뜻 |
|---|---|---|
| `FEATURE_CART` / `VITE_FEATURE_CART` | **preview 에만** | 장바구니(1,385줄)는 **prod 에서 확실히 미노출**. 둘 다 preview 뿐이라 비대칭도 아님 |
| `VITE_FEATURE_REVIEW_EDIT` | preview 에만 | 후기 수정 prod 미노출 |
| `FEATURE_CHARTER_HERO_PRICE` | prod 등록됐으나 **값이 빈 문자열** | `=== 'true'` 게이트라 사실상 OFF |

---

## 🔑 env 키 (플래그 아님)

| 키 | 실조회 결과 | 조치 |
|---|---|---|
| `AIRPORT_API_KEY` | ✅ dev+preview+prod 등록, **엔드포인트 200 정상** | 조치 불필요 (감사의 "500" 은 오진) |
| `TMAP_APP_KEY` · `TRANSIT_PROVIDER` | ✅ preview+prod | TMAP 전환 준비됨 — `TRANSIT_PROVIDER` 값 확인만 |
| `REVIEW_REQUEST_ENABLED` · `CONTENT_WORKER_ENABLED` · `OPS_WATCHDOG_ENABLED` | ✅ preview+prod 등록 | 값이 `true` 인지는 대시보드 확인 필요 |
| `PAYPAL_MODE` | ⚠️ dev+preview+prod 등록 — **코드가 안 읽는 유령 키** | 지우기. 결제 환경 스위치는 `PAYPAL_ENV` 하나뿐. 이 키 보고 샌드박스/라이브 바꾼다고 오해하면 사고 |
| `VISITKOREA_SERVICE_KEY` | ❌ 미등록 | 관광지 수집 크론이 매번 빈손 성공. 발급하거나 크론 내리기 |
| `DATA_GO_KR_SERVICE_KEY` | ❌ 미등록 | 코드가 안 읽는 유령 키 — `.env.example` 에서도 제거 |
| `POSTHOG_API_KEY` | ❌ 미등록 | 어드민 전환 퍼널·방문자 카드가 비어 있는 원인 |

---

## ⚠️ 켤 때의 3대 함정

1. **프론트·백엔드 쌍** — `VITE_FEATURE_X`(프론트) 와 `FEATURE_X`(백엔드) 는 **같은 값**이어야 한다.
   한쪽만 `true` 면 프론트는 허용하는데 백엔드가 거절(401)하거나 **표시가 ≠ 청구가**(돈버그).
   *현재 등록 기준으로는 모든 쌍이 대칭이다 — 값까지 같은지는 대시보드에서 확인할 것.*
2. **Redeploy 로는 안 반영됨** — `VITE_*` 는 빌드타임 변수. env 변경 후 **새 커밋 push** 필요 (#754 전례).
3. **켜기 전 실물 확인** — `?v2`, `?refined` 처럼 쿼리로 미리 볼 수 있는 것부터.

---

## 남은 확인 (운영자 5분 작업)

Vercel → Settings → Environment Variables → **Production** 에서 **값**만 눈으로 확인:

- [ ] `DISCOUNT_V2` 프론트·백 **값 일치**하나 (돈 문제 — 최우선)
- [ ] `TRANSFER` / `MULTIDAY` / `TOUR_HOURLY` 3종 프론트·백 값 일치 + true 인가
- [ ] `CHARTER_WAYPOINTS` 프론트·백 값 일치 (장거리 경유 청구 정확도)
- [ ] `GUEST_ANON_AUTH` 값 (비회원 결제 = 전환율 직결)
- [x] `OWN_TOUR_UPSELL` — **값 확인 불필요, 코드 리더 0 (2026-07-26 실측)**. `getMatchedOwnTours`
      (`src/data/tours.ts`)를 부르는 곳이 테스트뿐이고 업셀 UI 컴포넌트 자체가 없다. 켜든 끄든
      화면이 안 바뀐다 → **Vercel preview+production 에서 삭제 권장**(운영자 결정 대기).
- [ ] `TRANSIT_VS_CHARTER` 값 — 🔴 이건 **살아있다**(`src/pages/PlanDetailPage/lib/transitVsCharter.ts`
      가 `=== 'true'` 로 읽음). 위 항목과 묶어서 지우면 완성된 비교 카드가 사라진다.
- [ ] `PAYPAL_MODE` 삭제 — 2026-07-26 재확인: 코드 참조 여전히 0, dev+preview+production 등록됨.
