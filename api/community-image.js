/**
 * Vercel API Route: 커뮤니티 사진 프록시 (2026-07-30, P1-3)
 *   GET /api/community-image?p=<postId>&m=<mediaToken>
 *
 * 왜 프록시인가: 공개 피드가 Firebase Storage 다운로드 URL 을 그대로 내보내면 그 경로
 * (`community/{uid}/...`)에 작성자 Firebase uid 가 들어 있다. 응답에서 `authorUid` 를 지워도
 * 사진 한 장이면 uid 가 새는 것이다. 그래서 밖으로는 불투명 토큰만 주고, 실제 바이트는 서버가
 * 대신 받아 온다. **기존 파일을 옮기지 않는다** — 레거시 글도 같은 규칙으로 동작한다.
 *
 * 안전 장치
 *   - `status === 'active'` 인 글의 사진만 준다(숨김·삭제된 글의 사진은 404).
 *   - 원본 URL 은 저장된 값 중 토큰이 일치하는 것만 쓴다 → 임의 URL 주입(SSRF) 불가.
 *     저장된 값도 프로젝트 버킷의 `community/` 경로인지 다시 확인한다(레거시 문서 방어).
 *   - 이미지 MIME 만 통과시키고 크기 상한을 둔다.
 */
import { initAdminDb } from './_shared/firebase-admin.js';
import { resolveStoredImage, isFetchableCommunityImage } from './_shared/community-media.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

function firstQueryValue(v) {
  return Array.isArray(v) ? v[0] : v;
}

function fail(res, status, message) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    // 사진 URL 은 검색 결과에 뜰 이유가 없다.
    'X-Robots-Tag': 'noindex, nofollow',
  });
  return res.end(message);
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'Method Not Allowed');

  const query = req.query || {};
  const postId = String(firstQueryValue(query.p) || '').trim();
  const token = String(firstQueryValue(query.m) || '').trim();
  if (!postId || !/^[A-Za-z0-9_-]{1,128}$/.test(postId)) return fail(res, 404, 'Not found');
  if (!/^[a-f0-9]{32}$/.test(token)) return fail(res, 404, 'Not found');

  try {
    const db = initAdminDb('community-image');
    if (!db) return fail(res, 503, 'Storage unavailable');

    const doc = await db.collection('community_posts').doc(postId).get();
    if (!doc.exists) return fail(res, 404, 'Not found');
    const d = doc.data() || {};
    // 숨김·삭제된 글의 사진은 링크를 알아도 볼 수 없어야 한다.
    if (d.status !== 'active') return fail(res, 404, 'Not found');

    const storedUrl = resolveStoredImage(postId, d.images, token);
    if (!storedUrl) return fail(res, 404, 'Not found');
    if (!isFetchableCommunityImage(storedUrl)) return fail(res, 404, 'Not found');

    const upstream = await fetch(storedUrl);
    if (!upstream.ok) return fail(res, 404, 'Not found');

    const contentType = String(upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!ALLOWED_TYPES.has(contentType)) return fail(res, 404, 'Not found');

    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) return fail(res, 404, 'Not found');

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': String(buf.length),
      // 토큰은 (글, 파일) 쌍에 고정이라 내용이 바뀌지 않는다 → 오래 캐시해도 안전.
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Robots-Tag': 'noindex, nofollow',
      'X-Content-Type-Options': 'nosniff',
    });
    return res.end(req.method === 'HEAD' ? undefined : buf);
  } catch (err) {
    console.error('[community-image]', err);
    return fail(res, 500, 'Internal error');
  }
}
