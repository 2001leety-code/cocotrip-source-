// @vitest-environment jsdom
/**
 * 내 코스 탭 + 공유 수신 페이지 렌더 회귀 슬롯 (2026-07-04).
 *
 * 잠금:
 *   1. MyCoursesTab — 목록 렌더 · '플래너에서 열기' = draft 저장 + /planner?mode=course 이동
 *      (로그인-뒤 화면 검증 원칙: useItinerary/네비 mock 렌더테스트).
 *   2. SharedCoursePage — 조회 성공 시 스탑 렌더 + '이 코스로 시작하기' 동일 흐름,
 *      404 시 안내.
 */
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig() as object),
  useNavigate: () => navigateMock,
}));
vi.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ language: 'ko', t: {}, changeLanguage: () => {} }) }));
vi.mock('@/hooks/usePageMeta', () => ({ usePageMeta: () => {} }));
vi.mock('@/sections/Header', () => ({ Header: () => <div /> }));
vi.mock('@/sections/Footer', () => ({ Footer: () => <div /> }));

const deleteMock = vi.fn();
const SAMPLE_IT = {
  id: 'it1', title: 'Course 2026-07-04', startDate: '2026-07-04', endDate: '2026-07-05',
  createdAt: 1, updatedAt: 1,
  days: [
    { dayNumber: 1, date: '2026-07-04', slots: [{ slotId: 'a', productId: 'course-x', productType: 'planner' as const, name: '경복궁', timeStart: '09:00', category: 'sight' }] },
    { dayNumber: 2, date: '2026-07-05', slots: [] },
  ],
};
vi.mock('@/hooks/useItinerary', () => ({
  useItinerary: () => ({ itineraries: [SAMPLE_IT], loading: false, deleteItinerary: deleteMock }),
}));

import { MyCoursesTab } from '../../src/components/MyCoursesTab';
import SharedCoursePage from '../../src/pages/SharedCoursePage';

beforeEach(() => {
  navigateMock.mockReset();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('MyCoursesTab', () => {
  it('저장 코스 목록 렌더 (제목·기간·수량)', () => {
    render(<MemoryRouter><MyCoursesTab /></MemoryRouter>);
    expect(screen.getByText('Course 2026-07-04')).toBeTruthy();
    expect(screen.getByText(/2일 · 1개 장소/)).toBeTruthy();
  });

  it("'플래너에서 열기' → draft 저장 + /planner?mode=course", () => {
    render(<MemoryRouter><MyCoursesTab /></MemoryRouter>);
    fireEvent.click(screen.getByText('플래너에서 열기'));
    const draft = JSON.parse(localStorage.getItem('cocotrip:course:draft:v1') || 'null');
    expect(draft.days[0].stops[0].title).toBe('경복궁');
    expect(navigateMock).toHaveBeenCalledWith('/planner?mode=course');
  });
});

describe('SharedCoursePage', () => {
  const renderAt = (id: string) => render(
    <MemoryRouter initialEntries={[`/s/${id}`]}>
      <Routes><Route path="/s/:id" element={<SharedCoursePage />} /></Routes>
    </MemoryRouter>
  );

  it('조회 성공 — 스탑 렌더 + 시작하기 → draft+이동', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      json: async () => ({ ok: true, data: { v: 1, days: [{ stops: [{ id: 's1', title: '해운대', time: '10:00', category: 'sight', memo: '' }] }], title: '', createdAt: 1 } }),
    })) as unknown as typeof fetch);
    renderAt('abcd1234');
    await waitFor(() => expect(screen.getByText('해운대')).toBeTruthy());
    fireEvent.click(screen.getByText('이 코스로 시작하기'));
    const draft = JSON.parse(localStorage.getItem('cocotrip:course:draft:v1') || 'null');
    expect(draft.days[0].stops[0].title).toBe('해운대');
    expect(navigateMock).toHaveBeenCalledWith('/planner?mode=course');
  });

  it('404 — 안내 문구', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ ok: false, code: 'NOT_FOUND' }) })) as unknown as typeof fetch);
    renderAt('zzzzzzzz');
    await waitFor(() => expect(screen.getByText(/찾을 수 없거나 삭제/)).toBeTruthy());
  });
});
