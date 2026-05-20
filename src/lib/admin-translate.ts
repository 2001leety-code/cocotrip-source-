// ─────────────────────────────────────────────────────────────────────────────
// admin-translate.ts — 어드민 AI 번역 클라이언트 헬퍼
// Phase 4 (2026-05-19): ko → en/ja/zh
// Phase 5 (2026-05-20): 4-lang any-direction (source.lang 명시)
//
// /api/admin-translate 호출. Firebase ID token 필요 (admin only).
// ─────────────────────────────────────────────────────────────────────────────
import type { User } from 'firebase/auth';

// P117 (2026-05-20): I18nString import 제거 — Phase 5 변경 후 LangCode 만 사용.
// Phase 4 는 targets?: Array<keyof I18nString & ('en'|'ja'|'zh')> 였으나
// Phase 5 는 LangCode 로 단순화.

export type LangCode = 'ko' | 'en' | 'ja' | 'zh';

export interface TranslateResult {
  ko?: string;
  en?: string;
  ja?: string;
  zh?: string;
}

interface TranslateOptions {
  /** "투어 제목" / "FAQ 답변" 같은 문맥 힌트 (선택, 번역 톤 보정) */
  context?: string;
  /** 기본 = ALL 4 lang − source.lang. 비어있는 lang 만 채울 때 customize. */
  targets?: LangCode[];
}

/**
 * 4-lang any-direction 번역. source 언어 명시 + target 자동 (self-skip).
 * Phase 5 (2026-05-20) — P104 이후 어드민 상품 시스템에서 외국어 import 시 사용.
 *
 * 예: source={lang:'en', text:'Royal Palace Tour'} → ko/ja/zh 자동 채움.
 */
export async function translateFromSource(
  user: User,
  source: { lang: LangCode; text: string },
  opts: TranslateOptions = {},
): Promise<TranslateResult> {
  if (!source?.text || !source.text.trim()) {
    throw new Error(`${source.lang} 텍스트가 비어있습니다.`);
  }

  const idToken = await user.getIdToken();
  const resp = await fetch('/api/admin-translate', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      source: { lang: source.lang, text: source.text.trim() },
      targets: opts.targets,
      context: opts.context,
    }),
  });

  const json = await resp.json().catch(() => ({}));
  if (!resp.ok || !json.ok) {
    throw new Error(json.error || `HTTP ${resp.status}`);
  }
  return json.data as TranslateResult;
}

/**
 * Legacy ko → others wrapper. Phase 4 호환 — 신규 코드는 translateFromSource
 * 사용 권장. 4 lang 중 어느 source 든 동일 endpoint.
 */
export async function translateKoreanToOthers(
  user: User,
  korean: string,
  opts: Omit<TranslateOptions, 'targets'> & { targets?: Array<'en' | 'ja' | 'zh'> } = {},
): Promise<TranslateResult> {
  return translateFromSource(
    user,
    { lang: 'ko', text: korean },
    {
      context: opts.context,
      targets: opts.targets ?? ['en', 'ja', 'zh'],
    },
  );
}
