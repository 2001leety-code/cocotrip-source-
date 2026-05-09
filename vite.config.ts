import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { VitePWA } from "vite-plugin-pwa"
import { visualizer } from "rollup-plugin-visualizer"

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  plugins: [
    react(),
    // 2026-05-10 Bundle analyzer — `npm run build` 시 dist/stats.html 자동 생성.
    // dist/ 자체가 .gitignore 라 repo 오염 X. Main bundle 의존성 트리 시각화 →
    // 정확한 lazy-split 후보 식별 (post-launch 작업 데이터 인프라).
    visualizer({
      filename: 'dist/stats.html',
      template: 'treemap',
      gzipSize: true,
      brotliSize: false,
    }),
    // PWA — 홈 화면에 추가 + 오프라인 캐싱 + 자동 업데이트.
    // 기존 public/sw.js + index.html 수동 등록 코드 대체.
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
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
      injectManifest: {
        // src/sw.ts 가 self.__WB_MANIFEST 로 받을 precache 대상.
        // 큰 이미지(.webp/.jpg/.png 본문)는 precache 제외, runtime caching으로 처리.
        globPatterns: ['**/*.{js,css,html,ico,svg}', 'icons/*.png', 'favicon.png'],
        globIgnores: [
          '**/og-image-original-backup.png',  // 20MB 백업 파일 — 절대 precache 금지
          '**/AdobeStock_*.webp',
          '**/Type1_*.jpg',
          '**/hero-*.webp',
          '**/[가-힣]*.webp',
        ],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
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
        // 2026-05-06: i18n locale chunk 파일명 명시화 (i18n-ko / i18n-ja / i18n-zh) —
        // 디버깅 용이성 + CDN 모니터링.
        manualChunks(id) {
          if (id.includes('src/i18n/locales/ko.json')) return 'i18n-ko';
          if (id.includes('src/i18n/locales/ja.json')) return 'i18n-ja';
          if (id.includes('src/i18n/locales/zh.json')) return 'i18n-zh';
          if (id.includes('node_modules/react-router-dom')) return 'vendor-react';
          if (id.includes('node_modules/react-dom')) return 'vendor-react';
          if (/node_modules\/react\//.test(id) || /node_modules\/react$/.test(id)) return 'vendor-react';
          if (id.includes('node_modules/firebase/firestore')) return 'vendor-firebase-firestore';
          if (id.includes('node_modules/firebase/storage')) return 'vendor-firebase-storage';
          if (id.includes('node_modules/firebase/app') || id.includes('node_modules/firebase/auth')) return 'vendor-firebase-core';
          if (id.includes('node_modules/lucide-react')) return 'vendor-icons';
          if (id.includes('node_modules/framer-motion')) return 'vendor-motion';
          if (id.includes('node_modules/html2canvas')) return 'vendor-pdf';
          if (id.includes('node_modules/sonner')) return 'vendor-sonner';
          return undefined;
        },
      },
    },
  },
});
