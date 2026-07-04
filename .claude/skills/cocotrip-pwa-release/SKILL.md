---
name: cocotrip-pwa-release
description: Use when changing PWA splash/intro, service worker (sw.ts), manifest, vite.config PWA section, PWAUpdatePrompt, index.html app-splash, or when 앱에 변경이 안 보인다·스플래시 깜빡임·두 번 켜지는 느낌·업데이트 안 됨 issues appear.
---

# PWA 릴리즈 레시피 (CocoTrip + MOOD)

**왜:** 2026-07-01~03 사흘치 삽질 박제. 스플래시·인트로·업데이트는 서로 물려 있어서 하나만 바꾸면 깨짐.

## 불변식 (잠금 테스트가 지킴 — 어기면 pre-push에서 죽음)
- **seamless**: 스플래시 배경 = manifest background_color (cocotrip `#0a0b14` / mood `#0a0412`). OS 스플래시→인트로 색 점프 0.
- **아이콘 비트**: 인트로 첫 프레임 = manifest 아이콘(중앙 112px) → 인트로 이미지로 크로스페이드. "두 번 켜지는 느낌" 방지 (7/3 fix).
- **인트로 이미지 = .webp 우선**(21~23KB) + .png 폴백. 새 이미지 추가 시 webp 생성 + `vite.config.ts includeAssets` 등록.
- **standalone 전용**: 브라우저 탭에선 인트로 미노출. 프리뷰는 `?intro=1` / `/mood?intro=mood`.
- **signalAppReady 규칙**: App.tsx 전역 1회 호출(Bug#10) + `/mood`·`/mood/*`만 예외(MoodPortal이 더블 rAF로 페인트 후 직접 신호). MAX 3.9s 캡 = 안전망.
- **결제중 자동 리로드 금지**: PWAUpdatePrompt의 isPaymentLikelyInProgress(PayPal iframe/포커스) 가드 제거 금지. 자동 업데이트는 콜드스타트 10s 창 + idle 1.2s 안에서만.

## 잠금 테스트 위치 (수정 시 불변식 유지하며 같이 갱신)
- `tests/unit/pwa-splash-shortcuts.test.ts` — 스플래시 구조·색·이미지 경로
- `tests/unit/bughunt-splash-ready.test.ts` — signalAppReady 배선
- `tests/unit/pwa-update-prompt-no-forced-reload.test.ts` — P235 강제 리로드 금지

## 검증 순서
1. `npx vitest run tests/unit/pwa-splash-shortcuts.test.ts tests/unit/bughunt-splash-ready.test.ts`
2. dev에서 `/?intro=1`·`/mood?intro=mood` 렌더 + 인트로 자산 HTTP 200
3. `npm run build` — precache 목록에 새 자산 들어갔는지
4. **실기기 standalone은 운영자 몫** — 프리뷰에 주소창 보이는 건 정상, PWA 문제로 오판 금지
5. 배포 후 앱에 변경 안 보이면 = SW 캐시 (#950 콜드스타트 자동업뎃·시크릿창 확인)

## 함정
| 함정 | 결과 |
|---|---|
| 인트로 배경색만 바꿈 | manifest와 불일치 → 실행 순간 색 점프 |
| PNG만 추가 | 1.2MB 로드 동안 빈 화면 |
| signalAppReady 일찍 쏨 | 스플래시 걷힌 뒤 빈 화면/스피너 노출 |
| autoUpdate로 되돌림 | 위저드 작성 중 강제 리로드 회귀 (#pwa-prompt) |
