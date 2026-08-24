// Request body builder for /api/ai-planner-quick.
//
// 2026-08-24 (planner-trust-course): usePlannerHandlers.handleSubmit used to
// build this payload inline and forwarded only a handful of fields
// (destination/preferences/durationDays/pax/dietPrefs/dietaryRestrictions/
// priceRange/special_request — and special_request wasn't even read
// server-side). Everything else the wizard collects (dates, airports,
// hotel/zone, mobility, pace, luggage, companions, entry/exit cities) was
// silently dropped, so the "preview" ignored most of what the traveller
// answered.
//
// Mirrored server-side by `api/_shared/quickPreviewIntent.js` (api/ and src/
// don't cross-import) — `tests/unit/quick-preview-intent-parity.test.ts`
// guards the two from drifting apart.
import type { PlannerFormValues } from '@/components/PlannerForm';
import { buildReservationStatusField } from './reservationStatusField';

export function buildQuickPreviewPayload(values: PlannerFormValues, language: string): Record<string, unknown> {
  return {
    language,
    destination: (values.regions || []).join(', '),
    regions: values.regions || [],
    // 2026-08-24 (planner-trust-course): stable UI city key for the primary
    // city, preferred by the server over parsing localized `destination` text.
    cityKey: values.cityKey || '',
    preferences: (values.categories || []).join(', '),
    categories: values.categories || [],
    // 2026-08-24 (planner-trust-course, E.2): NEVER fabricate a default here —
    // an invalid/missing durationDays or pax (0, NaN, undefined) must reach the
    // server's validateRequiredIntent as-is and fail with a stable code, not
    // silently become a fake "3-day, 2-person" trip. `undefined` is dropped by
    // JSON.stringify, which is exactly the "field wasn't usably filled in" signal
    // the server-side normalizer's `!= null` check is written to catch.
    durationDays: values.durationDays,
    pax: values.pax,
    startDate: values.startDate || '',
    endDate: values.endDate || '',
    arrival_airport: values.arrival_airport || values.arrivalAirport || '',
    departure_airport: values.departure_airport || '',
    arrival_time: values.arrival_time || '',
    departure_time: values.departure_time || '',
    hotel_address: values.hotel_address || '',
    recommended_zone: values.recommended_zone || '',
    recommended_zones: values.recommended_zones || {},
    mobility: values.mobility || '',
    tourPace: values.tourPace || '',
    tour_start_time: values.tour_start_time || '',
    tour_end_time: values.tour_end_time || '',
    luggage: values.luggage || undefined,
    companions: values.companions || '',
    // 2026-08-24 (planner-trust-course, E.4): arrival_city is the flight-lands
    // city; entry_city is the older, less precise multi-city field. Both are
    // forwarded — the server prefers arrival_city when both are present.
    // 2026-08-24 (planner-trust-course, D): reservation_status is ALWAYS
    // serialized (raw pass-through, never conditionally omitted, never
    // defaulted) — see reservationStatusField.ts.
    ...buildReservationStatusField(values),
    arrival_city: values.arrival_city || '',
    entry_city: values.entry_city || '',
    departure_city: values.departure_city || '',
    dietPrefs: values.dietPrefs || [],
    dietaryRestrictions: values.dietaryRestrictions || [],
    priceRange: values.priceRange || 'Any',
    spiceLevel: values.spiceLevel || '',
    bucketDishes: values.bucketDishes || [],
    special_request: values.freeText || '',
  };
}
