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
import { readFileSync, readdirSync } from 'node:fs';
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

  // 2026-10-23: GitHub ubuntu-latest 가 2026-10-12 부터 ubuntu-26.04 로 바뀌었다. 캐시된 webkit(24.04 빌드)이
  //   libicudata.so.74 를 못 찾아 nav 스모크가 통째로 실패 — 캐시 key(runner.os = Linux)는 OS 버전을 구분하지 못한다.
  //   그래서 webkit 을 쓰는 워크플로는 runs-on 을 **고정 버전**으로 둔다.
  it('webkit 을 쓰는 워크플로는 runs-on 이 고정 버전이다 (ubuntu-latest 금지)', () => {
    const dir = resolve(process.cwd(), '.github/workflows');
    const offenders: string[] = [];
    let webkitWorkflows = 0;
    for (const name of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
      const text = readFileSync(resolve(dir, name), 'utf8');
      if (!/\bwebkit\b/.test(text)) continue;
      webkitWorkflows += 1;
      for (const m of text.matchAll(/^\s*runs-on:\s*(\S+)/gm)) {
        if (!/^ubuntu-\d{2}\.\d{2}$/.test(m[1])) offenders.push(`${name}: runs-on ${m[1]}`);
      }
    }
    expect(webkitWorkflows).toBeGreaterThanOrEqual(4);
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('캐시 key 가 설치 브라우저 조합을 반영한다 (안 그러면 옛 캐시가 hit 돼 새 브라우저가 영원히 없다)', () => {
    const installed = installedBrowsers().sort();
    const keyLine = yml.match(/key:\s*\$\{\{\s*runner\.os\s*\}\}-(?:ubuntu-\d{2}\.\d{2}-)?playwright-([a-z-]+)-/);
    expect(keyLine, 'Playwright 캐시 key 를 찾지 못했다').toBeTruthy();
    for (const browser of installed) {
      expect(keyLine![1], `캐시 key 에 ${browser} 가 없다`).toContain(browser);
    }
  });

  // 2026-10-23: playwright-cache-prime 이 만든 캐시를 daily-health·i18n 워크플로가 **그대로** 써야 한다 —
  //   키 형식이 달라(…-playwright-<hash> vs …-playwright-chromium-webkit-<hash>) prime 이 무의미했고,
  //   runner.os(=Linux) 만으로는 OS 버전이 구분되지 않아 26.04 러너가 24.04 빌드 webkit 을 받았다.
  const PINNED = ['daily-health', 'playwright-cache-prime', 'pr-i18n-smoke', 'weekly-i18n-audit'];
  const EXPECTED_KEY = "${{ runner.os }}-ubuntu-24.04-playwright-chromium-webkit-${{ hashFiles('**/package-lock.json') }}";
  const EXPECTED_RESTORE = '${{ runner.os }}-ubuntu-24.04-playwright-chromium-webkit-';
  for (const name of PINNED) {
    it(`${name}: runs-on ubuntu-24.04 · same Playwright cache key/restore-keys · webkit install step`, () => {
      const text = readFileSync(resolve(process.cwd(), `.github/workflows/${name}.yml`), 'utf8');
      const runsOn = [...text.matchAll(/^\s*runs-on:\s*(\S+)/gm)].map((m) => m[1]);
      expect(runsOn.length).toBeGreaterThan(0);
      for (const r of runsOn) expect(r).toBe('ubuntu-24.04');
      const keys = [...text.matchAll(/^\s*key:\s*(\S.*)$/gm)].map((m) => m[1].trim());
      expect(keys).toContain(EXPECTED_KEY);
      expect(text).toMatch(/restore-keys:\s*\|\s*\r?\n\s*(\S.*)/);
      const restore = (text.match(/restore-keys:\s*\|\s*\r?\n\s*(\S.*)/) as RegExpMatchArray)[1].trim();
      expect(restore).toBe(EXPECTED_RESTORE);
      expect(text).toMatch(/npx playwright install[^\n]*\bwebkit\b/);
    });
  }

  // 2026-10-23: webkit 을 안 쓰는 워크플로도 ubuntu-latest(26.04) 에서 Playwright chromium 설치가
  //   7분 타임아웃·exit 100 으로 실패했다(#1448 visual). chromium 전용이라 webkit 설치 단언은 해당 없음.
  for (const name of ['pr-visual-regression']) {
    it(`${name}: runs-on ubuntu-24.04 (chromium only)`, () => {
      const text = readFileSync(resolve(process.cwd(), `.github/workflows/${name}.yml`), 'utf8');
      const runsOn = [...text.matchAll(/^\s*runs-on:\s*(\S+)/gm)].map((m) => m[1]);
      expect(runsOn.length).toBeGreaterThan(0);
      for (const r of runsOn) expect(r).toBe('ubuntu-24.04');
      expect(text).toMatch(/npx playwright install[^\n]*\bchromium\b/);
    });
  }
});
