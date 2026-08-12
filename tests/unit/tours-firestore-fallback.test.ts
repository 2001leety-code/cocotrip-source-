import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
  collection: vi.fn(() => ({ kind: 'collection' })),
  deleteDoc: vi.fn(),
  doc: vi.fn((_db: unknown, collectionName: string, documentId: string) => ({
    collectionName,
    documentId,
  })),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn((...parts: unknown[]) => parts),
  serverTimestamp: vi.fn(),
  setDoc: vi.fn(),
  where: vi.fn((...parts: unknown[]) => parts),
}));

vi.mock('@/lib/firebase', () => ({
  db: {},
  auth: {},
  storage: {},
  app: {},
}));

vi.mock('firebase/firestore', () => ({
  ...firestore,
  Timestamp: class Timestamp {
    toMillis() {
      return 0;
    }
  },
}));

import { fetchTourBySlug } from '../../src/lib/tours-firestore';

describe('fetchTourBySlug static catalog fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('continues with the public slug query when an absent direct document is permission denied', async () => {
    firestore.getDoc.mockRejectedValueOnce(Object.assign(new Error('Missing or insufficient permissions.'), {
      code: 'permission-denied',
    }));
    firestore.getDocs.mockResolvedValueOnce({ empty: true, docs: [] });

    await expect(fetchTourBySlug('seoul-city-full-day')).resolves.toBeNull();
    expect(firestore.getDocs).toHaveBeenCalledTimes(1);
  });

  it('does not hide a non-permission Firestore failure', async () => {
    const outage = Object.assign(new Error('service unavailable'), { code: 'unavailable' });
    firestore.getDoc.mockRejectedValueOnce(outage);

    await expect(fetchTourBySlug('seoul-city-full-day')).rejects.toBe(outage);
    expect(firestore.getDocs).not.toHaveBeenCalled();
  });
});
