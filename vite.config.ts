import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { VitePWA } from "vite-plugin-pwa"

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  plugins: [
    react(),
    // PWA — 홈 화면에 추가 + 오프라인 캐싱 + 자동 업데이트.
    // 기존 public/sw.js + index.html 수동 등록 코드 대체.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'icons/icon-192.png', 'icons/icon-512.png'],
      // 기존 public/manifest.json 의 내용을 그대로 옮김. Vite가 빌드 시 자동 생성.
      manifest: {
        name: 'CocoTrip',
        short_name: 'CocoTrip',
        description: 'Premium Korea Travel — AI Planner & Private Charter',
        start_url: '/',
        display: 'standalone',
        background_color: '#0a0b14',
        theme_color: '#B668FC',
        orientation: 'portrait',
        scope: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
        categories: ['travel', 'tourism'],
        lang: 'en',
        dir: 'ltr',
      },
      workbox: {
        // 빌드 시 precache 대상 — 글로벌 자산 (HTML/JS/CSS + 작은 아이콘).
        // 큰 이미지(.webp/.jpg/.png 본문)는 precache 제외, runtime caching으로 처리.
        globPatterns: ['**/*.{js,css,html,ico,svg}', 'icons/*.png', 'favicon.png'],
        globIgnores: [
          '**/og-image-original-backup.png',  // 20MB 백업 파일 — 절대 precache 금지
          '**/AdobeStock_*.webp',             // 큰 hero/landing 이미지들 (4-5MB)
          '**/Type1_*.jpg',                   // 한국관광공사 hi-res
          '**/hero-*.webp',                   // 4MB hero 이미지
          '**/[가-힣]*.webp',                  // 한글 이름 큰 이미지
        ],
        // 위 패턴 빠진 큰 자산은 무시
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        runtimeCaching: [
          {
            // Google Fonts — CSS는 자주 안 바뀜 + 폰트 파일은 immutable hash → CacheFirst 1년
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // /api/* — NetworkFirst, 5초 timeout 후 캐시 fallback (오프라인 안전망)
            urlPattern: /\/api\/.*/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-runtime',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 5 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // 이미지 (webp/jpg/png) — StaleWhileRevalidate (즉시 표시 + 백그라운드 업데이트)
            urlPattern: /\.(?:png|jpg|jpeg|webp|svg)$/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'images',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
      devOptions: {
        enabled: false, // dev 모드에서 SW 비활성 (HMR 충돌 방지)
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // 모바일 첫 로드 속도 최적화 — vendor를 작은 단위로 쪼개 병렬 다운로드.
        // 라우트별 lazy chunk와 함께 캐싱 효율 향상 (firebase 업데이트 시 react는 캐시 hit).
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-firebase-core': ['firebase/app', 'firebase/auth'],
          'vendor-firebase-firestore': ['firebase/firestore'], // 가장 무거움 → 분리
          'vendor-firebase-storage': ['firebase/storage'],
          'vendor-icons': ['lucide-react'],          // ~60KB gz, 자주 안 바뀜
          'vendor-motion': ['framer-motion'],        // ~70KB gz, 페이지 전환에 필수
          'vendor-pdf': ['html2canvas'],             // 결제 후 PDF 페이지에서만 필요
          'vendor-sonner': ['sonner'],
        },
      },
    },
  },
});
