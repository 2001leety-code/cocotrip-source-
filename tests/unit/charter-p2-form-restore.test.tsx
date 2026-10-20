// @vitest-environment jsdom
/**
 * 차터 P2-1 (2026-10-18) — Step6 → Step5 재마운트 시 BookingInfoForm 성·이름·편명 표시 복원.
 *
 * 잠그는 것
 *   1) BookingInfoForm optional initial* seed 는 마운트 1회만 읽힌다(마운트 중 재seed 없음). 미전달 = 기존 '' 기본값.
 *   2) Step5 는 split 성·이름(customerLastName/FirstName)을 저장하고 재마운트 시 그 값으로 seed.
 *      복합 이름 원문 유지, 부분 입력 = customerName '' (기존 규칙), 명시적 '' 삭제는 재마운트 후에도 ''.
 *   3) split 필드 없는 레거시 customerName 은 첫 emit·무관한 입력에서 지워지지 않는다.
 *   4) 같은 편명 복원은 arrival·terminal·luggage 보존, 실제 편명 변경/삭제는 기존처럼 arrival 무효화.
 * 네트워크 없음 — fetch 는 실패 stub, 주소 자동완성/국가번호 picker 는 로컬 mock.
 * Host 는 메모리 state 만 소유 — 실제 draft 저장/복원·Continue 흐름은 여기서 검증하지 않는다(브라우저 검증 몫).
 */
import React, { useEffect, useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../src/components/charter/AddressAutocomplete', () => ({
  AddressAutocomplete: () => null,
}));
vi.mock('../../src/components/booking/CountryDialPicker', () => ({
  CountryDialPicker: () => null,
}));

import { BookingInfoForm } from '../../src/components/booking/BookingInfoForm';
import { Step5DateOptions } from '../../src/components/charter/Step5DateOptions';
import { INITIAL_WIZARD_STATE } from '../../src/components/charter/types';
import type { WizardState } from '../../src/components/charter/types';

// 실제 기본 state 복사본 위에 partial 을 얹는다 (공유 default·options 객체는 변형하지 않음).
const makeState = (p: Partial<WizardState> = {}): WizardState => ({
  ...INITIAL_WIZARD_STATE,
  options: { ...INITIAL_WIZARD_STATE.options },
  ...p,
});

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

// ── Host: 위저드 state 소유 + Step5 ↔ Step6 이동(언마운트/재마운트) ──────────────
let latest: WizardState = makeState();
function Host({ initial }: { initial: Partial<WizardState> }) {
  const [state, setState] = useState<WizardState>(() => makeState(initial));
  const [step, setStep] = useState<5 | 6>(5);
  useEffect(() => {
    latest = state;
  }, [state]);
  const patch = (p: Partial<WizardState>) => setState((s) => ({ ...s, ...p }));
  return (
    <MemoryRouter>
      <button type="button" onClick={() => setStep(6)}>go-step6</button>
      <button type="button" onClick={() => setStep(5)}>go-step5</button>
      {step === 5 ? <Step5DateOptions state={state} patch={patch} language="en" quote={null} /> : <div>step6</div>}
    </MemoryRouter>
  );
}

const lastInput = () => screen.getByPlaceholderText('HONG') as HTMLInputElement;
const firstInput = () => screen.getByPlaceholderText('GILDONG') as HTMLInputElement;
const flightInput = () => screen.getByPlaceholderText('e.g. KE5760, OZ521') as HTMLInputElement;
const emailInput = () => screen.getByPlaceholderText('you@email.com') as HTMLInputElement;
const remount = () => {
  fireEvent.click(screen.getByText('go-step6'));
  expect(screen.queryByPlaceholderText('HONG')).toBeNull();
  fireEvent.click(screen.getByText('go-step5'));
};

const formBase = {
  eyebrow: 'e', title: 't', dateText: 'd', paxText: 'p', isAirport: true, meetingLabel: 'Meeting point',
  baseStr: '-', meetingStr: '', childSeatStr: '', totalStr: '-', usdStr: '', ctaLabel: 'Pay', lang: 'en' as const,
  onSubmit: () => {},
};

describe('BookingInfoForm initial seeds', () => {
  it('미전달 시 기존 기본값 (투어 등 다른 호출처)', () => {
    render(<MemoryRouter><BookingInfoForm {...formBase} /></MemoryRouter>);
    expect(lastInput().value).toBe('');
    expect(firstInput().value).toBe('');
    expect(flightInput().value).toBe('');
  });

  it('seed 는 마운트 1회만 — 마운트 중 prop 변경으로 재seed 하지 않는다', () => {
    const { rerender } = render(
      <MemoryRouter><BookingInfoForm {...formBase} initialLastName="PARK" initialFirstName="JI SOO" initialFlightNo="KE123" /></MemoryRouter>,
    );
    expect(lastInput().value).toBe('PARK');
    expect(firstInput().value).toBe('JI SOO');
    expect(flightInput().value).toBe('KE123');
    fireEvent.change(lastInput(), { target: { value: 'PARKER' } });
    rerender(
      <MemoryRouter><BookingInfoForm {...formBase} initialLastName="CHOI" initialFirstName="" initialFlightNo="OZ1" /></MemoryRouter>,
    );
    expect(lastInput().value).toBe('PARKER');
    expect(firstInput().value).toBe('JI SOO');
    expect(flightInput().value).toBe('KE123');
  });

  it('이메일·메신저 seed — "<type>: <id>" 를 select·ID 입력으로 분해 표시', () => {
    render(<MemoryRouter><BookingInfoForm {...formBase} initialEmail="a@b.co" initialMessenger="LINE: line_user" /></MemoryRouter>);
    const messengerIdInput = screen.getByPlaceholderText('Messenger ID or number') as HTMLInputElement;
    expect(emailInput().value).toBe('a@b.co');
    expect((messengerIdInput.parentElement?.querySelector('select') as HTMLSelectElement).value).toBe('LINE');
    expect(messengerIdInput.value).toBe('line_user');
  });

  it('알 수 없는 메신저 종류 seed — WhatsApp + 빈 ID 로 폴백', () => {
    render(<MemoryRouter><BookingInfoForm {...formBase} initialMessenger="Telegram: x" /></MemoryRouter>);
    const messengerIdInput = screen.getByPlaceholderText('Messenger ID or number') as HTMLInputElement;
    expect((messengerIdInput.parentElement?.querySelector('select') as HTMLSelectElement).value).toBe('WhatsApp');
    expect(messengerIdInput.value).toBe('');
  });
});

describe('Step5 split name persist / restore', () => {
  it('복합 이름 seed 원문 그대로 표시, 복원 emit 은 state 를 바꾸지 않는다', () => {
    const initial: Partial<WizardState> = {
      service: 'day_tour',
      customerLastName: 'VAN DER BERG', customerFirstName: 'MARY ANN', customerName: 'VAN DER BERG MARY ANN',
    };
    render(<Host initial={initial} />);
    expect(lastInput().value).toBe('VAN DER BERG');
    expect(firstInput().value).toBe('MARY ANN');
    expect(latest.customerName).toBe('VAN DER BERG MARY ANN');
    expect(latest.customerLastName).toBe('VAN DER BERG');
    expect(latest.customerFirstName).toBe('MARY ANN');
  });

  it('레거시 combined customerName (split 없음) — 첫 emit·무관한 입력에서 보존, split 하지 않음', () => {
    render(<Host initial={{ customerName: 'KIM MIN JUN' }} />);
    expect(lastInput().value).toBe('');
    expect(firstInput().value).toBe('');
    expect(latest.customerName).toBe('KIM MIN JUN');
    fireEvent.change(emailInput(), { target: { value: 'a@b.co' } });
    expect(latest.customerEmail).toBe('a@b.co');
    expect(latest.customerName).toBe('KIM MIN JUN');
    expect(latest.customerLastName).toBeUndefined();
    expect(latest.customerFirstName).toBeUndefined();
  });

  it.each([
    { cleared: 'lastName', clearInput: lastInput, keptInput: firstInput, keptValue: 'SOO JIN' },
    { cleared: 'firstName', clearInput: firstInput, keptInput: lastInput, keptValue: 'LEE' },
  ] as const)('편집 → 부분입력 규칙 → $cleared 명시적 삭제 → 재마운트 후에도 빈 값 유지', ({ cleared, clearInput, keptInput, keptValue }) => {
    render(<Host initial={{ customerName: 'LEGACY NAME' }} />);
    fireEvent.change(lastInput(), { target: { value: 'LEE' } });
    expect(latest.customerLastName).toBe('LEE');
    expect(latest.customerFirstName).toBe('');
    expect(latest.customerName).toBe('');
    fireEvent.change(firstInput(), { target: { value: 'SOO JIN' } });
    expect(latest.customerName).toBe('LEE SOO JIN');

    remount();
    expect(lastInput().value).toBe('LEE');
    expect(firstInput().value).toBe('SOO JIN');
    expect(latest.customerName).toBe('LEE SOO JIN');

    fireEvent.change(clearInput(), { target: { value: '' } });
    const expectSplit = () => {
      expect(latest.customerLastName).toBe(cleared === 'lastName' ? '' : 'LEE');
      expect(latest.customerFirstName).toBe(cleared === 'firstName' ? '' : 'SOO JIN');
      expect(latest.customerName).toBe('');
    };
    expectSplit();

    remount();
    expect(clearInput().value).toBe('');
    expect(keptInput().value).toBe(keptValue);
    expectSplit();
  });
});

describe('Step5 flight number restore', () => {
  const lookedUp = { scheduledTime: '10:00', estimatedTime: '10:20', gate: 'A1', origin: 'TAIPEI', status: 'Arrived', lookedUp: true };
  const airportInitial = (): Partial<WizardState> => ({
    service: 'airport_transfer',
    airport: { flightNumber: 'KE123', terminal: 'T2', arrival: { ...lookedUp }, luggage: { small: 1, medium: 0, large: 2 } },
  });

  it('같은 편명 복원 — arrival·terminal·luggage 보존 (마운트, 무관한 입력, 재마운트)', () => {
    const initial = airportInitial();
    const snapshot = JSON.stringify(initial.airport);
    render(<Host initial={initial} />);
    expect(flightInput().value).toBe('KE123');
    expect(JSON.stringify(latest.airport)).toBe(snapshot);
    fireEvent.change(emailInput(), { target: { value: 'x@y.z' } });
    expect(JSON.stringify(latest.airport)).toBe(snapshot);
    remount();
    expect(flightInput().value).toBe('KE123');
    expect(JSON.stringify(latest.airport)).toBe(snapshot);
  });

  it('실제 편명 변경 — arrival 무효화 (기존 정책), 재마운트 시 새 편명 복원', () => {
    render(<Host initial={airportInitial()} />);
    fireEvent.change(flightInput(), { target: { value: 'oz521' } });
    expect(latest.airport?.flightNumber).toBe('OZ521');
    expect(latest.airport?.arrival).toBeUndefined();
    expect(latest.airport?.terminal).toBe('T2');
    expect(latest.airport?.luggage).toEqual({ small: 1, medium: 0, large: 2 });
    remount();
    expect(flightInput().value).toBe('OZ521');
  });

  it('편명 삭제 — flightNumber "" + arrival 무효화, 재마운트 후에도 빈 값', () => {
    render(<Host initial={airportInitial()} />);
    fireEvent.change(flightInput(), { target: { value: '' } });
    expect(latest.airport?.flightNumber).toBe('');
    expect(latest.airport?.arrival).toBeUndefined();
    remount();
    expect(flightInput().value).toBe('');
    expect(latest.airport?.flightNumber).toBe('');
  });

  it('조회 네트워크 호출 없음', () => {
    render(<Host initial={airportInitial()} />);
    remount();
    expect(fetch).not.toHaveBeenCalled();
  });
});
