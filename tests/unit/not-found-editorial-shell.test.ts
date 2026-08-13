import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import handler from '../../api/not-found.js';

type MockRequest = {
  method: string;
  query?: Record<string, string | string[]>;
  headers?: Record<string, string>;
};

type MockResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
  writeHead: (status: number, headers: Record<string, string>) => void;
  end: (body?: string) => void;
};

const EXPECTED = {
  en: 'Page not found',
  ko: '페이지를 찾을 수 없습니다',
  ja: 'ページが見つかりません',
  zh: '页面未找到',
} as const;

function invoke(request: MockRequest) {
  const response: MockResponse = {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers) {
      response.status = status;
      response.headers = headers;
    },
    end(body = '') {
      response.body = body;
    },
  };

  handler(request, response);
  return response;
}

describe('standalone editorial 404 response', () => {
  it.each(Object.entries(EXPECTED))('renders %s without changing the real 404 contract', (language, title) => {
    const response = invoke({ method: 'GET', query: { lang: language } });

    expect(response.status).toBe(404);
    expect(response.headers['Content-Type']).toBe('text/html; charset=utf-8');
    expect(response.headers['Content-Language']).toBe(language);
    expect(response.headers['X-Robots-Tag']).toBe('noindex, nofollow');
    expect(response.headers.Vary).toBe('Accept-Language');
    expect(response.body).toContain(`<html lang="${language}">`);
    expect(response.body).toContain(title);
    expect(response.body).toContain('data-testid="not-found-server"');
    expect(response.body.match(/data-recovery-link/g)).toHaveLength(3);
    expect(response.body.match(/data-language-link/g)).toHaveLength(4);
    expect(response.body).not.toMatch(/gradient|backdrop-filter|filter:\s*blur/i);
  });

  it('uses browser language only for supported automatic locales', () => {
    expect(invoke({ method: 'GET', headers: { 'accept-language': 'ja-JP,ja;q=0.9' } }).body)
      .toContain(EXPECTED.ja);
    expect(invoke({ method: 'GET', headers: { 'accept-language': 'zh-CN,zh;q=0.9' } }).body)
      .toContain(EXPECTED.zh);
    expect(invoke({ method: 'GET', headers: { 'accept-language': 'ko-KR,ko;q=0.9' } }).body)
      .toContain(EXPECTED.en);
  });

  it('returns no body for HEAD while keeping 404 and noindex headers', () => {
    const response = invoke({ method: 'HEAD', query: { lang: 'ko' } });

    expect(response.status).toBe(404);
    expect(response.headers['X-Robots-Tag']).toBe('noindex, nofollow');
    expect(response.body).toBe('');
  });
});

describe('server and app share one 404 design contract', () => {
  const apiSource = readFileSync(resolve(process.cwd(), 'api/not-found.js'), 'utf8');
  const pageSource = readFileSync(resolve(process.cwd(), 'src/pages/NotFoundPage.tsx'), 'utf8');
  const sharedPath = resolve(process.cwd(), 'src/lib/notFoundEditorial.js');
  const sharedSource = existsSync(sharedPath) ? readFileSync(sharedPath, 'utf8') : '';

  it('keeps copy, markup and route-scoped CSS in one shared module', () => {
    expect(existsSync(sharedPath)).toBe(true);
    expect(apiSource).toMatch(/from ['"]\.\.\/src\/lib\/notFoundEditorial\.js['"]/);
    expect(pageSource).toMatch(/from ['"]@\/lib\/notFoundEditorial\.js['"]/);
    expect(sharedSource).toContain('NOT_FOUND_COPY');
    expect(sharedSource).toContain('NOT_FOUND_EDITORIAL_CSS');
    expect(sharedSource).toContain('renderNotFoundHtml');
  });

  it('uses paper, ink and hairlines without forbidden visual effects', () => {
    expect(sharedSource).not.toMatch(/linear-gradient|radial-gradient|backdrop-filter|filter:\s*blur/i);
    expect(sharedSource).not.toContain('?' + '?');
    expect(sharedSource).toContain('@media (prefers-reduced-motion: reduce)');
    expect(sharedSource).toContain('min-height: 44px');
    expect(sharedSource).toContain(':focus-visible');
  });

  it('keeps the high-contrast focus treatment above the refined app shell', () => {
    expect(sharedSource).toMatch(
      /\.refined \.not-found-editorial :where\(a, button\):focus-visible \{\s*outline: 3px solid #14141A;\s*outline-offset: 3px;\s*box-shadow: none;\s*\}/,
    );
    expect(sharedSource.match(/\.refined[^{]*\{/g)).toEqual([
      '.refined .not-found-editorial :where(a, button):focus-visible {',
    ]);
  });
});
