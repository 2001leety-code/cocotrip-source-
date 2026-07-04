# MOOD 일정 충돌 감지 — TODO (구현 보류, 설계 기록)

> 작성 2026-07-02. **운영자 최종 결정(2026-07-02): 충돌 "경고" 구현 금지.**
> 현재 스키마에 배정 주체(managerId/vehicleId)가 없어 "충돌"을 정의할 수 없기 때문.
> 허용된 것은 캘린더의 **"동일 시간대 예약 수" 수준의 중립 표시**까지만
> (빨간 경고/충돌 뱃지/경고 아이콘 금지 — 회색/보라 중립 톤).
> 이 문서는 필드가 생겼을 때 바로 구현할 수 있도록 설계만 남긴다.

## 1. 현재 예약 스키마 (2026-07-02 기준)

생성 지점: `api/mood-book.js` `tx.set(bookingRef, {...})` (L208~222)

```
clientId, date("YYYY-MM-DD"), startTime("HH:MM"), durationHours, serviceType,
airportDirection, ratePerHour, amountKRW, breakdown{origin,destination,waypoints,km,...},
balanceAfterKRW, status('confirmed'|'completed'), createdByEmail, createdAt
```

프론트 타입: `src/pages/MoodPortal.tsx` `interface MoodBooking` (L62~79 부근)

## 2. 스키마에 **없는** 필드 (충돌 감지에 필요)

| 필드 | 타입(안) | 용도 |
|---|---|---|
| `managerId` / `managerName` | string | 어떤 매니저가 배정됐는지 — "같은 매니저 이중 예약" 판정의 키 |
| `vehicleId` / `vehicleName` | string | 어떤 차량이 배정됐는지 — "같은 차량 이중 예약" 판정의 키 |
| `startAt` / `endAt` | epoch ms (또는 ISO) | 자정 넘김·타임존 안전한 절대 시각. 현재는 date+startTime+durationHours 로 유도만 가능 |
| `location` | { lat, lng, address } | 이동시간 버퍼 계산(직전 운행 종료지 → 다음 출발지) |
| `routeStops` | Array<{ at, lat, lng }> | 경유지 포함 실제 동선 — 버퍼 정밀화 (breakdown.waypoints 는 주소 문자열뿐) |
| `status` 세분화 | 'requested'\|'confirmed'\|'in_progress'\|'completed'\|'cancelled' | 취소/완료 건을 충돌 계산에서 제외할 근거. 현재는 confirmed/completed 뿐(취소 상태 없음) |

## 3. 충돌 정의 후보 (필드 도입 후)

1. **같은 `managerId` 시간겹침 2건+** — [startAt, endAt) 반열림 구간이 교차하면 충돌.
2. **같은 `vehicleId` 시간겹침 2건+** — 위와 동일 판정, 키만 차량.
3. **이동시간 포함 버퍼 부족** — 같은 매니저/차량의 연속 예약에서
   `다음.startAt - 이전.endAt < 이동시간(이전 종료지 → 다음 출발지) + 여유버퍼(예: 20분)`
   이면 "겹치진 않지만 물리적으로 불가능" 충돌. 이동시간은 `/api/mood-route`
   (네이버 Directions, `api/_shared/mood-route.js`) 재사용 가능.
- 공통 제외: `status === 'cancelled'`(도입 시), `startTime` 없는 예약(현재 중립 표시와 동일 규칙).

## 4. 구현 보류 사유

- **운영자 결정 2026-07-02**: managerId/vehicleId 필드 자체가 없어 충돌이 정의 불가.
  필드 없이 시간겹침만으로 "충돌"이라 표시하면 오탐(매니저 2명이면 정상 운영)이라
  빨간 경고는 신뢰를 깎음. → 중립 표시("동시간대 N건")만 허용.

## 5. 구현 시 수정 지점 (2026-07-02 라인 기준 — 라인은 변동 가능, 앵커 텍스트로 탐색)

| 위치 | 무엇을 |
|---|---|
| `api/mood-book.js` L208~222 (`tx.set(bookingRef, ...)`) | 신규 필드 저장 (managerId/vehicleId/startAt/endAt/...) + 요청 바디 검증 |
| `api/mood-data.js` | 응답 bookings 에 신규 필드 포함 |
| `src/pages/MoodPortal.tsx` `interface MoodBooking` (L62~79) | 타입에 신규 필드 추가 |
| `src/pages/MoodPortal.tsx` 예약 폼 (L714~ "예약하기" 카드) | 매니저/차량 선택 입력 추가 |
| `src/lib/moodOverlap.ts` | 현재 `maxConcurrentCount`(전체 겹침) 옆에 `conflictsByKey(bookings, key)` 류 순수함수 추가 — 같은 managerId/vehicleId 그룹별 겹침 + 버퍼 판정 |
| `src/pages/MoodPortal.tsx` `overlapByDate` 계산부 (bookingsByDate 직후) | 중립 표시를 충돌 판정으로 승격(운영자 재승인 후에만) |
| `src/pages/MoodPortal.tsx` 캘린더 셀 렌더 (L690~ `calendarDays.map`) | 셀 표시 교체 — 이때도 색·문구는 운영자 승인 필요 |

## 6. 현재 구현돼 있는 것 (충돌 경고 아님)

- `src/lib/moodOverlap.ts` — `maxConcurrentCount`: 같은 날 예약들의 최대 동시 건수
  (startTime "HH:MM" + durationHours, 반열림 구간, startTime 없는 예약 제외). 순수함수 + 단위테스트
  (`tests/unit/mood-overlap-neutral-display.test.ts`).
- `MoodPortal.tsx` 캘린더 — 겹침 있는 날짜 셀에 보라 점, 선택 날짜 헤더에 "동시간대 N건" (중립 톤).

### 중립 표시의 알려진 한계 (2026-07-02 버그헌트에서 확인 — 의도적 미수정)

1. **공항 예약은 집계에서 제외됨** — 공항 픽업/샌딩은 정액제라 `durationHours=0`으로 저장되고,
   겹침 계산이 duration≤0 을 제외하므로 같은 시각 공항 건 여러 개여도 "동시간대 N건"에 안 잡힘.
   충돌 필드 도입 시 공항 건에 명목 소요시간(예: 1h)을 부여해 포함할 것.
2. **자정 넘는 예약은 다음날과 비교 안 됨** — 날짜(`b.date`) 단위 그룹핑이라 23:00 시작 3시간
   운행이 다음날 00~02시 예약과 겹쳐도 미표시. `startAt/endAt` 절대시각 도입 시 자연 해소.
