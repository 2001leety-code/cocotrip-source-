import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    // Component tests (.test.tsx) override env via `// @vitest-environment jsdom` 헤더.
    // Pure function tests stay on node for speed.
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    setupFiles: ['./tests/unit/setup.ts'],
    // 전역 timeout SSOT — 계약 테스트: tests/unit/vitest-timeout-contract.test.ts
    // 왜 기본 5000ms 로는 부족한가: 548개 파일을 fork 로 병렬 실행하면 파일의 첫
    // 테스트가 무거운 모듈 그래프를 cold import 하는 시간이 그 테스트 예산에
    // 그대로 잡힌다. 직접 `await import()` 뿐 아니라 간접 lazy import 도 같다
    // (예: executeRemediation → `await import('firebase-admin/firestore')`).
    // 실측(이 스위트, 12코어): 한산 3.6s / 스위트 2개 동시 경합 8.2s.
    // 15000 = 실측 최악치의 약 1.8배. 더 올리지 않는 이유 — 영원히 pending 인
    // 진짜 멈춘 테스트도 이 값만큼 기다린 뒤에야 실패하므로, 실제 네트워크를
    // 타는 테스트가 인라인으로 쓰는 30000 아래를 상한으로 유지한다.
    testTimeout: 15000,
    // 훅 안에서도 같은 cold import 가 일어난다(admin-auth-cold-start-pr441 등
    // 7개 파일이 beforeAll/beforeEach 에서 동적 import). 기본 10000 은 실측
    // 최악치 8.2s 대비 여유가 1.2배뿐이라 testTimeout 과 같은 값으로 맞춘다.
    hookTimeout: 15000,
    coverage: {
      provider: 'v8',
      // Scope coverage to backend helpers + schemas — frontend components are
      // covered by Playwright e2e (tests/e2e/), not vitest. Adding more files
      // here without tests would just lower the score and force noisy thresholds.
      include: [
        'src/schemas/**',
        'api/_shared/log.js',
        'api/_shared/paypal.js',
        'api/_shared/response.js',
        'api/_shared/admin-auth.js',
        'api/_shared/firebase-admin.js',
      ],
      exclude: ['**/*.test.ts', '**/*.d.ts'],
      reporter: ['text', 'json-summary'],
      thresholds: {
        // Per-file thresholds — every covered file must hold its own line.
        // Functions threshold is 65 not 70 because `text().catch(() => '')`
        // arrow fallback in paypal.js is hard to exercise (would need
        // text() that rejects, which fetch-mock doesn't naturally produce).
        // Raise as we add tests for firebase-admin.initAdminDb, admin-auth, etc.
        perFile: true,
        lines: 75,
        functions: 65,
        branches: 60,
        statements: 75,
      },
    },
  },
});
