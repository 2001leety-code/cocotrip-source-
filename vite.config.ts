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
        // P235 참고: cleanupOutdatedCaches 는 injectManifest 모드에서
        // vite.config 에 넣을 수 없음 — workbox-build 스키마 미지원.
        // 대신 src/sw.ts activate handler 에서 cleanupOutdatedCaches() 직접 호출.
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
        // 2026-06-02: eager 엔트리 청크만 entry-* 로 리네임. size-limit "Main bundle" glob(dist/assets/index-*.js)
        //   이 lazy index-* 청크(PlanDetailPage/index.tsx · PlannerPage/index.tsx · WizardForm/index.tsx — 전부
        //   folder/index 컨벤션이라 index-[hash].js 로 명명)까지 합산해 first-paint 를 ~2배 과대측정하던 버그 해소.
        //   엔트리(=HTML 참조 청크)만 entryFileNames 대상이고 import() async 청크는 chunkFileNames(Vite 기본 유지)
        //   라, 이 한 줄로 entry-* 만 분리됨. .size-limit.json "Main bundle" path 도 entry-* 로 변경.
        entryFileNames: 'assets/entry-[hash].js',
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
