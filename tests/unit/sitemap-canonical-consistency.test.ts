/**
 * sitemap.xml ↔ canonical 도메인 정합 + 로그인벽 라우트 제외 가드 (2026-06-04 자율).
 *
 * 배경: sitemap 이 www.cocotripkr.com, index.html canonical 은 non-www(cocotripkr.com) = 자기모순
 *   → 구글이 정식 도메인을 헷갈려 색인 분산. 또 /charter 는 <AuthRequired> 로그인벽(App.tsx:422-431)
 *   이라 봇이 받는 화면이 마케팅이 아니라 'Sign in' → sitemap 에 있으면 로그인벽을 색인(역효과).
 *
 * 가드: 모든 <loc> 은 non-www cocotripkr.com (canonical 과 일치) + 인증 게이트 라우트(/charter) 부재.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sitemap = readFileSync(join(process.cwd(), 'public', 'sitemap.xml'), 'utf8');
const indexHtml = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

describe('sitemap canonical 도메인 정합', () => {
  it('canonical 은 non-www (cocotripkr.com)', () => {
    expect(indexHtml).toMatch(/rel="canonical"\s+href="https:\/\/cocotripkr\.com/);
  });
  it('sitemap 에 URL 이 존재', () => {
    expect(locs.length).toBeGreaterThan(0);
  });
  it('모든 <loc> 이 non-www 도메인 (canonical 과 동일) — www 재유입 방지', () => {
    for (const loc of locs) {
      expect(loc, `${loc} 가 www 또는 다른 도메인`).toMatch(/^https:\/\/cocotripkr\.com(\/|$)/);
      expect(loc).not.toMatch(/www\./);
    }
  });
  it('인증 게이트 라우트(/charter=AuthRequired 로그인벽)는 sitemap 제외 — 로그인벽 색인 방지', () => {
    expect(locs.some((l) => /\/charter(\/|$)/.test(l)), '/charter 는 로그인벽이라 sitemap 제외 대상').toBe(false);
  });
});
