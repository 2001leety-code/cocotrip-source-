// Pure proposal builder: no network, file or database access.
// Regional search fields/limits: https://developers.naver.com/docs/serviceapi/search/local/local.md
// API migration/pricing notice: https://developers.naver.com/notice/article/32530
// Live requests are intentionally absent: the connected account's current quota and billing are unconfirmed.
const ENTITIES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };

export function cleanNaverText(value) {
  return String(value || '').replace(/<[^>]*>/g, '').replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (original, entity) => {
    if (entity[0] !== '#') return ENTITIES[entity.toLowerCase()] || original;
    const hex = entity[1].toLowerCase() === 'x';
    const code = parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : original;
  }).trim();
}
export function normalizeNaverIdentity(value) {
  return cleanNaverText(value).normalize('NFKC').toLocaleLowerCase('ko').replace(/[^\p{L}\p{N}]/gu, '');
}
export function parseNaverCoordinates(mapx, mapy) {
  if (mapx === null || mapx === undefined || mapy === null || mapy === undefined || mapx === '' || mapy === '') return null;
  const x = Number(mapx), y = Number(mapy);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const decimal = (lng, lat) => lat >= 33 && lat <= 39 && lng >= 124 && lng <= 132 ? { lat, lng } : null;
  return decimal(x, y) || decimal(x / 1e7, y / 1e7);
}
function validUrl(value) {
  try { const url = new URL(String(value || '')); return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null; } catch { return null; }
}
function distanceM(a, b) {
  const rad = (degrees) => degrees * Math.PI / 180;
  const dLat = rad(a.lat - b.lat), dLng = rad(a.lng - b.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 12742017.6 * Math.asin(Math.sqrt(Math.min(1, h)));
}
export function parseNaverLocalItem(item, { query, checkedAt } = {}) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const name = cleanNaverText(item.title);
  if (!name) return null;
  return {
    source: 'naver_local_search', query: typeof query === 'string' ? query : null,
    checkedAt: typeof checkedAt === 'string' ? checkedAt : null,
    name, address: cleanNaverText(item.address), roadAddress: cleanNaverText(item.roadAddress),
    category: cleanNaverText(item.category), coordinates: parseNaverCoordinates(item.mapx, item.mapy),
    sourceUrl: validUrl(item.link), responseFields: { ...item },
    opening_status: 'unknown', dietary_verification: 'unchanged',
  };
}

// Exact identifiers/names/addresses and nearby valid coordinates are evidence for a proposal, never a write or certification.
export function proposeNaverFoodEnrichment({ existing, response, query, checkedAt } = {}) {
  if (!existing || typeof existing !== 'object' || !response || !Array.isArray(response.items)) return { status: 'unknown', proposals: [] };
  const proposals = response.items.map((item) => parseNaverLocalItem(item, { query, checkedAt })).filter(Boolean);
  if (!proposals.length) return { status: 'no_match', proposals };
  const exactName = normalizeNaverIdentity(existing.name);
  const exactAddresses = [existing.address, existing.roadAddress].map(normalizeNaverIdentity).filter(Boolean);
  const existingCoord = parseNaverCoordinates(existing.lng, existing.lat);
  const expectedId = String(existing.naverPlaceId || '').trim();
  const assessed = proposals.map((proposal) => {
    const reasons = [];
    const candidateId = String(proposal.responseFields.naverPlaceId || '').trim();
    if (!expectedId || !candidateId || candidateId !== expectedId) reasons.push('id_unconfirmed');
    if (!exactName || normalizeNaverIdentity(proposal.name) !== exactName) reasons.push('name_unconfirmed');
    const foundAddresses = [proposal.address, proposal.roadAddress].map(normalizeNaverIdentity).filter(Boolean);
    if (!exactAddresses.length || !foundAddresses.some((address) => exactAddresses.includes(address))) reasons.push('address_unconfirmed');
    if (!existingCoord || !proposal.coordinates || distanceM(existingCoord, proposal.coordinates) > 100) reasons.push('coordinates_unconfirmed');
    if (!proposal.sourceUrl || !proposal.checkedAt || !Number.isFinite(Date.parse(proposal.checkedAt))) reasons.push('provenance_unconfirmed');
    return { ...proposal, reviewReasons: reasons };
  });
  const exact = assessed.filter((proposal) => proposal.reviewReasons.length === 0);
  // More than one plausible match cannot be selected without a human review.
  const status = exact.length === 1 && assessed.length === 1 ? 'match_proposal' : 'review';
  return { status, proposals: assessed };
}
