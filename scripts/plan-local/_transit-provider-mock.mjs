/** Transit boundary used only by the offline planner harness. */

export function getTransitProvider() {
  return 'odsay';
}

// Live calls stay disabled; cached fixture transit is checked before this path.
export async function searchTransit() {
  return null;
}
