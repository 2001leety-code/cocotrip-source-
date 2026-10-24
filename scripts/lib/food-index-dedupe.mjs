/**
 * build-food-index 중복 제거 + 식이 태그 제한 복구 (2026-10-24, Astra food-dedupe r1 4항 (b)).
 *
 * 키 = placeId || googleMapsUrl || `name|address`, 첫 행 유지(기존 동작). 입력 순서가 general → halal → vegan 이라
 * 같은 장소의 식이 행이 general 행에 밀려 사라지던 결함을 **좁게만** 되살린다 — 유지된 general 행의 tag 만 식이 태그로
 * 바꾸고 이름·주소·좌표·cuisine·allergens 등은 그대로 둔다. 순서를 뒤집으면 도시·업종이 다른 행으로 교체되므로 금지.
 *
 * 복구 조건(전부 충족): 유지 행 tag === 'general' · 충돌 식이 행이 같은 강한 식별자(placeId 또는 googleMapsUrl)
 * · 식이 주장이 정확히 하나(halal+vegan, vegan+vegetarian 도 교차) · city 동일 · source 동일(둘 다 없음 포함)
 * · 유지 행에 검증 필드가 없음(deriveVerificationStatus 가 기존 승격 등급을 그대로 두므로 다른 식이로 번지는 것 방지).
 * 하나라도 어긋나면 손대지 않고 held 에 사유를 남긴다. 복구는 식이 안전 검증이 아니다 — 복구 행은 `dietary_restored:true`
 * 로 표시되고 deriveVerificationStatus 가 unverified 로 격리한다(2026-10-24 실측: 복구 "halal" 대부분이 비할랄).
 */

export function dedupeKey(item) {
  return item.placeId || item.googleMapsUrl || `${item.name}|${item.address}`;
}

const keyKind = (item) => (item.placeId ? 'placeId' : item.googleMapsUrl ? 'url' : 'weak');
const lower = (v) => String(v || '').toLowerCase().trim();
const exact = (v) => String(v || '').trim();
const VERIFICATION_FIELDS = ['verification_status', 'dietary_claim', 'certification_type'];

function holdReason(kept, claims, tags) {
  if (claims.some((c) => keyKind(c) === 'weak' || keyKind(c) !== keyKind(kept))) return 'weak_key';
  if (tags.length !== 1) return 'cross_tag';
  if (claims.some((c) => lower(c.city) !== lower(kept.city))) return 'city_mismatch';
  if (claims.some((c) => exact(c.source) !== exact(kept.source))) return 'source_mismatch';
  if (VERIFICATION_FIELDS.some((f) => exact(kept[f]) !== '')) return 'kept_has_verification';
  return null;
}

/**
 * @param {object[]} items 필터·정규화가 끝난 원시 행(변경하지 않음)
 * @param {{ dietaryTags: string[] }} opts
 * @returns {{ deduped: object[], restored: {key,name,city,tag}[], held: {key,name,city,tags,reason}[] }}
 */
export function dedupeWithDietaryRestore(items, { dietaryTags }) {
  const diet = new Set(dietaryTags.map(lower));
  const groups = new Map();
  for (const item of items) {
    const key = dedupeKey(item);
    const group = groups.get(key);
    if (!group) groups.set(key, { kept: item, claims: [] });
    else if (diet.has(lower(item.tag))) group.claims.push(item);
  }

  const deduped = [];
  const restored = [];
  const held = [];
  for (const [key, { kept, claims }] of groups) {
    if (lower(kept.tag) !== 'general' || claims.length === 0) {
      deduped.push(kept);
      continue;
    }
    const tags = [...new Set(claims.map((c) => lower(c.tag)))];
    const reason = holdReason(kept, claims, tags);
    if (reason) {
      held.push({ key, name: kept.name, city: kept.city, tags, reason });
      deduped.push(kept);
      continue;
    }
    // dietary_restored: 복구 표시 — deriveVerificationStatus 가 이 행을 unverified 로 격리한다(운영자 override 로만 승격).
    deduped.push({ ...kept, tag: tags[0], dietary_restored: true });
    restored.push({ key, name: kept.name, city: kept.city, tag: tags[0], dietary_restored: true });
  }
  return { deduped, restored, held };
}
