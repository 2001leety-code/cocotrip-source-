/**
 * CocoTrip API 표준 응답 래퍼
 * 
 * 모든 API가 동일한 형식으로 응답하도록 강제:
 *   { ok: true,  data: {...} }
 *   { ok: false, error: "message", code: "ERROR_CODE" }
 * 
 * 사용법:
 *   const { success, fail, methodGuard } = require('./_shared/response');
 *   if (!methodGuard(req, res, 'POST')) return;
 *   try { ... return success(res, data); }
 *   catch(e) { return fail(res, e.message, 'SOME_ERROR', 500); }
 */

const _ok  = (data) => ({ ok: true, data });
const _err = (msg, code = 'UNKNOWN_ERROR') => ({ ok: false, error: msg, code });

/**
 * 성공 응답 전송
 * @param {object} res - Vercel Response
 * @param {any} data - 응답 데이터
 * @param {number} status - HTTP 상태 코드 (기본 200)
 */
function success(res, data, status = 200) {
  return res.status(status).json(_ok(data));
}

/**
 * 에러 응답 전송
 * @param {object} res - Vercel Response
 * @param {string} msg - 에러 메시지
 * @param {string} code - 에러 코드
 * @param {number} status - HTTP 상태 코드 (기본 400)
 */
function fail(res, msg, code = 'UNKNOWN_ERROR', status = 400) {
  return res.status(status).json(_err(msg, code));
}

/**
 * HTTP 메서드 가드
 * @param {object} req
 * @param {object} res
 * @param {string|string[]} allowed - 허용할 HTTP 메서드(들)
 * @returns {boolean} true면 허용된 메서드
 */
function methodGuard(req, res, allowed) {
  const methods = Array.isArray(allowed) ? allowed : [allowed];
  if (methods.includes(req.method)) return true;
  res.setHeader('Allow', methods.join(', '));
  fail(res, `${req.method} not allowed`, 'METHOD_NOT_ALLOWED', 405);
  return false;
}

module.exports = { success, fail, methodGuard, _ok, _err };