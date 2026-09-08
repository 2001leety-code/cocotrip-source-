// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminRecordedAiUsage, type RecordedAiUsage } from '@/components/AdminRecordedAiUsage';
import { adminRecordedAiUsageCopy } from '@/components/adminRecordedAiUsageCopy';
import AdminAiOpsCenter, { type OpsCenterData } from '@/pages/AdminAiOpsCenter';
import { adminAiOpsCopy } from '@/lib/adminAiOpsCopy';
import type { Language } from '@/i18n';

void React;
const state = vi.hoisted(() => ({ getIdToken: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { getIdToken: state.getIdToken } }) }));
vi.mock('@/hooks/usePageMeta', () => ({ usePageMeta: vi.fn() }));
vi.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ language: 'ko', changeLanguage: vi.fn() }) }));
vi.mock('@/components/OwnerControllerSetupPanel', () => ({ OwnerControllerSetupPanel: () => null }));
vi.mock('@/components/OwnerNotificationSetup', () => ({ OwnerNotificationSetup: () => null }));

const languages: Language[] = ['ko', 'en', 'ja', 'zh'];
const now = '2026-09-08T02:00:00.000Z';
function usage(patch: Partial<RecordedAiUsage> = {}): RecordedAiUsage {
  return {
    source: 'api_usage', service: 'gemini', currency: 'USD', basis: 'stored-estimate',
    coverage: 'best-effort-records-only', actualBillConnected: false,
    status: 'ok', generatedAt: now, monthStart: '2026-08-31T15:00:00.000Z', todayStart: '2026-09-07T15:00:00.000Z',
    queryLimit: 500, recordedCostUsd: 1.25, todayRecordedCostUsd: 0.125,
    recordCount: 5, todayRecordCount: 2, excludedCount: 0, limitReached: false,
    latestRecordAt: '2026-09-08T01:00:00.000Z', ...patch,
  };
}
function period(label: string) {
  return screen.getByText(label).parentElement!;
}
function page(recordedAiUsage?: RecordedAiUsage) {
  const data: OpsCenterData = {
    generatedAt: now,
    summary: { actionRequired: 0, urgent: 0, todayReservations: 0, upcoming7d: 0, openInquiries: 0, openCs: 0, paymentReviews: 0, automationAttention: 0 },
    workItems: [], reservations: [], inboxItems: [], automation: [], sources: [], partialErrors: [],
    deduplication: { rule: 'synthetic', removedMirrorCount: 0 }, window: { perSourceLimit: 180, note: 'synthetic' },
    ...(recordedAiUsage ? { recordedAiUsage } : {}),
  };
  return <MemoryRouter><AdminAiOpsCenter previewData={data} /></MemoryRouter>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('SYNTHETIC_NETWORK_FORBIDDEN'); }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('recorded AI usage presentation', () => {
  it.each(languages)('%s displays existing estimates without billing claims or side effects', (language) => {
    const copy = adminRecordedAiUsageCopy[language];
    const data = usage();
    const original = JSON.stringify(data);
    render(<AdminRecordedAiUsage data={data} language={language} />);
    expect(screen.getByRole('region', { name: copy.title })).toBeVisible();
    expect(screen.getByText(copy.basis)).toBeVisible();
    expect(period(copy.today)).toHaveTextContent('USD');
    expect(period(copy.today)).toHaveTextContent('0.125');
    expect(period(copy.today)).toHaveTextContent(copy.records(2));
    expect(period(copy.month)).toHaveTextContent('1.25');
    expect(period(copy.month)).toHaveTextContent(copy.records(5));
    expect(screen.getByText(copy.coverage)).not.toBeVisible();
    expect(JSON.stringify(data)).toBe(original);
    expect(fetch).not.toHaveBeenCalled();
    expect(state.getIdToken).not.toHaveBeenCalled();
  });

  it.each(languages)('%s keeps missing responses, failed reads and no records distinct from zero cost', (language) => {
    const copy = adminRecordedAiUsageCopy[language];
    const view = render(<AdminRecordedAiUsage language={language} />);
    expect(screen.getByText(copy.missing)).toBeVisible();
    expect(period(copy.today)).toHaveTextContent(copy.unknown);
    expect(period(copy.month)).not.toHaveTextContent('USD');

    view.rerender(<AdminRecordedAiUsage language={language} data={usage({ status: 'unknown', recordedCostUsd: 0, todayRecordedCostUsd: 0 })} />);
    expect(screen.getByText(copy.failed)).toBeVisible();
    expect(screen.queryByText(copy.missing)).not.toBeInTheDocument();
    expect(period(copy.month)).toHaveTextContent(copy.unknown);
    expect(period(copy.month)).not.toHaveTextContent('USD');

    view.rerender(<AdminRecordedAiUsage language={language} data={usage({ status: 'empty', recordedCostUsd: null, todayRecordedCostUsd: null, recordCount: 0, todayRecordCount: 0, latestRecordAt: null })} />);
    expect(screen.getByText(copy.emptyDetail)).toBeVisible();
    expect(period(copy.today)).toHaveTextContent(copy.empty);
    expect(period(copy.month)).not.toHaveTextContent('USD');
    expect(period(copy.month)).not.toHaveTextContent(copy.records(0));
  });

  it.each(languages)('%s shows true stored zero only when a valid record exists', (language) => {
    const copy = adminRecordedAiUsageCopy[language];
    render(<AdminRecordedAiUsage language={language} data={usage({ recordedCostUsd: 0, todayRecordedCostUsd: 0, recordCount: 1, todayRecordCount: 1 })} />);
    expect(period(copy.month)).toHaveTextContent('USD');
    expect(period(copy.month)).toHaveTextContent('0.00');
    expect(period(copy.month)).toHaveTextContent(copy.records(1));
    expect(screen.getByText(copy.basis)).toBeVisible();
  });

  it.each(languages)('%s preserves partial warnings and keeps period, count and exclusion details folded', (language) => {
    const copy = adminRecordedAiUsageCopy[language];
    render(<AdminRecordedAiUsage language={language} data={usage({ status: 'partial', excludedCount: 3, limitReached: true })} />);
    expect(screen.getByText(copy.partial)).toBeVisible();
    expect(screen.getByText(copy.partialDetail)).toBeVisible();
    const summary = screen.getByText(copy.details);
    const details = summary.closest('details')!;
    expect(details.open).toBe(false);
    expect(screen.getByText(copy.limitReached)).not.toBeVisible();
    summary.focus();
    expect(summary).toHaveFocus();
    expect(summary).toHaveClass('min-h-[44px]', 'min-w-[44px]', 'focus-visible:ring-2');
    fireEvent.click(summary);
    expect(details.open).toBe(true);
    expect(screen.getByText(copy.limit(500))).toBeVisible();
    expect(screen.getByText(copy.limitReached)).toBeVisible();
    expect(screen.getByText(copy.excluded(3))).toBeVisible();
    expect(screen.getByText(copy.timeZone)).toBeVisible();
    expect(screen.getByText(copy.refreshed).parentElement).toHaveTextContent('11:00');
    expect(screen.getByText(copy.latest).parentElement).toHaveTextContent('10:00');
    expect(screen.getByText(copy.todayWindow).parentElement).toHaveTextContent('00:00');
    fireEvent.click(summary);
    expect(details.open).toBe(false);
    expect(summary).toHaveFocus();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not turn a day without retrieved records or an all-excluded result into zero', () => {
    const copy = adminRecordedAiUsageCopy.ko;
    const view = render(<AdminRecordedAiUsage language="ko" data={usage({ todayRecordCount: 0, todayRecordedCostUsd: null })} />);
    expect(period(copy.today)).toHaveTextContent(copy.empty);
    expect(period(copy.today)).not.toHaveTextContent('USD');
    expect(period(copy.month)).toHaveTextContent('1.25');
    view.rerender(<AdminRecordedAiUsage language="ko" data={usage({ status: 'partial', recordCount: 0, todayRecordCount: 0, recordedCostUsd: null, todayRecordedCostUsd: null, excludedCount: 4 })} />);
    expect(screen.getByText(copy.partialDetail)).toBeVisible();
    expect(period(copy.month)).toHaveTextContent(copy.empty);
    expect(period(copy.month)).not.toHaveTextContent('USD');
  });

  it('does not round a positive stored estimate to a displayed zero or show invalid numeric values', () => {
    const copy = adminRecordedAiUsageCopy.ko;
    const view = render(<AdminRecordedAiUsage language="ko" data={usage({ recordedCostUsd: 0.000000001, todayRecordedCostUsd: 0.000000001 })} />);
    expect(period(copy.month)).toHaveTextContent('0.000000001');
    view.rerender(<AdminRecordedAiUsage language="ko" data={usage({ recordedCostUsd: NaN, todayRecordedCostUsd: Infinity })} />);
    expect(period(copy.month)).toHaveTextContent(copy.unknown);
    expect(period(copy.today)).toHaveTextContent(copy.unknown);
    expect(screen.getByRole('region')).not.toHaveTextContent(/NaN|Infinity/);
  });

  it('preserves complete four-language copy and count-function contracts', () => {
    const keys = Object.keys(adminRecordedAiUsageCopy.ko).sort();
    for (const language of languages) {
      const copy = adminRecordedAiUsageCopy[language];
      expect(Object.keys(copy).sort()).toEqual(keys);
      for (const value of Object.values(copy)) if (typeof value === 'string') expect(value.trim()).not.toBe('');
      for (const count of [0, 1, 500]) {
        expect(copy.records(count)).toContain(String(count));
        expect(copy.limit(count)).toContain(String(count));
        expect(copy.excluded(count)).toContain(String(count));
      }
    }
  });

  it('wires the optional aggregate into the existing center without claiming bills are connected', () => {
    const copy = adminRecordedAiUsageCopy.ko;
    const ops = adminAiOpsCopy.ko;
    const view = render(page(usage()));
    expect(within(screen.getByRole('region', { name: copy.title })).getByText(/1\.25/)).toBeVisible();
    const connections = screen.getByRole('region', { name: ops.additionalConnectionsTitle });
    expect(within(connections).getByText(ops.apiHostingCosts).parentElement).toHaveTextContent(ops.notConnected);
    view.rerender(page());
    expect(screen.getByText(copy.missing)).toBeVisible();
    expect(fetch).not.toHaveBeenCalled();
    expect(state.getIdToken).not.toHaveBeenCalled();
  });
});
