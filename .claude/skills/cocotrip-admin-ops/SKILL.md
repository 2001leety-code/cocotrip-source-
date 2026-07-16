---
name: cocotrip-admin-ops
description: Use when changing /admin pages, admin menus/links, MOOD topup flow, deposit-confirm queue, inquiry list, or 어드민·운영 화면·입금 확인·무드 충전 관련 작업.
---

# 어드민 운영 화면 작업 규칙

## 구조
- `/admin` 홈 = Brain OS 톤 다크 운영 콘솔: 운영관제 히어로 + KPI 카드 + 입금 확인 대기 큐 + 빠른 실행 + 업무군별 메뉴 (`src/pages/Admin.tsx`).
- 게이트 = `AdminRoute` — `VITE_ADMIN_EMAIL` 단일 이메일 매치.
  - ⚠️ **이 프론트 이메일 비교는 UX 게이트일 뿐, 최종 보안 경계가 아니다.** 클라에서 우회 가능. 실제 보호는 각 API의 서버측 인증(Firebase 토큰 + admins allowlist)에서 이뤄져야 한다.
  - 로그인 후 화면은 dev에서 자동 검증 불가 — 코드 대조 + 운영자 눈확인.

## 메뉴 링크 레지스트리 (변경 시 구버전과 전수 대조 — 누락 사고 방지)
개수를 박제하지 말고 자동 비교로 확인:
```bash
diff <(git show HEAD:src/pages/Admin.tsx | grep -o "/admin[^'\"]*" | sort -u) \
     <(grep -o "/admin[^'\"]*" src/pages/Admin.tsx | sort -u)
```
신규 추가/삭제된 링크가 diff로 드러난다. 기존 링크를 리디자인 중 실수로 빠뜨리지 말 것.

## 무드 충전 (돈 — `cocotrip-money-safety` 스킬 필수 병행)
- **진입 = 인라인 모달.** 어드민의 "무드 충전"을 누르면 `src/pages/Admin.tsx`가 인라인 `MoodTopupModal`(`@/components/admin/MoodTopupModal`)을 연다(`setMoodTopupOpen(true)`). 페이지 이동이 아니다.
  - `/mood#topup` 문자열은 메뉴/action 레지스트리의 **내부 식별자로 남아 있을 수 있으나**, 실제 사용자 동작은 그 href로의 이동이 아니라 **모달 오픈**으로 가로채진다.
- API: `api/mood-topup.js` — 서버 4중벽(Firebase 토큰 + emailVerified + admins allowlist + Firestore 트랜잭션), 양의 정수만. 이력에 `previousBalanceKRW`/`newBalanceKRW`/`byEmail`/`at`(+제공 시 `note`)를 같은 트랜잭션에 기록.
- **충전 실행은 운영자 수동 — AI가 실충전 금지.** 충전 대상 client는 사전 등록 필수(`CLIENT_NOT_FOUND` = 정상 동작).

## 문의 목록 (charter_inquiries)
- `AdminClaims.tsx`가 렌더 — vehicle 라벨 하드코딩 금지(신규 값이 자동으로 떠야 함).
- 새 vehicle 값 추가 시: `api/inquiry-submit.js` ALLOWED_VEHICLES + 텔레그램 알림 포맷 같이 갱신.

## 주의
- 사용자가 기능 변경을 요청하지 않았으면 기존 기능(예약 테이블·테스트 푸시·투어 생성폼)을 리디자인 중에도 제거하지 말 것.
- KPI 수치는 실데이터 소스 확인 — 가짜 숫자 금지(미연동이면 미연동 표기).
- 돈 관련 API 수정은 항상 `cocotrip-money-safety` 병행. 검증만 요청받으면 자동 수정하지 않는다.
