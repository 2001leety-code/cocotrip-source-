// wttr.in 날씨 설명 다국어 헬퍼 (2026-07-17).
// 배경: 홈/마이페이지 날씨 칩이 wttr.in 영어 설명("Partly cloudy")을 그대로 노출 —
// ko/ja/zh 화면에 영어 잔존. wttr.in 은 `?lang=xx` 요청 시 j1 JSON 의
// current_condition[0][`lang_${xx}`][0].value 에 번역 설명을 담아준다.
// 번역 필드가 없거나 요청 실패 시 영어(weatherDesc) 폴백 — 표시 자체는 항상 보장.

/** UI 언어 → wttr.in lang 코드 (en 은 파라미터 불필요). */
export const WTTR_LANG: Record<string, string> = { ko: 'ko', ja: 'ja', zh: 'zh-cn' };

/** wttr.in 요청 URL 에 붙일 lang 쿼리 (en 이면 빈 문자열). */
export function wttrLangParam(language: string): string {
  const code = WTTR_LANG[language];
  return code ? `&lang=${code}` : '';
}

type WttrValue = { value?: string };
type WttrCurrent = Record<string, unknown> & { weatherDesc?: WttrValue[] };

/** current_condition[0] 에서 UI 언어 설명 추출 (없으면 영어 폴백). */
export function pickWeatherDesc(cur: WttrCurrent | undefined | null, language: string): string {
  if (!cur) return '';
  const code = WTTR_LANG[language];
  if (code) {
    const localized = (cur[`lang_${code}`] as WttrValue[] | undefined)?.[0]?.value;
    if (localized) return localized;
  }
  return cur.weatherDesc?.[0]?.value || '';
}
