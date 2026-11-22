// @vitest-environment jsdom
/**
 * 2026-11-22 처리방침 동의 후속 — 화면 잠금.
 *
 *   1) 다른 화면에서 /privacy#article-6 으로 오면 그 조항으로 내려간다(조항이 늦게 그려져도). 같은 화면 안 # 이동은 건드리지 않는다.
 *   2) 예약 폼이 다시 그려져도(투어 이전→다음) "아이와 함께 가요"·보호자 동의가 돌아오고, 호출처에 알린다.
 *   3) 예약 메모 줄: 동의 여부·시각·문구 판만(새 개인정보 없음). 차터 장바구니 메모에도 붙는다.
 *   4) 결제 버튼 옆 동의 한 줄: 4개 언어, 이용약관·처리방침 연결.
 */
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ko from '../../src/i18n/locales/ko.json';
import en from '../../src/i18n/locales/en.json';
import ja from '../../src/i18n/locales/ja.json';
import zh from '../../src/i18n/locales/zh.json';

void React;
const h = vi.hoisted(() => ({ t: null as unknown }));
vi.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: h.t, language: 'ko' }) }));
vi.mock('../../src/components/charter/AddressAutocomplete', () => ({ AddressAutocomplete: () => null }));
vi.mock('../../src/components/booking/CountryDialPicker', () => ({ CountryDialPicker: () => null }));

const { HashScroll } = await import('../../src/components/HashScroll');
const { BookingInfoForm } = await import('../../src/components/booking/BookingInfoForm');
const { PayConsentNote } = await import('../../src/components/booking/PayConsentNote');
const { guardianMemoLine, GUARDIAN_CONSENT_VERSION } = await import('../../src/lib/guardianConsent');
const { buildCharterCartItem } = await import('../../src/components/charter/charterCartItem');
type GuardianConsent = import('../../src/lib/guardianConsent').GuardianConsent;

const scrollSpy = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  h.t = ko;
  Element.prototype.scrollIntoView = scrollSpy;
});
afterEach(() => { cleanup(); document.body.innerHTML = ''; });

// ── 1) 조항 바로가기 ───────────────────────────────────────────
function GoButton({ to }: { to: string }) {
  const nav = useNavigate();
  return <button type="button" onClick={() => nav(to)}>go</button>;
}

describe('HashScroll', () => {
  it('다른 화면에서 /privacy#article-6 으로 오면, 조항이 늦게 그려져도 그 조항으로 내려간다', async () => {
    render(<MemoryRouter initialEntries={['/']}><HashScroll /><GoButton to="/privacy#article-6" /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'go' }));
    expect(scrollSpy).not.toHaveBeenCalled(); // 아직 조항 없음(게으른 화면)
    const sec = document.createElement('section');
    sec.id = 'article-6';
    document.body.appendChild(sec);
    await waitFor(() => expect(scrollSpy).toHaveBeenCalledTimes(1));
    expect(scrollSpy.mock.contexts[0]).toBe(sec);
  });
  it('같은 화면 안에서 # 만 바뀌면 건드리지 않는다(#t=·#course= 같은 값 해시 보호)', async () => {
    const sec = document.createElement('section');
    sec.id = 'x';
    document.body.appendChild(sec);
    render(<MemoryRouter initialEntries={['/plan/1']}><HashScroll /><GoButton to="/plan/1#x" /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'go' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(scrollSpy).not.toHaveBeenCalled();
  });
});

// ── 2) 예약 폼 다시 그리기 ─────────────────────────────────────
const formBase = {
  eyebrow: 'e', title: 't', dateText: 'd', paxText: 'p', isAirport: true, meetingLabel: 'Meeting point',
  baseStr: '-', meetingStr: '', childSeatStr: '', totalStr: '-', usdStr: '', ctaLabel: 'Pay', onSubmit: () => {},
};
const GUARDIAN_KO = /보호자로서 제공하고 처리에 동의합니다/;
const MINOR_KO = /만 14세 미만 아이와 함께 가요/;
const AGREE1_KO = /이용약관 및 취소 규정에 동의합니다/;

/** 투어 창처럼: 2단계에서만 폼을 그리고, 약관·보호자 상태는 호출처가 들고 있다. */
function TourLikeCaller({ log }: { log: { terms: boolean; guardian: GuardianConsent | null }[] }) {
  const [show, setShow] = useState(true);
  const [terms, setTerms] = useState(false);
  const [guardian, setGuardian] = useState<GuardianConsent | null>(null);
  log.push({ terms, guardian });
  return (
    <MemoryRouter>
      <button type="button" onClick={() => setShow((v) => !v)}>flip</button>
      {show && (
        <BookingInfoForm {...formBase} lang="ko" externalAgreeAll={terms} onAgreeAllChange={setTerms}
          initialGuardian={guardian} onGuardianChange={setGuardian} hideCta />
      )}
    </MemoryRouter>
  );
}

describe('BookingInfoForm — 다시 그려도 아이·보호자 동의가 돌아온다', () => {
  it('투어: 아이 표시+보호자 동의 → 이전→다음 → 둘 다 켜진 채, 결제 게이트도 열린 채', () => {
    const log: { terms: boolean; guardian: GuardianConsent | null }[] = [];
    render(<TourLikeCaller log={log} />);
    fireEvent.click(screen.getAllByRole('checkbox', { name: AGREE1_KO })[0]);
    fireEvent.click(screen.getByRole('checkbox', { name: MINOR_KO }));
    fireEvent.click(screen.getByRole('checkbox', { name: GUARDIAN_KO }));
    const before = log[log.length - 1];
    expect(before.terms).toBe(true);
    expect(before.guardian).toMatchObject({ minor: true, agreed: true, version: GUARDIAN_CONSENT_VERSION });
    expect(before.guardian!.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    fireEvent.click(screen.getByRole('button', { name: 'flip' })); // 1단계로
    fireEvent.click(screen.getByRole('button', { name: 'flip' })); // 다시 2단계
    expect(screen.getByRole('checkbox', { name: MINOR_KO })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: GUARDIAN_KO })).toBeChecked();
    const after = log[log.length - 1];
    expect(after.terms).toBe(true);
    expect(after.guardian).toEqual(before.guardian); // 동의 시각도 그대로(다시 찍지 않음)
  });
  it('보호자 동의를 끄면 시각이 지워지고 결제 게이트가 내려간다', () => {
    const log: { terms: boolean; guardian: GuardianConsent | null }[] = [];
    render(<TourLikeCaller log={log} />);
    fireEvent.click(screen.getAllByRole('checkbox', { name: AGREE1_KO })[0]);
    fireEvent.click(screen.getByRole('checkbox', { name: MINOR_KO }));
    fireEvent.click(screen.getByRole('checkbox', { name: GUARDIAN_KO }));
    fireEvent.click(screen.getByRole('checkbox', { name: GUARDIAN_KO }));
    const now = log[log.length - 1];
    expect(now.terms).toBe(false);
    expect(now.guardian).toMatchObject({ minor: true, agreed: false, at: null });
  });
});

// ── 3) 예약 메모 줄 ────────────────────────────────────────────
describe('guardianMemoLine — 동의 여부·시각·판만', () => {
  const at = '2026-11-22T01:02:03.000Z';
  it('아이 없음 → 빈 줄', () => {
    expect(guardianMemoLine(null)).toBe('');
    expect(guardianMemoLine({ minor: false, agreed: false, at: null, version: GUARDIAN_CONSENT_VERSION })).toBe('');
  });
  it('아이+동의 → 시각·판', () => {
    expect(guardianMemoLine({ minor: true, agreed: true, at, version: '2026-11-21' }))
      .toBe('Child under 14: yes | Guardian consent: yes @ 2026-11-22T01:02:03.000Z (v2026-11-21)');
  });
  it('아이+동의 없음(또는 시각 없음) → no', () => {
    expect(guardianMemoLine({ minor: true, agreed: false, at: null, version: 'v' })).toBe('Child under 14: yes | Guardian consent: no');
    expect(guardianMemoLine({ minor: true, agreed: true, at: null, version: 'v' })).toBe('Child under 14: yes | Guardian consent: no');
  });
  it('차터 장바구니 메모에도 붙는다(가격 키는 그대로)', () => {
    const state = { vehicle: 'staria', paxCount: 2, childCount: 1, startDate: '2026-12-01', service: 'day_tour', notes: 'hello' } as never;
    const resolved = { productType: 'charter_seoul_city', priceKRW: 1, passengers: 2, payable: true } as never;
    const g: GuardianConsent = { minor: true, agreed: true, at, version: GUARDIAN_CONSENT_VERSION };
    const withG = buildCharterCartItem(state, resolved, { guardian: g })!;
    const without = buildCharterCartItem(state, resolved)!;
    expect(withG.booking.memo).toContain(`Guardian consent: yes @ ${at}`);
    expect(without.booking.memo).not.toContain('Guardian');
    const { memo: _a, ...restG } = withG.booking;
    const { memo: _b, ...rest } = without.booking;
    void _a; void _b;
    expect(restG).toEqual(rest);
  });
});

// ── 4) 결제 버튼 옆 동의 한 줄 ─────────────────────────────────
describe('PayConsentNote', () => {
  it.each([['ko', ko], ['en', en], ['ja', ja], ['zh', zh]] as const)('%s — 문장 + 두 문서 연결(새 탭)', (_lang, dict) => {
    h.t = dict;
    render(<MemoryRouter><PayConsentNote /></MemoryRouter>);
    const c = dict.payConsent;
    expect(screen.getByTestId('pay-consent-note')).toHaveTextContent(`${c.before}${c.terms}${c.middle}${c.privacy}${c.after}`.trim());
    const terms = screen.getByRole('link', { name: c.terms });
    const privacy = screen.getByRole('link', { name: c.privacy });
    expect(terms).toHaveAttribute('href', '/terms');
    expect(privacy).toHaveAttribute('href', '/privacy');
    for (const a of [terms, privacy]) {
      expect(a).toHaveAttribute('target', '_blank');
      expect(a).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });
});
