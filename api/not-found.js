import {
  renderNotFoundHtml,
  resolveNotFoundRequestLanguage,
} from '../src/lib/notFoundEditorial.js';

export const config = { runtime: 'nodejs' };

export default function handler(req, res) {
  const language = resolveNotFoundRequestLanguage(req);
  const html = renderNotFoundHtml(language);

  res.writeHead(404, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Language': language,
    'X-Robots-Tag': 'noindex, nofollow',
    'Cache-Control': 'public, max-age=0, must-revalidate',
    Vary: 'Accept-Language',
  });
  res.end(req.method === 'HEAD' ? undefined : html);
}
