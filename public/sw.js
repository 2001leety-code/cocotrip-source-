/* CocoTrip Service Worker — Offline caching + App shell + Push notifications */
const CACHE_NAME = 'cocotrip-v2';  // bumped for push listener rollout
const PRECACHE = [
  '/',
  '/index.html',
];

// Install — cache app shell
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — Network first, fallback to cache
self.addEventListener('fetch', (e) => {
  // Skip non-GET and API calls
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('/api/')) return;
  if (e.request.url.includes('firestore')) return;
  if (e.request.url.includes('googleapis')) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        // Cache successful responses
        if (res.ok && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('/')))
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Push notifications (Web Push protocol).
// 백엔드(api/_send-push.js)가 보낸 데이터를 OS 알림으로 표시.
// payload 형식: { title, body, url, icon?, tag? }
// ─────────────────────────────────────────────────────────────────────────────
self.addEventListener('push', (e) => {
  if (!e.data) return;
  let data = {};
  try { data = e.data.json(); } catch (_) { data = { title: 'CocoTrip', body: e.data.text() }; }
  const title = data.title || 'CocoTrip';
  const opts = {
    body: data.body || '',
    icon: data.icon || '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || 'cocotrip-default',  // 같은 tag면 기존 알림 대체
    data: { url: data.url || '/' },
    requireInteraction: false,
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

// 알림 클릭 → 해당 URL의 기존 탭이 있으면 포커스, 없으면 새 탭으로 오픈
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = e.notification.data?.url || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.includes(target) && 'focus' in w) return w.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
