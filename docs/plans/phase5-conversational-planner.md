---
plan: Phase 5 — Conversational AI Planner (Mindtrip pattern)
created: 2026-04-24
status: SPEC ONLY (사용자 명시적 승인 후만 시작)
estimated: 1주
---

# Phase 5: Conversational AI Planner

## 1. 문제 의식
현재 폼은 15+ 필드를 한 번에 받음. 경쟁사 비교:
- **Mindtrip**: 자연어 입력만, 채팅으로 좁혀나감
- **GuideGeek**: 자연어 + 도시
- **Roam Around**: 5필드 (도시/일수/예산/companions/관심사)

CocoTrip은 "필드는 가장 많은데 출력 반영도 가장 낮음" 위치. 옵션 2가지:
- **A. 폼 더 정교화** (현재 방향) — 이미 result-quality-upgrade로 격차 좁힘
- **B. 자연어 + 챗 정제** (Mindtrip 패턴) — 차별화 큼, 구현 큼

이 spec은 B안.

## 2. 목표
사용자가 채팅으로 여행 의도 표현 → AI가 부족한 정보 묻고 답변받아 plan 생성. 폼은 Optional fallback.

## 3. UI/UX
```
HeroPage:
  ┌─────────────────────────────────────────┐
  │ "한국 여행 어떻게 도와드릴까요?"          │
  │ ┌─────────────────────────────────────┐ │
  │ │ 자연어로 입력 (예: "아빠랑 4일 부산 여행, │ │
  │ │ 매운 거 잘 못 먹고 카메라 좋아함")   │ │
  │ └─────────────────────────────────────┘ │
  │            [ 시작하기 ]                 │
  │                                         │
  │   ── 또는 ──                            │
  │                                         │
  │   [폼으로 진행 (15필드)] (이전 플로우)   │
  └─────────────────────────────────────────┘

채팅 모드:
  Bot: "좋아요! 부산 4일 매운 음식 적은 미식 여행이군요.
        몇 분이서 가시나요?"
  User: "아빠랑 둘이"
  Bot: "도착 공항이 어디인가요? 김해(PUS) / 인천(ICN)"
  User: "김해"
  Bot: "도착 시각도 알려주세요 (선택)"
  User: "오후 3시"
  Bot: "마지막 — 매운맛 회피하시는 정도가 어떻게 되나요?
        ① 완전 안 매운 / ② 약간 매콤 OK / ③ 김치 정도"
  User: "①"
  Bot: "일정 만들고 있어요... [생성중] (15-30초)"
  → PlanDetailPage 이동
```

## 4. 기술 아키텍처

### 백엔드
- 신규 endpoint: `/api/chat-planner` (multi-turn)
- Gemini Function Calling 활용:
  - `tool: ask_user_followup(question, options?)` — Bot이 질문 만들기
  - `tool: generate_plan(complete_inputs)` — 충분한 정보 모으면 호출
- 세션 state는 Firestore `chat_sessions/{sessionId}` 임시 저장 (24h TTL)
- 기존 `ai-planner-full.js` 재사용 — `generate_plan` 호출 시 inputs 변환 후 전달

### 프론트
- 신규 페이지: `/planner/chat` (또는 `/planner` 메인 진입)
- 신규 컴포넌트:
  - `ChatPlanner.tsx` — 채팅 UI (메시지 리스트 + 입력창 + 옵션 버튼)
  - `ChatMessage.tsx` — 메시지 버블 (User/Bot 구분)
  - `useChatSession.ts` — Firestore 세션 동기화 훅

### 데이터 모델
```ts
interface ChatSession {
  id: string;
  uid?: string | null;
  email?: string;
  messages: ChatMessage[];
  collected: PartialPlanInputs;  // Gemini가 모은 정보
  status: 'collecting' | 'generating' | 'complete' | 'failed';
  planId?: string;  // 완료 시 생성된 plan ID
  createdAt, updatedAt
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  options?: string[];  // 선택지 버튼 (있으면 quick reply)
  timestamp: number;
}
```

## 5. 단계별 구현

### Phase 5-A: 채팅 백본 (3일)
- `/api/chat-planner` endpoint
- Gemini Function Calling 기본 구조
- Firestore session 저장
- 영문 only

### Phase 5-B: UI (2일)
- `/planner/chat` 페이지
- 메시지 리스트 + 입력 + quick reply 버튼
- 모바일 최적화

### Phase 5-C: i18n + 폼 fallback (1일)
- 4개 언어 채팅 prompt 번역
- 폼 모드와 토글 가능

### Phase 5-D: 분석 + 튜닝 (1일)
- 평균 메시지 수 / 완료율 GA4
- 폼 vs 챗 A/B 테스트

## 6. 리스크
1. **Gemini Function Calling 지연** — 매 메시지 5-10s. 채팅 끊김 우려 → 스트리밍 응답 적용
2. **부정확한 질문** — Bot이 이미 들은 정보 다시 물음. 시스템 프롬프트로 대화 history 명시
3. **이탈** — 사용자가 5번 이상 답해야 plan 생성 → 3-4번 안에 완료되도록 prompt 튜닝
4. **세션 lost** — 페이지 떠났다가 돌아오면 진행 못 이음. Firestore + URL `?session=xxx`로 복원

## 7. 의사결정 필요
- [ ] 자연어 입력만? 또는 폼+자연어 토글?
- [ ] Gemini 외 모델 (Claude/GPT) 검토?
- [ ] 어느 페이지에 노출? `/planner` 메인 / 신규 `/planner/chat` / Hero 위 인풋박스만

## 8. 시작 조건
- result-quality-upgrade-plan.md 완료 후 1주 + 데이터 검토
- 사용자 명시적 GO 신호
- Phase 5-A 시작 시 별도 detailed spec 작성

## 9. 비교: 폼 vs 챗

| 항목 | 폼 (현재 + result-quality) | 챗 (Phase 5) |
|---|---|---|
| 사용자 시간 | 1-2분 (15필드) | 2-4분 (3-5 메시지) |
| 정확도 | 높음 (선택지) | 중간 (자연어 해석 오류 가능) |
| 차별화 | 낮음 | 높음 (Mindtrip 패턴) |
| 모바일 친화 | 중간 | 높음 |
| 구현 복잡도 | 낮음 | 높음 |
| 결과 퀄리티 | result-quality 후 ↑ | Phase 5 후 ↑↑ |
