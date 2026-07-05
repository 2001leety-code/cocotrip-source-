/**
 * PWA manifest id 잠금 (2026-07-05) — MOOD 별개 앱 설치 회귀 방지.
 *
 * id 없으면 크롬이 같은 origin 의 설치된 코코트립 앱과 동일시해
 * MOOD 설치 시 "이미 설치됨"으로 거부(운영자 실기기 재현). id 로 구분.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('PWA manifest id (MOOD 별개 앱 구분)', () => {
  it('manifest-mood.webmanifest — id=/mood, scope/start_url 유지', () => {
    const m = JSON.parse(readFileSync(resolve(__dirname, '../../public/manifest-mood.webmanifest'), 'utf8'));
    expect(m.id).toBe('/mood');
    expect(m.start_url).toBe('/mood');
    expect(m.scope).toBe('/mood');
    expect(m.name).toBe('MOOD');
  });

  it('메인 manifest(vite.config) — id "/" 명시 (기존 설치 identity 불변)', () => {
    const src = readFileSync(resolve(__dirname, '../../vite.config.ts'), 'utf8');
    expect(src).toMatch(/manifest:\s*\{[\s\S]{0,400}id:\s*'\/'/);
  });
});
