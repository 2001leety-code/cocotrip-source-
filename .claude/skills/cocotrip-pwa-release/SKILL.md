---
name: cocotrip-pwa-release
description: Use when changing PWA splash/intro, service worker (sw.ts), manifest, vite.config PWA section, PWAUpdatePrompt, index.html app-splash, or when 앱에 변경이 안 보인다·스플래시 깜빡임·두 번 켜지는 느낌·업데이트 안 됨 issues appear.
---

# PWA 릴리즈 레시피 (CocoTrip + MOOD)

**왜:** 스플래시·인트로·업데이트는 서로 물려 있어 하나만 바꾸면 깨진다.

## 불변식 (잠금 테스트가 지킴)
- **seamless**: 스플래시 배경 = manifest `background_color`. OS 스플래시 → 인트로 색 점프 0.
- **아이콘 비트**: 인트로 첫 프레임 = manifest 아이콘 → 인트로 이미지로 크로스페이드("두 번 켜지는 느낌" 방지).
- **인트로 이미지 = .webp 우선 + .png 폴백.** 새 이미지 추가 시 webp 생성 + `vite.config.ts includeAssets` 등록.
- **standalone 전용**: 브라우저 탭에선 인트로 미노출. 프리뷰 = `?intro=1` / `/mood?intro=mood`.
- **결제중 자동 리로드 금지**: PWAUpdatePrompt의 `isPaymentLikelyInProgress` 가드 제거 금지. 자동 업데이트는 콜드스타트 창 + idle 안에서만.

## signalAppReady (실제 구조 — `src/lib/appReady.ts`)
- **멱등**: 모듈 플래그 `_appReadyFired`. **첫 호출만** `globalThis.__appReady?.()`를 발화하고, 이후 중복 호출은 no-op.
- **일반 브라우저 탭**: `__appReady`가 정의되지 않아 no-op. standalone 설치 실행 때만 index.html 인라인 스플래시가 이 신호를 기다린다(안전 캡은 index.html 인라인에 있음 — 값은 코드 확인).
- **호출 지점**: `App.tsx`가 전역(useEffect)에서 호출. 첫 페인트가 민감한 페이지도 각자 호출한다 — `MobileHomeV2`, `CommunityPage`(useEffect), `MoodPortal`(더블 `requestAnimationFrame`으로 실제 페인트 후 신호). 멱등 가드 덕분에 어디서 먼저 불려도 **1회만** 발화 → 스플래시가 빈 화면을 덮은 채 실제 페인트 후에만 걷힌다.
- 실수 패턴: 신호를 **너무 일찍** 쏘면 스플래시 걷힌 뒤 빈 화면/스피너 노출. 새 첫-화면 페이지는 페인트 준비 후 호출.

## 잠금 테스트 (수정 시 불변식 유지하며 같이 갱신)
- `tests/unit/pwa-splash-shortcuts.test.ts` — 스플래시 구조·색·이미지 경로
- `tests/unit/bughunt-splash-ready.test.ts` — signalAppReady 배선
- `tests/unit/pwa-update-prompt-no-forced-reload.test.ts` — 강제 리로드 금지 가드

## 검증 순서
1. 3개 잠금 테스트 모두:
   ```bash
   npx vitest run tests/unit/pwa-splash-shortcuts.test.ts tests/unit/bughunt-splash-ready.test.ts tests/unit/pwa-update-prompt-no-forced-reload.test.ts
   ```
2. dev에서 `/?intro=1`·`/mood?intro=mood` 렌더 + 인트로 자산 HTTP 200
3. `npm run build` — precache 목록에 새 자산 들어갔는지
4. ⚠️ **build 성공 = 코드/precache 확인일 뿐, service worker의 실기기 동작을 검증한 게 아니다.** 실기기 standalone 설치·업데이트·스플래시 거동은 **항상 "미검증 — 운영자 확인 필요"** 로 분리 보고한다.
5. 배포 후 앱에 변경 안 보이면 = SW 캐시(콜드스타트 자동업뎃·시크릿창 확인). 프리뷰에 주소창 보이는 건 정상(PWA 문제로 오판 금지).

## 함정
| 함정 | 결과 |
|---|---|
| 인트로 배경색만 바꿈 | manifest와 불일치 → 실행 순간 색 점프 |
| PNG만 추가 | webp 없이 큰 로드 동안 빈 화면 |
| signalAppReady 일찍 쏨 | 스플래시 걷힌 뒤 빈 화면/스피너 |
| autoUpdate로 되돌림 | 위저드 작성 중 강제 리로드 회귀 |
