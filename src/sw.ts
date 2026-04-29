/// <reference lib="WebWorker" />
// Custom Service Worker — VitePWA injectManifest 모드.
// 1) Workbox precache + runtime caching (기존 generateSW workbox 옵션 이전)
// 2) push 이벤트 핸들러 — _send-push.js 발송 payload {title,body,url,tag,icon} 표시
// 3) notificationclick — 클릭 시 url로 focus/open
// 빌드 시 self.__WB_MANIFEST 가 precache 매니페스트로 치환됨.
import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

precacheAndRoute(self.__WB_MANIFEST || []);

registerRoute(
  ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
  new CacheFirst({
    cacheName: 'google-fonts',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 }),
    ],
  })
);

registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  new NetworkFirst({
    cacheName: 'api-runtime',
    networkTimeoutSeconds: 5,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 60 * 5 }),
    ],
  })
);

registerRoute(
  ({ request }) => request.destination === 'image',
  new StaleWhileRevalidate({
    cacheName: 'images',
    plugins: [
      new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 }),
    ],
  })
);

// ───── Web Push ─────
interface PushPayload {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
  icon?: string;
  badge?: string;
}

self.addEventListener('push', (event: PushEvent) => {
  let payload: PushPayload = {};
  try {
    if (event.data) payload = event.data.json() as PushPayload;
  } catch {
    payload = { title: 'CocoTrip', body: event.data?.text() || '' };
  }
  const title = payload.title || 'CocoTrip';
  const options: NotificationOptions = {
    body: payload.body || '',
    icon: payload.icon || '/icons/icon-192.png',
    badge: payload.badge || '/icons/icon-192.png',
    tag: payload.tag,
    data: { url: payload.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const target = (event.notification.data && (event.notification.data as { url?: string }).url) || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      if ('focus' in client) {
        try {
          await (client as WindowClient).focus();
          if ('navigate' in client) await (client as WindowClient).navigate(target);
          return;
        } catch { /* fall through to openWindow */ }
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});

// VitePWA autoUpdate가 등록 후 즉시 활성화 — generateSW 기본 동작과 동일.
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });
