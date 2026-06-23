/**
 * sampleToPlanDoc.mjs — convert a static "예시 (Example)" sample plan
 * (src/data/sample-plans/{seoul,busan,jeju}.json, the SampleShowcase shape) into
 * the local-harness PlanDocument shape that PlanDetailPage's ?localPlan=<name>
 * loader expects (the same shape scripts/plan-local/run.mjs writes to
 * outputs/plan-<scenario>.json).
 *
 * WHY: the showcase samples are a DIFFERENT shape from the harness output —
 *   showcase:  { id, isSample, city, cityLabel, tour_title_i18n, day:{ single day, *_i18n } }
 *   harness:   { scenario, pricing, blocksUsed, itinerary:{ tour_title, days:[...] } }
 * This converter bridges them so the operator can preview the 3 samples in the
 * Brain OS plan-tester webview via ?localPlan=seoul|busan|jeju, reusing the
 * existing /local-plans dev middleware (no new loader, no app/runtime change).
 *
 * i18n objects ({ ko, en, ja, zh }) are resolved to English as the base render
 * language — PlanDetailPage's auto-translate handles other UI languages, exactly
 * like a real (English-base) plan. Stops/transit are passed through unchanged
 * (already the same shape RouteAgent writes).
 *
 * Dev-only tooling. Not imported by the production app.
 */

/** Resolve an i18n object ({ en, ko, ja, zh }) or plain string to an English-base string. */
function pickEn(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  return v.en || v.ko || v.ja || v.zh || '';
}

/** Convert one showcase stop → harness/PlanStop (flat English-base strings). */
function convertStop(s) {
  const display = s.display_name_i18n ? pickEn(s.display_name_i18n) : s.display_name;
  const out = {
    ...s,
    display_name: display || s.display_name || s.name,
    tip: pickEn(s.tip) || undefined,
  };
  // i18n source objects are not part of the PlanStop render contract — drop them.
  delete out.display_name_i18n;
  return out;
}

/**
 * Convert a showcase sample plan (RawSamplePlan) → harness PlanDocument.
 * @param {object} sample parsed src/data/sample-plans/<city>.json
 * @param {string} scenario the ?localPlan id (e.g. "seoul")
 */
export function sampleToPlanDoc(sample, scenario) {
  const d = sample.day || {};
  const today = new Date().toISOString().slice(0, 10);
  const lodgingLabel = pickEn(d.lodgingLabel);

  const day = {
    day: d.day || 1,
    date: d.date || today,
    theme: pickEn(d.theme_i18n),
    city: d.city || sample.city,
    // getLodgingLabelForDay() reads day.lodging.name first (P140) → drives the
    // "🏨 숙소 출발/복귀" bookend label, same as a real backfilled plan.
    lodging: lodgingLabel ? { name: lodgingLabel } : undefined,
    lodging_to_first: d.lodging_to_first || null,
    stops: Array.isArray(d.stops) ? d.stops.map(convertStop) : [],
  };

  return {
    scenario,
    isSample: true,
    // Nominal pricing — samples are view-only previews ($0, no checkout path).
    pricing: { note: 'sample (예시) — preview only' },
    blocksUsed: [],
    itinerary: {
      tour_title: pickEn(sample.tour_title_i18n) || `${sample.city} sample`,
      days: [day],
    },
  };
}
