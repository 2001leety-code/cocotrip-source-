---
name: cocotrip-design-review
description: Use when creating or changing user-facing UI (pages, cards, modals, forms, buttons) in the CocoTrip web app — before merging any visual change, or when reviewing design quality/density/tone of a screen. 디자인 점검·UI 밀도·카드 크기·접근성·톤 검토 요청 시.
---

# CocoTrip 디자인 리뷰 기준

**왜:** 운영자가 같은 피드백을 반복하지 않게 기준을 박제. 아래 미준수 = 재작업.

## 운영자 기준
1. **작고 밀도 있게.** 모바일 카드/선택창이 크면 "답답". Trip.com 카드 밀도가 기준 — 큰 랜딩형 히어로·과한 여백 금지, 실사용 앱 느낌.
2. **모바일 390px 우선.** 데스크탑은 그 다음. 확인도 모바일 뷰포트로 먼저.
3. **톤 = 다크네이비 + 퍼플/핑크.** 배경 다크(웹/MOOD), 포인트 퍼플·핑크 그라디언트. 어드민은 Brain OS 다크 콘솔.
   - ⚠️ **색상 hex를 새로 발명하기 전에 기존 design token/SSOT를 먼저 확인**한다. 중복 상수·하드코딩 hex 금지 — 기존 토큰·유틸리티 클래스를 재사용.
4. **4-lang 동시.** 사용자 노출 텍스트는 ko/en/ja/zh 한 번에. 하나라도 빠지면 lint/리뷰 컷.
5. **울룰루/Trip.com 캡처는 참고만** — 사업 구조 다르면 CocoTrip에 맞게 변형.

## 접근성 (기본 검사)
- **색 대비:** 어두운 배경에 어두운 텍스트 금지.
  - 본문·읽어야 하는 텍스트: 충분한 대비 확보(대략 WCAG AA 4.5:1). `text-white/50` 이하로 **본문**을 쓰지 말 것.
  - 보조/캡션/메타: 낮은 대비 허용하되 가독 하한 유지.
  - disabled·순수 장식(decorative): 낮은 대비 OK — 의미 전달을 색에만 의존하지 않기.
- **터치 타깃:** **클릭 가능한 주요 컨트롤**(버튼·링크·입력·토글)은 최소 44px(`min-h-[44px]`). 순수 텍스트/장식 요소는 대상 아님.
- **키보드:** 인터랙티브 요소는 키보드로 도달·조작 가능해야 하고, **`focus-visible` 포커스 링**이 보여야 한다(제거 금지).
- **모션:** 큰 애니메이션은 `prefers-reduced-motion`을 존중.
- **폼:** 모든 입력에 연결된 `label`(또는 `aria-label`). placeholder를 label 대용으로 쓰지 말 것.

## 기존 것 보호
- **사용자가 기능 변경을 요청하지 않았으면 기존 기능·배선(예약·결제·쿠폰·지도·API)을 보존**한다 — 리디자인은 레이아웃/시각에 한정하고 동작을 바꾸지 않는다.
- 디자인 SSOT·기존 컴포넌트(TrustBadges·QuickPreviewCard 등) 재사용 우선, 새 스타일 발명 최소화.

## 리뷰 절차
1. 모바일 390px snapshot → 첫 화면에 핵심 CTA 보이나, 답답하지 않나
2. PC 1280px — 모바일 수정이 데스크탑 그리드 안 깨뜨렸나
3. 대비·터치 타깃·키보드 포커스·4-lang 스팟체크
4. 머지 전 `verify-web`으로 실물 확인(빌드 통과로 끝내지 말 것)
