import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const app = readFileSync('src/App.tsx', 'utf8');
const bottomNav = readFileSync('src/components/MobileBottomNav.tsx', 'utf8');

describe('/admin 고객용 chrome 격리', () => {
  it('GlobalWidgets와 NonMoodChrome 모두 /admin에서 렌더하지 않는다', () => {
    const globalWidgets = app.slice(app.indexOf('function GlobalWidgets()'), app.indexOf('function RobotsMeta()'));
    const nonMoodChrome = app.slice(app.indexOf('function NonMoodChrome()'));
    expect(globalWidgets).toContain("location.pathname.startsWith('/admin')");
    expect(nonMoodChrome.slice(0, nonMoodChrome.indexOf('return null'))).toContain("location.pathname.startsWith('/admin')");
  });

  it('MobileBottomSpacer도 /admin에서 렌더하지 않는다', () => {
    const spacer = bottomNav.slice(bottomNav.indexOf('export function MobileBottomSpacer'));
    expect(spacer).toContain("location.pathname.startsWith('/admin')");
  });

  it('PWA 업데이트 토스트는 App 전역 마운트를 유지한다', () => {
    expect(app.indexOf('<PWAUpdatePrompt />')).toBeGreaterThan(0);
    expect(app.indexOf('<PWAUpdatePrompt />')).toBeLessThan(app.indexOf('<GlobalWidgets />'));
  });
});
