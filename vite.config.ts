import path from "path"
import fs from "node:fs"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { VitePWA } from "vite-plugin-pwa"
import prerender from "@prerenderer/rollup-plugin"

// 프리렌더(빌드후 SSG) 대상 라우트 — public.sitemap.xml 과 동기(/charter=로그인벽 제외).
// 투어/지역 추가 시 갱신. PRERENDER=1 빌드에서만 사용.
const PRERENDER_ROUTES = [
  '/', '/tours', '/planner', '/about', '/terms', '/privacy', '/travel-terms',
  '/tours/seoul-city-full-day', '/tours/seoul-night-tour', '/tours/danyang-day-tour',
  '/tours/incheon-ganghwa-tour', '/tours/dmz-paju-tour', '/tours/nami-island-chuncheon',
  '/tours/gyeongju-day-tour', '/tours/busan-day-tour', '/tours/korea-multicity-3d2n',
  '/region/seoul', '/region/chuncheon', '/region/paju', '/region/ganghwa', '/region/busan',
  '/region/danyang', '/region/incheon', '/region/gyeongju', '/region/jeonju',
];

// Vercel 빌드 시 @sparticuz/chromium 경로 resolve (PRERENDER=1 한정). 로컬은 PUPPETEER_EXECUTABLE_PATH env.
// 이걸로 운영자는 Vercel env PRERENDER=1 만 켜면 활성화(executablePath 수동 불필요).
let PRERENDER_EXEC_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
let PRERENDER_LAUNCH_ARGS = ['--no-sandbox', '--disable-setuid-sandbox'];
if (process.env.PRERENDER === '1' && !PRERENDER_EXEC_PATH && process.env.VERCEL) {
  const chromium = (await import('@sparticuz/chromium')).default;
  PRERENDER_EXEC_PATH = await chromium.executablePath();
  PRERENDER_LAUNCH_ARGS = chromium.args;
}

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  // DEV-only: /api 를 prod 로 프록시 — 로그인 뒤 화면(MOOD 포털 등)을 dev 에서 실데이터로
  // 검증하기 위한 하네스 (verify-web). same-origin 이라 CORS 무관. prod 빌드에 영향 없음.
  server: {
    proxy: { '/api': { target: 'https://cocotripkr.com', changeOrigin: true } },
  },
  plugins: [
    react(),
    // DEV-only (로컬 플랜 하네스): scripts/plan-local/outputs/plan-<scenario>.json 을
    //   /local-plans/<scenario>.json 으로 서빙 → PlanDetailPage ?localPlan=<scenario> 가 fetch 해 렌더.
    //   apply:'serve' = dev 서버 전용 (prod 빌드/번들 무관). `npm run plan:test -- <scenario>` 후 사용.
    {
      name: 'local-plan-server',
      apply: 'serve',
      configureServer(server) {
        server.middlewares.use('/local-plans', (req, res, next) => {
          let name = (req.url || '').slice(1).split('?')[0];
          if (name.endsWith('.json')) name = name.slice(0, -5);
          if (!/^[a-z0-9-]+$/i.test(name)) return next();
          const file = path.resolve(__dirname, 'scripts/plan-local/outputs', `plan-${name}.json`);
          if (!fs.existsSync(file)) return next();
          res.setHeader('Content-Type', 'application/json');
          res.end(fs.readFileSync(file));
        });
      },
    },
    // PWA — 홈 화면에 추가 + 오프라인 캐싱 + 자동 업데이트.
    // 기존 public/sw.js + index.html 수동 등록 코드 대체.
    VitePWA({
      // #pwa-prompt (2026-06-05): autoUpdate→prompt — 배포-중-세션 강제 리로드 방지.
      // autoUpdate 는 새 SW 를 즉시 활성화(skipWaiting)하며 옛 청크를 cleanup → 위저드 작성 중
      // 다음 스텝 청크가 stale → 강제 리로드 + 복구모달(운영자 #4 신고). prompt = 새 SW 대기 +
      // PWAUpdatePrompt 토스트로 사용자가 직접 [새로고침] 선택 (/my-plans 는 즉시 강제 최신 유지).
      registerType: 'prompt',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      includeAssets: [
        'favicon.png',
        'icons/icon-192.png',
        'icons/icon-512.png',
        'images/pwa-intro/cocotrip-intro.webp',
        'images/pwa-intro/mood-collab-intro.webp',
        'images/pwa-intro/cocotrip-intro.png',
        'images/pwa-intro/mood-collab-intro.png',
      ],
      // 기존 public/manifest.json 의 내용을 그대로 옮김. Vite가 빌드 시 자동 생성.
      manifest: {
        // id 명시 (2026-07-05): MOOD(/mood) PWA 와 별개 앱 구분용. id 없으면 크롬이
        // 같은 origin 의 설치된 앱과 동일시해 MOOD 설치 시 "이미 설치됨"으로 거부.
        // "/" = 기존 설치본의 computed id(start_url) 와 동일 → 기존 설치 identity 불변.
        id: '/',
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
          // 2026-07-25: AdobeStock_*.webp 8장은 참조 0 으로 삭제됨 → 제외 규칙도 함께 제거.
          //   (규칙만 남으면 "이 자산 쓰는 중" 이라는 착시가 생긴다)
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
    // 프리렌더(빌드후 SSG) — PRERENDER=1 일 때만 (OFF 기본 = prod 빌드 무변).
    // 무JS 크롤러(Naver/카톡/AI엔진) 빈 본문 fix. 26 라우트를 puppeteer 로 렌더 후 정적 HTML.
    // executablePath=PUPPETEER_EXECUTABLE_PATH env (로컬=Chrome / Vercel=@sparticuz/chromium).
    ...(process.env.PRERENDER === '1' ? [prerender({
      routes: PRERENDER_ROUTES,
      renderer: '@prerenderer/renderer-puppeteer',
      rendererOptions: {
        renderAfterDocumentEvent: 'prerender-ready',
        maxConcurrentRoutes: 2,
        timeout: 60000,
        headless: true,
        launchOptions: {
          headless: true,
          executablePath: PRERENDER_EXEC_PATH,
          args: PRERENDER_LAUNCH_ARGS,
        },
      },
    })] : []),
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
          // 2026-06-02: 어드민 회계 엑셀 내보내기 전용 (write-excel-file). 동적 import 라 lazy 유지되며,
          //   안정적 청크명(write-excel-file-*)으로 size-limit 가드 부착. 기본 명명은 'browser-*'(범용)이라 변경.
          if (id.includes('node_modules/write-excel-file')) return 'write-excel-file';
          return undefined;
        },
      },
    },
  },
});
