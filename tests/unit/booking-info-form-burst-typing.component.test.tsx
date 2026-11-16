// @vitest-environment jsdom
/**
 * BookingInfoForm — 아주 빠른 연속 입력에서 React #185(Maximum update depth exceeded) 금지 (2026-11-16).
 *
 * 원인(Sentry 11/12, Preview 투어 예약창): 폼이 입력값을 부모로 넘기는 일을 **passive effect** 에서 했다.
 *   키 입력(Sync 렌더) → 커밋 끝에 effect 가 부모 setState(Default 레인) → 그 렌더는 다음 매크로태스크에서야 돈다.
 *   키가 그 사이 없이 연달아 들어오면(자동 입력·느린 기기) React 가 "중첩 갱신"으로 세다가 51번째에 #185 를 던진다.
 *   화면은 멀쩡하고 글자 하나가 빠진다. 투어(픽업·메신저·요청사항)와 차터(Step5)가 같은 폼을 쓴다.
 *
 * 이 시험은 act() 없이 진짜 input 이벤트를 연달아 보낸다 — act 는 키마다 일을 다 비워서 재현이 안 된다.
 * 부모는 TourBookingDialog 와 같은 모양(값 있을 때만 set)이다.
 */
import React, { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../src/components/charter/AddressAutocomplete', () => ({ AddressAutocomplete: () => null }));
vi.mock('../../src/components/booking/CountryDialPicker', () => ({ CountryDialPicker: () => null }));

import { BookingInfoForm, type BookingFormData } from '../../src/components/booking/BookingInfoForm';

type ParentState = { pickupAddress: string; memoText: string; messenger: string };

function TourLikeParent() {
  const [pickupAddress, setPickupAddress] = useState('');
  const [memoText, setMemoText] = useState('');
  const [messenger, setMessenger] = useState('');
  const [phone, setPhone] = useState('');
  return (
    <>
    <output data-parent={JSON.stringify({ pickupAddress, memoText, messenger })} />
    <BookingInfoForm
      eyebrow="e" title="t" dateText="d" paxText="p" isAirport={false} meetingLabel="Pickup"
      baseStr="-" meetingStr="" childSeatStr="" totalStr="-" usdStr="" ctaLabel="Pay" lang="en"
      phone={phone} onPhoneChange={setPhone}
      onFieldsChange={(d: BookingFormData) => {
        if (d.meetingPlace) setPickupAddress(d.meetingPlace);
        if (d.notes) setMemoText(d.notes);
        if (d.messengerId) setMessenger(`${d.messenger}: ${d.messengerId}`);
      }}
      hideAddons hideDiscount hideCta onSubmit={() => {}}
    />
    </>
  );
}

const macrotask = () => new Promise<void>((r) => setTimeout(r, 0));
const TEXT = 'Lotte Hotel Seoul, 30 Eulji-ro, Jung-gu, Seoul 04533, Korea - lobby 9am';

let container: HTMLDivElement;
let root: Root;
let caught: string[];
const onWinErr = (ev: ErrorEvent) => { caught.push(String(ev.message || ev.error)); ev.preventDefault(); };

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network disabled in unit test'))));
  if (typeof window.matchMedia !== 'function') {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: false, media: q, onchange: null, addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    }));
  }
  caught = [];
  window.addEventListener('error', onWinErr);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container, { onUncaughtError: (e) => { caught.push(String((e as Error)?.message || e)); } });
  root.render(<MemoryRouter><TourLikeParent /></MemoryRouter>);
  for (let i = 0; i < 4; i++) await macrotask();
});

afterEach(async () => {
  root.unmount();
  container.remove();
  window.removeEventListener('error', onWinErr);
  vi.unstubAllGlobals();
  for (let i = 0; i < 2; i++) await macrotask();
});

const FIELDS: Record<string, () => HTMLInputElement | HTMLTextAreaElement | null> = {
  notes: () => container.querySelector('textarea'),
  messengerId: () => container.querySelector('.customer-booking-messenger-row input'),
  pickup: () => container.querySelector('input[placeholder^="e.g. L7 Myeongdong"]'),
};

async function burst(el: HTMLInputElement | HTMLTextAreaElement, n: number) {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setValue = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  for (let i = 0; i < n; i++) {
    setValue.call(el, el.value + TEXT[i % TEXT.length]);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve(); // 마이크로태스크만 — 스케줄러(매크로태스크)는 키 사이에 못 돈다
  }
  for (let i = 0; i < 6; i++) await macrotask();
}

describe('BookingInfoForm 빠른 연속 입력 (#185)', () => {
  it.each(['notes', 'messengerId', 'pickup'])('%s — 80자를 쉬지 않고 넣어도 오류 없이 부모 값과 같다', async (field) => {
    const el = FIELDS[field]();
    expect(el, `${field} 입력칸`).toBeTruthy();
    await burst(el!, 80);
    expect(caught).toEqual([]);
    const typed = TEXT.repeat(2).slice(0, 80);
    expect(FIELDS[field]()!.value).toBe(typed);
    const parentState: ParentState = JSON.parse(container.querySelector('output')!.getAttribute('data-parent')!);
    if (field === 'notes') expect(parentState.memoText).toBe(typed);
    if (field === 'pickup') expect(parentState.pickupAddress).toBe(typed);
    if (field === 'messengerId') expect(parentState.messenger).toBe(`WhatsApp: ${typed}`);
  });
});
