/**
 * Vercel API Route: 존재하지 않는 경로의 **진짜 404** (2026-07-30, P1-4).
 *
 * 🔴 고친 문제: `vercel.json` 의 SPA 폴백이 `/((?!api/).*)` 를 전부 `index.html` 로 보내고 있었다.
 *   그래서 오타 URL·삭제된 링크·봇이 찍는 아무 경로가 전부 **HTTP 200 + 홈 HTML** 이었다.
 *   원문에는 `robots: index, follow` 와 `canonical: /` 가 박혀 있으니, 검색엔진 입장에서는
 *   "존재하는 페이지가 무한히 많고 전부 홈과 같은 내용" 으로 보였다(soft 404 + 중복 색인).
 *
 * 지금은 `vercel.json` 이 **알려진 SPA 라우트만** index.html 로 보내고, 나머지는 여기로 온다.
 * 여기서 하는 일은 하나뿐이다 — 상태코드 404 와 noindex 를 붙여 정직하게 응답한다.
 *
 * 왜 정적 404.html 이 아닌가: 정적 파일은 rewrite 로 보내면 200 이 된다. 상태코드를 우리가
 * 정할 수 있는 곳은 함수뿐이다. (`routes` 의 `status: 404` 는 `rewrites`/`headers` 와 함께 쓸 수 없다.)
 *
 * ⚠️ SPA 내부 이동은 영향이 없다 — 클라이언트 라우터가 처리하므로 서버 요청이 나가지 않는다.
 *    주소창 직접 입력·새로고침·크롤러만 이 응답을 받는다.
 */
export const config = { runtime: 'nodejs' };

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>404 — Page not found | CocoTrip</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:#0B1020; color:#fff; font-family:system-ui,-apple-system,"Segoe UI",sans-serif; }
  main { text-align:center; padding:24px; max-width:32rem; }
  h1 { font-size:1.375rem; margin:0 0 .5rem; }
  p { color:rgba(255,255,255,.65); font-size:.875rem; line-height:1.6; margin:0 0 1.25rem; }
  a { display:inline-block; padding:12px 22px; border-radius:12px; color:#fff; text-decoration:none;
      font-weight:600; font-size:.875rem; background:linear-gradient(135deg,#7C5CFC,#EA537E); }
</style>
</head>
<body>
<main>
  <h1>404 — Page not found</h1>
  <p>이 주소에는 페이지가 없습니다. / The page you requested does not exist.</p>
  <a href="/">CocoTrip 홈으로 · Go to homepage</a>
</main>
</body>
</html>
`;

export default function handler(req, res) {
  res.writeHead(404, {
    'Content-Type': 'text/html; charset=utf-8',
    'X-Robots-Tag': 'noindex, nofollow',
    // 404 는 잠깐만 캐시한다 — 나중에 진짜 페이지가 생겼을 때 오래 남지 않게.
    'Cache-Control': 'public, max-age=0, must-revalidate',
  });
  res.end(req.method === 'HEAD' ? undefined : HTML);
}
