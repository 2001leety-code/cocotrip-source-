/**
 * POST /api/notify-claim — 닫음 (운영자 결정 2026-11-22).
 *
 * "이미 예약했어요 → 무료 플랜" 신청은 받지 않는다(화면은 #255 에서 없어짐, 새 신청 쓰기는
 * firestore.rules·storage.rules 에서 막음). 예전 클라이언트가 불러도 텔레그램을 보내지 않고
 * 요청 내용(이메일·예약 번호)을 읽거나 남기지 않은 채 410 으로 끝낸다. IP 기록도 남기지 않는다.
 *
 * 남은 신청의 승인·거절은 그대로: telegram-webhook-admin.js `handleClaimCallback`, /admin/claims.
 */
export const maxDuration = 5;
export const config = { runtime: 'nodejs' };

export default function handler(_req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(410).json({ ok: false, error: 'FREE_CLAIM_CLOSED' });
}
