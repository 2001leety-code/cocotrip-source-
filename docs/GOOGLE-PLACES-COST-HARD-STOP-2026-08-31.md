# Google Places 비용 사고 오답노트 — 2026-08-31

## 결론

Google Places는 CocoTrip 운영 runtime에서 사용하지 않는다. 일정 좌표는 기존 Naver 경로와 정적 fallback만 사용하고, 장소 사진은 외부 API 대신 내부 시각 요소를 사용한다.

## 근본 원인

- 2026-04-28 Naver가 일부 관광지명을 못 찾을 때의 좌표 fallback으로 Google Text Search가 추가됐다.
- 같은 날 “시각 강화” 목적으로 좌표가 이미 있어도 `photo_ref`가 없으면 Google을 호출하도록 범위가 넓어졌다.
- 공개 `/api/place-photo`에는 인증·전체 상한·Preview 차단이 없었다.
- 같은 사진을 카드·확대·요약·PDF가 서로 다른 URL로 요청했다.
- 자동검사가 실제 Preview의 유료 API까지 호출할 수 있었고, 예산 알림을 강제 차단으로 잘못 취급했다.

## 다시 깨지면 안 되는 계약

1. `api/`와 `src/`의 운영 코드에는 Google Places/Maps 유료 endpoint가 없어야 한다.
2. `/api/place-photo`는 Vercel 정적 자산 redirect가 먼저 처리하고, 함수 fallback도 외부 `fetch`와 키 읽기가 0이어야 한다.
3. `RouteAgent`는 `GOOGLE_PLACES_API_KEY`, `photo_ref`, Google Text Search를 참조하지 않는다.
4. Playwright는 `maps.googleapis.com`, `places.googleapis.com`, `/api/place-photo` 시도를 차단하고 시도 자체를 테스트 실패로 기록한다.
5. CI에서 `BASE_URL`이 빠지면 운영 사이트로 넘어가지 않는다. 로컬 기본값은 `127.0.0.1`이다.
6. 수동 Google 데이터 보강은 `--allow-paid-google-places`와 `--max-paid-requests=1..100`을 동시에 줘야 한다. `--dry`도 외부 호출은 유료다.
7. Google Places를 다시 켜는 변경은 운영자의 새 비용 승인, 호출 전 원자적 월 한도, 장애 시 fail-closed, Preview 0-call 검증 없이는 머지하지 않는다.

## 회귀 잠금

- `tests/unit/places-cost-hard-stop.test.ts`
- `tests/unit/google-places-runtime-zero.test.ts`
- `tests/unit/places-cost-hard-stop-ci.test.ts`
- `tests/unit/paid-google-scripts-consent.test.ts`
- `tests/unit/image-proxy-pr454.test.ts`

## 운영 설정 후속

코드 배포 뒤 운영자가 Google Cloud Console에서 기존 Places 키 사용량이 0으로 수렴하는지 확인한다. 비밀키 값·Vercel 환경변수 값은 저장소나 로그에 기록하지 않는다.
