# 기능 플래그 점검표 (2026-07-25)

> 목적: **"코드는 다 만들었는데 손님에겐 안 보이는 기능"** 을 한 장에 모아 켜기/지우기를 결정한다.
> 감사 근거: 2026-07-25 미사용 자산 감사(4차원 48건) 중 플래그 12건.

---

## 🔴 먼저 읽기 — 레포만 봐서는 ON/OFF 를 알 수 없다

`.env` 파일을 grep 해서 "이 플래그는 꺼져 있다" 고 판단하면 **틀린다.**
Vercel Production 환경변수는 **대시보드에만 있고 레포에는 없다.**

실제로 2026-07-25 감사에서 자동 판정이 2건 틀렸다(둘 다 "OFF, 확신 높음" 이라고 했으나 prod 실측은 ON):

| 플래그 | 자동 판정 | prod 실측 | 실측 방법 |
|---|---|---|---|
| `VITE_FEATURE_MOBILE_V2` | OFF | ✅ **ON** | 모바일(375px)로 cocotripkr.com 접속 → V2 홈("Hello, Traveler" + 날씨칩 + Smart Picks) 표시됨 |
| `VITE_FEATURE_REFINED_UI` | OFF | ✅ **ON** | prod DOM 에 `<html class="dark refined">` (main.tsx:33 이 플래그 ON 일 때만 부착) |

**따라서 아래 표의 "상태" 는 전부 `미확인` 에서 출발한다. Vercel 대시보드에서 눈으로 확인한 뒤 채울 것.**

확인 위치: 🌐 Vercel → 프로젝트 → Settings → Environment Variables → **Production** 스코프

---

## ⚠️ 켤 때의 3대 함정

1. **프론트·백엔드 쌍** — `VITE_FEATURE_X`(프론트) 와 `FEATURE_X`(백엔드) 가 쌍인 기능은 **반드시 같은 값**으로.
   한쪽만 켜면 → 프론트는 허용하는데 백엔드가 거절(401) 하거나, **표시가 ≠ 청구가**(돈버그)가 난다.
2. **Redeploy 로는 안 반영됨** — `VITE_*` 는 빌드타임 변수라 env 만 바꾸고 Redeploy 하면 **옛 값**으로 빌드된다.
   env 등록 후 **새 커밋 push** 필요. (#754 전례)
3. **켜기 전 실물 확인** — 대부분 `?쿼리` 로 미리 볼 수 있다 (아래 표 "미리보기" 열).

---

## 점검표

상태 열은 Vercel 확인 후 직접 채운다: `ON` / `OFF` / `프론트만` / `백엔드만`

### 💰 돈 직결 (우선순위 최상 — 쌍 불일치 시 사고)

| # | 플래그 | 무엇이 켜지나 | 쌍 | 미리보기 | 상태 |
|---|---|---|---|---|---|
| 1 | `VITE_FEATURE_DISCOUNT_V2` + `FEATURE_DISCOUNT_V2` | 결제창 쿠폰 피커, v2 할인율 | ✅ 쌍 | — | ⬜ |
| 2 | `VITE_FEATURE_TRANSFER_CHECKOUT` + `FEATURE_*` | 도시간 이동(편도/왕복) 즉시결제 | ✅ 쌍 | — | ⬜ |
| 3 | `VITE_FEATURE_MULTIDAY_CHECKOUT` + `FEATURE_*` | 1박+ 멀티데이 차터 즉시결제 | ✅ 쌍 | — | ⬜ |
| 4 | `VITE_FEATURE_TOUR_HOURLY` + `FEATURE_*` | 시간제 투어 즉시결제 | ✅ 쌍 | — | ⬜ |
| 5 | `VITE_FEATURE_CHARTER_WAYPOINTS` + `FEATURE_*` | 차터 경유지 입력 + 실도로 거리 기반 가격 | ✅ 쌍 | — | ⬜ |
| 6 | `VITE_FEATURE_CART` + `FEATURE_CART` | 장바구니 전체(1,385줄) — 여러 상품 한 번에 결제 | ✅ 쌍 | — | ⬜ |
| 7 | `VITE_FEATURE_GUEST_ANON_AUTH` + `FEATURE_*` | 비회원 즉시결제(로그인 벽 제거) | ✅ 쌍 | — | ⬜ |

**2~5 미노출 시 손해**: 차터 3종은 견적만 보여주고 결제가 안 돼 손님이 수동 문의로 이탈.
경유지(5)는 꺼져 있으면 서울→강릉→부산 같은 장거리도 **직선 zone 가격**으로 청구돼 회사가 손해.

**6 켜기 전 선결**: `PAYMENT_P1_MONEY_BUGS_INVESTIGATION_HANDOFF.md` 의 F6~F9 돈버그가 "FEATURE_CART OFF 가정" 위에 있음 → 먼저 닫을 것.

### 📣 매출 업셀 (프론트 단독 — 리스크 낮음)

| # | 플래그 | 무엇이 켜지나 | 쌍 | 미리보기 | 상태 |
|---|---|---|---|---|---|
| 8 | `VITE_FEATURE_OWN_TOUR_UPSELL` | AI 플랜 결과 → 자사 투어 추천 섹션 | 프론트만 | — | ⬜ |
| 9 | `VITE_FEATURE_TRANSIT_VS_CHARTER` | "대중교통 X시간/Y원 vs 차터" 비교 카드 (4개국어 번역 완료) | 프론트만 | — | ⬜ |

> 상용화 실행안의 전제가 **"$9.90 플랜 = 고마진 업셀로 가는 미끼"** 인데, 그 업셀 장치(8)가 꺼져 있으면 깔때기가 끊긴다. 우선순위 높음.

### 🎨 UI / 기타

| # | 플래그 | 무엇이 켜지나 | 쌍 | 미리보기 | 상태 |
|---|---|---|---|---|---|
| 10 | `VITE_FEATURE_MOBILE_V2` | 신형 라이트 모바일 홈 | 프론트만 | `?v2` | ✅ **ON (실측)** |
| 11 | `VITE_FEATURE_REFINED_UI` | 정제 퍼플·핑크 스킨 (8개 화면) | 프론트만 | `?refined` | ✅ **ON (실측)** |
| 12 | `VITE_FEATURE_ACTIVITY_GUIDE` + `FEATURE_ACTIVITY_BLOCKS` + `FEATURE_PINNED_ACTIVITY_DAY` | 활동 블록·가이드 탭·PDF 섹션 | ✅ 3개 | — | ⬜ |

> 12번 주의: 지금이 **최악의 중간상태**. 기능은 미노출인데 `KNOWN-RISKS.md:214` 의 러닝 코스 leak(안 시킨 "5km 러닝" 이 일반 관광 플랜에 끼어듦) 부작용은 그대로다. **leak 은 플래그와 별개로 먼저 막을 것.**

---

## 🔑 env 키 정리 (플래그 아님)

| 키 | 상태 | 조치 |
|---|---|---|
| `AIRPORT_API_KEY` | 배선 완료·키 미설정 | 🔴 지금 차터 예약 중 "도착시간 자동조회" 누르면 **500 에러**. data.go.kr 무료 발급 → 🌐Vercel Production 등록. 안 쓸 거면 조회 버튼부터 숨길 것 |
| `VISITKOREA_SERVICE_KEY` | 배선 완료·키 미설정 | 관광지 메타 수집 크론이 매번 아무것도 안 하고 성공한 척 종료. 발급하거나 크론 내리기 |
| `PAYPAL_MODE` | 유령 — 코드가 안 읽음 | 지우기. 결제 환경 스위치는 `PAYPAL_ENV` 하나뿐. 이 키 보고 샌드박스/라이브를 바꾼다고 오해하면 사고 |
| `DATA_GO_KR_SERVICE_KEY` | 유령 — 코드가 안 읽음 | 지우기 |

---

## 확인 절차 (권장 순서)

1. Vercel Production env 열고 위 표 12행 **상태 열을 눈으로 채운다** (5분)
2. **쌍 불일치부터** 고친다 (돈 문제 — 1~7번 중 프론트만/백엔드만 인 것)
3. 리스크 낮은 업셀(8·9) 부터 켠다 → 매출 효과 측정
4. 차터 결제(2~5)는 실 PayPal e2e 1건 후 켠다
5. env 등록했으면 **새 커밋 push** (Redeploy ❌)
