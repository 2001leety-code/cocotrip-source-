// 2026-11-24: 서비스워커 사전 저장(precache)이 굽기 라우트 HTML 46개 + 디자인 시안(압축 전 약 4.4MB)을 전 손님에게 받게 했다.
// src/sw.ts 의 precacheAndRoute 는 '/' 만 '/index.html' 과 짝지어서, 하위 폴더 HTML 은 내줄 일이 없다.
// 규칙(vite.config.ts globIgnores '*/**/*.html')을 실제 workbox-build 로 돌려, 홈은 남고 나머지는 빠지는지 잠근다.
// '**/*.html' 로 "간단히" 바꾸면 홈(설치 앱 시작 주소)까지 빠진다 — 이 시험이 막는다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { getManifest } from 'workbox-build';

const root = path.resolve(__dirname, '../..');
const config = fs.readFileSync(path.join(root, 'vite.config.ts'), 'utf8');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-precache-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('service worker precache HTML', () => {
  it('keeps the top-level index.html and drops HTML in sub-folders', async () => {
    // A live entry inside globIgnores: not commented out, not moved elsewhere.
    const ignores = config.match(/globIgnores:\s*\[([\s\S]*?)\n\s*\],/)![1];
    expect(ignores).toMatch(/^\s*'\*\/\*\*\/\*\.html',\s*$/m);
    const globPatterns = JSON.parse(`[${config.match(/globPatterns:\s*\[([^\]]+)\]/)![1].replace(/'/g, '"')}]`);

    for (const file of ['index.html', 'planner/index.html', 'guide/a-post/index.html', 'home-dope/design-v3.html', 'assets/app.js', 'assets/app.css']) {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      fs.writeFileSync(path.join(dir, file), 'x');
    }
    const { manifestEntries } = await getManifest({ globDirectory: dir, globPatterns, globIgnores: ['*/**/*.html'] });

    expect(manifestEntries!.map((e) => e.url).sort()).toEqual(['assets/app.css', 'assets/app.js', 'index.html']);
  });
});
