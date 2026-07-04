---
name: cocotrip-design-review
description: Use when creating or changing user-facing UI (pages, cards, modals, forms, buttons) in the CocoTrip web app — before merging any visual change, or when reviewing design quality/density/tone of a screen. 디자인 점검·UI 밀도·카드 크기·톤 검토 요청 시.
---

# CocoTrip 디자인 리뷰 기준 (운영자 확정 취향)

**왜:** 운영자가 매번 같은 피드백을 반복하지 않게 기준을 박제. "클로드가 디자인을 못한다"는 평가의 원인 = 아래 기준 미준수.

## 운영자 기준 (어기면 재작업)
1. **작고 밀도 있게.** 모바일에서 카드/선택창이 크면 "답답하다". Trip.com 카드 밀도가 기준 — 큰 랜딩형 히어로·과한 여백 금지, 실사용 앱 느낌.
2. **모바일 390px 우선.** 데스크탑은 그 다음. 확인도 모바일 뷰포트로 먼저.
3. **톤 = 다크네이비 + 퍼플/핑크.** 배경 `#0a0b14`(웹)/`#0a0412`(MOOD), 포인트 `#B668FC`·`#EA537E`(그라디언트 135deg). 어드민/운영 화면은 Brain OS 톤 다크 콘솔.
4. **다크 대비 확인.** 어두운 배경에 어두운 텍스트 금지 — text-white/50 이하로 본문 쓰지 말 것 (dark contrast 오답노트).
5. **터치 타깃 최소 44px** (min-h-[44px] 관례).
6. **4-lang 동시.** 사용자 노출 텍스트는 ko/en/ja/zh 한 번에 (STRINGS 패턴). 하나라도 빠지면 lint/리뷰 컷.
7. **울룰루/Trip.com 캡처는 참고만** — 사업 구조 다르면 그대로 베끼지 말고 CocoTrip에 맞게 변형.

## 기존 것 보호
- 기능/배선(예약·결제·쿠폰·지도·API) 제거 금지 — 레이아웃만.
- 디자인 SSOT·기존 컴포넌트(TrustBadges·QuickPreviewCard 등) 재사용 우선, 새 스타일 발명 최소화.

## 리뷰 절차
1. 모바일 390px 스냅샷 → 첫 화면에 핵심 CTA 보이나, 스크롤 없이 답답하지 않나
2. PC 1280px — 모바일 수정이 데스크탑 그리드 안 깨뜨렸나
3. 다크 대비·터치 타깃·4-lang 스팟체크
4. **머지 전 verify-web 필수** (실물 스냅샷 판단 — 빌드 통과로 끝내지 말 것)
