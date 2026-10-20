// @vitest-environment jsdom
/**
 * TourBookingDialog 추가 옵션 토글 접근성 (2026-10-19 후속 배치).
 *
 * 잠그는 것
 *   1) 투어 적용 애드온마다 기존 라벨 이름의 버튼이 aria-pressed=false 로 시작한다.
 *   2) 클릭 → aria-pressed=true, 다시 클릭 → false (기존 toggleAddon 그대로).
 *   3) 장식 체크 박스는 aria-hidden 이라 버튼 이름에 섞이지 않는다.
 *   4) 한 애드온을 켜도 다른 애드온은 꺼진 채다.
 *   5) 애드온은 현장 결제라 표시 총액(=청구가) 문자열이 토글 전후 같다.
 * 네트워크 없음 — fetch 는 실패 stub, 인증·프로필·가용성·결제 컴포넌트는 로컬 mock.
 * 키보드(Space/Enter) 실제 토글은 jsdom 이 네이티브 button 활성화를 재현하지 않아 여기서 잠그지 않는다.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/lib/firebase', () => ({ auth: { currentUser: null }, db: {} }));
vi.mock('@/lib/firebase-auth', () => ({ auth: { currentUser: null } }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useUserProfile', () => ({ useUserProfile: () => ({ profile: null }) }));
vi.mock('@/hooks/useProfileContactSync', () => ({ useProfileContactSync: () => {} }));
vi.mock('@/lib/tour-availability-store', () => ({ fetchMonthAvailability: async () => new Map() }));
vi.mock('@/lib/analytics', () => ({
  trackDateSelect: () => {}, trackTourBookingStart: () => {}, trackTourStep: () => {},
}));
vi.mock('@/components/PayPalBookingButton', () => ({ PayPalBookingButton: () => null }));
vi.mock('@/components/CartButton', () => ({ CartAddButton: () => null }));
vi.mock('@/components/booking/BookingInfoForm', () => ({ BookingInfoForm: () => null }));
vi.mock('@/components/tours/SlotPicker', () => ({ SlotPicker: () => null }));

import { TourBookingDialog } from '../../src/components/tours/TourBookingDialog';
import pricingSpec from '../../src/data/pricing_spec.json';
import { TOURS, type Tour } from '../../src/data/tours';

type SpecAddon = { id: string; labels: { en: string }; applies_to: string[] };

// 컴포넌트 visibleAddons 와 같은 규칙: 투어 적용, 기사언어·한복 제외, stops 없음 → attraction_pass 미노출.
const VISIBLE_ADDONS: SpecAddon[] = (((pricingSpec as { addons?: { items?: SpecAddon[] } }).addons?.items) || [])
  .filter((a) => a.applies_to.includes('tour'))
  .filter((a) => !['japanese_driver', 'chinese_driver', 'hanbok_rental', 'attraction_pass'].includes(a.id));

const TOUR: Tour = { ...TOURS[0], driverLanguages: ['en'], stops: [] };

beforeEach(() => {
  localStorage.clear();
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

function openDialog() {
  render(
    <MemoryRouter>
      <TourBookingDialog tour={TOUR} language="en" trigger={<button type="button">Open booking</button>} />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Open booking' }));
  return screen.getByRole('dialog');
}

function addonButton(dialog: HTMLElement, label: string) {
  return within(dialog).getByRole('button', { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) });
}

describe('TourBookingDialog add-on toggle accessibility', () => {
  it('투어 애드온이 기존 라벨 이름의 버튼으로 aria-pressed=false 로 시작한다', () => {
    expect(VISIBLE_ADDONS.length).toBeGreaterThan(0);
    const dialog = openDialog();
    for (const a of VISIBLE_ADDONS) {
      const btn = addonButton(dialog, a.labels.en);
      expect(btn.getAttribute('aria-pressed')).toBe('false');
      expect(btn.classList.contains('customer-tour-addon-toggle')).toBe(true);
    }
  });

  it('클릭하면 aria-pressed 가 false → true → false 로 바뀐다', () => {
    const dialog = openDialog();
    const btn = addonButton(dialog, VISIBLE_ADDONS[0].labels.en);
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });

  it('장식 체크 박스는 aria-hidden 이고 선택 시에만 체크 아이콘을 담는다', () => {
    const dialog = openDialog();
    const btn = addonButton(dialog, VISIBLE_ADDONS[0].labels.en);
    const mark = btn.querySelector('.customer-tour-addon-mark');
    expect(mark).not.toBeNull();
    expect(mark?.getAttribute('aria-hidden')).toBe('true');
    expect(mark?.getAttribute('style')).toBeNull();
    expect(mark?.querySelector('svg')).toBeNull();
    fireEvent.click(btn);
    expect(mark?.querySelector('svg')).not.toBeNull();
  });

  it('한 애드온을 켜도 다른 애드온은 꺼진 채다', () => {
    const dialog = openDialog();
    const buttons = VISIBLE_ADDONS.map((a) => addonButton(dialog, a.labels.en));
    fireEvent.click(buttons[0]);
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
    for (const other of buttons.slice(1)) {
      expect(other.getAttribute('aria-pressed')).toBe('false');
    }
  });

  it('애드온 토글 전후 표시 총액 문자열이 같다 (현장 결제, 총액 미포함)', () => {
    const dialog = openDialog();
    const total = dialog.querySelector('.customer-booking-total');
    expect(total).not.toBeNull();
    const before = (total?.textContent || '').trim();
    expect(before).not.toBe('');
    expect(before).toMatch(/\d/);
    expect(before).not.toMatch(/NaN|undefined|null/);
    const btn = addonButton(dialog, VISIBLE_ADDONS[0].labels.en);
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect((dialog.querySelector('.customer-booking-total')?.textContent || '').trim()).toBe(before);
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect((dialog.querySelector('.customer-booking-total')?.textContent || '').trim()).toBe(before);
    for (const a of VISIBLE_ADDONS) fireEvent.click(addonButton(dialog, a.labels.en));
    expect((dialog.querySelector('.customer-booking-total')?.textContent || '').trim()).toBe(before);
  });
});
