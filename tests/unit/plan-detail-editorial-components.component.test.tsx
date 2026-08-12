// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlanDocumentMasthead } from '../../src/pages/PlanDetailPage/components/PlanDocumentMasthead';
import { getPlanDocumentStatus } from '../../src/pages/PlanDetailPage/lib/planStats';
import { PlanDocumentState } from '../../src/pages/PlanDetailPage/components/PlanDocumentState';
import { ConfirmDialog } from '../../src/pages/PlanDetailPage/components/ConfirmDialog';
import { ReviewWriteModal } from '../../src/components/ReviewWriteModal';
import type { PlanDocument } from '../../src/pages/PlanDetailPage/types';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { uid: 'reviewer-1', displayName: 'Reviewer', photoURL: null } }),
}));

vi.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    language: 'en',
    t: {
      a11y: { close: 'Close' },
      reviews: { errSubmit: 'Could not submit', errNetwork: 'Network error', submitting: 'Submitting', rewardNote: 'Reward note' },
      planDetail: {
        reviews: {
          writeButton: 'Write a review',
          rating: 'Your rating',
          placeholder: 'Share your experience',
          charLimit: '{used}/500',
          photoUpload: 'Add photos',
          photoSize: 'Photos must be under 5MB',
          photoType: 'Only image files can be added',
          photoLabel: 'Review photo {index}',
          removePhoto: 'Remove photo {index}',
          photoUploading: 'Uploading',
          ratingRequired: 'Please select a rating',
          rewardToast: 'Thanks',
          submit: 'Submit review',
          alreadyReviewed: 'Already reviewed',
        },
      },
    },
  }),
}));

vi.mock('@/lib/firebase', () => ({ storage: {} }));
vi.mock('firebase/storage', () => ({
  ref: vi.fn(),
  uploadBytes: vi.fn(),
  getDownloadURL: vi.fn(),
}));

const mastheadUi = {
  documentEyebrow: 'Trip working document',
  documentBuilding: 'Building',
  documentPartial: 'Partial',
  documentReady: 'Ready',
  documentStartDate: 'Start date',
  documentIntro: 'Review the itinerary.',
  documentRouteNote: 'Route details are factual.',
  planStatDays: 'Days',
  planStatStops: 'Stops',
  planStatTravelers: 'Travelers',
  pdfDefaultTitle: 'Korea trip',
};

const stateUi = {
  loadingPlan: 'Loading plan',
  documentPartial: 'Partial plan',
  partialPlanBody: 'Some details are still loading.',
  planNotFound: 'Plan not found',
  planNotFoundDesc: 'Check the link.',
  emptyPlanTitle: 'No itinerary yet',
  emptyPlanBody: 'Create a plan to continue.',
  accessDenied: 'Access denied',
  accessDeniedDesc: 'This plan is private.',
  sessionExpiredTitle: 'Session expired',
  sessionExpiredBody: 'Refresh and try again.',
  planErrorTitle: 'Plan unavailable',
  planErrorDesc: 'Try again later.',
  refreshPage: 'Refresh',
};

function planWithInput(input: Record<string, unknown>): PlanDocument {
  return {
    input,
    itinerary: { tour_title: 'Seoul plan', days: [] },
  } as unknown as PlanDocument;
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.style.overflow = '';
});

describe('plan detail editorial components', () => {
  it('renders terminal document states without a second card surface', () => {
    const { rerender } = render(<PlanDocumentState kind="permission" ui={stateUi} />);
    expect(screen.getByTestId('plan-detail-permission').querySelector('.ec-card .ec-root')).toBeNull();

    rerender(<PlanDocumentState kind="empty" ui={stateUi} />);
    expect(screen.getByTestId('plan-detail-empty').querySelector('.ec-card .ec-root')).toBeNull();
  });

  it('does not add children twice when pax already contains the party total', () => {
    const { rerender } = render(
      <PlanDocumentMasthead plan={planWithInput({ pax: 4, children: 2 })} status="ready" ui={mastheadUi} />,
    );
    expect(within(screen.getByText('Travelers').parentElement as HTMLElement).getByText('4')).toBeTruthy();

    rerender(
      <PlanDocumentMasthead plan={planWithInput({ adults: 2, children: 1 })} status="ready" ui={mastheadUi} />,
    );
    expect(within(screen.getByText('Travelers').parentElement as HTMLElement).getByText('3')).toBeTruthy();
  });

  it('recognizes both current and legacy truncated plan shapes', () => {
    expect(getPlanDocumentStatus({ __truncated: true }, false)).toBe('partial');
    expect(getPlanDocumentStatus({ itinerary: { _truncated_days: 2 } }, false)).toBe('partial');
    expect(getPlanDocumentStatus({ __truncated: true }, true)).toBe('building');
  });

  it('keeps modal focus stable across parent callback rerenders', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    const restoreFocus = vi.spyOn(trigger, 'focus');
    const firstCancel = vi.fn();
    const latestCancel = vi.fn();
    const { rerender, unmount } = render(
      <ConfirmDialog open title="Remove stop?" onConfirm={vi.fn()} onCancel={firstCancel} />,
    );

    rerender(<ConfirmDialog open title="Remove stop?" onConfirm={vi.fn()} onCancel={latestCancel} />);
    expect(document.body.style.overflow).toBe('hidden');
    expect(restoreFocus).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(firstCancel).not.toHaveBeenCalled();
    expect(latestCancel).toHaveBeenCalledTimes(1);

    unmount();
    expect(restoreFocus).toHaveBeenCalledTimes(1);
    trigger.remove();
  });

  it('excludes lodging bookends from the visible stop total', () => {
    render(
      <PlanDocumentMasthead
        plan={{
          itinerary: {
            tour_title: 'Seoul plan',
            days: [{ stops: [{ category: 'lodging' }, { category: 'culture' }] }],
          },
        }}
        status="ready"
        ui={mastheadUi}
      />,
    );
    expect(within(screen.getByText('Stops').parentElement as HTMLElement).getByText('1')).toBeTruthy();
  });

  it('keeps an invalid photo error visible in the paper review modal', () => {
    render(
      <ReviewWriteModal
        targetType="plan"
        targetId="plan-1"
        surface="paper"
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );

    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    fireEvent.change(input as HTMLInputElement, {
      target: { files: [new File(['plain text'], 'notes.txt', { type: 'text/plain' })] },
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Only image files can be added');
  });
});
