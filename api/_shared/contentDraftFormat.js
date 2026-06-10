/**
 * 마케팅 콘텐츠 직원 — 출력 파싱·안전검증·텔레그램 포맷 (순수 함수, 단위 테스트).
 *
 * 2026-06-10 자가운영 에이전시 P3. Gemini JSON → 안전검증 → 텔레그램 HTML.
 * 사실 카드(이름/도시/평점/가격)는 **코드가** 렌더(항상 정확). AI 캡션은 "초안"으로 분리 표시.
 * 안전검증 = AI 환각·SAFETY 차단의 3층(식이주장 포함 시 폐기).
 */

// CLAUDE.md J: 식이/알레르기 주장은 검증 불가 → 마케팅 캡션에서 생성 금지. 포함 시 캡션 폐기.
const FORBIDDEN_CLAIM = /(halal|할랄|vegan|비건|vegetarian|채식|gluten|글루텐|allerg|알레르기|알러지)/i;

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Gemini 원문 → JSON 객체. 코드펜스/잡텍스트 방어. 실패 시 null. */
export function parseContentJson(raw) {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(s); } catch { /* fallthrough */ }
  const m = s.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* fail */ } }
  return null;
}

/** draft(variants/hashtags) 안전검증 — 식이주장 포함 variant 제거. 전부 위반/구조이상 시 null. */
export function sanitizeDraft(draft) {
  if (!draft || !Array.isArray(draft.variants)) return null;
  const variants = draft.variants
    .filter((v) => v && (v.ko || v.en) && !FORBIDDEN_CLAIM.test(`${v.ko || ''} ${v.en || ''}`))
    .slice(0, 3);
  if (variants.length === 0) return null;
  const hashtags = Array.isArray(draft.hashtags)
    ? draft.hashtags.filter((h) => typeof h === 'string' && !FORBIDDEN_CLAIM.test(h)).slice(0, 15)
    : [];
  return { variants, hashtags };
}

/** 소재 사실 카드 (코드 렌더, 항상 정확). */
function factsCard(m) {
  const loc = `${m.cityLabel || m.city || ''}${m.dong ? ' · ' + m.dong : ''}`;
  const price = m.priceLabelKo ? ` · ${m.priceLabelKo}` : '';
  const cuisine = m.cuisineKo ? ` · ${m.cuisineKo}` : '';
  return `소재: <b>${esc(m.name)}</b> (${esc(m.nameEn)})\n${esc(loc)}${esc(cuisine)} · ⭐${m.rating} (리뷰 ${Number(m.reviewCount || 0).toLocaleString()})${esc(price)}`;
}

const HOOK_LABEL = { 호기심: '🔮 호기심', 정보: 'ℹ️ 정보', 감성: '💛 감성' };

/** 소재 + (정제된) draft → 텔레그램 HTML 메시지. draft 가 null 이면 사실 카드만(AI 실패 graceful). */
export function formatDraftMessage(material, draft) {
  const m = material || {};
  const lines = ['📝 <b>오늘의 콘텐츠 초안</b> · 맛집', factsCard(m), ''];
  if (draft && Array.isArray(draft.variants) && draft.variants.length) {
    for (const v of draft.variants) {
      lines.push(`<b>${esc(HOOK_LABEL[v.hook] || v.hook || '안')}</b>`);
      if (v.ko) lines.push(`ko: ${esc(v.ko)}`);
      if (v.en) lines.push(`en: ${esc(v.en)}`);
      lines.push('');
    }
    if (draft.hashtags && draft.hashtags.length) lines.push(draft.hashtags.map(esc).join(' '), '');
  } else {
    lines.push('<i>AI 초안 생성 실패 — 위 소재 사실만 전달. 직접 작성하시거나 다음 날 재시도.</i>', '');
  }
  lines.push('<i>🌐 admin 에서도 확인 · 발행은 직접 (자동 발행 안 함)</i>');
  return lines.join('\n');
}
