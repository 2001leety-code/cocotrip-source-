// @vitest-environment jsdom
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: { planDetail: { reviews: {} } } }) }));
vi.mock('../../src/components/ReviewCard', () => ({ ReviewCard: ({ review }: { review: { text: string } }) => <div>{review.text}</div> }));
vi.mock('../../src/components/ReviewWriteModal', () => ({ ReviewWriteModal: () => null }));
vi.mock('@/lib/authFetch', () => ({ authFetch: vi.fn() }));

import { authFetch } from '@/lib/authFetch';
import { ReviewList } from '../../src/components/ReviewList';

describe('ReviewList request lifecycle', () => {
  it('drops a slow previous target response after the target changes', async () => {
    let resolveFirst!: (value: { json: () => Promise<{ reviews: { id: string; authorUid: string; authorName: string; rating: number; text: string; createdAt: number }[] }> }) => void;
    const first = new Promise<typeof resolveFirst extends (value: infer T) => void ? T : never>((resolve) => { resolveFirst = resolve; });
    const second = Promise.resolve({ json: async () => ({ reviews: [{ id: 'b', authorUid: 'u', authorName: 'B', rating: 5, text: 'second target', createdAt: 1 }] }) });
    vi.mocked(authFetch).mockReturnValueOnce(first as never).mockReturnValueOnce(second as never);

    const view = render(<ReviewList targetType="tour" targetId="first" />);
    view.rerender(<ReviewList targetType="tour" targetId="second" />);
    await waitFor(() => expect(screen.getByText('second target')).toBeTruthy());

    resolveFirst({ json: async () => ({ reviews: [{ id: 'a', authorUid: 'u', authorName: 'A', rating: 5, text: 'stale target', createdAt: 1 }] }) });
    await waitFor(() => expect(screen.queryByText('stale target')).toBeNull());
  });
});
