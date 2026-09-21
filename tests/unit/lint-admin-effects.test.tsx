// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AltEditorModal } from '@/components/admin/AltEditorModal';
import type { TourPhoto } from '@/data/tours';

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() }, Toaster: () => null }));
vi.mock('@/lib/tours-firestore', () => ({
  fetchDraft: vi.fn(async () => ({ title: { ko: '기존 상품' } })),
  fetchTourById: vi.fn(async () => null), saveDraft: vi.fn(), publishDraft: vi.fn(),
}));
vi.mock('@/lib/zone-courses-firestore', () => ({
  fetchDraft: vi.fn(async () => ({ theme: '기존 코스' })),
  fetchZoneCourseById: vi.fn(async () => null), saveDraft: vi.fn(), publishDraft: vi.fn(),
}));
vi.mock('@/lib/admin-product-publish-validation', () => ({ validateProductPublish: vi.fn() }));
vi.mock('@/lib/zone-course-publish-validation', () => ({ validateZoneCoursePublish: vi.fn() }));
vi.mock('@/components/admin/ProductEditor/BasicInfoTab', () => ({ BasicInfoTab: () => null }));
vi.mock('@/components/admin/ProductEditor/MediaTab', () => ({ MediaTab: () => null }));
vi.mock('@/components/admin/ProductEditor/StopsTab', () => ({ StopsTab: () => null }));
vi.mock('@/components/admin/ProductEditor/MeetingPointTab', () => ({ MeetingPointTab: () => null }));
vi.mock('@/components/admin/ProductEditor/PricingTab', () => ({ PricingTab: () => null }));
vi.mock('@/components/admin/ProductEditor/IncludedExcludedTab', () => ({ IncludedExcludedTab: () => null }));
vi.mock('@/components/admin/ProductEditor/CancellationTab', () => ({ CancellationTab: () => null }));
vi.mock('@/components/admin/ProductEditor/FaqTab', () => ({ FaqTab: () => null }));
vi.mock('@/components/admin/ProductEditor/MetaTab', () => ({ MetaTab: () => null }));
vi.mock('@/components/admin/ZoneCourseEditor/BasicTab', () => ({ BasicTab: () => null }));
vi.mock('@/components/admin/ZoneCourseEditor/StopsTab', () => ({ StopsTab: () => null }));
vi.mock('@/components/admin/ZoneCourseEditor/TransitMatrixTab', () => ({ TransitMatrixTab: () => null }));
vi.mock('@/components/admin/ZoneCourseEditor/BestForTab', () => ({ BestForTab: () => null }));
vi.mock('@/components/admin/ZoneCourseEditor/DietaryTab', () => ({ DietaryTab: () => null }));
vi.mock('@/components/admin/ZoneCourseEditor/BookingTab', () => ({ BookingTab: () => null }));
vi.mock('@/components/admin/ZoneCourseEditor/TrendHintsTab', () => ({ TrendHintsTab: () => null }));
vi.mock('@/components/admin/ZoneCourseEditor/PainpointsTab', () => ({ PainpointsTab: () => null }));
vi.mock('@/components/admin/ZoneCourseEditor/MetaTab', () => ({ MetaTab: () => null }));
vi.mock('@/components/admin/ZoneCourseEditor/TrekkingMetaTab', () => ({ TrekkingMetaTab: () => null }));
vi.mock('@/components/admin/ZoneCourseEditor/RunningMetaTab', () => ({ RunningMetaTab: () => null }));

const photo = (alt: TourPhoto['alt']): TourPhoto => ({ url: 'https://example.com/photo.jpg', alt });


describe('AltEditorModal', () => {
  afterEach(cleanup);

  it('resets a changed draft for a new photo with the same alt values', () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    const view = render(
      <AltEditorModal photo={photo({ ko: '첫 설명', en: 'first', ja: '', zh: '' })} open onSave={onSave} onClose={onClose} />,
    );

    fireEvent.change(screen.getByDisplayValue('첫 설명'), { target: { value: '수정 중' } });
    view.rerender(
      <AltEditorModal photo={photo({ ko: '첫 설명', en: 'first', ja: '', zh: '' })} open onSave={onSave} onClose={onClose} />,
    );

    expect(screen.getByDisplayValue('첫 설명')).toBeTruthy();
    expect(screen.queryByDisplayValue('수정 중')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(onSave).toHaveBeenCalledWith({ ko: '첫 설명', en: 'first', ja: '', zh: '' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes without saving when canceled', () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<AltEditorModal photo={photo({ ko: '설명', en: '', ja: '', zh: '' })} open onSave={onSave} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps an edit when a new photo object shares the same alt reference', () => {
    const sharedAlt = { ko: '공유 설명', en: '', ja: '', zh: '' };
    const view = render(<AltEditorModal photo={photo(sharedAlt)} open onSave={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByDisplayValue('공유 설명'), { target: { value: '계속 편집' } });
    view.rerender(<AltEditorModal photo={photo(sharedAlt)} open onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByDisplayValue('계속 편집')).toBeTruthy();
  });

});
