/**
 * Vercel API Route: Chat Poll
 * GET /api/chat-poll?sessionId=<id>&since=<ms>
 *
 * ChatWidget이 주기적으로 호출하여 관리자가 텔레그램으로 보낸 답장을
 * 받아옴. since(epoch ms) 이후 새 메시지만 반환.
 *
 * 보안:
 *   - 로그인 사용자는 Firebase ID token uid와 서명 쿠키를 함께 대조
 *   - 게스트는 서버가 발급한 HttpOnly 서명 쿠키로 sessionId 소유권 증명
 *   - 소유자별 서버 1분 상한으로 클라이언트 폴링 간격 우회 방지
 */
import { getMessagesSince } from './_shared/chat-relay.js';
import { initAdminDb } from './_shared/firebase-admin.js';
import {
  authorizeChatSessionRead,
  checkChatPollRateLimit,
} from './_shared/chat-session-auth.js';

export const maxDuration = 5;
export const config = { runtime: 'nodejs' };

const _ok  = (data) => ({ ok: true, data });
const _err = (msg, code = 'UNKNOWN_ERROR') => ({ ok: false, error: msg, code });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const JSON_CORS = { ...CORS, 'Content-Type': 'application/json' };

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, CORS); return res.end(); }
  if (req.method !== 'GET') {
    res.writeHead(405, JSON_CORS);
    return res.end(JSON.stringify(_err('GET only', 'METHOD_NOT_ALLOWED')));
  }

  const url = new URL(req.url, 'http://localhost');
  const sessionId = url.searchParams.get('sessionId') || '';
  const sinceStr = url.searchParams.get('since') || '0';
  const since = parseInt(sinceStr, 10) || 0;

  try {
    const access = await authorizeChatSessionRead(req, res, sessionId);
    if (!access.ok) {
      res.writeHead(access.status || 401, JSON_CORS);
      return res.end(JSON.stringify(_err(access.error || 'Chat session denied', access.code || 'SESSION_FORBIDDEN')));
    }

    const rate = await checkChatPollRateLimit(initAdminDb('chat-poll'), access.rateKey);
    if (!rate.ok) {
      res.writeHead(429, { ...JSON_CORS, 'Retry-After': String(rate.retryAfterSec || 60) });
      return res.end(JSON.stringify(_err('Too many chat polls. Please wait.', 'RATE_LIMIT_POLL')));
    }

    const messages = await getMessagesSince(sessionId, since);
    // customer/ai 메시지는 ChatWidget이 이미 표시 중 — admin 메시지만 반환
    const adminOnly = messages.filter((m) => m.from === 'admin');
    res.writeHead(200, JSON_CORS);
    return res.end(JSON.stringify(_ok({ messages: adminOnly })));
  } catch (err) {
    console.error('[chat-poll] error:', err);
    res.writeHead(500, JSON_CORS);
    return res.end(JSON.stringify(_err(err.message, 'INTERNAL_ERROR')));
  }
}
