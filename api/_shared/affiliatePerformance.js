const AFFILIATE_EVENTS = new Set(['affiliate_impression', 'affiliate_click']);

/** PostHog 차원값을 관리자 화면에 안전하게 표시할 짧은 문자열로 정규화한다. */
function normalizeDimension(value) {
  const normalized = String(value || 'unknown').trim().slice(0, 80);
  return normalized || 'unknown';
}

/** 분모가 없을 때 0을 반환하고 소수 둘째 자리까지 클릭률을 계산한다. */
function clickThroughRate(clicks, impressions) {
  if (!impressions) return 0;
  return Math.round((clicks / impressions) * 10000) / 100;
}

/** 상품·노출 위치별 집계 버킷을 갱신한다. */
function addToBucket(map, key, event, total) {
  const current = map.get(key) || { key, impressions: 0, clicks: 0, ctr: 0 };
  if (event === 'affiliate_impression') current.impressions += total;
  if (event === 'affiliate_click') current.clicks += total;
  current.ctr = clickThroughRate(current.clicks, current.impressions);
  map.set(key, current);
}

/** PostHog HogQL 행을 관리자용 제휴 성과 응답으로 변환한다. */
export function aggregateAffiliateRows(rows) {
  let impressions = 0;
  let clicks = 0;
  const products = new Map();
  const placements = new Map();
  const languages = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!Array.isArray(row)) continue;
    const event = String(row[0] || '');
    if (!AFFILIATE_EVENTS.has(event)) continue;
    const total = Math.max(0, Number(row[4]) || 0);
    if (!total) continue;

    const product = normalizeDimension(row[1]);
    const placement = normalizeDimension(row[2]);
    const language = normalizeDimension(row[3]);
    if (event === 'affiliate_impression') impressions += total;
    if (event === 'affiliate_click') clicks += total;
    addToBucket(products, product, event, total);
    addToBucket(placements, placement, event, total);
    addToBucket(languages, language, event, total);
  }

  const sortBuckets = (map) => [...map.values()].sort((a, b) =>
    b.clicks - a.clicks || b.impressions - a.impressions || a.key.localeCompare(b.key));

  return {
    summary: { impressions, clicks, ctr: clickThroughRate(clicks, impressions) },
    byProduct: sortBuckets(products),
    byPlacement: sortBuckets(placements),
    byLanguage: sortBuckets(languages),
  };
}
