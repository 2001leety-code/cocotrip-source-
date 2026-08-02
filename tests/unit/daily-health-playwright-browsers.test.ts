/**
 * daily-health 워크플로: Playwright 프로젝트와 설치 브라우저가 어긋나지 않게 잠근다. (2026-08-02)
 *
 * 잠근 사고: nav 스모크에 `--project='iPhone 14 Pro'` 를 추가했는데, 그 device 의 기본 엔진은
 *   **webkit** 이다(Pixel 5·Desktop Chrome 은 chromium). 워크플로는 chromium 만 설치하고
 *   있어서 iPhone 5건이 "Please run: npx playwright install" 로 통째로 실패했다.
 *   그런데 그 스텝은 `continue-on-error: true`(health-log 커밋을 살리려고) 라서
 *   **잡 결과는 초록인데 스모크만 빨간** 상태가 됐다 — 아무도 눈치채지 못한다.
 *
 * 그래서 "프로젝트를 늘렸으면 브라우저도 늘렸는가" 를 코드로 확인한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { devices } from 'playwright-core';

const WORKFLOW = resolve(process.cwd(), '.github/workflows/daily-health.yml');
const yml = readFileSync(WORKFLOW, 'utf8');

/** 워크플로에서 `--project='...'` 로 지정된 Playwright 프로젝트 이름 전부. */
function usedProjects(): string[] {
  return [...yml.matchAll(/--project=['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

/** `npx playwright install ...` 로 설치되는 브라우저 이름 전부. */
function installedBrowsers(): string[] {
  const found = new Set<string>();
  for (const m of yml.matchAll(/playwright install(?:-deps)?(?:\s+--with-deps)?([^\n]*)/g)) {
    for (const word of m[1].split(/\s+/)) {
      if (['chromium', 'webkit', 'firefox'].includes(word)) found.add(word);
    }
  }
  return [...found];
}

describe('daily-health — Playwright 프로젝트 ↔ 브라우저 설치 일치', () => {
  it('워크플로가 실제로 프로젝트를 지정해 돌린다', () => {
    expect(usedProjects().length).toBeGreaterThan(0);
  });

  it('쓰는 프로젝트의 엔진이 전부 설치 목록에 있다', () => {
    const installed = installedBrowsers();
    const missing: string[] = [];
    for (const name of new Set(usedProjects())) {
      // playwright.config.ts 의 프로젝트 이름 = devices 키와 동일하게 유지하고 있다.
      const device = (devices as Record<string, { defaultBrowserType?: string } | undefined>)[name];
      const engine = device?.defaultBrowserType || 'chromium';
      if (!installed.includes(engine)) missing.push(`${name} → ${engine}`);
    }
    expect(missing, `설치 안 된 엔진이 필요한 프로젝트: ${missing.join(', ')} (설치됨: ${installed.join(', ')})`)
      .toEqual([]);
  });

  it('캐시 key 가 설치 브라우저 조합을 반영한다 (안 그러면 옛 캐시가 hit 돼 새 브라우저가 영원히 없다)', () => {
    const installed = installedBrowsers().sort();
    const keyLine = yml.match(/key:\s*\$\{\{\s*runner\.os\s*\}\}-playwright-([a-z-]+)-/);
    expect(keyLine, 'Playwright 캐시 key 를 찾지 못했다').toBeTruthy();
    for (const browser of installed) {
      expect(keyLine![1], `캐시 key 에 ${browser} 가 없다`).toContain(browser);
    }
  });
});
