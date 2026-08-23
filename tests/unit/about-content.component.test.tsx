// @vitest-environment jsdom
/**
 * /about — 두 낱말짜리 페이지를 대체한 본문 계약 (2026-08-23).
 *
 * 🔴 실측한 결함: 화면에 뜻 있는 낱말이 **두 개**("About COCOTRIP") 뿐이었다. 나머지는
 *    브랜드 이미지 4장. 색인 대상 경로인데 크롤러가 읽을 본문이 사실상 없었고, 신뢰를
 *    판단하려는 사람에게도 아무 말을 하지 않았다.
 *
 * 잠그는 것
 *   1) 네 언어 모두 실제 본문이 나온다(로고 한 줄이 아니다).
 *   2) 본문의 사실은 **이미 검증된 두 원천**에서만 온다 — homeCopy(홈과 같은 문구·수치)와
 *      `t.footer.*`(이미 전 페이지 하단에 공개된 등록·연락 정보).
 *   3) /about 전용 문구(`aboutCopy.ts`)에는 숫자가 한 개도 없다 — 면허번호·응대시간·
 *      가격·보증을 새로 지어낼 수 없게 구조로 막는다.
 *   4) 서비스·정책·가이드로 나가는 평범한 앵커가 있다(프리렌더 HTML 에 실려야 한다).
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { ABOUT_COPY, pickAboutCopy, type AboutCopy } from '../../src/pages/aboutCopy';
import { pickHomeCopy } from '../../src/sections/home/homeCopy';
import en from '../../src/i18n/locales/en.json';
import ko from '../../src/i18n/locales/ko.json';
import ja from '../../src/i18n/locales/ja.json';
import zh from '../../src/i18n/locales/zh.json';

void React;

const LOCALES = { en, ko, ja, zh } as Record<string, Record<string, unknown>>;
const LANGS = ['en', 'ko', 'ja', 'zh'] as const;

const state = vi.hoisted(() => ({ language: 'en', t: {} as Record<string, unknown> }));
const usePageMetaMock = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ language: state.language, t: state.t, changeLanguage: vi.fn() }),
}));
vi.mock('@/hooks/usePageMeta', () => ({ usePageMeta: usePageMetaMock }));
vi.mock('@/sections/Header', () => ({ Header: () => <div data-testid="header" /> }));
vi.mock('@/sections/Footer', () => ({ Footer: () => <div data-testid="footer" /> }));

const About = (await import('../../src/pages/About')).default;

function renderAbout(lang: string) {
  state.language = lang;
  state.t = LOCALES[lang];
  return render(<MemoryRouter><About /></MemoryRouter>);
}

/** 화면에 실제로 읽히는 본문만. 공백은 접는다. */
function mainText(container: HTMLElement): string {
  return (container.querySelector('main')?.textContent || '').replace(/\s+/g, ' ').trim();
}

function keyPaths(value: unknown, prefix = ''): string[] {
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>).sort()
      .flatMap((k) => keyPaths((value as Record<string, unknown>)[k], prefix ? `${prefix}.${k}` : k));
  }
  return [prefix];
}

function allStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).flatMap(allStrings);
  return [];
}

beforeEach(() => {
  cleanup();
  usePageMetaMock.mockReset();
});

describe('/about 전용 문구', () => {
  it('네 언어의 키 구조가 같다', () => {
    const base = keyPaths(ABOUT_COPY.en);
    for (const lang of LANGS) expect(keyPaths(ABOUT_COPY[lang]), lang).toEqual(base);
  });

  it('빈 문구가 없다', () => {
    for (const lang of LANGS) {
      for (const s of allStrings(ABOUT_COPY[lang])) expect(s.trim().length, lang).toBeGreaterThan(0);
    }
  });

  it('숫자가 한 개도 없다 — 면허번호·응대시간·가격·기간을 새로 적을 수 없다', () => {
    for (const lang of LANGS) {
      const withDigits = allStrings(ABOUT_COPY[lang]).filter((s) => /[0-9０-９]/.test(s));
      expect(withDigits, `${lang} 숫자 포함 문구`).toEqual([]);
    }
  });

  it('보증·인증을 약속하는 낱말이 없다', () => {
    const banned = [
      /guarantee/i, /certified/i, /24\/7/i, /\bwarrant/i,
      /보장/, /보증/, /인증/,
      /保証/, /認証/,
      /保证/, /认证/,
    ];
    for (const lang of LANGS) {
      for (const s of allStrings(ABOUT_COPY[lang])) {
        for (const rule of banned) expect(rule.test(s), `${lang}: "${s}"`).toBe(false);
      }
    }
  });

  it('알 수 없는 언어는 영어로 떨어진다', () => {
    expect(pickAboutCopy('fr')).toBe(ABOUT_COPY.en as AboutCopy);
  });
});

describe('/about 렌더', () => {
  it.each([...LANGS])('%s: 두 낱말이 아니라 실제 본문이 나온다', (lang) => {
    const { container } = renderAbout(lang);
    const text = mainText(container as HTMLElement);
    // 교체 전 본문은 "About COCOTRIP" 14자였다. 400자는 "본문이 있다" 의 하한이다.
    expect(text.length, `${lang} main text length`).toBeGreaterThan(400);
    expect(screen.getByRole('heading', { level: 1 }).textContent?.trim().length).toBeGreaterThan(0);
  });

  it('서비스 3종으로 나가는 평범한 앵커가 있다', () => {
    const { container } = renderAbout('en');
    for (const href of ['/planner', '/charter', '/tours']) {
      expect(container.querySelector(`main a[href="${href}"]`), href).not.toBeNull();
    }
  });

  it('가이드·지역·정책으로 이어진다', () => {
    const { container } = renderAbout('en');
    for (const href of ['/guide', '/#regions', '/terms', '/privacy', '/travel-terms']) {
      expect(container.querySelector(`main a[href="${href}"]`), href).not.toBeNull();
    }
  });

  it('등록·연락 정보는 footer i18n 값 그대로다 (두 번째 원천을 만들지 않는다)', () => {
    const { container } = renderAbout('en');
    const text = mainText(container as HTMLElement);
    const footer = (en as unknown as { footer: Record<string, string> }).footer;
    for (const key of ['company', 'ceo', 'address', 'businessNo', 'tourNo', 'email', 'phone', 'hours']) {
      expect(text, `footer.${key}`).toContain(footer[key]);
    }
  });

  it('데이터 근거·안 하는 약속은 홈과 같은 문구다', () => {
    const { container } = renderAbout('en');
    const text = mainText(container as HTMLElement);
    const home = pickHomeCopy('en');
    expect(text).toContain(home.ledger.trustLine);
    expect(text).toContain(home.ledger.limits);
    expect(text).toContain(home.closing.reviewsBody);
    for (const item of home.ledger.items) expect(text).toContain(item.figure);
  });

  it('브랜드 이미지는 장식이라 접근성 트리에서 빠진다', () => {
    const { container } = renderAbout('en');
    const imgs = Array.from(container.querySelectorAll('main img'));
    expect(imgs.length).toBeGreaterThan(0);
    for (const img of imgs) expect(img.getAttribute('alt')).toBe('');
  });

  it('페이지 메타는 기존 i18n 값을 그대로 쓴다', () => {
    renderAbout('ko');
    const meta = (ko as unknown as { pageMeta: { about: { title: string; description: string } } }).pageMeta.about;
    expect(usePageMetaMock).toHaveBeenCalledWith(expect.objectContaining({
      title: meta.title,
      description: meta.description,
    }));
  });
});
