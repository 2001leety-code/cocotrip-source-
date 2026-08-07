// @vitest-environment jsdom
/**
 * 투어 슬롯 정원(capacity) 배선 — 죽어 있던 오버부킹 방지 활성화 (2026-08-08).
 *
 * 🔴 고친 문제
 *   - 백엔드는 완성돼 있었다: `api/_shared/slot-capacity.js` 의 acquireSlotLock/confirmSlotLock 가
 *     트랜잭션으로 pending/confirmed 를 세고 정원 초과면 SLOT_FULL 로 주문 생성 자체를 막는다.
 *   - 그런데 두 endpoint 는 **body 에 tourId·tourSlotId·bookingDate·slotCapacity 4개가 전부
 *     있을 때만** 그 잠금을 호출하고, 없으면 조용히 스킵한다.
 *   - 프론트(TourBookingDialog)는 고른 슬롯을 결제 메모 문자열에만 넣고 4필드를 안 보냈다
 *     (`// TODO: slot id forward to backend`) → 정원 강제가 한 번도 걸린 적이 없다 = 오버부킹 가능.
 *
 * 이 파일이 잠그는 것
 *   1) 슬롯을 고른 예약은 create·capture **두 요청 모두**에 4필드가 실린다.
 *   2) 슬롯 없는 투어(정원 미설정)는 4필드가 전혀 안 실린다 — 백엔드 스킵 = 기존 동작 보존.
 *   3) 프론트가 쓰는 키 이름이 백엔드가 읽는 이름과 글자까지 같다(파리티 — 오타 1글자면 다시 죽는다).
 *   4) SLOT_FULL / DATE_UNAVAILABLE 거절이 손님에게 4개 언어로 보인다(서버 진단 영어 노출 금지).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'fs';
import { join } from 'path';

const { authFetchMock } = vi.hoisted(() => ({ authFetchMock: vi.fn() }));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useLoyalty', () => ({ useLoyalty: () => ({ activeCoupons: [] }) }));
vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));
vi.mock('@/lib/analytics', () => ({
  trackPaidConversion: vi.fn(),
  trackBeginCheckout: vi.fn(),
  getAttributionSnapshot: () => null,
}));
vi.mock('@/lib/authFetch', () => ({ authFetch: (...args: unknown[]) => authFetchMock(...args) }));

import { PayPalBookingButton } from '@/components/PayPalBookingButton';
import { tourSlotBody, resolveSlotCapacity } from '@/lib/tourSlotBooking';

function src(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

/** 백엔드가 읽는 이름 — 이 배열이 곧 계약이다. */
const BACKEND_KEYS = ['bookingDate', 'slotCapacity', 'tourId', 'tourSlotId'] as const;

const SLOT_PROPS = {
  tourId: 'tour_admin_abc',
  tourSlotId: 'slot_am',
  bookingDate: '2026-09-01',
  slotCapacity: 8,
};

type PaypalButtonsConfig = {
  createOrder: () => string;
  onApprove: (d: { orderID: string }) => Promise<void>;
};

let capturedConfig: PaypalButtonsConfig | null = null;
let fetchMock: ReturnType<typeof vi.fn>;

function okOrderResponse() {
  return {
    ok: true,
    json: async () => ({
      ok: true,
      data: {
        orderID: 'ORDER-1',
        usdAmount: '107.14',
        currentRate: 1400,
        displayKRW: '₩150,000',
        displayUSD: '$107.14 USD',
      },
    }),
  };
}

function renderButton(extra: Record<string, unknown> = {}, lang = 'en') {
  return render(
    <MemoryRouter>
      <PayPalBookingButton
        productType="tour_test"
        passengers={3}
        dateStart="2026-09-01"
        dateEnd="2026-09-01"
        priceKRW={150000}
        lang={lang}
        p={{ paypalBookBtn: 'PAY NOW' }}
        {...extra}
      />
    </MemoryRouter>,
  );
}

async function clickPay() {
  const btn = screen.getByText('PAY NOW').closest('button');
  expect(btn).toBeTruthy();
  await act(async () => {
    fireEvent.click(btn!);
  });
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
}

function createBody(): Record<string, unknown> {
  const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('createPaypalOrder'));
  expect(call, 'createPaypalOrder 호출 없음').toBeTruthy();
  return JSON.parse((call![1] as { body: string }).body);
}

function captureBody(): Record<string, unknown> {
  const call = authFetchMock.mock.calls.find((c) => String(c[0]).includes('capturePaypalOrder'));
  expect(call, 'capturePaypalOrder 호출 없음').toBeTruthy();
  return JSON.parse((call![1] as { body: string }).body);
}

beforeEach(() => {
  capturedConfig = null;
  vi.stubEnv('VITE_PAYPAL_CLIENT_ID', 'test-client-id');
  fetchMock = vi.fn(async () => okOrderResponse());
  vi.stubGlobal('fetch', fetchMock);
  authFetchMock.mockReset();
  authFetchMock.mockResolvedValue({
    json: async () => ({
      ok: true,
      data: { orderID: 'ORDER-1', payerName: 'Test Payer', payerEmail: 't@example.com', amount: '107.14' },
    }),
  });
  (window as unknown as { paypal: unknown }).paypal = {
    Buttons: (cfg: PaypalButtonsConfig) => {
      capturedConfig = cfg;
      return { render: () => {}, isEligible: () => true };
    },
    FUNDING: {},
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  delete (window as unknown as { paypal?: unknown }).paypal;
});

describe('tourSlotBody — 4필드 all-or-nothing (백엔드 게이트와 동형)', () => {
  it('4개 전부 유효하면 그대로 실어 보낸다', () => {
    expect(tourSlotBody(SLOT_PROPS)).toEqual(SLOT_PROPS);
  });

  it('반환 키는 백엔드가 읽는 이름과 정확히 일치한다', () => {
    expect(Object.keys(tourSlotBody(SLOT_PROPS)).sort()).toEqual([...BACKEND_KEYS]);
  });

  it('하나라도 없으면 빈 객체 — 반쪽 전송 금지(백엔드가 조용히 스킵하는 상태를 만들지 않는다)', () => {
    for (const k of BACKEND_KEYS) {
      const partial: Record<string, unknown> = { ...SLOT_PROPS };
      delete partial[k];
      expect(tourSlotBody(partial), `${k} 없을 때 빈 객체여야 한다`).toEqual({});
    }
    expect(tourSlotBody(undefined)).toEqual({});
    expect(tourSlotBody({})).toEqual({});
  });

  it('capacity 가 0·음수·NaN 이면 보내지 않는다 (0 = 백엔드에서 전원 차단)', () => {
    for (const bad of [0, -1, Number.NaN]) {
      expect(tourSlotBody({ ...SLOT_PROPS, slotCapacity: bad })).toEqual({});
    }
  });

  it('공백 문자열은 값이 아니다', () => {
    expect(tourSlotBody({ ...SLOT_PROPS, tourSlotId: '   ' })).toEqual({});
    expect(tourSlotBody({ ...SLOT_PROPS, bookingDate: '' })).toEqual({});
  });
});

describe('resolveSlotCapacity — 슬롯 정원 출처', () => {
  it('슬롯에 capacity 가 있으면 그 값', () => {
    expect(resolveSlotCapacity(4, 7)).toBe(4);
  });

  it('슬롯 capacity 미설정이면 tour.maxPax 폴백 (slot-capacity.js·validateSlotNumeric 이 명시한 규칙)', () => {
    expect(resolveSlotCapacity(undefined, 7)).toBe(7);
    expect(resolveSlotCapacity(null, 7)).toBe(7);
  });

  it('둘 다 없으면 undefined — tourSlotBody 가 전송을 막는다', () => {
    expect(resolveSlotCapacity(undefined, undefined)).toBeUndefined();
    expect(resolveSlotCapacity(0, 0)).toBeUndefined();
  });
});

describe('필드명 파리티 — 프론트 키 == 백엔드가 읽는 이름', () => {
  const createSrc = src('api/createPaypalOrder.js');
  const captureSrc = src('api/capturePaypalOrder.js');

  it('createPaypalOrder 가 body 에서 같은 이름으로 읽는다', () => {
    for (const k of Object.keys(tourSlotBody(SLOT_PROPS))) {
      expect(createSrc, `createPaypalOrder 가 body.${k} 를 읽지 않는다`).toContain(`body.${k}`);
    }
  });

  it('capturePaypalOrder 가 body 에서 같은 이름으로 구조분해한다', () => {
    expect(captureSrc).toMatch(/tourId,\s*tourSlotId,\s*bookingDate,\s*slotCapacity,/);
    for (const k of Object.keys(tourSlotBody(SLOT_PROPS))) {
      expect(captureSrc, `capturePaypalOrder 가 ${k} 를 안 읽는다`).toMatch(new RegExp(`\\b${k}\\b`));
    }
  });
});

describe('결제 요청 — 슬롯 있는 예약', () => {
  it('create 요청 body 에 4필드가 실린다', async () => {
    renderButton(SLOT_PROPS);
    await clickPay();
    const body = createBody();
    expect(body.tourId).toBe(SLOT_PROPS.tourId);
    expect(body.tourSlotId).toBe(SLOT_PROPS.tourSlotId);
    expect(body.bookingDate).toBe(SLOT_PROPS.bookingDate);
    expect(body.slotCapacity).toBe(SLOT_PROPS.slotCapacity);
  });

  it('capture 요청 body 에도 같은 4필드가 실린다 (create 만 보내면 pending 이 confirmed 로 안 넘어간다)', async () => {
    renderButton(SLOT_PROPS);
    await clickPay();
    await waitFor(() => expect(capturedConfig).toBeTruthy());
    await act(async () => {
      await capturedConfig!.onApprove({ orderID: 'ORDER-1' });
    });
    const body = captureBody();
    expect(body.tourId).toBe(SLOT_PROPS.tourId);
    expect(body.tourSlotId).toBe(SLOT_PROPS.tourSlotId);
    expect(body.bookingDate).toBe(SLOT_PROPS.bookingDate);
    expect(body.slotCapacity).toBe(SLOT_PROPS.slotCapacity);
  });
});

describe('결제 요청 — 슬롯 없는 투어는 기존 동작 그대로', () => {
  it('create·capture 어느 쪽에도 4필드가 없다', async () => {
    renderButton();
    await clickPay();
    const cBody = createBody();
    for (const k of BACKEND_KEYS) {
      expect(cBody, `슬롯 없는데 create 에 ${k} 가 실렸다`).not.toHaveProperty(k);
    }
    await waitFor(() => expect(capturedConfig).toBeTruthy());
    await act(async () => {
      await capturedConfig!.onApprove({ orderID: 'ORDER-1' });
    });
    const capBody = captureBody();
    for (const k of BACKEND_KEYS) {
      expect(capBody, `슬롯 없는데 capture 에 ${k} 가 실렸다`).not.toHaveProperty(k);
    }
  });

  it('슬롯 일부만 넘겨도 반쪽 전송이 되지 않는다', async () => {
    renderButton({ tourId: 'tour_admin_abc', tourSlotId: 'slot_am' });
    await clickPay();
    const body = createBody();
    for (const k of BACKEND_KEYS) {
      expect(body).not.toHaveProperty(k);
    }
  });
});

describe('정원 초과 거절이 손님에게 보인다 (4개 언어)', () => {
  const CASES = [
    { code: 'SLOT_FULL', raw: 'Slot full: requested=3, confirmed=6, pending=0, capacity=8', status: 409 },
    { code: 'DATE_UNAVAILABLE', raw: 'Date 2026-09-01 is fully_booked', status: 410 },
  ] as const;

  for (const c of CASES) {
    for (const lang of ['ko', 'en', 'ja', 'zh'] as const) {
      it(`${c.code} / ${lang}: 서버 진단 영어가 아니라 안내 문구가 뜬다`, async () => {
        fetchMock.mockResolvedValue({
          ok: false,
          json: async () => ({ ok: false, error: c.raw, code: c.code }),
        });
        renderButton(SLOT_PROPS, lang);
        await clickPay();
        await waitFor(() => {
          expect(document.body.textContent).not.toContain(c.raw);
        });
        const alertBox = document.querySelector('.border-red-500\\/30');
        expect(alertBox, '오류 안내 박스가 없다').toBeTruthy();
        expect((alertBox!.textContent || '').length).toBeGreaterThan(10);
      });
    }
  }

  it('한국어 문구가 "마감" 을 말한다', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ ok: false, error: 'Slot full: requested=3', code: 'SLOT_FULL' }),
    });
    renderButton(SLOT_PROPS, 'ko');
    await clickPay();
    await waitFor(() => expect(document.body.textContent).toContain('마감'));
  });
});

describe('TourBookingDialog 배선 (소스 잠금)', () => {
  const dialog = src('src/components/tours/TourBookingDialog.tsx');

  it('죽은 TODO 가 사라졌다', () => {
    expect(dialog).not.toContain('TODO: slot id forward to backend');
  });

  it('슬롯이 선택됐을 때만 4필드를 넘긴다', () => {
    expect(dialog).toMatch(/selectedSlot\s*&&\s*slotCapacityForOrder/);
    expect(dialog).toContain('tourSlotId: selectedSlot.id');
    expect(dialog).toContain('resolveSlotCapacity(');
  });
});
