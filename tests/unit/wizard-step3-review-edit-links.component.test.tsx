// @vitest-environment jsdom
//
// 2026-08-24 (planner-trust-course): WizardStep3Review's edit links pointed at
// the wrong steps — "Destination" jumped to step 0 (Reservation) and
// "Dates/Airport/Travelers" + the Back button jumped to step 2 (Food) instead
// of step 3 (Details). Locks the fix: destination -> step 1 (Destination),
// dates/airport/pax + Back -> step 3 (Details).
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

void React;
import { WizardStep3Review } from '../../src/components/WizardForm/WizardStep3Review';

function renderReview(onEditStep = vi.fn()) {
  render(
    <WizardStep3Review
      p={{}}
      allCities={['Seoul']}
      // startDate/endDate both inclusive — Sep 1-3 = 2 nights / 3 days.
      startDate="2026-09-01"
      endDate="2026-09-03"
      arrivalTerminal="ICN"
      pax={2}
      selectedActivities={['Food']}
      hotelAddress=""
      isLoading={false}
      errorMsg=""
      language="en"
      onEditStep={onEditStep}
      onGenerate={vi.fn()}
    />,
  );
  return onEditStep;
}

describe('WizardStep3Review edit links go to the right step', () => {
  it('Destination card jumps to step 1 (Destination), not step 0', () => {
    const onEditStep = renderReview();
    fireEvent.click(screen.getByText('Seoul').closest('button')!);
    expect(onEditStep).toHaveBeenCalledWith(1);
  });

  it('Dates card jumps to step 3 (Details), not step 2', () => {
    const onEditStep = renderReview();
    fireEvent.click(screen.getByText(/Sep 1/).closest('button')!);
    expect(onEditStep).toHaveBeenCalledWith(3);
  });

  it('Airport card jumps to step 3 (Details)', () => {
    const onEditStep = renderReview();
    fireEvent.click(screen.getByText('ICN').closest('button')!);
    expect(onEditStep).toHaveBeenCalledWith(3);
  });

  it('Travelers card jumps to step 3 (Details)', () => {
    const onEditStep = renderReview();
    fireEvent.click(screen.getByText(/2 pax/).closest('button')!);
    expect(onEditStep).toHaveBeenCalledWith(3);
  });

  it('Back button jumps to step 3 (Details), not step 2', () => {
    const onEditStep = renderReview();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onEditStep).toHaveBeenCalledWith(3);
  });
});
