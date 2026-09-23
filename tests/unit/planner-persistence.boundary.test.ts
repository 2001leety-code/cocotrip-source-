import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeFirestore } from '../helpers/fake-firestore.js';

// This checks persistence only, not payment authorization or full generation.
// Firebase Admin is the only SDK boundary replaced here. The real planPersister,
// quality metrics, payment-source classifier, and issuance modules are imported.
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => ({ __sentinel: 'serverTimestamp' }),
    increment: (by: number) => ({ __sentinel: 'increment', by }),
    delete: () => ({ __sentinel: 'delete' }),
  },
}));

import { persistPlan } from '../../api/_ai_core/planPersister.js';

const itinerary = {
  tour_title: 'Seoul day',
  regions: ['seoul'],
  days: [{
    day: 1,
    city: 'seoul',
    stops: [
      { name: 'Hotel', category: 'lodging', start_time: '09:00', stay_min: 0, address: 'Seoul' },
      { name: 'Lunch', category: 'food', start_time: '12:00', stay_min: 60, address: 'Seoul' },
    ],
  }],
};

const baseArgs = {
  body: { regions: ['seoul'], adults: 2, children: 0, paypalOrderId: 'ADMIN-BYPASS-persist-test' },
  itinerary,
  uid: 'planner-test-user',
  vehicle: 'sedan',
  priceKRW: 26600,
  priceUSD: 18.6,
  guestName: 'Test guest',
  pax: 2,
  styles: ['culture'],
  area: 'seoul',
  duration: 1,
  startDate: '2099-01-02',
  email: 'planner-test@example.com',
  specialRequest: '',
  arrival_airport: 'ICN',
  departure_airport: 'ICN',
  hotel_address: null,
  mobility: null,
  language: 'en',
  dietary: [],
  foodIndex: [],
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('real persistPlan → Firestore boundary', () => {
  it('writes a usable plan document and returns its URL', async () => {
    const db = createFakeFirestore();
    const result = await persistPlan(db, { ...baseArgs, planIdOverride: 'plan-persist-test' });

    expect(result).toMatchObject({ planId: 'plan-persist-test', planUrl: '/my-plans/plan-persist-test' });
    expect(db.__get('plans/plan-persist-test')).toMatchObject({
      planId: 'plan-persist-test',
      status: 'ready',
      itinerary,
    });
  });

  it('does not return a plan when the Firestore write fails', async () => {
    const db = createFakeFirestore();
    const originalCollection = db.collection.bind(db);
    db.collection = (name: string) => {
      const collection = originalCollection(name);
      if (name !== 'plans') return collection;
      return {
        ...collection,
        doc: (id: string) => ({
          ...collection.doc(id),
          set: vi.fn(async () => { throw new Error('synthetic Firestore failure'); }),
        }),
      };
    };

    await expect(persistPlan(db, { ...baseArgs, planIdOverride: 'plan-write-failure' }))
      .rejects.toThrow('Plan save failed');
    expect(db.__get('plans/plan-write-failure')).toBeUndefined();
  });
});
