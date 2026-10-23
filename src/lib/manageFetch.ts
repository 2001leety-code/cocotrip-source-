/**
 * manageFetch — 게스트 예약 관리 토큰으로 부르는 POST (2026-10-23, 후속 ②a).
 *
 * 확인 메일 링크(`/booking/manage#t=<token>`)의 토큰을 **본문**(`manageToken`)으로만 보낸다 —
 * URL 쿼리·헤더에 싣지 않는다. Bearer 를 붙이지 않는다(서버는 Authorization 헤더가 있으면 회원
 * 경로만 타므로, 로그인 상태여도 게스트 토큰 요청은 헤더 없이 가야 한다).
 *
 * 허용 경로는 세 개뿐이다(조회·취소·날짜 변경, 2026-10-23 ②b). 다른 보호 엔드포인트(voucher 등)는 throw —
 * lint P43 도 같은 목록을 본다.
 */
const MANAGE_PATHS = new Set(['/api/booking-manage', '/api/cancelBooking', '/api/modifyBooking']);

export async function manageFetch(
  path: string,
  { manageToken, body = {} }: { manageToken: string; body?: Record<string, unknown> },
): Promise<Response> {
  if (!MANAGE_PATHS.has(path)) throw new Error(`manageFetch: path not allowed: ${path}`);
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'omit',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
    body: JSON.stringify({ ...body, manageToken }),
  });
}
