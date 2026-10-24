// 게스트(비로그인) 채팅 무료 문답 수 — 서명 쿠키 게스트 세션당 일(KST) 한도 (2026-10-24).
// 클라이언트 게이트 src/hooks/useChatSession.ts GUEST_FREE_QUESTIONS 와 같은 값이어야 한다
// (tests/unit/chat-guest-free-limit.test.ts 가 소스 문자열로 잠금).
export const GUEST_FREE_QUESTIONS = 3;
