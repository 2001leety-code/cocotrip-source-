import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import type { BrowserContext, Route } from '@playwright/test';
import { expect, test } from './fixtures/analytics-guard';

async function listen(server: Server) {
  return new Promise<number>((resolvePort, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolvePort((server.address() as AddressInfo).port);
    });
  });
}

async function close(server: Server) {
  if (!server.listening) return;
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
}

async function loadProtectedManifest(context: BrowserContext, linkTag: string) {
  const state = { manifestRequests: 0, authenticatedRequests: 0, loginRedirects: 0, corsErrors: 0 };
  const authServer = createServer((_request, response) => {
    // Deliberately cross-origin, no Access-Control-Allow-Origin: emulate a protection login page.
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>Mock auth gateway</title>');
  });
  const authPort = await listen(authServer);
  const siteServer = createServer((request, response) => {
    if (request.url === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html><html><head>${linkTag}</head><body>manifest cookie test</body></html>`);
      return;
    }
    if (request.url === '/manifest.webmanifest') {
      state.manifestRequests++;
      if ((request.headers.cookie || '').split('; ').includes('pwa-auth=allowed')) {
        state.authenticatedRequests++;
        response.writeHead(200, { 'content-type': 'application/manifest+json' });
        response.end(JSON.stringify({ name: 'Mock PWA', start_url: '/', display: 'standalone' }));
        return;
      }
      state.loginRedirects++;
      response.writeHead(302, { location: `http://localhost:${authPort}/login` });
      response.end();
      return;
    }
    response.writeHead(404);
    response.end();
  });
  const sitePort = await listen(siteServer);
  const siteOrigin = `http://127.0.0.1:${sitePort}`;
  const authOrigin = `http://localhost:${authPort}`;
  const isolateRequest = async (route: Route) => {
    const requestOrigin = new URL(route.request().url()).origin;
    if (requestOrigin === siteOrigin || requestOrigin === authOrigin) await route.continue();
    else await route.abort();
  };
  await context.route('**/*', isolateRequest);
  const page = await context.newPage();
  try {
    await context.addCookies([{
      name: 'pwa-auth', value: 'allowed', domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax',
    }]);
    page.on('console', (message) => {
      if (message.type() === 'error' && /cors|cross-origin/i.test(message.text())) state.corsErrors++;
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Page.enable');
    await page.goto(`${siteOrigin}/`, { waitUntil: 'domcontentloaded' });
    await cdp.send('Page.getAppManifest');
    await expect.poll(() => state.manifestRequests, { timeout: 5000 }).toBe(1);
    await expect.poll(() => state.authenticatedRequests + state.loginRedirects, { timeout: 5000 }).toBe(1);
    await page.waitForTimeout(100);
    return state;
  } finally {
    await page.close();
    await context.unroute('**/*', isolateRequest);
    await Promise.all([close(siteServer), close(authServer)]);
  }
}

test('generated PWA manifest request sends the Preview cookie before following auth redirects', async ({ context }, testInfo) => {
  test.skip(testInfo.project.name !== 'Desktop Chrome', 'Check the Chromium manifest fetch once.');
  await context.routeWebSocket('**/*', (socket) => socket.close());
  // Run npm run build first: verify the actual generated HTML without reloading Vite config.
  const html = await readFile(resolve('dist/index.html'), 'utf8');
  const linkTag = html.match(/<link rel="manifest"[^>]*>/)?.[0];
  expect(linkTag).toBeTruthy();
  expect(linkTag).toContain('crossorigin="use-credentials"');

  const withoutCredentials = await loadProtectedManifest(context, linkTag!.replace(' crossorigin="use-credentials"', ''));
  expect(withoutCredentials).toMatchObject({ manifestRequests: 1, authenticatedRequests: 0, loginRedirects: 1, corsErrors: 1 });

  const withCredentials = await loadProtectedManifest(context, linkTag!);
  expect(withCredentials).toMatchObject({ manifestRequests: 1, authenticatedRequests: 1, loginRedirects: 0, corsErrors: 0 });
});
