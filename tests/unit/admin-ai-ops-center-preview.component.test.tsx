// @vitest-environment jsdom
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminAiOpsCenterDevHarness from '@/pages/AdminAiOpsCenterDevHarness';
import type { OpsCenterData } from '@/pages/AdminAiOpsCenter';

void React;

const captured = vi.hoisted(() => ({ latest: null as OpsCenterData | null, failure: undefined as string | undefined }));
vi.mock('@/pages/AdminAiOpsCenter', () => ({
  default: ({ previewData, previewFailure }: { previewData: OpsCenterData; previewFailure?: string }) => {
    captured.latest = previewData;
    captured.failure = previewFailure;
    return null;
  },
}));

const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  captured.latest = null;
  captured.failure = undefined;
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('미리보기 외부 호출은 금지됩니다.'); }));
});

function renderPreview(search = '', now = '2026-09-06T15:30:00Z') {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse(now));
  render(<MemoryRouter initialEntries={[`/admin/preview-ai-center${search}`]}><AdminAiOpsCenterDevHarness /></MemoryRouter>);
  expect(captured.latest).not.toBeNull();
  expect(fetch).not.toHaveBeenCalled();
  return captured.latest!;
}

function expectConsistentSummary(data: OpsCenterData) {
  const dayStart = Date.parse(`${data.reservations[0]?.tripAt || '2026-09-07'}T00:00:00+09:00`);
  expect(data.summary.actionRequired).toBe(data.workItems.filter((item) => item.actionRequired).length);
  expect(data.summary.urgent).toBe(data.workItems.filter((item) => item.priority === 'P0' || item.priority === 'P1').length);
  expect(data.summary.todayReservations).toBe(data.reservations.filter((item) => item.tripAtMs >= dayStart && item.tripAtMs < dayStart + DAY_MS).length);
  expect(data.summary.upcoming7d).toBe(data.reservations.filter((item) => item.tripAtMs >= dayStart && item.tripAtMs < dayStart + 8 * DAY_MS).length);
  expect(data.summary.openInquiries).toBe(data.inboxItems.filter((item) => item.type === 'inquiry' && item.actionRequired).length);
  expect(data.summary.openCs).toBe(data.inboxItems.filter((item) => item.type === 'cs' && item.actionRequired).length);
  expect(data.summary.paymentReviews).toBe(data.workItems.filter((item) => item.type === 'payment_review').length);
  expect(data.summary.automationAttention).toBe(data.automation.filter((item) => item.status === 'attention' || item.status === 'retrying').length + data.partialErrors.length);
}

describe('AI 운영센터 미리보기 자료', () => {
  it.each([
    ['2026-09-06T15:30:00Z', '2026-09-07'],
    ['2027-12-31T15:30:00Z', '2028-01-01'],
  ])('현재 시각 %s에서 한국 날짜 %s 기준 예약을 만든다', (now, today) => {
    const data = renderPreview('', now);
    expect(data.generatedAt).toBe(new Date(now).toISOString());
    expect(data.reservations[0].tripAt).toBe(today);
    expect(data.reservations[0].tripAtMs).toBe(Date.parse(`${today}T00:00:00+09:00`));
    expect(data.summary.todayReservations).toBe(1);
    expect(data.summary.upcoming7d).toBe(3);
    expect(data.reservations.every((item) => item.isTest)).toBe(true);
    expectConsistentSummary(data);
  });

  it('긴 목록 쿼리는 외부 요청 없이 업무 23개·예약 65개와 일치하는 요약을 만든다', () => {
    const data = renderPreview('?work-list=long&reservations=long&period=all');
    expect(data.workItems).toHaveLength(23);
    expect(data.reservations).toHaveLength(65);
    expect(new Set(data.workItems.map((item) => item.workItemId)).size).toBe(23);
    expect(new Set(data.reservations.map((item) => item.workItemId)).size).toBe(65);
    expect(data.sources.find((item) => item.key === 'mood_bookings')?.count).toBe(63);
    expectConsistentSummary(data);
  });

  it('부분 실패 자료는 이메일 원본을 정상이나 수동 처리 확정으로 표시하지 않는다', () => {
    const data = renderPreview('?source-state=partial');
    expect(data.partialErrors).toEqual(['pending_email_retries']);
    expect(data.sources.find((item) => item.key === 'pending_email_retries')).toMatchObject({ ok: false, count: 0 });
    expect(data.automation.find((item) => item.key === 'email_retry')).toMatchObject({ status: 'unknown', count: 0, manual: 0 });
    expect(data.workItems.some((item) => item.sourceSystem === 'email_retry')).toBe(false);
    expectConsistentSummary(data);
  });

  it('빈 상태 쿼리는 모든 목록과 요약을 함께 비운다', () => {
    const data = renderPreview('?scenario=empty&work-list=long&reservations=long&source-state=partial');
    expect(data.workItems).toEqual([]);
    expect(data.reservations).toEqual([]);
    expect(data.inboxItems).toEqual([]);
    expect(data.automation).toEqual([]);
    expect(data.partialErrors).toEqual([]);
    expect(Object.values(data.summary).every((value) => value === 0)).toBe(true);
    expect(data.sources.every((item) => item.ok && item.count === 0)).toBe(true);
  });

  it('갱신 실패 쿼리는 이전 가짜 자료를 유지하며 정적 실패 표시만 전달한다', () => {
    const data = renderPreview('?scenario=refresh-failed');
    expect(captured.failure).toBe('가상 갱신 실패');
    expect(data.reservations).toHaveLength(3);
    expect(data.workItems).toHaveLength(6);
    expect(data.generatedAt).toBe('2026-09-06T15:30:00.000Z');
    expectConsistentSummary(data);
    // Fetch/retry behavior belongs to the real component tests; this is a static browser fixture.
    expect(fetch).not.toHaveBeenCalled();
  });
});
