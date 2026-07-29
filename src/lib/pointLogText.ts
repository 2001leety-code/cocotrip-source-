/**
 * 포인트 내역 문구 현지화 (2026-07-30).
 *
 * 🔴 왜 필요한가: `pointHistory.description` 은 **서버가 영어로 저장한 값**이다.
 *   한국어로 보고 있는 손님의 마이페이지에도 그대로 영어가 뜬다. 특히
 *   `Ledger correction: removed AI-plan estimates not backed by a verified PayPal capture (plan …)`
 *   같은 문장은 "내 코인이 왜 줄었지?" 를 설명해야 하는 자리인데 영어라 아무것도 설명하지 못한다.
 *
 * 🔴 저장된 값은 바꾸지 않는다. 감사 기록이므로 원문이 남아야 한다.
 *   화면에 그릴 때만 아는 형태를 골라 번역하고, 모르는 문장은 원문 그대로 둔다
 *   (운영자가 손으로 쓴 설명까지 뭉개면 안 된다).
 */

export type PointLogLang = 'ko' | 'en' | 'ja' | 'zh';

/** 이 보정이 남긴 역분개 문장. api/… 실행부가 쓴 정확한 접두사. */
const CORRECTION_PREFIX =
  'Ledger correction: removed AI-plan estimates not backed by a verified PayPal capture';

const CORRECTION_TEXT: Record<PointLogLang, string> = {
  ko: '원장 보정 — 결제로 확인되지 않은 AI 플랜 추정 금액을 되돌림',
  en: 'Ledger correction — removed AI-plan estimates not backed by a verified payment',
  ja: '台帳補正 — 決済で確認できない AI プラン概算を取り消し',
  zh: '账目修正 — 移除未经支付验证的 AI 行程估算',
};

/** `AI Plan: Seoul ($942.86)` 형태 — 플랜 생성으로 잘못 적립되던 옛 기록. */
const AI_PLAN_RE = /^AI Plan:\s*(.+?)\s*\(\$([0-9.,]+)\)\s*$/;

const AI_PLAN_TEXT: Record<PointLogLang, (place: string) => string> = {
  ko: (p) => `AI 플랜 생성 (${p})`,
  en: (p) => `AI plan created (${p})`,
  ja: (p) => `AI プラン作成 (${p})`,
  zh: (p) => `生成 AI 行程 (${p})`,
};

/**
 * 화면에 그릴 문구. 아는 형태만 번역하고 나머지는 원문을 돌려준다.
 *
 * @param description 서버가 저장한 원문
 * @param lang        현재 화면 언어
 */
export function describePointLog(description: string | undefined, lang: string): string {
  const raw = String(description || '');
  if (!raw) return '';
  const l = (['ko', 'en', 'ja', 'zh'].includes(lang) ? lang : 'en') as PointLogLang;

  if (raw.startsWith(CORRECTION_PREFIX)) return CORRECTION_TEXT[l];

  const m = raw.match(AI_PLAN_RE);
  if (m) return AI_PLAN_TEXT[l](m[1]);

  return raw;
}
