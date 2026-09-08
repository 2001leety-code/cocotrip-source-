// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OwnerDispatchReadiness, type OwnerDispatchReadinessSnapshot } from '@/components/OwnerDispatchReadiness';
import { ownerDispatchReadinessCopy } from '@/components/ownerDispatchReadinessCopy';
import type { Language } from '@/i18n';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const states = ['off', 'configuration_required', 'configured', 'unknown'] as const;
const languages: Language[] = ['ko', 'en', 'ja', 'zh'];

describe('owner dispatch readiness display', () => {
  it.each(languages)('%s shows each server state separately from actual receipt and unconnected channels', (language) => {
    const copy = ownerDispatchReadinessCopy[language];
    for (const state of states) {
      const view = render(<OwnerDispatchReadiness readiness={{ state, deliveryVerified: false }} language={language} />);
      expect(screen.getByRole('region', { name: copy.title })).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent(copy.labels[state]);
      expect(screen.getByText(copy.descriptions[state]).closest('details')).toBeNull();
      expect(screen.getByText(copy.delivery).closest('details')).toBeNull();
      expect(screen.getByText(copy.unavailable).closest('details')).toBeNull();
      expect(screen.getByText(copy.details)).toHaveClass('min-h-[44px]');
      expect(screen.getByText(copy.setup)).toHaveTextContent('Vercel');
      view.unmount();
    }
  });

  it.each([undefined, null])('does not turn absent data %j into OFF or configured', (readiness) => {
    render(<OwnerDispatchReadiness readiness={readiness} />);
    expect(screen.getByRole('status')).toHaveTextContent(ownerDispatchReadinessCopy.ko.labels.unknown);
  });

  it('does not render unknown server strings, private fields or a claimed delivery confirmation', () => {
    const privateData = {
      state: 'private-state@example.invalid', deliveryVerified: true,
      uid: 'private-uid', endpoint: 'https://example.invalid/private-subscription',
    } as unknown as OwnerDispatchReadinessSnapshot;
    const { container } = render(<OwnerDispatchReadiness readiness={privateData} />);
    expect(screen.getByRole('status')).toHaveTextContent(ownerDispatchReadinessCopy.ko.labels.unknown);
    expect(container.textContent).not.toContain('private-');
    expect(screen.getByText(ownerDispatchReadinessCopy.ko.delivery)).toBeInTheDocument();
  });

  it.each(languages)('%s shows checking rather than stale configuration during refresh', (language) => {
    const copy = ownerDispatchReadinessCopy[language];
    const view = render(<OwnerDispatchReadiness language={language} readiness={{ state: 'configured', deliveryVerified: false }} />);
    expect(screen.getByRole('status')).toHaveTextContent(copy.labels.configured);
    view.rerender(<OwnerDispatchReadiness language={language} readiness={{ state: 'configured', deliveryVerified: false }} loading />);
    expect(screen.getByRole('status')).toHaveTextContent(copy.checking);
    expect(screen.queryByText(copy.descriptions.configured)).not.toBeInTheDocument();
    expect(screen.getByText(copy.delivery)).toBeInTheDocument();
  });

  it('does not fetch, request permission or send a notification when rendered or details are opened', () => {
    const fetch = vi.fn();
    const requestPermission = vi.fn();
    const notification = vi.fn();
    Object.assign(notification, { requestPermission });
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('Notification', notification);
    render(<OwnerDispatchReadiness readiness={{ state: 'configured', deliveryVerified: false }} />);
    fireEvent.click(screen.getByText(ownerDispatchReadinessCopy.ko.details));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(notification).not.toHaveBeenCalled();
  });
});
