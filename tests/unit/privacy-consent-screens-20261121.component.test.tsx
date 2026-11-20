// @vitest-environment jsdom
/**
 * 2026-11-21 처리방침 동의 화면 — 화면 잠금.
 *
 *   1) 위자드 Food: 식이 조건이 있으면 동의 줄이 뜨고, 동의 없이는 다음으로 못 간다(식이 조건은 안 버린다).
 *   2) 예약 폼: 만 14세 미만 아이가 있으면 보호자 동의가 필수 — 호출처 결제 게이트(termsAgreed)까지 묶인다.
 *      agree3 에서 "고유식별정보"가 빠졌다(4개 언어).
 *   3) 쿠키 안내: 처리방침 제6조(/privacy#article-6) 연결, "계속 쓰면 동의로 간주" 없음.
 *   4) 14세 확인 창: 확인 시 /api/age-confirm, 이미 확인·익명이면 안 뜸, "미만"은 로그아웃만.
 */
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ko from '../../src/i18n/locales/ko.json';
import en from '../../src/i18n/locales/en.json';

void React;
type U = { uid: string; isAnonymous?: boolean; email?: string | null } | null;

const h = vi.hoisted(() => ({
  user: null as U,
  t: null as unknown,
  signOut: vi.fn(async () => undefined),
  authFetch: vi.fn(),
  getDoc: vi.fn(),
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: h.user, loading: false }) }));
vi.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: h.t, language: 'ko' }) }));
vi.mock('@/lib/firebase-auth', () => ({ signOutUser: h.signOut, auth: { get currentUser() { return h.user; } } }));
vi.mock('@/lib/authFetch', () => ({ authFetch: h.authFetch, authDownload: vi.fn() }));
vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({ doc: (_db: unknown, ...path: string[]) => path.join('/'), getDoc: h.getDoc }));
vi.mock('../../src/components/charter/AddressAutocomplete', () => ({ AddressAutocomplete: () => null }));
vi.mock('../../src/components/booking/CountryDialPicker', () => ({ CountryDialPicker: () => null }));

const { WizardStep1Food } = await import('../../src/components/WizardForm/WizardStep1Food');
const { BookingInfoForm } = await import('../../src/components/booking/BookingInfoForm');
const CookieBanner = (await import('../../src/components/CookieBanner')).default;
const { AgeConfirmPrompt } = await import('../../src/components/AgeConfirmPrompt');

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  h.t = ko;
  h.user = null;
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network disabled in unit test'))));
  if (typeof window.matchMedia !== 'function') {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: false, media: q, onchange: null, addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    }));
  }
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

// ── 1) 위자드 Food ─────────────────────────────────────────────
describe('WizardStep1Food — 식이 동의', () => {
  const p = ko.planner as unknown as Record<string, string>;
  function renderFood(over: { dietaryRestrictions?: string[]; dietaryConsent?: boolean } = {}) {
    const onNext = vi.fn();
    const setDietaryConsent = vi.fn();
    const toggleDietaryRestriction = vi.fn();
    render(
      <WizardStep1Food
        p={p} isMobile={false} dietPrefs={[]} dietaryRestrictions={over.dietaryRestrictions || ['Halal']}
        priceRange="" spiceLevel="" bucketDishes={[]} toggleDiet={vi.fn()} toggleDietaryRestriction={toggleDietaryRestriction}
        setPriceRange={vi.fn()} setSpiceLevel={vi.fn()} toggleBucketDish={vi.fn()}
        dietaryConsent={over.dietaryConsent || false} setDietaryConsent={setDietaryConsent} onPrev={vi.fn()} onNext={onNext}
      />,
    );
    return { onNext, setDietaryConsent, toggleDietaryRestriction };
  }
  const next = () => screen.getByRole('button', { name: p.planner_step2_date });

  it('식이 조건 있고 동의 없음 → 다음 막힘 + 안내, 식이 조건은 건드리지 않음', () => {
    const { onNext, toggleDietaryRestriction } = renderFood();
    const box = screen.getByRole('checkbox', { name: new RegExp(p.wizardDietConsentLabel) });
    expect(box).not.toBeChecked();
    fireEvent.click(next());
    expect(onNext).not.toHaveBeenCalled();
    expect(toggleDietaryRestriction).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(p.wizardDietConsentError);
  });
  it('동의 체크 → setDietaryConsent(true)', () => {
    const { setDietaryConsent } = renderFood();
    fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(p.wizardDietConsentLabel) }));
    expect(setDietaryConsent).toHaveBeenCalledWith(true);
  });
  it('동의했으면 다음으로 간다', () => {
    const { onNext } = renderFood({ dietaryConsent: true });
    fireEvent.click(next());
    expect(onNext).toHaveBeenCalledTimes(1);
  });
  it('식이 조건이 없으면 동의 줄이 없고 그냥 간다', () => {
    const { onNext } = renderFood({ dietaryRestrictions: [] });
    expect(screen.queryByRole('checkbox', { name: new RegExp(p.wizardDietConsentLabel) })).toBeNull();
    fireEvent.click(next());
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});

// ── 2) 예약 폼 보호자 동의 ─────────────────────────────────────
const formBase = {
  eyebrow: 'e', title: 't', dateText: 'd', paxText: 'p', isAirport: true, meetingLabel: 'Meeting point',
  baseStr: '-', meetingStr: '', childSeatStr: '', totalStr: '-', usdStr: '', ctaLabel: 'Pay', onSubmit: () => {},
};
const GUARDIAN_KO = /보호자로서 제공하고 처리에 동의합니다/;
const AGREE1_KO = /이용약관 및 취소 규정에 동의합니다/;

/** 호출처(차터·투어)처럼 termsAgreed 를 들고 BookingInfoForm 에 넘긴다. */
function Caller({ childCount, initial = false, seen }: { childCount?: number; initial?: boolean; seen: boolean[] }) {
  const [termsAgreed, setTermsAgreed] = useState(initial);
  seen.push(termsAgreed);
  return (
    <MemoryRouter>
      <BookingInfoForm {...formBase} lang="ko" childCount={childCount} externalAgreeAll={termsAgreed} onAgreeAllChange={setTermsAgreed} hideCta />
    </MemoryRouter>
  );
}
const last = (a: boolean[]) => a[a.length - 1];

describe('BookingInfoForm — 만 14세 미만 보호자 동의', () => {
  it('차터 아이 1명: 약관만으로는 결제 게이트가 안 열리고, 보호자 동의까지 해야 열린다', () => {
    const seen: boolean[] = [];
    render(<Caller childCount={1} seen={seen} />);
    fireEvent.click(screen.getAllByRole('checkbox', { name: AGREE1_KO })[0]);
    expect(last(seen)).toBe(false);
    fireEvent.click(screen.getByRole('checkbox', { name: GUARDIAN_KO }));
    expect(last(seen)).toBe(true);
  });
  it('차터: 동의 후 아이를 늘려 다시 들어오면(재마운트) 결제 게이트를 내린다', () => {
    const seen: boolean[] = [];
    render(<Caller childCount={2} initial seen={seen} />);
    expect(last(seen)).toBe(false);
    expect(screen.getByRole('checkbox', { name: GUARDIAN_KO })).not.toBeChecked();
  });
  it('차터 아이 0명: 보호자 줄 없음, 예전처럼 약관만으로 열린다', () => {
    const seen: boolean[] = [];
    render(<Caller childCount={0} seen={seen} />);
    expect(screen.queryByRole('checkbox', { name: GUARDIAN_KO })).toBeNull();
    fireEvent.click(screen.getAllByRole('checkbox', { name: AGREE1_KO })[0]);
    expect(last(seen)).toBe(true);
  });
  it('투어(아이 수 모름): "아이와 함께 가요"를 고르면 보호자 동의가 필수가 된다', () => {
    const seen: boolean[] = [];
    render(<Caller seen={seen} />);
    expect(screen.queryByRole('checkbox', { name: GUARDIAN_KO })).toBeNull();
    fireEvent.click(screen.getAllByRole('checkbox', { name: AGREE1_KO })[0]);
    expect(last(seen)).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: /만 14세 미만 아이와 함께 가요/ }));
    expect(last(seen)).toBe(false);
    fireEvent.click(screen.getByRole('checkbox', { name: GUARDIAN_KO }));
    expect(last(seen)).toBe(true);
  });
  it('"모두 동의"는 보호자 동의까지 켠다', () => {
    const seen: boolean[] = [];
    render(<Caller childCount={1} seen={seen} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /아래 항목에 모두 동의합니다/ }));
    expect(screen.getByRole('checkbox', { name: GUARDIAN_KO })).toBeChecked();
    expect(last(seen)).toBe(true);
  });
  it.each(['ko', 'en', 'ja', 'zh'] as const)('%s — agree3 에 고유식별정보 없음', (lang) => {
    const { container } = render(<MemoryRouter><BookingInfoForm {...formBase} lang={lang} /></MemoryRouter>);
    expect(container.textContent).not.toMatch(/고유식별|unique identif|固有識別|唯一识别|身份识别/i);
    expect(container.textContent).toMatch(/국외 이전|cross-border|国外移転|跨境/);
  });
});

// ── 3) 쿠키 안내 ───────────────────────────────────────────────
describe('CookieBanner — 동의해야 켠다 + 제6조 연결', () => {
  it.each([['ko', ko], ['en', en]] as const)('%s', (_lang, dict) => {
    vi.useFakeTimers();
    h.t = dict;
    render(<CookieBanner />);
    act(() => { vi.advanceTimersByTime(1600); });
    const links = screen.getAllByRole('link', { name: dict.cookieBanner.providersLink });
    expect(links.length).toBeGreaterThan(0);
    for (const a of links) expect(a).toHaveAttribute('href', '/privacy#article-6');
    expect(document.body.textContent).not.toMatch(/간주|By continuing/);
  });
});

// ── 4) 14세 확인 창 ────────────────────────────────────────────
const MEMBER: U = { uid: 'member-1', isAnonymous: false, email: 'person@example.invalid' };
const snap = (data: Record<string, unknown> | null) => ({ exists: () => data !== null, data: () => data || undefined });
const ag = ko.ageGate;

describe('AgeConfirmPrompt', () => {
  it('확인 기록 없는 회원 → 창이 뜨고, 확인하면 /api/age-confirm 후 닫힌다', async () => {
    h.user = MEMBER;
    h.getDoc.mockResolvedValue(snap({ email: 'person@example.invalid' }));
    h.authFetch.mockResolvedValue({ ok: true, status: 200 });
    render(<AgeConfirmPrompt />);
    const dialog = await screen.findByRole('dialog', { name: ag.title });
    expect(dialog).toHaveTextContent(ag.body);
    fireEvent.click(screen.getByRole('button', { name: ag.confirm }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(h.authFetch).toHaveBeenCalledWith('/api/age-confirm', { method: 'POST' });
    expect(localStorage.getItem('COCO_AGE14_OK:member-1')).toBe('1');
  });
  it('이미 확인한 회원 → 창 없음', async () => {
    h.user = MEMBER;
    h.getDoc.mockResolvedValue(snap({ ageOver14Confirmed: true, ageOver14ConfirmedAt: '2026-11-01T00:00:00.000Z' }));
    render(<AgeConfirmPrompt />);
    await waitFor(() => expect(h.getDoc).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(localStorage.getItem('COCO_AGE14_OK:member-1')).toBe('1');
  });
  it('익명·로그아웃 → 읽지도 않는다', () => {
    h.user = { uid: 'anon', isAnonymous: true };
    render(<AgeConfirmPrompt />);
    expect(h.getDoc).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('이 기기에서 이미 확인 → 읽지 않는다', () => {
    h.user = MEMBER;
    localStorage.setItem('COCO_AGE14_OK:member-1', '1');
    render(<AgeConfirmPrompt />);
    expect(h.getDoc).not.toHaveBeenCalled();
  });
  it('"만 14세 미만" → 로그아웃만(서버에 안 씀), 안내가 뜬다', async () => {
    h.user = MEMBER;
    h.getDoc.mockResolvedValue(snap({}));
    h.signOut.mockImplementation(async () => { h.user = null; });
    render(<AgeConfirmPrompt />);
    fireEvent.click(await screen.findByRole('button', { name: ag.under14 }));
    await screen.findByText(ag.under14Notice);
    expect(h.signOut).toHaveBeenCalledTimes(1);
    expect(h.authFetch).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('저장 실패 → 창을 닫지 않고 오류 안내', async () => {
    h.user = MEMBER;
    h.getDoc.mockResolvedValue(snap({}));
    h.authFetch.mockResolvedValue({ ok: false, status: 500 });
    render(<AgeConfirmPrompt />);
    fireEvent.click(await screen.findByRole('button', { name: ag.confirm }));
    expect(await screen.findByRole('alert')).toHaveTextContent(ag.error);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(localStorage.getItem('COCO_AGE14_OK:member-1')).toBeNull();
  });
});
