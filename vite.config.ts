import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  plugins: [react()],
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
