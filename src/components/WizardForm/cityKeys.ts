/**
 * Supported wizard city keys — the allowlist behind `?prefillRegions=`.
 *
 * Its own module rather than a re-export from `./data.tsx`, because that file
 * carries JSX icons and therefore drags React + lucide-react behind it. The two
 * places that need only the keys — PlannerPage's query-string guard and a
 * node-environment test — cannot afford that, and PlannerPage itself is not
 * openable in a test at all (it reaches firebase through WizardForm).
 *
 * So the list exists twice, and `tests/unit/planner-prefill-regions-allowlist.test.ts`
 * fails if the two copies drift — the same "two copies plus a test that catches
 * the drift" rule the repo already applies wherever a shared import is not
 * available. Add a city here and to `CITY_CHIPS` in the same commit.
 */
export const CITY_KEYS = [
  'seoul', 'busan', 'jeju', 'gyeongju', 'jeonju',
  'gangneung', 'incheon', 'suwon', 'yeosu', 'daegu',
] as const;

export type CityKey = (typeof CITY_KEYS)[number];

const SUPPORTED: ReadonlySet<string> = new Set<string>(CITY_KEYS);

/**
 * Wizard city keys from a public `prefillRegions` query value.
 *
 * Anyone can author the link, so anything the wizard cannot render is dropped
 * instead of reaching `initialValues` — WizardForm shows an unmatched value
 * verbatim as the city name, which turned the query string into arbitrary text
 * on the traveller's screen. Dropped silently on purpose: a mistyped deep link
 * should land on the city step, not on an error.
 */
export function filterSupportedRegions(raw: string | null | undefined): CityKey[] {
  const keys = String(raw || '')
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part): part is CityKey => SUPPORTED.has(part));
  return [...new Set(keys)];
}
