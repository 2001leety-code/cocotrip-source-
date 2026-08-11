/**
 * PWA manifest description — truth-in-metadata contract.
 *
 * vite.config.ts 의 manifest.description 이 "AI Planner" 류 문구로 되돌아가면
 * 안 된다 (사실 아닌 것을 표기하지 않는다는 원칙). 소스 문자열 + 빌드 산출물
 * (dist/manifest.webmanifest) 양쪽을 잠근다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const EXPECTED_DESCRIPTION =
  'Korea itineraries built from real local routes and private charter vehicles.';

const FORBIDDEN_PATTERNS = [/\bAI\b/, /\bAI-powered\b/i, /\bAI-curated\b/i, /\bPremium\b/, /Trip Planner/i];

describe('PWA manifest description', () => {
  it('vite.config.ts manifest.description = 정확히 지정된 문구, 금지어 없음', () => {
    const src = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8');
    const match = src.match(/description:\s*'([^']*)'/);
    expect(match, 'manifest.description 필드를 vite.config.ts 에서 못 찾음').toBeTruthy();
    const description = match![1];
    expect(description).toBe(EXPECTED_DESCRIPTION);
    for (const pattern of FORBIDDEN_PATTERNS) {
      expect(description).not.toMatch(pattern);
    }
  });

  const distManifestPath = resolve(process.cwd(), 'dist/manifest.webmanifest');
  const distExists = existsSync(distManifestPath);

  it.skipIf(!distExists)(
    'dist/manifest.webmanifest — description 일치 + 금지어 없음 + 필수 필드 보존 (npm run build 후)',
    () => {
      const manifest = JSON.parse(readFileSync(distManifestPath, 'utf8'));
      expect(manifest.description).toBe(EXPECTED_DESCRIPTION);
      for (const pattern of FORBIDDEN_PATTERNS) {
        expect(manifest.description).not.toMatch(pattern);
      }
      expect(manifest.name).toBe('CocoTrip');
      expect(manifest.short_name).toBe('CocoTrip');
      expect(manifest.start_url).toBe('/');
      expect(manifest.display).toBe('standalone');
      expect(Array.isArray(manifest.icons) && manifest.icons.length).toBeGreaterThan(0);
      expect(manifest.theme_color).toBe('#B668FC');
      expect(manifest.background_color).toBe('#0a0b14');
    },
  );

  if (!distExists) {
    // ponytail: dist 없으면 위 테스트 skip — npm run build 후 재실행해 산출물 단언 필요.
    it('dist/manifest.webmanifest 없음 — build 후 재검증 필요 (정보용, 실패 아님)', () => {
      expect(distExists).toBe(false);
    });
  }
});
