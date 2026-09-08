// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminAiOpsCenter, { type OpsCenterData } from '@/pages/AdminAiOpsCenter';
import { adminAiOpsCopy } from '@/lib/adminAiOpsCopy';
import type { Language } from '@/i18n';

void React;
const state = vi.hoisted(() => ({ language: 'ko' as Language, getIdToken: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { getIdToken: state.getIdToken } }) }));
vi.mock('@/hooks/usePageMeta', () => ({ usePageMeta: vi.fn() }));
vi.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ language: state.language, changeLanguage: vi.fn() }) }));
vi.mock('@/components/OwnerControllerSetupPanel', () => ({ OwnerControllerSetupPanel: () => null }));
vi.mock('@/components/OwnerNotificationSetup', () => ({ OwnerNotificationSetup: () => null }));

const NOW = Date.parse('2026-09-07T09:00:00+09:00');
function data(overrides: Partial<OpsCenterData> = {}): OpsCenterData {
  return {
    generatedAt: new Date(NOW).toISOString(),
    summary: { actionRequired: 0, urgent: 0, todayReservations: 0, upcoming7d: 0, openInquiries: 0, openCs: 0, paymentReviews: 0, automationAttention: 0 },
    workItems: [], reservations: [], inboxItems: [], automation: [],
    // Historical all-good fixtures intentionally do not list every possible source.
    sources: [{ key: 'bookings', label: '가짜 예약 자료', ok: true, count: 0, possiblyTruncated: false }],
    partialErrors: [], deduplication: { rule: 'fixture', removedMirrorCount: 0 },
    window: { perSourceLimit: 180, note: 'fixture' }, ...overrides,
  };
}
function page(value: OpsCenterData) {
  return <MemoryRouter><AdminAiOpsCenter previewData={value} /></MemoryRouter>;
}
function recordedUsage(status: 'ok' | 'partial' | 'empty' | 'unknown'): NonNullable<OpsCenterData['recordedAiUsage']> {
  return {
    source: 'api_usage', service: 'gemini', currency: 'USD', basis: 'stored-estimate',
    coverage: 'best-effort-records-only', actualBillConnected: false,
    status, generatedAt: new Date(NOW).toISOString(),
    monthStart: '2026-08-31T15:00:00.000Z', todayStart: '2026-09-06T15:00:00.000Z',
    queryLimit: 500, recordedCostUsd: status === 'unknown' || status === 'empty' ? null : 0.1,
    todayRecordedCostUsd: status === 'unknown' || status === 'empty' ? null : 0.1,
    recordCount: status === 'unknown' ? null : status === 'empty' ? 0 : 1,
    todayRecordCount: status === 'unknown' ? null : status === 'empty' ? 0 : 1,
    excludedCount: status === 'partial' ? 1 : 0, limitReached: false,
    latestRecordAt: status === 'unknown' || status === 'empty' ? null : new Date(NOW).toISOString(),
  };
}
function card(label: string) {
  const labelNode = within(screen.getByRole('region', { name: adminAiOpsCopy[state.language].summaryLabel })).getByText(label);
  return labelNode.parentElement!.parentElement!;
}
const emailQueue = {
  key: 'email_retry', label: '고객 이메일', status: 'ok' as const, pending: 0, manual: 0, count: 0,
  detail: '대기 없음', deepLink: '/admin/reconciliation',
};
beforeEach(() => {
  state.language = 'ko';
  vi.clearAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('SYNTHETIC_NETWORK_FORBIDDEN'); }));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('AI center partial-data presentation', () => {
  it.each(['ko', 'en', 'ja', 'zh'] as Language[])('%s never presents failed empty sources as confirmed zero or no work', (language) => {
    state.language = language;
    const copy = adminAiOpsCopy[language];
    const value = data({ partialErrors: ['bookings', 'charter_inquiries', 'cs_tickets'] });
    const original = JSON.stringify(value);
    render(page(value));
    for (const label of [copy.actionRequired, copy.todayReservations, copy.unansweredInquiries, copy.automationAttention]) {
      expect(card(label)).toHaveTextContent(copy.countUnavailable);
      expect(card(label)).toHaveTextContent(copy.partialData);
    }
    const queue = screen.getByRole('region', { name: copy.workTitle });
    expect(queue).toHaveTextContent(copy.workPartialEmpty);
    expect(queue).not.toHaveTextContent(copy.workEmpty);
    expect(queue).not.toHaveTextContent(copy.count(0));
    expect(screen.getByRole('region', { name: copy.reservationsTitle })).toHaveTextContent(copy.reservationsPartialEmpty);
    expect(screen.queryByText(copy.reservationsEmpty)).not.toBeInTheDocument();
    const inbox = screen.getByRole('region', { name: copy.inboxLabel });
    for (const label of [copy.webInquiries, copy.csInquiries]) {
      expect(within(inbox).getByText(label).closest('a')).toHaveTextContent(copy.countUnavailable);
    }
    expect(within(inbox).getByText(copy.paymentReviews).closest('a')).toHaveTextContent(copy.count(0));
    expect(screen.getByRole('status', { name: copy.refreshStatus })).toHaveTextContent(copy.refreshPartial);
    expect(screen.getByRole('status', { name: copy.refreshStatus })).not.toHaveTextContent(copy.refreshComplete);
    expect(screen.getByRole('status', { name: copy.refreshStatus })).toHaveTextContent(copy.updatedAt('').trim());
    expect(screen.getByRole('alert')).toHaveTextContent(copy.partialErrorDetail);
    expect(JSON.stringify(value)).toBe(original);
    expect(fetch).not.toHaveBeenCalled();
    expect(state.getIdToken).not.toHaveBeenCalled();
  });

  it('uses source failure flags even without partialErrors and does not contaminate healthy reservation counts', () => {
    const copy = adminAiOpsCopy.ko;
    render(page(data({
      sources: [{ key: 'pending_email_retries', label: '가짜 발신 원본', ok: false, count: 0, possiblyTruncated: false }],
      automation: [emailQueue],
    })));
    expect(card(copy.actionRequired)).toHaveTextContent(copy.countUnavailable);
    expect(card(copy.todayReservations)).not.toHaveTextContent(copy.countUnavailable);
    expect(card(copy.todayReservations)).toHaveTextContent('0');
    expect(card(copy.unansweredInquiries)).not.toHaveTextContent(copy.partialData);
    expect(screen.getByRole('status', { name: copy.refreshStatus })).toHaveTextContent(copy.refreshPartial);
    expect(document.getElementById('ops-source')).toHaveTextContent(copy.sourceFailures(1));
    expect(document.getElementById('ops-source')).not.toHaveTextContent(copy.allSourcesResponded);
    const email = within(screen.getByRole('region', { name: copy.automationTitle })).getByText(copy.outboundEmailRetry).closest('a');
    expect(email).toHaveTextContent(copy.automationLabels.unknown);
    expect(email).not.toHaveTextContent(copy.sendingQueueEmpty);
    expect(email).toHaveAttribute('href', emailQueue.deepLink);
  });

  it('deduplicates both failure signals and honors partialErrors over a contradictory ok flag', () => {
    render(page(data({ partialErrors: ['bookings', 'bookings'], sources: [
      { key: 'bookings', label: '가짜 예약 자료', ok: false, count: 0, possiblyTruncated: false },
    ] })));
    expect(document.getElementById('ops-source')).toHaveTextContent('1곳 확인 실패');
    cleanup();
    render(page(data({ partialErrors: ['bookings'] })));
    const source = document.getElementById('ops-source')!;
    expect(source).toHaveTextContent('실패');
    expect(within(source).getByText('가짜 예약 자료').parentElement).not.toHaveTextContent('0건');
  });

  it.each([
    ['bookings', true, false],
    ['pending_free_claims', false, true],
  ] as const)('%s failure only marks its dependent summary and links as incomplete', (source, reservationsPartial, inquiriesPartial) => {
    const copy = adminAiOpsCopy.ko;
    render(page(data({ partialErrors: [source] })));
    expect(card(copy.todayReservations).textContent!.includes(copy.countUnavailable)).toBe(reservationsPartial);
    expect(card(copy.unansweredInquiries).textContent!.includes(copy.countUnavailable)).toBe(inquiriesPartial);
    const inbox = screen.getByRole('region', { name: copy.inboxLabel });
    const web = within(inbox).getByText(copy.webInquiries).closest('a')!;
    expect(web.textContent!.includes(copy.countUnavailable)).toBe(inquiriesPartial);
    const cs = within(inbox).getByText(copy.csInquiries).closest('a');
    expect(cs).toHaveTextContent(copy.count(0));
    expect(cs).not.toHaveTextContent(copy.partialData);
    expect(cs).toHaveAttribute('href', '/admin/ops?tab=review');
  });

  it('runtime flag failure does not claim automatic acknowledgement works or affect other readable queues', () => {
    const copy = adminAiOpsCopy.ko;
    const acknowledgement = { ...emailQueue, key: 'inquiry_auto_ack', label: '가짜 접수 자동화', detail: '가짜 켜짐', deepLink: '/admin/claims' };
    const processor = { ...emailQueue, key: 'processor_retry', label: '가짜 예약 후속처리' };
    render(page(data({ partialErrors: ['runtime_flags'], automation: [acknowledgement, processor, emailQueue] })));
    const automation = screen.getByRole('region', { name: copy.automationTitle });
    const acknowledgementLink = within(automation).getByText(acknowledgement.label).closest('a');
    expect(acknowledgementLink).toHaveTextContent(copy.automationLabels.unknown);
    expect(acknowledgementLink).not.toHaveTextContent(acknowledgement.detail);
    expect(acknowledgementLink).toHaveAttribute('href', acknowledgement.deepLink);
    expect(within(automation).getByText(processor.label).closest('a')).toHaveTextContent(copy.automationLabels.ok);
    expect(within(automation).getByText(copy.outboundEmailRetry).closest('a')).toHaveTextContent(copy.sendingQueueEmpty);
    expect(card(copy.todayReservations)).not.toHaveTextContent(copy.partialData);
    expect(card(copy.unansweredInquiries)).not.toHaveTextContent(copy.partialData);
  });

  it('preserves known positive counts, original objects and links while marking incomplete totals', () => {
    const value = data({ partialErrors: ['charter_inquiries'], summary: {
      actionRequired: 23, urgent: 2, todayReservations: 3, upcoming7d: 4, openInquiries: 5, openCs: 6, paymentReviews: 0, automationAttention: 1,
    } });
    const original = JSON.stringify(value);
    render(page(value));
    expect(card('처리할 일')).toHaveTextContent('23');
    expect(card('처리할 일')).toHaveTextContent('일부 자료 기준');
    expect(card('미답변 문의')).toHaveTextContent('11');
    expect(card('오늘 예약')).toHaveTextContent('3');
    expect(card('오늘 예약')).not.toHaveTextContent('일부 자료 기준');
    const inbox = screen.getByRole('region', { name: adminAiOpsCopy.ko.inboxLabel });
    const web = within(inbox).getByText('웹 문의').closest('a');
    expect(web).toHaveTextContent('5건');
    expect(web).toHaveTextContent('일부 자료 기준');
    expect(web).toHaveAttribute('href', '/admin/claims');
    const cs = within(inbox).getByText('CS 문의').closest('a');
    expect(cs).toHaveTextContent('6건');
    expect(cs).not.toHaveTextContent('일부 자료 기준');
    expect(JSON.stringify(value)).toBe(original);
  });

  it('returns to explicit healthy empty states after recovery without inventing missing-source failures', () => {
    const view = render(page(data({ partialErrors: ['bookings'] })));
    expect(screen.getByText('자료 확인이 필요합니다')).toBeInTheDocument();
    view.rerender(page(data()));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('자료 확인이 필요합니다')).not.toBeInTheDocument();
    expect(screen.getByText('지금 급한 업무가 없습니다')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: adminAiOpsCopy.ko.refreshStatus })).toHaveTextContent('갱신 완료');
    expect(document.getElementById('ops-source')).toHaveTextContent(adminAiOpsCopy.ko.allSourcesResponded);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['ko', 'en', 'ja', 'zh'] as Language[])('%s keeps unconnected channels visible and sends no requests or fabricated costs', (language) => {
    state.language = language;
    const copy = adminAiOpsCopy[language];
    render(page(data({ automation: [emailQueue] })));
    const section = screen.getByRole('region', { name: copy.additionalConnectionsTitle });
    expect(section.closest('details')).toBeNull();
    expect(within(section).getAllByText(copy.notConnected)).toHaveLength(3);
    for (const label of [copy.incomingEmail, copy.whatsapp, copy.apiHostingCosts]) expect(within(section).getByText(label)).toBeVisible();
    expect(section.textContent).not.toMatch(/[0-9$₩¥]|USD|KRW/);
    expect(within(section).queryAllByRole('button')).toHaveLength(0);
    expect(within(section).queryAllByRole('link')).toHaveLength(0);
    const automation = screen.getByRole('region', { name: copy.automationTitle });
    const email = within(automation).getByText(copy.outboundEmailRetry).closest('a');
    expect(email).toHaveTextContent(copy.sendingQueueEmpty);
    expect(email).not.toHaveTextContent(copy.automationLabels.ok);
    expect(within(automation).getByText(copy.sendingQueueDetail)).toBeVisible();
    expect(email).toHaveAttribute('href', '/admin/reconciliation');
    expect(fetch).not.toHaveBeenCalled();
    expect(state.getIdToken).not.toHaveBeenCalled();
  });

  it.each(['ko', 'en', 'ja', 'zh'] as Language[])('%s includes cost read failures in the named refresh badge without changing reservation or inquiry totals', (language) => {
    state.language = language;
    const copy = adminAiOpsCopy[language];
    const summary = { ...data().summary, todayReservations: 3, openInquiries: 2, openCs: 4 };
    const failed = data({ summary, recordedAiUsage: recordedUsage('unknown') });
    const original = JSON.stringify(failed);
    const view = render(page(failed));
    for (const status of ['unknown', 'partial'] as const) {
      view.rerender(page(data({ summary, recordedAiUsage: recordedUsage(status) })));
      const refresh = screen.getByRole('status', { name: copy.refreshStatus });
      expect(refresh).toHaveTextContent(copy.refreshPartial);
      expect(refresh).not.toHaveTextContent(copy.refreshComplete);
      expect(card(copy.todayReservations)).toHaveTextContent('3');
      expect(card(copy.todayReservations)).not.toHaveTextContent(copy.partialData);
      expect(card(copy.unansweredInquiries)).toHaveTextContent('6');
      expect(card(copy.unansweredInquiries)).not.toHaveTextContent(copy.partialData);
      expect(document.getElementById('ops-source')).toHaveTextContent(copy.allSourcesResponded);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    }
    view.rerender(page(data({ summary, recordedAiUsage: recordedUsage('ok') })));
    expect(screen.getByRole('status', { name: copy.refreshStatus })).toHaveTextContent(copy.refreshComplete);
    expect(screen.getByRole('status', { name: copy.refreshStatus })).not.toHaveTextContent(copy.refreshPartial);
    expect(JSON.stringify(failed)).toBe(original);
    expect(fetch).not.toHaveBeenCalled();
    expect(state.getIdToken).not.toHaveBeenCalled();
  });

  it.each(['ko', 'en', 'ja', 'zh'] as Language[])('%s includes an explicitly unknown dispatch configuration without treating old missing fields as a new failure', (language) => {
    state.language = language;
    const copy = adminAiOpsCopy[language];
    const value = data({ ownerDispatchReadiness: { state: 'unknown', deliveryVerified: false } });
    const original = JSON.stringify(value);
    const view = render(page(value));
    expect(screen.getByRole('status', { name: copy.refreshStatus })).toHaveTextContent(copy.refreshPartial);
    expect(card(copy.todayReservations)).not.toHaveTextContent(copy.countUnavailable);
    expect(card(copy.unansweredInquiries)).not.toHaveTextContent(copy.partialData);
    for (const dispatchState of ['off', 'configured', 'configuration_required'] as const) {
      view.rerender(page(data({ ownerDispatchReadiness: { state: dispatchState, deliveryVerified: false } })));
      expect(screen.getByRole('status', { name: copy.refreshStatus })).toHaveTextContent(copy.refreshComplete);
    }
    view.rerender(page(data({ recordedAiUsage: recordedUsage('empty') })));
    expect(screen.getByRole('status', { name: copy.refreshStatus })).toHaveTextContent(copy.refreshComplete);
    view.rerender(page(data()));
    expect(screen.getByRole('status', { name: copy.refreshStatus })).toHaveTextContent(copy.refreshComplete);
    expect(JSON.stringify(value)).toBe(original);
    expect(fetch).not.toHaveBeenCalled();
    expect(state.getIdToken).not.toHaveBeenCalled();
  });
});
