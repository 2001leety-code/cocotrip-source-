/**
 * Quick-preview response contract (2026-08-24, planner-trust-course, client
 * hardening) — the single, pure parser both `usePlannerHandlers` (gate:
 * malformed 200 must never unlock quickSuccess/PurchaseSection) and
 * `QuickPreviewCard` (render) use. One parse, one truth — the card must not
 * carry a second, more permissive reading of the same payload.
 *
 * `api/ai-planner-quick.js` (server, out of scope here) does not yet emit a
 * `candidateId` on each `spotDetails` entry — this parser requires one
 * anyway, ahead of that server follow-up. Until the server adds it, every
 * real response fails this parser and the preview surfaces as an error
 * (fail-closed), never a broken/empty card.
 *
 * Deliberately dependency-free (no React) so it is trivial to unit test and
 * safe to call from both a hook and a component without import cycles.
 */

export interface QuickPreviewFoodDetail {
  type: 'food';
  spot: string;
  candidateId: string;
  placeId?: string;
  lat?: number;
  lng?: number;
  address?: string;
}

export interface QuickPreviewAttractionDetail {
  type: 'attraction';
  spot: string;
  candidateId: string;
  key: string;
  lat: number;
  lng: number;
}

export interface QuickPreviewSpotDetail {
  type: 'spot';
  spot: string;
  candidateId: string;
  name: string;
  address: string;
}

export type QuickPreviewDetail = QuickPreviewFoodDetail | QuickPreviewAttractionDetail | QuickPreviewSpotDetail;

export interface QuickPreviewStop {
  time: string;
  spot: string;
  transit: string;
  tip: string;
  detail: QuickPreviewDetail;
}

export interface ParsedQuickPreview {
  narrative: string;
  themes: string[];
  stops: QuickPreviewStop[];
  reflectedConditions: string[];
  deferredCategories: string[];
}

// ── Korea coordinate bounds (mirrors api/_food_helper.js KOREA_LAT_RANGE/KOREA_LNG_RANGE) ──
const KOREA_LAT_RANGE: [number, number] = [32.5, 39.5];
const KOREA_LNG_RANGE: [number, number] = [124, 132];

function isFiniteKoreaCoord(lat: unknown, lng: unknown): lat is number {
  return (
    typeof lat === 'number' && Number.isFinite(lat) &&
    typeof lng === 'number' && Number.isFinite(lng) &&
    (lat as number) >= KOREA_LAT_RANGE[0] && (lat as number) <= KOREA_LAT_RANGE[1] &&
    (lng as number) >= KOREA_LNG_RANGE[0] && (lng as number) <= KOREA_LNG_RANGE[1]
  );
}

// Google place_id token — opaque, but never empty/URL-shaped. Loose on
// purpose (Google does not publish a strict grammar) while still rejecting
// obvious garbage (whitespace, a full URL pasted in by mistake).
const PLACE_ID_RE = /^[A-Za-z0-9_-]{10,255}$/;
function isValidPlaceId(id: unknown): id is string {
  return typeof id === 'string' && PLACE_ID_RE.test(id);
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

// ── Table headers — exact localized name AND order (ko/en/ja/zh), matching
// api/ai-planner-quick.js's buildPrompt table templates. English's 4th column
// is "Insider Tip", not "Tip" — this is intentional, not a typo.
const CANONICAL_HEADERS: Record<string, [string, string, string, string]> = {
  ko: ['시간', '명소', '교통', '팁'],
  en: ['Time', 'Spot', 'Transit', 'Insider Tip'],
  ja: ['時間', 'スポット', '交通', 'ヒント'],
  zh: ['时间', '地点', '交通', '贴士'],
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

interface RawTableRow { time: string; spot: string; transit: string; tip: string }

function parseTable(raw: string, language: string): RawTableRow[] | null {
  const headers = CANONICAL_HEADERS[language] || CANONICAL_HEADERS.en;
  const lines = raw.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|'));
  const dataLines = lines.filter((l) => !/^\|[\s:\-|]+\|$/.test(l));
  if (dataLines.length !== 4) return null; // exactly 1 header + 3 stop rows

  const cellsOf = (line: string) => line.split('|').slice(1, -1).map((c) => c.trim());
  const headerCells = cellsOf(dataLines[0]);
  if (headerCells.length !== 4) return null;
  if (headers.some((h, i) => headerCells[i] !== h)) return null;

  const rows: RawTableRow[] = [];
  for (let i = 1; i < dataLines.length; i++) {
    const cells = cellsOf(dataLines[i]);
    if (cells.length !== 4) return null;
    const [time, spot, transit, tip] = cells;
    if (!nonEmptyString(time) || !nonEmptyString(spot) || !nonEmptyString(transit) || !nonEmptyString(tip)) return null;
    if (!TIME_RE.test(time)) return null;
    rows.push({ time, spot, transit, tip });
  }

  for (let i = 1; i < rows.length; i++) {
    if (timeToMinutes(rows[i].time) <= timeToMinutes(rows[i - 1].time)) return null; // strictly ascending
  }
  const uniqueSpots = new Set(rows.map((r) => r.spot));
  if (uniqueSpots.size !== rows.length) return null; // 3 unique displayed spots

  return rows;
}

function parseDetail(raw: unknown, expectedSpot: string): QuickPreviewDetail | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const d = raw as Record<string, unknown>;
  if (d.spot !== expectedSpot) return null; // index-corresponding to its row
  if (!nonEmptyString(d.candidateId)) return null;
  const candidateId = d.candidateId as string;

  if (d.type === 'food') {
    const placeId = isValidPlaceId(d.placeId) ? (d.placeId as string) : undefined;
    const hasCoords = isFiniteKoreaCoord(d.lat, d.lng);
    const address = nonEmptyString(d.address) ? (d.address as string).trim() : undefined;
    if (!placeId && !hasCoords && !address) return null; // safe placeId, or coords, or canonical address
    return {
      type: 'food', spot: expectedSpot, candidateId,
      placeId,
      lat: hasCoords ? (d.lat as number) : undefined,
      lng: hasCoords ? (d.lng as number) : undefined,
      address,
    };
  }

  if (d.type === 'attraction') {
    if (!nonEmptyString(d.key) || !isFiniteKoreaCoord(d.lat, d.lng)) return null; // key + finite Korea coords
    return { type: 'attraction', spot: expectedSpot, candidateId, key: (d.key as string).trim(), lat: d.lat as number, lng: d.lng as number };
  }

  if (d.type === 'spot') {
    if (!nonEmptyString(d.name) || !nonEmptyString(d.address)) return null; // canonical name + address
    return { type: 'spot', spot: expectedSpot, candidateId, name: (d.name as string).trim(), address: (d.address as string).trim() };
  }

  return null; // 'start' | 'unknown' | anything else — never a usable identity
}

/**
 * Parses and validates a `/api/ai-planner-quick` 200 body into the only shape
 * the UI is allowed to render. Returns `null` for anything malformed —
 * callers must treat `null` as a hard failure (stay on/return to the error
 * state), never coerce or partially render.
 */
export function parseQuickPreviewResponse(data: unknown, language: string): ParsedQuickPreview | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;

  if (!nonEmptyString(d.marketingNarrative)) return null;

  if (!Array.isArray(d.themes) || d.themes.length < 1 || d.themes.length > 5) return null;
  if (!d.themes.every((t) => nonEmptyString(t))) return null;

  if (typeof d.day1MarkdownTable !== 'string') return null;
  const rows = parseTable(d.day1MarkdownTable, language);
  if (!rows) return null;

  if (!Array.isArray(d.reflectedConditions) || !d.reflectedConditions.every((v) => typeof v === 'string')) return null;
  if (!Array.isArray(d.deferredCategories) || !d.deferredCategories.every((v) => typeof v === 'string')) return null;

  if (!Array.isArray(d.spotDetails) || d.spotDetails.length !== 3) return null;
  const seenIds = new Set<string>();
  const details: QuickPreviewDetail[] = [];
  for (let i = 0; i < 3; i++) {
    const detail = parseDetail(d.spotDetails[i], rows[i].spot);
    if (!detail) return null;
    if (seenIds.has(detail.candidateId)) return null; // unique candidateId
    seenIds.add(detail.candidateId);
    details.push(detail);
  }

  return {
    narrative: (d.marketingNarrative as string).trim(),
    themes: d.themes as string[],
    stops: rows.map((r, i) => ({ ...r, detail: details[i] })),
    reflectedConditions: d.reflectedConditions as string[],
    deferredCategories: d.deferredCategories as string[],
  };
}

/**
 * Google Maps URL from server-owned identity only — never the model-authored
 * displayed spot name. Priority: placeId > finite Korea coordinates > (spot
 * type) canonical name+address, or (food address-only fallback) the
 * canonical address alone. Attraction details always carry coordinates (see
 * `parseDetail`), so their address branch is unreachable by construction.
 */
export function buildGoogleMapsUrl(detail: QuickPreviewDetail): string | null {
  if (detail.type === 'food') {
    if (isValidPlaceId(detail.placeId)) {
      return `https://www.google.com/maps/search/?api=1&query=Google&query_place_id=${encodeURIComponent(detail.placeId as string)}`;
    }
    if (isFiniteKoreaCoord(detail.lat, detail.lng)) {
      return `https://www.google.com/maps/search/?api=1&query=${detail.lat},${detail.lng}`;
    }
    if (detail.address) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(detail.address)}`;
    }
    return null;
  }
  if (detail.type === 'attraction') {
    if (isFiniteKoreaCoord(detail.lat, detail.lng)) {
      return `https://www.google.com/maps/search/?api=1&query=${detail.lat},${detail.lng}`;
    }
    return null;
  }
  // 'spot'
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${detail.name} ${detail.address}`)}`;
}
