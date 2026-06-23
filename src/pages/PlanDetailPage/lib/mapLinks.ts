// Shared map-link builder for stop cards (full plan + Day-1 preview).
// Returns BOTH a Google Maps directions link (transit mode, from the user's
// current location → this stop) and a Naver Map link (existing scheme).
//
// Google: origin is intentionally OMITTED so Google uses the user's current
// location as the start; travelmode=transit matches our public-transit framing.
// Naver: reuses the same coordinate/district fallback chain StopCard has used
// since Sprint 1 — coordinate URL preferred, then district-prefixed name search.
//
// Graceful with block_mode / legacy / missing-coordinate stops: every branch
// degrades to a name search, never emits "undefined".

/** Minimal shape — works for both PlanStop (full plan) and preview rows. */
export interface MapLinkStop {
  name?: string;
  name_ko?: string;
  display_name?: string;
  name_en?: string;
  address?: string;
  lat?: number;
  lng?: number;
  naverMapUrl?: string;
}

export interface MapLinks {
  google: string;
  naver: string;
}

/** Best Korean place name for map search (Naver indexes Korean names). */
function koreanName(stop: MapLinkStop): string {
  return (stop.name || stop.name_ko || '').replace(/\s*\(.*\)\s*/g, '').trim();
}

/** Any non-empty display label, last-resort for Google when no coords. */
function anyName(stop: MapLinkStop): string {
  return (
    stop.name ||
    stop.name_ko ||
    stop.display_name ||
    stop.name_en ||
    ''
  ).trim();
}

/** Extract a Korean district ("○○구") from the address for sharper search. */
function district(stop: MapLinkStop): string {
  const m = (stop.address || '').match(/([가-힣]+구)/);
  return m ? m[1] : '';
}

/** Naver Map URL — coordinate URL preferred, then district-prefixed name. */
export function buildNaverLink(stop: MapLinkStop): string {
  if (stop.naverMapUrl) return stop.naverMapUrl;
  const nameKo = koreanName(stop);
  if (stop.lat && stop.lng) {
    const q = nameKo || anyName(stop);
    return `https://map.naver.com/v5/search/${encodeURIComponent(q)}?c=${stop.lng},${stop.lat},15,0,0,0,dh`;
  }
  const gu = district(stop);
  const q = gu && nameKo ? `${gu} ${nameKo}` : nameKo || anyName(stop);
  return `https://map.naver.com/v5/search/${encodeURIComponent(q)}`;
}

/**
 * Google Maps directions link in TRANSIT mode.
 * destination = "lat,lng" when coordinates exist (most precise), otherwise the
 * place name. Origin omitted on purpose → Google starts from the user's
 * current location. Falls back to a plain map search when there's no usable
 * destination string (should not happen, but never emits "undefined").
 */
export function buildGoogleLink(stop: MapLinkStop): string {
  const destinationName = anyName(stop);
  let destination = '';
  if (stop.lat && stop.lng) {
    destination = `${stop.lat},${stop.lng}`;
  } else if (destinationName) {
    destination = destinationName;
  }
  if (destination) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=transit`;
  }
  // No name and no coords — degrade to a generic Naver-style Google search.
  return 'https://www.google.com/maps';
}

/** Both map links for a stop. */
export function buildMapLinks(stop: MapLinkStop): MapLinks {
  return {
    google: buildGoogleLink(stop),
    naver: buildNaverLink(stop),
  };
}
