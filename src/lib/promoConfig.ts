let pendingPromoConfig: Promise<{
  ok?: boolean;
  banner?: unknown;
  config?: unknown;
  popup?: unknown;
} | null> | null = null;

export function fetchPromoConfig() {
  if (!pendingPromoConfig) {
    pendingPromoConfig = Promise.resolve()
      .then(() => fetch('/api/promo-config'))
      .then((response) => response.json())
      .finally(() => { pendingPromoConfig = null; });
  }
  return pendingPromoConfig;
}
