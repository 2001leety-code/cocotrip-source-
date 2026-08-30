// @vitest-environment jsdom
//
// 게스트 3문답 게이트 (2026-08-18 퍼널 감사 1번 — AI 챗 로그인 벽 제거).
//
// 계약:
//   - 비로그인(게스트)도 바로 질문할 수 있다 (로그인 벽 없음).
//   - 게스트는 GUEST_FREE_QUESTIONS(3)개까지만 — 4번째 전송은 훅이 무시한다
//     (fetch 자체가 안 나감 = Gemini 비용 0).
//   - 로그인 사용자는 게이트 없음.
//   - 게스트 요청 body 의 userId 는 falsy (서버가 게스트로 인식해 IP 캡 적용).
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

void React;

const authHolder: { user: { uid: string; getIdToken: () => Promise<string> } | null } = { user: null };
vi.mock('../../src/hooks/useAuth', () => ({ useAuth: () => ({ ...authHolder }) }));

const { useChatSession, GUEST_FREE_QUESTIONS } = await import('../../src/hooks/useChatSession');

const fetchMock = vi.fn();

beforeEach(() => {
  window.localStorage.clear();
  authHolder.user = null;
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({
      ok: true,
      data: { reply: 'hello!', sessionId: 'sess_abcdefghijklmnopqrstuvwxyz123456' },
    }),
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** /api/chat 호출만 집계 (운영자 답장 폴링 /api/chat-poll 은 제외). */
function chatCalls() {
  return fetchMock.mock.calls.filter(([url]) => url === '/api/chat');
}

describe('guest 3-question gate', () => {
  it('guests can send up to GUEST_FREE_QUESTIONS, then the hook blocks the next send', async () => {
    const { result } = renderHook(() => useChatSession('en', true));

    for (let i = 1; i <= GUEST_FREE_QUESTIONS; i++) {
      await act(async () => { await result.current.sendMessage(`question ${i}`); });
      expect(chatCalls()).toHaveLength(i);
    }
    expect(result.current.guestGated).toBe(true);
    expect(result.current.guestQuestionCount).toBe(GUEST_FREE_QUESTIONS);

    // 4번째 — 전송 자체가 막힌다 (fetch 불변, user 메시지 안 늘어남).
    await act(async () => { await result.current.sendMessage('one more?'); });
    expect(chatCalls()).toHaveLength(GUEST_FREE_QUESTIONS);
    expect(result.current.messages.filter((m) => m.role === 'user')).toHaveLength(GUEST_FREE_QUESTIONS);
  });

  it('guest requests carry no userId, so the server owns guest identity via signed cookie', async () => {
    const { result } = renderHook(() => useChatSession('en', true));
    await act(async () => { await result.current.sendMessage('hi'); });

    const [, init] = chatCalls()[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).not.toHaveProperty('userId');
    expect(result.current.sessionId).toBe('sess_abcdefghijklmnopqrstuvwxyz123456');
    expect(window.localStorage.getItem('cocotrip_chat_session_v1'))
      .toBe('sess_abcdefghijklmnopqrstuvwxyz123456');
  });

  it('signed-in users are never gated (more than 3 sends go through)', async () => {
    authHolder.user = { uid: 'user-1234', getIdToken: async () => 'firebase-id-token' };
    const { result } = renderHook(() => useChatSession('en', true));

    for (let i = 1; i <= GUEST_FREE_QUESTIONS + 2; i++) {
      await act(async () => { await result.current.sendMessage(`question ${i}`); });
    }
    expect(chatCalls()).toHaveLength(GUEST_FREE_QUESTIONS + 2);
    expect(result.current.guestGated).toBe(false);
    expect(result.current.guestQuestionCount).toBe(0);

    const [, init] = chatCalls()[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).not.toHaveProperty('userId');
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get('Authorization')).toBe('Bearer firebase-id-token');
  });

  it('a signed-in token failure never downgrades the request to a guest chat', async () => {
    authHolder.user = {
      uid: 'user-1234',
      getIdToken: async () => { throw new Error('token unavailable'); },
    };
    const { result } = renderHook(() => useChatSession('en', true));

    await act(async () => { await result.current.sendMessage('private question'); });

    expect(chatCalls()).toHaveLength(0);
    expect(result.current.messages.at(-1)?.text).toContain('Connection error');
  });
});
