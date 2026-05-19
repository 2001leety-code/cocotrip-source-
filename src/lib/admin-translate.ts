// ─────────────────────────────────────────────────────────────────────────────
// admin-translate.ts — 어드민 AI 번역 클라이언트 헬퍼 (Phase 4, 2026-05-19)
//
// /api/admin-translate 호출. Firebase ID token 필요 (admin only).
// ─────────────────────────────────────────────────────────────────────────────
import type { User } from 'firebase/auth';
import type { I18nString } from '@/data/tours';

export interface TranslateResult {
  en?: string;
  ja?: string;
  zh?: string;
}

interface TranslateOptions {
  /** "투어 제목" / "FAQ 답변" 같은 문맥 힌트 (선택, 번역 톤 보정) */
  context?: string;
  /** 기본 ['en','ja','zh']. 비어있는 lang 만 채울 때 customize. */
  targets?: Array<keyof I18nString & ('en' | 'ja' | 'zh')>;
}

/** ko 텍스트 → en/ja/zh 자동 번역. user 가 admin 이 아니면 backend 가 401 응답. */
export async function translateKoreanToOthers(
  user: User,
  korean: string,
  opts: TranslateOptions = {},
): Promise<TranslateResult> {
  if (!korean || !korean.trim()) throw new Error('한국어 텍스트가 비어있습니다.');

  const idToken = await user.getIdToken();
  const resp = await fetch('/api/admin-translate', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      korean: korean.trim(),
      targets: opts.targets ?? ['en', 'ja', 'zh'],
      context: opts.context,
    }),
  });

  const json = await resp.json().catch(() => ({}));
  if (!resp.ok || !json.ok) {
    throw new Error(json.error || `HTTP ${resp.status}`);
  }
  return json.data as TranslateResult;
}
