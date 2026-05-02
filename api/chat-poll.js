/**
 * Vercel API Route: Chat Poll
 * GET /api/chat-poll?sessionId=<id>&since=<ms>
 *
 * ChatWidget이 주기적으로 호출하여 관리자가 텔레그램으로 보낸 답장을
 * 받아옴. since(epoch ms) 이후 새 메시지만 반환.
 *
 * 보안:
 *   - sessionId가 추측 어려운 임의 문자열이어야 함 (sess_<UUID>)
 *   - 인증 미적용 — sessionId 자체가 access token 역할
 *   - rate limit은 ChatWidget 측 폴링 간격(8초)으로 자연 제한
 */
import { getMessagesSince } from './_shared/chat-relay.js';

export const maxDuration = 5;
export const config = { runtime: 'nodejs' };

const _ok  = (data) => ({ ok: true, data });
const _err = (msg, code = 'UNKNOWN_ERROR') => ({ ok: false, error: msg, code });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
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

  if (!sessionId || !sessionId.startsWith('sess_') || sessionId.length < 8) {
    res.writeHead(400, JSON_CORS);
    return res.end(JSON.stringify(_err('Invalid sessionId', 'INVALID_SESSION')));
  }

  try {
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
