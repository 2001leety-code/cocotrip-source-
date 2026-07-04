---
name: cocotrip-admin-ops
description: Use when changing /admin pages, admin menus/links, MOOD topup flow, deposit-confirm queue, inquiry list, or 어드민·운영 화면·입금 확인·무드 충전 관련 작업.
---

# 어드민 운영 화면 작업 규칙

## 구조 (2026-07-03 리디자인 기준)
- `/admin` 홈 = Brain OS 톤 다크 운영 콘솔: 운영관제 히어로 + KPI 4카드(오늘 실결제/입금대기/환불/월매출) + 입금 확인 대기 큐 + 빠른 실행 + 업무군별 전체 메뉴 (`src/pages/Admin.tsx`)
- 게이트 = `AdminRoute`(`VITE_ADMIN_EMAIL` 단일 이메일 매치). 로그인 후 화면은 dev에서 자동 검증 불가 — 코드 대조 + 운영자 눈확인.

## 링크 레지스트리 (변경 시 구버전과 전수 대조 — 누락 사고 방지)
`git show HEAD:src/pages/Admin.tsx | grep -o "/admin[^'\"]*"` 로 뽑아 신구 비교. 현재 21개:
reviews·claims·plans·calendar·availability·reconciliation·products·zone-courses·translations·coupons·sales·analytics·promo-stats·quality·intent-classifier·briefing·decisions·ops·ops?tab=profit·payments·all-bookings (+ `/mood#topup`)

## 무드 충전 (돈 — cocotrip-money-safety 스킬 필수 병행)
- 진입: 어드민 "무드 충전" → `/mood#topup` → MoodPortal이 로그인·로딩 후 충전 카드 스크롤+포커스
- API: `api/mood-topup.js` — 4중벽(토큰+emailVerified+admins+트랜잭션), 양의 정수만, 이력에 previous/newBalanceKRW+note. **충전 실행은 운영자 수동** — AI가 실충전 금지.
- 충전 대상 client는 사전 등록 필수(CLIENT_NOT_FOUND = 정상 동작).

## 문의 목록 (charter_inquiries)
- `AdminClaims.tsx`가 렌더 — vehicle 라벨 하드코딩 금지(bus·tour_custom 등 신규 값이 자동으로 떠야 함).
- 새 문의 vehicle 값 추가 시: `api/inquiry-submit.js` ALLOWED_VEHICLES + 텔레그램 알림 포맷 같이.

## 주의
- 기존 기능(예약 테이블·테스트 푸시·투어 생성폼) 리디자인 시에도 제거 금지.
- KPI 수치는 실데이터 소스 확인 — 가짜 숫자 표시 금지(사용량 미연동이면 미연동 표기).
