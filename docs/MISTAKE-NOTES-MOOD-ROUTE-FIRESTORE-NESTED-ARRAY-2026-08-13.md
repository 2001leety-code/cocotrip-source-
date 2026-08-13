# 실수 노트 — MOOD routeSnapshot 중첩 배열로 Firestore 커밋 전멸 (2026-08-13)

## 무슨 일

2026-08-13 11:13~11:15 KST, `POST /api/mood-book` 이 500 을 4회 반환.

```
3 INVALID_ARGUMENT: Property routeSnapshot contains an invalid nested entity.
```

예약도 생성되지 않았고 잔액도 차감되지 않았다(트랜잭션이 통째로 깨졌으므로 돈 사고는 아님).
사용자 입장에서는 "출발지·도착지를 넣은 예약이 서버 오류로 전부 실패".

## 근본 원인

`api/_shared/mood-route.js` 의 `computeRoute` 는 Naver Directions 폴리라인을
**`[[lng,lat], ...]`** (배열의 배열) 로 돌려준다.

**Firestore 는 배열 안에 배열을 저장할 수 없다.** `routeSnapshot.path` 에 그대로
넣는 순간 문서 전체가 서버에서 거부되고, 그 write 가 든 트랜잭션이 통째로 실패한다.

같은 `compactPath` 함수가 **세 파일에 복붙**돼 있어서 결함도 셋이었다:

| 파일 | 필드 |
|---|---|
| `api/mood-book.js` | `routeSnapshot.path` (신고된 곳) |
| `api/mood-change.js` | `routeSnapshot.path` (+ 감사 이벤트·멱등 응답에도 실림) |
| `api/mood-settle.js` | `finalRouteSnapshot.path` |

즉 신고된 건 예약 하나였지만, **변경·정산도 실제 경로가 붙는 순간 같은 방식으로 죽는다.**

## 왜 테스트가 못 잡았나 (진짜 이유)

1. **테스트 대역이 서버보다 관대했다.** MOOD 핸들러 테스트들은 인메모리 db 목을 쓰는데,
   그 목은 자바스크립트 객체를 그냥 보관한다. 중첩 배열도 얌전히 저장된다.
   서버가 거부하는 모양을 대역이 받아주면, 테스트는 초록인데 prod 만 죽는다.
2. **`path` 를 항상 빈 배열로만 테스트했다.** `computeRouteMock` 이 `path: []`, `points: []`
   를 돌려주고 있었다. 빈 배열엔 중첩 배열이 없으니 결함이 발현할 수 없었다.
   "경로 스냅샷을 저장한다" 를 검증하면서 정작 **경로가 없는 입력**으로만 검증한 것.
3. **클라이언트 SDK 도 못 잡는다.** `@google-cloud/firestore` 의 `validateUserInput` 은
   `undefined`·`FieldPath`·transform 위치는 잡지만 **중첩 배열은 통과시킨다.**
   거부는 서버(gRPC `3 INVALID_ARGUMENT`)에서만 일어난다 — 로컬에서 잡으려면
   직렬화 결과(`arrayValue` 안의 `arrayValue`)를 직접 봐야 한다.

## 고친 방법

`api/_shared/mood-route-snapshot.js` — 경로 스냅샷 코덱 SSOT 신설.

- **저장형(canonical)** = `[{ lng, lat }, ...]` — 중첩 배열 없음.
- **공개 API 형** = `[[lng,lat], ...]` — 프론트 지도/공유 카드 계약 **불변**.
- `buildRouteSnapshot(route)` 를 book/change/settle 셋이 공유(복붙 `compactPath` 3개 삭제).
  600점 압축 알고리즘은 그대로.
- 좌표는 유한수 + 실제 위경도 범위만 통과. 한 점이라도 깨지면 **경로 전체를 버린다**
  (중간을 건너뛴 선은 실제로 가지 않은 지름길을 그려 거짓 동선이 된다).
- 마커도 `{lat,lng,role,index?}` 허용 필드만 새 객체로 만들고 손상 스냅샷은 공개하지 않는다.
- 디코드는 **Firestore 저장이 끝난 HTTP 경계**에서만. `mood-data`와 `mood-change`의
  전송용 복사본은 공개형으로 돌리고, 구 데이터가 이미 공개형이어도 통과.

### 🔴 주의: mood-change 응답은 공개형으로 바꾸면 안 된다

`api/mood-change.js` 는 내부 응답 객체를 그대로 멱등 doc(`mood_booking_change_idempotency`)
에 저장한다. 저장 전에 `path` 를 `[lng,lat][]` 로 되돌리면 **중첩 배열이 다시 Firestore 로
들어가 같은 장애가 재현된다.** 그래서 감사·멱등 doc 은 저장형을 유지하고, 최초 응답과
멱등 재응답은 저장 완료 뒤 전송용 복사본만 공개형으로 변환한다.

## 잠근 회귀

`tests/unit/mood-route-snapshot.test.ts` (20 케이스) — **빈 경로가 아니라 실제 폴리라인**으로:

1. 코덱 왕복 / 600점 압축 / 손상 좌표 거부.
2. **실제 `@google-cloud/firestore` 직렬화**(네트워크·자격증명 없이 `_serializer.encodeValue`)
   결과에 `arrayValue` 안 `arrayValue` 가 없음을 확인. 구 모양은 있음을 같이 증명.
3. `mood-book` / `mood-change` / `mood-settle` 을 실제로 주행 — 서버와 같은 규칙을 강제하는
   대역에서 200 으로 커밋되고 저장된 모든 doc 에 중첩 배열이 없음.
4. `mood-data` 가 `[lng,lat][]` 로 되돌리고, 손상 데이터는 가짜 좌표 대신 null로 폴백한다.

`tests/helpers/fake-firestore.js` 에 `assertFirestoreSafe()` 를 넣어 **모든 write 에서**
중첩 배열을 실제 장애 메시지로 거부하게 했다. 이제 이 대역을 쓰는 테스트는 전부
"서버가 받아줄 모양인가" 를 공짜로 검증한다.

## 다음에 안 틀리려면

- **Firestore 에 배열을 넣을 땐 원소가 스칼라/맵인지 먼저 본다.** 좌표쌍·행렬·튜플 배열은
  전부 이 함정이다. 정답은 `{lng,lat}` 같은 맵 배열 또는 평탄화.
- **테스트 대역은 서버보다 엄격해야 한다.** 목이 관대하면 초록은 아무 의미가 없다.
- **"저장한다" 를 빈 값으로 검증하지 않는다.** 목 픽스처가 `[]`·`null` 이면 그 필드는
  사실상 테스트되지 않은 것이다.
- 같은 헬퍼가 3개 파일에 복붙돼 있으면 결함도 3개다. 공유 모듈로 올리고 잠금 테스트를 건다.
