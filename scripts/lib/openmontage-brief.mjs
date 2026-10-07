/**
 * OpenMontage 영상 brief 생성기 — 순수 함수 모음 (파일·네트워크·env 접근 없음).
 *
 * 무엇: src/data/tours.ts 의 정적 투어 1개 + locale 1개 →
 *   OpenMontage `schemas/artifacts/brief.schema.json` (version "1.0") 에 맞는 brief 객체,
 *   OpenMontage 에이전트에게 붙여넣을 운영자 프롬프트(prompt.md), 사진 출처표기(CREDITS.txt).
 *
 * 왜 따로 두나: OpenMontage 는 AGPL-3.0 이라 레포에 넣지 않는다(docs/MARKETING-OPENMONTAGE-VIDEO-RUNBOOK.md).
 *   CocoTrip 쪽에는 "우리 데이터 → 입력 파일" 변환만 둔다. CLI(scripts/export-openmontage-brief.mjs)가
 *   tours.ts 를 Vite 로 읽어 이 함수들에 넘기고, 파일 쓰기·사진 복사는 CLI 만 한다.
 *
 * 결정된 규칙 (바꾸려면 운영자 결정 필요):
 *   - 가격·할인·평점·후기 수 필드는 아예 넣지 않는다. 영상은 가격보다 오래 남고, 가격 SSOT 는 사이트다.
 *   - 식이(할랄/비건/알레르기) 안전 주장 금지. 원문에 그런 문구가 있으면 brief 에서 뺀다.
 *   - locale 문자열이 없으면 다른 언어로 폴백하지 않는다 → 생략 + warning.
 *     필수 필드(title/hook/key_points)가 비면 missingRequired 에 남기고, CLI 는 그 locale 을 쓰지 않는다.
 *   - 근거 없는 배지 태그(Popular / Best Value / AI-Curated)는 tours.ts 의 isUngroundedBadgeTag 로 거른다.
 *     (판정 로직 SSOT 는 tours.ts — 여기서 복제하지 않고 opts 로 주입받는다.)
 *   - 원문 문구 중 가격·평점·최상급·식이·"AI" 위험 표현은 문장 단위로 빼고 warning 으로 남긴다
 *     (" — " 뒤 꼬리 구만 위험하면 그 꼬리만 — filterSentence 규칙). 빼고 나서도 걸리면 필드째 뺀다.
 *
 * 스키마 기준: OpenMontage 커밋 9327439 (OPENMONTAGE_PINNED_COMMIT). 스키마가 바뀌면
 *   validateOpenMontageBrief() 와 테스트를 같이 갱신한다.
 */

export const OPENMONTAGE_PINNED_COMMIT = '9327439db69021ab4b0e2776729bf3b58fdb5a87';

/** 사이트 공개 도메인 + 투어 상세 라우트 (src/App.tsx `/tours/:slug`, TourDetailPage ogUrl 과 동일). */
export const PUBLIC_ORIGIN = 'https://cocotripkr.com';

export const LOCALES = Object.freeze(['ko', 'en', 'ja', 'zh']);

/** brief.schema.json 의 required / properties / target_platform enum (커밋 9327439 기준). */
export const BRIEF_REQUIRED_FIELDS = Object.freeze([
  'version', 'title', 'hook', 'key_points', 'tone', 'style', 'target_platform', 'target_duration_seconds',
]);
export const BRIEF_ALLOWED_FIELDS = Object.freeze([
  ...BRIEF_REQUIRED_FIELDS,
  'core_message', 'cta', 'target_audience', 'reference_material', 'angle_options', 'selected_angle', 'metadata',
]);
export const SCHEMA_TARGET_PLATFORMS = Object.freeze(['youtube', 'instagram', 'tiktok', 'linkedin', 'generic']);

/**
 * CLI --platform → 스키마 enum + OpenMontage lib/media_profiles.py 프로필 이름.
 * max_seconds 는 그 프로필의 max_duration_seconds.
 */
export const PLATFORM_PROFILES = Object.freeze({
  instagram: Object.freeze({ target_platform: 'instagram', label: 'Instagram Reels', media_profile: 'instagram_reels', aspect_ratio: '9:16', max_seconds: 90 }),
  youtube: Object.freeze({ target_platform: 'youtube', label: 'YouTube Shorts', media_profile: 'youtube_shorts', aspect_ratio: '9:16', max_seconds: 60 }),
  tiktok: Object.freeze({ target_platform: 'tiktok', label: 'TikTok', media_profile: 'tiktok', aspect_ratio: '9:16', max_seconds: 600 }),
});

export const DEFAULT_PLATFORM = 'instagram';
export const DEFAULT_SECONDS = 30;
export const DEFAULT_BUDGET_USD = 1;

/**
 * locale 별 메타. 사진 기관명은 사이트가 이미 쓰는 표기(src/sections/home/homeCopy.ts photoCredit)를 따른다.
 * language/audience 는 OpenMontage 에이전트용 영어 지시문이다(화면 노출 텍스트 아님).
 */
const LOCALE_INFO = Object.freeze({
  ko: {
    language: 'Korean', languageCode: 'ko-KR', glyphs: 'Korean (Hangul)',
    audience: 'Korean-speaking travellers planning a trip in Korea',
    creditLine: (c) => `사진: ${c.credit} (${c.title}) / 한국관광공사, 공공누리 제${c.kogl_type}유형`,
  },
  en: {
    language: 'English', languageCode: 'en-US', glyphs: 'Latin',
    audience: 'English-speaking travellers planning a trip to Korea',
    creditLine: (c) => `Photo: ${c.credit} (${c.title}) / Korea Tourism Organization, KOGL Type ${c.kogl_type}`,
  },
  ja: {
    language: 'Japanese', languageCode: 'ja-JP', glyphs: 'Japanese (kana and kanji)',
    audience: 'Japanese-speaking travellers planning a trip to Korea',
    creditLine: (c) => `写真：${c.credit}（${c.title}）/ 韓国観光公社・KOGL Type ${c.kogl_type}`,
  },
  zh: {
    language: 'Simplified Chinese', languageCode: 'zh-CN', glyphs: 'Simplified Chinese',
    audience: 'Simplified-Chinese-speaking travellers planning a trip to Korea',
    creditLine: (c) => `照片：${c.credit}（${c.title}）/ 韩国观光公社・KOGL Type ${c.kogl_type}`,
  },
});

/** docs/DESIGN-EDITORIAL-CONCIERGE.md §1·§5 (accountable, plain verbs, sentence case) 를 에이전트용으로 옮김. */
export const BRIEF_TONE = 'Calm, editorial and specific. Accountable, never hype: plain verbs, sentence case, active voice.';
/** OpenMontage styles/clean-professional.yaml (hybrid 파이프라인 recommended playbook). */
export const BRIEF_STYLE = 'clean-professional';

/**
 * 하드 제약. brief.metadata.constraints 에는 id 만, prompt.md 에는 text 전체가 들어간다.
 * text 안의 {budget} 은 buildOpenMontagePrompt 가 금액으로 치환한다.
 */
export const HARD_CONSTRAINTS = Object.freeze([
  {
    id: 'only_supplied_real_photos',
    text: 'Use only the real photos supplied in the inputs photos/ folder. Motion such as slow zooms, pans and crops is fine. Do not pull stock footage or archive clips.',
  },
  {
    id: 'no_generated_imagery',
    text: 'Do not generate AI images or AI video of real places or real people, and do not generate a logo or a hero shot. No avatars, no face or voice cloning.',
  },
  {
    id: 'facts_only_from_brief',
    text: 'Every factual line (place names, times, durations, what is included) must come from brief.json. Do not add facts from web research, from memory, or by translating another language\'s brief.',
  },
  {
    id: 'no_price_or_discount',
    text: 'Do not mention prices, currency amounts, discounts, coupons, deals or "free". The website is the only source of prices.',
  },
  {
    id: 'no_ratings_or_superlatives',
    text: 'Do not mention ratings, reviews, star counts or customer counts, and do not use superlatives or hype ("best", "#1", "most popular", "must-see", "guaranteed").',
  },
  {
    id: 'no_dietary_safety_claims',
    text: 'Do not say or imply that any food, meal or restaurant is halal, vegan, vegetarian, allergy-safe or gluten-free.',
  },
  {
    id: 'do_not_lead_with_ai',
    text: 'Do not lead with "AI" and do not present CocoTrip as an AI product. Lead with the itinerary: real places, timed stops, a private vehicle.',
  },
  {
    id: 'burn_in_subtitles_target_locale',
    text: 'Burn in subtitles in the target language, using the brief.json strings verbatim.',
  },
  {
    id: 'photo_credits_required',
    text: 'Credit every photo you use on the end card, copying the lines from CREDITS.txt verbatim (do not translate or romanize names). Do not use a photo listed under NEEDS REVIEW until I confirm it.',
  },
  {
    id: 'budget_cap_and_paid_call_approval',
    text: 'Total paid provider spend for this project must stay at or under {budget} USD. Ask me before every paid API call, even under the cap, and show the estimated cost first.',
  },
]);

// ─────────────────────────────────────────────────────────────────────────────
// 위험 문구 스캐너
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 영상 문구로 쓰면 안 되는 표현. 보수적으로 잡는다 — 오탐은 문구 하나가 빠질 뿐이고,
 * 미탐은 영상에 가격·최상급·식이 주장이 박힌다.
 * (주의: zh 의 단독 '最' 는 '最后'(마지막에)·'最多'(최대 N명) 오탐이라 쓰지 않는다.)
 */
export const CLAIM_RISK_PATTERNS = Object.freeze({
  price: Object.freeze([
    /[₩$€£¥￥]/u,
    /\b(?:USD|KRW|JPY|CNY|RMB)\b/i,
    /\d[\d,.]*\s*(?:won\b|dollars?\b|원|만원|円|元)/iu, // \b: "2 wonderful days" 는 금액이 아니다
    /(?<![-\w])free\b(?!\s+time)/i, // duty-free / tax-free 는 가격 주장이 아니다
    /무료|無料|免费|免費/u,
    /\b(?:discounts?|deals?|sale|coupons?|promo|prices?|priced|pricing|cheap|cheapest|bargain)\b/i,
    /할인|쿠폰|특가|최저가|가격|요금|비용|割引|クーポン|セール|最安|料金|価格|費用|折扣|优惠|打折|特价|价格|费用/u,
  ]),
  rating: Object.freeze([
    /\b(?:ratings?|rated|reviews?|stars?)\b/i,
    /[\u2605\u2606\u2B50]/u, // 별 기호(평점 표기)
    /평점|별점|후기|리뷰|評価|レビュー|口コミ|评分|评价|好评|星级/u,
  ]),
  superlative: Object.freeze([
    /\b(?:best|No\.?\s?1|number\s+one|most|greatest|grandest|biggest|largest|oldest|finest|ultimate|unbeatable|unmatched|unrivall?ed|pinnacle|quintessential|masterpiece|perfect|world-class|guarantee[sd]?|must-(?:see|visit|do)|bucket\s+list|iconic|popular)\b/i,
    /#\s?1\b/,
    // "top landmarks"·"top 10"·"top-rated" 는 잡고 "to the top." / "to the top of Namsan" 은 통과
    /\btop(?:\s+|-)(?!of\b)(?=[a-z0-9])/i,
    /\bessential\s+(?=\p{Lu})/u, // "essential Busan" (= '부산 정수') — "quiet visiting is essential." 은 통과
    // '최대'·'最大' 바로 뒤 숫자는 정원·한도("최대 10인", "最大10名")라 최상급이 아니다
    // '한국 대표 해변' = en "Korea's top beach" (나라 단위 '대표' 만 — 'OO 의 대표 명소' 는 통과)
    /최고|최대(?!\s*\d)|최초|1위|필수|인기|유일|가장|베스트|넘버원|보장|정수|완벽|(?:한국|국내)\s*대표/u,
    /最高|最大(?!\s*\d)|最古|最初|最も|最人気|1位|必訪|必見|人気|保証|唯一|ベスト|ナンバーワン|精髄|精華|エッセンス|完璧|韓国代表/u,
    /最好|最佳|最受欢迎|最美|第一(?![天站日])|必去|必看|必游|热门|人气|保证|精髓|精华|标志性|標誌性|完美|巅峰|韩国代表|韓國代表/u,
  ]),
  dietary: Object.freeze([
    /\b(?:halal|kosher|vegan|vegetarian|plant-based|allerg\w*|gluten(?:-free)?|dairy-free|nut-free)\b/i,
    /할랄|비건|채식|알레르기|알러지|글루텐|ハラール|ハラル|ヴィーガン|ビーガン|ベジタリアン|アレルギー|グルテン|清真|素食|纯素|过敏|麸质/u,
  ]),
  ai_lead: Object.freeze([
    /\bAI\b/,
    /인공지능|人工知能|人工智能/u,
  ]),
});

/** text 에서 걸린 위험 표현 목록. [{ category, match }] — 없으면 빈 배열. */
export function findClaimRisks(text) {
  if (typeof text !== 'string' || text === '') return [];
  const hits = [];
  for (const [category, patterns] of Object.entries(CLAIM_RISK_PATTERNS)) {
    for (const re of patterns) {
      const m = text.match(re);
      if (m) {
        hits.push({ category, match: m[0] });
        break; // 카테고리당 첫 매치 하나면 충분
      }
    }
  }
  return hits;
}

/**
 * 문장 경계(. ! ? 뒤 공백, 。！？ 뒤). 구분자는 캡처해서 원문 그대로 다시 붙인다.
 * "Mt. Namsan"·"No. 1"·"incl." 같은 약어 뒤에서는 자르지 않는다 — 자르면 "Ride to Mt." 처럼 문장이
 * 중간에 끊기거나, "No." / "1 scenic spot" 으로 쪼개져 최상급 스캐너를 피해 간다.
 * (약어를 못 알아봐 두 문장이 하나로 합쳐지는 쪽은 둘 다 빠질 뿐이라 안전하다.)
 */
const SENTENCE_SPLIT = /((?<=[.!?])(?<!\b(?:Mt|Mts|St|No|Nos|Dr|Jr|Sr|Ave|Rd|Blvd|vs|approx|incl|excl|etc|e\.g|i\.e|[A-Z])\.)\s+|(?<=[。！？])\s*)/u;
/** 문장 안의 " — " 구 경계. */
const DASH_SPLIT = /(\s+[—–]\s+)/u;
const TERMINAL_PUNCT = /[.!?。！？]$/u;
/**
 * " — " 뒤 꼬리 구가 앞 구를 부정·한정하는 표지. 그런 꼬리만 떼면 앞 구가 과장·반대 뜻이 되므로
 * ("Shuttle included — free on weekdays only" → "Shuttle included.") 문장 전체를 뺀다. 오탐은 문장이 빠질 뿐이다.
 */
const QUALIFIER_RE = /\b(?:not|no|never|only|except|excluding|excl|without|unless|until|but|however|extra|additional|surcharge|separately|subject)\b|n't\b|않|못|없|제외|불가|별도|추가|단[,\s]|ない|ません|不可|のみ|だけ|以外|別途|追加|除|不|没|無|无|仅|只|另|额外/iu;

/**
 * 위험 표현이 든 한 문장 → 남길 문자열(없으면 '').
 * 부분 삭제는 "앞 구 — 꼬리 구" (대시 1개) 에서 **꼬리 구만** 위험하고, 꼬리가 부정·한정 표지가 아닐 때뿐이다
 * (예: "A · B · C — K-drama bucket list" → "A · B · C"). 그 밖에는 문장 전체를 뺀다:
 *   - 앞 구를 빼면 꼬리가 앞 구에 걸린 말일 수 있다 ("Free entry — only for hanbok wearers" → "Only for hanbok wearers.").
 *   - 대시가 2개 이상이면 가운데가 삽입구라 마지막 구를 빼면 문장이 깨진다 ("Combine A — made famous by B — with C").
 */
function filterSentence(sentence, removed) {
  const parts = sentence.split(DASH_SPLIT);
  if (parts.length === 3) {
    const [head, , tail] = parts;
    const tailRisks = findClaimRisks(tail);
    if (head.trim() && findClaimRisks(head).length === 0 && tailRisks.length > 0 && !QUALIFIER_RE.test(tail)) {
      removed.push({ segment: tail.trim(), risks: tailRisks });
      let out = head.trim();
      const terminal = sentence.trim().match(TERMINAL_PUNCT);
      if (terminal && !TERMINAL_PUNCT.test(out)) out += terminal[0];
      return out;
    }
  }
  removed.push({ segment: sentence.trim(), risks: findClaimRisks(sentence) });
  return '';
}

/**
 * 위험 표현이 있는 문장(또는 그 문장의 " — " 꼬리 구)만 빼고 나머지를 원래 구분자로 다시 잇는다.
 * 다 잇고 나서도 스캐너에 걸리면(분할 경계를 넘는 표현 등) 필드 전체를 비운다 — 위험 표현이 남는 것보다 낫다.
 * @returns {{ text: string, removed: Array<{ segment: string, risks: Array<{category:string,match:string}> }> }}
 */
export function filterClaimText(text) {
  if (typeof text !== 'string') return { text: '', removed: [] };
  const parts = text.split(SENTENCE_SPLIT);
  const kept = [];
  const removed = [];
  for (let i = 0; i < parts.length; i += 2) {
    const sentence = parts[i];
    const separator = i + 1 < parts.length ? parts[i + 1] : '';
    if (!sentence || !sentence.trim()) continue;
    const filtered = findClaimRisks(sentence).length > 0 ? filterSentence(sentence, removed) : sentence;
    if (filtered) kept.push({ sentence: filtered, separator });
  }
  const out = kept.map((k, idx) => (idx < kept.length - 1 ? `${k.sentence}${k.separator}` : k.sentence)).join('').trim();
  const residual = findClaimRisks(out);
  if (residual.length > 0) {
    removed.push({ segment: out, risks: residual });
    return { text: '', removed };
  }
  return { text: out, removed };
}

// ─────────────────────────────────────────────────────────────────────────────
// 사진 출처 (KTO 파일명 규칙)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `Type{공공누리 유형}_{제목}_{촬영/제공}_{6자리 id}[(n)].{ext}`
 *   예) /Type1_대릉원(천마총)_한국관광공사, 엠엠피 김진규_651iea(1).jpg
 * 제목은 첫 `_` 까지(lazy), 크레딧은 마지막 `_{id}` 직전까지(greedy) — 크레딧 안의 쉼표·공백 허용.
 */
const KOGL_FILE_RE = /^Type([1-4])_(.+?)_(.+)_([A-Za-z0-9]{6})(?:\(\d+\))?\.([A-Za-z0-9]+)$/u;
/** `{6자리 id}_{제목}[(n)].{ext}` — KTO 원본을 재인코딩한 것으로 보이나 크레딧이 파일명에 없음. */
const KTO_ID_PREFIX_RE = /^([A-Za-z0-9]{6})_(.+?)(?:\(\d+\))?\.([A-Za-z0-9]+)$/u;

/** 공공누리 유형별 이용 조건. 상업 영상 + 크롭/모션(변경) 에 문제없는 건 제1유형뿐. */
const KOGL_TERMS = Object.freeze({
  1: { commercial: true, modification: true, label: 'attribution only' },
  2: { commercial: false, modification: true, label: 'attribution + no commercial use' },
  3: { commercial: true, modification: false, label: 'attribution + no modification' },
  4: { commercial: false, modification: false, label: 'attribution + no commercial use + no modification' },
});

function basenameOf(p) {
  const s = String(p).split('?')[0].split('#')[0];
  const parts = s.split('/');
  return parts[parts.length - 1];
}

/**
 * 파일명에서 출처를 추정한다. 어디까지나 **파일명 기준 추정**이다 — 실제 라이선스는 운영자가 확인한다.
 * @param {string} photoPath  /public 기준 경로
 * @param {{ knownFiles?: string[] }} [opts]  public/ 루트의 Type*_ 파일명 목록(재인코딩본 크레딧 복원용)
 */
export function parsePhotoCredit(photoPath, opts = {}) {
  const name = basenameOf(photoPath);
  const m = name.match(KOGL_FILE_RE);
  if (m) {
    const type = Number(m[1]);
    const terms = KOGL_TERMS[type];
    const ok = terms.commercial && terms.modification;
    return {
      provenance: 'kogl',
      kogl_type: type,
      title: m[2],
      credit: m[3],
      kto_id: m[4],
      needs_review: !ok,
      note: ok
        ? `KOGL Type ${type} (${terms.label}) parsed from the file name. Confirm on the KTO source page before publishing.`
        : `KOGL Type ${type} (${terms.label}): not usable in a commercial or edited video without permission.`,
    };
  }
  const k = name.match(KTO_ID_PREFIX_RE);
  if (k) {
    const id = k[1];
    const known = Array.isArray(opts.knownFiles) ? opts.knownFiles : [];
    for (const candidate of known) {
      const cm = basenameOf(candidate).match(KOGL_FILE_RE);
      if (cm && cm[4] === id) {
        const recovered = parsePhotoCredit(candidate);
        return {
          ...recovered,
          recovered_from: basenameOf(candidate),
          note: `${recovered.note} Credit recovered from the matching original file (same id ${id}).`,
        };
      }
    }
    return {
      provenance: 'kto_id_only',
      kto_id: id,
      title: k[2],
      needs_review: true,
      note: `Looks like a re-encoded KTO photo (id ${id}) but the credit is not in the file name. Find the original credit before use.`,
    };
  }
  return {
    provenance: 'unknown',
    needs_review: true,
    note: 'Provenance unknown. Confirm the licence (and a model release if people are recognisable) before use.',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 투어 사진 계획
// ─────────────────────────────────────────────────────────────────────────────

/** string 또는 TourPhoto 객체 → 경로 문자열 (legacy_public_path 우선). 없으면 ''. */
function photoSourceOf(photo) {
  if (typeof photo === 'string') return photo.trim();
  if (photo && typeof photo === 'object') {
    if (typeof photo.legacy_public_path === 'string' && photo.legacy_public_path.trim()) return photo.legacy_public_path.trim();
    if (typeof photo.url === 'string') return photo.url.trim();
  }
  return '';
}

/** 투어가 참조하는 사진 경로 전부(중복 제거 전, 순서: stops → thumbnail → images → photos[]). */
export function collectTourPhotoSources(tour) {
  const out = [];
  for (const stop of Array.isArray(tour && tour.stops) ? tour.stops : []) {
    const src = photoSourceOf(stop && stop.photo);
    if (src) out.push(src);
  }
  const thumb = photoSourceOf(tour && tour.thumbnail_photo) || photoSourceOf(tour && tour.thumbnail);
  if (thumb) out.push(thumb);
  for (const img of Array.isArray(tour && tour.images) ? tour.images : []) {
    const src = photoSourceOf(img);
    if (src) out.push(src);
  }
  for (const p of Array.isArray(tour && tour.photos) ? tour.photos : []) {
    const src = photoSourceOf(p);
    if (src) out.push(src);
  }
  return out;
}

/** 장소명 비교용 — 공백·가운뎃점·괄호·대시·쉼표·마침표 제거, NFC. */
function normalizePlaceName(s) {
  return String(s).normalize('NFC').replace(/[\s·・()（）[\]—–\-_,.]/gu, '').toLowerCase();
}

function extensionOf(p) {
  const m = basenameOf(p).match(/\.([A-Za-z0-9]+)$/);
  return m ? `.${m[1].toLowerCase()}` : '';
}

/**
 * 투어 사진 → 복사 계획. 로컬 /public 경로만 대상, http(s)·누락·위험 경로는 skipped.
 * 복사본 파일명은 ASCII 로 바꾼다(한글·공백·쉼표·괄호 파일명은 ffmpeg/셸에서 깨지기 쉽다).
 *
 * @param {object} tour
 * @param {{ knownFiles?: string[], missing?: Iterable<string> }} [opts]
 *   missing: CLI 가 존재 확인 후 넘기는 "public/ 에 없는 경로" 목록.
 */
export function planTourPhotos(tour, opts = {}) {
  const missing = new Set(opts.missing ? Array.from(opts.missing) : []);
  const byPath = new Map();
  const skipped = [];
  const seenSkipped = new Set();

  const skip = (source, reason) => {
    const key = `${reason}:${source}`;
    if (seenSkipped.has(key)) return;
    seenSkipped.add(key);
    skipped.push({ source, reason });
  };

  const add = (source, role, stopNumber) => {
    if (!source) return null;
    if (/^[a-z][a-z0-9+.-]*:/i.test(source) || source.startsWith('//')) {
      skip(source, 'remote_url_not_copied');
      return null;
    }
    if (!source.startsWith('/') || source.split('/').includes('..')) {
      skip(source, 'unsafe_or_relative_path');
      return null;
    }
    if (missing.has(source)) {
      skip(source, 'missing_local_file');
      return null;
    }
    let entry = byPath.get(source);
    if (!entry) {
      entry = { source, role, is_cover: false, stop_numbers: [], ...parsePhotoCredit(source, opts) };
      byPath.set(source, entry);
    }
    if (typeof stopNumber === 'number' && !entry.stop_numbers.includes(stopNumber)) entry.stop_numbers.push(stopNumber);
    return entry;
  };

  const stops = Array.isArray(tour && tour.stops) ? tour.stops : [];
  stops.forEach((stop, idx) => add(photoSourceOf(stop && stop.photo), 'stop', idx + 1));

  const thumb = photoSourceOf(tour && tour.thumbnail_photo) || photoSourceOf(tour && tour.thumbnail);
  const coverEntry = add(thumb, 'cover');
  if (coverEntry) coverEntry.is_cover = true;

  for (const img of Array.isArray(tour && tour.images) ? tour.images : []) add(photoSourceOf(img), 'gallery');
  for (const p of Array.isArray(tour && tour.photos) ? tour.photos : []) add(photoSourceOf(p), 'gallery');

  for (const e of byPath.values()) if (e.stop_numbers.length > 0) e.stop_link = 'tour_data';

  // 데이터에 사진이 없는 정류지 ↔ KTO 사진 제목이 정류지 한국어 정식 명칭과 **완전히 같을 때만** 연결.
  // (부분 일치는 금지 — '경주' 가 '경주 한정식' 에 붙는 식의 오배선이 난다. docs/TOUR-PHOTO-AUDIT-MISTAKE-NOTES-2026-08-22.md)
  stops.forEach((stop, idx) => {
    if (photoSourceOf(stop && stop.photo)) return;
    const ko = stop && stop.name && typeof stop.name.ko === 'string' ? stop.name.ko : '';
    if (!ko) return;
    const wanted = new Set([normalizePlaceName(ko), normalizePlaceName(ko.replace(/^[^—–]+[—–]\s*/u, ''))]);
    for (const e of byPath.values()) {
      if (e.provenance !== 'kogl' && e.provenance !== 'kto_id_only') continue;
      if (!e.title || !wanted.has(normalizePlaceName(e.title))) continue;
      e.stop_numbers.push(idx + 1);
      if (!e.stop_link) e.stop_link = 'kto_title_match';
      e.role = 'stop';
      break;
    }
  });

  // 순서: 정류지(정류지 번호순) → 커버 전용 → 갤러리(삽입 순서 유지, stable sort)
  const rank = { stop: 0, cover: 1, gallery: 2 };
  const firstStop = (e) => (e.stop_numbers.length > 0 ? Math.min(...e.stop_numbers) : 0);
  const entries = Array.from(byPath.values())
    .sort((a, b) => (rank[a.role] - rank[b.role]) || (firstStop(a) - firstStop(b)));
  const photos = entries.map((e, i) => {
    const n = String(i + 1).padStart(2, '0');
    const suffix = e.role === 'stop' ? `stop-${firstStop(e)}` : e.role;
    return { file: `photos/${n}-${suffix}${extensionOf(e.source)}`, ...e };
  });
  return { photos, skipped };
}

// ─────────────────────────────────────────────────────────────────────────────
// brief
// ─────────────────────────────────────────────────────────────────────────────

/** 공개 투어 상세 URL. 언어별 URL 은 없다(src/lib/seoRoutes.ts — 같은 URL 에서 클라이언트가 언어 전환). */
export function tourPublicUrl(slug) {
  return `${PUBLIC_ORIGIN}/tours/${encodeURIComponent(slug)}`;
}

function localizedString(value, locale) {
  if (!value || typeof value !== 'object') return '';
  const s = value[locale];
  return typeof s === 'string' ? s.trim() : '';
}

function riskLabel(risks) {
  return risks.map((r) => `${r.category}: "${r.match}"`).join(', ');
}

/**
 * @param {object} tour     src/data/tours.ts 의 Tour (정적 카탈로그)
 * @param {'ko'|'en'|'ja'|'zh'} locale
 * @param {{
 *   isUngroundedBadgeTag: (tag: string) => boolean,
 *   platform?: 'instagram'|'youtube'|'tiktok',
 *   seconds?: number,
 *   budgetUsd?: number,
 *   generatedAt?: string,
 *   knownFiles?: string[],
 *   missing?: Iterable<string>,
 * }} opts
 * @returns {{ brief: object, warnings: string[], missingRequired: string[], photos: object[], skippedPhotos: object[] }}
 */
export function buildOpenMontageBrief(tour, locale, opts = {}) {
  if (!tour || typeof tour !== 'object' || typeof tour.slug !== 'string' || !tour.slug) {
    throw new TypeError('buildOpenMontageBrief: tour with a slug is required');
  }
  if (!LOCALES.includes(locale)) {
    throw new RangeError(`buildOpenMontageBrief: locale must be one of ${LOCALES.join(', ')} (got ${String(locale)})`);
  }
  if (typeof opts.isUngroundedBadgeTag !== 'function') {
    throw new TypeError('buildOpenMontageBrief: opts.isUngroundedBadgeTag (from src/data/tours.ts) is required');
  }
  const platformKey = opts.platform === undefined ? DEFAULT_PLATFORM : opts.platform;
  const profile = PLATFORM_PROFILES[platformKey];
  if (!profile) {
    throw new RangeError(`buildOpenMontageBrief: platform must be one of ${Object.keys(PLATFORM_PROFILES).join(', ')}`);
  }
  const seconds = opts.seconds === undefined ? DEFAULT_SECONDS : Number(opts.seconds);
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > profile.max_seconds) {
    throw new RangeError(`buildOpenMontageBrief: seconds must be between 1 and ${profile.max_seconds} for ${platformKey}`);
  }
  const budgetUsd = opts.budgetUsd === undefined ? DEFAULT_BUDGET_USD : Number(opts.budgetUsd);
  if (!Number.isFinite(budgetUsd) || budgetUsd < 0) {
    throw new RangeError('buildOpenMontageBrief: budgetUsd must be a number >= 0');
  }

  const info = LOCALE_INFO[locale];
  const warnings = [];
  const missingRequired = [];
  const warn = (msg) => warnings.push(`[${tour.slug}/${locale}] ${msg}`);

  /** 원문 문자열 → (생략 | 필터된 문자열). 다른 언어 폴백 없음. */
  const textField = (label, raw, mode) => {
    if (!raw) {
      warn(`${label}: missing in this locale, omitted (no fallback to another language)`);
      return '';
    }
    if (mode === 'whole') {
      const risks = findClaimRisks(raw);
      if (risks.length > 0) {
        warn(`${label}: removed (${riskLabel(risks)}): ${raw}`);
        return '';
      }
      return raw;
    }
    const { text, removed } = filterClaimText(raw);
    for (const r of removed) warn(`${label}: removed segment (${riskLabel(r.risks)}): ${r.segment}`);
    if (!text) warn(`${label}: nothing left after removing risky segments, omitted`);
    return text;
  };

  const title = textField('title', localizedString(tour.title, locale), 'whole');
  const hook = textField('hook (summary)', localizedString(tour.summary, locale), 'segments');
  const coreMessage = textField('core_message (description)', localizedString(tour.description, locale), 'segments');

  const keyPoints = [];
  (Array.isArray(tour.highlights) ? tour.highlights : []).forEach((h, i) => {
    const kp = textField(`key_points[${i}] (highlight)`, localizedString(h && h.text, locale), 'whole');
    if (kp) keyPoints.push(kp);
  });

  const { photos, skipped } = planTourPhotos(tour, { knownFiles: opts.knownFiles, missing: opts.missing });
  for (const s of skipped) warn(`photo skipped (${s.reason}): ${s.source}`);

  const stops = [];
  (Array.isArray(tour.stops) ? tour.stops : []).forEach((rawStop, i) => {
    const n = i + 1;
    const stop = rawStop && typeof rawStop === 'object' ? rawStop : {};
    const name = textField(`stops[${n}].name`, localizedString(stop.name, locale), 'whole');
    const description = textField(`stops[${n}].description`, localizedString(stop.description, locale), 'segments');
    if (!name) {
      warn(`stops[${n}]: dropped because it has no usable name in this locale`);
      return;
    }
    const entry = { order: n, time: String(stop.time || ''), name };
    if (typeof stop.stay_min === 'number' && stop.stay_min > 0) entry.stay_min = stop.stay_min;
    if (description) entry.description = description;
    const linked = photos.find((p) => p.stop_numbers.includes(n));
    if (linked) {
      entry.photo = linked.file;
      entry.photo_link = photoSourceOf(stop.photo) === linked.source ? 'tour_data' : 'kto_title_match';
    }
    stops.push(entry);
  });

  const tags = (Array.isArray(tour.tags) ? tour.tags : [])
    .filter((t) => typeof t === 'string' && !opts.isUngroundedBadgeTag(t));

  const ctaUrl = tourPublicUrl(tour.slug);
  const ctaDisplay = ctaUrl.replace(/^https:\/\//, '');
  const tracking = new URLSearchParams({
    utm_source: profile.target_platform,
    utm_medium: 'social_video',
    utm_campaign: 'tour_video',
    utm_content: `${tour.slug}_${locale}`,
  });

  const metadata = {
    source: 'cocotrip src/data/tours.ts (static catalogue)',
    generator: 'scripts/export-openmontage-brief.mjs',
    openmontage_schema_commit: OPENMONTAGE_PINNED_COMMIT,
    tour_id: String(tour.id || ''),
    slug: tour.slug,
    region: String(tour.region || ''),
    locale,
    language: info.language,
    subtitle_language_code: info.languageCode,
    media_profile: profile.media_profile,
    aspect_ratio: profile.aspect_ratio,
    night_tour: tour.isNightTour === true,
    tags,
    cta_display: ctaDisplay,
    cta_tracking_url: `${ctaUrl}?${tracking.toString()}`,
    stops,
    photos: photos.map((p) => {
      const out = { file: p.file, source: p.source, role: p.role, is_cover: p.is_cover };
      if (p.stop_numbers.length > 0) {
        out.stop_numbers = p.stop_numbers.slice().sort((a, b) => a - b);
        out.stop_link = p.stop_link;
      }
      out.provenance = p.provenance;
      if (p.kogl_type !== undefined) out.kogl_type = p.kogl_type;
      if (p.title !== undefined) out.title = p.title;
      if (p.credit !== undefined) out.credit = p.credit;
      out.needs_review = p.needs_review;
      out.note = p.note;
      return out;
    }),
    constraints: HARD_CONSTRAINTS.map((c) => c.id),
    budget_cap_usd: budgetUsd,
  };
  if (typeof tour.durationHours === 'number' && tour.durationHours > 0) metadata.duration_hours = tour.durationHours;
  if (typeof tour.durationDays === 'number' && tour.durationDays > 0) metadata.duration_days = tour.durationDays;
  if (typeof opts.generatedAt === 'string' && opts.generatedAt) metadata.generated_at = opts.generatedAt;

  const brief = { version: '1.0' };
  if (title) brief.title = title; else missingRequired.push('title');
  if (hook) brief.hook = hook; else missingRequired.push('hook');
  if (keyPoints.length > 0) brief.key_points = keyPoints;
  else {
    missingRequired.push('key_points');
    warn('key_points: no usable highlight in this locale');
  }
  if (coreMessage) brief.core_message = coreMessage;
  brief.cta = ctaUrl;
  brief.tone = BRIEF_TONE;
  brief.style = BRIEF_STYLE;
  brief.target_audience = info.audience;
  brief.target_platform = profile.target_platform;
  brief.target_duration_seconds = seconds;
  brief.reference_material = photos.map((p) => p.file);
  brief.metadata = metadata;

  if (photos.length === 0) warn('no local photo available: the video would have no real imagery');

  return { brief, warnings, missingRequired, photos, skippedPhotos: skipped };
}

/**
 * brief.schema.json (커밋 9327439) 최소 검증 — required, const, enum, 타입, minItems, additionalProperties:false.
 * 외부 의존성 없이 CLI·테스트에서 같은 기준을 쓰려고 직접 구현했다. 오류 문자열 배열(없으면 []).
 */
export function validateOpenMontageBrief(brief) {
  const errors = [];
  if (!brief || typeof brief !== 'object' || Array.isArray(brief)) return ['brief must be an object'];
  for (const key of BRIEF_REQUIRED_FIELDS) {
    if (!(key in brief)) errors.push(`missing required field: ${key}`);
  }
  for (const key of Object.keys(brief)) {
    if (!BRIEF_ALLOWED_FIELDS.includes(key)) errors.push(`additional property not allowed: ${key}`);
  }
  const isStr = (v) => typeof v === 'string';
  const isStrArray = (v) => Array.isArray(v) && v.every(isStr);
  if ('version' in brief && brief.version !== '1.0') errors.push('version must be "1.0"');
  if ('title' in brief && (!isStr(brief.title) || brief.title.length < 1)) errors.push('title must be a non-empty string');
  for (const key of ['hook', 'core_message', 'cta', 'tone', 'style', 'target_audience', 'selected_angle']) {
    if (key in brief && !isStr(brief[key])) errors.push(`${key} must be a string`);
  }
  if ('key_points' in brief && (!isStrArray(brief.key_points) || brief.key_points.length < 1)) {
    errors.push('key_points must be an array of at least 1 string');
  }
  if ('target_platform' in brief && !SCHEMA_TARGET_PLATFORMS.includes(brief.target_platform)) {
    errors.push(`target_platform must be one of ${SCHEMA_TARGET_PLATFORMS.join(', ')}`);
  }
  if ('target_duration_seconds' in brief
    && (typeof brief.target_duration_seconds !== 'number' || !(brief.target_duration_seconds >= 1))) {
    errors.push('target_duration_seconds must be a number >= 1');
  }
  if ('reference_material' in brief && !isStrArray(brief.reference_material)) errors.push('reference_material must be an array of strings');
  if ('angle_options' in brief) {
    const ok = Array.isArray(brief.angle_options) && brief.angle_options.every((a) => a && isStr(a.name) && isStr(a.description));
    if (!ok) errors.push('angle_options must be an array of { name, description } strings');
  }
  if ('metadata' in brief && (!brief.metadata || typeof brief.metadata !== 'object' || Array.isArray(brief.metadata))) {
    errors.push('metadata must be an object');
  }
  return errors;
}

// ─────────────────────────────────────────────────────────────────────────────
// prompt.md
// ─────────────────────────────────────────────────────────────────────────────

/** 센트 미만은 내림 — toFixed 반올림이면 1.999 가 "$2.00" 이 되어 요청보다 큰 상한을 적게 된다. */
function formatUsd(n) {
  const cents = Math.floor(Number(n) * 100 + 1e-6);
  return `$${(cents / 100).toFixed(2)}`;
}

/** prompt.md 에서 쓰는 하드 제약 문장(예산 치환 완료). 테스트도 이 함수로 기대값을 만든다. */
export function renderHardConstraints(budgetUsd) {
  return HARD_CONSTRAINTS.map((c) => c.text.replace('{budget}', formatUsd(budgetUsd)));
}

/**
 * OpenMontage 워크스페이스에서 연 Claude Code 에 붙여넣을 운영자 프롬프트(영어 지시문).
 * @param {object} brief  buildOpenMontageBrief().brief
 * @param {{ projectId?: string, inputsDir?: string }} [opts]
 */
export function buildOpenMontagePrompt(brief, opts = {}) {
  const meta = (brief && brief.metadata) || {};
  const locale = meta.locale;
  const info = LOCALE_INFO[locale];
  if (!info) throw new RangeError('buildOpenMontagePrompt: brief.metadata.locale is missing or unknown');
  const slug = String(meta.slug || 'tour');
  const projectId = opts.projectId || `cocotrip-${slug}-${locale}`;
  const inputsDir = opts.inputsDir || `projects/${projectId}/inputs`;
  const budget = typeof meta.budget_cap_usd === 'number' ? meta.budget_cap_usd : DEFAULT_BUDGET_USD;
  const stops = Array.isArray(meta.stops) ? meta.stops : [];
  const photos = Array.isArray(meta.photos) ? meta.photos : [];
  const reviewCount = photos.filter((p) => p.needs_review).length;
  const seconds = brief.target_duration_seconds;
  const constraints = renderHardConstraints(budget);
  const platformEntry = Object.values(PLATFORM_PROFILES).find((p) => p.target_platform === brief.target_platform);
  const platformLabel = platformEntry ? platformEntry.label : String(brief.target_platform);

  const lines = [
    `# OpenMontage prompt: ${brief.title || slug} (${locale})`,
    '',
    `Generated by CocoTrip \`scripts/export-openmontage-brief.mjs\`${meta.generated_at ? ` at ${meta.generated_at}` : ''}.`,
    `Copy this folder to \`${inputsDir}/\` inside the OpenMontage workspace, start Claude Code from the OpenMontage root in a clean shell (\`env -u GEMINI_API_KEY -u GOOGLE_API_KEY -u GOOGLE_APPLICATION_CREDENTIALS -u OPENAI_API_KEY claude\`), and paste everything below the line.`,
    'Keep the hard constraints exactly as written. Steps and pre-publish checks: CocoTrip docs/MARKETING-OPENMONTAGE-VIDEO-RUNBOOK.md.',
    '',
    '---',
    '',
    `Use the \`hybrid\` pipeline with anchor medium \`still_sequence\` (CocoTrip's own real photos) to make a ${seconds}-second ${meta.aspect_ratio || '9:16'} ${platformLabel} video (media profile \`${meta.media_profile}\`) in ${info.language}.`,
    '',
    `Project id: \`${projectId}\`. Inputs (read-only): \`${inputsDir}/brief.json\`, \`${inputsDir}/CREDITS.txt\` and the photos in \`${inputsDir}/photos/\`. brief.json is the only source of facts.`,
    '',
    '## Hard constraints (non-negotiable)',
    '',
    ...constraints.map((t, i) => `${i + 1}. ${t}`),
    '',
    '## Structure',
    '',
    '- Hook (first 2 to 3 seconds): the photo with `is_cover: true` in `metadata.photos`, with on-screen text taken from `hook` in brief.json (you may shorten it by dropping items, never by adding words).',
    `- Itinerary: the ${stops.length} entries of \`metadata.stops\` in order, each as a time + place card over that stop's own \`photo\` when it has one (\`photo_link\` says whether the link comes from CocoTrip's tour data or from an exact match with the KTO photo title). A stop without a photo gets a plain card: never put another place's photo behind it.`,
    '- Photos with role `gallery` are atmosphere only: no place caption, and never next to a stop card for a different place.',
    '- Key points: pick from `key_points` only, as short text cards. Do not rephrase them into claims they do not make.',
    `- End card: \`${meta.cta_display || ''}\`, then the photo credit lines from CREDITS.txt for the photos you actually used.`,
    `- Post caption link (not on screen): \`${meta.cta_tracking_url || brief.cta || ''}\`.`,
    '',
    '## Subtitles and audio',
    '',
    `- Burn in ${info.language} subtitles (language code ${info.languageCode}) using the brief.json strings verbatim. Use a font with full ${info.glyphs} glyph coverage and check that every glyph renders before the final render.`,
    `- Audio: show me two options with their cost before choosing: (a) no narration, with a track I placed in \`music_library/\` (I confirm its licence); (b) ${info.language} narration with a voice for ${info.languageCode} from the provider menu. Do not generate music with a paid provider without asking.`,
    '',
    '## Budget, approvals and safety',
    '',
    `- Budget cap: ${formatUsd(budget)} USD in total for paid provider calls. Check that \`config.yaml\` has \`budget.mode: cap\` and tell me before starting if it does not.`,
    '- Stop at every approval gate (idea, script, scene plan, assets, publish) and wait for my explicit approval. Approving one gate does not approve the next.',
    '- Do not install or update any package, and do not run `npx hyperframes` commands, without asking me first.',
    `- Do not upload or publish anything. The deliverable is \`projects/${projectId}/renders/final.mp4\`.`,
    reviewCount > 0
      ? `- ${reviewCount} photo(s) are listed under NEEDS REVIEW in CREDITS.txt. Ask me before using any of them.`
      : '- Every supplied photo has a parsed credit; still credit each one you use.',
    '',
    '## If something is missing',
    '',
    'If brief.json lacks a fact you need, leave it out or ask me. Never fill the gap from the web, from memory, or by translating the brief of another language.',
    '',
  ];
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// CREDITS.txt
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {{ brief: object, photos: object[], skippedPhotos: object[] }} result  buildOpenMontageBrief() 반환값
 */
export function buildCreditsText(result) {
  const meta = (result && result.brief && result.brief.metadata) || {};
  const info = LOCALE_INFO[meta.locale] || LOCALE_INFO.en;
  const photos = (result && result.photos) || [];
  const skipped = (result && result.skippedPhotos) || [];
  const credited = photos.filter((p) => p.provenance === 'kogl' && !p.needs_review);
  const review = photos.filter((p) => p.needs_review);

  const lines = [
    `CocoTrip photo credits: ${meta.slug || ''} (${meta.locale || ''})`,
    `Generated by scripts/export-openmontage-brief.mjs from src/data/tours.ts${meta.generated_at ? ` at ${meta.generated_at}` : ''}.`,
    'Credits are parsed from file names only (미검증). Verify each credit and licence before publishing.',
    '',
    '== END CARD: credit lines (copy verbatim for the photos you use) ==',
  ];
  if (credited.length === 0) lines.push('(none)');
  for (const p of credited) lines.push(`${p.file}  ${info.creditLine(p)}`);

  lines.push('', '== NEEDS REVIEW: do not use until the licence is confirmed ==');
  if (review.length === 0) lines.push('(none)');
  for (const p of review) {
    lines.push(`${p.file}  <- ${p.source}`);
    lines.push(`  ${p.note}`);
  }

  lines.push('', '== All copied photos ==');
  for (const p of photos) {
    const where = p.role === 'stop' ? `stop ${p.stop_numbers.join(', ')}` : p.role;
    lines.push(`${p.file}  <- ${p.source}  [${where}${p.is_cover ? ', cover' : ''}; ${p.provenance}]`);
  }

  if (skipped.length > 0) {
    lines.push('', '== Not copied ==');
    for (const s of skipped) lines.push(`${s.source}  (${s.reason})`);
  }
  lines.push('');
  return lines.join('\n');
}
