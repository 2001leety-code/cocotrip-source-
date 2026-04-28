/**
 * Client-side mirror of api/_ai_core/sanitizeName.js.
 * Multilingual stop name sanitizer — display-time fallback when backend missed.
 * Algorithm identical to server module.
 */

type Lang = 'ko' | 'en' | 'ja' | 'zh';

function classifyWord(w: string): Lang | 'common' {
  if (/[가-힣]/.test(w)) return 'ko';
  if (/[぀-ゟ゠-ヿ]/.test(w)) return 'ja';
  if (/[一-龿]/.test(w)) return 'zh';
  if (/[A-Za-z]/.test(w)) return 'en';
  return 'common';
}

function pickByLang(tokens: string[], lang: Lang): string {
  const langPattern: Record<Lang, RegExp> = {
    ko: /[가-힣]/,
    en: /^[\sA-Za-z\d().'\-,&]+$/,
    zh: /[一-龿]/,
    ja: /[぀-ゟ゠-ヿ]/,
  };
  const pat = langPattern[lang] || langPattern.ko;
  const exclude = lang === 'zh' ? /[぀-ゟ゠-ヿ]/ : null;
  for (const t of tokens) {
    if (pat.test(t) && (!exclude || !exclude.test(t))) return t.trim();
  }
  return tokens[0].trim();
}

function extractPhrase(s: string, lang: Lang): string | null {
  const words = s.split(/\s+/);
  const groups: { lang: Lang | 'common' | null; words: string[] }[] = [];
  let current: { lang: Lang | 'common' | null; words: string[] } = { lang: null, words: [] };
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

export function sanitizeStopName(raw: string | undefined | null, lang: Lang = 'ko'): string {
  if (!raw || typeof raw !== 'string') return raw || '';
  const s = raw.trim();
  if (!s) return s;

  if (/[|/ㅣ│]/.test(s)) {
    const tokens = s.split(/\s*[|/ㅣ│]\s*/).filter(Boolean);
    if (tokens.length > 1) {
      const picked = pickByLang(tokens, lang);
      const innerScripts = [/[가-힣]/, /[A-Za-z]{2,}/, /[一-龿]/, /[぀-ゟ゠-ヿ]/].filter(r => r.test(picked)).length;
      if (innerScripts >= 2) {
        const phrase = extractPhrase(picked, lang);
        if (phrase && phrase.length >= 2) return phrase;
      }
      return picked;
    }
  }

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
