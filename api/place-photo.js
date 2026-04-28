/**
 * GET /api/place-photo?ref=PHOTO_REF&w=400
 *
 * Google Places Photo proxy — RouteAgent가 Place Text Search로 받은 photo_reference를
 * 클라이언트에 노출하지 않고 (API key 보호) 서버에서 fetching 후 streaming.
 *
 * - HTTP 캐싱 (1일) — 브라우저/CDN이 같은 ref 재요청 시 200 복귀
 * - max-width 파라미터로 비용 제어 (작을수록 quota 적게)
 * - 비용: Place Photo API ~$7/1000 호출 (Google Maps Platform Free $200/월 한도 내)
 *
 * 사용처: src/pages/PlanDetailPage/components/StopCard.tsx — stop.photo_ref 있으면 thumbnail.
 */

export default async function handler(req, res) {
  const ref = req.query?.ref || req.query?.photo_reference;
  const widthRaw = parseInt(req.query?.w || '400', 10);
  const width = Math.min(800, Math.max(100, isNaN(widthRaw) ? 400 : widthRaw));

  if (!ref || typeof ref !== 'string' || ref.length < 10) {
    return res.status(400).json({ error: 'photo_reference required (?ref=...)' });
  }

  const key = (process.env.GOOGLE_PLACES_API_KEY || '').trim();
  if (!key) return res.status(500).json({ error: 'GOOGLE_PLACES_API_KEY not configured' });

  const url = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${width}&photo_reference=${encodeURIComponent(ref)}&key=${key}`;

  try {
    const upstream = await fetch(url, { redirect: 'follow' });
    if (!upstream.ok) {
      console.warn('[place-photo] upstream', upstream.status, ref.slice(0, 20));
      return res.status(502).json({ error: 'upstream_error', status: upstream.status });
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    // 1 day cache — Google Places Photo URL은 stable한 photo_reference 기반.
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, immutable');
    return res.status(200).send(buf);
  } catch (e) {
    console.error('[place-photo] error:', e.message);
    return res.status(502).json({ error: 'fetch_failed', detail: e.message });
  }
}
