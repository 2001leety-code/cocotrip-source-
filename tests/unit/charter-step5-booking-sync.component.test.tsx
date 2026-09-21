// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Step5DateOptions } from '../../src/components/charter/Step5DateOptions';
import type { WizardState } from '../../src/components/charter/types';

void React;

const initialState: WizardState = {
  origin: 'ICN',
  service: 'airport_transfer',
  destinationKey: 'seoul-central',
  vehicle: 'bus',
  paxCount: 2,
  startDate: '2099-06-15',
  pickupTime: '10:00',
  customerName: 'PROFILE GUEST',
  customerPhone: '+82 1012345678',
  options: {},
  airport: {
    flightNumber: 'KE123',
    terminal: 'T1',
    luggage: { small: 1, medium: 2, large: 3 },
    arrival: { scheduledTime: '12:00', gate: '1', origin: 'TPE', lookedUp: true },
  },
};

function Harness() {
  const [state, setState] = useState(initialState);
  return (
    <MemoryRouter>
      <Step5DateOptions
        state={state}
        patch={(next) => setState((previous) => ({ ...previous, ...next }))}
        language="en"
        termsAgreed={false}
        onTermsChange={() => {}}
      />
      <output data-testid="customer-name">{state.customerName || '(empty)'}</output>
      <output data-testid="airport-state">{JSON.stringify(state.airport)}</output>
    </MemoryRouter>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

describe('Step 5 booking field synchronization', () => {
  it('preserves prefill on mount and unrelated edits, then clears name and arrival safely', async () => {
    render(<Harness />);
    const airportState = () => JSON.parse(screen.getByTestId('airport-state').textContent || '{}') as WizardState['airport'];

    await waitFor(() => expect(screen.getByTestId('customer-name')).toHaveTextContent('PROFILE GUEST'));
    fireEvent.change(screen.getByPlaceholderText(/specific pickup time/i), { target: { value: 'Window seat' } });
    await waitFor(() => expect(screen.getByTestId('customer-name')).toHaveTextContent('PROFILE GUEST'));
    expect(airportState()).toEqual(initialState.airport);

    fireEvent.change(screen.getByPlaceholderText('HONG'), { target: { value: 'HONG' } });
    fireEvent.change(screen.getByPlaceholderText('GILDONG'), { target: { value: 'GILDONG' } });
    await waitFor(() => expect(screen.getByTestId('customer-name')).toHaveTextContent('HONG GILDONG'));
    fireEvent.change(screen.getByPlaceholderText('HONG'), { target: { value: '' } });
    await waitFor(() => expect(screen.getByTestId('customer-name')).toHaveTextContent('(empty)'));

    fireEvent.change(screen.getByPlaceholderText('HONG'), { target: { value: 'HONG' } });
    const flight = screen.getByPlaceholderText(/KE5760|OZ521/i);
    fireEvent.change(flight, { target: { value: 'KE123' } });
    await waitFor(() => expect(airportState()).toEqual(expect.objectContaining({
      flightNumber: 'KE123',
      terminal: 'T1',
      luggage: { small: 1, medium: 2, large: 3 },
      arrival: expect.objectContaining({ scheduledTime: '12:00', lookedUp: true }),
    })));
    fireEvent.change(flight, { target: { value: '' } });
    await waitFor(() => expect(airportState()).toEqual(expect.objectContaining({
      flightNumber: '',
      terminal: 'T1',
      luggage: { small: 1, medium: 2, large: 3 },
    })));
    expect(airportState()?.arrival).toBeUndefined();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
