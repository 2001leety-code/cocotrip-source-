/**
 * Multilingual stop name sanitizer.
 *
 * 사용자 PDF 보고로 발견된 패턴:
 *   - "Pig Company Myeongdong ... 강남 돼지상회 ... 明洞サムギョプサル焼肉" (3-script inline, space-separated)
 *   - "고기굽는놈(Korean BBQ) / The Guy ... / 烤肉的家伙 ... / 肉を焼く奴 ..." (4-language slash-separated)
 *
 * 원인: Gemini가 prompt 위반 (CLAUDE.md B.2 절대 금지) + food_index raw name이 그대로 전달됨.
 *
 * 처방: 모든 stop.name / stop.display_name 필드에 본 sanitizer 적용:
 *   1. pipe/slash 분리 → 사용자 lang 토큰 선택
 *   2. mixed-script inline → 같은 script의 단어 그룹만 추출
 *
 * 사용처:
 *   - api/_ai_core/responseValidator.js (Gemini plan 출력 후처리)
 *   - api/translate-plan.js (번역 출력 후처리)
 *   - scripts/build-food-index.js (DB 빌드 시 cleansing)
 *
 * 클라이언트 미러: src/lib/sanitizeName.ts (동일 알고리즘)
 */

/** Returns 'ko' | 'en' | 'ja' | 'zh' | 'common' for a single word. */
function classifyWord(w) {
  if (/[가-힣]/.test(w)) return 'ko';
  if (/[぀-ゟ゠-ヿ]/.test(w)) return 'ja'; // Hiragana / Katakana → Japanese
  if (/[一-龿]/.test(w)) return 'zh';      // Hanzi only (no kana) → Chinese
  if (/[A-Za-z]/.test(w)) return 'en';
  return 'common'; // numbers, punctuation, brand symbols
}

/** Pick the first token matching the target language. */
function pickByLang(tokens, lang) {
  const langPattern = {
    ko: /[가-힣]/,
    en: /^[\sA-Za-z\d().'\-,&]+$/,
    zh: /[一-龿]/,
    ja: /[぀-ゟ゠-ヿ]/,
  };
  const pat = langPattern[lang] || langPattern.ko;
  // For zh: exclude tokens with kana (those are ja).
  const exclude = lang === 'zh' ? /[぀-ゟ゠-ヿ]/ : null;
  for (const t of tokens) {
    if (pat.test(t) && (!exclude || !exclude.test(t))) return t.trim();
  }
  return tokens[0].trim();
}

/** Extract phrase matching target lang from mixed-script string. */
function extractPhrase(s, lang) {
  const words = s.split(/\s+/);
  const groups = [];
  let current = { lang: null, words: [] };
  for (const w of words) {
    const c = classifyWord(w);
    if (c === 'common' || c === current.lang) {
      current.words.push(w);
    } else {
      if (current.words.length) groups.push(current);
      current = { lang: c, words: [w] };
    }
  }
  if (current.words.length) groups.push(current);
  const matches = groups.filter(g => g.lang === lang);
  if (matches.length) return matches.map(g => g.words.join(' ')).join(' ').trim();
  return null;
}

/**
 * Sanitize a stop name by removing other-language tokens.
 * @param {string} raw - Original name (potentially multilingual concat).
 * @param {'ko'|'en'|'ja'|'zh'} lang - Target user language.
 * @returns {string} Cleaned single-language name.
 */
export function sanitizeStopName(raw, lang = 'ko') {
  if (!raw || typeof raw !== 'string') return raw || '';
  const s = raw.trim();
  if (!s) return s;

  // Layer 1: pipe/slash/Korean-bar separator
  if (/[|/ㅣ│]/.test(s)) {
    const tokens = s.split(/\s*[|/ㅣ│]\s*/).filter(Boolean);
    if (tokens.length > 1) {
      const picked = pickByLang(tokens, lang);
      // 선택된 토큰이 여전히 mixed-script면 inline 추출 (e.g. "엉터리 Ungteori Hongdae kbbq" → en일 때 "Ungteori Hongdae kbbq")
      const innerScripts = [/[가-힣]/, /[A-Za-z]{2,}/, /[一-龿]/, /[぀-ゟ゠-ヿ]/].filter(r => r.test(picked)).length;
      if (innerScripts >= 2) {
        const phrase = extractPhrase(picked, lang);
        if (phrase && phrase.length >= 2) return phrase;
      }
      return picked;
    }
  }

  // Layer 2: mixed-script inline (no separator)
  const hasHangul = /[가-힣]/.test(s);
  const hasLatin = /[A-Za-z]{2,}/.test(s);
  const hasHanzi = /[一-龿]/.test(s);
  const hasKana = /[぀-ゟ゠-ヿ]/.test(s);
  const scriptCount = [hasHangul, hasLatin, hasHanzi, hasKana].filter(Boolean).length;
  if (scriptCount >= 2) {
    const phrase = extractPhrase(s, lang);
    if (phrase && phrase.length >= 2) return phrase;
  }

  return s;
}

/** CommonJS compat for scripts/build-food-index.js (Node CJS). */
export default { sanitizeStopName };
