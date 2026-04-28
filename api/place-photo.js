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
 *
 * Runtime: **edge** — pure proxy + cache. 50ms cold start vs 250ms node lambda.
 * High-frequency endpoint (plan당 5-7장 호출) 이라 cold start 차이가 직접적으로
 * 사용자 perceived latency 와 비용에 반영.
 *
 * Edge constraints satisfied:
 *   - Web Fetch API (no node:http)
 *   - No Buffer — upstream.arrayBuffer() 그대로 Response 에 전달
 *   - No fs / path / firebase-admin
 *   - process.env.* OK (Vercel injects at edge runtime)
 */

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const reqUrl = new URL(req.url);
  const ref = reqUrl.searchParams.get('ref') || reqUrl.searchParams.get('photo_reference');
  const widthRaw = parseInt(reqUrl.searchParams.get('w') || '400', 10);
  const width = Math.min(800, Math.max(100, isNaN(widthRaw) ? 400 : widthRaw));

  if (!ref || typeof ref !== 'string' || ref.length < 10) {
    return Response.json(
      { error: 'photo_reference required (?ref=...)' },
      { status: 400 },
    );
  }

  const key = (process.env.GOOGLE_PLACES_API_KEY || '').trim();
  if (!key) {
    return Response.json(
      { error: 'GOOGLE_PLACES_API_KEY not configured' },
      { status: 500 },
    );
  }

  const upstreamUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${width}&photo_reference=${encodeURIComponent(ref)}&key=${key}`;

  try {
    const upstream = await fetch(upstreamUrl, { redirect: 'follow' });
    if (!upstream.ok) {
      console.warn('[place-photo] upstream', upstream.status, ref.slice(0, 20));
      return Response.json(
        { error: 'upstream_error', status: upstream.status },
        { status: 502 },
      );
    }
    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        // 1 day browser cache + 1 week CDN cache. photo_reference 는 stable.
        'Cache-Control': 'public, max-age=86400, s-maxage=604800, immutable',
      },
    });
  } catch (e) {
    console.error('[place-photo] error:', e.message);
    return Response.json(
      { error: 'fetch_failed', detail: e.message },
      { status: 502 },
    );
  }
}
