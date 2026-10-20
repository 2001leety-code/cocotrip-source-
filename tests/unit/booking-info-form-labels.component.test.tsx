// @vitest-environment jsdom
/**
 * BookingInfoForm 라벨 ↔ 입력 연결 (2026-10-19 접근성 배치).
 *
 * 잠그는 것
 *   1) 성·이름·휴대폰·이메일·편명 5개 입력이 기존 4언어 라벨 문구로 getByLabelText / getByRole(name) 에 잡힌다.
 *   2) 폼 두 개가 동시에 떠도 id 가 겹치지 않고, 각 라벨은 자기 인스턴스 입력만 가리킨다.
 *   3) 라벨로 찾은 입력의 기존 onChange(→ onFieldsChange emit)가 그대로 동작한다.
 * 네트워크 없음 — fetch 는 실패 stub, 주소 자동완성/국가번호 picker 는 로컬 mock.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../src/components/charter/AddressAutocomplete', () => ({
  AddressAutocomplete: () => null,
}));
vi.mock('../../src/components/booking/CountryDialPicker', () => ({
  CountryDialPicker: () => null,
}));

import { BookingInfoForm } from '../../src/components/booking/BookingInfoForm';
import type { BookingFormData } from '../../src/components/booking/BookingInfoForm';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network disabled in unit test'))));
  if (typeof window.matchMedia !== 'function') {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: false, media: q, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    }));
  }
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Lang = 'ko' | 'en' | 'ja' | 'zh';

const formBase = {
  eyebrow: 'e', title: 't', dateText: 'd', paxText: 'p', isAirport: true, meetingLabel: 'Meeting point',
  baseStr: '-', meetingStr: '', childSeatStr: '', totalStr: '-', usdStr: '', ctaLabel: 'Pay',
  onSubmit: () => {},
};

// 화면에 이미 노출되던 라벨 문구 (BookingInfoForm STR) — 뒤의 필수 * / (선택) 표시는 접두 매칭으로 허용.
const LABELS: Record<Lang, { lastName: string; firstName: string; phone: string; email: string; flightNo: string }> = {
  ko: { lastName: '영문 성 (Last name)', firstName: '영문 이름 (First name)', phone: '휴대폰 번호', email: '이메일 주소', flightNo: '항공편 편명' },
  en: { lastName: 'Last name (passport)', firstName: 'First name (passport)', phone: 'Mobile number', email: 'Email address', flightNo: 'Flight number' },
  ja: { lastName: '姓（ローマ字）', firstName: '名（ローマ字）', phone: '携帯電話番号', email: 'メールアドレス', flightNo: 'フライト便名' },
  zh: { lastName: '姓（英文/拼音）', firstName: '名（英文/拼音）', phone: '手机号码', email: '电子邮箱', flightNo: '航班号' },
};

const startsWith = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);

describe('BookingInfoForm label association', () => {
  it.each(['ko', 'en', 'ja', 'zh'] as const)('%s — 5개 라벨이 입력 이름으로 노출된다', (lang) => {
    render(<MemoryRouter><BookingInfoForm {...formBase} lang={lang} /></MemoryRouter>);
    const l = LABELS[lang];
    for (const text of [l.lastName, l.firstName, l.phone, l.email, l.flightNo]) {
      const byLabel = screen.getByLabelText(startsWith(text));
      expect(byLabel.tagName).toBe('INPUT');
      expect(screen.getByRole('textbox', { name: startsWith(text) })).toBe(byLabel);
    }
  });

  it('라벨로 찾은 입력의 기존 onChange 가 그대로 emit 된다', () => {
    const emitted: BookingFormData[] = [];
    render(
      <MemoryRouter>
        <BookingInfoForm {...formBase} lang="en" onFieldsChange={(d) => emitted.push(d)} />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText(startsWith(LABELS.en.lastName)), { target: { value: 'HONG' } });
    fireEvent.change(screen.getByLabelText(startsWith(LABELS.en.firstName)), { target: { value: 'GILDONG' } });
    fireEvent.change(screen.getByLabelText(startsWith(LABELS.en.email)), { target: { value: 'a@b.co' } });
    fireEvent.change(screen.getByLabelText(startsWith(LABELS.en.flightNo)), { target: { value: 'ke123' } });
    const last = emitted[emitted.length - 1];
    expect(last.lastName).toBe('HONG');
    expect(last.firstName).toBe('GILDONG');
    expect(last.email).toBe('a@b.co');
    expect(last.flightNo).toBe('KE123');
  });

  it('두 인스턴스 동시 렌더 — id 고유, 라벨은 자기 폼 입력만 가리킨다', () => {
    render(
      <MemoryRouter>
        <section data-testid="form-a"><BookingInfoForm {...formBase} lang="en" /></section>
        <section data-testid="form-b"><BookingInfoForm {...formBase} lang="en" /></section>
      </MemoryRouter>,
    );
    const ids: string[] = [];
    for (const key of ['form-a', 'form-b']) {
      const scope = within(screen.getByTestId(key));
      for (const text of Object.values(LABELS.en)) {
        const input = scope.getByLabelText(startsWith(text));
        expect(input.id).not.toBe('');
        expect(screen.getByTestId(key).contains(input)).toBe(true);
        ids.push(input.id);
      }
    }
    expect(new Set(ids).size).toBe(ids.length);
    expect(screen.getAllByLabelText(startsWith(LABELS.en.lastName))).toHaveLength(2);
    expect(fetch).not.toHaveBeenCalled();
  });
});
